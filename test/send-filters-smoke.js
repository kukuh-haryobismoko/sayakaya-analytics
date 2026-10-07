// Smoke test for the Send tabs' search and fund-filter inputs — run with
// `node test/send-filters-smoke.js`. Pure functions, no BigQuery:
// queries.js userSearch() (name wildcard, LIKE escaping, phone matching) and
// report-helpers.js normalizeFundFilter() (untrusted request/schedule input).
const assert = require('assert');
const { userSearch } = require('../server/queries');
const { normalizeFundFilter } = require('../server/report-helpers');

// `*` is a wildcard; literal LIKE metacharacters are escaped.
assert.deepStrictEqual(userSearch(' Budi*Santoso ').params, { q: '%budi%santoso%' });
assert.deepStrictEqual(userSearch('a_b%c').params, { q: '%a\\_b\\%c%' });
assert.ok(!userSearch('budi').sql.includes('@phone'));

// Phone: 0812…, +62 812… and 812… all reduce to the same digits.
for (const q of ['0812-3456', '+62 812 3456', '8123456', '(62)8123456']) {
  assert.strictEqual(userSearch(q).params.phone, '%8123456%', q);
  assert.ok(userSearch(q).sql.includes('@phone'), q);
}
assert.strictEqual(userSearch('1234').params.phone, undefined); // too short to be a phone

// Fund filter: null = all funds; only non-empty string lists survive.
assert.strictEqual(normalizeFundFilter(null), null);
assert.strictEqual(normalizeFundFilter({ types: [], fundIds: [] }), null);
assert.strictEqual(normalizeFundFilter({ types: 'EQUITY' }), null);
assert.deepStrictEqual(normalizeFundFilter({ types: ['EQUITY', ' EQUITY ', ''] }), { types: ['EQUITY'], fundIds: [] });
assert.deepStrictEqual(normalizeFundFilter({ fundIds: ['abc', 7] }), { types: [], fundIds: ['abc', '7'] });

console.log('send-filters smoke test passed');
