// Bulk export tick list (setupBulkExport in app.js) — run with
// `node test/bulk-pick-smoke.js`. A code search for "alex" also returns
// ALEXANDER; unticking that investor must keep them out of the export
// request, and with nobody ticked no request is sent at all.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

process.on('unhandledRejection', (e) => { if (!/null \(setting 'value'\)/.test(e.message)) throw e; }); // app.js's init() rejects in this minimal page

const ids = ['BulkBar', 'BulkList', 'BulkCount', 'BulkSummary', 'BulkSummaryKpis', 'BulkSummaryHoldings', 'BulkSummaryInvestors',
  'BulkCode', 'BulkSearchBtn', 'BulkClear', 'BulkSummaryBtn', 'BulkCsv', 'BulkXlsx', 'BulkPdf', 'BulkDate'];
const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>
  <select id="xBulkField"><option value="referrer_code">r</option></select>
  <select id="xBulkMode"><option value="combined">c</option></select>
  ${ids.map((id) => (id === 'BulkCode' || id === 'BulkDate' ? `<input id="x${id}">` : `<div id="x${id}"></div>`)).join('')}
</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
const sent = [];
window.fetch = async (url, opts = {}) => {
  if (String(url).includes('/api/users/by-code')) {
    return { ok: true, status: 200, json: async () => [
      { user_id: 'u1', sid: 'SID1', name: 'Alex', referrer_code: 'ALEX', sales_code: null },
      { user_id: 'u2', sid: 'SID2', name: 'Alexander', referrer_code: 'ALEXANDER', sales_code: 'S9' },
    ] };
  }
  sent.push(JSON.parse(opts.body));
  return { ok: true, status: 200, blob: async () => new window.Blob(['x']), headers: { get: () => null }, json: async () => ({}) };
};
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.Chart = Object.assign(class { destroy() {} }, { defaults: { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } }, register() {} });
window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

const sandbox = vm.createContext(window);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), sandbox);
vm.runInContext("setupBulkExport({ prefix: 'x', source: 'portfolio_full' })", sandbox);

const $ = (sel) => window.document.querySelector(sel);
const tick = () => new Promise((r) => setTimeout(r, 20));
(async () => {
  $('#xBulkCode').value = 'alex';
  $('#xBulkSearchBtn').click();
  await tick();
  const rows = [...window.document.querySelectorAll('#xBulkList tbody tr')].map((tr) => [...tr.children].slice(1).map((td) => td.textContent.trim()));
  assert.deepStrictEqual(rows, [['SID1', 'Alex', 'ALEX', 'n/a'], ['SID2', 'Alexander', 'ALEXANDER', 'S9']], 'both matches listed with their codes');
  assert.strictEqual($('#xBulkCount').textContent, '2 / 2', 'everyone starts ticked');

  const alexander = $('#xBulkList input[data-id="u2"]');
  alexander.checked = false;
  alexander.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual($('#xBulkCount').textContent, '1 / 2');
  assert.strictEqual($('#xBulkList .bulk-all').indeterminate, true, 'select-all shows a partial selection');

  $('#xBulkCsv').click();
  await tick();
  assert.strictEqual(sent.length, 1, 'one export request');
  assert.deepStrictEqual(sent[0].users.map((u) => u.userId), ['u1'], 'the unticked investor is left out of the export');

  const all = $('#xBulkList .bulk-all');
  all.checked = false;
  all.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual($('#xBulkCount').textContent, '0 / 2');
  $('#xBulkCsv').click();
  await tick();
  assert.strictEqual(sent.length, 1, 'nothing is exported when nobody is ticked');
  console.log('bulk-pick smoke test passed');
})().catch((e) => { console.error(e); process.exit(1); });
