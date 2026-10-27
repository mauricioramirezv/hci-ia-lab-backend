export type Config = {
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  corsOrigins: string[];
  nodeEnv: string;
  cookieSecure: boolean;
  sameSite: 'lax' | 'none';
  sessionHours: number;
  webBaseUrl: string;
  identityInternalToken?: string;
  smtpUrl?: string;
  smtpFrom?: string;
  mailTransport: 'local' | 'smtp';
  developmentInboxUrl?: string;
  identityBaseUrl: string;
  learningBaseUrl: string;
  communityBaseUrl: string;
  evidenceBaseUrl: string;
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
const serviceOrigin = (key: string, fallback: string) => {
  const value = process.env[key]?.trim() || fallback;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Configuration error: ${key} is invalid`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`Configuration error: ${key} must be an origin`);
  return url.origin;
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
  const cookieSecure = flag('IDENTITY_COOKIE_SECURE');
  const sameSite = (process.env.IDENTITY_COOKIE_SAME_SITE ?? 'lax').toLowerCase();
  if (!['lax', 'none'].includes(sameSite)) throw new Error('Configuration error: IDENTITY_COOKIE_SAME_SITE is invalid');
  if (sameSite === 'none' && !cookieSecure) throw new Error('Configuration error: SameSite=None requires Secure cookies');
  if (nodeEnv === 'production' && !cookieSecure) throw new Error('Configuration error: production requires Secure cookies');
  const smtpUrl = process.env.IDENTITY_SMTP_URL?.trim();
  const smtpFrom = process.env.IDENTITY_SMTP_FROM?.trim();
  let smtpHost: string | undefined;
  if (smtpUrl) {
    try { smtpHost = new URL(smtpUrl).hostname; } catch { /* Detailed syntax error is reported below. */ }
  }
  const mailTransport = (process.env.IDENTITY_MAIL_TRANSPORT?.trim().toLowerCase() || (smtpUrl && smtpFrom ? 'smtp' : 'local'));
  if (!['local', 'smtp'].includes(mailTransport)) throw new Error('Configuration error: IDENTITY_MAIL_TRANSPORT is invalid');
  if (mailTransport === 'smtp' && (!smtpUrl || !smtpFrom)) throw new Error('Configuration error: smtp transport requires IDENTITY_SMTP_URL and IDENTITY_SMTP_FROM');
  if (nodeEnv === 'production' && mailTransport !== 'smtp') throw new Error('Configuration error: production requires IDENTITY_SMTP_URL and IDENTITY_SMTP_FROM (SMTP transport)');
  if (nodeEnv === 'production' && (!smtpUrl || !smtpFrom)) throw new Error('Configuration error: production requires IDENTITY_SMTP_URL and IDENTITY_SMTP_FROM');
  if (nodeEnv === 'production' && (smtpHost === 'mailpit' || ['localhost', '127.0.0.1', '[::1]'].includes(smtpHost ?? '') || smtpFrom?.toLowerCase().endsWith('.local'))) throw new Error('Configuration error: production cannot use a local SMTP host or sender');
  if (smtpUrl) {
    let transport: URL;
    try { transport = new URL(smtpUrl); } catch { throw new Error('Configuration error: IDENTITY_SMTP_URL is invalid'); }
    if (!['smtp:', 'smtps:'].includes(transport.protocol) || !transport.hostname) throw new Error('Configuration error: IDENTITY_SMTP_URL must use smtp or smtps');
  }
  const configuredDevelopmentInboxUrl = process.env.IDENTITY_DEVELOPMENT_INBOX_URL?.trim();
  const developmentInboxUrl = configuredDevelopmentInboxUrl || (nodeEnv === 'development' && smtpHost === 'mailpit' ? 'http://127.0.0.1:8025' : undefined);
  if (developmentInboxUrl) {
    let inbox: URL;
    try { inbox = new URL(developmentInboxUrl); } catch { throw new Error('Configuration error: IDENTITY_DEVELOPMENT_INBOX_URL is invalid'); }
    if (nodeEnv !== 'development' || inbox.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(inbox.hostname) || inbox.username || inbox.password) throw new Error('Configuration error: development inbox must be a loopback HTTP URL in development');
  }
  if (smtpFrom && (!smtpFrom.includes('@') || /[\r\n]/.test(smtpFrom))) throw new Error('Configuration error: IDENTITY_SMTP_FROM is invalid');
  const webBaseUrl = process.env.IDENTITY_WEB_BASE_URL?.trim() || 'http://localhost:5173';
  let webUrl: URL;
  try { webUrl = new URL(webBaseUrl); } catch { throw new Error('Configuration error: IDENTITY_WEB_BASE_URL is invalid'); }
  if (!['http:', 'https:'].includes(webUrl.protocol) || webUrl.username || webUrl.password || webUrl.search || webUrl.hash) throw new Error('Configuration error: IDENTITY_WEB_BASE_URL must be an HTTP(S) application base URL');
  if (nodeEnv === 'production' && webUrl.protocol !== 'https:') throw new Error('Configuration error: production web base URL must use HTTPS');
  const identityInternalToken = process.env.IDENTITY_INTERNAL_TOKEN?.trim();
  if (nodeEnv === 'production' && !identityInternalToken) throw new Error('Configuration error: production requires IDENTITY_INTERNAL_TOKEN');
  const learningBaseUrl = serviceOrigin('LEARNING_BASE_URL', 'http://localhost:3002');
  const communityBaseUrl = serviceOrigin('COMMUNITY_BASE_URL', 'http://localhost:3003');
  const evidenceBaseUrl = serviceOrigin('EVIDENCE_BASE_URL', 'http://localhost:3004');
  const identityBaseUrl = serviceOrigin('IDENTITY_BASE_URL', 'http://localhost:3001');
  return {
    port: integer('PORT', process.env.PORT ?? '3001', 1, 65535),
    host: process.env.HOST?.trim() || '127.0.0.1',
    logLevel: level as Config['logLevel'],
    corsOrigins: [...new Set(origins)],
    nodeEnv,
    cookieSecure,
    sameSite: sameSite as 'lax' | 'none',
    sessionHours: integer('IDENTITY_SESSION_HOURS', process.env.IDENTITY_SESSION_HOURS ?? '24', 1, 720),
    webBaseUrl: `${webUrl.origin}${webUrl.pathname.replace(/\/$/, '')}`,
    identityInternalToken,
    smtpUrl,
    smtpFrom,
    mailTransport: mailTransport as Config['mailTransport'],
    developmentInboxUrl,
    identityBaseUrl,
    learningBaseUrl,
    communityBaseUrl,
    evidenceBaseUrl,
    database: { host: required('POSTGRES_HOST'), port: integer('POSTGRES_PORT', required('POSTGRES_PORT'), 1, 65535), database: required('POSTGRES_DB'), user: required('POSTGRES_USER'), password: required('POSTGRES_PASSWORD'), max: 5, connectionTimeoutMillis: 1500, ssl: flag('POSTGRES_SSL') },
  };
}
