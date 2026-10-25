// Ask actions smoke test: an ACTION line from the model becomes an open_tab or portfolio_export
// result only when the user may use that tab, and the investor must resolve to exactly one row.
// BigQuery and the AI call are stubbed. Run with `node test/ask-action-smoke.js`.
const assert = require('assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.AI_BASE_URL = 'http://router.test';
process.env.AI_API_KEY = 'test';
const stub = (rel, exports) => { const f = require.resolve(rel, { paths: [path.join(__dirname, '../server')] }); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

let people = [];
let prompts = [];
let top = [];
let ranDay = null;
stub('./bigquery', { runQuery: async (sql) => (sql === 'top' ? top : sql === 'latest' ? [{ latest_date: { value: '2026-10-24' } }] : people), validateAdHoc: () => ({ ok: true, sql: 'SELECT 1' }), capRows: (s) => s });
stub('./queries', {
  userSearch: (q) => ({ sql: 'search', params: { q } }),
  hnwiLatestDate: () => ({ sql: 'latest', params: {} }),
  hnwiTotal: (day, min, max, limit) => { ranDay = { day, limit }; return { sql: 'top', params: {} }; },
  usersByIdentifiers: (ids) => ({ sql: 'ids', params: { ids } }),
});
stub('./auth', { userCan: (u, tab) => u.is_superuser || (u.allowed_tabs || []).includes(tab), logEvent: async () => {} });

let reply = '';
global.fetch = async (_url, init) => {
  prompts.push(JSON.parse(init.body).messages[0].content); // the system message
  return new Response(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }), { status: 200 });
};
const { ask } = require('../server/ask');

const tabs = [{ id: 'portfolio', label: 'Portfolio' }, { id: 'aum', label: 'AUM' }];
const run = (user, r, extra = {}) => { reply = r; return ask('q', null, [], user, { tabs, ...extra }); };
const budi = { user_id: 'u1', sid: 'IDD123', name: 'Budi' };
const allowed = { allowed_tabs: ['portfolio', 'aum'] };

(async () => {
  people = [budi];
  let r = await run(allowed, 'ACTION: {"type":"portfolio_export","query":"Budi","format":"pdf","date":"2026-10-01"}');
  assert.deepStrictEqual(r.action, { type: 'portfolio_export', userId: 'u1', sid: 'IDD123', name: 'Budi', source: 'portfolio_full', format: 'pdf', date: '2026-10-01', performance: false });
  assert.ok(prompts[prompts.length - 1].includes('aum: AUM'), 'the tab list reaches the prompt');

  r = await run(allowed, 'ACTION: {"type":"portfolio_export","query":"Budi","format":"exe","date":"yesterday"}');
  assert.strictEqual(r.action.format, 'pdf', 'unknown format falls back to pdf');
  assert.strictEqual(r.action.date, undefined, 'a non-ISO date is dropped');

  r = await run({ allowed_tabs: ['aum'] }, 'ACTION: {"type":"portfolio_export","query":"Budi","format":"pdf"}');
  assert.ok(!r.action && /access/i.test(r.answer), 'no Portfolio access, no export');

  people = [budi, { user_id: 'u2', sid: 'IDD999', name: 'Budi Santoso' }];
  r = await run(allowed, 'ACTION: {"type":"portfolio_export","query":"budi","format":"pdf"}');
  assert.ok(!r.action && r.answer.includes('IDD999'), 'two matches ask which one');
  r = await run(allowed, 'ACTION: {"type":"portfolio_export","query":"idd999","format":"pdf"}');
  assert.strictEqual(r.action.sid, 'IDD999', 'an exact SID wins over a loose match');

  people = [];
  r = await run(allowed, 'ACTION: {"type":"portfolio_export","query":"nobody","format":"pdf"}');
  assert.ok(!r.action && /No investor/.test(r.answer));

  r = await run(allowed, 'ACTION: {"type":"open_tab","tab":"aum"}');
  assert.deepStrictEqual(r.action, { type: 'open_tab', tab: 'aum', label: 'AUM' });
  r = await run({ allowed_tabs: ['portfolio'] }, 'ACTION: {"type":"open_tab","tab":"aum"}');
  assert.ok(!r.action, 'a tab the user cannot open is refused');
  r = await run(allowed, 'ACTION: {"type":"open_tab","tab":"admin"}');
  assert.ok(!r.action, 'a tab missing from the browser list is refused');
  r = await run(allowed, 'ACTION: {not json}');
  assert.ok(!r.action && r.answer);

  // portfolio source, AI Insights, written note, aggregate tables
  people = [budi];
  r = await run(allowed, 'ACTION: {"type":"portfolio_export","query":"Budi","source":"tx","format":"xlsx"}');
  assert.ok(!r.action && /access/i.test(r.answer), 'Portfolio TX needs its own tab');
  r = await run({ allowed_tabs: ['portfolio-tx'] }, 'ACTION: {"type":"portfolio_export","query":"Budi","source":"tx","format":"xlsx"}');
  assert.strictEqual(r.action.source, 'portfolio_tx_full');
  r = await run({ allowed_tabs: ['portfolio'] }, 'ACTION: {"type":"portfolio_export","query":"Budi","source":"constructor"}');
  assert.ok(!r.action, 'an unknown source is refused, not read off the prototype');

  r = await run({ allowed_tabs: ['ai-insights'] }, 'ACTION: {"type":"ai_insight","kind":"churn"}');
  assert.deepStrictEqual(r.action, { type: 'ai_insight', kind: 'churn' });
  r = await run(allowed, 'ACTION: {"type":"ai_insight","kind":"churn"}');
  assert.ok(!r.action, 'AI Insights needs its tab');
  r = await run({ allowed_tabs: ['ai-insights'] }, 'ACTION: {"type":"ai_insight","kind":"retrain"}');
  assert.ok(!r.action, 'only the four read-only reports run');

  r = await run({ allowed_tabs: ['portfolio-fix'] }, 'ACTION: {"type":"portfolio_note","query":"Budi"}');
  assert.deepStrictEqual(r.action, { type: 'portfolio_note', userId: 'u1', sid: 'IDD123', name: 'Budi' });
  r = await run({ allowed_tabs: ['aum'] }, 'ACTION: {"type":"portfolio_note","query":"Budi"}');
  assert.ok(!r.action, 'a note needs some portfolio tab');

  r = await run(allowed, 'ACTION: {"type":"table_export","table":"aum_history","format":"xlsx","from":"2026-01-01","to":"2026-03-31","granularity":"day"}');
  assert.deepStrictEqual(r.action, { type: 'table_export', table: 'aum_history', source: 'aum_history', format: 'xlsx', from: '2026-01-01', to: '2026-03-31', date: r.action.date, granularity: 'day' });
  r = await run({ allowed_tabs: ['portfolio'] }, 'ACTION: {"type":"table_export","table":"aum_history"}');
  assert.ok(!r.action, 'a table needs its tab');
  r = await run(allowed, 'ACTION: {"type":"table_export","table":"transactions"}');
  assert.ok(!r.action, 'tables with personal data are not on the list');
  r = await run(allowed, 'ACTION: {"type":"send_email","to":"a@b.c"}');
  assert.ok(!r.action, 'unknown action types, such as email, are refused');

  // Bulk: top N by AUM, or a typed list, resolved on the server.
  people = [{ user_id: 'u1', sid: 'IDD123' }, { user_id: 'u2', sid: 'IDD999' }];
  top = [{ sid_code: 'IDD123' }, { sid_code: 'IDD999' }];
  const hnwi = { allowed_tabs: ['portfolio', 'hnwi'] };
  r = await run(hnwi, 'ACTION: {"type":"portfolio_bulk","top":2,"format":"pdf","mode":"separate","date":"2026-10-10"}');
  assert.deepStrictEqual(r.action, { type: 'portfolio_bulk', users: [{ userId: 'u1', sid: 'IDD123' }, { userId: 'u2', sid: 'IDD999' }], missing: [], source: 'portfolio_full', format: 'pdf', mode: 'separate', date: '2026-10-10' });
  assert.deepStrictEqual(ranDay, { day: '2026-10-10', limit: 2 });
  r = await run(hnwi, 'ACTION: {"type":"portfolio_bulk","top":2}');
  assert.strictEqual(ranDay.day, '2026-10-24', 'no date: latest HNWI day');
  assert.strictEqual(r.action.mode, 'combined');
  r = await run(allowed, 'ACTION: {"type":"portfolio_bulk","top":2}');
  assert.ok(!r.action && /access/i.test(r.answer), 'top N needs the hnwi tab');
  r = await run(allowed, 'ACTION: {"type":"portfolio_bulk","queries":["idd123","IDD404"],"format":"xlsx"}');
  assert.deepStrictEqual(r.action.users, [{ userId: 'u1', sid: 'IDD123' }]);
  assert.deepStrictEqual(r.action.missing, ['IDD404']);
  r = await run(hnwi, 'ACTION: {"type":"portfolio_bulk","top":51}');
  assert.ok(!r.action, 'over 50 refused');
  r = await run({ allowed_tabs: ['hnwi'] }, 'ACTION: {"type":"portfolio_bulk","queries":["IDD123"]}');
  assert.ok(!r.action, 'no Portfolio tab, no bulk');
  r = await run(allowed, 'ACTION: {"type":"portfolio_bulk","queries":[]}');
  assert.ok(!r.action, 'empty list refused');

  console.log('ask-action-smoke ok');
})().catch((e) => { console.error(e); process.exit(1); });
