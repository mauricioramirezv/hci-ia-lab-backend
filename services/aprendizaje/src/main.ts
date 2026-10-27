import pg from 'pg';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { PostgresHealth } from './aprendizaje/infrastructure/postgres-health.js';
import { IdentityHttpClient } from './aprendizaje/infrastructure/identity-client.js';
import { instrumentEventPool, startEventWorker } from './infrastructure/events.js';
process.env.PORT ??= process.env.APRENDIZAJE_PORT;
process.env.POSTGRES_DB ??= process.env.APRENDIZAJE_DB;
process.env.POSTGRES_USER ??= process.env.APRENDIZAJE_USER;
process.env.POSTGRES_PASSWORD ??= process.env.APRENDIZAJE_PASSWORD;
const config = loadConfig();
const pool = instrumentEventPool(new pg.Pool({ ...config.database, ssl: config.database.ssl ? { rejectUnauthorized: true } : false, query_timeout: 1500, application_name: 'hci-aprendizaje', idleTimeoutMillis: 10000 }));
const sessions = new IdentityHttpClient(config.identityBaseUrl, config.identityInternalToken);
const eventOptions = { schema: 'learning' as const, source: 'aprendizaje' as const, token: config.identityInternalToken, targets: { identidad: config.identityBaseUrl, comunidad: config.communityBaseUrl, evidencias: config.evidenceBaseUrl } };
const app = await createApp(config, new PostgresHealth(pool), pool, sessions, eventOptions);
let worker: ReturnType<typeof startEventWorker> | undefined;
try { await app.listen({ port: config.port, host: config.host }); }
catch (error) { app.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'startup failed'); await pool.end(); process.exitCode = 1; }
if (!process.exitCode) worker = startEventWorker(pool, eventOptions);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => worker?.stop()).finally(() => pool.end()); });
