import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { EvidenceApplication } from '../src/evidencias/application/use-cases.js';
import { PostgresEvidenceRepository } from '../src/evidencias/infrastructure/postgres-evidence.js';

const enabled = process.env.TEST_POSTGRES === '1';
const suite = enabled ? describe : describe.skip;
suite('Evidence consent and report persistence (PostgreSQL)', () => {
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.EVIDENCIAS_DB, user: process.env.EVIDENCIAS_USER, password: process.env.EVIDENCIAS_PASSWORD, max: 3 });
  const repository = new PostgresEvidenceRepository(pool);
  const ownerId = randomUUID(), otherId = randomUUID(), executionId = randomUUID(), workspaceId = randomUUID();
  const application = new EvidenceApplication(repository, {
    ownsExecution: async (accountId, id) => accountId === ownerId && id === executionId,
    ownsWorkspace: async (accountId, id) => accountId === ownerId && id === workspaceId,
    ownsExecutions: async (accountId, id, values) => accountId === ownerId && id === workspaceId && values.every(value => value === executionId),
    ownsReportRecords: async (accountId, id, records) => accountId === ownerId && id === workspaceId && (records.execution ?? []).every(value => value === executionId) && Object.entries(records).every(([key, values]) => key === 'execution' || !values?.length),
  }, { ownsReservations: async () => true });
  let sessionId = '', reportId = '', evidenceId = '', checkId = '';
  const retentionEvents: string[] = [], retentionInboxEvents: string[] = [], retentionAggregates: string[] = [];
  afterAll(async () => {
    if (retentionEvents.length) await pool.query('DELETE FROM evidence.event_outbox WHERE event_id=ANY($1::uuid[])', [retentionEvents]);
    if (retentionInboxEvents.length) await pool.query('DELETE FROM evidence.event_inbox WHERE event_id=ANY($1::uuid[])', [retentionInboxEvents]);
    if (retentionAggregates.length) await pool.query('DELETE FROM evidence.event_projection WHERE aggregate_id=ANY($1::uuid[])', [retentionAggregates]);
    if (reportId) await pool.query('DELETE FROM evidence.informe WHERE informe_id=$1', [reportId]);
    if (evidenceId) await pool.query('DELETE FROM evidence.evidencia WHERE evidencia_id=$1', [evidenceId]);
    if (sessionId) await pool.query('DELETE FROM evidence.sesion_ux WHERE sesion_ux_id=$1', [sessionId]);
    if (checkId) await pool.query('DELETE FROM evidence.verificacion_accesibilidad WHERE verificacion_accesibilidad_id=$1', [checkId]);
    await pool.query('DELETE FROM evidence.write_idempotency WHERE actor_id=$1', [ownerId]);
    await pool.end();
  });
  const input = (granted: boolean) => ({
    executionId, type: 'page' as const, route: '/concepts/accessibility', mode: 'none' as const, source: 'measured' as const,
    documentWidth: 1280, documentHeight: 1800, viewportWidth: 1280, viewportHeight: 800,
    durationMs: 12000, maxDepthPercent: 76, clickCount: 4, wheelCount: 2,
    consent: { purpose: 'aggregate_metrics' as const, noticeVersion: '2026-10', granted: granted as true },
  });
  it('requires explicit purposes, records batch events once, and keeps calibration aggregate only', async () => {
    await expect(application.createUxSession(ownerId, input(false), 'session-denied')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(application.createUxSession(otherId, input(true), 'session-other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const created = await application.createUxSession(ownerId, input(true), 'session-created');
    expect(created.replayed).toBe(false);
    sessionId = (created.item as { id: string }).id;
    const consent = await pool.query('SELECT otorgado,proposito,revocado_en FROM evidence.consentimiento WHERE sesion_ux_id=$1', [sessionId]);
    expect(consent.rows).toEqual([{ otorgado: true, proposito: 'aggregate_metrics', revocado_en: null }]);
    await expect(application.recordUxEvents(ownerId, sessionId, [{ channel: 'gaze', atMs: 100, x: 12.5, y: 8, source: 'measured' }], 'event-denied')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await application.setConsent(ownerId, sessionId, 'detailed_telemetry', 'notice-detail-1', true, 'consent-detail');
    const events = [{ channel: 'gaze' as const, atMs: 100, x: 12.5, y: 8, source: 'measured' as const }];
    const concurrentWrites = await Promise.all([
      application.recordUxEvents(ownerId, sessionId, events, 'event-batch'),
      application.recordUxEvents(ownerId, sessionId, events, 'event-batch'),
    ]);
    expect(concurrentWrites.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(concurrentWrites.every(result => result.accepted === 1)).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS total FROM evidence.evento_ux WHERE sesion_ux_id=$1', [sessionId])).rows[0].total).toBe(1);
    await application.setConsent(ownerId, sessionId, 'calibration', 'notice-calibration-1', true, 'consent-calibration');
    const calibration = { medianErrorPx: 1.7, viewportWidth: 1280, viewportHeight: 800, sampleCount: 9, validatedAt: '2026-10-24T10:00:00Z' };
    expect(await application.saveCalibration(ownerId, sessionId, calibration, 'calibration-1')).toMatchObject({ calibration: { median_error_px: '1.7', sample_count: 9 }, replayed: false });
    await application.revokeConsent(ownerId, sessionId, 'detailed_telemetry');
    await expect(application.recordUxEvents(ownerId, sessionId, events, 'event-after-revoke')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(await application.getUxSession(otherId, sessionId)).toBeNull();
  });
  it('stores file metadata without accepting video and records typed report selections', async () => {
    const metadata = { executionId, name: 'screen.png', mime: 'image/png', bytes: 120, sha256: 'a'.repeat(64), location: `${ownerId}/${executionId}/screen.png` };
    await expect(application.saveFileMetadata(otherId, { ...metadata, location: `${otherId}/${executionId}/screen.png` }, 'file-foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(application.saveFileMetadata(ownerId, { ...metadata, mime: 'video/mp4', name: 'capture.mp4' }, 'file-video')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const saved = await application.saveFileMetadata(ownerId, metadata, 'file-meta');
    evidenceId = (saved.item as { id: string }).id;
    expect(saved).toMatchObject({ replayed: false, item: { name: 'screen.png', location: metadata.location } });
    const check = await application.saveAccessibilityCheck(ownerId, workspaceId, 'keyboard', true, 'check-key');
    checkId = (check.item as { id: string }).id;
    const reportInput: Parameters<EvidenceApplication['createReport']>[1] = { workspaceId, format: 'markdown', includeComparison: true, justification: 'Compare the baseline and follow-up checks.', records: [
      { section: 'selected', source: 'execution', id: executionId },
      { section: 'selected', source: 'evidence', id: evidenceId },
      { section: 'after', source: 'accessibility_check', id: checkId },
      { section: 'before', source: 'ux_session', id: sessionId },
    ] };
    const report = await application.createReport(ownerId, reportInput, 'report-key');
    reportId = (report.item as { id: string }).id;
    expect(report).toMatchObject({ replayed: false, item: { format: 'markdown', selected_record_count: 4 } });
    const replayedReport = await application.createReport(ownerId, reportInput, 'report-key');
    expect(replayedReport).toMatchObject({ replayed: true, item: { id: reportId } });
    await expect(application.createReport(ownerId, { ...reportInput, format: 'csv' }, 'report-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    const records = await pool.query('SELECT seccion,ejecucion_id,evidencia_id,sesion_ux_id,verificacion_accesibilidad_id FROM evidence.informe_registro WHERE informe_id=$1 ORDER BY orden', [reportId]);
    expect(records.rows).toEqual([
      { seccion: 'selected', ejecucion_id: executionId, evidencia_id: null, sesion_ux_id: null, verificacion_accesibilidad_id: null },
      { seccion: 'selected', ejecucion_id: null, evidencia_id: evidenceId, sesion_ux_id: null, verificacion_accesibilidad_id: null },
      { seccion: 'after', ejecucion_id: null, evidencia_id: null, sesion_ux_id: null, verificacion_accesibilidad_id: checkId },
      { seccion: 'before', ejecucion_id: null, evidencia_id: null, sesion_ux_id: sessionId, verificacion_accesibilidad_id: null },
    ]);
    expect(await application.getReport(otherId, reportId)).toBeNull();
  });
  it('automatically prunes records beyond 30 days while preserving pending and failed outbox work', async () => {
    const createOldEvent = async () => {
      const aggregateId = randomUUID(); retentionAggregates.push(aggregateId);
      await pool.query("SELECT evidence.emit_domain_event('retention.fixture','fixture',$1,'1','{}'::jsonb)", [aggregateId]);
      const eventId = (await pool.query('SELECT event_id FROM evidence.event_outbox WHERE aggregate_id=$1', [aggregateId])).rows[0].event_id as string;
      retentionEvents.push(eventId);
      await pool.query("UPDATE evidence.event_outbox SET occurred_at=now()-interval '31 days' WHERE event_id=$1", [eventId]);
      return eventId;
    };
    const delivered = await createOldEvent();
    const pending = await createOldEvent();
    const retry = await createOldEvent();
    const deadletter = await createOldEvent();
    await pool.query("UPDATE evidence.event_outbox_delivery SET status='delivered',delivered_at=now() WHERE event_id=$1", [delivered]);
    await pool.query("UPDATE evidence.event_outbox_delivery SET status='retry' WHERE event_id=$1", [retry]);
    await pool.query("UPDATE evidence.event_outbox_delivery SET status='deadletter' WHERE event_id=$1", [deadletter]);

    const processedInboxId = randomUUID(), pendingInboxId = randomUUID();
    retentionInboxEvents.push(processedInboxId, pendingInboxId);
    await pool.query("INSERT INTO evidence.event_inbox(source,event_id,source_sequence,event_type,request_hash,correlation_id,received_at,processed_at) VALUES('fixture',$1,1,'fixture.changed',$2,'processed',$3,now()-interval '31 days')", [processedInboxId, 'a'.repeat(64), new Date(Date.now() - 31 * 86400000)]);
    await pool.query("INSERT INTO evidence.event_inbox(source,event_id,source_sequence,event_type,request_hash,correlation_id,received_at) VALUES('fixture',$1,2,'fixture.changed',$2,'unprocessed',now()-interval '31 days')", [pendingInboxId, 'b'.repeat(64)]);
    const projectionId = randomUUID(); retentionAggregates.push(projectionId);
    await pool.query("INSERT INTO evidence.event_projection(source,aggregate_type,aggregate_id,source_sequence,aggregate_version,event_type,payload,occurred_at,correlation_id) VALUES('fixture','fixture',$1,1,'1','fixture.changed','{}'::jsonb,now()-interval '31 days','fixture')", [projectionId]);

    const removed = await repository.pruneExpired(new Date(Date.now() - 30 * 86400000));
    expect(removed).toMatchObject({ outbox: 1, inbox: 1, projections: 1 });
    expect((await pool.query('SELECT status FROM evidence.event_outbox_delivery WHERE event_id=$1', [delivered])).rowCount).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM evidence.event_outbox WHERE event_id=ANY($1::uuid[])', [[pending, retry, deadletter]])).rows[0].n).toBe(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM evidence.event_inbox WHERE event_id=ANY($1::uuid[])', [[pendingInboxId]])).rows[0].n).toBe(1);
  });
});
