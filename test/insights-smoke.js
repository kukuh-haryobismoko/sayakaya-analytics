// Insights smoke test: the churn action rules, the watchdog flags and the digest
// arithmetic, with BigQuery, the churn model and the AI call stubbed out.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const stub = (rel, exports) => { const f = require.resolve(rel, { paths: [path.join(__dirname, '../server')] }); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

let prompts = [];
let queries = [];
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
stub('./bigquery', { runQuery: async (sql) => {
  queries.push(sql);
  if (sql.includes('FROM `sayakaya.mi_fee_logs.mi_fee`') && sql.includes('AS day, SUM(AUM)')) return [{ day: daysAgo(8), v: 100 }, { day: daysAgo(1), v: 110 }];
  if (sql.includes("'buy'  AND d >")) return [{ buy_7d: 300, sell_7d: 100, buy_prev: 200, sell_prev: 150 }];
  if (sql.includes('new_7d')) return [{ new_7d: 12, new_prev: 10 }];
  if (sql.includes("'mi_fee (AUM date)'")) return [{ source: 'mi_fee (AUM date)', latest: daysAgo(1) }, { source: 'goal_snapshots', latest: daysAgo(6) }];
  if (sql.includes('goal_snapshots, ROUND') || sql.includes('AS goal_snapshots')) return [{ day: daysAgo(1), goal_snapshots: 90, mi_fee: 100, portfolio_with_code: 100 }];
  return [];
} });
stub('./ml', { churnPredictions: async () => ({ summary: { scored: 4 }, top: [
  { name: 'big-high', churn_prob: 0.9, total_buy_amount: 2e8, recency_days: 10 },
  { name: 'quiet-high', churn_prob: 0.7, total_buy_amount: 1e6, recency_days: 120 },
  { name: 'small-high', churn_prob: 0.6, total_buy_amount: 1e6, recency_days: 5 },
  { name: 'big-medium', churn_prob: 0.3, total_buy_amount: 3e8, recency_days: 5 },
  { name: 'small-medium', churn_prob: 0.3, total_buy_amount: 1e6, recency_days: 5 },
] }) });
stub('./queries', {});
stub('./ask', { aiText: async (system, user) => { prompts.push(user); return 'ok'; } });
const I = require('../server/insights');

(async () => {
  const errors = [];
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); else console.log('ok   ', m); };

  const { rows } = await I.churnActions();
  eq(rows.map((r) => [r.name, r.priority]), [['big-high', 1], ['quiet-high', 2], ['small-high', 3], ['big-medium', 4]], 'churn actions ranked, small medium-risk dropped');

  const d = await I.digest();
  eq([d.facts.aum_change_7d_pct, d.facts.last_7d.net_flow, d.facts.previous_7d.net_flow, d.facts.new_users_last_7d], [10, 200, 50, 12], 'digest figures');
  if (/@|IDD|sid_code/i.test(prompts[0])) errors.push('digest prompt carries identifying fields');

  const w = await I.watchdog();
  eq(w.checks.map((c) => c.status), ['ok', 'stale'], 'watchdog freshness flags');
  eq(w.diffs[0].status, 'differs', 'watchdog flags a 10 percent gap');

  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('insights smoke test passed');
})();
