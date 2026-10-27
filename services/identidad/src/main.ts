import pg from 'pg';
import {loadConfig} from './config.js';
import {createApp} from './app.js';
import {PostgresHealth} from './identidad/infrastructure/postgres-health.js';
import {AuthDatabase} from './identidad/infrastructure/auth-database.js';
import {AuthApplication} from './identidad/application/auth.js';
import {hashPassword,verifyPassword,newToken,tokenHash,DUMMY_PASSWORD_HASH} from './identidad/infrastructure/passwords.js';
import {LocalMailer,SmtpMailer} from './identidad/infrastructure/mailer.js';
import {instrumentEventPool,startEventWorker} from './infrastructure/events.js';

process.env.PORT??=process.env.IDENTIDAD_PORT;
process.env.POSTGRES_DB??=process.env.IDENTIDAD_DB;
process.env.POSTGRES_USER??=process.env.IDENTIDAD_USER;
process.env.POSTGRES_PASSWORD??=process.env.IDENTIDAD_PASSWORD;
const config=loadConfig();
const pool=instrumentEventPool(new pg.Pool({...config.database,ssl:config.database.ssl?{rejectUnauthorized:true}:false,query_timeout:1500,application_name:'hci-identidad',idleTimeoutMillis:10000}));
const localMailer=config.mailTransport==='local'?new LocalMailer():undefined;
const mailer=config.mailTransport==='local'?localMailer:config.smtpUrl&&config.smtpFrom?new SmtpMailer(config.smtpUrl,config.smtpFrom):undefined;
if(!mailer)throw new Error('Identity mail adapter is not configured');
const crypto={hashPassword,verifyPassword,newToken,tokenHash,dummyPasswordHash:DUMMY_PASSWORD_HASH};
const auth=new AuthApplication(new AuthDatabase(pool),crypto,mailer,config.webBaseUrl,config.sessionHours);
const eventOptions={schema:'identity' as const,source:'identidad' as const,token:config.identityInternalToken,targets:{aprendizaje:config.learningBaseUrl,comunidad:config.communityBaseUrl,evidencias:config.evidenceBaseUrl}};
const app=await createApp(config,new PostgresHealth(pool),auth,localMailer,pool,eventOptions);
let worker:ReturnType<typeof startEventWorker>|undefined;
try { await app.listen({port:config.port,host:config.host});worker=startEventWorker(pool,eventOptions); }
catch(error) { app.log.error({err:error instanceof Error?error.name:'unknown'},'startup failed');await pool.end();process.exitCode=1; }
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>worker?.stop()).finally(()=>pool.end());});
