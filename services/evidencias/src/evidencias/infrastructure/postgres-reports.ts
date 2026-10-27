import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ReportRepository, SourceRecords } from '../application/reports.js';
import type { ReportInput } from '../application/use-cases.js';
import { ReportError, type ReportDefinition, type ReportSnapshot, type ReportStatus } from '../domain/reports.js';
import type { ReportSelection } from '../domain/evidence.js';
import { PostgresEvidenceRepository } from './postgres-evidence.js';
import type { EventEnvelope } from '../../infrastructure/events.js';

const columns:Record<string,string>={execution:'ejecucion_id',persona:'persona_id',scenario:'escenario_id',reservation:'reserva_id',finding:'hallazgo_id',evaluation_session:'sesion_evaluacion_id',ux_session:'sesion_ux_id',evidence:'evidencia_id',demo_user:'usuario_demo_id',multimodal_evidence:'evidencia_multimodal_id',lab_event:'evento_laboratorio_id',accessibility_check:'verificacion_accesibilidad_id'};
const summary=(report:ReportDefinition)=>({id:report.id,status:report.status,snapshotVersion:report.snapshotVersion,missingSources:report.missingSources,lastError:report.lastError,generatedAt:report.generatedAt});
export class PostgresReportRepository implements ReportRepository{
  constructor(private readonly pool:Pool){}
  async definition(id:string):Promise<ReportDefinition|null>{
    const result=await this.pool.query('SELECT * FROM evidence.informe WHERE informe_id=$1',[id]);if(!result.rowCount)return null;
    const row=result.rows[0],records=await this.pool.query('SELECT * FROM evidence.informe_registro WHERE informe_id=$1 ORDER BY orden',[id]);
    const selections=records.rows.map(record=>{const [source,column]=Object.entries(columns).find(([,column])=>record[column])!;return {source,id:record[column],section:record.seccion} as ReportSelection;});
    return {id:row.informe_id,ownerId:row.solicitado_por,workspaceId:row.espacio_id,projectName:row.nombre_proyecto,objective:row.objetivo,method:row.metodo,interpretation:row.interpretacion,improvements:row.mejoras,limitations:row.limites,conclusions:row.conclusiones,references:row.referencias,includeComparison:row.incluir_comparacion,justification:row.justificacion,format:row.formato,records:selections,status:row.generation_status,snapshotVersion:row.snapshot_version,snapshot:row.snapshot_data,missingSources:row.missing_sources,lastError:row.last_error,generatedAt:row.generated_at?.toISOString()??null,stale:row.snapshot_stale};
  }
  async list(workspaceId:string,limit:number,offset:number){const result=await this.pool.query('SELECT informe_id FROM evidence.informe WHERE espacio_id=$1 ORDER BY creado_en DESC,informe_id LIMIT $2 OFFSET $3',[workspaceId,limit,offset]);return (await Promise.all(result.rows.map(row=>this.definition(row.informe_id)))).filter((report):report is ReportDefinition=>report!==null);}
  create(accountId:string,input:ReportInput,key:string){return new PostgresEvidenceRepository(this.pool).createReport(accountId,input,key);}
  async localSnapshots(workspaceId:string,records:ReportSelection[]):Promise<SourceRecords>{
    const items:SourceRecords['items']=[],missing:SourceRecords['missing']=[];
    for(const record of records){
      let result;
      if(record.source==='ux_session')result=await this.pool.query('SELECT sesion_ux_id AS id,iniciada_en::text AS version,ejecucion_id AS "executionId",tipo_sesion AS type,ruta AS route,modo AS mode,origen_dato AS source,duracion_ms AS duration_ms,profundidad_maxima_pct AS max_depth_percent,cantidad_clics AS click_count,eventos_rueda AS wheel_count FROM evidence.sesion_ux WHERE sesion_ux_id=$1',[record.id]);
      else if(record.source==='evidence')result=await this.pool.query('SELECT evidencia_id AS id,creada_en::text AS version,ejecucion_id AS "executionId",nombre AS name,mime,bytes,sha256 FROM evidence.evidencia WHERE evidencia_id=$1 AND eliminada_en IS NULL',[record.id]);
      else if(record.source==='lab_event')result=await this.pool.query('SELECT evento_laboratorio_id AS id,ocurrido_en::text AS version,tipo AS type,ocurrido_en AS occurred_at,duracion_segundos AS duration_seconds,detalle AS detail FROM evidence.evento_laboratorio WHERE evento_laboratorio_id=$1 AND espacio_id=$2',[record.id,workspaceId]);
      else if(record.source==='accessibility_check')result=await this.pool.query('SELECT verificacion_accesibilidad_id AS id,verificada_en::text AS version,codigo AS code,superada AS passed,verificada_en AS checked_at FROM evidence.verificacion_accesibilidad WHERE verificacion_accesibilidad_id=$1 AND espacio_id=$2',[record.id,workspaceId]);
      if(!result?.rowCount)missing.push({source:record.source,id:record.id});else items.push({source:record.source,id:record.id,version:result.rows[0].version,data:result.rows[0]});
    }return {items,missing};
  }
  async claim(id:string,accountId:string,key:string):Promise<{token:string}|{item:unknown;replayed:boolean}>{
    const client=await this.pool.connect();try{await client.query('BEGIN');const report=await client.query('SELECT generation_status,lease_until FROM evidence.informe WHERE informe_id=$1 FOR UPDATE',[id]);if(!report.rowCount)throw new ReportError('NOT_FOUND');
      const prior=await client.query('SELECT response_data FROM evidence.report_generation_request WHERE report_id=$1 AND account_id=$2 AND idempotency_key=$3',[id,accountId,key]);if(prior.rows[0]?.response_data){await client.query('COMMIT');return {item:prior.rows[0].response_data,replayed:true};}
      if(report.rows[0].lease_until&&report.rows[0].lease_until>new Date()){await client.query('COMMIT');return {item:{id,status:'pending'},replayed:false};}
      const token=randomUUID();await client.query('INSERT INTO evidence.report_generation_request(report_id,account_id,idempotency_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,accountId,key]);
      await client.query("UPDATE evidence.informe SET generation_status='pending',lease_token=$2,lease_until=now()+interval '60 seconds',attempt_count=attempt_count+1 WHERE informe_id=$1",[id,token]);await client.query('COMMIT');return {token};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async finish(id:string,accountId:string,key:string,token:string,status:ReportStatus,snapshot:ReportSnapshot,lastError:string|null){
    const client=await this.pool.connect();try{await client.query('BEGIN');const result=await client.query("UPDATE evidence.informe SET generation_status=$3,snapshot_version=snapshot_version+1,snapshot_data=$4,missing_sources=$5,last_error=$6,generated_at=now(),snapshot_stale=($3<>'ready'),lease_token=NULL,lease_until=NULL,next_attempt_at=now()+(LEAST(3600,POWER(2,LEAST(attempt_count,12))) * interval '1 second') WHERE informe_id=$1 AND lease_token=$2 RETURNING snapshot_version,generated_at",[id,token,status,JSON.stringify(snapshot),JSON.stringify(snapshot.missingSources),lastError]);
      if(!result.rowCount){await client.query('COMMIT');return {item:{id,status:'pending'},replayed:false};}
      const version=result.rows[0].snapshot_version;
      await client.query('INSERT INTO evidence.report_snapshot(report_id,version,status,snapshot_data,missing_sources,correlation_id) VALUES($1,$2,$3,$4,$5,COALESCE(NULLIF(current_setting(\'app.correlation_id\',true),\'\'),$6))',[id,version,status,JSON.stringify(snapshot),JSON.stringify(snapshot.missingSources),'report:'+id]);
      const response={id,status,snapshotVersion:version,missingSources:snapshot.missingSources,lastError,generatedAt:result.rows[0].generated_at.toISOString()};
      await client.query('UPDATE evidence.report_generation_request SET response_data=$4,completed_at=now() WHERE report_id=$1 AND account_id=$2 AND idempotency_key=$3',[id,accountId,key,JSON.stringify(response)]);await client.query('COMMIT');return {item:response,replayed:false};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async due(){return (await this.pool.query("SELECT informe_id AS id,solicitado_por AS \"ownerId\" FROM evidence.informe WHERE generation_status IN ('pending','partial','failed') AND attempt_count<8 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at,informe_id LIMIT 10")).rows;}
}
export async function invalidateReportsFromEvent(client:PoolClient,event:EventEnvelope){
  const workspaceId=typeof event.payload.workspaceId==='string'?event.payload.workspaceId:null;
  const accountId=typeof event.payload.accountId==='string'?event.payload.accountId:null;
  const column=columns[event.aggregateType];
  if(column)await client.query(`UPDATE evidence.informe SET generation_status='pending',snapshot_stale=true,next_attempt_at=now(),attempt_count=0 WHERE informe_id IN(SELECT informe_id FROM evidence.informe_registro WHERE ${column}=$1)`,[event.aggregateId]);
  if(workspaceId)await client.query("UPDATE evidence.informe SET generation_status='pending',snapshot_stale=true,next_attempt_at=now(),attempt_count=0 WHERE espacio_id=$1",[workspaceId]);
  if(accountId)await client.query("UPDATE evidence.informe SET generation_status='pending',snapshot_stale=true,next_attempt_at=now(),attempt_count=0 WHERE solicitado_por=$1",[accountId]);
}
export const reportSummary=summary;
