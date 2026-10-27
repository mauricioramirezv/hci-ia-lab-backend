import type { Pool, PoolClient } from 'pg';
import { completeWrite, claimWrite } from './write-idempotency.js';
import { EvaluationError, computeScore, type DemoUserInput, type DemoUserPatch, type FindingInput, type Instrument, type InstrumentItem, type ResponseInput, type SessionInput } from '../domain/evaluation.js';
import type { EvaluationRepository } from '../application/evaluation.js';
import { IdempotencyKeyConflict } from '../domain/learning-data.js';

type DbRow = Record<string, unknown>;
type EvaluationRecord = {
  id: string; workspace_id: string; execution_id: string | null; kind: string;
  participant_alias: string | null; task: string | null; success: boolean | null;
  seconds: string | number | null; errors: number | null; seq: string | number | null;
  emotion: string | number | null; notes: string | null; started_at: Date | string;
  finished_at: Date | string | null; instrument_id: string | null; instrument_code: string | null;
  instrument_version: number | null; instrument_locale: string | null; instrument_name: string | null;
  instrument_type: Instrument['type'] | null; formula_version: string | null; item_id: string | null;
  item_code: string | null; item_prompt: string | null; item_order: number | null;
  item_minimum: string | number | null; item_maximum: string | number | null;
  response_id: string | null; response_number: string | number | null; response_text: string | null;
};
const num = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
const uniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';

export class PostgresEvaluationRepository implements EvaluationRepository {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async loadSessions(client: PoolClient, accountId: string, ids: string[], workspaceId?: string): Promise<unknown[]> {
    if (!ids.length) return [];
    const result = await client.query(
      `SELECT s.sesion_evaluacion_id AS id,s.espacio_id AS workspace_id,s.ejecucion_id AS execution_id,s.tipo AS kind,
       s.participante_alias AS participant_alias,s.tarea AS task,s.exito AS success,s.segundos AS seconds,s.errores AS errors,
       s.seq,s.emocion AS emotion,s.notas AS notes,s.iniciada_en AS started_at,s.finalizada_en AS finished_at,
       i.instrumento_id AS instrument_id,i.codigo AS instrument_code,i.numero_version AS instrument_version,
       i.locale AS instrument_locale,i.nombre AS instrument_name,i.tipo AS instrument_type,i.formula_version,
       it.item_id AS item_id,it.codigo AS item_code,it.enunciado AS item_prompt,it.orden AS item_order,
       it.minimo AS item_minimum,it.maximo AS item_maximum,r.respuesta_id AS response_id,
       r.valor_numerico AS response_number,r.valor_texto AS response_text
       FROM learning.sesion_evaluacion s
       JOIN learning.espacio_trabajo w ON w.espacio_id=s.espacio_id AND w.propietario_id=$1 AND w.archivado_en IS NULL
       LEFT JOIN learning.instrumento i ON i.instrumento_id=s.instrumento_id
       LEFT JOIN learning.item_instrumento it ON it.instrumento_id=i.instrumento_id
       LEFT JOIN learning.respuesta_item r ON r.sesion_evaluacion_id=s.sesion_evaluacion_id AND r.item_id=it.item_id
       WHERE s.cuenta_id=$1 AND s.sesion_evaluacion_id=ANY($2::uuid[]) AND ($3::uuid IS NULL OR s.espacio_id=$3)
       ORDER BY s.iniciada_en DESC,s.sesion_evaluacion_id,it.orden`,
      [accountId, ids, workspaceId ?? null],
    );
    const groups = new Map<string, { row: EvaluationRecord; items: InstrumentItem[]; responses: ResponseInput[] }>();
    for (const row of result.rows as EvaluationRecord[]) {
      let group = groups.get(row.id);
      if (!group) { group = { row, items: [], responses: [] }; groups.set(row.id, group); }
      if (row.item_id) {
        group.items.push({ id: row.item_id, code: row.item_code ?? '', prompt: row.item_prompt ?? '', order: Number(row.item_order), minimum: num(row.item_minimum), maximum: num(row.item_maximum) });
        if (row.response_id) group.responses.push({ itemId: row.item_id, value: row.response_number !== null ? Number(row.response_number) : row.response_text ?? '' });
      }
    }
    return [...groups.values()].map(group => {
      const row = group.row;
      const instrument: Instrument | null = row.instrument_id && row.instrument_type ? {
        id: row.instrument_id, code: row.instrument_code ?? '', version: Number(row.instrument_version),
        locale: row.instrument_locale ?? '', name: row.instrument_name ?? '', type: row.instrument_type,
        formulaVersion: row.formula_version, items: group.items,
      } : null;
      const computed = row.finished_at && instrument && ['SUS', 'NASA_TLX'].includes(instrument.type) ? computeScore(instrument, group.responses) : null;
      return {
        id: row.id, workspaceId: row.workspace_id, executionId: row.execution_id, type: row.kind,
        participantAlias: row.participant_alias, task: row.task, success: row.success, seconds: num(row.seconds),
        errors: row.errors, seq: num(row.seq), emotion: num(row.emotion), notes: row.notes,
        startedAt: row.started_at, finishedAt: row.finished_at,
        instrument: instrument ? { id: instrument.id, code: instrument.code, version: instrument.version, locale: instrument.locale, name: instrument.name, type: instrument.type, formulaVersion: instrument.formulaVersion } : null,
        responses: group.responses, computed,
      };
    });
  }
  async listInstruments(locale: string, type: 'SUS' | 'NASA_TLX' | 'custom' | undefined, limit: number, offset: number) {
    const result = await this.pool.query(
      `WITH selected AS (
         SELECT instrumento_id FROM learning.instrumento WHERE locale=$1 AND ($2::text IS NULL OR tipo=$2)
         ORDER BY codigo,numero_version DESC LIMIT $3 OFFSET $4
       )
       SELECT i.instrumento_id AS id,i.codigo AS code,i.numero_version AS version,i.locale,i.nombre AS name,i.tipo AS type,
       i.formula_version,it.item_id,it.codigo AS item_code,it.enunciado AS prompt,it.orden AS item_order,it.minimo AS minimum,it.maximo AS maximum
       FROM selected p JOIN learning.instrumento i ON i.instrumento_id=p.instrumento_id
       LEFT JOIN learning.item_instrumento it ON it.instrumento_id=i.instrumento_id
       ORDER BY i.codigo,i.numero_version DESC,it.orden`,
      [locale, type ?? null, limit, offset],
    );
    const groups = new Map<string, { row: DbRow; items: InstrumentItem[] }>();
    for (const row of result.rows as DbRow[]) {
      const id = String(row.id); let group = groups.get(id);
      if (!group) { group = { row, items: [] }; groups.set(id, group); }
      if (row.item_id) group.items.push({ id: String(row.item_id), code: String(row.item_code), prompt: String(row.prompt), order: Number(row.item_order), minimum: num(row.minimum), maximum: num(row.maximum) });
    }
    return [...groups.values()].map(({ row, items }) => ({
      id: row.id, code: row.code, version: Number(row.version), locale: row.locale, name: row.name, type: row.type, formulaVersion: row.formula_version, items,
    }));
  }
  async listHeuristics(locale: string, limit: number, offset: number) {
    const result = await this.pool.query(
      `SELECT heuristica_version_id AS id,codigo AS code,numero_version AS version,locale,nombre AS name,
       explicacion AS explanation,pregunta AS question,ejemplo AS example FROM learning.heuristica_version
       WHERE locale=$1 ORDER BY codigo,numero_version DESC LIMIT $2 OFFSET $3`,
      [locale, limit, offset],
    );
    return result.rows;
  }
  async createSession(accountId: string, workspaceId: string, input: SessionInput, key: string) {
    return this.tx(async client => {
      const workspace = await client.query('SELECT espacio_id FROM learning.espacio_trabajo WHERE espacio_id=$1 AND propietario_id=$2 AND archivado_en IS NULL FOR SHARE', [workspaceId, accountId]);
      if (!workspace.rowCount) return null;
      const operation = 'evaluation.session.create';
      const receipt = await claimWrite(client, accountId, operation, key, { workspaceId, input });
      if (receipt.replayed) {
        const items = await this.loadSessions(client, accountId, [receipt.resourceId as string], workspaceId);
        return items.length ? { item: items[0], replayed: true } : null;
      }
      if (input.instrumentId) {
        const instrument = await client.query('SELECT tipo AS type FROM learning.instrumento WHERE instrumento_id=$1 FOR SHARE', [input.instrumentId]);
        const expected = input.type === 'SUS' ? 'SUS' : input.type === 'NASA_TLX' ? 'NASA_TLX' : input.type === 'custom' ? 'custom' : null;
        if (!instrument.rowCount || instrument.rows[0].type !== expected) throw new EvaluationError('INVALID_INPUT');
      }
      if (input.executionId) {
        const execution = await client.query('SELECT ejecucion_id FROM learning.ejecucion_actividad WHERE ejecucion_id=$1 AND espacio_id=$2 AND cuenta_id=$3 FOR SHARE', [input.executionId, workspaceId, accountId]);
        if (!execution.rowCount) throw new EvaluationError('NOT_FOUND');
      }
      const created = await client.query(
        `INSERT INTO learning.sesion_evaluacion(cuenta_id,espacio_id,ejecucion_id,instrumento_id,tipo,participante_alias,tarea,exito,segundos,errores,seq,emocion,notas)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING sesion_evaluacion_id AS id`,
        [accountId, workspaceId, input.executionId ?? null, input.instrumentId ?? null, input.type, input.participantAlias ?? null, input.task ?? null,
          input.success ?? null, input.seconds ?? null, input.errors ?? null, input.seq ?? null, input.emotion ?? null, input.notes ?? null],
      );
      const id = String(created.rows[0].id);
      await completeWrite(client, accountId, operation, key, id);
      const items = await this.loadSessions(client, accountId, [id], workspaceId);
      return items.length ? { item: items[0], replayed: false } : null;
    });
  }
  async listSessions(accountId: string, workspaceId: string, limit: number, offset: number) {
    const owned = await this.pool.query('SELECT espacio_id FROM learning.espacio_trabajo WHERE espacio_id=$1 AND propietario_id=$2 AND archivado_en IS NULL', [workspaceId, accountId]);
    if (!owned.rowCount) return null;
    const result = await this.pool.query('SELECT sesion_evaluacion_id AS id FROM learning.sesion_evaluacion WHERE espacio_id=$1 AND cuenta_id=$2 ORDER BY iniciada_en DESC,sesion_evaluacion_id LIMIT $3 OFFSET $4', [workspaceId, accountId, limit, offset]);
    const client = await this.pool.connect();
    try { return await this.loadSessions(client, accountId, result.rows.map(row => String(row.id)), workspaceId); }
    finally { client.release(); }
  }
  async getSession(accountId: string, sessionId: string) {
    const client = await this.pool.connect();
    try { const items = await this.loadSessions(client, accountId, [sessionId]); return items[0] ?? null; }
    finally { client.release(); }
  }
  async submitResponses(accountId: string, sessionId: string, inputs: ResponseInput[], key: string) {
    return this.tx(async client => {
      const found = await client.query(
        `SELECT s.sesion_evaluacion_id AS id,s.espacio_id AS workspace_id,s.instrumento_id AS instrument_id,s.tipo AS kind,s.finalizada_en AS finished_at
         FROM learning.sesion_evaluacion s JOIN learning.espacio_trabajo w ON w.espacio_id=s.espacio_id AND w.propietario_id=$1 AND w.archivado_en IS NULL
         WHERE s.sesion_evaluacion_id=$2 AND s.cuenta_id=$1 FOR UPDATE OF s,w`,
        [accountId, sessionId],
      );
      if (!found.rowCount) return null;
      const row = found.rows[0] as { id: string; workspace_id: string; instrument_id: string | null; kind: string; finished_at: Date | null };
      const operation = 'evaluation.responses.submit';
      const receipt = await claimWrite(client, accountId, operation, key, { sessionId, inputs });
      if (receipt.replayed) {
        const items = await this.loadSessions(client, accountId, [sessionId], row.workspace_id);
        return items.length ? { item: items[0], replayed: true } : null;
      }
      if (row.finished_at || !row.instrument_id || !['SUS', 'NASA_TLX'].includes(row.kind)) throw new EvaluationError('STATE_CONFLICT');
      const instrumentResult = await client.query(
        `SELECT i.instrumento_id AS id,i.codigo AS code,i.numero_version AS version,i.locale,i.nombre AS name,i.tipo AS type,
         i.formula_version,it.item_id,it.codigo AS item_code,it.enunciado AS prompt,it.orden AS item_order,it.minimo AS minimum,it.maximo AS maximum
         FROM learning.instrumento i JOIN learning.item_instrumento it ON it.instrumento_id=i.instrumento_id
         WHERE i.instrumento_id=$1 ORDER BY it.orden FOR SHARE OF i,it`,
        [row.instrument_id],
      );
      if (!instrumentResult.rowCount) throw new EvaluationError('STATE_CONFLICT');
      const first = instrumentResult.rows[0] as DbRow;
      const instrument: Instrument = {
        id: String(first.id), code: String(first.code), version: Number(first.version), locale: String(first.locale),
        name: String(first.name), type: first.type as Instrument['type'], formulaVersion: first.formula_version as string | null,
        items: (instrumentResult.rows as DbRow[]).map(item => ({
          id: String(item.item_id), code: String(item.item_code), prompt: String(item.prompt), order: Number(item.item_order),
          minimum: num(item.minimum), maximum: num(item.maximum),
        })),
      };
      const computed = computeScore(instrument, inputs);
      if (!computed) throw new EvaluationError('STATE_CONFLICT');
      for (const answer of inputs) {
        if (!instrument.items.some(item => item.id === answer.itemId)) throw new EvaluationError('INVALID_INPUT');
        await client.query('INSERT INTO learning.respuesta_item(sesion_evaluacion_id,item_id,valor_numerico,valor_texto) VALUES($1,$2,$3,$4)', [
          sessionId, answer.itemId, typeof answer.value === 'number' ? answer.value : null, typeof answer.value === 'string' ? answer.value : null,
        ]);
      }
      await client.query('UPDATE learning.sesion_evaluacion SET finalizada_en=now() WHERE sesion_evaluacion_id=$1 AND finalizada_en IS NULL', [sessionId]);
      await completeWrite(client, accountId, operation, key, sessionId);
      const items = await this.loadSessions(client, accountId, [sessionId], row.workspace_id);
      return items.length ? { item: items[0], replayed: false } : null;
    });
  }
  async createFinding(accountId: string, workspaceId: string, input: FindingInput, key: string) {
    return this.tx(async client => {
      const workspace = await client.query('SELECT espacio_id FROM learning.espacio_trabajo WHERE espacio_id=$1 AND propietario_id=$2 AND archivado_en IS NULL FOR SHARE', [workspaceId, accountId]);
      if (!workspace.rowCount) return null;
      const operation = 'heuristic.finding.create';
      const receipt = await claimWrite(client, accountId, operation, key, { workspaceId, input });
      if (receipt.replayed) {
        const existing = await client.query('SELECT hallazgo_id AS id,espacio_id AS workspace_id,sesion_evaluacion_id AS session_id,ejecucion_id AS execution_id,heuristica_version_id AS heuristic_version_id,heuristica_etiqueta AS heuristic_label,tarea AS task,severidad AS severity,problema AS problem,evidencia AS evidence,recomendacion AS recommendation,fuente AS source,estado AS state,creado_en AS created_at FROM learning.hallazgo_heuristico WHERE hallazgo_id=$1 AND espacio_id=$2 AND creado_por=$3', [receipt.resourceId, workspaceId, accountId]);
        return existing.rowCount ? { item: existing.rows[0], replayed: true } : null;
      }
      if (input.sessionId) {
        const session = await client.query('SELECT sesion_evaluacion_id FROM learning.sesion_evaluacion WHERE sesion_evaluacion_id=$1 AND espacio_id=$2 AND cuenta_id=$3', [input.sessionId, workspaceId, accountId]);
        if (!session.rowCount) throw new EvaluationError('NOT_FOUND');
      }
      if (input.executionId) {
        const execution = await client.query('SELECT ejecucion_id FROM learning.ejecucion_actividad WHERE ejecucion_id=$1 AND espacio_id=$2 AND cuenta_id=$3', [input.executionId, workspaceId, accountId]);
        if (!execution.rowCount) throw new EvaluationError('NOT_FOUND');
      }
      let label = input.heuristicLabel ?? null;
      if (input.heuristicVersionId) {
        const heuristic = await client.query('SELECT nombre FROM learning.heuristica_version WHERE heuristica_version_id=$1 FOR SHARE', [input.heuristicVersionId]);
        if (!heuristic.rowCount) throw new EvaluationError('INVALID_INPUT');
        label ??= String(heuristic.rows[0].nombre);
      }
      if (!label) throw new EvaluationError('INVALID_INPUT');
      const created = await client.query(
        `INSERT INTO learning.hallazgo_heuristico(espacio_id,sesion_evaluacion_id,ejecucion_id,creado_por,heuristica_version_id,
         heuristica_etiqueta,tarea,severidad,problema,evidencia,recomendacion,fuente,estado)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING hallazgo_id AS id,espacio_id AS workspace_id,sesion_evaluacion_id AS session_id,ejecucion_id AS execution_id,
         heuristica_version_id AS heuristic_version_id,heuristica_etiqueta AS heuristic_label,tarea AS task,severidad AS severity,
         problema AS problem,evidencia AS evidence,recomendacion AS recommendation,fuente AS source,estado AS state,creado_en AS created_at`,
        [workspaceId, input.sessionId ?? null, input.executionId ?? null, accountId, input.heuristicVersionId ?? null,
          label, input.task, input.severity, input.problem, input.evidence, input.recommendation, input.source, input.state ?? 'pending'],
      );
      const id = String(created.rows[0].id);
      await completeWrite(client, accountId, operation, key, id);
      return { item: created.rows[0], replayed: false };
    });
  }
  async listFindings(accountId: string, workspaceId: string, limit: number, offset: number) {
    const workspace = await this.pool.query('SELECT espacio_id FROM learning.espacio_trabajo WHERE espacio_id=$1 AND propietario_id=$2 AND archivado_en IS NULL', [workspaceId, accountId]);
    if (!workspace.rowCount) return null;
    const result = await this.pool.query(
      `SELECT f.hallazgo_id AS id,f.espacio_id AS workspace_id,f.sesion_evaluacion_id AS session_id,f.ejecucion_id AS execution_id,
       f.heuristica_version_id AS heuristic_version_id,f.heuristica_etiqueta AS heuristic_label,f.tarea AS task,
       f.severidad AS severity,f.problema AS problem,f.evidencia AS evidence,f.recomendacion AS recommendation,
       f.fuente AS source,f.estado AS state,f.creado_en AS created_at FROM learning.hallazgo_heuristico f
       WHERE f.espacio_id=$1 AND f.creado_por=$2 ORDER BY f.creado_en DESC,f.hallazgo_id LIMIT $3 OFFSET $4`,
      [workspaceId, accountId, limit, offset],
    );
    return result.rows;
  }
  async updateFinding(accountId: string, id: string, expectedState: string, state: 'validated' | 'rejected') {
    return this.tx(async client => {
      const current = await client.query(
        `SELECT f.estado FROM learning.hallazgo_heuristico f JOIN learning.espacio_trabajo w
         ON w.espacio_id=f.espacio_id AND w.propietario_id=$1 AND w.archivado_en IS NULL
         WHERE f.hallazgo_id=$2 AND f.creado_por=$1 FOR UPDATE OF f`,
        [accountId, id],
      );
      if (!current.rowCount) return null;
      if (current.rows[0].estado !== expectedState || current.rows[0].estado !== 'pending') throw new EvaluationError('STATE_CONFLICT');
      const updated = await client.query('UPDATE learning.hallazgo_heuristico SET estado=$3 WHERE hallazgo_id=$1 AND creado_por=$2 RETURNING hallazgo_id AS id,estado AS state,creado_en AS created_at', [id, accountId, state]);
      return updated.rows[0] ?? null;
    });
  }
  async createDemoUser(accountId: string, input: DemoUserInput, key: string) {
    try {
      return await this.tx(async client => {
        const operation = 'demo-user.create';
        const receipt = await claimWrite(client, accountId, operation, key, input);
        if (receipt.replayed) {
          const existing = await client.query("SELECT usuario_demo_id AS id,creado_por AS created_by,nombre AS name,correo_demo AS email,rol_demo AS role,estado AS state,creado_en AS created_at,actualizado_en::text AS updated_at FROM learning.usuario_demo WHERE usuario_demo_id=$1 AND creado_por=$2", [receipt.resourceId, accountId]);
          return { item: existing.rows[0] ?? null, replayed: true };
        }
        const result = await client.query(
          `INSERT INTO learning.usuario_demo(creado_por,nombre,correo_demo,rol_demo,estado) VALUES($1,$2,$3,$4,$5)
           RETURNING usuario_demo_id AS id,creado_por AS created_by,nombre AS name,correo_demo AS email,rol_demo AS role,
           estado AS state,creado_en AS created_at,actualizado_en::text AS updated_at`,
          [accountId, input.name, input.email, input.role, input.state ?? 'active'],
        );
        const id = String(result.rows[0].id);
        await completeWrite(client, accountId, operation, key, id);
        return { item: result.rows[0], replayed: false };
      });
    } catch (error) { if (uniqueViolation(error)) throw new EvaluationError('STATE_CONFLICT'); throw error; }
  }
  async listDemoUsers(accountId: string, limit: number, offset: number) {
    const result = await this.pool.query(
      "SELECT usuario_demo_id AS id,creado_por AS created_by,nombre AS name,correo_demo AS email,rol_demo AS role,estado AS state,creado_en AS created_at,actualizado_en::text AS updated_at FROM learning.usuario_demo WHERE creado_por=$1 ORDER BY creado_en DESC,usuario_demo_id LIMIT $2 OFFSET $3",
      [accountId, limit, offset],
    );
    return result.rows;
  }
  async updateDemoUser(accountId: string, id: string, input: DemoUserPatch) {
    try {
      return await this.tx(async client => {
        const updated = await client.query(
          `UPDATE learning.usuario_demo SET nombre=COALESCE($3,nombre),correo_demo=COALESCE($4,correo_demo),
           rol_demo=COALESCE($5,rol_demo),estado=COALESCE($6,estado),actualizado_en=now()
           WHERE usuario_demo_id=$1 AND creado_por=$2 AND actualizado_en=$7
           RETURNING usuario_demo_id AS id,creado_por AS created_by,nombre AS name,correo_demo AS email,rol_demo AS role,
           estado AS state,creado_en AS created_at,actualizado_en::text AS updated_at`,
          [id, accountId, input.name ?? null, input.email ?? null, input.role ?? null, input.state ?? null, input.expectedUpdatedAt],
        );
        if (updated.rowCount) return updated.rows[0];
        const owned = await client.query('SELECT usuario_demo_id FROM learning.usuario_demo WHERE usuario_demo_id=$1 AND creado_por=$2', [id, accountId]);
        if (owned.rowCount) throw new EvaluationError('STATE_CONFLICT');
        return null;
      });
    } catch (error) { if (uniqueViolation(error)) throw new EvaluationError('STATE_CONFLICT'); throw error; }
  }
}
