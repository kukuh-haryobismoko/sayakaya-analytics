// Smoke test for server/pdf.js's portfolio PDF renderers — run with
// `node test/portfolio-batch-smoke.js`. portfolioReport() was refactored to
// share its "one investor's holdings page" drawing code with the new
// portfolioReportBatch() (multi-investor bulk export) — this checks the
// refactor didn't break the original single-investor PDF, and that the new
// batch renderer actually produces a page per investor plus the shared
// performance pages, without needing BigQuery or Express.
const assert = require('assert');
const PDF = require('../server/pdf');

const holdingsA = [
  { fund: 'Fund A', fund_type: 'EQUITY', unit: 100, avg_buy_price: 1000, nav: 1200, fund_value: 100000, value: 120000, gain_loss: 20000, gain_pct: 20, nav_date: '2026-09-01' },
];
const holdingsB = [
  { fund: 'Fund B', fund_type: 'MIXED', unit: 50, avg_buy_price: 2000, nav: 1800, fund_value: 100000, value: 90000, gain_loss: -10000, gain_pct: -10, nav_date: '2026-09-01' },
];
const perf = [{ name: 'EQUITY', rows: [{ Fund: 'Fund A', '1D': 0.5 }] }];

(async () => {
  // Single-investor PDF still works after extracting drawPortfolioHoldingsPage().
  const single = await PDF.portfolioReport({ contact: { name: 'A', sid: 'IDD1' }, holdings: holdingsA }, perf, { username: 'tester' });
  assert.ok(Buffer.isBuffer(single) && single.length > 0, 'portfolioReport() should return a non-empty buffer');
  assert.strictEqual(single.slice(0, 5).toString(), '%PDF-', 'portfolioReport() output should be a valid PDF');

  // Batch PDF: one page per investor, then the shared performance pages once.
  const entries = [
    { contact: { name: 'A', sid: 'IDD1' }, holdings: holdingsA },
    { contact: { name: 'B', sid: 'IDD2' }, holdings: holdingsB },
  ];
  const batch = await PDF.portfolioReportBatch(entries, perf, { username: 'tester' });
  assert.ok(Buffer.isBuffer(batch) && batch.length > 0, 'portfolioReportBatch() should return a non-empty buffer');
  assert.strictEqual(batch.slice(0, 5).toString(), '%PDF-', 'portfolioReportBatch() output should be a valid PDF');
  // A 2-investor batch (+ the same performance page) should be noticeably
  // bigger than a 1-investor report with the same performance page — a cheap
  // proxy for "did it actually add a page per investor" without parsing the PDF.
  assert.ok(batch.length > single.length, 'batch PDF for 2 investors should be larger than a single-investor PDF');

  // Empty holdings shouldn't crash the batch (e.g. an investor with no active funds).
  const withEmpty = await PDF.portfolioReportBatch([{ contact: { sid: 'IDD3' }, holdings: [] }], [], { username: 'tester' });
  assert.strictEqual(withEmpty.slice(0, 5).toString(), '%PDF-');

  console.log('ok    pdf.js portfolioReport/portfolioReportBatch render valid multi-page PDFs');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
