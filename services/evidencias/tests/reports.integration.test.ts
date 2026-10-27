import {afterAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {ReportsApplication,type ReportSources} from '../src/evidencias/application/reports.js';
import {PostgresReportRepository,invalidateReportsFromEvent} from '../src/evidencias/infrastructure/postgres-reports.js';
import {exportReport} from '../src/evidencias/domain/reports.js';
import {receiveEvent} from '../src/infrastructure/events.js';
import {createApp} from '../src/app.js';

const suite=process.env.TEST_POSTGRES==='1'?describe:describe.skip;
suite('Report snapshots, authorization and reconciliation (PostgreSQL)',()=>{
 const pool=new pg.Pool({host:process.env.POSTGRES_HOST??'127.0.0.1',port:Number(process.env.POSTGRES_PORT??5432),database:process.env.EVIDENCIAS_DB,user:process.env.EVIDENCIAS_USER,password:process.env.EVIDENCIAS_PASSWORD,max:5});
 const owner=randomUUID(),leader=randomUUID(),other=randomUUID(),workspace=randomUUID(),execution=randomUUID(),activity=randomUUID(),reportIds:string[]=[],inboxIds:string[]=[];
 const repository=new PostgresReportRepository(pool);let unavailable=false,version=1;
 const sources:ReportSources={authorize:async(account,id)=>id===workspace&&(account===owner||account===leader),active:async account=>account===owner,learning:async(_account,_workspace,records)=>{if(unavailable)throw Error('fixture-source-down');return {items:records.map(record=>({...record,version,activityVersion:{id:activity,version:2},instrumentVersion:{id:'versioned-instrument',version:1},formulaVersion:'SUS-5PT-1.0',data:{score:75,executionId:record.id}})),missing:[]};},community:async()=>({items:[],missing:[]})};
 const application=new ReportsApplication(repository,sources);let reportId='',checkId='';
 afterAll(async()=>{if(reportIds.length){await pool.query('DELETE FROM evidence.informe WHERE informe_id=ANY($1::uuid[])',[reportIds]);await pool.query('DELETE FROM evidence.event_outbox WHERE aggregate_id=ANY($1::uuid[])',[reportIds]);}if(checkId)await pool.query('DELETE FROM evidence.verificacion_accesibilidad WHERE verificacion_accesibilidad_id=$1',[checkId]);await pool.query('DELETE FROM evidence.write_idempotency WHERE actor_id=$1',[owner]);if(inboxIds.length)await pool.query('DELETE FROM evidence.event_inbox WHERE event_id=ANY($1::uuid[])',[inboxIds]);await pool.query('DELETE FROM evidence.event_projection WHERE aggregate_id=$1',[execution]);await pool.end();});
 it('authorizes the owner or an active group leader, never an unrelated account',async()=>{
   checkId=(await pool.query("INSERT INTO evidence.verificacion_accesibilidad(espacio_id,cuenta_id,codigo,superada) VALUES($1,$2,'keyboard',true) RETURNING verificacion_accesibilidad_id",[workspace,owner])).rows[0].verificacion_accesibilidad_id;
   const created=await application.create(owner,{workspaceId:workspace,projectName:'Synthetic study',records:[{section:'selected',source:'execution',id:execution},{section:'selected',source:'accessibility_check',id:checkId}]},'create-fixture','correlation-create');reportId=(created.item as {id:string}).id;reportIds.push(reportId);
   expect(await application.get(leader,reportId)).toMatchObject({status:'pending',snapshotVersion:0});await expect(application.get(other,reportId)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(application.create(other,{workspaceId:workspace,records:[{section:'selected',source:'execution',id:execution}]},'foreign','correlation')).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('claims concurrent generation once, preserves formula/activity snapshots and replays the completed key',async()=>{
   const generated=await Promise.all([application.generate(owner,reportId,'same-key','correlation-1'),application.generate(owner,reportId,'same-key','correlation-1')]);expect(generated.some(result=>(result.item as {status:string}).status==='ready')).toBe(true);
   expect((await pool.query('SELECT count(*)::int AS n FROM evidence.report_snapshot WHERE report_id=$1',[reportId])).rows[0].n).toBe(1);
   const report=await application.get(owner,reportId);expect(report.snapshot?.records[0]).toMatchObject({source:'execution',version:1,activityVersion:{id:activity,version:2},instrumentVersion:{version:1},formulaVersion:'SUS-5PT-1.0'});expect(report.snapshotVersion).toBe(1);
   expect(await application.generate(owner,reportId,'same-key','correlation-retry')).toMatchObject({replayed:true,item:{snapshotVersion:1,status:'ready'}});
 });
 it('keeps a partial prior snapshot during source outage, then reconciles it without losing history',async()=>{
   unavailable=true;expect(await application.generate(owner,reportId,'source-down','correlation-down')).toMatchObject({item:{status:'partial',snapshotVersion:2,missingSources:['aprendizaje']}});
   const partial=await application.get(owner,reportId);expect(partial.snapshot?.records).toHaveLength(2);expect(partial.stale).toBe(true);
   unavailable=false;version=3;expect(await application.generate(leader,reportId,'source-restored','correlation-restored')).toMatchObject({item:{status:'ready',snapshotVersion:3,missingSources:[]}});expect((await application.get(owner,reportId)).snapshot?.records[0].version).toBe(3);
   expect((await pool.query('SELECT version FROM evidence.report_snapshot WHERE report_id=$1 ORDER BY version',[reportId])).rows.map(row=>row.version)).toEqual([1,2,3]);
 });
 it('invalidates relevant report snapshots through the transactional inbox consumer only once',async()=>{
   const id=randomUUID();inboxIds.push(id);const event={id,source:'aprendizaje' as const,sequence:'123456',type:'execution.changed',aggregateType:'execution',aggregateId:execution,version:'4',occurredAt:new Date().toISOString(),correlationId:'execution-change-fixture',payload:{executionId:execution,workspaceId:workspace,version:4}};
   expect(await receiveEvent(pool,{schema:'evidence',source:'evidencias',targets:{},onEvent:invalidateReportsFromEvent},event)).toMatchObject({duplicate:false});expect(await receiveEvent(pool,{schema:'evidence',source:'evidencias',targets:{},onEvent:invalidateReportsFromEvent},event)).toMatchObject({duplicate:true});expect(await application.get(owner,reportId)).toMatchObject({status:'pending',stale:true});
 });
 it('exports actual snapshots and keeps the version and incomplete-source markers in artifacts',async()=>{
   const report=await application.get(owner,reportId);expect(JSON.parse(exportReport(report,'json').body).snapshotVersion).toBe(3);expect(exportReport(report,'markdown').body).toContain('SUS-5PT-1.0');expect(exportReport(report,'csv').body).toContain('snapshot_version');expect(()=>exportReport(report,'pdf')).toThrow('FORMAT_UNSUPPORTED');
 });
 it('documents remote report operations and rejects absent sessions/CSRF before external calls',async()=>{
   const config={port:3004,host:'127.0.0.1',logLevel:'silent' as const,corsOrigins:['https://lab.example.test'],nodeEnv:'test',identityBaseUrl:'http://identity.test',learningBaseUrl:'http://learning.test',communityBaseUrl:'http://community.test',identityInternalToken:'internal-fixture',database:{host:'localhost',port:5432,database:'evidence_db',user:'evidence_app',password:'fixture-only',max:1,connectionTimeoutMillis:100,ssl:false}};
   const session={resolve:async(token:string)=>token==='owner-session'?{id:owner,globalRoles:['participant'],permissions:[],emailVerified:true}:null};
   const app=await createApp(config,{check:async()=>true},pool,session);const request=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{throw Error('must not reach network');});
   try{const spec=(await app.inject('/openapi.json')).json();for(const path of ['/v1/reports','/v1/reports/{id}/generate','/v1/reports/{id}/export','/internal/v1/events'])expect(spec.paths[path]).toBeDefined();expect((await app.inject(`/v1/reports/${reportId}`)).statusCode).toBe(401);const denied=await app.inject({method:'POST',url:`/v1/reports/${reportId}/generate`,headers:{cookie:'hci_identity_session=owner-session; hci_identity_csrf=csrf','idempotency-key':'contract-test'}});expect(denied.statusCode).toBe(403);expect(denied.json().code).toBe('CSRF_INVALID');expect(request).not.toHaveBeenCalled();}finally{request.mockRestore();await app.close();}
 });
});
