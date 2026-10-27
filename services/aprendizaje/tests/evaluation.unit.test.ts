import { describe, expect, it } from 'vitest';
import { computeScore, normalizeDemoPatch, normalizeFinding, normalizeLocale, normalizeResponses, normalizeSession, type Instrument } from '../src/aprendizaje/domain/evaluation.js';

const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function instrument(type: 'SUS' | 'NASA_TLX'): Instrument {
  const count = type === 'SUS' ? 10 : 6;
  return {
    id: id(1), code: type, version: 1, locale: 'es-CO', name: type, type,
    formulaVersion: type === 'SUS' ? 'SUS-5PT-1.0' : 'RAW-TLX-MEAN-1.0',
    items: Array.from({ length: count }, (_, index) => ({
      id: id(index + 2), code: type === 'SUS' ? 'sus' + (index + 1) : ['mental', 'physical', 'temporal', 'performance', 'effort', 'frustration'][index],
      prompt: 'item', order: index + 1, minimum: type === 'SUS' ? 1 : 0, maximum: type === 'SUS' ? 5 : 100,
    })),
  };
}

describe('evaluation domain scoring and validation', () => {
  it('scores SUS from the ten alternating positive/negative responses', () => {
    const catalog = instrument('SUS');
    const maximum = catalog.items.map((item, index) => ({ itemId: item.id, value: index % 2 === 0 ? 5 : 1 }));
    const minimum = catalog.items.map((item, index) => ({ itemId: item.id, value: index % 2 === 0 ? 1 : 5 }));
    expect(computeScore(catalog, maximum)).toMatchObject({ code: 'sus_score', value: 100, formulaVersion: 'SUS-5PT-1.0' });
    expect(computeScore(catalog, minimum)?.value).toBe(0);
  });

  it('uses the frontend Raw TLX formula and keeps its formula version', () => {
    const catalog = instrument('NASA_TLX');
    const answers = catalog.items.map((item, index) => ({ itemId: item.id, value: [10, 20, 30, 40, 50, 60][index] }));
    expect(computeScore(catalog, answers)).toMatchObject({ code: 'raw_tlx_score', value: 35, formulaVersion: 'RAW-TLX-MEAN-1.0' });
  });

  it('rejects missing, repeated, out-of-range and formula-mismatched answers', () => {
    const catalog = instrument('SUS');
    const valid = catalog.items.map(item => ({ itemId: item.id, value: 3 }));
    expect(() => computeScore(catalog, valid.slice(1))).toThrow();
    expect(() => normalizeResponses([valid[0], valid[0]])).toThrow();
    expect(() => computeScore(catalog, valid.map((item, index) => index === 0 ? { ...item, value: 6 } : item))).toThrow();
    expect(() => computeScore({ ...catalog, formulaVersion: 'SUS-2.0' }, valid)).toThrow();
  });

  it('validates session scales, stable locale list and fictional findings', () => {
    expect(normalizeSession({ type: 'task', seq: 7, emotion: 4, seconds: 0, errors: 0 })).toMatchObject({ type: 'task', seq: 7 });
    expect(() => normalizeSession({ type: 'SUS' })).toThrow();
    expect(normalizeLocale('ca-ES')).toBe('ca-ES');
    expect(() => normalizeLocale('de-DE')).toThrow();
    expect(normalizeFinding({ sessionId: id(3), task: 'Task', severity: 4, problem: 'Issue', evidence: 'Observed', recommendation: 'Fix', source: 'human' })).toMatchObject({ state: 'pending' });
    expect(() => normalizeFinding({ task: 'Task', severity: 5, problem: 'Issue', evidence: 'Observed', recommendation: 'Fix', source: 'human' })).toThrow();
  });

  it('normalizes demo profile edits without converting the fictional user to a real account', () => {
    expect(normalizeDemoPatch({ expectedUpdatedAt: '2026-01-01T00:00:00Z', email: '  FICTICIO@example.test ' })).toMatchObject({ email: 'FICTICIO@example.test' });
    expect(() => normalizeDemoPatch({ expectedUpdatedAt: 'not-a-date' })).toThrow();
  });
});
