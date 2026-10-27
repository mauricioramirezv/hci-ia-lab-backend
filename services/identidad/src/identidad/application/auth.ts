import { canAdminTransitionStatus, normalizeAccountName, normalizeEmail, validatePassword } from '../domain/account.js';
import type { AccountStatus } from '../domain/account.js';

export interface DbResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}
export interface DbClient {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<DbResult<T>>;
}
export interface DbPool extends DbClient {
  transaction<T>(work: (client: DbClient) => Promise<T>): Promise<T>;
}
export interface AuthCrypto {
  hashPassword(value: string): Promise<string>;
  verifyPassword(value: string, hash: string): Promise<boolean>;
  newToken(): string;
  tokenHash(value: string): string;
  dummyPasswordHash: string;
}
export interface MailPort {
  send(message: { to: string; subject: string; link: string }): Promise<void>;
}
export interface IdentityMail { to: string; subject: string; link: string }
export interface LocalMailOutbox extends MailPort { readonly messages: IdentityMail[] }

export type GlobalRole = 'administrator' | 'participant' | 'teacher' | 'evaluator';
export type Account = {
  id: string;
  email: string;
  displayName: string;
  lastName?: string | null;
  platformRole: 'participant' | 'admin';
  globalRoles: GlobalRole[];
  permissions: string[];
  emailVerified: boolean;
  status: AccountStatus;
  version: number;
};

type IdentityRow = {
  id: string;
  email: string;
  display_name: string;
  last_name: string | null;
  password_hash?: string;
  email_verified_at: Date | null;
  status: AccountStatus;
  version: number;
  global_roles: GlobalRole[];
  permissions: string[];
};
type AdminOutcome = 'OK' | 'NOT_FOUND' | 'CONFLICT' | 'LAST_ADMIN' | 'EMAIL_NOT_VERIFIED' | 'INVALID_ROLE' | 'INVALID_STATUS_TRANSITION';
const roleCodes: GlobalRole[] = ['administrator', 'participant', 'teacher', 'evaluator'];
const identitySelect = `
  SELECT a.id,a.email,a.name AS display_name,a.last_name,a.password_hash,a.email_verified_at,a.status,a.version,
    COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM identity.account_roles ar JOIN identity.roles r ON r.id=ar.role_id WHERE ar.account_id=a.id),'{}'::text[]) AS global_roles,
    COALESCE((SELECT array_agg(DISTINCT p.code ORDER BY p.code) FROM identity.account_roles ar JOIN identity.role_permissions rp ON rp.role_id=ar.role_id JOIN identity.permissions p ON p.id=rp.permission_id WHERE ar.account_id=a.id),'{}'::text[]) AS permissions
  FROM identity.accounts a`;
const toAccount = (row: IdentityRow): Account => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  lastName: row.last_name ?? null,
  platformRole: row.global_roles.includes('administrator') ? 'admin' : 'participant',
  globalRoles: row.global_roles,
  permissions: row.permissions,
  emailVerified: row.email_verified_at !== null,
  status: row.status,
  version: row.version,
});

export class AuthApplication {
  constructor(
    private readonly db: DbPool,
    private readonly crypto: AuthCrypto,
    private readonly mailer: MailPort,
    private readonly webBase: string,
    private readonly sessionHours: number,
  ) {}

  private link(kind: string, token: string) {
    return `${this.webBase.replace(/\/$/, '')}/#/cuenta?${kind}=${encodeURIComponent(token)}`;
  }

  async register(email: string, password: string, displayName: string, lastName?: string) {
    const normalized = normalizeEmail(email);
    validatePassword(password);
    const name = normalizeAccountName(displayName);
    const surname = lastName === undefined ? null : normalizeAccountName(lastName);
    if (lastName !== undefined && (!name || !surname)) throw new Error('INVALID_NAME');
    const hash = await this.crypto.hashPassword(password);
    const token = this.crypto.newToken();
    const created = await this.db.transaction(async client => {
      const result = await client.query<{ id: string; email: string }>(
        'INSERT INTO identity.accounts(email,email_normalized,password_hash,display_name,name,status,last_name) VALUES($1,$2,$3,$4,$4,\'pending\',$5) ON CONFLICT(email_normalized) DO NOTHING RETURNING id,email',
        [email.trim(), normalized, hash, name, surname],
      );
      if (!result.rowCount) return null;
      await client.query("INSERT INTO identity.account_roles(account_id,role_id) SELECT $1,id FROM identity.roles WHERE code='participant'", [result.rows[0].id]);
      await client.query("INSERT INTO identity.one_time_tokens(account_id,purpose,token_hash,expires_at) VALUES($1,'verify_email',$2,now()+interval '24 hours')", [result.rows[0].id, this.crypto.tokenHash(token)]);
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1,'account.registered','account',$2,'success')", [result.rows[0].id, result.rows[0].id]);
      return result.rows[0];
    });
    if (created) {
      await this.mailer.send({ to: created.email, subject: 'Verifica tu correo · HCI Lab + IA', link: this.link('verify', token) });
      return;
    }

    // Keep registration responses indistinguishable, while making a repeated
    // registration useful when the existing account is still pending.
    await this.resendVerification(email);
  }

  async resendVerification(email: string) {
    let normalized: string;
    try { normalized = normalizeEmail(email); } catch { return; }
    const token = this.crypto.newToken();
    const pending = await this.db.transaction(async client => {
      const account = await client.query<{ id: string; email: string }>(
        "SELECT id,email FROM identity.accounts WHERE email_normalized=$1 AND status='pending' AND email_verified_at IS NULL FOR UPDATE",
        [normalized],
      );
      if (!account.rowCount) return null;
      await client.query("UPDATE identity.one_time_tokens SET consumed_at=now() WHERE account_id=$1 AND purpose='verify_email' AND consumed_at IS NULL", [account.rows[0].id]);
      await client.query("INSERT INTO identity.one_time_tokens(account_id,purpose,token_hash,expires_at) VALUES($1,'verify_email',$2,now()+interval '24 hours')", [account.rows[0].id, this.crypto.tokenHash(token)]);
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1::uuid,'account.verification_resent','account',$1::text,'success')", [account.rows[0].id]);
      return account.rows[0];
    });
    if (pending) await this.mailer.send({ to: pending.email, subject: 'Verifica tu correo · HCI Lab + IA', link: this.link('verify', token) });
  }

  async verify(token: string) {
    const hash = this.crypto.tokenHash(token);
    return this.db.transaction(async client => {
      const candidate = await client.query<{ account_id: string }>("SELECT account_id FROM identity.one_time_tokens WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now()", [hash]);
      if (!candidate.rowCount) return false;
      const accountId = candidate.rows[0].account_id;
      const account = await client.query<{ id: string }>("SELECT id FROM identity.accounts WHERE id=$1 AND status='pending' AND disabled_at IS NULL FOR UPDATE", [accountId]);
      if (!account.rowCount) return false;
      const consumed = await client.query("UPDATE identity.one_time_tokens SET consumed_at=now() WHERE token_hash=$1 AND account_id=$2 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now() RETURNING account_id", [hash, accountId]);
      if (!consumed.rowCount) return false;
      const activated = await client.query("UPDATE identity.accounts SET email_verified_at=now(),status='active',updated_at=now(),version=version+1 WHERE id=$1 AND status='pending' AND disabled_at IS NULL RETURNING id", [accountId]);
      if (!activated.rowCount) return false;
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1::uuid,'account.email_verified','account',$1::text,'success')", [accountId]);
      return true;
    });
  }

  async login(email: string, password: string, csrf: string) {
    const normalized = normalizeEmail(email);
    const result = await this.db.query<IdentityRow>(`${identitySelect} WHERE a.email_normalized=$1`, [normalized]);
    const row = result.rows[0];
    const valid = await this.crypto.verifyPassword(password, row?.password_hash ?? this.crypto.dummyPasswordHash);
    if (!row || !valid || row.status !== 'active' || !row.email_verified_at) return null;
    const session = this.crypto.newToken();
    const expires = new Date(Date.now() + this.sessionHours * 3600000);
    await this.db.transaction(async client => {
      await client.query('INSERT INTO identity.sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4)', [row.id, this.crypto.tokenHash(session), this.crypto.tokenHash(csrf), expires]);
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1,'session.created','session',$2,'success')", [row.id, row.id]);
    });
    return { token: session, expires, account: toAccount(row) };
  }

  async current(sessionToken: string) {
    const result = await this.db.query<IdentityRow>(`${identitySelect} JOIN identity.sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active' AND a.email_verified_at IS NOT NULL`, [this.crypto.tokenHash(sessionToken)]);
    if (!result.rowCount) return null;
    await this.db.query('UPDATE identity.sessions SET last_seen_at=now() WHERE token_hash=$1', [this.crypto.tokenHash(sessionToken)]);
    return toAccount(result.rows[0]);
  }

  async isAccountActive(accountId: string) {
    const result = await this.db.query("SELECT 1 FROM identity.accounts WHERE id=$1 AND status='active' AND email_verified_at IS NOT NULL", [accountId]);
    return result.rowCount === 1;
  }

  async sessionValid(sessionToken: string, csrf: string) {
    const result = await this.db.query(`SELECT 1 FROM identity.sessions s JOIN identity.accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.csrf_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active'`, [this.crypto.tokenHash(sessionToken), this.crypto.tokenHash(csrf)]);
    return result.rowCount === 1;
  }

  async logout(sessionToken: string) {
    await this.db.query(`WITH revoked AS (UPDATE identity.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING account_id)
      INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome)
      SELECT account_id,'session.revoked','session',account_id::text,'success' FROM revoked`, [this.crypto.tokenHash(sessionToken)]);
  }

  async updateProfile(id: string, version: number, displayName: string, lastName?: string) {
    return this.db.transaction(async client => {
      const result = await client.query<{ version: number }>('UPDATE identity.accounts SET name=$3,display_name=$3,last_name=COALESCE($4,last_name),updated_at=now(),version=version+1 WHERE id=$1 AND version=$2 AND status=\'active\' RETURNING version', [id, version, normalizeAccountName(displayName), lastName === undefined ? null : normalizeAccountName(lastName)]);
      if (!result.rowCount) return null;
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1,'account.profile_updated','account',$2,'success')", [id, id]);
      return result.rows[0].version;
    });
  }

  async requestReset(email: string) {
    let normalized: string;
    try { normalized = normalizeEmail(email); } catch { return; }
    const result = await this.db.query<{ id: string; email: string }>('SELECT id,email FROM identity.accounts WHERE email_normalized=$1 AND status=\'active\' AND email_verified_at IS NOT NULL', [normalized]);
    if (!result.rowCount) return;
    const token = this.crypto.newToken();
    await this.db.transaction(async client => {
      await client.query("UPDATE identity.one_time_tokens SET consumed_at=now() WHERE account_id=$1 AND purpose='reset_password' AND consumed_at IS NULL", [result.rows[0].id]);
      await client.query("INSERT INTO identity.one_time_tokens(account_id,purpose,token_hash,expires_at) VALUES($1,'reset_password',$2,now()+interval '30 minutes')", [result.rows[0].id, this.crypto.tokenHash(token)]);
    });
    await this.mailer.send({ to: result.rows[0].email, subject: 'Recuperación de contraseña · HCI Lab + IA', link: this.link('reset', token) });
  }

  async completeReset(token: string, password: string) {
    validatePassword(password);
    const hash = await this.crypto.hashPassword(password);
    return this.db.transaction(async client => {
      const consumed = await client.query<{ account_id: string }>("UPDATE identity.one_time_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>now() RETURNING account_id", [this.crypto.tokenHash(token)]);
      if (!consumed.rowCount) return false;
      const accountId = consumed.rows[0].account_id;
      const updated = await client.query("UPDATE identity.accounts SET password_hash=$2,updated_at=now(),version=version+1 WHERE id=$1 AND status='active'", [accountId, hash]);
      if (!updated.rowCount) return false;
      await client.query('UPDATE identity.sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL', [accountId]);
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1,'account.password_reset','account',$2,'success')", [accountId, accountId]);
      return true;
    });
  }

  async adminList(limit: number, offset: number) {
    const result = await this.db.query<IdentityRow & { created_at: Date; last_name: string | null }>(`
      SELECT a.id,a.email,a.name AS display_name,a.email_verified_at,a.status,a.version,a.created_at,a.last_name,
        COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM identity.account_roles ar JOIN identity.roles r ON r.id=ar.role_id WHERE ar.account_id=a.id),'{}'::text[]) AS global_roles,
        COALESCE((SELECT array_agg(DISTINCT p.code ORDER BY p.code) FROM identity.account_roles ar JOIN identity.role_permissions rp ON rp.role_id=ar.role_id JOIN identity.permissions p ON p.id=rp.permission_id WHERE ar.account_id=a.id),'{}'::text[]) AS permissions
      FROM identity.accounts a ORDER BY a.created_at DESC,a.id LIMIT $1 OFFSET $2`, [limit, offset]);
    return result.rows;
  }

  async adminUpdateRoles(id: string, roles: string[], status: AccountStatus, version: number, actorId: string): Promise<AdminOutcome> {
    if (roles.some(role => !roleCodes.includes(role as GlobalRole))) return 'INVALID_ROLE';
    const nextRoles = [...new Set<GlobalRole>(['participant', ...(roles as GlobalRole[])])];
    return this.db.transaction(async client => {
      await client.query('LOCK TABLE identity.account_roles IN SHARE ROW EXCLUSIVE MODE');
      const existing = await client.query<{ status: AccountStatus; email_verified_at: Date | null; version: number }>('SELECT status,email_verified_at,version FROM identity.accounts WHERE id=$1 FOR UPDATE', [id]);
      if (!existing.rowCount) return 'NOT_FOUND';
      const old = existing.rows[0];
      const oldRoles = await client.query<{ code: GlobalRole }>('SELECT r.code FROM identity.account_roles ar JOIN identity.roles r ON r.id=ar.role_id WHERE ar.account_id=$1', [id]);
      const currentRoles = oldRoles.rows.map(row => row.code);
      if (old.version !== version) return 'CONFLICT';
      if (status === 'active' && !old.email_verified_at) return 'EMAIL_NOT_VERIFIED';
      if (!canAdminTransitionStatus(old.status, status, old.email_verified_at !== null)) return 'INVALID_STATUS_TRANSITION';
      const wasAdmin = currentRoles.includes('administrator');
      const remainsAdmin = nextRoles.includes('administrator') && status === 'active';
      if (wasAdmin && !remainsAdmin) {
        const admins = await client.query(`SELECT a.id FROM identity.accounts a JOIN identity.account_roles ar ON ar.account_id=a.id JOIN identity.roles r ON r.id=ar.role_id WHERE r.code='administrator' AND a.status='active' FOR UPDATE`);
        if ((admins.rowCount ?? admins.rows.length) <= 1) return 'LAST_ADMIN';
      }
      const update = await client.query(`UPDATE identity.accounts SET
        platform_role=CASE WHEN $2::text[] @> ARRAY['administrator']::text[] THEN 'admin' ELSE 'participant' END,
        status=$3,disabled_at=CASE WHEN $3='inactive' THEN COALESCE(disabled_at,now()) ELSE NULL END,
        updated_at=now(),version=version+1 WHERE id=$1 AND version=$4 RETURNING id`, [id, nextRoles, status, version]);
      if (!update.rowCount) return 'CONFLICT';
      await client.query('DELETE FROM identity.account_roles WHERE account_id=$1', [id]);
      await client.query(`INSERT INTO identity.account_roles(account_id,role_id,assigned_by)
        SELECT $1,id,$2 FROM identity.roles WHERE code=ANY($3::text[])`, [id, actorId, nextRoles]);
      if (status !== 'active') await client.query('UPDATE identity.sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL', [id]);
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1,'account.roles_updated','account',$2,'success')", [actorId, id]);
      return 'OK';
    });
  }

  async adminUpdate(id: string, role: 'participant' | 'admin', disabled: boolean, version: number, actorId: string) {
    const current = await this.db.query<{ global_roles: GlobalRole[] }>(`SELECT COALESCE(array_agg(r.code ORDER BY r.code),'{}'::text[]) AS global_roles FROM identity.account_roles ar JOIN identity.roles r ON r.id=ar.role_id WHERE ar.account_id=$1`, [id]);
    if (!current.rowCount) return 'NOT_FOUND' as AdminOutcome;
    const roles = new Set(current.rows[0].global_roles);
    if (role === 'admin') roles.add('administrator'); else roles.delete('administrator');
    return this.adminUpdateRoles(id, [...roles], disabled ? 'inactive' : 'active', version, actorId);
  }

  async bootstrapAdmin(email: string) {
    const normalized = normalizeEmail(email);
    return this.db.transaction(async client => {
      await client.query('LOCK TABLE identity.account_roles IN SHARE ROW EXCLUSIVE MODE');
      const current = await client.query(`SELECT a.id FROM identity.accounts a JOIN identity.account_roles ar ON ar.account_id=a.id JOIN identity.roles r ON r.id=ar.role_id WHERE r.code='administrator' AND a.status='active'`);
      if (current.rowCount) return false;
      const account = await client.query<{ id: string }>(`UPDATE identity.accounts SET platform_role='admin',updated_at=now(),version=version+1
        WHERE email_normalized=$1 AND email_verified_at IS NOT NULL AND status='active' RETURNING id`, [normalized]);
      if (!account.rowCount) return false;
      await client.query("INSERT INTO identity.account_roles(account_id,role_id) SELECT $1,id FROM identity.roles WHERE code='administrator' ON CONFLICT DO NOTHING", [account.rows[0].id]);
      await client.query("INSERT INTO identity.audit_events(actor_id,event_type,resource_type,resource_id,outcome) VALUES($1::uuid,'account.admin_bootstrapped','account',$1::text,'success')", [account.rows[0].id]);
      return true;
    });
  }
}
