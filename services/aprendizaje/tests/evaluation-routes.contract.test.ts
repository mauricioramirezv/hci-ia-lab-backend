import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import type { Pool } from 'pg';

const config = {
  port: 3002, host: '127.0.0.1', logLevel: 'silent' as const, corsOrigins: ['https://lab.example.test'],
  nodeEnv: 'test', identityBaseUrl: 'http://identity.test', communityBaseUrl: 'http://community.test',
  identityInternalToken: 'internal-fixture',
  database: { host: 'localhost', port: 5432, database: 'learning_db', user: 'learning_app', password: 'fixture_only_not_a_secret', max: 1, connectionTimeoutMillis: 100, ssl: false },
};
const pool = { query: async () => { throw new Error('database should not be reached'); }, connect: async () => { throw new Error('database should not be reached'); } } as unknown as Pool;
const sessions = { resolve: async () => null };

describe('learning evaluation HTTP contracts', () => {
  it('publishes versioned evaluation, heuristic, demo-user and delivery-history operations', async () => {
    const app = await createApp(config, { check: async () => true }, pool, sessions);
    try {
      const spec = (await app.inject('/openapi.json')).json();
      expect(spec.paths['/v1/instruments']?.get).toBeDefined();
      expect(spec.paths['/v1/heuristics']?.get).toBeDefined();
      expect(spec.paths['/v1/workspaces/{workspaceId}/evaluation-sessions']?.post).toBeDefined();
      expect(spec.paths['/v1/evaluation-sessions/{id}/responses']?.post).toBeDefined();
      expect(spec.paths['/v1/workspaces/{workspaceId}/heuristic-findings']?.post).toBeDefined();
      expect(spec.paths['/v1/demo-users']?.post).toBeDefined();
      expect(spec.paths['/v1/executions/{id}/deliveries']?.get).toBeDefined();
      expect(spec.paths['/v1/groups/{groupId}/deliveries']?.get).toBeDefined();
      const read = await app.inject('/v1/workspaces/00000000-0000-4000-8000-000000000001/evaluation-sessions');
      expect(read.statusCode).toBe(401);
      expect(read.json().code).toBe('UNAUTHENTICATED');
      const write = await app.inject({
        method: 'POST', url: '/v1/workspaces/00000000-0000-4000-8000-000000000001/evaluation-sessions',
        headers: { cookie: 'hci_identity_session=bad', 'idempotency-key': '00000000-0000-4000-8000-000000000002' },
        payload: { type: 'task' },
      });
      expect(write.statusCode).toBe(403);
      expect(write.json().code).toBe('CSRF_INVALID');
    } finally { await app.close(); }
  });
});
