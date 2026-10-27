import { describe, expect, it } from 'vitest';
import { canTransitionSuggestion, reservationValidation } from '../src/comunidad/domain/community.js';

describe('community domain policies', () => {
  it('applies catalog reservation date and time rules in the product timezone', () => {
    const now = new Date('2026-04-10T16:00:00.000Z');
    const base = { workspaceId: '00000000-0000-4000-8000-000000000001', serviceCode: 'advice' as const, date: '2026-04-10', time: '10:00' };
    expect(reservationValidation(base, now)).toBe('INVALID_INPUT');
    expect(reservationValidation({ ...base, date: '2026-04-12', time: '10:00' }, now)).toBeNull();
    expect(reservationValidation({ ...base, date: '2026-04-12', time: '25:00' }, now)).toBe('INVALID_INPUT');
    expect(reservationValidation({ ...base, date: '2026-02-30', time: '10:00' }, now)).toBe('INVALID_INPUT');
  });

  it('allows only forward suggestion review transitions', () => {
    expect(canTransitionSuggestion('received', 'reviewing')).toBe(true);
    expect(canTransitionSuggestion('reviewing', 'accepted')).toBe(true);
    expect(canTransitionSuggestion('accepted', 'implemented')).toBe(true);
    expect(canTransitionSuggestion('implemented', 'reviewing')).toBe(false);
    expect(canTransitionSuggestion('rejected', 'accepted')).toBe(false);
  });
});
