import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from '../../config.js';
import type { SessionPort } from '../application/session.js';
import type { PersonaInput, ResultInput, ScenarioInput } from '../domain/learning-data.js';
import { IdempotencyKeyConflict, LearningDataError } from '../domain/learning-data.js';
import { LearningDataApplication } from '../application/learning-data.js';
import { PostgresLearningDataRepository } from '../infrastructure/postgres-learning-data.js';
import { account } from './work-routes.js';

const pagination = { type:'object', additionalProperties:false, properties:{
  limit:{type:'integer',minimum:1,maximum:100,default:25}, offset:{type:'integer',minimum:0,default:0},
} };
const uuidParam = (name:string) => ({type:'object',required:[name],additionalProperties:false,properties:{[name]:{type:'string',format:'uuid'}}});
const idempotencyHeader = {type:'object',required:['idempotency-key'],additionalProperties:true,properties:{
  'idempotency-key':{type:'string',format:'uuid'},
}};
const error = (reply:FastifyReply, code:string, status:number) => reply.code(status).send({code,requestId:reply.request.id});
function mapError(reply:FastifyReply, cause:unknown) {
  if (cause instanceof IdempotencyKeyConflict) return error(reply,cause.code,409);
  if (!(cause instanceof LearningDataError)) throw cause;
  const statuses = {INVALID_INPUT:400,NOT_FOUND:404,VERSION_CONFLICT:409,STATE_CONFLICT:409,IDEMPOTENCY_KEY_REUSED:409} as const;
  return error(reply,cause.code,statuses[cause.code]);
}
const metric = {type:'object',additionalProperties:false,required:['code','repetition','value'],properties:{
  code:{type:'string',pattern:'^[a-z][a-z0-9_]{0,79}$'}, repetition:{type:'integer',minimum:1,maximum:10000},
  value:{anyOf:[{type:'number'},{type:'string',maxLength:5000},{type:'boolean'}]},
}};
const concept = {type:'object',additionalProperties:false,required:['code','outcome'],properties:{
  code:{type:'string',enum:['ux','usability','accessibility','awareness','engagement','emotions','ergonomics','cognition','information','universal','responsibleAI']},
  outcome:{type:'string',enum:['completed','cancelled']},text:{type:'string',maxLength:5000},reason:{type:'string',maxLength:5000},
  edit:{type:'string',maxLength:5000},decision:{type:'string',maxLength:5000},
  emotionBefore:{type:'integer',minimum:1,maximum:5},emotionAfter:{type:'integer',minimum:1,maximum:5},
  confidenceBefore:{type:'integer',minimum:1,maximum:5},confidenceAfter:{type:'integer',minimum:1,maximum:5},
}};
const pattern = {type:'object',additionalProperties:false,required:['code','problem','principle','correction'],properties:{
  code:{type:'string',enum:['form','navigation','feedback','choice','content','privacy']},
  problem:{type:'string',minLength:1,maxLength:5000},principle:{type:'string',minLength:1,maxLength:5000},
  correction:{type:'string',minLength:1,maxLength:5000},
}};
const trial = {type:'object',additionalProperties:false,required:['number','seconds','errors','input'],properties:{
  number:{type:'integer',minimum:1,maximum:8},seconds:{type:'number',minimum:0},errors:{type:'integer',minimum:0},
  input:{type:'string',enum:['keyboard','pointer']},distance:{type:'number',minimum:0},indexDifficulty:{type:'number',minimum:0},
}};
const metricQuery = {type:'object',additionalProperties:false,properties:{
  locale:{type:'string',enum:['es-CO','en-US','pt-BR','fr-FR','it-IT','ca-ES'],default:'es-CO'},
  limit:{type:'integer',minimum:1,maximum:100,default:25},offset:{type:'integer',minimum:0,default:0},
}};
const personaSchema = {type:'object',additionalProperties:false,required:['name','age','context','goal','barrier','device','empathy'],properties:{
  name:{type:'string',minLength:1,maxLength:120},age:{type:'string',maxLength:80},context:{type:'string',minLength:1,maxLength:5000},
  goal:{type:'string',minLength:1,maxLength:2000},barrier:{type:'string',minLength:1,maxLength:2000},device:{type:'string',minLength:1,maxLength:500},
  empathy:{type:'object',additionalProperties:false,required:['says','thinks','does','feels'],properties:{
    says:{type:'string',maxLength:2000},thinks:{type:'string',maxLength:2000},does:{type:'string',maxLength:2000},feels:{type:'string',maxLength:2000}}},
  basis:{type:'string',enum:['observed','assumed','mixed']},observed:{type:'string',maxLength:5000},
  assumptions:{type:'string',maxLength:5000},emotionSource:{type:'string',enum:['observed','declared']},
}};
const scenarioSchema = {type:'object',additionalProperties:false,required:['title','actor','context','task','constraint','success'],properties:{
  title:{type:'string',minLength:1,maxLength:200},actor:{type:'string',minLength:1,maxLength:200},context:{type:'string',minLength:1,maxLength:5000},
  task:{type:'string',minLength:1,maxLength:2000},constraint:{type:'string',minLength:1,maxLength:2000},
  success:{type:'string',minLength:1,maxLength:2000},personaId:{type:'string',format:'uuid'},fictional:{type:'boolean'},
}};
const resultSchema = {type:'object',additionalProperties:false,required:['expectedVersion','metrics'],properties:{
  expectedVersion:{type:'integer',minimum:1},metrics:{type:'array',maxItems:200,items:metric},concept,pattern,
  trials:{type:'array',minItems:8,maxItems:8,items:trial},notes:{type:'string',maxLength:5000},
}};
const notFound = (reply:FastifyReply) => error(reply,'NOT_FOUND',404);
export async function registerLearningDataRoutes(app:FastifyInstance,pool:Pool,sessions:SessionPort,config:Config) {
  const data = new LearningDataApplication(new PostgresLearningDataRepository(pool));
  const originAllowed = (request:FastifyRequest) => !request.headers.origin || config.corsOrigins.includes(request.headers.origin);
  app.get<{Querystring:{locale?:string;limit?:number;offset?:number}}>('/v1/catalog/modules',{
    schema:{operationId:'listLearningModules',tags:['learning'],querystring:metricQuery},
  },async request=>{
    const {locale='es-CO',limit=25,offset=0}=request.query;
    return {items:await data.listModules(locale,limit,offset),locale,limit,offset};
  });
  app.get<{Querystring:{locale?:string;moduleCode?:string;limit?:number;offset?:number}}>('/v1/catalog/activities',{
    schema:{operationId:'listLearningActivities',tags:['learning'],querystring:{...metricQuery,properties:{...metricQuery.properties,moduleCode:{type:'string',pattern:'^[a-z0-9-]{1,80}$'}}}},
  },async request=>{
    const {locale='es-CO',moduleCode,limit=25,offset=0}=request.query;
    return {items:await data.listActivities(locale,moduleCode,limit,offset),locale,moduleCode:moduleCode??null,limit,offset};
  });
  app.get<{Params:{id:string}}>('/v1/catalog/activity-versions/:id/metrics',{
    schema:{operationId:'listActivityVersionMetrics',tags:['learning'],params:uuidParam('id')},
  },async(request,reply)=>{
    try{const items=await data.listMetrics(request.params.id);return items===null?notFound(reply):{items};}
    catch(cause){return mapError(reply,cause);}
  });
  app.get<{Params:{workspaceId:string};Querystring:{limit?:number;offset?:number}}>('/v1/workspaces/:workspaceId/personas',{
    schema:{operationId:'listWorkspacePersonas',tags:['learning'],security:[{sessionCookie:[]}],params:uuidParam('workspaceId'),querystring:pagination},
  },async(request,reply)=>{
    const actor=await account(request,reply,sessions);if(!actor)return;
    const {limit=25,offset=0}=request.query;
    try{const items=await data.listPersonas(actor.id,request.params.workspaceId,limit,offset);return items===null?notFound(reply):{items,limit,offset};}
    catch(cause){return mapError(reply,cause);}
  });
  app.post<{Params:{workspaceId:string}}>('/v1/workspaces/:workspaceId/personas',{
    schema:{operationId:'createWorkspacePersona',tags:['learning'],security:[{sessionCookie:[],csrfHeader:[]}],params:uuidParam('workspaceId'),
      headers:idempotencyHeader,body:personaSchema},
  },async(request,reply)=>{
    if(!originAllowed(request))return error(reply,'FORBIDDEN',403);
    const actor=await account(request,reply,sessions,true);if(!actor)return;
    const key=request.headers['idempotency-key'] as string;
    try{
      const result=await data.createPersona(actor.id,request.params.workspaceId,key,request.body as PersonaInput);
      if(!result)return notFound(reply);
      return reply.code(result.replayed?200:201).send({item:result.item,replayed:result.replayed});
    }catch(cause){return mapError(reply,cause);}
  });
  app.get<{Params:{workspaceId:string};Querystring:{limit?:number;offset?:number}}>('/v1/workspaces/:workspaceId/scenarios',{
    schema:{operationId:'listWorkspaceScenarios',tags:['learning'],security:[{sessionCookie:[]}],params:uuidParam('workspaceId'),querystring:pagination},
  },async(request,reply)=>{
    const actor=await account(request,reply,sessions);if(!actor)return;
    const {limit=25,offset=0}=request.query;
    try{const items=await data.listScenarios(actor.id,request.params.workspaceId,limit,offset);return items===null?notFound(reply):{items,limit,offset};}
    catch(cause){return mapError(reply,cause);}
  });
  app.post<{Params:{workspaceId:string}}>('/v1/workspaces/:workspaceId/scenarios',{
    schema:{operationId:'createWorkspaceScenario',tags:['learning'],security:[{sessionCookie:[],csrfHeader:[]}],params:uuidParam('workspaceId'),
      headers:idempotencyHeader,body:scenarioSchema},
  },async(request,reply)=>{
    if(!originAllowed(request))return error(reply,'FORBIDDEN',403);
    const actor=await account(request,reply,sessions,true);if(!actor)return;
    const key=request.headers['idempotency-key'] as string;
    try{
      const result=await data.createScenario(actor.id,request.params.workspaceId,key,request.body as ScenarioInput);
      if(!result)return notFound(reply);
      return reply.code(result.replayed?200:201).send({item:result.item,replayed:result.replayed});
    }catch(cause){return mapError(reply,cause);}
  });
  app.post<{Params:{id:string}}>('/v1/executions/:id/results',{
    schema:{operationId:'recordExecutionResults',tags:['learning'],security:[{sessionCookie:[],csrfHeader:[]}],params:uuidParam('id'),
      headers:idempotencyHeader,body:resultSchema},
  },async(request,reply)=>{
    if(!originAllowed(request))return error(reply,'FORBIDDEN',403);
    const actor=await account(request,reply,sessions,true);if(!actor)return;
    const body=request.body as ResultInput & {expectedVersion:number};
    const key=request.headers['idempotency-key'] as string;
    try{
      const result=await data.recordResults(actor.id,request.params.id,body.expectedVersion,key,body);
      if(!result)return notFound(reply);
      return reply.code(result.replayed?200:201).send({item:result.item,replayed:result.replayed});
    }catch(cause){return mapError(reply,cause);}
  });
  app.get<{Params:{id:string}}>('/v1/executions/:id/results',{
    schema:{operationId:'getExecutionResults',tags:['learning'],security:[{sessionCookie:[]}],params:uuidParam('id')},
  },async(request,reply)=>{
    const actor=await account(request,reply,sessions);if(!actor)return;
    try{const item=await data.getResults(actor.id,request.params.id);return item===null?notFound(reply):{item};}
    catch(cause){return mapError(reply,cause);}
  });
}
