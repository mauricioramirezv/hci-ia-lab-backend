import {
  EvaluationError,
  normalizeDemoPatch,
  normalizeDemoUser,
  normalizeFinding,
  normalizeLocale,
  normalizeResponses,
  normalizeSession,
  type DemoUserInput,
  type DemoUserPatch,
  type EvaluationKind,
  type FindingInput,
  type SessionInput,
} from '../domain/evaluation.js';
import { isUuid } from '../domain/learning-data.js';

export interface EvaluationRepository {
  listInstruments(locale: string, type: 'SUS' | 'NASA_TLX' | 'custom' | undefined, limit: number, offset: number): Promise<unknown[]>;
  listHeuristics(locale: string, limit: number, offset: number): Promise<unknown[]>;
  createSession(accountId: string, workspaceId: string, input: SessionInput, key: string): Promise<{ item: unknown; replayed: boolean } | null>;
  listSessions(accountId: string, workspaceId: string, limit: number, offset: number): Promise<unknown[] | null>;
  getSession(accountId: string, sessionId: string): Promise<unknown | null>;
  submitResponses(accountId: string, sessionId: string, inputs: ReturnType<typeof normalizeResponses>, key: string): Promise<{ item: unknown; replayed: boolean } | null>;
  createFinding(accountId: string, workspaceId: string, input: FindingInput, key: string): Promise<{ item: unknown; replayed: boolean } | null>;
  listFindings(accountId: string, workspaceId: string, limit: number, offset: number): Promise<unknown[] | null>;
  updateFinding(accountId: string, id: string, expectedState: string, state: 'validated' | 'rejected'): Promise<unknown | null>;
  createDemoUser(accountId: string, input: DemoUserInput, key: string): Promise<{ item: unknown; replayed: boolean }>;
  listDemoUsers(accountId: string, limit: number, offset: number): Promise<unknown[]>;
  updateDemoUser(accountId: string, id: string, input: DemoUserPatch): Promise<unknown | null>;
}

export class EvaluationApplication {
  constructor(private readonly repository: EvaluationRepository) {}
  listInstruments(locale: string, type: 'SUS' | 'NASA_TLX' | 'custom' | undefined, limit: number, offset: number) {
    if (type !== undefined && !['SUS', 'NASA_TLX', 'custom'].includes(type)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.listInstruments(normalizeLocale(locale), type, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  listHeuristics(locale: string, limit: number, offset: number) {
    return this.repository.listHeuristics(normalizeLocale(locale), Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  createSession(accountId: string, workspaceId: string, input: SessionInput, key: string) {
    if (!isUuid(workspaceId) || !isUuid(key)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.createSession(accountId, workspaceId, normalizeSession(input), key);
  }
  listSessions(accountId: string, workspaceId: string, limit: number, offset: number) {
    if (!isUuid(workspaceId)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.listSessions(accountId, workspaceId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  getSession(accountId: string, sessionId: string) {
    if (!isUuid(sessionId)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.getSession(accountId, sessionId);
  }
  submitResponses(accountId: string, sessionId: string, inputs: unknown, key: string) {
    if (!isUuid(sessionId) || !isUuid(key)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.submitResponses(accountId, sessionId, normalizeResponses(inputs), key);
  }
  createFinding(accountId: string, workspaceId: string, input: FindingInput, key: string) {
    if (!isUuid(workspaceId) || !isUuid(key)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.createFinding(accountId, workspaceId, normalizeFinding(input), key);
  }
  listFindings(accountId: string, workspaceId: string, limit: number, offset: number) {
    if (!isUuid(workspaceId)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.listFindings(accountId, workspaceId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  updateFinding(accountId: string, id: string, expectedState: string, state: 'validated' | 'rejected') {
    if (!isUuid(id) || !['pending', 'validated'].includes(expectedState) || !['validated', 'rejected'].includes(state)) throw new EvaluationError('INVALID_INPUT');
    if (expectedState === state) throw new EvaluationError('INVALID_INPUT');
    return this.repository.updateFinding(accountId, id, expectedState, state);
  }
  createDemoUser(accountId: string, input: DemoUserInput, key: string) {
    if (!isUuid(key)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.createDemoUser(accountId, normalizeDemoUser(input), key);
  }
  listDemoUsers(accountId: string, limit: number, offset: number) {
    return this.repository.listDemoUsers(accountId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  updateDemoUser(accountId: string, id: string, input: DemoUserPatch) {
    if (!isUuid(id)) throw new EvaluationError('INVALID_INPUT');
    return this.repository.updateDemoUser(accountId, id, normalizeDemoPatch(input));
  }
}

export type { EvaluationKind };
