import type { ReportSources, SourceRecords } from '../application/reports.js';
import { ReportError } from '../domain/reports.js';
export class HttpReportSources implements ReportSources {
  constructor(private readonly identityOrigin:string,private readonly learningOrigin:string,private readonly communityOrigin:string,private readonly token:string|undefined,private readonly transport:typeof fetch=fetch){}
  private async call(origin:string,path:string,body?:unknown,correlationId?:string){
    if(!this.token)throw new ReportError('DEPENDENCY_UNAVAILABLE');
    try{const result=await this.transport(origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-identity-internal-token':this.token,...(correlationId?{'x-request-id':correlationId}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(3000)});if(!result.ok)throw new Error('HTTP_DEPENDENCY');return await result.json() as Record<string,unknown>;}catch{throw new ReportError('DEPENDENCY_UNAVAILABLE');}
  }
  async authorize(accountId:string,workspaceId:string){return (await this.call(this.learningOrigin,'/internal/v1/workspaces/report-authorize',{accountId,workspaceId})).allowed===true;}
  async active(accountId:string){return (await this.call(this.identityOrigin,`/internal/v1/accounts/${accountId}/status`)).active===true;}
  private async snapshot(origin:string,accountId:string,workspaceId:string,records:Array<{source:string;id:string}>,correlationId:string):Promise<SourceRecords>{
    const response=await this.call(origin,'/internal/v1/report-records/snapshot',{accountId,workspaceId,records:records.map(({source,id})=>({source,id}))},correlationId);
    if(!Array.isArray(response.items)||!Array.isArray(response.missing))throw new ReportError('DEPENDENCY_UNAVAILABLE');
    const requested=new Set(records.map(record=>record.source+':'+record.id));
    for(const item of [...response.items,...response.missing])if(!item||typeof item!=='object'||!requested.has(String(item.source)+':'+String(item.id)))throw new ReportError('DEPENDENCY_UNAVAILABLE');
    if(response.items.length+response.missing.length!==requested.size||new Set([...response.items,...response.missing].map(item=>String(item.source)+':'+String(item.id))).size!==requested.size)throw new ReportError('DEPENDENCY_UNAVAILABLE');
    for(const item of response.items)if((typeof item.version!=='string'&&typeof item.version!=='number')||(typeof item.version==='number'&&!Number.isFinite(item.version))||!item.data||typeof item.data!=='object'||Array.isArray(item.data))throw new ReportError('DEPENDENCY_UNAVAILABLE');
    return response as unknown as SourceRecords;
  }
  learning(accountId:string,workspaceId:string,records:Array<{source:string;id:string}>,correlationId:string){return this.snapshot(this.learningOrigin,accountId,workspaceId,records,correlationId);}
  community(accountId:string,workspaceId:string,records:Array<{source:string;id:string}>,correlationId:string){return this.snapshot(this.communityOrigin,accountId,workspaceId,records,correlationId);}
}
