import { ReportError, type ReportDefinition, type ReportRecordSnapshot, type ReportSnapshot } from '../domain/reports.js';
import { isReportSource, type ReportSelection } from '../domain/evidence.js';
import type { ReportInput } from './use-cases.js';

export type SourceRecords = { items: ReportRecordSnapshot[]; missing: Array<{source:string;id:string}> };
export interface ReportSources {
  authorize(accountId:string,workspaceId:string):Promise<boolean>;
  active(accountId:string):Promise<boolean>;
  learning(accountId:string,workspaceId:string,records:Array<{source:string;id:string}>,correlationId:string):Promise<SourceRecords>;
  community(accountId:string,workspaceId:string,records:Array<{source:string;id:string}>,correlationId:string):Promise<SourceRecords>;
}
export interface ReportRepository {
  definition(id:string):Promise<ReportDefinition|null>;
  list(workspaceId:string,limit:number,offset:number):Promise<ReportDefinition[]>;
  localSnapshots(workspaceId:string,records:ReportSelection[]):Promise<SourceRecords>;
  create(accountId:string,input:ReportInput,key:string):Promise<{item:unknown;replayed:boolean}>;
  claim(id:string,accountId:string,key:string):Promise<{token:string}|{item:unknown;replayed:boolean}>;
  finish(id:string,accountId:string,key:string,token:string,status:ReportDefinition['status'],snapshot:ReportSnapshot,lastError:string|null):Promise<{item:unknown;replayed:boolean}>;
  due():Promise<Array<{id:string;ownerId:string}>>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localSources=new Set(['ux_session','evidence','lab_event','accessibility_check']);
export class ReportsApplication {
  constructor(private readonly repo:ReportRepository,private readonly sources:ReportSources){}
  async get(accountId:string,id:string) { if(!uuid.test(id))throw new ReportError('INVALID_INPUT');const report=await this.repo.definition(id); if(!report || !await this.sources.authorize(accountId,report.workspaceId))throw new ReportError('NOT_FOUND');return report; }
  async list(accountId:string,workspaceId:string,limit:number,offset:number){if(!uuid.test(workspaceId)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw new ReportError('INVALID_INPUT');if(!await this.sources.authorize(accountId,workspaceId))throw new ReportError('NOT_FOUND');return this.repo.list(workspaceId,limit,offset);}
  async create(accountId:string,input:ReportInput,key:string,correlationId:string){
    if(!uuid.test(input.workspaceId)||!key||key.length>128||!input.records?.length||input.records.length>100||input.records.some(record=>!uuid.test(record.id)||!isReportSource(record.source)||!['selected','before','after'].includes(record.section))||new Set(input.records.map(record=>record.section+':'+record.source+':'+record.id)).size!==input.records.length)throw new ReportError('INVALID_INPUT');
    if([input.projectName,input.objective,input.method,input.interpretation,input.improvements,input.limitations,input.conclusions,input.references,input.justification].some(value=>value!==undefined&&(typeof value!=='string'||value.length>5000)))throw new ReportError('INVALID_INPUT');
    if((input.includeComparison||input.records.some(record=>record.section!=='selected'))&&(!input.includeComparison||!input.justification?.trim()))throw new ReportError('INVALID_INPUT');
    if(!await this.sources.authorize(accountId,input.workspaceId))throw new ReportError('NOT_FOUND');
    // Creation proves all selected records belong to the authorized workspace. Later outages may make generation partial.
    const snapshot=await this.capture(accountId,input.workspaceId,input.records,correlationId,null);
    if(snapshot.missingSources.length)throw new ReportError('DEPENDENCY_UNAVAILABLE');
    if(snapshot.missingRecords.length)throw new ReportError('NOT_FOUND');
    return this.repo.create(accountId,input,key);
  }
  async generate(accountId:string,id:string,key:string,correlationId:string){
    if(!key||key.length>128)throw new ReportError('INVALID_INPUT');
    const report=await this.get(accountId,id),claim=await this.repo.claim(id,accountId,key);
    if(!('token'in claim))return claim;
    const snapshot=await this.capture(accountId,report.workspaceId,report.records,correlationId,report.snapshot);
    const status=snapshot.missingSources.length||snapshot.missingRecords.length?snapshot.records.length?'partial':'failed':'ready';
    return this.repo.finish(id,accountId,key,claim.token,status,snapshot,snapshot.missingSources.length?'DEPENDENCY_UNAVAILABLE':snapshot.missingRecords.length?'SOURCE_RECORD_MISSING':null);
  }
  async reconcile(){let count=0;for(const report of await this.repo.due()){try{if(!await this.sources.active(report.ownerId))continue;await this.generate(report.ownerId,report.id,'reconcile:'+report.id+':'+Date.now(),'reconcile:'+report.id);count++;}catch{/* A later bounded retry rechecks synchronous authorization. */}}return count;}
  private async capture(accountId:string,workspaceId:string,records:ReportSelection[],correlationId:string,previous:ReportSnapshot|null):Promise<ReportSnapshot>{
    const unique=[...new Map(records.map(record=>[record.source+':'+record.id,record])).values()];
    const learning=unique.filter(record=>!localSources.has(record.source)&&record.source!=='reservation'),community=unique.filter(record=>record.source==='reservation'),local=unique.filter(record=>localSources.has(record.source));
    const missingSources:string[]=[],missingRecords:Array<{source:string;id:string}>=[],items:ReportRecordSnapshot[]=[];
    const load=async(name:string,selected:ReportSelection[],work:()=>Promise<SourceRecords>)=>{if(!selected.length)return;try{const result=await work();items.push(...result.items);missingRecords.push(...result.missing);}catch{missingSources.push(name);for(const record of selected){const old=previous?.records.find(item=>item.source===record.source&&item.id===record.id);if(old)items.push(old);}}};
    await Promise.all([load('aprendizaje',learning,()=>this.sources.learning(accountId,workspaceId,learning,correlationId)),load('comunidad',community,()=>this.sources.community(accountId,workspaceId,community,correlationId)),load('evidencias',local,()=>this.repo.localSnapshots(workspaceId,local))]);
    // Evidence-owned execution references still require synchronous authorization from their owner service.
    const executionIds=[...new Set(items.filter(item=>localSources.has(item.source)).map(item=>item.data.executionId).filter((id):id is string=>typeof id==='string'))];
    if(executionIds.length){try{const authorized=await this.sources.learning(accountId,workspaceId,executionIds.map(id=>({source:'execution',id})),correlationId);if(authorized.missing.length){for(const entry of items.filter(item=>executionIds.includes(String(item.data.executionId))))missingRecords.push({source:entry.source,id:entry.id});for(let i=items.length-1;i>=0;i--)if(executionIds.includes(String(items[i].data.executionId)))items.splice(i,1);}}catch{if(!missingSources.includes('aprendizaje'))missingSources.push('aprendizaje');}}
    const snapshotRecords=records.flatMap(record=>{const item=items.find(item=>item.source===record.source&&item.id===record.id);return item?[{...item,section:record.section}]:[];});
    return {records:snapshotRecords,missingSources,missingRecords,capturedAt:new Date().toISOString()};
  }
}
