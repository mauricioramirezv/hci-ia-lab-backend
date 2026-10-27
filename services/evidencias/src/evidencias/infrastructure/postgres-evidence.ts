import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { EvidenceRepository, ReportInput, UxSessionInput } from '../application/use-cases.js';
import type { ReportSelection, UxEvent, ConsentPurpose, CalibrationInput, EvidenceMetadataInput, AccessibilityCode, ReportSource } from '../domain/evidence.js';

const reportColumn: Record<ReportSource, string> = {
  execution: 'ejecucion_id', persona: 'persona_id', scenario: 'escenario_id', reservation: 'reserva_id', finding: 'hallazgo_id',
  evaluation_session: 'sesion_evaluacion_id', ux_session: 'sesion_ux_id', evidence: 'evidencia_id', demo_user: 'usuario_demo_id',
  multimodal_evidence: 'evidencia_multimodal_id', lab_event: 'evento_laboratorio_id', accessibility_check: 'verificacion_accesibilidad_id',
};
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
type IdempotentResult<T> = { value: T; replayed: boolean };
async function idempotent<T>(pool: Pool, actor: string, operation: string, key: string, input: unknown, work: (client: PoolClient) => Promise<T>): Promise<IdempotentResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestHash = hash(input);
    const claim = await client.query('INSERT INTO evidence.write_idempotency(actor_id,operation,idempotency_key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,operation,idempotency_key) DO NOTHING RETURNING idempotency_key', [actor, operation, key, requestHash]);
    if (!claim.rowCount) {
      const prior = await client.query('SELECT request_hash,response_data FROM evidence.write_idempotency WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3 FOR UPDATE', [actor, operation, key]);
      if (!prior.rowCount || prior.rows[0].request_hash !== requestHash) throw Object.assign(new Error('IDEMPOTENCY_KEY_REUSED'), { code: 'IDEMPOTENCY_KEY_REUSED' });
      await client.query('COMMIT');
      return { value: prior.rows[0].response_data as T, replayed: true };
    }
    const value = await work(client);
    await client.query('UPDATE evidence.write_idempotency SET response_data=$4 WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3', [actor, operation, key, JSON.stringify(value)]);
    await client.query('COMMIT');
    return { value, replayed: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export class PostgresEvidenceRepository implements EvidenceRepository {
  constructor(private readonly pool: Pool) {}
  async createUxSession(accountId: string, input: UxSessionInput, key: string) {
    const result = await idempotent(this.pool, accountId, 'ux.session.create', key, input, async client => {
      const created = await client.query(
        'INSERT INTO evidence.sesion_ux(ejecucion_id,cuenta_id,tipo_sesion,ruta,participante_alias,tarea,prototipo,objetivo,notas,modo,origen_dato,ancho_documento,alto_documento,ancho_ventana,alto_ventana,duracion_ms,profundidad_maxima_pct,cantidad_clics,eventos_rueda) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING sesion_ux_id AS id,ejecucion_id AS execution_id,tipo_sesion AS type,ruta AS route,modo AS mode,origen_dato AS source,duracion_ms AS duration_ms,profundidad_maxima_pct AS max_depth_percent,iniciada_en AS started_at',
        [input.executionId,accountId,input.type,input.route,input.alias ?? null,input.task ?? null,input.prototype ?? null,input.objective ?? null,input.notes ?? null,input.mode,input.source,input.documentWidth,input.documentHeight,input.viewportWidth,input.viewportHeight,input.durationMs,input.maxDepthPercent,input.clickCount ?? 0,input.wheelCount ?? 0],
      );
      await client.query('INSERT INTO evidence.consentimiento(sesion_ux_id,proposito,version_aviso,otorgado) VALUES($1,$2,$3,true)', [created.rows[0].id,input.consent.purpose,input.consent.noticeVersion]);
      for (const exposure of input.exposures ?? []) await client.query('INSERT INTO evidence.sesion_ux_exposicion(sesion_ux_id,banda,segundos) VALUES($1,$2,$3)', [created.rows[0].id,exposure.band,exposure.seconds]);
      return created.rows[0];
    });
    return { item: result.value, replayed: result.replayed };
  }
  async getUxSession(accountId: string, id: string) {
    const result = await this.pool.query("SELECT s.sesion_ux_id AS id,s.ejecucion_id AS execution_id,s.tipo_sesion AS type,s.ruta AS route,s.modo AS mode,s.origen_dato AS source,s.duracion_ms AS duration_ms,s.profundidad_maxima_pct AS max_depth_percent,s.cantidad_clics AS click_count,s.eventos_rueda AS wheel_count,s.iniciada_en AS started_at,COALESCE((SELECT json_agg(c.proposito ORDER BY c.proposito) FROM evidence.consentimiento c WHERE c.sesion_ux_id=s.sesion_ux_id AND c.otorgado=true AND c.revocado_en IS NULL),'[]'::json) AS active_consents,COALESCE((SELECT json_agg(json_build_object('band',e.banda,'seconds',e.segundos) ORDER BY e.banda) FROM evidence.sesion_ux_exposicion e WHERE e.sesion_ux_id=s.sesion_ux_id),'[]'::json) AS exposures FROM evidence.sesion_ux s WHERE s.sesion_ux_id=$1 AND s.cuenta_id=$2", [id, accountId]);
    return result.rows[0] ?? null;
  }
  async listConsents(accountId: string, id: string) {
    const owned = await this.pool.query('SELECT 1 FROM evidence.sesion_ux WHERE sesion_ux_id=$1 AND cuenta_id=$2', [id, accountId]);
    if (!owned.rowCount) return null;
    const result = await this.pool.query('SELECT consentimiento_id AS id,proposito AS purpose,version_aviso AS notice_version,otorgado AS granted,registrado_en AS recorded_at,revocado_en AS revoked_at FROM evidence.consentimiento WHERE sesion_ux_id=$1 ORDER BY registrado_en,consentimiento_id', [id]);
    return result.rows;
  }
  async setConsent(accountId: string, id: string, purpose: ConsentPurpose, noticeVersion: string, granted: boolean, key: string) {
    const result = await idempotent(this.pool, accountId, 'consent.set', key, { id, purpose, noticeVersion, granted }, async client => {
      const owner = await client.query('SELECT sesion_ux_id FROM evidence.sesion_ux WHERE sesion_ux_id=$1 AND cuenta_id=$2 FOR UPDATE', [id, accountId]);
      if (!owner.rowCount) return null;
      await client.query('UPDATE evidence.consentimiento SET revocado_en=COALESCE(revocado_en,now()) WHERE sesion_ux_id=$1 AND proposito=$2 AND otorgado=true AND revocado_en IS NULL', [id, purpose]);
      const saved = await client.query('INSERT INTO evidence.consentimiento(sesion_ux_id,proposito,version_aviso,otorgado) VALUES($1,$2,$3,$4) RETURNING consentimiento_id AS id,proposito AS purpose,version_aviso AS notice_version,otorgado AS granted,registrado_en AS recorded_at,revocado_en AS revoked_at', [id, purpose, noticeVersion, granted]);
      return saved.rows[0];
    });
    return result.value === null ? null : { item: result.value, replayed: result.replayed };
  }
  async revokeConsent(accountId: string, id: string, purpose?: ConsentPurpose) {
    const result = await this.pool.query('UPDATE evidence.consentimiento c SET revocado_en=COALESCE(c.revocado_en,now()) FROM evidence.sesion_ux s WHERE c.sesion_ux_id=s.sesion_ux_id AND s.sesion_ux_id=$1 AND s.cuenta_id=$2 AND c.otorgado=true AND c.revocado_en IS NULL AND ($3::text IS NULL OR c.proposito=$3) RETURNING c.consentimiento_id', [id, accountId, purpose ?? null]);
    if (result.rowCount) return true;
    const owned = await this.pool.query('SELECT 1 FROM evidence.sesion_ux WHERE sesion_ux_id=$1 AND cuenta_id=$2', [id, accountId]);
    return !!owned.rowCount;
  }
  async recordUxEvents(accountId: string, id: string, events: UxEvent[], key: string) {
    const result = await idempotent(this.pool, accountId, 'ux.events', key, { id, events }, async client => {
      const authorized = await client.query("SELECT 1 FROM evidence.sesion_ux s WHERE s.sesion_ux_id=$1 AND s.cuenta_id=$2 AND EXISTS(SELECT 1 FROM evidence.consentimiento c WHERE c.sesion_ux_id=s.sesion_ux_id AND c.proposito='detailed_telemetry' AND c.otorgado=true AND c.revocado_en IS NULL) FOR UPDATE", [id, accountId]);
      if (!authorized.rowCount) return null;
      for (const event of events) await client.query('INSERT INTO evidence.evento_ux(sesion_ux_id,canal,ocurrido_ms,x,y,peso,area,ruta,scroll_top_px,profundidad_pct,direccion,modo,origen_dato) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [id,event.channel,event.atMs,event.x ?? null,event.y ?? null,event.weight ?? null,event.area ?? null,event.route ?? null,event.scrollTopPx ?? null,event.depthPercent ?? null,event.direction ?? null,event.mode ?? null,event.source]);
      return { accepted: events.length };
    });
    return result.value === null ? null : { ...result.value, replayed: result.replayed };
  }
  async listUxEvents(accountId: string, id: string, limit: number, offset: number) {
    const owned = await this.pool.query('SELECT 1 FROM evidence.sesion_ux WHERE sesion_ux_id=$1 AND cuenta_id=$2', [id, accountId]);
    if (!owned.rowCount) return null;
    const [items,count] = await Promise.all([
      this.pool.query('SELECT evento_ux_id AS id,canal AS channel,ocurrido_ms AS at_ms,x,y,peso AS weight,area,ruta AS route,scroll_top_px,profundidad_pct AS depth_percent,direccion AS direction,modo AS mode,origen_dato AS source FROM evidence.evento_ux WHERE sesion_ux_id=$1 ORDER BY ocurrido_ms,evento_ux_id LIMIT $2 OFFSET $3', [id,limit,offset]),
      this.pool.query('SELECT count(*)::int AS total FROM evidence.evento_ux WHERE sesion_ux_id=$1', [id]),
    ]);
    return { items: items.rows, total: count.rows[0].total };
  }
  async saveCalibration(accountId: string, id: string, input: CalibrationInput, key: string) {
    const result = await idempotent(this.pool, accountId, 'ux.calibration', key, { id, input }, async client => {
      const authorized = await client.query("SELECT 1 FROM evidence.sesion_ux s WHERE s.sesion_ux_id=$1 AND s.cuenta_id=$2 AND EXISTS(SELECT 1 FROM evidence.consentimiento c WHERE c.sesion_ux_id=s.sesion_ux_id AND c.proposito='calibration' AND c.otorgado=true AND c.revocado_en IS NULL) FOR UPDATE", [id, accountId]);
      if (!authorized.rowCount) return null;
      const saved = await client.query('INSERT INTO evidence.validacion_calibracion(sesion_ux_id,error_mediano_px,ancho_ventana,alto_ventana,cantidad_muestras,validada_en) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sesion_ux_id) DO UPDATE SET error_mediano_px=EXCLUDED.error_mediano_px,ancho_ventana=EXCLUDED.ancho_ventana,alto_ventana=EXCLUDED.alto_ventana,cantidad_muestras=EXCLUDED.cantidad_muestras,validada_en=EXCLUDED.validada_en RETURNING error_mediano_px AS median_error_px,ancho_ventana AS viewport_width,alto_ventana AS viewport_height,cantidad_muestras AS sample_count,validada_en AS validated_at', [id,input.medianErrorPx,input.viewportWidth,input.viewportHeight,input.sampleCount,input.validatedAt]);
      return saved.rows[0];
    });
    return result.value === null ? null : { calibration: result.value, replayed: result.replayed };
  }
  async saveAccessibilityCheck(accountId: string, workspaceId: string, code: AccessibilityCode, passed: boolean, key: string) {
    const result = await idempotent(this.pool, accountId, 'accessibility.check', key, { workspaceId, code, passed }, async client => {
      const saved = await client.query('INSERT INTO evidence.verificacion_accesibilidad(espacio_id,cuenta_id,codigo,superada) VALUES($1,$2,$3,$4) ON CONFLICT(espacio_id,codigo) DO UPDATE SET cuenta_id=EXCLUDED.cuenta_id,superada=EXCLUDED.superada,verificada_en=now() RETURNING verificacion_accesibilidad_id AS id,espacio_id AS workspace_id,codigo AS code,superada AS passed,verificada_en AS checked_at', [workspaceId, accountId, code, passed]);
      return saved.rows[0];
    });
    return { item: result.value, replayed: result.replayed };
  }
  async listAccessibilityChecks(accountId: string, workspaceId: string) {
    const result = await this.pool.query('SELECT verificacion_accesibilidad_id AS id,espacio_id AS workspace_id,codigo AS code,superada AS passed,verificada_en AS checked_at FROM evidence.verificacion_accesibilidad WHERE espacio_id=$1 AND cuenta_id=$2 ORDER BY codigo', [workspaceId, accountId]);
    return result.rows;
  }
  async saveFileMetadata(accountId: string, input: EvidenceMetadataInput, key: string) {
    const result = await idempotent(this.pool, accountId, 'evidence.metadata.create', key, input, async client => {
      const saved = await client.query('INSERT INTO evidence.evidencia(ejecucion_id,creada_por,nombre,mime,bytes,sha256,ubicacion) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING evidencia_id AS id,ejecucion_id AS execution_id,nombre AS name,mime,bytes,sha256,ubicacion AS location,creada_en AS created_at', [input.executionId,accountId,input.name,input.mime,input.bytes,input.sha256,input.location]);
      return saved.rows[0];
    });
    return { item: result.value, replayed: result.replayed };
  }
  async listFileMetadata(accountId: string, executionId: string) {
    const result = await this.pool.query('SELECT evidencia_id AS id,ejecucion_id AS execution_id,nombre AS name,mime,bytes,sha256,ubicacion AS location,creada_en AS created_at FROM evidence.evidencia WHERE ejecucion_id=$1 AND creada_por=$2 AND eliminada_en IS NULL ORDER BY creada_en DESC,evidencia_id', [executionId, accountId]);
    return result.rows;
  }
  async deleteFileMetadata(accountId: string, id: string) {
    const result = await this.pool.query('UPDATE evidence.evidencia SET eliminada_en=COALESCE(eliminada_en,now()) WHERE evidencia_id=$1 AND creada_por=$2 AND eliminada_en IS NULL RETURNING evidencia_id', [id, accountId]);
    return !!result.rowCount;
  }
  async localReportExecutionIds(accountId: string, workspaceId: string, records: ReportSelection[]) {
    const found: string[] = [];
    for (const record of records) {
      if (record.source === 'ux_session') {
        const result = await this.pool.query('SELECT s.ejecucion_id FROM evidence.sesion_ux s WHERE s.sesion_ux_id=$1 AND s.cuenta_id=$2', [record.id, accountId]);
        if (!result.rowCount) return null;
        found.push(result.rows[0].ejecucion_id);
      } else if (record.source === 'evidence') {
        const result = await this.pool.query('SELECT e.ejecucion_id FROM evidence.evidencia e WHERE e.evidencia_id=$1 AND e.creada_por=$2 AND e.eliminada_en IS NULL', [record.id, accountId]);
        if (!result.rowCount) return null;
        found.push(result.rows[0].ejecucion_id);
      } else if (record.source === 'lab_event') {
        const result = await this.pool.query('SELECT 1 FROM evidence.evento_laboratorio WHERE evento_laboratorio_id=$1 AND espacio_id=$2 AND cuenta_id=$3', [record.id, workspaceId, accountId]);
        if (!result.rowCount) return null;
      } else if (record.source === 'accessibility_check') {
        const result = await this.pool.query('SELECT 1 FROM evidence.verificacion_accesibilidad WHERE verificacion_accesibilidad_id=$1 AND espacio_id=$2 AND cuenta_id=$3', [record.id, workspaceId, accountId]);
        if (!result.rowCount) return null;
      }
    }
    return found;
  }
  async createReport(accountId: string, input: ReportInput, key: string) {
    const result = await idempotent(this.pool, accountId, 'report.create', key, input, async client => {
      const report = await client.query('INSERT INTO evidence.informe(solicitado_por,espacio_id,nombre_proyecto,objetivo,metodo,interpretacion,mejoras,limites,conclusiones,referencias,incluir_comparacion,justificacion,formato) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING informe_id AS id,espacio_id AS workspace_id,nombre_proyecto AS project_name,creado_en AS created_at,formato AS format,incluir_comparacion AS include_comparison', [accountId,input.workspaceId,input.projectName ?? null,input.objective ?? null,input.method ?? null,input.interpretation ?? null,input.improvements ?? null,input.limitations ?? null,input.conclusions ?? null,input.references ?? null,input.includeComparison ?? false,input.justification ?? null,input.format ?? 'json']);
      for (const [index, record] of input.records.entries()) {
        await client.query(`INSERT INTO evidence.informe_registro(informe_id,seccion,orden,${reportColumn[record.source]}) VALUES($1,$2,$3,$4)`, [report.rows[0].id,record.section,index+1,record.id]);
      }
      return { ...report.rows[0], selected_record_count: input.records.length, status: 'pending', artifact: null };
    });
    return { item: result.value, replayed: result.replayed };
  }
  async getReport(accountId: string, id: string) {
    const report = await this.pool.query('SELECT informe_id AS id,espacio_id AS workspace_id,nombre_proyecto AS project_name,objetivo,metodo,interpretacion,mejoras,limites AS limitations,conclusiones,referencias,formato AS format,incluir_comparacion AS include_comparison,justificacion AS justification,creado_en AS created_at FROM evidence.informe WHERE informe_id=$1 AND solicitado_por=$2', [id,accountId]);
    if (!report.rowCount) return null;
    const records = await this.pool.query('SELECT informe_registro_id AS id,seccion AS section,orden AS position,ejecucion_id AS execution_id,persona_id AS persona_id,escenario_id AS scenario_id,reserva_id AS reservation_id,hallazgo_id AS finding_id,sesion_evaluacion_id AS evaluation_session_id,sesion_ux_id AS ux_session_id,evidencia_id AS evidence_id,usuario_demo_id AS demo_user_id,evidencia_multimodal_id AS multimodal_evidence_id,evento_laboratorio_id AS lab_event_id,verificacion_accesibilidad_id AS accessibility_check_id FROM evidence.informe_registro WHERE informe_id=$1 ORDER BY seccion,orden', [id]);
    return { ...report.rows[0], selected: records.rows, artifact: null, status: 'definition_saved' };
  }
  async pruneExpired(cutoff: Date) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reports = await client.query('DELETE FROM evidence.informe WHERE creado_en<$1', [cutoff]);
      const events = await client.query('DELETE FROM evidence.evento_laboratorio x WHERE ocurrido_en<$1 AND NOT EXISTS(SELECT 1 FROM evidence.informe_registro r WHERE r.evento_laboratorio_id=x.evento_laboratorio_id)', [cutoff]);
      const checks = await client.query('DELETE FROM evidence.verificacion_accesibilidad x WHERE verificada_en<$1 AND NOT EXISTS(SELECT 1 FROM evidence.informe_registro r WHERE r.verificacion_accesibilidad_id=x.verificacion_accesibilidad_id)', [cutoff]);
      const sessions = await client.query('DELETE FROM evidence.sesion_ux x WHERE iniciada_en<$1 AND NOT EXISTS(SELECT 1 FROM evidence.informe_registro r WHERE r.sesion_ux_id=x.sesion_ux_id)', [cutoff]);
      const oldFiles = await client.query('SELECT evidencia_id FROM evidence.evidencia x WHERE creada_en<$1 AND NOT EXISTS(SELECT 1 FROM evidence.informe_registro r WHERE r.evidencia_id=x.evidencia_id)', [cutoff]);
      if (oldFiles.rowCount) {
        await client.query('DELETE FROM evidence.entrega_evidencia WHERE evidencia_id=ANY($1::uuid[])', [oldFiles.rows.map(row => row.evidencia_id)]);
        await client.query('DELETE FROM evidence.evidencia WHERE evidencia_id=ANY($1::uuid[])', [oldFiles.rows.map(row => row.evidencia_id)]);
      }
      const idempotency = await client.query('DELETE FROM evidence.write_idempotency WHERE created_at<$1', [cutoff]);
      const outbox = await client.query("DELETE FROM evidence.event_outbox e WHERE e.occurred_at<$1 AND EXISTS(SELECT 1 FROM evidence.event_outbox_delivery d WHERE d.event_id=e.event_id) AND NOT EXISTS(SELECT 1 FROM evidence.event_outbox_delivery d WHERE d.event_id=e.event_id AND d.status<>'delivered')", [cutoff]);
      const inbox = await client.query('DELETE FROM evidence.event_inbox WHERE processed_at<$1', [cutoff]);
      const projections = await client.query('DELETE FROM evidence.event_projection WHERE occurred_at<$1', [cutoff]);
      await client.query('COMMIT');
      return { reports: reports.rowCount ?? 0, sessions: sessions.rowCount ?? 0, events: events.rowCount ?? 0, files: oldFiles.rowCount ?? 0, checks: checks.rowCount ?? 0, idempotency: idempotency.rowCount ?? 0, outbox: outbox.rowCount ?? 0, inbox: inbox.rowCount ?? 0, projections: projections.rowCount ?? 0 };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
