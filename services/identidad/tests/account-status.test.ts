import { describe, expect, it } from 'vitest';
import { canAdminTransitionStatus, type AccountStatus } from '../src/identidad/domain/account.js';

describe('explicit administrative account status transitions', () => {
  const statuses: AccountStatus[] = ['pending', 'active', 'inactive', 'locked'];

  it('allows unchanged states and the declared administrative transitions only', () => {
    const allowed: Record<AccountStatus, AccountStatus[]> = {
      pending: ['pending', 'inactive', 'locked'],
      active: ['active', 'inactive', 'locked'],
      inactive: ['inactive', 'active', 'locked'],
      locked: ['locked', 'active', 'inactive'],
    };
    for (const current of statuses) for (const next of statuses) {
      expect(canAdminTransitionStatus(current, next, true)).toBe(allowed[current].includes(next));
    }
  });

  it('requires verified email to administratively activate an inactive or locked account', () => {
    expect(canAdminTransitionStatus('inactive', 'active', false)).toBe(false);
    expect(canAdminTransitionStatus('locked', 'active', false)).toBe(false);
    expect(canAdminTransitionStatus('inactive', 'active', true)).toBe(true);
    expect(canAdminTransitionStatus('locked', 'active', true)).toBe(true);
  });

  it('reserves pending-to-active for the one-time email verification flow', () => {
    expect(canAdminTransitionStatus('pending', 'active', false)).toBe(false);
    expect(canAdminTransitionStatus('pending', 'active', true)).toBe(false);
  });
});
