// Matters, time entries, and file uploads.
//
// Access rules:
//   - Firms see only their own matters (firm_id = req.user.firm_id).
//   - Paralegals see matters assigned to them (paralegal_id = req.user.id).
//   - Firms can create matters; paralegals can log time; both can view files.
//   - File uploads/downloads are gated to participants in the matter.
//
// Routes (all under /api, all require an auth session):
//
//   GET    /api/matters                       list (scoped to role)
//   POST   /api/matters                       create   (firm only)
//   GET    /api/matters/:id                   detail   (participants only)
//   PATCH  /api/matters/:id                   update   (firm or assigned paralegal)
//
//   GET    /api/matters/:id/time              list time entries
//   POST   /api/matters/:id/time              log time (paralegal only, assigned)
//
//   GET    /api/matters/:id/files             list files
//   POST   /api/matters/:id/files             upload (multipart/form-data 'file')
//   GET    /api/files/:id                     download
//
//   GET    /api/paralegals                    directory (firms see this to assign)

import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { createReadStream, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { requireAuth } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== UPLOAD STORAGE =====
// Files live alongside the SQLite db on the persistent volume.
// On Railway: /data/uploads (volume mounted at /data).
// Locally:    <repo>/data/uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || resolve(__dirname, '..', 'data', 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      // Generate random filename to avoid collisions + path traversal.
      const ext  = (file.originalname.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
      const name = crypto.randomBytes(20).toString('hex') + ext;
      cb(null, name);
    }
  }),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
    files: 1
  }
});

// ===== PREPARED STATEMENTS =====

const insertMatter = db.prepare(`
  INSERT INTO matters
    (title, description, firm_id, paralegal_id, created_by, practice_area, status, estimated_hours, deadline)
  VALUES
    (@title, @description, @firm_id, @paralegal_id, @created_by, @practice_area, @status, @estimated_hours, @deadline)
`);

const findMatter = db.prepare(`
  SELECT m.*,
         f.name AS firm_name,
         u.name AS paralegal_name,
         u.email AS paralegal_email,
         (SELECT IFNULL(SUM(hours),0) FROM time_entries te WHERE te.matter_id = m.id) AS hours_logged
  FROM matters m
  LEFT JOIN firms f ON f.id = m.firm_id
  LEFT JOIN users u ON u.id = m.paralegal_id
  WHERE m.id = ?
`);

const listMattersForFirm = db.prepare(`
  SELECT m.id, m.title, m.status, m.estimated_hours, m.deadline, m.practice_area, m.created_at,
         u.name AS paralegal_name,
         (SELECT IFNULL(SUM(hours),0) FROM time_entries te WHERE te.matter_id = m.id) AS hours_logged
  FROM matters m
  LEFT JOIN users u ON u.id = m.paralegal_id
  WHERE m.firm_id = ?
  ORDER BY m.created_at DESC
`);

const listMattersForParalegal = db.prepare(`
  SELECT m.id, m.title, m.status, m.estimated_hours, m.deadline, m.practice_area, m.created_at,
         f.name AS firm_name,
         (SELECT IFNULL(SUM(hours),0) FROM time_entries te WHERE te.matter_id = m.id) AS hours_logged
  FROM matters m
  LEFT JOIN firms f ON f.id = m.firm_id
  WHERE m.paralegal_id = ?
  ORDER BY m.created_at DESC
`);

const updateMatter = db.prepare(`
  UPDATE matters
  SET status          = COALESCE(@status, status),
      estimated_hours = COALESCE(@estimated_hours, estimated_hours),
      deadline        = COALESCE(@deadline, deadline),
      paralegal_id    = COALESCE(@paralegal_id, paralegal_id),
      title           = COALESCE(@title, title),
      description     = COALESCE(@description, description)
  WHERE id = @id
`);

const insertTimeEntry = db.prepare(`
  INSERT INTO time_entries (matter_id, paralegal_id, entry_date, hours, description, billable)
  VALUES (@matter_id, @paralegal_id, @entry_date, @hours, @description, @billable)
`);

const listTimeForMatter = db.prepare(`
  SELECT te.id, te.entry_date, te.hours, te.description, te.billable, te.created_at,
         u.name AS paralegal_name
  FROM time_entries te JOIN users u ON u.id = te.paralegal_id
  WHERE te.matter_id = ?
  ORDER BY te.entry_date DESC, te.id DESC
`);

const insertFile = db.prepare(`
  INSERT INTO files (matter_id, uploader_id, storage_name, original_name, mime_type, size_bytes)
  VALUES (@matter_id, @uploader_id, @storage_name, @original_name, @mime_type, @size_bytes)
`);

const listFilesForMatter = db.prepare(`
  SELECT fi.id, fi.original_name, fi.mime_type, fi.size_bytes, fi.created_at,
         u.name AS uploader_name
  FROM files fi JOIN users u ON u.id = fi.uploader_id
  WHERE fi.matter_id = ?
  ORDER BY fi.created_at DESC
`);

const findFile = db.prepare(`
  SELECT fi.*, m.firm_id, m.paralegal_id
  FROM files fi JOIN matters m ON m.id = fi.matter_id
  WHERE fi.id = ?
`);

const listParalegals = db.prepare(`
  SELECT id, name, email, bio, hourly_rate, specialisms, availability
  FROM users WHERE role = 'paralegal' ORDER BY name ASC
`);

// ===== HELPERS =====

function canSeeMatter(user, matter) {
  if (!matter) return false;
  if (user.role === 'firm')      return matter.firm_id === user.firm_id;
  if (user.role === 'paralegal') return matter.paralegal_id === user.id;
  return false;
}

function isFirmOf(user, matter) {
  return user.role === 'firm' && matter && matter.firm_id === user.firm_id;
}

function isAssignedParalegal(user, matter) {
  return user.role === 'paralegal' && matter && matter.paralegal_id === user.id;
}

function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

const ALLOWED_STATUS = ['proposed','in-progress','in-review','delivered','closed','on-hold'];

// ===== ROUTER =====

export const matterRouter = Router();
export const fileRouter = Router();

// --- list ---
matterRouter.get('/', requireAuth(), (req, res) => {
  if (req.user.role === 'firm') {
    if (!req.user.firm_id) return res.json({ matters: [] });
    return res.json({ matters: listMattersForFirm.all(req.user.firm_id) });
  }
  return res.json({ matters: listMattersForParalegal.all(req.user.id) });
});

// --- create (firm only) ---
matterRouter.post('/', requireAuth('firm'), (req, res) => {
  if (!req.user.firm_id) return bad(res, 'Your account isn\'t linked to a firm yet.', 400);
  const b = req.body || {};
  if (typeof b.title !== 'string' || b.title.trim().length < 3) return bad(res, 'Title is required.');
  if (b.description && typeof b.description !== 'string')       return bad(res, 'Description must be text.');
  if (b.paralegal_id != null && !Number.isInteger(b.paralegal_id)) return bad(res, 'Invalid paralegal_id.');
  if (b.estimated_hours != null && !(b.estimated_hours > 0 && b.estimated_hours <= 1000)) return bad(res, 'Invalid estimate.');
  if (b.deadline && typeof b.deadline !== 'string') return bad(res, 'Deadline must be an ISO date string.');

  const r = insertMatter.run({
    title:           b.title.trim(),
    description:     b.description?.trim() || null,
    firm_id:         req.user.firm_id,
    paralegal_id:    b.paralegal_id ?? null,
    created_by:      req.user.id,
    practice_area:   b.practice_area?.trim() || null,
    status:          'proposed',
    estimated_hours: b.estimated_hours ?? null,
    deadline:        b.deadline || null
  });
  res.json({ matter: findMatter.get(r.lastInsertRowid) });
});

// --- detail ---
matterRouter.get('/:id', requireAuth(), (req, res) => {
  const m = findMatter.get(req.params.id);
  if (!canSeeMatter(req.user, m)) return bad(res, 'Not found.', 404);
  res.json({ matter: m });
});

// --- update ---
matterRouter.patch('/:id', requireAuth(), (req, res) => {
  const m = findMatter.get(req.params.id);
  if (!canSeeMatter(req.user, m)) return bad(res, 'Not found.', 404);

  const b = req.body || {};
  // Status: assigned paralegal can change to in-progress/in-review/delivered.
  // Firm can change to anything. on-hold/closed by firm only.
  if (b.status != null) {
    if (!ALLOWED_STATUS.includes(b.status)) return bad(res, 'Invalid status.');
    if (req.user.role === 'paralegal' && ['closed','on-hold'].includes(b.status)) {
      return bad(res, 'Only the firm can close or hold a matter.', 403);
    }
  }
  // Only firms can reassign paralegal.
  if (b.paralegal_id != null && req.user.role !== 'firm') {
    return bad(res, 'Only the firm can reassign a paralegal.', 403);
  }
  // Only firms can change title / estimate / deadline.
  if (req.user.role === 'paralegal') {
    if (b.title != null || b.estimated_hours != null || b.deadline != null || b.description != null) {
      return bad(res, 'Paralegals can only update status.', 403);
    }
  }

  updateMatter.run({
    id: m.id,
    status:          b.status ?? null,
    estimated_hours: b.estimated_hours ?? null,
    deadline:        b.deadline ?? null,
    paralegal_id:    b.paralegal_id ?? null,
    title:           b.title?.trim() ?? null,
    description:     b.description?.trim() ?? null
  });
  res.json({ matter: findMatter.get(m.id) });
});

// --- time entries ---
matterRouter.get('/:id/time', requireAuth(), (req, res) => {
  const m = findMatter.get(req.params.id);
  if (!canSeeMatter(req.user, m)) return bad(res, 'Not found.', 404);
  res.json({ entries: listTimeForMatter.all(m.id) });
});

matterRouter.post('/:id/time', requireAuth('paralegal'), (req, res) => {
  const m = findMatter.get(req.params.id);
  if (!isAssignedParalegal(req.user, m)) return bad(res, 'Not your matter.', 403);

  const b = req.body || {};
  const hours = parseFloat(b.hours);
  if (!(hours > 0 && hours <= 24)) return bad(res, 'Hours must be between 0 and 24.');
  if (typeof b.description !== 'string' || b.description.trim().length < 2) return bad(res, 'Description required.');
  const entryDate = b.entry_date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return bad(res, 'entry_date must be YYYY-MM-DD.');

  const r = insertTimeEntry.run({
    matter_id:    m.id,
    paralegal_id: req.user.id,
    entry_date:   entryDate,
    hours,
    description:  b.description.trim(),
    billable:     b.billable === false ? 0 : 1
  });
  res.json({ id: r.lastInsertRowid, hours_logged: findMatter.get(m.id).hours_logged });
});

// --- files: list ---
matterRouter.get('/:id/files', requireAuth(), (req, res) => {
  const m = findMatter.get(req.params.id);
  if (!canSeeMatter(req.user, m)) return bad(res, 'Not found.', 404);
  res.json({ files: listFilesForMatter.all(m.id) });
});

// --- files: upload (multipart) ---
matterRouter.post('/:id/files', requireAuth(), upload.single('file'), (req, res) => {
  const m = findMatter.get(req.params.id);
  if (!canSeeMatter(req.user, m)) return bad(res, 'Not found.', 404);
  if (!req.file) return bad(res, 'No file received.');

  const r = insertFile.run({
    matter_id:     m.id,
    uploader_id:   req.user.id,
    storage_name:  req.file.filename,
    original_name: req.file.originalname.slice(0, 255),
    mime_type:     req.file.mimetype || null,
    size_bytes:    req.file.size
  });
  res.json({
    file: {
      id: r.lastInsertRowid,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size
    }
  });
});

// --- files: download (mounted separately so the path is /api/files/:id) ---
fileRouter.get('/:id', requireAuth(), (req, res) => {
  const f = findFile.get(req.params.id);
  if (!f) return bad(res, 'Not found.', 404);
  // Reconstruct a fake matter object for the access check.
  const matterShape = { firm_id: f.firm_id, paralegal_id: f.paralegal_id };
  if (!canSeeMatter(req.user, matterShape)) return bad(res, 'Not found.', 404);

  const path = resolve(UPLOAD_DIR, f.storage_name);
  // Make sure resolved path stays inside UPLOAD_DIR (paranoia).
  if (!path.startsWith(UPLOAD_DIR)) return bad(res, 'Forbidden.', 403);
  try { statSync(path); } catch { return bad(res, 'File missing on disk.', 410); }

  if (f.mime_type) res.type(f.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.original_name)}"`);
  createReadStream(path).pipe(res);
});

// --- paralegals directory (for firm-side assignment) ---
export const paralegalRouter = Router();
paralegalRouter.get('/', requireAuth(), (req, res) => {
  res.json({ paralegals: listParalegals.all() });
});
