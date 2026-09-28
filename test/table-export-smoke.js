// Smoke test for the universal table/chart export feature in app.js — run
// with `node test/table-export-smoke.js`. This is the one part of app.js
// render-smoke.js's hand-rolled DOM stub can't exercise for real: a
// MutationObserver watching every .table-wrap for a rendered <table> and
// auto-injecting an export toolbar, plus paint() doing the same for charts.
// Needs a real DOM (MutationObserver, closest(), classList, sibling
// traversal), hence jsdom instead of the plain-object stub the other smoke
// tests use.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// app.js's init() is async and unconditionally called at the bottom of the
// file; it rejects in this minimal stub (no #from/#to inputs etc.) since
// this test only cares about the synchronous top-level setup (the
// MutationObserver wiring under test) — swallow that expected rejection.
process.on('unhandledRejection', () => {});

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="pfResults" class="table-wrap"></div>
  <div class="chart-wrap"><canvas id="pfAumChart"></canvas></div>
</body></html>`, { pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

// Same idea as render-smoke.js's stub sandbox, backed by a real jsdom
// document instead of a hand-rolled one.
window.Chart = Object.assign(class { constructor() {} destroy() {} }, { defaults: { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } }, register() {} });
window.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
window.fetch = async () => ({ ok: true, json: async () => ({}), blob: async () => ({}), headers: { get: () => null } });
window.XLSX = { utils: {}, writeFile() {} };
window.jspdf = { jsPDF: class { autoTable() {} save() {} } };
window.navigator.clipboard = { write: async () => {} };
window.ClipboardItem = class {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

const sandbox = vm.createContext(window);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), sandbox, { filename: 'app.js' });

(async () => {
  const wrap = window.document.getElementById('pfResults');

  // No table has rendered yet — no bar should exist.
  assert.strictEqual(wrap.previousElementSibling, null, 'export bar should not appear before any table renders');

  // Simulate a real section render (exactly what e.g. renderPfResults does).
  wrap.innerHTML = '<table><thead><tr><th>SID</th><th>Name</th></tr></thead><tbody><tr><td>IDD1</td><td>Alice</td></tr></tbody></table>';
  await new Promise((r) => setTimeout(r, 50)); // MutationObserver callback + rAF debounce

  const bar = wrap.previousElementSibling;
  assert.ok(bar && bar.classList.contains('table-export-bar'), 'export bar should be auto-injected right before the table-wrap');
  assert.ok(!bar.classList.contains('hidden'), 'export bar should be visible once a real <table> exists');
  const formats = [...bar.querySelectorAll('button')].map((b) => b.dataset.fmt);
  assert.deepStrictEqual(formats, ['csv', 'xlsx', 'pdf', 'png'], 'all four export formats should be offered');

  // Table clears back to an empty state (e.g. a new search with no
  // results) — the bar should hide, not disappear, so it's instantly ready
  // again once a real table comes back.
  wrap.innerHTML = '<div class="empty">No matching investor.</div>';
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(bar.classList.contains('hidden'), 'export bar should hide again once the table-wrap has no table');

  // CSV export reads straight from the live DOM: header + body + tfoot, with
  // a comma-containing cell correctly quoted.
  wrap.innerHTML = '<table><thead><tr><th>SID</th><th>Name</th></tr></thead>'
    + '<tbody><tr><td>IDD1</td><td>Alice, A</td></tr></tbody><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></table>';
  await new Promise((r) => setTimeout(r, 50));

  let capturedBlob = null;
  const realCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const el = realCreateElement(tag);
    if (tag === 'a') Object.defineProperty(el, 'click', { value() {} });
    return el;
  };
  window.URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:mock'; };
  window.URL.revokeObjectURL = () => {};

  bar.querySelector('button[data-fmt="csv"]').click();
  await new Promise((r) => setTimeout(r, 20));
  const csvText = capturedBlob ? await capturedBlob.text() : '';
  assert.ok(csvText.includes('SID,Name'), 'CSV should include the table header row');
  assert.ok(csvText.includes('"Alice, A"'), 'CSV should quote a cell containing a comma');
  assert.ok(csvText.includes('Total'), 'CSV should include the tfoot Total row');

  // paint() (a real app.js function) auto-injects a chart export bar (PNG +
  // copy) into the chart's .chart-wrap, and must not duplicate it on repaint
  // (e.g. a filter change re-rendering the same chart).
  window.paint('pfAumChart', { type: 'line', data: {}, options: {} });
  const chartWrap = window.document.querySelector('.chart-wrap');
  const chartBar = chartWrap.querySelector('.chart-export-bar');
  assert.ok(chartBar, 'paint() should inject a chart export bar');
  assert.deepStrictEqual([...chartBar.querySelectorAll('button')].map((b) => b.dataset.action), ['png', 'copy']);
  window.paint('pfAumChart', { type: 'line', data: {}, options: {} });
  assert.strictEqual(chartWrap.querySelectorAll('.chart-export-bar').length, 1, 're-painting the same chart should not duplicate its export bar');

  console.log('ok    app.js table/chart export bars auto-inject, toggle, and export real DOM data (jsdom)');
})();
