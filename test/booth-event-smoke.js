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

process.on('unhandledRejection', (e) => { if (!/null \(setting 'value'\)/.test(e.message)) throw e; });
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
// Registered 9 Jan, KYC verified 15 Jan (after the event ended on 10 Jan): counts in the last period.
const late = add({ code: 'SCP3', registered: '2027-01-09', verified: '2027-01-15' });
// Verified on the last event day itself (10 Jan): also the last period.
const lastDay = add({ code: 'SCP3', registered: '2027-01-10', verified: '2027-01-10' });
// Period edges: 31 Dec is December, 1 Jan is January.
const decEdge = add({ code: 'SCP3', registered: '2026-12-30', verified: '2026-12-31' });
const janFirst = add({ code: 'SCP3', registered: '2027-01-01', verified: '2027-01-01' });

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
assert.strictEqual(res.latePeriod, '2027-01', 'a KYC verified after the event counts in the last period (January)');

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

// Event runs to 10 Jan 2027. December and January are separate periods: December is a full
// month (M1 = January), January is 1-10 Jan prorated 10/31 (M1 = February).
const cfgInfo = JSON.parse(run(`(() => {
  const c = BOOTH_EVENT, dec = c.periods.find((p) => p.id === '2026-12'), jan = c.periods.find((p) => p.id === '2027-01');
  const periodOf = (id) => boothCompute(__data, c, '2027-01-12').people.find((x) => x.user_id === id).sidPeriod.id;
  return JSON.stringify({ end: c.end, ids: c.periods.map((p) => p.id), dec, jan, decEdge: periodOf('${decEdge}'), janFirst: periodOf('${janFirst}'), lastDay: periodOf('${lastDay}') });
})()`));
assert.strictEqual(cfgInfo.end, '2027-01-10');
assert.deepStrictEqual(cfgInfo.ids, ['2026-10', '2026-11', '2026-12', '2027-01']);
assert.deepStrictEqual([cfgInfo.dec.from, cfgInfo.dec.to, cfgInfo.dec.workDays], ['2026-12-01', '2026-12-31', 21], 'December is a full month on its own');
assert.deepStrictEqual(cfgInfo.dec.m1, { from: '2027-01-01', to: '2027-01-31' });
assert.deepStrictEqual([cfgInfo.jan.from, cfgInfo.jan.to], ['2027-01-01', '2027-01-10']);
assert.ok(Math.abs(cfgInfo.jan.workDays - 21 * 10 / 31) < 1e-9, 'January 1-10 = 10/31 x 21 working days');
assert.deepStrictEqual(cfgInfo.jan.m1, { from: '2027-02-01', to: '2027-02-28' });
assert.strictEqual(cfgInfo.decEdge, '2026-12', 'KYC on 31 Dec is December');
assert.strictEqual(cfgInfo.janFirst, '2027-01', 'KYC on 1 Jan is January, not December');
assert.strictEqual(cfgInfo.lastDay, '2027-01', 'KYC on the last event day (10 Jan) is January');

// Sales names from the sheet: the position (person) stays the key, the name is display only.
const who = JSON.parse(run(`JSON.stringify({
  named: bWho(BOOTH_EVENT, 'Sales PIM 1'), lead: bWho(BOOTH_EVENT, 'Team Lead GC'), dotted: bWho(BOOTH_EVENT, 'Sales PIM 5'),
  flying: bWho(BOOTH_EVENT, 'Flying Team 1'), noName: bWho(BOOTH_EVENT, 'Sales GC 6'), emptyLead: bWho(BOOTH_EVENT, 'Team Lead CP'),
  none: bWho(BOOTH_EVENT, null), unknown: bWho(BOOTH_EVENT, 'Nobody'),
  filled: BOOTH_EVENT.roster.filter((r) => r.name).length, total: BOOTH_EVENT.roster.length,
  badName: BOOTH_EVENT.roster.filter((r) => r.name !== null && (typeof r.name !== 'string' || r.name !== r.name.trim() || !r.name)).map((r) => r.code),
  nameByCode: Object.fromEntries(BOOTH_EVENT.roster.filter((r) => r.name).map((r) => [r.code, r.name])),
})`));
assert.strictEqual(who.named, 'Viki Setiadi (Sales PIM 1)');
assert.strictEqual(who.lead, 'Sandy (Team Lead GC)');
assert.strictEqual(who.dotted, 'M. Zhafran (Sales PIM 5)');
assert.strictEqual(who.flying, 'Flying Team 1', 'flying team has no names yet: falls back to the position');
assert.strictEqual(who.noName, 'Sales GC 6');
assert.strictEqual(who.emptyLead, 'Team Lead CP');
assert.strictEqual(who.none, '');
assert.strictEqual(who.unknown, 'Nobody');
assert.deepStrictEqual([who.filled, who.total], [19, 27], '19 of 27 codes have a name so far (6 flying team, TLCP and SGC6 are empty)');
assert.deepStrictEqual(who.badName, []);
assert.deepStrictEqual(who.nameByCode, {
  TLPIM: 'Herlangga', SPIM1: 'Viki Setiadi', SPIM2: 'Ilham Ramadhan', SPIM3: 'Gabriel Rizal Pratama', SPIM4: 'Novi Yulianti', SPIM5: 'M. Zhafran', SPIM6: 'Zulham Donni',
  SCP1: 'Nur Haliza', SCP2: 'Khairy Harianto', SCP3: 'M. Ilham Saputra', SCP4: 'Milza Anindya Putri', SCP5: 'Widya Sartika', SCP6: 'Marlinda',
  TLGC: 'Sandy', SGC1: 'Eka Muhammad Rizki', SGC2: 'Jihan', SGC3: 'Arfan Herdian', SGC4: 'Agus Rinaldi Rusli', SGC5: 'Edi Sudrajat',
});

// Transaction list: filters (status, type, amount, booth, sales) and the 30-day hold check.
const txRows = [
  { tx_id: 't1', via: 'code', registered_on: '2026-10-19', promo: 'SPIM1', user_id: 'u1', code: 'SPIM1', type: 'buy', status: 'completed', amount: 1000000, created_wib: '2026-10-20 10:00', done_day: '2026-10-20', hold_days: 30, hold_broken_on: null },
  { tx_id: 't2', via: 'code', registered_on: '2026-10-19', promo: null, user_id: 'u2', code: 'SPIM1', type: 'buy', status: 'completed_payment', amount: 25000, created_wib: '2026-10-20 11:00', done_day: '2026-10-20', hold_days: null, hold_broken_on: null },
  { tx_id: 't3', via: 'promo', registered_on: '2026-03-02', promo: 'SGC1', user_id: 'u3', code: 'SGC1', type: 'buy', status: 'pending_payment', amount: 5000000, created_wib: '2026-10-21 09:00', done_day: '2026-10-21', hold_days: null, hold_broken_on: null },
  { tx_id: 't4', via: 'code', registered_on: '2026-10-19', promo: null, user_id: 'u1', code: 'SPIM1', type: 'sell', status: 'verified_by_operational', amount: 1000000, created_wib: '2026-10-25 09:00', done_day: '2026-10-25', hold_days: null, hold_broken_on: null },
  { tx_id: 't5', via: 'promo', registered_on: '2025-12-30', promo: 'FT1GC', user_id: 'u4', code: 'fT1gc', type: 'buy', status: 'completed', amount: 2500000, created_wib: '2026-10-22 09:00', done_day: '2026-10-22', hold_days: 11, hold_broken_on: '2026-11-03' },
  { tx_id: 't6', via: 'code', registered_on: '2026-10-22', promo: 'SCP1', user_id: 'u5', code: 'SCP1', type: 'buy', status: 'completed', amount: 1500000, created_wib: '2026-10-23 09:00', done_day: '2026-10-23', hold_days: 9, hold_broken_on: null },
  { tx_id: 't7', via: 'promo', registered_on: '2026-10-30', promo: 'SCP1', user_id: 'u6', code: 'SCP1', type: 'buy', status: 'completed', amount: 1000000, created_wib: '2026-11-18 09:00', done_day: '2026-11-18', hold_days: null, hold_broken_on: null },
  { tx_id: 't8', via: 'code', registered_on: '2026-11-30', promo: null, user_id: 'u7', code: 'SCP1', type: 'buy', status: 'completed', amount: 1000000, created_wib: '2026-12-01 09:00', done_day: '2026-12-01', hold_days: null, hold_broken_on: null },
];
ctx.__tx = txRows;
const txr = JSON.parse(run(`(() => {
  const ids = (f) => boothTxFilter(__tx, BOOTH_EVENT, f).map((r) => r.tx_id).join(',');
  const row = boothTxFilter(__tx, BOOTH_EVENT, {}).find((r) => r.tx_id === 't5');
  const hs = (id, today) => boothHoldState(__tx.find((r) => r.tx_id === id), BOOTH_EVENT, today);
  return JSON.stringify({
    all: ids({}), completed: ids({ status: 'completed' }), sells: ids({ type: 'sell' }),
    min: ids({ min: '1000000' }), max: ids({ max: 1000000 }), band: ids({ min: 1000000, max: '2500000' }), blank: ids({ min: '', max: null }),
    kindNew: ids({ kind: 'new' }), kindExisting: ids({ kind: 'existing' }), kindOther: ids({ kind: 'other' }),
    kinds: boothTxFilter(__tx, BOOTH_EVENT, {}).map((r) => r.tx_id + ':' + r.kind).join(','),
    existingBig: ids({ kind: 'existing', min: 5000000 }),
    booth: ids({ booth: 'PIM' }), person: ids({ person: 'Sales PIM 1' }), both: ids({ booth: 'GC', status: 'completed' }),
    t5: { person: row.person, booth: row.booth, amount: row.amount },
    held: hs('t1', '2026-12-10'), broken: hs('t5', '2026-12-10'), running: hs('t6', '2026-11-01'),
    pendingNew: hs('t7', '2026-11-20'), noSnap: hs('t8', '2026-12-20'),
    notBuy: hs('t4', '2026-12-10'), notDone: hs('t2', '2026-12-10'), pendingPay: hs('t3', '2026-12-10'),
    need: BOOTH_EVENT.txHoldDays,
    cnt: boothTxCount(boothTxFilter(__tx, BOOTH_EVENT, {})), cntPim: boothTxCount(boothTxFilter(__tx, BOOTH_EVENT, { booth: 'PIM' })), cntNone: boothTxCount([]),
  });
})()`));
assert.strictEqual(txr.all, 't1,t2,t3,t4,t5,t6,t7,t8', 'no filter keeps every row the server sent (expired and cancelled are dropped in SQL)');
assert.strictEqual(txr.completed, 't1,t5,t6,t7,t8');
// 8 rows, users u1..u7 (u1 has a buy and a sell), all 7 bought, 4 of them new (u1 u2 u5 u7) and 3 of those settled (u2 is completed_payment), t2/t3/t4 are not completed.
assert.deepStrictEqual(txr.cnt, { rows: 8, users: 7, buyers: 7, newBuyers: 4, newSettled: 3, waiting: 3 }, 'KPI counts come from the list rows');
assert.deepStrictEqual(txr.cntNone, { rows: 0, users: 0, buyers: 0, newBuyers: 0, newSettled: 0, waiting: 0 });
assert.strictEqual(txr.cntPim.rows, txr.booth.split(',').length, 'the card follows the booth filter like the list');
assert.strictEqual(txr.sells, 't4');
assert.strictEqual(txr.min, 't1,t3,t4,t5,t6,t7,t8', 'min is inclusive');
assert.strictEqual(txr.max, 't1,t2,t4,t7,t8', 'max is inclusive');
assert.strictEqual(txr.band, 't1,t4,t5,t6,t7,t8');
assert.strictEqual(txr.blank, txr.all, 'empty amount boxes mean no limit');
assert.strictEqual(txr.kinds, 't1:new,t2:new,t3:existing,t4:new,t5:existing,t6:new,t7:other,t8:new', 'new = registered with an event code; existing = registered before the event; other = signed up in the event without a code');
assert.strictEqual(txr.kindNew, 't1,t2,t4,t6,t8');
assert.strictEqual(txr.kindExisting, 't3,t5');
assert.strictEqual(txr.kindOther, 't7');
assert.strictEqual(txr.existingBig, 't3', 'customer type combines with the amount filter (t5 is only 2.5 jt)');
assert.strictEqual(txr.booth, 't1,t2,t4', 'PIM booth = SPIM1 rows');
assert.strictEqual(txr.person, 't1,t2,t4');
assert.strictEqual(txr.both, 't5', 'booth GC plus status: flying team code matched case-insensitively');
assert.deepStrictEqual(txr.t5, { person: 'Flying Team 1', booth: 'GC', amount: 2500000 });
assert.deepStrictEqual(txr.held, { key: 'held', days: 30 });
assert.deepStrictEqual(txr.broken, { key: 'broken', days: 11, on: '2026-11-03' }, 'units dropped on day 12: held 11 days');
assert.deepStrictEqual(txr.running, { key: 'holding', days: 9 });
assert.deepStrictEqual(txr.pendingNew, { key: 'pending', days: null }, 'no snapshot yet, bought 2 days ago');
assert.deepStrictEqual(txr.noSnap, { key: 'no_snapshot', days: null }, 'no snapshot 19 days later');
assert.strictEqual(txr.notBuy, null, 'a sell has no hold check');
assert.strictEqual(txr.notDone, null, 'completed_payment is not a completed buy');
assert.strictEqual(txr.pendingPay, null);
assert.strictEqual(txr.need, 30);

// Recap per booth: a customer counts under the code's booth; KYC is the share of the
// range's registrations that verified, so it never exceeds Registered, plus an all-booths row.
const rc = JSON.parse(run(`(() => {
  const { people } = boothCompute(__data, BOOTH_EVENT, '2026-11-20');
  const at = (from, to) => boothRecap(people, BOOTH_EVENT, from, to)
    .map((r) => ({ b: r.booth || 'ALL', reg: r.registered, kyc: r.kyc, fb: r.firstBuy, fu: r.funded, buy: r.buy, sell: r.sell }));
  return JSON.stringify({ nov: at('2026-11-03', '2026-11-30'), first: at('2026-11-03', '2026-11-03'), d25: at('2026-10-25', '2026-10-25') });
})()`));
const rcRow = (set, b) => rc[set].find((r) => r.b === b);
assert.deepStrictEqual(rc.nov.map((r) => r.b), ['PIM', 'GC', 'CP', 'ALL'], 'every booth in config order, then all booths');
assert.deepStrictEqual(rcRow('nov', 'PIM'), { b: 'PIM', reg: 142, kyc: 142, fb: 120, fu: 120, buy: 199000000, sell: 500000 });
assert.deepStrictEqual(rcRow('nov', 'GC'), { b: 'GC', reg: 306, kyc: 305, fb: 225, fu: 225, buy: 350000000, sell: 0 }, 'one pending KYC is registered but not verified');
assert.deepStrictEqual(rcRow('nov', 'CP'), { b: 'CP', reg: 3, kyc: 3, fb: 0, fu: 1, buy: 500000, sell: 1000000 }, 'a booth with only a few rows still gets its own line');
const sumNov = (k) => rc.nov.filter((r) => r.b !== 'ALL').reduce((a, r) => a + r[k], 0);
assert.deepStrictEqual(['reg', 'kyc', 'fb', 'fu', 'buy', 'sell'].map(sumNov), ['reg', 'kyc', 'fb', 'fu', 'buy', 'sell'].map((k) => rcRow('nov', 'ALL')[k]), 'the all-booths row is the sum of the booths');
assert.ok(rc.nov.every((r) => r.kyc <= r.reg), 'KYC never exceeds Registered');
assert.deepStrictEqual([rcRow('first', 'PIM').reg, rcRow('first', 'PIM').fb], [142, 0], 'one-day range: registered that day, first purchase only that day');
assert.deepStrictEqual(rcRow('d25', 'CP'), { b: 'CP', reg: 0, kyc: 0, fb: 1, fu: 0, buy: 500000, sell: 0 },
  'verifications of people who registered the day before stay out of that day: KYC 0, never above Registered');

// A filtered recap (booth or sales filter on the page) lists only the booths left,
// with no all-booths row repeating the same numbers.
const oneBooth = JSON.parse(run(`(() => {
  const { people } = boothCompute(__data, BOOTH_EVENT, '2026-11-20');
  return JSON.stringify(boothRecap(people, { ...BOOTH_EVENT, booths: { PIM: BOOTH_EVENT.booths.PIM } }, '2026-11-03', '2026-11-30').map((r) => r.booth));
})()`));
assert.deepStrictEqual(oneBooth, ['PIM'], 'one booth: that row only, no all-booths row');

console.log('booth-event smoke test passed');
