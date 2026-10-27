import pg from 'pg';
import {instrumentEventPool,startEventWorker} from './infrastructure/events.js';
import {invalidateReportsFromEvent} from './evidencias/infrastructure/postgres-reports.js';
import {reportApplication} from './evidencias/presentation/report-routes.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { PostgresHealth } from './evidencias/infrastructure/postgres-health.js';
import { IdentityHttpClient } from './evidencias/infrastructure/identity-client.js';
import { createEvidenceApplication } from './evidencias/infrastructure/composition.js';
import { startRetentionScheduler } from './infrastructure/retention-scheduler.js';
process.env.PORT ??= process.env.EVIDENCIAS_PORT;
process.env.POSTGRES_DB ??= process.env.EVIDENCIAS_DB;
process.env.POSTGRES_USER ??= process.env.EVIDENCIAS_USER;
process.env.POSTGRES_PASSWORD ??= process.env.EVIDENCIAS_PASSWORD;
const config = loadConfig();
const pool = instrumentEventPool(new pg.Pool({ ...config.database, ssl: config.database.ssl ? { rejectUnauthorized: true } : false, query_timeout: 1500, application_name: 'hci-evidencias', idleTimeoutMillis: 10000 }));
const sessions = new IdentityHttpClient(config.identityBaseUrl, config.identityInternalToken);
const evidence = createEvidenceApplication(pool, config);
const app = await createApp(config, new PostgresHealth(pool), pool, sessions, evidence);
const eventWorker=startEventWorker(pool,{schema:'evidence',source:'evidencias',token:config.identityInternalToken,targets:{identidad:config.identityBaseUrl,aprendizaje:config.learningBaseUrl,comunidad:config.communityBaseUrl},onEvent:invalidateReportsFromEvent});
const reports=reportApplication(pool,config);let reconciling=false;let reconciliation:Promise<unknown>|undefined;
const reportTimer=setInterval(()=>{if(reconciling||!config.identityInternalToken)return;reconciling=true;reconciliation=reports.reconcile().catch(()=>undefined).finally(()=>{reconciling=false;});},5000);reportTimer.unref();
let stopRetention=()=>{};
try { await app.listen({ port: config.port, host: config.host }); stopRetention=startRetentionScheduler(()=>evidence.pruneExpired(config.evidenceRetentionDays),app.log); }
catch (error) { app.log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'startup failed'); await pool.end(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { clearInterval(reportTimer);stopRetention();void Promise.all([eventWorker.stop(),reconciliation]).then(()=>app.close()).finally(() => pool.end()); });
