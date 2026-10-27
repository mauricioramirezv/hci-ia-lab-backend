import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import type { Pool } from 'pg';

const config = { port: 3003, host: '127.0.0.1', logLevel: 'silent' as const, corsOrigins: ['https://lab.example.test'], nodeEnv: 'test', identityBaseUrl: 'http://identity.test', learningBaseUrl: 'http://learning.test', identityInternalToken: 'internal-fixture', database: { host: 'localhost', port: 5432, database: 'community_db', user: 'community_app', password: 'fixture_only_not_a_secret', max: 1, connectionTimeoutMillis: 100, ssl: false } };
const pool = { query: async () => { throw new Error('database should not be reached'); }, connect: async () => { throw new Error('database should not be reached'); } } as unknown as Pool;
const sessions = { resolve: async () => null };

describe('community API contracts', () => {
  it('publishes the versioned group, suggestion, catalog and reservation operations', async () => {
    const app = await createApp(config, { check: async () => true }, pool, sessions, { ownsWorkspace: async () => true });
    try {
      const spec = (await app.inject('/openapi.json')).json();
      for (const path of ['/v1/groups', '/v1/groups/{id}/invitations', '/v1/groups/{groupId}/workspaces/{workspaceId}', '/v1/suggestions', '/v1/suggestions/{id}/history', '/v1/reservation-services', '/v1/reservations', '/internal/v1/reservations/authorize']) expect(spec.paths[path]).toBeDefined();
      expect(spec.paths['/v1/reservations'].post.security).toEqual([{ sessionCookie: [], csrfHeader: [] }]);
      expect(spec.paths['/v1/reservations'].post.parameters.some((parameter: { name: string }) => parameter.name === 'idempotency-key')).toBe(true);
      expect(spec.components.schemas.Error.properties.code.enum).toContain('RESERVATION_CONFLICT');
      expect(spec.info.version).toBe('0.4.0');
      const result = await app.inject('/v1/groups');
      expect(result.statusCode).toBe(401);
      const internal = await app.inject('/internal/v1/groups/00000000-0000-4000-8000-000000000001/members/00000000-0000-4000-8000-000000000002');
      expect(internal.statusCode).toBe(401);
      const reservationAuth = await app.inject({ method: 'POST', url: '/internal/v1/reservations/authorize', payload: { accountId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002', reservationIds: [] } });
      expect(reservationAuth.statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
