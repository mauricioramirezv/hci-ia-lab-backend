import { afterEach, describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
afterEach(() => vi.unstubAllEnvs());
describe('evidencias configuration', () => {
  it('rejects malformed origins, invalid retention periods and SSL flags', () => {
    vi.stubEnv('POSTGRES_HOST','localhost'); vi.stubEnv('POSTGRES_PORT','5432'); vi.stubEnv('POSTGRES_DB','evidence_db'); vi.stubEnv('POSTGRES_USER','evidence_app'); vi.stubEnv('POSTGRES_PASSWORD','fixture_not_a_secret');
    vi.stubEnv('CORS_ORIGINS','https://lab.example.test/path'); expect(() => loadConfig()).toThrow('exact origins');
    vi.stubEnv('CORS_ORIGINS','https://lab.example.test'); vi.stubEnv('EVIDENCE_RETENTION_DAYS','0'); expect(() => loadConfig()).toThrow('EVIDENCE_RETENTION_DAYS is invalid');
    vi.stubEnv('EVIDENCE_RETENTION_DAYS','90'); vi.stubEnv('POSTGRES_SSL','yes'); expect(() => loadConfig()).toThrow('POSTGRES_SSL is invalid');
  });
  it('defaults to 30 days and enforces the approved minimum', () => {
    vi.stubEnv('POSTGRES_HOST','localhost'); vi.stubEnv('POSTGRES_PORT','5432'); vi.stubEnv('POSTGRES_DB','evidence_db'); vi.stubEnv('POSTGRES_USER','evidence_app'); vi.stubEnv('POSTGRES_PASSWORD','fixture_not_a_secret'); vi.stubEnv('POSTGRES_SSL','false');
    vi.stubEnv('EVIDENCE_RETENTION_DAYS','');
    expect(loadConfig().evidenceRetentionDays).toBe(30);
    vi.stubEnv('EVIDENCE_RETENTION_DAYS','29');
    expect(() => loadConfig()).toThrow('EVIDENCE_RETENTION_DAYS is invalid');
    vi.stubEnv('EVIDENCE_RETENTION_DAYS','30');
    expect(loadConfig().evidenceRetentionDays).toBe(30);
    vi.stubEnv('EVIDENCE_RETENTION_DAYS','36500');
    expect(loadConfig().evidenceRetentionDays).toBe(36500);
  });
});
