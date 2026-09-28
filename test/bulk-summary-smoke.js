// Smoke test for server/report-helpers.js's aggregateBulkHoldings() — run
// with `node test/bulk-summary-smoke.js`. Pure function, no BigQuery: given
// the same {contact, holdings} shape /api/export/batch fetches per investor,
// checks the combined totals it hands to the Bulk export "Preview summary"
// panel are right, including BigQuery's wrapped NUMERIC/DATE values.
const assert = require('assert');
const { aggregateBulkHoldings } = require('../server/report-helpers');

const D = (v) => ({ value: v }); // mimics a BigQuery DATE/NUMERIC wrapper

const entries = [
  {
    contact: { sid: 'IDD1', name: 'Alice', email: 'alice@example.com', phone: '0811', referrer_code: 'REF1', sales_code: 'SAL1' },
    holdings: [
      { fund: 'Fund A', fund_type: 'EQUITY', unit: D('100'), fund_value: 100000, value: 120000, nav: 1200 },
      { fund: 'Fund B', fund_type: 'MIXED', unit: D('50'), fund_value: 100000, value: 90000, nav: 1800 },
    ],
  },
  {
    contact: { sid: 'IDD2', name: 'Bob' },
    holdings: [
      { fund: 'Fund A', fund_type: 'EQUITY', unit: D('20'), fund_value: 20000, value: 24000, nav: 1200 },
    ],
  },
];

const summary = aggregateBulkHoldings(entries);

// Totals sum across every investor and every holding.
assert.strictEqual(summary.count, 2);
assert.strictEqual(summary.totalAum, 120000 + 90000 + 24000);

// Per-fund rows combine the same fund across different investors (Fund A
// appears for both Alice and Bob) instead of listing it twice.
assert.strictEqual(summary.funds.length, 2);
const fundA = summary.funds.find((f) => f.fund === 'Fund A');
assert.strictEqual(fundA.unit, 120); // 100 + 20, unwrapped from the {value} wrapper
assert.strictEqual(fundA.fund_value, 120000);
assert.strictEqual(fundA.value, 144000);
assert.strictEqual(fundA.gain_loss, 24000);
assert.strictEqual(fundA.gain_pct, 20); // (144000-120000)/120000 * 100

// Gain % comes from the summed fund_value/value, not an average of each
// investor's own gain% (which would misrepresent differently-sized positions).
const fundB = summary.funds.find((f) => f.fund === 'Fund B');
assert.strictEqual(fundB.value, 90000);
assert.strictEqual(fundB.fund_value, 100000);
assert.strictEqual(fundB.gain_pct, -10);

// Per-investor AUM, sorted largest first.
assert.deepStrictEqual(summary.investors.map((i) => i.sid), ['IDD1', 'IDD2']);
assert.strictEqual(summary.investors[0].aum, 210000);
assert.strictEqual(summary.investors[1].aum, 24000);

// Contact detail (preview-only — the export files never carry this) passes
// through from userContact() untouched.
assert.strictEqual(summary.investors[0].email, 'alice@example.com');
assert.strictEqual(summary.investors[0].phone, '0811');
assert.strictEqual(summary.investors[0].referrer_code, 'REF1');
assert.strictEqual(summary.investors[0].sales_code, 'SAL1');

// A fund with zero cost basis gets no gain % (avoids dividing by zero).
const zeroCost = aggregateBulkHoldings([{ contact: { sid: 'IDD3' }, holdings: [{ fund: 'Fund C', fund_type: 'MONEY_MARKET', unit: 10, fund_value: 0, value: 0, nav: 1000 }] }]);
assert.strictEqual(zeroCost.funds[0].gain_pct, null);

console.log('ok    report-helpers.js aggregateBulkHoldings sums holdings across investors correctly');
