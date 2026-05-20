# Legal Champions — backend

Small Node + SQLite backend that:

- Serves the static site (`index.html`, `firm.html`, `dashboard.html`, `demo.html`)
- Captures every form submission into SQLite (`../data/leads.db`)
- Optionally emails a notification to `engage@legalchampions.my`
- Provides an admin page at `/admin` to view & export submissions

No frameworks, no build step, no external services required to run.

---

## Run locally

```bash
cd legal-champions/api
npm install
npm start
```

Then open:

- Site → http://localhost:4040
- Demo entry → http://localhost:4040/demo.html
- Admin → http://localhost:4040/admin (user: `admin`, pass: `changeme`)

To auto-restart on file changes:

```bash
npm run dev
```

---

## Configuration

Copy `.env.example` to `.env` and edit. Or set the variables in your hosting dashboard.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Server port | `4040` |
| `ADMIN_USER` / `ADMIN_PASS` | Basic-auth for `/admin` | `admin` / `changeme` — **change this** |
| `NOTIFY_EMAIL` | Where notifications are sent | `engage@legalchampions.my` |
| `MAIL_FROM` | From address on notifications | `Legal Champions <noreply@legalchampions.my>` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP credentials (optional — if blank, submissions are captured but not emailed) | — |
| `DB_PATH` | Override SQLite location | `../data/leads.db` |

---

## API

All endpoints accept JSON, return JSON. Same-origin only.

### `POST /api/waitlist`

```json
{ "firm": "Tan & Partners", "name": "Aishah K.", "email": "aishah@firm.com", "area": "Litigation" }
```

### `POST /api/brief`

```json
{
  "firm": "Tan & Partners",
  "name": "Aishah K.",
  "position": "Partner",
  "email": "aishah@firm.com",
  "phone": "+60 ...",
  "practice_area": "Litigation",
  "engagement_type": "Per-matter quote",
  "outline": "Court bundle ... ",
  "timeline": "Filing by 30 May"
}
```

### `POST /api/contact`

```json
{ "channel": "chatbot", "email": "...", "message": "...", "context": { "topic": "litigation" } }
```

Success → `{ "ok": true, "id": 123 }`
Failure → `{ "error": "..." }` with a 4xx status.

Rate-limited to 20 writes / IP / 5 min.

---

## Admin

`/admin` (basic-auth) shows three tables:

- Waiting list signups
- Brief submissions
- Contact / chatbot messages

CSV download per table at `/admin/<table>.csv`.

---

## Deploying

Any Node host that supports persistent file storage will work (Railway, Render, Fly.io, a small VPS). Vercel/Netlify Functions don't keep the SQLite file between cold starts — for those, swap `db.js` to point at a hosted Postgres (Supabase, Neon).

### Railway / Render (recommended)

1. Push this repo to GitHub.
2. New service, point at `legal-champions/api`.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Add a persistent volume mounted at `/data` and set `DB_PATH=/data/leads.db`.
6. Set `ADMIN_USER`, `ADMIN_PASS`, and the SMTP variables.

### Fly.io

Similar — add a volume, set env, deploy.

---

## What's *not* in here yet

- Real authentication for the firm portal & paralegal dashboard (currently those are static mock-ups).
- Matter / time tracking schema (waitlist + briefs only).
- Calendar / one-click slot booking.
- File uploads.
- Webhook integrations.

These would each be a meaningful extension — happy to add when needed.
