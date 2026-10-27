import { isUuid, locales } from './learning-data.js';

export type EvaluationKind = 'task' | 'SUS' | 'NASA_TLX' | 'heuristic' | 'custom';
export type DemoRole = 'student' | 'teacher' | 'evaluator';
export type EvaluationErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'STATE_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED';
export class EvaluationError extends Error {
  constructor(readonly code: EvaluationErrorCode) {
    super(code);
    this.name = 'EvaluationError';
  }
}

export type InstrumentItem = {
  id: string;
  code: string;
  prompt: string;
  order: number;
  minimum: number | null;
  maximum: number | null;
};
export type Instrument = {
  id: string;
  code: string;
  version: number;
  locale: string;
  name: string;
  type: 'SUS' | 'NASA_TLX' | 'custom';
  formulaVersion: string | null;
  items: InstrumentItem[];
};
export type ResponseInput = { itemId: string; value: number | string };
export type ComputedScore = { code: 'sus_score' | 'raw_tlx_score'; value: number; minimum: 0; maximum: 100; formulaVersion: string };
export type SessionInput = {
  type: EvaluationKind;
  executionId?: string;
  instrumentId?: string;
  participantAlias?: string;
  task?: string;
  success?: boolean;
  seconds?: number;
  errors?: number;
  seq?: number;
  emotion?: number;
  notes?: string;
};
export type FindingInput = {
  sessionId?: string;
  executionId?: string;
  heuristicVersionId?: string;
  heuristicLabel?: string;
  task: string;
  severity: number;
  problem: string;
  evidence: string;
  recommendation: string;
  source: 'human' | 'ai';
  state?: 'pending' | 'validated' | 'rejected';
};
export type DemoUserInput = { name: string; email: string; role: DemoRole; state?: 'active' | 'inactive' };
export type DemoUserPatch = { name?: string; email?: string; role?: DemoRole; state?: 'active' | 'inactive'; expectedUpdatedAt: string };

const invalid = (): never => { throw new EvaluationError('INVALID_INPUT'); };
const cleanText = (value: unknown, max: number, required = true): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return invalid();
  return value.trim();
};

export function normalizeSession(input: SessionInput): SessionInput {
  if (!input || typeof input !== 'object' || !['task', 'SUS', 'NASA_TLX', 'heuristic', 'custom'].includes(input.type)) return invalid();
  if (input.executionId !== undefined && !isUuid(input.executionId)) return invalid();
  if (input.instrumentId !== undefined && !isUuid(input.instrumentId)) return invalid();
  if (['SUS', 'NASA_TLX', 'custom'].includes(input.type) !== (input.instrumentId !== undefined)) return invalid();
  if (input.type === 'SUS' && input.instrumentId === undefined || input.type === 'NASA_TLX' && input.instrumentId === undefined) return invalid();
  if (input.success !== undefined && typeof input.success !== 'boolean') return invalid();
  for (const value of [input.seconds, input.errors, input.seq, input.emotion]) if (value !== undefined && !Number.isFinite(value)) return invalid();
  if (input.seconds !== undefined && input.seconds < 0 || input.errors !== undefined && (!Number.isInteger(input.errors) || input.errors < 0)) return invalid();
  if (input.seq !== undefined && (input.seq < 1 || input.seq > 7) || input.emotion !== undefined && (input.emotion < 1 || input.emotion > 5)) return invalid();
  return {
    type: input.type,
    executionId: input.executionId,
    instrumentId: input.instrumentId,
    participantAlias: cleanText(input.participantAlias, 100, false),
    task: cleanText(input.task, 2000, false),
    success: input.success,
    seconds: input.seconds,
    errors: input.errors,
    seq: input.seq,
    emotion: input.emotion,
    notes: cleanText(input.notes, 5000, false),
  };
}

export function normalizeResponses(value: unknown): ResponseInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return invalid();
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.itemId !== 'string' || !isUuid(item.itemId)) return invalid();
    if (seen.has(item.itemId)) return invalid();
    seen.add(item.itemId);
    if (!(typeof item.value === 'string' && item.value.trim().length > 0 && item.value.length <= 5000) &&
      !(typeof item.value === 'number' && Number.isFinite(item.value))) return invalid();
    return { itemId: item.itemId, value: typeof item.value === 'string' ? item.value.trim() : item.value };
  });
}

export function computeScore(instrument: Instrument, inputs: ResponseInput[]): ComputedScore | null {
  const normalized = normalizeResponses(inputs);
  const items = [...instrument.items].sort((a, b) => a.order - b.order);
  if (items.length !== normalized.length) return invalid();
  const values = new Map(normalized.map(answer => [answer.itemId, answer.value]));
  if (items.some(item => !values.has(item.id))) return invalid();
  const numeric = items.map(item => {
    const value = values.get(item.id);
    if (typeof value !== 'number' || !Number.isFinite(value) ||
      item.minimum !== null && value < item.minimum || item.maximum !== null && value > item.maximum) return invalid();
    return value;
  });
  if (instrument.type === 'SUS') {
    if (instrument.formulaVersion !== 'SUS-5PT-1.0' || items.length !== 10 ||
      items.some((item, index) => item.order !== index + 1 || item.minimum !== 1 || item.maximum !== 5) ||
      numeric.some(value => !Number.isInteger(value))) throw new EvaluationError('STATE_CONFLICT');
    const score = numeric.reduce((total, value, index) => total + (index % 2 === 0 ? value - 1 : 5 - value), 0) * 2.5;
    return { code: 'sus_score', value: score, minimum: 0, maximum: 100, formulaVersion: instrument.formulaVersion };
  }
  if (instrument.type === 'NASA_TLX') {
    if (instrument.formulaVersion !== 'RAW-TLX-MEAN-1.0' || items.length !== 6 ||
      items.some((item, index) => item.order !== index + 1 || item.minimum !== 0 || item.maximum !== 100)) throw new EvaluationError('STATE_CONFLICT');
    const score = numeric.reduce((total, value) => total + value, 0) / 6;
    return { code: 'raw_tlx_score', value: score, minimum: 0, maximum: 100, formulaVersion: instrument.formulaVersion };
  }
  return null;
}

export function normalizeFinding(input: FindingInput): FindingInput {
  if (!input || typeof input !== 'object' ||
    (input.sessionId === undefined && input.executionId === undefined) ||
    (input.sessionId !== undefined && !isUuid(input.sessionId)) ||
    (input.executionId !== undefined && !isUuid(input.executionId)) ||
    (input.heuristicVersionId !== undefined && !isUuid(input.heuristicVersionId)) ||
    (input.state !== undefined && !['pending', 'validated', 'rejected'].includes(input.state)) ||
    !Number.isInteger(input.severity) || input.severity < 0 || input.severity > 4 ||
    !['human', 'ai'].includes(input.source)) return invalid();
  return {
    sessionId: input.sessionId,
    executionId: input.executionId,
    heuristicVersionId: input.heuristicVersionId,
    heuristicLabel: cleanText(input.heuristicLabel, 200, false),
    task: cleanText(input.task, 2000) as string,
    severity: input.severity,
    problem: cleanText(input.problem, 5000) as string,
    evidence: cleanText(input.evidence, 5000) as string,
    recommendation: cleanText(input.recommendation, 5000) as string,
    source: input.source,
    state: input.state ?? 'pending',
  };
}

export function normalizeDemoUser(input: DemoUserInput): DemoUserInput {
  if (!input || typeof input !== 'object' || !['student', 'teacher', 'evaluator'].includes(input.role) ||
    (input.state !== undefined && !['active', 'inactive'].includes(input.state))) return invalid();
  const name = cleanText(input.name, 120) as string;
  const email = cleanText(input.email, 254) as string;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid();
  return { name, email, role: input.role, state: input.state ?? 'active' };
}

export function normalizeDemoPatch(input: DemoUserPatch): DemoUserPatch {
  if (!input || typeof input !== 'object' || typeof input.expectedUpdatedAt !== 'string' ||
    Number.isNaN(Date.parse(input.expectedUpdatedAt))) return invalid();
  if (input.name === undefined && input.email === undefined && input.role === undefined && input.state === undefined) return invalid();
  const normalized = normalizeDemoUser({
    name: input.name ?? 'placeholder',
    email: input.email ?? 'placeholder@example.test',
    role: input.role ?? 'student',
    state: input.state,
  });
  return { ...normalized, name: input.name === undefined ? undefined : normalized.name, email: input.email === undefined ? undefined : normalized.email, role: input.role, state: input.state, expectedUpdatedAt: input.expectedUpdatedAt };
}

export function normalizeLocale(locale: string): string {
  if (!locales.includes(locale as typeof locales[number])) return invalid();
  return locale;
}
