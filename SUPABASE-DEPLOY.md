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
supabase link --project-ref <your-project-ref>
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

Separate, already-known blocker (see `DEVELOPER_GUIDE.md` §2 and
`.github/workflows/gh-pages.yml`'s header comment): this repo is private, and
GitHub Pages requires a public repo (or a paid GitHub plan) on the free tier.
Once resolved, re-add the `push` trigger to `gh-pages.yml` and enable Pages in
Settings → Pages → Source: GitHub Actions.

### 6. Verify

```bash
curl https://<your-project-ref>.supabase.co/functions/v1/api/health
curl -H "x-app-password: <your APP_PASSWORD>" https://<your-project-ref>.supabase.co/functions/v1/api/overview
```

Compare the `/api/overview` numbers against the same endpoint on Netlify —
they read the same BigQuery project, so they must match exactly.

---

## If PDF export breaks in production despite passing locally

Per the migration plan this was built against: if the real Supabase runtime's
resource limits (not reproducible in local `deno run`) cause PDF export to
fail on genuinely large portfolios, the fallback is to leave it broken on
this deployment target specifically — CSV and XLSX export (`export.ts`) are a
separate, lower-risk code path and are unaffected. Netlify's PDF export
(`server/pdf.js`) is completely independent and keeps working regardless.
