import { log } from './log.js';
import { pool, rollbackLastMigration } from './persistence/db.js';

try {
  const filename = await rollbackLastMigration();
  log('info', filename ? 'migration_rollback_complete' : 'migration_rollback_noop', {
    filename,
  });
  await pool.end();
} catch (error) {
  log('error', 'migration_rollback_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  await pool.end();
  process.exitCode = 1;
}
