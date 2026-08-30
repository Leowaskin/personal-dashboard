import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

fs.mkdirSync(path.dirname(config.DATABASE_PATH), { recursive: true });
export const sqlite = new Database(config.DATABASE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'ONE_TIME', status TEXT NOT NULL DEFAULT 'PENDING',
    priority INTEGER NOT NULL DEFAULT 3, estimated_minutes INTEGER NOT NULL DEFAULT 30,
    deadline TEXT, earliest_start TEXT, preferred_time TEXT NOT NULL DEFAULT 'ANY',
    energy TEXT NOT NULL DEFAULT 'MEDIUM', splittable INTEGER NOT NULL DEFAULT 0,
    minimum_chunk_minutes INTEGER NOT NULL DEFAULT 30, recurrence_rule TEXT,
    completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_occurrences (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    occurrence_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', completed_at TEXT,
    UNIQUE(task_id, occurrence_date)
  );
  CREATE TABLE IF NOT EXISTS schedule_blocks (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    start TEXT NOT NULL, end TEXT NOT NULL, calendar_event_id TEXT, state TEXT NOT NULL DEFAULT 'PLANNED',
    plan_run_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id = 1), timezone TEXT NOT NULL, day_start TEXT NOT NULL DEFAULT '08:00',
    day_end TEXT NOT NULL DEFAULT '22:00', working_days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
    event_buffer_minutes INTEGER NOT NULL DEFAULT 10, maximum_planned_minutes INTEGER NOT NULL DEFAULT 480,
    briefing_time TEXT NOT NULL DEFAULT '08:00', onboarding_complete INTEGER NOT NULL DEFAULT 0,
    auto_plan_enabled INTEGER NOT NULL DEFAULT 0, agent_calendar_id TEXT,
    include_news_in_briefing INTEGER NOT NULL DEFAULT 1,
    news_topics TEXT NOT NULL DEFAULT '["artificial intelligence","software and technology","startups and business"]',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plan_runs (
    id TEXT PRIMARY KEY, reason TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS briefings (
    id TEXT PRIMARY KEY, briefing_date TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'PENDING', sent_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_actions (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, action TEXT NOT NULL, input TEXT NOT NULL,
    result TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS web_search_runs (
    id TEXT PRIMARY KEY, query TEXT NOT NULL, provider TEXT NOT NULL, result_urls TEXT NOT NULL,
    status TEXT NOT NULL, latency_ms INTEGER NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_blocks_start ON schedule_blocks(start);
  CREATE INDEX IF NOT EXISTS idx_web_search_runs_created ON web_search_runs(created_at);
`);

// The app manages its own small SQLite schema. Keep existing local data intact
// when introducing settings columns after a user has already started using it.
const settingsColumns = new Set((sqlite.prepare('PRAGMA table_info(settings)').all() as Array<{ name: string }>).map((column) => column.name));
if (!settingsColumns.has('include_news_in_briefing')) sqlite.exec('ALTER TABLE settings ADD COLUMN include_news_in_briefing INTEGER NOT NULL DEFAULT 1');
if (!settingsColumns.has('news_topics')) sqlite.exec("ALTER TABLE settings ADD COLUMN news_topics TEXT NOT NULL DEFAULT '[\"artificial intelligence\",\"software and technology\",\"startups and business\"]'");

const now = new Date().toISOString();
sqlite.prepare(`INSERT OR IGNORE INTO settings (id, timezone, updated_at) VALUES (1, ?, ?)`).run(
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  now,
);

export const db = drizzle(sqlite, { schema });
