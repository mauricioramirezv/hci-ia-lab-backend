import {describe,it,expect} from 'vitest';
import {createApp} from '../src/app.js';
import type {Pool} from 'pg';

const config={port:3002,host:'127.0.0.1',logLevel:'silent' as const,corsOrigins:['https://lab.example.test'],nodeEnv:'test',
  identityBaseUrl:'http://identity.test',identityInternalToken:'internal-fixture',
  database:{host:'localhost',port:5432,database:'learning_db',user:'learning_app',password:'fixture_only_not_a_secret',max:1,connectionTimeoutMillis:100,ssl:false}};
const pool={query:async()=>{throw new Error('database should not be reached');},connect:async()=>{throw new Error('database should not be reached');}} as unknown as Pool;
const sessions={resolve:async()=>null};
const key='00000000-0000-4000-8000-000000000002';

describe('learning activity API contracts',()=>{
  it('publishes catalog and execution data paths in OpenAPI with stable security requirements',async()=>{
    const app=await createApp(config,{check:async()=>true},pool,sessions);
    try{
      const spec=(await app.inject('/openapi.json')).json();
      expect(spec.paths['/v1/catalog/modules'].get.operationId).toBe('listLearningModules');
      expect(spec.paths['/v1/catalog/activities'].get).toBeDefined();
      expect(spec.paths['/v1/catalog/activity-versions/{id}/metrics'].get).toBeDefined();
      expect(spec.paths['/internal/v1/report-records/authorize'].post.operationId).toBe('authorizeReportRecordsInternal');
      expect(spec.paths['/v1/workspaces/{workspaceId}/personas'].get).toBeDefined();
      expect(spec.paths['/v1/workspaces/{workspaceId}/personas'].post).toBeDefined();
      expect(spec.paths['/v1/workspaces/{workspaceId}/scenarios'].post).toBeDefined();
      expect(spec.paths['/v1/executions/{id}/results'].get).toBeDefined();
      expect(spec.paths['/v1/executions/{id}/results'].post).toBeDefined();
      expect(spec.paths['/v1/executions/{id}/results'].post.parameters).toContainEqual(expect.objectContaining({name:'idempotency-key',required:true}));
      const unauthenticated=await app.inject('/v1/workspaces');
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json().code).toBe('UNAUTHENTICATED');
      const write=await app.inject({method:'POST',url:'/v1/workspaces',payload:{name:'Private workspace'},headers:{
        'idempotency-key':key,'cookie':'hci_identity_session=bad; hci_identity_csrf=csrf','x-csrf-token':'csrf'}});
      expect(write.statusCode).toBe(401);
      const foreignWrite=await app.inject({method:'POST',url:'/v1/workspaces/00000000-0000-4000-8000-000000000001/personas',
        headers:{'idempotency-key':key,'cookie':'hci_identity_session=bad; hci_identity_csrf=csrf','x-csrf-token':'csrf'},
        payload:{name:'Ana',age:'',context:'ctx',goal:'goal',barrier:'barrier',device:'tablet',empathy:{says:'',thinks:'',does:'',feels:''}}});
      expect(foreignWrite.statusCode).toBe(401);
      expect(foreignWrite.json().code).toBe('UNAUTHENTICATED');
    }finally{await app.close();}
  });
});
