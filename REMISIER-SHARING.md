# Revenue v2 and remisier sharing (goal_snapshots)

Three additions, all built on `sayakaya.main.goal_snapshots` (a daily
per-goal-per-fund valuation table, joined through `sayakaya.main.goals` for
`user_id`) instead of `sayakaya.mi_fee_logs.portfolio_with_code`, which the
original Revenue tab uses. None of this replaces the original Revenue tab —
it stays untouched for comparison.

## Why a second revenue calculation

`portfolio_with_code`'s `created_at` needs a `DATE_SUB(..., INTERVAL 1 DAY)`
correction in the original Revenue query — the timestamp is a day off from
the AUM date it actually represents. `goal_snapshots.date` doesn't have that
problem, so Revenue v2 skips the correction entirely. Same management-fee
math otherwise (see "The daily fee math" below) — the two tabs are meant to
be compared side by side, not reconciled to match, since they draw from
genuinely different underlying data.

## The daily fee math (shared by all three features below)

1. `management_fee_logs`, deduped to the latest row per fund by `updated_at`,
   gives `management_fee` (an annual rate, e.g. `0.025` = 2.5%), `aperd_share`,
   and `mi_share` (fractions that sum to 1, e.g. `0.5`/`0.5` or `0.4`/`0.6`).
2. Daily fee accrual: `management_fee * aum / days_in_year(date)`.
3. Split into `aperd_share_per_day` and `mi_share_per_day` by multiplying the
   daily accrual by each share fraction.
4. **Remisier sharing only:** the remisier's fee is a portion of
   `aperd_share_per_day` specifically — **never** a portion of the raw
   management fee. E.g. if the agreement is Sayakaya 40% / remisier 60% of
   the AperD share, `remisier_fee = aperd_share_per_day * 0.6` and Sayakaya
   keeps the other 40%. The portion is a runtime input (`portion`, a
   fraction 0–1; the UI takes a whole percent like `60` and divides by 100
   before calling the API), not a stored/fixed rate.
5. **Remisier sharing only:** the remisier's fee is also subject to a fixed
   2.5% PPh 23 withholding cut — `total_remisier_pph = total_remisier_fee *
   0.025`, `total_remisier_fee_net = total_remisier_fee * 0.975`. Unlike
   `portion`, this rate is a hardcoded statutory constant
   (`REMISIER_PPH_RATE` in `server/queries.js` /
   `supabase/functions/api/queries.ts`), not a runtime input. Sayakaya's
   share is untouched by this — the cut only applies to the remisier's
   portion of the AperD share.

## Revenue v2 (new tab, next to Revenue)

Same shape as the original Revenue tab (period filter, trend chart, per-fund
detail table, monthly summary, CSV/Excel export for both) — same columns,
same month-only granularity — just sourced from `goal_snapshots` across
**all** users instead of `portfolio_with_code`.

- **Endpoints:** `GET /api/revenue-v2` (detail), `GET /api/revenue-v2/summary`.
- **Export sources:** `revenue_v2_detail`, `revenue_v2_summary`.
- Query logic: `revenueV2Detail`, `revenueV2MonthlySummary` (and the shared
  `revenueV2CTEs` builder) in `server/queries.js` /
  `supabase/functions/api/queries.ts`.

## Remisier sharing (new tab)

Revenue attributed to one remisier's book of business — filter
`sayakaya.main.users` by `referrer_code` or `sales_code` (your choice which
field), then run the same daily fee math above across just those users'
goals, with an extra remisier/Sayakaya split of the AperD share.

- **List the remisier's users:** `GET /api/remisier/users?field=&code=` —
  lets you verify who's actually in scope before trusting the numbers.
- **Revenue:** `GET /api/remisier/revenue` (per-fund detail) and
  `GET /api/remisier/revenue/summary` (summed across funds), both taking
  `field`, `code`, `from`, `to`, `granularity` (`day`/`month`/`quarter`), and
  `portion`. Unlike Revenue v2, granularity is selectable — day/month/quarter
  all mean genuine calendar buckets over the same daily-computed rows, not
  three different calculations.
- **Export sources:** `remisier_revenue_detail`, `remisier_revenue_summary` —
  same params as the GET endpoints, plus `format`.
- Query logic: `remisierUsers`, `remisierRevenueDetail`,
  `remisierRevenueSummary` (and the shared `remisierRevenueCTEs` builder).

### Remisier sharing (PWC) — second tab, same math, AUM from `portfolio_with_code`

Same remisier/Sayakaya AperD-share split as above, but AUM comes from
`sayakaya.mi_fee_logs.portfolio_with_code` (the original Revenue tab's
source) instead of `goal_snapshots`, including that source's "-1 day"
correction (see "Why a second revenue calculation" above). Users are matched
by `sid_code` — `portfolio_with_code` doesn't carry `user_id`. Added
alongside the goal_snapshots tab, not a replacement, so the two can be
compared side by side; `remisierUsers` (the users list) is shared by both
tabs since it doesn't depend on the AUM source.

- **Revenue:** `GET /api/remisier/revenue-pwc` (per-fund detail) and
  `GET /api/remisier/revenue-pwc/summary` (summed across funds) — same
  params as the goal_snapshots versions.
- **Export sources:** `remisier_revenue_pwc_detail`, `remisier_revenue_pwc_summary`.
- Query logic: `remisierRevenuePwcDetail`, `remisierRevenuePwcSummary` (and
  the shared `remisierRevenuePwcCTEs` builder).

### Remisier transactions (nested section, same tab)

A separate, independent panel below the revenue rollup — per-transaction
detail for audit/due-diligence, not a revenue number. Filters by
**transaction date**, not snapshot date.

- Filter by `referrer_code` and/or `sales_code`, each accepting **one or
  multiple** comma-separated codes in the UI (parsed client-side into
  arrays); combines via OR both within a field (multiple codes) and across
  the two fields (referrer OR sales).
- Joins `sayakaya.main.transactions` → `users` (code filter) → `user_profiles`
  (name, phone) → `funds` (fund name) — returns SID, name, email, phone, fund
  name, and full transaction detail (unit, amount, NAV, realized gain/loss,
  etc.) per row.
- **Endpoint:** `GET /api/remisier/transactions` (paginated: `limit`,
  `offset`, returns `{ rows, total }`). Repeated query params
  (`?referrerCodes=a&referrerCodes=b`) for multi-code filters.
- **Export source:** `remisier_transactions` — takes `referrerCodes`/
  `salesCodes` as JSON arrays in the POST body, uncapped (no `limit`).
- Query logic: `remisierTransactions` in the same two query files.

## Two-backend reminder

Every query/route above is implemented twice — `server/` (Node/Express,
used by Standalone/Netlify/GH Pages+Netlify) and
`supabase/functions/api/` (Deno, used by GH Pages+Supabase) — per this
repo's existing two-backend setup (see `DEVELOPER_GUIDE.md` §2). A change to
one without the other will silently diverge between deploy targets.

## Known caveats

- `goal_snapshots` itself has a real coverage gap for **April–May 2026**
  (distinct goals snapshotted drops from ~22,000/month to ~450–570/month,
  recovering to ~14,700/month from June on) — confirmed directly against
  BigQuery, not a bug in these queries. Revenue v2 and Remisier sharing
  numbers across that window will be artificially low. Worth flagging to
  whoever owns the snapshot pipeline.
- Remisier revenue detail/summary rounds per row before summing (same
  pattern as the original Revenue tab), so `total_remisier_fee +
  total_sayakaya_fee` can be off by a fraction of a rupiah from
  `total_aperd_share` — not worth reconciling for display purposes.
