export type Config = {
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  corsOrigins: string[];
  nodeEnv: string;
  identityBaseUrl: string;
  learningBaseUrl: string;
  evidenceBaseUrl?: string;
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
function serviceOrigin(key: string, value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Configuration error: ${key} is invalid`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`Configuration error: ${key} must be an origin`);
  return url.origin;
}

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
  const identityBaseUrl = serviceOrigin('IDENTITY_BASE_URL', process.env.IDENTITY_BASE_URL?.trim() || 'http://localhost:3001');
  const learningBaseUrl = serviceOrigin('LEARNING_BASE_URL', process.env.LEARNING_BASE_URL?.trim() || 'http://localhost:3002');
  const identityInternalToken = process.env.IDENTITY_INTERNAL_TOKEN?.trim();
  if (nodeEnv === 'production' && !identityInternalToken) throw new Error('Configuration error: production requires IDENTITY_INTERNAL_TOKEN');
  return {
    port: integer('PORT', process.env.PORT ?? '3003', 1, 65535),
    host: process.env.HOST?.trim() || '127.0.0.1',
    logLevel: level as Config['logLevel'], corsOrigins: [...new Set(origins)], nodeEnv,
    identityBaseUrl, learningBaseUrl, evidenceBaseUrl: serviceOrigin('EVIDENCE_BASE_URL', process.env.EVIDENCE_BASE_URL?.trim() || 'http://localhost:3004'), identityInternalToken,
    database: { host: required('POSTGRES_HOST'), port: integer('POSTGRES_PORT', required('POSTGRES_PORT'), 1, 65535), database: required('POSTGRES_DB'), user: required('POSTGRES_USER'), password: required('POSTGRES_PASSWORD'), max: 5, connectionTimeoutMillis: 1500, ssl: flag('POSTGRES_SSL') },
  };
}
