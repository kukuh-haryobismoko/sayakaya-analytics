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

// Shared day/week/month/quarter -> DATE_TRUNC part mapping, used everywhere a
// query lets the caller pick the bucket size (revenue, remisier revenue, ...).
const granularityPart = (granularity?: string, fallback = 'MONTH'): string =>
  ({ day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER' } as Record<string, string>)[granularity || ''] || fallback;

// Wildcard (partial, case-insensitive) fund/MI filter shared by the revenue
// queries below — empty string means "no filter" for that field.
const FUND_MI_FILTER_SQL = `
  (@fund = '' OR UPPER(f.name) LIKE CONCAT('%', UPPER(@fund), '%') OR UPPER(f.sinvest_code) LIKE CONCAT('%', UPPER(@fund), '%'))
  AND (@mi = '' OR UPPER(COALESCE(im.common_name, im.name)) LIKE CONCAT('%', UPPER(@mi), '%'))`;

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
// AUM KPI. avg_buy_price is unit-weighted across the buy price carried on the
// portfolio rows themselves (portfolios.initial_price / bonus_portfolios.average_nav),
// so it exists even for holdings with no completed buy transaction (transfers, bonus).
export const userHoldings = (userId: string): Query => ({
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

// Same shape as userHoldings() above, but avg_buy_price is derived from the
// real transaction ledger instead of portfolios.initial_price (which can
// silently drift from the actual buy price — see the IDD031084165546 case).
// Weighted-average cost method: only "incoming" transaction types set the
// average (buy, SWITCH_IN, reinvestment, transfer_in); sells/switch-outs/
// transfers-out/liquidation/unit_adjustment reduce units only and never move
// the average. Bonus units have no transaction trail, so they keep using
// bonus_portfolios.average_nav, same as userHoldings().
export const userHoldingsFromTx = (userId: string): Query => ({
  sql: `WITH incoming_tx AS (
      -- unit is FLOAT64 on transactions (unlike portfolios/bonus_portfolios,
      -- which are NUMERIC) — cast so the weighted average below is computed
      -- in exact decimal arithmetic, same as every other portfolio query,
      -- instead of picking up FLOAT64 binary-representation noise.
      SELECT fund_id, CAST(unit AS NUMERIC) AS unit, value_per_unit
      FROM ${TX}
      WHERE user_id = @userId
        AND type IN ('buy', 'SWITCH_IN', 'reinvestment', 'transfer_in')
        AND status IN ('completed', 'completed_payment', 'verified')
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
export const userHoldingsFromTxAsOf = (userId: string, date: string): Query => ({
  sql: `WITH incoming_tx AS (
      -- unit is FLOAT64 on transactions (unlike portfolios/bonus_portfolios,
      -- which are NUMERIC) — cast so unit and the weighted average below are
      -- computed in exact decimal arithmetic, same as every other portfolio
      -- query, instead of picking up FLOAT64 binary-representation noise.
      SELECT fund_id, CAST(unit AS NUMERIC) AS unit, value_per_unit, created_at
      FROM ${TX}
      WHERE user_id = @userId
        AND type IN ('buy', 'SWITCH_IN', 'reinvestment', 'transfer_in')
        AND status IN ('completed', 'completed_payment', 'verified')
        AND DATE(created_at) <= @date
    ),
    outgoing_tx AS (
      SELECT fund_id, CAST(unit AS NUMERIC) AS unit
      FROM ${TX}
      WHERE user_id = @userId
        AND type IN ('sell', 'SWITCH_OUT', 'transfer_out', 'liquidation', 'unit_adjustment')
        AND status IN ('completed', 'completed_payment', 'verified')
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
export const goalLatestSnapshotDate = (userId: string): Query => ({
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
export const goalUserHoldings = (userId: string, asOfDate: string): Query => ({
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
export const goalUserHoldingsByGoal = (userId: string, asOfDate: string): Query => ({
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

// Latest date with a portfolio_with_code snapshot for this SID — default for
// the "as of" date picker below, and the "latest available" comparison line.
// created_at's date is a day ahead of the AUM date it represents (same
// correction as revenueCTEs/remisierRevenuePwcCTEs elsewhere in this file).
export const userHoldingsLatestDate = (sid: string): Query => ({
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
export const userHoldingsAsOf = (sid: string, date: string): Query => ({
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

export const userAumHistoryFix = (sid: string): Query => ({
  sql: `SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS bucket, SUM(amount) AS amount
    FROM ${PORT_FIX}
    WHERE sid_code = @sid
    GROUP BY bucket ORDER BY bucket`,
  params: { sid },
});

export const userPerformanceFix = (sid: string): Query => ({
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

export const userHoldingsLatestDateFix = (sid: string): Query => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_FIX} WHERE sid_code = @sid`,
  params: { sid },
});

export const userHoldingsAsOfFix = (sid: string, date: string): Query => ({
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

// ---- HNWI (High Net Worth Individual): investors at/above an AUM threshold,
// as of a specific date, from portfolio_with_code — same -1 day correction as
// the rest of this section (created_at is a day ahead of the AUM date it
// represents). Two shapes: one row per investor (total AUM across funds), and
// one row per investor per fund (for a full breakdown export).
export const hnwiLatestDate = (): Query => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_WITH_CODE}`,
  params: {},
});

function hnwiCTE(date: string, minAum?: number | string) {
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
        HAVING SUM(amount) >= @minAum
      )`,
    params: { date, minAum: Number(minAum) || 0 },
  };
}

export const hnwiTotal = (date: string, minAum?: number | string, limit: number | string = 500): Query => {
  const { cte, params } = hnwiCTE(date, minAum);
  return {
    sql: `${cte}
      SELECT u.sid_code, up.name, u.ifua_code AS ifua, up.phone_number AS phone, u.email, up.birthdate,
        pu.total_aum, pu.aum_date
      FROM per_user pu
      JOIN ${USERS} u ON u.sid_code = pu.sid_code
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      ORDER BY pu.total_aum DESC
      LIMIT @limit`,
    params: { ...params, limit: parseInt(String(limit), 10) || 500 },
  };
};

export const hnwiByFund = (date: string, minAum?: number | string, limit: number | string = 5000): Query => {
  const { cte, params } = hnwiCTE(date, minAum);
  return {
    sql: `${cte}
      SELECT u.sid_code, up.name, u.ifua_code AS ifua, up.phone_number AS phone, u.email, up.birthdate,
        d.fund_name, d.amount AS fund_aum, d.aum_date, pu.total_aum
      FROM daily d
      JOIN per_user pu ON pu.sid_code = d.sid_code
      JOIN ${USERS} u ON u.sid_code = d.sid_code
      LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
      ORDER BY pu.total_aum DESC, u.sid_code, d.fund_name
      LIMIT @limit`,
    params: { ...params, limit: parseInt(String(limit), 10) || 5000 },
  };
};

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

// Overview "Largest funds by AUM": one daily batch from portfolio_with_code
// (one row per sid_code+fund+day), not funds.latest_aum_value/snapshots —
// those lag the actual book, and not portfolio_fix — that only has history
// back to early August, and this panel needs to backtrace older dates too.
// Same -1 day correction as the rest of the portfolio_with_code queries in
// this file (created_at's date is a day ahead of the AUM date it
// represents). AUM = SUM(amount) of that batch; investors = COUNT(DISTINCT
// sid_code). groupBy switches the rollup between fund and investment
// manager; excludeFunds drops those funds before the rollup so an MI's total
// reflects the exclusion too. Shows every fund/MI — no LIMIT.
export const largestFundsLatestDate = (): Query => ({
  sql: `SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS latest_date FROM ${PORT_WITH_CODE}`,
  params: {},
});

export const largestFundsAum = (groupBy = 'fund', date?: string, excludeFunds: string[] = []): Query => {
  const label = groupBy === 'manager' ? 'COALESCE(im.common_name, im.name)' : 'f.name';
  const names = (Array.isArray(excludeFunds) ? excludeFunds : []).filter(Boolean);
  const params: Record<string, unknown> = { date };
  let excludeFilter = '';
  if (names.length) { excludeFilter = 'WHERE f.name NOT IN UNNEST(@excludeFunds)'; params.excludeFunds = names; }
  return {
    sql: `WITH latest AS (
        SELECT sid_code, id AS fund_id, amount
        FROM ${PORT_WITH_CODE}
        WHERE DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date AND total_unit > 0
      )
      SELECT ${label} AS label,
        ROUND(SUM(l.amount)) AS aum,
        COUNT(DISTINCT l.sid_code) AS investors
      FROM latest l
      JOIN ${FUNDS} f ON f.id = l.fund_id
      LEFT JOIN ${IM} im ON im.id = f.investment_manager_id
      ${excludeFilter}
      GROUP BY label
      ORDER BY aum DESC`,
    params,
  };
};

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
export const usersByProvince = (): Query => ({
  sql: `WITH ${CITY_LOOKUP_CTE},
    ${ACTIVE_CTE},
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
    LEFT JOIN aum_by_user abu ON abu.user_id = up.user_id
    GROUP BY cl.province_name
    ORDER BY investor_count DESC`,
  params: {},
});

// Top cities by investor count, and separately by AUM — the finer-grained
// companion to the province map (508 distinct cities is too many to put on
// one map at a glance, so these are ranked lists instead of a second map).
// Same join/shape for both, ordered differently — hence the shared builder.
function topCitiesQuery(limit: number | string, orderBy: 'investor_count' | 'total_aum'): Query {
  return {
    sql: `WITH ${CITY_LOOKUP_CTE},
      ${ACTIVE_CTE},
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
      LEFT JOIN aum_by_user abu ON abu.user_id = up.user_id
      GROUP BY cl.city_name, cl.province_name
      ORDER BY ${orderBy} DESC
      LIMIT @limit`,
    params: { limit: parseInt(String(limit), 10) },
  };
}
export const topCitiesByInvestors = (limit: number | string = 15): Query => topCitiesQuery(limit, 'investor_count');
export const topCitiesByAum = (limit: number | string = 15): Query => topCitiesQuery(limit, 'total_aum');

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

// Transaction_Type is a numeric-code string ('1'..'9') for KSEI/SInvest's
// Subscription/Redemption/Switch In/Switch Out/Reinvestment/Liquidation/
// Transfer In/Transfer Out/Unit Adjustment.
const RECON_TYPE_CASE = `CASE Transaction_Type
        WHEN '1' THEN 'BUY' WHEN '2' THEN 'SELL' WHEN '3' THEN 'SWITCH_IN' WHEN '4' THEN 'SWITCH_OUT'
        WHEN '5' THEN 'REINVESTMENT' WHEN '6' THEN 'LIQUIDATION' WHEN '7' THEN 'TRANSFER_IN'
        WHEN '8' THEN 'TRANSFER_OUT' WHEN '9' THEN 'UNIT_ADJUSTMENT' ELSE 'OTHER' END`;

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

export function sinvestTransactions(
  { from, to, type, sid, search, limit = 50, offset = 0 }:
  { from?: string; to?: string; type?: string; sid?: string; search?: string; limit?: number | string; offset?: number | string },
): Query {
  const r = range(from, to);
  const params: Record<string, unknown> = {
    fromYmd: r.from.replace(/-/g, ''), toYmd: r.to.replace(/-/g, ''),
    limit: parseInt(String(limit), 10), offset: parseInt(String(offset), 10),
  };
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
export const sinvestHoldings = (sid: string): Query => ({
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
export const sinvestHoldingsAsOf = (sid: string, date: string): Query => {
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
function revenueCTEs(from?: string, to?: string, granularity = 'month', fund = '', mi = '') {
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

export const revenueDetail = (from?: string, to?: string, granularity = 'month', fund = '', mi = ''): Query => {
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
export const revenueMonthlySummary = (from?: string, to?: string, granularity = 'month', fund = '', mi = ''): Query => {
  const { cte, params } = revenueCTEs(from, to, granularity, fund, mi);
  const part = granularityPart(granularity);
  // avg_aum here is the average of each day's *platform-wide* total AUM
  // across the period — not an average of each fund's own average (which
  // would double-count differently sized funds) or of end-of-period values.
  return {
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

// ---- Remisier sharing: same management-fee math as Revenue above, but the
// AUM comes from goal_snapshots (already daily, per user+fund) filtered down
// to one remisier's users, instead of the whole platform's daily AUM — so
// there's no "-1 day" correction to make (that only exists because
// portfolio_with_code's created_at is a day off from the AUM date it
// represents; goal_snapshots.date is already correct). Remisier fee is a
// portion of the AperD share specifically (never of the raw management
// fee) — the rest of the AperD share stays with Sayakaya.
const remisierFieldColumn = (field?: string): string =>
  ({ referrer_code: 'referrer_code', sales_code: 'sales_code' } as Record<string, string>)[field || ''] || 'sales_code';
const remisierGranularityPart = (granularity?: string): string => granularityPart(granularity, 'DAY');
// PPh 23 withholding tax cut on the remisier's fee — a fixed statutory rate,
// not a runtime input like remisierPortion.
const REMISIER_PPH_RATE = 0.025;

// Users matching a remisier's code — lets the remisier's book of business be
// listed/verified before running the revenue calculation below.
export const remisierUsers = (field: string, code: string): Query => ({
  sql: `SELECT u.id AS user_id, u.sid_code AS sid, up.name, u.email, u.referrer_code, u.sales_code
    FROM ${USERS} u
    LEFT JOIN ${USER_PROFILES} up ON up.user_id = u.id
    WHERE UPPER(u.${remisierFieldColumn(field)}) LIKE CONCAT('%', UPPER(@code), '%')
    ORDER BY up.name`,
  params: { code },
});

function remisierRevenueCTEs(field: string, code: string, from?: string, to?: string) {
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

// Per fund, per investor, per period — keeps each of the remisier's
// investors as its own row (sid/name/email), since "one row per fund" was
// hiding whose AUM the fee actually came from.
export const remisierRevenueDetail = (
  field: string, code: string, from: string | undefined, to: string | undefined,
  granularity: string | undefined, remisierPortion: number,
): Query => {
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
export const remisierRevenueSummary = (
  field: string, code: string, from: string | undefined, to: string | undefined,
  granularity: string | undefined, remisierPortion: number,
): Query => {
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
function remisierRevenuePwcCTEs(field: string, code: string, from?: string, to?: string) {
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
export const remisierRevenuePwcDetail = (
  field: string, code: string, from: string | undefined, to: string | undefined,
  granularity: string | undefined, remisierPortion: number,
): Query => {
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
export const remisierRevenuePwcSummary = (
  field: string, code: string, from: string | undefined, to: string | undefined,
  granularity: string | undefined, remisierPortion: number,
): Query => {
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
export interface RemisierTransactionsArgs {
  referrerCodes?: string[]; salesCodes?: string[]; type?: string; status?: string;
  from?: string; to?: string; limit?: number | string; offset?: number | string;
}

export function remisierTransactions(
  { referrerCodes = [], salesCodes = [], type, status, from, to, limit = 100, offset = 0 }: RemisierTransactionsArgs,
): Query {
  const params: Record<string, unknown> = {
    ...range(from, to),
    limit: parseInt(String(limit), 10),
    offset: parseInt(String(offset), 10),
  };
  const codeConds: string[] = [];
  if (referrerCodes.length) {
    codeConds.push("EXISTS (SELECT 1 FROM UNNEST(@referrerCodes) rc WHERE UPPER(u.referrer_code) LIKE CONCAT('%', rc, '%'))");
    params.referrerCodes = referrerCodes.map((c) => c.toUpperCase());
  }
  if (salesCodes.length) {
    codeConds.push("EXISTS (SELECT 1 FROM UNNEST(@salesCodes) sc WHERE UPPER(u.sales_code) LIKE CONCAT('%', sc, '%'))");
    params.salesCodes = salesCodes.map((c) => c.toUpperCase());
  }
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

// ---- Revenue v2: same shape/columns as revenueDetail/revenueMonthlySummary
// above, but AUM comes from goal_snapshots instead of
// mi_fee_logs.portfolio_with_code — goal_snapshots.date is already the
// correct AUM date, so there's no "-1 day" correction to make, which is what
// makes this the more accurate of the two. Kept as a fully separate section
// (not a replacement) so the two can be compared side by side.
function revenueV2CTEs(from?: string, to?: string, granularity = 'month', fund = '', mi = '') {
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

export const revenueV2Detail = (from?: string, to?: string, granularity = 'month', fund = '', mi = ''): Query => {
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

export const revenueV2MonthlySummary = (from?: string, to?: string, granularity = 'month', fund = '', mi = ''): Query => {
  const { cte, params } = revenueV2CTEs(from, to, granularity, fund, mi);
  const part = granularityPart(granularity);
  // avg_aum here is the average of each day's *platform-wide* total AUM
  // across the period — not an average of each fund's own average (which
  // would double-count differently sized funds) or of end-of-period values.
  return {
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
function userLifetimeCTEs(from?: string, to?: string, fund = '', mi = '', sid = '') {
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
    WHERE status IN ('completed','completed_payment','verified')
    GROUP BY user_id
  )`;

// Per-investor table. Ordered by the platform's own take (AperD share) so the
// LIMIT keeps the investors that actually matter to revenue.
//
// holding_lifetime_days runs from the investor's first buy to today when they
// still show up in the snapshot feed (last_hold within 3 days of today, which
// absorbs the feed's normal 1-2 day lag), otherwise to their last sell — i.e.
// "how long have they been invested", not "how long has the feed seen them".
export const userLifetimeUsers = (from?: string, to?: string, fund = '', mi = '', sid = '', limit: number | string = 200): Query => {
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
    params: { ...params, limit: parseInt(String(limit), 10) || 200 },
  };
};

// Drill-down for one investor: per period, per fund. @sid is required by the
// route — without it this would aggregate the whole platform per fund.
export const userLifetimeDetail = (sid: string, from?: string, to?: string, granularity = 'month', fund = '', mi = ''): Query => {
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
export const userLifetimeSummary = (from?: string, to?: string, granularity = 'month', fund = '', mi = ''): Query => {
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
function campaignRevenueCTEs(from?: string, to?: string, promo = '') {
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
        WHERE status IN ('completed','completed_payment','verified') AND goal_id IS NOT NULL
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
export const campaignRevenueDetail = (from?: string, to?: string, granularity = 'month', promo = ''): Query => {
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
export const campaignRevenueByCampaign = (from?: string, to?: string, promo = ''): Query => {
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
export const campaignRevenueSummary = (from?: string, to?: string, granularity = 'month', promo = ''): Query => {
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
