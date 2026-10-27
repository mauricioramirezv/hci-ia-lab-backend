import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Account, AuthApplication, GlobalRole, LocalMailOutbox } from '../application/auth.js';
import type { AccountStatus } from '../domain/account.js';
import type { Config } from '../../config.js';

const body = (fields: Record<string, object>, required = Object.keys(fields)) => ({ type: 'object', additionalProperties: false, required, properties: fields });
const tokenSchema = { type: 'string', minLength: 1, maxLength: 256 };
const eventServices = ['identidad','aprendizaje','comunidad','evidencias'] as const;
const globalRoleSchema = { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['administrator', 'participant', 'teacher', 'evaluator'] } };
function cookies(request: FastifyRequest) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    const value = part.slice(index + 1);
    try { return [part.slice(0, index), decodeURIComponent(value)]; } catch { return [part.slice(0, index), value]; }
  }));
}
function setCookie(reply: FastifyReply, name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: string; maxAge?: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${options.sameSite}`, ...(options.httpOnly ? ['HttpOnly'] : []), ...(options.secure ? ['Secure'] : []), ...(options.maxAge === undefined ? [] : [`Max-Age=${options.maxAge}`])];
  const previous = reply.getHeader('set-cookie');
  const headers = Array.isArray(previous) ? previous : [...(typeof previous === 'string' ? [previous] : [])];
  reply.header('set-cookie', [...headers, parts.join('; ')]);
}
function secretMatches(received: string | undefined, expected: string | undefined) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerAuthRoutes(app: FastifyInstance, auth: AuthApplication, config: Config, localMailer?: LocalMailOutbox) {
  const sessionCookie = 'hci_identity_session';
  const csrfCookie = 'hci_identity_csrf';
  const clear = (reply: FastifyReply) => {
    setCookie(reply, sessionCookie, '', { httpOnly: true, secure: config.cookieSecure, sameSite: config.sameSite, maxAge: 0 });
    setCookie(reply, csrfCookie, '', { httpOnly: false, secure: config.cookieSecure, sameSite: config.sameSite, maxAge: 0 });
  };
  const originAllowed = (request: FastifyRequest) => !request.headers.origin || config.corsOrigins.includes(request.headers.origin);
  const csrfValid = async (request: FastifyRequest) => {
    const values = cookies(request);
    const header = request.headers['x-csrf-token'];
    return typeof header === 'string' && header === values[csrfCookie] && await auth.sessionValid(values[sessionCookie] ?? '', header);
  };
  const current = async (request: FastifyRequest) => {
    const token = cookies(request)[sessionCookie];
    return token ? auth.current(token) : null;
  };
  const invalid = (reply: FastifyReply, code: string, status = 400) => reply.code(status).send({ code, requestId: reply.request.id });
  const isAdmin = (account: Account) => account.globalRoles.includes('administrator') && account.permissions.includes('account:manage');

  app.get('/v1/auth-options', { schema: {
    operationId: 'getAuthenticationOptions', tags: ['identity'],
    response: { 200: { type: 'object', additionalProperties: false, required: ['delivery'], properties: { delivery: { type: 'string', enum: ['local', 'smtp_local', 'smtp'] }, developmentInboxUrl: { type: 'string', format: 'uri' } } } },
  } }, async () => {
    const isLocalSmtp = config.mailTransport === 'smtp' && config.nodeEnv === 'development' && !!config.developmentInboxUrl && new URL(config.smtpUrl!).hostname === 'mailpit';
    return isLocalSmtp
      ? { delivery: 'smtp_local', developmentInboxUrl: config.developmentInboxUrl }
      : { delivery: config.mailTransport === 'local' ? 'local' : 'smtp' };
  });

  app.post('/v1/accounts', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: {
    operationId: 'registerAccount', tags: ['identity'], body: body({ email: { type: 'string', maxLength: 254 }, password: { type: 'string', minLength: 12, maxLength: 128 }, displayName: { type: 'string', maxLength: 100 }, lastName: { type: 'string', minLength: 1, maxLength: 100 } }, ['email', 'password', 'displayName']),
    response: { 202: { type: 'object', properties: { message: { type: 'string' } } } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const input = request.body as { email: string; password: string; displayName: string; lastName?: string };
    try { await auth.register(input.email, input.password, input.displayName, input.lastName); return reply.code(202).send({ message: 'Si el correo puede registrarse, recibirá instrucciones.' }); }
    catch (error) { const code = error instanceof Error ? error.message : ''; if (['INVALID_EMAIL', 'PASSWORD_POLICY', 'INVALID_NAME'].includes(code)) return invalid(reply, code); throw error; }
  });

  app.post('/v1/email-verifications', { schema: { operationId: 'verifyEmail', tags: ['identity'], body: body({ token: tokenSchema }) } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    return await auth.verify((request.body as { token: string }).token) ? { verified: true } : invalid(reply, 'TOKEN_INVALID_OR_EXPIRED');
  });

  app.post('/v1/email-verifications/resend', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: {
    operationId: 'resendEmailVerification', tags: ['identity'], body: body({ email: { type: 'string', maxLength: 254 } }),
    response: { 202: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    await auth.resendVerification((request.body as { email: string }).email);
    return reply.code(202).send({ message: 'Si la cuenta puede verificar su correo, recibirÃ¡ instrucciones.' });
  });

  app.post('/v1/sessions', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: {
    operationId: 'createSession', tags: ['identity'], response: { 200: { $ref: 'BrowserSession#' } }, body: body({ email: { type: 'string', maxLength: 254 }, password: { type: 'string', maxLength: 128 } }),
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const input = request.body as { email: string; password: string };
    const csrf = randomBytes(32).toString('base64url');
    let session: Awaited<ReturnType<AuthApplication['login']>> = null;
    try { session = await auth.login(input.email, input.password, csrf); }
    catch (error) { if (!(error instanceof Error && error.message === 'INVALID_EMAIL')) throw error; }
    if (!session) return invalid(reply, 'INVALID_CREDENTIALS', 401);
    const maxAge = Math.floor((session.expires.getTime() - Date.now()) / 1000);
    setCookie(reply, sessionCookie, session.token, { httpOnly: true, secure: config.cookieSecure, sameSite: config.sameSite, maxAge });
    setCookie(reply, csrfCookie, csrf, { httpOnly: false, secure: config.cookieSecure, sameSite: config.sameSite, maxAge });
    return { account: session.account, csrfToken: csrf, expiresAt: session.expires.toISOString() };
  });

  app.delete('/v1/sessions/current', { schema: { operationId: 'revokeSession', tags: ['identity'], security: [{ sessionCookie: [], csrfHeader: [] }] } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const value = cookies(request);
    if (value[sessionCookie] && !await csrfValid(request)) return invalid(reply, 'CSRF_INVALID', 403);
    if (value[sessionCookie]) await auth.logout(value[sessionCookie]);
    clear(reply);
    return reply.code(204).send();
  });

  app.get('/v1/accounts/me', { schema: { operationId: 'getProfile', tags: ['identity'], response: { 200: { $ref: 'CurrentSession#' } }, security: [{ sessionCookie: [] }] } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const account = await current(request);
    if (!account) return invalid(reply, 'UNAUTHENTICATED', 401);
    const values = cookies(request), csrf = values[csrfCookie];
    if (!csrf || !await auth.sessionValid(values[sessionCookie] ?? '', csrf)) return invalid(reply, 'CSRF_INVALID', 403);
    return { account, csrfToken: csrf };
  });

  app.patch('/v1/accounts/me', { schema: { operationId: 'updateProfile', tags: ['identity'], security: [{ sessionCookie: [], csrfHeader: [] }], body: body({ displayName: { type: 'string', maxLength: 100 }, lastName: { type: 'string', maxLength: 100 }, version: { type: 'integer', minimum: 1 } }, ['displayName', 'version']) } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    if (!await csrfValid(request)) return invalid(reply, 'CSRF_INVALID', 403);
    const account = await current(request);
    if (!account) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { displayName: string; lastName?: string; version: number };
    const version = await auth.updateProfile(account.id, input.version, input.displayName, input.lastName);
    return version ? { version } : invalid(reply, 'VERSION_CONFLICT', 409);
  });

  app.post('/v1/password-resets', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: { operationId: 'requestPasswordReset', tags: ['identity'], body: body({ email: { type: 'string', maxLength: 254 } }) } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    await auth.requestReset((request.body as { email: string }).email);
    return reply.code(202).send({ message: 'Si la cuenta existe, recibirá instrucciones.' });
  });

  app.post('/v1/password-resets/complete', { schema: { operationId: 'completePasswordReset', tags: ['identity'], body: body({ token: tokenSchema, password: { type: 'string', minLength: 12, maxLength: 128 } }) } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const input = request.body as { token: string; password: string };
    try { return await auth.completeReset(input.token, input.password) ? { completed: true } : invalid(reply, 'TOKEN_INVALID_OR_EXPIRED'); }
    catch (error) { if (error instanceof Error && error.message === 'PASSWORD_POLICY') return invalid(reply, error.message); throw error; }
  });

  app.get('/v1/admin/accounts', { schema: { operationId: 'listAccounts', tags: ['identity'], security: [{ sessionCookie: [] }], querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, default: 0 } } } } }, async (request, reply) => {
    const actor = await current(request);
    if (!actor) return invalid(reply, 'UNAUTHENTICATED', 401);
    if (!isAdmin(actor)) return invalid(reply, 'FORBIDDEN', 403);
    const query = request.query as { limit?: number; offset?: number };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const rows = await auth.adminList(limit, offset);
    return { items: rows.map(account => ({ id: account.id, email: account.email, displayName: account.display_name, lastName: account.last_name, platformRole: account.global_roles.includes('administrator') ? 'admin' : 'participant', globalRoles: account.global_roles, emailVerified: !!account.email_verified_at, status: account.status, disabled: account.status === 'inactive', createdAt: account.created_at, version: account.version })), limit, offset };
  });

  app.patch<{ Params: { id: string } }>('/v1/admin/accounts/:id', { schema: { operationId: 'adminUpdateAccount', tags: ['identity'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: body({
    platformRole: { type: 'string', enum: ['participant', 'admin'] }, disabled: { type: 'boolean' }, globalRoles: globalRoleSchema,
    status: { type: 'string', enum: ['pending', 'active', 'inactive', 'locked'] }, version: { type: 'integer', minimum: 1 },
  }, ['version']) } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    if (!await csrfValid(request)) return invalid(reply, 'CSRF_INVALID', 403);
    const actor = await current(request);
    if (!actor) return invalid(reply, 'UNAUTHENTICATED', 401);
    if (!isAdmin(actor) || !actor.permissions.includes('role:assign')) return invalid(reply, 'FORBIDDEN', 403);
    const input = request.body as { platformRole?: 'participant' | 'admin'; disabled?: boolean; globalRoles?: GlobalRole[]; status?: AccountStatus; version: number };
    let outcome: string;
    if (input.globalRoles && input.status) outcome = await auth.adminUpdateRoles(request.params.id, input.globalRoles, input.status, input.version, actor.id);
    else if (input.platformRole && typeof input.disabled === 'boolean') outcome = await auth.adminUpdate(request.params.id, input.platformRole, input.disabled, input.version, actor.id);
    else return invalid(reply, 'INVALID_REQUEST');
    if (outcome === 'NOT_FOUND') return invalid(reply, 'ACCOUNT_NOT_FOUND', 404);
    if (outcome === 'CONFLICT' || outcome === 'LAST_ADMIN' || outcome === 'EMAIL_NOT_VERIFIED' || outcome === 'INVALID_STATUS_TRANSITION') return invalid(reply, outcome === 'CONFLICT' ? 'VERSION_CONFLICT' : outcome, 409);
    if (outcome === 'INVALID_ROLE') return invalid(reply, 'INVALID_ROLE');
    return outcome === 'OK' ? { updated: true } : invalid(reply, 'INTERNAL_ERROR', 500);
  });

  const eventTargets:Record<(typeof eventServices)[number],string>={identidad:config.identityBaseUrl,aprendizaje:config.learningBaseUrl,comunidad:config.communityBaseUrl,evidencias:config.evidenceBaseUrl};
  app.get('/v1/admin/integrations/events', { schema: { operationId: 'listIntegrationEventStatus', tags: ['identity-admin'], security: [{ sessionCookie: [] }] } }, async(request,reply)=>{
    if(!originAllowed(request))return invalid(reply,'FORBIDDEN',403);
    const actor=await current(request);if(!actor)return invalid(reply,'UNAUTHENTICATED',401);if(!isAdmin(actor))return invalid(reply,'FORBIDDEN',403);
    const items=await Promise.all(eventServices.map(async service=>{
      try{
        if(!config.identityInternalToken)throw new Error('UNAVAILABLE');
        const response=await fetch(`${eventTargets[service]}/internal/v1/events/status`,{headers:{'x-identity-internal-token':config.identityInternalToken,'x-request-id':request.id},signal:AbortSignal.timeout(2500)});
        if(!response.ok)throw new Error('UNAVAILABLE');
        const payload=await response.json() as {outbox?:unknown;inbox?:unknown;deadLetters?:unknown};
        if(!Array.isArray(payload.outbox)||!payload.inbox||typeof payload.inbox!=='object'||!Array.isArray(payload.deadLetters))throw new Error('INVALID_RESPONSE');
        return {service,state:'available' as const,outbox:payload.outbox,inbox:payload.inbox,deadLetters:payload.deadLetters};
      }catch{return {service,state:'unavailable' as const,code:'DEPENDENCY_UNAVAILABLE'};}
    }));
    return {items,requestId:request.id};
  });

  app.post('/v1/admin/integrations/events/retry', { config:{rateLimit:{max:10,timeWindow:'1 minute'}},schema:{operationId:'retryIntegrationDeadLetter',tags:['identity-admin'],security:[{sessionCookie:[],csrfHeader:[]}],body:body({service:{type:'string',enum:eventServices},eventId:{type:'string',format:'uuid'},target:{type:'string',enum:eventServices}})}},async(request,reply)=>{
    if(!originAllowed(request))return invalid(reply,'FORBIDDEN',403);
    if(!await csrfValid(request))return invalid(reply,'CSRF_INVALID',403);
    const actor=await current(request);if(!actor)return invalid(reply,'UNAUTHENTICATED',401);if(!isAdmin(actor)||!actor.permissions.includes('role:assign'))return invalid(reply,'FORBIDDEN',403);
    const input=request.body as {service:(typeof eventServices)[number];eventId:string;target:(typeof eventServices)[number]};
    try{
      const response=await fetch(`${eventTargets[input.service]}/internal/v1/events/retry`,{method:'POST',headers:{'content-type':'application/json','x-identity-internal-token':config.identityInternalToken??'','x-request-id':request.id},body:JSON.stringify({eventId:input.eventId,target:input.target}),signal:AbortSignal.timeout(2500)});
      if(!response.ok)return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);
      const result=await response.json() as {requeued?:unknown};if(typeof result.requeued!=='boolean')return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);
      return {service:input.service,eventId:input.eventId,target:input.target,requeued:result.requeued};
    }catch{return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);}
  });

  app.post('/internal/v1/sessions/introspect', { schema: { operationId: 'internalSessionIntrospection', tags: ['internal'], security: [{ identityInternalToken: [] }], body: body({ sessionToken: tokenSchema, csrfToken: { type: 'string', minLength: 1, maxLength: 256 } }, ['sessionToken']) } }, async (request, reply) => {
    if (!secretMatches(request.headers['x-identity-internal-token'] as string | undefined, config.identityInternalToken)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { sessionToken: string; csrfToken?: string };
    if (input.csrfToken && !await auth.sessionValid(input.sessionToken, input.csrfToken)) return invalid(reply, 'CSRF_INVALID', 403);
    const principal = await auth.current(input.sessionToken);
    return principal ? { principal } : invalid(reply, 'UNAUTHENTICATED', 401);
  });

  app.get<{ Params: { id: string } }>('/internal/v1/accounts/:id/status', { schema: {
    operationId: 'internalAccountStatus', tags: ['internal'], security: [{ identityInternalToken: [] }],
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    response: { 200: { type: 'object', additionalProperties: false, required: ['active'], properties: { active: { type: 'boolean' } } } },
  } }, async (request, reply) => {
    if (!secretMatches(request.headers['x-identity-internal-token'] as string | undefined, config.identityInternalToken)) return invalid(reply, 'UNAUTHENTICATED', 401);
    return { active: await auth.isAccountActive(request.params.id) };
  });

  if (config.nodeEnv === 'development' && localMailer) app.get('/__dev/mailbox', { schema: { hide: true } }, async () => ({ messages: localMailer.messages.map(({ to, subject, link }) => ({ to, subject, link })) }));
}


