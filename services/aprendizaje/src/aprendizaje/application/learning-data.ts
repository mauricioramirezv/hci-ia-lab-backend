import { isUuid, LearningDataError, normalizePersona, normalizeResults, normalizeScenario, type PersonaInput, type ResultInput, type ScenarioInput } from '../domain/learning-data.js';
export interface LearningDataRepository {
  listModules(locale:string,limit:number,offset:number):Promise<unknown[]>;
  listActivities(locale:string,moduleCode:string|undefined,limit:number,offset:number):Promise<unknown[]>;
  listMetrics(versionId:string):Promise<unknown[]|null>;
  listPersonas(accountId:string,workspaceId:string,limit:number,offset:number):Promise<unknown[]|null>;
  createPersona(accountId:string,workspaceId:string,key:string,input:PersonaInput):Promise<{item:unknown;replayed:boolean}|null>;
  listScenarios(accountId:string,workspaceId:string,limit:number,offset:number):Promise<unknown[]|null>;
  createScenario(accountId:string,workspaceId:string,key:string,input:ScenarioInput):Promise<{item:unknown;replayed:boolean}|null>;
  recordResults(accountId:string,executionId:string,version:number,key:string,input:ResultInput):Promise<{item:unknown;replayed:boolean}|null>;
  getResults(accountId:string,executionId:string):Promise<unknown|null>;
}
export class LearningDataApplication {
  constructor(private readonly repository:LearningDataRepository){}
  listModules(locale:string,limit:number,offset:number){if(!['es-CO','en-US','pt-BR','fr-FR','it-IT','ca-ES'].includes(locale))throw new LearningDataError('INVALID_INPUT');return this.repository.listModules(locale,Math.min(Math.max(limit,1),100),Math.max(offset,0));}
  listActivities(locale:string,moduleCode:string|undefined,limit:number,offset:number){if(!['es-CO','en-US','pt-BR','fr-FR','it-IT','ca-ES'].includes(locale)||(moduleCode!==undefined&&!/^[a-z0-9-]{1,80}$/.test(moduleCode)))throw new LearningDataError('INVALID_INPUT');return this.repository.listActivities(locale,moduleCode,Math.min(Math.max(limit,1),100),Math.max(offset,0));}
  listMetrics(versionId:string){if(!isUuid(versionId))throw new LearningDataError('INVALID_INPUT');return this.repository.listMetrics(versionId);}
  listPersonas(accountId:string,workspaceId:string,limit:number,offset:number){if(!isUuid(workspaceId))throw new LearningDataError('INVALID_INPUT');return this.repository.listPersonas(accountId,workspaceId,Math.min(Math.max(limit,1),100),Math.max(offset,0));}
  createPersona(accountId:string,workspaceId:string,key:string,input:PersonaInput){if(!isUuid(workspaceId)||!isUuid(key))throw new LearningDataError('INVALID_INPUT');return this.repository.createPersona(accountId,workspaceId,key,normalizePersona(input));}
  listScenarios(accountId:string,workspaceId:string,limit:number,offset:number){if(!isUuid(workspaceId))throw new LearningDataError('INVALID_INPUT');return this.repository.listScenarios(accountId,workspaceId,Math.min(Math.max(limit,1),100),Math.max(offset,0));}
  createScenario(accountId:string,workspaceId:string,key:string,input:ScenarioInput){if(!isUuid(workspaceId)||!isUuid(key))throw new LearningDataError('INVALID_INPUT');return this.repository.createScenario(accountId,workspaceId,key,normalizeScenario(input));}
  recordResults(accountId:string,id:string,version:number,key:string,input:ResultInput){if(!isUuid(id)||!isUuid(key)||!Number.isInteger(version)||version<1)throw new LearningDataError('INVALID_INPUT');return this.repository.recordResults(accountId,id,version,key,normalizeResults(input));}
  getResults(accountId:string,id:string){if(!isUuid(id))throw new LearningDataError('INVALID_INPUT');return this.repository.getResults(accountId,id);}
}
