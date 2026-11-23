// Portfolio PDF: normal type size, extra funds flow to a second page.
const assert = require('assert');
const PDF = require('../server/pdf.js');

const pages = (buf) => (String(buf.toString('latin1')).match(/\/Type\s*\/Page[^s]/g) || []).length;

const mk = (n) => Array.from({ length: n }, (_, i) => ({
  fund: `Fund ${i + 1} With A Fairly Long Name`, fund_type: 'EQUITY', unit: 1000 + i,
  avg_buy_price: 1200, nav: 1100, fund_value: 1000000 + i, value: 950000 + i,
  gain_loss: -50000, gain_pct: -5, ccy: 'IDR', fx: 1, displayCcy: 'IDR',
}));
const perf = [{
  name: 'EQUITY', asOf: '2026-11-10',
  rows: Array.from({ length: 25 }, (_, i) => ({ Fund: `Fund ${i + 1} With A Fairly Long Name`, ipoDate: '2020-01-01', NAV: 1100, '1D': 0.1, '1Y': -2 })),
}];

(async () => {
  const two = await PDF.portfolioReport({ contact: { name: 'Test', sid: 'X' }, holdings: mk(22) }, perf, { mode: 'IDR' });
  assert.strictEqual(pages(two), 2, '22 funds: holdings + NAV = 2 pages');

  const many = await PDF.portfolioReport({ contact: { name: 'Test', sid: 'X' }, holdings: mk(60) }, perf, { mode: 'IDR' });
  assert.ok(pages(many) >= 3, '60 funds: holdings flows onto extra pages, not squeezed');

  console.log('pdf pages ok');
})();
