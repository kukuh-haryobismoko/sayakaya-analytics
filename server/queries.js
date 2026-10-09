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
const MGMT_FEE_LOGS = '`sayakaya.main.management_fee_logs`';

function range(from, to) {
  return {
    from: from || '2021-01-01',
    to: to || '2100-01-01',
  };
}

// Shared day/week/month/quarter -> DATE_TRUNC part mapping, used everywhere a
// query lets the caller pick the bucket size (revenue, remisier revenue, ...).
const granularityPart = (granularity, fallback = 'MONTH') =>
  ({ day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER' })[granularity] || fallback;

// Wildcard (partial, case-insensitive) fund/MI filter shared by the revenue
// queries below — empty string means "no filter" for that field.
const FUND_MI_FILTER_SQL = `
  (@fund = '' OR UPPER(f.name) LIKE CONCAT('%', UPPER(@fund), '%') OR UPPER(f.sinvest_code) LIKE CONCAT('%', UPPER(@fund), '%'))
  AND (@mi = '' OR UPPER(COALESCE(im.common_name, im.name)) LIKE CONCAT('%', UPPER(@mi), '%'))`;

// "Only these funds" filter shared by the Overview fund-filter dropdown.
// Same convention as excludeFunds below: omit the clause (and the param)
// entirely when nothing was picked, so an unfiltered call never binds an
// empty array. funds.id / *.fund_id are STRING columns in BigQuery, not
// INT64 — keep ids as strings so @fundIds infers as ARRAY<STRING>.
const normalizeFundIds = (fundIds) => (Array.isArray(fundIds) ? fundIds : []).map((v) => String(v).trim()).filter(Boolean);
function fundIdsClause(params, col, ids, joiner = ' AND ') {
  if (!ids.length) return '';
  params.fundIds = ids;
  return `${joiner}${col} IN UNNEST(@fundIds)`;
}

// Overview user filter: rules like { field: 'referrer_code', mode: 'exclude',
// values: ['RAIZKAYA'] }. Rules AND together, the values inside one rule OR
// together. Values match the whole field case-insensitively, `*` is a
// wildcard (BPJSKES* = every BPJS Kesehatan sales code). `institution` takes
// no values, it's the users.is_institution flag. Malformed input throws
// instead of being dropped, so a typo can never silently widen the numbers.
const USER_FILTER_COLS = { sid: 'sid_code', email: 'email', referrer_code: 'referrer_code', sales_code: 'sales_code' };
// ponytail: the filter rides in a GET query string, and Supabase's gateway
// 414s somewhere past 16KB. Move the Overview routes to POST if lists need to grow.
const USER_FILTER_MAX_VALUES = 300;
function normalizeUserFilter(raw) {
  if (!raw) return [];
  let rules = raw;
  if (typeof raw === 'string') {
    try { rules = JSON.parse(raw); } catch { throw new Error('userFilter is not valid JSON.'); }
  }
  if (!Array.isArray(rules)) throw new Error('userFilter must be a list of rules.');
  const out = rules.map((r) => {
    const { field, mode } = r || {};
    if (mode !== 'include' && mode !== 'exclude') throw new Error(`Unknown user filter mode: ${mode}`);
    if (field === 'institution') return { field, mode, values: [] };
    if (!USER_FILTER_COLS[field]) throw new Error(`Unknown user filter field: ${field}`);
    const values = (Array.isArray(r.values) ? r.values : [])
      .map((v) => String(v).trim().toLowerCase()).filter(Boolean)
      .map((v) => v.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%'));
    return { field, mode, values };
  }).filter((r) => r.field === 'institution' || r.values.length);
  if (out.reduce((n, r) => n + r.values.length, 0) > USER_FILTER_MAX_VALUES) {
    throw new Error(`The user filter takes at most ${USER_FILTER_MAX_VALUES} values in total.`);
  }
  return out;
}
// `col IN (users passing every rule)`, keyed on users.id, or on sid_code for
// the portfolio_with_code snapshots. Omitted entirely when there are no rules.
function userFilterClause(params, col, rules, key = 'id', joiner = ' AND ') {
  if (!rules.length) return '';
  const preds = rules.map((r, i) => {
    let p = 'IFNULL(is_institution, FALSE)';
    if (r.field !== 'institution') {
      params[`uf${i}`] = r.values;
      p = `EXISTS(SELECT 1 FROM UNNEST(@uf${i}) v WHERE LOWER(${USER_FILTER_COLS[r.field]}) LIKE v)`;
    }
    return r.mode === 'exclude' ? `NOT ${p}` : p;
  });
  return `${joiner}${col} IN (SELECT ${key} FROM ${USERS} WHERE ${preds.join(' AND ')})`;
}

// ---- Overview KPIs ----------------------------------------------------------

const overviewUsers = (userFilter = []) => {
  const params = {};
  return {
    sql: `SELECT
        COUNT(*) AS total_users,
        COUNTIF(verification_status = 'verified') AS verified_users,
        COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS new_users_30d
      FROM ${USERS}${userFilterClause(params, 'id', userFilter, 'id', ' WHERE ')}`,
    params,
  };
};

const overviewTx = (from, to, fundIds = [], userFilter = []) => {
  const ids = normalizeFundIds(fundIds);
  const params = range(from, to);
  const fundFilter = fundIdsClause(params, 'fund_id', ids);
  return {
    sql: `SELECT
        COUNT(*) AS total_tx,
        COUNTIF(type='buy'  AND status='completed') AS buy_count,
        COUNTIF(type='sell' AND status='completed') AS sell_count,
        SUM(IF(type='buy'  AND status='completed', final_amount, 0)) AS buy_volume,
        SUM(IF(type='sell' AND status='completed', final_amount, 0)) AS sell_volume,
        COUNT(DISTINCT user_id) AS active_users
      FROM ${TX}
      WHERE DATE(created_at) BETWEEN @from AND @to${fundFilter}${userFilterClause(params, 'user_id', userFilter)}`,
    params,
  };
};

const overviewFunds = (fundIds = []) => {
  const ids = normalizeFundIds(fundIds);
  const params = {};
  const fundFilter = fundIdsClause(params, 'id', ids, ' WHERE ');
  return {
    sql: `SELECT
        COUNTIF(listing_status='ACTIVE') AS active_funds,
        COUNT(*) AS total_funds
      FROM ${FUNDS}${fundFilter}`,
    params,
  };
};

// ---- Time series ------------------------------------------------------------

const trends = (from, to, granularity = 'month', fundIds = [], userFilter = []) => {
  const fmt = granularity === 'day' ? '%Y-%m-%d'
    : granularity === 'week' ? '%Y-%W'
    : '%Y-%m';
  const ids = normalizeFundIds(fundIds);
  const params = range(from, to);
  const fundFilter = fundIdsClause(params, 'fund_id', ids) + userFilterClause(params, 'user_id', userFilter);
  return {
    sql: `SELECT
        FORMAT_TIMESTAMP('${fmt}', created_at) AS bucket,
        COUNTIF(type='buy'  AND status='completed') AS buy_count,
        COUNTIF(type='sell' AND status='completed') AS sell_count,
        SUM(IF(type='buy'  AND status='completed', final_amount, 0)) AS buy_volume,
        SUM(IF(type='sell' AND status='completed', final_amount, 0)) AS sell_volume,
        COUNT(DISTINCT user_id) AS active_users
      FROM ${TX}
      WHERE DATE(created_at) BETWEEN @from AND @to${fundFilter}
      GROUP BY bucket ORDER BY bucket`,
    params,
  };
};

// ---- Breakdowns -------------------------------------------------------------

const breakdownBy = (column, from, to, fundIds = [], userFilter = []) => {
  const allowed = { status: 'status', type: 'type', payment_method: 'payment_method', payment_gateway: 'payment_gateway' };
  const col = allowed[column] || 'status';
  const ids = normalizeFundIds(fundIds);
  const params = range(from, to);
  const fundFilter = fundIdsClause(params, 'fund_id', ids) + userFilterClause(params, 'user_id', userFilter);
  return {
    sql: `SELECT
        IFNULL(${col}, '(none)') AS label,
        COUNT(*) AS count,
        SUM(IFNULL(final_amount, 0)) AS volume
      FROM ${TX}
      WHERE DATE(created_at) BETWEEN @from AND @to${fundFilter}
      GROUP BY label ORDER BY count DESC`,
    params,
  };
};

// ---- Funds ------------------------------------------------------------------

// funds.latest_aum_value is a whole-fund total, so it can't be narrowed to a
// set of users. With a user filter on, AUM is summed from those users' live
// holdings instead (same definition as the Overview map, activeCte below).
const fundTypes = (fundIds = [], userFilter = []) => {
  const ids = normalizeFundIds(fundIds);
  const params = {};
  if (userFilter.length) {
    return {
      sql: `WITH ${activeCte(params, ids)}
      SELECT f.type AS label, COUNT(DISTINCT f.id) AS count, ROUND(SUM(a.unit * f.latest_nav_value)) AS aum
      FROM active a
      JOIN ${FUNDS} f ON f.id = a.fund_id
      WHERE f.listing_status = 'ACTIVE'${userFilterClause(params, 'a.user_id', userFilter)}
      GROUP BY f.type ORDER BY aum DESC`,
      params,
    };
  }
  const fundFilter = fundIdsClause(params, 'id', ids);
  return {
    sql: `SELECT type AS label, COUNT(*) AS count, SUM(IFNULL(latest_aum_value,0)) AS aum
      FROM ${FUNDS}
      WHERE listing_status='ACTIVE'${fundFilter}
      GROUP BY type ORDER BY aum DESC`,
    params,
  };
};

// ---- Users ------------------------------------------------------------------

const userGrowth = () => ({
  sql: `SELECT FORMAT_DATETIME('%Y-%m', created_at) AS bucket, COUNT(*) AS signups
    FROM ${USERS}
    WHERE created_at >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 24 MONTH)
    GROUP BY bucket ORDER BY bucket`,
  params: {},
});

const verificationBreakdown = (userFilter = []) => {
  const params = {};
  return {
    sql: `SELECT IFNULL(verification_status,'(none)') AS label, COUNT(*) AS count
      FROM ${USERS}${userFilterClause(params, 'id', userFilter, 'id', ' WHERE ')} GROUP BY label ORDER BY count DESC`,
    params,
  };
};

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
// Joined to FUNDS and filtered to listing_status='ACTIVE' — a liquidated fund
// stops being a real ongoing position once it's inactive, so its AUM
// shouldn't keep counting past that point. Same rule as platformAumAsOf below.
//
// Root cause columns: ΔAUM = net flow (completed buy − sell) + market effect
// (the rest: NAV moves, reinvestments, bonus units). mi_fee's row for day D
// already includes transactions completed on D−1 (daily ΔAUM vs net flow
// correlates 0.998 at that lag, 0.36 same-day), hence the +1 day shift below.
// Switching nets to ~0 platform-wide, so it only shows up in the per-fund
// drill (aumHistoryDrill). market_effect is NULL on the first row (no prior
// period in range to diff against).
const AUM_FLOW_DATE = 'DATE_ADD(DATE(t.completed_at), INTERVAL 1 DAY)';
const aumHistory = (from, to, granularity = 'month') => {
  const fmt = granularity === 'day' ? '%Y-%m-%d' : '%Y-%m';
  return {
    sql: `WITH daily AS (
        SELECT DATE(m.created_at) AS d,
          SUM(m.AUM) AS aum, SUM(m.aperd_share_per_day) AS revenue,
          COUNT(DISTINCT m.fund_id) AS funds
        FROM ${MIFEE} m
        JOIN ${FUNDS} f ON f.id = m.fund_id
        WHERE DATE(m.created_at) BETWEEN @from AND @to AND f.listing_status = 'ACTIVE'
        GROUP BY d
      ),
      flows AS (
        SELECT ${AUM_FLOW_DATE} AS d,
          SUM(IF(t.type = 'buy', t.final_amount, 0)) AS subs,
          SUM(IF(t.type = 'sell', t.final_amount, 0)) AS reds
        FROM ${TX} t
        JOIN ${FUNDS} f ON f.id = t.fund_id
        WHERE t.status = 'completed' AND t.type IN ('buy', 'sell') AND f.listing_status = 'ACTIVE'
          AND ${AUM_FLOW_DATE} BETWEEN @from AND @to
        GROUP BY d
      ),
      buckets AS (
        SELECT FORMAT_DATE('${fmt}', d) AS bucket,
          ARRAY_AGG(aum ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS aum,
          SUM(revenue) AS revenue, MAX(funds) AS funds,
          SUM(IFNULL(subs, 0)) AS subs, SUM(IFNULL(reds, 0)) AS reds
        FROM daily LEFT JOIN flows USING (d)
        GROUP BY bucket
      )
      SELECT bucket, ROUND(aum) AS aum, ROUND(revenue) AS revenue, funds,
        ROUND(subs) AS subscriptions, ROUND(reds) AS redemptions,
        ROUND(subs - reds) AS net_flow,
        ROUND(aum - LAG(aum) OVER (ORDER BY bucket) - (subs - reds)) AS market_effect
      FROM buckets ORDER BY bucket`,
    params: range(from, to),
  };
};

// Revenue trend: same calculation as Revenue (PWC), so the numbers match that
// tab. revenueCTEs rebuilds daily fees from portfolio_with_code AUM x latest
// management fee, with the same day/week/month buckets (granularityPart).
// revenue = AperD share. The first and last bucket can be partial when the
// date range cuts through them; the days effect below picks that up.
//
// Root cause columns: revenue = days x avg AUM x daily rate, where
// rate = revenue / (days x avg AUM). Change vs the previous bucket splits
// exactly into days effect (more/fewer days), AUM effect (avg AUM moved, at
// the old rate) and rate effect (fee rate and fund mix, the remainder).
// All three are NULL on the first row (no prior bucket to diff against).
const revenueTrend = (from, to, granularity = 'month') => {
  const { cte, params } = revenueCTEs(from, to, granularity);
  const part = granularityPart(granularity);
  const fmt = granularity === 'month' ? '%Y-%m' : '%Y-%m-%d';
  return {
    sql: `${cte},
      b AS (SELECT period, SUM(total_aperd_share) AS revenue FROM period_fund GROUP BY period),
      p AS (
        SELECT DATE_TRUNC(created_date, ${part}) AS period, COUNT(*) AS days, AVG(platform_aum) AS avg_aum
        FROM (SELECT created_date, SUM(aum) AS platform_aum FROM daily_detail GROUP BY created_date)
        GROUP BY period
      ),
      j AS (
        SELECT period, revenue, days, avg_aum, SAFE_DIVIDE(revenue, days * avg_aum) AS r
        FROM b JOIN p USING (period)
      ),
      l AS (
        SELECT *, LAG(revenue) OVER w AS rev0, LAG(days) OVER w AS d0, LAG(avg_aum) OVER w AS a0, LAG(r) OVER w AS r0
        FROM j WINDOW w AS (ORDER BY period)
      )
      SELECT FORMAT_DATE('${fmt}', period) AS bucket, ROUND(revenue) AS revenue, days, ROUND(avg_aum) AS avg_aum,
        ROUND(SAFE_DIVIDE(revenue - rev0, rev0) * 100, 1) AS change_pct,
        ROUND((days - d0) * a0 * r0) AS days_effect,
        ROUND(days * (avg_aum - a0) * r0) AS aum_effect,
        ROUND(revenue - rev0 - (days - d0) * a0 * r0 - days * (avg_aum - a0) * r0) AS rate_effect
      FROM l ORDER BY period`,
    params,
  };
};

// Per-fund version of the same split for one bucket (period = the bucket's
// first day) against the bucket before it. A fund missing from either bucket
// (new or gone) has no rate to compare, so its effects are NULL and only the
// revenue change is shown.
const revenueTrendDrill = (from, to, granularity = 'month', period = '') => {
  const { cte, params } = revenueCTEs(from, to, granularity);
  return {
    sql: `${cte},
      periods AS (SELECT period, LAG(period) OVER (ORDER BY period) AS prev FROM (SELECT DISTINCT period FROM period_fund)),
      tgt AS (SELECT period, prev FROM periods WHERE period = DATE(@period)),
      c AS (SELECT pf.* FROM period_fund pf JOIN tgt ON pf.period = tgt.period),
      o AS (SELECT pf.* FROM period_fund pf JOIN tgt ON pf.period = tgt.prev),
      j AS (
        SELECT COALESCE(c.fund_name, o.fund_name) AS fund, COALESCE(c.mi_name, o.mi_name) AS manager,
          IFNULL(o.total_aperd_share, 0) AS rev0, IFNULL(c.total_aperd_share, 0) AS rev1,
          c.days_running AS d1, o.days_running AS d0, c.avg_aum AS a1, o.avg_aum AS a0,
          SAFE_DIVIDE(c.total_aperd_share, c.days_running * c.avg_aum) AS r1,
          SAFE_DIVIDE(o.total_aperd_share, o.days_running * o.avg_aum) AS r0
        FROM c FULL JOIN o USING (fund_id)
      )
      SELECT fund, manager, ROUND(rev0) AS revenue_prev, ROUND(rev1) AS revenue_cur, ROUND(rev1 - rev0) AS change,
        ROUND((d1 - d0) * a0 * r0) AS days_effect,
        ROUND(d1 * (a1 - a0) * r0) AS aum_effect,
        ROUND(rev1 - rev0 - (d1 - d0) * a0 * r0 - d1 * (a1 - a0) * r0) AS rate_effect
      FROM j ORDER BY ABS(rev1 - rev0) DESC`,
    params: { ...params, period },
  };
};

// Per-fund breakdown of one AUM history period: which funds moved, and how
// much of each fund's move was money in/out vs market. start/end = the
// period's first/last day (the caller clips end to the page's "to" date so
// it matches the AUM history row). Diffs the last mi_fee day in the period
// against the last one before it — same end-of-period rule as aumHistory.
const aumHistoryDrill = (start, end) => ({
  sql: `WITH bounds AS (
      SELECT
        (SELECT MAX(DATE(created_at)) FROM ${MIFEE} WHERE DATE(created_at) < @start) AS prev_end,
        (SELECT MAX(DATE(created_at)) FROM ${MIFEE} WHERE DATE(created_at) BETWEEN @start AND @end) AS cur_end
    ),
    aum AS (
      SELECT m.fund_id,
        SUM(IF(DATE(m.created_at) = b.prev_end, m.AUM, 0)) AS aum_start,
        SUM(IF(DATE(m.created_at) = b.cur_end, m.AUM, 0)) AS aum_end
      FROM ${MIFEE} m CROSS JOIN bounds b
      WHERE DATE(m.created_at) IN (b.prev_end, b.cur_end)
      GROUP BY m.fund_id
    ),
    flows AS (
      SELECT t.fund_id,
        SUM(IF(t.type = 'buy', t.final_amount, 0)) AS subs,
        SUM(IF(t.type = 'sell', t.final_amount, 0)) AS reds,
        SUM(CASE t.type WHEN 'SWITCH_IN' THEN t.final_amount WHEN 'SWITCH_OUT' THEN -t.final_amount ELSE 0 END) AS switch_net
      FROM ${TX} t CROSS JOIN bounds b
      WHERE t.status = 'completed' AND t.type IN ('buy', 'sell', 'SWITCH_IN', 'SWITCH_OUT')
        AND ${AUM_FLOW_DATE} > b.prev_end AND ${AUM_FLOW_DATE} <= b.cur_end
      GROUP BY t.fund_id
    ),
    joined AS (
      SELECT f.name AS fund, COALESCE(im.common_name, im.name) AS manager,
        IFNULL(a.aum_start, 0) AS aum_start, IFNULL(a.aum_end, 0) AS aum_end,
        IFNULL(fl.subs, 0) AS subs, IFNULL(fl.reds, 0) AS reds, IFNULL(fl.switch_net, 0) AS switch_net
      FROM ${FUNDS} f
      LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
      LEFT JOIN aum a ON a.fund_id = f.id
      LEFT JOIN flows fl ON fl.fund_id = f.id
      WHERE f.listing_status = 'ACTIVE' AND (a.fund_id IS NOT NULL OR fl.fund_id IS NOT NULL)
    )
    SELECT fund, manager,
      ROUND(aum_start) AS aum_start, ROUND(aum_end) AS aum_end,
      ROUND(aum_end - aum_start) AS aum_change,
      ROUND(subs) AS subscriptions, ROUND(reds) AS redemptions, ROUND(switch_net) AS switch_net,
      ROUND(aum_end - aum_start - (subs - reds + switch_net)) AS market_effect
    FROM joined
    WHERE aum_end != aum_start OR subs != 0 OR reds != 0 OR switch_net != 0
    ORDER BY ABS(aum_end - aum_start) DESC`,
  params: { start, end },
});

// ---- Product performance (NAV per fund, from native BigQuery tables) -------
// snapshots.value is daily NAV per fund. % change per period = (latest NAV -
// NAV as-of period start) / NAV as-of period start, averaged per fund type.
const SNAPSHOTS = '`sayakaya.main.snapshots`';
const NAV_SOURCE = `
    SELECT s.product_id, f.name, f.type, s.value, DATE(s.created_at) AS d
    FROM ${SNAPSHOTS} s
    LEFT JOIN ${FUNDS} f
      ON s.product_id = f.id
    WHERE s.type = 'NAV' AND f.listing_status = 'ACTIVE'`;

// Shared period list for every "% change vs N periods ago" report: 1D/1W/1M/3M/YTD/1Y/3Y/5Y.
// Targets are computed relative to each entity's own *latest available* date
// (not today) — if a fund's freshest NAV is from 2 days ago, "1D" compares
// that NAV to the NAV as-of (latest - 1 day), nearest available on or before.
function periodTargets(latestDateExpr) {
  return `[
        STRUCT('1D' AS period, 1 AS ord, DATE_SUB(${latestDateExpr}, INTERVAL 1 DAY) AS target),
        STRUCT('1W', 2, DATE_SUB(${latestDateExpr}, INTERVAL 1 WEEK)),
        STRUCT('1M', 3, DATE_SUB(${latestDateExpr}, INTERVAL 1 MONTH)),
        STRUCT('3M', 4, DATE_SUB(${latestDateExpr}, INTERVAL 3 MONTH)),
        STRUCT('YTD', 5, DATE_TRUNC(${latestDateExpr}, YEAR)),
        STRUCT('1Y', 6, DATE_SUB(${latestDateExpr}, INTERVAL 1 YEAR)),
        STRUCT('3Y', 7, DATE_SUB(${latestDateExpr}, INTERVAL 3 YEAR)),
        STRUCT('5Y', 8, DATE_SUB(${latestDateExpr}, INTERVAL 5 YEAR)),
        STRUCT('10Y', 9, DATE_SUB(${latestDateExpr}, INTERVAL 10 YEAR))
      ]`;
}

const productPerformance = () => ({
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
// asOfDate (optional, YYYY-MM-DD): caps "latest" at the most recent NAV on
// or before this date instead of the true latest — lets a caller pin the
// report to a specific NAV date (e.g. to confirm/override before exporting)
// rather than always floating to whatever published today.
const productPerformanceDetail = (asOfDate) => ({
  sql: `WITH nav AS (${NAV_SOURCE}),
    latest AS (
      SELECT product_id, ANY_VALUE(name) AS name, ANY_VALUE(type) AS type,
        ARRAY_AGG(STRUCT(value AS v, d AS d) ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS latest_snap
      FROM nav WHERE type IS NOT NULL ${asOfDate ? 'AND d <= @asOfDate' : ''} GROUP BY product_id
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
    SELECT s.product_id AS fund_id, s.type, s.name, s.period, s.ord,
      ROUND(SAFE_DIVIDE(s.latest_snap.v - s.asof_snap.v, s.asof_snap.v) * 100, 2) AS pct_change,
      s.latest_snap.v AS latest_nav, s.asof_snap.v AS base_nav, s.latest_snap.d AS latest_nav_date,
      f.ipo_date
    FROM snaps s
    LEFT JOIN ${FUNDS} f ON f.id = s.product_id
    WHERE s.asof_snap IS NOT NULL
    ORDER BY s.type, s.name, s.ord`,
  params: asOfDate ? { asOfDate } : {},
});

// All active, AUM-bearing funds — powers the fund-picker checkboxes on the
// Performance trend chart.
const fundList = (type) => {
  const params = {};
  let typeFilter = '';
  if (type) { typeFilter = 'AND type = @type'; params.type = type; }
  return {
    sql: `SELECT id, name, type FROM ${FUNDS}
      WHERE listing_status = 'ACTIVE' AND latest_aum_value IS NOT NULL ${typeFilter}
      ORDER BY latest_aum_value DESC`,
    params,
  };
};

// Daily NAV trend for the Performance tab's top chart, over one of the shared
// PERF_PERIODS windows above. Anchored to the platform's latest available NAV
// date overall (not each fund's own), so every line shares one x-axis end point.
// Two modes:
//   - `funds` given (checkbox picks): chart exactly those funds, no ranking.
//   - `funds` omitted: rank all candidates (optionally scoped by `type`) by
//     their own % change over the period and chart the top `limit` performers
//     — "best performing", not "biggest by AUM".
function fundNavTrend({ type, period = '1Y', limit = 5, funds } = {}) {
  const params = { period };
  let typeFilter = '';
  if (type) { typeFilter = 'AND f.type = @type'; params.type = type; }

  const fundNames = (Array.isArray(funds) ? funds : funds ? [funds] : []).filter(Boolean);
  let chosenCte;
  if (fundNames.length) {
    params.funds = fundNames;
    chosenCte = `SELECT id AS product_id, name FROM ${FUNDS} WHERE name IN UNNEST(@funds)`;
  } else {
    params.limit = parseInt(limit, 10);
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

// Investor search box (Portfolio tabs, both Send tabs): SID, name, email, or
// phone. `*` is a wildcard ("budi*santoso"); otherwise a contains-match.
// Phones are stored as 62xxxxxxxxx digits, so a digits-only query drops a
// leading 0/62 first: 0812…, +62 812… and 812… all find the same number.
const userSearch = (q) => {
  const s = String(q || '').trim().toLowerCase();
  const params = { q: `%${s.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%')}%` };
  const digits = s.replace(/[\s+\-().]/g, '');
  if (/^\d{5,}$/.test(digits)) params.phone = `%${digits.replace(/^(62|0)/, '')}%`;
  return {
    sql: `SELECT u.id AS user_id, u.sid_code AS sid, u.ifua_code AS ifua,
        up.name, u.email, up.phone_number AS phone
      FROM ${USERS} u
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      WHERE LOWER(u.sid_code) LIKE @q OR LOWER(up.name) LIKE @q OR LOWER(u.email) LIKE @q
        ${params.phone ? "OR REGEXP_REPLACE(up.phone_number, r'\\D', '') LIKE @phone" : ''}
      ORDER BY u.sid_code LIMIT 20`,
    params,
  };
};

// Exact-match resolver for batch sends: each entry in `identifiers` is either
// a SID code or an email, matched case-insensitively. Deliberately not a LIKE
// search like userSearch() above — a pasted list must resolve deterministically,
// not fuzzy-match into the wrong investor.
const usersByIdentifiers = (identifiers) => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, u.email
    FROM ${USERS} u
    WHERE LOWER(u.sid_code) IN UNNEST(@ids) OR LOWER(u.email) IN UNNEST(@ids)`,
  params: { ids: (identifiers || []).map((s) => String(s).trim().toLowerCase()) },
});

// Contact card for the PDF export header — fetched server-side by userId so
// the report shows authoritative data, not whatever the client last selected.
const userContact = (userId) => ({
  sql: `SELECT u.sid_code AS sid, u.ifua_code AS ifua, u.email, up.name, up.phone_number AS phone, up.birthdate,
      u.referrer_code, u.sales_code,
      COALESCE(up.correspondence_address, up.id_address) AS address
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE u.id = @userId
    LIMIT 1`,
  params: { userId },
});

// Same as userContact but for a whole batch of investors in one round-trip —
// used by bulk export/preview instead of one userContact call per investor.
const userContactBatch = (userIds) => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, u.ifua_code AS ifua, u.email, up.name, up.phone_number AS phone, up.birthdate,
      u.referrer_code, u.sales_code,
      COALESCE(up.correspondence_address, up.id_address) AS address
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE u.id IN UNNEST(@userIds)`,
  params: { userIds },
});

// One investor's transactions within a date range, for the monthly e-statement
// PDF (server/pdf.js transactionStatement) — fund name resolved here since
// main.transactions only carries fund_id. Restricted to settled/successful
// statuses — same set as the referral eligibility report's "did they buy"
// check — so an expired/cancelled/pending_payment attempt never shows up on
// an investor's official statement.
const userTransactions = (userId, from, to) => ({
  sql: `SELECT t.created_at, t.type, t.status, f.name AS fund, t.unit, t.amount, t.final_amount
    FROM ${TX} t
    LEFT JOIN ${FUNDS} f ON f.id = t.fund_id
    WHERE t.user_id = @userId AND DATE(t.created_at) BETWEEN @from AND @to
      AND t.status IN ('completed', 'verified', 'completed_payment')
    ORDER BY t.created_at`,
  params: { userId, from, to },
});

// Current holdings for one user, one row per fund — regular + bonus units are
// combined (the investor doesn't care which bucket a unit came from). Live
// value at the fund's latest NAV, same "active holdings" definition as the
// AUM KPI. avg_buy_price is unit-weighted across the buy price carried on the
// portfolio rows themselves (portfolios.initial_price / bonus_portfolios.average_nav),
// so it exists even for holdings with no completed buy transaction (transfers, bonus).
const userHoldings = (userId) => ({
  sql: `WITH holdings AS (
      SELECT fund_id, SUM(unit) AS unit, SAFE_DIVIDE(SUM(unit * price), SUM(unit)) AS avg_buy_price, MIN(created_at) AS opened_at
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

// Batched per-recipient recap for a schedule's queue detail view: for each
// user, whether they currently hold any portfolio units (same "active
// holdings" definition as userHoldings — regular + bonus, unit > 0/on_going)
// and whether they transacted within [from, to] (the schedule's e-statement
// month) — one query for the whole recipient list instead of one per row.
const scheduleRecipientRecap = (userIds, from, to) => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, up.name,
      (EXISTS (SELECT 1 FROM ${PORT} p WHERE p.deleted_at IS NULL AND p.unit > 0 AND p.user_id = u.id)
        OR EXISTS (SELECT 1 FROM ${BONUS_PORT} bp WHERE bp.status = 'on_going' AND bp.user_id = u.id)) AS has_portfolio,
      EXISTS (SELECT 1 FROM ${TX} t WHERE t.user_id = u.id AND DATE(t.created_at) BETWEEN @from AND @to) AS had_transaction_last_month
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE u.id IN UNNEST(@userIds)`,
  params: { userIds: userIds || [], from, to },
});

// Same shape as userHoldings() above, but avg_buy_price is derived from the
// real transaction ledger instead of portfolios.initial_price (which can
// silently drift from the actual buy price — see the IDD031084165546 case).
// Weighted-average cost method: only "incoming" transaction types set the
// average (buy, SWITCH_IN, reinvestment, transfer_in); sells/switch-outs/
// transfers-out/liquidation/unit_adjustment reduce units only and never move
// the average. Bonus units have no transaction trail, so they keep using
// bonus_portfolios.average_nav, same as userHoldings().
const userHoldingsFromTx = (userId) => ({
  sql: `WITH incoming_tx AS (
      -- unit is FLOAT64 on transactions (unlike portfolios/bonus_portfolios,
      -- which are NUMERIC) — cast so the weighted average below is computed
      -- in exact decimal arithmetic, same as every other portfolio query,
      -- instead of picking up FLOAT64 binary-representation noise.
      SELECT fund_id, CAST(unit AS NUMERIC) AS unit, value_per_unit
      FROM ${TX}
      WHERE user_id = @userId
        AND type IN ('buy', 'SWITCH_IN', 'reinvestment', 'transfer_in')
        AND status NOT IN ('expired', 'cancelled')
    ),
    regular_avg AS (
      SELECT fund_id, SAFE_DIVIDE(SUM(unit * value_per_unit), SUM(unit)) AS avg_price
      FROM incoming_tx
      GROUP BY fund_id
    ),
    regular_current AS (
      SELECT fund_id, SUM(unit) AS unit, MIN(created_at) AS opened_at
      FROM ${PORT}
      WHERE deleted_at IS NULL AND unit > 0 AND user_id = @userId
      GROUP BY fund_id
    ),
    holdings AS (
      SELECT rc.fund_id, rc.unit, ra.avg_price AS avg_buy_price, rc.opened_at
      FROM regular_current rc
      LEFT JOIN regular_avg ra ON ra.fund_id = rc.fund_id
      UNION ALL
      SELECT bp.fund_id, bp.unit, bp.average_nav AS avg_buy_price, bp.created_at AS opened_at
      FROM ${BONUS_PORT} bp
      WHERE bp.status = 'on_going' AND bp.user_id = @userId
    ),
    merged AS (
      SELECT fund_id, SUM(unit) AS unit,
        SAFE_DIVIDE(SUM(unit * avg_buy_price), SUM(unit)) AS avg_buy_price,
        MIN(opened_at) AS opened_at
      FROM holdings
      GROUP BY fund_id
    )
    SELECT *, value - fund_value AS gain_loss,
      SAFE_DIVIDE(value - fund_value, fund_value) * 100 AS gain_pct
    FROM (
      SELECT f.name AS fund, f.type AS fund_type, m.unit, m.avg_buy_price,
        f.latest_nav_value AS nav, f.latest_nav_date AS nav_date,
        ROUND(m.unit * m.avg_buy_price) AS fund_value,
        ROUND(m.unit * f.latest_nav_value) AS value,
        m.opened_at
      FROM merged m
      JOIN ${FUNDS} f ON f.id = m.fund_id
    )
    ORDER BY value DESC`,
  params: { userId },
});

// Same as userHoldingsFromTx() above, but every transaction after @date is
// ignored — both for setting the average (incoming) and for netting the
// current unit count (incoming - outgoing), so this reconstructs exactly
// what userHoldingsFromTx would have shown had it been run on that day.
// Historical NAV comes from sayakaya.main.snapshots (same canonical source
// used by userHoldingsAsOf/goalUserHoldings), falling back to the fund's
// live NAV if that date has no snapshot. Bonus units are NOT included here —
// bonus_portfolios has no history at all, so there is no correct "as of a
// past date" bonus figure to show; the live view (userHoldingsFromTx) is the
// only place bonus holdings appear. net_unit is compared against a small
// epsilon rather than > 0, since a fund fully switched/sold out historically
// can net to a tiny nonzero float (e.g. 1e-9) instead of exactly 0.
const userHoldingsFromTxAsOf = (userId, date) => ({
  sql: `WITH incoming_tx AS (
      -- unit is FLOAT64 on transactions (unlike portfolios/bonus_portfolios,
      -- which are NUMERIC) — cast so unit and the weighted average below are
      -- computed in exact decimal arithmetic, same as every other portfolio
      -- query, instead of picking up FLOAT64 binary-representation noise.
      SELECT fund_id, CAST(unit AS NUMERIC) AS unit, value_per_unit, created_at
      FROM ${TX}
      WHERE user_id = @userId
        AND type IN ('buy', 'SWITCH_IN', 'reinvestment', 'transfer_in')
        AND status NOT IN ('expired', 'cancelled')
        AND DATE(created_at) <= @date
    ),
    outgoing_tx AS (
      SELECT fund_id, CAST(unit AS NUMERIC) AS unit
      FROM ${TX}
      WHERE user_id = @userId
        AND type IN ('sell', 'SWITCH_OUT', 'transfer_out', 'liquidation', 'unit_adjustment')
        AND status NOT IN ('expired', 'cancelled')
        AND DATE(created_at) <= @date
    ),
    regular_avg AS (
      SELECT fund_id, SAFE_DIVIDE(SUM(unit * value_per_unit), SUM(unit)) AS avg_price, MIN(created_at) AS opened_at
      FROM incoming_tx
      GROUP BY fund_id
    ),
    regular_net_all AS (
      SELECT fund_id, SUM(unit) AS net_unit
      FROM (
        SELECT fund_id, unit FROM incoming_tx
        UNION ALL
        SELECT fund_id, -unit FROM outgoing_tx
      )
      GROUP BY fund_id
    ),
    merged AS (
      SELECT rn.fund_id, rn.net_unit AS unit, ra.avg_price AS avg_buy_price, ra.opened_at
      FROM regular_net_all rn
      JOIN regular_avg ra ON ra.fund_id = rn.fund_id
      WHERE rn.net_unit > 0.0001
    ),
    canon_nav AS (
      SELECT product_id AS fund_id, value AS nav
      FROM ${SNAPSHOTS}
      WHERE type = 'NAV' AND DATE(created_at) = @date
    )
    SELECT *, value - fund_value AS gain_loss,
      SAFE_DIVIDE(value - fund_value, fund_value) * 100 AS gain_pct
    FROM (
      SELECT f.name AS fund, f.type AS fund_type, m.unit, m.avg_buy_price,
        COALESCE(cn.nav, f.latest_nav_value) AS nav, @date AS nav_date,
        ROUND(m.unit * m.avg_buy_price) AS fund_value,
        ROUND(m.unit * COALESCE(cn.nav, f.latest_nav_value)) AS value,
        m.opened_at
      FROM merged m
      JOIN ${FUNDS} f ON f.id = m.fund_id
      LEFT JOIN canon_nav cn ON cn.fund_id = m.fund_id
    )
    ORDER BY value DESC`,
  params: { userId, date },
});

// Regular vs bonus AUM split for the dashboard KPIs only — the per-fund
// holdings table/exports stay merged; this is purely for the breakdown card.
const userPortfolioSplit = (userId) => ({
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

// ---- Portfolio Explorer: goal_snapshots-based, point-in-time holdings -----
// goal_snapshots is a daily per-goal-per-fund valuation table (goal_id,
// fund_id, nav, unit, amount, date); it has no user_id or buy-price column,
// so every query here joins through goals for user_id and treats each
// (goal, fund) pair's earliest ever snapshot nav as the buy price (there's
// no real cost-basis column, same idea as portfolios.initial_price).
const GOALS = '`sayakaya.main.goals`';
const GOAL_SNAPSHOTS = '`sayakaya.main.goal_snapshots`';

// Latest snapshot date available for this user — used to default the date
// picker when the caller hasn't picked one yet.
const goalLatestSnapshotDate = (userId) => ({
  sql: `SELECT MAX(gs.date) AS latest_date
    FROM ${GOAL_SNAPSHOTS} gs JOIN ${GOALS} g ON g.id = gs.goal_id
    WHERE g.user_id = @userId AND g.deleted_at IS NULL`,
  params: { userId },
});

// Holdings on a given date, merged across all of a user's goals — same row
// shape as userHoldings() so it can feed the same PDF/table renderers.
// Requires an exact snapshot row for that date per (goal, fund): the daily
// job stops writing rows once a fund is fully redeemed rather than writing a
// zero-unit row, so carrying forward the last snapshot before the date would
// wrongly keep showing redeemed funds — no row on the date means no holding
// that day. "Value" uses the snapshot's own nav (the NAV in effect on that
// date), not the fund's live NAV, since this is a historical point-in-time view.
const goalUserHoldings = (userId, asOfDate) => ({
  sql: `WITH first_nav AS (
      SELECT goal_id, fund_id,
        ARRAY_AGG(STRUCT(nav AS nav, date AS date) ORDER BY date ASC LIMIT 1)[OFFSET(0)] AS first_snap
      FROM ${GOAL_SNAPSHOTS}
      GROUP BY goal_id, fund_id
    ),
    ranked AS (
      SELECT gs.goal_id, gs.fund_id, gs.unit, gs.nav, gs.date,
        ROW_NUMBER() OVER (PARTITION BY gs.goal_id, gs.fund_id ORDER BY gs.created_at DESC) AS rn
      FROM ${GOAL_SNAPSHOTS} gs
      JOIN ${GOALS} g ON g.id = gs.goal_id
      WHERE g.user_id = @userId AND g.deleted_at IS NULL AND gs.date = @asOfDate
    ),
    latest AS (
      SELECT r.goal_id, r.fund_id, r.unit, r.nav, r.date AS nav_date,
        fn.first_snap.nav AS buy_nav, fn.first_snap.date AS opened_at
      FROM ranked r JOIN first_nav fn ON fn.goal_id = r.goal_id AND fn.fund_id = r.fund_id
      WHERE r.rn = 1 AND r.unit > 0
    ),
    -- Canonical daily fund NAV (sayakaya.main.snapshots, same source as Product
    -- Performance) — goal_snapshots.nav is written per goal and can lag a day
    -- if that particular snapshot row didn't refresh, so the close NAV is read
    -- from the fund-level daily source instead of averaged from each goal's
    -- own row. Falls back to the old goal_snapshots-derived average if a fund
    -- has no canonical snapshot for this date.
    canon_nav AS (
      SELECT product_id AS fund_id, value AS nav
      FROM ${SNAPSHOTS}
      WHERE type = 'NAV' AND DATE(created_at) = @asOfDate
    ),
    -- Cost basis: goal_snapshots has no real cost-basis column, so this query
    -- approximates it as the earliest snapshot's nav (buy_nav below). That's
    -- an approximation, not the true weighted-average buy price — the same
    -- user's row in portfolio_with_code carries the real one (computed from
    -- actual buy transactions), so it's preferred here when available.
    pwc_buy AS (
      SELECT fund_id, avg_buy_price FROM (
        SELECT pwc.id AS fund_id, pwc.avg_buy_price,
          ROW_NUMBER() OVER (PARTITION BY pwc.id ORDER BY pwc.created_at DESC) AS rn
        FROM ${PORT_WITH_CODE} pwc
        JOIN ${USERS} u ON u.sid_code = pwc.sid_code
        WHERE u.id = @userId
      ) WHERE rn = 1
    ),
    holdings AS (
      SELECT fund_id, SUM(unit) AS unit,
        SAFE_DIVIDE(SUM(unit * buy_nav), SUM(unit)) AS fallback_avg_buy_price,
        SAFE_DIVIDE(SUM(unit * nav), SUM(unit)) AS fallback_nav,
        MAX(nav_date) AS nav_date, MIN(opened_at) AS opened_at
      FROM latest
      GROUP BY fund_id
    )
    SELECT *, value - fund_value AS gain_loss,
      SAFE_DIVIDE(value - fund_value, fund_value) * 100 AS gain_pct
    FROM (
      SELECT f.name AS fund, f.type AS fund_type, h.unit,
        COALESCE(pb.avg_buy_price, h.fallback_avg_buy_price) AS avg_buy_price,
        COALESCE(cn.nav, h.fallback_nav) AS nav, h.nav_date, h.opened_at,
        ROUND(h.unit * COALESCE(pb.avg_buy_price, h.fallback_avg_buy_price)) AS fund_value,
        ROUND(h.unit * COALESCE(cn.nav, h.fallback_nav)) AS value
      FROM holdings h
      JOIN ${FUNDS} f ON f.id = h.fund_id
      LEFT JOIN canon_nav cn ON cn.fund_id = h.fund_id
      LEFT JOIN pwc_buy pb ON pb.fund_id = h.fund_id
    )
    ORDER BY value DESC`,
  params: { userId, asOfDate },
});

// Same computation as goalUserHoldings, but broken out per goal (one row per
// goal+fund, with the goal's name) for the Portfolio Explorer preview's "by
// goal" section. Never used for export — export always stays merged.
const goalUserHoldingsByGoal = (userId, asOfDate) => ({
  sql: `WITH first_nav AS (
      SELECT goal_id, fund_id,
        ARRAY_AGG(STRUCT(nav AS nav, date AS date) ORDER BY date ASC LIMIT 1)[OFFSET(0)] AS first_snap
      FROM ${GOAL_SNAPSHOTS}
      GROUP BY goal_id, fund_id
    ),
    ranked AS (
      SELECT gs.goal_id, gs.fund_id, gs.unit, gs.nav, gs.date,
        ROW_NUMBER() OVER (PARTITION BY gs.goal_id, gs.fund_id ORDER BY gs.created_at DESC) AS rn
      FROM ${GOAL_SNAPSHOTS} gs
      JOIN ${GOALS} g ON g.id = gs.goal_id
      WHERE g.user_id = @userId AND g.deleted_at IS NULL AND gs.date = @asOfDate
    ),
    latest AS (
      SELECT r.goal_id, r.fund_id, r.unit, r.nav, r.date AS nav_date, fn.first_snap.nav AS buy_nav
      FROM ranked r JOIN first_nav fn ON fn.goal_id = r.goal_id AND fn.fund_id = r.fund_id
      WHERE r.rn = 1 AND r.unit > 0
    ),
    -- Same canonical-NAV fix as goalUserHoldings above — see its comment.
    canon_nav AS (
      SELECT product_id AS fund_id, value AS nav
      FROM ${SNAPSHOTS}
      WHERE type = 'NAV' AND DATE(created_at) = @asOfDate
    ),
    -- Same cost-basis fix as goalUserHoldings above — see its comment.
    pwc_buy AS (
      SELECT fund_id, avg_buy_price FROM (
        SELECT pwc.id AS fund_id, pwc.avg_buy_price,
          ROW_NUMBER() OVER (PARTITION BY pwc.id ORDER BY pwc.created_at DESC) AS rn
        FROM ${PORT_WITH_CODE} pwc
        JOIN ${USERS} u ON u.sid_code = pwc.sid_code
        WHERE u.id = @userId
      ) WHERE rn = 1
    )
    SELECT g.name AS goal, f.name AS fund, f.type AS fund_type,
      l.unit, COALESCE(pb.avg_buy_price, l.buy_nav) AS avg_buy_price,
      COALESCE(cn.nav, l.nav) AS nav, l.nav_date,
      ROUND(l.unit * COALESCE(pb.avg_buy_price, l.buy_nav)) AS fund_value,
      ROUND(l.unit * COALESCE(cn.nav, l.nav)) AS value,
      ROUND(l.unit * COALESCE(cn.nav, l.nav)) - ROUND(l.unit * COALESCE(pb.avg_buy_price, l.buy_nav)) AS gain_loss,
      SAFE_DIVIDE(ROUND(l.unit * COALESCE(cn.nav, l.nav)) - ROUND(l.unit * COALESCE(pb.avg_buy_price, l.buy_nav)), ROUND(l.unit * COALESCE(pb.avg_buy_price, l.buy_nav))) * 100 AS gain_pct
    FROM latest l
    JOIN ${GOALS} g ON g.id = l.goal_id
    JOIN ${FUNDS} f ON f.id = l.fund_id
    LEFT JOIN canon_nav cn ON cn.fund_id = l.fund_id
    LEFT JOIN pwc_buy pb ON pb.fund_id = l.fund_id
    ORDER BY g.name, value DESC`,
  params: { userId, asOfDate },
});

// AUM performance for one user (by SID code), summed across their funds per
// day from portfolio_with_code (one row per sid_code+fund per day; `amount`
// is that holding's value on that day).
const PORT_WITH_CODE = '`sayakaya.mi_fee_logs.portfolio_with_code`';

// Daily total AUM time series for one user — for the AUM-over-time chart.
const userAumHistory = (sid) => ({
  sql: `SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS bucket, SUM(amount) AS amount
    FROM ${PORT_WITH_CODE}
    WHERE sid_code = @sid
    GROUP BY bucket ORDER BY bucket`,
  params: { sid },
});

// Most recent completed transactions for one investor — powers the "latest
// activity" line on their Portfolio (PWC) lookup, a live fact rather than a
// static claim.
const userRecentTransactions = (userId, limit = 8) => ({
  sql: `SELECT t.type, t.final_amount, t.completed_at, f.name AS fund
    FROM ${TX} t
    LEFT JOIN ${FUNDS} f ON f.id = t.fund_id
    WHERE t.user_id = @userId AND t.status = 'completed'
    ORDER BY t.completed_at DESC
    LIMIT @limit`,
  params: { userId, limit },
});

const userPerformance = (sid) => ({
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

// Latest date with a portfolio_with_code snapshot for this SID — default for
// the "as of" date picker below, and the "latest available" comparison line.
// created_at's date is a day ahead of the AUM date it represents (same
// correction as revenueCTEs/remisierRevenuePwcCTEs elsewhere in this file).
const userHoldingsLatestDate = (sid) => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_WITH_CODE} WHERE sid_code = @sid`,
  params: { sid },
});

// Holdings on a specific date, from portfolio_with_code's daily
// per-user-per-fund snapshot — same row shape as userHoldings() so it feeds
// the same PDF/table renderers. Unlike userHoldings() (current units x
// today's live NAV), this shows what was actually held and valued as of that
// date; regular/bonus split isn't available here (portfolio_with_code
// doesn't distinguish the two), so the caller skips userPortfolioSplit.
// created_at's date is a day ahead of the AUM date it represents, so the
// -1 day correction still picks the row that holds the right units for
// @date — but that row's own latest_nav_value can itself be a stale
// duplicate of the prior day's batch (portfolio_with_code's own pipeline
// glitch, not a dating error), so the close NAV is read from
// sayakaya.main.snapshots (the same canonical daily source used for the
// goal_snapshots side and for Product Performance) keyed directly on @date —
// no day-shift needed there since that table's dates are already correct.
const userHoldingsAsOf = (sid, date) => ({
  sql: `WITH pwc AS (
      SELECT id AS fund_id, fund, fund_type, total_unit AS unit, avg_buy_price,
        buy_amount, latest_nav_value,
        DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS nav_date
      FROM ${PORT_WITH_CODE}
      WHERE sid_code = @sid AND DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date AND total_unit > 0
    ),
    canon_nav AS (
      SELECT product_id AS fund_id, value AS nav
      FROM ${SNAPSHOTS}
      WHERE type = 'NAV' AND DATE(created_at) = @date
    )
    SELECT p.fund, p.fund_type, p.unit, p.avg_buy_price,
      COALESCE(cn.nav, p.latest_nav_value) AS nav, p.nav_date,
      ROUND(p.buy_amount) AS fund_value,
      ROUND(p.unit * COALESCE(cn.nav, p.latest_nav_value)) AS value,
      ROUND(p.unit * COALESCE(cn.nav, p.latest_nav_value)) - ROUND(p.buy_amount) AS gain_loss,
      SAFE_DIVIDE(ROUND(p.unit * COALESCE(cn.nav, p.latest_nav_value)) - ROUND(p.buy_amount), ROUND(p.buy_amount)) * 100 AS gain_pct
    FROM pwc p
    LEFT JOIN canon_nav cn ON cn.fund_id = p.fund_id
    ORDER BY value DESC`,
  params: { sid, date },
});

// ---- Portfolio (Fix): same as the PWC block above, but sourced from
// portfolio_fix — a corrected daily snapshot (same schema as
// portfolio_with_code) whose scheduled query weights avg_buy_price/buy_amount
// by unit instead of taking a plain AVG(price) across lots. Kept as a
// separate table/section rather than replacing PWC in place, so the two can
// be compared until portfolio_with_code's own pipeline is fixed.
const PORT_FIX = '`sayakaya.mi_fee_logs.portfolio_fix`';

const userAumHistoryFix = (sid) => ({
  sql: `SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS bucket, SUM(amount) AS amount
    FROM ${PORT_FIX}
    WHERE sid_code = @sid
    GROUP BY bucket ORDER BY bucket`,
  params: { sid },
});

const userPerformanceFix = (sid) => ({
  sql: `WITH daily AS (
      SELECT DATE(created_at) AS d, SUM(amount) AS amount
      FROM ${PORT_FIX}
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

const userHoldingsLatestDateFix = (sid) => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_FIX} WHERE sid_code = @sid`,
  params: { sid },
});

const userHoldingsAsOfFix = (sid, date) => ({
  sql: `WITH pwc AS (
      SELECT id AS fund_id, fund, fund_type, total_unit AS unit, avg_buy_price,
        buy_amount, latest_nav_value,
        DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS nav_date
      FROM ${PORT_FIX}
      WHERE sid_code = @sid AND DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date AND total_unit > 0
    ),
    canon_nav AS (
      SELECT product_id AS fund_id, value AS nav
      FROM ${SNAPSHOTS}
      WHERE type = 'NAV' AND DATE(created_at) = @date
    )
    SELECT p.fund, p.fund_type, p.unit, p.avg_buy_price,
      COALESCE(cn.nav, p.latest_nav_value) AS nav, p.nav_date,
      ROUND(p.buy_amount) AS fund_value,
      ROUND(p.unit * COALESCE(cn.nav, p.latest_nav_value)) AS value,
      ROUND(p.unit * COALESCE(cn.nav, p.latest_nav_value)) - ROUND(p.buy_amount) AS gain_loss,
      SAFE_DIVIDE(ROUND(p.unit * COALESCE(cn.nav, p.latest_nav_value)) - ROUND(p.buy_amount), ROUND(p.buy_amount)) * 100 AS gain_pct
    FROM pwc p
    LEFT JOIN canon_nav cn ON cn.fund_id = p.fund_id
    ORDER BY value DESC`,
  params: { sid, date },
});

// ---- Scheduled sending: recipient resolution for "All AUM investors" /
// "All registered users" (see server/schedules.js) --------------------------

// Every investor with a positive AUM as of the latest available portfolio_fix
// snapshot, with an email on file — same source table as the rest of Send
// statement's "portfolio as of" branch (userHoldingsAsOfFix), so a scheduled
// "all AUM investors" send reflects the same holdings data the manual tool
// would show for any one of them.
const allInvestorsWithAum = () => ({
  sql: `WITH latest AS (
      SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS d FROM ${PORT_FIX}
    ),
    aum AS (
      SELECT sid_code, SUM(buy_amount) AS total_aum
      FROM ${PORT_FIX}, latest
      WHERE DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = latest.d AND total_unit > 0
      GROUP BY sid_code
      HAVING SUM(buy_amount) > 0
    )
    SELECT u.id AS user_id, u.sid_code AS sid, u.email
    FROM aum
    JOIN ${USERS} u ON u.sid_code = aum.sid_code
    WHERE u.email IS NOT NULL`,
  params: {},
});

// Every registered user with an email on file — the broadest recipient pool,
// regardless of whether they hold anything.
const allRegisteredUsersWithEmail = () => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, u.email
    FROM ${USERS} u
    WHERE u.email IS NOT NULL`,
  params: {},
});

// ---- HNWI (High Net Worth Individual): investors at/above an AUM threshold,
// as of a specific date, from portfolio_with_code — same -1 day correction as
// the rest of this section (created_at is a day ahead of the AUM date it
// represents). Two shapes: one row per investor (total AUM across funds), and
// one row per investor per fund (for a full breakdown export).
const hnwiLatestDate = () => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_WITH_CODE}`,
  params: {},
});

function aumRange(minAum, maxAum) {
  return {
    min: Number(minAum) || 0,
    max: maxAum === '' || maxAum == null ? Number.MAX_SAFE_INTEGER : Number(maxAum),
  };
}

// Shared base: one row per investor per fund holding, plus each investor's
// total AUM across funds — unfiltered by any AUM threshold, so the total and
// per-fund filters below can be applied independently of each other.
function hnwiBase(date) {
  return {
    cte: `WITH daily AS (
        SELECT sid_code, id AS fund_id, fund AS fund_name, amount,
          DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS aum_date
        FROM ${PORT_WITH_CODE}
        WHERE DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date AND amount > 0
      ),
      per_user AS (
        SELECT sid_code, SUM(amount) AS total_aum, ANY_VALUE(aum_date) AS aum_date
        FROM daily
        GROUP BY sid_code
      )`,
    params: { date },
  };
}

// Filtered by the investor's TOTAL AUM across all funds.
const hnwiTotal = (date, minAum, maxAum, limit = 500) => {
  const { cte, params } = hnwiBase(date);
  const { min, max } = aumRange(minAum, maxAum);
  return {
    sql: `${cte}
      SELECT u.sid_code, up.name, u.ifua_code AS ifua, up.phone_number AS phone, u.email, up.birthdate,
        up.risk_level, up.investment_priorities, up.investment_risk_tolerance,
        pu.total_aum, pu.aum_date
      FROM per_user pu
      JOIN ${USERS} u ON u.sid_code = pu.sid_code
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      WHERE pu.total_aum BETWEEN @minAum AND @maxAum
      ORDER BY pu.total_aum DESC
      LIMIT @limit`,
    params: { ...params, minAum: min, maxAum: max, limit: parseInt(limit, 10) || 500 },
  };
};

// Defaults to the same investor list as the total-AUM filter above (the
// per_user total_aum range) — inherited so the section "follows" whatever
// the top filter is set to. minFundAum/maxFundAum are an optional extra
// layer on top: leave them blank to just inherit, or set them to also
// narrow down to fund holdings within that own AUM range.
const hnwiByFund = (date, minAum, maxAum, minFundAum, maxFundAum, limit = 5000) => {
  const { cte, params } = hnwiBase(date);
  const total = aumRange(minAum, maxAum);
  const fund = aumRange(minFundAum, maxFundAum);
  return {
    sql: `${cte}
      SELECT u.sid_code, up.name, u.ifua_code AS ifua, up.phone_number AS phone, u.email, up.birthdate,
        up.risk_level, up.investment_priorities, up.investment_risk_tolerance,
        d.fund_name, d.amount AS fund_aum, d.aum_date, pu.total_aum
      FROM daily d
      JOIN per_user pu ON pu.sid_code = d.sid_code
      JOIN ${USERS} u ON u.sid_code = d.sid_code
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      WHERE pu.total_aum BETWEEN @minAum AND @maxAum
        AND d.amount BETWEEN @minFundAum AND @maxFundAum
      ORDER BY pu.total_aum DESC, u.sid_code, d.fund_name
      LIMIT @limit`,
    params: {
      ...params,
      minAum: total.min, maxAum: total.max,
      minFundAum: fund.min, maxFundAum: fund.max,
      limit: parseInt(limit, 10) || 5000,
    },
  };
};

// ---- Dormant win-back: computed live from main.transactions, not a
// precomputed table. For every user, look at the gap between each pair of
// consecutive completed buys (LEAD/LAG over their own buy history): a gap of
// 14+ days is a "dormancy episode." If a buy eventually follows, the episode
// "converted" (gap_days = how long it took); if not, the gap just keeps
// growing, measured against CURRENT_DATE(). Episodes are capped at 179 days:
// past 6 months of silence is effectively churned, not "about to come back."
// That population belongs to the Predict tab's churn model instead: letting
// an unbounded gap sit in "3 Month Dormant" forever would swamp that bucket
// with permanently-gone users and crater its conversion rate.
// One user can appear in multiple episodes/buckets over their lifetime:
// that's real (someone can go quiet, come back, then go quiet again years
// later), not double-counting.
const DORMANT_EPISODES_CTE = `WITH buys AS (
    SELECT user_id, DATE(created_at) AS txn_date, final_amount
    FROM ${TX}
    WHERE status = 'completed' AND type = 'buy'
  ),
  gaps AS (
    SELECT user_id, txn_date, final_amount,
      LEAD(txn_date) OVER (PARTITION BY user_id ORDER BY txn_date) AS next_txn_date,
      LEAD(final_amount) OVER (PARTITION BY user_id ORDER BY txn_date) AS next_amount
    FROM buys
  ),
  episodes AS (
    SELECT *,
      DATE_DIFF(COALESCE(next_txn_date, CURRENT_DATE()), txn_date, DAY) AS gap_days,
      next_txn_date IS NOT NULL AS converted
    FROM gaps
  ),
  categorized AS (
    SELECT *,
      CASE
        WHEN gap_days >= 180 THEN NULL
        WHEN gap_days >= 90 THEN '3 Month Dormant'
        WHEN gap_days >= 60 THEN '2 Month Dormant'
        WHEN gap_days >= 30 THEN '1 Month Dormant'
        WHEN gap_days >= 14 THEN '2 Weeks Dormant'
      END AS dormant_category
    FROM episodes
    WHERE gap_days >= 14
  )`;
const DORMANT_CATEGORY_ORDER = `CASE dormant_category
    WHEN '2 Weeks Dormant' THEN 1
    WHEN '1 Month Dormant' THEN 2
    WHEN '2 Month Dormant' THEN 3
    WHEN '3 Month Dormant' THEN 4
    ELSE 5 END`;

const dormantConversionSummary = () => ({
  sql: `${DORMANT_EPISODES_CTE},
    counts AS (
      SELECT dormant_category, COUNT(*) AS total_dormancy_periods, COUNTIF(converted) AS converted_periods
      FROM categorized WHERE dormant_category IS NOT NULL
      GROUP BY dormant_category
    ),
    revenue AS (
      SELECT dormant_category, SUM(next_amount) AS total_revenue,
        ROUND(AVG(next_amount)) AS avg_revenue_per_conversion,
        APPROX_QUANTILES(next_amount, 2)[OFFSET(1)] AS median_revenue_per_conversion,
        MAX(next_amount) AS max_revenue_per_conversion
      FROM categorized WHERE dormant_category IS NOT NULL AND converted
      GROUP BY dormant_category
    )
    SELECT c.dormant_category, c.total_dormancy_periods, c.converted_periods,
      ROUND(SAFE_DIVIDE(c.converted_periods, c.total_dormancy_periods) * 100, 2) AS conversion_rate_pct,
      COALESCE(r.total_revenue, 0) AS total_revenue,
      r.avg_revenue_per_conversion, r.median_revenue_per_conversion, r.max_revenue_per_conversion
    FROM counts c
    LEFT JOIN revenue r USING (dormant_category)
    ORDER BY ${DORMANT_CATEGORY_ORDER}`,
  params: {},
});

const dormantTimeToConvert = () => ({
  sql: `${DORMANT_EPISODES_CTE}
    SELECT user_id, dormant_category, next_txn_date AS first_txn_date, gap_days AS days_to_convert
    FROM categorized
    WHERE dormant_category IS NOT NULL AND converted
    ORDER BY gap_days DESC
    LIMIT 1000`,
  params: {},
});

// Lifetime buy activity of everyone who ever recovered from a dormancy
// episode, tagged with the longest one they recovered from, not every
// episode they ever had (one row per user, not per episode).
const dormantRepeatBuyers = () => ({
  sql: `${DORMANT_EPISODES_CTE},
    converted_ranked AS (
      SELECT user_id, dormant_category, gap_days,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY gap_days DESC) AS rn
      FROM categorized
      WHERE dormant_category IS NOT NULL AND converted
    ),
    longest_recovery AS (
      SELECT user_id, dormant_category FROM converted_ranked WHERE rn = 1
    ),
    lifetime AS (
      SELECT user_id, COUNT(*) AS txn_count, SUM(final_amount) AS total_spent
      FROM buys
      GROUP BY user_id
    )
    SELECT lr.user_id, lr.dormant_category, l.txn_count, l.total_spent,
      CASE WHEN l.txn_count = 1 THEN 'One-time'
           WHEN l.txn_count BETWEEN 2 AND 3 THEN 'Light (2-3)'
           ELSE 'Power (4+)' END AS buyer_type
    FROM longest_recovery lr
    JOIN lifetime l USING (user_id)
    ORDER BY l.total_spent DESC
    LIMIT 1000`,
  params: {},
});

// ---- Kalcer (ambassadors): who referred whom, and when, with the referred
// investor's AUM as of a picked date. Originally read kalcer.kalcer_fix, a
// precomputed bonus table with no date columns at all (not even on the
// table itself: each refresh just overwrites the same dateless aggregate),
// so there was no way to say when a referral happened or what date an AUM
// figure was as of. Rebuilt on raw, dated sources instead:
//   - main.user_referrals for the link itself: immutable (by user id, set
//     once at referral time), unlike referrer_code/sales_code string
//     matching, which breaks once a code is reused or reassigned.
//   - mi_fee_logs.portfolio_with_code for AUM, same -1-day correction and
//     "as of" picker as the HNWI tab (its created_at is a day ahead of the
//     AUM date it represents).
// Deliberately excludes bonus amounts, tier qualification, and eligibility
// status: that math isn't documented anywhere in this codebase, and
// guessing at it risks misstating who's owed money. This only reports
// referral activity and AUM, nothing about what anyone is paid for it.
const kalcerLatestDate = () => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_WITH_CODE}`,
  params: {},
});

// Shared base: every referral link plus the invitee's AUM as of @date.
function kalcerBase(date) {
  return {
    cte: `WITH referrals AS (
        SELECT referrer_id, user_id AS invitee_id, DATE(created_at) AS referral_date
        FROM ${USER_REFERRALS}
      ),
      invitee_aum AS (
        SELECT sid_code, SUM(amount) AS aum
        FROM ${PORT_WITH_CODE}
        WHERE DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date AND amount > 0
        GROUP BY sid_code
      )`,
    params: { date },
  };
}

const kalcerAmbassadorSummary = (date, q = '') => {
  const { cte, params } = kalcerBase(date);
  const search = String(q || '').trim().toLowerCase();
  return {
    sql: `${cte}
      SELECT referrer.sid_code AS referrer_sid, referrer_up.name AS referrer_name, referrer.email AS referrer_email,
        COUNT(DISTINCT r.invitee_id) AS referred_count,
        MIN(r.referral_date) AS first_referral_date,
        MAX(r.referral_date) AS last_referral_date,
        COALESCE(SUM(ia.aum), 0) AS total_aum_referred
      FROM referrals r
      JOIN ${USERS} referrer ON referrer.id = r.referrer_id
      LEFT JOIN ${USER_PROFILES} referrer_up ON referrer_up.user_id = referrer.id
      JOIN ${USERS} invitee ON invitee.id = r.invitee_id
      LEFT JOIN invitee_aum ia ON ia.sid_code = invitee.sid_code
      WHERE @search = '' OR LOWER(referrer.sid_code) LIKE @searchLike
        OR LOWER(referrer_up.name) LIKE @searchLike OR LOWER(referrer.email) LIKE @searchLike
      GROUP BY referrer_sid, referrer_name, referrer_email
      ORDER BY referred_count DESC
      LIMIT 2000`,
    params: { ...params, search, searchLike: `%${search}%` },
  };
};

const kalcerReferralDetail = (date, q = '') => {
  const { cte, params } = kalcerBase(date);
  const search = String(q || '').trim().toLowerCase();
  return {
    sql: `${cte}
      SELECT referrer.sid_code AS referrer_sid, referrer_up.name AS referrer_name,
        invitee.sid_code AS invitee_sid, invitee_up.name AS invitee_name,
        r.referral_date, COALESCE(ia.aum, 0) AS invitee_aum
      FROM referrals r
      JOIN ${USERS} referrer ON referrer.id = r.referrer_id
      LEFT JOIN ${USER_PROFILES} referrer_up ON referrer_up.user_id = referrer.id
      JOIN ${USERS} invitee ON invitee.id = r.invitee_id
      LEFT JOIN ${USER_PROFILES} invitee_up ON invitee_up.user_id = invitee.id
      LEFT JOIN invitee_aum ia ON ia.sid_code = invitee.sid_code
      WHERE @search = '' OR LOWER(referrer.sid_code) LIKE @searchLike
        OR LOWER(referrer_up.name) LIKE @searchLike OR LOWER(referrer.email) LIKE @searchLike
      ORDER BY r.referral_date DESC
      LIMIT 5000`,
    params: { ...params, search, searchLike: `%${search}%` },
  };
};

// ---- Push delivery: Firebase Cloud Messaging's own delivery log (own
// dataset, day-partitioned on event_timestamp). This is send-pipeline
// health only ("did FCM accept and hand off the message"), not an
// open/click/read event: Firebase's standard export has no such events for
// messaging, and there's no user_id on this table (only an FCM
// instance_id) to join against opens or revenue. `event` has exactly 6
// values; everything but MESSAGE_ACCEPTED is some flavor of failure (a
// stale/invalid device token, a malformed send, etc.). MISSING_REGISTRATIONS
// is broken out on its own since it's the dominant failure and the most
// actionable (stale token list).
const FIREBASE_MESSAGING = '`sayakaya.firebase_messaging.data`';

const pushTrend = (from, to, granularity) => {
  const r = range(from, to);
  const part = granularityPart(granularity, 'WEEK');
  return {
    sql: `SELECT DATE_TRUNC(DATE(event_timestamp), ${part}) AS bucket,
        COUNT(*) AS total_sends,
        COUNTIF(event = 'MESSAGE_ACCEPTED') AS accepted,
        ROUND(SAFE_DIVIDE(COUNTIF(event = 'MESSAGE_ACCEPTED'), COUNT(*)) * 100, 2) AS delivery_rate_pct
      FROM ${FIREBASE_MESSAGING}
      WHERE DATE(event_timestamp) BETWEEN @from AND @to
      GROUP BY bucket
      ORDER BY bucket`,
    params: r,
  };
};

const pushByCampaign = (from, to) => {
  const r = range(from, to);
  return {
    sql: `SELECT analytics_label,
        COUNT(*) AS total_sends,
        COUNTIF(event = 'MESSAGE_ACCEPTED') AS accepted,
        COUNTIF(event = 'MISSING_REGISTRATIONS') AS missing_registrations,
        COUNTIF(event NOT IN ('MESSAGE_ACCEPTED', 'MISSING_REGISTRATIONS')) AS other_errors,
        ROUND(SAFE_DIVIDE(COUNTIF(event = 'MESSAGE_ACCEPTED'), COUNT(*)) * 100, 2) AS delivery_rate_pct
      FROM ${FIREBASE_MESSAGING}
      WHERE DATE(event_timestamp) BETWEEN @from AND @to AND analytics_label != ''
      GROUP BY analytics_label
      ORDER BY total_sends DESC
      LIMIT 500`,
    params: r,
  };
};

const pushByPlatform = (from, to) => {
  const r = range(from, to);
  return {
    sql: `SELECT sdk_platform,
        COUNT(*) AS total_sends,
        COUNTIF(event = 'MESSAGE_ACCEPTED') AS accepted,
        ROUND(SAFE_DIVIDE(COUNTIF(event = 'MESSAGE_ACCEPTED'), COUNT(*)) * 100, 2) AS delivery_rate_pct
      FROM ${FIREBASE_MESSAGING}
      WHERE DATE(event_timestamp) BETWEEN @from AND @to
      GROUP BY sdk_platform
      ORDER BY total_sends DESC`,
    params: r,
  };
};

// ---- Marketing attribution: Adjust's mobile attribution events (own
// dataset, tiny, 80K rows, no partitioning). One row per channel
// (_tracker_name_): clicks, installs, and funnel milestones through to a
// completed payment, with revenue. _event_name_ has duplicate-fire variants
// for the same transaction (payment_completed_1M_plus etc., an ad-network
// value-threshold marker, same _transaction_id_ as the plain
// payment_completed row); only the plain event names below are counted, or
// every payment would be counted 2-3x over.
const ADJUST_EVENTS = '`sayakaya.adjust_analytics.events`';

const marketingFunnelByChannel = (from, to) => {
  const r = range(from, to);
  return {
    sql: `SELECT
        COALESCE(_tracker_name_, '(no tracker)') AS channel,
        COUNTIF(_activity_kind_ = 'click') AS clicks,
        COUNTIF(_activity_kind_ = 'install') AS installs,
        COUNTIF(_event_name_ = 'otp_register_verified') AS otp_verified,
        COUNTIF(_event_name_ = 'registration_completed') AS registrations,
        COUNTIF(_event_name_ = 'kyc_verified') AS kyc_verified,
        COUNTIF(_event_name_ = 'order_created') AS orders_created,
        COUNTIF(_event_name_ = 'payment_completed') AS payments_completed,
        SUM(IF(_event_name_ = 'payment_completed', SAFE_CAST(_amount_ AS NUMERIC), 0)) AS total_revenue
      FROM ${ADJUST_EVENTS}
      WHERE DATE(TIMESTAMP_SECONDS(_created_at_)) BETWEEN @from AND @to
      GROUP BY channel
      HAVING clicks > 0 OR installs > 0 OR otp_verified > 0 OR registrations > 0
        OR kyc_verified > 0 OR orders_created > 0 OR payments_completed > 0
      ORDER BY installs DESC, clicks DESC, payments_completed DESC`,
    params: r,
  };
};

// ---- App health: Firebase Crashlytics + Performance Monitoring, each split
// across two own-dataset tables (one per platform, identical schema) that
// have to be UNIONed since there's no combined table.
const CRASH_ANDROID = '`sayakaya.firebase_crashlytics.com_sayakaya_android_ANDROID`';
const CRASH_IOS = '`sayakaya.firebase_crashlytics.com_sayakaya_ios_IOS`';
const PERF_ANDROID = '`sayakaya.firebase_performance.com_sayakaya_android_ANDROID`';
const PERF_IOS = '`sayakaya.firebase_performance.com_sayakaya_ios_IOS`';

const appCrashIssues = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH crashes AS (
        SELECT platform, issue_title, is_fatal, installation_uuid, application.display_version AS app_version
        FROM ${CRASH_ANDROID}
        WHERE DATE(event_timestamp) BETWEEN @from AND @to
        UNION ALL
        SELECT platform, issue_title, is_fatal, installation_uuid, application.display_version AS app_version
        FROM ${CRASH_IOS}
        WHERE DATE(event_timestamp) BETWEEN @from AND @to
      )
      SELECT platform, issue_title, is_fatal,
        COUNT(*) AS event_count,
        COUNT(DISTINCT installation_uuid) AS affected_devices,
        MAX(app_version) AS latest_app_version
      FROM crashes
      GROUP BY platform, issue_title, is_fatal
      ORDER BY event_count DESC
      LIMIT 200`,
    params: r,
  };
};

// DURATION_TRACE only (not SCREEN_TRACE or NETWORK_REQUEST): a screen
// trace's "duration" is how long the screen stayed in the foreground, a
// dwell time, not a load latency, so mixing it in would misrepresent slow
// dwell as slow performance. _app_in_background/_app_in_foreground are
// excluded for the same reason: their duration is how long the app sat
// backgrounded, sometimes hours, which also swamps the average (not the
// median) with noise unrelated to any real operation. Median is the
// headline number here for the same reason the Dormant/Kalcer tabs lead
// with it: a handful of multi-hour sessions blow out the average by 10-100x.
const appPerfTraces = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH traces AS (
        SELECT 'ANDROID' AS platform, event_name, trace_info.duration_us AS duration_us
        FROM ${PERF_ANDROID}
        WHERE DATE(event_timestamp) BETWEEN @from AND @to
          AND event_type = 'DURATION_TRACE' AND trace_info.duration_us IS NOT NULL
          AND event_name NOT IN ('_app_in_background', '_app_in_foreground')
        UNION ALL
        SELECT 'IOS' AS platform, event_name, trace_info.duration_us AS duration_us
        FROM ${PERF_IOS}
        WHERE DATE(event_timestamp) BETWEEN @from AND @to
          AND event_type = 'DURATION_TRACE' AND trace_info.duration_us IS NOT NULL
          AND event_name NOT IN ('_app_in_background', '_app_in_foreground')
      )
      SELECT platform, event_name,
        COUNT(*) AS sample_count,
        ROUND(APPROX_QUANTILES(duration_us, 2)[OFFSET(1)] / 1000, 1) AS median_duration_ms,
        ROUND(AVG(duration_us) / 1000, 1) AS avg_duration_ms
      FROM traces
      GROUP BY platform, event_name
      HAVING sample_count >= 20
      ORDER BY median_duration_ms DESC
      LIMIT 100`,
    params: r,
  };
};

// ---- Product funnel: GA4 export (own dataset, one physical table per day,
// `events_*` + `_TABLE_SUFFIX` is BigQuery's standard way to query a date
// range across them without naming all 239). Cohort-based, not a same-window
// count per step: registering and paying can land in different calendar
// periods (someone registers in July, pays in September), so naively
// counting "registrants in range" vs "payers in range" separately produces a
// funnel that goes UP between steps, not down: it would show more OTP
// submissions than registrations, because otp_on_submit also fires on every
// login, not just signup. Instead: find everyone whose register_click fell
// in the range, then check, with no date bound, whether that SAME device
// ever reached each later milestone. That join scans the full GA4 history
// regardless of the chosen range (a few hundred MB), not just the window.
const GA4_EVENTS = '`sayakaya.analytics_266759216.events_*`';

const productFunnelByPlatform = (from, to) => {
  const r = range(from, to);
  const fromSuffix = String(r.from).replace(/-/g, '');
  const toSuffix = String(r.to).replace(/-/g, '');
  return {
    sql: `WITH cohort AS (
        SELECT user_pseudo_id, platform,
          ROW_NUMBER() OVER (PARTITION BY user_pseudo_id ORDER BY event_timestamp) AS rn
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND event_name = 'register_click'
        QUALIFY rn = 1
      ),
      milestones AS (
        SELECT c.user_pseudo_id,
          MAX(e.event_name = 'otp_on_submit') AS did_otp,
          MAX(e.event_name = 'kyc_start') AS did_kyc_start,
          MAX(e.event_name = 'kyc_success') AS did_kyc_success,
          MAX(e.event_name = 'order_created') AS did_order,
          MAX(e.event_name = 'payment_complete') AS did_payment
        FROM ${GA4_EVENTS} e
        JOIN cohort c USING (user_pseudo_id)
        WHERE e.event_name IN ('otp_on_submit', 'kyc_start', 'kyc_success', 'order_created', 'payment_complete')
        GROUP BY c.user_pseudo_id
      )
      SELECT COALESCE(c.platform, '(unknown)') AS platform,
        COUNT(DISTINCT c.user_pseudo_id) AS registered,
        COUNTIF(m.did_otp) AS otp_submitted,
        COUNTIF(m.did_kyc_start) AS kyc_started,
        COUNTIF(m.did_kyc_success) AS kyc_verified,
        COUNTIF(m.did_order) AS ordered,
        COUNTIF(m.did_payment) AS paid
      FROM cohort c
      LEFT JOIN milestones m USING (user_pseudo_id)
      GROUP BY platform
      ORDER BY registered DESC`,
    params: { fromSuffix, toSuffix },
  };
};

// ---- User behavior: GA4 app events joined to the main database. GA4's
// user_id is main.users.id (the app sets it at login), so in-app actions can
// be lined up against real transactions, holdings and KYC status. Events
// from before login only carry user_pseudo_id and are left out. Background
// events (a push arriving, an OS or app update) are excluded from "activity":
// they fire whether or not the person opened the app, and counting them made
// active days exceed sessions. Transaction dates use DATE(created_at) like
// every other tab, while GA4 days are the property's own event_date.
// Purchases are matched from 10 minutes BEFORE an app event: the backend
// writes the transaction row a few seconds before the app logs order_created.
const GA4_PASSIVE_EVENTS = `'notification_receive', 'notification_dismiss', 'app_remove', 'os_update', 'app_update', 'app_clear_data', 'firebase_campaign'`;
const ga4Param = (key, type = 'string') => `(SELECT value.${type}_value FROM UNNEST(event_params) WHERE key = '${key}')`;
const ga4Range = (r) => ({ ...r, fromSuffix: String(r.from).replace(/-/g, ''), toSuffix: String(r.to).replace(/-/g, '') });
const HOLDERS_SQL = `SELECT DISTINCT user_id FROM ${PORT} WHERE deleted_at IS NULL AND unit > 0
        UNION DISTINCT
        SELECT DISTINCT user_id FROM ${BONUS_PORT} WHERE status = 'on_going'`;
const COMPLETED_BUYS_SQL = `SELECT user_id, fund_id, created_at, final_amount FROM ${TX}
        WHERE type = 'buy' AND status = 'completed' AND DATE(created_at) >= DATE_SUB(CAST(@from AS DATE), INTERVAL 1 DAY)`;

// Segment is the investor's status TODAY (holding now, bought before but
// fully redeemed, KYC-verified but never bought, not verified), not their
// status at the start of the period.
const behaviorSegments = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT user_id, event_name, event_date,
          ${ga4Param('ga_session_id', 'int')} AS session_id,
          ${ga4Param('engagement_time_msec', 'int')} AS engagement_ms
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name NOT IN (${GA4_PASSIVE_EVENTS})
      ),
      app AS (
        SELECT user_id, COUNT(DISTINCT event_date) AS active_days, COUNT(DISTINCT session_id) AS sessions,
          COUNTIF(event_name = 'screen_view') AS screen_views, SUM(IFNULL(engagement_ms, 0)) / 60000 AS engaged_min
        FROM ev GROUP BY user_id
      ),
      holders AS (${HOLDERS_SQL}),
      ever_bought AS (SELECT DISTINCT user_id FROM ${TX} WHERE type = 'buy' AND status = 'completed'),
      tx AS (
        SELECT user_id,
          COUNTIF(type = 'buy') AS buys, SUM(IF(type = 'buy', final_amount, 0)) AS buy_amount,
          COUNTIF(type = 'sell') AS sells, SUM(IF(type = 'sell', final_amount, 0)) AS sell_amount
        FROM ${TX}
        WHERE status = 'completed' AND type IN ('buy', 'sell') AND DATE(created_at) BETWEEN @from AND @to
        GROUP BY user_id
      ),
      seg AS (
        SELECT a.*, t.buys, t.buy_amount, t.sells, t.sell_amount,
          CASE
            WHEN h.user_id IS NOT NULL THEN 'holding'
            WHEN eb.user_id IS NOT NULL THEN 'redeemed'
            WHEN u.verification_status = 'verified' THEN 'verified_no_buy'
            ELSE 'not_verified'
          END AS segment
        FROM app a
        JOIN ${USERS} u ON u.id = a.user_id
        LEFT JOIN holders h ON h.user_id = a.user_id
        LEFT JOIN ever_bought eb ON eb.user_id = a.user_id
        LEFT JOIN tx t ON t.user_id = a.user_id
      )
      SELECT segment, COUNT(*) AS app_users,
        ROUND(AVG(active_days), 1) AS avg_active_days,
        ROUND(AVG(sessions), 1) AS avg_sessions,
        ROUND(AVG(screen_views), 1) AS avg_screen_views,
        ROUND(APPROX_QUANTILES(engaged_min, 2)[OFFSET(1)], 1) AS median_engaged_min,
        COUNTIF(buys > 0) AS buyers,
        ROUND(SAFE_DIVIDE(COUNTIF(buys > 0), COUNT(*)) * 100, 1) AS buyer_rate_pct,
        SUM(IFNULL(buy_amount, 0)) AS buy_amount,
        COUNTIF(sells > 0) AS sellers,
        SUM(IFNULL(sell_amount, 0)) AS sell_amount
      FROM seg
      GROUP BY segment
      ORDER BY CASE segment WHEN 'holding' THEN 1 WHEN 'redeemed' THEN 2 WHEN 'verified_no_buy' THEN 3 ELSE 4 END`,
    params: ga4Range(r),
  };
};

// Daily logged-in app users, how many of them hold a portfolio today, and
// how many of them completed a buy that same day.
const behaviorDaily = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT DISTINCT PARSE_DATE('%Y%m%d', event_date) AS day, user_id
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name NOT IN (${GA4_PASSIVE_EVENTS})
      ),
      holders AS (${HOLDERS_SQL}),
      buys AS (
        SELECT DISTINCT DATE(created_at) AS day, user_id FROM ${TX}
        WHERE type = 'buy' AND status = 'completed' AND DATE(created_at) BETWEEN @from AND @to
      )
      SELECT ev.day, COUNT(*) AS app_users,
        COUNTIF(h.user_id IS NOT NULL) AS holding_users,
        COUNTIF(b.user_id IS NOT NULL) AS buyers
      FROM ev
      LEFT JOIN holders h ON h.user_id = ev.user_id
      LEFT JOIN buys b ON b.day = ev.day AND b.user_id = ev.user_id
      GROUP BY ev.day
      ORDER BY ev.day`,
    params: ga4Range(r),
  };
};

// For each in-app action: of the people who did it in the period, how many
// completed a buy within 7 days of first doing it, against the baseline of
// every logged-in app user (7 days from their first activity in the
// period). Lift > 1 means the action comes before buying more often than
// average. Correlation, not cause: buy-flow steps (order_button, promo_code)
// sit at the top because they are part of buying. Generic events
// (screen_view, session_start, user_engagement) are left out.
const behaviorFeatureLift = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT user_id, event_name, TIMESTAMP_MICROS(event_timestamp) AS ts
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name NOT IN (${GA4_PASSIVE_EVENTS}, 'session_start', 'user_engagement', 'screen_view', 'first_open')
      ),
      firsts AS (SELECT user_id, event_name, MIN(ts) AS first_ts FROM ev GROUP BY user_id, event_name),
      user_first AS (SELECT user_id, MIN(ts) AS first_ts FROM ev GROUP BY user_id),
      buys AS (${COMPLETED_BUYS_SQL}),
      converted AS (
        SELECT DISTINCT f.user_id, f.event_name
        FROM firsts f
        JOIN buys b ON b.user_id = f.user_id
          AND b.created_at BETWEEN TIMESTAMP_SUB(f.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(f.first_ts, INTERVAL 7 DAY)
      ),
      baseline AS (
        SELECT SAFE_DIVIDE(COUNT(DISTINCT b.user_id), (SELECT COUNT(*) FROM user_first)) AS rate
        FROM user_first u
        JOIN buys b ON b.user_id = u.user_id
          AND b.created_at BETWEEN TIMESTAMP_SUB(u.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(u.first_ts, INTERVAL 7 DAY)
      )
      SELECT f.event_name, COUNT(*) AS users,
        COUNTIF(c.user_id IS NOT NULL) AS buyers_7d,
        ROUND(SAFE_DIVIDE(COUNTIF(c.user_id IS NOT NULL), COUNT(*)) * 100, 1) AS buy_rate_pct,
        ROUND(ANY_VALUE(baseline.rate) * 100, 1) AS baseline_pct,
        ROUND(SAFE_DIVIDE(SAFE_DIVIDE(COUNTIF(c.user_id IS NOT NULL), COUNT(*)), ANY_VALUE(baseline.rate)), 2) AS lift
      FROM firsts f
      CROSS JOIN baseline
      LEFT JOIN converted c ON c.user_id = f.user_id AND c.event_name = f.event_name
      GROUP BY f.event_name
      HAVING users >= 10
      ORDER BY lift DESC, users DESC`,
    params: ga4Range(r),
  };
};

// Push campaigns from the app side: the Push delivery tab only sees FCM's
// send log (no user, no opens). Here, per campaign name: logged-in users who
// received it, who opened it, and who completed a buy within 72 hours.
// Pushes with no name or label are transactional (e.g. payment receipts).
const behaviorPushImpact = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH n AS (
        SELECT user_id, event_name, TIMESTAMP_MICROS(event_timestamp) AS ts,
          COALESCE(NULLIF(TRIM(${ga4Param('message_name')}), ''), NULLIF(TRIM(${ga4Param('label')}), ''), '(no campaign name)') AS campaign
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name IN ('notification_receive', 'notification_open')
      ),
      per_user AS (
        SELECT campaign, user_id,
          MIN(IF(event_name = 'notification_receive', ts, NULL)) AS received_ts,
          MIN(IF(event_name = 'notification_open', ts, NULL)) AS opened_ts
        FROM n GROUP BY campaign, user_id
      ),
      buys AS (${COMPLETED_BUYS_SQL}),
      scored AS (
        SELECT p.campaign, p.received_ts, p.opened_ts,
          (SELECT SUM(b.final_amount) FROM buys b WHERE b.user_id = p.user_id AND p.opened_ts IS NOT NULL
             AND b.created_at BETWEEN p.opened_ts AND TIMESTAMP_ADD(p.opened_ts, INTERVAL 72 HOUR)) AS open_buy_amount,
          (SELECT SUM(b.final_amount) FROM buys b WHERE b.user_id = p.user_id
             AND b.created_at BETWEEN COALESCE(p.received_ts, p.opened_ts) AND TIMESTAMP_ADD(COALESCE(p.received_ts, p.opened_ts), INTERVAL 72 HOUR)) AS buy_amount
        FROM per_user p
      )
      SELECT campaign,
        MIN(DATE(COALESCE(received_ts, opened_ts))) AS first_seen,
        MAX(DATE(COALESCE(received_ts, opened_ts))) AS last_seen,
        COUNTIF(received_ts IS NOT NULL) AS received_users,
        COUNTIF(opened_ts IS NOT NULL) AS opened_users,
        ROUND(SAFE_DIVIDE(COUNTIF(opened_ts IS NOT NULL), COUNTIF(received_ts IS NOT NULL)) * 100, 1) AS open_rate_pct,
        COUNTIF(open_buy_amount > 0) AS opened_then_bought,
        SUM(IFNULL(open_buy_amount, 0)) AS opened_buy_amount,
        COUNTIF(buy_amount > 0) AS buyers_72h,
        ROUND(SAFE_DIVIDE(COUNTIF(buy_amount > 0), COUNT(*)) * 100, 1) AS buy_rate_pct,
        SUM(IFNULL(buy_amount, 0)) AS buy_amount_72h
      FROM scored
      GROUP BY campaign
      ORDER BY received_users DESC
      LIMIT 200`,
    params: ga4Range(r),
  };
};

// Fund detail screen views (screen_view on ProductDetailScreen, whose `id`
// param is funds.id) against completed buys of THAT fund within 7 days of
// the person's first view in the period.
const behaviorProductInterest = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH v AS (
        SELECT user_id, TIMESTAMP_MICROS(event_timestamp) AS ts, ${ga4Param('id')} AS fund_id
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'screen_view'
          AND ${ga4Param('firebase_screen')} = 'ProductDetailScreen'
      ),
      viewers AS (
        SELECT fund_id, user_id, COUNT(*) AS views, MIN(ts) AS first_ts
        FROM v WHERE fund_id IS NOT NULL GROUP BY fund_id, user_id
      ),
      holdings AS (SELECT DISTINCT user_id, fund_id FROM ${PORT} WHERE deleted_at IS NULL AND unit > 0),
      buys AS (${COMPLETED_BUYS_SQL}),
      scored AS (
        SELECT vw.fund_id, vw.views, h.user_id IS NOT NULL AS holds_now,
          (SELECT SUM(b.final_amount) FROM buys b WHERE b.user_id = vw.user_id AND b.fund_id = vw.fund_id
             AND b.created_at BETWEEN TIMESTAMP_SUB(vw.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(vw.first_ts, INTERVAL 7 DAY)) AS buy_amount
        FROM viewers vw
        LEFT JOIN holdings h ON h.user_id = vw.user_id AND h.fund_id = vw.fund_id
      )
      SELECT COALESCE(f.name, s.fund_id) AS fund, f.type AS fund_type,
        SUM(s.views) AS views, COUNT(*) AS viewers,
        COUNTIF(s.buy_amount > 0) AS buyers_7d,
        ROUND(SAFE_DIVIDE(COUNTIF(s.buy_amount > 0), COUNT(*)) * 100, 1) AS view_to_buy_pct,
        SUM(IFNULL(s.buy_amount, 0)) AS buy_amount_7d,
        COUNTIF(s.holds_now) AS viewers_holding_now
      FROM scored s
      LEFT JOIN ${FUNDS} f ON f.id = s.fund_id
      GROUP BY fund, fund_type
      ORDER BY viewers DESC`,
    params: ga4Range(r),
  };
};

// People who started buying in the app (opened the buy sheet or created an
// order) but have no paid buy in the main database from 10 minutes before
// their first try to 3 days after their last. Paid includes 'verified' and
// 'completed_payment' (money received, units not allotted yet), not just
// 'completed'. order_statuses shows what happened to any order they did
// create (expired = never paid).
// Contact columns are included on purpose: this is a follow-up list.
const behaviorIntentNoBuy = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH intent AS (
        SELECT user_id,
          MIN(IF(event_name != 'screen_view', TIMESTAMP_MICROS(event_timestamp), NULL)) AS first_ts,
          MAX(IF(event_name != 'screen_view', TIMESTAMP_MICROS(event_timestamp), NULL)) AS last_ts,
          COUNTIF(event_name = 'buy_bottom_sheet') AS buy_sheet_opens,
          COUNTIF(event_name = 'order_created') AS orders_created,
          ARRAY_AGG(IF(event_name = 'screen_view', ${ga4Param('product_name')}, NULL) IGNORE NULLS ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_fund_viewed
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND (event_name IN ('buy_bottom_sheet', 'order_button', 'order_created')
            OR (event_name = 'screen_view' AND ${ga4Param('firebase_screen')} = 'ProductDetailScreen'))
        GROUP BY user_id
        HAVING buy_sheet_opens + orders_created > 0
      ),
      tried AS (
        SELECT i.*,
          (SELECT COUNT(*) FROM ${TX} t WHERE t.user_id = i.user_id AND t.type = 'buy' AND t.status IN ('completed', 'completed_payment', 'verified')
             AND t.created_at BETWEEN TIMESTAMP_SUB(i.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(i.last_ts, INTERVAL 3 DAY)) AS paid_buys,
          (SELECT STRING_AGG(DISTINCT t.status, ', ') FROM ${TX} t WHERE t.user_id = i.user_id AND t.type = 'buy'
             AND t.created_at BETWEEN TIMESTAMP_SUB(i.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(i.last_ts, INTERVAL 3 DAY)) AS order_statuses
        FROM intent i
      ),
      aum AS (
        SELECT h.user_id, SUM(h.unit * f.latest_nav_value) AS aum_now
        FROM (
          SELECT user_id, fund_id, unit FROM ${PORT} WHERE deleted_at IS NULL AND unit > 0
          UNION ALL
          SELECT user_id, fund_id, unit FROM ${BONUS_PORT} WHERE status = 'on_going'
        ) h
        JOIN ${FUNDS} f ON f.id = h.fund_id
        GROUP BY h.user_id
      ),
      last_buy AS (
        SELECT user_id, MAX(created_at) AS last_buy_at FROM ${TX}
        WHERE type = 'buy' AND status = 'completed' GROUP BY user_id
      )
      SELECT up.name, u.sid_code AS sid, u.email, up.phone_number AS phone, u.verification_status,
        FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', t.last_ts, 'Asia/Jakarta') AS last_try_wib,
        t.buy_sheet_opens, t.orders_created,
        COALESCE(t.order_statuses, 'no order created') AS order_statuses,
        t.last_fund_viewed,
        ROUND(IFNULL(a.aum_now, 0)) AS aum_now,
        DATE(lb.last_buy_at) AS last_completed_buy
      FROM tried t
      JOIN ${USERS} u ON u.id = t.user_id
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = t.user_id
      LEFT JOIN aum a ON a.user_id = t.user_id
      LEFT JOIN last_buy lb ON lb.user_id = t.user_id
      WHERE t.paid_buys = 0
      ORDER BY t.last_ts DESC
      LIMIT 500`,
    params: ga4Range(r),
  };
};

// One investor: who they are in the main database, plus a summary of their
// app use in the period.
const behaviorUserProfile = (userId, from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH app AS (
        SELECT
          FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', MIN(TIMESTAMP_MICROS(event_timestamp)), 'Asia/Jakarta') AS first_seen_wib,
          FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', MAX(TIMESTAMP_MICROS(event_timestamp)), 'Asia/Jakarta') AS last_seen_wib,
          COUNT(DISTINCT IF(event_name NOT IN (${GA4_PASSIVE_EVENTS}), event_date, NULL)) AS active_days,
          COUNT(DISTINCT ${ga4Param('ga_session_id', 'int')}) AS sessions,
          COUNTIF(event_name NOT IN (${GA4_PASSIVE_EVENTS})) AS app_events,
          ARRAY_AGG(platform ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS platform,
          ARRAY_AGG(app_info.version ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS app_version,
          ARRAY_AGG(TRIM(CONCAT(IFNULL(device.mobile_brand_name, ''), ' ', IFNULL(device.mobile_model_name, ''))) ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS device
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id = @userId
      ),
      holdings AS (
        SELECT fund_id, unit FROM ${PORT} WHERE deleted_at IS NULL AND unit > 0 AND user_id = @userId
        UNION ALL
        SELECT fund_id, unit FROM ${BONUS_PORT} WHERE status = 'on_going' AND user_id = @userId
      ),
      tx AS (
        SELECT
          COUNTIF(type = 'buy' AND status = 'completed') AS lifetime_buys,
          SUM(IF(type = 'buy' AND status = 'completed', final_amount, 0)) AS lifetime_buy_amount,
          COUNTIF(type = 'sell' AND status = 'completed') AS lifetime_sells,
          MIN(IF(type = 'buy' AND status = 'completed', DATE(created_at), NULL)) AS first_buy,
          MAX(IF(type = 'buy' AND status = 'completed', DATE(created_at), NULL)) AS last_buy
        FROM ${TX} WHERE user_id = @userId
      )
      SELECT u.id AS user_id, u.sid_code AS sid, u.email, up.name, u.verification_status,
        DATE(u.created_at) AS registered_on, DATE(u.verified_at) AS verified_on,
        (SELECT ROUND(COALESCE(SUM(h.unit * f.latest_nav_value), 0)) FROM holdings h JOIN ${FUNDS} f ON f.id = h.fund_id) AS aum_now,
        app.*, tx.*
      FROM ${USERS} u
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      CROSS JOIN app
      CROSS JOIN tx
      WHERE u.id = @userId`,
    params: { ...ga4Range(r), userId },
  };
};

// The same investor's app events and main-database transactions on one
// timeline, newest first. Pushes arriving/dismissed and engagement pings are
// left out: they say nothing about what the person did.
const behaviorUserTimeline = (userId, from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH app AS (
        SELECT TIMESTAMP_MICROS(event_timestamp) AS ts, 'app' AS source, event_name AS event,
          COALESCE(${ga4Param('product_name')}, ${ga4Param('message_name')}, ${ga4Param('firebase_screen')}) AS detail,
          CAST(NULL AS INT64) AS amount, CAST(NULL AS STRING) AS status,
          ${ga4Param('ga_session_id', 'int')} AS session_id, platform
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id = @userId
          AND event_name NOT IN ('user_engagement', 'notification_receive', 'notification_dismiss')
      ),
      tx AS (
        SELECT t.created_at AS ts, 'transaction' AS source, t.type AS event, f.name AS detail,
          t.final_amount AS amount, t.status, CAST(NULL AS INT64) AS session_id, CAST(NULL AS STRING) AS platform
        FROM ${TX} t
        LEFT JOIN ${FUNDS} f ON f.id = t.fund_id
        WHERE t.user_id = @userId AND DATE(t.created_at) BETWEEN @from AND @to
      )
      SELECT FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', ts, 'Asia/Jakarta') AS time_wib, source, event, detail, amount, status, session_id, platform
      FROM (SELECT * FROM app UNION ALL SELECT * FROM tx)
      ORDER BY ts DESC
      LIMIT 1000`,
    params: { ...ga4Range(r), userId },
  };
};

// ---- Subscription analysis: which screens and actions come before a paid
// buy (a fund subscription), and where people leave the buy flow. Same GA4
// to main-database join as User behavior. The app's buy flow, in order:
// buy form (SubscriptionFormBottomSheet, or the multi-fund form from the
// cart) > SubscriptionCheckoutScreen > SubscriptionPaymentMethodBottomSheet
// > order_created (PaymentScreen). "Paid" is a buy that reached completed,
// completed_payment or verified in the main database. manual_bonus buys are
// entered by admins, not made in the app, so they never count.
const GA4_SCREEN = ga4Param('firebase_screen');
const GA4_SESSION = ga4Param('ga_session_id', 'int');
const SUB_FORM_SCREENS = `'SubscriptionFormBottomSheet', 'MultipleSubscriptionFormBottomSheet'`;
// Coming back to the form from a later step is not a new way in.
const SUB_LATER_SCREENS = `'SubscriptionCheckoutScreen', 'SubscriptionPaymentMethodBottomSheet', 'PaymentScreen'`;
// Screens and taps that are part of buying (or the button that opens the
// buy form). They rank first among "what comes before a subscription" by
// construction, so the Drivers table can hide them.
const SUB_FLOW_NAMES = `${SUB_FORM_SCREENS}, ${SUB_LATER_SCREENS}, 'SubscriptionTopUpScreen', 'CartScreen', 'PromoCodesScreen', 'PaymentProofPreviewScreen', 'TransactionSuccessScreen',
        'buy_bottom_sheet', 'price_chips', 'promo_code', 'order_button', 'order_created', 'payment_complete',
        'top_up_portfolio_click', 'top_up_portfolio_detail_click', 'top_up_portfolio_detail_options_click', 'top_up_product_click',
        'top_up_other_product_click', 'buy_repeat_portfolio_click', 'buy_repeat_click'`;
const SUB_PAID_STATUSES = `'completed', 'completed_payment', 'verified'`;
const SUB_PAID_SQL = `SELECT user_id, created_at, paid_at, amount, final_amount FROM ${TX}
        WHERE type = 'buy' AND status IN (${SUB_PAID_STATUSES}) AND IFNULL(payment_method, '') != 'manual_bonus'`;
// The main-database side of a GA4 window: the period's last day plus one,
// for orders paid shortly after midnight.
const SUB_PAID_UNTIL = 'TIMESTAMP_ADD(TIMESTAMP(CAST(@to AS DATE)), INTERVAL 2 DAY)';

// Per person, the first time in the period they reached each step, each step
// counted only after the one before it (so the funnel never goes up). Paid
// is any paid buy from 10 minutes before their first order onwards. One
// query, four cuts: everyone, platform, first or repeat buyer (any paid buy
// before they first opened the form), and app version at that first open.
const subscriptionFunnel = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT user_id, platform, app_info.version AS app_version, TIMESTAMP_MICROS(event_timestamp) AS ts,
          CASE
            WHEN event_name = 'buy_bottom_sheet' OR (event_name = 'screen_view' AND ${GA4_SCREEN} IN (${SUB_FORM_SCREENS})) THEN 1
            WHEN event_name = 'screen_view' AND ${GA4_SCREEN} = 'SubscriptionCheckoutScreen' THEN 2
            WHEN event_name = 'screen_view' AND ${GA4_SCREEN} = 'SubscriptionPaymentMethodBottomSheet' THEN 3
            WHEN event_name = 'order_created' THEN 4
          END AS step
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name IN ('buy_bottom_sheet', 'screen_view', 'order_created')
      ),
      s1 AS (
        SELECT user_id, MIN(ts) AS t1, ARRAY_AGG(STRUCT(platform, app_version) ORDER BY ts LIMIT 1)[OFFSET(0)] AS d
        FROM ev WHERE step = 1 GROUP BY user_id
      ),
      s2 AS (SELECT s.user_id, MIN(e.ts) AS t2 FROM s1 s JOIN ev e ON e.user_id = s.user_id AND e.step = 2 AND e.ts >= s.t1 GROUP BY s.user_id),
      s3 AS (SELECT s.user_id, MIN(e.ts) AS t3 FROM s2 s JOIN ev e ON e.user_id = s.user_id AND e.step = 3 AND e.ts >= s.t2 GROUP BY s.user_id),
      s4 AS (SELECT s.user_id, MIN(e.ts) AS t4 FROM s3 s JOIN ev e ON e.user_id = s.user_id AND e.step = 4 AND e.ts >= s.t3 GROUP BY s.user_id),
      paid AS (${SUB_PAID_SQL}),
      s5 AS (
        SELECT s.user_id, ARRAY_AGG(STRUCT(p.created_at, p.paid_at) ORDER BY p.created_at LIMIT 1)[OFFSET(0)] AS tx
        FROM s4 s JOIN paid p ON p.user_id = s.user_id
          AND p.created_at BETWEEN TIMESTAMP_SUB(s.t4, INTERVAL 10 MINUTE) AND ${SUB_PAID_UNTIL}
        GROUP BY s.user_id
      ),
      prior AS (
        SELECT DISTINCT s.user_id FROM s1 s
        JOIN paid p ON p.user_id = s.user_id AND p.created_at < TIMESTAMP_SUB(s.t1, INTERVAL 10 MINUTE)
      ),
      base AS (
        SELECT s1.d.platform AS platform, IF(pr.user_id IS NULL, 'first', 'repeat') AS buyer_type,
          IFNULL(s1.d.app_version, '(unknown)') AS app_version, s1.t1, s2.t2, s3.t3, s4.t4, s5.tx
        FROM s1
        LEFT JOIN s2 USING (user_id) LEFT JOIN s3 USING (user_id) LEFT JOIN s4 USING (user_id) LEFT JOIN s5 USING (user_id)
        LEFT JOIN prior pr USING (user_id)
      )
      SELECT
        CASE WHEN GROUPING(platform) = 0 THEN 'platform' WHEN GROUPING(buyer_type) = 0 THEN 'buyer_type'
          WHEN GROUPING(app_version) = 0 THEN 'app_version' ELSE 'all' END AS split,
        COALESCE(platform, buyer_type, app_version, 'all') AS segment,
        COUNT(*) AS opened_form, COUNT(t2) AS checkout, COUNT(t3) AS payment_method, COUNT(t4) AS ordered, COUNT(tx) AS paid,
        ROUND(SAFE_DIVIDE(COUNT(tx), COUNT(*)) * 100, 1) AS paid_pct,
        ROUND(APPROX_QUANTILES(TIMESTAMP_DIFF(t4, t1, SECOND) / 60, 2)[OFFSET(1)], 1) AS median_min_to_order,
        ROUND(APPROX_QUANTILES(TIMESTAMP_DIFF(tx.paid_at, tx.created_at, SECOND) / 60, 2)[OFFSET(1)], 1) AS median_min_to_pay
      FROM base
      GROUP BY GROUPING SETS ((), (platform), (buyer_type), (app_version))
      ORDER BY split, opened_form DESC`,
    params: ga4Range(r),
  };
};

// Which screen people were on right before each buy-form open (and the one
// before that), within the same app session. Per screen: how many of those
// people created an order in that session, and how many paid within 3 days
// of an open from that screen.
const subscriptionEntry = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH sv AS (
        SELECT user_id, ${GA4_SESSION} AS session_id, TIMESTAMP_MICROS(event_timestamp) AS ts, ${GA4_SCREEN} AS screen
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'screen_view'
      ),
      seq AS (
        SELECT *, LAG(screen) OVER w AS prev1, LAG(screen, 2) OVER w AS prev2
        FROM sv WINDOW w AS (PARTITION BY user_id, session_id ORDER BY ts)
      ),
      opens AS (
        SELECT user_id, session_id, ts, IFNULL(prev1, '(session start)') AS came_from, IFNULL(prev2, '(session start)') AS before_that
        FROM seq
        WHERE screen IN (${SUB_FORM_SCREENS}) AND IFNULL(prev1, '') NOT IN (${SUB_FORM_SCREENS}, ${SUB_LATER_SCREENS})
      ),
      orders AS (
        SELECT user_id, ${GA4_SESSION} AS session_id, TIMESTAMP_MICROS(event_timestamp) AS ts
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'order_created'
      ),
      paid AS (${SUB_PAID_SQL}),
      scored AS (
        SELECT o.*,
          EXISTS (SELECT 1 FROM orders x WHERE x.user_id = o.user_id AND x.session_id = o.session_id AND x.ts >= o.ts) AS ordered,
          EXISTS (SELECT 1 FROM paid p WHERE p.user_id = o.user_id
            AND p.created_at BETWEEN TIMESTAMP_SUB(o.ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(o.ts, INTERVAL 3 DAY)) AS paid
        FROM opens o
      )
      SELECT IF(GROUPING(before_that) = 1, 'screen', 'path') AS level, came_from, before_that,
        COUNT(*) AS opens, COUNT(DISTINCT user_id) AS users,
        COUNT(DISTINCT IF(ordered, user_id, NULL)) AS ordered_users,
        COUNT(DISTINCT IF(paid, user_id, NULL)) AS paid_users,
        ROUND(SAFE_DIVIDE(COUNT(DISTINCT IF(paid, user_id, NULL)), COUNT(DISTINCT user_id)) * 100, 1) AS paid_pct
      FROM scored
      GROUP BY GROUPING SETS ((came_from), (came_from, before_that))
      HAVING users >= 3
      ORDER BY level DESC, users DESC`,
    params: ga4Range(r),
  };
};

// App sessions that reached the buy form but created no order: the furthest
// step reached, the next screen after the last buy-flow screen ("(left the
// app)" when nothing followed in that session), and how many of those people
// came back and paid within 7 days. Up to 12 exits per step, plus one total
// row per step (exit_screen empty).
const subscriptionDropoff = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT user_id, ${GA4_SESSION} AS session_id, TIMESTAMP_MICROS(event_timestamp) AS ts, event_name, ${GA4_SCREEN} AS screen
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name IN ('screen_view', 'order_created')
      ),
      sv AS (
        SELECT user_id, session_id, ts,
          CASE WHEN screen IN (${SUB_FORM_SCREENS}) THEN 1 WHEN screen = 'SubscriptionCheckoutScreen' THEN 2
            WHEN screen = 'SubscriptionPaymentMethodBottomSheet' THEN 3 END AS step,
          LEAD(screen) OVER (PARTITION BY user_id, session_id ORDER BY ts) AS next_screen
        FROM ev WHERE event_name = 'screen_view'
      ),
      sess AS (
        SELECT user_id, session_id, MAX(step) AS furthest, MAX(IF(step IS NOT NULL, ts, NULL)) AS last_ts,
          ARRAY_AGG(IF(step IS NOT NULL, IFNULL(next_screen, '(left the app)'), NULL) IGNORE NULLS ORDER BY ts DESC LIMIT 1)[SAFE_OFFSET(0)] AS went_to
        FROM sv GROUP BY user_id, session_id
        HAVING furthest IS NOT NULL
      ),
      ordered AS (SELECT DISTINCT user_id, session_id FROM ev WHERE event_name = 'order_created'),
      paid AS (${SUB_PAID_SQL}),
      dropped AS (
        SELECT s.*,
          EXISTS (SELECT 1 FROM paid p WHERE p.user_id = s.user_id
            AND p.created_at BETWEEN s.last_ts AND TIMESTAMP_ADD(s.last_ts, INTERVAL 7 DAY)) AS paid_later
        FROM sess s
        LEFT JOIN ordered o ON o.user_id = s.user_id AND o.session_id = s.session_id
        WHERE o.user_id IS NULL
      ),
      grouped AS (
        SELECT furthest AS step, IF(GROUPING(went_to) = 1, NULL, went_to) AS exit_screen,
          COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS users,
          COUNT(DISTINCT IF(paid_later, user_id, NULL)) AS paid_later_users
        FROM dropped
        GROUP BY GROUPING SETS ((furthest), (furthest, went_to))
      )
      SELECT *, ROUND(SAFE_DIVIDE(paid_later_users, users) * 100, 1) AS paid_later_pct
      FROM grouped
      QUALIFY exit_screen IS NULL OR ROW_NUMBER() OVER (PARTITION BY step, exit_screen IS NULL ORDER BY sessions DESC) <= 12
      ORDER BY step, exit_screen IS NOT NULL, sessions DESC`,
    params: ga4Range(r),
  };
};

// Every buy order created in the period (main database), by how the person
// chose to pay: paid, expired, cancelled, still waiting, and the median
// minutes from order to payment. "Paid another order within 7 days" counts
// people whose order here expired or was cancelled and who then paid a
// different order.
const subscriptionPayment = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH o AS (
        SELECT user_id, created_at, paid_at, amount, final_amount, status,
          status IN (${SUB_PAID_STATUSES}) AS is_paid,
          status IN ('expired', 'cancelled') AS is_lost,
          CASE
            WHEN payment_method = 'virtual_account' THEN CONCAT('Virtual account ', IFNULL(virtual_account_bank, ''))
            WHEN payment_method = 'bank_transfer' THEN CONCAT('Bank transfer ', IFNULL(virtual_account_bank, ''))
            ELSE IFNULL(payment_method, '(none)')
          END AS method
        FROM ${TX}
        WHERE type = 'buy' AND DATE(created_at) BETWEEN @from AND @to AND IFNULL(payment_method, '') != 'manual_bonus'
      ),
      paid AS (${SUB_PAID_SQL}),
      scored AS (
        SELECT o.*,
          is_lost AND EXISTS (SELECT 1 FROM paid p WHERE p.user_id = o.user_id
            AND p.created_at > o.created_at AND p.created_at <= TIMESTAMP_ADD(o.created_at, INTERVAL 7 DAY)) AS lost_then_paid
        FROM o
      )
      SELECT TRIM(method) AS method, COUNT(*) AS orders, COUNT(DISTINCT user_id) AS users,
        COUNTIF(is_paid) AS paid, COUNTIF(status = 'expired') AS expired, COUNTIF(status = 'cancelled') AS cancelled,
        COUNTIF(NOT is_paid AND NOT is_lost) AS waiting,
        ROUND(SAFE_DIVIDE(COUNTIF(is_paid), COUNT(*)) * 100, 1) AS paid_pct,
        ROUND(APPROX_QUANTILES(IF(is_paid, TIMESTAMP_DIFF(paid_at, created_at, SECOND) / 60, NULL), 2)[OFFSET(1)], 1) AS median_min_to_pay,
        SUM(IF(is_paid, final_amount, 0)) AS paid_amount,
        SUM(IF(is_lost, amount, 0)) AS lost_amount,
        COUNT(DISTINCT IF(is_lost, user_id, NULL)) AS lost_users,
        COUNT(DISTINCT IF(lost_then_paid, user_id, NULL)) AS lost_then_paid_users
      FROM scored
      GROUP BY method
      ORDER BY orders DESC`,
    params: r,
  };
};

// For every screen and in-app action: of the logged-in people who did it in
// the period (people who reached the outcome: only what they did before
// first reaching it), how many reached the outcome, against the same rate
// for everyone who did not do it. A person reaches the outcome with an
// outcome row from their first app activity in the period to the period's
// end. Lift 2.0 = twice the rate of those who did not.
// graceSeconds: how long after the outcome row's created_at still counts as
// "before". Buying: 120, because the app logs order_created up to ~90 s
// after the backend writes the row (95th pct, Sep 2026); any longer and the
// payment receipt push and receipt screen start counting as things people
// did before buying. Selling is the other way round: the row is written a
// median 8 s after confirm_redeem_click, and the app opens the transaction
// list in that same second, so -2 keeps the confirmation and drops what
// comes after.
// notification_foreground is a push arriving while the app is open, not
// something the person did.
// outcomeSql: rows with user_id and created_at. flowNames: screens and
// actions that are part of reaching the outcome (flagged in_flow).
// population: extra condition on who counts at all.
const ga4OutcomeDrivers = (from, to, { outcomeSql, flowNames, population = 'TRUE', graceSeconds = 120 }) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT user_id, TIMESTAMP_MICROS(event_timestamp) AS ts,
          IF(event_name = 'screen_view', 'screen', 'action') AS kind,
          IF(event_name = 'screen_view', ${GA4_SCREEN}, event_name) AS name
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name NOT IN (${GA4_PASSIVE_EVENTS}, 'notification_foreground', 'session_start', 'user_engagement', 'first_open', 'app_exception')
          AND ${population}
      ),
      people AS (SELECT user_id, MIN(ts) AS first_ts FROM ev GROUP BY user_id),
      conv AS (
        SELECT pp.user_id, MIN(o.created_at) AS outcome_ts
        FROM people pp
        JOIN (${outcomeSql}) o ON o.user_id = pp.user_id
          AND o.created_at >= TIMESTAMP_SUB(pp.first_ts, INTERVAL 10 MINUTE) AND DATE(o.created_at) <= CAST(@to AS DATE)
        GROUP BY pp.user_id
      ),
      totals AS (SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM conv) AS c FROM people),
      firsts AS (SELECT user_id, kind, name, MIN(ts) AS first_ts FROM ev WHERE name IS NOT NULL GROUP BY user_id, kind, name),
      did AS (
        SELECT f.kind, f.name, c.user_id IS NOT NULL AS converted
        FROM firsts f LEFT JOIN conv c USING (user_id)
        WHERE c.user_id IS NULL OR f.first_ts <= TIMESTAMP_ADD(c.outcome_ts, INTERVAL ${Number(graceSeconds)} SECOND)
      ),
      agg AS (
        SELECT kind, name, COUNT(*) AS users, COUNTIF(converted) AS converted, ANY_VALUE(t.n) AS n, ANY_VALUE(t.c) AS c
        FROM did CROSS JOIN totals t
        GROUP BY kind, name
        HAVING users >= 20
      )
      SELECT kind, name, name IN (${flowNames}) AS in_flow, users, converted, n AS population, c AS population_converted,
        ROUND(SAFE_DIVIDE(converted, users) * 100, 1) AS rate_pct,
        ROUND(SAFE_DIVIDE(c - converted, n - users) * 100, 1) AS rate_without_pct,
        ROUND(SAFE_DIVIDE(SAFE_DIVIDE(converted, users), SAFE_DIVIDE(c - converted, n - users)), 2) AS lift,
        ROUND(SAFE_DIVIDE(converted, c) * 100, 1) AS share_of_converted_pct
      FROM agg
      ORDER BY lift DESC, users DESC`,
    params: ga4Range(r),
  };
};
const subscriptionDrivers = (from, to) => ga4OutcomeDrivers(from, to, { outcomeSql: SUB_PAID_SQL, flowNames: SUB_FLOW_NAMES });

// People who signed up in the period: calendar days from sign-up to KYC
// verified and to their first paid buy (no end date, so recent sign-ups have
// had less time), plus the logged-in app sessions they had
// before that first buy. One row per bucket; the medians repeat on every row.
const SUB_DAY_BUCKET = (col) => `CASE WHEN ${col} IS NULL THEN '6_not_yet' WHEN ${col} <= 0 THEN '1_same_day'
          WHEN ${col} <= 3 THEN '2_1_3' WHEN ${col} <= 7 THEN '3_4_7' WHEN ${col} <= 30 THEN '4_8_30' ELSE '5_over_30' END`;
const subscriptionTiming = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH cohort AS (
        SELECT id AS user_id, created_at, verified_at FROM ${USERS}
        WHERE DATE(created_at) BETWEEN @from AND @to
      ),
      first_buy AS (
        SELECT p.user_id, MIN(p.created_at) AS buy_ts
        FROM (${SUB_PAID_SQL}) p JOIN cohort c USING (user_id)
        GROUP BY p.user_id
      ),
      sessions AS (
        SELECT e.user_id, COUNT(DISTINCT ${GA4_SESSION}) AS sessions_before
        FROM ${GA4_EVENTS} e
        JOIN first_buy f ON f.user_id = e.user_id AND TIMESTAMP_MICROS(e.event_timestamp) <= f.buy_ts
        WHERE _TABLE_SUFFIX >= @fromSuffix AND e.user_id IS NOT NULL
        GROUP BY e.user_id
      ),
      d AS (
        SELECT
          DATE_DIFF(DATE(c.verified_at), DATE(c.created_at), DAY) AS days_to_kyc,
          DATE_DIFF(DATE(f.buy_ts), DATE(c.created_at), DAY) AS days_to_buy,
          DATE_DIFF(DATE(f.buy_ts), DATE(c.verified_at), DAY) AS days_kyc_to_buy,
          s.sessions_before
        FROM cohort c LEFT JOIN first_buy f USING (user_id) LEFT JOIN sessions s USING (user_id)
      ),
      summary AS (
        SELECT COUNT(*) AS signed_up,
          APPROX_QUANTILES(days_to_kyc, 2)[OFFSET(1)] AS median_days_to_kyc,
          APPROX_QUANTILES(days_kyc_to_buy, 2)[OFFSET(1)] AS median_days_kyc_to_buy,
          APPROX_QUANTILES(days_to_buy, 2)[OFFSET(1)] AS median_days_to_buy,
          APPROX_QUANTILES(sessions_before, 2)[OFFSET(1)] AS median_sessions_before_buy
        FROM d
      ),
      b AS (
        SELECT 'kyc' AS milestone, ${SUB_DAY_BUCKET('days_to_kyc')} AS bucket FROM d
        UNION ALL
        SELECT 'buy', ${SUB_DAY_BUCKET('days_to_buy')} FROM d
      )
      SELECT b.bucket, COUNTIF(b.milestone = 'kyc') AS verified, COUNTIF(b.milestone = 'buy') AS first_buy, ANY_VALUE(s).*
      FROM b CROSS JOIN summary s
      GROUP BY b.bucket
      ORDER BY b.bucket`,
    params: ga4Range(r),
  };
};

// Logged-in app sessions against buy orders and paid buys, by WIB hour and
// weekday (1 = Sunday, BigQuery's DAYOFWEEK).
const subscriptionHours = (from, to) => {
  const r = range(from, to);
  const wib = (ts) => `DATETIME(${ts}, 'Asia/Jakarta')`;
  return {
    sql: `WITH s AS (
        SELECT EXTRACT(DAYOFWEEK FROM ${wib('TIMESTAMP_MICROS(event_timestamp)')}) AS dow,
          EXTRACT(HOUR FROM ${wib('TIMESTAMP_MICROS(event_timestamp)')}) AS hour, COUNT(*) AS sessions
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'session_start'
        GROUP BY dow, hour
      ),
      o AS (
        SELECT EXTRACT(DAYOFWEEK FROM ${wib('created_at')}) AS dow, EXTRACT(HOUR FROM ${wib('created_at')}) AS hour,
          COUNT(*) AS orders, COUNTIF(status IN (${SUB_PAID_STATUSES})) AS paid
        FROM ${TX}
        WHERE type = 'buy' AND DATE(created_at) BETWEEN @from AND @to AND IFNULL(payment_method, '') != 'manual_bonus'
        GROUP BY dow, hour
      )
      SELECT dow, hour, IFNULL(s.sessions, 0) AS sessions, IFNULL(o.orders, 0) AS orders, IFNULL(o.paid, 0) AS paid
      FROM s FULL JOIN o USING (dow, hour)
      ORDER BY dow, hour`,
    params: ga4Range(r),
  };
};

// The preset amount chips on the buy form: per chip, who tapped it, who paid
// a buy within a day of their first tap, and whether that buy kept the chip's
// amount.
const subscriptionChips = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH taps AS (
        SELECT user_id,
          CAST(COALESCE(${ga4Param('nominal', 'double')}, ${ga4Param('nominal', 'int')}, SAFE_CAST(${ga4Param('nominal')} AS FLOAT64)) AS INT64) AS chip,
          TIMESTAMP_MICROS(event_timestamp) AS ts
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'price_chips'
      ),
      per_user AS (SELECT chip, user_id, COUNT(*) AS taps, MIN(ts) AS first_ts FROM taps WHERE chip IS NOT NULL GROUP BY chip, user_id),
      paid AS (${SUB_PAID_SQL}),
      scored AS (
        SELECT u.chip, u.user_id, ANY_VALUE(u.taps) AS taps,
          ARRAY_AGG(IF(p.user_id IS NULL, NULL, STRUCT(p.amount, p.final_amount)) IGNORE NULLS ORDER BY p.created_at LIMIT 1)[SAFE_OFFSET(0)] AS buy
        FROM per_user u
        LEFT JOIN paid p ON p.user_id = u.user_id
          AND p.created_at BETWEEN TIMESTAMP_SUB(u.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(u.first_ts, INTERVAL 1 DAY)
        GROUP BY u.chip, u.user_id
      )
      SELECT chip, SUM(taps) AS taps, COUNT(*) AS users,
        COUNTIF(buy IS NOT NULL) AS paid_users,
        ROUND(SAFE_DIVIDE(COUNTIF(buy IS NOT NULL), COUNT(*)) * 100, 1) AS paid_pct,
        COUNTIF(buy.amount = chip) AS paid_chip_amount,
        APPROX_QUANTILES(buy.final_amount, 2)[OFFSET(1)] AS median_paid_amount
      FROM scored
      GROUP BY chip
      ORDER BY chip`,
    params: ga4Range(r),
  };
};

// ---- Analysis tabs shared pieces (Subscription, Onboarding, Redemption,
// Engagement). Every one joins GA4's user_id to main.users.id.
// A sell or switch is done once it reaches any of these; cancelled is not.
const DONE_STATUSES = `'completed', 'completed_payment', 'verified', 'verified_by_operational'`;
// Unpaid or in-flight sells keep final_amount at 0; amount is what was asked for.
const SELL_DONE_SQL = `SELECT id, user_id, fund_id, created_at, is_all_unit, COALESCE(NULLIF(final_amount, 0), amount) AS amount FROM ${TX}
        WHERE type = 'sell' AND status IN (${DONE_STATUSES})`;
// Live holdings value per person, same rule as the follow-up list above.
const USER_AUM_SQL = `SELECT h.user_id, CAST(SUM(h.unit * f.latest_nav_value) AS FLOAT64) AS aum
        FROM (
          SELECT user_id, fund_id, unit FROM ${PORT} WHERE deleted_at IS NULL AND unit > 0
          UNION ALL
          SELECT user_id, fund_id, unit FROM ${BONUS_PORT} WHERE status = 'on_going'
        ) h
        JOIN ${FUNDS} f ON f.id = h.fund_id
        GROUP BY h.user_id`;
const ga4Screens = (names) => `(event_name = 'screen_view' AND ${GA4_SCREEN} IN (${names}))`;

// How well the two sides line up for the period: logged-in app users found
// in main.users, and main-database buy, sell and switch rows with the
// matching app event within 10 minutes (the rest came from outside the app,
// such as admin entry, or the app's analytics did not send that event).
const analysisCoverage = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ga AS (
        SELECT DISTINCT user_id FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
      ),
      app AS (
        SELECT user_id, event_name, TIMESTAMP_MICROS(event_timestamp) AS ts FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name IN ('order_created', 'confirm_redeem_click', 'confirm_switch_click')
      ),
      db_rows AS (
        SELECT user_id, created_at, IF(type = 'buy', 'order_created', 'confirm_redeem_click') AS app_event FROM ${TX}
        WHERE type IN ('buy', 'sell') AND DATE(created_at) BETWEEN @from AND @to AND IFNULL(payment_method, '') != 'manual_bonus'
        UNION ALL
        SELECT user_id, created_at, 'confirm_switch_click' FROM ${SWITCHING} WHERE DATE(created_at) BETWEEN @from AND @to
      ),
      matched AS (
        SELECT app_event, EXISTS (SELECT 1 FROM app a WHERE a.user_id = x.user_id AND a.event_name = x.app_event
          AND a.ts BETWEEN TIMESTAMP_SUB(x.created_at, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(x.created_at, INTERVAL 10 MINUTE)) AS in_app
        FROM db_rows x
      ),
      signups AS (SELECT id FROM ${USERS} WHERE DATE(created_at) BETWEEN @from AND @to)
      SELECT
        (SELECT COUNT(*) FROM ga) AS app_users,
        (SELECT COUNT(*) FROM ga JOIN ${USERS} u ON u.id = ga.user_id) AS app_users_in_db,
        (SELECT COUNTIF(app_event = 'order_created') FROM matched) AS db_buys,
        (SELECT COUNTIF(app_event = 'order_created' AND in_app) FROM matched) AS db_buys_in_app,
        (SELECT COUNTIF(app_event = 'confirm_redeem_click') FROM matched) AS db_sells,
        (SELECT COUNTIF(app_event = 'confirm_redeem_click' AND in_app) FROM matched) AS db_sells_in_app,
        (SELECT COUNTIF(app_event = 'confirm_switch_click') FROM matched) AS db_switches,
        (SELECT COUNTIF(app_event = 'confirm_switch_click' AND in_app) FROM matched) AS db_switches_in_app,
        (SELECT COUNT(*) FROM signups) AS db_signups,
        (SELECT COUNT(*) FROM signups s JOIN ga ON ga.user_id = s.id) AS db_signups_in_app`,
    params: ga4Range(r),
  };
};

// Who opens the buy form and who goes on to pay, by what the main database
// knows about them: age (user_profiles.birthdate, 17 to 90 kept), gender,
// occupation, investment purpose, risk level from the risk questionnaire,
// and how long they had had an account when they first opened the form.
// Paid: a paid buy from 10 minutes before that first open to the period end.
const PROFILE_DIMS = `UNNEST([
          STRUCT('age_band' AS dimension, age_band AS value), ('gender', gender), ('occupation', occupation),
          ('purpose', purpose), ('risk_level', risk_level), ('tenure', tenure)])`;
const subscriptionProfile = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH opens AS (
        SELECT user_id, MIN(TIMESTAMP_MICROS(event_timestamp)) AS t1
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND (event_name = 'buy_bottom_sheet' OR ${ga4Screens(SUB_FORM_SCREENS)})
        GROUP BY user_id
      ),
      paid AS (${SUB_PAID_SQL}),
      scored AS (
        SELECT o.user_id, o.t1, SUM(p.final_amount) AS paid_amount
        FROM opens o
        LEFT JOIN paid p ON p.user_id = o.user_id AND p.created_at BETWEEN TIMESTAMP_SUB(o.t1, INTERVAL 10 MINUTE) AND ${SUB_PAID_UNTIL}
        GROUP BY o.user_id, o.t1
      ),
      prof AS (
        SELECT paid_amount,
          CASE WHEN age BETWEEN 17 AND 24 THEN '1_17_24' WHEN age BETWEEN 25 AND 34 THEN '2_25_34' WHEN age BETWEEN 35 AND 44 THEN '3_35_44'
            WHEN age BETWEEN 45 AND 54 THEN '4_45_54' WHEN age BETWEEN 55 AND 90 THEN '5_55_plus' ELSE 'unknown' END AS age_band,
          IFNULL(up.gender, 'unknown') AS gender, IFNULL(up.occupation, 'unknown') AS occupation,
          IFNULL(up.investment_purpose, 'unknown') AS purpose, IFNULL(CAST(up.risk_level AS STRING), 'unknown') AS risk_level,
          CASE WHEN tenure < 30 THEN '1_under_30d' WHEN tenure < 180 THEN '2_30_180d' WHEN tenure < 365 THEN '3_180_365d'
            WHEN tenure < 730 THEN '4_1_2y' ELSE '5_over_2y' END AS tenure
        FROM (
          SELECT s.paid_amount, up.gender, up.occupation, up.investment_purpose, up.risk_level,
            DATE_DIFF(DATE(s.t1), DATE(up.birthdate), YEAR) AS age, DATE_DIFF(DATE(s.t1), DATE(u.created_at), DAY) AS tenure
          FROM scored s JOIN ${USERS} u ON u.id = s.user_id LEFT JOIN ${USER_PROFILES} up ON up.user_id = s.user_id
        ) up
      )
      SELECT d.dimension, d.value, COUNT(*) AS opened_form, COUNTIF(paid_amount > 0) AS paid,
        ROUND(SAFE_DIVIDE(COUNTIF(paid_amount > 0), COUNT(*)) * 100, 1) AS paid_pct,
        SUM(IFNULL(paid_amount, 0)) AS paid_amount,
        APPROX_QUANTILES(IF(paid_amount > 0, paid_amount, NULL), 2)[OFFSET(1)] AS median_paid_amount
      FROM prof, ${PROFILE_DIMS} d
      GROUP BY d.dimension, d.value
      ORDER BY d.dimension, d.value`,
    params: ga4Range(r),
  };
};

// ---- Onboarding analysis: starts from the main database (everyone whose
// account was created in the period, institutions left out), then looks in
// GA4 for the KYC screens they reached, with no end date so a KYC finished
// after the period still counts. KYC screens in the app's order (Sep 2026):
// VerificationIntroScreen > IdentityPreviewScreen (KTP photo) >
// SelfiePreviewScreen > ProfileVerificationScreen > OccupationVerification
// > Address (and correspondence address) > BankVerificationScreen >
// SignatureVerificationScreen > VerificationSuccessScreen (submitted).
// Then the database again: KYC review (users.verification_status, with
// user_status_logs holding each pending > verified/failed decision since
// 21 Jul 2026), risk profile (user_profiles.risk_level) and first paid buy.
// Steps count everyone who reached them, so a later step can only exceed
// an earlier one when app tracking missed a screen. Columns are addr_step
// and sign_step, not address and signature: runQuery strips any column
// with those names from every result (KYC redaction, bigquery.js).
const ONB_COHORT_SQL = `SELECT id AS user_id, created_at, verification_status, verified_at FROM ${USERS}
        WHERE DATE(created_at) BETWEEN @from AND @to AND NOT IFNULL(is_institution, FALSE)`;
const onboardingFunnel = (from, to) => {
  const r = range(from, to);
  const reached = (cond) => `LOGICAL_OR(${cond})`;
  return {
    sql: `WITH cohort AS (${ONB_COHORT_SQL}),
      ev AS (
        SELECT e.user_id, e.platform, e.event_name, TIMESTAMP_MICROS(e.event_timestamp) AS ts,
          IF(e.event_name = 'screen_view', ${GA4_SCREEN}, NULL) AS screen
        FROM ${GA4_EVENTS} e JOIN cohort c ON c.user_id = e.user_id
        WHERE _TABLE_SUFFIX >= @fromSuffix
      ),
      app AS (
        SELECT user_id, ARRAY_AGG(platform IGNORE NULLS ORDER BY ts LIMIT 1)[SAFE_OFFSET(0)] AS platform,
          ${reached(`screen = 'VerificationIntroScreen' OR event_name = 'kyc_start'`)} AS kyc_intro,
          ${reached(`screen = 'IdentityPreviewScreen'`)} AS ktp,
          ${reached(`screen = 'SelfiePreviewScreen'`)} AS selfie,
          ${reached(`screen = 'ProfileVerificationScreen'`)} AS personal,
          ${reached(`screen = 'OccupationVerificationScreen'`)} AS occupation,
          ${reached(`screen IN ('AddressVerificationScreen', 'CorrespondenceAddressVerificationScreen')`)} AS addr_step,
          ${reached(`screen = 'BankVerificationScreen'`)} AS bank,
          ${reached(`screen = 'SignatureVerificationScreen'`)} AS sign_step,
          ${reached(`screen = 'VerificationSuccessScreen' OR event_name = 'kyc_success'`)} AS submitted
        FROM ev GROUP BY user_id
      ),
      first_buy AS (SELECT p.user_id FROM (${SUB_PAID_SQL}) p JOIN cohort USING (user_id) GROUP BY p.user_id),
      base AS (
        SELECT c.verification_status, IFNULL(a.platform, '(not in app)') AS platform, a.user_id IS NOT NULL AS in_app,
          a.kyc_intro, a.ktp, a.selfie, a.personal, a.occupation, a.addr_step, a.bank, a.sign_step, a.submitted,
          up.risk_level IS NOT NULL AS risk_profiled, b.user_id IS NOT NULL AS bought
        FROM cohort c
        LEFT JOIN app a USING (user_id)
        LEFT JOIN ${USER_PROFILES} up ON up.user_id = c.user_id
        LEFT JOIN first_buy b ON b.user_id = c.user_id
      )
      SELECT IF(GROUPING(platform) = 1, 'all', platform) AS segment,
        COUNT(*) AS signed_up, COUNTIF(in_app) AS in_app,
        COUNTIF(kyc_intro) AS kyc_intro, COUNTIF(ktp) AS ktp, COUNTIF(selfie) AS selfie, COUNTIF(personal) AS personal,
        COUNTIF(occupation) AS occupation, COUNTIF(addr_step) AS addr_step, COUNTIF(bank) AS bank,
        COUNTIF(sign_step) AS sign_step, COUNTIF(submitted) AS submitted,
        COUNTIF(verification_status = 'verified') AS verified,
        COUNTIF(verification_status = 'failed') AS failed,
        COUNTIF(risk_profiled) AS risk_profiled,
        COUNTIF(bought) AS first_buy
      FROM base
      GROUP BY GROUPING SETS ((), (platform))
      ORDER BY segment = 'all' DESC, signed_up DESC`,
    params: ga4Range(r),
  };
};

// The same sign-ups by where KYC ended up: verified first time, verified
// after a failed review, failed, waiting for review, or never submitted.
// Per outcome: median minutes in the app from opening KYC to submitting it,
// app sessions until submitting, hours from submitting to the review
// decision (user_status_logs), and paid buys. Then one row per "rejected"
// screen the app showed (which part of KYC was sent back) with how many of
// those people are verified now.
const onboardingOutcome = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH cohort AS (${ONB_COHORT_SQL}),
      ev AS (
        SELECT e.user_id, e.event_name, TIMESTAMP_MICROS(e.event_timestamp) AS ts, ${GA4_SESSION} AS session_id,
          IF(e.event_name = 'screen_view', ${GA4_SCREEN}, NULL) AS screen
        FROM ${GA4_EVENTS} e JOIN cohort c ON c.user_id = e.user_id
        WHERE _TABLE_SUFFIX >= @fromSuffix
      ),
      app AS (
        SELECT user_id,
          MIN(IF(screen = 'VerificationIntroScreen' OR event_name = 'kyc_start', ts, NULL)) AS kyc_start_ts,
          MIN(IF(screen = 'VerificationSuccessScreen' OR event_name = 'kyc_success', ts, NULL)) AS submit_ts
        FROM ev GROUP BY user_id
      ),
      sessions AS (
        SELECT e.user_id, COUNT(DISTINCT e.session_id) AS sessions_to_submit
        FROM ev e JOIN app a USING (user_id)
        WHERE a.submit_ts IS NOT NULL AND e.ts <= a.submit_ts
        GROUP BY e.user_id
      ),
      review AS (
        SELECT l.user_id, MIN(IF(l.status = 'verified', l.created_at, NULL)) AS verified_ts, MIN(IF(l.status = 'failed', l.created_at, NULL)) AS failed_ts
        FROM \`sayakaya.main.user_status_logs\` l JOIN cohort USING (user_id)
        GROUP BY l.user_id
      ),
      buys AS (
        SELECT p.user_id, MIN(p.created_at) AS first_buy_ts, ARRAY_AGG(p.final_amount ORDER BY p.created_at LIMIT 1)[OFFSET(0)] AS first_amount
        FROM (${SUB_PAID_SQL}) p JOIN cohort USING (user_id) GROUP BY p.user_id
      ),
      scored AS (
        SELECT c.user_id,
          CASE
            WHEN c.verification_status = 'verified' AND rv.failed_ts IS NOT NULL THEN '2_verified_after_fail'
            WHEN c.verification_status = 'verified' THEN '1_verified'
            WHEN c.verification_status = 'failed' THEN '3_failed'
            WHEN c.verification_status = 'pending_verification' THEN '4_waiting'
            WHEN a.submit_ts IS NOT NULL THEN '5_submitted_not_reviewed'
            ELSE '6_not_submitted'
          END AS outcome,
          TIMESTAMP_DIFF(a.submit_ts, a.kyc_start_ts, SECOND) / 60 AS fill_min,
          s.sessions_to_submit,
          TIMESTAMP_DIFF(COALESCE(rv.verified_ts, rv.failed_ts), a.submit_ts, MINUTE) / 60 AS review_hours,
          b.first_buy_ts IS NOT NULL AS bought,
          b.first_buy_ts <= TIMESTAMP_ADD(TIMESTAMP(c.created_at), INTERVAL 7 DAY) AS bought_7d,
          b.first_amount
        FROM cohort c
        LEFT JOIN app a USING (user_id) LEFT JOIN sessions s USING (user_id)
        LEFT JOIN review rv USING (user_id) LEFT JOIN buys b USING (user_id)
      ),
      rejected AS (
        SELECT e.user_id, e.screen FROM ev e
        WHERE e.screen IN ('IdentityRejectedScreen', 'ProfileRejectedScreen', 'OccupationRejectedScreen', 'AddressRejectedScreen', 'BankRejectedScreen')
        GROUP BY e.user_id, e.screen
      )
      SELECT 'outcome' AS kind, outcome AS name, COUNT(*) AS users,
        ROUND(APPROX_QUANTILES(IF(fill_min >= 0, fill_min, NULL), 2)[OFFSET(1)], 1) AS median_fill_min,
        APPROX_QUANTILES(sessions_to_submit, 2)[OFFSET(1)] AS median_sessions,
        ROUND(APPROX_QUANTILES(IF(review_hours >= 0, review_hours, NULL), 2)[OFFSET(1)], 1) AS median_review_hours,
        COUNTIF(bought_7d) AS bought_7d, COUNTIF(bought) AS bought,
        APPROX_QUANTILES(first_amount, 2)[OFFSET(1)] AS median_first_buy,
        CAST(NULL AS INT64) AS verified_now
      FROM scored GROUP BY outcome
      UNION ALL
      SELECT 'rejected', rj.screen, COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL,
        COUNTIF(c.verification_status = 'verified')
      FROM rejected rj JOIN cohort c USING (user_id)
      GROUP BY rj.screen
      ORDER BY kind, name`,
    params: ga4Range(r),
  };
};

// ---- Redemption analysis -------------------------------------------------
// An ordered app funnel that ends in a main-database row: per person, the
// first time in the period they reached each app step, each one counted only
// after the step before it (so the numbers only go down), then whether a
// matching database row was written from 10 minutes before their last app
// step onward. steps: SQL conditions on one GA4 event. Everyone and per
// platform (at the first step).
const ga4OrderedFunnel = (from, to, steps, doneSql) => {
  const r = range(from, to);
  const n = steps.length;
  const idx = [...Array(n).keys()].map((i) => i + 1);
  return {
    sql: `WITH ev AS (
        SELECT user_id, platform, TIMESTAMP_MICROS(event_timestamp) AS ts,
          CASE ${steps.map((cond, i) => `WHEN ${cond} THEN ${i + 1}`).join(' ')} END AS step
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
      ),
      s1 AS (SELECT user_id, MIN(ts) AS t1, ARRAY_AGG(platform ORDER BY ts LIMIT 1)[OFFSET(0)] AS platform FROM ev WHERE step = 1 GROUP BY user_id),
      ${idx.slice(1).map((i) => `s${i} AS (SELECT s.user_id, MIN(e.ts) AS t${i} FROM s${i - 1} s JOIN ev e ON e.user_id = s.user_id AND e.step = ${i} AND e.ts >= s.t${i - 1} GROUP BY s.user_id),`).join('\n      ')}
      done AS (
        SELECT s.user_id, MIN(d.created_at) AS done_ts
        FROM s${n} s JOIN (${doneSql}) d ON d.user_id = s.user_id
          AND d.created_at BETWEEN TIMESTAMP_SUB(s.t${n}, INTERVAL 10 MINUTE) AND ${SUB_PAID_UNTIL}
        GROUP BY s.user_id
      )
      SELECT IF(GROUPING(platform) = 1, 'all', platform) AS segment,
        ${idx.map((i) => `COUNT(t${i}) AS step${i}`).join(', ')}, COUNT(done_ts) AS done,
        ROUND(SAFE_DIVIDE(COUNT(done_ts), COUNT(t1)) * 100, 1) AS done_pct,
        ROUND(APPROX_QUANTILES(TIMESTAMP_DIFF(t${n}, t1, SECOND) / 60, 2)[OFFSET(1)], 1) AS median_min_to_confirm
      FROM s1 ${idx.slice(1).map((i) => `LEFT JOIN s${i} USING (user_id)`).join(' ')} LEFT JOIN done USING (user_id)
      GROUP BY GROUPING SETS ((), (platform))
      ORDER BY segment = 'all' DESC, step1 DESC`,
    params: ga4Range(r),
  };
};
// Sell flow (Sep 2026): redeem_click (portfolio page) > RedemptionFormBottomSheet
// > redeem_product_click > RedemptionCheckoutScreen > confirm_redeem_click,
// then the redemption questionnaire, which comes after confirming.
const redemptionFunnel = (from, to) => ga4OrderedFunnel(from, to, [
  `event_name = 'redeem_click' OR ${ga4Screens(`'RedemptionFormBottomSheet'`)}`,
  `event_name = 'redeem_product_click' OR ${ga4Screens(`'RedemptionCheckoutScreen'`)}`,
  `event_name = 'confirm_redeem_click'`,
], SELL_DONE_SQL);
// Switch flow: switch_click > SwitchProductFormBottomSheet > fund list >
// switch_product_click > SwitchProductConfirmationScreen > confirm_switch_click.
const switchingFunnel = (from, to) => ga4OrderedFunnel(from, to, [
  `event_name = 'switch_click' OR ${ga4Screens(`'SwitchProductFormBottomSheet'`)}`,
  ga4Screens(`'SwitchProductFundListScreen'`),
  `event_name = 'switch_product_click' OR ${ga4Screens(`'SwitchProductConfirmationScreen'`)}`,
  `event_name = 'confirm_switch_click'`,
], `SELECT user_id, created_at FROM ${SWITCHING} WHERE status IN (${DONE_STATUSES})`);

// Every sell done in the period (main database, app or not), cut four ways:
// all, how long the person had held that fund (since their first paid buy or
// switch-in of it), fund type, and full or partial. Per cut: amount, the
// share that were full redemptions, people who paid a new buy within 30
// days, people holding nothing today, and sells with the app's confirm event.
const REDEEM_HELD_BAND = `CASE WHEN held_days IS NULL THEN 'unknown' WHEN held_days < 30 THEN '1_under_30d' WHEN held_days < 90 THEN '2_30_90d'
          WHEN held_days < 180 THEN '3_90_180d' WHEN held_days < 365 THEN '4_180_365d' ELSE '5_over_1y' END`;
const redemptionProfile = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH s AS (SELECT * FROM (${SELL_DONE_SQL}) WHERE DATE(created_at) BETWEEN @from AND @to),
      first_in AS (
        SELECT user_id, fund_id, MIN(created_at) AS first_in FROM ${TX}
        WHERE type IN ('buy', 'SWITCH_IN') AND status IN (${DONE_STATUSES}) GROUP BY user_id, fund_id
      ),
      paid AS (${SUB_PAID_SQL}),
      aum AS (${USER_AUM_SQL}),
      app AS (
        SELECT user_id, TIMESTAMP_MICROS(event_timestamp) AS ts FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'confirm_redeem_click'
      ),
      scored AS (
        SELECT s.*, f.type AS fund_type, DATE_DIFF(DATE(s.created_at), DATE(fi.first_in), DAY) AS held_days,
          EXISTS (SELECT 1 FROM paid p WHERE p.user_id = s.user_id
            AND p.created_at > s.created_at AND p.created_at <= TIMESTAMP_ADD(s.created_at, INTERVAL 30 DAY)) AS rebought,
          IFNULL(a.aum, 0) = 0 AS holds_nothing,
          EXISTS (SELECT 1 FROM app x WHERE x.user_id = s.user_id
            AND x.ts BETWEEN TIMESTAMP_SUB(s.created_at, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(s.created_at, INTERVAL 10 MINUTE)) AS via_app
        FROM s
        LEFT JOIN ${FUNDS} f ON f.id = s.fund_id
        LEFT JOIN first_in fi ON fi.user_id = s.user_id AND fi.fund_id = s.fund_id
        LEFT JOIN aum a ON a.user_id = s.user_id
      )
      SELECT d.dimension, d.value, COUNT(*) AS sells, COUNT(DISTINCT user_id) AS people, SUM(amount) AS amount,
        ROUND(SAFE_DIVIDE(COUNTIF(is_all_unit), COUNT(*)) * 100, 1) AS full_pct,
        APPROX_QUANTILES(held_days, 2)[OFFSET(1)] AS median_held_days,
        COUNT(DISTINCT IF(rebought, user_id, NULL)) AS rebought_people,
        COUNT(DISTINCT IF(holds_nothing, user_id, NULL)) AS left_people,
        COUNTIF(via_app) AS via_app
      FROM scored, UNNEST([
          STRUCT('all' AS dimension, 'all' AS value), ('held', ${REDEEM_HELD_BAND}),
          ('fund_type', IFNULL(fund_type, 'unknown')), ('size', IF(is_all_unit, 'full', 'partial'))]) d
      GROUP BY d.dimension, d.value
      ORDER BY d.dimension, d.value`,
    params: ga4Range(r),
  };
};

// What investors did in the app before they redeemed, against investors who
// did not redeem: the same lift rule as Subscription analysis' drivers, over
// people who already had a paid buy before the period. The flow list also
// holds the way to the sell button (portfolio page, a fund inside it) and
// the PIN every transaction asks for: nearly every seller passes them.
const REDEEM_FLOW_NAMES = `'redeem_click', 'redeem_product_click', 'confirm_redeem_click', 'redemption_terms_click', 'redeem_portfolio_bonus_click',
        'RedemptionFormBottomSheet', 'RedemptionCheckoutScreen', 'RedemptionQuestionnaireScreen', 'TransactionSuccessScreen',
        'GoalDetailScreen', 'product_in_portfolio_click', 'portfolio_detail_click', 'PinScreen', 'pin_on_submit'`;
const redemptionSignals = (from, to) => ga4OutcomeDrivers(from, to, {
  outcomeSql: SELL_DONE_SQL,
  flowNames: REDEEM_FLOW_NAMES,
  population: `user_id IN (SELECT user_id FROM ${TX} WHERE type = 'buy' AND status IN (${SUB_PAID_STATUSES}) AND DATE(created_at) < CAST(@from AS DATE))`,
  graceSeconds: -2,
});

// ---- Engagement analysis -------------------------------------------------
// App features (Sep 2026 event and screen names) grouped by what they are for.
const ENG_FEATURES = {
  search: { events: ['search_trigger', 'search_result_click', 'search_history_click'], screens: ['ProductSearchScreen'] },
  sort_filter: { events: ['sort_filter_open', 'sort_filter_apply'] },
  watchlist: { events: ['watchlist_product_click', 'all_watchlist_product_click'], screens: ['WatchlistScreen'] },
  compare: { screens: ['ProductComparisonScreen'] },
  expert_picks: { events: ['mutual_fund_by_expert_click', 'mutual_fund_by_expert_invest_click', 'mutual_fund_by_expert_product_click', 'mutual_fund_by_expert_detail_click'] },
  goal_planning: {
    events: ['create_portfolio_click', 'set_portfolio_target_click', 'set_portfolio_strategy_click', 'set_portfolio_risk_level_click', 'portfolio_target_amount_fill', 'portfolio_target_time_fill', 'edit_portfolio_click'],
    screens: ['CreateGoalScreen', 'CreateGoalStrategyScreen', 'CreateGoalRecommendationScreen', 'UpdateGoalScreen'],
  },
  calculators: {
    events: ['simulation_click', 'simulation_budget_click', 'simulation_calculate_click', 'calculate_budget_click', 'simulation_housing_budget_click', 'simulation_housing_loan_saving_click', 'simulation_recalculate_click', 'simulation_calculation_formula_click'],
    screens: ['CalculatorsScreen'],
  },
  learning: { events: ['news_click', 'all_news_click', 'news_share_click', 'investment_dictionary_click', 'tutorial_click', 'faq_click'], screens: ['TutorialDetailScreen'] },
  promo: { events: ['all_promo_click', 'promo_click', 'promo_product_click', 'promo_code_copy'] },
  referral: { events: ['referral_click'] },
  notifications: { events: ['notification_open', 'notification_detail_click'], screens: ['NotificationsScreen'] },
  help: { events: ['live_chat_click', 'help_center_click', 'telegram_community_click'], screens: ['CsChatScreen'] },
  manager_pages: { events: ['sharia_click'], screens: ['InvestmentManagerScreen', 'FundGroupDetailScreen'] },
  reports: { events: ['estatement_click', 'send_spt_email_click'], screens: ['TaxReportScreen'] },
};
const ENG_FEATURE_CASE = `CASE ${Object.entries(ENG_FEATURES).map(([key, f]) => [
  ...(f.events ? [`WHEN event_name IN (${f.events.map((e) => `'${e}'`).join(', ')}) THEN '${key}'`] : []),
  ...(f.screens ? [`WHEN ${ga4Screens(f.screens.map((e) => `'${e}'`).join(', '))} THEN '${key}'`] : []),
].join(' ')).join(' ')} END`;
// Paid buys and done sells in the period per person (main database).
const PERIOD_TX_SQL = `SELECT user_id, COUNTIF(type = 'buy') AS buys, SUM(IF(type = 'buy', final_amount, 0)) AS buy_amount, COUNTIF(type = 'sell') AS sells
        FROM ${TX}
        WHERE type IN ('buy', 'sell') AND status IN (${DONE_STATUSES}) AND IFNULL(payment_method, '') != 'manual_bonus'
          AND DATE(created_at) BETWEEN @from AND @to
        GROUP BY user_id`;

// Per feature: logged-in people who used it in the period, against every
// logged-in app user (the "all" row), by what the main database says about
// them: holding a portfolio today and its median value, and paid buys and
// done sells in the period (at any point in it, not necessarily after using
// the feature).
const engagementFeatures = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH ev AS (
        SELECT user_id, ${ENG_FEATURE_CASE} AS feature
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name NOT IN (${GA4_PASSIVE_EVENTS}, 'notification_foreground')
      ),
      app_users AS (SELECT DISTINCT user_id FROM ev),
      used AS (SELECT DISTINCT user_id, feature FROM ev WHERE feature IS NOT NULL),
      aum AS (${USER_AUM_SQL}),
      tx AS (${PERIOD_TX_SQL}),
      u AS (
        SELECT a.user_id, IFNULL(m.aum, 0) AS aum, IFNULL(t.buys, 0) > 0 AS bought, IFNULL(t.buy_amount, 0) AS buy_amount, IFNULL(t.sells, 0) > 0 AS sold
        FROM app_users a LEFT JOIN aum m USING (user_id) LEFT JOIN tx t USING (user_id)
      ),
      x AS (SELECT 'all' AS feature, u.* FROM u UNION ALL SELECT used.feature, u.* FROM used JOIN u USING (user_id))
      SELECT feature, COUNT(*) AS users,
        COUNTIF(aum > 0) AS holders, ROUND(SAFE_DIVIDE(COUNTIF(aum > 0), COUNT(*)) * 100, 1) AS holder_pct,
        APPROX_QUANTILES(IF(aum > 0, aum, NULL), 2)[OFFSET(1)] AS median_aum,
        COUNTIF(bought) AS buyers, ROUND(SAFE_DIVIDE(COUNTIF(bought), COUNT(*)) * 100, 1) AS buyer_pct, SUM(buy_amount) AS buy_amount,
        COUNTIF(sold) AS sellers, ROUND(SAFE_DIVIDE(COUNTIF(sold), COUNT(*)) * 100, 1) AS seller_pct
      FROM x
      GROUP BY feature
      ORDER BY feature = 'all' DESC, users DESC`,
    params: ga4Range(r),
  };
};

// What people type into fund search (whole terms, lower-cased): who searched,
// who tapped a result in the same session within 30 minutes, who paid any
// buy within 7 days, and who paid a buy of a fund they tapped (fund name
// matched to main.funds). Terms fewer than 2 people typed are hidden: a
// single person's term can be a reference number or a name.
const engagementSearch = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH s AS (
        SELECT user_id, ${GA4_SESSION} AS session_id, TIMESTAMP_MICROS(event_timestamp) AS ts, LOWER(TRIM(${ga4Param('name')})) AS term
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'search_trigger'
      ),
      c AS (
        SELECT user_id, ${GA4_SESSION} AS session_id, TIMESTAMP_MICROS(event_timestamp) AS ts, ${ga4Param('product_name')} AS fund
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name = 'search_result_click'
      ),
      per AS (SELECT term, user_id, COUNT(*) AS searches, MIN(ts) AS first_ts FROM s WHERE IFNULL(term, '') != '' GROUP BY term, user_id),
      clicks AS (
        SELECT DISTINCT s.term, s.user_id, c.fund
        FROM s JOIN c ON c.user_id = s.user_id AND c.session_id = s.session_id AND c.ts BETWEEN s.ts AND TIMESTAMP_ADD(s.ts, INTERVAL 30 MINUTE)
        WHERE c.fund IS NOT NULL
      ),
      paid AS (
        SELECT p.user_id, p.created_at, LOWER(f.name) AS fund FROM ${TX} p JOIN ${FUNDS} f ON f.id = p.fund_id
        WHERE p.type = 'buy' AND p.status IN (${SUB_PAID_STATUSES}) AND IFNULL(p.payment_method, '') != 'manual_bonus'
      ),
      bought_any AS (
        SELECT DISTINCT per.term, per.user_id FROM per JOIN paid p ON p.user_id = per.user_id
          AND p.created_at BETWEEN per.first_ts AND TIMESTAMP_ADD(per.first_ts, INTERVAL 7 DAY)
      ),
      bought_clicked AS (
        SELECT DISTINCT cl.term, cl.user_id FROM clicks cl
        JOIN per USING (term, user_id)
        JOIN paid p ON p.user_id = cl.user_id AND p.fund = LOWER(cl.fund)
          AND p.created_at BETWEEN per.first_ts AND TIMESTAMP_ADD(per.first_ts, INTERVAL 7 DAY)
      ),
      tapped AS (SELECT DISTINCT term, user_id FROM clicks),
      top AS (
        SELECT term, STRING_AGG(fund, ', ' ORDER BY n DESC, fund LIMIT 3) AS top_tapped
        FROM (SELECT term, fund, COUNT(*) AS n FROM clicks GROUP BY term, fund)
        GROUP BY term
      )
      SELECT per.term, SUM(per.searches) AS searches, COUNT(*) AS users,
        COUNT(tp.user_id) AS tapped_users,
        COUNT(ba.user_id) AS bought_users, COUNT(bc.user_id) AS bought_tapped_users,
        ANY_VALUE(top.top_tapped) AS top_tapped
      FROM per
      LEFT JOIN tapped tp USING (term, user_id)
      LEFT JOIN bought_any ba USING (term, user_id)
      LEFT JOIN bought_clicked bc USING (term, user_id)
      LEFT JOIN top USING (term)
      GROUP BY per.term
      HAVING users >= 2
      ORDER BY users DESC, searches DESC
      LIMIT 50`,
    params: ga4Range(r),
  };
};

// How people narrow down funds: sort and filter choices, the expert-picks
// theme they open, and the risk level they land on when the app asks for a
// risk profile before showing a fund. Per choice: people, and who paid a
// buy within 7 days of first making it.
const engagementDiscovery = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH e AS (
        SELECT user_id, TIMESTAMP_MICROS(event_timestamp) AS ts,
          CASE event_name WHEN 'sort_filter_apply' THEN 'sort' WHEN 'mutual_fund_by_expert_click' THEN 'expert' ELSE 'risk_gate' END AS kind,
          CASE event_name
            WHEN 'sort_filter_apply' THEN CONCAT(IFNULL(${ga4Param('sort_by')}, '-'), ' / ', IFNULL(${ga4Param('sort_return_period')}, '-'))
            WHEN 'mutual_fund_by_expert_click' THEN ${ga4Param('goal_name')}
            ELSE COALESCE(CAST(${ga4Param('level', 'int')} AS STRING), ${ga4Param('level')})
          END AS value
        FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL
          AND event_name IN ('sort_filter_apply', 'mutual_fund_by_expert_click', 'risk_profile_gate_completed')
      ),
      per AS (SELECT kind, IFNULL(value, '-') AS value, user_id, COUNT(*) AS events, MIN(ts) AS first_ts FROM e GROUP BY kind, value, user_id),
      paid AS (${SUB_PAID_SQL}),
      scored AS (
        SELECT per.*, EXISTS (SELECT 1 FROM paid p WHERE p.user_id = per.user_id
          AND p.created_at BETWEEN TIMESTAMP_SUB(per.first_ts, INTERVAL 10 MINUTE) AND TIMESTAMP_ADD(per.first_ts, INTERVAL 7 DAY)) AS paid_7d
        FROM per
      )
      SELECT kind, value, SUM(events) AS events, COUNT(*) AS users, COUNTIF(paid_7d) AS paid_users,
        ROUND(SAFE_DIVIDE(COUNTIF(paid_7d), COUNT(*)) * 100, 1) AS paid_pct
      FROM scored
      GROUP BY kind, value
      HAVING users >= 2
      ORDER BY kind, users DESC`,
    params: ga4Range(r),
  };
};

// Investors holding fund units they bought, today (main.portfolios; people
// holding only promo bonus units, mostly a few thousand rupiah from sign-up
// campaigns, and institutions are left out; bonus units still count toward
// AUM) by portfolio size and by how many days they opened the app in the period
// (logged in; pushes arriving and app updates do not count). Shows how much
// money sits with people who never opened the app, and whether active
// investors buy and sell more in the period.
const engagementActivity = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH holders AS (
        SELECT a.user_id, a.aum FROM (${USER_AUM_SQL}) a JOIN ${USERS} u ON u.id = a.user_id
        WHERE a.aum > 0 AND NOT IFNULL(u.is_institution, FALSE)
          AND a.user_id IN (SELECT user_id FROM ${PORT} WHERE deleted_at IS NULL AND unit > 0)
      ),
      act AS (
        SELECT user_id, COUNT(DISTINCT event_date) AS days FROM ${GA4_EVENTS}
        WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND user_id IS NOT NULL AND event_name NOT IN (${GA4_PASSIVE_EVENTS})
        GROUP BY user_id
      ),
      tx AS (${PERIOD_TX_SQL})
      SELECT
        CASE WHEN h.aum < 1e6 THEN '1_under_1m' WHEN h.aum < 1e7 THEN '2_1m_10m' WHEN h.aum < 1e8 THEN '3_10m_100m'
          WHEN h.aum < 1e9 THEN '4_100m_1b' ELSE '5_over_1b' END AS aum_tier,
        CASE WHEN IFNULL(a.days, 0) = 0 THEN '0_none' WHEN a.days <= 2 THEN '1_1_2' WHEN a.days <= 9 THEN '2_3_9' ELSE '3_10_plus' END AS activity,
        COUNT(*) AS holders, SUM(h.aum) AS aum,
        COUNTIF(IFNULL(t.buys, 0) > 0) AS bought, COUNTIF(IFNULL(t.sells, 0) > 0) AS sold
      FROM holders h LEFT JOIN act a USING (user_id) LEFT JOIN tx t USING (user_id)
      GROUP BY aum_tier, activity
      ORDER BY aum_tier, activity`,
    params: ga4Range(r),
  };
};

// ---- Growth: campaigns, referrals, switching, manager/demographic AUM splits --
const CAMPAIGNS = '`sayakaya.main.campaigns`';
const SWITCHING = '`sayakaya.main.switching_transactions`';
const IM = '`sayakaya.main.investment_managers`';

const campaignPerformance = (limit = 50) => ({
  sql: `SELECT name, campaign_type, promo_code, quota, used_quota,
      ROUND(SAFE_DIVIDE(used_quota, quota) * 100, 1) AS redemption_pct,
      bonus_amount, ROUND(used_quota * bonus_amount) AS est_cost,
      start_date, end_date
    FROM ${CAMPAIGNS}
    WHERE deleted_at IS NULL
    ORDER BY used_quota DESC LIMIT @limit`,
  params: { limit: parseInt(limit, 10) },
});

// Fund-to-fund switching flow: which funds bleed AUM to which.
const switchingTopPairs = (limit = 15) => ({
  sql: `SELECT fo.name AS from_fund, fd.name AS to_fund,
      COUNT(*) AS switches, SUM(s.origin_amount) AS amount
    FROM ${SWITCHING} s
    JOIN ${FUNDS} fo ON fo.id = s.origin_fund_id
    JOIN ${FUNDS} fd ON fd.id = s.destination_fund_id
    WHERE s.status = 'completed'
    GROUP BY from_fund, to_fund
    ORDER BY amount DESC LIMIT @limit`,
  params: { limit: parseInt(limit, 10) },
});

// Market AUM rolled up by investment manager (same source as the fund-type chart).
const aumByManager = (limit = 15) => ({
  sql: `SELECT COALESCE(im.common_name, im.name) AS label,
      COUNT(*) AS fund_count, SUM(IFNULL(f.latest_aum_value, 0)) AS aum
    FROM ${FUNDS} f
    LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
    WHERE f.listing_status = 'ACTIVE'
    GROUP BY label
    ORDER BY aum DESC LIMIT @limit`,
  params: { limit: parseInt(limit, 10) },
});

// Overview "Largest funds by AUM": one daily batch from portfolio_with_code
// (one row per sid_code+fund+day), not funds.latest_aum_value/snapshots —
// those lag the actual book, and not portfolio_fix — that only has history
// back to early August, and this panel needs to backtrace older dates too.
// Same -1 day correction as the rest of the portfolio_with_code queries in
// this file (created_at's date is a day ahead of the AUM date it
// represents). AUM = SUM(amount) of that batch; investors = COUNT(DISTINCT
// sid_code). groupBy switches the rollup between fund and investment
// manager; excludeFunds drops those funds before the rollup so an MI's total
// reflects the exclusion too. Shows every fund/MI — no LIMIT. The last row
// (is_total) is the grand total; its investors are counted once even when
// they hold several funds, which a sum of the rows above would double count.
const largestFundsLatestDate = () => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_WITH_CODE}`,
  params: {},
});

const largestFundsAum = (groupBy = 'fund', date, excludeFunds = [], userFilter = []) => {
  const label = groupBy === 'manager' ? 'COALESCE(im.common_name, im.name)' : 'f.name';
  const names = (Array.isArray(excludeFunds) ? excludeFunds : []).filter(Boolean);
  const params = { date };
  let excludeFilter = '';
  if (names.length) { excludeFilter = 'WHERE f.name NOT IN UNNEST(@excludeFunds)'; params.excludeFunds = names; }
  return {
    sql: `WITH latest AS (
        SELECT sid_code, id AS fund_id, amount
        FROM ${PORT_WITH_CODE}
        WHERE DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date AND total_unit > 0${userFilterClause(params, 'sid_code', userFilter, 'sid_code')}
      ),
      joined AS (
        SELECT ${label} AS label, l.amount, l.sid_code
        FROM latest l
        JOIN ${FUNDS} f ON f.id = l.fund_id
        LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
        ${excludeFilter}
      )
      SELECT label,
        ROUND(SUM(amount)) AS aum,
        ROUND(SAFE_DIVIDE(100 * SUM(amount), (SELECT SUM(amount) FROM joined)), 2) AS pct_of_total,
        COUNT(DISTINCT sid_code) AS investors,
        FALSE AS is_total
      FROM joined
      GROUP BY label
      UNION ALL
      SELECT 'Total', ROUND(SUM(amount)), 100.0, COUNT(DISTINCT sid_code), TRUE
      FROM joined
      HAVING COUNT(*) > 0
      ORDER BY is_total, aum DESC`,
    params,
  };
};

// Platform AUM KPI card, as of a chosen date — deliberately its own date
// (defaults to the latest available, via largestFundsLatestDate above),
// decoupled from the buy/sell/transaction date range at the top of the page:
// that range never scoped this figure, which was confusing when the two
// pickers sat side by side. Same source/shape as largestFundsAum just above
// (portfolio_with_code, -1 day correction), rolled up to one platform total
// instead of per-fund/manager rows.
// Joined to FUNDS and filtered to listing_status='ACTIVE' — a liquidated fund
// stops being a real ongoing position once it's inactive (its NAV/AUM just
// stays frozen at whatever it was on its last day), so it shouldn't keep
// counting toward "current" platform AUM after that point.
const platformAumAsOf = (date, fundIds = [], userFilter = []) => {
  const ids = normalizeFundIds(fundIds);
  const params = { date };
  const fundFilter = fundIdsClause(params, 'p.id', ids) + userFilterClause(params, 'p.sid_code', userFilter, 'sid_code');
  return {
    sql: `SELECT
        ROUND(SUM(p.amount)) AS platform_aum,
        COUNT(DISTINCT p.sid_code) AS investing_users
      FROM ${PORT_WITH_CODE} p
      JOIN ${FUNDS} f ON f.id = p.id
      WHERE DATE_SUB(DATE(p.created_at), INTERVAL 1 DAY) = @date AND p.total_unit > 0 AND f.listing_status = 'ACTIVE'${fundFilter}`,
    params,
  };
};

// Platform AUM from live holdings (funds.latest_nav_value) split by investor
// demographic — risk tolerance and income bracket. Note this is a different
// AUM definition than the Overview KPI/Largest funds table above, which both
// read a portfolio_with_code snapshot instead; the two can disagree slightly.
// fundIds narrows "active" to selected funds (used by the Overview map/city
// tables); callers that don't take a fund filter just pass an empty array.
function activeCte(params, ids) {
  return `active AS (
      SELECT p.user_id, p.unit, p.fund_id FROM ${PORT} p WHERE p.deleted_at IS NULL AND p.unit > 0${fundIdsClause(params, 'p.fund_id', ids)}
      UNION ALL
      SELECT bp.user_id, bp.unit, bp.fund_id FROM \`sayakaya.main.bonus_portfolios\` bp WHERE bp.status = 'on_going'${fundIdsClause(params, 'bp.fund_id', ids)}
    )`;
}

const aumByRisk = () => {
  const params = {};
  return {
    sql: `WITH ${activeCte(params, [])}
    SELECT IFNULL(up.investment_risk_tolerance, '(unknown)') AS label,
      COUNT(DISTINCT a.user_id) AS investors,
      ROUND(SUM(a.unit * f.latest_nav_value)) AS aum
    FROM active a
    JOIN ${FUNDS} f ON f.id = a.fund_id
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = a.user_id
    GROUP BY label ORDER BY aum DESC`,
    params,
  };
};

const aumByIncome = () => {
  const params = {};
  return {
    sql: `WITH ${activeCte(params, [])}
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
    params,
  };
};

// ---- Geographic distribution (Overview map) ---------------------------------
// user_profiles.id_address_city is NOT a free-text city name — it's the exact
// Kemendagri/BPS administrative code (e.g. "31.71"), matching main.geo's
// subdistrict_city_code one-for-one. main.geo is one row per *village*, so it's
// deduped to one row per city code first; otherwise the join would fan out
// every investor once per village in their city.
const GEO = '`sayakaya.main.geo`';
const CITY_LOOKUP_CTE = `city_lookup AS (
      SELECT DISTINCT subdistrict_city_code AS city_code, city_name, province_name
      FROM ${GEO}
    )`;

// One row per province — investor count + live AUM, for the Overview choropleth.
// province_name here must exactly match the `province_name` property baked into
// public/data/indonesia-provinces.json (see that file's generation notes).
// fundIds, when given, also switches investor_count/total_aum from "every
// investor" to "investors holding one of the selected funds" (LEFT -> INNER
// join on aum_by_user, which is itself already scoped to those funds).
const usersByProvince = (fundIds = [], userFilter = []) => {
  const ids = normalizeFundIds(fundIds);
  const params = {};
  const active = activeCte(params, ids);
  const aumJoin = ids.length ? 'JOIN' : 'LEFT JOIN';
  return {
    sql: `WITH ${CITY_LOOKUP_CTE},
    ${active},
    aum_by_user AS (
      SELECT a.user_id, SUM(a.unit * f.latest_nav_value) AS aum
      FROM active a JOIN ${FUNDS} f ON f.id = a.fund_id
      GROUP BY a.user_id
    )
    SELECT cl.province_name,
      COUNT(DISTINCT up.user_id) AS investor_count,
      ROUND(SUM(IFNULL(abu.aum, 0))) AS total_aum
    FROM ${USER_PROFILES} up
    JOIN city_lookup cl ON cl.city_code = up.id_address_city
    ${aumJoin} aum_by_user abu ON abu.user_id = up.user_id${userFilterClause(params, 'up.user_id', userFilter, 'id', '\n    WHERE ')}
    GROUP BY cl.province_name
    ORDER BY investor_count DESC`,
    params,
  };
};

// Top cities by investor count, and separately by AUM — the finer-grained
// companion to the province map (508 distinct cities is too many to put on
// one map at a glance, so these are ranked lists instead of a second map).
// Same join/shape for both, ordered differently — hence the shared builder.
// Same fundIds behavior as usersByProvince above.
function topCitiesQuery(limit, orderBy, fundIds = [], userFilter = []) {
  const ids = normalizeFundIds(fundIds);
  const params = { limit: parseInt(limit, 10) };
  const active = activeCte(params, ids);
  const aumJoin = ids.length ? 'JOIN' : 'LEFT JOIN';
  return {
    sql: `WITH ${CITY_LOOKUP_CTE},
      ${active},
      aum_by_user AS (
        SELECT a.user_id, SUM(a.unit * f.latest_nav_value) AS aum
        FROM active a JOIN ${FUNDS} f ON f.id = a.fund_id
        GROUP BY a.user_id
      )
      SELECT cl.city_name, cl.province_name,
        COUNT(DISTINCT up.user_id) AS investor_count,
        ROUND(SUM(IFNULL(abu.aum, 0))) AS total_aum
      FROM ${USER_PROFILES} up
      JOIN city_lookup cl ON cl.city_code = up.id_address_city
      ${aumJoin} aum_by_user abu ON abu.user_id = up.user_id${userFilterClause(params, 'up.user_id', userFilter, 'id', '\n      WHERE ')}
      GROUP BY cl.city_name, cl.province_name
      ORDER BY ${orderBy} DESC
      LIMIT @limit`,
    params,
  };
}
const topCitiesByInvestors = (limit = 15, fundIds = [], userFilter = []) => topCitiesQuery(limit, 'investor_count', fundIds, userFilter);
const topCitiesByAum = (limit = 15, fundIds = [], userFilter = []) => topCitiesQuery(limit, 'total_aum', fundIds, userFilter);

// Referral leaderboard: who brought in the most $ via referral_code/referrer_code.
const topReferrers = (limit = 20) => ({
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
  params: { limit: parseInt(limit, 10) },
});

// ---- Referral program: Sep-Dec 2026 T&C eligibility report ----------------
// main.user_referrals records the inviter/invitee link by user id at the time
// of referral (immutable), unlike invitee.referrer_code / inviter.referral_code
// string matching used elsewhere (e.g. the Growth tab's referral leaderboard):
// referral_code isn't unique (33 codes are currently shared by 2 users each,
// so a plain code JOIN double-counts/mis-attributes those invitees) and can
// be reassigned after the fact, silently breaking old links. RESOLVED_INVITER_CTE
// prefers user_referrals when a row exists, falling back to the code match
// otherwise — that table doesn't (yet) cover every historical referrer_code
// relationship, so falling back keeps the ones it's missing instead of
// dropping them from these reports.
const USER_REFERRALS = '`sayakaya.main.user_referrals`';
const RESOLVED_INVITER_CTE = `resolved_inviter AS (
    SELECT
      invitee.id AS invitee_id,
      COALESCE(ur.referrer_id, code_inviter.id) AS inviter_id
    FROM ${USERS} invitee
    LEFT JOIN ${USER_REFERRALS} ur ON ur.user_id = invitee.id
    LEFT JOIN (
      SELECT referral_code, MIN(id) AS id
      FROM ${USERS}
      WHERE referral_code IS NOT NULL
      GROUP BY referral_code
    ) code_inviter ON ur.referrer_id IS NULL AND code_inviter.referral_code = invitee.referrer_code
    WHERE ur.referrer_id IS NOT NULL OR invitee.referrer_code IS NOT NULL
  )`;

// Rules: the invitee's very first-ever completed transaction (across every
// fund, not just Sucor's) must itself be a Sucor Asset Management fund buy
// of >= Rp1,000,000, placed using someone else's referral code, inside the
// purchase window. The bonus additionally requires that fund's units to not
// decrease for 30 days after that purchase — checked against
// mi_fee_logs.portfolio_fix's daily snapshots (only completed transactions
// ever reach that table), not main.transactions, per how this fund's
// snapshots are read everywhere else in this file (created_at is one day
// ahead of the balance date it represents).
// id ASC is a deliberate tiebreaker: two of a user's transactions can share
// the exact same created_at (batch-imported data), and BigQuery's ARRAY_AGG
// ORDER BY has no defined order for ties — without it, this and the two
// referralInviterStats*() queries below (which independently compute the
// same "first-ever transaction") could each resolve a tie differently
// between requests, making the leaderboard silently disagree with this
// detail table over the same set of qualifying invitees.
// inviteeDateField: which invitee date gates the qualifying population —
// 'created_at' (registration date) for the main "Referral program" tab,
// 'verified_at' (KYC verification date) for "Referral Program (kyc based)" —
// see the two routes in server/app.js. Same -1-day grace window either way.
// This must stay in sync with the corresponding referralInviterStats*()
// leaderboard's own invited-population filter below (registration date vs.
// verification date, respectively) — otherwise this "qualifying" population
// (invitees whose first-ever transaction hits the campaign's own
// Sucor/>=1jt/period rule) could include invitees the leaderboard excluded
// entirely, silently breaking the invited >= transacted >= qualifying funnel
// the leaderboard is merged into.
const referralProgramDetail = (periodFrom, periodTo, inviteeDateField = 'created_at') => {
  const dateCol = inviteeDateField === 'verified_at' ? 'verified_at' : 'created_at';
  return {
  sql: `WITH first_tx AS (
      SELECT user_id,
        ARRAY_AGG(STRUCT(id AS tx_id, fund_id, amount, created_at) ORDER BY created_at ASC, id ASC LIMIT 1)[OFFSET(0)] AS first_buy
      FROM ${TX}
      WHERE type = 'buy' AND status NOT IN ('expired', 'cancelled')
      GROUP BY user_id
    ),
    qualifying AS (
      -- Only investors whose first-ever investment satisfies the campaign's
      -- product/amount/period rule.
      SELECT
        ft.user_id AS invitee_user_id,
        ft.first_buy.tx_id AS tx_id,
        ft.first_buy.fund_id AS fund_id,
        f.name AS fund_name,
        ft.first_buy.amount AS amount,
        DATE(ft.first_buy.created_at) AS tx_date
      FROM first_tx ft
      JOIN ${FUNDS} f ON f.id = ft.first_buy.fund_id
      JOIN ${IM} im ON im.id = f.investment_manager_id
      WHERE LOWER(im.name) LIKE '%sucor%'
        AND ft.first_buy.amount >= 1000000
        AND DATE(ft.first_buy.created_at) BETWEEN @periodFrom AND @periodTo
    ),
    ${RESOLVED_INVITER_CTE},
    pairs AS (
      SELECT
        q.tx_id, q.fund_id, q.fund_name, q.amount, q.tx_date,
        inviter.sid_code AS inviter_sid, inviter.ifua_code AS inviter_ifua,
        inviter.email AS inviter_email, inviter.verification_status AS inviter_verification,
        inviter_up.name AS inviter_name, inviter_up.phone_number AS inviter_phone,
        invitee.sid_code AS invitee_sid, invitee.ifua_code AS invitee_ifua,
        invitee.email AS invitee_email, invitee.verification_status AS invitee_verification,
        invitee_up.name AS invitee_name, invitee_up.phone_number AS invitee_phone
      FROM qualifying q
      JOIN ${USERS} invitee ON invitee.id = q.invitee_user_id
      LEFT JOIN ${USER_PROFILES} invitee_up ON invitee_up.user_id = invitee.id
      JOIN resolved_inviter ri ON ri.invitee_id = invitee.id
      JOIN ${USERS} inviter ON inviter.id = ri.inviter_id
      LEFT JOIN ${USER_PROFILES} inviter_up ON inviter_up.user_id = inviter.id
      WHERE DATE(invitee.${dateCol}) BETWEEN DATE_SUB(DATE(@periodFrom), INTERVAL 1 DAY) AND DATE(@periodTo)
    ),
    fix_snaps AS (
      SELECT sid_code, id AS fund_id, DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS snap_date, total_unit
      FROM ${PORT_FIX}
    ),
    holding AS (
      -- baseline_unit = the unit balance on the first snapshot on/after the
      -- purchase (i.e. right after it settled); min_unit_in_window dropping
      -- below that at any point in the next 30 days means something reduced
      -- the position (sell/switch-out/transfer-out) during the hold.
      SELECT
        p.tx_id,
        MIN(fs.total_unit) AS min_unit_in_window,
        ARRAY_AGG(fs.total_unit ORDER BY fs.snap_date ASC LIMIT 1)[OFFSET(0)] AS baseline_unit
      FROM pairs p
      JOIN fix_snaps fs
        ON fs.sid_code = p.invitee_sid AND fs.fund_id = p.fund_id
        AND fs.snap_date BETWEEN p.tx_date AND DATE_ADD(p.tx_date, INTERVAL 30 DAY)
      GROUP BY p.tx_id
    )
    SELECT
      p.inviter_sid, p.inviter_ifua, p.inviter_email, p.inviter_phone, p.inviter_name, p.inviter_verification,
      p.invitee_sid, p.invitee_ifua, p.invitee_email, p.invitee_phone, p.invitee_name, p.invitee_verification,
      p.fund_name, p.amount, p.tx_date,
      DATE_DIFF(CURRENT_DATE(), p.tx_date, DAY) AS days_held,
      h.baseline_unit, h.min_unit_in_window
    FROM pairs p
    LEFT JOIN holding h ON h.tx_id = p.tx_id
    ORDER BY p.tx_date DESC`,
    params: {
      periodFrom: periodFrom || '2026-09-01',
      periodTo: periodTo || '2026-12-31',
    },
  };
};

// Referral program leaderboard, per inviter: everyone still relevant to this
// campaign and how many of those transacted — broader than
// referralProgramDetail's "qualifying" set (scoped to the campaign's own
// Sucor/>=1jt rule), but NOT everyone the inviter has ever referred. The
// frontend merges this with referralProgramDetail's per-row status
// (computeReferralEligibility) for the full funnel: invited -> transacted ->
// transacted >=1jt (qualifying) -> pending/eligible, so each stage must be a
// superset of the next.
// An invitee counts as "invited" here if they registered no earlier than one
// day before the period starts — a grace day for someone who signed up the
// evening before the campaign officially opened and transacted right at the
// start, without opening the door to someone who registered, say, a week
// early and only coincidentally transacts inside the window. Still counted
// even if they haven't transacted yet (pending) — the registration date
// alone qualifies them, independent of whether/when they transact.
const referralInviterStats = (periodFrom, periodTo) => ({
  sql: `WITH ${RESOLVED_INVITER_CTE},
    invited_all AS (
      SELECT invitee.id AS invitee_id, invitee.created_at AS invitee_registered_at,
        inviter.sid_code AS inviter_sid, inviter.referral_code AS inviter_referral_code,
        COALESCE(inviter_up.name, inviter.email) AS inviter_name
      FROM ${USERS} invitee
      JOIN resolved_inviter ri ON ri.invitee_id = invitee.id
      JOIN ${USERS} inviter ON inviter.id = ri.inviter_id
      LEFT JOIN ${USER_PROFILES} inviter_up ON inviter_up.user_id = inviter.id
    ),
    first_tx AS (
      SELECT user_id,
        ARRAY_AGG(created_at ORDER BY created_at ASC, id ASC LIMIT 1)[OFFSET(0)] AS first_tx_at
      FROM ${TX}
      WHERE type = 'buy' AND status NOT IN ('expired', 'cancelled')
      GROUP BY user_id
    ),
    invited AS (
      SELECT ia.invitee_id, ia.inviter_sid, ia.inviter_referral_code, ia.inviter_name,
        DATE(ft.first_tx_at) AS first_tx_date
      FROM invited_all ia
      LEFT JOIN first_tx ft ON ft.user_id = ia.invitee_id
      WHERE DATE(ia.invitee_registered_at)
        BETWEEN DATE_SUB(DATE(@periodFrom), INTERVAL 1 DAY) AND DATE(@periodTo)
    )
    SELECT inviter_sid, ANY_VALUE(inviter_referral_code) AS inviter_referral_code, ANY_VALUE(inviter_name) AS inviter_name,
      COUNT(DISTINCT invitee_id) AS invited_count,
      COUNT(DISTINCT IF(first_tx_date BETWEEN @periodFrom AND @periodTo, invitee_id, NULL)) AS transacted_count
    FROM invited
    GROUP BY inviter_sid`,
  params: {
    periodFrom: periodFrom || '2026-09-01',
    periodTo: periodTo || '2026-12-31',
  },
});

// Leaderboard for "Referral Program (kyc based)" — a sibling of
// referralInviterStats above with one deliberate swap: that one gates
// "Invited" by the invitee's registration date (invitee.created_at); this one
// gates it by their KYC verification date (invitee.verified_at) instead, same
// -1-day grace window. Everything else (transacted_count, grouping) is
// identical — this is the invitee's verification date, not their signup
// date, and an invitee who never got verified (verified_at IS NULL) never
// counts as invited here regardless of how old the referral is.
// Known caveat (deliberately left as-is): a small number of legacy users
// have verification_status='verified' with a NULL verified_at (rows predating
// that timestamp column — see e688ddd for the same gap in eventCodeFunnel/
// eventCodeUsers, fixed there by switching to verification_status since that
// query only needed a boolean, not a date). This leaderboard needs an actual
// date to bucket invitees into a period, and there's no real verification
// date to fall back to for those legacy rows, so they're excluded here rather
// than guessed at. Confirmed decision: do not change this without checking
// with the team first, since it feeds a live compliance/eligibility program.
const referralInviterStatsAlt = (periodFrom, periodTo) => ({
  sql: `WITH ${RESOLVED_INVITER_CTE},
    invited_all AS (
      SELECT invitee.id AS invitee_id, invitee.verified_at AS invitee_verified_at,
        inviter.sid_code AS inviter_sid, inviter.referral_code AS inviter_referral_code,
        COALESCE(inviter_up.name, inviter.email) AS inviter_name
      FROM ${USERS} invitee
      JOIN resolved_inviter ri ON ri.invitee_id = invitee.id
      JOIN ${USERS} inviter ON inviter.id = ri.inviter_id
      LEFT JOIN ${USER_PROFILES} inviter_up ON inviter_up.user_id = inviter.id
    ),
    first_tx AS (
      SELECT user_id,
        ARRAY_AGG(created_at ORDER BY created_at ASC, id ASC LIMIT 1)[OFFSET(0)] AS first_tx_at
      FROM ${TX}
      WHERE type = 'buy' AND status NOT IN ('expired', 'cancelled')
      GROUP BY user_id
    ),
    invited AS (
      SELECT ia.invitee_id, ia.inviter_sid, ia.inviter_referral_code, ia.inviter_name,
        DATE(ft.first_tx_at) AS first_tx_date
      FROM invited_all ia
      LEFT JOIN first_tx ft ON ft.user_id = ia.invitee_id
      WHERE DATE(ia.invitee_verified_at)
        BETWEEN DATE_SUB(DATE(@periodFrom), INTERVAL 1 DAY) AND DATE(@periodTo)
    )
    SELECT inviter_sid, ANY_VALUE(inviter_referral_code) AS inviter_referral_code, ANY_VALUE(inviter_name) AS inviter_name,
      COUNT(DISTINCT invitee_id) AS invited_count,
      COUNT(DISTINCT IF(first_tx_date BETWEEN @periodFrom AND @periodTo, invitee_id, NULL)) AS transacted_count
    FROM invited
    GROUP BY inviter_sid`,
  params: {
    periodFrom: periodFrom || '2026-09-01',
    periodTo: periodTo || '2026-12-31',
  },
});

// Full roster behind the leaderboards' "Invited" counts above: one row per
// invitee with their own contact/KYC/referral-code details, not just the
// per-inviter tallies. `alt` picks the same "invited" population as
// referralInviterStats (false, gated by invitee.created_at) or
// referralInviterStatsAlt (true, gated by invitee.verified_at instead) so the
// row count always matches the corresponding leaderboard's Invited total.
const referralInvitedUsers = (periodFrom, periodTo, alt = false) => {
  const invitedFilter = alt
    ? 'DATE(invitee.verified_at) BETWEEN DATE_SUB(DATE(@periodFrom), INTERVAL 1 DAY) AND DATE(@periodTo)'
    : 'DATE(invitee.created_at) BETWEEN DATE_SUB(DATE(@periodFrom), INTERVAL 1 DAY) AND DATE(@periodTo)';
  return {
    sql: `WITH ${RESOLVED_INVITER_CTE},
      first_tx AS (
        SELECT user_id,
          ARRAY_AGG(STRUCT(created_at, status) ORDER BY created_at ASC, id ASC LIMIT 1)[OFFSET(0)] AS first_tx
        FROM ${TX}
        WHERE type = 'buy' AND status NOT IN ('expired', 'cancelled')
        GROUP BY user_id
      )
      SELECT
        inviter.sid_code AS inviter_sid, COALESCE(inviter_up.name, inviter.email) AS inviter_name,
        inviter.referral_code AS inviter_referral_code,
        invitee_up.name AS invitee_name, invitee.created_at AS invitee_created_at,
        invitee.verified_at AS invitee_verified_at,
        invitee.sid_code AS invitee_sid, invitee.email AS invitee_email,
        invitee_up.phone_number AS invitee_phone,
        invitee.referral_code AS invitee_referral_code,
        invitee.verification_status AS kyc_status,
        IFNULL(ft.first_tx.status, 'none') AS transaction_status
      FROM ${USERS} invitee
      JOIN resolved_inviter ri ON ri.invitee_id = invitee.id
      JOIN ${USERS} inviter ON inviter.id = ri.inviter_id
      LEFT JOIN ${USER_PROFILES} invitee_up ON invitee_up.user_id = invitee.id
      LEFT JOIN ${USER_PROFILES} inviter_up ON inviter_up.user_id = inviter.id
      LEFT JOIN first_tx ft ON ft.user_id = invitee.id
      WHERE ${invitedFilter}
      ORDER BY invitee.created_at DESC`,
    params: {
      periodFrom: periodFrom || '2026-09-01',
      periodTo: periodTo || '2026-12-31',
    },
  };
};

// ---- Reconciliation: app ledger (main.transactions) vs custodian feed (sinvest) -
// Transaction_Date/amount columns in sinvest.trx_history are STRING ('YYYYMMDD',
// formatted numbers) — the raw KSEI/SInvest export, never cleaned.
const SINVEST = '`sayakaya.sinvest.trx_history`';

// Transaction_Type is a numeric-code string ('1'..'9') for KSEI/SInvest's
// Subscription/Redemption/Switch In/Switch Out/Reinvestment/Liquidation/
// Transfer In/Transfer Out/Unit Adjustment. main.transactions.type only
// covers the first five (buy/sell/SWITCH_IN/SWITCH_OUT/reinvestment) — the
// backoffice doesn't book Liquidation/Transfer/Unit Adjustment yet, so those
// rows will show sinvest-only counts until it does.
const RECON_TYPE_CASE = `CASE Transaction_Type
        WHEN '1' THEN 'BUY' WHEN '2' THEN 'SELL' WHEN '3' THEN 'SWITCH_IN' WHEN '4' THEN 'SWITCH_OUT'
        WHEN '5' THEN 'REINVESTMENT' WHEN '6' THEN 'LIQUIDATION' WHEN '7' THEN 'TRANSFER_IN'
        WHEN '8' THEN 'TRANSFER_OUT' WHEN '9' THEN 'UNIT_ADJUSTMENT' ELSE 'OTHER' END`;

const reconciliationDaily = (from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH sinvest_raw AS (
        SELECT PARSE_DATE('%Y%m%d', Input_Date) AS d,
          ${RECON_TYPE_CASE} AS type_label,
          SAFE_CAST(Net_Transaction_Amount AS NUMERIC) AS amount
        FROM ${SINVEST}
        WHERE Input_Date IS NOT NULL
      ),
      sinvest AS (
        SELECT d, IFNULL(type_label, 'ALL') AS type, SUM(amount) AS amount, COUNT(*) AS cnt
        FROM sinvest_raw GROUP BY ROLLUP(d, type_label)
      ),
      app_raw AS (
        SELECT DATE(completed_at) AS d, UPPER(type) AS type_label, final_amount
        FROM ${TX} WHERE status = 'completed'
      ),
      app AS (
        SELECT d, IFNULL(type_label, 'ALL') AS type, SUM(final_amount) AS amount, COUNT(*) AS cnt
        FROM app_raw GROUP BY ROLLUP(d, type_label)
      )
      SELECT FORMAT_DATE('%Y-%m-%d', COALESCE(s.d, a.d)) AS bucket,
        COALESCE(s.type, a.type) AS type,
        IFNULL(s.amount, 0) AS sinvest_amount, IFNULL(s.cnt, 0) AS sinvest_count,
        IFNULL(a.amount, 0) AS app_amount, IFNULL(a.cnt, 0) AS app_count,
        ROUND(IFNULL(a.amount, 0) - IFNULL(s.amount, 0)) AS amount_diff
      FROM sinvest s FULL OUTER JOIN app a ON s.d = a.d AND s.type = a.type
      WHERE COALESCE(s.d, a.d) BETWEEN @from AND @to
      ORDER BY bucket DESC, type = 'ALL' DESC, type`,
    params: r,
  };
};

// ---- SInvest transactions explorer (paged, filtered) -----------------------
// Every column in trx_history is STRING, including the two date columns
// (Transaction_Date/Input_Date, both 'YYYYMMDD') and the numeric-looking ones
// — this is the raw, uncleaned KSEI/SInvest export. Dates are reformatted to
// ISO ('YYYY-MM-DD') and amounts SAFE_CAST to NUMERIC for display; filtering
// stays on the raw YYYYMMDD string (zero-padded, so it sorts/compares
// correctly as text without parsing).
const sinvestTxColumns = `
      FORMAT_DATE('%Y-%m-%d', SAFE.PARSE_DATE('%Y%m%d', Transaction_Date)) AS transaction_date,
      ${RECON_TYPE_CASE} AS type,
      SID AS sid,
      Investor_Fund_Unit_A_C_Name AS investor_name,
      Fund_Code AS fund_code,
      Fund_Name AS fund_name,
      SAFE_CAST(Number_of_Units AS NUMERIC) AS unit,
      SAFE_CAST(NAV_per_Unit AS NUMERIC) AS nav_per_unit,
      SAFE_CAST(Gross_Transaction_Amount AS NUMERIC) AS gross_amount,
      SAFE_CAST(Transaction_Fee__Nominal AS NUMERIC) AS fee,
      SAFE_CAST(Net_Transaction_Amount AS NUMERIC) AS net_amount,
      FORMAT_DATE('%Y-%m-%d', SAFE.PARSE_DATE('%Y%m%d', Input_Date)) AS input_date,
      Reference_No AS reference_no`;

function sinvestTransactions({ from, to, type, sid, search, limit = 50, offset = 0 }) {
  const r = range(from, to);
  const params = { fromYmd: r.from.replace(/-/g, ''), toYmd: r.to.replace(/-/g, ''), limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
  let where = 'Transaction_Date BETWEEN @fromYmd AND @toYmd';
  if (type) { where += ` AND ${RECON_TYPE_CASE} = @type`; params.type = type; }
  if (sid) { where += ' AND SID = @sid'; params.sid = sid; }
  if (search) {
    where += ' AND (SID = @search OR Reference_No = @search OR LOWER(Investor_Fund_Unit_A_C_Name) LIKE @searchLike)';
    params.search = search;
    params.searchLike = `%${search.toLowerCase()}%`;
  }
  return {
    sql: `SELECT ${sinvestTxColumns} FROM ${SINVEST} WHERE ${where}
          ORDER BY Transaction_Date DESC, Reference_No DESC LIMIT @limit OFFSET @offset`,
    params,
    countSql: `SELECT COUNT(*) AS total FROM ${SINVEST} WHERE ${where}`,
  };
}

// ---- Portfolio (SInvest): same shape/logic as userHoldingsFromTx(), but
// sourced entirely from the custodian feed (sinvest.trx_history) instead of
// the app's own transactions table — keyed by SID (trx_history has no
// user_id), joined to funds via funds.sinvest_code = Fund_Code. trx_history
// has no status column (every row is the custodian's own settled record, no
// pending/cancelled states), so unlike userHoldingsFromTx there's no status
// filter. Same weighted-average-cost rule: only incoming transaction types
// (BUY/SWITCH_IN/REINVESTMENT/TRANSFER_IN, codes 1/3/5/7) set the average;
// outgoing types (SELL/SWITCH_OUT/LIQUIDATION/TRANSFER_OUT/UNIT_ADJUSTMENT,
// codes 2/4/6/8/9) only reduce units.
const sinvestHoldings = (sid) => ({
  sql: `WITH incoming_tx AS (
      SELECT Fund_Code AS fund_code, SAFE_CAST(Number_of_Units AS NUMERIC) AS unit,
        SAFE_CAST(NAV_per_Unit AS NUMERIC) AS price, SAFE.PARSE_DATE('%Y%m%d', Transaction_Date) AS d
      FROM ${SINVEST}
      WHERE SID = @sid AND Transaction_Type IN ('1', '3', '5', '7')
    ),
    outgoing_tx AS (
      SELECT Fund_Code AS fund_code, SAFE_CAST(Number_of_Units AS NUMERIC) AS unit
      FROM ${SINVEST}
      WHERE SID = @sid AND Transaction_Type IN ('2', '4', '6', '8', '9')
    ),
    regular_avg AS (
      SELECT fund_code, SAFE_DIVIDE(SUM(unit * price), SUM(unit)) AS avg_price, MIN(d) AS opened_at
      FROM incoming_tx
      GROUP BY fund_code
    ),
    regular_net_all AS (
      SELECT fund_code, SUM(unit) AS net_unit
      FROM (
        SELECT fund_code, unit FROM incoming_tx
        UNION ALL
        SELECT fund_code, -unit FROM outgoing_tx
      )
      GROUP BY fund_code
    ),
    merged AS (
      SELECT rn.fund_code, rn.net_unit AS unit, ra.avg_price AS avg_buy_price, ra.opened_at
      FROM regular_net_all rn
      JOIN regular_avg ra ON ra.fund_code = rn.fund_code
      WHERE rn.net_unit > 0.0001
    )
    SELECT *, value - fund_value AS gain_loss,
      SAFE_DIVIDE(value - fund_value, fund_value) * 100 AS gain_pct
    FROM (
      SELECT f.name AS fund, f.type AS fund_type, m.unit, m.avg_buy_price,
        f.latest_nav_value AS nav, f.latest_nav_date AS nav_date,
        ROUND(m.unit * m.avg_buy_price) AS fund_value,
        ROUND(m.unit * f.latest_nav_value) AS value,
        m.opened_at
      FROM merged m
      JOIN ${FUNDS} f ON f.sinvest_code = m.fund_code
    )
    ORDER BY value DESC`,
  params: { sid },
});

// Same as sinvestHoldings() above, but every transaction after @date is
// ignored (both for the average and for netting units) — same idea as
// userHoldingsFromTxAsOf(). Historical NAV comes from sayakaya.main.snapshots,
// falling back to the fund's live NAV if that date has no snapshot.
const sinvestHoldingsAsOf = (sid, date) => {
  const dateYmd = date.replace(/-/g, '');
  return {
    sql: `WITH incoming_tx AS (
      SELECT Fund_Code AS fund_code, SAFE_CAST(Number_of_Units AS NUMERIC) AS unit,
        SAFE_CAST(NAV_per_Unit AS NUMERIC) AS price, SAFE.PARSE_DATE('%Y%m%d', Transaction_Date) AS d
      FROM ${SINVEST}
      WHERE SID = @sid AND Transaction_Type IN ('1', '3', '5', '7') AND Transaction_Date <= @dateYmd
    ),
    outgoing_tx AS (
      SELECT Fund_Code AS fund_code, SAFE_CAST(Number_of_Units AS NUMERIC) AS unit
      FROM ${SINVEST}
      WHERE SID = @sid AND Transaction_Type IN ('2', '4', '6', '8', '9') AND Transaction_Date <= @dateYmd
    ),
    regular_avg AS (
      SELECT fund_code, SAFE_DIVIDE(SUM(unit * price), SUM(unit)) AS avg_price, MIN(d) AS opened_at
      FROM incoming_tx
      GROUP BY fund_code
    ),
    regular_net_all AS (
      SELECT fund_code, SUM(unit) AS net_unit
      FROM (
        SELECT fund_code, unit FROM incoming_tx
        UNION ALL
        SELECT fund_code, -unit FROM outgoing_tx
      )
      GROUP BY fund_code
    ),
    merged AS (
      SELECT rn.fund_code, rn.net_unit AS unit, ra.avg_price AS avg_buy_price, ra.opened_at
      FROM regular_net_all rn
      JOIN regular_avg ra ON ra.fund_code = rn.fund_code
      WHERE rn.net_unit > 0.0001
    ),
    canon_nav AS (
      SELECT product_id AS fund_id, value AS nav
      FROM ${SNAPSHOTS}
      WHERE type = 'NAV' AND DATE(created_at) = @date
    )
    SELECT *, value - fund_value AS gain_loss,
      SAFE_DIVIDE(value - fund_value, fund_value) * 100 AS gain_pct
    FROM (
      SELECT f.name AS fund, f.type AS fund_type, m.unit, m.avg_buy_price,
        COALESCE(cn.nav, f.latest_nav_value) AS nav, @date AS nav_date,
        ROUND(m.unit * m.avg_buy_price) AS fund_value,
        ROUND(m.unit * COALESCE(cn.nav, f.latest_nav_value)) AS value,
        m.opened_at
      FROM merged m
      JOIN ${FUNDS} f ON f.sinvest_code = m.fund_code
      LEFT JOIN canon_nav cn ON cn.fund_id = f.id
    )
    ORDER BY value DESC`,
    params: { sid, date, dateYmd },
  };
};

// ---- Revenue: management fee earned per fund, prorated daily from AUM -----
// Daily AUM snapshots (portfolio_with_code) x the management fee rate in
// effect (latest_mgmt_fee, deduped by updated_at) gives a daily fee accrual,
// split into AperD's and MI's share. Grouped by month + fund for the detail
// view; summed again across funds for the monthly summary.
function revenueCTEs(from, to, granularity = 'month', fund = '', mi = '') {
  const r = range(from, to);
  const part = granularityPart(granularity);
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
        -- portfolio_with_code is one row per sid_code (investor) + fund + day,
        -- not one row per fund + day — SUM(pwc.amount) across investors is
        -- required to get the fund's actual daily AUM. Without this, aum_eom/
        -- avg_aum below silently pick a single investor's holding instead of
        -- the whole fund's (management_fee/aperd_share/mi_share are the same
        -- for every row of a fund regardless, so ANY_VALUE is still correct
        -- there — and summing each investor's per-day fee contribution, which
        -- is what daily_detail/period_fund do below, was already
        -- mathematically equal to the fund total either way; this fix is
        -- about the AUM columns specifically).
        SELECT
          DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) AS created_date,
          pwc.id AS fund_id,
          f.sinvest_code,
          f.name AS fund_name,
          COALESCE(im.common_name, im.name) AS mi_name,
          SUM(pwc.amount) AS aum,
          ANY_VALUE(lmf.management_fee) AS management_fee,
          ANY_VALUE(lmf.aperd_share) AS aperd_share,
          ANY_VALUE(lmf.mi_share) AS mi_share
        FROM ${PORT_WITH_CODE} pwc
        LEFT JOIN ${FUNDS} f ON pwc.id = f.id
        LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
        LEFT JOIN latest_mgmt_fee lmf ON f.id = lmf.management_fee_id
        WHERE DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) BETWEEN @from AND @to
          AND ${FUND_MI_FILTER_SQL}
        GROUP BY DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY), pwc.id, f.sinvest_code, f.name,
          COALESCE(im.common_name, im.name)
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
      period_fund AS (
        SELECT
          DATE_TRUNC(created_date, ${part}) AS period,
          fund_id,
          sinvest_code,
          ANY_VALUE(fund_name) AS fund_name,
          ANY_VALUE(mi_name) AS mi_name,
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
        GROUP BY period, fund_id, sinvest_code
      )`,
    params: { ...r, fund, mi },
  };
}

const revenueDetail = (from, to, granularity = 'month', fund = '', mi = '') => {
  const { cte, params } = revenueCTEs(from, to, granularity, fund, mi);
  return {
    sql: `${cte}
      SELECT
        period, fund_id, sinvest_code, fund_name, mi_name, management_fee, aperd_share, mi_share,
        days_running, avg_aum, aum_eom, total_management_fee, total_aperd_share, total_mi_share
      FROM period_fund
      ORDER BY period, fund_id, sinvest_code`,
    params,
  };
};

// days_running per period is the MAX across funds in that period — funds that
// started mid-period run fewer days, so the longest-running fund estimates the
// actual calendar days elapsed (not yet accounting for mid-period closures).
const revenueMonthlySummary = (from, to, granularity = 'month', fund = '', mi = '') => {
  const { cte, params } = revenueCTEs(from, to, granularity, fund, mi);
  const part = granularityPart(granularity);
  return {
    // avg_aum here is the average of each day's *platform-wide* total AUM
    // across the period — not an average of each fund's own average (which
    // would double-count differently sized funds) or of end-of-period values.
    sql: `${cte},
      daily_platform AS (
        SELECT created_date, SUM(aum) AS platform_aum
        FROM daily_detail
        GROUP BY created_date
      ),
      period_avg_aum AS (
        SELECT DATE_TRUNC(created_date, ${part}) AS period, AVG(platform_aum) AS avg_aum
        FROM daily_platform
        GROUP BY period
      ),
      per_period AS (
        SELECT
          period,
          COUNT(DISTINCT fund_id) AS funds,
          MAX(days_running) AS days_running,
          SUM(aum_eom) AS total_aum,
          SUM(total_management_fee) AS total_management_fee,
          SUM(total_aperd_share) AS total_aperd_share,
          SUM(total_mi_share) AS total_mi_share
        FROM period_fund
        GROUP BY period
      )
      SELECT pp.period, pp.funds, pp.days_running, pp.total_aum, pa.avg_aum,
        pp.total_management_fee, pp.total_aperd_share, pp.total_mi_share
      FROM per_period pp
      JOIN period_avg_aum pa ON pa.period = pp.period
      ORDER BY pp.period`,
    params,
  };
};

// ---- Revenue v2: same shape/columns as revenueDetail/revenueMonthlySummary
// above, but AUM comes from goal_snapshots instead of
// mi_fee_logs.portfolio_with_code — goal_snapshots.date is already the
// correct AUM date, so there's no "-1 day" correction to make, which is what
// makes this the more accurate of the two. Kept as a fully separate section
// (not a replacement) so the two can be compared side by side.
function revenueV2CTEs(from, to, granularity = 'month', fund = '', mi = '') {
  const r = range(from, to);
  const part = granularityPart(granularity);
  return {
    cte: `WITH latest_mgmt_fee AS (
        SELECT management_fee_id, management_fee, aperd_share, mi_share
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY management_fee_id ORDER BY updated_at DESC) AS rn
          FROM ${MGMT_FEE_LOGS}
        ) t
        WHERE rn = 1
      ),
      daily AS (
        SELECT gs.date, gs.fund_id, f.sinvest_code, f.name AS fund_name,
          SUM(gs.amount) AS aum,
          ANY_VALUE(lmf.management_fee) AS management_fee,
          ANY_VALUE(lmf.aperd_share) AS aperd_share,
          ANY_VALUE(lmf.mi_share) AS mi_share,
          ANY_VALUE(COALESCE(im.common_name, im.name)) AS mi_name
        FROM ${GOAL_SNAPSHOTS} gs
        JOIN ${GOALS} g ON g.id = gs.goal_id AND g.deleted_at IS NULL
        LEFT JOIN ${FUNDS} f ON f.id = gs.fund_id
        LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
        LEFT JOIN latest_mgmt_fee lmf ON lmf.management_fee_id = gs.fund_id
        WHERE gs.unit > 0 AND gs.date BETWEEN @from AND @to
          AND ${FUND_MI_FILTER_SQL}
        GROUP BY gs.date, gs.fund_id, f.sinvest_code, f.name
      ),
      daily_detail AS (
        SELECT *,
          (management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY) AS management_fee_per_day,
          aperd_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY)) AS aperd_share_per_day,
          mi_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY)) AS mi_share_per_day
        FROM daily
      ),
      period_fund AS (
        SELECT
          DATE_TRUNC(date, ${part}) AS period,
          fund_id,
          sinvest_code,
          ANY_VALUE(fund_name) AS fund_name,
          ANY_VALUE(mi_name) AS mi_name,
          ANY_VALUE(management_fee) AS management_fee,
          ANY_VALUE(aperd_share) AS aperd_share,
          ANY_VALUE(mi_share) AS mi_share,
          COUNT(DISTINCT date) AS days_running,
          AVG(aum) AS avg_aum,
          ARRAY_AGG(aum ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS aum_eom,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share
        FROM daily_detail
        GROUP BY period, fund_id, sinvest_code
      )`,
    params: { ...r, fund, mi },
  };
}

const revenueV2Detail = (from, to, granularity = 'month', fund = '', mi = '') => {
  const { cte, params } = revenueV2CTEs(from, to, granularity, fund, mi);
  return {
    sql: `${cte}
      SELECT
        period, fund_id, sinvest_code, fund_name, mi_name, management_fee, aperd_share, mi_share,
        days_running, avg_aum, aum_eom, total_management_fee, total_aperd_share, total_mi_share
      FROM period_fund
      ORDER BY period, fund_id, sinvest_code`,
    params,
  };
};

const revenueV2MonthlySummary = (from, to, granularity = 'month', fund = '', mi = '') => {
  const { cte, params } = revenueV2CTEs(from, to, granularity, fund, mi);
  const part = granularityPart(granularity);
  return {
    // avg_aum here is the average of each day's *platform-wide* total AUM
    // across the period — not an average of each fund's own average (which
    // would double-count differently sized funds) or of end-of-period values.
    sql: `${cte},
      daily_platform AS (
        SELECT date, SUM(aum) AS platform_aum
        FROM daily_detail
        GROUP BY date
      ),
      period_avg_aum AS (
        SELECT DATE_TRUNC(date, ${part}) AS period, AVG(platform_aum) AS avg_aum
        FROM daily_platform
        GROUP BY period
      ),
      per_period AS (
        SELECT
          period,
          COUNT(DISTINCT fund_id) AS funds,
          MAX(days_running) AS days_running,
          SUM(aum_eom) AS total_aum,
          SUM(total_management_fee) AS total_management_fee,
          SUM(total_aperd_share) AS total_aperd_share,
          SUM(total_mi_share) AS total_mi_share
        FROM period_fund
        GROUP BY period
      )
      SELECT pp.period, pp.funds, pp.days_running, pp.total_aum, pa.avg_aum,
        pp.total_management_fee, pp.total_aperd_share, pp.total_mi_share
      FROM per_period pp
      JOIN period_avg_aum pa ON pa.period = pp.period
      ORDER BY pp.period`,
    params,
  };
};

// ---- User lifetime: the same daily management-fee accrual as Revenue (PWC)
// above, but grouped per investor instead of per fund, with lifetime dates
// attached.
//
// Why lifetime does NOT come from portfolio_with_code: that table only holds
// ~216 days of history (it starts 2026-01-14), so MIN(created_at) over it is
// "first day in the snapshot feed", not "first day this investor held
// anything". The lifetime columns therefore come from main.transactions (full
// history back to 2021) and users.created_at, while the money columns come
// from PWC exactly as Revenue (PWC) computes them. first_hold/last_hold are
// deliberately labelled as in-range, snapshot-feed dates for that reason.
//
// PWC is one row per sid_code + fund + day (verified: 260,628 rows and 260,628
// distinct sid+fund pairs on 2026-08-15), so pwc.amount is used directly — no
// GROUP BY is needed to get an investor's per-fund daily AUM, unlike
// revenueCTEs which must SUM across investors to reach a fund total.
function userLifetimeCTEs(from, to, fund = '', mi = '', sid = '') {
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
      daily AS (
        SELECT
          DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) AS created_date,
          pwc.sid_code,
          pwc.id AS fund_id,
          f.name AS fund_name,
          f.sinvest_code,
          COALESCE(im.common_name, im.name) AS mi_name,
          pwc.amount AS aum,
          lmf.management_fee,
          lmf.aperd_share,
          lmf.mi_share
        FROM ${PORT_WITH_CODE} pwc
        LEFT JOIN ${FUNDS} f ON pwc.id = f.id
        LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
        LEFT JOIN latest_mgmt_fee lmf ON f.id = lmf.management_fee_id
        WHERE DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) BETWEEN @from AND @to
          AND pwc.sid_code IS NOT NULL
          AND (@sid = '' OR pwc.sid_code = @sid)
          AND ${FUND_MI_FILTER_SQL}
      ),
      daily_fee AS (
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
        FROM daily
      )`,
    params: { ...r, fund, mi, sid },
  };
}

// Lifetime dates from the full transaction ledger — deliberately unfiltered by
// @from/@to, since a lifetime that only counted the selected window would not
// be a lifetime. Kept as its own CTE so both the per-user table and the
// per-user drill-down can reuse it.
const TX_LIFE_CTE = `tx_life AS (
    SELECT user_id,
      MIN(DATE(created_at)) AS first_tx,
      MAX(DATE(created_at)) AS last_tx,
      MIN(IF(type IN ('buy','SWITCH_IN','reinvestment','transfer_in'), DATE(created_at), NULL)) AS first_buy,
      MAX(IF(type IN ('sell','SWITCH_OUT','transfer_out','liquidation'), DATE(created_at), NULL)) AS last_sell,
      COUNT(*) AS tx_count,
      SUM(IF(type = 'buy', amount, 0)) AS total_invested
    FROM ${TX}
    WHERE status NOT IN ('expired','cancelled')
    GROUP BY user_id
  )`;

// Per-investor table. Ordered by the platform's own take (AperD share) so the
// LIMIT keeps the investors that actually matter to revenue.
//
// holding_lifetime_days runs from the investor's first buy to today when they
// still show up in the snapshot feed (last_hold within 3 days of today, which
// absorbs the feed's normal 1-2 day lag), otherwise to their last sell — i.e.
// "how long have they been invested", not "how long has the feed seen them".
const userLifetimeUsers = (from, to, fund = '', mi = '', sid = '', limit = 200) => {
  const { cte, params } = userLifetimeCTEs(from, to, fund, mi, sid);
  return {
    sql: `${cte},
      ${TX_LIFE_CTE},
      per_user AS (
        SELECT sid_code,
          MIN(created_date) AS first_hold,
          MAX(created_date) AS last_hold,
          COUNT(DISTINCT created_date) AS active_days,
          COUNT(DISTINCT fund_id) AS funds,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share
        FROM daily_fee
        GROUP BY sid_code
      ),
      user_day_aum AS (
        SELECT sid_code, created_date, SUM(aum) AS day_total
        FROM daily_fee
        GROUP BY sid_code, created_date
      ),
      aum_stats AS (
        SELECT sid_code,
          AVG(day_total) AS avg_aum,
          ARRAY_AGG(day_total ORDER BY created_date DESC LIMIT 1)[OFFSET(0)] AS last_aum
        FROM user_day_aum
        GROUP BY sid_code
      )
      SELECT
        pu.sid_code, up.name, u.email,
        DATE(u.created_at) AS registered_at,
        t.first_tx, t.first_buy, t.last_tx, t.tx_count, t.total_invested,
        pu.first_hold, pu.last_hold, pu.active_days, pu.funds,
        DATE_DIFF(CURRENT_DATE(), DATE(u.created_at), DAY) AS account_age_days,
        DATE_DIFF(t.first_buy, DATE(u.created_at), DAY) AS days_to_first_buy,
        DATE_DIFF(t.last_tx, t.first_tx, DAY) + 1 AS tx_span_days,
        DATE_DIFF(
          IF(pu.last_hold >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY),
             CURRENT_DATE(), COALESCE(t.last_sell, pu.last_hold)),
          t.first_buy, DAY) + 1 AS holding_lifetime_days,
        a.avg_aum, a.last_aum,
        pu.total_management_fee, pu.total_aperd_share, pu.total_mi_share
      FROM per_user pu
      JOIN aum_stats a ON a.sid_code = pu.sid_code
      JOIN ${USERS} u ON u.sid_code = pu.sid_code
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      LEFT JOIN tx_life t ON t.user_id = u.id
      ORDER BY pu.total_aperd_share DESC
      LIMIT @limit`,
    params: { ...params, limit: parseInt(limit, 10) || 200 },
  };
};

// Drill-down for one investor: per period, per fund. @sid is required by the
// route — without it this would aggregate the whole platform per fund.
const userLifetimeDetail = (sid, from, to, granularity = 'month', fund = '', mi = '') => {
  const { cte, params } = userLifetimeCTEs(from, to, fund, mi, sid);
  const part = granularityPart(granularity);
  return {
    sql: `${cte}
      SELECT
        DATE_TRUNC(created_date, ${part}) AS period,
        fund_id,
        ANY_VALUE(fund_name) AS fund_name,
        ANY_VALUE(sinvest_code) AS sinvest_code,
        ANY_VALUE(mi_name) AS mi_name,
        ANY_VALUE(management_fee) AS management_fee,
        COUNT(DISTINCT created_date) AS days_running,
        AVG(aum) AS avg_aum,
        ARRAY_AGG(aum ORDER BY created_date DESC LIMIT 1)[OFFSET(0)] AS aum_eop,
        SUM(management_fee_per_day) AS total_management_fee,
        SUM(aperd_share_per_day) AS total_aperd_share,
        SUM(mi_share_per_day) AS total_mi_share
      FROM daily_fee
      GROUP BY period, fund_id
      ORDER BY period, fund_name`,
    params,
  };
};

// Platform-wide per-period rollup for the trend chart. avg_aum is the average
// of each day's platform-wide total, matching revenueMonthlySummary.
const userLifetimeSummary = (from, to, granularity = 'month', fund = '', mi = '') => {
  const { cte, params } = userLifetimeCTEs(from, to, fund, mi, '');
  const part = granularityPart(granularity);
  return {
    sql: `${cte},
      daily_platform AS (
        SELECT created_date, SUM(aum) AS platform_aum, COUNT(DISTINCT sid_code) AS investors
        FROM daily_fee
        GROUP BY created_date
      ),
      period_daily AS (
        SELECT DATE_TRUNC(created_date, ${part}) AS period,
          AVG(platform_aum) AS avg_aum, MAX(investors) AS peak_investors
        FROM daily_platform
        GROUP BY period
      ),
      per_period AS (
        SELECT DATE_TRUNC(created_date, ${part}) AS period,
          COUNT(DISTINCT sid_code) AS investors,
          COUNT(DISTINCT created_date) AS days_running,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share
        FROM daily_fee
        GROUP BY period
      )
      SELECT pp.period, pp.investors, pp.days_running, pd.avg_aum, pd.peak_investors,
        SAFE_DIVIDE(pp.total_aperd_share, pp.investors) AS aperd_per_investor,
        pp.total_management_fee, pp.total_aperd_share, pp.total_mi_share
      FROM per_period pp
      JOIN period_daily pd ON pd.period = pp.period
      ORDER BY pp.period`,
    params,
  };
};

// ---- Campaign revenue: management fee earned on units locked by a promo -----
//
// main.bonus_portfolios is one row per promo participation: the units a buy
// transaction locked under a campaign's holding period (verified — for promo
// THRCUAN, bonus_portfolios.unit equals the qualifying buy's unit exactly, and
// campaigns.bonus_amount is paid out separately as its own later buy). Status
// drives the window over which those units earn a fee:
//
//   on_going  — still locked: created_at .. today
//   redeemed  — pulled out early:  created_at .. redeemed_at
//   succeeded — holding period cleared and the units merged back into
//               main.portfolios, which stores only a live unit balance with no
//               history. So "are they still held?" is answered from the
//               transaction ledger instead: any sell/switch-out on the same
//               goal_id + fund_id after the lock date eats into the locked
//               units. Verified against goal 07f81095 / fund GgT-hq…: 3935.6324
//               units locked 2026-03-12, sold in full 2026-07-07, and the
//               computed remaining unit drops to 0 on exactly that date.
//
// Two attributions of a sell are produced side by side, because which one is
// right is a business call rather than a data one:
//   unit_a — sells consume campaign units FIRST (conservative; this is the rule
//            as originally specified: "jika unit berkurang sejumlah unit dari
//            bonus_portfolios maka stop"). Drives the headline columns.
//   unit_b — sells consume the investor's own units first, campaign units last
//            (optimistic). Surfaced as *_alt so the two can be compared.
function campaignRevenueCTEs(from, to, promo = '') {
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
      bonus AS (
        SELECT bp.id AS bonus_id, bp.promo_code, bp.goal_id, bp.fund_id, bp.user_id, bp.status,
          CAST(bp.unit AS NUMERIC) AS bonus_unit,
          DATE(bp.created_at) AS start_d,
          CASE WHEN bp.status = 'redeemed' THEN DATE(bp.redeemed_at) ELSE CURRENT_DATE() END AS end_d
        FROM ${BONUS_PORT} bp
        WHERE bp.promo_code IS NOT NULL AND bp.unit > 0
          AND (@promo = '' OR UPPER(bp.promo_code) LIKE CONCAT('%', UPPER(@promo), '%'))
      ),
      win AS (
        SELECT b.*,
          GREATEST(b.start_d, @from) AS win_from,
          LEAST(COALESCE(b.end_d, CURRENT_DATE()), @to, CURRENT_DATE()) AS win_to
        FROM bonus b
      ),
      -- Net unit movement per goal + fund per day, from the ledger only:
      -- a promo lock is not a transaction, so this never double-counts it.
      flow AS (
        SELECT goal_id, fund_id, DATE(created_at) AS d,
          SUM(IF(type IN ('sell','SWITCH_OUT','transfer_out','liquidation','unit_adjustment'), CAST(unit AS NUMERIC), 0)) AS sold,
          SUM(IF(type IN ('buy','SWITCH_IN','reinvestment','transfer_in'), CAST(unit AS NUMERIC), 0)) AS bought
        FROM ${TX}
        WHERE status NOT IN ('expired','cancelled') AND goal_id IS NOT NULL
        GROUP BY goal_id, fund_id, d
      ),
      cum AS (
        SELECT goal_id, fund_id, d,
          SUM(sold) OVER (PARTITION BY goal_id, fund_id ORDER BY d) AS cum_sold,
          SUM(bought) OVER (PARTITION BY goal_id, fund_id ORDER BY d) AS cum_bought
        FROM flow
      ),
      -- Ledger position at the lock date and at the start of the requested
      -- window. The window baseline is what seeds the forward-fill below when
      -- @from lands after the lock date and the first day carries no ledger row.
      base AS (
        SELECT w.bonus_id,
          COALESCE(SUM(IF(f.d <= w.start_d,  f.sold,   0)), 0) AS sold_at_start,
          COALESCE(SUM(IF(f.d <= w.win_from, f.sold,   0)), 0) AS sold_at_winfrom,
          COALESCE(SUM(IF(f.d <= w.start_d,  f.bought, 0)), 0) AS bought_at_start,
          COALESCE(SUM(IF(f.d <= w.win_from, f.bought, 0)), 0) AS bought_at_winfrom
        FROM win w
        LEFT JOIN flow f ON f.goal_id = w.goal_id AND f.fund_id = w.fund_id
        WHERE w.win_from <= w.win_to
        GROUP BY w.bonus_id
      ),
      days AS (
        SELECT w.bonus_id, w.promo_code, w.goal_id, w.fund_id, w.user_id, w.status, w.bonus_unit,
          w.start_d, d,
          b.sold_at_start, b.sold_at_winfrom, b.bought_at_start, b.bought_at_winfrom
        FROM win w
        JOIN base b ON b.bonus_id = w.bonus_id,
        UNNEST(GENERATE_DATE_ARRAY(w.win_from, w.win_to)) AS d
      ),
      filled AS (
        SELECT dd.*,
          COALESCE(LAST_VALUE(c.cum_sold   IGNORE NULLS) OVER (PARTITION BY dd.bonus_id ORDER BY dd.d), dd.sold_at_winfrom)   AS cs,
          COALESCE(LAST_VALUE(c.cum_bought IGNORE NULLS) OVER (PARTITION BY dd.bonus_id ORDER BY dd.d), dd.bought_at_winfrom) AS cb
        FROM days dd
        LEFT JOIN cum c ON c.goal_id = dd.goal_id AND c.fund_id = dd.fund_id AND c.d = dd.d
      ),
      held AS (
        SELECT bonus_id, promo_code, fund_id, user_id, status, d, bonus_unit, start_d,
          IF(status = 'succeeded',
             GREATEST(bonus_unit - (cs - sold_at_start), 0),
             bonus_unit) AS unit_a,
          IF(status = 'succeeded',
             LEAST(bonus_unit, GREATEST(bonus_unit + (cb - bought_at_start) - (cs - sold_at_start), 0)),
             bonus_unit) AS unit_b
        FROM filled
      ),
      nav_pts AS (
        SELECT product_id AS fund_id, DATE(created_at) AS d, MAX(value) AS nav
        FROM ${SNAPSHOTS} WHERE type = 'NAV'
        GROUP BY fund_id, d
      ),
      -- NAV only exists on trading days, but the fee accrues every calendar
      -- day, so the last known NAV is carried forward. Generated from 2021 so
      -- the fill always has a seed regardless of @from; ~77 promo funds x ~2k
      -- days, which is negligible next to the ledger scan.
      nav_daily AS (
        SELECT fund_id, d, LAST_VALUE(nav IGNORE NULLS) OVER (PARTITION BY fund_id ORDER BY d) AS nav
        FROM (
          SELECT bf.fund_id, gd AS d, n.nav
          FROM (SELECT DISTINCT fund_id FROM bonus) bf
          CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(DATE '2021-01-01', LEAST(@to, CURRENT_DATE()))) AS gd
          LEFT JOIN nav_pts n ON n.fund_id = bf.fund_id AND n.d = gd
        )
      ),
      priced AS (
        SELECT h.bonus_id, h.promo_code, h.fund_id, h.user_id, h.status, h.d, h.bonus_unit, h.start_d,
          h.unit_a, h.unit_b,
          f.name AS fund_name,
          COALESCE(im.common_name, im.name) AS mi_name,
          h.unit_a * COALESCE(nd.nav, f.latest_nav_value) AS aum_a,
          h.unit_b * COALESCE(nd.nav, f.latest_nav_value) AS aum_b,
          lmf.management_fee, lmf.aperd_share, lmf.mi_share,
          DATE_DIFF(DATE_ADD(DATE_TRUNC(h.d, YEAR), INTERVAL 1 YEAR), DATE_TRUNC(h.d, YEAR), DAY) AS year_days
        FROM held h
        LEFT JOIN ${FUNDS} f ON f.id = h.fund_id
        LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
        LEFT JOIN nav_daily nd ON nd.fund_id = h.fund_id AND nd.d = h.d
        LEFT JOIN latest_mgmt_fee lmf ON lmf.management_fee_id = h.fund_id
      ),
      fees AS (
        SELECT *,
          management_fee * aum_a / year_days AS management_fee_per_day,
          aperd_share * management_fee * aum_a / year_days AS aperd_share_per_day,
          mi_share * management_fee * aum_a / year_days AS mi_share_per_day,
          aperd_share * management_fee * aum_b / year_days AS aperd_share_per_day_alt
        FROM priced
      )`,
    params: { ...r, promo },
  };
}

// Per campaign, per period — the detail table.
const campaignRevenueDetail = (from, to, granularity = 'month', promo = '') => {
  const { cte, params } = campaignRevenueCTEs(from, to, promo);
  const part = granularityPart(granularity);
  return {
    // avg_aum/avg_units are the average of each *day's* campaign-wide total,
    // not an average over bonus-days — otherwise a campaign with many small
    // participations would report the size of a single participation.
    sql: `${cte},
      daily_promo AS (
        SELECT promo_code, d, SUM(aum_a) AS day_aum, SUM(unit_a) AS day_units
        FROM fees
        GROUP BY promo_code, d
      ),
      period_promo_daily AS (
        SELECT promo_code, DATE_TRUNC(d, ${part}) AS period,
          AVG(day_aum) AS avg_aum, AVG(day_units) AS avg_units
        FROM daily_promo
        GROUP BY promo_code, period
      ),
      period_promo AS (
        SELECT DATE_TRUNC(d, ${part}) AS period, promo_code,
          COUNT(DISTINCT bonus_id) AS participations,
          COUNT(DISTINCT user_id) AS investors,
          COUNT(DISTINCT fund_id) AS funds,
          COUNT(DISTINCT d) AS days_running,
          COUNT(DISTINCT IF(status = 'on_going', bonus_id, NULL)) AS still_locked,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share,
          SUM(aperd_share_per_day_alt) AS total_aperd_share_alt
        FROM fees
        GROUP BY period, promo_code
      )
      SELECT pp.period, pp.promo_code, c.name AS campaign_name,
        pp.participations, pp.investors, pp.funds, pp.days_running, pp.still_locked,
        pd.avg_units, pd.avg_aum,
        pp.total_management_fee, pp.total_aperd_share, pp.total_mi_share,
        pp.total_aperd_share_alt
      FROM period_promo pp
      JOIN period_promo_daily pd ON pd.promo_code = pp.promo_code AND pd.period = pp.period
      LEFT JOIN ${CAMPAIGNS} c ON c.promo_code = pp.promo_code AND c.deleted_at IS NULL
      ORDER BY pp.period, pp.total_aperd_share DESC`,
    params,
  };
};

// One row per campaign across the whole range — the "which promo actually paid
// for itself" table. est_cost mirrors the Growth tab's campaign cost estimate
// (bonus_amount x used_quota) so revenue and cost sit side by side.
const campaignRevenueByCampaign = (from, to, promo = '') => {
  const { cte, params } = campaignRevenueCTEs(from, to, promo);
  return {
    sql: `${cte},
      per_campaign AS (
        SELECT promo_code,
          COUNT(DISTINCT bonus_id) AS participations,
          COUNT(DISTINCT user_id) AS investors,
          COUNT(DISTINCT fund_id) AS funds,
          MIN(start_d) AS first_lock,
          MAX(d) AS last_day,
          COUNT(DISTINCT d) AS days_running,
          COUNT(DISTINCT IF(status = 'on_going', bonus_id, NULL)) AS still_locked,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share,
          SUM(aperd_share_per_day_alt) AS total_aperd_share_alt
        FROM fees
        GROUP BY promo_code
      )
      SELECT pc.promo_code,
        c.name AS campaign_name, c.campaign_type,
        c.start_date, c.end_date, c.holding_date,
        pc.participations, pc.investors, pc.funds,
        pc.first_lock, pc.last_day, pc.days_running, pc.still_locked,
        c.bonus_amount, c.used_quota,
        c.bonus_amount * c.used_quota AS est_cost,
        pc.total_management_fee, pc.total_aperd_share, pc.total_mi_share,
        pc.total_aperd_share_alt,
        pc.total_aperd_share - COALESCE(c.bonus_amount * c.used_quota, 0) AS net_vs_cost
      FROM per_campaign pc
      LEFT JOIN ${CAMPAIGNS} c ON c.promo_code = pc.promo_code AND c.deleted_at IS NULL
      ORDER BY pc.total_aperd_share DESC`,
    params,
  };
};

// All campaigns rolled up per period — drives the trend chart.
const campaignRevenueSummary = (from, to, granularity = 'month', promo = '') => {
  const { cte, params } = campaignRevenueCTEs(from, to, promo);
  const part = granularityPart(granularity);
  return {
    sql: `${cte},
      daily_platform AS (
        SELECT d, SUM(aum_a) AS platform_aum, COUNT(DISTINCT bonus_id) AS participations
        FROM fees GROUP BY d
      ),
      period_daily AS (
        SELECT DATE_TRUNC(d, ${part}) AS period, AVG(platform_aum) AS avg_aum
        FROM daily_platform GROUP BY period
      ),
      per_period AS (
        SELECT DATE_TRUNC(d, ${part}) AS period,
          COUNT(DISTINCT promo_code) AS campaigns,
          COUNT(DISTINCT bonus_id) AS participations,
          COUNT(DISTINCT user_id) AS investors,
          COUNT(DISTINCT d) AS days_running,
          SUM(management_fee_per_day) AS total_management_fee,
          SUM(aperd_share_per_day) AS total_aperd_share,
          SUM(mi_share_per_day) AS total_mi_share,
          SUM(aperd_share_per_day_alt) AS total_aperd_share_alt
        FROM fees GROUP BY period
      )
      SELECT pp.period, pp.campaigns, pp.participations, pp.investors, pp.days_running,
        pd.avg_aum, pp.total_management_fee, pp.total_aperd_share, pp.total_mi_share,
        pp.total_aperd_share_alt
      FROM per_period pp
      JOIN period_daily pd ON pd.period = pp.period
      ORDER BY pp.period`,
    params,
  };
};

// ---- Remisier sharing: same management-fee math as Revenue above, but the
// AUM comes from goal_snapshots (already daily, per user+fund) filtered down
// to one remisier's users, instead of the whole platform's daily AUM — so
// there's no "-1 day" correction to make (that only exists because
// portfolio_with_code's created_at is a day off from the AUM date it
// represents; goal_snapshots.date is already correct). Remisier fee is a
// portion of the AperD share specifically (never of the raw management
// fee) — the rest of the AperD share stays with Sayakaya.
const remisierFieldColumn = (field) =>
  ({ referrer_code: 'referrer_code', sales_code: 'sales_code' })[field] || 'sales_code';
const remisierGranularityPart = (granularity) => granularityPart(granularity, 'DAY');
// PPh 23 withholding tax cut on the remisier's fee — a fixed statutory rate,
// not a runtime input like remisierPortion.
const REMISIER_PPH_RATE = 0.025;

// Users matching a remisier's code — lets the remisier's book of business be
// listed/verified before running the revenue calculation below.
const remisierUsers = (field, code) => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, up.name, u.email, u.referrer_code, u.sales_code
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE UPPER(u.${remisierFieldColumn(field)}) LIKE CONCAT('%', UPPER(@code), '%')
    ORDER BY up.name`,
  params: { code },
});

function remisierRevenueCTEs(field, code, from, to) {
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
      matched_users AS (
        SELECT u.id AS user_id, u.sid_code AS sid, up.name, u.email
        FROM ${USERS} u
        LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
        WHERE UPPER(u.${remisierFieldColumn(field)}) LIKE CONCAT('%', UPPER(@code), '%')
      ),
      daily AS (
        SELECT gs.date, gs.fund_id, f.sinvest_code, f.name AS fund_name,
          mu.user_id, mu.sid, mu.name, mu.email,
          SUM(gs.amount) AS aum,
          ANY_VALUE(lmf.management_fee) AS management_fee,
          ANY_VALUE(lmf.aperd_share) AS aperd_share,
          ANY_VALUE(lmf.mi_share) AS mi_share
        FROM ${GOAL_SNAPSHOTS} gs
        JOIN ${GOALS} g ON g.id = gs.goal_id AND g.deleted_at IS NULL
        JOIN matched_users mu ON mu.user_id = g.user_id
        LEFT JOIN ${FUNDS} f ON f.id = gs.fund_id
        LEFT JOIN latest_mgmt_fee lmf ON lmf.management_fee_id = gs.fund_id
        WHERE gs.unit > 0 AND gs.date BETWEEN @from AND @to
        GROUP BY gs.date, gs.fund_id, f.sinvest_code, f.name, mu.user_id, mu.sid, mu.name, mu.email
      ),
      daily_fund AS (
        SELECT date, fund_id, SUM(aum) AS aum
        FROM daily
        GROUP BY date, fund_id
      ),
      daily_detail AS (
        SELECT *,
          (management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY) AS management_fee_per_day,
          aperd_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY)) AS aperd_share_per_day,
          mi_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY)) AS mi_share_per_day
        FROM daily
      )`,
    params: { ...r, code },
  };
}

// Per fund, per period (day/month/quarter) — mirrors revenueDetail's shape
// plus the remisier/Sayakaya split of the AperD share.
// Per fund, per investor, per period — mirrors revenueDetail's shape but
// keeps each of the remisier's investors as its own row (sid/name/email),
// since "one row per fund" was hiding whose AUM the fee actually came from.
const remisierRevenueDetail = (field, code, from, to, granularity, remisierPortion) => {
  const { cte, params } = remisierRevenueCTEs(field, code, from, to);
  const part = remisierGranularityPart(granularity);
  return {
    sql: `${cte}
      SELECT DATE_TRUNC(date, ${part}) AS period, fund_id, sinvest_code,
        user_id, sid, name, email,
        ANY_VALUE(fund_name) AS fund_name,
        ANY_VALUE(management_fee) AS management_fee,
        ANY_VALUE(aperd_share) AS aperd_share,
        ANY_VALUE(mi_share) AS mi_share,
        COUNT(DISTINCT date) AS days_running,
        AVG(aum) AS avg_aum,
        ARRAY_AGG(aum ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS aum_eom,
        SUM(management_fee_per_day) AS total_management_fee,
        SUM(aperd_share_per_day) AS total_aperd_share,
        SUM(mi_share_per_day) AS total_mi_share,
        SUM(aperd_share_per_day) * @remisierPortion AS total_remisier_fee,
        SUM(aperd_share_per_day) * @remisierPortion * ${REMISIER_PPH_RATE} AS total_remisier_pph,
        SUM(aperd_share_per_day) * @remisierPortion * ${1 - REMISIER_PPH_RATE} AS total_remisier_fee_net,
        SUM(aperd_share_per_day) * (1 - @remisierPortion) AS total_sayakaya_fee
      FROM daily_detail
      GROUP BY period, fund_id, sinvest_code, user_id, sid, name, email
      ORDER BY period, fund_id, name`,
    params: { ...params, remisierPortion },
  };
};

// Summed across funds, per period — mirrors revenueMonthlySummary's shape
// (days_running = MAX across funds, AUM = SUM of each fund's end-of-period
// value, not a naive sum of daily rows). daily_detail is now per investor,
// so aum_eom re-derives the fund-level total via daily_fund rather than
// grabbing one investor's row off ARRAY_AGG.
const remisierRevenueSummary = (field, code, from, to, granularity, remisierPortion) => {
  const { cte, params } = remisierRevenueCTEs(field, code, from, to);
  const part = remisierGranularityPart(granularity);
  return {
    sql: `${cte},
      per_fund AS (
        SELECT DATE_TRUNC(dd.date, ${part}) AS period, dd.fund_id,
          COUNT(DISTINCT dd.date) AS days_running,
          ARRAY_AGG(df.aum ORDER BY dd.date DESC LIMIT 1)[OFFSET(0)] AS aum_eom,
          SUM(dd.management_fee_per_day) AS total_management_fee,
          SUM(dd.aperd_share_per_day) AS total_aperd_share,
          SUM(dd.mi_share_per_day) AS total_mi_share
        FROM daily_detail dd
        JOIN daily_fund df ON df.date = dd.date AND df.fund_id = dd.fund_id
        GROUP BY period, dd.fund_id
      )
      SELECT period,
        COUNT(DISTINCT fund_id) AS funds,
        MAX(days_running) AS days_running,
        SUM(aum_eom) AS total_aum,
        SUM(total_management_fee) AS total_management_fee,
        SUM(total_aperd_share) AS total_aperd_share,
        SUM(total_mi_share) AS total_mi_share,
        SUM(total_aperd_share) * @remisierPortion AS total_remisier_fee,
        SUM(total_aperd_share) * @remisierPortion * ${REMISIER_PPH_RATE} AS total_remisier_pph,
        SUM(total_aperd_share) * @remisierPortion * ${1 - REMISIER_PPH_RATE} AS total_remisier_fee_net,
        SUM(total_aperd_share) * (1 - @remisierPortion) AS total_sayakaya_fee
      FROM per_fund
      GROUP BY period
      ORDER BY period`,
    params: { ...params, remisierPortion },
  };
};

// ---- Remisier sharing (portfolio_with_code): same math as
// remisierRevenueDetail/Summary above, but AUM comes from
// mi_fee_logs.portfolio_with_code (one row per sid_code+fund per day) instead
// of goal_snapshots — matches the original Revenue tab's source, including
// its "-1 day" correction (portfolio_with_code's created_at is a day off from
// the AUM date it represents). Kept as a separate tab, not a replacement, so
// the two remisier calculations can be compared side by side.
function remisierRevenuePwcCTEs(field, code, from, to) {
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
      matched_users AS (
        SELECT u.sid_code AS sid, up.name, u.email
        FROM ${USERS} u
        LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
        WHERE UPPER(u.${remisierFieldColumn(field)}) LIKE CONCAT('%', UPPER(@code), '%')
      ),
      combined AS (
        SELECT
          DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) AS created_date,
          pwc.id AS fund_id,
          f.sinvest_code,
          f.name AS fund_name,
          mu.sid, mu.name, mu.email,
          pwc.amount AS aum,
          lmf.management_fee,
          lmf.aperd_share,
          lmf.mi_share
        FROM ${PORT_WITH_CODE} pwc
        JOIN matched_users mu ON mu.sid = pwc.sid_code
        LEFT JOIN ${FUNDS} f ON pwc.id = f.id
        LEFT JOIN latest_mgmt_fee lmf ON f.id = lmf.management_fee_id
        WHERE DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) BETWEEN @from AND @to
      ),
      daily AS (
        SELECT created_date AS date, fund_id, sinvest_code,
          ANY_VALUE(fund_name) AS fund_name,
          sid, ANY_VALUE(name) AS name, ANY_VALUE(email) AS email,
          SUM(aum) AS aum,
          ANY_VALUE(management_fee) AS management_fee,
          ANY_VALUE(aperd_share) AS aperd_share,
          ANY_VALUE(mi_share) AS mi_share
        FROM combined
        GROUP BY date, fund_id, sinvest_code, sid
      ),
      daily_fund AS (
        SELECT date, fund_id, SUM(aum) AS aum
        FROM daily
        GROUP BY date, fund_id
      ),
      daily_detail AS (
        SELECT *,
          (management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY) AS management_fee_per_day,
          aperd_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY)) AS aperd_share_per_day,
          mi_share * ((management_fee * aum) / DATE_DIFF(
            DATE_ADD(DATE_TRUNC(date, YEAR), INTERVAL 1 YEAR),
            DATE_TRUNC(date, YEAR), DAY)) AS mi_share_per_day
        FROM daily
      )`,
    params: { ...r, code },
  };
}

// Per fund, per investor, per period — see remisierRevenueDetail above.
const remisierRevenuePwcDetail = (field, code, from, to, granularity, remisierPortion) => {
  const { cte, params } = remisierRevenuePwcCTEs(field, code, from, to);
  const part = remisierGranularityPart(granularity);
  return {
    sql: `${cte}
      SELECT DATE_TRUNC(date, ${part}) AS period, fund_id, sinvest_code,
        sid, name, email,
        ANY_VALUE(fund_name) AS fund_name,
        ANY_VALUE(management_fee) AS management_fee,
        ANY_VALUE(aperd_share) AS aperd_share,
        ANY_VALUE(mi_share) AS mi_share,
        COUNT(DISTINCT date) AS days_running,
        AVG(aum) AS avg_aum,
        ARRAY_AGG(aum ORDER BY date DESC LIMIT 1)[OFFSET(0)] AS aum_eom,
        SUM(management_fee_per_day) AS total_management_fee,
        SUM(aperd_share_per_day) AS total_aperd_share,
        SUM(mi_share_per_day) AS total_mi_share,
        SUM(aperd_share_per_day) * @remisierPortion AS total_remisier_fee,
        SUM(aperd_share_per_day) * @remisierPortion * ${REMISIER_PPH_RATE} AS total_remisier_pph,
        SUM(aperd_share_per_day) * @remisierPortion * ${1 - REMISIER_PPH_RATE} AS total_remisier_fee_net,
        SUM(aperd_share_per_day) * (1 - @remisierPortion) AS total_sayakaya_fee
      FROM daily_detail
      GROUP BY period, fund_id, sinvest_code, sid, name, email
      ORDER BY period, fund_id, name`,
    params: { ...params, remisierPortion },
  };
};

// daily_detail is per investor; aum_eom re-derives the fund-level total via
// daily_fund rather than grabbing one investor's row off ARRAY_AGG.
const remisierRevenuePwcSummary = (field, code, from, to, granularity, remisierPortion) => {
  const { cte, params } = remisierRevenuePwcCTEs(field, code, from, to);
  const part = remisierGranularityPart(granularity);
  return {
    sql: `${cte},
      per_fund AS (
        SELECT DATE_TRUNC(dd.date, ${part}) AS period, dd.fund_id,
          COUNT(DISTINCT dd.date) AS days_running,
          ARRAY_AGG(df.aum ORDER BY dd.date DESC LIMIT 1)[OFFSET(0)] AS aum_eom,
          SUM(dd.management_fee_per_day) AS total_management_fee,
          SUM(dd.aperd_share_per_day) AS total_aperd_share,
          SUM(dd.mi_share_per_day) AS total_mi_share
        FROM daily_detail dd
        JOIN daily_fund df ON df.date = dd.date AND df.fund_id = dd.fund_id
        GROUP BY period, dd.fund_id
      )
      SELECT period,
        COUNT(DISTINCT fund_id) AS funds,
        MAX(days_running) AS days_running,
        SUM(aum_eom) AS total_aum,
        SUM(total_management_fee) AS total_management_fee,
        SUM(total_aperd_share) AS total_aperd_share,
        SUM(total_mi_share) AS total_mi_share,
        SUM(total_aperd_share) * @remisierPortion AS total_remisier_fee,
        SUM(total_aperd_share) * @remisierPortion * ${REMISIER_PPH_RATE} AS total_remisier_pph,
        SUM(total_aperd_share) * @remisierPortion * ${1 - REMISIER_PPH_RATE} AS total_remisier_fee_net,
        SUM(total_aperd_share) * (1 - @remisierPortion) AS total_sayakaya_fee
      FROM per_fund
      GROUP BY period
      ORDER BY period`,
    params: { ...params, remisierPortion },
  };
};

// ---- Remisier transactions: per-transaction detail for one or more
// referrer_code/sales_code values, with the buyer's contact info and fund
// name attached — a due-diligence/audit list next to the revenue rollups
// above, filtered by transaction date rather than snapshot date.
function remisierTransactions({ referrerCodes = [], salesCodes = [], type, status, from, to, limit = 100, offset = 0 }) {
  const params = {
    ...range(from, to),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  };
  const codeConds = [];
  if (referrerCodes.length) { codeConds.push('EXISTS (SELECT 1 FROM UNNEST(@referrerCodes) rc WHERE UPPER(u.referrer_code) LIKE CONCAT(\'%\', rc, \'%\'))'); params.referrerCodes = referrerCodes.map((c) => c.toUpperCase()); }
  if (salesCodes.length) { codeConds.push('EXISTS (SELECT 1 FROM UNNEST(@salesCodes) sc WHERE UPPER(u.sales_code) LIKE CONCAT(\'%\', sc, \'%\'))'); params.salesCodes = salesCodes.map((c) => c.toUpperCase()); }
  const codeWhere = codeConds.length ? `(${codeConds.join(' OR ')})` : 'FALSE';
  let where = `${codeWhere} AND DATE(t.created_at) BETWEEN @from AND @to`;
  if (type) { where += ' AND t.type = @type'; params.type = type; }
  if (status) { where += ' AND t.status = @status'; params.status = status; }
  return {
    sql: `SELECT
        t.id, t.transaction_number, t.type, t.status,
        t.unit, t.amount, t.final_amount, t.value_per_unit, t.realized_gain_loss,
        t.payment_method, t.payment_gateway, t.created_at, t.completed_at,
        u.sid_code AS sid, u.email, up.name, up.phone_number AS phone,
        u.referrer_code, u.sales_code,
        f.name AS fund_name, f.type AS fund_type
      FROM ${TX} t
      JOIN ${USERS} u ON u.id = t.user_id
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      LEFT JOIN ${FUNDS} f ON f.id = t.fund_id
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT @limit OFFSET @offset`,
    params,
    countSql: `SELECT COUNT(*) AS total
      FROM ${TX} t JOIN ${USERS} u ON u.id = t.user_id
      WHERE ${where}`,
  };
}

// ---- Users transactions: any investor's transactions by SID/email/name
// (partial match, caller requires at least one — this table has hundreds of
// thousands of rows), with type/status/fund/date refinements on top. Same
// users/user_profiles/funds join as remisierTransactions above, just keyed
// by investor identity instead of referrer/sales code.
function usersTransactions({ q, type, status, fundId, from, to, limit = 100, offset = 0 }) {
  const params = {
    ...range(from, to),
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  };
  let where = 'DATE(t.created_at) BETWEEN @from AND @to';
  const term = String(q || '').trim();
  if (term) {
    where += ' AND (LOWER(u.sid_code) LIKE @q OR LOWER(u.email) LIKE @q OR LOWER(up.name) LIKE @q)';
    params.q = `%${term.toLowerCase()}%`;
  }
  if (type) { where += ' AND t.type = @type'; params.type = type; }
  if (status) { where += ' AND t.status = @status'; params.status = status; }
  if (fundId) { where += ' AND t.fund_id = @fundId'; params.fundId = fundId; }
  return {
    sql: `SELECT
        t.id, t.transaction_number, t.type, t.status, t.created_at,
        t.unit, t.amount, t.final_amount, t.value_per_unit,
        u.sid_code AS sid, u.email, up.name, up.phone_number AS phone,
        f.name AS fund_name
      FROM ${TX} t
      JOIN ${USERS} u ON u.id = t.user_id
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      LEFT JOIN ${FUNDS} f ON f.id = t.fund_id
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT @limit OFFSET @offset`,
    params,
    countSql: `SELECT COUNT(*) AS total
      FROM ${TX} t
      JOIN ${USERS} u ON u.id = t.user_id
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      WHERE ${where}`,
  };
}

// ---- Top investors: biggest subscribers / redeemers / net depositors -----
// Completed buy/sell only, bucketed by transaction date (created_at) like the
// Overview buy/sell volume KPIs — not the +1 day completed_at shift the AUM
// history root-cause columns need. Share % is of every investor's total in
// the period, not just the rows returned.
const TOP_INVESTOR_ORDER = { subscriptions: 'subscriptions', redemptions: 'redemptions', net: 'net_deposit' };
const topInvestors = ({ from, to, metric, limit = 100, direction }) => {
  const order = TOP_INVESTOR_ORDER[metric] || 'subscriptions';
  const dir = direction === 'asc' ? 'ASC' : 'DESC';
  // Net can be negative: descending keeps net > 0 (biggest net depositors, as
  // before), ascending keeps net < 0 (biggest net redeemers). Subscriptions and
  // redemptions are never negative, so both directions keep > 0.
  const keep = order === 'net_deposit' && dir === 'ASC' ? '< 0' : '> 0';
  return {
    sql: `WITH per_user AS (
        SELECT user_id,
          SUM(IF(type = 'buy', final_amount, 0)) AS subscriptions,
          SUM(IF(type = 'sell', final_amount, 0)) AS redemptions,
          COUNTIF(type = 'buy') AS buys, COUNTIF(type = 'sell') AS sells
        FROM ${TX}
        WHERE status = 'completed' AND type IN ('buy', 'sell') AND DATE(created_at) BETWEEN @from AND @to
        GROUP BY user_id
      ),
      ranked AS (
        SELECT *, subscriptions - redemptions AS net_deposit,
          SAFE_DIVIDE(100 * subscriptions, SUM(subscriptions) OVER ()) AS pct_of_subscriptions,
          SAFE_DIVIDE(100 * redemptions, SUM(redemptions) OVER ()) AS pct_of_redemptions
        FROM per_user
      )
      SELECT u.sid_code AS sid, up.name, u.email,
        ROUND(r.subscriptions) AS subscriptions, r.buys, ROUND(r.pct_of_subscriptions, 2) AS pct_of_subscriptions,
        ROUND(r.redemptions) AS redemptions, r.sells, ROUND(r.pct_of_redemptions, 2) AS pct_of_redemptions,
        ROUND(r.net_deposit) AS net_deposit
      FROM ranked r
      JOIN ${USERS} u ON u.id = r.user_id
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      WHERE r.${order} ${keep}
      ORDER BY r.${order} ${dir}, u.sid_code
      LIMIT @limit`,
    params: { ...range(from, to), limit: Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000) },
  };
};

// ---- Event code tracking (generic): an event that doesn't exist yet will
// hand out its own referral/sales codes, but neither the codes nor even
// which users column they'll land in are decided yet. So, like the Remisier
// tabs above, `field` picks referrer_code or sales_code at query time
// instead of hardcoding one, and `codes` is whatever wildcard list the
// caller types in — swap in a real field/column once the event defines one.
const normalizeCodes = (codes) => (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
const eventCodeWhere = (field) => {
  const col = remisierFieldColumn(field);
  return `u.${col} IS NOT NULL AND EXISTS (SELECT 1 FROM UNNEST(@codes) c WHERE UPPER(u.${col}) LIKE CONCAT('%', c, '%'))`;
};

// Users tagged with the code, registered in the window — the population the
// funnel and cohort below are computed over. Paginated: a real code can be a
// platform-wide default/organic value shared by hundreds of thousands of
// users (confirmed in production — not just a hypothetical), so this list
// can't assume "one code = a small cohort" the way remisierUsers does.
const eventCodeUsers = (field, codes, from, to, limit = 100, offset = 0) => {
  const r = range(from, to);
  const where = `${eventCodeWhere(field)} AND DATE(u.created_at) BETWEEN @from AND @to`;
  return {
    sql: `SELECT u.id AS user_id, u.sid_code AS sid, up.name, u.email,
        u.referrer_code, u.sales_code, u.created_at, u.verified_at, u.verification_status
      FROM ${USERS} u
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      WHERE ${where}
      ORDER BY u.created_at
      LIMIT @limit OFFSET @offset`,
    params: { ...r, codes: normalizeCodes(codes), limit: parseInt(limit, 10), offset: parseInt(offset, 10) },
    countSql: `SELECT COUNT(*) AS total
      FROM ${USERS} u
      WHERE ${where}`,
  };
};

// Generic 4-step acquisition funnel (tagged -> KYC verified -> transacted ->
// repeat transacted) since the event's own rules don't exist yet — swap or
// extend the steps once they're defined. "Transacted" mirrors the referral
// program's own convention: a completed-or-in-flight buy (type='buy', not
// expired/cancelled), not necessarily settled yet.
const eventCodeFunnel = (field, codes, from, to) => {
  const r = range(from, to);
  return {
    sql: `WITH tagged AS (
        SELECT u.id AS user_id, u.verification_status
        FROM ${USERS} u
        WHERE ${eventCodeWhere(field)}
          AND DATE(u.created_at) BETWEEN @from AND @to
      ),
      tx_counts AS (
        SELECT t.user_id, COUNT(*) AS tx_count
        FROM ${TX} t
        JOIN tagged tg ON tg.user_id = t.user_id
        WHERE t.type = 'buy' AND t.status NOT IN ('expired', 'cancelled')
        GROUP BY t.user_id
      )
      SELECT
        COUNT(*) AS tagged,
        COUNTIF(tg.verification_status = 'verified') AS verified,
        COUNTIF(COALESCE(tc.tx_count, 0) >= 1) AS transacted,
        COUNTIF(COALESCE(tc.tx_count, 0) >= 2) AS repeat_transacted
      FROM tagged tg
      LEFT JOIN tx_counts tc ON tc.user_id = tg.user_id`,
    params: { ...r, codes: normalizeCodes(codes) },
  };
};

// Cohort retention, grain picked at query time (day/week/month/quarter), two
// bases to choose from since "cohort" is ambiguous for an acquisition code:
//   - 'registration' (default): cohort = the period a tagged user registered
//     in. Includes every tagged user, even ones who never transacted — an
//     acquisition-funnel view (of everyone tagged, how many converted when).
//   - 'first_tx': cohort = the period a tagged user's first buy transaction
//     landed in, same basis as ml.js:retentionCohorts. Excludes tagged users
//     with no qualifying transaction at all (they have no first_tx to anchor
//     on) — a pure engagement/repeat-purchase view.
// Either way, retained-in-a-later-period means "made a buy transaction in
// it". `periods` caps how many offsets past cohort 0 to compute (capped at
// 52, same idea as ml.js:retentionCohorts' month cap) so a day-grain cohort
// from years ago doesn't blow up into thousands of columns.
const eventCodeCohort = (field, codes, from, to, grain, periods, basis) => {
  const r = range(from, to);
  const part = granularityPart(grain, 'WEEK');
  const n = Math.min(parseInt(periods, 10) || 12, 52);
  const taggedCte = basis === 'first_tx'
    ? `tagged AS (
        SELECT ft.user_id, DATE_TRUNC(DATE(ft.first_tx_at), ${part}) AS cohort
        FROM (
          SELECT u.id AS user_id,
            ARRAY_AGG(t.created_at ORDER BY t.created_at ASC LIMIT 1)[OFFSET(0)] AS first_tx_at
          FROM ${USERS} u
          JOIN ${TX} t ON t.user_id = u.id AND t.type = 'buy' AND t.status NOT IN ('expired', 'cancelled')
          WHERE ${eventCodeWhere(field)}
            AND DATE(u.created_at) BETWEEN @from AND @to
          GROUP BY u.id
        ) ft
      )`
    : `tagged AS (
        SELECT u.id AS user_id, DATE_TRUNC(DATE(u.created_at), ${part}) AS cohort
        FROM ${USERS} u
        WHERE ${eventCodeWhere(field)}
          AND DATE(u.created_at) BETWEEN @from AND @to
      )`;
  return {
    sql: `WITH ${taggedCte},
      cohort_sizes AS (
        SELECT cohort, COUNT(*) AS cohort_size FROM tagged GROUP BY cohort
      ),
      act AS (
        SELECT DISTINCT t.user_id, DATE_TRUNC(DATE(t.created_at), ${part}) AS p
        FROM ${TX} t
        JOIN tagged tg ON tg.user_id = t.user_id
        WHERE t.type = 'buy' AND t.status NOT IN ('expired', 'cancelled')
      )
      SELECT tg.cohort, DATE_DIFF(a.p, tg.cohort, ${part}) AS period_offset,
        COUNT(DISTINCT a.user_id) AS users,
        ANY_VALUE(cs.cohort_size) AS cohort_size
      FROM tagged tg
      JOIN act a ON a.user_id = tg.user_id
      JOIN cohort_sizes cs ON cs.cohort = tg.cohort
      WHERE DATE_DIFF(a.p, tg.cohort, ${part}) BETWEEN 0 AND ${n}
      GROUP BY tg.cohort, period_offset
      ORDER BY tg.cohort, period_offset`,
    params: { ...r, codes: normalizeCodes(codes) },
  };
};

module.exports = {
  normalizeUserFilter, overviewUsers, overviewTx, overviewFunds,
  trends, breakdownBy, fundTypes, aumHistory, revenueTrend, revenueTrendDrill, aumHistoryDrill, topInvestors,
  userGrowth, verificationBreakdown,
  transactions, txFilterValues, txColumns,
  productPerformance, productPerformanceDetail, fundNavTrend, fundList,
  userSearch, usersByIdentifiers, userContact, userContactBatch, userTransactions, userRecentTransactions, userHoldings, scheduleRecipientRecap, userPortfolioSplit, userPerformance, userAumHistory,
  userHoldingsLatestDate, userHoldingsAsOf,
  userPerformanceFix, userAumHistoryFix, userHoldingsLatestDateFix, userHoldingsAsOfFix,
  allInvestorsWithAum, allRegisteredUsersWithEmail,
  userHoldingsFromTx, userHoldingsFromTxAsOf,
  hnwiLatestDate, hnwiTotal, hnwiByFund,
  dormantConversionSummary, dormantRepeatBuyers, dormantTimeToConvert,
  kalcerLatestDate, kalcerAmbassadorSummary, kalcerReferralDetail,
  pushTrend, pushByCampaign, pushByPlatform,
  marketingFunnelByChannel,
  appCrashIssues, appPerfTraces,
  productFunnelByPlatform,
  behaviorSegments, behaviorDaily, behaviorFeatureLift, behaviorPushImpact, behaviorProductInterest,
  behaviorIntentNoBuy, behaviorUserProfile, behaviorUserTimeline,
  subscriptionFunnel, subscriptionEntry, subscriptionDropoff, subscriptionPayment, subscriptionDrivers,
  subscriptionTiming, subscriptionHours, subscriptionChips, subscriptionProfile, analysisCoverage,
  onboardingFunnel, onboardingOutcome, redemptionFunnel, switchingFunnel, redemptionProfile, redemptionSignals,
  engagementFeatures, engagementSearch, engagementDiscovery, engagementActivity,
  goalLatestSnapshotDate, goalUserHoldings, goalUserHoldingsByGoal,
  campaignPerformance, switchingTopPairs, aumByManager, largestFundsAum, largestFundsLatestDate, platformAumAsOf,
  aumByRisk, aumByIncome, usersByProvince, topCitiesByInvestors, topCitiesByAum, topReferrers,
  referralProgramDetail, referralInviterStats, referralInviterStatsAlt, referralInvitedUsers, reconciliationDaily,
  sinvestTransactions, sinvestHoldings, sinvestHoldingsAsOf,
  revenueDetail, revenueMonthlySummary,
  revenueV2Detail, revenueV2MonthlySummary,
  userLifetimeUsers, userLifetimeDetail, userLifetimeSummary,
  campaignRevenueDetail, campaignRevenueByCampaign, campaignRevenueSummary,
  remisierUsers, remisierRevenueDetail, remisierRevenueSummary,
  remisierRevenuePwcDetail, remisierRevenuePwcSummary, remisierTransactions,
  usersTransactions,
  eventCodeUsers, eventCodeFunnel, eventCodeCohort,
};
