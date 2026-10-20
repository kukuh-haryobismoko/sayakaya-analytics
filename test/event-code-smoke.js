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

// Population: signed up in the window OR made a completed buy in it, for every
// panel except the recap (which counts every code holder's transactions).
const inWindow = "w.type = 'buy'\n            AND w.status = 'completed' AND DATE(w.created_at) BETWEEN @from AND @to";
for (const sql of [Q.eventCodeFunnel('sales_code', ['EVT*']).sql, Q.eventCodeUsers('sales_code', ['EVT*']).countSql, pf.summarySql,
  Q.eventCodeCohort('sales_code', ['EVT*'], '', '', 'week', 12, 'registration').sql, Q.eventCodeCohort('sales_code', ['EVT*'], '', '', 'week', 12, 'first_tx').sql]) {
  assert.ok(sql.includes('DATE(u.created_at) BETWEEN @from AND @to\n          OR EXISTS') && sql.includes(inWindow), sql.slice(0, 80));
}
assert.ok(!all.sql.includes('OR EXISTS (SELECT 1 FROM'));

// Paged lists sort only by their own output columns; anything else falls back.
const EX = require('../server/explore');
assert.ok(Q.usersTransactions({ q: 'a', sort: 'final_amount', dir: 'asc' }).sql.includes('ORDER BY final_amount ASC NULLS LAST, id'));
assert.ok(Q.usersTransactions({ q: 'a', sort: 'id; DROP TABLE x', dir: 'asc' }).sql.includes('ORDER BY t.created_at DESC'));
assert.ok(Q.remisierTransactions({ salesCodes: ['A'], sort: 'fund_type' }).sql.includes('ORDER BY LOWER(fund_type) DESC NULLS LAST, id'));
assert.ok(Q.sinvestTransactions({ sort: 'net_amount', dir: 'asc' }).sql.includes('ORDER BY net_amount ASC NULLS LAST, reference_no'));
assert.ok(Q.eventCodeUsers('sales_code', ['A'], '', '', 10, 0, 'aum_now', 'desc').sql.includes('ORDER BY aum_now DESC NULLS LAST, user_id'));
assert.ok(EX.buildExplore('transactions', { sort: 'final_amount', dir: 'asc' }).sql.includes('ORDER BY final_amount ASC NULLS LAST, t.created_at DESC'));
assert.ok(EX.buildExplore('transactions', { sort: 'email', dir: 'asc' }).sql.includes('ORDER BY LOWER(email) ASC NULLS LAST'));
assert.ok(EX.buildExplore('transactions', { sort: 'password' }).sql.includes('ORDER BY t.created_at DESC LIMIT'));

// Exports keep the table's on-screen sort (report-helpers sortExportRows).
const { sortExportRows } = require('../server/report-helpers');
const xr = [{ name: 'bea', aum: '1500000', d: { value: '2026-10-02' } }, { name: 'Al', aum: null, d: { value: '2026-10-01' } },
  { name: 'cy', aum: '2500000', d: { value: '2026-10-03' } }];
const names = (rows) => rows.map((r) => r.name);
assert.deepStrictEqual(names(sortExportRows(xr, { sortKey: 'aum', sortDir: 'desc' })), ['cy', 'bea', 'Al'], 'numbers high to low, blanks last');
assert.deepStrictEqual(names(sortExportRows(xr, { sortKey: 'aum', sortDir: 'asc' })), ['bea', 'cy', 'Al'], 'blanks last ascending too');
assert.deepStrictEqual(names(sortExportRows(xr, { sortKey: 'name', sortDir: 'asc' })), ['Al', 'bea', 'cy'], 'text ignores case');
assert.deepStrictEqual(names(sortExportRows(xr, { sortKey: 'd', sortDir: 'desc' })), ['cy', 'bea', 'Al'], 'BigQuery {value} dates unwrap');
assert.deepStrictEqual(names(sortExportRows(xr, { sortKey: 'nope', orderKey: 'name', order: ['cy', 'Al'] })), ['cy', 'Al', 'bea'], 'unknown column: on-screen first-column order, others after');
assert.strictEqual(sortExportRows(xr, {}), xr, 'no sort: rows untouched');

// Users transactions: fund name and promo code take the same comma-separated patterns.
const ut = Q.usersTransactions({ fundName: 'sucor*, money', promo: 'thr*' });
assert.deepStrictEqual([ut.params.fundPats, ut.params.promoPats, ut.params.q], [['SUCOR%', '%MONEY%'], ['THR%'], undefined]);
assert.ok(/UPPER\(f\.name\) LIKE fp/.test(ut.countSql), 'count joins funds for the fund-name filter');
assert.ok(!('fundPats' in Q.usersTransactions({ q: 'x', fundName: ' , ' }).params), 'blank terms add no filter');

// Users transactions with no search term at all: only the date range (and type) narrow the list.
const utAll = Q.usersTransactions({ type: 'sell', from: '2026-10-01', to: '2026-10-20' });
assert.deepStrictEqual([utAll.params.from, utAll.params.to, utAll.params.type], ['2026-10-01', '2026-10-20', 'sell']);
assert.ok(!('q' in utAll.params) && !('fundPats' in utAll.params) && !('promoPats' in utAll.params), 'no search term adds no investor filter');
assert.ok(/WHERE DATE\(t\.created_at\) BETWEEN @from AND @to AND t\.type = @type\s/.test(utAll.sql), 'date range + type only');

// Users transactions summary: both types always count, expired/cancelled never,
// Monday weeks by default, and it inherits the list's investor/fund/promo filter.
const sums = Q.usersTransactionsSummary({ from: '2026-10-01', to: '2026-10-19', granularity: 'nope' });
assert.ok(sums.sql.includes('DATE_TRUNC(DATE(t.created_at), WEEK(MONDAY))'), 'unknown granularity falls back to the Monday week');
assert.ok(sums.sql.includes("FORMAT_DATE('%Y-%m-%d'"));
assert.ok(sums.sql.includes("AND t.type IN ('buy', 'sell')") && sums.sql.includes("NOT IN ('expired', 'cancelled')"));
assert.ok(!sums.sql.includes('@type') && !sums.sql.includes('@status'), 'type and status are not parameters');
assert.ok(sums.sql.includes('IFNULL(NULLIF(t.final_amount, 0), t.amount)'), 'in-flight rows count at their order amount');
const sumM = Q.usersTransactionsSummary({ from: '2026-10-01', to: '2026-10-31', granularity: 'month', q: 'kukuh', promo: 'THR*', fundName: 'sucor*' });
assert.ok(sumM.sql.includes("FORMAT_DATE('%Y-%m', DATE_TRUNC(DATE(t.created_at), MONTH))"));
assert.deepStrictEqual([sumM.params.q, sumM.params.promoPats, sumM.params.fundPats], ['%kukuh%', ['THR%'], ['SUCOR%']]);
assert.ok(sumM.sql.includes('LOWER(up.name) LIKE @q') && sumM.sql.includes('UPPER(f.name) LIKE fp'), 'same joins and filters as the list');
assert.ok(!('q' in Q.usersTransactionsSummary({ from: '2026-10-01', to: '2026-10-31' }).params), 'blank search adds no filter');

console.log('event-code smoke test passed');
