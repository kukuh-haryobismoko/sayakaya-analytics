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
  // app.js wires a MutationObserver at load time (table export bars) — not
  // exercised here, just needs to exist so the script finishes loading.
  MutationObserver: class { observe(){} disconnect(){} },
  fetch: async () => ({ ok:true, json: async () => ({}), blob: async () => ({}), headers:{ get: () => null } }),
  getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
  URL: { createObjectURL: () => '', revokeObjectURL(){} },
  location: { href: 'http://localhost/', origin: 'http://localhost', hostname: 'localhost', search: '', pathname: '/' },
  navigator: { language: 'en', userAgent: 'node' },
  alert(){}, requestAnimationFrame: (f) => f(),
  setTimeout, clearTimeout, URLSearchParams, encodeURIComponent, decodeURIComponent, JSON, Math, Date, Promise, Number, String, Array, Object, isNaN, parseInt, parseFloat, Intl,
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
const referralProgram = [{ inviter_sid: 'IDD1', inviter_name: 'A', inviter_ifua: 'IFUA1', inviter_email: 'a@b.c', inviter_phone: '628',
  invitee_sid: 'IDD2', invitee_name: 'B', invitee_ifua: 'IFUA2', invitee_email: 'b@b.c', invitee_phone: '628',
  fund_name: 'Sucorinvest Money Market Fund', amount: 1000000, tx_date: D('2026-09-05'), days_held: 35,
  baseline_unit: '1000', min_unit_in_window: '1000', status: 'Eligible', reason: null }];
const referralInviterStats = [{ inviter_sid: 'IDD1', inviter_referral_code: 'REF1', inviter_name: 'A', invited_count: 8, transacted_count: 3 }];

// Overview tab: KPIs (platform_aum is now date-scoped via #ovAumDate, not the
// from/to range), trend/breakdown charts, AUM-by-type, investor map, top
// cities, and the fund-filter dropdown's own option list.
const overviewKpis = { platform_aum: '1.2e13', investing_users: 4200,
  total_users: 12000, verified_users: 9000, new_users_30d: 150, buy_volume: '3e11', buy_count: 800,
  sell_volume: '1e11', sell_count: 200, active_users: 900, total_tx: 1200, active_funds: 40, total_funds: 45 };
const overviewTrends = [{ bucket: '2026-09', buy_count: 10, sell_count: 4, buy_volume: '1e10', sell_volume: '2e9', active_users: 50 }];
const overviewBreakdown = [{ label: 'buy', count: 10, volume: '1e10' }];
const overviewVerification = [{ label: 'verified', count: 9000 }];
const overviewFundTypes = [{ label: 'Money Market', count: 10, aum: '5e12' }];
// id is a short opaque string in the real schema (BigQuery funds.id / *.fund_id
// are STRING, not INT64) — kept non-numeric here so a stray parseInt() on the
// fund-filter path would fail this test instead of shipping broken.
const overviewFundList = [{ id: 'PlFsTEcPFZCWZNeBOQ7Qw', name: 'Sucorinvest Money Market Fund', type: 'Money Market' }];
const overviewProvince = [{ province_name: 'DKI Jakarta', investor_count: 3000, total_aum: '6e12' }];
const overviewTopCities = [{ city_name: 'Jakarta Selatan', province_name: 'DKI Jakarta', investor_count: 1500 }];
const overviewTopCitiesAum = [{ city_name: 'Jakarta Selatan', province_name: 'DKI Jakarta', total_aum: '3e12' }];
const overviewTopFunds = [
  { label: 'Sucorinvest Money Market Fund', aum: '5e12', pct_of_total: '66.81', investors: 2000, is_total: false },
  { label: 'Total', aum: '7.48e12', pct_of_total: 100, investors: 3100, is_total: true },
];
// AUM history: first row has no prior period, so market_effect is null there.
const aumHistory = [
  { bucket: '2026-07', aum: '2.6e11', revenue: '1e8', funds: 80, subscriptions: '8.5e10', redemptions: '9e10', net_flow: '-4.5e9', market_effect: null },
  { bucket: '2026-08', aum: '2.61e11', revenue: '1e8', funds: 80, subscriptions: '6.9e10', redemptions: '7.1e10', net_flow: '-1.9e9', market_effect: '2.9e9' },
];
const revenueTrend = [
  { bucket: '2026-08-31', revenue: '31075533', days: 6, avg_aum: '2.6e11', change_pct: null, days_effect: null, aum_effect: null, rate_effect: null },
  { bucket: '2026-09-07', revenue: '33630815', days: 7, avg_aum: '2.61e11', change_pct: '8.2', days_effect: '5179000', aum_effect: '120000', rate_effect: '-3000' },
];
const revenueTrendDrill = [{ fund: 'Sucorinvest Money Market Fund', manager: 'Sucor Asset Management', revenue_prev: '1e7', revenue_cur: '1.2e7',
  change: '2e6', days_effect: '1.6e6', aum_effect: '3e5', rate_effect: '1e5' }];
const aumDrill = [{ fund: 'Sucorinvest Money Market Fund', manager: 'Sucor Asset Management', aum_start: '1e11', aum_end: '9e10',
  aum_change: '-1e10', subscriptions: '8.7e9', redemptions: '6.2e10', switch_net: '5.2e9', market_effect: '3.8e10' }];
const topInvestors = [{ sid: 'IDD1', name: 'A', email: 'a@b.c', subscriptions: '2.1e9', buys: 3, pct_of_subscriptions: '37.58',
  redemptions: '0', sells: 0, pct_of_redemptions: '0', net_deposit: '2.1e9' }];

const dormantConversionSummary = [
  { dormant_category: '2 Weeks Dormant', total_dormancy_periods: 1000, converted_periods: 980, conversion_rate_pct: 98.0, total_revenue: '7e8', avg_revenue_per_conversion: '7.1e5', median_revenue_per_conversion: '1e6', max_revenue_per_conversion: '5e7' },
  { dormant_category: '3 Month Dormant', total_dormancy_periods: 300, converted_periods: 250, conversion_rate_pct: 83.3, total_revenue: '2e8', avg_revenue_per_conversion: '8e5', median_revenue_per_conversion: '1e6', max_revenue_per_conversion: '2e7' },
];
const dormantRepeatBuyers = [{ user_id: 'u1', dormant_category: '2 Weeks Dormant', txn_count: 3, total_spent: '9e7', buyer_type: 'Power (4+)' }];
const dormantTimeToConvert = [{ user_id: 'u1', dormant_category: '2 Weeks Dormant', first_txn_date: D('2026-06-01'), days_to_convert: 16 }];

const pushTrend = [{ bucket: D('2026-09-01'), total_sends: 1000, accepted: 980, delivery_rate_pct: 98.0 }];
const pushByPlatform = [
  { sdk_platform: 'ANDROID', total_sends: 700, accepted: 650, delivery_rate_pct: 92.86 },
  { sdk_platform: 'IOS', total_sends: 300, accepted: 299, delivery_rate_pct: 99.67 },
];
const pushByCampaign = [{ analytics_label: 'Promo_Test', total_sends: 500, accepted: 480, missing_registrations: 15, other_errors: 5, delivery_rate_pct: 96.0 }];

const marketingFunnel = [
  { channel: 'Organic', clicks: 0, installs: 4984, otp_verified: 6823, registrations: 1643, kyc_verified: 376, orders_created: 3976, payments_completed: 2816, total_revenue: '4.78e10' },
  { channel: 'x::download apk', clicks: 122, installs: 0, otp_verified: 0, registrations: 0, kyc_verified: 0, orders_created: 0, payments_completed: 0, total_revenue: '0' },
];

const appCrashIssues = [
  { platform: 'ANDROID', issue_title: 'package:aegis/src/utils/measurement_util.dart', is_fatal: false, event_count: 815, affected_devices: 83, latest_app_version: '2.28.2' },
  { platform: 'ANDROID', issue_title: 'Null check crash', is_fatal: true, event_count: 3, affected_devices: 3, latest_app_version: '2.28.1' },
];
const appPerfTraces = [
  { platform: 'IOS', event_name: 'screen_GoalDetailRoute', sample_count: 39, median_duration_ms: 12506.5, avg_duration_ms: 270297.6 },
  { platform: 'ANDROID', event_name: 'gql_query_promotions', sample_count: 16675, median_duration_ms: 1851, avg_duration_ms: 3098.7 },
];

const productFunnel = [
  { platform: 'ANDROID', registered: 258, otp_submitted: 242, kyc_started: 142, kyc_verified: 90, ordered: 50, paid: 40 },
  { platform: 'IOS', registered: 71, otp_submitted: 69, kyc_started: 45, kyc_verified: 37, ordered: 28, paid: 23 },
];

const kalcerSummary = [
  { referrer_sid: 'IDD1', referrer_name: 'Jessica Wijaya', referrer_email: 'jessica@sayakaya.id',
    referred_count: 435, first_referral_date: D('2022-01-27'), last_referral_date: D('2026-05-18'), total_aum_referred: '2.05e10' },
  { referrer_sid: 'IDD2', referrer_name: 'Michael Gorby', referrer_email: 'michael@example.com',
    referred_count: 2, first_referral_date: D('2023-01-01'), last_referral_date: D('2023-02-01'), total_aum_referred: '1e8' },
];
const kalcerDetail = [
  { referrer_sid: 'IDD1', referrer_name: 'Jessica Wijaya', invitee_sid: 'IDD9', invitee_name: 'Merissa',
    referral_date: D('2026-05-18'), invitee_aum: '2.07e8' },
];

// Email recap (Supabase RPC/PostgREST, plain JSON, no BigQuery wrappers).
// The subject is an HTML payload on purpose: it must come out escaped.
const XSS = '<img src=x onerror=alert(1)>';
const emailSummary = {
  totals: { sent: 12, failed: 1, recipients: 10, delivered: 11, opened: 6, clicked: 2, bounced: 1, complained: 0, opens: 9, clicks: 3 },
  by_category: [{ category: 'statement', sent: 10, failed: 1, delivered: 9, opened: 5, clicked: 0, bounced: 1, complained: 0 },
    { category: 'invite', sent: 2, failed: 0, delivered: 2, opened: 1, clicked: 2, bounced: 0, complained: 0 }],
  by_day: [{ day: '2026-10-01', sent: 7, failed: 0, delivered: 7, opened: 4, clicked: 1 }, { day: '2026-10-02', sent: 5, failed: 1, delivered: 4, opened: 2, clicked: 1 }],
  by_subject: [{ subject: XSS, category: 'statement', first_sent: '2026-10-01T01:00:00+00:00', last_sent: '2026-10-02T01:00:00+00:00', sent: 10, failed: 1, delivered: 9, opened: 5, clicked: 0, bounced: 1 }],
  top_links: [{ link: 'https://sayakaya.id/app', clicks: 3, emails: 2 }],
  tracking: { events: 20, last_event_at: '2026-10-02T03:00:00+00:00' },
};
const emailLog = { total: 1, rows: [{ id: '0b0b0b0b-0000-4000-8000-000000000001', created_at: '2026-10-02T01:00:00+00:00', recipient: 'a@b.c', subject: XSS,
  category: 'statement', source: 'schedule', description: 'Portfolio (current holdings)', sent_by: 'kukuh', outcome: 'opened',
  delivered_at: '2026-10-02T01:00:05+00:00', opened_at: '2026-10-02T02:00:00+00:00', open_count: 2, clicked_at: null, click_count: 0, error: null }] };
// User behavior (BigQuery rows, same wrappers as the other GA4 tabs)
const bhSegments = [
  { segment: 'holding', app_users: 791, avg_active_days: 6, avg_sessions: 8.5, avg_screen_views: 63.3, median_engaged_min: 4, buyers: 239, buyer_rate_pct: 30.2, buy_amount: 6664265797, sellers: 129, sell_amount: 6538119127 },
  { segment: 'not_verified', app_users: 140, avg_active_days: 2, avg_sessions: 1, avg_screen_views: 9, median_engaged_min: 0.2, buyers: 0, buyer_rate_pct: 0, buy_amount: 0, sellers: 0, sell_amount: 0 },
];
const bhDaily = [{ day: D('2026-09-08'), app_users: 247, holding_users: 208, buyers: 14 }];
const bhFeatures = [{ event_name: 'top_up_product_click', users: 64, buyers_7d: 56, buy_rate_pct: 87.5, baseline_pct: 13.4, lift: 6.52 }];
const bhPush = [{ campaign: XSS, first_seen: D('2026-09-08'), last_seen: D('2026-10-06'), received_users: 954, opened_users: 20, open_rate_pct: 2.1,
  opened_then_bought: 0, opened_buy_amount: 0, buyers_72h: 37, buy_rate_pct: 3.8, buy_amount_72h: 2209048136 }];
const bhProducts = [{ fund: 'Sucorinvest Maxi fund', fund_type: 'EQUITY', views: 393, viewers: 138, buyers_7d: 9, view_to_buy_pct: 6.5, buy_amount_7d: 57800000, viewers_holding_now: 24 }];
const bhIntent = [{ name: 'A', sid: 'IDD1', email: 'a@b.c', phone: '62812', verification_status: 'verified', last_try_wib: '2026-10-06 23:36',
  buy_sheet_opens: 1, orders_created: 1, order_statuses: 'no order created', last_fund_viewed: 'Pinnacle Money Market Fund', aum_now: '24520669', last_completed_buy: D('2026-08-29') }];
// Subscription analysis (shapes from live BigQuery, Sep 2026). Screen,
// event and payment-method names come from app payloads, hence XSS.
const saFunnel = [
  { split: 'all', segment: 'all', opened_form: 401, checkout: 331, payment_method: 324, ordered: 294, paid: 277, paid_pct: 69.1, median_min_to_order: 0.8, median_min_to_pay: 1 },
  { split: 'platform', segment: 'IOS', opened_form: 151, checkout: 133, payment_method: 131, ordered: 119, paid: 113, paid_pct: 74.8, median_min_to_order: 1.1, median_min_to_pay: 0.8 },
];
const saEntry = [
  { level: 'screen', came_from: XSS, before_that: null, opens: 825, users: 251, ordered_users: 163, paid_users: 155, paid_pct: 61.8 },
  { level: 'path', came_from: 'ProductDetailScreen', before_that: 'ProductListScreen', opens: 193, users: 106, ordered_users: 60, paid_users: 55, paid_pct: 51.9 },
];
const saDropoff = [
  { step: 1, exit_screen: null, sessions: 177, users: 125, paid_later_users: 19, paid_later_pct: 15.2 },
  { step: 1, exit_screen: XSS, sessions: 76, users: 67, paid_later_users: 11, paid_later_pct: 16.4 },
  { step: 3, exit_screen: null, sessions: 107, users: 75, paid_later_users: 25, paid_later_pct: 33.3 },
];
const saPayment = [{ method: XSS, orders: 154, users: 36, paid: 102, expired: 33, cancelled: 19, waiting: 0, paid_pct: 66.2, median_min_to_pay: 1,
  paid_amount: 334586996, lost_amount: 231584232, lost_users: 19, lost_then_paid_users: 6 }];
const saDrivers = [
  { kind: 'screen', name: XSS, in_flow: false, users: 642, converted: 214, population: 1124, population_converted: 239, rate_pct: 33.3, rate_without_pct: 9.2, lift: 3.61, share_of_converted_pct: 76.4 },
  { kind: 'action', name: 'order_button', in_flow: true, users: 295, converted: 277, population: 1124, population_converted: 239, rate_pct: 93.9, rate_without_pct: 0.3, lift: 332.09, share_of_converted_pct: 98.9 },
];
const saTimingSummary = { signed_up: 189, median_days_to_kyc: 0, median_days_kyc_to_buy: 1, median_days_to_buy: 2, median_sessions_before_buy: 3 };
const saTiming = [{ bucket: '1_same_day', verified: 53, first_buy: 4, ...saTimingSummary }, { bucket: '6_not_yet', verified: 86, first_buy: 161, ...saTimingSummary }];
const saHours = [{ dow: 1, hour: 9, sessions: 61, orders: 2, paid: 2 }, { dow: 2, hour: 22, sessions: 20, orders: 3, paid: 3 }, { dow: 2, hour: 1, sessions: 5, orders: 3, paid: 3 }];
const saProfile = [
  { dimension: 'age_band', value: '2_25_34', opened_form: 161, paid: 121, paid_pct: 75.2, paid_amount: 2118435831, median_paid_amount: 2238500 },
  { dimension: 'age_band', value: '4_45_54', opened_form: 47, paid: 30, paid_pct: 63.8, paid_amount: 321910000, median_paid_amount: 4000000 },
  { dimension: 'occupation', value: XSS, opened_form: 12, paid: 6, paid_pct: 50, paid_amount: 1000000, median_paid_amount: 100000 },
];
const anCoverage = [{ app_users: 1505, app_users_in_db: 1503, db_buys: 754, db_buys_in_app: 713, db_sells: 345, db_sells_in_app: 325, db_switches: 171, db_switches_in_app: 170, db_signups: 140, db_signups_in_app: 129 }];
// Onboarding, Redemption and Engagement analysis (shapes from live BigQuery, Sep 2026).
const obFunnel = [
  { segment: 'all', signed_up: 140, in_app: 129, kyc_intro: 123, ktp: 83, selfie: 82, personal: 83, occupation: 77, addr_step: 77, bank: 77, sign_step: 76, submitted: 75, verified: 74, failed: 9, risk_profiled: 52, first_buy: 13 },
  { segment: 'ANDROID', signed_up: 90, in_app: 90, kyc_intro: 89, ktp: 58, selfie: 57, personal: 58, occupation: 54, addr_step: 54, bank: 53, sign_step: 52, submitted: 51, verified: 43, failed: 8, risk_profiled: 31, first_buy: 8 },
  { segment: 'IOS', signed_up: 39, in_app: 39, kyc_intro: 34, ktp: 25, selfie: 25, personal: 25, occupation: 23, addr_step: 23, bank: 24, sign_step: 24, submitted: 24, verified: 26, failed: 0, risk_profiled: 17, first_buy: 4 },
];
const obOutcome = [
  { kind: 'outcome', name: '1_verified', users: 69, median_fill_min: 11.8, median_sessions: 1, median_review_hours: 0.9, bought_7d: 8, bought: 12, median_first_buy: 1000000, verified_now: null },
  { kind: 'outcome', name: '2_verified_after_fail', users: 5, median_fill_min: 7.7, median_sessions: 1, median_review_hours: 37.5, bought_7d: 1, bought: 1, median_first_buy: 1000000, verified_now: null },
  { kind: 'outcome', name: '3_failed', users: 9, median_fill_min: 13.2, median_sessions: 1, median_review_hours: 14.3, bought_7d: 0, bought: 0, median_first_buy: null, verified_now: null },
  { kind: 'rejected', name: 'IdentityRejectedScreen', users: 4, median_fill_min: null, median_sessions: null, median_review_hours: null, bought_7d: null, bought: null, median_first_buy: null, verified_now: 3 },
];
const rdFunnel = [
  { segment: 'all', step1: 190, step2: 171, step3: 165, done: 162, done_pct: 85.3, median_min_to_confirm: 0.3 },
  { segment: 'ANDROID', step1: 116, step2: 104, step3: 101, done: 100, done_pct: 86.2, median_min_to_confirm: 0.3 },
  { segment: 'IOS', step1: 74, step2: 67, step3: 64, done: 62, done_pct: 83.8, median_min_to_confirm: 0.2 },
];
const rdSwitching = [{ segment: 'all', step1: 78, step2: 73, step3: 50, step4: 47, done: 46, done_pct: 59, median_min_to_confirm: 0.7 }];
const rdProfile = [
  { dimension: 'all', value: 'all', sells: 345, people: 174, amount: 60326075601, full_pct: 46.7, median_held_days: 424, rebought_people: 56, left_people: 35, via_app: 325 },
  { dimension: 'held', value: '1_under_30d', sells: 37, people: 24, amount: 528522536, full_pct: 70.3, median_held_days: 9, rebought_people: 8, left_people: 12, via_app: 36 },
  { dimension: 'held', value: '5_over_1y', sells: 180, people: 95, amount: 4687737293, full_pct: 40.6, median_held_days: 978, rebought_people: 26, left_people: 13, via_app: 167 },
];
const rdSignals = [
  { kind: 'screen', name: XSS, in_flow: false, users: 320, converted: 146, population: 912, population_converted: 162, rate_pct: 45.6, rate_without_pct: 2.7, lift: 16.88, share_of_converted_pct: 90.1 },
  { kind: 'action', name: 'confirm_redeem_click', in_flow: true, users: 162, converted: 160, population: 912, population_converted: 162, rate_pct: 98.8, rate_without_pct: 0.3, lift: 370.37, share_of_converted_pct: 98.8 },
];
const egFeatures = [
  { feature: 'all', users: 1171, holders: 797, holder_pct: 68.1, median_aum: 5000000, buyers: 240, buyer_pct: 20.5, buy_amount: 6224118571, sellers: 164, seller_pct: 14 },
  { feature: 'search', users: 88, holders: 74, holder_pct: 84.1, median_aum: 12000000, buyers: 47, buyer_pct: 53.4, buy_amount: 1845135472, sellers: 26, seller_pct: 29.5 },
  { feature: 'calculators', users: 30, holders: 18, holder_pct: 60, median_aum: 3000000, buyers: 11, buyer_pct: 36.7, buy_amount: 26138658, sellers: 6, seller_pct: 20 },
];
const egActivity = [
  { aum_tier: '1_under_1m', activity: '0_none', holders: 231273, aum: 5998831974.7, bought: 1, sold: 0 },
  { aum_tier: '4_100m_1b', activity: '0_none', holders: 38, aum: 10375194078.1, bought: 0, sold: 4 },
  { aum_tier: '4_100m_1b', activity: '3_10_plus', holders: 57, aum: 19781234486.4, bought: 26, sold: 19 },
  { aum_tier: '3_10m_100m', activity: '1_1_2', holders: 89, aum: 3434702877.4, bought: 12, sold: 5 },
];
const egSearch = [{ term: XSS, searches: 9, users: 7, tapped_users: 6, bought_users: 2, bought_tapped_users: 1, top_tapped: XSS }];
const egDiscovery = [
  { kind: 'sort', value: 'highest_return / one_year', events: 39, users: 16, paid_users: 5, paid_pct: 31.3 },
  { kind: 'expert', value: XSS, events: 24, users: 16, paid_users: 3, paid_pct: 18.8 },
];
const saChips = [{ chip: 1000000, taps: 161, users: 89, paid_users: 61, paid_pct: 68.5, paid_chip_amount: 45, median_paid_amount: 1000000 }];

sandbox.api = async (path) => {
  if (path.startsWith('/api/user-lifetime/summary')) return summaryUL;
  if (path.startsWith('/api/user-lifetime/detail'))  return [];
  if (path.startsWith('/api/user-lifetime'))         return usersUL;
  if (path.startsWith('/api/campaign-revenue/campaigns')) return campaignsCR;
  if (path.startsWith('/api/campaign-revenue/summary'))   return summaryCR;
  if (path.startsWith('/api/campaign-revenue'))           return detailCR;
  if (path.startsWith('/api/referral-program-alt/detail')) return referralProgram;
  if (path.startsWith('/api/referral-program-alt/inviter-stats')) return referralInviterStats;
  if (path.startsWith('/api/referral-program-alt/invited')) return [];
  if (path.startsWith('/api/referral-program/detail'))    return referralProgram;
  if (path.startsWith('/api/referral-program/inviter-stats')) return referralInviterStats;
  if (path.startsWith('/api/referral-program/invited')) return [];
  if (path.startsWith('/api/overview')) {
    // The route 400s without aumDate in the real server (queries.js'
    // platformAumAsOf needs it) — assert the client always sends it, same
    // way the real one would reject a request that forgot to.
    if (!path.includes('aumDate=')) throw new Error('missing aumDate: ' + path);
    return overviewKpis;
  }
  if (path.startsWith('/api/trends'))                return overviewTrends;
  if (path.startsWith('/api/breakdown/'))             return overviewBreakdown;
  if (path.startsWith('/api/users/verification'))    return overviewVerification;
  if (path.startsWith('/api/funds/types'))            return overviewFundTypes;
  if (path.startsWith('/api/funds/list'))             return overviewFundList;
  if (path.startsWith('/api/funds/top/latest-date'))  return { latestDate: '2026-09-15' };
  if (path.startsWith('/api/funds/top'))              return overviewTopFunds;
  if (path.startsWith('/api/users/by-province'))      return overviewProvince;
  if (path.startsWith('/api/users/top-cities-aum'))   return overviewTopCitiesAum;
  if (path.startsWith('/api/users/top-cities'))       return overviewTopCities;
  if (path.startsWith('/api/aum-history/drill?start=2026-08-01&end=')) return aumDrill;
  if (path.startsWith('/api/aum-history'))            return aumHistory;
  if (path.startsWith('/api/revenue-trend/drill'))    return revenueTrendDrill;
  if (path.startsWith('/api/revenue-trend'))          return revenueTrend;
  if (path.startsWith('/api/top-investors?') && path.includes('from=') && path.includes('to=')) return topInvestors;
  if (path.startsWith('/api/dormant/conversion-summary')) return dormantConversionSummary;
  if (path.startsWith('/api/dormant/repeat-buyers'))      return dormantRepeatBuyers;
  if (path.startsWith('/api/dormant/time-to-convert'))    return dormantTimeToConvert;
  if (path.startsWith('/api/kalcer/latest-date'))          return { latestDate: '2026-09-30' };
  if (path.startsWith('/api/kalcer/summary'))              return kalcerSummary;
  if (path.startsWith('/api/kalcer/detail'))               return kalcerDetail;
  if (path.startsWith('/api/push/trend'))                 return pushTrend;
  if (path.startsWith('/api/push/by-platform'))            return pushByPlatform;
  if (path.startsWith('/api/push/by-campaign'))            return pushByCampaign;
  if (path.startsWith('/api/marketing/funnel'))            return marketingFunnel;
  if (path.startsWith('/api/app-health/crashes'))          return appCrashIssues;
  if (path.startsWith('/api/app-health/performance'))      return appPerfTraces;
  if (path.startsWith('/api/product-funnel'))              return productFunnel;
  if (path.startsWith('/api/email-recap/summary'))         return emailSummary;
  if (path.startsWith('/api/email-recap/log'))             return emailLog;
  if (path.startsWith('/api/behavior/segments'))           return bhSegments;
  if (path.startsWith('/api/behavior/daily'))              return bhDaily;
  if (path.startsWith('/api/behavior/features'))           return bhFeatures;
  if (path.startsWith('/api/behavior/push'))               return bhPush;
  if (path.startsWith('/api/behavior/products'))           return bhProducts;
  if (path.startsWith('/api/behavior/intent'))             return bhIntent;
  if (path.startsWith('/api/subscription/funnel'))         return saFunnel;
  if (path.startsWith('/api/subscription/entry'))          return saEntry;
  if (path.startsWith('/api/subscription/dropoff'))        return saDropoff;
  if (path.startsWith('/api/subscription/payment'))        return saPayment;
  if (path.startsWith('/api/subscription/drivers'))        return saDrivers;
  if (path.startsWith('/api/subscription/timing'))         return saTiming;
  if (path.startsWith('/api/subscription/hours'))          return saHours;
  if (path.startsWith('/api/subscription/chips'))          return saChips;
  if (path.startsWith('/api/subscription/profile'))        return saProfile;
  if (path.startsWith('/api/analysis/coverage'))           return anCoverage;
  if (path.startsWith('/api/onboarding/funnel'))           return obFunnel;
  if (path.startsWith('/api/onboarding/outcome'))          return obOutcome;
  if (path.startsWith('/api/redemption/funnel'))           return rdFunnel;
  if (path.startsWith('/api/redemption/switching'))        return rdSwitching;
  if (path.startsWith('/api/redemption/profile'))          return rdProfile;
  if (path.startsWith('/api/redemption/signals'))          return rdSignals;
  if (path.startsWith('/api/engagement/features'))         return egFeatures;
  if (path.startsWith('/api/engagement/activity'))         return egActivity;
  if (path.startsWith('/api/engagement/search'))           return egSearch;
  if (path.startsWith('/api/engagement/discovery'))        return egDiscovery;
  throw new Error('unexpected path ' + path);
};

(async () => {
  for (const fn of ['loadUserLifetime', 'loadCampaignRevenue', 'loadReferralProgram', 'loadReferralProgramAlt', 'loadOverview', 'loadAumHistory', 'loadRevenueTrend', 'loadTopInvestors', 'loadDormant', 'loadKalcer', 'loadPush', 'loadMarketing', 'loadAppHealth', 'loadProductFunnel', 'loadEmailRecap', 'loadBehavior', 'loadSubscription', 'loadOnboarding', 'loadRedemption', 'loadEngagement']) {
    if (typeof sandbox[fn] !== 'function') { errors.push(`${fn} is not defined`); continue; }
    try { await sandbox[fn](); } catch (e) { errors.push(`${fn}: ${e.message}`); }
  }
  try { await sandbox.loadAumDrill('2026-08'); } catch (e) { errors.push(`loadAumDrill: ${e.message}`); }
  // The loaders swallow exceptions into the table div, so "did it throw?" is
  // not enough — assert each target actually became a <table>.
  for (const sel of ['#ulUsersTable', '#ulSummaryTable', '#crCampaignsTable', '#crDetailTable', '#crSummaryTable', '#refProgTable', '#refProgLeaderboardTable', '#refProgAltTable', '#refProgAltLeaderboardTable', '#aumTable', '#revTrendTable', '#aumDrillTable', '#tiTable', '#topFunds', '#dwConversionTable', '#dwRepeatTable', '#dwTtcTable', '#kalcerSummaryTable', '#kalcerDetailTable', '#pushPlatformTable', '#pushCampaignTable', '#mktTable', '#ahCrashTable', '#ahPerfTable', '#pfnTable', '#erCategoryTable', '#erSubjectTable', '#erLinksTable', '#erLogTable', '#bhSegmentTable', '#bhFeatureTable', '#bhPushTable', '#bhProductTable', '#bhIntentTable', '#saFunnelTable', '#saEntryTable', '#saDropTable', '#saPayTable', '#saDriverTable', '#saChipTable', '#saProfileTable', '#obFunnelTable', '#obOutcomeTable', '#obRejectedTable', '#rdFunnelTable', '#rdProfileTable', '#rdSignalTable', '#rdSwitchTable', '#egFeatureTable', '#egActivityTable', '#egSearchTable', '#egDiscoveryTable']) {
    const html = get(sel)._html;
    if (html.includes('<table')) { console.log(`ok    ${sel}`); continue; }
    const why = html.replace(/<[^>]*>/g, '').trim() || '(never rendered)';
    console.log(`FAIL  ${sel} -> ${why}`);
    errors.push(`${sel} did not render a table: ${why}`);
  }
  // Overview KPI grid is cards, not a table — just check it rendered.
  const kpisHtml = get('#kpis')._html;
  if (kpisHtml.includes('kpi-value')) {
    console.log('ok    #kpis');
  } else {
    console.log(`FAIL  #kpis -> ${kpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#kpis did not render KPI cards');
  }
  const dwKpisHtml = get('#dwKpis')._html;
  if (dwKpisHtml.includes('kpi-value')) {
    console.log('ok    #dwKpis');
  } else {
    console.log(`FAIL  #dwKpis -> ${dwKpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#dwKpis did not render KPI cards');
  }
  const kalcerKpisHtml = get('#kalcerKpis')._html;
  if (kalcerKpisHtml.includes('kpi-value')) {
    console.log('ok    #kalcerKpis');
  } else {
    console.log(`FAIL  #kalcerKpis -> ${kalcerKpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#kalcerKpis did not render KPI cards');
  }
  const pushKpisHtml = get('#pushKpis')._html;
  if (pushKpisHtml.includes('kpi-value')) {
    console.log('ok    #pushKpis');
  } else {
    console.log(`FAIL  #pushKpis -> ${pushKpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#pushKpis did not render KPI cards');
  }
  const mktKpisHtml = get('#mktKpis')._html;
  if (mktKpisHtml.includes('kpi-value')) {
    console.log('ok    #mktKpis');
  } else {
    console.log(`FAIL  #mktKpis -> ${mktKpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#mktKpis did not render KPI cards');
  }
  const ahKpisHtml = get('#ahKpis')._html;
  if (ahKpisHtml.includes('kpi-value')) {
    console.log('ok    #ahKpis');
  } else {
    console.log(`FAIL  #ahKpis -> ${ahKpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#ahKpis did not render KPI cards');
  }
  const pfnKpisHtml = get('#pfnKpis')._html;
  if (pfnKpisHtml.includes('kpi-value')) {
    console.log('ok    #pfnKpis');
  } else {
    console.log(`FAIL  #pfnKpis -> ${pfnKpisHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#pfnKpis did not render KPI cards');
  }
  for (const sel of ['#erKpis', '#bhKpis', '#saKpis', '#obKpis', '#rdKpis', '#egKpis']) {
    if (get(sel)._html.includes('kpi-value')) console.log(`ok    ${sel}`);
    else errors.push(`${sel} did not render KPI cards`);
  }
  // Email subjects and push campaign names are typed by people; genTable
  // writes raw HTML, so the new tabs escape them first.
  for (const sel of ['#erSubjectTable', '#erLogTable', '#bhPushTable', '#saEntryTable', '#saDropTable', '#saPayTable', '#saDriverTable', '#saProfileTable',
    '#rdSignalTable', '#egSearchTable', '#egDiscoveryTable', '#saEntryStory', '#saDropStory', '#saPayStory', '#saDriverStory', '#saProfileStory', '#rdSignalStory', '#egSearchStory', '#egDiscoveryStory']) {
    if (get(sel)._html.includes(XSS)) errors.push(`${sel} rendered unescaped HTML`);
    else console.log(`ok    ${sel} escapes HTML`);
  }
  // Subscription analysis: all four KPI cards (funnel + payment), buy-flow
  // steps hidden from Drivers until ticked, one drop-off button per step,
  // and the sign-up timing line filled from the repeated medians.
  for (const [ok, label] of [
    [(get('#saKpis')._html.match(/kpi-value/g) || []).length === 4, '#saKpis has 4 cards'],
    [!get('#saDriverTable')._html.includes('order_button'), '#saDriverTable hides buy-flow steps'],
    [get('#saDropStep')._html.includes('data-step="1"') && get('#saDropStep')._html.includes('data-step="3"'), '#saDropStep has a button per step'],
    [get('#saTimingSummary')._html.includes('189 '), '#saTimingSummary filled'],
    [get('#saCoverage')._html.includes('99.9%') && get('#saCoverage')._html.includes('94.6%'), '#saCoverage shows how GA4 matches the database'],
    [get('#saFunnelStory')._html.includes('401') && get('#saFunnelStory')._html.includes('69.1%'), '#saFunnelStory written from the funnel rows'],
    [get('#obFunnelStory')._html.includes('140') && get('#obFunnelStory')._html.includes('13 (9.3%)'), '#obFunnelStory written from the onboarding rows'],
    [get('#obOutcomeStory')._html.includes('69'), '#obOutcomeStory filled'],
    [get('#saHoursStory')._html.includes('22:00 to 01:59') && get('#saHoursStory')._html.includes('75%'), '#saHoursStory picks the busiest 4 hours from the data, across midnight'],
    [get('#rdFunnelStory')._html.includes('162 (85.3%)'), '#rdFunnelStory written from the sell funnel'],
    [get('#rdProfileStory')._html.includes('345'), '#rdProfileStory filled'],
    [get('#rdSignalStory')._html.includes('16.9'), '#rdSignalStory names the top signal'],
    [!get('#rdSignalTable')._html.includes('confirm_redeem_click'), '#rdSignalTable hides sell-flow steps'],
    [get('#egActivityStory')._html.includes('38'), '#egActivityStory filled'],
    [get('#egActivityTable')._html.includes('231,273'), '#egActivityTable pivots tiers by app use'],
    [get('#egFeatureStory')._html.includes('1,171'), '#egFeatureStory written from the feature rows'],
  ]) {
    if (ok) console.log(`ok    ${label}`);
    else { console.log(`FAIL  ${label}`); errors.push(label); }
  }
  // Platform AUM's own "as of" date input should default to the latest
  // available date from /api/funds/top/latest-date, same as #topFundsDate.
  const aumDateVal = get('#ovAumDate').value;
  if (aumDateVal === '2026-09-15') {
    console.log('ok    #ovAumDate defaulted');
  } else {
    console.log(`FAIL  #ovAumDate -> ${aumDateVal || '(empty)'}`);
    errors.push('#ovAumDate did not default to the latest available date');
  }
  // Fund-filter dropdown checklist, populated from /api/funds/list.
  const fundListHtml = get('#ovFundFilterList')._html;
  if (fundListHtml.includes('Sucorinvest Money Market Fund')) {
    console.log('ok    #ovFundFilterList');
  } else {
    console.log(`FAIL  #ovFundFilterList -> ${fundListHtml.slice(0, 200) || '(never rendered)'}`);
    errors.push('#ovFundFilterList did not render the fund checklist');
  }
  // Root-cause columns and the % of total share actually reach the page.
  // Total rows: SQL-provided for Largest funds, summed for genTable/AUM history.
  const foot = (sel) => (get(sel)._html.match(/<tfoot>([\s\S]*?)<\/tfoot>/) || [])[1] || '';
  for (const [sel, needle] of [['#topFunds', '3,100'], ['#topFunds', '100.0%'], ['#aumTable', 'Rp 154.000.000.000'], ['#revTrendTable', 'Rp 64.706.348'], ['#aumDrillTable', 'Rp 8.700.000.000'], ['#tiTable', '37.6%']]) {
    if (foot(sel).includes(needle)) { console.log(`ok    ${sel} total row has ${needle}`); continue; }
    console.log(`FAIL  ${sel} total row missing ${needle}: ${foot(sel).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
    errors.push(`${sel} total row missing ${needle}`);
  }
  if (get('#ovFundFilterList')._html.includes('>Total<') || get('#topFundsExcludeList')._html.includes('value="Total"')) errors.push('Total row leaked into a fund picker');
  for (const [sel, needle] of [['#revTrendTable', '+8.2%'], ['#tiCompactTable', 'Net increase'], ['#tiCompactTable', 'data-sort="buys"'], ['#aumTable', 'data-bucket="2026-08"'], ['#aumTable', '<button type="button" class="link-btn mono"'], ['#topFunds', '66.8%'], ['#tiTable', '37.6%']]) {
    if (get(sel)._html.includes(needle)) { console.log(`ok    ${sel} has ${needle}`); continue; }
    console.log(`FAIL  ${sel} missing ${needle}`);
    errors.push(`${sel} is missing ${needle}`);
  }
  // Two sections once shared #revTrendFinding/#revTrendChart; $() hit the first, so one tab painted into the other.
  const ids = (fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').match(/ id="[^"]+"/g) || []);
  const dups = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  if (dups.length) errors.push(`duplicate element ids in index.html:${dups.join('')}`);
  else console.log('ok    index.html has no duplicate ids');

  if (errors.length) { console.log(`\n${errors.length} failure(s):\n` + errors.join('\n')); process.exit(1); }
  console.log('\nAll section loaders rendered.');
})();
