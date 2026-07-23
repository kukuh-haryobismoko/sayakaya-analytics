# Product performance & user portfolio

Two additions to the dashboard: a fund-performance report and a per-investor
portfolio lookup.

## Product performance (Performance tab)

% change in NAV per fund type — 1D / 1W / 1M / 3M / YTD / 1Y / 3Y / 5Y —
averaged across funds of that type, plus a filterable per-fund detail table.

- **Source:** `sayakaya.main.snapshots` (daily NAV per fund, `type = 'NAV'`)
  joined to `sayakaya.main.funds`. Originally specified against an external
  Apollo DB via `EXTERNAL_QUERY`; switched to these native tables after the
  external connection was denied.
- **Method:** for each fund, latest NAV vs. the NAV as-of each period's start
  date (closest snapshot on or before that date). % change is averaged per
  fund type for the summary table.
- **Endpoints:** `GET /api/product-performance` (summary), `GET
  /api/product-performance/detail` (per-fund).
- **Export:** CSV/Excel for both. The detail export writes **one worksheet
  per fund type** in a single workbook (`toXlsxMultiSheet` in
  `server/export.js`).
- Query logic lives in `server/queries.js` (`productPerformance`,
  `productPerformanceDetail`, shared `PERIODS_CTE`).

## User portfolio (Portfolio tab — landing page)

Search an investor by SID code (or name/email), pick them, and see their
current holdings and AUM performance.

- **Search:** `GET /api/users/search?q=` — matches `sid_code`, name, or
  email on `sayakaya.main.users` / `user_profiles`.
- **Holdings:** `GET /api/portfolio?userId=&sid=` — current value comes from
  `sayakaya.main.portfolios` (not soft-deleted, unit > 0) plus
  `sayakaya.main.bonus_portfolios` (`status = 'on_going'`), valued at each
  fund's `latest_nav_value`. Same "active holdings" definition used by the
  platform AUM KPI on Overview.
- **AUM performance:** same endpoint, summed per day across the investor's
  funds from `sayakaya.mi_fee_logs.portfolio_with_code` (one row per
  sid_code+fund per day; columns verified directly against BigQuery:
  `sid_code`, `fund`, `id` (fund id), `fund_type`, `total_unit`,
  `latest_nav_value`, `amount`, `created_at`), then the same period-vs-latest
  % change logic as product performance.
- **"As of" date picker:** optional `&date=YYYY-MM-DD` on the same endpoint
  (plus a date input + "Go" button in the UI). When set, holdings are read
  from `portfolio_with_code` for that exact date instead of the live
  `portfolios`/`bonus_portfolios` tables — `fund`, `fund_type`, `total_unit`,
  `avg_buy_price`, `latest_nav_value`, `buy_amount`, `amount` map directly
  onto the same row shape `userHoldings()` returns, so the existing
  table/PDF renderers don't need a separate code path. The regular/bonus
  split KPI cards go blank in this mode (that split only exists for live
  data, not historical). Every export button (CSV/Excel/PDF) also accepts
  `date` and passes it straight through.
  - `portfolio_with_code` (~10.6GB, ~50M rows) has **no partitioning or
    clustering**, so filtering by `sid_code`+date doesn't reduce bytes
    scanned — reading the columns this query needs costs ~6.9GB regardless
    of filter selectivity. `MAX_BYTES_BILLED` was raised from 4GB to 8GB
    (`.env`, `supabase/.env.secrets`) to cover it. If you see "Query exceeded
    limit for bytes billed" on this endpoint, that cap is what to check.
- Query logic lives in `server/queries.js` / `supabase/functions/api/queries.ts`
  (`userSearch`, `userHoldings`, `userPerformance`, `userHoldingsAsOf`,
  `userHoldingsLatestDate`).

## Portfolio Explorer (new tab, goal_snapshots)

A second, independent portfolio view — same search-an-investor flow as the
Portfolio tab above, but for picking a specific historical date and seeing a
by-goal breakdown, sourced from `sayakaya.main.goal_snapshots` (a daily
per-goal-per-fund valuation table) joined through `sayakaya.main.goals` for
`user_id`. Doesn't touch or replace the original Portfolio tab.

- **Endpoint:** `GET /api/portfolio-explorer?userId=&date=` — returns
  `{ asOfDate, latestDate, holdings, byGoal }`. Omit `date` to default to the
  latest available snapshot; `latestDate` is always returned too, so the UI
  can show "Snapshot date: X (latest available: Y)" for validation.
- **Exact-date semantics, not carry-forward:** a fund needs a snapshot row on
  the exact picked date to show up. This was originally built as "latest
  snapshot on or before the date" (`date <= @asOfDate`), but that silently
  kept showing funds the investor had already fully redeemed, since the
  snapshot job stops writing rows for a fund once it's gone rather than
  writing a zero-unit row. Fixed to `date = @asOfDate`: no row that day means
  no holding that day.
- **Preview vs. export:** the preview shows holdings merged by fund (same
  columns as the old Portfolio tab) *and* a "Holdings by goal" breakdown
  below it, labeled with each goal's name. Exports (`portfolio_explorer_full`
  source) always use the merged-by-fund view — never split by goal.
- **Gain/loss:** `goal_snapshots` has no buy-price/cost-basis column, so each
  `(goal, fund)` pair's **earliest ever snapshot nav** is used as a stand-in
  buy price (the confirmed approach — an approximation, since the real buy
  price may predate the first snapshot row).
- Query logic: `goalLatestSnapshotDate`, `goalUserHoldings`,
  `goalUserHoldingsByGoal` in the same two query files as above.
- **Known gap:** `goal_snapshots` itself has a real coverage hole for
  **April–May 2026** — distinct goals snapshotted drops from ~22,000/month to
  ~450–570/month, then recovers to ~14,700/month from June on (still below
  the Jan–Mar level). Confirmed by querying BigQuery directly, not a query
  bug — worth flagging to whoever owns that pipeline before trusting
  month-over-month numbers across that gap.

## Incidental fix: corrupted Excel exports on Netlify

`netlify/functions/api.js` wraps the Express app with `serverless-http`,
which only base64-encodes a response if told it's binary (via a `binary`
option or `BINARY_CONTENT_TYPES` env var). With neither set, every `.xlsx`
response was passed through `Buffer.toString('utf8')` — silently mangling
the binary bytes — before being returned as plain text. This corrupted
**every** Excel export when run through Netlify (CSV/JSON were unaffected,
since those are valid UTF-8). Fixed by passing
`binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']`
to `serverless-http`.

## Open items

- Portfolio Explorer's "by goal" preview breakdown and the merged-by-fund
  total can be off by a rupiah or two against each other — each is rounded
  (`ROUND()`) independently before summing, so the per-goal rows don't always
  add up to the exact merged total. Not worth reconciling for display
  purposes, but don't treat it as an integrity bug if you spot it.
- The old Portfolio tab's "as of date" mode and Portfolio Explorer answer a
  similar question from two different tables (`portfolio_with_code` vs.
  `goal_snapshots`) with different holdings for the same investor/date in
  some cases — that's a real data-coverage difference between the two
  sources, not a bug in either query (see the goal_snapshots coverage gap
  above).
