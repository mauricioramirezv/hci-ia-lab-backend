import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyIdentityMigrations } from '../src/infrastructure/migration-runner.js';

const enabled = process.env.TEST_POSTGRES === '1';
const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error('Missing migration-test environment variable: ' + key);
  return value;
};

async function withTemporaryIdentityDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const dockerAdmin = process.env.TEST_POSTGRES_ADMIN_DOCKER === '1';
  const admin = dockerAdmin ? undefined : new pg.Client({
    host: required('POSTGRES_HOST'), port: Number(required('POSTGRES_PORT')), database: 'postgres',
    user: required('POSTGRES_BOOTSTRAP_USER'), password: required('POSTGRES_BOOTSTRAP_PASSWORD'),
    connectionTimeoutMillis: 5000, application_name: 'hci-identity-migration-test-admin',
  });
  await admin?.connect();
  const database = 'hci_identity_migration_' + randomUUID().replaceAll('-', '');
  if (!/^hci_identity_migration_[a-f0-9]{32}$/.test(database)) throw new Error('Invalid temporary identity database name');
  let service: pg.Client | undefined;
  let created = false;
  const adminQuery = async (sql: string) => dockerAdmin
    ? (await promisify(execFile)('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', process.env.POSTGRES_BOOTSTRAP_USER ?? 'hci_bootstrap', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql])).stdout.trim()
    : (await admin!.query(sql)).rows;
  try {
    const roleExists = dockerAdmin ? await adminQuery("SELECT count(*) FROM pg_roles WHERE rolname='identity_owner'") === '1' : !!(await admin!.query('SELECT 1 FROM pg_roles WHERE rolname=$1', ['identity_owner'])).rowCount;
    if (!roleExists) throw new Error('Provisioning role identity_owner is required for migration integration tests.');
    await adminQuery('CREATE DATABASE "' + database + '" OWNER identity_owner');
    created = true;
    service = new pg.Client({
      host: required('POSTGRES_HOST'),
      port: Number(required('POSTGRES_PORT')),
      database,
      user: required('IDENTIDAD_MIGRATOR'),
      password: required('IDENTIDAD_MIGRATOR_PASSWORD'),
      connectionTimeoutMillis: 5000,
      application_name: 'hci-identity-migration-test',
    });
    await service.connect();
    return await work(service);
  } finally {
    if (service) await service.end();
    if (created) {
      await adminQuery("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='" + database + "' AND pid<>pg_backend_pid()");
      await adminQuery('DROP DATABASE "' + database + '"');
    }
    await admin?.end();
  }
}

describe.skipIf(!enabled)('Identity migration compatibility', () => {
  it('installs all migrations on an empty database and keeps the visible-name compatibility mapping', async () => {
    await withTemporaryIdentityDatabase(async client => {
      const events = await applyIdentityMigrations(client);
      expect(events.map(event => event.migration)).toEqual([
        '001_service_metadata.sql',
        '002_accounts.sql',
        '003_identity_rbac.sql',
        '004_account_name_mer_alignment.sql',
        '006_domain_events.sql',
      ]);
      expect(events.every(event => event.event === 'migration.applied')).toBe(true);

      const roleCount = await client.query('SELECT count(*)::int AS total FROM identity.roles');
      expect(roleCount.rows[0].total).toBe(4);
      const legacyWrite = await client.query(
        "INSERT INTO identity.accounts(email,email_normalized,password_hash,display_name,status) VALUES($1,$1,'fixture-hash','Legacy display name','pending') RETURNING name,display_name",
        ['fresh-migration@example.test'],
      );
      expect(legacyWrite.rows[0]).toEqual({ name: 'Legacy display name', display_name: 'Legacy display name' });
      expect((await client.query("SELECT event_type FROM identity.event_outbox WHERE aggregate_id=(SELECT id FROM identity.accounts WHERE email_normalized='fresh-migration@example.test')")).rows).toEqual([{ event_type: 'account.changed' }]);
      const merWrite = await client.query(
        "INSERT INTO identity.accounts(email,email_normalized,password_hash,display_name,name,status) VALUES($1,$1,'fixture-hash','','MER visible name','pending') RETURNING name,display_name",
        ['fresh-mer-name@example.test'],
      );
      expect(merWrite.rows[0]).toEqual({ name: 'MER visible name', display_name: 'MER visible name' });
      const replay = await applyIdentityMigrations(client);
      expect(replay.every(event => event.event === 'migration.already_applied')).toBe(true);
    });
  }, 30000);

  it('upgrades a populated 001/002 database without changing password, session or one-time-token data', async () => {
    await withTemporaryIdentityDatabase(async client => {
      const previous = await applyIdentityMigrations(client, '002_accounts.sql');
      expect(previous.map(event => event.migration)).toEqual(['001_service_metadata.sql', '002_accounts.sql']);

      const records = [
        { email: 'legacy-admin@example.test', name: 'Legacy Admin', role: 'admin', verified: true, disabled: false, hash: 'legacy-password-hash-admin' },
        { email: 'legacy-participant@example.test', name: 'Legacy Participant', role: 'participant', verified: true, disabled: true, hash: 'legacy-password-hash-inactive' },
        { email: 'legacy-pending@example.test', name: 'Legacy Pending', role: 'participant', verified: false, disabled: false, hash: 'legacy-password-hash-pending' },
      ];
      const accountIds: Record<string, string> = {};
      for (const record of records) {
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO identity.accounts(email,email_normalized,password_hash,display_name,platform_role,email_verified_at,disabled_at) VALUES($1,$1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,CASE WHEN $6 THEN now() ELSE NULL END) RETURNING id',
          [record.email, record.hash, record.name, record.role, record.verified, record.disabled],
        );
        accountIds[record.email] = inserted.rows[0].id;
      }

      await client.query(
        'INSERT INTO identity.sessions(account_id,token_hash,csrf_hash,expires_at,revoked_at) VALUES($1,$2,$3,now()+interval \'12 hours\',NULL),($1,$4,$5,now()+interval \'3 hours\',now()-interval \'1 hour\')',
        [accountIds['legacy-admin@example.test'], 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)],
      );
      await client.query(
        'INSERT INTO identity.one_time_tokens(account_id,purpose,token_hash,expires_at,consumed_at) VALUES($1,\'verify_email\',$2,now()+interval \'12 hours\',NULL),($1,\'reset_password\',$3,now()-interval \'1 hour\',now()-interval \'2 hours\')',
        [accountIds['legacy-pending@example.test'], 'e'.repeat(64), 'f'.repeat(64)],
      );

      const beforeAccounts = await client.query(
        'SELECT id::text,email_normalized,password_hash,display_name,platform_role,email_verified_at::text,disabled_at::text FROM identity.accounts ORDER BY email_normalized',
      );
      const beforeSessions = await client.query(
        'SELECT id::text,account_id::text,token_hash,csrf_hash,expires_at::text,revoked_at::text,created_at::text,last_seen_at::text FROM identity.sessions ORDER BY id',
      );
      const beforeTokens = await client.query(
        'SELECT id::text,account_id::text,purpose,token_hash,expires_at::text,consumed_at::text,created_at::text FROM identity.one_time_tokens ORDER BY id',
      );

      const applied = await applyIdentityMigrations(client);
      expect(applied.map(event => event.migration)).toEqual([
        '001_service_metadata.sql',
        '002_accounts.sql',
        '003_identity_rbac.sql',
        '004_account_name_mer_alignment.sql',
        '006_domain_events.sql',
      ]);
      expect(applied.map(event => event.event)).toEqual([
        'migration.already_applied',
        'migration.already_applied',
        'migration.applied',
        'migration.applied',
        'migration.applied',
      ]);

      const afterAccounts = await client.query(
        'SELECT id::text,email_normalized,password_hash,display_name,platform_role,email_verified_at::text,disabled_at::text FROM identity.accounts ORDER BY email_normalized',
      );
      expect(afterAccounts.rows).toEqual(beforeAccounts.rows);

      const aligned = await client.query(
        'SELECT email_normalized,name,display_name,last_name,status FROM identity.accounts ORDER BY email_normalized',
      );
      expect(aligned.rows).toEqual([
        { email_normalized: 'legacy-admin@example.test', name: 'Legacy Admin', display_name: 'Legacy Admin', last_name: null, status: 'active' },
        { email_normalized: 'legacy-participant@example.test', name: 'Legacy Participant', display_name: 'Legacy Participant', last_name: null, status: 'inactive' },
        { email_normalized: 'legacy-pending@example.test', name: 'Legacy Pending', display_name: 'Legacy Pending', last_name: null, status: 'pending' },
      ]);

      const roleRows = await client.query(
        'SELECT a.email_normalized,r.code FROM identity.accounts a JOIN identity.account_roles ar ON ar.account_id=a.id JOIN identity.roles r ON r.id=ar.role_id ORDER BY a.email_normalized,r.code',
      );
      expect(roleRows.rows).toEqual([
        { email_normalized: 'legacy-admin@example.test', code: 'administrator' },
        { email_normalized: 'legacy-participant@example.test', code: 'participant' },
        { email_normalized: 'legacy-pending@example.test', code: 'participant' },
      ]);
      const afterSessions = await client.query(
        'SELECT id::text,account_id::text,token_hash,csrf_hash,expires_at::text,revoked_at::text,created_at::text,last_seen_at::text FROM identity.sessions ORDER BY id',
      );
      expect(afterSessions.rows).toEqual(beforeSessions.rows);
      const afterTokens = await client.query(
        'SELECT id::text,account_id::text,purpose,token_hash,expires_at::text,consumed_at::text,created_at::text FROM identity.one_time_tokens ORDER BY id',
      );
      expect(afterTokens.rows).toEqual(beforeTokens.rows);
    });
  }, 30000);
});
