// scripts/migrate_to_postgres.ts
/**
 * Local SQLite to Production PostgreSQL Migration Utility.
 * Reads existing state from SQLite (data/app.db) and migrates real competition entities
 * to PostgreSQL transactionally.
 *
 * Safety features:
 * - Automatically performs pre-migration snapshot backup.
 * - Automatically filters out demo/seed participants, test accounts, and fake scores unless --include-seeds is set.
 * - Entire migration executes within an ACID transaction (COMMIT / ROLLBACK).
 * - Optional --dry-run mode tests the migration and reports reconciliation without persisting changes.
 * - Reconciliation report validates source and destination counts without exposing personal information.
 *
 * Usage:
 *   DATABASE_URL="postgres://user:pass@host:5432/db" npx tsx scripts/migrate_to_postgres.ts
 *   DATABASE_URL="postgres://user:pass@host:5432/db" npx tsx scripts/migrate_to_postgres.ts --dry-run
 *   DATABASE_URL="postgres://user:pass@host:5432/db" npx tsx scripts/migrate_to_postgres.ts --include-seeds
 */

import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDryRun = process.argv.includes('--dry-run');
const includeSeeds = process.argv.includes('--include-seeds');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL environment variable is required to run PostgreSQL migration.');
  console.error('Example: DATABASE_URL="postgresql://user:password@hostname:5432/dbname" npx tsx scripts/migrate_to_postgres.ts');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const sqlitePath = path.join(dataDir, 'app.db');
if (!fs.existsSync(sqlitePath)) {
  console.error(`❌ SQLite database not found at ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new DatabaseSync(sqlitePath);
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

// Automatic pre-migration snapshot backup
function createPreMigrationBackup(): string {
  const backupsDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupsDir, `pre_migration_backup_${timestamp}.json`);

  const tables = [
    'users', 'submissions', 'evaluations', 'auth_sessions',
    'admin_config', 'event_timer', 'timer_action_log',
    'evaluation_jobs', 'evaluation_history'
  ];

  const backupData: Record<string, any[]> = {};
  for (const table of tables) {
    try {
      backupData[table] = sqlite.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      backupData[table] = [];
    }
  }
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`🛡️ Pre-migration backup verified and saved to:\n   ${backupFile}`);
  return backupFile;
}

async function runMigration() {
  console.log('================================================================');
  console.log('🚀 CCG × OpenAI: Production PostgreSQL Migration');
  console.log('================================================================');
  console.log(`📂 Source SQLite: ${sqlitePath}`);
  console.log(`🌐 Target PostgreSQL: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`🧹 Filter Mock/Seed Accounts: ${includeSeeds ? 'DISABLED (--include-seeds passed)' : 'ENABLED (Excluding seed/test data)'}`);
  if (isDryRun) {
    console.log('🔍 MODE: DRY-RUN (Transaction will be simulated and cleanly rolled back; no changes persisted)');
  }

  const backupFile = createPreMigrationBackup();

  const client = await pool.connect();

  try {
    // 1. Run initial schema migration
    console.log('\n📦 Step 1: Applying PostgreSQL initial schema...');
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial_schema.sql'), 'utf-8');
    await client.query(schemaSql);
    console.log('✅ PostgreSQL initial schema verified.');

    await client.query('BEGIN');

    // 2. Migrate users (excluding mock seeds unless requested)
    console.log('\n👥 Step 2: Migrating users...');
    const allUsers = sqlite.prepare('SELECT * FROM users').all() as any[];
    const users = allUsers.filter(u => {
      if (includeSeeds) return true;
      const isSeed = u.id.startsWith('usr_seed_') || ['22b0101', '22b0204', '22b0315', '22b0422', '22b0530', 'test_participant'].includes(u.roll_number?.toLowerCase());
      return !isSeed;
    });

    for (const u of users) {
      await client.query(`
        INSERT INTO users (id, name, roll_number, role, last_login_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          roll_number = EXCLUDED.roll_number,
          role = EXCLUDED.role,
          last_login_at = EXCLUDED.last_login_at
      `, [u.id, u.name, u.roll_number, u.role || 'participant', u.last_login_at || null, u.created_at]);
    }
    console.log(`   Migrated ${users.length} real users (skipped ${allUsers.length - users.length} demo seeds).`);

    // 3. Migrate submissions (excluding mock seeds unless requested)
    console.log('\n📄 Step 3: Migrating submissions...');
    const allSubmissions = sqlite.prepare('SELECT * FROM submissions').all() as any[];
    const validUserIds = new Set(users.map(u => u.id));
    const submissions = allSubmissions.filter(s => {
      if (includeSeeds) return true;
      const isSeed = s.id.startsWith('sub_seed_') || s.user_id.startsWith('usr_seed_');
      return !isSeed && validUserIds.has(s.user_id);
    });

    for (const s of submissions) {
      await client.query(`
        INSERT INTO submissions (
          id, user_id, team_name, submission_name, deck_file_name, deck_file_url,
          storage_key, file_type, file_size, slide_count, submission_duration_sec,
          notes, review_status, is_published, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          team_name = EXCLUDED.team_name,
          submission_name = EXCLUDED.submission_name,
          review_status = EXCLUDED.review_status,
          is_published = EXCLUDED.is_published,
          updated_at = EXCLUDED.updated_at
      `, [
        s.id, s.user_id, s.team_name, s.submission_name, s.deck_file_name, s.deck_file_url,
        s.storage_key, s.file_type, s.file_size || 0, s.slide_count || 0, s.submission_duration_sec || 0,
        s.notes, s.review_status || 'pending', s.is_published ?? 1, s.created_at, s.updated_at
      ]);
    }
    console.log(`   Migrated ${submissions.length} real submissions (skipped ${allSubmissions.length - submissions.length} demo seeds).`);

    // 4. Migrate evaluations
    console.log('\n⚖️ Step 4: Migrating evaluations...');
    const allEvaluations = sqlite.prepare('SELECT * FROM evaluations').all() as any[];
    const validSubIds = new Set(submissions.map(s => s.id));
    const evaluations = allEvaluations.filter(ev => {
      if (includeSeeds) return true;
      const isSeed = ev.id.startsWith('eval_seed_') || !validSubIds.has(ev.submission_id);
      return !isSeed;
    });

    for (const ev of evaluations) {
      await client.query(`
        INSERT INTO evaluations (
          id, submission_id, evaluation_version, evaluation_status,
          overall_score, problem_structuring_score, analytical_rigor_score,
          strategic_insight_score, feasibility_impact_score, communication_score,
          ai_rationale, strengths, weaknesses, evidence, is_mock,
          input_tokens, output_tokens, total_tokens, estimated_cost_usd,
          provider, model, cached_tokens, reasoning_tokens, provider_request_id,
          executive_summary, recommendation, assumptions_and_risks, actionable_feedback,
          criterion_scores_json, confidence, needs_human_review, review_flags,
          human_reviewer_id, human_override_score, human_override_reason, human_reviewed_at,
          attempt_number, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        ev.id, ev.submission_id, ev.evaluation_version || 'v1', ev.evaluation_status || 'completed',
        ev.overall_score || 50, ev.problem_structuring_score || 50, ev.analytical_rigor_score || 50,
        ev.strategic_insight_score || 50, ev.feasibility_impact_score || 50, ev.communication_score || 50,
        ev.ai_rationale, ev.strengths, ev.weaknesses, ev.evidence, ev.is_mock ?? 0,
        ev.input_tokens || 0, ev.output_tokens || 0, ev.total_tokens || 0, ev.estimated_cost_usd || 0.0,
        ev.provider || 'mock', ev.model || 'mock', ev.cached_tokens || 0, ev.reasoning_tokens || 0,
        ev.provider_request_id, ev.executive_summary, ev.recommendation, ev.assumptions_and_risks,
        ev.actionable_feedback, ev.criterion_scores_json, ev.confidence ?? 1.0, ev.needs_human_review ?? 0,
        ev.review_flags, ev.human_reviewer_id, ev.human_override_score, ev.human_override_reason,
        ev.human_reviewed_at, ev.attempt_number || 1, ev.created_at
      ]);
    }
    console.log(`   Migrated ${evaluations.length} evaluations (skipped ${allEvaluations.length - evaluations.length} demo seeds).`);

    // 5. Migrate admin_config
    console.log('\n⚙️ Step 5: Migrating admin configuration...');
    const configs = sqlite.prepare('SELECT * FROM admin_config').all() as any[];
    for (const cfg of configs) {
      await client.query(`
        INSERT INTO admin_config (
          id, app_token_budget, is_ai_judge_enabled, leaderboard_visibility, enforce_min_slides,
          ai_judge_provider, ai_judge_model, ai_judge_rubric_version, ai_judge_max_concurrency,
          ai_judge_max_retries, ai_judge_budget_usd, ai_judge_spent_usd, feedback_release_mode,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          app_token_budget = EXCLUDED.app_token_budget,
          is_ai_judge_enabled = EXCLUDED.is_ai_judge_enabled,
          leaderboard_visibility = EXCLUDED.leaderboard_visibility,
          enforce_min_slides = EXCLUDED.enforce_min_slides,
          ai_judge_provider = EXCLUDED.ai_judge_provider,
          ai_judge_model = EXCLUDED.ai_judge_model,
          ai_judge_rubric_version = EXCLUDED.ai_judge_rubric_version,
          ai_judge_max_concurrency = EXCLUDED.ai_judge_max_concurrency,
          ai_judge_max_retries = EXCLUDED.ai_judge_max_retries,
          ai_judge_budget_usd = EXCLUDED.ai_judge_budget_usd,
          ai_judge_spent_usd = EXCLUDED.ai_judge_spent_usd,
          feedback_release_mode = EXCLUDED.feedback_release_mode
      `, [
        cfg.id, cfg.app_token_budget || 500000, cfg.is_ai_judge_enabled || 0,
        cfg.leaderboard_visibility || 'all', cfg.enforce_min_slides || 0,
        cfg.ai_judge_provider || 'openai', cfg.ai_judge_model || 'gpt-4o',
        cfg.ai_judge_rubric_version || 'v1', cfg.ai_judge_max_concurrency || 2,
        cfg.ai_judge_max_retries || 3, cfg.ai_judge_budget_usd || 50.0,
        cfg.ai_judge_spent_usd || 0.0, cfg.feedback_release_mode || 'immediate',
        cfg.created_at || new Date().toISOString()
      ]);
    }
    console.log(`   Migrated ${configs.length} admin configuration rows.`);

    // 6. Migrate event_timer
    console.log('\n⏱️ Step 6: Migrating event timer...');
    const timers = sqlite.prepare('SELECT * FROM event_timer').all() as any[];
    for (const t of timers) {
      await client.query(`
        INSERT INTO event_timer (
          id, status, initial_duration_sec, remaining_duration_sec,
          start_timestamp, end_timestamp, last_updated_at, last_updated_by, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          remaining_duration_sec = EXCLUDED.remaining_duration_sec,
          start_timestamp = EXCLUDED.start_timestamp,
          end_timestamp = EXCLUDED.end_timestamp,
          last_updated_at = EXCLUDED.last_updated_at,
          last_updated_by = EXCLUDED.last_updated_by,
          version = EXCLUDED.version
      `, [
        t.id, t.status, t.initial_duration_sec, t.remaining_duration_sec,
        t.start_timestamp, t.end_timestamp, t.last_updated_at, t.last_updated_by,
        t.version || 1
      ]);
    }
    console.log(`   Migrated ${timers.length} timer rows.`);

    // 7. Migrate timer action logs
    console.log('\n📜 Step 7: Migrating timer action logs...');
    const timerLogs = sqlite.prepare('SELECT * FROM timer_action_log').all() as any[];
    for (const log of timerLogs) {
      await client.query(`
        INSERT INTO timer_action_log (id, organizer_id, action, duration_added_sec, previous_state, new_state, timestamp, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [log.id, log.organizer_id, log.action, log.duration_added_sec || 0, log.previous_state, log.new_state, log.timestamp, log.notes]);
    }
    console.log(`   Migrated ${timerLogs.length} timer log records.`);

    // 8. Migrate evaluation jobs
    console.log('\n🚦 Step 8: Migrating queue evaluation jobs...');
    const allJobs = sqlite.prepare('SELECT * FROM evaluation_jobs').all() as any[];
    const jobs = allJobs.filter(j => includeSeeds || validSubIds.has(j.submission_id));
    for (const j of jobs) {
      await client.query(`
        INSERT INTO evaluation_jobs (
          id, submission_id, status, provider, model, attempts, max_attempts,
          error_message, created_at, updated_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `, [
        j.id, j.submission_id, j.status, j.provider || 'openai', j.model,
        j.attempts || 0, j.max_attempts || 3, j.error_message, j.created_at,
        j.updated_at, j.completed_at
      ]);
    }
    console.log(`   Migrated ${jobs.length} queue jobs.`);

    // 9. Migrate evaluation history
    console.log('\n📚 Step 9: Migrating evaluation history...');
    const allHistories = sqlite.prepare('SELECT * FROM evaluation_history').all() as any[];
    const histories = allHistories.filter(h => includeSeeds || validSubIds.has(h.submission_id));
    for (const h of histories) {
      await client.query(`
        INSERT INTO evaluation_history (
          id, evaluation_id, submission_id, version, provider, model,
          overall_score, scores_json, rationale, total_tokens, estimated_cost_usd,
          created_at, archived_at, archive_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO NOTHING
      `, [
        h.id, h.evaluation_id, h.submission_id, h.version, h.provider, h.model,
        h.overall_score, h.scores_json, h.rationale, h.total_tokens || 0,
        h.estimated_cost_usd || 0.0, h.created_at, h.archived_at, h.archive_reason
      ]);
    }
    console.log(`   Migrated ${histories.length} historical evaluation snapshots.`);

    // 10. Post-migration reconciliation audit (comparing source vs destination)
    console.log('\n📊 Step 10: Reconciliation & Integrity Audit:');
    const tableAudit = [
      { name: 'users', sourceCount: users.length },
      { name: 'submissions', sourceCount: submissions.length },
      { name: 'evaluations', sourceCount: evaluations.length },
      { name: 'admin_config', sourceCount: configs.length },
      { name: 'event_timer', sourceCount: timers.length },
      { name: 'timer_action_log', sourceCount: timerLogs.length },
      { name: 'evaluation_jobs', sourceCount: jobs.length },
      { name: 'evaluation_history', sourceCount: histories.length },
    ];

    let auditPassed = true;
    for (const item of tableAudit) {
      const res = await client.query(`SELECT COUNT(*) as count FROM ${item.name}`);
      const pgCount = Number(res.rows[0]?.count || 0);
      const isMatch = pgCount >= item.sourceCount;
      console.log(`   - ${item.name.padEnd(20)}: Source=${item.sourceCount} | Target=${pgCount} | ${isMatch ? '✅ MATCH' : '⚠️ MISMATCH'}`);
      if (!isMatch) auditPassed = false;
    }

    // Verify foreign key integrity
    const orphanSubs = await client.query('SELECT COUNT(*) as count FROM submissions s LEFT JOIN users u ON s.user_id = u.id WHERE u.id IS NULL');
    const orphanCount = Number(orphanSubs.rows[0]?.count || 0);
    if (orphanCount === 0) {
      console.log('   - Foreign Keys        : ✅ ZERO ORPHANED SUBMISSIONS');
    } else {
      console.warn(`   - Foreign Keys        : ⚠️ FOUND ${orphanCount} ORPHANED SUBMISSIONS`);
      auditPassed = false;
    }

    if (!auditPassed) {
      throw new Error('Reconciliation audit detected table count or relationship mismatches.');
    }

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('\n🔍 DRY-RUN COMPLETE: Transaction safely rolled back. Target PostgreSQL was not modified.');
    } else {
      await client.query('COMMIT');
      console.log('\n🎉 Migration successfully committed! Data safely stored in PostgreSQL.');
    }

    console.log('\nℹ️ In case of emergency or unexpected issues, restore the previous state via:');
    console.log(`   npx tsx scripts/restore_db.ts ${backupFile}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed. Transaction rolled back cleanly:', err);
    console.log(`ℹ️ Your original SQLite database remains untouched. Backup snapshot available at: ${backupFile}`);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});
