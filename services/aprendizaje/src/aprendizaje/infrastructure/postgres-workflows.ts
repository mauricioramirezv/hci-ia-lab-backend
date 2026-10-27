import type { Pool } from 'pg';
import type { ExecutionInput, WorkRepository } from '../application/workflows.js';
import { claimWrite, completeWrite } from './write-idempotency.js';
export class PostgresWorkRepository implements WorkRepository {
  constructor(private readonly pool: Pool) {}
  async listActivities(locale: string, limit: number, offset: number) {
    const result = await this.pool.query(
      "SELECT m.codigo AS module_code,m.nombre AS module_name,a.actividad_id AS activity_id,a.codigo AS activity_code,a.tipo AS type,v.actividad_version_id AS activity_version_id,v.numero_version AS version,v.locale,v.titulo AS title,v.descripcion AS description,v.reglas AS rules FROM learning.modulo m JOIN learning.actividad a ON a.modulo_id=m.modulo_id JOIN learning.actividad_version v ON v.actividad_id=a.actividad_id WHERE a.activa=true AND v.publicada_en IS NOT NULL AND v.locale=$1 ORDER BY m.codigo,a.codigo,v.numero_version DESC LIMIT $2 OFFSET $3",
      [locale,limit,offset],
    );
    return result.rows;
  }  async createWorkspace(ownerId: string, name: string, idempotencyKey: string) {
    const client = await this.pool.connect();
    const operation = 'workspace.create';
    try {
      await client.query('BEGIN');
      const claim = await claimWrite(client, ownerId, operation, idempotencyKey, { name });
      if (claim.replayed) {
        const prior = await client.query('SELECT espacio_id AS id,nombre AS name,creado_en AS created_at,actualizado_en AS updated_at,archivado_en AS archived_at FROM learning.espacio_trabajo WHERE espacio_id=$1 AND propietario_id=$2', [claim.resourceId, ownerId]);
        if (!prior.rowCount) { await client.query('ROLLBACK'); return { item: null, replayed: true }; }
        await client.query('COMMIT');
        return { item: prior.rows[0], replayed: true };
      }
      const created = await client.query('INSERT INTO learning.espacio_trabajo(propietario_id,nombre) VALUES($1,$2) RETURNING espacio_id AS id,nombre AS name,creado_en AS created_at,actualizado_en AS updated_at,archivado_en AS archived_at', [ownerId,name]);
      await completeWrite(client, ownerId, operation, idempotencyKey, created.rows[0].id);
      await client.query('COMMIT');
      return { item: created.rows[0], replayed: false };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async listWorkspaces(ownerId: string, limit: number, offset: number) {
    const result = await this.pool.query(
      'SELECT espacio_id AS id,nombre,creado_en AS created_at,actualizado_en AS updated_at,archivado_en AS archived_at FROM learning.espacio_trabajo WHERE propietario_id=$1 AND archivado_en IS NULL ORDER BY actualizado_en DESC,espacio_id LIMIT $2 OFFSET $3',
      [ownerId, limit, offset],
    );
    return result.rows;
  }
  async createExecution(accountId: string, input: ExecutionInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query(
        'SELECT ejecucion_id AS id,espacio_id AS workspace_id,actividad_version_id AS activity_version_id,asignacion_id AS assignment_id,alias_participante AS participant_alias,condicion AS condition,prototipo AS prototype,origen_dato AS source,estado AS state,version_registro AS version,iniciada_en AS started_at FROM learning.ejecucion_actividad WHERE cuenta_id=$1 AND clave_idempotencia=$2 FOR SHARE',
        [accountId, input.idempotencyKey],
      );
      if (prior.rowCount) {
        const row = prior.rows[0];
        const matches = row.workspace_id === input.workspaceId && row.activity_version_id === input.activityVersionId && row.assignment_id === (input.assignmentId ?? null) && row.participant_alias === (input.alias ?? null) && row.prototype === (input.prototype ?? null) && row.condition === (input.condition ?? null) && row.source === input.source;
        await client.query('COMMIT');
        return { item: matches ? row : null, replayed: true };
      }      const workspace = await client.query(
        'SELECT espacio_id FROM learning.espacio_trabajo WHERE espacio_id=$1 AND propietario_id=$2 AND archivado_en IS NULL FOR SHARE',
        [input.workspaceId, accountId],
      );
      if (!workspace.rowCount) { await client.query('ROLLBACK'); return { item: null, replayed: false }; }
      if (input.assignmentId) {
        const assignment = await client.query("SELECT 1 FROM learning.asignacion_actividad WHERE asignacion_id=$1 AND actividad_version_id=$2 AND estado='published' AND (abre_en IS NULL OR abre_en<=now()) AND (vence_en IS NULL OR vence_en>=now())", [input.assignmentId, input.activityVersionId]);
        if (!assignment.rowCount) { await client.query('ROLLBACK'); return { item: null, replayed: false }; }
      }
      const activity = await client.query(
        'SELECT actividad_version_id FROM learning.actividad_version WHERE actividad_version_id=$1 AND publicada_en IS NOT NULL',
        [input.activityVersionId],
      );
      if (!activity.rowCount) { await client.query('ROLLBACK'); return { item: null, replayed: false }; }
      const inserted = await client.query(
        'INSERT INTO learning.ejecucion_actividad(espacio_id,cuenta_id,actividad_version_id,asignacion_id,alias_participante,condicion,origen_dato,prototipo,clave_idempotencia) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(cuenta_id,clave_idempotencia) DO NOTHING RETURNING ejecucion_id AS id,espacio_id AS workspace_id,actividad_version_id AS activity_version_id,asignacion_id AS assignment_id,alias_participante AS participant_alias,condicion AS condition,prototipo AS prototype,origen_dato AS source,estado AS state,version_registro AS version,iniciada_en AS started_at',
        [input.workspaceId, accountId, input.activityVersionId, input.assignmentId ?? null, input.alias ?? null, input.condition ?? null, input.source, input.prototype ?? null, input.idempotencyKey],
      );
      if (inserted.rowCount) { await client.query('COMMIT'); return { item: inserted.rows[0], replayed: false }; }
      const existing = await client.query(
        'SELECT ejecucion_id AS id,espacio_id AS workspace_id,actividad_version_id AS activity_version_id,asignacion_id AS assignment_id,alias_participante AS participant_alias,condicion AS condition,prototipo AS prototype,origen_dato AS source,estado AS state,version_registro AS version,iniciada_en AS started_at FROM learning.ejecucion_actividad WHERE cuenta_id=$1 AND clave_idempotencia=$2',
        [accountId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      await client.query('COMMIT');
      const matches = row && row.workspace_id === input.workspaceId && row.activity_version_id === input.activityVersionId && row.assignment_id === (input.assignmentId ?? null) && row.participant_alias === (input.alias ?? null) && row.prototype === (input.prototype ?? null) && row.condition === (input.condition ?? null) && row.source === input.source;
      return { item: matches ? row : null, replayed: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async listExecutions(accountId: string, limit: number, offset: number) {
    const result = await this.pool.query(
      'SELECT ejecucion_id AS id,espacio_id AS workspace_id,actividad_version_id AS activity_version_id,asignacion_id AS assignment_id,condicion AS condition,origen_dato AS source,estado AS state, iniciada_en AS started_at,finalizada_en AS completed_at,version_registro AS version FROM learning.ejecucion_actividad WHERE cuenta_id=$1 ORDER BY iniciada_en DESC,ejecucion_id LIMIT $2 OFFSET $3',
      [accountId, limit, offset],
    );
    return result.rows;
  }
  async updateExecution(accountId: string, id: string, version: number, state: 'in_progress' | 'completed' | 'cancelled', notes?: string) {
    const result = await this.pool.query(
      "UPDATE learning.ejecucion_actividad AS x SET estado=$4,notas=COALESCE($5,x.notas),finalizada_en=CASE WHEN $4='in_progress' THEN NULL ELSE now() END,version_registro=x.version_registro+1 WHERE x.ejecucion_id=$1 AND x.cuenta_id=$2 AND x.version_registro=$3 AND x.estado='in_progress' AND EXISTS(SELECT 1 FROM learning.espacio_trabajo w WHERE w.espacio_id=x.espacio_id AND w.propietario_id=$2 AND w.archivado_en IS NULL) RETURNING x.ejecucion_id AS id,x.estado AS state,x.version_registro AS version,x.finalizada_en AS completed_at",
      [id, accountId, version, state, notes ?? null],
    );
    return result.rows[0] ?? null;
  }
  async createDelivery(accountId: string, executionId: string, idempotencyKey: string, comment?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const execution = await client.query("SELECT x.ejecucion_id FROM learning.ejecucion_actividad x JOIN learning.espacio_trabajo w ON w.espacio_id=x.espacio_id WHERE x.ejecucion_id=$1 AND x.cuenta_id=$2 AND x.estado='completed' AND w.propietario_id=$2 AND w.archivado_en IS NULL FOR UPDATE OF x,w", [executionId, accountId]);
      if (!execution.rowCount) { await client.query('ROLLBACK'); return null; }
      const previous = await client.query('SELECT entrega_id AS id,ejecucion_id AS execution_id,numero_version AS version,estado AS state,enviada_en AS submitted_at,comentario_estudiante AS comment FROM learning.entrega WHERE ejecucion_id=$1 AND clave_idempotencia=$2', [executionId,idempotencyKey]);
      if (previous.rowCount) {
        const item = previous.rows[0], matches = item.comment === (comment ?? null);
        await client.query('COMMIT'); return { item: matches ? item : null, replayed: true };
      }
      const sequence = await client.query('SELECT COALESCE(MAX(numero_version),0)+1 AS next_version FROM learning.entrega WHERE ejecucion_id=$1', [executionId]);
      const created = await client.query("INSERT INTO learning.entrega(ejecucion_id,numero_version,estado,comentario_estudiante,clave_idempotencia) VALUES($1,$2,'submitted',$3,$4) RETURNING entrega_id AS id,ejecucion_id AS execution_id,numero_version AS version,estado AS state,enviada_en AS submitted_at,comentario_estudiante AS comment", [executionId,sequence.rows[0].next_version,comment ?? null,idempotencyKey]);
      await client.query('COMMIT'); return { item: created.rows[0], replayed: false };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }  async addOwnerFeedback(accountId: string, deliveryId: string, message: string, kind: 'comment' | 'response') {
    const result = await this.pool.query(
      'INSERT INTO learning.retroalimentacion(entrega_id,autor_id,mensaje,tipo) SELECT d.entrega_id,$2,$3,$4 FROM learning.entrega d JOIN learning.ejecucion_actividad x ON x.ejecucion_id=d.ejecucion_id JOIN learning.espacio_trabajo w ON w.espacio_id=x.espacio_id WHERE d.entrega_id=$1 AND x.cuenta_id=$2 AND w.propietario_id=$2 AND w.archivado_en IS NULL RETURNING retroalimentacion_id AS id,entrega_id AS delivery_id,mensaje AS message,tipo AS kind,creada_en AS created_at',
      [deliveryId, accountId, message, kind],
    );
    return result.rows[0] ?? null;
  }
  async assignmentGroup(assignmentId: string) {
    const result = await this.pool.query('SELECT grupo_id AS id FROM learning.asignacion_actividad WHERE asignacion_id=$1', [assignmentId]);
    return result.rows[0]?.id ?? null;
  }
  async createAssignment(groupId: string, accountId: string, input: { activityVersionId: string; title: string; instructions: string; opensAt?: Date; dueAt?: Date; criteria?: { code: string; name: string; description?: string; maxScore?: number; order: number }[] }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        "INSERT INTO learning.asignacion_actividad(grupo_id,actividad_version_id,creada_por,titulo,instrucciones,abre_en,vence_en,estado) SELECT $1,$2,$3,$4,$5,$6,$7,'published' WHERE EXISTS(SELECT 1 FROM learning.actividad_version WHERE actividad_version_id=$2 AND publicada_en IS NOT NULL) RETURNING asignacion_id AS id,grupo_id AS group_id,actividad_version_id AS activity_version_id,titulo AS title,instrucciones AS instructions,abre_en AS opens_at,vence_en AS due_at,estado AS state,creada_en AS created_at",
        [groupId,input.activityVersionId,accountId,input.title,input.instructions,input.opensAt ?? null,input.dueAt ?? null],
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return null; }
      for (const criterion of input.criteria ?? []) {
        await client.query('INSERT INTO learning.criterio_asignacion(asignacion_id,codigo,nombre,descripcion,puntaje_maximo,orden) VALUES($1,$2,$3,$4,$5,$6)', [result.rows[0].id,criterion.code.trim(),criterion.name.trim(),criterion.description?.trim() ?? null,criterion.maxScore ?? null,criterion.order]);
      }
      await client.query('COMMIT');
      return { ...result.rows[0], criteria: input.criteria ?? [] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }  async listAssignments(groupId: string) {
    const result = await this.pool.query("SELECT a.asignacion_id AS id,a.grupo_id AS group_id,a.actividad_version_id AS activity_version_id,a.titulo AS title,a.instrucciones AS instructions,a.abre_en AS opens_at,a.vence_en AS due_at,a.estado AS state,a.creada_en AS created_at,COALESCE((SELECT json_agg(json_build_object('id',c.criterio_id,'code',c.codigo,'name',c.nombre,'description',c.descripcion,'maxScore',c.puntaje_maximo,'order',c.orden) ORDER BY c.orden) FROM learning.criterio_asignacion c WHERE c.asignacion_id=a.asignacion_id),'[]'::json) AS criteria FROM learning.asignacion_actividad a WHERE a.grupo_id=$1 AND a.estado IN ('published','closed') ORDER BY a.creada_en DESC,a.asignacion_id", [groupId]);
    return result.rows;
  }
  async executionGroup(executionId: string) {
    const result = await this.pool.query('SELECT a.grupo_id AS id FROM learning.ejecucion_actividad x JOIN learning.asignacion_actividad a ON a.asignacion_id=x.asignacion_id WHERE x.ejecucion_id=$1', [executionId]);
    return result.rows[0]?.id ?? null;
  }
  async listDeliveryVersions(accountId: string, executionId: string, limit: number, offset: number) {
    const owned = await this.pool.query('SELECT x.ejecucion_id FROM learning.ejecucion_actividad x JOIN learning.espacio_trabajo w ON w.espacio_id=x.espacio_id WHERE x.ejecucion_id=$1 AND x.cuenta_id=$2 AND w.propietario_id=$2 AND w.archivado_en IS NULL', [executionId, accountId]);
    if (!owned.rowCount) return null;
    const result = await this.pool.query("SELECT d.entrega_id AS id,d.ejecucion_id AS execution_id,d.numero_version AS version,d.estado AS state,d.comentario_estudiante AS comment,d.enviada_en AS submitted_at,COALESCE((SELECT json_agg(json_build_object('id',v.valoracion_id,'criterionId',v.criterio_id,'evaluatorId',v.evaluada_por,'score',v.puntaje,'comment',v.comentario,'evaluatedAt',v.evaluada_en) ORDER BY v.evaluada_en,v.valoracion_id) FROM learning.valoracion v WHERE v.entrega_id=d.entrega_id),'[]'::json) AS evaluations,COALESCE((SELECT json_agg(json_build_object('id',f.retroalimentacion_id,'authorId',f.autor_id,'replyToId',f.respuesta_a,'message',f.mensaje,'kind',f.tipo,'createdAt',f.creada_en) ORDER BY f.creada_en,f.retroalimentacion_id) FROM learning.retroalimentacion f WHERE f.entrega_id=d.entrega_id),'[]'::json) AS feedback FROM learning.entrega d WHERE d.ejecucion_id=$1 ORDER BY d.numero_version DESC LIMIT $2 OFFSET $3", [executionId, limit, offset]);
    return result.rows;
  }
  async listGroupDeliveryVersions(groupId: string, limit: number, offset: number) {
    const result = await this.pool.query("SELECT d.entrega_id AS id,d.ejecucion_id AS execution_id,d.numero_version AS version,d.estado AS state,d.comentario_estudiante AS comment,d.enviada_en AS submitted_at,x.cuenta_id AS participant_id,a.asignacion_id AS assignment_id,COALESCE((SELECT json_agg(json_build_object('id',v.valoracion_id,'criterionId',v.criterio_id,'evaluatorId',v.evaluada_por,'score',v.puntaje,'comment',v.comentario,'evaluatedAt',v.evaluada_en) ORDER BY v.evaluada_en,v.valoracion_id) FROM learning.valoracion v WHERE v.entrega_id=d.entrega_id),'[]'::json) AS evaluations,COALESCE((SELECT json_agg(json_build_object('id',f.retroalimentacion_id,'authorId',f.autor_id,'replyToId',f.respuesta_a,'message',f.mensaje,'kind',f.tipo,'createdAt',f.creada_en) ORDER BY f.creada_en,f.retroalimentacion_id) FROM learning.retroalimentacion f WHERE f.entrega_id=d.entrega_id),'[]'::json) AS feedback FROM learning.entrega d JOIN learning.ejecucion_actividad x ON x.ejecucion_id=d.ejecucion_id JOIN learning.asignacion_actividad a ON a.asignacion_id=x.asignacion_id WHERE a.grupo_id=$1 ORDER BY d.enviada_en DESC,d.ejecucion_id,d.numero_version DESC LIMIT $2 OFFSET $3", [groupId, limit, offset]);
    return result.rows;
  }
  async deliveryGroup(deliveryId: string) {
    const result = await this.pool.query('SELECT a.grupo_id AS "groupId",x.cuenta_id AS "ownerId",d.estado AS state FROM learning.entrega d JOIN learning.ejecucion_actividad x ON x.ejecucion_id=d.ejecucion_id LEFT JOIN learning.asignacion_actividad a ON a.asignacion_id=x.asignacion_id WHERE d.entrega_id=$1', [deliveryId]);
    return result.rows[0] ?? null;
  }
  async evaluateDelivery(accountId: string, deliveryId: string, criterionId: string, score?: number, comment?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const eligible = await client.query(
        "SELECT c.puntaje_maximo FROM learning.entrega d JOIN learning.ejecucion_actividad x ON x.ejecucion_id=d.ejecucion_id JOIN learning.asignacion_actividad a ON a.asignacion_id=x.asignacion_id JOIN learning.criterio_asignacion c ON c.asignacion_id=a.asignacion_id AND c.criterio_id=$2 WHERE d.entrega_id=$1 AND d.estado IN ('submitted','revision','changes_requested','accepted') FOR UPDATE OF d",
        [deliveryId,criterionId],
      );
      if (!eligible.rowCount || (score !== undefined && eligible.rows[0].puntaje_maximo !== null && score > Number(eligible.rows[0].puntaje_maximo))) { await client.query('ROLLBACK'); return null; }
      const result = await client.query(
        'INSERT INTO learning.valoracion(entrega_id,criterio_id,evaluada_por,puntaje,comentario) VALUES($1,$2,$3,$4,$5) ON CONFLICT(entrega_id,criterio_id,evaluada_por) DO NOTHING RETURNING valoracion_id AS id,entrega_id AS delivery_id,criterio_id AS criterion_id,puntaje AS score,comentario AS comment,evaluada_en AS evaluated_at',
        [deliveryId,criterionId,accountId,score ?? null,comment ?? null],
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return null; }
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }  async reviewDelivery(accountId: string, deliveryId: string, expectedState: string, state: 'changes_requested' | 'accepted', message: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT estado FROM learning.entrega WHERE entrega_id=$1 FOR UPDATE', [deliveryId]);
      if (!current.rowCount || current.rows[0].estado !== expectedState) { await client.query('ROLLBACK'); return null; }
      const updated = await client.query('UPDATE learning.entrega SET estado=$2 WHERE entrega_id=$1 AND estado=$3 RETURNING entrega_id AS id,estado AS state,numero_version AS version', [deliveryId,state,expectedState]);
      if (!updated.rowCount) { await client.query('ROLLBACK'); return null; }
      await client.query('INSERT INTO learning.retroalimentacion(entrega_id,autor_id,mensaje,tipo) VALUES($1,$2,$3,$4)', [deliveryId,accountId,message,state==='changes_requested'?'request_changes':'comment']);
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}









