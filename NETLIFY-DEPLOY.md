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
| `APP_PASSWORD` | A password you choose — **strongly recommended** (see security note). |
| `ANTHROPIC_API_KEY` | Optional. Enables the **Ask** tab (plain-English questions → SQL). Get one at console.anthropic.com/settings/keys. |

The UI handles the multi-line JSON cleanly. With the CLI, do it in one shot from
the file so newlines stay intact:

```bash
netlify env:set GCP_SA_KEY "$(cat service-account.json)"
netlify env:set GCP_PROJECT_ID sayakaya
netlify env:set BQ_LOCATION asia-southeast2
netlify env:set MAX_BYTES_BILLED 2000000000
netlify env:set APP_PASSWORD "choose-a-strong-password"
```

> If a build ever fails on Netlify's **secrets scanning** because it detects the
> service-account string, add `SECRETS_SCAN_OMIT_KEYS = GCP_SA_KEY` as another
> environment variable. The key lives only in the env, never in your code.

---

## ⚠️ Security: lock it down before sharing the URL

A Netlify site is **public on the internet** by default. This app reads your
production financial data, so do at least one of these before sending the link
around:

- **Set `APP_PASSWORD`** — the app then shows a password gate and requires it on
  every request. Simplest option.
- Use **Netlify's built-in password protection** or **Identity / SSO** (Site
  configuration → Access control) for per-user logins.

Either way, the `users.password` column stays blocked and the SQL lab stays
read-only — but the gate is what keeps strangers out.

---

## Verify it works

1. Open `https://<name>.netlify.app` — you should see the dashboard (or the
   password gate if you set one).
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
