import { describe, it, expect, vi } from 'vitest';
import { EvidenceApplication, type EvidenceRepository, type LearningAccessPort, type CommunityAccessPort } from '../src/evidencias/application/use-cases.js';

const accountId = '00000000-0000-4000-8000-000000000001';
const executionId = '00000000-0000-4000-8000-000000000002';
const workspaceId = '00000000-0000-4000-8000-000000000003';
const sessionId = '00000000-0000-4000-8000-000000000004';
const ok = async () => true;
function setup() {
  const repo = {
    createUxSession: vi.fn(), getUxSession: vi.fn(), listConsents: vi.fn(), setConsent: vi.fn(), revokeConsent: vi.fn(), recordUxEvents: vi.fn(), saveCalibration: vi.fn(),
    saveAccessibilityCheck: vi.fn(), listAccessibilityChecks: vi.fn(), saveFileMetadata: vi.fn(), listFileMetadata: vi.fn(), deleteFileMetadata: vi.fn(), localReportExecutionIds: vi.fn(), createReport: vi.fn(), getReport: vi.fn(), pruneExpired: vi.fn(),
  } as unknown as EvidenceRepository;
  const learning: LearningAccessPort = { ownsExecution: ok, ownsWorkspace: ok, ownsExecutions: ok, ownsReportRecords: vi.fn(ok) };
  const community: CommunityAccessPort = { ownsReservations: vi.fn(ok) };
  return { app: new EvidenceApplication(repo, learning, community), repo, learning, community };
}

describe('Evidence consent and data minimization policies', () => {
  it('requires separate consent before detailed events or calibration can be stored', async () => {
    const { app, repo } = setup();
    (repo.recordUxEvents as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repo.saveCalibration as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(app.recordUxEvents(accountId, sessionId, [{ channel: 'gaze', atMs: 2, source: 'measured' }], 'event-key')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(app.saveCalibration(accountId, sessionId, { medianErrorPx: 1.5, viewportWidth: 1200, viewportHeight: 800, sampleCount: 9, validatedAt: '2026-10-24T10:00:00Z' }, 'calibration-key')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    (repo.setConsent as ReturnType<typeof vi.fn>).mockResolvedValue({ item: {}, replayed: false });
    await app.setConsent(accountId, sessionId, 'calibration', 'notice-v1', true, 'consent-key');
    expect(repo.setConsent).toHaveBeenCalledWith(accountId, sessionId, 'calibration', 'notice-v1', true, 'consent-key');
  });

  it('rejects camera video and unsafe file locations while accepting metadata only', async () => {
    const { app, repo } = setup();
    const metadata = { executionId, name: 'screen.png', mime: 'image/png', bytes: 120, sha256: 'a'.repeat(64), location: `${accountId}/${executionId}/screen.png` };
    (repo.saveFileMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({ item: { id: 'file' }, replayed: false });
    await expect(app.saveFileMetadata(accountId, { ...metadata, name: 'capture.webm', mime: 'video/webm' }, 'file-1')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(app.saveFileMetadata(accountId, { ...metadata, location: '../private.png' }, 'file-2')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(app.saveFileMetadata(accountId, metadata, 'file-3')).resolves.toMatchObject({ replayed: false });
  });

  it('enforces a minimum retention of 30 days before cleanup', async () => {
    const { app, repo } = setup();
    await expect(app.pruneExpired(undefined)).rejects.toMatchObject({ code: 'RETENTION_DISABLED' });
    await expect(app.pruneExpired(29)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(repo.pruneExpired).not.toHaveBeenCalled();
    (repo.pruneExpired as ReturnType<typeof vi.fn>).mockResolvedValue({ reports: 0, sessions: 0, events: 0, files: 0, checks: 0, idempotency: 0, outbox: 0, inbox: 0, projections: 0 });
    await app.pruneExpired(30);
    expect(repo.pruneExpired).toHaveBeenCalledOnce();
  });

  it('validates typed report records with each owning service before saving the definition', async () => {
    const { app, repo, learning, community } = setup();
    (repo.localReportExecutionIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (repo.createReport as ReturnType<typeof vi.fn>).mockResolvedValue({ item: { id: 'report' }, replayed: false });
    const records = [{ section: 'selected', source: 'reservation', id: sessionId }] as const;
    const report = await app.createReport(accountId, { workspaceId, records: [...records] }, 'report-key');
    expect(report).toMatchObject({ item: { id: 'report' } });
    expect(learning.ownsReportRecords).toHaveBeenCalledOnce();
    expect(community.ownsReservations).toHaveBeenCalledWith(accountId, workspaceId, [sessionId]);
    expect(repo.localReportExecutionIds).toHaveBeenCalledOnce();
    expect(repo.createReport).toHaveBeenCalledOnce();
    await expect(app.createReport(accountId, { workspaceId, records: [{ ...records[0], section: 'before' }] }, 'compare-key')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
