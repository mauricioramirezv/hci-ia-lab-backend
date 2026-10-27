import type {FastifyInstance} from 'fastify';
import type {HealthPort} from '../application/health.js';
export async function registerHealthRoutes(app:FastifyInstance,health:HealthPort):Promise<void>{
 app.get('/health/live',{schema:{operationId:'getLiveness',tags:['health'],response:{200:{$ref:'Liveness#'},404:{$ref:'Error#'},405:{$ref:'Error#'}}}},async()=>({status:'ok',service:'identidad'}));
 app.get('/health/ready',{schema:{operationId:'getReadiness',tags:['health'],response:{200:{$ref:'Readiness#'},404:{$ref:'Error#'},405:{$ref:'Error#'},503:{$ref:'Error#'}}}},async(request,reply)=>{if(!await health.check())return reply.code(503).send({code:'DEPENDENCY_UNAVAILABLE',requestId:request.id});return {status:'ok',service:'identidad',dependencies:{postgres:'ok'}};});
}
