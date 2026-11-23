// Portfolio PDF must stay 2 pages (holdings + NAV) even with many funds.
const assert = require('assert');
const PDF = require('../server/pdf.js');

const pages = (buf) => (String(buf.toString('latin1')).match(/\/Type\s*\/Page[^s]/g) || []).length;

const holdings = Array.from({ length: 22 }, (_, i) => ({
  fund: `Fund ${i + 1} With A Fairly Long Name`, fund_type: 'EQUITY', unit: 1000 + i,
  avg_buy_price: 1200, nav: 1100, fund_value: 1000000 + i, value: 950000 + i,
  gain_loss: -50000, gain_pct: -5, ccy: 'IDR', fx: 1, displayCcy: 'IDR',
}));
const perf = [{
  name: 'EQUITY', asOf: '2026-11-10',
  rows: Array.from({ length: 25 }, (_, i) => ({ Fund: `Fund ${i + 1} With A Fairly Long Name`, ipoDate: '2020-01-01', NAV: 1100, '1D': 0.1, '1Y': -2 })),
}];

(async () => {
  const buf = await PDF.portfolioReport({ contact: { name: 'Test', sid: 'X' }, holdings }, perf, { mode: 'IDR' });
  assert.strictEqual(pages(buf), 2, 'portfolio PDF must be 2 pages');
  console.log('pdf pages ok');
})();
