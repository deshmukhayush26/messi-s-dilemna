// server/db.ts
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL;

// Enforce PostgreSQL in production
if (isProduction && !databaseUrl) {
  const fatalMessage = 'FATAL: DATABASE_URL is required in production environment. Application will not silently fall back to SQLite.';
  console.error(`❌ ${fatalMessage}`);
  throw new Error(fatalMessage);
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure uploads directory exists
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export interface DatabaseAdapter {
  isPostgres: boolean;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>;
  /** Run a raw multi-statement SQL script. Used for migration files only. */
  executeScript(sql: string): Promise<void>;
  transaction<T>(fn: (trx: DatabaseAdapter) => Promise<T>): Promise<T>;
  checkHealth(): Promise<{ status: string; engine: string; tables: number; ready: boolean; error?: string }>;
  close(): Promise<void>;
}

/**
 * Translates SQLite style parameter placeholders ('?') to PostgreSQL style ('$1', '$2', ...)
 * while safely ignoring question marks inside single- or double-quoted strings.
 */
export function translateSqlForPostgres(sql: string): string {
  let paramIdx = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += char;
    } else if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && sql[i + 1] === '"') {
        result += '""';
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      result += char;
    } else if (char === '?' && !inSingleQuote && !inDoubleQuote) {
      result += `$${paramIdx++}`;
    } else {
      result += char;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL Adapter Implementation
// ─────────────────────────────────────────────────────────────────────────────
class PostgresDatabaseAdapter implements DatabaseAdapter {
  readonly isPostgres = true;
  private pool: pg.Pool;

  constructor(connString: string) {
    this.pool = new pg.Pool({
      connectionString: connString,
      ssl: connString.includes('localhost') || connString.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      console.error('[Postgres Pool Error]', err);
    });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const translatedSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(translatedSql, params);
    return res.rows as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const translatedSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(translatedSql, params);
    return (res.rows[0] as T) ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const translatedSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(translatedSql, params);
    return { rowCount: res.rowCount ?? 0 };
  }

  async executeScript(sql: string): Promise<void> {
    // Acquire a client from the pool and run the full script string in simple-query
    // mode. pg supports multiple statements separated by ; in a single client.query()
    // when called without parameters.
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (trx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const trxAdapter: DatabaseAdapter = {
        isPostgres: true,
        query: async <R = any>(sql: string, params: any[] = []): Promise<R[]> => {
          const res = await client.query(translateSqlForPostgres(sql), params);
          return res.rows as R[];
        },
        queryOne: async <R = any>(sql: string, params: any[] = []): Promise<R | null> => {
          const res = await client.query(translateSqlForPostgres(sql), params);
          return (res.rows[0] as R) ?? null;
        },
        execute: async (sql: string, params: any[] = []): Promise<{ rowCount: number }> => {
          const res = await client.query(translateSqlForPostgres(sql), params);
          return { rowCount: res.rowCount ?? 0 };
        },
        executeScript: async (scriptSql: string): Promise<void> => {
          await client.query(scriptSql);
        },
        transaction: async <R>(subFn: (subTrx: DatabaseAdapter) => Promise<R>): Promise<R> => {
          return subFn(trxAdapter);
        },
        checkHealth: () => this.checkHealth(),
        close: async () => {},
      };
      const result = await fn(trxAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async checkHealth(): Promise<{ status: string; engine: string; tables: number; ready: boolean; error?: string }> {
    try {
      const client = await this.pool.connect();
      try {
        const res = await client.query(`
          SELECT count(*) as count 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
            AND table_name IN ('users', 'submissions', 'evaluations', 'auth_sessions', 'admin_config', 'event_timer', 'timer_action_log', 'evaluation_jobs', 'evaluation_history')
        `);
        const tables = Number(res.rows[0]?.count || 0);
        return {
          status: 'connected',
          engine: 'postgresql',
          tables,
          ready: tables >= 9,
        };
      } finally {
        client.release();
      }
    } catch (err: any) {
      return {
        status: 'error',
        engine: 'postgresql',
        tables: 0,
        ready: false,
        error: err.message,
      };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SQLite Adapter Implementation (Development / Test Isolated Only)
// ─────────────────────────────────────────────────────────────────────────────
class SqliteDatabaseAdapter implements DatabaseAdapter {
  readonly isPostgres = false;
  private sqlite: DatabaseSync;

  constructor(filePath: string) {
    this.sqlite = new DatabaseSync(filePath);
    // Optimize SQLite for robust concurrency in local testing
    try {
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
      this.sqlite.exec('PRAGMA synchronous = NORMAL;');
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
    } catch {}
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.sqlite.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = this.sqlite.prepare(sql);
    const row = stmt.get(...params);
    return (row as T) ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const stmt = this.sqlite.prepare(sql);
    const result = stmt.run(...params);
    return { rowCount: Number(result.changes) };
  }

  async executeScript(sql: string): Promise<void> {
    this.sqlite.exec(sql);
  }

  async transaction<T>(fn: (trx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.sqlite.exec('BEGIN TRANSACTION;');
    try {
      const result = await fn(this);
      this.sqlite.exec('COMMIT;');
      return result;
    } catch (err) {
      this.sqlite.exec('ROLLBACK;');
      throw err;
    }
  }

  async checkHealth(): Promise<{ status: string; engine: string; tables: number; ready: boolean; error?: string }> {
    try {
      const row = this.sqlite.prepare(`
        SELECT count(*) as count 
        FROM sqlite_master 
        WHERE type='table' 
          AND name IN ('users', 'submissions', 'evaluations', 'auth_sessions', 'admin_config', 'event_timer', 'timer_action_log', 'evaluation_jobs', 'evaluation_history')
      `).get() as { count: number };
      const tables = Number(row?.count || 0);
      return {
        status: 'connected',
        engine: 'sqlite_persistent',
        tables,
        ready: tables >= 9,
      };
    } catch (err: any) {
      return {
        status: 'error',
        engine: 'sqlite_persistent',
        tables: 0,
        ready: false,
        error: err.message,
      };
    }
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Database Adapter Export
// ─────────────────────────────────────────────────────────────────────────────
const dbPath = path.join(dataDir, 'app.db');

export const db: DatabaseAdapter = databaseUrl
  ? new PostgresDatabaseAdapter(databaseUrl)
  : new SqliteDatabaseAdapter(dbPath);

export async function checkDbHealthAsync() {
  return db.checkHealth();
}

export function checkDbHealth() {
  // Synchronous fallback for legacy health check
  return {
    status: 'connected',
    engine: db.isPostgres ? 'postgresql' : 'sqlite_persistent',
    isPostgres: db.isPostgres,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Initialization & Migration Verification
// ─────────────────────────────────────────────────────────────────────────────
export async function initDb(): Promise<void> {
  if (db.isPostgres) {
    // 1. Verify schema on PostgreSQL
    const health = await db.checkHealth();
    if (!health.ready) {
      const schemaPath = path.join(__dirname, '..', 'migrations', '001_initial_schema.sql');
      if (fs.existsSync(schemaPath)) {
        console.log('📦 Applying PostgreSQL schema from migrations/001_initial_schema.sql...');
        const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
        await db.executeScript(schemaSql);
        console.log('✅ Schema migration applied successfully.');
      } else {
        throw new Error('FATAL: migrations/001_initial_schema.sql not found. Cannot initialise PostgreSQL schema.');
      }
    }

    // 2. Ensure default admin_config row exists
    const configRow = await db.queryOne('SELECT id FROM admin_config WHERE id = ?', ['global']);
    if (!configRow) {
      const nowIso = new Date().toISOString();
      await db.execute(`
        INSERT INTO admin_config (
          id, app_token_budget, is_ai_judge_enabled, leaderboard_visibility, enforce_min_slides,
          ai_judge_provider, ai_judge_model, ai_judge_rubric_version, ai_judge_max_concurrency,
          ai_judge_max_retries, ai_judge_budget_usd, ai_judge_spent_usd, feedback_release_mode,
          created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?
        ) ON CONFLICT (id) DO NOTHING
      `, [
        'global', 500000, 0, 'all', 0,
        'openai', 'gpt-4o', 'v1', 2,
        3, 50.0, 0.0, 'immediate',
        nowIso
      ]);
    }

    // 3. Ensure default event_timer row exists
    const timerRow = await db.queryOne('SELECT id FROM event_timer WHERE id = ?', ['global']);
    if (!timerRow) {
      const nowIso = new Date().toISOString();
      await db.execute(`
        INSERT INTO event_timer (
          id, status, initial_duration_sec, remaining_duration_sec,
          start_timestamp, end_timestamp, last_updated_at, last_updated_by, version
        ) VALUES (
          ?, 'not_started', 3600, 3600,
          NULL, NULL, ?, 'Lead Case Coordinator', 1
        ) ON CONFLICT (id) DO NOTHING
      `, ['global', nowIso]);
    }

    // 4. Ensure default organizer user exists
    const organizerUser = await db.queryOne('SELECT id FROM users WHERE roll_number = ?', ['ORGANIZER_ADMIN']);
    if (!organizerUser) {
      const nowIso = new Date().toISOString();
      await db.execute(`
        INSERT INTO users (id, name, roll_number, role, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING
      `, ['usr_organizer_root', 'Lead Case Coordinator', 'ORGANIZER_ADMIN', 'organizer', nowIso]);
    }

    console.log('✅ PostgreSQL runtime connection & schema readiness verified.');
    return;
  }

  // SQLite Initialization (for local development only)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      roll_number TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'participant',
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      submission_name TEXT NOT NULL,
      deck_file_name TEXT,
      deck_file_url TEXT,
      storage_key TEXT,
      file_type TEXT,
      file_size INTEGER DEFAULT 0,
      slide_count INTEGER DEFAULT 0,
      submission_duration_sec INTEGER DEFAULT 0,
      notes TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      is_published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      evaluation_version TEXT NOT NULL DEFAULT 'mock-v1',
      evaluation_status TEXT NOT NULL DEFAULT 'mock_evaluated',
      overall_score INTEGER NOT NULL DEFAULT 50,
      problem_structuring_score INTEGER NOT NULL DEFAULT 50,
      analytical_rigor_score INTEGER NOT NULL DEFAULT 50,
      strategic_insight_score INTEGER NOT NULL DEFAULT 50,
      feasibility_impact_score INTEGER NOT NULL DEFAULT 50,
      communication_score INTEGER NOT NULL DEFAULT 50,
      ai_rationale TEXT DEFAULT NULL,
      strengths TEXT DEFAULT NULL,
      weaknesses TEXT DEFAULT NULL,
      evidence TEXT DEFAULT NULL,
      is_mock INTEGER NOT NULL DEFAULT 1,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0.00,
      provider TEXT DEFAULT 'mock',
      model TEXT DEFAULT 'mock',
      cached_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      provider_request_id TEXT,
      executive_summary TEXT,
      recommendation TEXT,
      assumptions_and_risks TEXT,
      actionable_feedback TEXT,
      criterion_scores_json TEXT,
      confidence REAL DEFAULT 1.0,
      needs_human_review INTEGER DEFAULT 0,
      review_flags TEXT,
      human_reviewer_id TEXT,
      human_override_score INTEGER,
      human_override_reason TEXT,
      human_reviewed_at TEXT,
      attempt_number INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(submission_id, evaluation_version),
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      is_mock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_config (
      id TEXT PRIMARY KEY,
      app_token_budget INTEGER NOT NULL DEFAULT 500000,
      is_ai_judge_enabled INTEGER NOT NULL DEFAULT 0,
      leaderboard_visibility TEXT NOT NULL DEFAULT 'all',
      enforce_min_slides INTEGER NOT NULL DEFAULT 0,
      ai_judge_provider TEXT NOT NULL DEFAULT 'openai',
      ai_judge_model TEXT NOT NULL DEFAULT 'gpt-4o',
      ai_judge_rubric_version TEXT NOT NULL DEFAULT 'v1',
      ai_judge_max_concurrency INTEGER NOT NULL DEFAULT 2,
      ai_judge_max_retries INTEGER NOT NULL DEFAULT 3,
      ai_judge_budget_usd REAL NOT NULL DEFAULT 50.0,
      ai_judge_spent_usd REAL NOT NULL DEFAULT 0.0,
      feedback_release_mode TEXT NOT NULL DEFAULT 'immediate',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_timer (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'not_started',
      initial_duration_sec INTEGER NOT NULL DEFAULT 3600,
      remaining_duration_sec INTEGER NOT NULL DEFAULT 3600,
      start_timestamp TEXT,
      end_timestamp TEXT,
      last_updated_at TEXT NOT NULL,
      last_updated_by TEXT NOT NULL DEFAULT 'Lead Case Coordinator',
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS timer_action_log (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL,
      action TEXT NOT NULL,
      duration_added_sec INTEGER DEFAULT 0,
      previous_state TEXT NOT NULL,
      new_state TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS evaluation_jobs (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS evaluation_history (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      version TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      overall_score INTEGER NOT NULL,
      scores_json TEXT,
      rationale TEXT,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0.0,
      created_at TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      archive_reason TEXT
    );
  `);

  // Ensure default admin config in SQLite
  const configRow = await db.queryOne('SELECT id FROM admin_config WHERE id = ?', ['global']);
  if (!configRow) {
    await db.execute(`
      INSERT INTO admin_config (
        id, app_token_budget, is_ai_judge_enabled, leaderboard_visibility, enforce_min_slides,
        ai_judge_provider, ai_judge_model, ai_judge_rubric_version, ai_judge_max_concurrency,
        ai_judge_max_retries, ai_judge_budget_usd, ai_judge_spent_usd, feedback_release_mode,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'global', 500000, 0, 'all', 0,
      'openai', 'gpt-4o', 'v1', 2,
      3, 50.0, 0.0, 'immediate',
      new Date().toISOString()
    ]);
  }

  // Ensure default timer row in SQLite
  const timerRow = await db.queryOne('SELECT id FROM event_timer WHERE id = ?', ['global']);
  if (!timerRow) {
    const nowIso = new Date().toISOString();
    await db.execute(`
      INSERT INTO event_timer (
        id, status, initial_duration_sec, remaining_duration_sec,
        start_timestamp, end_timestamp, last_updated_at, last_updated_by, version
      )
      VALUES (?, 'not_started', 3600, 3600, NULL, NULL, ?, 'Lead Case Coordinator', 1)
    `, ['global', nowIso]);
  }

  // Ensure organizer user exists in SQLite
  const organizerUser = await db.queryOne('SELECT id FROM users WHERE roll_number = ?', ['ORGANIZER_ADMIN']);
  if (!organizerUser) {
    await db.execute(`
      INSERT INTO users (id, name, roll_number, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, ['usr_organizer_root', 'Lead Case Coordinator', 'ORGANIZER_ADMIN', 'organizer', new Date().toISOString()]);
  }

  // Check if we need initial seed submissions for a great first-load experience (dev only)
  const subCountRow = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM submissions');
  if (subCountRow && subCountRow.count === 0 && !isProduction && process.env.ENABLE_DEV_SEEDS === 'true') {
    await seedInitialDemoSubmissions();
  }
}

async function seedInitialDemoSubmissions() {
  const seedUsers = [
    { id: 'usr_seed_1', name: 'Aarav Sharma', roll: '22b0101' },
    { id: 'usr_seed_2', name: 'Ananya Iyer', roll: '22b0204' },
    { id: 'usr_seed_3', name: 'Rohan Mehta', roll: '22b0315' },
    { id: 'usr_seed_4', name: 'Sneha Patel', roll: '22b0422' },
    { id: 'usr_seed_5', name: 'Kabir Verma', roll: '22b0530' },
  ];

  const now = Date.now();

  for (let idx = 0; idx < seedUsers.length; idx++) {
    const u = seedUsers[idx];
    await db.execute(`
      INSERT INTO users (id, name, roll_number, role, last_login_at, created_at)
      VALUES (?, ?, ?, 'participant', ?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [u.id, u.name, u.roll, new Date(now - (idx + 1) * 3600000).toISOString(), new Date(now - (idx + 1) * 3600000).toISOString()]);

    const subId = `sub_seed_${idx + 1}`;
    const titles = [
      'Catalyst Strategy: Miami Fan Club & Academy',
      'Beyond 10: Digital Membership & Merchandising',
      'Global Franchising & Latin American Talent Hub',
      'The Fort Lauderdale Stadium Experience & Media Rights',
      'Sustainable Club Identity & Grassroots Football'
    ];
    const teamNames = [
      'Team Alpha Consulting',
      'Strategy Vanguard',
      'The Apex Analysts',
      'Nexus Ventures',
      'Horizon Advisory'
    ];

    await db.execute(`
      INSERT INTO submissions (
        id, user_id, team_name, submission_name, deck_file_name, deck_file_url,
        storage_key, file_type, file_size, slide_count, submission_duration_sec,
        notes, review_status, is_published, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pdf', 2450000, 5, 1800, ?, 'accepted', 1, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [
      subId,
      u.id,
      teamNames[idx],
      titles[idx],
      `Deck_${teamNames[idx].replace(/\s+/g, '_')}.pdf`,
      null,
      `seed_deck_${idx + 1}.pdf`,
      'Strategic deck analyzing fan transition, brand equity preservation, and academy monetization.',
      new Date(now - (idx + 1) * 3600000).toISOString(),
      new Date(now - (idx + 1) * 3600000).toISOString()
    ]);

    await db.execute(`
      INSERT INTO evaluations (
        id, submission_id, evaluation_version, evaluation_status,
        overall_score, problem_structuring_score, analytical_rigor_score,
        strategic_insight_score, feasibility_impact_score, communication_score,
        ai_rationale, strengths, weaknesses, evidence,
        is_mock, input_tokens, output_tokens, total_tokens, estimated_cost_usd,
        created_at
      )
      VALUES (
        ?, ?, 'mock-v1', 'mock_evaluated',
        50, 50, 50,
        50, 50, 50,
        NULL, NULL, NULL, NULL,
        1, 0, 0, 0, 0.00,
        ?
      )
      ON CONFLICT (submission_id, evaluation_version) DO NOTHING
    `, [
      `eval_seed_${idx + 1}`,
      subId,
      new Date(now - (idx + 1) * 3600000).toISOString()
    ]);
  }
}
