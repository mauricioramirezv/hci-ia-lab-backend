import type { OpenAPIV3_1 } from 'openapi-types';

export const schemas = {
  Liveness: { type: 'object', additionalProperties: false, required: ['status', 'service'], properties: { status: { const: 'ok' }, service: { const: 'identidad' } } },
  Readiness: { type: 'object', additionalProperties: false, required: ['status', 'service', 'dependencies'], properties: { status: { const: 'ok' }, service: { const: 'identidad' }, dependencies: { type: 'object', required: ['postgres'], properties: { postgres: { const: 'ok' } } } } },
  Account: { type: 'object', required: ['id', 'email', 'displayName', 'platformRole', 'globalRoles', 'permissions', 'emailVerified', 'status', 'version'], properties: {
    id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, displayName: { type: 'string' }, lastName: { type: ['string', 'null'], maxLength: 100 }, 
    platformRole: { type: 'string', enum: ['participant', 'admin'] }, globalRoles: { type: 'array', items: { type: 'string', enum: ['administrator', 'participant', 'teacher', 'evaluator'] } },
    permissions: { type: 'array', items: { type: 'string' } }, emailVerified: { type: 'boolean' }, status: { type: 'string', enum: ['pending', 'active', 'inactive', 'locked'] }, version: { type: 'integer', minimum: 1 },
  } },
  CurrentSession: { type: 'object', additionalProperties: false, required: ['account', 'csrfToken'], properties: { account: { $ref: 'Account#' }, csrfToken: { type: 'string', minLength: 1, maxLength: 256, description: 'Session-bound anti-CSRF value. It is not an access token; keep only in browser memory.' } } },
  BrowserSession: { type: 'object', additionalProperties: false, required: ['account', 'csrfToken', 'expiresAt'], properties: { account: { $ref: 'Account#' }, csrfToken: { type: 'string', minLength: 1, maxLength: 256 }, expiresAt: { type: 'string', format: 'date-time' } } },
  Error: { type: 'object', additionalProperties: false, required: ['code', 'requestId'], properties: { code: { type: 'string', enum: [
    'INVALID_REQUEST', 'INVALID_EMAIL', 'INVALID_NAME', 'PASSWORD_POLICY', 'INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'FORBIDDEN', 'CSRF_INVALID', 'TOKEN_INVALID_OR_EXPIRED',
    'VERSION_CONFLICT', 'LAST_ADMIN', 'LAST_ADMIN_REQUIRED', 'EMAIL_NOT_VERIFIED', 'INVALID_ROLE', 'ACCOUNT_NOT_FOUND', 'RATE_LIMITED', 'ROUTE_NOT_FOUND', 'METHOD_NOT_ALLOWED', 'DEPENDENCY_UNAVAILABLE', 'INTERNAL_ERROR',
  ] }, requestId: { type: 'string' } } },
} satisfies Record<string, OpenAPIV3_1.SchemaObject>;
