// USD funds: revenue uses ONE rate (period end date), tx uses per-tx rate. SQL-shape check only; BigQuery dry-run is done by hand.
const assert = require('assert');
const Q = require('../server/queries.js');
const rev = Q.revenueTrend('2026-10-23', '2026-11-22', 'month').sql;
assert(rev.includes('rate_date <= LEAST(CAST(@to AS DATE)'), 'revenue uses the period-end rate');
assert(!rev.includes('fx.d = DATE_SUB'), 'revenue does not use a per-day rate');
assert(Q.overviewTx('2026-10-01', '2026-10-31').sql.includes('COALESCE(t.fx_rate, fx.rate)'), 'tx converted at its own rate');
console.log('fx smoke ok');

// convertHoldings: IDR rows -> USD / native per fund
{
  const assert = require('assert');
  const { convertHoldings } = require('../server/pdf');
  const rows = [
    { ccy: 'USD', fx: 18000, fund_value: 18000, value: 36000, gain_loss: 18000 },
    { ccy: 'IDR', fx: 1, fund_value: 1800, value: 3600, gain_loss: 1800 },
  ];
  const usd = convertHoldings(rows, 'USD', 18000);
  assert.deepStrictEqual([usd[0].value, usd[1].value, usd[1].displayCcy], [2, 0.2, 'USD']);
  const nat = convertHoldings(rows, 'NATIVE', 18000);
  assert.deepStrictEqual([nat[0].value, nat[0].displayCcy, nat[1].value, nat[1].displayCcy], [2, 'USD', 3600, 'IDR']);
  assert.strictEqual(convertHoldings(rows, 'IDR')[0].value, 36000);
  console.log('convertHoldings ok');
}

// Portfolio USD valuation uses the T-1 rate: as-of D -> rate of D-1, live -> yesterday.
{
  const Q = require('../server/queries');
  const h = Q.goalUserHoldings('u', '2026-10-30').sql;
  assert.ok(/rate_date <= DATE_SUB\(CAST\(@asOfDate AS DATE\), INTERVAL 1 DAY\)/.test(h), 'as-of holdings must use D-1 rate');
  assert.ok(/rate_date <= DATE_SUB\(CURRENT_DATE\('Asia\/Jakarta'\), INTERVAL 1 DAY\)/.test(Q.userHoldings('u').sql), 'live holdings must use yesterday rate');
  console.log('T-1 fx ok');
}
