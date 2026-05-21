# Legal Champions

Pre-launch site + backend for **Legal Champions** — a Malaysian paralegal staffing service, supervised by Messrs Thomas Philip, Advocates & Solicitors.

## What's in here

| File / folder | What it is |
|---|---|
| `index.html` | Public website — hero, services, book form |
| `login.html` | Sign-in page for firm & paralegal accounts |
| `firm.html` | Firm portal — paralegal directory, engagements, briefs, billing, **live workspace** (create matters, upload documents) |
| `dashboard.html` | Paralegal dashboard — today's focus, matters, time, messages, **live workspace** (log time, upload deliverables) |
| `hero-image.webp` | Hero image (notebook + pen) |
| `api/` | Node + SQLite backend (Express). See [api/README.md](api/README.md) |
| `data/` | SQLite db + uploaded files (created on first server run, gitignored) |

## Run locally

```bash
cd api
npm install
npm start
```

Then open **http://localhost:4040**.

On first start the server seeds two demo accounts (printed in the console):

| Role | Email | Password |
|---|---|---|
| Firm | `aishah@tanpartners.my` | `champion` |
| Paralegal | `priya@legalchampions.my` | `champion` |

Sign in at `/login` and you'll land in the matching portal.

## What works end-to-end

- **Public intake** — waitlist / brief / contact forms post to SQLite, with optional SMTP notifications
- **Real authentication** — scrypt-hashed passwords, server-side session cookies (httpOnly, 7-day sliding), role-gated routes
- **Matters & time tracking** — firms create matters and assign paralegals; paralegals log hours per matter (real DB rows, summed against estimates)
- **File uploads** — multipart uploads gated to matter participants, files stored on the persistent volume next to the SQLite db, auth-gated downloads

Visit the **WORKSPACE** tab in either portal to exercise the live API.

## Deploy

The backend serves both the API and the static files, so a single deploy gets you the lot.

### Railway (currently live)

- Mount a Volume at `/data` (Settings → Volumes)
- Set env vars: `DB_PATH=/data/leads.db`, `UPLOAD_DIR=/data/uploads`, `NODE_ENV=production`, `ADMIN_USER`, `ADMIN_PASS`, optionally `SMTP_*`
- Railway will rebuild from `Dockerfile` on every push to `main`

### Fly.io (alternative)

A `fly.toml` is already in `api/`. From inside `api/`:

```bash
fly launch --copy-config --name legal-champions
fly volumes create lc_data --size 1
fly secrets set ADMIN_USER=... ADMIN_PASS=...
fly deploy
```

## Admin

The admin lead viewer lives at `/admin` (basic-auth, credentials via `ADMIN_USER` / `ADMIN_PASS`). This is separate from user accounts — it's just for reading waitlist / brief / contact form submissions.

## What's *not* in here yet

- Password reset / invite emails (today: ops resets via DB)
- Matter messaging / threaded comments (the inbox UI is still mocked)
- Invoicing — billing view is still mocked
- Calendar / one-click intake slot booking
- AU expansion (explicitly parked)

See `api/README.md` for the full API surface.
