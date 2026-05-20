// SQLite store for waitlist, briefs, and contact submissions.
// Single file, no separate DB server needed.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || resolve(dataDir, 'leads.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== SCHEMA =====
db.exec(`
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
`);

// ===== PREPARED STATEMENTS =====
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
    (SELECT COUNT(*) FROM contacts) AS contacts
`);

// ===== EXPORTED API =====
export function saveWaitlist(row) {
  const r = insertWaitlist.run(row);
  return { id: r.lastInsertRowid };
}

export function saveBrief(row) {
  const r = insertBrief.run(row);
  return { id: r.lastInsertRowid };
}

export function saveContact(row) {
  const r = insertContact.run(row);
  return { id: r.lastInsertRowid };
}

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
