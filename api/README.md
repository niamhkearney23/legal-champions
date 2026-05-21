# Legal Champions — backend

Small Node + SQLite backend with three concerns:

1. **Public site intake** — `waitlist`, `brief`, `contact` form submissions
2. **Accounts & auth** — firms, users (firm + paralegal roles), sessions
3. **Work** — matters, time entries, file uploads

No frameworks beyond Express, no build step, no external services required to run.

---

## Run locally

```bash
cd legal-champions/api
npm install
npm start
```

Then open:

- Public site → http://localhost:4040
- Sign in → http://localhost:4040/login
- Admin (leads) → http://localhost:4040/admin (user: `admin`, pass: `changeme`)

The server seeds two demo accounts on first start. Passwords are printed in the console:

| Role | Email | Password |
|---|---|---|
| Firm | `aishah@tanpartners.my` | `champion` |
| Paralegal | `priya@legalchampions.my` | `champion` |

To auto-restart on file changes:

```bash
npm run dev
```

---

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Server port | `4040` |
| `NODE_ENV` | Set to `production` to enable Secure cookies | (unset) |
| `ADMIN_USER` / `ADMIN_PASS` | Basic-auth for `/admin` leads viewer | `admin` / `changeme` — **change in prod** |
| `DB_PATH` | SQLite location | `../data/leads.db` |
| `UPLOAD_DIR` | Where uploaded files are stored | `<DB_PATH parent>/uploads` |
| `DEMO_PASSWORD` | Password used when seeding demo accounts | `champion` |
| `NOTIFY_EMAIL` | Where intake notifications are sent | `engage@legalchampions.my` |
| `MAIL_FROM` | From address on notifications | `Legal Champions <noreply@legalchampions.my>` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP credentials (optional) | — |

On Railway/Fly with a `/data` volume mounted:

```
DB_PATH=/data/leads.db
UPLOAD_DIR=/data/uploads
NODE_ENV=production
```

---

## API surface

All endpoints accept JSON (except file upload, which is `multipart/form-data`). Same-origin. Auth via `lc_session` httpOnly cookie set by `/api/auth/login`.

### Public intake (no auth)

| Method | Path | Body |
|---|---|---|
| POST | `/api/waitlist` | `{ firm, name, email, area?, notes? }` |
| POST | `/api/brief` | `{ firm, name, position?, email, phone, practice_area, engagement_type, outline, timeline? }` |
| POST | `/api/contact` | `{ channel, email?, message, context? }` |

Rate-limited to 20 writes / IP / 5 min. Success → `{ ok: true, id }`.

### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → sets cookie, returns `{ user }` |
| POST | `/api/auth/logout` | clears cookie |
| GET  | `/api/auth/me` | returns current `{ user }` or 401 |

Passwords are hashed with scrypt (built-in Node crypto, N=16384, 64-byte key, 16-byte salt). Sessions live in the DB, 7-day sliding expiry.

### Matters (auth required)

| Method | Path | Who | What |
|---|---|---|---|
| GET    | `/api/matters` | any | matters scoped to your firm (firm role) or assignments (paralegal role) |
| POST   | `/api/matters` | firm | create matter `{ title, description?, practice_area?, estimated_hours?, deadline?, paralegal_id? }` |
| GET    | `/api/matters/:id` | participants | matter detail incl. `hours_logged` |
| PATCH  | `/api/matters/:id` | firm / assigned paralegal | update status, etc. (paralegals can only change status, not closed/on-hold) |

### Time entries

| Method | Path | Who | What |
|---|---|---|---|
| GET    | `/api/matters/:id/time` | participants | list entries |
| POST   | `/api/matters/:id/time` | assigned paralegal | `{ hours, description, entry_date?, billable? }` |

### Files

| Method | Path | Who | What |
|---|---|---|---|
| GET    | `/api/matters/:id/files` | participants | list files |
| POST   | `/api/matters/:id/files` | participants | `multipart/form-data` with field `file`, max 25 MB |
| GET    | `/api/files/:id` | participants | stream download (auth-gated) |

Files are stored under `UPLOAD_DIR` with random hex filenames; original name kept in the `files` row. Download responses set `Content-Disposition: attachment`.

### Paralegals directory

| Method | Path | What |
|---|---|---|
| GET | `/api/paralegals` | list of paralegal profiles for firm-side assignment |

---

## Schema (SQLite)

```
firms          (id, name, created_at)
users          (id, email UNIQUE, password_hash, role IN ('firm','paralegal'),
                name, firm_id?, bio?, hourly_rate?, specialisms?, availability)
sessions       (id PK, user_id, expires_at, ip, user_agent, created_at)

matters        (id, title, description?, firm_id, paralegal_id?, created_by,
                practice_area?, status, estimated_hours?, deadline?, created_at)
time_entries   (id, matter_id, paralegal_id, entry_date, hours, description,
                billable, created_at)
files          (id, matter_id, uploader_id, storage_name, original_name,
                mime_type, size_bytes, created_at)

waitlist / briefs / contacts  — original public-intake tables
```

Foreign keys are enforced. Time entries cascade-delete with matters. Sessions cascade-delete with users.

---

## Admin

`/admin` (basic-auth) shows three tables:

- Waiting list signups
- Brief submissions
- Contact / chatbot messages

CSV download per table at `/admin/<table>.csv`.

This is the lead viewer, deliberately separate from the user account system.

---

## Deploying

Any Node host with persistent file storage works (Railway, Render, Fly.io, a small VPS). Vercel/Netlify Functions don't keep the SQLite file or uploaded files between cold starts — for those, swap `db.js` to Postgres and the file storage to S3.

### Railway (currently live)

1. Push to GitHub.
2. New service from the repo (auto-detects the Dockerfile at the root).
3. Add a Volume mounted at `/data`.
4. Set env: `DB_PATH=/data/leads.db`, `UPLOAD_DIR=/data/uploads`, `NODE_ENV=production`, `ADMIN_USER`, `ADMIN_PASS`, optionally `SMTP_*`.
5. Push to `main` → Railway rebuilds.

### Fly.io

Similar — `fly launch --copy-config`, create a volume, set secrets, `fly deploy`.

---

## Still to build

- Password reset & invite flow (today: ops resets via DB)
- Per-matter threaded messages (inbox UI is still mocked)
- Invoicing — billing view is mocked
- Calendar / slot booking
- Webhook integrations
- AU expansion (explicitly parked)
