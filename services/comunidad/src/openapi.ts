import type { OpenAPIV3_1 } from 'openapi-types';

export const schemas = {
  Liveness: { type: 'object', additionalProperties: false, required: ['status', 'service'], properties: { status: { const: 'ok' }, service: { const: 'comunidad' } } },
  Readiness: { type: 'object', additionalProperties: false, required: ['status', 'service', 'dependencies'], properties: { status: { const: 'ok' }, service: { const: 'comunidad' }, dependencies: { type: 'object', required: ['postgres'], properties: { postgres: { const: 'ok' } } } } },
  Error: { type: 'object', additionalProperties: false, required: ['code', 'requestId'], properties: { code: { type: 'string', enum: ['INVALID_REQUEST', 'INVALID_INPUT', 'NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN', 'CSRF_INVALID', 'INVITATION_INVALID_OR_EXPIRED', 'IDEMPOTENCY_KEY_REUSED', 'RESERVATION_CONFLICT', 'VERSION_CONFLICT', 'STATE_CONFLICT', 'RESOURCE_NOT_FOUND', 'DEPENDENCY_UNAVAILABLE', 'RATE_LIMITED', 'ROUTE_NOT_FOUND', 'METHOD_NOT_ALLOWED', 'INTERNAL_ERROR'] }, requestId: { type: 'string' } } },
  Page: { type: 'object', required: ['items', 'total', 'limit', 'offset'], properties: { items: { type: 'array', items: {} }, total: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } } },
} satisfies Record<string, OpenAPIV3_1.SchemaObject>;
