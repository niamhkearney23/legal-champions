# Legal Champions

Pre-launch site + backend for **Legal Champions** — a Malaysian paralegal staffing service, supervised by Messrs Thomas Philip, Advocates & Solicitors.

## What's in here

| File / folder | What it is |
|---|---|
| `index.html` | Public website (pre-launch positioning + waiting list) |
| `demo.html` | One-link entry page that connects all three surfaces |
| `firm.html` | Firm portal — directory of paralegals, brief submission, drawer with full profiles |
| `dashboard.html` | Paralegal dashboard — matters, time, messages, reviews |
| `api/` | Node + SQLite backend (Express). See [api/README.md](api/README.md) for details |
| `data/` | SQLite database file (created on first server run, gitignored) |

## Run locally

```bash
cd api
npm install
npm start
```

Then open **http://localhost:4040/demo.html**.

## Deploy

The backend serves both the API and the static files, so a single deploy gets you the lot.

### Recommended: Fly.io

A `fly.toml` is already in `api/`. From inside `api/`:

```bash
fly launch --copy-config --name legal-champions
fly volumes create lc_data --size 1
fly secrets set ADMIN_USER=... ADMIN_PASS=...
fly deploy
```

You get a `https://legal-champions.fly.dev` URL. The SQLite file lives on a persistent volume so submissions survive restarts.

### Alternative: Railway / Render

Both auto-detect the `package.json` in `api/` and run `npm start`. Add a persistent volume mounted at `/data` and set `DB_PATH=/data/leads.db`. Set the admin credentials and (optionally) SMTP env vars.

## Admin

After deploy, the admin page lives at `<your-url>/admin` — basic-auth, credentials set via env vars.

## What's *not* in here yet

- Real authentication for the firm / paralegal portals (still static mocks)
- Matter / time tracking schema
- Calendar / one-click intake slot booking
- File uploads for deliverables

See `api/README.md` for the API surface and roadmap.
