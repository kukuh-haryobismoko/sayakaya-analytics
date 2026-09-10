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
      GROUP BY d
    )
    SELECT FORMAT_DATE('%Y-%m', d) ym, ROUND(AVG(nonraiz_aum)) avg_nonraiz_aum,
      ROUND(AVG(raiz_aum)) avg_raiz_aum, COUNT(*) n_days
    FROM daily GROUP BY ym ORDER BY ym`,
    { raizCodes: RAIZ_CODES, pEnd });

  // ---- Revenue: total platform (mi_fee_logs.mi_fee) x RAIZ non-share ratio ----
  console.error('Querying revenue trend (mi_fee_logs.mi_fee)...');
  out.revenueTrendByMonth = await runQuery(`
    SELECT FORMAT_DATE('%Y-%m', d) ym, ROUND(AVG(day_aum)) avg_total_aum, ROUND(SUM(day_aperd)) total_aperd
    FROM (
      SELECT DATE(created_at,'Asia/Jakarta') d, SUM(AUM) day_aum, SUM(aperd_share_per_day) day_aperd
      FROM \`sayakaya.mi_fee_logs.mi_fee\`
      WHERE created_at >= TIMESTAMP('2026-01-01') AND created_at < TIMESTAMP(@pEnd)
      GROUP BY d
    ) GROUP BY ym ORDER BY ym`, { pEnd });

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
  async function concentration(asOfLabel, sidJoin) {
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
        WHERE a.user_id NOT IN (SELECT id FROM raiz)
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
      { raizCodes: RAIZ_CODES });
    return rows[0];
  }
  console.error('Querying AUM concentration (live snapshot)...');
  out.concentration = await concentration('today');

  // ---- Whale detection: biggest AUM movers over the review month ----
  console.error('Querying biggest AUM movers over the review month (whale detection)...');
  out.topMovers = await runQuery(`
    WITH raiz AS (SELECT DISTINCT sid_code FROM \`sayakaya.main.users\` WHERE UPPER(IFNULL(referrer_code,'')) IN UNNEST(@raizCodes) AND sid_code IS NOT NULL),
    start_snap AS (
      SELECT sid_code, SUM(amount) aum FROM \`sayakaya.mi_fee_logs.portfolio_with_code\`
      WHERE DATE(created_at,'Asia/Jakarta') = DATE_SUB(DATE(@rStart), INTERVAL 1 DAY)
      GROUP BY sid_code
    ),
    end_snap AS (
      SELECT sid_code, SUM(amount) aum FROM \`sayakaya.mi_fee_logs.portfolio_with_code\`
      WHERE DATE(created_at,'Asia/Jakarta') = DATE_SUB(DATE(@rEnd), INTERVAL 1 DAY)
      GROUP BY sid_code
    )
    SELECT COALESCE(s.sid_code, e.sid_code) sid_code,
      IFNULL(s.aum,0) start_aum, IFNULL(e.aum,0) end_aum, IFNULL(e.aum,0) - IFNULL(s.aum,0) change
    FROM start_snap s FULL OUTER JOIN end_snap e ON s.sid_code = e.sid_code
    LEFT JOIN raiz r ON r.sid_code = COALESCE(s.sid_code, e.sid_code)
    WHERE r.sid_code IS NULL
    ORDER BY change ASC LIMIT 10`, { raizCodes: RAIZ_CODES, rStart, rEnd });

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

  // ---- Product & revenue mix: top funds by AUM, review vs comparison ----
  console.error('Querying product & revenue mix (top funds)...');
  out.productMix = await runQuery(`
    WITH by_fund_month AS (
      SELECT fund_id, ANY_VALUE(fund_name) fund_name, FORMAT_DATE('%Y-%m', DATE(created_at,'Asia/Jakarta')) ym,
        AVG(AUM) avg_aum, SUM(aperd_share_per_day) aperd
      FROM \`sayakaya.mi_fee_logs.mi_fee\`
      WHERE created_at >= TIMESTAMP(@cStart) AND created_at < TIMESTAMP(@rEnd)
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
    { reviewMonth, comparisonMonth, cStart, rEnd });

  out.miConcentration = await runQuery(`
    SELECT im.common_name mi_name, COUNT(*) n_funds_in_top12
    FROM (
      SELECT fund_id FROM \`sayakaya.mi_fee_logs.mi_fee\`
      WHERE created_at >= TIMESTAMP(@rStart) AND created_at < TIMESTAMP(@rEnd)
      GROUP BY fund_id ORDER BY AVG(AUM) DESC LIMIT 12
    ) top12
    JOIN \`sayakaya.main.funds\` f ON CAST(f.id AS STRING) = top12.fund_id
    LEFT JOIN \`sayakaya.main.investment_managers\` im ON im.id = f.investment_manager_id
    GROUP BY mi_name ORDER BY n_funds_in_top12 DESC`, { rStart, rEnd });

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

  console.log(JSON.stringify(out, null, 2));
  console.error('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
