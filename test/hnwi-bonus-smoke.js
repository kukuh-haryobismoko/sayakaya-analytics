// HNWI bonus (hnwiCustomer in app.js, rules in public/hnwi-bonus-config.js),
// run with `node test/hnwi-bonus-smoke.js`. Amounts worked out by hand from
// the config: bonus a day = what is left x rate / 100 / 365.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

process.on('unhandledRejection', () => {});
const { window } = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>', { url: 'http://localhost/' });
window.Chart = Object.assign(class { destroy() {} }, { defaults: { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } }, register() {} });
window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
const ctx = vm.createContext(window);
for (const f of ['i18n.js', 'booth-event-config.js', 'hnwi-bonus-config.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'), ctx);

const MMF = 'PlFsTEcPFZCWZNeBOQ7Qw'; // 0.10%
const BOND = 'daZyyZB1L-UShYEfCDJN3'; // 0.15%
const PREMIUM = 'Z6uXYPsFUf_m7K3TIkEJJ'; // 0.20%
const MAXI = 'Pp0Dyh3SaSBFVoyIx0Khx'; // 0.25%
const buy = (day, amount, fund_id, done_day = day) => ({ type: 'buy', day, done_day, amount, fund_id, fund: fund_id });
const sell = (day, amount) => ({ type: 'sell', day, done_day: day, amount, fund_id: MMF, fund: 'x' });
const swOut = (day, amount, to_sam) => ({ type: 'SWITCH_OUT', day, done_day: day, amount, fund_id: MMF, fund: 'x', to_sam });
const run = (c, txs, today) => {
  ctx.__args = { c: { user_id: 'u', sid: 'S', first_below: null, ...c }, txs, today };
  return JSON.parse(vm.runInContext('JSON.stringify(hnwiCustomer(__args.c, __args.txs, HNWI_BONUS, __args.today))', ctx));
};
const month = (r, m) => r.months.find((x) => x.m === m);

// A: 300 jt MMF on 5 Oct. Day = 300e6 x 0.1% / 365 = 821.918. First month (31 days) paid on 5 Nov,
// then 5-30 Nov (26 days) = 46,849 for November; 1-10 Dec = 8,219 so far; sent by 9 Dec (7 weekdays after 30 Nov).
let r = run({}, [buy('2026-10-05', 300e6, MMF)], '2026-12-10');
assert.deepStrictEqual([r.qualifiedOn, month(r, '2026-11').amount, month(r, '2026-11').due, r.earned, r.running, r.status],
  ['2026-10-05', 46849, '2026-12-09', 46849, 8219, 'active']);

// B: 60 jt Bond on 10 Oct (completed 12 Oct), 20 jt redeemed 25 Oct (FIFO -> 40 jt left before the
// 12 Nov mark), 50 jt Maxi 20 Nov: net 90 jt, under 100 jt, so everything waits.
// Bond day = 40e6 x 0.15% / 365 = 164.384: 31 first-month days + 29 days to 10 Dec = 9,863.
r = run({}, [buy('2026-10-10', 60e6, BOND, '2026-10-12'), sell('2026-10-25', 20e6), buy('2026-11-20', 50e6, MAXI)], '2026-12-10');
assert.deepStrictEqual([r.net, r.qualifiedOn, r.earned, r.running, r.pending, r.status], [90e6, null, 0, 0, 9863, 'building']);
assert.strictEqual(r.lots[0].remaining, 40e6);
// Not reached by 31 Dec: lost.
assert.strictEqual(run({}, [buy('2026-10-10', 60e6, BOND, '2026-10-12')], '2027-01-15').status, 'not_reached');

// C: 80 jt MMF 1 Oct, 30 jt more on 2 Dec reaches 110 jt: November's 13,370 is paid with December
// (rapel): 2,192 for 1-10 Dec + 13,370 = 15,562 so far, nothing in November.
r = run({}, [buy('2026-10-01', 80e6, MMF), buy('2026-12-02', 30e6, MMF)], '2026-12-10');
assert.deepStrictEqual([r.qualifiedOn, month(r, '2026-11').amount, r.running, r.earned], ['2026-12-02', 0, 15562, 0]);

// D: 200 jt Premium 1 Oct, AUM under 500 jt on 20 Nov: out from November, its 54,795 lost.
r = run({ first_below: '2026-11-20' }, [buy('2026-10-01', 200e6, PREMIUM)], '2026-12-10');
assert.deepStrictEqual([r.status, r.earned, r.running, r.forfeited], ['lapsed_aum', 0, 0, 54795]);

// E: 50 M Maxi 1 Oct, day = 342,465.75: November 20,890,411; December 10,616,438 capped to
// 4,109,589 (25 jt in all); 1-5 Jan nothing left.
r = run({}, [buy('2026-10-01', 50e9, MAXI)], '2027-01-05');
assert.deepStrictEqual([month(r, '2026-11').amount, month(r, '2026-12').amount, r.earned, r.running, r.capReached, r.forfeited],
  [20890411, 4109589, 25000000, 0, true, 8219178]);

// F: a 50 jt redemption before any purchase takes from the next one (net = buys - redemptions).
r = run({}, [sell('2026-10-03', 50e6), buy('2026-10-10', 120e6, MMF)], '2026-10-20');
assert.deepStrictEqual([r.lots[0].remaining, r.net, r.qualifiedOn], [70e6, 70e6, null]);

// G: switching to another SAM fund is not a redemption; to a fund of another manager it is.
r = run({}, [buy('2026-10-01', 150e6, MMF), swOut('2026-10-20', 50e6, true), swOut('2026-10-21', 30e6, false)], '2026-10-25');
assert.deepStrictEqual([r.lots[0].remaining, r.redeemed], [120e6, 30e6]);

// A fund outside the rate table counts toward the minimum but earns nothing.
r = run({}, [buy('2026-10-01', 150e6, 'not-in-table')], '2026-12-10');
assert.deepStrictEqual([r.qualifiedOn, r.earned, r.running], ['2026-10-01', 0, 0]);

console.log('hnwi-bonus smoke test passed');
