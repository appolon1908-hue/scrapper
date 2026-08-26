import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { log } from '../log.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'codestra-business-scrapper',
});

pool.on('error', (error) => log('error', 'postgres_pool_error', { error: error.message }));

export async function pingDatabase(): Promise<void> {
  await pool.query('select 1');
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(directory = path.join(process.cwd(), 'migrations')): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const sql = await fs.readFile(path.join(directory, filename), 'utf8');
    const checksum = (await import('node:crypto')).createHash('sha256').update(sql).digest('hex');
    await withTransaction(async (client) => {
      const prior = await client.query<{ checksum: string }>(
        'select checksum from schema_migrations where filename=$1 for update',
        [filename],
      );
      if (prior.rowCount) {
        if (prior.rows[0]?.checksum !== checksum) {
          throw new Error(`migration_checksum_mismatch:${filename}`);
        }
        return;
      }
      await client.query(sql);
      await client.query(
        'insert into schema_migrations(filename,checksum) values($1,$2)',
        [filename, checksum],
      );
      log('info', 'migration_applied', { filename });
    });
  }
}
