# Sayakaya Analytics — Project Overview

## What it is

A live analytics dashboard for **Sayakaya**, an Indonesian mutual-fund
investment platform. It reads directly from the platform's BigQuery data
warehouse (project `sayakaya`, region `asia-southeast2`) — there is no
separate application database, no ORM, no build step. It exists so data
analysts and operators can monitor the business and answer ad-hoc questions
without writing SQL by hand or waiting on an engineer.

- **Backend:** Node.js + Express, translating HTTP requests into
  parameterized BigQuery SQL.
- **Frontend:** static HTML/CSS/JS (no React/Vue/bundler), charts via Chart.js.
- **AI layer:** optional Claude (Anthropic) integration for natural-language
  question answering and chart-type suggestion.
- **Currency:** all monetary figures are Indonesian Rupiah (IDR).
- **No automated test suite** — every query is manually cross-checked against
  independent BigQuery queries before shipping.

## Who it's for

Internal data analysts and operations staff at Sayakaya who need to:
- Track platform health (AUM, users, transaction volume) day to day.
- Look up an individual investor's portfolio and performance.
- Explore raw transaction/user/fund data without SQL access.
- Ask business questions in plain English and get a query + chart back.
- Reconcile the app's own ledger against the custodian (KSEI) feed.
- Forecast AUM/transaction volume and flag investors likely to churn.

## Core features, by tab

| Tab | What it shows |
|---|---|
| **Portfolio** (landing page) | Search an investor by SID/name/email → current holdings, AUM, and performance (1D–5Y % change) |
| **Overview** | Platform KPIs for a date range: AUM, total/verified users, buy & sell volume, active users, transaction counts, active funds, 30-day new users; trend chart, breakdowns by type/status, verification mix, AUM by fund type, largest funds |
| **AUM history** | AUM-over-time chart |
| **Performance** | % NAV change per fund type (1D/1W/1M/3M/YTD/1Y/3Y/5Y), plus a filterable per-fund detail table |
| **Growth** | Campaign performance, top switching pairs, top referrals |
| **Reconciliation** | App ledger vs. custodian (KSEI) transaction feed |
| **Revenue** | Platform fee revenue |
| **Predict** | BigQuery ML: AUM forecast, transaction-volume forecast, churn scoring, churn-rate exploration, retention cohorts |
| **Ask** | Natural-language question → generated SQL → results → auto-suggested chart. Editable/runnable SQL, resolves named entities (fund/manager names) against real data instead of guessing |
| **Data explorer** | Generic, config-driven browser over 10 datasets (transactions, holdings, funds, users, bonus units, switching, managers, raw custodian feed, campaigns) with filters, search, paging, export |
| **SQL lab** | Free-text read-only `SELECT`/`WITH` queries, byte-scan cost estimate before running, CSV/Excel export |

Every explorer/table view supports **CSV and Excel export**; a per-investor
**PDF portfolio report** is also available.

## Architecture

```
Browser (public/) ──HTTP──▶ Express API (server/) ──parameterized SQL──▶ BigQuery (project: sayakaya)
                                     │
                                     └──optional──▶ Claude API (NL→SQL, chart suggestion)
```

- **`server/bigquery.js`** — the only file that talks to BigQuery. Enforces a
  per-query byte-billed cap (cost guardrail), disables query caching (every
  report reflects live data), and is the sole gate for free-text SQL
  (single-statement, `SELECT`/`WITH` only, keyword blocklist, blocks the
  `password` column).
- **`server/queries.js`** — every analytical query as a parameterized
  `{ sql, params }` builder — the "model" layer. All user input (dates,
  filters, search) is a named parameter, never string-concatenated.
- **`server/app.js`** — the Express app and every `/api/*` route.
- **`server/ask.js`** — the Claude integration: a schema-aware system prompt
  turns a question into SQL, validates and runs it, self-corrects once on a
  BigQuery error, then optionally suggests a chart.
- **`public/app.js`** — one file, ~1400 lines, all frontend logic: fetch
  calls, Chart.js rendering, CSV/Excel export, theming.

## Tech stack

| Layer | Choice |
|---|---|
| Backend runtime | Node.js 18+, Express |
| Data warehouse | Google BigQuery |
| ML | BigQuery ML (ARIMA_PLUS for forecasts, logistic regression for churn) |
| Frontend | Vanilla HTML/CSS/JS, Chart.js (CDN) — no framework, no build step |
| AI | Anthropic Claude API (optional — feature hides itself if no API key) |
| Exports | ExcelJS (XLSX), PDFKit (PDF) |

## Deployment — four targets, two backend implementations

| Target | How | Notes |
|---|---|---|
| Standalone Node | `npm start` | Local dev, Cloud Run, any VM |
| Netlify | Express app wrapped with `serverless-http` | Auto-deploys on every push to `main` |
| GitHub Pages + Netlify | Static frontend on Pages, calling the Netlify API | Pages only redeploys when `public/**` changes |
| GitHub Pages + Supabase Edge Functions | Hand-ported Deno implementation of the whole backend | **Manual deploy only** — no CI watches this path |

The Node targets share one Express app (`createApp()`), so a route added
once applies to three of the four targets automatically. The Supabase target
is a from-scratch Deno port (Edge Functions don't run Node) and must be
updated and deployed by hand — a deliberate, documented asymmetry.

## Notable design decisions

- **Security by construction, not by review:** all user input flows through
  named SQL parameters; free-text SQL (SQL Lab, Ask) goes through a single
  shared validator that blocks writes/DDL and the `password` column.
- **One definition of "active holding," reused everywhere:** current
  holdings = `portfolios` (not soft-deleted, `unit > 0`) **UNION ALL**
  `bonus_portfolios` (`status = 'on_going'`) — used consistently across KPIs,
  portfolio lookup, and risk/income breakdowns so numbers never silently
  disagree.
- **Cost-conscious by default:** every query carries a hard byte-billed cap;
  the SQL Lab shows an estimated cost before you run anything.
- **AI is additive, not load-bearing:** the whole app works with zero Claude
  usage; only the Ask tab needs it, and it hides itself without an API key.
