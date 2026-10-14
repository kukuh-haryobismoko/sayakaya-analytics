// Promo recap summary (promoSummary / prBonusDue in app.js), run with
// `node test/promo-recap-smoke.js`. A payout is per customer and promo, so a
// customer with two participations in one promo counts once in "bonus sent".
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
for (const f of ['i18n.js', 'booth-event-config.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'), ctx);

const camp = { campaign: 'THR', min_amount: 10000000, bonus_amount: 100000, bonus_percentage: null };
ctx.__tx = [
  { promo: 'THRCUAN', user_id: 'a', status: 'completed', amount: 10000000, bonus: { status: 'succeeded' }, ...camp },
  { promo: 'THRCUAN', user_id: 'a', status: 'completed', amount: 12000000, bonus: { status: 'succeeded' }, ...camp },
  { promo: 'THRCUAN', user_id: 'b', status: 'completed', amount: 5000000, bonus: null, ...camp },
  { promo: 'THRCUAN', user_id: 'c', status: 'expired', amount: 10000000, bonus: null, ...camp },
  { promo: 'PCT', user_id: 'd', status: 'completed', amount: 20000000, bonus: { status: 'on_going' }, campaign: 'Pct', bonus_percentage: 1 },
];
ctx.__parts = [
  { promo: 'THRCUAN', user_id: 'a', status: 'succeeded', locked_value: 10000000, bonus_paid: 100000, value_now: 9000000, days_held: 100, fee_total: 40000, fee_aperd: 20000, ...camp },
  { promo: 'THRCUAN', user_id: 'a', status: 'succeeded', locked_value: 12000000, bonus_paid: 100000, value_now: 0, days_held: 50, fee_total: 30000, fee_aperd: 15000, ...camp },
  { promo: 'THRCUAN', user_id: 'e', status: 'redeemed', locked_value: 10000000, bonus_paid: 0, value_now: 0, days_held: 10, fee_total: 5000, fee_aperd: 2500, ...camp },
  { promo: 'PCT', user_id: 'd', status: 'succeeded', locked_value: 20000000, bonus_paid: 0, value_now: 20000000, days_held: 30, fee_total: 10000, fee_aperd: 5000, campaign: 'Pct', bonus_percentage: 1 },
  { promo: 'MANUAL', user_id: 'f', status: 'succeeded', locked_value: 5000000, bonus_paid: 50000, value_now: 5000000, days_held: 20, fee_total: 1000, fee_aperd: 500, campaign: 'Manual' },
];
const sum = JSON.parse(vm.runInContext('JSON.stringify(promoSummary(__tx, __parts))', ctx));
const row = (p) => sum.find((r) => r.promo === p);
const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));

assert.deepStrictEqual(pick(row('THRCUAN'), ['buys', 'users', 'amount', 'failed', 'no_bonus', 'parts', 'eligible', 'lapsed', 'due', 'sent', 'value_now', 'avg_days', 'fee_aperd']), {
  buys: 3, users: 2, amount: 27000000, failed: 1, no_bonus: 1, parts: 3, eligible: 2, lapsed: 1,
  due: 200000, sent: 100000, value_now: 9000000, avg_days: 53, fee_aperd: 37500,
}, 'two eligible participations owe 2 x 100 rb; the one payout to customer a counts once');
assert.strictEqual(row('PCT').due, 200000, '1% of a 20 jt locked value');
assert.deepStrictEqual([row('MANUAL').due, row('MANUAL').dueManual, row('MANUAL').rule], [0, 1, 'set by hand']);
assert.strictEqual(sum[0].promo, 'THRCUAN', 'sorted by amount');
console.log('promo-recap smoke test passed');
