import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from '../../config.js';
import type { SessionPort } from '../application/session.js';
import { IdentityUnavailable } from '../application/session.js';
import { EvidenceApplication, EvidenceError } from '../application/use-cases.js';
import type { ConsentPurpose, ReportSelection, UxEvent } from '../domain/evidence.js';
import { createEvidenceApplication } from '../infrastructure/composition.js';

const sessionCookie = 'hci_identity_session', csrfCookie = 'hci_identity_csrf';
function cookies(request: FastifyRequest) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('='); if (i < 0) return ['', ''];
    try { return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))]; } catch { return [part.slice(0, i), part.slice(i + 1)]; }
  }));
}
function invalid(reply: FastifyReply, code: string, status: number) { return reply.code(status).send({ code, requestId: reply.request.id }); }
export async function account(request: FastifyRequest, reply: FastifyReply, sessions: SessionPort, mutation = false) {
  const values = cookies(request), token = values[sessionCookie];
  if (!token) { invalid(reply, 'UNAUTHENTICATED', 401); return null; }
  const csrf = request.headers['x-csrf-token'];
  if (mutation && (typeof csrf !== 'string' || csrf !== values[csrfCookie])) { invalid(reply, 'CSRF_INVALID', 403); return null; }
  try {
    const principal = await sessions.resolve(token, mutation ? csrf as string : undefined);
    if (!principal) invalid(reply, 'UNAUTHENTICATED', 401);
    return principal;
  } catch (error) { if (error instanceof IdentityUnavailable) invalid(reply, 'DEPENDENCY_UNAVAILABLE', 503); else throw error; return null; }
}
function mapError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof EvidenceError)) {
    if ((error as { code?: string })?.code === 'IDEMPOTENCY_KEY_REUSED') return invalid(reply, 'IDEMPOTENCY_KEY_REUSED', 409);
    throw error;
  }
  const status = error.code === 'INVALID_INPUT' ? 400 : error.code === 'CONSENT_REQUIRED' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'RETENTION_DISABLED' ? 409 : error.code === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 503;
  return invalid(reply, error.code, status);
}
const uuid = { type: 'string', format: 'uuid' };
const keyHeader = { type: 'object', additionalProperties: false, required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } } };
const purposeSchema = { type: 'string', enum: ['aggregate_metrics','detailed_telemetry','calibration'] };
const recordSchema = { type: 'object', additionalProperties: false, required: ['section','source','id'], properties: { section: { type: 'string', enum: ['selected','before','after'] }, source: { type: 'string', enum: ['execution','persona','scenario','reservation','finding','evaluation_session','ux_session','evidence','demo_user','multimodal_evidence','lab_event','accessibility_check'] }, id: uuid } };
export async function registerEvidenceRoutes(app: FastifyInstance, pool: Pool, sessions: SessionPort, config: Config, application = createEvidenceApplication(pool, config)) {
  const evidence = application;
  const originAllowed = (request: FastifyRequest) => !request.headers.origin || config.corsOrigins.includes(request.headers.origin);
  const internalAllowed = (received: string | undefined) => { if (!received || !config.identityInternalToken) return false; const a = Buffer.from(received), b = Buffer.from(config.identityInternalToken); return a.length === b.length && timingSafeEqual(a, b); };
  const key = (request: FastifyRequest) => typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : '';
  app.post('/v1/ux-sessions', { schema: { operationId: 'recordAggregatedUxSession', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader, body: { type: 'object', additionalProperties: false, required: ['executionId','type','route','mode','source','documentWidth','documentHeight','viewportWidth','viewportHeight','durationMs','maxDepthPercent','consent'], properties: {
    executionId: uuid, type: { type: 'string', enum: ['page','example'] }, route: { type: 'string', minLength: 1, maxLength: 500 }, alias: { type: 'string', maxLength: 100 }, task: { type: 'string', maxLength: 500 }, prototype: { type: 'string', maxLength: 500 }, objective: { type: 'string', maxLength: 1000 }, notes: { type: 'string', maxLength: 2000 },
    mode: { type: 'string', enum: ['observed','cursor','F','Gutenberg','none','mixed'] }, source: { type: 'string', enum: ['measured','simulated','mixed'] }, exposures: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['band','seconds'], properties: { band: { type: 'string', minLength: 1, maxLength: 80 }, seconds: { type: 'number', minimum: 0 } } } },
    documentWidth: { type: 'integer', minimum: 1 }, documentHeight: { type: 'integer', minimum: 1 }, viewportWidth: { type: 'integer', minimum: 1 }, viewportHeight: { type: 'integer', minimum: 1 }, durationMs: { type: 'integer', minimum: 0 }, maxDepthPercent: { type: 'number', minimum: 0, maximum: 100 }, clickCount: { type: 'integer', minimum: 0, default: 0 }, wheelCount: { type: 'integer', minimum: 0, default: 0 },
    consent: { type: 'object', additionalProperties: false, required: ['purpose','noticeVersion','granted'], properties: { purpose: { const: 'aggregate_metrics' }, noticeVersion: { type: 'string', minLength: 1, maxLength: 80 }, granted: { const: true } } },
  } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    if (!key(request)) return invalid(reply, 'INVALID_INPUT', 400);
    try { const result = await evidence.createUxSession(actor.id, request.body as Parameters<EvidenceApplication['createUxSession']>[1], key(request)); return reply.code(result.replayed ? 200 : 201).send(result); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/ux-sessions/:id', { schema: { operationId: 'getAggregatedUxSession', tags: ['evidence'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const item = await evidence.getUxSession(actor.id, request.params.id); return item ? { item } : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string }; Querystring: { limit?: number; offset?: number } }>('/v1/ux-sessions/:id/events', { schema: { operationId: 'listUxSessionEvents', tags: ['evidence'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } }, querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 }, offset: { type: 'integer', minimum: 0, default: 0 } } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const result = await evidence.listUxEvents(actor.id, request.params.id, request.query.limit, request.query.offset); return result ? result : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/v1/ux-sessions/:id/consents', { schema: { operationId: 'listUxSessionConsents', tags: ['evidence'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const items = await evidence.listConsents(actor.id, request.params.id); return items ? { items } : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/v1/ux-sessions/:id/consents', { schema: { operationId: 'recordUxPurposeConsent', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader, params: { type: 'object', required: ['id'], properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, required: ['purpose','noticeVersion','granted'], properties: { purpose: purposeSchema, noticeVersion: { type: 'string', minLength: 1, maxLength: 80 }, granted: { type: 'boolean' } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { purpose: ConsentPurpose; noticeVersion: string; granted: boolean };
    try { const item = await evidence.setConsent(actor.id, request.params.id, body.purpose, body.noticeVersion, body.granted, key(request)); return reply.code(item.replayed ? 200 : 201).send(item); } catch (error) { return mapError(reply, error); }
  });
  app.delete<{ Params: { id: string; purpose: ConsentPurpose } }>('/v1/ux-sessions/:id/consents/:purpose', { schema: { operationId: 'revokeUxPurposeConsent', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id','purpose'], properties: { id: uuid, purpose: purposeSchema } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { return await evidence.revokeConsent(actor.id, request.params.id, request.params.purpose) ? reply.code(204).send() : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.delete<{ Params: { id: string } }>('/v1/ux-sessions/:id/consent', { schema: { operationId: 'revokeAllUxSessionConsents', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { return await evidence.revokeConsent(actor.id, request.params.id) ? reply.code(204).send() : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  const eventItem = { type: 'object', additionalProperties: false, required: ['channel','atMs','source'], properties: { channel: { type: 'string', enum: ['click','pointer','gaze','simulation','scroll','wheel','mode'] }, atMs: { type: 'integer', minimum: 0 }, x: { type: 'number' }, y: { type: 'number' }, weight: { type: 'number' }, area: { type: 'string', maxLength: 120 }, route: { type: 'string', maxLength: 500 }, scrollTopPx: { type: 'number', minimum: 0 }, depthPercent: { type: 'number', minimum: 0, maximum: 100 }, direction: { type: 'string', maxLength: 40 }, mode: { type: 'string', enum: ['cursor','F','Gutenberg','none'] }, source: { type: 'string', enum: ['measured','simulated','mixed'] } } };
  app.post<{ Params: { id: string } }>('/v1/ux-sessions/:id/events', { schema: { operationId: 'recordDetailedUxEvents', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader, params: { type: 'object', required: ['id'], properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, required: ['events'], properties: { events: { type: 'array', minItems: 1, maxItems: 500, items: eventItem } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const events = (request.body as { events: UxEvent[] }).events;
    try { const item = await evidence.recordUxEvents(actor.id, request.params.id, events, key(request)); return item ? reply.code(201).send({ item }) : invalid(reply, 'CONSENT_REQUIRED', 403); } catch (error) { return mapError(reply, error); }
  });
  app.put<{ Params: { id: string } }>('/v1/ux-sessions/:id/calibration', { schema: { operationId: 'saveUxCalibrationSummary', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader, params: { type: 'object', required: ['id'], properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, required: ['medianErrorPx','viewportWidth','viewportHeight','sampleCount','validatedAt'], properties: { medianErrorPx: { type: 'number', minimum: 0 }, viewportWidth: { type: 'integer', minimum: 1 }, viewportHeight: { type: 'integer', minimum: 1 }, sampleCount: { type: 'integer', minimum: 0, maximum: 10000 }, validatedAt: { type: 'string', format: 'date-time' } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { const item = await evidence.saveCalibration(actor.id, request.params.id, request.body as Parameters<EvidenceApplication['saveCalibration']>[2], key(request)); return item ? reply.code(item.replayed ? 200 : 201).send({ item }) : invalid(reply, 'CONSENT_REQUIRED', 403); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { workspaceId: string } }>('/v1/workspaces/:workspaceId/accessibility-checks', { schema: { operationId: 'listAccessibilityChecks', tags: ['evidence'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['workspaceId'], properties: { workspaceId: uuid } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const items = await evidence.listAccessibilityChecks(actor.id, request.params.workspaceId); return { items }; } catch (error) { return mapError(reply, error); }
  });
  app.put<{ Params: { workspaceId: string; code: string } }>('/v1/workspaces/:workspaceId/accessibility-checks/:code', { schema: { operationId: 'recordAccessibilityCheck', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader, params: { type: 'object', required: ['workspaceId','code'], properties: { workspaceId: uuid, code: { type: 'string', enum: ['keyboard','labels','contrast','zoom','screenReader','motion'] } } }, body: { type: 'object', additionalProperties: false, required: ['passed'], properties: { passed: { type: 'boolean' } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { const item = await evidence.saveAccessibilityCheck(actor.id, request.params.workspaceId, request.params.code as Parameters<EvidenceApplication['saveAccessibilityCheck']>[2], (request.body as { passed: boolean }).passed, key(request)); return reply.code(item.replayed ? 200 : 201).send(item); } catch (error) { return mapError(reply, error); }
  });
  app.post<{ Params: { executionId: string } }>('/v1/executions/:executionId/files', { schema: { operationId: 'recordEvidenceFileMetadata', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader, params: { type: 'object', required: ['executionId'], properties: { executionId: uuid } }, body: { type: 'object', additionalProperties: false, required: ['name','mime','bytes','sha256','location'], properties: { name: { type: 'string', minLength: 1, maxLength: 255 }, mime: { type: 'string', pattern: '^[\\w.+-]+/[\\w.+-]+$' }, bytes: { type: 'integer', minimum: 0 }, sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' }, location: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$' } } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { const item = await evidence.saveFileMetadata(actor.id, { ...(request.body as Omit<Parameters<EvidenceApplication['saveFileMetadata']>[1], 'executionId'>), executionId: request.params.executionId }, key(request)); return reply.code(item.replayed ? 200 : 201).send(item); } catch (error) { return mapError(reply, error); }
  });
  app.get<{ Params: { executionId: string } }>('/v1/executions/:executionId/files', { schema: { operationId: 'listEvidenceFileMetadata', tags: ['evidence'], security: [{ sessionCookie: [] }], params: { type: 'object', required: ['executionId'], properties: { executionId: uuid } } } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try { const items = await evidence.listFileMetadata(actor.id, request.params.executionId); return { items }; } catch (error) { return mapError(reply, error); }
  });
  app.delete<{ Params: { id: string } }>('/v1/files/:id', { schema: { operationId: 'softDeleteEvidenceFileMetadata', tags: ['evidence'], security: [{ sessionCookie: [], csrfHeader: [] }], params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try { return await evidence.deleteFileMetadata(actor.id, request.params.id) ? reply.code(204).send() : invalid(reply, 'RESOURCE_NOT_FOUND', 404); } catch (error) { return mapError(reply, error); }
  });
  app.post('/internal/v1/retention/sweep', { schema: { operationId: 'sweepExpiredEvidenceInternal', tags: ['internal'], security: [{ identityInternalToken: [] }] } }, async (request, reply) => {
    if (!internalAllowed(request.headers['x-identity-internal-token'] as string | undefined)) return invalid(reply, 'UNAUTHENTICATED', 401);
    try { return { removed: await evidence.pruneExpired(config.evidenceRetentionDays) }; } catch (error) { return mapError(reply, error); }
  });
}
