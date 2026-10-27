import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import type { Pool } from 'pg';

const config = { port: 3002, host: '127.0.0.1', logLevel: 'silent' as const, corsOrigins: ['https://lab.example.test'], nodeEnv: 'test', identityBaseUrl: 'http://identity.test', identityInternalToken: 'internal-fixture', database: { host: 'localhost', port: 5432, database: 'learning_db', user: 'learning_app', password: 'fixture_only_not_a_secret', max: 1, connectionTimeoutMillis: 100, ssl: false } };
const pool = { query: async () => { throw new Error('database should not be reached'); }, connect: async () => { throw new Error('database should not be reached'); } } as unknown as Pool;
const sessions = { resolve: async () => null };

describe('learning private workflow contracts', () => {
  it('publishes OpenAPI routes and requires an authenticated session before persistence', async () => {
    const app = await createApp(config, { check: async () => true }, pool, sessions);
    try {
      const spec = (await app.inject('/openapi.json')).json();
      expect(spec.paths['/v1/activities']).toBeDefined();
      expect(spec.paths['/v1/workspaces']).toBeDefined();
      expect(spec.paths['/v1/executions']).toBeDefined();
      expect(spec.paths['/v1/executions/{id}/deliveries']).toBeDefined();
      const result = await app.inject('/v1/workspaces');
      expect(result.statusCode).toBe(401);
      expect(result.json().code).toBe('UNAUTHENTICATED');
      const write = await app.inject({ method: 'POST', url: '/v1/workspaces', payload: { name: 'Private workspace' }, headers: { 'idempotency-key': '00000000-0000-4000-8000-000000000003', cookie: 'hci_identity_session=bad' } });
      expect(write.statusCode).toBe(403);
      expect(write.json().code).toBe('CSRF_INVALID');
    } finally { await app.close(); }
  });
});

