import { initPool, getPool } from "./client.js";

async function addColumnIfMissing(client, table, column, columnDef) {
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  if (rs.rows.some(c => c.name === column)) return;
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDef}`);
}

export async function initDB() {
  const client = initPool();

  // users — present but currently UNUSED by this backend. Auth is stateless
  // (shared JWT secret with the cold backend), and scoring is rule-based, so
  // nothing here reads/writes users. Kept for schema parity / future use.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_sub TEXT,
      is_admin INTEGER DEFAULT 0,
      gmail_address TEXT,
      gmail_app_password TEXT,
      gmail_refresh_token TEXT,
      claude_api_key TEXT,
      gemini_api_key TEXT,
      gemini_keys_json TEXT,
      full_name TEXT,
      phone TEXT,
      portfolio_url TEXT,
      linkedin_url TEXT,
      current_role TEXT,
      current_company TEXT,
      graduation_month_year TEXT,
      target_role TEXT,
      background_text TEXT,
      projects_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      source TEXT NOT NULL,
      job_url TEXT NOT NULL,
      posted_at TEXT,
      posted_at_parsed INTEGER,
      experience_required TEXT,
      skills TEXT,
      salary TEXT,
      is_startup INTEGER DEFAULT 0,
      ai_score INTEGER,
      ai_reason TEXT,
      status TEXT DEFAULT 'unseen',
      applied_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS li_leads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT,
      company TEXT,
      profile_url TEXT NOT NULL,
      ai_score INTEGER,
      ai_reason TEXT,
      category TEXT,
      connect_status TEXT DEFAULT 'not_queued',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS connection_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lead_id TEXT,
      profile_url TEXT NOT NULL,
      name TEXT,
      title TEXT,
      company TEXT,
      source TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'pending',
      queued_at TEXT DEFAULT (datetime('now')),
      attempted_at TEXT,
      result_at TEXT,
      error_msg TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS connections_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      profile_url TEXT NOT NULL,
      name TEXT,
      company TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      source TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT NOT NULL,
      user_id TEXT NOT NULL,
      connections_sent INTEGER DEFAULT 0,
      connections_failed INTEGER DEFAULT 0,
      jobs_scraped INTEGER DEFAULT 0,
      leads_found INTEGER DEFAULT 0,
      PRIMARY KEY (date, user_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS gemini_key_stats (
      key_index INTEGER PRIMARY KEY,
      call_count INTEGER DEFAULT 0,
      last_429_at TEXT,
      total_tokens_approx INTEGER DEFAULT 0
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS find_leads_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      company TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (key, user_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS scrape_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      mode TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'pending',
      message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Backfill missing columns on pre-existing tables from the older single-user schema.
  await addColumnIfMissing(client, "jobs", "user_id", "TEXT");
  await addColumnIfMissing(client, "jobs", "notes", "TEXT");
  await addColumnIfMissing(client, "li_leads", "user_id", "TEXT");
  await addColumnIfMissing(client, "li_leads", "profile_url", "TEXT");
  await addColumnIfMissing(client, "li_leads", "job_id", "TEXT");
  await addColumnIfMissing(client, "li_leads", "ai_score", "INTEGER");
  await addColumnIfMissing(client, "li_leads", "ai_reason", "TEXT");
  await addColumnIfMissing(client, "li_leads", "category", "TEXT");
  await addColumnIfMissing(client, "li_leads", "connect_status", "TEXT");
  await addColumnIfMissing(client, "connection_queue", "user_id", "TEXT");
  await addColumnIfMissing(client, "connection_queue", "profile_url", "TEXT");
  await addColumnIfMissing(client, "scrape_tasks", "company", "TEXT");

  // Expression-based unique indexes for dedup
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_source_company_title_url
    ON jobs (user_id, lower(source), lower(company), lower(title), lower(trim(job_url)))
  `);
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_li_leads_user_profile_job
    ON li_leads (user_id, profile_url, job_id)
  `);

  console.log("[DB] libsql schema initialized");
}

export function getDB() {
  return getPool();
}
