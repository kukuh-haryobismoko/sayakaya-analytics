# Deploying to Netlify

Netlify doesn't run a always-on server — it serves the static frontend from its
CDN and runs the backend as a **serverless function**. This project is already
set up for that:

- `public/` → served directly by Netlify's CDN
- `server/app.js` → the Express API, wrapped by `netlify/functions/api.js`
- `netlify.toml` → routes every `/api/*` request to that function
- BigQuery credentials come from an **environment variable** (`GCP_SA_KEY`),
  because you can't ship a key file to Netlify

> **Heads-up on timeouts:** Netlify functions time out at **10 seconds** on the
> Free/Personal plans and **26 seconds** on Pro. Normal dashboard queries finish
> in 1–3s, but a very large export (tens of thousands of rows) can approach the
> 10s limit. If you hit timeouts on free, lower the export `limit` or upgrade to
> Pro.

---

## What you need first

1. A **Netlify account** (free is fine to start).
2. Your **service-account JSON key** for project `sayakaya` with the
   `BigQuery Data Viewer` + `BigQuery Job User` roles (same key described in the
   main README). You'll paste its contents into an env var — you do **not**
   commit the file.

---

## Option A — Deploy from Git (recommended)

1. Push this project to a GitHub/GitLab repo. (`service-account.json` and `.env`
   are already git-ignored — keep them out of the repo.)
2. In Netlify: **Add new site → Import an existing project**, pick your repo.
3. Netlify reads `netlify.toml`, so build settings auto-fill:
   - Build command: `npm install`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Before the first deploy, add the environment variables (next section).
5. **Deploy.** Your site comes up at `https://<name>.netlify.app`.

Every future `git push` redeploys automatically.

## Option B — Deploy from your machine (Netlify CLI)

```bash
npm install -g netlify-cli
netlify login
cd sayakaya-analytics
netlify init          # link or create a site (uses netlify.toml)
# set env vars (see below), then:
netlify deploy --build --prod
```

---

## Set the environment variables

In the Netlify UI: **Site configuration → Environment variables → Add a variable.**

| Key | Value |
|---|---|
| `GCP_SA_KEY` | The **entire contents** of your `service-account.json`, pasted as one value. |
| `GCP_PROJECT_ID` | `sayakaya` |
| `BQ_LOCATION` | `asia-southeast2` |
| `MAX_BYTES_BILLED` | `2000000000` (your 2 GB-per-query cost cap) |
| `SUPABASE_URL` | `https://<your-project-ref>.supabase.co` — backs per-user login (see below). |
| `SUPABASE_SERVICE_ROLE_KEY` | From the Supabase dashboard → Settings → API. Supabase's own Edge Function gets this injected automatically; Netlify needs it set explicitly. |
| `ANTHROPIC_API_KEY` | Optional. Enables the **Ask** tab (plain-English questions → SQL). Get one at console.anthropic.com/settings/keys. |

`GCP_SA_KEY`'s service account also drives the Portfolio tab's **Google Sheet**
export button (server/sheets.js) — reuses the same key, and needs one more
variable:

| Key | Value |
|---|---|
| `GSHEET_TRACKER_ID` | The ID (from its URL) of a Google Sheet you create yourself, shared as **Editor** with the service account's email (`client_email` in `service-account.json`) — every export adds a new pair of tabs to this one sheet, it doesn't create a new file each time. |

Also enable the **Google Sheets API** for that key's GCP project
(console.cloud.google.com → APIs & Services) — separate from BigQuery's API.
Google Drive's API is *not* needed: a bare service account can't create its
own Drive-backed files under a Google Workspace org (sayakaya.id rejects that
outright), which is exactly why this writes into a sheet a real person
already owns instead of creating one per export.

The UI handles the multi-line JSON cleanly. With the CLI, do it in one shot from
the file so newlines stay intact:

```bash
netlify env:set GCP_SA_KEY "$(cat service-account.json)"
netlify env:set GCP_PROJECT_ID sayakaya
netlify env:set BQ_LOCATION asia-southeast2
netlify env:set MAX_BYTES_BILLED 2000000000
netlify env:set SUPABASE_URL "https://<your-project-ref>.supabase.co"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "<your service_role key>"
```

> If a build ever fails on Netlify's **secrets scanning** because it detects the
> service-account string, add `SECRETS_SCAN_OMIT_KEYS = GCP_SA_KEY` as another
> environment variable. The key lives only in the env, never in your code.
>
> **`SUPABASE_URL` needs the same treatment, for a different reason:** its
> value isn't actually sensitive (it's a project ref, not a credential), but
> `public/app.js`'s `API_BASE` line also hardcodes it (for GitHub Pages, which
> talks to the Supabase Edge Function instead of Netlify — see
> `SUPABASE-DEPLOY.md`), so the same string legitimately appears in both the
> env and the repo. Netlify's scanner flags that match as a leak. Add
> `SUPABASE_URL` to `SECRETS_SCAN_OMIT_KEYS` too (comma-separated if you
> already have that variable set: `GCP_SA_KEY,SUPABASE_URL`) — do **not**
> add `SUPABASE_SERVICE_ROLE_KEY` to this list, that one *is* a real secret
> and should never appear in repo code.

---

## ⚠️ Security: per-user login is mandatory

A Netlify site is **public on the internet** by default. This app reads your
production financial data, so every route (other than `/api/health` and the
login endpoint itself) requires a signed-in account — there's no way to turn
this off. Accounts, passwords, and per-tab permissions live in a small
Postgres schema in the same Supabase project used for the Edge Function
deploy (`dashboard_users`/`dashboard_sessions` — see the migration in
`supabase/migrations/`), reachable from Netlify via `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` above.

A superuser account is seeded by that migration; sign in as them and use the
**Manage users** tab to create accounts for everyone else, scoping each one to
just the nav tabs they need. The `users.password` column stays blocked and the
SQL lab stays read-only regardless of who's signed in.

---

## Verify it works

1. Open `https://<name>.netlify.app` — you should see the login screen.
2. Open `https://<name>.netlify.app/api/health` — it should return
   `{"ok":true,"project":"sayakaya",...}`.
3. If the Overview KPIs stay on "Loading…", check **Functions → api → logs** in
   Netlify; a credentials error there means `GCP_SA_KEY` is missing or malformed.

---

## Local development still works the same

Nothing about local dev changed:

```bash
npm install
cp .env.example .env     # point GOOGLE_APPLICATION_CREDENTIALS at your key file
npm start                # → http://localhost:8080
```

Locally you can use either a key file (`GOOGLE_APPLICATION_CREDENTIALS`) or the
`GCP_SA_KEY` variable — the app checks for the env var first, then the file.
