// Frontend render smoke test — run with `npm test` (or `node test/render-smoke.js`).
//
// public/app.js is a plain browser script with no build step and no type
// checking, so a typo in a helper name (calling makeChart() when the helper is
// actually named paint()) is invisible until the page runs. The section
// loaders swallow exceptions into a `<div class="empty">` error, so a broken
// call renders as "no data" rather than a visible crash — which is exactly how
// the User lifetime / Campaign revenue tabs shipped broken once.
//
// This executes app.js in a stubbed DOM, drives each section loader with canned
// rows shaped like the real API responses, and fails if any table did not end
// up as a real <table>. Add a case here when adding a section loader.
const fs = require('fs'), vm = require('vm'), path = require('path');
process.chdir(path.join(__dirname, '..'));

const errors = [];
const mkEl = (id) => {
  const el = {
    id, _html: '', style: {}, dataset: {}, value: '', textContent: '', rows: [],
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    addEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top:0, height:0, left:0, width:0 }),
    closest: () => null, appendChild(){}, click(){}, focus(){}, blur(){},
    scrollIntoView(){}, insertAdjacentHTML(){}, remove(){}, setAttribute(){},
    getAttribute: () => null, removeAttribute(){}, showModal(){}, close(){},
  };
  Object.defineProperty(el, 'innerHTML', {
    get(){ return el._html; },
    set(v){ el._html = String(v); },
  });
  return el;
};
const els = new Map();
const get = (sel) => { if (!els.has(sel)) els.set(sel, mkEl(sel)); return els.get(sel); };

const document = {
  querySelector: get, querySelectorAll: () => [],
  getElementById: (id) => get('#' + id),
  createElement: mkEl, addEventListener(){},
  documentElement: { style: { setProperty(){} }, getAttribute: () => null, setAttribute(){} },
  body: mkEl('body'),
};
const sandbox = {
  document, console,
  window: { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:''} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  Chart: Object.assign(class { constructor(){} destroy(){} }, { defaults: { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } }, register(){} }),
  fetch: async () => ({ ok:true, json: async () => ({}), blob: async () => ({}), headers:{ get: () => null } }),
  getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
  URL: { createObjectURL: () => '', revokeObjectURL(){} },
  location: { href: 'http://localhost/', origin: 'http://localhost', hostname: 'localhost', search: '', pathname: '/' },
  navigator: { language: 'en', userAgent: 'node' },
  alert(){}, requestAnimationFrame: (f) => f(),
  setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, JSON, Math, Date, Promise, Number, String, Array, Object, isNaN, parseInt, parseFloat, Intl,
};
sandbox.globalThis = sandbox;
sandbox.window.document = document;

// index.html loads i18n.js before app.js; app.js calls into it (translatePage,
// t), so load both into the same context in the same order.
for (const file of ['public/i18n.js', 'public/app.js']) {
  try { vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
  catch (e) { errors.push(`LOAD ${file}: ${e.message}`); }
}

// canned rows shaped like the real API responses
const D = (v) => ({ value: v });
const summaryUL = [{ period: D('2026-01-01'), investors: 5726, days_running: 31, avg_aum: '4.4e10',
  peak_investors: 5700, aperd_per_investor: '4300', total_management_fee: '1e8', total_aperd_share: '5e7', total_mi_share: '5e7' }];
const usersUL = [{ sid_code: 'IDD1', name: 'A', email: 'a@b.c', registered_at: D('2023-03-08'), first_tx: D('2022-11-04'),
  first_buy: D('2022-11-04'), last_tx: D('2026-08-05'), tx_count: 468, total_invested: 2.6e11, first_hold: D('2026-01-13'),
  last_hold: D('2026-08-16'), active_days: 216, funds: 20, account_age_days: 1258, days_to_first_buy: -124,
  tx_span_days: 1371, holding_lifetime_days: 1383, avg_aum: '4.4e10', last_aum: '2.1e10',
  total_management_fee: '5e8', total_aperd_share: '2.5e8', total_mi_share: '2.5e8' }];
const summaryCR = [{ period: D('2026-01-01'), campaigns: 268, participations: 12078, investors: 5726, days_running: 31,
  avg_aum: '4.4e10', total_management_fee: '4.9e7', total_aperd_share: '2.4e7', total_mi_share: '2.4e7', total_aperd_share_alt: '2.8e7' }];
const campaignsCR = [{ promo_code: 'KISIBESTINV', campaign_name: 'X', campaign_type: 'transaction', start_date: D('2025-11-10'),
  end_date: D('2026-01-09'), holding_date: D('2026-06-09'), participations: 192, investors: 79, funds: 3,
  first_lock: D('2025-11-11'), last_day: D('2026-08-16'), days_running: 228, still_locked: 0, bonus_amount: 0,
  used_quota: 0, est_cost: 0, total_management_fee: '7.4e7', total_aperd_share: '3.7e7', total_mi_share: '3.7e7',
  total_aperd_share_alt: '3.8e7', net_vs_cost: '3.7e7' }];
const detailCR = [{ period: D('2026-01-01'), promo_code: 'X', campaign_name: 'Y', participations: 5, investors: 4, funds: 1,
  days_running: 31, still_locked: 0, avg_units: '100', avg_aum: '1e9', total_management_fee: '1e6',
  total_aperd_share: '5e5', total_mi_share: '5e5', total_aperd_share_alt: '6e5' }];

sandbox.api = async (path) => {
  if (path.startsWith('/api/user-lifetime/summary')) return summaryUL;
  if (path.startsWith('/api/user-lifetime/detail'))  return [];
  if (path.startsWith('/api/user-lifetime'))         return usersUL;
  if (path.startsWith('/api/campaign-revenue/campaigns')) return campaignsCR;
  if (path.startsWith('/api/campaign-revenue/summary'))   return summaryCR;
  if (path.startsWith('/api/campaign-revenue'))           return detailCR;
  throw new Error('unexpected path ' + path);
};

(async () => {
  for (const fn of ['loadUserLifetime', 'loadCampaignRevenue']) {
    if (typeof sandbox[fn] !== 'function') { errors.push(`${fn} is not defined`); continue; }
    try { await sandbox[fn](); } catch (e) { errors.push(`${fn}: ${e.message}`); }
  }
  // The loaders swallow exceptions into the table div, so "did it throw?" is
  // not enough — assert each target actually became a <table>.
  for (const sel of ['#ulUsersTable', '#ulSummaryTable', '#crCampaignsTable', '#crDetailTable', '#crSummaryTable']) {
    const html = get(sel)._html;
    if (html.includes('<table')) { console.log(`ok    ${sel}`); continue; }
    const why = html.replace(/<[^>]*>/g, '').trim() || '(never rendered)';
    console.log(`FAIL  ${sel} -> ${why}`);
    errors.push(`${sel} did not render a table: ${why}`);
  }
  if (errors.length) { console.log(`\n${errors.length} failure(s):\n` + errors.join('\n')); process.exit(1); }
  console.log('\nAll section loaders rendered.');
})();
