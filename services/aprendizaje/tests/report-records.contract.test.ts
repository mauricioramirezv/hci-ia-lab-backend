import { afterEach, describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Pool } from 'pg';
const config = { port: 3002, host: '127.0.0.1', logLevel: 'silent' as const, corsOrigins: [], nodeEnv: 'test', identityBaseUrl: 'http://identity.test', communityBaseUrl: 'http://community.test', evidenceBaseUrl: 'http://evidence.test', identityInternalToken: 'internal-fixture', database: { host: 'localhost', port: 5432, database: 'learning_db', user: 'learning_app', password: 'fixture_only_not_a_secret', max: 1, connectionTimeoutMillis: 100, ssl: false } };
const pool = { query: async () => { throw new Error('database should not be reached'); }, connect: async () => { throw new Error('database should not be reached'); } } as unknown as Pool;
afterEach(()=>vi.unstubAllGlobals());
describe('Learning report record contract', () => {
  it('publishes an internal authorization contract and rejects unauthenticated callers', async () => {
    const app = await createApp(config, { check: async () => true }, pool, { resolve: async () => null });
    try {
      const spec = (await app.inject('/openapi.json')).json();
      expect(spec.paths['/internal/v1/report-records/authorize'].post.operationId).toBe('authorizeReportRecordsInternal');
      expect(spec.paths['/internal/v1/workspaces/report-authorize'].post.operationId).toBe('authorizeReportWorkspaceInternal');
      expect(spec.paths['/internal/v1/report-records/snapshot'].post.operationId).toBe('snapshotLearningReportRecordsInternal');
      expect(spec.paths['/internal/v1/report-records/snapshot'].post.requestBody.content['application/json'].schema.properties.records.items.properties.source.enum).toContain('evaluation_session');
      const result = await app.inject({ method: 'POST', url: '/internal/v1/report-records/authorize', payload: { accountId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002', records: {} } });
      expect(result.statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it('authorizes an active group leader and returns only snapshots in the shared workspace',async()=>{
    const executionId='00000000-0000-4000-8000-000000000011',personaId='00000000-0000-4000-8000-000000000012';
    const db={query:async(sql:string)=>sql.includes('learning.espacio_trabajo')?{rows:[],rowCount:0}:sql.includes('learning.ejecucion_actividad x JOIN learning.actividad_version')?{rows:[{id:executionId,version:'3',activity_version:{id:'av-1',version:2},formula_version:['formula-v2'],data:{state:'completed'}}],rowCount:1}:{rows:[],rowCount:0},connect:async()=>{throw new Error('connection should not be used');}} as unknown as Pool;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{const input=JSON.parse(String(init?.body)) as {workspaceId:string};return new Response(JSON.stringify({allowed:input.workspaceId.endsWith('0002')}),{status:200,headers:{'content-type':'application/json'}});}));
    const sessions={resolve:async()=>null,isAccountActive:async()=>true};
    const app=await createApp(config,{check:async()=>true},db,sessions);
    try{
      const body={accountId:'00000000-0000-4000-8000-000000000001',workspaceId:'00000000-0000-4000-8000-000000000002',records:[{source:'execution',id:executionId},{source:'persona',id:personaId}]};
      const response=await app.inject({method:'POST',url:'/internal/v1/report-records/snapshot',headers:{'x-identity-internal-token':'internal-fixture'},payload:body});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({items:[{source:'execution',id:executionId,version:'3',activityVersion:{id:'av-1',version:2},formulaVersion:['formula-v2'],data:{state:'completed'}}],missing:[{source:'persona',id:personaId}]});
      expect(fetch).toHaveBeenCalledWith('http://community.test/internal/v1/workspaces/report-authorize',expect.objectContaining({method:'POST'}));
      const denied=await app.inject({method:'POST',url:'/internal/v1/report-records/snapshot',headers:{'x-identity-internal-token':'internal-fixture'},payload:{...body,workspaceId:'00000000-0000-4000-8000-000000000003'}});
      expect(denied.statusCode).toBe(404);
    }finally{await app.close();}
  });
});
