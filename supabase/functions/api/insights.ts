// AI Insights tab: weekly digest, anomaly scan, churn action list, data-quality
// watchdog and the per-investor narrative. Mirrored in server/insights.js, keep
// both in sync.
//
// Division of labour: SQL and JS compute every number and every flag, the model
// only writes the sentences around them. It never receives names, SIDs or emails.
import { runQuery } from './bigquery.ts';
import * as Q from './queries.ts';
import * as ML from './ml.ts';
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

const BIG_INVESTOR = 100_000_000; // same 100 jt line as the HNWI bonus

// The churn model already scores everyone; this adds the missing step, which is
// who to contact first and with what. Rules, not a model: easy to read and tune.
export async function churnActions() {
  const { summary, top } = await ML.churnPredictions(2000);
  const rows = (top as Record<string, unknown>[]).map((r): Record<string, unknown> & { priority: number; action: string } => {
    const p = num(r.churn_prob), amount = num(r.total_buy_amount), recency = num(r.recency_days);
    let priority = 0, action = '';
    if (p >= 0.5 && amount >= BIG_INVESTOR) { priority = 1; action = 'Call personally: large investor at high risk'; }
    else if (p >= 0.5 && recency > 90) { priority = 2; action = 'Send statement plus a come-back message: high risk and quiet for 90+ days'; }
    else if (p >= 0.5) { priority = 3; action = 'Send a re-engagement offer: high risk'; }
    else if (p >= 0.2 && amount >= BIG_INVESTOR) { priority = 4; action = 'Send fund performance update: large investor, medium risk'; }
    return { ...r, priority, action };
  }).filter((r) => r.priority > 0)
    .sort((a, b) => a.priority - b.priority || num(b.churn_prob) - num(a.churn_prob) || num(b.total_buy_amount) - num(a.total_buy_amount))
    .slice(0, 200);
  return { summary, rows };
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
