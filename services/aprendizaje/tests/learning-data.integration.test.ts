import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {LearningDataApplication} from '../src/aprendizaje/application/learning-data.js';
import {WorkApplication} from '../src/aprendizaje/application/workflows.js';
import {PostgresLearningDataRepository} from '../src/aprendizaje/infrastructure/postgres-learning-data.js';
import {PostgresWorkRepository} from '../src/aprendizaje/infrastructure/postgres-workflows.js';
import type {PersonaInput,ResultInput,ScenarioInput} from '../src/aprendizaje/domain/learning-data.js';
import {locales} from '../src/aprendizaje/domain/learning-data.js';

const enabled=process.env.TEST_POSTGRES==='1';
const suite=enabled?describe:describe.skip;
suite('learning activity data persistence (PostgreSQL)',()=>{
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST??'127.0.0.1',port:Number(process.env.POSTGRES_PORT??5432),
    database:process.env.APRENDIZAJE_DB,user:process.env.APRENDIZAJE_USER,password:process.env.APRENDIZAJE_PASSWORD,max:4});
  const accountId=randomUUID(),foreignId=randomUUID(),key=randomUUID();
  const work=new WorkApplication(new PostgresWorkRepository(pool),{membership:async()=>({active:false,role:null})});
  const data=new LearningDataApplication(new PostgresLearningDataRepository(pool));
  let workspaceId='';
  const executions:string[]=[];
  let conceptVersion='',fittsVersion='',hickVersion='';
  beforeAll(async()=>{
    workspaceId=((await work.createWorkspace(accountId,'Iteration 5 integration workspace',key) as {item:{id:string}}).item.id);
    const versions=await pool.query("SELECT a.codigo,v.actividad_version_id FROM learning.actividad a JOIN learning.actividad_version v ON v.actividad_id=a.actividad_id WHERE v.locale='es-CO' AND v.publicada_en IS NOT NULL AND a.codigo IN ('concept-practice','fitts','hick') ORDER BY a.codigo,v.numero_version DESC");
    for(const row of versions.rows){if(row.codigo==='concept-practice')conceptVersion=row.actividad_version_id;if(row.codigo==='fitts')fittsVersion=row.actividad_version_id;if(row.codigo==='hick')hickVersion=row.actividad_version_id;}
    expect(conceptVersion&&fittsVersion&&hickVersion).toBeTruthy();
  });
  afterAll(async()=>{
    await pool.query('DELETE FROM learning.write_idempotency WHERE account_id=$1',[accountId]);
    if(workspaceId){
      await pool.query('DELETE FROM learning.escenario WHERE espacio_id=$1',[workspaceId]);
      await pool.query('DELETE FROM learning.persona WHERE espacio_id=$1',[workspaceId]);
      await pool.query('DELETE FROM learning.ejecucion_actividad WHERE espacio_id=$1',[workspaceId]);
      await pool.query('DELETE FROM learning.espacio_trabajo WHERE espacio_id=$1',[workspaceId]);
    }
    await pool.end();
  });
  const persona:PersonaInput={name:'Fictional test persona',age:'58',context:'Synthetic context',goal:'Complete a task',barrier:'Limited time',device:'tablet',
    empathy:{says:'',thinks:'',does:'',feels:''},basis:'assumed',assumptions:'Synthetic only'};
  it('serves published activity and formula versions in all six frontend locales',async()=>{
    for(const locale of locales){
      const modules=await data.listModules(locale,100,0);
      expect(modules.some(item=>(item as {code:string}).code==='experiments')).toBe(true);
      const activities=await data.listActivities(locale,'experiments',100,0);
      expect(activities.some(item=>(item as {code:string;version_id:string}).code==='fitts'&&!!(item as {version_id:string}).version_id)).toBe(true);
    }
    const metrics=await data.listMetrics(fittsVersion) as {code:string;formula:string|null;formula_version:string|null}[];
    expect(metrics.find(item=>item.code==='index_difficulty')).toMatchObject({formula:'log2(D/W + 1)',formula_version:'HCI-LAB-IA-2.5.0'});
  });
  it('authorizes every workspace write and makes workspace/persona/scenario creation idempotent',async()=>{
    const replay=await work.createWorkspace(accountId,'Iteration 5 integration workspace',key);
    expect(replay).toMatchObject({replayed:true,item:{id:workspaceId}});
    await expect(work.createWorkspace(accountId,'Changed workspace payload',key)).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
    expect(await data.createPersona(foreignId,workspaceId,randomUUID(),persona)).toBeNull();
    const personaKey=randomUUID();
    const created=await data.createPersona(accountId,workspaceId,personaKey,persona);
    expect(created).toMatchObject({replayed:false,item:{workspace_id:workspaceId,name:persona.name,basis:'assumed'}});
    const id=(created!.item as {id:string}).id;
    expect(await data.listPersonas(accountId,workspaceId,25,0)).toEqual(expect.arrayContaining([expect.objectContaining({id,name:persona.name})]));
    expect(await data.listPersonas(foreignId,workspaceId,25,0)).toBeNull();
    expect(await data.createPersona(accountId,workspaceId,personaKey,persona)).toMatchObject({replayed:true,item:{id}});
    await expect(data.createPersona(accountId,workspaceId,personaKey,{...persona,name:'Changed payload'})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
    const scenario:ScenarioInput={title:'Synthetic task',actor:'Fictional actor',context:'Synthetic context',task:'Use a control',constraint:'Small screen',success:'Task completed',personaId:id,fictional:true};
    const scenarioKey=randomUUID();
    const createdScenario=await data.createScenario(accountId,workspaceId,scenarioKey,scenario);
    expect(createdScenario).toMatchObject({replayed:false,item:{workspace_id:workspaceId,fictional:true}});
    expect(await data.createScenario(accountId,workspaceId,scenarioKey,scenario)).toMatchObject({replayed:true});
    const foreignPersona=await data.createScenario(accountId,workspaceId,randomUUID(),{...scenario,personaId:randomUUID()});
    expect(foreignPersona).toBeNull();
    expect(await data.listScenarios(foreignId,workspaceId,25,0)).toBeNull();
  });
  async function execution(versionId:string,condition?:string){
    const result=await new PostgresWorkRepository(pool).createExecution(accountId,{workspaceId,activityVersionId:versionId,source:'measured',condition,idempotencyKey:randomUUID()});
    expect(result.item).toBeTruthy();
    const id=(result.item as {id:string}).id;executions.push(id);return id;
  }
  it('stores concept results and typed metric values atomically with ownership, concurrency and replay checks',async()=>{
    const id=await execution(conceptVersion);
    const key=randomUUID();
    const body:ResultInput={metrics:[{code:'duration_seconds',repetition:1,value:43.5}],concept:{code:'usability',outcome:'completed',text:'Synthetic reflection',emotionBefore:2,emotionAfter:4}};
    const first=await data.recordResults(accountId,id,1,key,body);
    expect(first).toMatchObject({replayed:false,item:{id,state:'completed',version:2}});
    expect(await data.recordResults(accountId,id,1,key,body)).toMatchObject({replayed:true,item:{id,state:'completed'}});
    await expect(data.recordResults(accountId,id,1,key,{...body,notes:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
    expect(await data.getResults(foreignId,id)).toBeNull();
    const stored=await data.getResults(accountId,id) as {execution:{activity_version_id:string};metrics:{code:string;value:number}[];concept:{code:string;emotion_after:number}};
    expect(stored.execution.activity_version_id).toBe(conceptVersion);
    expect(stored.metrics).toContainEqual(expect.objectContaining({code:'duration_seconds',value:43.5}));
    expect(stored.concept).toMatchObject({code:'usability',emotion_after:4});
    await expect(data.recordResults(accountId,id,1,randomUUID(),body)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  });
  it('stores eight Fitts and Hick measurements without fabricating unprovided dimensions',async()=>{
    const fittsId=await execution(fittsVersion,'pointer-target-selection');
    const fitts:ResultInput={metrics:[],trials:Array.from({length:8},(_,i)=>({number:i+1,seconds:0.5+i/10,errors:i===0?1:0,input:'pointer' as const,distance:120,indexDifficulty:3.2}))};
    await data.recordResults(accountId,fittsId,1,randomUUID(),fitts);
    const fittsStored=await data.getResults(accountId,fittsId) as {execution:{condition:string};trials:{phase:string;distance_px:number|null;target_size_px:number|null;option_count:number|null;index_difficulty:number|null}[];metrics:{code:string;value:number|string}[]};
    expect(fittsStored.execution.condition).toBe('pointer-target-selection');
    expect(fittsStored.trials).toHaveLength(8);
    expect(fittsStored.trials.every(row=>row.phase==='measurement'&&row.distance_px===null&&row.target_size_px===null&&row.option_count===null)).toBe(true);
    expect(fittsStored.metrics.some(item=>item.code==='distance_px'&&item.value===120)).toBe(true);
    expect(fittsStored.metrics.some(item=>item.code==='index_difficulty'&&item.value===3.2)).toBe(true);
    const hickId=await execution(hickVersion);
    const hick:ResultInput={metrics:[],trials:Array.from({length:8},(_,i)=>({number:i+1,seconds:1+i/10,errors:0,input:'keyboard' as const}))};
    await data.recordResults(accountId,hickId,1,randomUUID(),hick);
    const hickStored=await data.getResults(accountId,hickId) as {trials:{number:number;distance_px:number|null;option_count:number|null}[];metrics:{code:string;value:number}[]};
    expect(hickStored.trials).toHaveLength(8);
    expect(hickStored.trials.every(row=>row.distance_px===null&&row.option_count===null)).toBe(true);
    expect(hickStored.metrics.some(item=>item.code==='trial_seconds'&&item.value===1)).toBe(true);
  });
  it('denies writes to an archived workspace',async()=>{
    const id=await execution(conceptVersion);
    await pool.query('UPDATE learning.espacio_trabajo SET archivado_en=now() WHERE espacio_id=$1',[workspaceId]);
    try{
      expect(await work.updateExecution(accountId,id,1,'completed')).toBeNull();
      expect(await data.createScenario(accountId,workspaceId,randomUUID(),{title:'Blocked',actor:'Fictional',context:'context',task:'task',constraint:'constraint',success:'success'})).toBeNull();
    }finally{
      await pool.query('UPDATE learning.espacio_trabajo SET archivado_en=NULL WHERE espacio_id=$1',[workspaceId]);
    }
  });

});
