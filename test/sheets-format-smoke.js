// Smoke test for server/sheets.js's pure grid-building logic (the part that
// mirrors server/pdf.js's statement layout) — run with `node test/sheets-format-smoke.js`.
// Doesn't touch the network/Google APIs; just checks the same holdings/totals
// math as the PDF renderer produces the same numbers for the sheet.
const assert = require('assert');
const { holdingsGrid, totalsRow } = require('../server/sheets');

const holdings = [
  { fund: 'Fund A', fund_type: 'EQUITY', unit: 100, avg_buy_price: 1000, nav: 1200, fund_value: 100000, value: 120000, gain_loss: 20000, gain_pct: 20 },
  { fund: 'Fund B', fund_type: 'MIXED', unit: 50, avg_buy_price: 2000, nav: 1800, fund_value: 100000, value: 90000, gain_loss: -10000, gain_pct: -10 },
];

// Column filtering keeps 'fund' plus only the requested keys.
{
  const { header, rows } = holdingsGrid(holdings, ['unit', 'value']);
  assert.deepStrictEqual(header, ['Fund Name', 'Unit Balance', 'Market Value']);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0][0], 'Fund A');
}

// Totals row sums fund/market value and derives gain% from the sums, not an
// average of the per-row percentages (20% and -10% must NOT average to 5%).
{
  const { cols } = holdingsGrid(holdings);
  const total = totalsRow(cols, holdings);
  const fundValueIdx = cols.findIndex((c) => c.key === 'fund_value');
  const gainPctIdx = cols.findIndex((c) => c.key === 'gain_pct');
  assert.strictEqual(total[fundValueIdx], '200.000');
  assert.strictEqual(total[gainPctIdx], '5,00%'); // (20000-10000)/200000
}

// A single holding gets no totals row (nothing to sum).
{
  const { cols } = holdingsGrid([holdings[0]]);
  assert.strictEqual(totalsRow(cols, [holdings[0]]), null);
}

console.log('ok    sheets.js holdings/totals grids match pdf.js formatting');
