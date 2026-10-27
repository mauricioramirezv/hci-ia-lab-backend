import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { schemas } from './openapi.js';
import { registerHealthRoutes } from './aprendizaje/presentation/routes.js';
import type { HealthPort } from './aprendizaje/application/health.js';
import type { SessionPort } from './aprendizaje/application/session.js';
import { registerLearningRoutes } from './aprendizaje/presentation/work-routes.js';
import { registerLearningDataRoutes } from './aprendizaje/presentation/learning-data-routes.js';
import { registerEvaluationRoutes } from './aprendizaje/presentation/evaluation-routes.js';
import type { EventOptions } from './infrastructure/events.js';
import { registerEventRoutes } from './infrastructure/events.js';

export async function createApp(config: Config, health: HealthPort, pool?: Pool, sessions?: SessionPort, eventOptions?: EventOptions) {
  const app = Fastify({
    logger: { level: config.logLevel, serializers: { req: request => ({ method: request.method, url: String(request.url).split('?')[0], hostname: request.hostname }) }, redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-api-key', 'req.headers.x-identity-internal-token'], censor: '[REDACTED]' } },
    genReqId: request => {
      const value = request.headers['x-request-id'];
      return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : randomUUID();
    },
  });
  app.addHook('onSend', async (request, reply, payload) => { reply.header('x-request-id', request.id); reply.header('cache-control', 'no-store'); return payload; });
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const candidate = Number(error.statusCode ?? 500);
    const status = candidate >= 400 && candidate < 500 ? candidate : 500;
    request.log.error({ err: status === 500 ? { name: error.name } : undefined, requestId: request.id, status }, 'request failed');
    const code = status === 500 ? 'INTERNAL_ERROR' : status === 400 ? 'INVALID_REQUEST' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'ROUTE_NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'INVALID_REQUEST';
    return reply.code(status).send({ code, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => {
    if (['/health/live', '/health/ready', '/openapi.json', '/documentation/json'].includes(request.url.split('?')[0])) return reply.header('allow', 'GET, HEAD').code(405).send({ code: 'METHOD_NOT_ALLOWED', requestId: request.id });
    return reply.code(404).send({ code: 'ROUTE_NOT_FOUND', requestId: request.id });
  });
  if (config.corsOrigins.length) await app.register(cors, { origin: config.corsOrigins, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'x-request-id', 'x-csrf-token', 'idempotency-key'], exposedHeaders: ['x-request-id'], maxAge: 600 });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute', errorResponseBuilder: request => ({ code: 'RATE_LIMITED', requestId: request.id }) });
  for (const [id, schema] of Object.entries(schemas)) app.addSchema({ $id: id, ...structuredClone(schema) });
  await app.register(swagger, { openapi: {
    openapi: '3.1.0', info: { title: 'HCI Lab IA - Aprendizaje', version: '0.3.0', description: 'Espacios de trabajo, ejecuciones, resultados, entregas versionadas y retroalimentacion.' },
    components: { schemas: structuredClone(schemas), securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'hci_identity_session' }, csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, identityInternalToken: { type: 'apiKey', in: 'header', name: 'x-identity-internal-token' },
    } }, paths: {}, security: [],
  } });
  if (pool && eventOptions) registerEventRoutes(app, pool, eventOptions);
  await app.register(async server => registerHealthRoutes(server, health));
  if (pool && sessions) {
    await app.register(async server => registerLearningRoutes(server, pool, sessions, config));
    await app.register(async server => registerLearningDataRoutes(server, pool, sessions, config));
    await app.register(async server => registerEvaluationRoutes(server, pool, sessions, config));
  }
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  return app;
}




