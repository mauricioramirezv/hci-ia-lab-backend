export type Config = {
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  corsOrigins: string[];
  nodeEnv: string;
  identityBaseUrl: string;
  communityBaseUrl: string;
  evidenceBaseUrl: string;
  identityInternalToken?: string;
  database: { host: string; port: number; database: string; user: string; password: string; max: number; connectionTimeoutMillis: number; ssl: boolean };
};

const flag = (key: string) => {
  const value = (process.env[key] ?? 'false').toLowerCase();
  if (!['true', 'false'].includes(value)) throw new Error(`Configuration error: ${key} is invalid`);
  return value === 'true';
};
const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Configuration error: ${key} is required`);
  return value;
};
const integer = (key: string, value: string, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Configuration error: ${key} is invalid`);
  return parsed;
};

export function loadConfig(): Config {
  const level = process.env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(level)) throw new Error('Configuration error: LOG_LEVEL is invalid');
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('Configuration error: CORS_ORIGINS must contain exact origins'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error('Configuration error: CORS_ORIGINS must contain exact origins');
  }
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const identityBaseUrl = process.env.IDENTITY_BASE_URL?.trim() || 'http://localhost:3001';
  let identityUrl: URL;
  try { identityUrl = new URL(identityBaseUrl); } catch { throw new Error('Configuration error: IDENTITY_BASE_URL is invalid'); }
  if (!['http:', 'https:'].includes(identityUrl.protocol) || identityUrl.username || identityUrl.password || identityUrl.pathname !== '/' || identityUrl.search || identityUrl.hash) throw new Error('Configuration error: IDENTITY_BASE_URL must be an origin');
  const communityBaseUrl = process.env.COMMUNITY_BASE_URL?.trim() || 'http://localhost:3003';
  let communityUrl: URL;
  try { communityUrl = new URL(communityBaseUrl); } catch { throw new Error('Configuration error: COMMUNITY_BASE_URL is invalid'); }
  if (!['http:', 'https:'].includes(communityUrl.protocol) || communityUrl.username || communityUrl.password || communityUrl.pathname !== '/' || communityUrl.search || communityUrl.hash) throw new Error('Configuration error: COMMUNITY_BASE_URL must be an origin');
  const evidenceBaseUrl = process.env.EVIDENCE_BASE_URL?.trim() || 'http://localhost:3004';
  let evidenceUrl: URL;
  try { evidenceUrl = new URL(evidenceBaseUrl); } catch { throw new Error('Configuration error: EVIDENCE_BASE_URL is invalid'); }
  if (!['http:', 'https:'].includes(evidenceUrl.protocol) || evidenceUrl.username || evidenceUrl.password || evidenceUrl.pathname !== '/' || evidenceUrl.search || evidenceUrl.hash) throw new Error('Configuration error: EVIDENCE_BASE_URL must be an origin');
  const identityInternalToken = process.env.IDENTITY_INTERNAL_TOKEN?.trim();
  if (nodeEnv === 'production' && !identityInternalToken) throw new Error('Configuration error: production requires IDENTITY_INTERNAL_TOKEN');
  return {
    port: integer('PORT', process.env.PORT ?? '3002', 1, 65535),
    host: process.env.HOST?.trim() || '127.0.0.1',
    logLevel: level as Config['logLevel'],
    corsOrigins: [...new Set(origins)],
    nodeEnv,
    identityBaseUrl: identityUrl.origin,
    communityBaseUrl: communityUrl.origin,
    evidenceBaseUrl: evidenceUrl.origin,
    identityInternalToken,
    database: { host: required('POSTGRES_HOST'), port: integer('POSTGRES_PORT', required('POSTGRES_PORT'), 1, 65535), database: required('POSTGRES_DB'), user: required('POSTGRES_USER'), password: required('POSTGRES_PASSWORD'), max: 5, connectionTimeoutMillis: 1500, ssl: flag('POSTGRES_SSL') },
  };
}

