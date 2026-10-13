// scripts/restore_db.ts
/**
 * Universal Database Restore Utility for CCG Competition Platform.
 * Restores tables from a JSON backup file into PostgreSQL (if configured) or SQLite.
 *
 * Usage:
 *   npx tsx scripts/restore_db.ts <path-to-backup.json>
 *   DATABASE_URL="postgresql://..." npx tsx scripts/restore_db.ts <path-to-backup.json>
 */

import fs from 'node:fs';
import { db, initDb } from '../server/db';

const backupFile = process.argv[2];
if (!backupFile || !fs.existsSync(backupFile)) {
  console.error('❌ Please specify a valid backup JSON file path to restore.');
  console.error('Usage: npx tsx scripts/restore_db.ts data/backups/ccg_backup_<timestamp>.json');
  process.exit(1);
}

async function runRestore() {
  await initDb();
  const engineName = db.isPostgres ? 'postgresql' : 'sqlite';
  console.log(`🔄 Restoring database into ${engineName} from:\n   ${backupFile}...`);

  const backupContent = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));

  // Ensure table restoration order respects foreign key hierarchy
  const orderedTables = [
    'users',
    'submissions',
    'evaluations',
    'auth_sessions',
    'admin_config',
    'event_timer',
    'timer_action_log',
    'evaluation_jobs',
    'evaluation_history'
  ];

  await db.transaction(async (trx) => {
    for (const table of orderedTables) {
      const rows = backupContent[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const sample = rows[0];
      const columns = Object.keys(sample);
      const placeholders = columns.map(() => '?').join(', ');
      const updateSet = columns
        .filter((col) => col !== 'id' && col !== 'token')
        .map((col) => `${col} = EXCLUDED.${col}`)
        .join(', ');

      const conflictTarget = table === 'auth_sessions' ? 'token' : 'id';
      const sql = updateSet.length > 0
        ? `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateSet}`
        : `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictTarget}) DO NOTHING`;

      let count = 0;
      for (const row of rows) {
        const values = columns.map((col) => row[col]);
        await trx.execute(sql, values);
        count++;
      }
      console.log(`   Restored ${count} records into ${table}.`);
    }
  });

  console.log(`✅ Database restore completed cleanly into ${engineName}.`);
  await db.close();
}

runRestore().catch((err) => {
  console.error('❌ Restore failed:', err);
  process.exit(1);
});
