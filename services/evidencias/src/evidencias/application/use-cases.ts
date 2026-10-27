export type EvidenceErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONSENT_REQUIRED' | 'DEPENDENCY_UNAVAILABLE' | 'IDEMPOTENCY_KEY_REUSED' | 'RETENTION_DISABLED';
export class EvidenceError extends Error { constructor(readonly code: EvidenceErrorCode) { super(code); this.name = 'EvidenceError'; } }

import { isAccessibilityCode, isConsentPurpose, isReportSource, isSafeStorageLocation, isVideoFile, isValidUxEvent, type AccessibilityCode, type CalibrationInput, type ConsentPurpose, type ReportSelection, type ReportSource, type UxEvent, type UxExposure, type EvidenceMetadataInput } from '../domain/evidence.js';
export type UxSessionInput = {
  executionId: string; type: 'page' | 'example'; route: string; alias?: string; task?: string; prototype?: string; objective?: string; notes?: string;
  mode: 'observed' | 'cursor' | 'F' | 'Gutenberg' | 'none' | 'mixed'; source: 'measured' | 'simulated' | 'mixed';
  documentWidth: number; documentHeight: number; viewportWidth: number; viewportHeight: number;
  durationMs: number; maxDepthPercent: number; clickCount?: number; wheelCount?: number;
  consent: { purpose: 'aggregate_metrics'; noticeVersion: string; granted: true };
  exposures?: UxExposure[];
};
export type ReportInput = { workspaceId: string; projectName?: string; objective?: string; method?: string; interpretation?: string; improvements?: string; limitations?: string; conclusions?: string; references?: string; includeComparison?: boolean; justification?: string; format?: 'pdf' | 'markdown' | 'csv' | 'json'; records: ReportSelection[] };
export type LearningReportIds = Partial<Record<Exclude<ReportSource, 'reservation' | 'ux_session' | 'evidence' | 'lab_event' | 'accessibility_check'>, string[]>>;

export interface EvidenceRepository {
  createUxSession(accountId: string, input: UxSessionInput, key: string): Promise<{ item: unknown; replayed: boolean }>;
  getUxSession(accountId: string, id: string): Promise<unknown | null>;
  listConsents(accountId: string, id: string): Promise<unknown | null>;
  setConsent(accountId: string, id: string, purpose: ConsentPurpose, noticeVersion: string, granted: boolean, key: string): Promise<{ item: unknown; replayed: boolean } | null>;
  revokeConsent(accountId: string, id: string, purpose?: ConsentPurpose): Promise<boolean>;
  recordUxEvents(accountId: string, id: string, events: UxEvent[], key: string): Promise<{ accepted: number; replayed: boolean } | null>;
  listUxEvents(accountId: string, id: string, limit: number, offset: number): Promise<{ items: unknown[]; total: number } | null>;
  saveCalibration(accountId: string, id: string, input: CalibrationInput, key: string): Promise<{ calibration: unknown; replayed: boolean } | null>;
  saveAccessibilityCheck(accountId: string, workspaceId: string, code: AccessibilityCode, passed: boolean, key: string): Promise<{ item: unknown; replayed: boolean }>;
  listAccessibilityChecks(accountId: string, workspaceId: string): Promise<unknown[] | null>;
  saveFileMetadata(accountId: string, input: EvidenceMetadataInput, key: string): Promise<{ item: unknown; replayed: boolean }>;
  listFileMetadata(accountId: string, executionId: string): Promise<unknown[] | null>;
  deleteFileMetadata(accountId: string, id: string): Promise<boolean>;
  localReportExecutionIds(accountId: string, workspaceId: string, records: ReportSelection[]): Promise<string[] | null>;
  createReport(accountId: string, input: ReportInput, key: string): Promise<{ item: unknown; replayed: boolean }>;
  getReport(accountId: string, id: string): Promise<unknown | null>;
  pruneExpired(cutoff: Date): Promise<{ reports: number; sessions: number; events: number; files: number; checks: number; idempotency: number; outbox: number; inbox: number; projections: number }>;
}
export interface LearningAccessPort {
  ownsExecution(accountId: string, executionId: string): Promise<boolean>;
  ownsWorkspace(accountId: string, workspaceId: string): Promise<boolean>;
  ownsExecutions(accountId: string, workspaceId: string, executionIds: string[]): Promise<boolean>;
  ownsReportRecords(accountId: string, workspaceId: string, records: LearningReportIds): Promise<boolean>;
}
export interface CommunityAccessPort { ownsReservations(accountId: string, workspaceId: string, reservationIds: string[]): Promise<boolean> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localSources = new Set<ReportSource>(['ux_session', 'evidence', 'lab_event', 'accessibility_check']);
const learningSources: (keyof LearningReportIds)[] = ['execution', 'persona', 'scenario', 'finding', 'evaluation_session', 'demo_user', 'multimodal_evidence'];
const validKey = (key: string) => key.length > 0 && key.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(key);

export class EvidenceApplication {
  constructor(private readonly repo: EvidenceRepository, private readonly learning: LearningAccessPort, private readonly community: CommunityAccessPort) {}
  async createUxSession(accountId: string, input: UxSessionInput, key: string) {
    if (input.consent.purpose !== 'aggregate_metrics' || input.consent.granted !== true) throw new EvidenceError('CONSENT_REQUIRED');
    if (!validKey(key) || !uuid.test(input.executionId) || input.route.length > 500 || input.route.startsWith('//')) throw new EvidenceError('INVALID_INPUT');
    if (![input.documentWidth,input.documentHeight,input.viewportWidth,input.viewportHeight].every(x => Number.isInteger(x) && x > 0 && x <= 100000)) throw new EvidenceError('INVALID_INPUT');
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 24 * 60 * 60 * 1000 || !Number.isFinite(input.maxDepthPercent) || input.maxDepthPercent < 0 || input.maxDepthPercent > 100) throw new EvidenceError('INVALID_INPUT');
    if ((input.clickCount ?? 0) < 0 || (input.wheelCount ?? 0) < 0 || !Number.isInteger(input.clickCount ?? 0) || !Number.isInteger(input.wheelCount ?? 0)) throw new EvidenceError('INVALID_INPUT');
    if ((input.exposures ?? []).length > 50 || new Set((input.exposures ?? []).map(exposure => exposure.band)).size !== (input.exposures ?? []).length || (input.exposures ?? []).some(exposure => !exposure.band.trim() || exposure.band.length > 80 || !Number.isFinite(exposure.seconds) || exposure.seconds < 0)) throw new EvidenceError('INVALID_INPUT');
    if (!input.consent.noticeVersion.trim() || input.consent.noticeVersion.length > 80) throw new EvidenceError('INVALID_INPUT');
    if (!await this.learning.ownsExecution(accountId, input.executionId)) throw new EvidenceError('NOT_FOUND');
    return this.repo.createUxSession(accountId, input, key);
  }
  getUxSession(accountId: string, id: string) { this.assertUuid(id); return this.repo.getUxSession(accountId, id); }
  listConsents(accountId: string, id: string) { this.assertUuid(id); return this.repo.listConsents(accountId, id); }
  async setConsent(accountId: string, id: string, purpose: ConsentPurpose, noticeVersion: string, granted: boolean, key: string) {
    this.assertUuid(id);
    if (!validKey(key) || !isConsentPurpose(purpose) || !noticeVersion.trim() || noticeVersion.length > 80 || typeof granted !== 'boolean') throw new EvidenceError('INVALID_INPUT');
    const result = await this.repo.setConsent(accountId, id, purpose, noticeVersion, granted, key);
    if (!result) throw new EvidenceError('NOT_FOUND');
    return result;
  }
  revokeConsent(accountId: string, id: string, purpose?: ConsentPurpose) { this.assertUuid(id); return this.repo.revokeConsent(accountId, id, purpose); }
  async recordUxEvents(accountId: string, id: string, events: UxEvent[], key: string) {
    this.assertUuid(id);
    if (!validKey(key) || !events.length || events.length > 500 || events.some(event => !isValidUxEvent(event))) throw new EvidenceError('INVALID_INPUT');
    const result = await this.repo.recordUxEvents(accountId, id, events, key);
    if (!result) throw new EvidenceError('CONSENT_REQUIRED');
    return result;
  }
  async listUxEvents(accountId: string, id: string, limit = 100, offset = 0) {
    this.assertUuid(id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new EvidenceError('INVALID_INPUT');
    return this.repo.listUxEvents(accountId, id, limit, offset);
  }
  async saveCalibration(accountId: string, id: string, input: CalibrationInput, key: string) {
    this.assertUuid(id);
    if (!validKey(key) || !Number.isFinite(input.medianErrorPx) || input.medianErrorPx < 0 || !this.dimensions(input.viewportWidth, input.viewportHeight) || !Number.isInteger(input.sampleCount) || input.sampleCount < 0 || input.sampleCount > 10000 || !Number.isFinite(Date.parse(input.validatedAt))) throw new EvidenceError('INVALID_INPUT');
    const result = await this.repo.saveCalibration(accountId, id, input, key);
    if (!result) throw new EvidenceError('CONSENT_REQUIRED');
    return result;
  }
  async saveAccessibilityCheck(accountId: string, workspaceId: string, code: AccessibilityCode, passed: boolean, key: string) {
    this.assertUuid(workspaceId);
    if (!isAccessibilityCode(code) || typeof passed !== 'boolean' || !validKey(key)) throw new EvidenceError('INVALID_INPUT');
    if (!await this.learning.ownsWorkspace(accountId, workspaceId)) throw new EvidenceError('NOT_FOUND');
    return this.repo.saveAccessibilityCheck(accountId, workspaceId, code, passed, key);
  }
  async listAccessibilityChecks(accountId: string, workspaceId: string) {
    this.assertUuid(workspaceId);
    if (!await this.learning.ownsWorkspace(accountId, workspaceId)) throw new EvidenceError('NOT_FOUND');
    return this.repo.listAccessibilityChecks(accountId, workspaceId);
  }
  async saveFileMetadata(accountId: string, input: EvidenceMetadataInput, key: string) {
    this.assertUuid(input.executionId);
    if (!validKey(key) || !input.name.trim() || input.name.length > 255 || !/^[\w.+-]+\/[\w.+-]+$/.test(input.mime) || isVideoFile(input.name, input.mime) || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || !/^[0-9a-f]{64}$/i.test(input.sha256) || !isSafeStorageLocation(input.location, accountId, input.executionId)) throw new EvidenceError('INVALID_INPUT');
    if (!await this.learning.ownsExecution(accountId, input.executionId)) throw new EvidenceError('NOT_FOUND');
    return this.repo.saveFileMetadata(accountId, input, key);
  }
  async listFileMetadata(accountId: string, executionId: string) {
    this.assertUuid(executionId);
    if (!await this.learning.ownsExecution(accountId, executionId)) throw new EvidenceError('NOT_FOUND');
    return this.repo.listFileMetadata(accountId, executionId);
  }
  async deleteFileMetadata(accountId: string, id: string) { this.assertUuid(id); return this.repo.deleteFileMetadata(accountId, id); }
  async createReport(accountId: string, input: ReportInput, key: string) {
    if (!validKey(key) || !uuid.test(input.workspaceId) || !input.records.length || input.records.length > 100) throw new EvidenceError('INVALID_INPUT');
    if ([input.projectName,input.objective,input.method,input.interpretation,input.improvements,input.limitations,input.conclusions,input.references,input.justification].some(value => value !== undefined && value.length > 5000)) throw new EvidenceError('INVALID_INPUT');
    if (new Set(input.records.map(item => `${item.section}:${item.source}:${item.id}`)).size !== input.records.length || input.records.some(item => !uuid.test(item.id) || !['selected','before','after'].includes(item.section) || !isReportSource(item.source))) throw new EvidenceError('INVALID_INPUT');
    const comparison = input.records.some(item => item.section !== 'selected');
    if ((input.includeComparison || comparison) && (!input.includeComparison || !input.justification?.trim())) throw new EvidenceError('INVALID_INPUT');
    if (!await this.learning.ownsWorkspace(accountId, input.workspaceId)) throw new EvidenceError('NOT_FOUND');
    const learningRecords: LearningReportIds = {};
    for (const source of learningSources) learningRecords[source] = input.records.filter(item => item.source === source).map(item => item.id);
    if (!await this.learning.ownsReportRecords(accountId, input.workspaceId, learningRecords)) throw new EvidenceError('NOT_FOUND');
    const reservations = input.records.filter(item => item.source === 'reservation').map(item => item.id);
    if (reservations.length && !await this.community.ownsReservations(accountId, input.workspaceId, reservations)) throw new EvidenceError('NOT_FOUND');
    const localExecutionIds = await this.repo.localReportExecutionIds(accountId, input.workspaceId, input.records.filter(item => localSources.has(item.source)));
    if (!localExecutionIds || !await this.learning.ownsExecutions(accountId, input.workspaceId, localExecutionIds)) throw new EvidenceError('NOT_FOUND');
    return this.repo.createReport(accountId, input, key);
  }
  getReport(accountId: string, id: string) { this.assertUuid(id); return this.repo.getReport(accountId, id); }
  async pruneExpired(days: number | undefined) {
    if (days === undefined) throw new EvidenceError('RETENTION_DISABLED');
    if (!Number.isInteger(days) || days < 30 || days > 36500) throw new EvidenceError('INVALID_INPUT');
    return this.repo.pruneExpired(new Date(Date.now() - days * 86400000));
  }
  private assertUuid(value: string) { if (!uuid.test(value)) throw new EvidenceError('INVALID_INPUT'); }
  private dimensions(width: number, height: number) { return [width,height].every(value => Number.isInteger(value) && value > 0 && value <= 100000); }
}
