// Smoke test for the Event code tab's code matching and daily recap — run
// with `node test/event-code-smoke.js`. Pure functions, no BigQuery.
const assert = require('assert');
const Q = require('../server/queries');

// No `*` keeps the old partial match; `*` anchors; LIKE metacharacters are literal.
assert.deepStrictEqual(Q.codePatterns([' ce ', 'EVT*', '*kaya', 'evt_0%1', '', '  ']),
  ['%CE%', 'EVT%', '%KAYA', '%EVT\\_0\\%1%']);
assert.deepStrictEqual(Q.codePatterns('a*b*'), ['A%B%']);

// Remisier transactions share the same patterns.
const rt = Q.remisierTransactions({ salesCodes: ['EVT*'] });
assert.deepStrictEqual(rt.params.salesCodes, ['EVT%']);
assert.ok(rt.sql.includes('UPPER(u.sales_code) LIKE sc)'));

// Recap: type and newOnly only add clauses when set; one row per day up to today.
const all = Q.eventCodeRecap('referrer_code', ['EVT*'], '2026-10-01', '2026-10-31');
assert.strictEqual(all.params.type, undefined);
assert.ok(!all.sql.includes('t.type = @type'));
assert.ok(all.sql.includes('GENERATE_DATE_ARRAY(DATE(@from), LEAST(DATE(@to), CURRENT_DATE()))'));
assert.ok(all.codesSql.includes('UPPER(u.referrer_code) AS code'));
const buys = Q.eventCodeRecap('sales_code', ['EVT*'], '2026-10-01', '2026-10-31', 'buy', true);
assert.strictEqual(buys.params.type, 'buy');
assert.ok(buys.sql.includes("WHERE t.status = 'completed' AND t.type = @type"));
assert.ok(buys.totalsSql.includes('COUNT(DISTINCT IF(done, user_id, NULL))'));

// Every count in the tab is completed-only.
const notFailed = "status NOT IN ('expired', 'cancelled')";
for (const q of [Q.eventCodeFunnel('sales_code', ['EVT*']), Q.eventCodeCohort('sales_code', ['EVT*'], '', '', 'week', 12, 'registration'),
  Q.eventCodeCohort('sales_code', ['EVT*'], '', '', 'week', 12, 'first_tx')]) {
  assert.ok(!q.sql.includes(notFailed) && q.sql.includes("t.status = 'completed'"));
}

// Portfolio: portfolio_fix with its -1 day, matched on SID; week or month only.
const pf = Q.eventCodePortfolio('referrer_code', ['EVT*'], '2026-10-01', '2026-10-31', 'week', 12);
assert.ok(pf.sql.includes('mi_fee_logs.portfolio_fix') && !pf.sql.includes('goal_snapshots'));
assert.ok(pf.sql.includes('DATE_SUB(DATE(p.created_at), INTERVAL 1 DAY) AS date') && pf.sql.includes('tg.sid_code = p.sid_code'));
assert.ok(pf.sql.includes('DATE_TRUNC(CURRENT_DATE(), WEEK), INTERVAL 11 WEEK'));
assert.ok(Q.eventCodePortfolio('referrer_code', ['EVT*'], '', '', 'day').sql.includes('INTERVAL 11 MONTH'));
assert.ok(pf.summarySql.includes('GROUP BY portfolio_status'));
assert.ok(Q.eventCodeUsers('referrer_code', ['EVT*'], '', '').sql.includes('p.portfolio_status, p.aum_now'));
assert.ok(buys.totalsSql.includes('UPPER(u.sales_code) LIKE c) AND DATE(u.created_at) BETWEEN @from AND @to'));

console.log('event-code smoke test passed');
