import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from '../../config.js';
import type { SessionPort, Principal } from '../application/session.js';
import { IdentityUnavailable } from '../application/session.js';
import { CommunityApplication, CommunityError } from '../application/use-cases.js';
import type { WorkspaceAccessPort } from '../application/use-cases.js';
import { PostgresCommunityRepository } from '../infrastructure/postgres-community.js';
import type { SuggestionState, ReservationInput } from '../domain/community.js';

const sessionCookie = 'hci_identity_session', csrfCookie = 'hci_identity_csrf';
const uuid = { type: 'string', format: 'uuid' } as const;
const pageSchema = { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, default: 0 } } };
const mutationSecurity = [{ sessionCookie: [], csrfHeader: [] }];

function cookies(request: FastifyRequest) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('='); if (i < 0) return ['', ''];
    try { return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))]; } catch { return [part.slice(0, i), part.slice(i + 1)]; }
  }));
}
function invalid(reply: FastifyReply, code: string, status: number) { return reply.code(status).send({ code, requestId: reply.request.id }); }
async function account(request: FastifyRequest, reply: FastifyReply, sessions: SessionPort, mutation = false): Promise<Principal | null> {
  const values = cookies(request), token = values[sessionCookie];
  if (!token) { invalid(reply, 'UNAUTHENTICATED', 401); return null; }
  const csrf = request.headers['x-csrf-token'];
  if (mutation && (typeof csrf !== 'string' || csrf !== values[csrfCookie])) { invalid(reply, 'CSRF_INVALID', 403); return null; }
  try {
    const principal = await sessions.resolve(token, mutation ? csrf as string : undefined);
    if (!principal || principal.status !== 'active') invalid(reply, 'UNAUTHENTICATED', 401);
    return principal?.status === 'active' ? principal : null;
  } catch (error) { if (error instanceof IdentityUnavailable) invalid(reply, 'DEPENDENCY_UNAVAILABLE', 503); else throw error; return null; }
}
function secretMatches(received: string | undefined, expected: string | undefined) {
  if (!received || !expected) return false; const a = Buffer.from(received), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b);
}
function moderator(actor: Principal) { return actor.globalRoles.includes('administrator') && actor.permissions.includes('account:manage'); }
function originAllowed(request: FastifyRequest, config: Config) { return !request.headers.origin || config.corsOrigins.includes(request.headers.origin); }
function mapError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof CommunityError)) throw error;
  const status: Record<CommunityError['code'], number> = {
    INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, INVITATION_INVALID_OR_EXPIRED: 409,
    IDEMPOTENCY_KEY_REUSED: 409, RESERVATION_CONFLICT: 409, VERSION_CONFLICT: 409,
    STATE_CONFLICT: 409, DEPENDENCY_UNAVAILABLE: 503,
  };
  return invalid(reply, error.code, status[error.code]);
}
function page(request: FastifyRequest) { const query = request.query as { limit?: number; offset?: number }; return { limit: query.limit ?? 25, offset: query.offset ?? 0 }; }
function key(request: FastifyRequest) { return request.headers['idempotency-key'] as string; }
function ifMatch(request: FastifyRequest) {
  const value = request.headers['if-match'];
  if (typeof value !== 'string' || !/^\"?[1-9]\d*\"?$/.test(value)) return null;
  return Number(value.replaceAll('"', ''));
}
function etag(reply: FastifyReply, item: { version?: number }) { if (item.version) reply.header('etag', `"${item.version}"`); }

export async function registerCommunityRoutes(app: FastifyInstance, pool: Pool, sessions: SessionPort, config: Config, workspaceAccess: WorkspaceAccessPort) {
  const community = new CommunityApplication(new PostgresCommunityRepository(pool), workspaceAccess);
  app.get('/v1/groups', { schema: { operationId: 'listGroups', tags: ['community'], security: [{ sessionCookie: [] }], querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); return await community.listGroups(actor.id, pagination.limit, pagination.offset); } catch (error) { return mapError(reply, error); }
  });
  app.post('/v1/groups', { schema: { operationId: 'createGroup', tags: ['community'], security: mutationSecurity, headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': uuid } }, body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 2000 } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { name: string; description?: string };
    try { const result = await community.createGroup(actor.id, body.name, body.description, key(request)); return reply.code(result.replayed ? 200 : 201).send(result); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/groups/:id/members', { schema: { operationId: 'listGroupMembers', tags: ['community'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } }, querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); return await community.listMembers(request.params.id, actor.id, pagination.limit, pagination.offset); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/groups/:id/invitations', { schema: { operationId: 'listGroupInvitations', tags: ['community'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } }, querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); return await community.listInvitations(request.params.id, actor.id, pagination.limit, pagination.offset); } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/groups/:id/invitations', { schema: { operationId: 'createGroupInvitation', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['id'], properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 254 } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { email?: string } | undefined;
    const token = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(token).digest('hex'), expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try { const invitation = await community.createInvitation(request.params.id, actor.id, body?.email ?? null, hash, expiresAt); return reply.code(201).send({ id: invitation.id, token, expiresAt: expiresAt.toISOString() }); } catch (error) { return mapError(reply, error); }
  });
  app.post('/v1/group-invitations/accept', { schema: { operationId: 'acceptGroupInvitation', tags: ['community'], security: mutationSecurity, body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', minLength: 20, maxLength: 128 } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const token = (request.body as { token: string }).token, hash = createHash('sha256').update(token).digest('hex');
    try { const accepted = await community.acceptInvitation(actor.id, actor.email, hash); return accepted ? reply.code('replayed' in accepted && accepted.replayed ? 200 : 201).send({ accepted: true, ...accepted }) : invalid(reply, 'INVITATION_INVALID_OR_EXPIRED', 409); } catch (error) { return mapError(reply, error); }
  });
  app.delete<{ Params: { groupId: string; accountId: string } }>('/v1/groups/:groupId/members/:accountId', { schema: { operationId: 'removeGroupParticipant', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['groupId', 'accountId'], properties: { groupId: uuid, accountId: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { return await community.removeMember(request.params.groupId, actor.id, request.params.accountId) ? reply.code(204).send() : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.delete<{ Params: { groupId: string; invitationId: string } }>('/v1/groups/:groupId/invitations/:invitationId', { schema: { operationId: 'revokeGroupInvitation', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['groupId', 'invitationId'], properties: { groupId: uuid, invitationId: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { return await community.revokeInvitation(request.params.groupId, actor.id, request.params.invitationId) ? reply.code(204).send() : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { groupId: string } }>('/v1/groups/:groupId/workspaces', { schema: { operationId: 'listGroupWorkspaces', tags: ['community'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['groupId'], properties: { groupId: uuid } }, querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); return await community.listSharedWorkspaces(request.params.groupId, actor.id, pagination.limit, pagination.offset); } catch (error) { return mapError(reply, error); }
  });
  app.put<{ Params: { groupId: string; workspaceId: string } }>('/v1/groups/:groupId/workspaces/:workspaceId', { schema: { operationId: 'shareGroupWorkspace', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['groupId', 'workspaceId'], properties: { groupId: uuid, workspaceId: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { await community.shareWorkspace(request.params.groupId, actor.id, request.params.workspaceId); return reply.code(204).send(); } catch (error) { return mapError(reply, error); }
  });
  app.delete<{ Params: { groupId: string; workspaceId: string } }>('/v1/groups/:groupId/workspaces/:workspaceId', { schema: { operationId: 'revokeGroupWorkspace', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['groupId', 'workspaceId'], properties: { groupId: uuid, workspaceId: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { await community.revokeWorkspace(request.params.groupId, actor.id, request.params.workspaceId); return reply.code(204).send(); } catch (error) { return mapError(reply, error); }
  });
  app.post('/v1/suggestions', { schema: { operationId: 'createSuggestion', tags: ['community'], security: mutationSecurity, headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': uuid } }, body: { type: 'object', additionalProperties: false, required: ['category', 'title', 'description'], properties: { category: { type: 'string', minLength: 1, maxLength: 80 }, title: { type: 'string', minLength: 1, maxLength: 160 }, description: { type: 'string', minLength: 1, maxLength: 4000 }, anonymous: { type: 'boolean', default: false } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { category: string; title: string; description: string; anonymous?: boolean };
    try { const result = await community.createSuggestion(actor.id, body.category, body.title, body.description, body.anonymous ?? false, key(request)); return reply.code(result.replayed ? 200 : 201).send(result); } catch (error) { return mapError(reply, error); }
  });
  app.get('/v1/suggestions', { schema: { operationId: 'listSuggestions', tags: ['community'], security: [{ sessionCookie: [] }], querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); return await community.listSuggestions(actor.id, moderator(actor), pagination.limit, pagination.offset); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/suggestions/:id', { schema: { operationId: 'getSuggestion', tags: ['community'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const item = await community.getSuggestion(actor.id, moderator(actor), request.params.id); return item ?? invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/suggestions/:id/history', { schema: { operationId: 'listSuggestionHistory', tags: ['community'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } }, querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); const result = await community.listSuggestionHistory(actor.id, moderator(actor), request.params.id, pagination.limit, pagination.offset); return result ?? invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.patch<{ Params: { id: string } }>('/v1/suggestions/:id', { schema: { operationId: 'moderateSuggestion', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['id'], properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, required: ['version', 'status'], properties: { version: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['reviewing', 'accepted', 'implemented', 'rejected'] }, response: { type: 'string', maxLength: 4000 } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { version: number; status: SuggestionState; response?: string };
    try { const item = await community.updateSuggestion(actor.id, moderator(actor), request.params.id, body.version, body.status, body.response); etag(reply, item); return item; } catch (error) { return mapError(reply, error); }
  });
  app.get('/v1/reservation-services', { schema: { operationId: 'listReservationServices', tags: ['community'] } }, async () => ({ items: await community.listReservationServices() }));
  app.patch<{ Params: { code: string } }>('/v1/reservation-services/:code', { schema: { operationId: 'setReservationServiceStatus', tags: ['community'], security: mutationSecurity, params: { type: 'object', required: ['code'], properties: { code: { type: 'string', enum: ['advice', 'workshop', 'health', 'visit', 'culture'] } } }, body: { type: 'object', additionalProperties: false, required: ['active'], properties: { active: { type: 'boolean' } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { await community.setReservationServiceActive(request.params.code, (request.body as { active: boolean }).active, moderator(actor)); return { code: request.params.code, active: (request.body as { active: boolean }).active }; } catch (error) { return mapError(reply, error); }
  });
  app.get('/v1/reservations', { schema: { operationId: 'listReservations', tags: ['community'], security: [{ sessionCookie: [] }], querystring: pageSchema } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const pagination = page(request); return await community.listReservations(actor.id, pagination.limit, pagination.offset); } catch (error) { return mapError(reply, error); }
  });
  app.post('/v1/reservations', { schema: { operationId: 'createReservation', tags: ['community'], security: mutationSecurity, headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': uuid } }, body: { type: 'object', additionalProperties: false, required: ['workspaceId', 'date', 'time'], anyOf: [{ required: ['serviceCode'] }, { required: ['serviceLabel'] }], properties: { workspaceId: uuid, serviceCode: { type: 'string', enum: ['advice', 'workshop', 'health', 'visit', 'culture'] }, serviceLabel: { type: 'string', minLength: 1, maxLength: 160 }, date: { type: 'string', format: 'date' }, time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, condition: { type: 'string', enum: ['good', 'bad'] } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { const result = await community.createReservation(actor.id, request.body as ReservationInput, key(request)); etag(reply, result.item as { version?: number }); return reply.code(result.replayed ? 200 : 201).send(result); } catch (error) { return mapError(reply, error); }
  });
  app.patch<{ Params: { id: string } }>('/v1/reservations/:id', { schema: { operationId: 'rescheduleReservation', tags: ['community'], security: mutationSecurity, headers: { type: 'object', required: ['if-match'], properties: { 'if-match': { type: 'string' } } }, params: { type: 'object', required: ['id'], properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, required: ['date', 'time'], properties: { serviceCode: { type: 'string', enum: ['advice', 'workshop', 'health', 'visit', 'culture'] }, serviceLabel: { type: 'string', minLength: 1, maxLength: 160 }, date: { type: 'string', format: 'date' }, time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, condition: { type: 'string', enum: ['good', 'bad'] } } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const version = ifMatch(request); if (!version) return invalid(reply, 'INVALID_INPUT', 400);
    try { const item = await community.updateReservation(actor.id, request.params.id, version, request.body as Parameters<CommunityApplication['updateReservation']>[3]); etag(reply, item as { version: number }); return item; } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/reservations/:id/cancellation', { schema: { operationId: 'cancelReservation', tags: ['community'], security: mutationSecurity, headers: { type: 'object', required: ['if-match'], properties: { 'if-match': { type: 'string' } } }, params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request, config)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const version = ifMatch(request); if (!version) return invalid(reply, 'INVALID_INPUT', 400);
    try { const item = await community.cancelReservation(actor.id, request.params.id, version); etag(reply, item as { version: number }); return item; } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { groupId: string; accountId: string } }>('/internal/v1/groups/:groupId/members/:accountId', { schema: { operationId: 'getGroupMembershipInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], params: { type: 'object', required: ['groupId', 'accountId'], properties: { groupId: uuid, accountId: uuid } } } }, async (request, reply) => {
    if (!secretMatches(request.headers['x-identity-internal-token'] as string | undefined, config.identityInternalToken)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const membership = await community.membership(request.params.groupId, request.params.accountId);
    return { active: membership.active, role: membership.role };
  });
  app.post('/internal/v1/workspaces/report-authorize', { schema: { operationId: 'authorizeSharedWorkspaceReportInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId', 'workspaceId'], properties: { accountId: uuid, workspaceId: uuid } }, response: { 200: { type: 'object', required: ['allowed'], properties: { allowed: { type: 'boolean' } } } } } }, async (request, reply) => {
    if (!secretMatches(request.headers['x-identity-internal-token'] as string | undefined, config.identityInternalToken)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; workspaceId: string };
    return { allowed: await community.canReportWorkspace(input.accountId, input.workspaceId) };
  });
  app.post('/internal/v1/report-records/snapshot', { schema: { operationId: 'snapshotCommunityReportRecordsInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId', 'workspaceId', 'records'], properties: { accountId: uuid, workspaceId: uuid, records: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['source', 'id'], properties: { source: { const: 'reservation' }, id: uuid } } } } } } }, async (request, reply) => {
    if (!secretMatches(request.headers['x-identity-internal-token'] as string | undefined, config.identityInternalToken)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; workspaceId: string; records: Array<{ source: 'reservation'; id: string }> };
    try {
      if (!sessions.isAccountActive) return invalid(reply, 'DEPENDENCY_UNAVAILABLE', 503);
      if (!await sessions.isAccountActive(input.accountId)) return invalid(reply, 'UNAUTHENTICATED', 401);
      return await community.snapshotReservations(input.accountId, input.workspaceId, input.records.map(record => record.id));
    } catch (error) { if (error instanceof IdentityUnavailable) return invalid(reply, 'DEPENDENCY_UNAVAILABLE', 503); return mapError(reply, error); }
  });
  app.post('/internal/v1/reservations/authorize', { schema: { operationId: 'authorizeReservationsInternal', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['accountId','workspaceId','reservationIds'], properties: { accountId: uuid, workspaceId: uuid, reservationIds: { type: 'array', maxItems: 100, items: uuid } } } } }, async (request, reply) => {
    if (!secretMatches(request.headers['x-identity-internal-token'] as string | undefined, config.identityInternalToken)) return invalid(reply, 'UNAUTHENTICATED', 401);
    const input = request.body as { accountId: string; workspaceId: string; reservationIds: string[] };
    if (new Set(input.reservationIds).size !== input.reservationIds.length) return invalid(reply, 'INVALID_REQUEST', 400);
    return { allowed: await community.ownsReservations(input.accountId, input.workspaceId, input.reservationIds) };
  });

}
