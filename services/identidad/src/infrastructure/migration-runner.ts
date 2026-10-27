import type { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = new URL('../identidad/infrastructure/migrations/', import.meta.url);

export type MigrationEvent = {
  event: 'migration.applied' | 'migration.already_applied';
  service: 'identidad';
  migration: string;
};

export async function applyIdentityMigrations(client: Client, through?: string): Promise<MigrationEvent[]> {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (through && !names.includes(through)) throw new Error('Unknown identity migration: ' + through);
  const selected = through ? names.slice(0, names.indexOf(through) + 1) : names;
  const events: MigrationEvent[] = [];

  for (const name of selected) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE identity_owner');
      await client.query('CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION identity_owner');
      await client.query('CREATE TABLE IF NOT EXISTS identity._schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
      const old = await client.query<{ checksum: string }>('SELECT checksum FROM identity._schema_migrations WHERE name=$1', [name]);
      if (old.rowCount) {
        if (old.rows[0].checksum !== checksum) throw new Error('Applied migration checksum differs: ' + name);
        events.push({ event: 'migration.already_applied', service: 'identidad', migration: name });
      } else {
        await client.query(sql);
        await client.query('INSERT INTO identity._schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        events.push({ event: 'migration.applied', service: 'identidad', migration: name });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return events;
}