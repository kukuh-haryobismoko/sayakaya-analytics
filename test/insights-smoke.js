// Insights smoke test: the churn list ordering and actions, the watchdog flags and the
// digest arithmetic, with BigQuery and the AI call stubbed out. Also checks that the dashboard language reaches the model.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const stub = (rel, exports) => { const f = require.resolve(rel, { paths: [path.join(__dirname, '../server')] }); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

let prompts = [];
let queries = [];
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
stub('./bigquery', { runQuery: async (sql) => {
  queries.push(sql);
  if (sql.includes('c.priority IS NOT NULL')) return [
    { priority: 2, name: 'half', peak_aum: 5e7, current_aum: 2e7 },
    { priority: 1, name: 'small-gone', peak_aum: 1.2e8, current_aum: 0, days_since_redeem_all: 90 },
    { priority: 1, name: 'big-gone', peak_aum: 9e9, current_aum: 0, days_since_redeem_all: 40 },
    { priority: 1, name: 'big-drop', peak_aum: 3e8, current_aum: 3e7 },
  ];
  if (sql.includes('AS day, SUM(p.amount)')) return [{ day: daysAgo(8), v: 100 }, { day: daysAgo(1), v: 110 }];
  if (sql.includes("'buy'  AND d >")) return [{ buy_7d: 300, sell_7d: 100, buy_prev: 200, sell_prev: 150 }];
  if (sql.includes('new_7d')) return [{ new_7d: 12, new_prev: 10 }];
  if (sql.includes("'portfolio_with_code' AS source")) return [{ source: 'portfolio_with_code', latest: daysAgo(1) }, { source: 'goal_snapshots', latest: daysAgo(6) }];
  if (sql.includes('goal_snapshots, ROUND') || sql.includes('AS goal_snapshots')) return [{ day: daysAgo(1), goal_snapshots: 90, portfolio_fix: 100, portfolio_with_code: 100 }];
  return [];
} });
stub('./queries', {});
let systems = [];
stub('./ask', { aiText: async (system, user) => { systems.push(system); prompts.push(user); return 'ok'; }, langRule: (lang) => (lang === 'id' ? 'Write in Indonesian.' : 'Write in English.') });
const I = require('../server/insights');

(async () => {
  const errors = [];
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); else console.log('ok   ', m); };

  const { summary, rows } = await I.churnActions();
  eq(rows.map((r) => [r.name, r.priority, r.status]), [['big-gone', 1, 'Redeemed all'], ['big-drop', 1, 'Dropped'], ['small-gone', 1, 'Redeemed all'], ['half', 2, 'Dropped']], 'churn list: priority first, then AUM lost');
  eq([summary.priority_1, summary.priority_2, summary.redeemed_all, summary.aum_lost], [3, 1, 2, 9e9 + 1.2e8 + 2.7e8 + 3e7], 'churn summary counts and AUM lost');
  if (!/Call personally: redeemed everything/.test(rows[0].action) || !/down more than 80%/.test(rows[1].action)) errors.push('churn action text does not match the status');

  const d = await I.digest();
  eq([d.facts.aum_change_7d_pct, d.facts.last_7d.net_flow, d.facts.previous_7d.net_flow, d.facts.new_users_last_7d], [10, 200, 50, 12], 'digest figures');
  if (/@|IDD|sid_code/i.test(prompts[0])) errors.push('digest prompt carries identifying fields');

  await I.digest('id');
  eq([/Write in English/.test(systems[0]), /Write in Indonesian/.test(systems[1])], [true, true], 'digest prompt follows the dashboard language');

  const w = await I.watchdog();
  eq(w.checks.map((c) => c.status), ['ok', 'stale'], 'watchdog freshness flags');
  eq(w.diffs[0].status, 'differs', 'watchdog flags a 10 percent gap');

  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('insights smoke test passed');
})();
