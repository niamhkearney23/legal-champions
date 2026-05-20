// Legal Champions backend.
// Serves the static site from the parent folder, exposes /api/* for form submissions,
// and a basic-auth /admin page for viewing captured leads.
//
// Run:    npm install && npm start
// Env:    PORT, ADMIN_USER, ADMIN_PASS, NOTIFY_EMAIL, SMTP_*

import express from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveWaitlist, saveBrief, saveContact, listAll, csvForTable } from './db.js';
import { sendNotification } from './mail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot  = resolve(__dirname, '..');

const PORT        = parseInt(process.env.PORT || '4040', 10);
const ADMIN_USER  = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS || 'changeme';

const app = express();
app.use(express.json({ limit: '64kb' }));
app.disable('x-powered-by');

// ===== HELPERS =====
const clientIp = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
const clientUa = req => (req.headers['user-agent'] || '').slice(0, 400);

const isEmail = v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const isStr   = (v, min = 1, max = 2000) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const trim    = v => (typeof v === 'string' ? v.trim() : v);

function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type === 'Basic' && token) {
    const [user, pass] = Buffer.from(token, 'base64').toString().split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Legal Champions admin"').status(401).end('Authentication required.');
}

// Tiny rolling rate limit: max 20 writes / IP / 5 min.
const buckets = new Map();
function rateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const max = 20;
  const arr = (buckets.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  arr.push(now);
  buckets.set(ip, arr);
  next();
}

// ===== API =====
app.post('/api/waitlist', rateLimit, async (req, res) => {
  const b = req.body || {};
  if (!isStr(b.firm, 1, 200))         return res.status(400).json({ error: 'Firm name required.' });
  if (!isStr(b.name, 1, 200))         return res.status(400).json({ error: 'Your name required.' });
  if (!isEmail(b.email))              return res.status(400).json({ error: 'A valid email is required.' });
  if (b.area && !isStr(b.area, 1, 200))         return res.status(400).json({ error: 'Practice area too long.' });
  if (b.notes && !isStr(b.notes, 1, 2000))      return res.status(400).json({ error: 'Notes too long.' });

  const row = {
    firm:          trim(b.firm),
    contact_name:  trim(b.name),
    email:         trim(b.email),
    practice_area: trim(b.area)  || null,
    notes:         trim(b.notes) || null,
    ip:            clientIp(req),
    user_agent:    clientUa(req)
  };
  const { id } = saveWaitlist(row);
  await sendNotification('waitlist', row).catch(err => console.error('[mail]', err));
  res.json({ ok: true, id });
});

app.post('/api/brief', rateLimit, async (req, res) => {
  const b = req.body || {};
  if (!isStr(b.firm, 1, 200))             return res.status(400).json({ error: 'Firm name required.' });
  if (!isStr(b.name, 1, 200))             return res.status(400).json({ error: 'Your name required.' });
  if (!isEmail(b.email))                  return res.status(400).json({ error: 'A valid email is required.' });
  if (!isStr(b.phone, 1, 50))             return res.status(400).json({ error: 'Phone required.' });
  if (!isStr(b.practice_area, 1, 200))    return res.status(400).json({ error: 'Practice area required.' });
  if (!isStr(b.engagement_type, 1, 200))  return res.status(400).json({ error: 'Engagement type required.' });
  if (!isStr(b.outline, 1, 5000))         return res.status(400).json({ error: 'Outline required (1–5000 chars).' });

  const row = {
    firm:            trim(b.firm),
    contact_name:    trim(b.name),
    position:        trim(b.position) || null,
    email:           trim(b.email),
    phone:           trim(b.phone),
    practice_area:   trim(b.practice_area),
    engagement_type: trim(b.engagement_type),
    outline:         trim(b.outline),
    timeline:        trim(b.timeline) || null,
    ip:              clientIp(req),
    user_agent:      clientUa(req)
  };
  const { id } = saveBrief(row);
  await sendNotification('brief', row).catch(err => console.error('[mail]', err));
  res.json({ ok: true, id });
});

app.post('/api/contact', rateLimit, async (req, res) => {
  const b = req.body || {};
  if (!isStr(b.channel, 1, 50))   return res.status(400).json({ error: 'Channel required.' });
  if (!isStr(b.message, 1, 5000)) return res.status(400).json({ error: 'Message required.' });
  if (b.email && !isEmail(b.email)) return res.status(400).json({ error: 'Email is invalid.' });

  const row = {
    channel:    trim(b.channel),
    email:      trim(b.email) || null,
    message:    trim(b.message),
    context:    b.context ? JSON.stringify(b.context).slice(0, 4000) : null,
    ip:         clientIp(req),
    user_agent: clientUa(req)
  };
  const { id } = saveContact(row);
  await sendNotification('contact', row).catch(err => console.error('[mail]', err));
  res.json({ ok: true, id });
});

// ===== ADMIN =====
app.get('/admin', basicAuth, async (req, res) => {
  const html = await readFile(resolve(__dirname, 'admin.html'), 'utf8');
  res.type('html').send(html);
});

app.get('/admin/data.json', basicAuth, (req, res) => {
  res.json(listAll(500));
});

app.get('/admin/:table.csv', basicAuth, (req, res) => {
  const t = req.params.table;
  if (!['waitlist', 'briefs', 'contacts'].includes(t)) return res.status(404).end();
  res.type('text/csv').attachment(`legal-champions-${t}.csv`).send(csvForTable(t));
});

// ===== HEALTH =====
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ===== STATIC SITE =====
// Served last so /api/* and /admin take precedence.
app.use(express.static(siteRoot, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`[server] up on http://localhost:${PORT}`);
  console.log(`[server] admin at http://localhost:${PORT}/admin (user: ${ADMIN_USER})`);
  console.log(`[server] site root: ${siteRoot}`);
});
