export type PlatformRole = 'participant' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'inactive' | 'locked';

const adminTransitions: Record<AccountStatus, readonly AccountStatus[]> = {
  pending: ['inactive', 'locked'],
  active: ['inactive', 'locked'],
  inactive: ['active', 'locked'],
  locked: ['active', 'inactive'],
};

export function canAdminTransitionStatus(current: AccountStatus, next: AccountStatus, emailVerified: boolean): boolean {
  if (current === next) return true;
  return adminTransitions[current].includes(next) && (next !== 'active' || emailVerified);
}

export function normalizeAccountName(value: string): string {
  const name = value.trim();
  if (name.length > 100) throw new Error('INVALID_NAME');
  return name;
}
export function normalizeEmail(email: string): string {
  const normalized = email.trim().normalize('NFKC').toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('INVALID_EMAIL');
  return normalized;
}
export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) throw new Error('PASSWORD_POLICY');
}
