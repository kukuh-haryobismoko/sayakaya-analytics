// Ported 1:1 from server/queries.js — every builder returns { sql, params }.
// Pure SQL template strings + params, no Node-specific code, so this is a
// mechanical syntax port (require/module.exports -> ES modules). If you
// change a query, change it in server/queries.js too (or vice versa) — the
// two are not auto-synced.
//
// User-controlled values (dates, type, status, search, paging) are always
// passed as named parameters — never string concatenated — so the SQL Lab is
// the only place raw user SQL can run.
//
// Date range convention: `from` and `to` are 'YYYY-MM-DD' strings. `to` is
// treated as inclusive of the whole day.

export interface Query {
  sql: string;
  params: Record<string, unknown>;
  countSql?: string;
}

const TX = '`sayakaya.main.transactions`';
const USERS = '`sayakaya.main.users`';
const FUNDS = '`sayakaya.main.funds`';
const PORT = '`sayakaya.main.portfolios`';
const MIFEE = '`sayakaya.mi_fee_logs.mi_fee`';
const MGMT_FEE_LOGS = '`sayakaya.main.management_fee_logs`';

function range(from?: string, to?: string) {
  return {
    from: from || '2021-01-01',
    to: to || '2100-01-01',
  };
}

// ---- Overview KPIs ----------------------------------------------------------

export const overviewUsers = (): Query => ({
  sql: `SELECT
      COUNT(*) AS total_users,
      COUNTIF(verification_status = 'verified') AS verified_users,
      COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS new_users_30d
    FROM ${USERS}`,
  params: {},
});

export const overviewAum = (): Query => ({
  sql: `WITH active AS (
      SELECT p.user_id, p.unit, p.fund_id
      FROM \`sayakaya.main.portfolios\` p
      WHERE p.deleted_at IS NULL AND p.unit > 0
      UNION ALL
      SELECT bp.user_id, bp.unit, bp.fund_id
      FROM \`sayakaya.main.bonus_portfolios\` bp
      WHERE bp.status = 'on_going'
    )
    SELECT
      ROUND(SUM(a.unit * f.latest_nav_value)) AS platform_aum,
      COUNT(DISTINCT a.user_id) AS investing_users,
      COUNT(*) AS holdings
    FROM active a
    JOIN \`sayakaya.main.funds\` f ON f.id = a.fund_id`,
  params: {},
});

export const overviewTx = (from?: string, to?: string): Query => ({
  sql: `SELECT
      COUNT(*) AS total_tx,
      COUNTIF(type='buy'  AND status='completed') AS buy_count,
      COUNTIF(type='sell' AND status='completed') AS sell_count,
      SUM(IF(type='buy'  AND status='completed', final_amount, 0)) AS buy_volume,
      SUM(IF(type='sell' AND status='completed', final_amount, 0)) AS sell_volume,
      COUNT(DISTINCT user_id) AS active_users
    FROM ${TX}
    WHERE DATE(created_at) BETWEEN @from AND @to`,
  params: range(from, to),
});

export const overviewFunds = (): Query => ({
  sql: `SELECT
      COUNTIF(listing_status='ACTIVE') AS active_funds,
      COUNT(*) AS total_funds
    FROM ${FUNDS}`,
  params: {},
});

// ---- Time series ------------------------------------------------------------

export const trends = (from?: string, to?: string, granularity = 'month'): Query => {
  const fmt = granularity === 'day' ? '%Y-%m-%d'
    : granularity === 'week' ? '%Y-%W'
    : '%Y-%m';
  return {
    sql: `SELECT
        FORMAT_TIMESTAMP('${fmt}', created_at) AS bucket,
        COUNTIF(type='buy'  AND status='completed') AS buy_count,
        COUNTIF(type='sell' AND status='completed') AS sell_count,
        SUM(IF(type='buy'  AND status='completed', final_amount, 0)) AS buy_volume,
        SUM(IF(type='sell' AND status='completed', final_amount, 0)) AS sell_volume,
        COUNT(DISTINCT user_id) AS active_users
      FROM ${TX}
      WHERE DATE(created_at) BETWEEN @from AND @to
      GROUP BY bucket ORDER BY bucket`,
    params: range(from, to),
  };
};

// ---- Breakdowns -------------------------------------------------------------

export const breakdownBy = (column: string, from?: string, to?: string): Query => {
  const allowed: Record<string, string> = { status: 'status', type: 'type', payment_method: 'payment_method', payment_gateway: 'payment_gateway' };
  const col = allowed[column] || 'status';
  return {
    sql: `SELECT
        IFNULL(${col}, '(none)') AS label,
        COUNT(*) AS count,
        SUM(IFNULL(final_amount, 0)) AS volume
      FROM ${TX}
      WHERE DATE(created_at) BETWEEN @from AND @to
      GROUP BY label ORDER BY count DESC`,
    params: range(from, to),
  };
};

// ---- Funds ------------------------------------------------------------------

export const topFunds = (limit: number | string = 10): Query => ({
  sql: `SELECT name, type, is_sharia, latest_nav_value, latest_aum_value, management_fee, latest_aum_date
    FROM ${FUNDS}
    WHERE latest_aum_value IS NOT NULL AND listing_status='ACTIVE'
    ORDER BY latest_aum_value DESC LIMIT @limit`,
  params: { limit: parseInt(String(limit), 10) },
});

export const fundTypes = (): Query => ({
  sql: `SELECT type AS label, COUNT(*) AS count, SUM(IFNULL(latest_aum_value,0)) AS aum
    FROM ${FUNDS}
    WHERE listing_status='ACTIVE'
    GROUP BY type ORDER BY aum DESC`,
  params: {},
});

// ---- Users ------------------------------------------------------------------

export const userGrowth = (): Query => ({
  sql: `SELECT FORMAT_DATETIME('%Y-%m', created_at) AS bucket, COUNT(*) AS signups
    FROM ${USERS}
    WHERE created_at >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 24 MONTH)
    GROUP BY bucket ORDER BY bucket`,
  params: {},
});

export const verificationBreakdown = (): Query => ({
  sql: `SELECT IFNULL(verification_status,'(none)') AS label, COUNT(*) AS count
    FROM ${USERS} GROUP BY label ORDER BY count DESC`,
  params: {},
});

// ---- Transactions explorer (paged, filtered) --------------------------------
// NOTE: the password column lives only on the users table; transactions has no
// sensitive PII columns, and we never join users' password anywhere.

export const txColumns = [
  'id', 'transaction_number', 'user_id', 'fund_id', 'type', 'status',
  'unit', 'amount', 'final_amount', 'payment_method', 'payment_gateway',
  'value_per_unit', 'realized_gain_loss', 'created_at', 'completed_at',
];

export interface TransactionsArgs {
  from?: string; to?: string; type?: string; status?: string; search?: string;
  limit?: number | string; offset?: number | string;
}

export function transactions({ from, to, type, status, search, limit = 50, offset = 0 }: TransactionsArgs): Query {
  const params: Record<string, unknown> = { ...range(from, to), limit: parseInt(String(limit), 10), offset: parseInt(String(offset), 10) };
  let where = 'DATE(created_at) BETWEEN @from AND @to';
  if (type) { where += ' AND type = @type'; params.type = type; }
  if (status) { where += ' AND status = @status'; params.status = status; }
  if (search) {
    where += ' AND (user_id = @search OR id = @search OR transaction_number = @search)';
    params.search = search;
  }
  const cols = txColumns.join(', ');
  return {
    sql: `SELECT ${cols} FROM ${TX} WHERE ${where}
          ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
    params,
    countSql: `SELECT COUNT(*) AS total FROM ${TX} WHERE ${where}`,
  };
}

// Distinct values to populate the explorer filter dropdowns.
export const txFilterValues = (): Query => ({
  sql: `SELECT
      ARRAY_AGG(DISTINCT type IGNORE NULLS) AS types,
      ARRAY_AGG(DISTINCT status IGNORE NULLS) AS statuses
    FROM ${TX}`,
  params: {},
});

// ---- AUM history (from mi_fee_logs.mi_fee: daily AUM + revenue per fund) -----
// AUM is a point-in-time stock: daily = sum across funds that day; monthly =
// end-of-month value. Revenue (aperd_share_per_day) is a flow: always summed.
export const aumHistory = (from?: string, to?: string, granularity = 'month'): Query => {
  const r = range(from, to);
  if (granularity === 'day') {
    return {
      sql: `SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS bucket,
          ROUND(SUM(AUM)) AS aum,
          ROUND(SUM(aperd_share_per_day)) AS revenue,
          COUNT(DISTINCT fund_id) AS funds
        FROM ${MIFEE}
        WHERE DATE(created_at) BETWEEN @from AND @to
        GROUP BY bucket ORDER BY bucket`,
      params: r,
    };
  }
  return {
    sql: `WITH daily AS (
        SELECT DATE(created_at) AS d,
          SUM(AUM) AS aum, SUM(aperd_share_per_day) AS revenue,
          COUNT(DISTINCT fund_id) AS funds
        FROM ${MIFEE}
        WHERE DATE(created_at) BETWEEN @from AND @to
        GROUP BY d
      )
      SELECT FORMAT_DATE('%Y-%m', d) AS bucket,
        ROUND(ARRAY_AGG(aum ORDER BY d DESC LIMIT 1)[OFFSET(0)]) AS aum,
        ROUND(SUM(revenue)) AS revenue,
        MAX(funds) AS funds
      FROM daily GROUP BY bucket ORDER BY bucket`,
    params: r,
  };
};

// ---- Product performance (NAV per fund, from native BigQuery tables) -------
// snapshots.value is daily NAV per fund. % change per period = (latest NAV -
// NAV as-of period start) / NAV as-of period start, averaged per fund type.
const SNAPSHOTS = '`sayakaya.main.snapshots`';
const NAV_SOURCE = `
    SELECT s.product_id, f.name, f.type, s.value, DATE(s.created_at) AS d
    FROM ${SNAPSHOTS} s
    LEFT JOIN ${FUNDS} f
      ON s.product_id = f.id
    WHERE s.type = 'NAV'`;

// Shared period list for every "% change vs N periods ago" report: 1D/1W/1M/3M/YTD/1Y/3Y/5Y.
// Targets are computed relative to each entity's own *latest available* date
// (not today) — if a fund's freshest NAV is from 2 days ago, "1D" compares
// that NAV to the NAV as-of (latest - 1 day), nearest available on or before.
function periodTargets(latestDateExpr: string): string {
  return `[
        STRUCT('1D' AS period, 1 AS ord, DATE_SUB(${latestDateExpr}, INTERVAL 1 DAY) AS target),
        STRUCT('1W', 2, DATE_SUB(${latestDateExpr}, INTERVAL 1 WEEK)),
        STRUCT('1M', 3, DATE_SUB(${latestDateExpr}, INTERVAL 1 MONTH)),
        STRUCT('3M', 4, DATE_SUB(${latestDateExpr}, INTERVAL 3 MONTH)),
        STRUCT('YTD', 5, DATE_TRUNC(${latestDateExpr}, YEAR)),
        STRUCT('1Y', 6, DATE_SUB(${latestDateExpr}, INTERVAL 1 YEAR)),
        STRUCT('3Y', 7, DATE_SUB(${latestDateExpr}, INTERVAL 3 YEAR)),
        STRUCT('5Y', 8, DATE_SUB(${latestDateExpr}, INTERVAL 5 YEAR))
      ]`;
}

export const productPerformance = (): Query => ({
  sql: `WITH nav AS (${NAV_SOURCE}),
    latest AS (
      SELECT product_id, ANY_VALUE(type) AS type,
        ARRAY_AGG(STRUCT(value AS v, d AS d) ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS latest_snap
      FROM nav WHERE type IS NOT NULL GROUP BY product_id
    ),
    periods AS (
      SELECT l.product_id, l.type, l.latest_snap, pr.period, pr.ord, pr.target
      FROM latest l, UNNEST(${periodTargets('l.latest_snap.d')}) AS pr
    ),
    snaps AS (
      SELECT p.product_id, p.type, p.period, p.ord, p.latest_snap,
        ARRAY_AGG(IF(n.d <= p.target, STRUCT(n.value AS v, n.d AS d), NULL) IGNORE NULLS ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
      FROM periods p JOIN nav n ON n.product_id = p.product_id
      GROUP BY p.product_id, p.type, p.period, p.ord, p.latest_snap
    )
    SELECT type, period, ord,
      ROUND(AVG(SAFE_DIVIDE(latest_snap.v - asof_snap.v, asof_snap.v) * 100), 2) AS pct_change,
      COUNT(*) AS fund_count
    FROM snaps
    WHERE asof_snap IS NOT NULL
    GROUP BY type, period, ord
    ORDER BY type, ord`,
  params: {},
});

// Per-fund detail behind productPerformance(): one row per fund per period,
// for the drill-down table and the per-type export sheets.
export const productPerformanceDetail = (): Query => ({
  sql: `WITH nav AS (${NAV_SOURCE}),
    latest AS (
      SELECT product_id, ANY_VALUE(name) AS name, ANY_VALUE(type) AS type,
        ARRAY_AGG(STRUCT(value AS v, d AS d) ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS latest_snap
      FROM nav WHERE type IS NOT NULL GROUP BY product_id
    ),
    periods AS (
      SELECT l.product_id, l.name, l.type, l.latest_snap, pr.period, pr.ord, pr.target
      FROM latest l, UNNEST(${periodTargets('l.latest_snap.d')}) AS pr
    ),
    snaps AS (
      SELECT p.product_id, p.name, p.type, p.period, p.ord, p.latest_snap,
        ARRAY_AGG(IF(n.d <= p.target, STRUCT(n.value AS v, n.d AS d), NULL) IGNORE NULLS ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
      FROM periods p JOIN nav n ON n.product_id = p.product_id
      GROUP BY p.product_id, p.name, p.type, p.period, p.ord, p.latest_snap
    )
    SELECT type, name, period, ord,
      ROUND(SAFE_DIVIDE(latest_snap.v - asof_snap.v, asof_snap.v) * 100, 2) AS pct_change,
      latest_snap.v AS latest_nav, asof_snap.v AS base_nav
    FROM snaps
    WHERE asof_snap IS NOT NULL
    ORDER BY type, name, ord`,
  params: {},
});

// All active, AUM-bearing funds — powers the fund-picker checkboxes on the
// Performance trend chart.
export const fundList = (type?: string): Query => {
  const params: Record<string, unknown> = {};
  let typeFilter = '';
  if (type) { typeFilter = 'AND type = @type'; params.type = type; }
  return {
    sql: `SELECT name, type FROM ${FUNDS}
      WHERE listing_status = 'ACTIVE' AND latest_aum_value IS NOT NULL ${typeFilter}
      ORDER BY latest_aum_value DESC`,
    params,
  };
};

export interface FundNavTrendArgs {
  type?: string; period?: string; limit?: number | string; funds?: string | string[];
}

// Daily NAV trend for the Performance tab's top chart, over one of the shared
// PERF_PERIODS windows above. Anchored to the platform's latest available NAV
// date overall (not each fund's own), so every line shares one x-axis end point.
// Two modes:
//   - `funds` given (checkbox picks): chart exactly those funds, no ranking.
//   - `funds` omitted: rank all candidates (optionally scoped by `type`) by
//     their own % change over the period and chart the top `limit` performers
//     — "best performing", not "biggest by AUM".
export function fundNavTrend({ type, period = '1Y', limit = 5, funds }: FundNavTrendArgs = {}): Query {
  const params: Record<string, unknown> = { period };
  let typeFilter = '';
  if (type) { typeFilter = 'AND f.type = @type'; params.type = type; }

  const fundNames = (Array.isArray(funds) ? funds : funds ? [funds] : []).filter(Boolean);
  let chosenCte: string;
  if (fundNames.length) {
    params.funds = fundNames;
    chosenCte = `SELECT id AS product_id, name FROM ${FUNDS} WHERE name IN UNNEST(@funds)`;
  } else {
    params.limit = parseInt(String(limit), 10);
    chosenCte = 'SELECT product_id, name FROM ranked ORDER BY pct_change DESC LIMIT @limit';
  }

  return {
    sql: `WITH nav AS (${NAV_SOURCE}),
      latest AS (SELECT MAX(d) AS latest_d FROM nav),
      bounds AS (
        SELECT latest_d,
          (SELECT pr.target FROM UNNEST(${periodTargets('latest_d')}) AS pr WHERE pr.period = @period) AS from_d
        FROM latest
      ),
      candidates AS (
        SELECT f.id AS product_id, f.name
        FROM ${FUNDS} f
        WHERE f.listing_status = 'ACTIVE' AND f.latest_aum_value IS NOT NULL ${typeFilter}
      ),
      perf AS (
        SELECT c.product_id, c.name,
          ARRAY_AGG(STRUCT(n.value AS v, n.d AS d) ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS latest_snap,
          ARRAY_AGG(IF(n.d <= (SELECT from_d FROM bounds), STRUCT(n.value AS v, n.d AS d), NULL) IGNORE NULLS ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
        FROM candidates c JOIN nav n ON n.product_id = c.product_id
        GROUP BY c.product_id, c.name
      ),
      ranked AS (
        SELECT product_id, name, SAFE_DIVIDE(latest_snap.v - asof_snap.v, asof_snap.v) AS pct_change
        FROM perf WHERE asof_snap IS NOT NULL
      ),
      chosen AS (${chosenCte})
    SELECT n.name, n.type, n.d, n.value
    FROM nav n
    JOIN chosen c ON c.product_id = n.product_id
    CROSS JOIN bounds b
    WHERE n.d >= b.from_d
    ORDER BY n.name, n.d`,
    params,
  };
}

// ---- User portfolio lookup (pick a user by SID code, print their holdings) -
const BONUS_PORT = '`sayakaya.main.bonus_portfolios`';
const USER_PROFILES = '`sayakaya.main.user_profiles`';

// SID search box: type a SID code (or name/email) to find the user to print.
export const userSearch = (q?: string): Query => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, u.ifua_code AS ifua,
      up.name, u.email
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE LOWER(u.sid_code) LIKE @q OR LOWER(up.name) LIKE @q OR LOWER(u.email) LIKE @q
    ORDER BY u.sid_code LIMIT 20`,
  params: { q: `%${String(q || '').trim().toLowerCase()}%` },
});

// Contact card for the PDF export header — fetched server-side by userId so
// the report shows authoritative data, not whatever the client last selected.
export const userContact = (userId: string): Query => ({
  sql: `SELECT u.sid_code AS sid, u.ifua_code AS ifua, u.email, up.name, up.phone_number AS phone,
      COALESCE(up.correspondence_address, up.id_address) AS address
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE u.id = @userId
    LIMIT 1`,
  params: { userId },
});

// Current holdings for one user, one row per fund — regular + bonus units are
// combined (the investor doesn't care which bucket a unit came from). Live
// value at the fund's latest NAV, same "active holdings" definition as the
// AUM KPI. avg_buy_price averages the buy price carried on the portfolio rows
// themselves (portfolios.initial_price / bonus_portfolios.average_nav), so it
// exists even for holdings with no completed buy transaction (transfers, bonus).
export const userHoldings = (userId: string): Query => ({
  sql: `WITH holdings AS (
      SELECT fund_id, SUM(unit) AS unit, AVG(price) AS avg_buy_price, MIN(created_at) AS opened_at
      FROM (
        SELECT p.fund_id, p.unit, p.initial_price AS price, p.created_at
        FROM ${PORT} p WHERE p.deleted_at IS NULL AND p.unit > 0 AND p.user_id = @userId
        UNION ALL
        SELECT bp.fund_id, bp.unit, bp.average_nav AS price, bp.created_at
        FROM ${BONUS_PORT} bp WHERE bp.status = 'on_going' AND bp.user_id = @userId
      )
      GROUP BY fund_id
    )
    SELECT *, value - fund_value AS gain_loss,
      SAFE_DIVIDE(value - fund_value, fund_value) * 100 AS gain_pct
    FROM (
      SELECT f.name AS fund, f.type AS fund_type, h.unit, h.avg_buy_price,
        f.latest_nav_value AS nav, f.latest_nav_date AS nav_date,
        ROUND(h.unit * h.avg_buy_price) AS fund_value,
        ROUND(h.unit * f.latest_nav_value) AS value,
        h.opened_at
      FROM holdings h
      JOIN ${FUNDS} f ON f.id = h.fund_id
    )
    ORDER BY value DESC`,
  params: { userId },
});

// Regular vs bonus AUM split for the dashboard KPIs only — the per-fund
// holdings table/exports stay merged; this is purely for the breakdown card.
export const userPortfolioSplit = (userId: string): Query => ({
  sql: `WITH regular AS (
      SELECT p.fund_id, p.unit FROM ${PORT} p WHERE p.deleted_at IS NULL AND p.unit > 0 AND p.user_id = @userId
    ),
    bonus AS (
      SELECT bp.fund_id, bp.unit FROM ${BONUS_PORT} bp WHERE bp.status = 'on_going' AND bp.user_id = @userId
    )
    SELECT
      (SELECT COALESCE(SUM(r.unit * f.latest_nav_value), 0) FROM regular r JOIN ${FUNDS} f ON f.id = r.fund_id) AS regular_value,
      (SELECT COALESCE(SUM(b.unit * f.latest_nav_value), 0) FROM bonus b JOIN ${FUNDS} f ON f.id = b.fund_id) AS bonus_value`,
  params: { userId },
});

// AUM performance for one user (by SID code), summed across their funds per
// day from portfolio_with_code (one row per sid_code+fund per day; `amount`
// is that holding's value on that day).
const PORT_WITH_CODE = '`sayakaya.mi_fee_logs.portfolio_with_code`';

// Daily total AUM time series for one user — for the AUM-over-time chart.
export const userAumHistory = (sid: string): Query => ({
  sql: `SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS bucket, SUM(amount) AS amount
    FROM ${PORT_WITH_CODE}
    WHERE sid_code = @sid
    GROUP BY bucket ORDER BY bucket`,
  params: { sid },
});

export const userPerformance = (sid: string): Query => ({
  sql: `WITH daily AS (
      SELECT DATE(created_at) AS d, SUM(amount) AS amount
      FROM ${PORT_WITH_CODE}
      WHERE sid_code = @sid
      GROUP BY d
    ),
    latest AS (
      SELECT ARRAY_AGG(STRUCT(amount AS v, d AS d) ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS latest_snap
      FROM daily
    ),
    periods AS (
      SELECT l.latest_snap, pr.period, pr.ord, pr.target
      FROM latest l, UNNEST(${periodTargets('l.latest_snap.d')}) AS pr
    ),
    snaps AS (
      SELECT p.period, p.ord, p.latest_snap,
        ARRAY_AGG(IF(daily.d <= p.target, STRUCT(daily.amount AS v, daily.d AS d), NULL) IGNORE NULLS ORDER BY daily.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
      FROM periods p CROSS JOIN daily
      GROUP BY p.period, p.ord, p.latest_snap
    )
    SELECT period, ord,
      latest_snap.v AS latest_amount, asof_snap.v AS base_amount,
      ROUND(SAFE_DIVIDE(latest_snap.v - asof_snap.v, asof_snap.v) * 100, 2) AS pct_change
    FROM snaps
    ORDER BY ord`,
  params: { sid },
});

// ---- Growth: campaigns, referrals, switching, manager/demographic AUM splits --
const CAMPAIGNS = '`sayakaya.main.campaigns`';
const SWITCHING = '`sayakaya.main.switching_transactions`';
const IM = '`sayakaya.main.investment_managers`';

export const campaignPerformance = (limit: number | string = 50): Query => ({
  sql: `SELECT name, campaign_type, promo_code, quota, used_quota,
      ROUND(SAFE_DIVIDE(used_quota, quota) * 100, 1) AS redemption_pct,
      bonus_amount, ROUND(used_quota * bonus_amount) AS est_cost,
      start_date, end_date
    FROM ${CAMPAIGNS}
    WHERE deleted_at IS NULL
    ORDER BY used_quota DESC LIMIT @limit`,
  params: { limit: parseInt(String(limit), 10) },
});

// Fund-to-fund switching flow: which funds bleed AUM to which.
export const switchingTopPairs = (limit: number | string = 15): Query => ({
  sql: `SELECT fo.name AS from_fund, fd.name AS to_fund,
      COUNT(*) AS switches, SUM(s.origin_amount) AS amount
    FROM ${SWITCHING} s
    JOIN ${FUNDS} fo ON fo.id = s.origin_fund_id
    JOIN ${FUNDS} fd ON fd.id = s.destination_fund_id
    WHERE s.status = 'completed'
    GROUP BY from_fund, to_fund
    ORDER BY amount DESC LIMIT @limit`,
  params: { limit: parseInt(String(limit), 10) },
});

// Market AUM rolled up by investment manager (same source as the fund-type chart).
export const aumByManager = (limit: number | string = 15): Query => ({
  sql: `SELECT COALESCE(im.common_name, im.name) AS label,
      COUNT(*) AS fund_count, SUM(IFNULL(f.latest_aum_value, 0)) AS aum
    FROM ${FUNDS} f
    LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
    WHERE f.listing_status = 'ACTIVE'
    GROUP BY label
    ORDER BY aum DESC LIMIT @limit`,
  params: { limit: parseInt(String(limit), 10) },
});

// Platform AUM (live holdings, same definition as the Overview KPI) split by
// investor demographic — risk tolerance and income bracket.
const ACTIVE_CTE = `active AS (
      SELECT p.user_id, p.unit, p.fund_id FROM ${PORT} p WHERE p.deleted_at IS NULL AND p.unit > 0
      UNION ALL
      SELECT bp.user_id, bp.unit, bp.fund_id FROM \`sayakaya.main.bonus_portfolios\` bp WHERE bp.status = 'on_going'
    )`;

export const aumByRisk = (): Query => ({
  sql: `WITH ${ACTIVE_CTE}
    SELECT IFNULL(up.investment_risk_tolerance, '(unknown)') AS label,
      COUNT(DISTINCT a.user_id) AS investors,
      ROUND(SUM(a.unit * f.latest_nav_value)) AS aum
    FROM active a
    JOIN ${FUNDS} f ON f.id = a.fund_id
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = a.user_id
    GROUP BY label ORDER BY aum DESC`,
  params: {},
});

export const aumByIncome = (): Query => ({
  sql: `WITH ${ACTIVE_CTE}
    SELECT
      CASE
        WHEN up.monthly_income IS NULL THEN '(unknown)'
        WHEN up.monthly_income < 5000000 THEN '< 5jt'
        WHEN up.monthly_income < 10000000 THEN '5–10jt'
        WHEN up.monthly_income < 25000000 THEN '10–25jt'
        WHEN up.monthly_income < 50000000 THEN '25–50jt'
        ELSE '50jt+'
      END AS label,
      CASE
        WHEN up.monthly_income IS NULL THEN 0
        WHEN up.monthly_income < 5000000 THEN 1
        WHEN up.monthly_income < 10000000 THEN 2
        WHEN up.monthly_income < 25000000 THEN 3
        WHEN up.monthly_income < 50000000 THEN 4
        ELSE 5
      END AS ord,
      COUNT(DISTINCT a.user_id) AS investors,
      ROUND(SUM(a.unit * f.latest_nav_value)) AS aum
    FROM active a
    JOIN ${FUNDS} f ON f.id = a.fund_id
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = a.user_id
    GROUP BY label, ord ORDER BY ord`,
  params: {},
});

// Referral leaderboard: who brought in the most $ via referral_code/referrer_code.
export const topReferrers = (limit: number | string = 20): Query => ({
  sql: `WITH vol AS (
      SELECT user_id, SUM(final_amount) AS amt
      FROM ${TX} WHERE type = 'buy' AND status = 'completed'
      GROUP BY user_id
    )
    SELECT u.referral_code, COALESCE(up.name, u.email) AS referrer,
      COUNT(r.id) AS referred_count,
      ROUND(SUM(IFNULL(v.amt, 0))) AS referred_volume
    FROM ${USERS} u
    JOIN ${USERS} r ON r.referrer_code = u.referral_code
    LEFT JOIN vol v ON v.user_id = r.id
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE u.referral_code IS NOT NULL
    GROUP BY u.referral_code, referrer
    ORDER BY referred_volume DESC LIMIT @limit`,
  params: { limit: parseInt(String(limit), 10) },
});

// ---- Reconciliation: app ledger (main.transactions) vs custodian feed (sinvest) -
// Transaction_Date/amount columns in sinvest.trx_history are STRING ('YYYYMMDD',
// formatted numbers) — the raw KSEI/SInvest export, never cleaned.
const SINVEST = '`sayakaya.sinvest.trx_history`';

export const reconciliationDaily = (from?: string, to?: string): Query => {
  const r = range(from, to);
  return {
    sql: `WITH sinvest AS (
        SELECT PARSE_DATE('%Y%m%d', Transaction_Date) AS d,
          SUM(SAFE_CAST(Net_Transaction_Amount AS NUMERIC)) AS amount,
          COUNT(*) AS cnt
        FROM ${SINVEST}
        WHERE Transaction_Date IS NOT NULL
        GROUP BY d
      ),
      app AS (
        SELECT DATE(created_at) AS d, SUM(final_amount) AS amount, COUNT(*) AS cnt
        FROM ${TX} WHERE status = 'completed'
        GROUP BY d
      )
      SELECT FORMAT_DATE('%Y-%m-%d', COALESCE(s.d, a.d)) AS bucket,
        IFNULL(s.amount, 0) AS sinvest_amount, IFNULL(s.cnt, 0) AS sinvest_count,
        IFNULL(a.amount, 0) AS app_amount, IFNULL(a.cnt, 0) AS app_count,
        ROUND(IFNULL(a.amount, 0) - IFNULL(s.amount, 0)) AS amount_diff
      FROM sinvest s FULL OUTER JOIN app a ON s.d = a.d
      WHERE COALESCE(s.d, a.d) BETWEEN @from AND @to
      ORDER BY bucket DESC`,
    params: r,
  };
};

// ---- Revenue: management fee earned per fund, prorated daily from AUM -----
// Daily AUM snapshots (portfolio_with_code) x the management fee rate in
// effect (latest_mgmt_fee, deduped by updated_at) gives a daily fee accrual,
// split into AperD's and MI's share. Grouped by month + fund for the detail
// view; summed again across funds for the monthly summary.
function revenueCTEs(from?: string, to?: string) {
  const r = range(from, to);
  return {
    cte: `WITH latest_mgmt_fee AS (
        SELECT management_fee_id, management_fee, aperd_share, mi_share
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY management_fee_id ORDER BY updated_at DESC) AS rn
          FROM ${MGMT_FEE_LOGS}
        ) t
        WHERE rn = 1
      ),
      combined AS (
        SELECT
          DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) AS created_date,
          pwc.id AS fund_id,
          f.sinvest_code,
          f.name AS fund_name,
          pwc.amount AS aum,
          lmf.management_fee,
          lmf.aperd_share,
          lmf.mi_share
        FROM ${PORT_WITH_CODE} pwc
        LEFT JOIN ${FUNDS} f ON pwc.id = f.id
        LEFT JOIN latest_mgmt_fee lmf ON f.id = lmf.management_fee_id
        WHERE DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) BETWEEN @from AND @to
      ),
      daily_detail AS (
        SELECT *,
          (management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(created_date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(created_date, YEAR), DAY) AS management_fee_per_day,
          aperd_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(created_date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(created_date, YEAR), DAY)) AS aperd_share_per_day,
          mi_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(created_date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(created_date, YEAR), DAY)) AS mi_share_per_day
        FROM combined
      ),
      monthly_fund AS (
        SELECT
          DATE_TRUNC(created_date, MONTH) AS month,
          fund_id,
          sinvest_code,
          ANY_VALUE(fund_name) AS fund_name,
          ANY_VALUE(management_fee) AS management_fee,
          ANY_VALUE(aperd_share) AS aperd_share,
          ANY_VALUE(mi_share) AS mi_share,
          COUNT(DISTINCT created_date) AS days_running,
          AVG(aum) AS avg_aum,
          ARRAY_AGG(aum ORDER BY created_date DESC LIMIT 1)[OFFSET(0)] AS aum_eom,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share
        FROM daily_detail
        GROUP BY month, fund_id, sinvest_code
      )`,
    params: r,
  };
}

export const revenueDetail = (from?: string, to?: string): Query => {
  const { cte, params } = revenueCTEs(from, to);
  return {
    sql: `${cte}
      SELECT
        month, fund_id, sinvest_code, fund_name, management_fee, aperd_share, mi_share,
        days_running, avg_aum, aum_eom, total_management_fee, total_aperd_share, total_mi_share
      FROM monthly_fund
      ORDER BY month, fund_id, sinvest_code`,
    params,
  };
};

// days_running per month is the MAX across funds in that month — funds that
// started mid-month run fewer days, so the longest-running fund estimates the
// actual calendar days elapsed (not yet accounting for mid-month closures).
export const revenueMonthlySummary = (from?: string, to?: string): Query => {
  const { cte, params } = revenueCTEs(from, to);
  return {
    sql: `${cte}
      SELECT
        month,
        COUNT(DISTINCT fund_id) AS funds,
        MAX(days_running) AS days_running,
        SUM(aum_eom) AS total_aum,
        SUM(total_management_fee) AS total_management_fee,
        SUM(total_aperd_share) AS total_aperd_share,
        SUM(total_mi_share) AS total_mi_share
      FROM monthly_fund
      GROUP BY month
      ORDER BY month`,
    params,
  };
};
