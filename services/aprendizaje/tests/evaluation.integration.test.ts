import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { EvaluationApplication } from '../src/aprendizaje/application/evaluation.js';
import { PostgresEvaluationRepository } from '../src/aprendizaje/infrastructure/postgres-evaluation.js';
import { PostgresWorkRepository } from '../src/aprendizaje/infrastructure/postgres-workflows.js';

const enabled = process.env.TEST_POSTGRES === '1';
const suite = enabled ? describe : describe.skip;
suite('learning evaluation persistence (PostgreSQL)', () => {
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.APRENDIZAJE_DB, user: process.env.APRENDIZAJE_USER, password: process.env.APRENDIZAJE_PASSWORD, max: 6,
  });
  const repository = new PostgresEvaluationRepository(pool);
  const service = new EvaluationApplication(repository);
  const ownerId = randomUUID(), foreignId = randomUUID(), instrumentCode = 'integration-sus-' + randomUUID();
  const heuristicCode = 'h10', heuristicVersion = 999, workspaceName = 'Iteration 6 synthetic workspace';
  let workspaceId = '', instrumentId = '', heuristicId = '', sessionId = '', findingId = '', demoId = '';

  beforeAll(async () => {
    const workspace = await new PostgresWorkRepository(pool).createWorkspace(ownerId, workspaceName, randomUUID());
    workspaceId = (workspace.item as { id: string }).id;
    const instrument = await pool.query(
      "INSERT INTO learning.instrumento(codigo,numero_version,locale,nombre,tipo,formula_version) VALUES($1,1,'es-CO','Synthetic SUS','SUS','SUS-5PT-1.0') RETURNING instrumento_id",
      [instrumentCode],
    );
    instrumentId = instrument.rows[0].instrumento_id as string;
    for (let order = 1; order <= 10; order++) {
      await pool.query('INSERT INTO learning.item_instrumento(instrumento_id,codigo,enunciado,orden,minimo,maximo) VALUES($1,$2,$3,$4,1,5)', [instrumentId, 'sus' + order, 'Synthetic question ' + order, order]);
    }
    const heuristic = await pool.query(
      "INSERT INTO learning.heuristica_version(codigo,numero_version,locale,nombre,explicacion,pregunta,ejemplo) VALUES($1,$2,'es-CO','Synthetic heuristic','Description','Question','Example') RETURNING heuristica_version_id",
      [heuristicCode, heuristicVersion],
    );
    heuristicId = heuristic.rows[0].heuristica_version_id as string;
  });

  afterAll(async () => {
    if (demoId) await pool.query('DELETE FROM learning.usuario_demo WHERE usuario_demo_id=$1', [demoId]);
    if (findingId) await pool.query('DELETE FROM learning.hallazgo_heuristico WHERE hallazgo_id=$1', [findingId]);
    if (sessionId) await pool.query('DELETE FROM learning.sesion_evaluacion WHERE sesion_evaluacion_id=$1', [sessionId]);
    if (instrumentId) await pool.query('DELETE FROM learning.item_instrumento WHERE instrumento_id=$1', [instrumentId]);
    if (instrumentId) await pool.query('DELETE FROM learning.instrumento WHERE instrumento_id=$1', [instrumentId]);
    if (heuristicId) await pool.query('DELETE FROM learning.heuristica_version WHERE heuristica_version_id=$1', [heuristicId]);
    if (workspaceId) await pool.query('DELETE FROM learning.espacio_trabajo WHERE espacio_id=$1', [workspaceId]);
    await pool.query("DELETE FROM learning.write_idempotency WHERE account_id=ANY($1::uuid[])", [[ownerId, foreignId]]);
    await pool.end();
  });

  it('keeps instrument versions, response history and scores atomic, owner-scoped and concurrency-safe', async () => {
    const sessionKey = randomUUID();
    const created = await service.createSession(ownerId, workspaceId, { type: 'SUS', instrumentId, task: 'Synthetic task' }, sessionKey);
    expect(created).toMatchObject({ replayed: false });
    sessionId = (created!.item as { id: string }).id;
    expect((await service.createSession(ownerId, workspaceId, { type: 'SUS', instrumentId, task: 'Synthetic task' }, sessionKey)).replayed).toBe(true);
    expect(await service.getSession(foreignId, sessionId)).toBeNull();
    expect(await service.listSessions(foreignId, workspaceId, 20, 0)).toBeNull();

    const answerItems = await pool.query('SELECT item_id,orden FROM learning.item_instrumento WHERE instrumento_id=$1 ORDER BY orden', [instrumentId]);
    const responses = answerItems.rows.map((item, index) => ({ itemId: item.item_id as string, value: index % 2 === 0 ? 5 : 1 }));
    const responseKey = randomUUID();
    const results = await Promise.all([
      service.submitResponses(ownerId, sessionId, responses, responseKey),
      service.submitResponses(ownerId, sessionId, responses, responseKey),
    ]);
    expect(results.map(item => item?.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.item).toMatchObject({ computed: { code: 'sus_score', value: 100, formulaVersion: 'SUS-5PT-1.0' } });
    expect((await pool.query('SELECT count(*)::int AS count FROM learning.respuesta_item WHERE sesion_evaluacion_id=$1', [sessionId])).rows[0].count).toBe(10);
    await expect(service.submitResponses(ownerId, sessionId, responses, randomUUID())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(service.submitResponses(ownerId, sessionId, responses.slice(1), randomUUID())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await service.listSessions(ownerId, workspaceId, 20, 0)).toHaveLength(1);
  });

  it('preserves heuristic labels and demo users separately with owner checks and optimistic updates', async () => {
    const finding = await service.createFinding(ownerId, workspaceId, {
      sessionId, heuristicVersionId: heuristicId, task: 'Review', severity: 2, problem: 'Synthetic issue',
      evidence: 'Synthetic evidence', recommendation: 'Synthetic fix', source: 'human',
    }, randomUUID());
    findingId = (finding!.item as { id: string }).id;
    expect(finding!.item).toMatchObject({ heuristic_label: 'Synthetic heuristic', state: 'pending' });
    expect(await service.listFindings(foreignId, workspaceId, 20, 0)).toBeNull();
    expect(await service.listFindings(ownerId, workspaceId, 20, 0)).toHaveLength(1);
    expect(await service.updateFinding(ownerId, findingId, 'pending', 'validated')).toMatchObject({ state: 'validated' });
    await expect(service.updateFinding(ownerId, findingId, 'pending', 'rejected')).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const user = await service.createDemoUser(ownerId, { name: 'Synthetic participant', email: 'DEMO@example.test', role: 'student' }, randomUUID());
    demoId = (user.item as { id: string }).id;
    expect(user.item).toMatchObject({ created_by: ownerId, role: 'student', state: 'active' });
    expect(await service.listDemoUsers(foreignId, 20, 0)).toEqual([]);
    expect(await service.listDemoUsers(ownerId, 20, 0)).toHaveLength(1);
    await expect(service.createDemoUser(ownerId, { name: 'Duplicate', email: ' demo@EXAMPLE.test ', role: 'teacher' }, randomUUID())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const updatedAt = String((user.item as { updated_at: string }).updated_at);
    expect(await service.updateDemoUser(ownerId, demoId, { expectedUpdatedAt: updatedAt, state: 'inactive' })).toMatchObject({ state: 'inactive' });
    await expect(service.updateDemoUser(ownerId, demoId, { expectedUpdatedAt: updatedAt, state: 'active' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await service.updateDemoUser(foreignId, demoId, { expectedUpdatedAt: updatedAt, state: 'active' })).toBeNull();
  });
});
