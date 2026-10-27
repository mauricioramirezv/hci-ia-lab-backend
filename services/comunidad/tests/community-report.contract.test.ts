import {describe,it,expect,vi,afterEach} from 'vitest';
import type {Pool} from 'pg';
import {createApp} from '../src/app.js';
import {CommunityApplication,CommunityError} from '../src/comunidad/application/use-cases.js';
import type {CommunityRepository} from '../src/comunidad/application/use-cases.js';
import {IdentityHttpClient} from '../src/comunidad/infrastructure/identity-client.js';

const accountId='00000000-0000-4000-8000-000000000001',workspaceId='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003';
const config={port:3003,host:'127.0.0.1',logLevel:'silent' as const,corsOrigins:[],nodeEnv:'test',identityBaseUrl:'http://identity.test',learningBaseUrl:'http://learning.test',identityInternalToken:'synthetic-service-token',database:{host:'localhost',port:5432,database:'community_db',user:'community_app',password:'synthetic-fixture',max:1,connectionTimeoutMillis:100,ssl:false}};
afterEach(()=>vi.unstubAllGlobals());
describe('Community report snapshots and invitation contracts',()=>{
  it('publishes invitation reads and internal report authorization/snapshots with authentication',async()=>{
    const query=vi.fn().mockRejectedValue(new Error('database should not be reached'));
    const app=await createApp(config,{check:async()=>true},{query} as unknown as Pool,{resolve:async()=>null});
    try{const spec=(await app.inject('/openapi.json')).json();expect(spec.paths['/v1/groups/{id}/invitations'].get.operationId).toBe('listGroupInvitations');for(const path of ['/internal/v1/workspaces/report-authorize','/internal/v1/report-records/snapshot']){expect(spec.paths[path].post.security).toEqual([{identityInternalToken:[]}]);}const response=await app.inject({method:'POST',url:'/internal/v1/report-records/snapshot',payload:{accountId,workspaceId,records:[{source:'reservation',id}]}});expect(response.statusCode).toBe(401);expect(query).not.toHaveBeenCalled();}finally{await app.close();}
  });
  it('blocks a snapshot for an inactive or unknown account before touching records',async()=>{
    const query=vi.fn().mockRejectedValue(new Error('database should not be reached'));
    const app=await createApp(config,{check:async()=>true},{query} as unknown as Pool,{resolve:async()=>null,isAccountActive:async()=>false},{ownsWorkspace:async()=>true});
    try{const response=await app.inject({method:'POST',url:'/internal/v1/report-records/snapshot',headers:{'x-identity-internal-token':config.identityInternalToken},payload:{accountId,workspaceId,records:[{source:'reservation',id}]}});expect(response.statusCode).toBe(401);expect(query).not.toHaveBeenCalled();}finally{await app.close();}
  });
  it('returns the saved reservation version and explicitly marks missing IDs',async()=>{
    const snapshotReservations=vi.fn().mockResolvedValue([{id,version:4,workspaceId,status:'confirmed'}]);
    const repo={snapshotReservations,canReportWorkspace:vi.fn().mockResolvedValue(false)} as unknown as CommunityRepository;
    const application=new CommunityApplication(repo,{ownsWorkspace:async()=>true});
    const missing='00000000-0000-4000-8000-000000000004';const result=await application.snapshotReservations(accountId,workspaceId,[id,missing]);expect(snapshotReservations).toHaveBeenCalledWith(workspaceId,[id,missing]);expect(result).toMatchObject({items:[{source:'reservation',id,version:4,data:{workspaceId}}],missing:[{source:'reservation',id:missing}]});
  });
  it('permits a group leader with a shared workspace and denies an unrelated account',async()=>{
    const snapshotReservations=vi.fn().mockResolvedValue([{id,version:1}]);const canReportWorkspace=vi.fn().mockResolvedValue(true);const application=new CommunityApplication({snapshotReservations,canReportWorkspace} as unknown as CommunityRepository,{ownsWorkspace:async()=>false});await application.snapshotReservations(accountId,workspaceId,[id]);expect(canReportWorkspace).toHaveBeenCalledWith(accountId,workspaceId);canReportWorkspace.mockResolvedValue(false);await expect(application.snapshotReservations(accountId,workspaceId,[id])).rejects.toMatchObject({code:'NOT_FOUND'});expect(snapshotReservations).toHaveBeenCalledTimes(1);
  });
  it('blocks dependent reads when a synchronous ownership dependency fails and rejects repeated IDs',async()=>{
    const snapshotReservations=vi.fn();const application=new CommunityApplication({snapshotReservations,canReportWorkspace:async()=>true} as unknown as CommunityRepository,{ownsWorkspace:async()=>{throw new Error('unavailable');}});await expect(application.snapshotReservations(accountId,workspaceId,[id])).rejects.toEqual(new CommunityError('DEPENDENCY_UNAVAILABLE'));await expect(application.snapshotReservations(accountId,workspaceId,[id,id])).rejects.toMatchObject({code:'INVALID_INPUT'});expect(snapshotReservations).not.toHaveBeenCalled();
  });
  it('checks active account state through the Identity contract and fails closed on malformed replies',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({active:true}))).mockResolvedValueOnce(new Response('{}'));vi.stubGlobal('fetch',fetcher);const client=new IdentityHttpClient('http://identity.test','synthetic-service-token');expect(await client.isAccountActive(accountId)).toBe(true);expect(fetcher).toHaveBeenCalledWith('http://identity.test/internal/v1/accounts/'+accountId+'/status',expect.objectContaining({headers:{'x-identity-internal-token':'synthetic-service-token'}}));await expect(client.isAccountActive(accountId)).rejects.toMatchObject({message:'DEPENDENCY_UNAVAILABLE'});
  });
});
