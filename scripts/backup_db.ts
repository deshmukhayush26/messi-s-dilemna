// scripts/backup_db.ts
/**
 * Universal Database Backup Utility for CCG Competition Platform.
 * Dumps PostgreSQL (if DATABASE_URL is set) or SQLite tables to a timestamped JSON backup file.
 *
 * Usage:
 *   npx tsx scripts/backup_db.ts
 *   DATABASE_URL="postgresql://..." npx tsx scripts/backup_db.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const backupsDir = path.join(dataDir, 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const engineName = db.isPostgres ? 'postgresql' : 'sqlite';
  const backupFile = path.join(backupsDir, `ccg_backup_${engineName}_${timestamp}.json`);

  const tables = [
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

  console.log(`📦 Creating full database backup from ${engineName}...`);
  const backupData: Record<string, any[]> = {};

  for (const table of tables) {
    try {
      backupData[table] = await db.query(`SELECT * FROM ${table}`);
    } catch (err: any) {
      console.warn(`⚠️ Could not read table ${table}: ${err.message}`);
      backupData[table] = [];
    }
  }

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`✅ Backup created successfully at:\n   ${backupFile}`);
  console.log('📊 Table record summary:');
  for (const [table, rows] of Object.entries(backupData)) {
    console.log(`   - ${table.padEnd(20)}: ${rows.length} records`);
  }

  await db.close();
}

runBackup().catch((err) => {
  console.error('❌ Backup failed:', err);
  process.exit(1);
});
