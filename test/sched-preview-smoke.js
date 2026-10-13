// Schedule recipient count (schedPreviewCount in app.js), run with
// `node test/sched-preview-smoke.js`. Switching from "All investors with AUM"
// (slow, ~232k rows) to the active-fund pool must end on the active-fund
// count even when the slow reply lands last, and an empty single email shows
// no count at all.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

process.on('unhandledRejection', () => {}); // app.js's init() rejects in this minimal page

const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>
  <select id="ssSchedRecipientType">
    <option value="single_email">s</option><option value="csv_list">c</option>
    <option value="all_aum">a</option><option value="active_aum">b</option>
  </select>
  <input id="ssSchedSingleEmail"><input type="file" id="ssSchedCsvFile"><textarea id="ssSchedCsvPaste"></textarea>
  <div id="ssSchedCountPreview" class="hidden"><span id="ssSchedCountPreviewText"></span></div>
</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
const COUNTS = { all_aum: [232392, 60], active_aum: [13837, 5], single_email: [1, 5] }; // [count, delay ms]
const sent = [];
window.fetch = async (url, opts = {}) => {
  const { recipientType } = JSON.parse(opts.body);
  sent.push(recipientType);
  const [count, ms] = COUNTS[recipientType];
  await new Promise((r) => setTimeout(r, ms));
  return { ok: true, status: 200, json: async () => ({ count }) };
};
window.Chart = Object.assign(class { destroy() {} }, { defaults: { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } }, register() {} });
window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

const sandbox = vm.createContext(window);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), sandbox);

const $ = (sel) => window.document.querySelector(sel);
const preview = (type) => { $('#ssSchedRecipientType').value = type; return vm.runInContext("schedPreviewCount('statement')", sandbox); };
(async () => {
  await preview('single_email');
  assert.ok($('#ssSchedCountPreview').classList.contains('hidden'), 'no count before an email is typed');
  assert.deepStrictEqual(sent, [], 'and no request');

  await Promise.all([preview('all_aum'), preview('active_aum')]);
  assert.match($('#ssSchedCountPreviewText').textContent, /13,837 investors/, 'the slow all_aum reply does not overwrite the active-fund count');
  assert.ok(!$('#ssSchedCountPreview').classList.contains('hidden'));

  $('#ssSchedSingleEmail').value = 'jane@example.com';
  await preview('single_email');
  assert.match($('#ssSchedCountPreviewText').textContent, /1 investor per send/, 'a typed email is counted too');
  // CSV / pasted lists: emails and SIDs anywhere in the text, other cells dropped.
  const csv = 'name,email,sid,phone\n"Budi Santoso","Budi@Example.com",idd2302a8215347,0812\nAni;ani@example.com;;\nbudi@example.com,TESTING,123';
  assert.deepStrictEqual(JSON.parse(vm.runInContext(`JSON.stringify(extractRecipients(${JSON.stringify(csv)}, true))`, sandbox)),
    ['budi@example.com', 'IDD2302A8215347', 'ani@example.com'], 'statement: emails + SIDs, deduped, header and names dropped');
  assert.deepStrictEqual(JSON.parse(vm.runInContext(`JSON.stringify(extractRecipients(${JSON.stringify(csv)}, false))`, sandbox)),
    ['budi@example.com', 'ani@example.com'], 'fund performance: emails only');
  console.log('sched-preview smoke test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
