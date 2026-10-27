import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '../../config.js';
import { PostgresLearningAccess } from '../infrastructure/postgres-access.js';
import type { Pool } from 'pg';
import type { SessionPort } from '../application/session.js';
import { IdentityUnavailable } from '../application/session.js';
import { WorkApplication, WorkError } from '../application/workflows.js';
import { IdempotencyKeyConflict } from '../domain/learning-data.js';
import { PostgresWorkRepository } from '../infrastructure/postgres-workflows.js';
import { CommunityAccessHttpClient } from '../infrastructure/community-access-client.js';
import { learningReportSources, PostgresLearningReportSnapshots } from '../infrastructure/postgres-report-snapshots.js';

const sessionCookie = 'hci_identity_session';
const csrfCookie = 'hci_identity_csrf';
function cookies(request: FastifyRequest) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    try { return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; } catch { return [part.slice(0, index), part.slice(index + 1)]; }
  }));
}
function invalid(reply: FastifyReply, code: string, status: number) { return reply.code(status).send({ code, requestId: reply.request.id }); }
export async function account(request: FastifyRequest, reply: FastifyReply, sessions: SessionPort, mutation = false) {
  const value = cookies(request);
  const token = value[sessionCookie];
  if (!token) { invalid(reply, 'UNAUTHENTICATED', 401); return null; }
  const csrf = request.headers['x-csrf-token'];
  if (mutation && (typeof csrf !== 'string' || csrf !== value[csrfCookie])) { invalid(reply, 'CSRF_INVALID', 403); return null; }
  try {
    const principal = await sessions.resolve(token, mutation ? csrf as string : undefined);
    if (!principal) invalid(reply, 'UNAUTHENTICATED', 401);
    return principal;
  } catch (error) {
    if (error instanceof IdentityUnavailable) invalid(reply, 'DEPENDENCY_UNAVAILABLE', 503);
    else throw error;
    return null;
  }
}
const pagination = { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, default: 0 } } };
function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof IdempotencyKeyConflict) return invalid(reply, error.code, 409);
  if (!(error instanceof WorkError)) throw error;
  const statuses = { INVALID_INPUT: 400, NOT_FOUND: 404, VERSION_CONFLICT: 409, STATE_CONFLICT: 409, FORBIDDEN: 403, DEPENDENCY_UNAVAILABLE: 503, IDEMPOTENCY_KEY_REUSED: 409 } as const;
  return invalid(reply, error.code, statuses[error.code]);
}
export async function registerLearningRoutes(app: FastifyInstance, pool: Pool, sessions: SessionPort, config: Config) {
  const originAllowed = (request: FastifyRequest) => !request.headers.origin || config.corsOrigins.includes(request.headers.origin);
  const communityAccess = new CommunityAccessHttpClient(config.communityBaseUrl, config.identityInternalToken);
  const work = new WorkApplication(new PostgresWorkRepository(pool), communityAccess);
  const access = new PostgresLearningAccess(pool);
  const reportSnapshots = new PostgresLearningReportSnapshots(pool);
  const internalAllowed = (received: string | undefined) => { if (!received || !config.identityInternalToken) return false; const a = Buffer.from(received), b = Buffer.from(config.identityInternalToken); return a.length === b.length && timingSafeEqual(a, b); };
  const reportWorkspaceAllowed = async (accountId:string,workspaceId:string) => await access.ownsWorkspace(accountId,workspaceId) || await communityAccess.canReportWorkspace(accountId,workspaceId);
  app.post('/internal/v1/workspaces/report-authorize', { schema: { operationId: 'authorizeReportWorkspaceInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId','workspaceId'], properties: { accountId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' } } }, response: { 200: { type: 'object', additionalProperties: false, required: ['allowed'], properties: { allowed: { type: 'boolean' } } } } } }, async (request,reply) => {
    if(!internalAllowed(request.headers['x-identity-internal-token'] as string|undefined))return invalid(reply,'UNAUTHENTICATED',401);
    const input=request.body as {accountId:string;workspaceId:string};
    try{
      if(!sessions.isAccountActive) return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);
      if(!await sessions.isAccountActive(input.accountId))return {allowed:false};
      return {allowed:await reportWorkspaceAllowed(input.accountId,input.workspaceId)};
    }catch(error){if(error instanceof IdentityUnavailable)return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);throw error;}
  });
  app.post('/internal/v1/report-records/snapshot', { schema: { operationId: 'snapshotLearningReportRecordsInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId','workspaceId','records'], properties: { accountId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' }, records: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['source','id'], properties: { source: { type: 'string', enum: learningReportSources }, id: { type: 'string', format: 'uuid' } } } } } } } }, async (request,reply) => {
    if(!internalAllowed(request.headers['x-identity-internal-token'] as string|undefined))return invalid(reply,'UNAUTHENTICATED',401);
    const input=request.body as {accountId:string;workspaceId:string;records:Array<{source:(typeof learningReportSources)[number];id:string}>};
    try{
      if(!sessions.isAccountActive)return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);
      if(!await sessions.isAccountActive(input.accountId))return invalid(reply,'UNAUTHENTICATED',401);
      if(!await reportWorkspaceAllowed(input.accountId,input.workspaceId))return invalid(reply,'NOT_FOUND',404);
      return await reportSnapshots.capture(input.accountId,input.workspaceId,input.records);
    }catch(error){if(error instanceof IdentityUnavailable)return invalid(reply,'DEPENDENCY_UNAVAILABLE',503);if(error instanceof Error&&error.message==='INVALID_REPORT_SELECTION')return invalid(reply,'INVALID_REQUEST',400);throw error;}
  });
  app.post('/internal/v1/workspaces/authorize', { schema: { operationId: 'authorizeWorkspaceInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId', 'workspaceId'], properties: { accountId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    if (!internalAllowed(request.headers['x-identity-internal-token'] as string | undefined)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; workspaceId: string };
    return { allowed: await access.ownsWorkspace(input.accountId, input.workspaceId) };
  });
  app.post('/internal/v1/executions/authorize', { schema: { operationId: 'authorizeExecutionsInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId', 'workspaceId', 'executionIds'], properties: { accountId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' }, executionIds: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } } } } } }, async (request, reply) => {
    if (!internalAllowed(request.headers['x-identity-internal-token'] as string | undefined)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; workspaceId: string; executionIds: string[] };
    if (new Set(input.executionIds).size !== input.executionIds.length) return invalid(reply, 'INVALID_REQUEST', 400);
    return { allowed: await access.ownsWorkspace(input.accountId, input.workspaceId) && await access.ownsExecutions(input.accountId, input.workspaceId, input.executionIds) };
  });
  app.post('/internal/v1/report-records/authorize', { schema: { operationId: 'authorizeReportRecordsInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId', 'workspaceId', 'records'], properties: { accountId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string', format: 'uuid' }, records: { type: 'object', additionalProperties: false, properties: { execution: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, persona: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, scenario: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, finding: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, evaluation_session: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, demo_user: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } }, multimodal_evidence: { type: 'array', maxItems: 100, items: { type: 'string', format: 'uuid' } } } } } } } }, async (request, reply) => {
    if (!internalAllowed(request.headers['x-identity-internal-token'] as string | undefined)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; workspaceId: string; records: Parameters<PostgresLearningAccess['ownsReportRecords']>[2] };
    return { allowed: await access.ownsWorkspace(input.accountId, input.workspaceId) && await access.ownsReportRecords(input.accountId, input.workspaceId, input.records) };
  });

  app.post('/internal/v1/executions/owner-check', { schema: { operationId: 'authorizeExecutionOwnerInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId', 'executionId'], properties: { accountId: { type: 'string', format: 'uuid' }, executionId: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    if (!internalAllowed(request.headers['x-identity-internal-token'] as string | undefined)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; executionId: string };
    return { allowed: await access.ownsExecution(input.accountId, input.executionId) };
  });
  app.post<{ Params: { groupId: string } }>('/v1/groups/:groupId/assignments', { schema: { operationId: 'createGroupAssignment', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['groupId'], properties: { groupId: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['activityVersionId','title','instructions'], properties: { activityVersionId: { type: 'string', format: 'uuid' }, title: { type: 'string', minLength: 1, maxLength: 200 }, instructions: { type: 'string', minLength: 1, maxLength: 5000 }, opensAt: { type: 'string', format: 'date-time' }, dueAt: { type: 'string', format: 'date-time' }, criteria: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['code','name','order'], properties: { code: { type: 'string', minLength: 1, maxLength: 80 }, name: { type: 'string', minLength: 1, maxLength: 160 }, description: { type: 'string', maxLength: 2000 }, maxScore: { type: 'number', minimum: 0 }, order: { type: 'integer', minimum: 1, maximum: 100 } } } } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { activityVersionId: string; title: string; instructions: string; opensAt?: string; dueAt?: string; criteria?: { code: string; name: string; description?: string; maxScore?: number; order: number }[] };
    try { return reply.code(201).send({ item: await work.createAssignment(actor.id, actor.globalRoles, request.params.groupId, { ...body, opensAt: body.opensAt ? new Date(body.opensAt) : undefined, dueAt: body.dueAt ? new Date(body.dueAt) : undefined }) }); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { groupId: string } }>('/v1/groups/:groupId/assignments', { schema: { operationId: 'listGroupAssignments', tags: ['learning'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['groupId'], properties: { groupId: { type: 'string', format: 'uuid' } } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { return { items: await work.listAssignments(actor.id, request.params.groupId) }; } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/deliveries/:id/evaluations', { schema: { operationId: 'evaluateDeliveryCriterion', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['criterionId'], properties: { criterionId: { type: 'string', format: 'uuid' }, score: { type: 'number', minimum: 0 }, comment: { type: 'string', maxLength: 5000 } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { criterionId: string; score?: number; comment?: string };
    try { return reply.code(201).send({ item: await work.evaluateDelivery(actor.id, actor.globalRoles, request.params.id, body.criterionId, body.score, body.comment) }); } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/deliveries/:id/reviews', { schema: { operationId: 'reviewGroupDelivery', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['expectedState','state','message'], properties: { expectedState: { type: 'string', enum: ['submitted','revision','changes_requested'] }, state: { type: 'string', enum: ['changes_requested','accepted'] }, message: { type: 'string', minLength: 1, maxLength: 5000 } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { expectedState: string; state: 'changes_requested' | 'accepted'; message: string };
    try { return { item: await work.reviewDelivery(actor.id, actor.globalRoles, request.params.id, body.expectedState, body.state, body.message) }; } catch (error) { return mapError(reply, error); }
  });
  app.get('/v1/activities', { schema: { operationId: 'listPublishedActivities', tags: ['learning'], querystring: { type: 'object', additionalProperties: false, properties: { locale: { type: 'string', enum: ['es-CO','en-US','fr-FR','pt-BR','it-IT','ca-ES'], default: 'es-CO' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, default: 0 } } } } }, async (request, reply) => {
    try {
      const query = request.query as { locale?: string; limit?: number; offset?: number };
      const locale = query.locale ?? 'es-CO', limit = query.limit ?? 25, offset = query.offset ?? 0;
      return { items: await work.listActivities(locale, limit, offset), locale, limit, offset };
    } catch (error) { return mapError(reply, error); }
  });
  app.get('/v1/workspaces', { schema: { operationId: 'listWorkspaces', tags: ['learning'], security: [{ sessionCookie: [] }], querystring: pagination } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const { limit = 25, offset = 0 } = request.query as { limit?: number; offset?: number };
    return { items: await work.listWorkspaces(actor.id, limit, offset), limit, offset };
  });
  app.post('/v1/workspaces', { schema: { operationId: 'createWorkspace', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 120 } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const key = request.headers['idempotency-key'] as string;
    try {
      const result = await work.createWorkspace(actor.id, (request.body as { name: string }).name, key);
      return reply.code(result.replayed ? 200 : 201).send({ item: result.item, replayed: result.replayed });
    } catch (error) { return mapError(reply, error); }
  });
  app.get('/v1/executions', { schema: { operationId: 'listExecutions', tags: ['learning'], security: [{ sessionCookie: [] }], querystring: pagination } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const { limit = 25, offset = 0 } = request.query as { limit?: number; offset?: number };
    return { items: await work.listExecutions(actor.id, limit, offset), limit, offset };
  });
  app.post('/v1/executions', { schema: { operationId: 'startExecution', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['workspaceId', 'activityVersionId', 'source'], properties: { workspaceId: { type: 'string', format: 'uuid' }, activityVersionId: { type: 'string', format: 'uuid' }, assignmentId: { type: 'string', format: 'uuid' }, source: { type: 'string', enum: ['measured', 'declared', 'simulated', 'mixed', 'derived'] }, alias: { type: 'string', maxLength: 100 }, condition: { type: 'string', maxLength: 2000 }, prototype: { type: 'string', maxLength: 500 } } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const key = request.headers['idempotency-key'] as string;
    const body = request.body as { workspaceId: string; activityVersionId: string; assignmentId?: string; source: 'measured' | 'declared' | 'simulated' | 'mixed' | 'derived'; alias?: string; condition?: string; prototype?: string };
    try {
      const result = await work.startExecution(actor.id, { ...body, idempotencyKey: key });
      if (!result.item) return invalid(reply, result.replayed ? 'IDEMPOTENCY_KEY_REUSED' : 'NOT_FOUND', result.replayed ? 409 : 404);
      return reply.code(result.replayed ? 200 : 201).send({ ...result.item, replayed: result.replayed });
    } catch (error) { return mapError(reply, error); }
  });
  app.patch<{ Params: { id: string } }>('/v1/executions/:id', { schema: { operationId: 'updateExecution', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['version', 'state'], properties: { version: { type: 'integer', minimum: 1 }, state: { type: 'string', enum: ['in_progress', 'completed', 'cancelled'] }, notes: { type: 'string', maxLength: 5000 } } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { version: number; state: 'in_progress' | 'completed' | 'cancelled'; notes?: string };
    try {
      const item = await work.updateExecution(actor.id, request.params.id, body.version, body.state, body.notes);
      return item ? { item } : invalid(reply, 'VERSION_OR_STATE_CONFLICT', 409);
    } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/executions/:id/deliveries', { schema: { operationId: 'createDeliveryVersion', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', format: 'uuid' } } }, params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, properties: { comment: { type: 'string', maxLength: 5000 } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string') return invalid(reply, 'INVALID_REQUEST', 400);
    const body = request.body as { comment?: string } | undefined;
    try {
      const result = await work.createDelivery(actor.id, request.params.id, key, body?.comment);
      if (!result) return invalid(reply, 'EXECUTION_NOT_READY_OR_NOT_FOUND', 409);
      if (!result.item) return invalid(reply, 'IDEMPOTENCY_KEY_REUSED', 409);
      return reply.code(result.replayed ? 200 : 201).send({ item: result.item, replayed: result.replayed });
    } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/deliveries/:id/feedback', { schema: { operationId: 'respondToFeedback', tags: ['learning'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string', minLength: 1, maxLength: 5000 } } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try {
      const item = await work.addOwnerFeedback(actor.id, request.params.id, (request.body as { message: string }).message);
      return item ? reply.code(201).send({ item }) : invalid(reply, 'DELIVERY_NOT_FOUND', 404);
    } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/executions/:id/deliveries', { schema: {
    operationId: 'listDeliveryVersions', tags: ['learning'], security: [{ sessionCookie: [] }],
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, querystring: pagination,
  } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const query = request.query as { limit?: number; offset?: number }, limit = query.limit ?? 25, offset = query.offset ?? 0;
    try {
      const items = await work.listDeliveryVersions(actor.id, request.params.id, limit, offset);
      return items === null ? invalid(reply, 'NOT_FOUND', 404) : { items, limit, offset };
    } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { groupId: string } }>('/v1/groups/:groupId/deliveries', { schema: {
    operationId: 'listGroupDeliveryVersions', tags: ['learning'], security: [{ sessionCookie: [] }],
    params: { type: 'object', required: ['groupId'], properties: { groupId: { type: 'string', format: 'uuid' } } }, querystring: pagination,
  } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const query = request.query as { limit?: number; offset?: number }, limit = query.limit ?? 25, offset = query.offset ?? 0;
    try {
      return { items: await work.listGroupDeliveryVersions(actor.id, request.params.groupId, limit, offset), limit, offset };
    } catch (error) { return mapError(reply, error); }
  });
}










