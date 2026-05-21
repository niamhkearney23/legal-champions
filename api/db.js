// SQLite store for Legal Champions.
//
// Three concerns live here:
//   1. PUBLIC SITE INTAKE  — waitlist / brief / contact form submissions
//   2. ACCOUNTS & AUTH     — firms, users (firm + paralegal roles), sessions
//   3. WORK                — matters, time entries, file uploads
//
// One SQLite file, no separate DB server.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDir = resolve(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || resolve(defaultDir, 'leads.db');

// Make sure the directory the SQLite file lives in actually exists.
// On Railway/Fly with DB_PATH=/data/leads.db, this creates /data on first boot
// if the volume mount doesn't already provide it.
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== SCHEMA =====
db.exec(`
  -- ===== PUBLIC INTAKE =====
  CREATE TABLE IF NOT EXISTS waitlist (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    firm          TEXT NOT NULL,
    contact_name  TEXT NOT NULL,
    email         TEXT NOT NULL,
    practice_area TEXT,
    notes         TEXT,
    ip            TEXT,
    user_agent    TEXT
  );

  CREATE TABLE IF NOT EXISTS briefs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    firm            TEXT NOT NULL,
    contact_name    TEXT NOT NULL,
    position        TEXT,
    email           TEXT NOT NULL,
    phone           TEXT,
    practice_area   TEXT NOT NULL,
    engagement_type TEXT NOT NULL,
    outline         TEXT NOT NULL,
    timeline        TEXT,
    ip              TEXT,
    user_agent      TEXT
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    channel     TEXT NOT NULL,
    email       TEXT,
    message     TEXT NOT NULL,
    context     TEXT,
    ip          TEXT,
    user_agent  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_briefs_created   ON briefs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(created_at DESC);

  -- ===== ACCOUNTS & AUTH =====
  CREATE TABLE IF NOT EXISTS firms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('firm','paralegal')),
    name           TEXT NOT NULL,
    -- for role='firm'
    firm_id        INTEGER REFERENCES firms(id) ON DELETE SET NULL,
    -- for role='paralegal'
    bio            TEXT,
    hourly_rate    INTEGER,
    specialisms    TEXT,
    availability   TEXT DEFAULT 'available' CHECK (availability IN ('available','limited','capacity'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- ===== WORK =====
  CREATE TABLE IF NOT EXISTS matters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    title           TEXT NOT NULL,
    description     TEXT,
    firm_id         INTEGER NOT NULL REFERENCES firms(id),
    paralegal_id    INTEGER REFERENCES users(id),
    created_by      INTEGER REFERENCES users(id),
    practice_area   TEXT,
    status          TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','in-progress','in-review','delivered','closed','on-hold')),
    estimated_hours REAL,
    deadline        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_matters_firm      ON matters(firm_id);
  CREATE INDEX IF NOT EXISTS idx_matters_paralegal ON matters(paralegal_id);
  CREATE INDEX IF NOT EXISTS idx_matters_status    ON matters(status);

  CREATE TABLE IF NOT EXISTS time_entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    matter_id     INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    paralegal_id  INTEGER NOT NULL REFERENCES users(id),
    entry_date    TEXT NOT NULL,
    hours         REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
    description   TEXT NOT NULL,
    billable      INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_time_matter    ON time_entries(matter_id);
  CREATE INDEX IF NOT EXISTS idx_time_paralegal ON time_entries(paralegal_id);
  CREATE INDEX IF NOT EXISTS idx_time_date      ON time_entries(entry_date DESC);

  CREATE TABLE IF NOT EXISTS files (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    matter_id      INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    uploader_id    INTEGER NOT NULL REFERENCES users(id),
    storage_name   TEXT NOT NULL,
    original_name  TEXT NOT NULL,
    mime_type      TEXT,
    size_bytes     INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_matter ON files(matter_id);
`);

// ===== PREPARED STATEMENTS — public intake =====
const insertWaitlist = db.prepare(`
  INSERT INTO waitlist (firm, contact_name, email, practice_area, notes, ip, user_agent)
  VALUES (@firm, @contact_name, @email, @practice_area, @notes, @ip, @user_agent)
`);

const insertBrief = db.prepare(`
  INSERT INTO briefs
    (firm, contact_name, position, email, phone, practice_area, engagement_type, outline, timeline, ip, user_agent)
  VALUES
    (@firm, @contact_name, @position, @email, @phone, @practice_area, @engagement_type, @outline, @timeline, @ip, @user_agent)
`);

const insertContact = db.prepare(`
  INSERT INTO contacts (channel, email, message, context, ip, user_agent)
  VALUES (@channel, @email, @message, @context, @ip, @user_agent)
`);

const allWaitlist = db.prepare(`SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?`);
const allBriefs   = db.prepare(`SELECT * FROM briefs   ORDER BY created_at DESC LIMIT ?`);
const allContacts = db.prepare(`SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?`);

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM waitlist) AS waitlist,
    (SELECT COUNT(*) FROM briefs)   AS briefs,
    (SELECT COUNT(*) FROM contacts) AS contacts,
    (SELECT COUNT(*) FROM users)    AS users,
    (SELECT COUNT(*) FROM matters)  AS matters
`);

// ===== EXPORTED API — intake =====
export function saveWaitlist(row) { return { id: insertWaitlist.run(row).lastInsertRowid }; }
export function saveBrief(row)    { return { id: insertBrief.run(row).lastInsertRowid }; }
export function saveContact(row)  { return { id: insertContact.run(row).lastInsertRowid }; }

export function listAll(limit = 200) {
  return {
    waitlist: allWaitlist.all(limit),
    briefs:   allBriefs.all(limit),
    contacts: allContacts.all(limit),
    counts:   counts.get()
  };
}

export function csvForTable(table) {
  const stmts = { waitlist: allWaitlist, briefs: allBriefs, contacts: allContacts };
  const rows = stmts[table].all(10000);
  if (!rows.length) return 'id\n';
  const cols = Object.keys(rows[0]);
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    cols.join(','),
    ...rows.map(r => cols.map(c => escape(r[c])).join(','))
  ].join('\n');
}

console.log(`[db] open at ${dbPath}`);
