import pg from 'pg';
import { applyIdentityMigrations } from './migration-runner.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error('Missing environment variable: ' + key);
  return value;
};
const client = new pg.Client({
  host: required('POSTGRES_HOST'),
  port: Number(required('POSTGRES_PORT')),
  database: required('IDENTIDAD_DB'),
  user: required('IDENTIDAD_MIGRATOR'),
  password: required('IDENTIDAD_MIGRATOR_PASSWORD'),
  connectionTimeoutMillis: 5000,
  application_name: 'hci-identidad-migrator',
});
await client.connect();
try {
  const events = await applyIdentityMigrations(client);
  for (const event of events) process.stdout.write(JSON.stringify(event) + '\n');
} finally {
  await client.end();
}