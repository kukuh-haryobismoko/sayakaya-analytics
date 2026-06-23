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
- Query logic lives in `server/queries.js` (`userSearch`, `userHoldings`,
  `userPerformance`).

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

- Product performance detail export and the Portfolio tab don't (yet) have
  the same export-all-as-one-file ergonomics for every combination — ask if
  you want CSV/Excel buttons added to the Portfolio tab too.
