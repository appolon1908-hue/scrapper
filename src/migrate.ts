import { pool, runMigrations } from './persistence/db.js';
import { log } from './log.js';

try {
  await runMigrations();
  log('info', 'migrations_complete');
  await pool.end();
} catch (error) {
  log('error', 'migrations_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  await pool.end();
  process.exitCode = 1;
}
