// AI Insights tab: weekly digest, anomaly scan, churn action list, data-quality
// watchdog and the per-investor narrative. Mirrored in supabase/functions/api/insights.ts,
// keep both in sync.
//
// Division of labour: SQL and JS compute every number and every flag, the model
// only writes the sentences around them. It never receives names, SIDs or emails.
'use strict';

const { runQuery } = require('./bigquery');
const Q = require('./queries');
const { aiText, langRule } = require('./ask');

const PWC = '`sayakaya.mi_fee_logs.portfolio_with_code`';
const PORT_FIX = '`sayakaya.mi_fee_logs.portfolio_fix`';
const TX = '`sayakaya.main.transactions`';
const FUNDS = '`sayakaya.main.funds`';
const USERS = '`sayakaya.main.users`';
const GOAL_SNAPSHOTS = '`sayakaya.main.goal_snapshots`';
const SNAPSHOTS = '`sayakaya.main.snapshots`';

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pct = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

// ---- 1. Weekly digest ------------------------------------------------------

const digestSystem = (lang) => `You write the weekly business digest for the team at Sayakaya, an Indonesian mutual-fund app. You get a JSON object of already-computed figures. ${langRule(lang)} 5 to 8 short sentences in plain paragraphs: lead with AUM and its direction, then net flow (buy minus sell), then new users, then one thing worth watching. Use only the figures given, never invent a cause, a fund name or a number. Amounts are rupiah. No headings, no bullet points, no em dashes, no emoji.`;

async function digest(lang) {
  // AUM per day from portfolio_fix, ACTIVE funds only (the dashboard's AUM rule:
  // a liquidated fund is no longer a real position). created_at is one day ahead
  // of the AUM date it holds, so shift back to the real date.
  const aum = await runQuery(`
    SELECT FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(p.created_at), INTERVAL 1 DAY)) AS day, SUM(p.amount) AS v
    FROM ${PORT_FIX} p JOIN ${FUNDS} f ON f.id = p.id AND f.listing_status = 'ACTIVE'
    WHERE DATE(p.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 46 DAY)
    GROUP BY day ORDER BY day`, {});
  if (!aum.length) throw new Error('No AUM data found in portfolio_fix for the last 45 days.');
  const at = (back) => {
    const last = new Date(String(aum[aum.length - 1].day) + 'T00:00:00Z').getTime();
    const want = new Date(last - back * 86400000).toISOString().slice(0, 10);
    const hit = aum.find((r) => r.day === want);
    return hit ? num(hit.v) : null;
  };
  const now = num(aum[aum.length - 1].v), d7 = at(7), d30 = at(30);

  // Net flow as the AUM history tab counts it: completed buy and sell of ACTIVE
  // funds, final_amount. Both windows end on the latest AUM day.
  const [flow] = await runQuery(`
    WITH last AS (SELECT MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS d FROM ${PORT_FIX}),
    f AS (
      SELECT DATE(t.completed_at) AS d, t.type, SUM(t.final_amount) AS v
      FROM ${TX} t JOIN ${FUNDS} fu ON fu.id = t.fund_id
      WHERE t.status = 'completed' AND t.type IN ('buy', 'sell') AND fu.listing_status = 'ACTIVE'
        AND DATE(t.completed_at) > DATE_SUB((SELECT d FROM last), INTERVAL 14 DAY)
        AND DATE(t.completed_at) <= (SELECT d FROM last)
      GROUP BY d, type)
    SELECT
      SUM(IF(type = 'buy'  AND d >  DATE_SUB((SELECT d FROM last), INTERVAL 7 DAY), v, 0)) AS buy_7d,
      SUM(IF(type = 'sell' AND d >  DATE_SUB((SELECT d FROM last), INTERVAL 7 DAY), v, 0)) AS sell_7d,
      SUM(IF(type = 'buy'  AND d <= DATE_SUB((SELECT d FROM last), INTERVAL 7 DAY), v, 0)) AS buy_prev,
      SUM(IF(type = 'sell' AND d <= DATE_SUB((SELECT d FROM last), INTERVAL 7 DAY), v, 0)) AS sell_prev
    FROM f`, {});
  const [usr] = await runQuery(`
    SELECT COUNTIF(DATE(created_at) > DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)) AS new_7d,
      COUNTIF(DATE(created_at) <= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)) AS new_prev
    FROM ${USERS} WHERE DATE(created_at) > DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)`, {});

  const buy = num(flow?.buy_7d), sell = num(flow?.sell_7d);
  const buyPrev = num(flow?.buy_prev), sellPrev = num(flow?.sell_prev);
  const facts = {
    as_of: aum[aum.length - 1].day,
    aum_now: now, aum_7d_ago: d7, aum_30d_ago: d30,
    aum_change_7d_pct: d7 == null ? null : pct(now, d7),
    aum_change_30d_pct: d30 == null ? null : pct(now, d30),
    last_7d: { buy: buy, sell: sell, net_flow: buy - sell },
    previous_7d: { buy: buyPrev, sell: sellPrev, net_flow: buyPrev - sellPrev },
    new_users_last_7d: num(usr?.new_7d), new_users_previous_7d: num(usr?.new_prev),
  };
  const text = await aiText(digestSystem(lang), JSON.stringify(facts));
  return { facts, text };
}

// ---- 2. Anomaly scan -------------------------------------------------------

// Plain statistics, no model: each day is compared with the previous 28 days of
// the same series. AUM is judged on its day-over-day change (the level trends),
// buy and sell volume on their level. |z| >= 3 in the last 14 days is flagged.
async function anomalies() {
  return await runQuery(`
    WITH aum AS (
      SELECT DATE_SUB(DATE(p.created_at), INTERVAL 1 DAY) AS d, SUM(p.amount) AS v FROM ${PORT_FIX} p JOIN ${FUNDS} f ON f.id = p.id AND f.listing_status = 'ACTIVE'
      WHERE DATE(p.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 61 DAY) GROUP BY d),
    tx AS (
      SELECT DATE(t.completed_at) AS d, t.type, SUM(t.final_amount) AS v FROM ${TX} t JOIN ${FUNDS} f ON f.id = t.fund_id
      WHERE t.status = 'completed' AND t.type IN ('buy', 'sell') AND f.listing_status = 'ACTIVE'
        AND DATE(t.completed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
      GROUP BY d, type),
    series AS (
      SELECT 'AUM' AS metric, d, v FROM aum
      UNION ALL SELECT 'Buy volume', d, v FROM tx WHERE type = 'buy'
      UNION ALL SELECT 'Sell volume', d, v FROM tx WHERE type = 'sell'),
    w AS (SELECT metric, d, v, LAG(v) OVER (PARTITION BY metric ORDER BY d) AS prev FROM series),
    c AS (SELECT metric, d, v, IF(metric = 'AUM', SAFE_DIVIDE(v - prev, prev), v) AS x FROM w),
    z AS (
      SELECT metric, d, v, x, AVG(x) OVER win AS mu, STDDEV_SAMP(x) OVER win AS sd
      FROM c WINDOW win AS (PARTITION BY metric ORDER BY d ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING))
    SELECT metric, FORMAT_DATE('%Y-%m-%d', d) AS day, ROUND(v) AS value, ROUND(SAFE_DIVIDE(x - mu, sd), 2) AS z,
      IF(metric = 'AUM', ROUND(x * 100, 2), NULL) AS change_pct
    FROM z WHERE d >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY) AND ABS(SAFE_DIVIDE(x - mu, sd)) >= 3
    ORDER BY d DESC, metric`, {});
}

// ---- 3. Churn action list --------------------------------------------------

// Who to win back, judged on money that left, not on a model score: investors
// whose AUM was once large and is now mostly gone (redeemed everything, or fell
// to a fraction of their peak) and who have not bought in the last 30 days.
// AUM per day is SUM(amount) per SID from portfolio_with_code over ACTIVE funds
// only (the dashboard's AUM rule), with the usual one-day correction on created_at. That table starts in mid January 2026, so
// peaks before then are not visible. Once a user holds nothing the rows stop
// coming, so "no row in the last 2 days" means current AUM is 0.
//   Priority 1: peak 100 jt or more, 20% or less of it left
//   Priority 2: peak 25 jt or more, 50% or less left
//   Priority 3: peak 10 jt or more, 50% or less left
const CHURN_SQL = `
  WITH snap AS (
    SELECT p.sid_code, DATE_SUB(DATE(p.created_at), INTERVAL 1 DAY) AS d, SUM(p.amount) AS aum
    FROM ${PWC} p JOIN ${FUNDS} f ON f.id = p.id AND f.listing_status = 'ACTIVE'
    GROUP BY p.sid_code, d),
  latest AS (SELECT MAX(d) AS d FROM snap),
  per AS (
    SELECT sid_code,
      ARRAY_AGG(STRUCT(d, aum) ORDER BY aum DESC LIMIT 1)[OFFSET(0)] AS peak,
      ARRAY_AGG(STRUCT(d, aum) ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS last
    FROM snap GROUP BY sid_code),
  cur AS (
    SELECT sid_code, peak.aum AS peak_aum, peak.d AS peak_date, last.d AS last_snap,
      IF(last.d >= DATE_SUB((SELECT d FROM latest), INTERVAL 2 DAY), last.aum, 0) AS current_aum
    FROM per),
  tx AS (
    SELECT user_id, MAX(IF(type = 'buy', DATE(created_at), NULL)) AS last_buy, MAX(IF(type = 'sell', DATE(created_at), NULL)) AS last_sell
    FROM ${TX} WHERE status = 'completed' AND type IN ('buy', 'sell') GROUP BY user_id),
  c AS (
    SELECT cur.*, u.id AS user_id, tx.last_buy, tx.last_sell, (SELECT d FROM latest) AS as_of,
      CASE WHEN peak_aum >= 1e8 AND current_aum <= peak_aum * 0.2 THEN 1
           WHEN peak_aum >= 2.5e7 AND current_aum <= peak_aum * 0.5 THEN 2
           WHEN peak_aum >= 1e7 AND current_aum <= peak_aum * 0.5 THEN 3 END AS priority
    FROM cur JOIN ${USERS} u ON u.sid_code = cur.sid_code LEFT JOIN tx ON tx.user_id = u.id)
  SELECT c.priority, up.name, u.email, up.phone_number AS phone, IFNULL(u.is_institution, FALSE) AS is_institution,
    ROUND(c.peak_aum) AS peak_aum, FORMAT_DATE('%Y-%m-%d', c.peak_date) AS peak_date, ROUND(c.current_aum) AS current_aum,
    ROUND(SAFE_DIVIDE(c.current_aum - c.peak_aum, c.peak_aum) * 100, 1) AS change_pct,
    IF(c.current_aum = 0, DATE_DIFF(c.as_of, c.last_snap, DAY), NULL) AS days_since_redeem_all,
    FORMAT_DATE('%Y-%m-%d', c.last_buy) AS last_buy, FORMAT_DATE('%Y-%m-%d', c.last_sell) AS last_sell,
    IF(c.last_buy IS NULL, NULL, DATE_DIFF(CURRENT_DATE(), c.last_buy, DAY)) AS days_since_buy
  FROM c JOIN ${USERS} u ON u.id = c.user_id LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = c.user_id
  WHERE c.priority IS NOT NULL AND (c.last_buy IS NULL OR c.last_buy < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))`;

async function churnActions() {
  const found = await runQuery(CHURN_SQL, {});
  const rows = found.map((r) => {
    const gone = num(r.current_aum) === 0;
    const priority = num(r.priority);
    // action_key lets the page show the line in the dashboard's language; the English text stays as a fallback.
    const actionKey = `${priority === 1 ? 'call' : 'msg'}_${gone ? 'gone' : 'drop'}`;
    const action = {
      call_gone: 'Call personally: redeemed everything and has not come back',
      msg_gone: 'Send a win-back message: redeemed everything and has not come back',
      call_drop: 'Call personally: AUM is down more than 80% from its peak',
      msg_drop: 'Send a win-back message: AUM is down by half or more from its peak',
    }[actionKey];
    return { ...r, status: gone ? 'Redeemed all' : 'Dropped', priority, action, action_key: actionKey, lost: num(r.peak_aum) - num(r.current_aum) };
  }).sort((a, b) => a.priority - b.priority || b.lost - a.lost);
  const count = (p) => rows.filter((r) => r.priority === p).length;
  return {
    summary: {
      priority_1: count(1), priority_2: count(2), priority_3: count(3),
      redeemed_all: rows.filter((r) => r.status === 'Redeemed all').length,
      aum_lost: rows.reduce((s, r) => s + r.lost, 0),
    },
    rows,
  };
}

// ---- 4. Data-quality watchdog ---------------------------------------------

const watchdogSystem = (lang) => `You review automated data-quality checks for the analytics team of an Indonesian mutual-fund app. You get JSON with each source's latest date and a same-day AUM comparison across portfolio_with_code, portfolio_fix and goal_snapshots, ACTIVE funds only. ${langRule(lang)} 3 to 6 short sentences: name what is stale or disagrees, by how much, and what to check first. Only use the figures given. If everything is within tolerance, say so in one sentence. Known and expected: portfolio_with_code and portfolio_fix are dated one day ahead and are already corrected, they should agree almost exactly, and goal_snapshots can run slightly below them. No headings, no bullet points, no em dashes.`;

async function watchdog(lang) {
  const freshness = await runQuery(`
    SELECT 'portfolio_with_code' AS source, FORMAT_DATE('%Y-%m-%d', MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY))) AS latest FROM ${PWC}
    UNION ALL SELECT 'portfolio_fix', FORMAT_DATE('%Y-%m-%d', MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY))) FROM ${PORT_FIX}
    UNION ALL SELECT 'goal_snapshots', FORMAT_DATE('%Y-%m-%d', MAX(date)) FROM ${GOAL_SNAPSHOTS}
    UNION ALL SELECT 'fund NAV (snapshots)', FORMAT_DATE('%Y-%m-%d', MAX(DATE(created_at))) FROM ${SNAPSHOTS} WHERE type = 'NAV'
    UNION ALL SELECT 'transactions', FORMAT_DATE('%Y-%m-%d', MAX(DATE(created_at))) FROM ${TX}`, {});

  // Same AUM date, three sources, ACTIVE funds only (the dashboard's AUM rule).
  // goal_snapshots is deduplicated to the latest row per goal, fund and date, as
  // in the Portfolio Explorer.
  const compare = await runQuery(`
    WITH act AS (SELECT id FROM ${FUNDS} WHERE listing_status = 'ACTIVE'),
    gs AS (
      SELECT d, SUM(unit * nav) AS v FROM (
        SELECT s.date AS d, s.unit, s.nav FROM ${GOAL_SNAPSHOTS} s
        WHERE s.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) AND s.fund_id IN (SELECT id FROM act)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY s.goal_id, s.fund_id, s.date ORDER BY s.created_at DESC) = 1) GROUP BY d),
    fx AS (SELECT DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS d, SUM(amount) AS v FROM ${PORT_FIX}
      WHERE id IN (SELECT id FROM act) AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) GROUP BY d),
    pw AS (SELECT DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS d, SUM(amount) AS v FROM ${PWC}
      WHERE id IN (SELECT id FROM act) AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) GROUP BY d)
    SELECT FORMAT_DATE('%Y-%m-%d', gs.d) AS day, ROUND(gs.v) AS goal_snapshots, ROUND(fx.v) AS portfolio_fix, ROUND(pw.v) AS portfolio_with_code
    FROM gs LEFT JOIN fx ON fx.d = gs.d LEFT JOIN pw ON pw.d = gs.d ORDER BY gs.d DESC`, {});

  const today = new Date().toISOString().slice(0, 10);
  const ageDays = (day) => Math.round((Date.parse(today) - Date.parse(String(day))) / 86400000);
  const checks = freshness.map((r) => {
    const age = r.latest ? ageDays(r.latest) : null;
    return { source: r.source, latest: r.latest, age_days: age, status: age == null || age > 2 ? 'stale' : 'ok' };
  });
  const diffs = compare.map((r) => {
    const gs = num(r.goal_snapshots), fx = num(r.portfolio_fix), pw = num(r.portfolio_with_code);
    const gsGap = pw ? pct(gs, pw) : null, fxGap = pw && fx ? pct(fx, pw) : null;
    return {
      day: r.day, goal_snapshots: gs, portfolio_fix: fx || null, portfolio_with_code: pw || null,
      goal_snapshots_vs_pwc_pct: gsGap, portfolio_fix_vs_pwc_pct: fxGap,
      // goal_snapshots can sit slightly low, so only flag beyond 3. portfolio_fix and
      // portfolio_with_code should agree, so flag beyond 1.
      status: (gsGap != null && Math.abs(gsGap) > 3) || (fxGap != null && Math.abs(fxGap) > 1) ? 'differs' : 'ok',
    };
  });
  const text = await aiText(watchdogSystem(lang), JSON.stringify({ today, checks, same_day_aum: diffs }));
  return { checks, diffs, text };
}

// ---- 5. Per-investor narrative --------------------------------------------

const narrativeSystem = (lang) => `You write a short portfolio note for one mutual-fund investor, as an advisor would, for the Sayakaya team to read or paste into a statement. You get JSON with current holdings and period changes. ${langRule(lang)} 4 to 6 sentences: total value and the biggest holding with its share, the overall gain or loss, how the value moved over the periods given, and one balanced observation about concentration or fund types. Only use the figures given. Do not recommend buying or selling, do not predict returns, no em dashes, no emoji.`;

async function portfolioNarrative(userId, sid, lang) {
  const h = Q.userHoldings(userId);
  const p = Q.userPerformance(sid);
  const [holdings, perf] = await Promise.all([runQuery(h.sql, h.params), runQuery(p.sql, p.params)]);
  if (!holdings.length) throw new Error('This investor has no active holdings to describe.');
  const total = holdings.reduce((s, r) => s + num(r.value), 0);
  const facts = {
    total_value: total,
    holdings: holdings.slice(0, 12).map((r) => ({
      fund: r.fund, type: r.fund_type, value: num(r.value),
      share_pct: total ? Math.round((num(r.value) / total) * 1000) / 10 : null,
      gain_loss: r.gain_loss == null ? null : num(r.gain_loss), gain_pct: r.gain_pct == null ? null : Math.round(num(r.gain_pct) * 100) / 100,
    })),
    holding_count: holdings.length,
    period_change_pct: perf.map((r) => ({ period: r.period, pct_change: r.pct_change == null ? null : num(r.pct_change) })),
  };
  return { text: await aiText(narrativeSystem(lang), JSON.stringify(facts)) };
}

module.exports = { digest, anomalies, churnActions, watchdog, portfolioNarrative };
