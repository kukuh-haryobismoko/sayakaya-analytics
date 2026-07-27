# Deploying to GitHub Pages + Supabase Edge Functions

A second deployment target alongside Netlify (see `NETLIFY-DEPLOY.md`) — not a
replacement. Netlify keeps working exactly as it does today; this is an
independent frontend/backend pair:

- `public/` → published as static files by **GitHub Pages** (`.github/workflows/gh-pages.yml`)
- `supabase/functions/api/` → a **Supabase Edge Function** (Deno runtime) that
  reimplements every route in `server/app.js`

## Why a separate implementation instead of reusing `server/`

Supabase Edge Functions run on **Deno**, not Node. `server/`'s Express routing
and its `@google-cloud/bigquery` SDK dependency don't carry over directly, so
`supabase/functions/api/` is a parallel port:

- **BigQuery access is hand-rolled against the REST API** (`bigquery.ts`) —
  JWT-signed service-account auth via Deno's Web Crypto API, not the Node SDK.
  This was a deliberate choice: the SDK's behavior under Deno's Node-compat
  layer was unverified going in, and betting the whole backend on that was the
  wrong risk for a financial dashboard. The REST approach has zero
  Node-compat risk (`fetch` + standard crypto) and has been verified against
  live BigQuery — see the Verified section below.
- Every query builder (`queries.ts`, `explore.ts`, `ml.ts`) is a byte-for-byte
  port of its `server/*.js` counterpart — pure SQL template strings, no
  runtime-specific code, so **if you change a query, change it in both
  places** (they are not auto-synced).
- `ask.ts` ports 1:1 — it was already just `fetch()` calls to the Anthropic
  API, so no rework was needed there.
- `export.ts` (CSV/TXT/XLSX) and `pdf.ts` (PDF) use `npm:exceljs` and
  `npm:pdfkit` respectively, imported directly via Supabase's native `npm:`
  specifier support.

## Verified against live infrastructure

Before ever deploying, every piece of this was run locally with `deno run`
against the real `sayakaya` BigQuery project and cross-checked against the
live Netlify deployment:

- `/api/overview` returned **byte-for-byte identical output** to Netlify (same
  field values, including the exact NUMERIC precision string).
- Date-range params, integer params, and array params (`IN UNNEST(@funds)`)
  all confirmed working through the hand-rolled REST parameter typing.
- The password gate, Ask's entity-resolution pipeline, CSV export, XLSX export
  (validated as a genuinely well-formed zip/xlsx, not just a 200 response),
  and PDF export (validated as a real multi-page PDF with the embedded logo)
  all passed.
- One real bug was caught and fixed this way: `pdfkit`'s `.image()` does a
  `Buffer.isBuffer()` check to tell image data from a file path — a plain
  `Uint8Array` fails that check silently. Fixed by importing `Buffer` from
  `node:buffer` in `pdf.ts`.

**What local testing can't fully verify:** Supabase's hosted CPU/memory
limits (~2s CPU time, isolate killed at 50% resource use — see
`supabase/functions/limits` docs) aren't enforced by a local `deno run`. Small
test exports worked fine; a genuinely large export (the app allows up to
100,000 rows) should be tested against the real deployed function before
relying on it.

---

## Do commits auto-deploy? Frontend yes, backend no

This trips people up because the two halves behave differently:

| Change | Auto-deploys on `git push`? | How |
|---|---|---|
| `public/**` (frontend) | **Yes** | `.github/workflows/gh-pages.yml` triggers on push to `main` when the diff touches `public/**` (or the workflow file itself), rebuilds, and publishes to GitHub Pages. |
| `supabase/functions/api/**` (backend) | **No** | Nothing in this repo watches this path. You must run `supabase functions deploy api` yourself after every edit. |

There's no CI wired up for the Supabase side — deploying it is a manual CLI
step, every time. If you forget, GitHub Pages will happily serve a frontend
that's talking to a backend running older code.

### Deploying a backend-only change (routine, after initial setup)

```bash
cd sayakaya-analytics
supabase functions deploy api
```

That's it — secrets don't need to be re-set unless they changed, and the
frontend doesn't need touching unless the API's request/response shape
changed. Verify with:

```bash
curl https://<your-project-ref>.supabase.co/functions/v1/api/health
```

---

## Step-by-step

### 1. Install the CLI and create a project

```bash
brew install supabase/tap/supabase   # already done in this repo's environment
supabase login
```

Create a project at [supabase.com](https://supabase.com) if you don't have one
(the free tier is enough — you're only using Edge Functions, not the Postgres
database this creates alongside it). Then link this repo to it:

```bash
cd sayakaya-analytics
supabase link --project-ref <josptpfisrsdjeggkqke>
```

The project ref is the short ID in your Supabase dashboard URL
(`https://supabase.com/dashboard/project/<ref>`).

### 2. Set secrets

`supabase/.env.secrets` (gitignored — never commit it) already exists in this
repo with the same values already in use for Netlify/local dev — no new
secrets to generate:

```bash
supabase secrets set --env-file supabase/.env.secrets
```

### 3. Deploy

```bash
supabase functions deploy api
```

Your function is now live at:

```
https://<your-project-ref>.supabase.co/functions/v1/api
```

> **Why this works without `--no-verify-jwt`:** Supabase Edge Functions
> require a *Supabase* auth token (its own platform-level JWT check) on every
> request by default — completely separate from this app's own per-user login
> (`dashboard_users`/`dashboard_sessions`, a plain Postgres schema this
> function reads over PostgREST, not Supabase's own Auth/GoTrue product).
> Since the frontend was never built to send a Supabase JWT, that platform
> default would reject every request with `401
> UNAUTHORIZED_NO_AUTH_HEADER` before it ever reached our router.
> `supabase/config.toml` already has `[functions.api] verify_jwt = false`
> committed, so a plain `supabase functions deploy api` picks it up
> automatically — you don't need to pass the flag by hand. (If you ever see
> that 401 on a fresh setup, it means this config wasn't picked up; redeploy
> explicitly with `supabase functions deploy api --no-verify-jwt` to confirm,
> then check why `config.toml` wasn't applied.)

### 4. Point the frontend at it

Edit `public/app.js`'s `API_BASE` line (near the top) — replace
`<PROJECT_REF>` with your actual project ref:

```js
const API_BASE = location.hostname.endsWith('.github.io')
  ? 'https://<PROJECT_REF>.supabase.co/functions/v1' : '';
```

The function is deliberately named `api` so the `/api/...` paths the frontend
already calls (e.g. `api('/api/overview')`) double as both the Supabase
function-name segment in the URL and the path prefix `index.ts`'s own router
expects — no path rewriting needed.

### 5. Enable GitHub Pages

Already done for this repo (Settings → Pages → Source: GitHub Actions), but
if you're setting this up on a fresh private repo, GitHub Pages requires
either a public repo or a paid GitHub plan on the free tier — see
`DEVELOPER_GUIDE.md` §2. Once the repo can host Pages at all:

1. Settings → Pages → **Source: GitHub Actions** (not "Deploy from a
   branch" — see Troubleshooting below for what goes wrong if you skip this).
2. Make sure `.github/workflows/gh-pages.yml` has the `push` trigger enabled
   (see §"Do commits auto-deploy?" above) rather than `workflow_dispatch`-only.
3. Push any change under `public/` (or run the workflow manually from the
   Actions tab) to kick off the first deploy.

### 6. Verify

```bash
curl https://<your-project-ref>.supabase.co/functions/v1/api/health
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  https://<your-project-ref>.supabase.co/functions/v1/api/auth/login \
  -d '{"username":"<your username>","password":"<your password>"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
curl -H "Authorization: Bearer $TOKEN" https://<your-project-ref>.supabase.co/functions/v1/api/overview
```

Compare the `/api/overview` numbers against the same endpoint on Netlify —
they read the same BigQuery project, so they must match exactly.

---

## Troubleshooting

**`401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` from the Supabase function** —
Supabase's own JWT gate, not this app's password gate (see the callout in
step 3). Fix: `supabase functions deploy api --no-verify-jwt`, and confirm
`supabase/config.toml` has `[functions.api] verify_jwt = false`.

**GitHub Pages serves your README instead of the dashboard** — the Pages
**Source** setting is on "Deploy from a branch" (GitHub's legacy Jekyll
pipeline, which auto-renders `README.md` when there's no Jekyll config) instead
of "GitHub Actions". Switch it in Settings → Pages → Source, then push a
change under `public/` (or re-run the workflow manually) to get a fresh
deploy. You can confirm which mode is actually active without opening the UI:

```bash
gh api repos/<owner>/<repo>/pages --jq '.build_type'
# "workflow" = correct (Actions-based); "legacy" = still on the old branch pipeline
```

**Switched the Source setting, but the site *still* looks wrong** — GitHub
Pages sits behind a CDN with `cache-control: max-age=600` (10 minutes). If a
legacy Jekyll build ran even once (e.g. right before you switched the
Source), its output can stay cached for up to 10 minutes after the switch,
independent of how correctly everything is now configured. Check the
response headers to tell a real problem from a caching lag:

```bash
curl -sD - https://<your-pages-url>/ -o /dev/null | grep -i "age:\|last-modified:"
```

A high `age` value relative to `max-age=600` combined with a `last-modified`
timestamp from *before* your fix means: it's not broken, just wait it out
(or push a trivial change to force a new cache entry).

---

## If PDF export breaks in production despite passing locally

Per the migration plan this was built against: if the real Supabase runtime's
resource limits (not reproducible in local `deno run`) cause PDF export to
fail on genuinely large portfolios, the fallback is to leave it broken on
this deployment target specifically — CSV and XLSX export (`export.ts`) are a
separate, lower-risk code path and are unaffected. Netlify's PDF export
(`server/pdf.js`) is completely independent and keeps working regardless.
