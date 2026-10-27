import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { CommunityApplication } from '../src/comunidad/application/use-cases.js';
import { PostgresCommunityRepository } from '../src/comunidad/infrastructure/postgres-community.js';

const enabled = process.env.TEST_POSTGRES === '1';
const suite = enabled ? describe : describe.skip;
const utcDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

suite('community PostgreSQL workflows', () => {
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), database: process.env.COMUNIDAD_DB, user: process.env.COMUNIDAD_USER, password: process.env.COMUNIDAD_PASSWORD, max: 4 });
  const repository = new PostgresCommunityRepository(pool);
  const workspaces = { ownsWorkspace: async () => true };
  const community = new CommunityApplication(repository, workspaces);
  const leader = randomUUID(), member = randomUUID(), foreign = randomUUID(), otherLeader = randomUUID();
  const groupIds: string[] = [], suggestionIds: string[] = [], reservationIds: string[] = [], actorIds = [leader, member, foreign, otherLeader];

  afterAll(async () => {
    for (const id of suggestionIds) await pool.query('DELETE FROM community.historial_sugerencia WHERE sugerencia_id=$1', [id]);
    if (suggestionIds.length) await pool.query('DELETE FROM community.sugerencia WHERE sugerencia_id=ANY($1::uuid[])', [suggestionIds]);
    if (reservationIds.length) await pool.query('DELETE FROM community.reserva WHERE reserva_id=ANY($1::uuid[])', [reservationIds]);
    if (groupIds.length) {
      await pool.query('DELETE FROM community.espacio_trabajo_grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
      await pool.query('DELETE FROM community.invitacion_grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
      await pool.query('DELETE FROM community.membresia_grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
      await pool.query('DELETE FROM community.grupo WHERE grupo_id=ANY($1::uuid[])', [groupIds]);
    }
    await pool.query('DELETE FROM community.write_idempotency WHERE actor_id=ANY($1::uuid[])', [actorIds]);
    await pool.end();
  });

  it('uses local leadership, one-use invitations, recipient binding and expiration', async () => {
    const key = randomUUID();
    const created = await community.createGroup(leader, 'Synthetic group', 'Temporary fixture', key) as { item: { id: string }; replayed: boolean };
    groupIds.push(created.item.id);
    const replay = await community.createGroup(leader, 'Synthetic group', 'Temporary fixture', key) as typeof created;
    expect(replay).toMatchObject({ item: { id: created.item.id }, replayed: true });
    await expect(community.createGroup(leader, 'Different name', undefined, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await repository.membership(created.item.id, leader)).toEqual({ active: true, role: 'leader' });
    await expect(community.createInvitation(created.item.id, foreign, null, randomBytes(32).toString('hex'), new Date(Date.now() + 60_000))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const code = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(code).digest('hex');
    await community.createInvitation(created.item.id, leader, 'member@example.invalid', hash, new Date(Date.now() + 60_000));
    expect(await community.acceptInvitation(member, 'MEMBER@example.invalid', hash)).toMatchObject({ groupId: created.item.id, replayed: false });
    expect(await community.acceptInvitation(member, 'member@example.invalid', hash)).toMatchObject({ groupId: created.item.id, replayed: true });
    await pool.query("UPDATE community.invitacion_grupo SET creada_en=now()-interval '2 minutes',expira_en=now()-interval '1 minute' WHERE codigo_hash=$1", [hash]);
    expect(await community.acceptInvitation(member, 'member@example.invalid', hash)).toMatchObject({ groupId: created.item.id, replayed: true });
    expect(await community.acceptInvitation(foreign, 'foreign@example.invalid', hash)).toBeNull();
    expect(await repository.membership(created.item.id, member)).toEqual({ active: true, role: 'participant' });
    expect((await community.listGroups(foreign, 20, 0)).items).toEqual([]);
    const expiredHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await pool.query("INSERT INTO community.invitacion_grupo(grupo_id,codigo_hash,creada_por,creada_en,expira_en) VALUES($1,$2,$3,now()-interval '2 minutes',now()-interval '1 minute')", [created.item.id, expiredHash, leader]);
    expect(await community.acceptInvitation(foreign, 'foreign@example.invalid', expiredHash)).toBeNull();
    const other = await community.createGroup(otherLeader, 'Other group', undefined, randomUUID()) as { item: { id: string } };
    groupIds.push(other.item.id);
    expect(await repository.removeMember(created.item.id, otherLeader, member)).toBe(false);
    expect(await repository.removeMember(created.item.id, leader, member)).toBe(true);
  });

  it('keeps anonymous suggestion attribution in storage, hides it in views and versions history atomically', async () => {
    const created = await community.createSuggestion(member, 'accessibility', 'Synthetic suggestion', 'Improve keyboard focus visibility.', true, randomUUID());
    suggestionIds.push(created.item.id);
    expect(created.item.authorId).toBeNull();
    const stored = await pool.query('SELECT autor_id,anonima FROM community.sugerencia WHERE sugerencia_id=$1', [created.item.id]);
    expect(stored.rows).toEqual([{ autor_id: member, anonima: true }]);
    expect((await community.listSuggestions(foreign, false, 10, 0)).items).toEqual([]);
    expect((await community.listSuggestions(leader, true, 100, 0)).items.find(item => item.id === created.item.id)?.authorId).toBeNull();
    const updated = await community.updateSuggestion(leader, true, created.item.id, 1, 'reviewing', 'Queued for review.');
    expect(updated).toMatchObject({ status: 'reviewing', version: 2, authorId: null });
    const history = await community.listSuggestionHistory(member, false, created.item.id, 10, 0);
    expect(history?.items).toHaveLength(1);
    await expect(community.updateSuggestion(leader, false, created.item.id, 2, 'accepted')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const concurrent = await Promise.allSettled([
      community.updateSuggestion(leader, true, created.item.id, 2, 'accepted'),
      community.updateSuggestion(otherLeader, true, created.item.id, 2, 'rejected'),
    ]);
    expect(concurrent.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter(item => item.status === 'rejected')).toHaveLength(1);
  });

  it('checks share ownership and keeps reservation duplicates safe under concurrent requests', async () => {
    const group = await community.createGroup(leader, 'Reservation group', undefined, randomUUID()) as { item: { id: string } };
    groupIds.push(group.item.id);
    const workspaceId = randomUUID();
    await community.shareWorkspace(group.item.id, leader, workspaceId);
    expect((await community.listSharedWorkspaces(group.item.id, leader, 10, 0)).items).toHaveLength(1);
    const now = new Date(), future = new Date(now.getTime() + 48 * 60 * 60 * 1000), date = utcDay(future);
    const request = { workspaceId, serviceCode: 'advice' as const, date, time: '12:00', condition: 'good' as const };
    const idempotencyKey = randomUUID();
    const first = await community.createReservation(member, request, idempotencyKey);
    reservationIds.push((first.item as { id: string }).id);
    const replay = await community.createReservation(member, request, idempotencyKey);
    expect(replay.replayed).toBe(true);
    await expect(community.createReservation(member, { ...request, condition: 'bad' }, idempotencyKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    const duplicateKeys = [randomUUID(), randomUUID()], concurrentRequest = { ...request, workspaceId: randomUUID() };
    const concurrent = await Promise.allSettled(duplicateKeys.map(key => community.createReservation(foreign, concurrentRequest, key)));
    const successful = concurrent.filter(item => item.status === 'fulfilled') as PromiseFulfilledResult<{ item: { id: string }; replayed: boolean }>[];
    const failed = concurrent.filter(item => item.status === 'rejected');
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    reservationIds.push(successful[0].value.item.id);
    const reservation = first.item as { id: string; version: number };
    const canceled = await community.cancelReservation(member, reservation.id, reservation.version) as { status: string; version: number };
    expect(canceled).toMatchObject({ status: 'cancelled', version: 2 });
    const replacement = await community.createReservation(member, request, randomUUID());
    reservationIds.push((replacement.item as { id: string }).id);
    const foreignList = await community.listReservations(leader, 10, 0);
    expect(foreignList.items.some(item => (item as { id: string }).id === reservation.id)).toBe(false);
    await expect(new CommunityApplication(repository, { ownsWorkspace: async () => false }).createReservation(member, { ...request, date: utcDay(new Date(future.getTime() + 24 * 60 * 60 * 1000)) }, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
