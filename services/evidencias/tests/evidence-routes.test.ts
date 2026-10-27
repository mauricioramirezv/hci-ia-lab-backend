import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import type { Pool } from 'pg';

const config = { port: 3004, host: '127.0.0.1', logLevel: 'silent' as const, corsOrigins: ['https://lab.example.test'], nodeEnv: 'test', identityBaseUrl: 'http://identity.test', learningBaseUrl: 'http://learning.test', communityBaseUrl: 'http://community.test', identityInternalToken: 'internal-fixture', database: { host: 'localhost', port: 5432, database: 'evidence_db', user: 'evidence_app', password: 'fixture_only_not_a_secret', max: 1, connectionTimeoutMillis: 100, ssl: false } };
const pool = { query: async () => { throw new Error('database should not be reached'); }, connect: async () => { throw new Error('database should not be reached'); } } as unknown as Pool;
const sessions = { resolve: async () => null };

describe('Evidence API and privacy contracts', () => {
  it('documents consent, events, calibration, accessibility, files and typed reports', async () => {
    const app = await createApp(config, { check: async () => true }, pool, sessions);
    try {
      const spec = (await app.inject('/openapi.json')).json();
      for (const path of ['/v1/ux-sessions','/v1/ux-sessions/{id}/consents','/v1/ux-sessions/{id}/events','/v1/ux-sessions/{id}/calibration','/v1/workspaces/{workspaceId}/accessibility-checks/{code}','/v1/executions/{executionId}/files','/v1/reports']) expect(spec.paths[path]).toBeDefined();
      expect(spec.paths['/v1/ux-sessions/{id}/events'].get.operationId).toBe('listUxSessionEvents');
      expect(spec.paths['/v1/ux-sessions/{id}/events'].post.parameters.some((parameter: { name: string }) => parameter.name === 'idempotency-key')).toBe(true);
      expect(spec.components.schemas.Error.properties.code.enum).toContain('CONSENT_REQUIRED');
      const result = await app.inject({ method: 'POST', url: '/v1/ux-sessions', headers: { 'idempotency-key': 'session-key' }, payload: { executionId: '00000000-0000-4000-8000-000000000001', type: 'page', route: '/concepts', mode: 'none', source: 'measured', documentWidth: 800, documentHeight: 1200, viewportWidth: 800, viewportHeight: 700, durationMs: 100, maxDepthPercent: 10, consent: { purpose: 'aggregate_metrics', noticeVersion: '1', granted: true } } });
      expect(result.statusCode).toBe(401);
      expect(result.json().code).toBe('UNAUTHENTICATED');
    } finally { await app.close(); }
  });
});
