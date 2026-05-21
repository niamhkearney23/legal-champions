// Authentication & session management for Legal Champions.
//
// - Passwords hashed with Node's built-in scrypt (no native deps).
// - Sessions stored in the DB, keyed by a random hex id that lives in
//   an httpOnly cookie. 7-day expiry, sliding refresh on every request.
// - Two user roles: 'firm' and 'paralegal'.
//
// Routes mounted by server.js:
//   POST /api/auth/login    { email, password } → { user }
//   POST /api/auth/logout
//   GET  /api/auth/me       → { user } or 401
//
// Middleware:
//   requireAuth()              — any signed-in user
//   requireAuth('firm')        — must be a firm user
//   requireAuth('paralegal')   — must be a paralegal

import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';

const COOKIE_NAME    = 'lc_session';
const SESSION_DAYS   = 7;
const SCRYPT_KEY_LEN = 64;
// scrypt cost parameter. 2^14 = 16384, ~100ms on modern hardware.
const SCRYPT_N       = 16384;

// ===== PASSWORD HASHING =====
// Stored format: scrypt$N$salt_hex$hash_hex

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, nStr, saltHex, hashHex] = parts;
  const N = parseInt(nStr, 10);
  if (!Number.isFinite(N) || N < 1024) return false;
  let salt, expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const computed = crypto.scryptSync(password, salt, expected.length, { N });
  return crypto.timingSafeEqual(expected, computed);
}

// ===== SESSIONS =====

const insertSession = db.prepare(`
  INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
  VALUES (?, ?, ?, ?, ?)
`);
const findSession = db.prepare(`
  SELECT s.id, s.user_id, s.expires_at,
         u.email, u.name, u.role, u.firm_id
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.id = ?
`);
const deleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const extendSession = db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`);
const purgeExpired = db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`);

// Run a purge on boot, then once an hour.
purgeExpired.run();
setInterval(() => { try { purgeExpired.run(); } catch (e) { console.error('[auth] purge', e); } }, 60 * 60 * 1000).unref();

function freshExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
}

function createSession(userId, req) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = freshExpiry();
  insertSession.run(
    id, userId, expires,
    (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim() || null,
    (req.headers['user-agent'] || '').slice(0, 400) || null
  );
  return { id, expires };
}

// ===== COOKIES =====

function parseCookies(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, value, expiresIso) {
  const expires = new Date(expiresIso).toUTCString();
  const secure  = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

// ===== MIDDLEWARE =====

// Attach req.user if a valid session cookie is present. Sliding refresh.
export function loadSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return next();

  const row = findSession.get(sid);
  if (!row) return next();

  if (new Date(row.expires_at) < new Date()) {
    deleteSession.run(sid);
    return next();
  }

  // Sliding refresh once per request.
  const newExpiry = freshExpiry();
  extendSession.run(newExpiry, sid);
  setSessionCookie(res, sid, newExpiry);

  req.user = {
    id:      row.user_id,
    email:   row.email,
    name:    row.name,
    role:    row.role,
    firm_id: row.firm_id
  };
  req.sessionId = sid;
  next();
}

export function requireAuth(role = null) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign-in required.' });
    if (role && req.user.role !== role) return res.status(403).json({ error: 'Forbidden.' });
    next();
  };
}

// Same as requireAuth() but for HTML page requests — redirects to /login
// instead of returning JSON.
export function requirePageAuth(req, res, next) {
  if (req.user) return next();
  const to = encodeURIComponent(req.originalUrl || '/');
  res.redirect(`/login?next=${to}`);
}

// ===== ROUTES =====

export const authRouter = Router();

const findUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`);

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password required.' });
  }
  const user = findUserByEmail.get(email.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    // Generic message — don't leak whether the email exists.
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const { id, expires } = createSession(user.id, req);
  setSessionCookie(res, id, expires);
  res.json({
    user: {
      id:      user.id,
      email:   user.email,
      name:    user.name,
      role:    user.role,
      firm_id: user.firm_id
    }
  });
});

authRouter.post('/logout', (req, res) => {
  if (req.sessionId) deleteSession.run(req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: req.user });
});
