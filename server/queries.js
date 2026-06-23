'use strict';

/**
 * Every builder returns { sql, params }. User-controlled values (dates, type,
 * status, search, paging) are always passed as named parameters — never string
 * concatenated — so the SQL Lab is the only place raw user SQL can run.
 *
 * Date range convention: `from` and `to` are 'YYYY-MM-DD' strings. `to` is
 * treated as inclusive of the whole day.
 */

const TX = '`sayakaya.main.transactions`';
const USERS = '`sayakaya.main.users`';
const FUNDS = '`sayakaya.main.funds`';
const PORT = '`sayakaya.main.portfolios`';
const MIFEE = '`sayakaya.mi_fee_logs.mi_fee`';

function range(from, to) {
  return {
    from: from || '2021-01-01',
    to: to || '2100-01-01',
  };
}

// ---- Overview KPIs ----------------------------------------------------------

const overviewUsers = () => ({
  sql: `SELECT
      COUNT(*) AS total_users,
      COUNTIF(verification_status = 'verified') AS verified_users,
      COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS new_users_30d
    FROM ${USERS}`,
  params: {},
});

const overviewAum = () => ({
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

const overviewTx = (from, to) => ({
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

const overviewFunds = () => ({
  sql: `SELECT
      COUNTIF(listing_status='ACTIVE') AS active_funds,
      COUNT(*) AS total_funds
    FROM ${FUNDS}`,
  params: {},
});

// ---- Time series ------------------------------------------------------------

const trends = (from, to, granularity = 'month') => {
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

const breakdownBy = (column, from, to) => {
  const allowed = { status: 'status', type: 'type', payment_method: 'payment_method', payment_gateway: 'payment_gateway' };
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

const topFunds = (limit = 10) => ({
  sql: `SELECT name, type, is_sharia, latest_nav_value, latest_aum_value, management_fee, latest_aum_date
    FROM ${FUNDS}
    WHERE latest_aum_value IS NOT NULL AND listing_status='ACTIVE'
    ORDER BY latest_aum_value DESC LIMIT @limit`,
  params: { limit: parseInt(limit, 10) },
});

const fundTypes = () => ({
  sql: `SELECT type AS label, COUNT(*) AS count, SUM(IFNULL(latest_aum_value,0)) AS aum
    FROM ${FUNDS}
    WHERE listing_status='ACTIVE'
    GROUP BY type ORDER BY aum DESC`,
  params: {},
});

// ---- Users ------------------------------------------------------------------

const userGrowth = () => ({
  sql: `SELECT FORMAT_DATETIME('%Y-%m', created_at) AS bucket, COUNT(*) AS signups
    FROM ${USERS}
    WHERE created_at >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 24 MONTH)
    GROUP BY bucket ORDER BY bucket`,
  params: {},
});

const verificationBreakdown = () => ({
  sql: `SELECT IFNULL(verification_status,'(none)') AS label, COUNT(*) AS count
    FROM ${USERS} GROUP BY label ORDER BY count DESC`,
  params: {},
});

// ---- Transactions explorer (paged, filtered) --------------------------------
// NOTE: the password column lives only on the users table; transactions has no
// sensitive PII columns, and we never join users' password anywhere.

const txColumns = [
  'id', 'transaction_number', 'user_id', 'fund_id', 'type', 'status',
  'unit', 'amount', 'final_amount', 'payment_method', 'payment_gateway',
  'value_per_unit', 'realized_gain_loss', 'created_at', 'completed_at',
];

function transactions({ from, to, type, status, search, limit = 50, offset = 0 }) {
  const params = { ...range(from, to), limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
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
const txFilterValues = () => ({
  sql: `SELECT
      ARRAY_AGG(DISTINCT type IGNORE NULLS) AS types,
      ARRAY_AGG(DISTINCT status IGNORE NULLS) AS statuses
    FROM ${TX}`,
  params: {},
});

// ---- AUM history (from mi_fee_logs.mi_fee: daily AUM + revenue per fund) -----
// AUM is a point-in-time stock: daily = sum across funds that day; monthly =
// end-of-month value. Revenue (aperd_share_per_day) is a flow: always summed.
const aumHistory = (from, to, granularity = 'month') => {
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
const PERIODS_CTE = `periods AS (
      SELECT * FROM UNNEST([
        STRUCT('1D' AS period, 1 AS ord, DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) AS target),
        STRUCT('1W', 2, DATE_SUB(CURRENT_DATE(), INTERVAL 1 WEEK)),
        STRUCT('1M', 3, DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)),
        STRUCT('3M', 4, DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)),
        STRUCT('YTD', 5, DATE_TRUNC(CURRENT_DATE(), YEAR)),
        STRUCT('1Y', 6, DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)),
        STRUCT('3Y', 7, DATE_SUB(CURRENT_DATE(), INTERVAL 3 YEAR)),
        STRUCT('5Y', 8, DATE_SUB(CURRENT_DATE(), INTERVAL 5 YEAR))
      ])
    )`;

const productPerformance = () => ({
  sql: `WITH nav AS (${NAV_SOURCE}),
    ${PERIODS_CTE},
    snaps AS (
      SELECT n.product_id, ANY_VALUE(n.type) AS type, p.period, p.ord,
        ARRAY_AGG(STRUCT(n.value AS v, n.d AS d) ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS latest_snap,
        ARRAY_AGG(IF(n.d <= p.target, STRUCT(n.value AS v, n.d AS d), NULL) IGNORE NULLS ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
      FROM nav n CROSS JOIN periods p
      WHERE n.type IS NOT NULL
      GROUP BY n.product_id, p.period, p.ord
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
const productPerformanceDetail = () => ({
  sql: `WITH nav AS (${NAV_SOURCE}),
    ${PERIODS_CTE},
    snaps AS (
      SELECT n.product_id, ANY_VALUE(n.name) AS name, ANY_VALUE(n.type) AS type, p.period, p.ord,
        ARRAY_AGG(STRUCT(n.value AS v, n.d AS d) ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS latest_snap,
        ARRAY_AGG(IF(n.d <= p.target, STRUCT(n.value AS v, n.d AS d), NULL) IGNORE NULLS ORDER BY n.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
      FROM nav n CROSS JOIN periods p
      WHERE n.type IS NOT NULL
      GROUP BY n.product_id, p.period, p.ord
    )
    SELECT type, name, period, ord,
      ROUND(SAFE_DIVIDE(latest_snap.v - asof_snap.v, asof_snap.v) * 100, 2) AS pct_change,
      latest_snap.v AS latest_nav, asof_snap.v AS base_nav
    FROM snaps
    WHERE asof_snap IS NOT NULL
    ORDER BY type, name, ord`,
  params: {},
});

// ---- User portfolio lookup (pick a user by SID code, print their holdings) -
const BONUS_PORT = '`sayakaya.main.bonus_portfolios`';
const USER_PROFILES = '`sayakaya.main.user_profiles`';

// SID search box: type a SID code (or name/email) to find the user to print.
const userSearch = (q) => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, u.ifua_code AS ifua,
      up.name, u.email
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE LOWER(u.sid_code) LIKE @q OR LOWER(up.name) LIKE @q OR LOWER(u.email) LIKE @q
    ORDER BY u.sid_code LIMIT 20`,
  params: { q: `%${String(q || '').trim().toLowerCase()}%` },
});

// Current holdings (regular + bonus) for one user, with live value at the
// fund's latest NAV — same "active holdings" definition as the AUM KPI.
const userHoldings = (userId) => ({
  sql: `WITH holdings AS (
      SELECT p.fund_id, p.unit, p.created_at, 'regular' AS source
      FROM ${PORT} p WHERE p.deleted_at IS NULL AND p.unit > 0 AND p.user_id = @userId
      UNION ALL
      SELECT bp.fund_id, bp.unit, bp.created_at, 'bonus' AS source
      FROM ${BONUS_PORT} bp WHERE bp.status = 'on_going' AND bp.user_id = @userId
    )
    SELECT f.name AS fund, f.type AS fund_type, h.source, h.unit,
      f.latest_nav_value AS nav, ROUND(h.unit * f.latest_nav_value) AS value, h.created_at AS opened_at
    FROM holdings h JOIN ${FUNDS} f ON f.id = h.fund_id
    ORDER BY value DESC`,
  params: { userId },
});

// AUM performance for one user (by SID code), summed across their funds per
// day from portfolios_with_code, % change per period vs the AUM history report.
const PORT_WITH_CODE = '`sayakaya.mi_fee_logs.portfolios_with_code`';
const userPerformance = (sid) => ({
  sql: `WITH daily AS (
      SELECT DATE(created_at) AS d, SUM(amount) AS amount
      FROM ${PORT_WITH_CODE}
      WHERE sid_code = @sid
      GROUP BY d
    ),
    ${PERIODS_CTE},
    snaps AS (
      SELECT p.period, p.ord,
        ARRAY_AGG(STRUCT(daily.amount AS v, daily.d AS d) ORDER BY daily.d DESC LIMIT 1)[OFFSET(0)] AS latest_snap,
        ARRAY_AGG(IF(daily.d <= p.target, STRUCT(daily.amount AS v, daily.d AS d), NULL) IGNORE NULLS ORDER BY daily.d DESC LIMIT 1)[OFFSET(0)] AS asof_snap
      FROM daily CROSS JOIN periods p
      GROUP BY p.period, p.ord
    )
    SELECT period, ord,
      latest_snap.v AS latest_amount, asof_snap.v AS base_amount,
      ROUND(SAFE_DIVIDE(latest_snap.v - asof_snap.v, asof_snap.v) * 100, 2) AS pct_change
    FROM snaps
    ORDER BY ord`,
  params: { sid },
});

module.exports = {
  overviewUsers, overviewAum, overviewTx, overviewFunds,
  trends, breakdownBy, topFunds, fundTypes, aumHistory,
  userGrowth, verificationBreakdown,
  transactions, txFilterValues, txColumns,
  productPerformance, productPerformanceDetail,
  userSearch, userHoldings, userPerformance,
};
