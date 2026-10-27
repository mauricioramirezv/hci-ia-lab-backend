import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
};
const directory = new URL('../evidencias/infrastructure/migrations/', import.meta.url);
const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
const client = new pg.Client({
  host: required('POSTGRES_HOST'),
  port: Number(required('POSTGRES_PORT')),
  database: required('EVIDENCIAS_DB'),
  user: required('EVIDENCIAS_MIGRATOR'),
  password: required('EVIDENCIAS_MIGRATOR_PASSWORD'),
  connectionTimeoutMillis: 5000,
  application_name: 'hci-evidencias-migrator',
});

await client.connect();
try {
  for (const name of names) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE evidence_owner');
      await client.query('CREATE SCHEMA IF NOT EXISTS evidence AUTHORIZATION evidence_owner');
      await client.query('CREATE TABLE IF NOT EXISTS evidence._schema_migrations(name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      const previous = await client.query('SELECT checksum FROM evidence._schema_migrations WHERE name=$1', [name]);
      if (previous.rowCount) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration checksum differs: ${name}`);
      } else {
        await client.query(sql);
        await client.query('INSERT INTO evidence._schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      }
      await client.query('COMMIT');
      process.stdout.write(JSON.stringify({ event: previous.rowCount ? 'migration.already_applied' : 'migration.applied', service: 'evidencias', migration: name }) + '\n');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}
