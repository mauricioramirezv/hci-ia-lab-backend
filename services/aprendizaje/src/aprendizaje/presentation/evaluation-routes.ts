import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from '../../config.js';
import type { SessionPort } from '../application/session.js';
import { EvaluationApplication } from '../application/evaluation.js';
import { EvaluationError } from '../domain/evaluation.js';
import { IdempotencyKeyConflict } from '../domain/learning-data.js';
import { PostgresEvaluationRepository } from '../infrastructure/postgres-evaluation.js';
import { account } from './work-routes.js';

const page = { type: 'object', additionalProperties: false, properties: {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  offset: { type: 'integer', minimum: 0, default: 0 },
} };
const uuid = { type: 'string', format: 'uuid' };
const keyHeader = { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': uuid } };
const locale = { type: 'string', enum: ['es-CO', 'en-US', 'pt-BR', 'fr-FR', 'it-IT', 'ca-ES'], default: 'es-CO' };
const responseItem = { type: 'object', additionalProperties: false, required: ['itemId', 'value'], properties: {
  itemId: uuid, value: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1, maxLength: 5000 }] },
} };

function invalid(reply: FastifyReply, code: string, status: number) {
  return reply.code(status).send({ code, requestId: reply.request.id });
}
function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof IdempotencyKeyConflict) return invalid(reply, 'IDEMPOTENCY_KEY_REUSED', 409);
  if (!(error instanceof EvaluationError)) throw error;
  const statuses = { INVALID_INPUT: 400, NOT_FOUND: 404, STATE_CONFLICT: 409, IDEMPOTENCY_KEY_REUSED: 409 } as const;
  return invalid(reply, error.code, statuses[error.code]);
}

export async function registerEvaluationRoutes(app: FastifyInstance, pool: Pool, sessions: SessionPort, config: Config) {
  const service = new EvaluationApplication(new PostgresEvaluationRepository(pool));
  const originAllowed = (request: FastifyRequest) => !request.headers.origin || config.corsOrigins.includes(request.headers.origin);

  app.get('/v1/instruments', { schema: { operationId: 'listEvaluationInstruments', tags: ['learning-assessment'], querystring: {
    type: 'object', additionalProperties: false, properties: { locale, type: { type: 'string', enum: ['SUS', 'NASA_TLX', 'custom'] }, limit: page.properties.limit, offset: page.properties.offset },
  } } }, async (request, reply) => {
    try {
      const query = request.query as { locale?: string; type?: 'SUS' | 'NASA_TLX' | 'custom'; limit?: number; offset?: number };
      const selectedLocale = query.locale ?? 'es-CO', limit = query.limit ?? 25, offset = query.offset ?? 0;
      return { items: await service.listInstruments(selectedLocale, query.type, limit, offset), locale: selectedLocale, limit, offset };
    } catch (error) { return mapError(reply, error); }
  });

  app.get('/v1/heuristics', { schema: { operationId: 'listHeuristicVersions', tags: ['learning-assessment'], querystring: {
    type: 'object', additionalProperties: false, properties: { locale, limit: page.properties.limit, offset: page.properties.offset },
  } } }, async (request, reply) => {
    try {
      const query = request.query as { locale?: string; limit?: number; offset?: number };
      const selectedLocale = query.locale ?? 'es-CO', limit = query.limit ?? 25, offset = query.offset ?? 0;
      return { items: await service.listHeuristics(selectedLocale, limit, offset), locale: selectedLocale, limit, offset };
    } catch (error) { return mapError(reply, error); }
  });

  app.post<{ Params: { workspaceId: string } }>('/v1/workspaces/:workspaceId/evaluation-sessions', {
    schema: { operationId: 'createEvaluationSession', tags: ['learning-assessment'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader,
      params: { type: 'object', required: ['workspaceId'], properties: { workspaceId: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['type'], properties: {
        type: { type: 'string', enum: ['task', 'SUS', 'NASA_TLX', 'heuristic', 'custom'] }, executionId: uuid, instrumentId: uuid,
        participantAlias: { type: 'string', maxLength: 100 }, task: { type: 'string', maxLength: 2000 }, success: { type: 'boolean' },
        seconds: { type: 'number', minimum: 0 }, errors: { type: 'integer', minimum: 0 }, seq: { type: 'number', minimum: 1, maximum: 7 },
        emotion: { type: 'number', minimum: 1, maximum: 5 }, notes: { type: 'string', maxLength: 5000 },
      } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try {
      const key = request.headers['idempotency-key'] as string;
      const item = await service.createSession(actor.id, request.params.workspaceId, request.body as never, key);
      if (!item) return invalid(reply, 'NOT_FOUND', 404);
      return reply.code(item.replayed ? 200 : 201).send(item);
    } catch (error) { return mapError(reply, error); }
  });

  app.get<{ Params: { workspaceId: string } }>('/v1/workspaces/:workspaceId/evaluation-sessions', {
    schema: { operationId: 'listWorkspaceEvaluationSessions', tags: ['learning-assessment'], security: [{ sessionCookie: [] }],
      params: { type: 'object', required: ['workspaceId'], properties: { workspaceId: uuid } }, querystring: page },
  }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const query = request.query as { limit?: number; offset?: number }, limit = query.limit ?? 25, offset = query.offset ?? 0;
    try {
      const items = await service.listSessions(actor.id, request.params.workspaceId, limit, offset);
      return items === null ? invalid(reply, 'NOT_FOUND', 404) : { items, limit, offset };
    } catch (error) { return mapError(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/v1/evaluation-sessions/:id', {
    schema: { operationId: 'getEvaluationSession', tags: ['learning-assessment'], security: [{ sessionCookie: [] }],
      params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    try {
      const item = await service.getSession(actor.id, request.params.id);
      return item ? { item } : invalid(reply, 'NOT_FOUND', 404);
    } catch (error) { return mapError(reply, error); }
  });

  app.post<{ Params: { id: string } }>('/v1/evaluation-sessions/:id/responses', {
    schema: { operationId: 'submitEvaluationResponses', tags: ['learning-assessment'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader,
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['responses'], properties: { responses: { type: 'array', minItems: 1, maxItems: 100, items: responseItem } } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try {
      const key = request.headers['idempotency-key'] as string;
      const item = await service.submitResponses(actor.id, request.params.id, (request.body as { responses: unknown[] }).responses, key);
      if (!item) return invalid(reply, 'NOT_FOUND', 404);
      return reply.code(item.replayed ? 200 : 201).send(item);
    } catch (error) { return mapError(reply, error); }
  });

  app.post<{ Params: { workspaceId: string } }>('/v1/workspaces/:workspaceId/heuristic-findings', {
    schema: { operationId: 'createHeuristicFinding', tags: ['learning-assessment'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader,
      params: { type: 'object', required: ['workspaceId'], properties: { workspaceId: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['task', 'severity', 'problem', 'evidence', 'recommendation', 'source'],
        properties: { sessionId: uuid, executionId: uuid, heuristicVersionId: uuid, heuristicLabel: { type: 'string', maxLength: 200 },
          task: { type: 'string', minLength: 1, maxLength: 2000 }, severity: { type: 'integer', minimum: 0, maximum: 4 },
          problem: { type: 'string', minLength: 1, maxLength: 5000 }, evidence: { type: 'string', minLength: 1, maxLength: 5000 },
          recommendation: { type: 'string', minLength: 1, maxLength: 5000 }, source: { type: 'string', enum: ['human', 'ai'] },
          state: { type: 'string', enum: ['pending', 'validated', 'rejected'] } },
      },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try {
      const result = await service.createFinding(actor.id, request.params.workspaceId, request.body as never, request.headers['idempotency-key'] as string);
      return result ? reply.code(result.replayed ? 200 : 201).send(result) : invalid(reply, 'NOT_FOUND', 404);
    } catch (error) { return mapError(reply, error); }
  });

  app.get<{ Params: { workspaceId: string } }>('/v1/workspaces/:workspaceId/heuristic-findings', {
    schema: { operationId: 'listHeuristicFindings', tags: ['learning-assessment'], security: [{ sessionCookie: [] }],
      params: { type: 'object', required: ['workspaceId'], properties: { workspaceId: uuid } }, querystring: page },
  }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const query = request.query as { limit?: number; offset?: number }, limit = query.limit ?? 25, offset = query.offset ?? 0;
    try {
      const items = await service.listFindings(actor.id, request.params.workspaceId, limit, offset);
      return items === null ? invalid(reply, 'NOT_FOUND', 404) : { items, limit, offset };
    } catch (error) { return mapError(reply, error); }
  });

  app.patch<{ Params: { id: string } }>('/v1/heuristic-findings/:id/state', {
    schema: { operationId: 'reviewHeuristicFinding', tags: ['learning-assessment'], security: [{ sessionCookie: [], csrfHeader: [] }],
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['expectedState', 'state'], properties: {
        expectedState: { type: 'string', enum: ['pending', 'validated'] }, state: { type: 'string', enum: ['validated', 'rejected'] },
      } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    const body = request.body as { expectedState: string; state: 'validated' | 'rejected' };
    try {
      const item = await service.updateFinding(actor.id, request.params.id, body.expectedState, body.state);
      return item ? { item } : invalid(reply, 'NOT_FOUND', 404);
    } catch (error) { return mapError(reply, error); }
  });

  app.post('/v1/demo-users', { schema: { operationId: 'createFictionalLabUser', tags: ['learning-assessment'], security: [{ sessionCookie: [], csrfHeader: [] }], headers: keyHeader,
    body: { type: 'object', additionalProperties: false, required: ['name', 'email', 'role'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 }, email: { type: 'string', format: 'email', maxLength: 254 },
      role: { type: 'string', enum: ['student', 'teacher', 'evaluator'] }, state: { type: 'string', enum: ['active', 'inactive'] },
    } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try {
      const result = await service.createDemoUser(actor.id, request.body as never, request.headers['idempotency-key'] as string);
      if (!result.item) return invalid(reply, 'NOT_FOUND', 404);
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) { return mapError(reply, error); }
  });

  app.get('/v1/demo-users', { schema: { operationId: 'listFictionalLabUsers', tags: ['learning-assessment'], security: [{ sessionCookie: [] }], querystring: page } }, async (request, reply) => {
    const actor = await account(request, reply, sessions); if (!actor) return;
    const query = request.query as { limit?: number; offset?: number }, limit = query.limit ?? 25, offset = query.offset ?? 0;
    try { return { items: await service.listDemoUsers(actor.id, limit, offset), limit, offset }; }
    catch (error) { return mapError(reply, error); }
  });

  app.patch<{ Params: { id: string } }>('/v1/demo-users/:id', {
    schema: { operationId: 'updateFictionalLabUser', tags: ['learning-assessment'], security: [{ sessionCookie: [], csrfHeader: [] }],
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['expectedUpdatedAt'], properties: {
        expectedUpdatedAt: { type: 'string', format: 'date-time' }, name: { type: 'string', minLength: 1, maxLength: 120 },
        email: { type: 'string', format: 'email', maxLength: 254 }, role: { type: 'string', enum: ['student', 'teacher', 'evaluator'] },
        state: { type: 'string', enum: ['active', 'inactive'] },
      } },
  } }, async (request, reply) => {
    if (!originAllowed(request)) return invalid(reply, 'FORBIDDEN', 403);
    const actor = await account(request, reply, sessions, true); if (!actor) return;
    try {
      const item = await service.updateDemoUser(actor.id, request.params.id, request.body as never);
      return item ? { item } : invalid(reply, 'NOT_FOUND', 404);
    } catch (error) { return mapError(reply, error); }
  });
}
