import type { Pool } from 'pg';
type ReportRecords = Partial<Record<'execution' | 'persona' | 'scenario' | 'finding' | 'evaluation_session' | 'demo_user' | 'multimodal_evidence', string[]>>;
export class PostgresLearningAccess {
  constructor(private readonly pool: Pool) {}
  async ownsExecution(accountId: string, executionId: string) {
    const result = await this.pool.query('SELECT 1 FROM learning.ejecucion_actividad WHERE cuenta_id=$1 AND ejecucion_id=$2', [accountId, executionId]);
    return !!result.rowCount;
  }
  async ownsWorkspace(accountId: string, workspaceId: string) {
    const result = await this.pool.query('SELECT 1 FROM learning.espacio_trabajo WHERE propietario_id=$1 AND espacio_id=$2 AND archivado_en IS NULL', [accountId, workspaceId]);
    return !!result.rowCount;
  }
  async ownsExecutions(accountId: string, workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return true;
    const result = await this.pool.query('SELECT count(DISTINCT ejecucion_id)::int AS count FROM learning.ejecucion_actividad WHERE cuenta_id=$1 AND espacio_id=$2 AND ejecucion_id=ANY($3::uuid[])', [accountId, workspaceId, unique]);
    return result.rows[0].count === unique.length;
  }
  async ownsReportRecords(accountId: string, workspaceId: string, records: ReportRecords) {
    const checks: Array<[string[] | undefined, string]> = [
      [records.execution, 'SELECT count(DISTINCT ejecucion_id)::int AS count FROM learning.ejecucion_actividad WHERE cuenta_id=$1 AND espacio_id=$2 AND ejecucion_id=ANY($3::uuid[])'],
      [records.persona, 'SELECT count(DISTINCT persona_id)::int AS count FROM learning.persona WHERE creada_por=$1 AND espacio_id=$2 AND persona_id=ANY($3::uuid[])'],
      [records.scenario, 'SELECT count(DISTINCT escenario_id)::int AS count FROM learning.escenario WHERE creado_por=$1 AND espacio_id=$2 AND escenario_id=ANY($3::uuid[])'],
      [records.finding, 'SELECT count(DISTINCT hallazgo_id)::int AS count FROM learning.hallazgo_heuristico WHERE creado_por=$1 AND espacio_id=$2 AND hallazgo_id=ANY($3::uuid[])'],
      [records.evaluation_session, 'SELECT count(DISTINCT sesion_evaluacion_id)::int AS count FROM learning.sesion_evaluacion WHERE cuenta_id=$1 AND espacio_id=$2 AND sesion_evaluacion_id=ANY($3::uuid[])'],
      [records.demo_user, 'SELECT count(DISTINCT usuario_demo_id)::int AS count FROM learning.usuario_demo WHERE creado_por=$1 AND usuario_demo_id=ANY($2::uuid[])'],
      [records.multimodal_evidence, 'SELECT count(DISTINCT m.ejecucion_id)::int AS count FROM learning.evidencia_multimodal m JOIN learning.ejecucion_actividad e ON e.ejecucion_id=m.ejecucion_id WHERE e.cuenta_id=$1 AND e.espacio_id=$2 AND m.ejecucion_id=ANY($3::uuid[])'],
    ];
    for (const [ids, sql] of checks) {
      const unique = [...new Set(ids ?? [])];
      if (!unique.length) continue;
      const values = sql.includes('usuario_demo') ? [accountId, unique] : [accountId, workspaceId, unique];
      const result = await this.pool.query(sql, values);
      if (result.rows[0].count !== unique.length) return false;
    }
    return true;
  }
}
