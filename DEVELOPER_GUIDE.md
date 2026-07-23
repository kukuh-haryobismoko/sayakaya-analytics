# Sayakaya Analytics — Developer Guide

This is the handoff document: what the system is, how every file fits together,
where the data comes from, and how to safely extend it. `README.md` is the
"install and run it" doc; this one is the "understand it and change it" doc.

If you're a new developer picking this up, read sections 1–4 first, then use
5–7 as a reference while you work.

---

## 1. What this is

A live analytics dashboard for a mutual-fund investment platform ("Sayakaya").
It reads directly from BigQuery (project `sayakaya`) — there is no application
database of its own, no ORM, and no build step. It is:

- An **Express API** (`server/`) that turns HTTP requests into parameterized
  BigQuery SQL and returns JSON (or CSV/XLSX/PDF for exports).
- A **static, framework-free frontend** (`public/`) — plain HTML/CSS/JS, no
  React/Vue/bundler. Chart.js is loaded from a CDN `<script>` tag.
- An optional **Claude (Anthropic) integration** for natural-language-to-SQL
  ("Ask") and chart-type suggestion.

There is **no automated test suite**. Verification throughout this project's
history has been manual: `curl` against the running server, and independent
BigQuery queries to cross-check results. Keep this in mind when you change a
query — nothing will fail a CI pipeline if the math is wrong; you have to check
it yourself (see §9 for the pattern used to verify changes in this repo).

---

## 2. How it's deployed — four targets, two independent backend implementations

The same `server/app.js` Express app is reused across three Node-based
targets; only the entrypoint differs. The fourth (GitHub Pages + Supabase) is
a **separate backend implementation**, not a reuse of `server/`, because
Supabase Edge Functions run on Deno, not Node — see §2b.

| Target | Entrypoint | Notes |
|---|---|---|
| **Standalone Node** (local dev, Cloud Run, any VM) | `server/index.js` → `npm start` | Serves `public/` itself (`serveStatic: true`). Full doc: `README.md`. |
| **Netlify** | `netlify/functions/api.js` (wraps `createApp({ serveStatic: false })` with `serverless-http`) | Netlify's CDN serves `public/` directly; `netlify.toml` rewrites `/api/*` to the function. Full doc: `NETLIFY-DEPLOY.md`. Function timeout is 10s (free) / 26s (Pro) — large exports can hit this. |
| **GitHub Pages + Netlify** | `.github/workflows/gh-pages.yml` serving `public/`, backed by the Netlify deployment above | `app.js`'s `API_BASE` points GitHub Pages traffic at the live Netlify site. |
| **GitHub Pages + Supabase Edge Functions** | `supabase/functions/api/index.ts` | A from-scratch Deno port of every `server/*.js` route — see §2b. Full doc: `SUPABASE-DEPLOY.md`. |

`server/app.js` exports `createApp({ serveStatic })` specifically so it can be
reused this way — if you add a new route, add it once in `server/app.js` and
the first three targets get it automatically. The Supabase target does **not**
get it automatically — see §2b for why, and add the route to
`supabase/functions/api/index.ts` too if you want it there.

### 2a. Deploys are not symmetric — know what auto-deploys and what doesn't

| Target | Trigger |
|---|---|
| Standalone Node | Nothing to deploy — you run it. |
| Netlify | **Auto**: every push to `main` redeploys the whole site (frontend + function) via Netlify's own Git integration. |
| GitHub Pages (frontend, either backend) | **Auto, but scoped**: `.github/workflows/gh-pages.yml` only fires on push to `main` when the diff touches `public/**` or the workflow file itself. A `server/` or `supabase/` change alone does not trigger it. |
| Supabase Edge Function | **Manual, always**: nothing in this repo watches `supabase/functions/api/**`. After every edit, run `supabase functions deploy api` yourself. There is no CI for this today — see `SUPABASE-DEPLOY.md`'s "Do commits auto-deploy?" section if you want to add one. |

The practical trap: editing `supabase/functions/api/queries.ts` and pushing
will **not** update the live Supabase function — GitHub Pages redeploys the
(unchanged) frontend, if anything under `public/` also changed, but the
backend keeps serving whatever was last manually deployed. Always pair a
`supabase/functions/api/**` edit with `supabase functions deploy api`.

### 2b. Why Supabase is a separate implementation, not a reuse

Supabase Edge Functions run on Deno, not Node, so `server/app.js`'s Express
routing and its `@google-cloud/bigquery` SDK dependency don't carry over
directly. `supabase/functions/api/` is a parallel, hand-ported implementation:

- **`bigquery.ts` talks to BigQuery's REST API directly** (JWT-signed
  service-account auth via Deno's Web Crypto API) instead of using the Node
  SDK — deliberate, since the SDK's behavior under Deno was unverified and
  this app already broke once on a Node host (Netlify) over a library's
  disk-file assumption (see the `pdfkit` note below). This was verified
  end-to-end against live BigQuery before ever deploying — `/api/overview`
  returned byte-for-byte identical output to the Netlify deployment.
- `queries.ts`, `explore.ts`, `ml.ts` are byte-for-byte SQL ports of their
  `server/*.js` counterparts — **if you change a query, change it in both
  places**, they are not auto-synced.
- `ask.ts` ports 1:1 (it was already just `fetch()` calls to Anthropic).
- `export.ts`/`pdf.ts` use `npm:exceljs`/`npm:pdfkit` via Supabase's native
  npm-specifier support. One real bug surfaced and was fixed here:
  `pdfkit`'s `.image()` does a `Buffer.isBuffer()` check to distinguish image
  data from a file path — a plain `Uint8Array` fails that check silently, so
  `pdf.ts` imports `Buffer` from `node:buffer` explicitly.

Full rationale, verification steps, and setup: `SUPABASE-DEPLOY.md`.

---

## 3. Directory map

```
public/
  index.html         All UI markup — one <section class="view"> per sidebar tab
  app.js             All frontend logic (~1400 lines, one file, no bundler)
  styles.css         Design tokens (CSS custom properties) + all component CSS
  favicon.png, logo.png

server/
  index.js           Standalone entrypoint (Node/Cloud Run)
  app.js             Express app factory + every /api/* route (~450 lines)
  bigquery.js         BigQuery client, runQuery/dryRun, ad-hoc SQL validator
  queries.js          Every parameterized query builder (~750 lines) — the "model" layer
  ask.js             Claude integration: NL→SQL, and chart-type suggestion
  explore.js         Config-driven multi-table browser (the "Data explorer" tab)
  export.js          CSV / XLSX (ExcelJS) generation
  pdf.js             Investor portfolio PDF generation (PDFKit)
  ml.js              BigQuery ML calls (forecasts, churn scoring)
  logo.js            Base64-inlined logo PNG (survives esbuild bundling on Netlify)

netlify/functions/api.js   Netlify entrypoint (see §2)
setup/ml_models.sql        One-time BQML model-training SQL — see PREDICTIVE-MODELS.md
.github/workflows/gh-pages.yml   Static frontend deploy (see §2)

supabase/functions/api/    Deno port of the whole backend, for GitHub Pages + Supabase (see §2b)
  index.ts           Router (Deno.serve() + URLPattern) — mirrors every server/app.js route
  bigquery.ts         REST-based BigQuery client (JWT auth) — replaces server/bigquery.js's SDK use
  queries.ts, explore.ts, ml.ts, ask.ts   Byte-for-byte ports of their server/*.js counterparts
  export.ts, pdf.ts   CSV/TXT ported; XLSX/PDF via npm:exceljs / npm:pdfkit
  .env.secrets        Gitignored — real secret values for `supabase secrets set --env-file`

README.md                            Install/run/deploy quick start
NETLIFY-DEPLOY.md                    Netlify specifics
SUPABASE-DEPLOY.md                   GitHub Pages + Supabase Edge Functions specifics
PREDICTIVE-MODELS.md                 BQML model setup for the Predict tab
PRODUCT-PERFORMANCE-AND-PORTFOLIO.md Older doc on the Performance tab + portfolio lookup
                                      (partially superseded — see §9, avg_buy_price/fund
                                      trend chart/fund picker were added after this was written) —
                                      also covers Portfolio Explorer and the Portfolio tab's
                                      "as of date" picker
REMISIER-SHARING.md                  Revenue v2, Remisier sharing, and Remisier transactions
                                      (all goal_snapshots-based, alongside — not replacing —
                                      the original Revenue tab)
```

No `node_modules` surprises: dependencies are exactly `@google-cloud/bigquery`,
`express`, `cors`, `dotenv`, `exceljs`, `pdfkit`, `serverless-http`. That's the
whole backend stack.

---

## 4. Data model — BigQuery datasets in use

All tables live in project **`sayakaya`**, region `asia-southeast2` (`BQ_LOCATION`).

| Dataset | Key tables | Used for |
|---|---|---|
| `main` | `users`, `user_profiles`, `funds`, `portfolios`, `bonus_portfolios`, `transactions`, `switching_transactions`, `campaigns`, `investment_managers`, `snapshots`, `management_fee_logs` | Almost everything: users, holdings, transactions, funds, campaigns, fee rates |
| `mi_fee_logs` | `mi_fee` (daily AUM+revenue snapshot per fund), `portfolio_with_code` (daily per-user-per-fund AUM by SID) | AUM history, per-user performance |
| `sinvest` | `trx_history` | Raw KSEI/custodian feed — reconciliation and the "Sinvest Transactions" explorer dataset. Every column is `STRING`; never cleaned. |
| `ml` | `aum_forecast`, `tx_forecast`, `churn_model`, `churn_features` | BigQuery ML models (see `server/ml.js`, `PREDICTIVE-MODELS.md`) |

### The recurring "active holdings" pattern

This exact UNION appears independently in **`server/queries.js`** (four times:
`overviewAum`, `userHoldings`, `userPortfolioSplit`, `aumByRisk`/`aumByIncome`
via `ACTIVE_CTE`), **`server/explore.js`** (`ACTIVE_HOLDINGS`), and implicitly
in `fundNavTrend`'s candidate scan. It is the platform's one true definition of
"what does this user currently hold":

```sql
SELECT user_id, fund_id, unit FROM main.portfolios
  WHERE deleted_at IS NULL AND unit > 0        -- regular, paid-for holdings
UNION ALL
SELECT user_id, fund_id, unit FROM main.bonus_portfolios
  WHERE status = 'on_going'                     -- bonus/promo units still held
```

**If you ever change what counts as an active holding** (a new status value, a
new soft-delete rule, etc.), grep for `deleted_at IS NULL AND` and
`status = 'on_going'` — you must update every one of those places or different
parts of the dashboard will silently disagree with each other (this already
happened once: `userPortfolioSplit`'s unrounded sum vs. the holdings table's
rounded per-fund sums can differ by a few rupiah — see §9).

`funds.latest_nav_value` is the live price used everywhere holdings are valued:
`unit * latest_nav_value = current value`.

---

## 5. Backend, file by file

### `server/bigquery.js` — the only place that talks to BigQuery
- `runQuery(sql, params, opts)` — every query in the app funnels through this.
  Sets `maximumBytesBilled` (cost guardrail) and **`useQueryCache: false`**
  (every report must reflect live table state, not a stale cached job result).
- `dryRun(sql, params)` — used by the SQL Lab's "Estimate cost" button.
- `validateAdHoc(sqlRaw)` — the only gate between free-text user SQL (SQL Lab,
  Ask) and BigQuery: single statement, must start with `SELECT`/`WITH`, blocks
  a keyword list (`insert`, `update`, `delete`, `drop`, `password`, etc.).
- `capRows(sql, limit)` — wraps ad-hoc SQL in `SELECT * FROM (...) LIMIT n` so
  a runaway query can't return unbounded rows.

### `server/queries.js` — every analytical query, as `{ sql, params }` builders
Each export is a function that returns `{ sql, params }` (sometimes `+countSql`
for paginated views). None of them execute anything themselves — `server/app.js`
calls `runQuery(q.sql, q.params)`. All user-controlled values (dates, search
text, IDs, limits) go in as **named parameters** (`@from`, `@userId`, ...),
never string-concatenated into the SQL. The one exception is table/column
*names* chosen from a fixed allow-list (e.g. `breakdownBy(dimension)`), which
is safe because the caller can't inject arbitrary identifiers this way — only
pick from a hardcoded map.

Notable helpers other queries build on:
- `periodTargets(latestDateExpr)` — returns the shared `1D/1W/1M/3M/YTD/1Y/3Y/5Y`
  period-target dates relative to some "latest available" date. Reused by
  `productPerformance`, `productPerformanceDetail`, `userPerformance`, and
  `fundNavTrend` — if you add an 9th period, add it here once.
- `range(from, to)` — normalizes an optional date range into BigQuery params.

### `server/app.js` — the Express app + every route
`createApp({ serveStatic })` builds one Express app:
1. CORS, JSON body parsing.
2. Optional password gate (`APP_PASSWORD` env var) on `/api/*` except `/api/health`.
3. `handler(fn)` wraps async route handlers so any thrown error becomes a
   `500 { error: message }` instead of crashing the process.
4. `/api/health` — pings BigQuery with `SELECT 1` (5s timeout) so the frontend
   can show a live/down indicator, not just "the API process is up." See §9 for
   the cost tradeoff of this.
5. Every other route: parse query/body params → build a query via `Q.xxx()` →
   `runQuery` → `res.json(...)`.
6. `/api/export` — one endpoint, many `source` values (see §7), returns
   CSV/XLSX/PDF depending on `format`.
7. If `serveStatic`, serves `public/` and falls back to `index.html` for any
   unmatched path (SPA routing).

### `server/ask.js` — natural language → SQL, and chart suggestion
Two independent Claude API calls, sharing one `SCHEMA` text block that
describes every table/column/convention the model is allowed to use:
- `ask(question, context)` — generates SQL, validates it (`validateAdHoc`),
  runs it, and on a BigQuery error **retries once** by feeding the error back
  to the model to self-correct.
- `suggestChart(question, rows, hint)` — given the question and up to 5 sample
  rows, asks the model to pick a Chart.js type + x/y columns, or `"none"` if
  the data doesn't chart well. Validates the returned type and column names
  before trusting them.

**If you change what a query is allowed to touch** (add a table, change a
business rule like "AUM = portfolios + bonus_portfolios"), update the `SCHEMA`
string in this file — it's the single source of truth Claude sees. This bit us
once already: `bonus_portfolios` existed in the schema everywhere else but was
missing from Ask's `SCHEMA`, so "who has the biggest AUM?" silently ignored
bonus units until it was added.

### `server/explore.js` — the Data Explorer's dataset registry
A `DATASETS` map (10 entries: transactions, holdings, aum_by_fund, funds, users,
bonus, switching, managers, sinvest_trx, campaigns) each declaring: the SQL
`from`/`select`, display `columns` (with a `type` for formatting), which columns
are filterable/searchable, and the default sort. `buildExplore()` turns a
dataset key + query-string filters into `{ sql, countSql, params }` generically
— **adding a new browsable table means adding one entry to `DATASETS`, not a
new endpoint.**

### `server/export.js` — CSV/XLSX generation
`cell(value)` is the important function here: BigQuery's Node client returns
some types as wrapper objects (`{value: '...'}` for dates, `big.js` instances
for NUMERIC/BIGNUMERIC) — `cell()` unwraps them so exports don't show
`[object Object]` or corrupt numeric precision. `toXlsxBuffer`/`toXlsxMultiSheet`
also apply a `%` number format to columns listed in `pctCols`.

### `server/pdf.js` — the investor portfolio PDF
A minimal hand-rolled table renderer (`table()`) with page-break handling, used
by `portfolioReport()` for the one PDF export (`/api/export` with
`source=portfolio_full&format=pdf`). Uses the same `val()`/wrapper-unwrapping
convention as `export.js` (duplicated, not shared — small enough that it hasn't
been worth extracting).

### `server/ml.js` — BigQuery ML calls
Thin wrappers around `ML.FORECAST` / `ML.PREDICT` SQL against models trained by
`setup/ml_models.sql` (see `PREDICTIVE-MODELS.md` for the one-time setup).
`status()` throws if the models don't exist yet — `server/app.js`'s
`/api/ml/status` catches that and reports `{ ready: false }` so the frontend
can show the "run the setup SQL" banner instead of erroring.

---

## 6. Frontend — section by section

`public/app.js` is one file, organized into banner-commented sections
(`// ==== SECTION NAME ====`) that roughly mirror the sidebar tabs. Reading
order if you're new to it:

1. **Helpers (top of file)** — `$`/`$$` (querySelector shortcuts), `api()`
   (fetch wrapper: adds auth header, throws on non-2xx with the server's error
   message), `val()` (unwraps BigQuery date/timestamp wrapper objects — the
   frontend's version of `server/export.js`'s `cell()`), `idr()`/`idrFull()`/
   `num()` (number formatting), `paint(id, config)` (Chart.js instance
   create-or-replace, used by every chart in the app), `pie()` (shared color
   palette for categorical charts), `readThemeColors()`/`C` (reads the current
   theme's CSS custom properties so charts repaint correctly on light/dark
   toggle).
2. **USER PORTFOLIO** — the investor lookup/portfolio-detail tab (default landing tab).
3. **OVERVIEW** — platform KPIs + trend/breakdown charts for the selected date range.
4. **AUM HISTORY**, **PRODUCT PERFORMANCE**, **GROWTH**, **RECONCILIATION**,
   **REVENUE**, **PREDICT** — one section per sidebar tab, each following the
   same shape: a `loadX()` that fetches and calls a `renderX()`/`genTable()`.
5. **ASK** — natural-language query UI: generates SQL via `/api/ask`, lets you
   Copy/Edit/Run the SQL directly (reusing the SQL Lab's `/api/sql/run`), and
   auto-suggests + lets you manually override a Chart.js visualization via
   `/api/ask/chart`.
6. **EXPLORER** — generic renderer driven entirely by `/api/explore/_meta`
   (which mirrors `server/explore.js`'s `DATASETS`) — this section has no
   per-dataset code; it reads column definitions from the server and renders
   whatever it's told to.
7. **SQL LAB** — free-text SQL against `/api/sql/run` / `/api/sql/estimate`.
8. **WIRING** (`wire()`, `switchTab()`, `repaintActiveTab()`) — every
   `addEventListener` in the app lives in `wire()`, called once from `init()`.
   `switchTab(name)` shows the matching `.view` and lazy-loads that tab's data
   on first visit (a `xLoaded` boolean per tab prevents re-fetching). If you
   add a chart to a tab, also add a `case` to `repaintActiveTab()` so it
   redraws with the new theme colors after a light/dark toggle — charts don't
   currently auto-listen for the toggle.
9. **`boot()` / `init()`** — app startup: reads the date range, wires
   listeners, checks `/api/health` (which also determines whether the
   password gate or `askEnabled` UI show), then boots the default tab.

### `public/index.html`
One `<section id="..." class="view">` per tab, all siblings under one `<main>`;
`switchTab()` toggles which has the `active` class (see `.view`/`.view.active`
in `styles.css`). The sidebar nav buttons declare their target via
`data-tab="..."`, matching a section's `id`.

### `public/styles.css`
All colors are CSS custom properties on `:root` (light) and
`:root[data-theme="dark"]` (dark) — **never hardcode a hex color in new CSS;
reference `var(--indigo)` etc.** so both themes and any future palette change
stay correct automatically. Brand palette: Blue (`--indigo`/`--indigo-soft`) +
amber/teal/rose as the categorical/status accents. Responsive breakpoints:
900px (sidebar becomes an off-canvas drawer), 480px (extra padding/font
reduction for small phones) — see the `@media` blocks at the bottom of the file.

---

## 7. API reference

All routes are prefixed `/api`. Gated by `APP_PASSWORD` (header
`x-app-password`) except `/api/health`.

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | Server + BigQuery liveness (pings `SELECT 1`), plus `passwordProtected`/`askEnabled` flags the frontend needs at boot |
| `/overview` | GET | Platform KPIs for a date range |
| `/trends` | GET | Volume trend chart data |
| `/breakdown/:dimension` | GET | Transaction breakdown by type/status/etc. |
| `/funds/top`, `/funds/types`, `/funds/list`, `/funds/by-manager` | GET | Fund listings/aggregates |
| `/users/growth`, `/users/verification`, `/users/aum-by-risk`, `/users/aum-by-income` | GET | User-side aggregates |
| `/transactions`, `/transactions/filters` | GET | Transactions explorer (paged) |
| `/aum-history` | GET | AUM-over-time chart |
| `/users/search`, `/portfolio` | GET | Investor lookup + one investor's full portfolio |
| `/product-performance`, `/product-performance/detail`, `/product-performance/trend` | GET | Performance tab: by-type summary, per-fund detail, NAV trend chart |
| `/campaigns/performance`, `/switching/top-pairs`, `/referrals/top` | GET | Growth tab |
| `/reconciliation` | GET | App ledger vs. custodian feed |
| `/revenue`, `/revenue/summary` | GET | Revenue tab |
| `/ml/status`, `/predict/aum`, `/predict/transactions`, `/predict/churn`, `/churn/overview`, `/retention/cohorts` | GET | Predict tab (BQML) |
| `/explore/_meta`, `/explore/:dataset`, `/explore/:dataset/filters/:filter` | GET | Data Explorer (generic, config-driven) |
| `/ask/tables` | GET | Table picker for Ask's "Advanced" options |
| `/ask` | POST | Natural language → SQL → rows |
| `/ask/chart` | POST | Suggest a Chart.js config for a set of rows |
| `/sql/estimate`, `/sql/run` | POST | SQL Lab: dry-run byte estimate, and execution |
| `/export` | POST | CSV/XLSX/PDF export; `source` selects the dataset (see `server/app.js`'s `source === '...'` branches), `format` selects the file type |

---

## 8. Configuration (`.env`)

| Variable | Meaning |
|---|---|
| `GCP_PROJECT_ID` | BigQuery project (default `sayakaya`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account JSON key (local/standalone only) |
| `GCP_SA_KEY` | Whole service-account JSON as one env var (used on Netlify, where you can't ship a key file) |
| `PORT` | Standalone server port (default 8080) |
| `MAX_BYTES_BILLED` | Hard cap on bytes scanned per query — cost guardrail (default 2GB) |
| `BQ_LOCATION` | BigQuery region (`asia-southeast2`) |
| `APP_PASSWORD` | Optional shared-secret gate. Blank = disabled. This is **not real auth** — no per-user accounts, no session expiry; put real SSO in front of it for production multi-user access. |
| `ANTHROPIC_API_KEY` | Enables the Ask tab (both NL→SQL and chart suggestion). Ask is fully hidden/disabled without it. |
| `ANTHROPIC_MODEL` | Overrides the default Claude model used by Ask (defaults to `claude-sonnet-4-6` in `server/ask.js`) |

---

## 9. Known caveats & deliberate simplifications

Things a new developer should know before "fixing" them — some are intentional
tradeoffs, some are open issues worth revisiting:

- **`avg_buy_price` (portfolio holdings table) uses `SUM(final_amount) /
  SUM(unit)` across *all* completed buy transactions ever**, but is displayed
  next to the *current* unit count (which can be smaller after partial sells,
  or include bonus units that were never bought). It is a "lifetime average
  buy price," not a precise cost basis. `final_amount` may also include fees
  (there's a separate `value_per_unit` column that's likely the fee-free NAV
  at purchase, unconfirmed against real data — worth checking before trusting
  this number for anything financially load-bearing).
- **`userPortfolioSplit` (regular vs. bonus AUM cards) and the holdings table's
  Total AUM can disagree by a few rupiah.** The split query sums unrounded
  `unit * latest_nav_value`; the holdings table sums per-fund values that were
  each `ROUND()`-ed first. Cosmetic, not a data bug, but a support question
  waiting to happen.
- **`/api/health` runs a real BigQuery job** (`SELECT 1`, uncached — see
  `runQuery`'s `useQueryCache: false`) **on every call**, and the frontend
  polls it every 30 seconds per open tab, unauthenticated (it's exempt from
  the password gate so the gate screen itself can show connectivity). Several
  tabs left open all day means a steady trickle of BigQuery jobs just for
  liveness. Fine at current usage; worth caching (e.g. 30–60s in-process) if
  this ever becomes a cost line item.
- **GitHub Pages auto-deploys, but only for `public/**` changes** — a
  `server/` or `supabase/` edit alone won't trigger it (see §2a). The
  Supabase Edge Function has **no CI at all**: `supabase functions deploy
  api` must be run by hand after every change to
  `supabase/functions/api/**`, or the live function silently keeps serving
  old code while the frontend (if `public/` also changed) redeploys fine.
- **Supabase Edge Functions require their own platform-level auth token by
  default** (`verify_jwt`), completely separate from this app's
  `APP_PASSWORD` gate. The `api` function doesn't use Supabase Auth/Postgres,
  so this is disabled via `supabase/config.toml`'s `[functions.api]
  verify_jwt = false`. If a fresh deploy of this function ever starts
  returning `401 UNAUTHORIZED_NO_AUTH_HEADER` on every request (including
  `/api/health`), that config wasn't picked up — redeploy explicitly with
  `supabase functions deploy api --no-verify-jwt` and see
  `SUPABASE-DEPLOY.md`'s Troubleshooting section.
- **`PRODUCT-PERFORMANCE-AND-PORTFOLIO.md` predates** the fund NAV trend chart,
  the avg-buy-price column, and the fund search/checkbox picker — treat this
  guide (and the code) as authoritative over that file for those features.
- **No automated tests.** When changing a query, the pattern used throughout
  this project's development is: run the endpoint with `curl` against the
  local server, and cross-check the numbers with an independent query via the
  BigQuery console/MCP tool before trusting the result. There's nothing else
  catching a wrong `JOIN` or an off-by-one in a date range.
- **The SQL Lab / Ask's `validateAdHoc` is the only injection defense** for
  free-text SQL — it's a keyword blocklist + single-statement check, not a
  full parser. It's deliberately conservative (blocks the whole
  `insert`/`update`/... keyword even inside a string literal), which is safe
  but can occasionally block a legitimate query that happens to contain one of
  those words in a column alias or comment.

---

## 10. Extending the app — recipes

**Add a new metric/chart to an existing tab:**
1. Add a query builder to `server/queries.js` (follow the `{ sql, params }` shape).
2. Add a route in `server/app.js` that calls it via `runQuery`.
3. Add a `load()`/`render()` pair in the matching section of `public/app.js`,
   call `load()` from `switchTab()`'s lazy-load block.
4. If it's a chart, use `paint(id, config)` and pull colors from the `C` object
   (not hardcoded hex) so it repaints correctly on theme toggle — and add a
   `case` in `repaintActiveTab()`.

**Add a new browsable dataset to the Data Explorer:** add one entry to
`DATASETS` in `server/explore.js` — no new route, no new frontend code.

**Add a new export format/source:** add a branch to the `source === '...'`
chain in `server/app.js`'s `/api/export` handler.

**Change what counts as an "active holding":** see §4 — grep for
`deleted_at IS NULL AND` / `status = 'on_going'` and update every match, or the
KPI cards will drift apart from each other.

**Give Ask a new table or business rule:** edit the `SCHEMA` string in
`server/ask.js`, not just `queries.js` — Ask can't infer anything it isn't
told in that prompt.

**Deploy target changes:** remember `server/app.js`'s `createApp()` is shared
across the three Node targets (§2) — a route or middleware change there
automatically applies everywhere; don't duplicate logic into
`netlify/functions/api.js` or `server/index.js`. The Supabase target does
**not** share this — port the change to `supabase/functions/api/` by hand if
you want it there too, then `supabase functions deploy api` (§2a: nothing
auto-deploys that target).
