import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { CommunityRepository, GroupSummary, Page, SuggestionItem } from '../application/use-cases.js';
import { CommunityError } from '../application/use-cases.js';
import type { ReservationInput, ReservationItem, SuggestionState } from '../domain/community.js';

const suggestionProjection = `s.sugerencia_id AS id,s.categoria AS category,s.titulo AS title,s.descripcion AS description,s.anonima AS anonymous,CASE WHEN s.anonima THEN NULL ELSE s.autor_id END AS "authorId",s.estado AS status,s.version AS version,s.creada_en AS "createdAt",s.actualizada_en AS "updatedAt"`;
const reservationProjection = `r.reserva_id AS id,r.espacio_id AS "workspaceId",r.creada_por AS "createdBy",r.servicio_codigo AS "serviceCode",r.servicio_etiqueta AS "serviceLabel",r.fecha::text AS date,to_char(r.hora,'HH24:MI') AS time,r.estado AS status,r.condicion AS condition,r.version AS version,r.creada_en AS "createdAt",r.actualizada_en AS "updatedAt"`;
const hashBody = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function claim(client: PoolClient, actorId: string, operation: string, key: string, input: unknown) {
  const digest = hashBody(input);
  const inserted = await client.query(
    'INSERT INTO community.write_idempotency(actor_id,operation,idempotency_key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,operation,idempotency_key) DO NOTHING RETURNING idempotency_key',
    [actorId, operation, key, digest],
  );
  if (inserted.rowCount) return { replayed: false, response: null as unknown };
  const previous = await client.query('SELECT request_hash,response_data FROM community.write_idempotency WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3 FOR UPDATE', [actorId, operation, key]);
  if (!previous.rowCount || previous.rows[0].request_hash !== digest) throw new CommunityError('IDEMPOTENCY_KEY_REUSED');
  return { replayed: true, response: previous.rows[0].response_data as unknown };
}
async function complete(client: PoolClient, actorId: string, operation: string, key: string, response: unknown) {
  await client.query('UPDATE community.write_idempotency SET response_data=$4 WHERE actor_id=$1 AND operation=$2 AND idempotency_key=$3', [actorId, operation, key, JSON.stringify(response)]);
}
async function begin(pool: Pool) { const client = await pool.connect(); await client.query('BEGIN'); return client; }
async function rollback(client: PoolClient) { await client.query('ROLLBACK'); }
async function commit(client: PoolClient) { await client.query('COMMIT'); }
const pageResult = <T>(items: T[], total: number, limit: number, offset: number): Page<T> => ({ items, total, limit, offset });

export class PostgresCommunityRepository implements CommunityRepository {
  constructor(private readonly pool: Pool) {}

  async createGroup(accountId: string, name: string, description: string | null, key: string) {
    const client = await begin(this.pool);
    try {
      const claimResult = await claim(client, accountId, 'group.create', key, { name, description });
      if (claimResult.replayed) { await commit(client); return { item: claimResult.response, replayed: true }; }
      const created = await client.query('INSERT INTO community.grupo(nombre,descripcion,creado_por) VALUES($1,$2,$3) RETURNING grupo_id AS id,nombre AS name,descripcion AS description,estado AS status,creado_en AS "createdAt"', [name, description, accountId]);
      await client.query("INSERT INTO community.membresia_grupo(grupo_id,cuenta_id,funcion,estado,unido_en) VALUES($1,$2,'leader','active',now())", [created.rows[0].id, accountId]);
      await complete(client, accountId, 'group.create', key, created.rows[0]);
      await commit(client);
      return { item: created.rows[0], replayed: false };
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }
  async listGroups(accountId: string, limit: number, offset: number): Promise<Page<GroupSummary>> {
    const [items, count] = await Promise.all([
      this.pool.query("SELECT g.grupo_id AS id,g.nombre AS name,g.descripcion AS description,m.funcion AS role,m.unido_en AS \"joinedAt\" FROM community.grupo g JOIN community.membresia_grupo m ON m.grupo_id=g.grupo_id WHERE m.cuenta_id=$1 AND m.estado='active' AND g.estado='active' ORDER BY g.creado_en DESC,g.grupo_id LIMIT $2 OFFSET $3", [accountId, limit, offset]),
      this.pool.query("SELECT count(*)::int AS total FROM community.grupo g JOIN community.membresia_grupo m ON m.grupo_id=g.grupo_id WHERE m.cuenta_id=$1 AND m.estado='active' AND g.estado='active'", [accountId]),
    ]);
    return pageResult(items.rows, count.rows[0].total, limit, offset);
  }
  async listMembers(groupId: string, actorId: string, limit: number, offset: number) {
    const authorized = await this.pool.query("SELECT 1 FROM community.membresia_grupo m JOIN community.grupo g ON g.grupo_id=m.grupo_id WHERE m.grupo_id=$1 AND m.cuenta_id=$2 AND m.estado='active' AND g.estado='active'", [groupId, actorId]);
    if (!authorized.rowCount) return null;
    const [items, count] = await Promise.all([
      this.pool.query("SELECT cuenta_id AS \"accountId\",funcion AS role,unido_en AS \"joinedAt\" FROM community.membresia_grupo WHERE grupo_id=$1 AND estado='active' ORDER BY unido_en,cuenta_id LIMIT $2 OFFSET $3", [groupId, limit, offset]),
      this.pool.query("SELECT count(*)::int AS total FROM community.membresia_grupo WHERE grupo_id=$1 AND estado='active'", [groupId]),
    ]);
    return pageResult(items.rows, count.rows[0].total, limit, offset);
  }
  async isLeader(groupId: string, accountId: string) {
    const result = await this.pool.query("SELECT 1 FROM community.membresia_grupo m JOIN community.grupo g ON g.grupo_id=m.grupo_id WHERE m.grupo_id=$1 AND m.cuenta_id=$2 AND m.funcion='leader' AND m.estado='active' AND g.estado='active'", [groupId, accountId]);
    return !!result.rowCount;
  }
  async createInvitation(groupId: string, accountId: string, email: string | null, hash: string, expiresAt: Date) {
    const result = await this.pool.query("INSERT INTO community.invitacion_grupo(grupo_id,codigo_hash,correo_destino,creada_por,expira_en) SELECT g.grupo_id,$4,$3,$2,$5 FROM community.grupo g JOIN community.membresia_grupo m ON m.grupo_id=g.grupo_id WHERE g.grupo_id=$1 AND g.estado='active' AND m.cuenta_id=$2 AND m.funcion='leader' AND m.estado='active' RETURNING invitacion_id", [groupId, accountId, email, hash, expiresAt]);
    return result.rows[0] ? { id: result.rows[0].invitacion_id as string } : null;
  }
  async listInvitations(groupId: string, actorId: string, limit: number, offset: number) {
    if (!await this.isLeader(groupId, actorId)) return null;
    const [items, count] = await Promise.all([
      this.pool.query(`SELECT invitacion_id AS id,correo_destino AS email,creada_en AS "createdAt",expira_en AS "expiresAt",CASE WHEN revocada_en IS NOT NULL THEN 'revoked' WHEN aceptada_en IS NOT NULL THEN 'accepted' WHEN expira_en <= now() THEN 'expired' ELSE 'pending' END AS status FROM community.invitacion_grupo WHERE grupo_id=$1 ORDER BY creada_en DESC,invitacion_id LIMIT $2 OFFSET $3`, [groupId, limit, offset]),
      this.pool.query('SELECT count(*)::int AS total FROM community.invitacion_grupo WHERE grupo_id=$1', [groupId]),
    ]);
    return pageResult(items.rows, count.rows[0].total, limit, offset);
  }
  async canReportWorkspace(accountId: string, workspaceId: string) {
    const result = await this.pool.query("SELECT 1 FROM community.espacio_trabajo_grupo s JOIN community.grupo g ON g.grupo_id=s.grupo_id JOIN community.membresia_grupo m ON m.grupo_id=g.grupo_id WHERE s.espacio_id=$2 AND s.revocado_en IS NULL AND g.estado='active' AND m.cuenta_id=$1 AND m.estado='active' AND m.funcion='leader' LIMIT 1", [accountId, workspaceId]);
    return !!result.rowCount;
  }
  async snapshotReservations(workspaceId: string, ids: string[]) {
    const result = await this.pool.query(`SELECT ${reservationProjection} FROM community.reserva r WHERE r.espacio_id=$1 AND r.reserva_id=ANY($2::uuid[]) ORDER BY r.reserva_id`, [workspaceId, ids]);
    return result.rows as Array<{ id: string; version: number; [key: string]: unknown }>;
  }
  async acceptInvitation(accountId: string, email: string, hash: string) {
    const client = await begin(this.pool);
    try {
      const result = await client.query("SELECT invitacion_id,grupo_id,correo_destino,aceptada_por,revocada_en,expira_en FROM community.invitacion_grupo WHERE codigo_hash=$1 FOR UPDATE", [hash]);
      const invitation = result.rows[0];
      if (!invitation || invitation.revocada_en || (invitation.correo_destino && invitation.correo_destino.toLowerCase() !== email)) { await rollback(client); return null; }
      if (invitation.aceptada_por) {
        if (invitation.aceptada_por === accountId) { await commit(client); return { groupId: invitation.grupo_id, replayed: true }; }
        await rollback(client); return null;
      }
      if (new Date(invitation.expira_en) <= new Date()) { await rollback(client); return null; }
      const active = await client.query("SELECT estado FROM community.grupo WHERE grupo_id=$1 AND estado='active' FOR UPDATE", [invitation.grupo_id]);
      if (!active.rowCount) { await rollback(client); return null; }
      await client.query("INSERT INTO community.membresia_grupo(grupo_id,cuenta_id,funcion,estado,invitado_por,unido_en) VALUES($1,$2,'participant','active',(SELECT creada_por FROM community.invitacion_grupo WHERE invitacion_id=$3),now()) ON CONFLICT(grupo_id,cuenta_id) DO UPDATE SET estado='active',funcion=CASE WHEN community.membresia_grupo.estado='active' THEN community.membresia_grupo.funcion ELSE 'participant' END,unido_en=CASE WHEN community.membresia_grupo.estado='active' THEN community.membresia_grupo.unido_en ELSE now() END,retirado_en=NULL,invitado_por=EXCLUDED.invitado_por", [invitation.grupo_id, accountId, invitation.invitacion_id]);
      await client.query('UPDATE community.invitacion_grupo SET aceptada_por=$2,aceptada_en=now() WHERE invitacion_id=$1', [invitation.invitacion_id, accountId]);
      await commit(client); return { groupId: invitation.grupo_id, replayed: false };
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }
  async removeMember(groupId: string, actorId: string, accountId: string) {
    const result = await this.pool.query("UPDATE community.membresia_grupo target SET estado='removed',retirado_en=now() FROM community.grupo g WHERE target.grupo_id=g.grupo_id AND target.grupo_id=$1 AND target.cuenta_id=$3 AND target.funcion='participant' AND target.estado='active' AND g.estado='active' AND EXISTS(SELECT 1 FROM community.membresia_grupo actor WHERE actor.grupo_id=g.grupo_id AND actor.cuenta_id=$2 AND actor.funcion='leader' AND actor.estado='active') RETURNING target.cuenta_id", [groupId, actorId, accountId]);
    return !!result.rowCount;
  }
  async revokeInvitation(groupId: string, actorId: string, invitationId: string) {
    const result = await this.pool.query("UPDATE community.invitacion_grupo i SET revocada_en=now() FROM community.grupo g WHERE i.grupo_id=g.grupo_id AND i.grupo_id=$1 AND i.invitacion_id=$3 AND i.revocada_en IS NULL AND i.aceptada_en IS NULL AND g.estado='active' AND EXISTS(SELECT 1 FROM community.membresia_grupo actor WHERE actor.grupo_id=g.grupo_id AND actor.cuenta_id=$2 AND actor.funcion='leader' AND actor.estado='active') RETURNING i.invitacion_id", [groupId, actorId, invitationId]);
    return !!result.rowCount;
  }
  async listSharedWorkspaces(groupId: string, actorId: string, limit: number, offset: number) {
    const authorized = await this.pool.query("SELECT 1 FROM community.membresia_grupo m JOIN community.grupo g ON g.grupo_id=m.grupo_id WHERE m.grupo_id=$1 AND m.cuenta_id=$2 AND m.estado='active' AND g.estado='active'", [groupId, actorId]);
    if (!authorized.rowCount) return null;
    const [items, count] = await Promise.all([
      this.pool.query('SELECT espacio_id AS "workspaceId",compartido_por AS "sharedBy",compartido_en AS "sharedAt" FROM community.espacio_trabajo_grupo WHERE grupo_id=$1 AND revocado_en IS NULL ORDER BY compartido_en DESC,espacio_id LIMIT $2 OFFSET $3', [groupId, limit, offset]),
      this.pool.query('SELECT count(*)::int AS total FROM community.espacio_trabajo_grupo WHERE grupo_id=$1 AND revocado_en IS NULL', [groupId]),
    ]);
    return pageResult(items.rows, count.rows[0].total, limit, offset);
  }
  async shareWorkspace(groupId: string, actorId: string, workspaceId: string) {
    const inserted = await this.pool.query("INSERT INTO community.espacio_trabajo_grupo(espacio_id,grupo_id,compartido_por) SELECT $3,$1,$2 WHERE EXISTS(SELECT 1 FROM community.membresia_grupo WHERE grupo_id=$1 AND cuenta_id=$2 AND funcion='leader' AND estado='active') AND EXISTS(SELECT 1 FROM community.grupo WHERE grupo_id=$1 AND estado='active') ON CONFLICT(espacio_id,grupo_id) DO UPDATE SET compartido_por=EXCLUDED.compartido_por,compartido_en=now(),revocado_en=NULL WHERE community.espacio_trabajo_grupo.revocado_en IS NOT NULL RETURNING espacio_id", [groupId, actorId, workspaceId]);
    if (inserted.rowCount) return true;
    const existing = await this.pool.query("SELECT 1 FROM community.espacio_trabajo_grupo s JOIN community.membresia_grupo m ON m.grupo_id=s.grupo_id WHERE s.espacio_id=$3 AND s.grupo_id=$1 AND s.revocado_en IS NULL AND m.cuenta_id=$2 AND m.funcion='leader' AND m.estado='active'", [groupId, actorId, workspaceId]);
    return !!existing.rowCount;
  }
  async revokeWorkspace(groupId: string, actorId: string, workspaceId: string) {
    const result = await this.pool.query("UPDATE community.espacio_trabajo_grupo s SET revocado_en=now() WHERE s.grupo_id=$1 AND s.espacio_id=$3 AND s.revocado_en IS NULL AND EXISTS(SELECT 1 FROM community.membresia_grupo m JOIN community.grupo g ON g.grupo_id=m.grupo_id WHERE m.grupo_id=s.grupo_id AND m.cuenta_id=$2 AND m.funcion='leader' AND m.estado='active' AND g.estado='active') RETURNING s.espacio_id", [groupId, actorId, workspaceId]);
    return !!result.rowCount;
  }
  async createSuggestion(accountId: string, category: string, title: string, description: string, anonymous: boolean, key: string) {
    const client = await begin(this.pool);
    try {
      const claimResult = await claim(client, accountId, 'suggestion.create', key, { category, title, description, anonymous });
      if (claimResult.replayed) { await commit(client); return { item: claimResult.response as SuggestionItem, replayed: true }; }
      const result = await client.query(`INSERT INTO community.sugerencia AS s(autor_id,categoria,titulo,descripcion,anonima) VALUES($1,$2,$3,$4,$5) RETURNING ${suggestionProjection}`, [accountId, category, title, description, anonymous]);
      const item = result.rows[0] as SuggestionItem;
      await complete(client, accountId, 'suggestion.create', key, item);
      await commit(client); return { item, replayed: false };
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }
  async listSuggestions(accountId: string, moderator: boolean, limit: number, offset: number) {
    const filter = moderator ? '' : 'WHERE autor_id=$1';
    const params = moderator ? [limit, offset] : [accountId, limit, offset];
    const [items, count] = await Promise.all([
      this.pool.query(`SELECT ${suggestionProjection} FROM community.sugerencia s ${filter} ORDER BY s.creada_en DESC,s.sugerencia_id LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      this.pool.query(`SELECT count(*)::int AS total FROM community.sugerencia ${moderator ? '' : 'WHERE autor_id=$1'}`, moderator ? [] : [accountId]),
    ]);
    return pageResult(items.rows as SuggestionItem[], count.rows[0].total, limit, offset);
  }
  async getSuggestion(accountId: string, moderator: boolean, id: string) {
    const result = await this.pool.query(`SELECT ${suggestionProjection} FROM community.sugerencia s WHERE s.sugerencia_id=$1 AND ($2::boolean OR s.autor_id=$3)`, [id, moderator, accountId]);
    return result.rows[0] as SuggestionItem | undefined ?? null;
  }
  async listSuggestionHistory(accountId: string, moderator: boolean, id: string, limit: number, offset: number) {
    const authorized = await this.pool.query('SELECT 1 FROM community.sugerencia WHERE sugerencia_id=$1 AND ($2::boolean OR autor_id=$3)', [id, moderator, accountId]);
    if (!authorized.rowCount) return null;
    const [items, count] = await Promise.all([
      this.pool.query('SELECT historial_id AS id,estado_anterior AS "previousStatus",estado_nuevo AS "newStatus",respuesta AS response,cambiado_por AS "changedBy",cambiado_en AS "changedAt" FROM community.historial_sugerencia WHERE sugerencia_id=$1 ORDER BY cambiado_en DESC,historial_id DESC LIMIT $2 OFFSET $3', [id, limit, offset]),
      this.pool.query('SELECT count(*)::int AS total FROM community.historial_sugerencia WHERE sugerencia_id=$1', [id]),
    ]);
    return pageResult(items.rows, count.rows[0].total, limit, offset);
  }
  async updateSuggestion(accountId: string, id: string, expectedVersion: number, status: SuggestionState, response: string | null) {
    const client = await begin(this.pool);
    try {
      const current = await client.query('SELECT estado,version FROM community.sugerencia WHERE sugerencia_id=$1 FOR UPDATE', [id]);
      if (!current.rowCount || current.rows[0].version !== expectedVersion) { await rollback(client); return null; }
      const updated = await client.query(`UPDATE community.sugerencia AS s SET estado=$2,actualizada_en=now(),version=version+1 WHERE sugerencia_id=$1 AND version=$3 RETURNING ${suggestionProjection}`, [id, status, expectedVersion]);
      if (!updated.rowCount) { await rollback(client); return null; }
      await client.query('INSERT INTO community.historial_sugerencia(sugerencia_id,cambiado_por,estado_anterior,estado_nuevo,respuesta) VALUES($1,$2,$3,$4,$5)', [id, accountId, current.rows[0].estado, status, response]);
      await commit(client); return updated.rows[0] as SuggestionItem;
    } catch (error) { await rollback(client); throw error; } finally { client.release(); }
  }
  async listReservationServices() {
    const result = await this.pool.query('SELECT servicio_codigo AS code,contexto AS context,activo AS active FROM community.servicio_reserva WHERE activo=true ORDER BY servicio_codigo');
    return result.rows;
  }
  async setReservationServiceActive(code: string, active: boolean) {
    const result = await this.pool.query('UPDATE community.servicio_reserva SET activo=$2 WHERE servicio_codigo=$1 RETURNING servicio_codigo', [code, active]);
    return !!result.rowCount;
  }
  async listReservations(accountId: string, limit: number, offset: number) {
    const [items, count] = await Promise.all([
      this.pool.query(`SELECT ${reservationProjection} FROM community.reserva r WHERE r.creada_por=$1 ORDER BY r.fecha DESC,r.hora DESC,r.reserva_id LIMIT $2 OFFSET $3`, [accountId, limit, offset]),
      this.pool.query('SELECT count(*)::int AS total FROM community.reserva WHERE creada_por=$1', [accountId]),
    ]);
    return pageResult(items.rows as ReservationItem[], count.rows[0].total, limit, offset);
  }
  async reservationWorkspace(accountId: string, id: string) {
    const result = await this.pool.query('SELECT espacio_id AS id FROM community.reserva WHERE reserva_id=$1 AND creada_por=$2', [id, accountId]);
    return result.rows[0]?.id ?? null;
  }
  async createReservation(accountId: string, input: ReservationInput, key: string) {
    const client = await begin(this.pool);
    try {
      const claimResult = await claim(client, accountId, 'reservation.create', key, input);
      if (claimResult.replayed) { await commit(client); return { item: claimResult.response, replayed: true }; }
      let label = input.serviceLabel?.trim() ?? input.serviceCode ?? '';
      if (input.serviceCode) {
        const service = await client.query('SELECT servicio_codigo FROM community.servicio_reserva WHERE servicio_codigo=$1 AND activo=true FOR SHARE', [input.serviceCode]);
        if (!service.rowCount) throw new CommunityError('NOT_FOUND');
        label = input.serviceLabel?.trim() || input.serviceCode;
      }
      const result = await client.query(`INSERT INTO community.reserva AS r(espacio_id,creada_por,servicio_codigo,servicio_etiqueta,fecha,hora,condicion,clave_idempotencia,request_hash) VALUES($1,$2,$3,$4,$5::date,$6::time,$7,$8,$9) RETURNING ${reservationProjection}`, [input.workspaceId, accountId, input.serviceCode ?? null, label, input.date, input.time, input.condition ?? null, key, hashBody(input)]);
      await complete(client, accountId, 'reservation.create', key, result.rows[0]);
      await commit(client); return { item: result.rows[0] as ReservationItem, replayed: false };
    } catch (error) {
      await rollback(client);
      if (isReservationUnique(error)) return null;
      throw error;
    } finally { client.release(); }
  }
  async updateReservation(accountId: string, id: string, expectedVersion: number, input: { serviceCode?: ReservationInput['serviceCode']; serviceLabel?: string; date?: string; time?: string; condition?: ReservationInput['condition'] }) {
    const client = await begin(this.pool);
    try {
      const current = await client.query(`SELECT ${reservationProjection} FROM community.reserva r WHERE r.reserva_id=$1 AND r.creada_por=$2 FOR UPDATE`, [id, accountId]);
      if (!current.rowCount) { await rollback(client); return null; }
      const before = current.rows[0] as ReservationItem;
      if (before.status !== 'confirmed' || before.version !== expectedVersion) { await rollback(client); return null; }
      const serviceCode = input.serviceCode ?? before.serviceCode;
      let serviceLabel = input.serviceLabel?.trim() ?? before.serviceLabel;
      if (input.serviceCode) {
        const service = await client.query('SELECT servicio_codigo FROM community.servicio_reserva WHERE servicio_codigo=$1 AND activo=true FOR SHARE', [input.serviceCode]);
        if (!service.rowCount) throw new CommunityError('NOT_FOUND');
        if (!input.serviceLabel) serviceLabel = input.serviceCode;
      }
      const date = input.date ?? before.date, time = input.time ?? before.time;
      const updated = await client.query(`UPDATE community.reserva r SET servicio_codigo=$3,servicio_etiqueta=$4,fecha=$5::date,hora=$6::time,condicion=$7,actualizada_en=now(),version=version+1 WHERE r.reserva_id=$1 AND r.creada_por=$2 AND r.version=$8 AND r.estado='confirmed' RETURNING ${reservationProjection}`, [id, accountId, serviceCode, serviceLabel, date, time, input.condition ?? before.condition, expectedVersion]);
      if (!updated.rowCount) { await rollback(client); return null; }
      await commit(client); return updated.rows[0] as ReservationItem;
    } catch (error) {
      await rollback(client);
      if (isReservationUnique(error)) throw new CommunityError('RESERVATION_CONFLICT');
      throw error;
    } finally { client.release(); }
  }
  async cancelReservation(accountId: string, id: string, expectedVersion: number) {
    const result = await this.pool.query(`UPDATE community.reserva r SET estado='cancelled',actualizada_en=now(),version=version+1 WHERE r.reserva_id=$1 AND r.creada_por=$2 AND r.estado='confirmed' AND r.version=$3 RETURNING ${reservationProjection}`, [id, accountId, expectedVersion]);
    return result.rows[0] as ReservationItem | undefined ?? null;
  }
  async membership(groupId: string, accountId: string) {
    const result = await this.pool.query("SELECT m.funcion AS role FROM community.membresia_grupo m JOIN community.grupo g ON g.grupo_id=m.grupo_id WHERE m.grupo_id=$1 AND m.cuenta_id=$2 AND m.estado='active' AND g.estado='active'", [groupId, accountId]);
    return { active: !!result.rowCount, role: result.rows[0]?.role ?? null };
  }
  async ownsReservations(accountId: string, workspaceId: string, reservationIds: string[]) {
    const unique = [...new Set(reservationIds)];
    if (!unique.length) return true;
    const result = await this.pool.query('SELECT count(DISTINCT reserva_id)::int AS count FROM community.reserva WHERE creada_por=$1 AND espacio_id=$2 AND reserva_id=ANY($3::uuid[])', [accountId, workspaceId, unique]);
    return result.rows[0].count === unique.length;
  }

}

function isReservationUnique(error: unknown) {
  const pgError = error as { code?: string; constraint?: string };
  return pgError?.code === '23505' && ['reserva_catalogo_confirmada_uq', 'reserva_legacy_confirmada_uq', 'reserva_account_idempotency_uq'].includes(pgError.constraint ?? '');
}
