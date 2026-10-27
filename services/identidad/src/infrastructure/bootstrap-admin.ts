import pg from 'pg';
import { normalizeEmail } from '../identidad/domain/account.js';

const email = process.argv[2];
if (!email) throw new Error('Usage: npm run identity:bootstrap-admin -- <verified-email>');
const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
};
const client = new pg.Client({
  host: required('POSTGRES_HOST'),
  port: Number(required('POSTGRES_PORT')),
  database: required('IDENTIDAD_DB'),
  user: required('IDENTIDAD_MIGRATOR'),
  password: required('IDENTIDAD_MIGRATOR_PASSWORD'),
  connectionTimeoutMillis: 5000,
  application_name: 'hci-identidad-admin-bootstrap',
});

await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE identity_owner');
  await client.query('LOCK TABLE identity.account_roles IN SHARE ROW EXCLUSIVE MODE');
  const existing = await client.query("SELECT 1 FROM identity.account_roles ar JOIN identity.roles r ON r.id=ar.role_id JOIN identity.accounts a ON a.id=ar.account_id WHERE r.code='administrator' AND a.status='active'");
  if (existing.rowCount) throw new Error('No admin was created: an active administrator already exists.');
  const account = await client.query<{ id: string }>("UPDATE identity.accounts SET platform_role='admin',updated_at=now(),version=version+1 WHERE email_normalized=$1 AND email_verified_at IS NOT NULL AND status='active' RETURNING id", [normalizeEmail(email)]);
  if (account.rowCount !== 1) throw new Error('No admin was created: verify the account exists, is active and verified.');
  await client.query("INSERT INTO identity.account_roles(account_id,role_id) SELECT $1,id FROM identity.roles WHERE code='administrator' ON CONFLICT DO NOTHING", [account.rows[0].id]);
  await client.query('COMMIT');
  process.stdout.write(JSON.stringify({ event: 'identity.admin_bootstrapped' }) + '\n');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
