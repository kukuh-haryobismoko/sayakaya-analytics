// AI Insights tab: weekly digest, anomaly scan, churn action list, data-quality
// watchdog and the per-investor narrative. Mirrored in server/insights.js, keep
// both in sync.
//
// Division of labour: SQL and JS compute every number and every flag, the model
// only writes the sentences around them. It never receives names, SIDs or emails.
import { runQuery } from './bigquery.ts';
import * as Q from './queries.ts';
import { aiText } from './ask.ts';

const MIFEE = '`sayakaya.mi_fee_logs.mi_fee`';
const PWC = '`sayakaya.mi_fee_logs.portfolio_with_code`';
const PORT_FIX = '`sayakaya.mi_fee_logs.portfolio_fix`';
const TX = '`sayakaya.main.transactions`';
const USERS = '`sayakaya.main.users`';
const GOAL_SNAPSHOTS = '`sayakaya.main.goal_snapshots`';
const SNAPSHOTS = '`sayakaya.main.snapshots`';

const num = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pct = (now: number, before: number): number | null => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

// ---- 1. Weekly digest ------------------------------------------------------

const DIGEST_SYSTEM = `You write the weekly business digest for the team at Sayakaya, an Indonesian mutual-fund app. You get a JSON object of already-computed figures. Write in Indonesian, 5 to 8 short sentences in plain paragraphs: lead with AUM and its direction, then net flow (buy minus sell), then new users, then one thing worth watching. Use only the figures given, never invent a cause, a fund name or a number. Amounts are rupiah: write them as "Rp 12,3 miliar" or "Rp 450 juta". No headings, no bullet points, no em dashes, no emoji.`;

export async function digest() {
  // AUM per day. mi_fee.created_at is one day ahead of the AUM date it holds
  // (same correction as the PWC queries), so shift back to the real date.
  const aum = await runQuery(`
    SELECT FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(created_at), INTERVAL 1 DAY)) AS day, SUM(AUM) AS v
    FROM ${MIFEE} WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 45 DAY)
    GROUP BY day ORDER BY day`, {});
  if (!aum.length) throw new Error('No AUM data found in mi_fee for the last 45 days.');
  const at = (back: number) => {
    const last = new Date(String(aum[aum.length - 1].day) + 'T00:00:00Z').getTime();
    const want = new Date(last - back * 86400000).toISOString().slice(0, 10);
    const hit = aum.find((r) => r.day === want);
    return hit ? num(hit.v) : null;
  };
  const now = num(aum[aum.length - 1].v), d7 = at(7), d30 = at(30);

  const [flow] = await runQuery(`
    SELECT
      SUM(IF(type = 'buy'  AND d >  DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), v, 0)) AS buy_7d,
      SUM(IF(type = 'sell' AND d >  DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), v, 0)) AS sell_7d,
      SUM(IF(type = 'buy'  AND d <= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), v, 0)) AS buy_prev,
      SUM(IF(type = 'sell' AND d <= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), v, 0)) AS sell_prev
    FROM (
      SELECT DATE(created_at) AS d, type, SUM(final_amount) AS v FROM ${TX}
      WHERE status = 'completed' AND type IN ('buy', 'sell') AND DATE(created_at) > DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
      GROUP BY d, type)`, {});
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
  const text = await aiText(DIGEST_SYSTEM, JSON.stringify(facts));
  return { facts, text };
}

// ---- 2. Anomaly scan -------------------------------------------------------

// Plain statistics, no model: each day is compared with the previous 28 days of
// the same series. AUM is judged on its day-over-day change (the level trends),
// buy and sell volume on their level. |z| >= 3 in the last 14 days is flagged.
export async function anomalies() {
  return await runQuery(`
    WITH aum AS (
      SELECT DATE(created_at) AS d, SUM(AUM) AS v FROM ${MIFEE}
      WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY) GROUP BY d),
    tx AS (
      SELECT DATE(created_at) AS d, type, SUM(final_amount) AS v FROM ${TX}
      WHERE status = 'completed' AND type IN ('buy', 'sell') AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
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
// AUM per day is unit x nav from goal_snapshots (the only source with history
// back to Aug 2025). The snapshot job stops writing rows once a user holds
// nothing, so "no snapshot in the last 2 days" means current AUM is 0.
//   Priority 1: peak 100 jt or more, 20% or less of it left
//   Priority 2: peak 25 jt or more, 50% or less left
//   Priority 3: peak 10 jt or more, 50% or less left
const CHURN_SQL = `
  WITH snap AS (
    SELECT g.user_id, s.date AS d, SUM(s.unit * s.nav) AS aum FROM (
      SELECT goal_id, fund_id, date, unit, nav FROM ${GOAL_SNAPSHOTS}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY goal_id, fund_id, date ORDER BY created_at DESC) = 1) s
    JOIN \`sayakaya.main.goals\` g ON g.id = s.goal_id AND g.deleted_at IS NULL
    GROUP BY g.user_id, s.date),
  latest AS (SELECT MAX(d) AS d FROM snap),
  per AS (
    SELECT user_id,
      ARRAY_AGG(STRUCT(d, aum) ORDER BY aum DESC LIMIT 1)[OFFSET(0)] AS peak,
      ARRAY_AGG(STRUCT(d, aum) ORDER BY d DESC LIMIT 1)[OFFSET(0)] AS last
    FROM snap GROUP BY user_id),
  cur AS (
    SELECT user_id, peak.aum AS peak_aum, peak.d AS peak_date, last.d AS last_snap,
      IF(last.d >= DATE_SUB((SELECT d FROM latest), INTERVAL 2 DAY), last.aum, 0) AS current_aum
    FROM per),
  tx AS (
    SELECT user_id, MAX(IF(type = 'buy', DATE(created_at), NULL)) AS last_buy, MAX(IF(type = 'sell', DATE(created_at), NULL)) AS last_sell
    FROM ${TX} WHERE status = 'completed' AND type IN ('buy', 'sell') GROUP BY user_id),
  c AS (
    SELECT cur.*, tx.last_buy, tx.last_sell, (SELECT d FROM latest) AS as_of,
      CASE WHEN peak_aum >= 1e8 AND current_aum <= peak_aum * 0.2 THEN 1
           WHEN peak_aum >= 2.5e7 AND current_aum <= peak_aum * 0.5 THEN 2
           WHEN peak_aum >= 1e7 AND current_aum <= peak_aum * 0.5 THEN 3 END AS priority
    FROM cur LEFT JOIN tx USING (user_id))
  SELECT c.priority, up.name, u.email, up.phone_number AS phone, IFNULL(u.is_institution, FALSE) AS is_institution,
    ROUND(c.peak_aum) AS peak_aum, FORMAT_DATE('%Y-%m-%d', c.peak_date) AS peak_date, ROUND(c.current_aum) AS current_aum,
    ROUND(SAFE_DIVIDE(c.current_aum - c.peak_aum, c.peak_aum) * 100, 1) AS change_pct,
    IF(c.current_aum = 0, DATE_DIFF(c.as_of, c.last_snap, DAY), NULL) AS days_since_redeem_all,
    FORMAT_DATE('%Y-%m-%d', c.last_buy) AS last_buy, FORMAT_DATE('%Y-%m-%d', c.last_sell) AS last_sell,
    IF(c.last_buy IS NULL, NULL, DATE_DIFF(CURRENT_DATE(), c.last_buy, DAY)) AS days_since_buy
  FROM c JOIN ${USERS} u ON u.id = c.user_id LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = c.user_id
  WHERE c.priority IS NOT NULL AND (c.last_buy IS NULL OR c.last_buy < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))`;

export async function churnActions() {
  const found = await runQuery(CHURN_SQL, {});
  const rows = found.map((r) => {
    const gone = num(r.current_aum) === 0;
    const priority = num(r.priority);
    let action: string;
    if (gone) action = priority === 1 ? 'Call personally: redeemed everything and has not come back' : 'Send a win-back message: redeemed everything and has not come back';
    else action = priority === 1 ? 'Call personally: AUM is down more than 80% from its peak' : 'Send a win-back message: AUM is down by half or more from its peak';
    return { ...r, status: gone ? 'Redeemed all' : 'Dropped', priority, action, lost: num(r.peak_aum) - num(r.current_aum) };
  }).sort((a, b) => a.priority - b.priority || b.lost - a.lost);
  const count = (p: number) => rows.filter((r) => r.priority === p).length;
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

const WATCHDOG_SYSTEM = `You review automated data-quality checks for the analytics team of an Indonesian mutual-fund app. You get JSON with each source's latest date and a same-day AUM comparison across sources. Write in Indonesian, 3 to 6 short sentences: name what is stale or disagrees, by how much, and what to check first. Only use the figures given. If everything is within tolerance, say so in one sentence. Known and expected: portfolio_with_code and mi_fee are dated one day ahead and are already corrected, and goal_snapshots runs roughly 1 to 2 percent below the others. No headings, no bullet points, no em dashes.`;

export async function watchdog() {
  const freshness = await runQuery(`
    SELECT 'mi_fee (AUM date)' AS source, FORMAT_DATE('%Y-%m-%d', MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY))) AS latest FROM ${MIFEE}
    UNION ALL SELECT 'portfolio_with_code', FORMAT_DATE('%Y-%m-%d', MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY))) FROM ${PWC}
    UNION ALL SELECT 'portfolio_fix', FORMAT_DATE('%Y-%m-%d', MAX(DATE_SUB(DATE(created_at), INTERVAL 1 DAY))) FROM ${PORT_FIX}
    UNION ALL SELECT 'goal_snapshots', FORMAT_DATE('%Y-%m-%d', MAX(date)) FROM ${GOAL_SNAPSHOTS}
    UNION ALL SELECT 'fund NAV (snapshots)', FORMAT_DATE('%Y-%m-%d', MAX(DATE(created_at))) FROM ${SNAPSHOTS} WHERE type = 'NAV'
    UNION ALL SELECT 'transactions', FORMAT_DATE('%Y-%m-%d', MAX(DATE(created_at))) FROM ${TX}`, {});

  // Same AUM date, three sources. goal_snapshots is deduplicated to the latest
  // row per goal, fund and date, as in the Portfolio Explorer.
  const compare = await runQuery(`
    WITH gs AS (
      SELECT d, SUM(unit * nav) AS v FROM (
        SELECT s.date AS d, s.unit, s.nav FROM ${GOAL_SNAPSHOTS} s
        WHERE s.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY s.goal_id, s.fund_id, s.date ORDER BY s.created_at DESC) = 1) GROUP BY d),
    mf AS (SELECT DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS d, SUM(AUM) AS v FROM ${MIFEE}
      WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) GROUP BY d),
    pw AS (SELECT DATE_SUB(DATE(created_at), INTERVAL 1 DAY) AS d, SUM(amount) AS v FROM ${PWC}
      WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) GROUP BY d)
    SELECT FORMAT_DATE('%Y-%m-%d', gs.d) AS day, ROUND(gs.v) AS goal_snapshots, ROUND(mf.v) AS mi_fee, ROUND(pw.v) AS portfolio_with_code
    FROM gs LEFT JOIN mf ON mf.d = gs.d LEFT JOIN pw ON pw.d = gs.d ORDER BY gs.d DESC`, {});

  const today = new Date().toISOString().slice(0, 10);
  const ageDays = (day: unknown) => Math.round((Date.parse(today) - Date.parse(String(day))) / 86400000);
  const checks = freshness.map((r) => {
    const age = r.latest ? ageDays(r.latest) : null;
    return { source: r.source, latest: r.latest, age_days: age, status: age == null || age > 2 ? 'stale' : 'ok' };
  });
  const diffs = compare.map((r) => {
    const gs = num(r.goal_snapshots), mf = num(r.mi_fee), pw = num(r.portfolio_with_code);
    const ref = pw || mf;
    return {
      day: r.day, goal_snapshots: gs, mi_fee: mf || null, portfolio_with_code: pw || null,
      goal_snapshots_vs_pwc_pct: ref ? pct(gs, ref) : null,
      mi_fee_vs_pwc_pct: pw && mf ? pct(mf, pw) : null,
      // goal_snapshots normally sits 1 to 2 percent low, so only flag beyond 3.
      status: (ref && Math.abs(pct(gs, ref) ?? 0) > 3) || (pw && mf && Math.abs(pct(mf, pw) ?? 0) > 1) ? 'differs' : 'ok',
    };
  });
  const text = await aiText(WATCHDOG_SYSTEM, JSON.stringify({ today, checks, same_day_aum: diffs }));
  return { checks, diffs, text };
}

// ---- 5. Per-investor narrative --------------------------------------------

const NARRATIVE_SYSTEM = `You write a short portfolio note for one mutual-fund investor, as an advisor would, for the Sayakaya team to read or paste into a statement. You get JSON with current holdings and period changes. Write in Indonesian, 4 to 6 sentences: total value and the biggest holding with its share, the overall gain or loss, how the value moved over the periods given, and one balanced observation about concentration or fund types. Only use the figures given. Do not recommend buying or selling, do not predict returns, no em dashes, no emoji. Amounts are rupiah.`;

export async function portfolioNarrative(userId: string, sid: string) {
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
  return { text: await aiText(NARRATIVE_SYSTEM, JSON.stringify(facts)) };
}
