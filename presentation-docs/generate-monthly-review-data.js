#!/usr/bin/env node
'use strict';

// Pulls every number the Monthly Review deck needs for one review month,
// vs the prior month for comparison, vs the current (partial) month for a
// run-rate. Run it, then hand generate-monthly-review-data.json to Claude
// to write the actual slides — the analysis/narrative is not templated,
// only the data is (see presentation-docs/README-monthly-review.md).
//
// Usage: node presentation-docs/generate-monthly-review-data.js [YYYY-MM]
//   Defaults to the most recently completed calendar month.
//
// RAIZ exclusion: users.referrer_code IN ('RAIZ','RAIZKAYA') — confirmed
// 2026-09-10 against the August deck's own reported counts (registered,
// ever-bought, holds-AUM all matched within the handful of accounts that
// joined since). Every "excl. RAIZ" figure below filters on this.
//
// AUM excl. RAIZ has no direct source table (mi_fee_logs.mi_fee is fund-
// level only, no user_id) — it's derived from mi_fee_logs.portfolio_with_code
// (per sid_code+fund+day), joined to users.sid_code. That table's SUM(amount)
// does not reconcile exactly with mi_fee_logs.mi_fee's platform total (up to
// ~24% apart in Jan-Feb 2026, within ~3% by Jun-Sep) — likely sales_code
// fan-out earlier in the data's life. Recent months (which is all this deck
// ever needs) are reliable; treat the multi-month AUM trend line's earliest
// points as directional, not exact.
//
// Revenue excl. RAIZ has no source table at all — it's estimated by scaling
// mi_fee_logs.mi_fee's total aperd_share_per_day by RAIZ's AUM share for
// that month (computed within portfolio_with_code alone, so the fan-out
// issue above cancels out of the ratio even where it doesn't cancel out of
// the absolute AUM figure). ponytail: proportional-allocation approximation
// — upgrade path is a real per-user fee table, if one ever exists.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runQuery } = require('../server/bigquery');

const RAIZ_CODES = ['RAIZ', 'RAIZKAYA'];

// Two funds excluded from every AUM/holdings/revenue figure platform-wide
// (confirmed 2026-09-10): Avrist Liquid Fund (sinvest TP002MMCAVRLIF00,
// 240,757 holders — the RAIZ-adjacent default money-market fund) and Avrist
// Indeks LQ45 (sinvest TP002IFCAVINLQ00, 7,186 holders). Applies wherever
// this script touches fund-level or per-fund holdings data: AUM trend,
// revenue trend, concentration, whale detection, product mix, and the new
// holding-decrement cohort. Does NOT touch transaction-based numbers (net
// flow, registrations, referral, campaigns) — sinvest_code only exists on
// the holdings tables, not on transactions.
const FUND_EXCLUDE_SINVEST = ['TP002MMCAVRLIF00', 'TP002IFCAVINLQ00']; // portfolio_with_code
const FUND_EXCLUDE_IDS = ['sjmIG8YqZOOp9JiAS_-pE', 'xJAj9OpLhRpSNip63uj0b']; // funds.id / mi_fee_logs.mi_fee.fund_id

// The current referral program's actual launch (confirmed 2026-09-10,
// matches the "Bonus Program MGM SayaKaya" campaign's system start_date of
// 1 Sep to within a day). referralProgram below is scoped ONLY to this date
// through pEnd — no data from before it — so it reports the program's own
// performance, not a monthly trend blended with whatever came before it.
// If this program is superseded by a new one later, update this date (or
// stop reporting this section) rather than letting the window silently
// drift across two different programs.
const REFERRAL_PROGRAM_LAUNCH = '2026-08-31';

function ymAdd(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const endD = new Date(Date.UTC(y, m, 1));
  const end = `${endD.getUTCFullYear()}-${String(endD.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { start, end };
}
// "Today" in WIB (UTC+7), so a run started right after midnight WIB doesn't
// accidentally treat yesterday as the partial month.
function todayJakarta() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const argMonth = process.argv[2];
  const today = todayJakarta();
  const currentYm = today.slice(0, 7);
  const reviewMonth = argMonth || ymAdd(currentYm, -1);
  const comparisonMonth = ymAdd(reviewMonth, -1);
  const partialMonth = currentYm;
  const partialThrough = today; // exclusive upper bound used in queries below

  console.error(`Review month:      ${reviewMonth} (full month)`);
  console.error(`Comparison month:  ${comparisonMonth} (full month)`);
  console.error(`Partial month:     ${partialMonth}, through ${partialThrough} (run-rate)`);

  const { start: rStart, end: rEnd } = monthBounds(reviewMonth);
  const { start: cStart, end: cEnd } = monthBounds(comparisonMonth);
  const { start: pStart } = monthBounds(partialMonth);
  const pEnd = partialThrough; // partial month is cut short "through today"
  const partialDays = Math.round((new Date(pEnd) - new Date(pStart)) / 86400000);
  const daysInReviewMonth = Math.round((new Date(rEnd) - new Date(rStart)) / 86400000);

  const out = { reviewMonth, comparisonMonth, partialMonth, partialThrough, partialDays, daysInReviewMonth, raizCodes: RAIZ_CODES };

  // ---- AUM: monthly daily-average, excl. RAIZ, full trend since data start ----
  console.error('Querying AUM trend (portfolio_with_code, excl. RAIZ)...');
  out.aumTrendByMonth = await runQuery(`
    WITH raiz AS (
      SELECT DISTINCT sid_code FROM \`sayakaya.main.users\`
      WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes) AND sid_code IS NOT NULL
    ),
    daily AS (
      SELECT DATE(p.created_at, 'Asia/Jakarta') AS d,
        SUM(IF(r.sid_code IS NULL, p.amount, 0)) AS nonraiz_aum,
        SUM(IF(r.sid_code IS NOT NULL, p.amount, 0)) AS raiz_aum
      FROM \`sayakaya.mi_fee_logs.portfolio_with_code\` p
      LEFT JOIN raiz r ON p.sid_code = r.sid_code
      WHERE p.created_at >= TIMESTAMP('2026-01-01') AND p.created_at < TIMESTAMP(@pEnd)
        AND p.sinvest_code NOT IN UNNEST(@fundExcludeSinvest)
      GROUP BY d
    )
    SELECT FORMAT_DATE('%Y-%m', d) ym, ROUND(AVG(nonraiz_aum)) avg_nonraiz_aum,
      ROUND(AVG(raiz_aum)) avg_raiz_aum, COUNT(*) n_days
    FROM daily GROUP BY ym ORDER BY ym`,
    { raizCodes: RAIZ_CODES, pEnd, fundExcludeSinvest: FUND_EXCLUDE_SINVEST });

  // ---- Revenue: total platform (mi_fee_logs.mi_fee) x RAIZ non-share ratio ----
  console.error('Querying revenue trend (mi_fee_logs.mi_fee)...');
  out.revenueTrendByMonth = await runQuery(`
    SELECT FORMAT_DATE('%Y-%m', d) ym, ROUND(AVG(day_aum)) avg_total_aum, ROUND(SUM(day_aperd)) total_aperd
    FROM (
      SELECT DATE(created_at,'Asia/Jakarta') d, SUM(AUM) day_aum, SUM(aperd_share_per_day) day_aperd
      FROM \`sayakaya.mi_fee_logs.mi_fee\`
      WHERE created_at >= TIMESTAMP('2026-01-01') AND created_at < TIMESTAMP(@pEnd)
        AND fund_id NOT IN UNNEST(@fundExcludeIds)
      GROUP BY d
    ) GROUP BY ym ORDER BY ym`, { pEnd, fundExcludeIds: FUND_EXCLUDE_IDS });

  // ---- Buy/sell volume, net flow, median buy ticket, active investors ----
  async function txStats(start, end) {
    const rows = await runQuery(`
      WITH raiz AS (
        SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)
      )
      SELECT
        ROUND(SUM(IF(t.type='buy' AND t.status='completed', t.final_amount, 0))) buy_volume,
        ROUND(SUM(IF(t.type='sell' AND t.status='completed', t.final_amount, 0))) sell_volume,
        COUNTIF(t.type='buy' AND t.status='completed') buy_count,
        APPROX_QUANTILES(IF(t.type='buy' AND t.status='completed', t.final_amount, NULL), 2)[OFFSET(1)] median_buy_ticket,
        ROUND(AVG(IF(t.type='buy' AND t.status='completed', t.final_amount, NULL))) avg_buy_ticket,
        COUNT(DISTINCT IF(t.type='buy' AND t.status='completed', t.user_id, NULL)) active_investors
      FROM \`sayakaya.main.transactions\` t
      WHERE t.completed_at >= TIMESTAMP(@start) AND t.completed_at < TIMESTAMP(@end)
        AND t.user_id NOT IN (SELECT id FROM raiz)`,
      { raizCodes: RAIZ_CODES, start, end });
    return rows[0];
  }
  console.error('Querying buy/sell/net-flow (review, comparison, partial)...');
  out.txStats = {
    review: await txStats(rStart, rEnd),
    comparison: await txStats(cStart, cEnd),
    partial: await txStats(pStart, pEnd),
  };

  // ---- Active investors, rolling 30d as of end of review month vs today ----
  async function active30d(asOf) {
    const rows = await runQuery(`
      WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
      SELECT COUNT(DISTINCT user_id) n FROM \`sayakaya.main.transactions\`
      WHERE type='buy' AND status='completed'
        AND completed_at >= TIMESTAMP_SUB(TIMESTAMP(@asOf), INTERVAL 30 DAY) AND completed_at < TIMESTAMP(@asOf)
        AND user_id NOT IN (SELECT id FROM raiz)`, { raizCodes: RAIZ_CODES, asOf });
    return rows[0].n;
  }
  console.error('Querying active-investors-30d (end of review month, today)...');
  out.active30d = { endOfReviewMonth: await active30d(rEnd), today: await active30d(pEnd) };

  // ---- Registrations + referral signups, per month, Jan-partial ----
  console.error('Querying registration trend...');
  out.registrationsByMonth = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
    SELECT FORMAT_DATETIME('%Y-%m', u.created_at) ym,
      COUNT(*) registered,
      COUNTIF(u.verification_status='verified') verified_ever
    FROM \`sayakaya.main.users\` u
    WHERE u.created_at >= DATETIME('2026-01-01') AND u.created_at < DATETIME(@pEnd)
      AND u.id NOT IN (SELECT id FROM raiz)
    GROUP BY ym ORDER BY ym`, { raizCodes: RAIZ_CODES, pEnd });

  // ---- Registration -> first buy within 30 days, per cohort month ----
  console.error('Querying registration -> first-buy-within-30d cohorts...');
  out.regToFirstBuy = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
    reg AS (
      SELECT id, created_at FROM \`sayakaya.main.users\`
      WHERE created_at >= DATETIME('2026-01-01') AND created_at < DATETIME(@pEnd) AND id NOT IN (SELECT id FROM raiz)
    ),
    first_buy AS (
      SELECT user_id, MIN(completed_at) first_buy_at FROM \`sayakaya.main.transactions\`
      WHERE type='buy' AND status='completed' GROUP BY user_id
    )
    SELECT FORMAT_DATETIME('%Y-%m', r.created_at) ym,
      COUNT(*) registered,
      COUNTIF(fb.first_buy_at IS NOT NULL AND TIMESTAMP_DIFF(fb.first_buy_at, TIMESTAMP(r.created_at), DAY) <= 30) bought_within_30d
    FROM reg r LEFT JOIN first_buy fb ON fb.user_id = r.id
    GROUP BY ym ORDER BY ym`, { raizCodes: RAIZ_CODES, pEnd });

  // ---- Top-N AUM concentration, as of end of review month vs today ----
  async function concentration() {
    // Live "current holdings" snapshot (portfolios+bonus_portfolios) can't be
    // rewound to a past date, so concentration is computed as-of TODAY only —
    // matches how the August deck's own "31 Jul" column was actually a Jul
    // month-end AUM-by-account cut, not a live rewind either.
    const rows = await runQuery(`
      WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
      active AS (
        SELECT user_id, fund_id, unit FROM \`sayakaya.main.portfolios\` WHERE deleted_at IS NULL AND unit > 0
        UNION ALL
        SELECT user_id, fund_id, unit FROM \`sayakaya.main.bonus_portfolios\` WHERE status = 'on_going'
      ),
      per_user AS (
        SELECT a.user_id, SUM(a.unit * f.latest_nav_value) aum
        FROM active a JOIN \`sayakaya.main.funds\` f ON f.id = a.fund_id
        WHERE a.user_id NOT IN (SELECT id FROM raiz) AND a.fund_id NOT IN UNNEST(@fundExcludeIds)
        GROUP BY a.user_id HAVING aum > 0
      ),
      ranked AS (SELECT aum, ROW_NUMBER() OVER (ORDER BY aum DESC) rn, COUNT(*) OVER () n FROM per_user)
      SELECT
        (SELECT SUM(aum) FROM per_user) total_aum,
        (SELECT COUNT(*) FROM per_user) n_accounts_with_aum,
        (SELECT SUM(aum) FROM ranked WHERE rn <= 2) top2_aum,
        (SELECT SUM(aum) FROM ranked WHERE rn <= 10) top10_aum,
        (SELECT SUM(aum) FROM ranked WHERE rn <= 100) top100_aum,
        (SELECT COUNT(*) FROM per_user WHERE aum < 100000) accounts_under_100k,
        (SELECT APPROX_QUANTILES(aum, 2)[OFFSET(1)] FROM per_user) median_aum`,
      { raizCodes: RAIZ_CODES, fundExcludeIds: FUND_EXCLUDE_IDS });
    return rows[0];
  }
  console.error('Querying AUM concentration (live snapshot)...');
  out.concentration = await concentration();

  // ---- Whale detection: biggest AUM movers over the review month ----
  console.error('Querying biggest AUM movers over the review month (whale detection)...');
  out.topMovers = await runQuery(`
    WITH raiz AS (SELECT DISTINCT sid_code FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes) AND sid_code IS NOT NULL),
    start_snap AS (
      SELECT sid_code, SUM(amount) aum FROM \`sayakaya.mi_fee_logs.portfolio_with_code\`
      WHERE DATE(created_at,'Asia/Jakarta') = DATE_SUB(DATE(@rStart), INTERVAL 1 DAY)
        AND sinvest_code NOT IN UNNEST(@fundExcludeSinvest)
      GROUP BY sid_code
    ),
    end_snap AS (
      SELECT sid_code, SUM(amount) aum FROM \`sayakaya.mi_fee_logs.portfolio_with_code\`
      WHERE DATE(created_at,'Asia/Jakarta') = DATE_SUB(DATE(@rEnd), INTERVAL 1 DAY)
        AND sinvest_code NOT IN UNNEST(@fundExcludeSinvest)
      GROUP BY sid_code
    )
    SELECT COALESCE(s.sid_code, e.sid_code) sid_code,
      IFNULL(s.aum,0) start_aum, IFNULL(e.aum,0) end_aum, IFNULL(e.aum,0) - IFNULL(s.aum,0) change
    FROM start_snap s FULL OUTER JOIN end_snap e ON s.sid_code = e.sid_code
    LEFT JOIN raiz r ON r.sid_code = COALESCE(s.sid_code, e.sid_code)
    WHERE r.sid_code IS NULL
    ORDER BY change ASC LIMIT 10`, { raizCodes: RAIZ_CODES, rStart, rEnd, fundExcludeSinvest: FUND_EXCLUDE_SINVEST });

  // ---- Retention: registered/ever-transacted/dormant + first-buy cohort table ----
  console.error('Querying retention headline + cohort table...');
  const retRows = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
    SELECT
      (SELECT COUNT(*) FROM \`sayakaya.main.users\` WHERE id NOT IN (SELECT id FROM raiz)) registered,
      (SELECT COUNT(DISTINCT user_id) FROM \`sayakaya.main.transactions\` WHERE type='buy' AND status='completed' AND user_id NOT IN (SELECT id FROM raiz)) ever_bought,
      (SELECT COUNT(DISTINCT user_id) FROM \`sayakaya.main.transactions\` WHERE type='buy' AND status='completed' AND completed_at >= TIMESTAMP_SUB(TIMESTAMP(@pEnd), INTERVAL 365 DAY) AND user_id NOT IN (SELECT id FROM raiz)) bought_last_365d`,
    { raizCodes: RAIZ_CODES, pEnd });
  out.retentionHeadline = retRows[0];

  out.cohortRetention = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
    buys AS (
      SELECT user_id, completed_at FROM \`sayakaya.main.transactions\`
      WHERE type='buy' AND status='completed' AND user_id NOT IN (SELECT id FROM raiz)
    ),
    first_buy AS (SELECT user_id, MIN(completed_at) first_at FROM buys GROUP BY user_id),
    cohort AS (SELECT user_id, DATE_TRUNC(DATE(first_at), MONTH) cohort_month FROM first_buy WHERE DATE(first_at) >= DATE '2025-06-01'),
    joined AS (
      SELECT c.cohort_month, c.user_id, DATE_DIFF(DATE_TRUNC(DATE(b.completed_at), MONTH), c.cohort_month, MONTH) m_offset
      FROM cohort c JOIN buys b ON b.user_id = c.user_id
    )
    SELECT FORMAT_DATE('%Y-%m', j.cohort_month) cohort_month,
      (SELECT COUNT(*) FROM cohort c2 WHERE c2.cohort_month = j.cohort_month) cohort_size,
      COUNT(DISTINCT IF(m_offset = 1, user_id, NULL)) m1,
      COUNT(DISTINCT IF(m_offset = 2, user_id, NULL)) m2,
      COUNT(DISTINCT IF(m_offset = 3, user_id, NULL)) m3,
      COUNT(DISTINCT IF(m_offset = 6, user_id, NULL)) m6
    FROM joined j
    GROUP BY j.cohort_month ORDER BY j.cohort_month`, { raizCodes: RAIZ_CODES });

  // ---- AUM retention cohorts: same cohort assignment as the first-buy
  // cohort table above (first completed 'buy' transaction month, excl.
  // RAIZ, capped to the same 8-month lookback), so cohort sizes here are
  // identical to that table's — same population, two different lenses.
  // "Retained" at month offset M = cumulative netflow (buy minus sell
  // transactions, cohort month through M) is still >= 0, i.e. money in
  // is still >= money out, matching the live dashboard's "AUM retention
  // cohorts" panel's definition (server/ml.js's aumRetentionCohorts).
  // Deliberately NOT sourced from mi_fee_logs.portfolios like that panel:
  // tried that first, and it inflates Jan-Mar 2026 cohort sizes with
  // accounts whose actual first buy was back in 2022-2024, only now
  // getting their first row in that table, a backfill artifact
  // analogous to portfolio_with_code's Jan-2026 feed start elsewhere in
  // this script. Building netflow straight from transactions (which the
  // first-buy cohort already trusts) sidesteps that table entirely.
  console.error('Querying AUM retention cohorts (first-buy cohort x cumulative netflow)...');
  out.aumRetentionCohorts = await runQuery(`
    WITH raiz AS (
      SELECT id FROM \`sayakaya.main.users\`
      WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)
    ),
    first_buy AS (
      SELECT user_id, MIN(completed_at) first_at
      FROM \`sayakaya.main.transactions\`
      WHERE type='buy' AND status='completed' AND user_id NOT IN (SELECT id FROM raiz)
      GROUP BY user_id
    ),
    cohort_users AS (
      SELECT user_id, DATE_TRUNC(DATE(first_at), MONTH) AS cohort
      FROM first_buy
      WHERE DATE_TRUNC(DATE(first_at), MONTH) >= DATE_SUB(DATE_TRUNC(DATE(@pEnd), MONTH), INTERVAL 8 MONTH)
    ),
    monthly_flow AS (
      SELECT user_id, DATE_TRUNC(DATE(completed_at), MONTH) AS m,
        SUM(IF(type='buy', final_amount, 0)) - SUM(IF(type='sell', final_amount, 0)) AS flow
      FROM \`sayakaya.main.transactions\`
      WHERE status='completed' AND type IN ('buy','sell') AND user_id NOT IN (SELECT id FROM raiz)
      GROUP BY user_id, m
    ),
    months AS (
      SELECT month_start FROM UNNEST(GENERATE_DATE_ARRAY(
        DATE_SUB(DATE_TRUNC(DATE(@pEnd), MONTH), INTERVAL 8 MONTH),
        DATE_TRUNC(DATE(@pEnd), MONTH),
        INTERVAL 1 MONTH
      )) AS month_start
    ),
    grid AS (
      SELECT cu.user_id, cu.cohort, mo.month_start AS m
      FROM cohort_users cu CROSS JOIN months mo
      WHERE mo.month_start >= cu.cohort
    ),
    joined AS (
      SELECT g.user_id, g.cohort, g.m,
        DATE_DIFF(g.m, g.cohort, MONTH) AS month_offset,
        COALESCE(mf.flow, 0) AS flow
      FROM grid g
      LEFT JOIN monthly_flow mf ON mf.user_id = g.user_id AND mf.m = g.m
    ),
    withcum AS (
      SELECT *, SUM(flow) OVER (PARTITION BY user_id ORDER BY m ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_netflow
      FROM joined
    )
    SELECT FORMAT_DATE('%Y-%m', cohort) AS cohort, month_offset,
      COUNT(DISTINCT user_id) AS cohort_size,
      COUNT(DISTINCT IF(cum_netflow >= 0, user_id, NULL)) AS users,
      ROUND(SUM(cum_netflow)) AS netflow
    FROM withcum
    GROUP BY cohort, month_offset
    ORDER BY cohort, month_offset`,
    { raizCodes: RAIZ_CODES, pEnd });

  // ---- Product & revenue mix: top funds by AUM, review vs comparison ----
  console.error('Querying product & revenue mix (top funds)...');
  out.productMix = await runQuery(`
    WITH by_fund_month AS (
      SELECT fund_id, ANY_VALUE(fund_name) fund_name, FORMAT_DATE('%Y-%m', DATE(created_at,'Asia/Jakarta')) ym,
        AVG(AUM) avg_aum, SUM(aperd_share_per_day) aperd
      FROM \`sayakaya.mi_fee_logs.mi_fee\`
      WHERE created_at >= TIMESTAMP(@cStart) AND created_at < TIMESTAMP(@rEnd)
        AND fund_id NOT IN UNNEST(@fundExcludeIds)
      GROUP BY fund_id, ym
    )
    SELECT f.id fund_id, f.name fund_name, im.common_name mi_name, f.management_fee,
      MAX(IF(bfm.ym = @comparisonMonth, bfm.avg_aum, NULL)) comparison_avg_aum,
      MAX(IF(bfm.ym = @reviewMonth, bfm.avg_aum, NULL)) review_avg_aum,
      MAX(IF(bfm.ym = @reviewMonth, bfm.aperd, NULL)) review_aperd
    FROM by_fund_month bfm
    JOIN \`sayakaya.main.funds\` f ON CAST(f.id AS STRING) = bfm.fund_id
    LEFT JOIN \`sayakaya.main.investment_managers\` im ON im.id = f.investment_manager_id
    GROUP BY f.id, f.name, im.common_name, f.management_fee
    HAVING review_avg_aum IS NOT NULL
    ORDER BY review_avg_aum DESC LIMIT 12`,
    { reviewMonth, comparisonMonth, cStart, rEnd, fundExcludeIds: FUND_EXCLUDE_IDS });

  out.miConcentration = await runQuery(`
    SELECT im.common_name mi_name, COUNT(*) n_funds_in_top12
    FROM (
      SELECT fund_id FROM \`sayakaya.mi_fee_logs.mi_fee\`
      WHERE created_at >= TIMESTAMP(@rStart) AND created_at < TIMESTAMP(@rEnd)
        AND fund_id NOT IN UNNEST(@fundExcludeIds)
      GROUP BY fund_id ORDER BY AVG(AUM) DESC LIMIT 12
    ) top12
    JOIN \`sayakaya.main.funds\` f ON CAST(f.id AS STRING) = top12.fund_id
    LEFT JOIN \`sayakaya.main.investment_managers\` im ON im.id = f.investment_manager_id
    GROUP BY mi_name ORDER BY n_funds_in_top12 DESC`, { rStart, rEnd, fundExcludeIds: FUND_EXCLUDE_IDS });

  // ---- Referral effectiveness, all-time-to-date ----
  console.error('Querying referral effectiveness...');
  out.referral = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
    base AS (
      SELECT u.id, EXISTS(SELECT 1 FROM \`sayakaya.main.user_referrals\` ur WHERE ur.user_id = u.id) via_referral
      FROM \`sayakaya.main.users\` u
      WHERE u.created_at >= DATETIME('2026-01-01') AND u.created_at < DATETIME(@pEnd) AND u.id NOT IN (SELECT id FROM raiz)
    ),
    buys AS (
      SELECT user_id, COUNT(*) n_buys, SUM(final_amount) total_invested
      FROM \`sayakaya.main.transactions\` WHERE type='buy' AND status='completed' GROUP BY user_id
    )
    SELECT b.via_referral,
      COUNT(*) registered,
      COUNTIF(bu.user_id IS NOT NULL) activated,
      APPROX_QUANTILES(bu.total_invested, 2)[OFFSET(1)] median_invested,
      AVG(bu.n_buys) avg_buys
    FROM base b LEFT JOIN buys bu ON bu.user_id = b.id
    GROUP BY b.via_referral`, { raizCodes: RAIZ_CODES, pEnd });

  // ---- Referral share by month (the cumulative stat above hides monthly
  // swings — check this every month before trusting the cumulative one) ----
  console.error('Querying referral share by month...');
  out.referralByMonth = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
    SELECT FORMAT_DATETIME('%Y-%m', u.created_at) ym,
      COUNT(*) registered,
      COUNTIF(EXISTS(SELECT 1 FROM \`sayakaya.main.user_referrals\` ur WHERE ur.user_id = u.id)) via_referral
    FROM \`sayakaya.main.users\` u
    WHERE u.created_at >= DATETIME('2026-01-01') AND u.created_at < DATETIME(@pEnd) AND u.id NOT IN (SELECT id FROM raiz)
    GROUP BY ym ORDER BY ym`, { raizCodes: RAIZ_CODES, pEnd });

  // ---- Referrer concentration: is growth broad-based or a couple of people?
  // "Recent" = comparison month start through today; "baseline" = everything
  // before that. If recent's top-2 share is far above baseline, that's worth
  // a slide on its own before crediting referral as a scalable channel. ----
  console.error('Querying referrer concentration (recent vs baseline)...');
  async function referrerConcentration(start, end) {
    const rows = await runQuery(`
      WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
      refs AS (
        SELECT ur.referrer_id, COUNT(*) n_referred
        FROM \`sayakaya.main.user_referrals\` ur
        JOIN \`sayakaya.main.users\` u ON u.id = ur.user_id
        WHERE u.created_at >= DATETIME(@start) AND u.created_at < DATETIME(@end) AND u.id NOT IN (SELECT id FROM raiz)
        GROUP BY ur.referrer_id
      ),
      ranked AS (SELECT n_referred, ROW_NUMBER() OVER (ORDER BY n_referred DESC) rn FROM refs)
      SELECT (SELECT COUNT(*) FROM refs) n_referrers, (SELECT SUM(n_referred) FROM refs) total_referred,
        (SELECT SUM(n_referred) FROM ranked WHERE rn <= 2) top2_referred
    `, { raizCodes: RAIZ_CODES, start, end });
    return rows[0];
  }
  out.referrerConcentration = {
    recent: await referrerConcentration(cStart, pEnd),
    baseline: await referrerConcentration('2026-01-01', cStart),
  };
  out.topReferrers = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
    SELECT ur.referrer_id, COUNT(*) n_referred, MIN(u.created_at) first_ref, MAX(u.created_at) last_ref
    FROM \`sayakaya.main.user_referrals\` ur
    JOIN \`sayakaya.main.users\` u ON u.id = ur.user_id
    WHERE u.created_at >= DATETIME(@cStart) AND u.created_at < DATETIME(@pEnd) AND u.id NOT IN (SELECT id FROM raiz)
    GROUP BY ur.referrer_id ORDER BY n_referred DESC LIMIT 10`,
    { raizCodes: RAIZ_CODES, cStart, pEnd });

  // ---- Referral PROGRAM performance, scoped strictly to its own launch date
  // (REFERRAL_PROGRAM_LAUNCH) through pEnd — nothing from before it. This is
  // a different question from referralByMonth/referrerConcentration above,
  // which look at calendar-month trends regardless of when the program
  // itself started. ----
  console.error(`Querying referral program performance since ${REFERRAL_PROGRAM_LAUNCH}...`);
  out.referralProgram = {
    launchDate: REFERRAL_PROGRAM_LAUNCH,
    summary: await runQuery(`
      WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
      base AS (
        SELECT u.id, EXISTS(SELECT 1 FROM \`sayakaya.main.user_referrals\` ur WHERE ur.user_id = u.id) via_referral
        FROM \`sayakaya.main.users\` u
        WHERE u.created_at >= DATETIME(@launch) AND u.created_at < DATETIME(@pEnd) AND u.id NOT IN (SELECT id FROM raiz)
      ),
      buys AS (
        SELECT user_id, COUNT(*) n_buys, SUM(final_amount) total_invested
        FROM \`sayakaya.main.transactions\` WHERE type='buy' AND status='completed' GROUP BY user_id
      )
      SELECT b.via_referral, COUNT(*) registered, COUNTIF(bu.user_id IS NOT NULL) activated,
        APPROX_QUANTILES(bu.total_invested, 2)[OFFSET(1)] median_invested
      FROM base b LEFT JOIN buys bu ON bu.user_id = b.id
      GROUP BY b.via_referral`,
      { raizCodes: RAIZ_CODES, launch: REFERRAL_PROGRAM_LAUNCH, pEnd }),
    referrers: await runQuery(`
      WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
      SELECT ur.referrer_id, COUNT(*) n_referred, MIN(u.created_at) first_ref, MAX(u.created_at) last_ref
      FROM \`sayakaya.main.user_referrals\` ur
      JOIN \`sayakaya.main.users\` u ON u.id = ur.user_id
      WHERE u.created_at >= DATETIME(@launch) AND u.created_at < DATETIME(@pEnd) AND u.id NOT IN (SELECT id FROM raiz)
      GROUP BY ur.referrer_id ORDER BY n_referred DESC`,
      { raizCodes: RAIZ_CODES, launch: REFERRAL_PROGRAM_LAUNCH, pEnd }),
  };

  // ---- Campaigns active during the review month: users + buy volume ----
  console.error('Querying campaign usage during the review month...');
  out.campaigns = await runQuery(`
    SELECT c.id, c.name, c.promo_code, c.start_date, c.end_date, c.bonus_amount, c.bonus_fund_id,
      c.min_amount, c.quota, c.used_quota,
      COUNT(DISTINCT t.user_id) users_bought,
      ROUND(SUM(t.final_amount)) buy_volume
    FROM \`sayakaya.main.campaigns\` c
    LEFT JOIN \`sayakaya.main.transactions\` t
      ON t.type = 'buy' AND t.status = 'completed'
      AND t.completed_at >= TIMESTAMP(c.start_date) AND t.completed_at <= TIMESTAMP(c.end_date)
      AND (c.min_amount IS NULL OR t.final_amount >= c.min_amount)
    WHERE c.deleted_at IS NULL
      AND c.start_date < DATETIME(@rEnd) AND (c.end_date IS NULL OR c.end_date >= DATETIME(@rStart))
    GROUP BY c.id, c.name, c.promo_code, c.start_date, c.end_date, c.bonus_amount, c.bonus_fund_id, c.min_amount, c.quota, c.used_quota
    ORDER BY buy_volume DESC NULLS LAST`, { rStart, rEnd });

  // ---- Added for the October 2026 deck ----------------------------------
  // Net flow per month since March, total and without the one account whose
  // own net flow was largest that month (either direction). September's
  // -55.6 B and early October's +51.7 B were mostly one account redeeming
  // Rp 50 B on 28 Sep and buying it back on 5 Oct; the second column is
  // everyone else.
  console.error('Querying net flow by month, with and without the largest account...');
  out.netFlowByMonth = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
    per_user AS (
      SELECT FORMAT_TIMESTAMP('%Y-%m', t.completed_at) ym, t.user_id,
        SUM(IF(t.type='buy', t.final_amount, 0)) - SUM(IF(t.type='sell', t.final_amount, 0)) net
      FROM \`sayakaya.main.transactions\` t
      WHERE t.status='completed' AND t.type IN ('buy','sell')
        AND t.completed_at >= TIMESTAMP('2026-03-01') AND t.completed_at < TIMESTAMP(@pEnd)
        AND t.user_id NOT IN (SELECT id FROM raiz)
      GROUP BY ym, t.user_id
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ym ORDER BY ABS(net) DESC) rn FROM per_user)
    SELECT ym, ROUND(SUM(net)) net_flow, ROUND(SUM(IF(rn = 1, net, 0))) largest_account_net,
      ROUND(SUM(IF(rn > 1, net, 0))) net_flow_excl_largest, COUNT(*) accounts
    FROM ranked GROUP BY ym ORDER BY ym`, { raizCodes: RAIZ_CODES, pEnd });

  // Fund-to-fund switches in the review month. A switch never shows up as
  // a platform outflow, but it moves money between funds with different
  // AperD rates, which is how AUM can rise while revenue falls.
  console.error('Querying fund switches in the review month...');
  out.switchFlows = await runQuery(`
    WITH raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))
    SELECT fo.name from_fund, fd.name to_fund, COUNT(DISTINCT s.user_id) accounts,
      ROUND(SUM(s.origin_amount)) amount, MIN(DATE(s.created_at)) first_day, MAX(DATE(s.created_at)) last_day
    FROM \`sayakaya.main.switching_transactions\` s
    JOIN \`sayakaya.main.funds\` fo ON fo.id = s.origin_fund_id
    JOIN \`sayakaya.main.funds\` fd ON fd.id = s.destination_fund_id
    WHERE s.status = 'completed' AND s.created_at >= TIMESTAMP(@rStart) AND s.created_at < TIMESTAMP(@rEnd)
      AND s.user_id NOT IN (SELECT id FROM raiz)
    GROUP BY from_fund, to_fund ORDER BY amount DESC LIMIT 15`, { raizCodes: RAIZ_CODES, rStart, rEnd });

  // The account behind the review month's largest single-account net flow:
  // its moves of Rp 1 B or more since March, and its holdings today. Nothing
  // identifying leaves BigQuery, only dates, types, funds and amounts. In
  // 2026 this has been one account moving exactly Rp 50 B in and out.
  console.error('Querying the largest single account (no identifiers)...');
  const LARGEST_ACCT = `
    raiz AS (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes)),
    acct AS (
      SELECT user_id FROM \`sayakaya.main.transactions\`
      WHERE status='completed' AND type IN ('buy','sell') AND completed_at >= TIMESTAMP(@rStart) AND completed_at < TIMESTAMP(@rEnd)
        AND user_id NOT IN (SELECT id FROM raiz)
      GROUP BY user_id
      ORDER BY ABS(SUM(IF(type='buy', final_amount, 0)) - SUM(IF(type='sell', final_amount, 0))) DESC LIMIT 1
    )`;
  out.largestAccount = {
    moves: await runQuery(`
      WITH ${LARGEST_ACCT}
      SELECT DATE(t.completed_at, 'Asia/Jakarta') d, t.type, f.name fund, ROUND(t.final_amount) amount
      FROM \`sayakaya.main.transactions\` t JOIN acct a ON a.user_id = t.user_id
      LEFT JOIN \`sayakaya.main.funds\` f ON f.id = t.fund_id
      WHERE t.status='completed' AND t.final_amount >= 1e9 AND t.completed_at >= TIMESTAMP('2026-03-01') AND t.completed_at < TIMESTAMP(@pEnd)
      ORDER BY t.completed_at, t.type`, { raizCodes: RAIZ_CODES, rStart, rEnd, pEnd }),
    profile: (await runQuery(`
      WITH ${LARGEST_ACCT},
      held AS (
        SELECT fund_id, unit FROM \`sayakaya.main.portfolios\` WHERE deleted_at IS NULL AND unit > 0 AND user_id IN (SELECT user_id FROM acct)
        UNION ALL
        SELECT fund_id, unit FROM \`sayakaya.main.bonus_portfolios\` WHERE status = 'on_going' AND user_id IN (SELECT user_id FROM acct)
      )
      SELECT (SELECT FORMAT_DATETIME('%Y-%m', created_at) FROM \`sayakaya.main.users\` WHERE id IN (SELECT user_id FROM acct)) registered,
        (SELECT ROUND(SUM(h.unit * f.latest_nav_value)) FROM held h JOIN \`sayakaya.main.funds\` f ON f.id = h.fund_id
          WHERE h.fund_id NOT IN UNNEST(@fundExcludeIds)) aum_today`,
      { raizCodes: RAIZ_CODES, rStart, rEnd, fundExcludeIds: FUND_EXCLUDE_IDS }))[0],
  };

  // Daily AUM from the start of the review month to today, same basis as
  // aumTrendByMonth, to show a single account's exit and return.
  console.error('Querying daily AUM (review month to today)...');
  out.dailyAum = await runQuery(`
    WITH raiz AS (
      SELECT DISTINCT sid_code FROM \`sayakaya.main.users\`
      WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes) AND sid_code IS NOT NULL
    )
    SELECT DATE(p.created_at, 'Asia/Jakarta') d, ROUND(SUM(p.amount)) aum
    FROM \`sayakaya.mi_fee_logs.portfolio_with_code\` p LEFT JOIN raiz r ON p.sid_code = r.sid_code
    WHERE r.sid_code IS NULL AND p.created_at >= TIMESTAMP(@rStart) AND p.created_at < TIMESTAMP_ADD(TIMESTAMP(@pEnd), INTERVAL 1 DAY)
      AND p.sinvest_code NOT IN UNNEST(@fundExcludeSinvest)
    GROUP BY d ORDER BY d`, { raizCodes: RAIZ_CODES, rStart, pEnd, fundExcludeSinvest: FUND_EXCLUDE_SINVEST });

  // How well Google Analytics' user_id lines up with main.users in the
  // review month (it is main.users.id, set by the app at login).
  console.error('Querying GA4 user_id match rate...');
  const gaFrom = rStart.replace(/-/g, ''); const gaTo = new Date(new Date(rEnd) - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  out.gaMatch = (await runQuery(`
    WITH g AS (
      SELECT DISTINCT user_id FROM \`sayakaya.analytics_266759216.events_*\`
      WHERE _TABLE_SUFFIX BETWEEN @gaFrom AND @gaTo AND user_id IS NOT NULL
    )
    SELECT COUNT(*) ga_users, COUNTIF(u.id IS NOT NULL) matched,
      COUNTIF(UPPER(IFNULL(u.referrer_code,'')) IN UNNEST(@raizCodes)) raiz
    FROM g LEFT JOIN \`sayakaya.main.users\` u ON u.id = g.user_id`, { gaFrom, gaTo, raizCodes: RAIZ_CODES }))[0];

  // Install channels from Adjust for the review month (Marketing attribution tab).
  console.error('Querying Adjust install channels...');
  out.adjustChannels = await runQuery(`
    SELECT COALESCE(_tracker_name_, '(no tracker)') channel,
      COUNTIF(_activity_kind_ = 'install') installs,
      COUNTIF(_event_name_ = 'registration_completed') registrations,
      COUNTIF(_event_name_ = 'payment_completed') payments
    FROM \`sayakaya.adjust_analytics.events\`
    WHERE DATE(TIMESTAMP_SECONDS(_created_at_)) >= @rStart AND DATE(TIMESTAMP_SECONDS(_created_at_)) < @rEnd
    GROUP BY channel ORDER BY installs DESC LIMIT 6`, { rStart, rEnd });

  // Revenue change, comparison -> review month, split the way the Revenue
  // trend tab splits it: revenue = days x average AUM x daily AperD yield,
  // so the change is exactly days effect + AUM effect + rate/mix effect.
  // Revenue is scaled to exclude RAIZ the same way as the deck's headline.
  const revByYm = Object.fromEntries(out.revenueTrendByMonth.map((r) => [r.ym, r]));
  const aumByYm = Object.fromEntries(out.aumTrendByMonth.map((r) => [r.ym, r]));
  const monthRev = (ym, days) => {
    const r = revByYm[ym]; const a = aumByYm[ym];
    const total = Number(r.total_aperd) * (1 - Number(a.avg_raiz_aum) / Number(r.avg_total_aum));
    const aum = Number(a.avg_nonraiz_aum);
    return { revenue: total, days, aum, dailyYield: total / days / aum };
  };
  const daysIn = (ym) => { const b = monthBounds(ym); return Math.round((new Date(b.end) - new Date(b.start)) / 86400000); };
  const c0 = monthRev(comparisonMonth, daysIn(comparisonMonth));
  const r1 = monthRev(reviewMonth, daysIn(reviewMonth));
  out.revenueCause = {
    comparison: c0, review: r1,
    change: r1.revenue - c0.revenue,
    daysEffect: (r1.days - c0.days) * c0.aum * c0.dailyYield,
    aumEffect: r1.days * (r1.aum - c0.aum) * c0.dailyYield,
    rateMixEffect: r1.days * r1.aum * (r1.dailyYield - c0.dailyYield),
    annualYieldPct: { comparison: c0.dailyYield * 365 * 100, review: r1.dailyYield * 365 * 100 },
  };

  // App behavior for the review month (Google Analytics joined to the main
  // database by user_id, see the User behavior tab). The dashboard's query
  // builders are reused with the deck's RAIZ exclusion added to their GA4
  // filter: about 14% of logged-in app users are RAIZ.
  console.error('Querying app behavior (GA4 x main, excl. RAIZ)...');
  const Q = require('../server/queries');
  const GA4_FILTER = '_TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL';
  const RAIZ_GA = `${GA4_FILTER} AND user_id NOT IN (SELECT id FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes))`;
  const noRaiz = (q) => {
    const parts = q.sql.split(GA4_FILTER);
    if (parts.length !== 2) throw new Error(`RAIZ filter not applied: expected one GA4 filter, found ${parts.length - 1}`);
    return runQuery(parts.join(RAIZ_GA), { ...q.params, raizCodes: RAIZ_CODES });
  };
  const lastDay = (end) => new Date(new Date(end) - 86400000).toISOString().slice(0, 10);
  const intentRows = await noRaiz(Q.behaviorIntentNoBuy(rStart, lastDay(rEnd)));
  const intentBy = {};
  for (const r of intentRows) {
    const k = String(r.order_statuses).includes('expired') ? 'expired'
      : String(r.order_statuses).includes('cancelled') ? 'cancelled'
      : r.order_statuses === 'no order created' ? 'no_order' : 'other';
    intentBy[k] = (intentBy[k] || 0) + 1;
  }
  out.appBehavior = {
    segments: await noRaiz(Q.behaviorSegments(rStart, lastDay(rEnd))),
    comparisonSegments: await noRaiz(Q.behaviorSegments(cStart, lastDay(cEnd))),
    features: await noRaiz(Q.behaviorFeatureLift(rStart, lastDay(rEnd))),
    push: await noRaiz(Q.behaviorPushImpact(rStart, lastDay(rEnd))),
    products: (await noRaiz(Q.behaviorProductInterest(rStart, lastDay(rEnd)))).slice(0, 15),
    // Counts only: the dashboard tab holds the named follow-up list.
    intent: { people: intentRows.length, byOutcome: intentBy, withAum: intentRows.filter((r) => Number(r.aum_now) > 0).length },
  };

  // Referral links created since the program launched, per referrer, with
  // how many of each referrer's invitees went on to buy. Identities stay out
  // of the output; internal_domain flags a sayakaya.id email.
  console.error('Querying referrer quality since launch...');
  out.referrerQuality = await runQuery(`
    WITH r AS (
      SELECT ur.referrer_id, COUNT(*) referred,
        COUNTIF(EXISTS(SELECT 1 FROM \`sayakaya.main.transactions\` t WHERE t.user_id = ur.user_id AND t.type='buy' AND t.status='completed')) bought
      FROM \`sayakaya.main.user_referrals\` ur
      WHERE ur.created_at >= DATETIME(@launch) AND ur.created_at < DATETIME(@pEnd)
      GROUP BY 1
    )
    SELECT ROW_NUMBER() OVER (ORDER BY r.referred DESC, r.bought DESC) rnk, r.referred, r.bought,
      LOWER(SPLIT(u.email, '@')[SAFE_OFFSET(1)]) = 'sayakaya.id' internal_domain
    FROM r JOIN \`sayakaya.main.users\` u ON u.id = r.referrer_id
    ORDER BY rnk`, { launch: REFERRAL_PROGRAM_LAUNCH, pEnd });

  // Emails the dashboard sent in the review month (Email recap tab, Supabase).
  console.error('Querying dashboard email sends (Supabase)...');
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/dashboard_email_recap`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_from: rStart, p_to: lastDay(rEnd) }),
    });
    const d = await res.json();
    out.emails = { totals: d.totals, byCategory: d.by_category, tracking: d.tracking };
  } catch (e) { out.emails = { error: e.message }; }

  console.log(JSON.stringify(out, null, 2));
  console.error('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
