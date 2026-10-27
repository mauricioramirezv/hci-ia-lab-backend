import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresWorkRepository } from '../src/aprendizaje/infrastructure/postgres-workflows.js';
import { WorkApplication } from '../src/aprendizaje/application/workflows.js';

const enabled = process.env.TEST_POSTGRES === '1';
const suite = enabled ? describe : describe.skip;

suite('learning workflow persistence (PostgreSQL)', () => {
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.APRENDIZAJE_DB, user: process.env.APRENDIZAJE_USER, password: process.env.APRENDIZAJE_PASSWORD, max: 4 });
  const repository = new PostgresWorkRepository(pool);
  const teacherId = randomUUID(), participantId = randomUUID(), foreignId = randomUUID(), groupId = randomUUID();
  const moduleCode = 'integration-' + randomUUID();
  let moduleId = '', activityId = '', activityVersionId = '', workspaceId = '', assignmentId = '', executionId = '', deliveryId = '';
  const groups = { membership: async (id: string, accountId: string) => ({ active: id === groupId && (accountId === teacherId || accountId === participantId), role: id === groupId && accountId === teacherId ? 'leader' as const : id === groupId && accountId === participantId ? 'participant' as const : null }) };
  const work = new WorkApplication(repository, groups);
  beforeAll(async () => {
    const module = await pool.query('INSERT INTO learning.modulo(codigo,nombre) VALUES($1,$2) RETURNING modulo_id', [moduleCode, 'Synthetic integration module']);
    moduleId = module.rows[0].modulo_id;
    const activity = await pool.query('INSERT INTO learning.actividad(modulo_id,codigo,nombre,tipo) VALUES($1,$2,$3,$4) RETURNING actividad_id', [moduleId, 'practice', 'Synthetic practice', 'practice']);
    activityId = activity.rows[0].actividad_id;
    const version = await pool.query("INSERT INTO learning.actividad_version(actividad_id,numero_version,locale,titulo,descripcion,publicada_en) VALUES($1,1,'es-CO','Synthetic practice','Test-only content',now()) RETURNING actividad_version_id", [activityId]);
    activityVersionId = version.rows[0].actividad_version_id;
    workspaceId = (await work.createWorkspace(participantId, 'Synthetic workspace', randomUUID()) as { item: { id: string } }).item.id;
    expect((await repository.listActivities('es-CO', 100, 0)).some(item => item.module_code === moduleCode)).toBe(true);
    expect((await repository.listActivities('en-US', 100, 100)).some(item => item.module_code === moduleCode)).toBe(false);
  });
  afterAll(async () => {
    if (executionId) await pool.query('DELETE FROM learning.valoracion WHERE entrega_id IN (SELECT entrega_id FROM learning.entrega WHERE ejecucion_id=$1)', [executionId]);
    if (executionId) await pool.query('DELETE FROM learning.retroalimentacion WHERE entrega_id IN (SELECT entrega_id FROM learning.entrega WHERE ejecucion_id=$1)', [executionId]);
    if (executionId) await pool.query('DELETE FROM learning.entrega WHERE ejecucion_id=$1', [executionId]);
    if (executionId) await pool.query('DELETE FROM learning.ejecucion_actividad WHERE ejecucion_id=$1', [executionId]);
    if (assignmentId) await pool.query('DELETE FROM learning.criterio_asignacion WHERE asignacion_id=$1', [assignmentId]);
    if (assignmentId) await pool.query('DELETE FROM learning.asignacion_actividad WHERE asignacion_id=$1', [assignmentId]);
    if (workspaceId) await pool.query('DELETE FROM learning.espacio_trabajo WHERE espacio_id=$1', [workspaceId]);
    if (activityVersionId) await pool.query('DELETE FROM learning.actividad_version WHERE actividad_version_id=$1', [activityVersionId]);
    if (activityId) await pool.query('DELETE FROM learning.actividad WHERE actividad_id=$1', [activityId]);
    if (moduleId) await pool.query('DELETE FROM learning.modulo WHERE modulo_id=$1', [moduleId]);
    await pool.end();
  });
  it('enforces group-scoped assignments, exact execution idempotency, optimistic state, immutable delivery versions and review scope', async () => {
    const assignment = await work.createAssignment(teacherId, ['teacher'], groupId, { activityVersionId, title: 'Synthetic assignment', instructions: 'Complete the test practice', criteria: [{ code: 'result-quality', name: 'Result quality', maxScore: 10, order: 1 }] }) as { id: string };
    assignmentId = assignment.id;
    expect(await repository.listAssignments(groupId)).toMatchObject([{ id: assignmentId, criteria: [{ code: 'result-quality', maxScore: 10 }] }]);
    const created = await work.startExecution(participantId, { workspaceId, activityVersionId, assignmentId, source: 'measured', idempotencyKey: randomUUID() });
    expect(created.item).toBeTruthy();
    expect(created.replayed).toBe(false);
    executionId = (created.item as { id: string }).id;
    const key = (await pool.query('SELECT clave_idempotencia FROM learning.ejecucion_actividad WHERE ejecucion_id=$1', [executionId])).rows[0].clave_idempotencia as string;
    const replay = await work.startExecution(participantId, { workspaceId, activityVersionId, assignmentId, source: 'measured', idempotencyKey: key });
    expect(replay.replayed).toBe(true);
    expect((replay.item as { id: string }).id).toBe(executionId);
    const changedPayload = await work.startExecution(participantId, { workspaceId, activityVersionId, assignmentId, source: 'simulated', idempotencyKey: key });
    expect(changedPayload.item).toBeNull();
    expect(await repository.createExecution(foreignId, { workspaceId, activityVersionId, source: 'measured', idempotencyKey: randomUUID() })).toMatchObject({ item: null });
    const completed = await work.updateExecution(participantId, executionId, 1, 'completed', 'Synthetic completion');
    expect(completed).toMatchObject({ state: 'completed', version: 2 });
    expect(await work.updateExecution(participantId, executionId, 1, 'cancelled')).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS total FROM learning.valoracion WHERE evaluada_por=$1', [teacherId])).rows[0].total).toBe(0);
    const deliveryKey = randomUUID();
    const first = await work.createDelivery(participantId, executionId, deliveryKey, 'First version');
    expect(first).toMatchObject({ replayed: false });
    deliveryId = (first!.item as { id: string }).id;
    const criterionId = (await pool.query('SELECT criterio_id FROM learning.criterio_asignacion WHERE asignacion_id=$1', [assignmentId])).rows[0].criterio_id as string;
    const evaluation = await work.evaluateDelivery(teacherId, ['teacher'], deliveryId, criterionId, 8, 'Meets the declared criterion.');
    expect(evaluation).toMatchObject({ delivery_id: deliveryId, criterion_id: criterionId, score: '8' });
    await expect(work.evaluateDelivery(teacherId, ['teacher'], deliveryId, criterionId, 8)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const secondCall = await work.createDelivery(participantId, executionId, deliveryKey, 'First version');
    expect(secondCall).toMatchObject({ replayed: true, item: { id: deliveryId, version: 1 } });
    expect((await work.createDelivery(participantId, executionId, deliveryKey, 'Changed content'))?.item).toBeNull();
    const reviewed = await work.reviewDelivery(teacherId, ['teacher'], deliveryId, 'submitted', 'changes_requested', 'Please clarify the result.');
    expect(reviewed).toMatchObject({ state: 'changes_requested' });
    const versions = await pool.query('SELECT numero_version,estado FROM learning.entrega WHERE ejecucion_id=$1 ORDER BY numero_version', [executionId]);
    expect(versions.rows).toEqual([{ numero_version: 1, estado: 'changes_requested' }]);
    const feedback = await pool.query('SELECT tipo,autor_id FROM learning.retroalimentacion WHERE entrega_id=$1', [deliveryId]);
    expect(feedback.rows).toHaveLength(1);
    expect(feedback.rows[0].tipo).toBe('request_changes');
    expect(feedback.rows[0].autor_id).toBe(teacherId);
    const second = await work.createDelivery(participantId, executionId, randomUUID(), 'Corrected version');
    expect(second).toMatchObject({ replayed: false, item: { version: 2 } });
    const secondId = (second!.item as { id: string }).id;
    const concurrentRatings = await Promise.allSettled([
      work.evaluateDelivery(teacherId, [], secondId, criterionId, 7, 'Concurrent rating A'),
      work.evaluateDelivery(teacherId, [], secondId, criterionId, 7, 'Concurrent rating B'),
    ]);
    expect(concurrentRatings.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentRatings.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS total FROM learning.valoracion WHERE entrega_id=$1 AND criterio_id=$2', [secondId, criterionId])).rows[0].total).toBe(1);
    const concurrent = await Promise.all([
      work.createDelivery(participantId, executionId, randomUUID(), 'Concurrent version A'),
      work.createDelivery(participantId, executionId, randomUUID(), 'Concurrent version B'),
    ]);
    expect(concurrent.map(item => (item!.item as { version: number }).version).sort((a, b) => a - b)).toEqual([3, 4]);
    const history = await work.listDeliveryVersions(participantId, executionId, 20, 0);
    expect(history?.map(item => (item as { version: number }).version)).toEqual([4, 3, 2, 1]);
    expect(await work.listGroupDeliveryVersions(teacherId, groupId, 20, 0)).toHaveLength(4);
  });
  it('denies assignment creation to a global teacher who is not a leader of that group', async () => {
    const nonLeader = new WorkApplication(repository, { membership: async () => ({ active: true, role: 'participant' as const }) });
    await expect(nonLeader.createAssignment(teacherId, ['teacher'], groupId, { activityVersionId, title: 'Denied assignment', instructions: 'No permission' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(nonLeader.listGroupDeliveryVersions(teacherId, groupId, 10, 0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('uses the group leader responsibility without requiring a global teacher role', async () => {
    const assignment = await work.createAssignment(teacherId, [], groupId, { activityVersionId, title: 'Group-scoped assignment', instructions: 'No global role needed' }) as { id: string };
    expect(assignment.id).toBeTruthy();
    await pool.query('DELETE FROM learning.asignacion_actividad WHERE asignacion_id=$1', [assignment.id]);
  });
});

