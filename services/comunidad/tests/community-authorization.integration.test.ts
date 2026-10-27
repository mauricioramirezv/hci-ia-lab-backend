import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Principal } from '../src/comunidad/application/session.js';
import { createApp } from '../src/app.js';

const enabled = process.env.TEST_POSTGRES === '1';
const suite = enabled ? describe : describe.skip;

suite('community session and group authorization (PostgreSQL)', () => {
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.COMUNIDAD_DB, user: process.env.COMUNIDAD_USER, password: process.env.COMUNIDAD_PASSWORD, max: 2 });
  const leaderId = randomUUID(), participantId = randomUUID(), teacherId = randomUUID(), adminId = randomUUID(), inactiveId = randomUUID();
  const groupIds: string[] = [], actors = [leaderId, participantId, teacherId, adminId, inactiveId];
  const principals = new Map<string, Principal>([
    ['leader-token', { id: leaderId, email: 'leader@example.invalid', globalRoles: ['participant'], permissions: [], status: 'active' }],
    ['participant-token', { id: participantId, email: 'participant@example.invalid', globalRoles: ['participant'], permissions: [], status: 'active' }],
    ['teacher-token', { id: teacherId, email: 'teacher@example.invalid', globalRoles: ['teacher'], permissions: ['group:manage'], status: 'active' }],
    ['admin-token', { id: adminId, email: 'admin@example.invalid', globalRoles: ['administrator'], permissions: ['account:manage'], status: 'active' }],
    ['inactive-token', { id: inactiveId, email: 'inactive@example.invalid', globalRoles: ['participant'], permissions: [], status: 'inactive' } as unknown as Principal],
  ]);
  const config = { port: 3003, host: '127.0.0.1', logLevel: 'silent' as const, corsOrigins: ['https://lab.example.test'], nodeEnv: 'test', identityBaseUrl: 'http://identity.test', learningBaseUrl: 'http://learning.test', identityInternalToken: 'test-internal-token', database: { host: 'localhost', port: 5432, database: process.env.COMUNIDAD_DB ?? 'community_db', user: process.env.COMUNIDAD_USER ?? 'community_app', password: process.env.COMUNIDAD_PASSWORD ?? 'local-fixture', max: 2, connectionTimeoutMillis: 500, ssl: false } };
  const sessions = { resolve: async (token: string) => principals.get(token) ?? null };
  const appPromise = createApp(config, { check: async () => true }, pool, sessions, { ownsWorkspace: async () => true });
  const actorHeaders = (token: string) => ({ origin: 'https://lab.example.test', cookie: `hci_identity_session=${token}; hci_identity_csrf=csrf-${token}`, 'x-csrf-token': `csrf-${token}`, 'content-type': 'application/json' });

  afterAll(async () => {
    if (groupIds.length) {
      await pool.query('DELETE FROM community.invitacion_grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
      await pool.query('DELETE FROM community.membresia_grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
      await pool.query('DELETE FROM community.grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
    }
    await pool.query('DELETE FROM community.write_idempotency WHERE actor_id=ANY($1::uuid[])', [actors]);
    await (await appPromise).close();
    await pool.end();
  });

  it('requires an active session and CSRF, then enforces group-local leadership despite global roles', async () => {
    const app = await appPromise;
    const noSession = await app.inject({ method: 'POST', url: '/v1/groups', headers: { 'idempotency-key': randomUUID() }, payload: { name: 'No account' } });
    expect(noSession.statusCode).toBe(401);
    const inactive = await app.inject({ method: 'POST', url: '/v1/groups', headers: { ...actorHeaders('inactive-token'), 'idempotency-key': randomUUID() }, payload: { name: 'Inactive account' } });
    expect(inactive.statusCode).toBe(401);
    const noCsrf = await app.inject({ method: 'POST', url: '/v1/groups', headers: { cookie: 'hci_identity_session=leader-token', origin: 'https://lab.example.test', 'idempotency-key': randomUUID() }, payload: { name: 'No CSRF' } });
    expect(noCsrf.statusCode).toBe(403);

    const created = await app.inject({ method: 'POST', url: '/v1/groups', headers: { ...actorHeaders('leader-token'), 'idempotency-key': randomUUID() }, payload: { name: 'Route authorization group' } });
    expect(created.statusCode).toBe(201);
    const { item } = created.json() as { item: { id: string } };
    groupIds.push(item.id);
    const teacherInvite = await app.inject({ method: 'POST', url: `/v1/groups/${item.id}/invitations`, headers: actorHeaders('teacher-token'), payload: {} });
    expect(teacherInvite.statusCode).toBe(403);
    const adminInvite = await app.inject({ method: 'POST', url: `/v1/groups/${item.id}/invitations`, headers: actorHeaders('admin-token'), payload: {} });
    expect(adminInvite.statusCode).toBe(403);
    const foreignMembers = await app.inject({ method: 'GET', url: `/v1/groups/${item.id}/members`, headers: { cookie: 'hci_identity_session=teacher-token' } });
    expect(foreignMembers.statusCode).toBe(404);

    const invite = await app.inject({ method: 'POST', url: `/v1/groups/${item.id}/invitations`, headers: actorHeaders('leader-token'), payload: { email: 'participant@example.invalid' } });
    expect(invite.statusCode).toBe(201);
    const { token } = invite.json() as { token: string };
    const accepted = await app.inject({ method: 'POST', url: '/v1/group-invitations/accept', headers: actorHeaders('participant-token'), payload: { token } });
    expect(accepted.statusCode).toBe(201);
    const replayed = await app.inject({ method: 'POST', url: '/v1/group-invitations/accept', headers: actorHeaders('participant-token'), payload: { token } });
    expect(replayed.statusCode).toBe(200);
    const members = await app.inject({ method: 'GET', url: `/v1/groups/${item.id}/members`, headers: { cookie: 'hci_identity_session=participant-token' } });
    expect(members.statusCode).toBe(200);
    expect(members.json().items).toHaveLength(2);
  });
});
