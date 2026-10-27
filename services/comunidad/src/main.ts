import pg from 'pg';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { PostgresHealth } from './comunidad/infrastructure/postgres-health.js';
import { IdentityHttpClient } from './comunidad/infrastructure/identity-client.js';
import { instrumentEventPool, startEventWorker } from './infrastructure/events.js';
process.env.PORT ??= process.env.COMUNIDAD_PORT;
process.env.POSTGRES_DB ??= process.env.COMUNIDAD_DB;
process.env.POSTGRES_USER ??= process.env.COMUNIDAD_USER;
process.env.POSTGRES_PASSWORD ??= process.env.COMUNIDAD_PASSWORD;
const config = loadConfig();
const pool = instrumentEventPool(new pg.Pool({ ...config.database, ssl: config.database.ssl ? { rejectUnauthorized: true } : false, query_timeout: 1500, application_name: 'hci-comunidad', idleTimeoutMillis: 10000 }));
const sessions = new IdentityHttpClient(config.identityBaseUrl, config.identityInternalToken);
const app = await createApp(config, new PostgresHealth(pool), pool, sessions);
let worker: ReturnType<typeof startEventWorker> | undefined;
try { await app.listen({ port: config.port, host: config.host }); worker = startEventWorker(pool, { schema: 'community', source: 'comunidad', token: config.identityInternalToken, targets: { identidad: config.identityBaseUrl, aprendizaje: config.learningBaseUrl, evidencias: config.evidenceBaseUrl ?? 'http://localhost:3004' } }); }
catch (error) { app.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'startup failed'); await pool.end(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => worker?.stop()).finally(() => pool.end()); });
