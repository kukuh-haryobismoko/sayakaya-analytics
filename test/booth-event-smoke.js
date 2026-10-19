// Booth event incentives (boothCompute / boothIncentives /
// boothCustomerBonuses in app.js, rules in public/booth-event-config.js), run
// with `node test/booth-event-smoke.js`. Synthetic customers with amounts
// worked out by hand; if a rule in the config changes, update the
// expectations here with it.
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
const run = (code) => vm.runInContext(code, ctx);

const customers = [];
const transactions = [];
let n = 0;
// One customer; buys/sells: [[day, amount, extra]] (extra merges into the row).
const add = ({ code, via = 'code', registered = '2026-11-03', verified = '2026-11-03', status = 'verified', aum = 1, buys = [], sells = [] }) => {
  const id = `u${++n}`;
  customers.push({ user_id: id, code, via, sid: `SID${n}`, email: `${id}@x.id`, name: `C${n}`, verification_status: status, registered_on: registered, verified_on: verified, aum_now: aum });
  for (const [day, amount, extra] of buys) transactions.push({ user_id: id, day, type: 'buy', amount, sam: false, promo: null, plan_id: null, ...extra });
  for (const [day, amount, extra] of sells) transactions.push({ user_id: id, day, type: 'sell', amount, sam: false, promo: null, plan_id: null, ...extra });
  return id;
};
const times = (k, f) => { for (let i = 0; i < k; i++) f(i); };

// November (full month, scale 1).
// SPIM1: 63 SID; 41 buy 1 jt, one of them sells 500 rb (net 500 rb, not funded) -> 40 funded = 63.5%;
// 20 buy again 1 jt in December (M1) = 31.7%.
times(63, (i) => add({
  code: 'SPIM1',
  buys: i < 41 ? [['2026-11-05', 1000000], ...(i < 20 ? [['2026-12-03', 1000000]] : [])] : [],
  sells: i === 0 ? [['2026-11-20', 500000]] : [],
}));
// SPIM2: 49 SID all funded: one short of the 50 threshold -> nothing.
times(49, () => add({ code: 'SPIM2', buys: [['2026-11-06', 2000000]] }));
// Flying Team 1: 30 SID on FT1PIM + 25 on FT1GC = 55, all funded 2 jt.
times(30, () => add({ code: 'FT1PIM', buys: [['2026-11-07', 2000000]] }));
times(25, () => add({ code: 'FT1GC', buys: [['2026-11-07', 2000000]] }));
// SGC1: 280 SID, 200 buy 1,5 jt; 80 buy again 1,5 jt in December.
times(280, (i) => add({ code: 'SGC1', buys: i < 200 ? [['2026-11-08', 1500000], ...(i < 80 ? [['2026-12-04', 1500000]] : [])] : [] }));
// Not counted as SID: registered but KYC pending.
add({ code: 'SGC1', status: 'pending', verified: null });

// October (13/31 x 21 = 8.81 days, scale 0.4194): SCP1 21 SID, 11 funded.
times(21, (i) => add({ code: 'SCP1', registered: '2026-10-24', verified: '2026-10-25', buys: i < 11 ? [['2026-10-26', 1000000]] : [] }));
// SCP2 20 SID all funded: one short of ceil(50 x 0.4194) = 21.
times(20, () => add({ code: 'SCP2', registered: '2026-10-24', verified: '2026-10-25', buys: [['2026-10-26', 1000000]] }));
// Registered 2 Jan, KYC verified 10 Jan (after the event): counts in the last period.
const late = add({ code: 'SCP3', registered: '2027-01-02', verified: '2027-01-10' });

// Customer bonuses.
const welcomeOk = add({ code: 'SCP4', buys: [['2026-11-02', 1000000, { sam: true }]] });
const welcomeNotSam = add({ code: 'SCP4', buys: [['2026-11-02', 1000000]] });
const welcomeLapsed = add({ code: 'SCP4', buys: [['2026-11-02', 1000000, { sam: true }]], sells: [['2026-11-10', 1000000, { sam: true }]] });
const topOk = add({ code: 'SPIM1', via: 'promo', registered: '2025-01-01', verified: '2025-01-02', buys: [['2026-11-05', 6000000, { sam: true, promo: 'SPIM1' }]] });
const topCapLapsed = add({ code: 'SPIM1', via: 'promo', registered: '2025-01-01', verified: '2025-01-02',
  buys: [['2026-11-05', 60000000, { sam: true, promo: 'SPIM1' }]], sells: [['2026-11-20', 1000000, { sam: true }]] });
const saver = add({ code: 'SCP5', registered: '2026-10-20', verified: '2026-10-20', buys: [
  ['2026-10-25', 500000, { sam: true, plan_id: 'p1' }], ['2026-11-25', 500000, { sam: true, plan_id: 'p1' }], ['2026-12-25', 500000, { sam: true, plan_id: 'p1' }],
] });
const plans = [
  { plan_id: 'p1', user_id: saver, frequency: 'MONTHLY', status: 'ACTIVE', deleted: false, created_on: '2026-10-20', sam_amount: 500000 },
  { plan_id: 'p2', user_id: welcomeOk, frequency: 'MONTHLY', status: 'ACTIVE', deleted: false, created_on: '2026-11-02', sam_amount: 400000 },
];

ctx.__data = { customers, transactions, plans };
const today = '2026-12-10';
const res = JSON.parse(run(`(() => {
  const today = '${today}';
  const { people } = boothCompute(__data, BOOTH_EVENT, today);
  const P = (id) => BOOTH_EVENT.periods.find((p) => p.id === id);
  const nov = boothIncentives(people, BOOTH_EVENT, P('2026-11'), today);
  const oct = boothIncentives(people, BOOTH_EVENT, P('2026-10'), today);
  const bon = boothCustomerBonuses(people, __data.plans, BOOTH_EVENT, today);
  const strip = ({ x, ...rest }) => ({ ...rest, user_id: x.user_id });
  return JSON.stringify({
    nov, oct,
    latePeriod: people.find((x) => x.user_id === '${late}').sidPeriod.id,
    welcome: bon.welcome.map(strip), nabung: bon.nabung.map(strip), topUp: bon.topUp.map(strip),
  });
})()`));

const sales = (period, name) => res[period].sales.find((r) => r.person === name);
const pick = (r) => ({ sid: r.sid, funded: r.funded, gate: r.gate, r1: r.r1, r2: r.r2, r3: r.r3, r4: r.r4, total: r.total, paid: r.paid });

assert.deepStrictEqual(pick(sales('nov', 'Sales PIM 1')), { sid: 63, funded: 40, gate: true, r1: 400000, r2: 300000, r3: 0, r4: 250000, total: 950000, paid: 950000 });
assert.strictEqual(sales('nov', 'Sales PIM 1').aum, 40500000, 'net money in: 41 x 1 jt minus the 500 rb sale');
assert.deepStrictEqual(pick(sales('nov', 'Sales PIM 2')), { sid: 49, funded: 49, gate: false, r1: 0, r2: 0, r3: 0, r4: 0, total: 0, paid: 0 });
assert.deepStrictEqual(pick(sales('nov', 'Flying Team 1')), { sid: 55, funded: 55, gate: true, r1: 200000, r2: 800000, r3: 600000, r4: 0, total: 1600000, paid: 1600000 });
assert.deepStrictEqual(pick(sales('nov', 'Sales GC 1')), { sid: 280, funded: 200, gate: true, r1: 400000, r2: 450000, r3: 600000, r4: 0, total: 1450000, paid: 1450000 });
assert.strictEqual(res.nov.status, 'waiting_m1', 'November ended, December (M1) still running');

const lead = (period, booth) => res[period].leads.find((r) => r.booth === booth);
// PIM: 63 + 49 + 30 = 142 of 378 -> under 80%.
assert.deepStrictEqual({ sid: lead('nov', 'PIM').sid, gate: lead('nov', 'PIM').gate, paid: lead('nov', 'PIM').paid }, { sid: 142, gate: false, paid: 0 });
// GC: 280 + 25 = 305 of 378 = 80.7%; funded 1,5 jt+: 200 + 25 = 225 = 73.8%; 350 jt; 80 / 305 = 26.2% again.
assert.deepStrictEqual(pick(lead('nov', 'GC')), { sid: 305, funded: 225, gate: true, r1: 750000, r2: 700000, r3: 700000, r4: 350000, total: 2500000, paid: 2500000 });
assert.strictEqual(lead('nov', 'GC').aum, 350000000);

// October, prorated: SCP1 21 SID (= ceil(50 x 8.81 / 21)), 11 funded = 52.4%.
assert.deepStrictEqual(pick(sales('oct', 'Sales CP 1')), { sid: 21, funded: 11, gate: true, r1: 150000, r2: 300000, r3: 0, r4: 0, total: 450000, paid: 450000 });
assert.strictEqual(sales('oct', 'Sales CP 2').gate, false, '20 SID is one short in October');
assert.strictEqual(sales('oct', 'Sales CP 1').gateSid, 21);
assert.strictEqual(res.latePeriod, '2026-12', 'a KYC verified after the event counts in the last period');

const w = (id) => res.welcome.find((r) => r.user_id === id);
assert.deepStrictEqual([w(welcomeOk).key, w(welcomeOk).bonus, w(welcomeOk).until], ['eligible', 25000, '2026-12-02']);
assert.strictEqual(w(welcomeNotSam).key, 'not_sam');
assert.deepStrictEqual([w(welcomeLapsed).key, w(welcomeLapsed).bonus], ['lapsed', 0]);

const u = (id) => res.topUp.find((r) => r.user_id === id);
assert.deepStrictEqual([u(topOk).key, u(topOk).cashback, u(topOk).payable, u(topOk).person], ['eligible', 30000, 30000, 'Sales PIM 1']);
assert.deepStrictEqual([u(topCapLapsed).cashback, u(topCapLapsed).key, u(topCapLapsed).payable], [250000, 'lapsed', 0], '0.5% of 60 jt capped at 250 rb, then lapsed');

const plan = (id) => res.nabung.find((r) => r.plan.plan_id === id);
assert.deepStrictEqual([plan('p1').months, plan('p1').key, plan('p1').bonus], [3, 'eligible', 100000]);
assert.strictEqual(plan('p2').key, 'not_eligible', '400 rb a month is below the 500 rb minimum');

// "Data as of" line: oldest copy time, shown in WIB (UTC + 7), in both languages.
const fresh = [
  { table_id: 'transactions', modified_at: '2026-10-19T01:17:14Z' },
  { table_id: 'users', modified_at: '2026-10-19T02:02:11Z' },
  { table_id: 'user_profiles', modified_at: '2026-10-18T20:30:00Z' },
];
ctx.__fresh = fresh;
assert.ok(run('boothFreshText(__fresh)').includes('2026-10-19 03:30 WIB'), 'oldest copy (20:30 UTC) = 03:30 WIB next day');
assert.strictEqual(run('boothFreshText([])'), '');
assert.strictEqual(run('boothFreshText(undefined)'), '');
assert.strictEqual(run("boothFreshText([{ table_id: 'users', modified_at: 'nope' }])"), '');

console.log('booth-event smoke test passed');
