// Smoke test for the Overview user filter — run with
// `node test/user-filter-smoke.js`. Pure functions, no BigQuery:
// queries.js normalizeUserFilter() (untrusted ?userFilter= input) and the
// SQL/params it turns into on the Overview builders.
const assert = require('assert');
const Q = require('../server/queries');

// Empty input = no rules, and the builders emit exactly their old SQL.
assert.deepStrictEqual(Q.normalizeUserFilter(''), []);
assert.deepStrictEqual(Q.normalizeUserFilter(undefined), []);
assert.deepStrictEqual(Q.overviewUsers([]).params, {});
assert.ok(!Q.overviewUsers([]).sql.includes('WHERE'));

// Values: trimmed, lowercased, LIKE metacharacters escaped, `*` -> `%`.
// Rules without values are dropped; institution never takes values.
const rules = Q.normalizeUserFilter(JSON.stringify([
  { field: 'referrer_code', mode: 'exclude', values: [' RAIZKAYA ', 'a_b%c'] },
  { field: 'sales_code', mode: 'include', values: ['BPJSKES*'] },
  { field: 'email', mode: 'include', values: ['', '  '] },
  { field: 'institution', mode: 'exclude', values: ['ignored'] },
]));
assert.deepStrictEqual(rules, [
  { field: 'referrer_code', mode: 'exclude', values: ['raizkaya', 'a\\_b\\%c'] },
  { field: 'sales_code', mode: 'include', values: ['bpjskes%'] },
  { field: 'institution', mode: 'exclude', values: [] },
]);

// Each valued rule binds its own param; exclude = NOT; rules AND together.
const tx = Q.overviewTx('2026-09-01', '2026-09-30', [], rules);
assert.deepStrictEqual(tx.params.uf0, ['raizkaya', 'a\\_b\\%c']);
assert.deepStrictEqual(tx.params.uf1, ['bpjskes%']);
assert.strictEqual(tx.params.uf2, undefined);
assert.ok(tx.sql.includes('user_id IN (SELECT id FROM `sayakaya.main.users` WHERE NOT EXISTS'));
assert.ok(tx.sql.includes('AND NOT IFNULL(is_institution, FALSE))'));

// Portfolio snapshots are keyed on SID, not user id.
assert.ok(Q.platformAumAsOf('2026-10-07', [], rules).sql.includes('p.sid_code IN (SELECT sid_code FROM'));
// AUM by fund type and by manager sum customer holdings, never the market-wide fund total, and
// BigQuery rejects an IN subquery inside a join predicate.
for (const ft of [Q.fundTypes([], []), Q.fundTypes([], rules), Q.aumByManager(15)]) assert.ok(!ft.sql.includes('latest_aum_value'));
assert.ok(!/ON a\.fund_id = f\.id\s+AND/.test(Q.fundTypes([], rules).sql) && Q.fundTypes([], rules).sql.includes('FROM active WHERE user_id IN ('));

// Untrusted input is rejected, never silently widened.
for (const bad of ['{', '{"field":"sid"}', '[{"field":"password","mode":"include","values":["x"]}]', '[{"field":"sid","mode":"maybe","values":["x"]}]']) {
  assert.throws(() => Q.normalizeUserFilter(bad), bad);
}
assert.throws(() => Q.normalizeUserFilter([{ field: 'sid', mode: 'include', values: Array(301).fill('x') }]), /at most 300/);

console.log('user-filter smoke test passed');
