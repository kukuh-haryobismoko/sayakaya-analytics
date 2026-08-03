'use strict';

// ---------- tiny helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const AUTH_KEY = 'sk_auth'; // { token, user: { id, username, isSuperuser, allowedTabs } }

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}
function setAuth(auth) { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
// Also resets the language back to English — a shared/kiosk computer
// shouldn't hand the next person to log in whatever language the last
// person happened to leave it on. Still persists normally for as long as
// the current session stays logged in (reloads, other tabs).
function clearAuth() { localStorage.removeItem(AUTH_KEY); resetLangToDefault(); }

// On Netlify this is served same-origin, so relative /api/* paths just work.
// GitHub Pages is static-only — it can't run a backend — so this mirror calls
// the Supabase Edge Function instead (supabase/functions/api/, project ref
// josptpfisrsdjeggkqke). The function is deliberately named "api" so that the
// "/api/..." paths this file already calls (e.g. api('/api/overview')) double
// as both the Supabase function-name segment AND the path the function's own
// router expects — no extra rewrite needed. See SUPABASE-DEPLOY.md.
const API_BASE = location.hostname.endsWith('.github.io') ? 'https://josptpfisrsdjeggkqke.supabase.co/functions/v1' : '';

function authHeaders() {
  const auth = getAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    clearAuth();
    showGate();
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

const idr = (n) => {
  if (n == null) return '—';
  return 'Rp ' + new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(n));
};
const idrFull = (n) => (n == null ? '—' : 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n))));
const idrExact = (n) => (n == null ? '—' : 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n)));
const num = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US').format(Number(n)));
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function val(x) { return x && typeof x === 'object' && 'value' in x ? x.value : x; }

// ---------- date range ----------
function isoDate(d) { return d.toISOString().slice(0, 10); }
function defaultRange() {
  const to = new Date();
  const from = new Date(); from.setMonth(from.getMonth() - 12);
  return { from: isoDate(from), to: isoDate(to) };
}
function currentRange() { return { from: $('#from').value, to: $('#to').value }; }

// Revenue tabs have their own date-range pickers, independent of the
// day-range pickers used everywhere else — plus wildcard fund/MI filters.
function revRange() {
  return { from: $('#revFrom').value, to: $('#revTo').value, fund: $('#revFund').value.trim(), mi: $('#revMi').value.trim() };
}
function rev2Range() {
  return { from: $('#rev2From').value, to: $('#rev2To').value, fund: $('#rev2Fund').value.trim(), mi: $('#rev2Mi').value.trim() };
}

// ---------- chart palette (theme-aware: read from CSS custom properties) ----------
function readThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    indigo: v('--indigo'), soft: v('--indigo-soft'), amber: v('--amber'),
    teal: v('--teal'), rose: v('--rose'), muted: v('--muted'),
    grid: v('--line'), surface: v('--surface'), heatRgb: v('--heat-rgb'),
  };
}
let C = readThemeColors();
const pie = () => [C.indigo, C.amber, C.teal, C.rose, C.soft, '#9aa3bd', '#c9a06a', '#7fbfa6'];
const charts = {};
function paint(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($('#' + id), config);
}
function applyChartDefaults() {
  Chart.defaults.font.family = 'Inter, sans-serif';
  Chart.defaults.color = C.muted;
}
applyChartDefaults();

// ====================================================================
//  USER PORTFOLIO (search by SID, print one investor's holdings)
// ====================================================================
async function searchPortfolioUsers() {
  const q = $('#pfSearchInput').value.trim();
  if (!q) return;
  $('#pfResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPfResults(rows);
  } catch (e) { $('#pfResults').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPfResults(rows) {
  if (!rows.length) { $('#pfResults').innerHTML = '<div class="empty">No matching investor.</div>'; return; }
  const body = rows.map((r) => `<tr class="pf-row" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${val(r.name) || ''}" data-email="${val(r.email) || ''}" style="cursor:pointer">
      <td>${val(r.sid) || '—'}</td><td>${val(r.name) || '—'}</td><td>${val(r.email) || '—'}</td><td>${val(r.ifua) || '—'}</td>
    </tr>`).join('');
  $('#pfResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#pfResults .pf-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPortfolioUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
}

let pfSelected = null; // { userId, sid, name, date } — used by the export buttons

// New user picked from search results — resets the date filter to live.
async function selectPortfolioUser(userId, sid, name, email) {
  pfSelected = { userId, sid, name: name || sid, date: '' };
  $('#pfDetail').classList.remove('hidden');
  $('#pfUserName').textContent = name || sid;
  $('#pfUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#pfDate').value = '';
  await loadPortfolioUser();
}

// Fetches/renders for the currently selected user + whatever date is in the
// picker — used both by selectPortfolioUser above and by the "Go" button, and
// by repaintActiveTab (theme toggle) so a toggle doesn't reset the date back to live.
async function loadPortfolioUser() {
  if (!pfSelected) return;
  const { userId, sid } = pfSelected;
  const dateVal = $('#pfDate').value;
  $('#pfKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#pfHoldings').innerHTML = '';
  $('#pfPerformance').innerHTML = '';
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, asOfDate, latestDate } = await api(`/api/portfolio?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    pfSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate), latest = val(latestDate);
    $('#pfSnapshotInfo').textContent = asOf
      ? `Snapshot date: ${asOf}${latest && latest !== asOf ? ` (latest available: ${latest})` : ''} — from mi_fee_logs.portfolio_with_code.`
      : `Live holdings (current units × today's NAV).${latest ? ` Latest historical snapshot available: ${latest}.` : ''}`;
    renderPfKpis(holdings, split);
    renderPfHoldings(holdings);
    renderPfPerformance(performance);
    renderPfAumChart(history);
  } catch (e) { $('#pfKpis').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPfAumChart(rows) {
  if (!rows.length) { return; }
  paint('pfAumChart', {
    type: 'line',
    data: {
      labels: rows.map((d) => val(d.bucket)),
      datasets: [{ label: 'AUM', data: rows.map((d) => Number(val(d.amount))),
        borderColor: C.indigo, backgroundColor: 'rgba(30,42,74,.08)', fill: true, tension: .3, pointRadius: 0 }],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { y: { grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => idrFull(c.raw) } } },
    },
  });
}

function renderPfKpis(holdings, split) {
  const totalAum = holdings.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  // split is null in "as of date" mode — portfolios/bonus_portfolios only
  // have a live split, not a historical one, so there's nothing real to show.
  $('#pfKpis').innerHTML = [
    kpi(t('kpi_total_aum'), idrFull(totalAum), t('kpi_holding_count').replace('{n}', holdings.length).replace('{s}', holdings.length === 1 ? '' : 's'), 'accent'),
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : '—', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : '—', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

// Shared by the Portfolio tab and Portfolio Explorer — both feed rows of the
// same shape (fund, fund_type, unit, avg_buy_price, nav, value, ...).
function holdingsTableHtml(rows) {
  const gl = (v) => {
    if (v == null) return '<td class="num">—</td>';
    const n = Number(v);
    return `<td class="num"><span style="color:${n >= 0 ? 'var(--teal)' : 'var(--rose)'}">${idrFull(n)}</span></td>`;
  };
  const glPct = (v) => {
    if (v == null) return '<td class="num">—</td>';
    const n = Number(v);
    return `<td class="num"><span style="color:${n >= 0 ? 'var(--teal)' : 'var(--rose)'}">${n >= 0 ? '+' : ''}${n.toFixed(2)}%</span></td>`;
  };
  const body = rows.map((h) => {
    // Derived client-side so the table works regardless of API version:
    // fund value = units x avg buy NAV; gain = market - fund value.
    const avg = h.avg_buy_price == null ? null : Number(val(h.avg_buy_price));
    const market = Number(val(h.value));
    const fundValue = avg == null ? null : Math.round(Number(val(h.unit)) * avg);
    const gain = fundValue == null ? null : market - fundValue;
    const pct = fundValue ? (gain / fundValue) * 100 : null;
    return `<tr>
      <td>${val(h.fund)}</td>
      <td><span class="tag other">${val(h.fund_type)}</span></td>
      <td class="num">${Number(val(h.unit)).toFixed(4)}</td>
      <td class="num">${avg == null ? '—' : num(avg)}</td>
      <td class="num">${num(val(h.nav))}</td>
      <td class="num">${fundValue == null ? '—' : idrFull(fundValue)}</td>
      <td class="num">${idrFull(market)}</td>
      ${gl(gain)}
      ${glPct(pct)}
    </tr>`;
  }).join('');
  return `<table><thead><tr>
      <th>Fund</th><th>Type</th><th class="num">Unit Balance</th><th class="num">Average NAV</th><th class="num">Close NAV</th><th class="num">Fund Value</th><th class="num">Market Value</th><th class="num">Unrealized G/L</th><th class="num">%</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function renderPfHoldings(rows) {
  if (!rows.length) { $('#pfHoldings').innerHTML = '<div class="empty">No active holdings.</div>'; return; }
  $('#pfHoldings').innerHTML = holdingsTableHtml(rows);
}

function renderPfPerformance(rows) {
  if (!rows.length) { $('#pfPerformance').innerHTML = '<div class="empty">No AUM history for this SID.</div>'; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">—</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#pfPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// ====================================================================
//  PORTFOLIO EXPLORER (goal_snapshots — point-in-time holdings by date,
//  merged by fund and also broken out by goal for the preview only)
// ====================================================================
async function searchExplorerUsers() {
  const q = $('#peSearchInput').value.trim();
  if (!q) return;
  $('#peResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPeResults(rows);
  } catch (e) { $('#peResults').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPeResults(rows) {
  if (!rows.length) { $('#peResults').innerHTML = '<div class="empty">No matching investor.</div>'; return; }
  const body = rows.map((r) => `<tr class="pe-row" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${val(r.name) || ''}" data-email="${val(r.email) || ''}" style="cursor:pointer">
      <td>${val(r.sid) || '—'}</td><td>${val(r.name) || '—'}</td><td>${val(r.email) || '—'}</td><td>${val(r.ifua) || '—'}</td>
    </tr>`).join('');
  $('#peResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#peResults .pe-row').forEach((tr) => tr.addEventListener('click', () =>
    selectExplorerUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
}

let peSelected = null; // { userId, sid, name, date } — used by the export buttons

async function selectExplorerUser(userId, sid, name, email) {
  peSelected = { userId, sid, name: name || sid, date: '' };
  $('#peDetail').classList.remove('hidden');
  $('#peUserName').textContent = name || sid;
  $('#peUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#peSnapshotInfo').textContent = '';
  $('#peKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#peHoldings').innerHTML = '';
  $('#peByGoal').innerHTML = '';
  await loadExplorerPortfolio();
}

async function loadExplorerPortfolio() {
  if (!peSelected) return;
  const dateParam = $('#peDate').value ? `&date=${$('#peDate').value}` : '';
  try {
    const { asOfDate, latestDate, holdings, byGoal } = await api(`/api/portfolio-explorer?userId=${encodeURIComponent(peSelected.userId)}&sid=${encodeURIComponent(peSelected.sid)}${dateParam}`);
    const asOf = val(asOfDate), latest = val(latestDate);
    peSelected.date = asOf || '';
    $('#peDate').value = asOf || '';
    $('#peSnapshotInfo').textContent = asOf
      ? `Snapshot date: ${asOf}${latest && latest !== asOf ? ` (latest available: ${latest})` : ''}`
      : (latest ? `No snapshot for this date. Latest available: ${latest}` : 'No goal_snapshots found for this user.');
    renderPeKpis(holdings, byGoal);
    renderPeHoldings(holdings);
    renderPeByGoal(byGoal);
  } catch (e) { $('#peKpis').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPeKpis(holdings, byGoal) {
  const totalAum = holdings.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  const goalCount = new Set(byGoal.map((r) => val(r.goal))).size;
  $('#peKpis').innerHTML = [
    kpi(t('kpi_total_aum_as_of'), idrFull(totalAum), t('kpi_holding_count').replace('{n}', holdings.length).replace('{s}', holdings.length === 1 ? '' : 's'), 'accent'),
    kpi(t('kpi_goals'), num(goalCount), 'goal_snapshots (main.goals)'),
  ].join('');
}

function renderPeHoldings(rows) {
  if (!rows.length) { $('#peHoldings').innerHTML = '<div class="empty">No holdings for this date.</div>'; return; }
  $('#peHoldings').innerHTML = holdingsTableHtml(rows);
}

// Preview-only breakdown: one mini table per goal, headed by the goal's name.
// Exports never use this grouping — they always use the merged holdings above.
function renderPeByGoal(rows) {
  if (!rows.length) { $('#peByGoal').innerHTML = '<div class="empty">No goals with holdings for this date.</div>'; return; }
  const byGoal = new Map();
  rows.forEach((r) => {
    const name = val(r.goal) || '(unnamed goal)';
    if (!byGoal.has(name)) byGoal.set(name, []);
    byGoal.get(name).push(r);
  });
  $('#peByGoal').innerHTML = Array.from(byGoal.entries()).map(([name, goalRows]) => {
    const total = goalRows.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
    return `<div class="panel" style="margin-top:12px">
        <div class="panel-head"><h3 style="margin:0">${name}</h3><span class="hint">${idrFull(total)}</span></div>
        <div class="table-wrap">${holdingsTableHtml(goalRows)}</div>
      </div>`;
  }).join('');
}

// ====================================================================
//  HNWI (High Net Worth Individual) — investors at/above an AUM threshold,
//  as of a date, from portfolio_with_code (mirrors Portfolio's -1 day
//  correction: created_at is a day ahead of the AUM date it represents).
// ====================================================================
let hnwiDateDefaulted = false;
function hnwiParams() {
  return { date: $('#hnwiDate').value, minAum: $('#hnwiMinAum').value || 0 };
}
const HNWI_CONTACT_COLS = [
  { key: 'name', label: 'Name' }, { key: 'sid_code', label: 'SID code' }, { key: 'ifua', label: 'IFUA code' },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'birthdate', label: 'Birthdate', type: 'date' },
];
async function loadHnwi() {
  if (!hnwiDateDefaulted) {
    hnwiDateDefaulted = true;
    try {
      const { latestDate } = await api('/api/hnwi/latest-date');
      if (latestDate && !$('#hnwiDate').value) $('#hnwiDate').value = val(latestDate);
    } catch { /* leave blank — user can still pick a date manually */ }
  }
  if (!$('#hnwiDate').value) {
    $('#hnwiTotalTable').innerHTML = '<div class="empty">Pick a date.</div>';
    $('#hnwiByFundTable').innerHTML = '';
    return;
  }
  const p = hnwiParams();
  $('#hnwiTotalTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#hnwiByFundTable').innerHTML = '<div class="loading">Loading…</div>';
  const qs = `date=${p.date}&minAum=${p.minAum}`;
  try {
    const [totals, byFund] = await Promise.all([
      api(`/api/hnwi/total?${qs}`),
      api(`/api/hnwi/by-fund?${qs}`),
    ]);
    genTable('#hnwiTotalTable', totals, [
      ...HNWI_CONTACT_COLS,
      { key: 'total_aum', label: 'Total AUM', type: 'idr' }, { key: 'aum_date', label: 'AUM date', type: 'date' },
    ], 'No investors at or above this AUM threshold.');
    genTable('#hnwiByFundTable', byFund, [
      ...HNWI_CONTACT_COLS,
      { key: 'fund_name', label: 'Fund' }, { key: 'fund_aum', label: 'Fund AUM', type: 'idr' },
      { key: 'aum_date', label: 'AUM date', type: 'date' }, { key: 'total_aum', label: 'Total AUM', type: 'idr' },
    ], 'No investors at or above this AUM threshold.');
  } catch (e) {
    $('#hnwiTotalTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#hnwiByFundTable').innerHTML = '';
  }
}

// ====================================================================
//  OVERVIEW
// ====================================================================
let overviewLoaded = false;
async function loadOverview() {
  overviewLoaded = true;
  const r = currentRange();
  const qs = `?from=${r.from}&to=${r.to}`;
  $('#kpis').innerHTML = '<div class="loading">Loading metrics…</div>';

  try {
    const o = await api('/api/overview' + qs);
    renderKpis(o);
  } catch (e) { $('#kpis').innerHTML = `<div class="empty">${e.message}</div>`; }

  loadTrends($('.seg button.on', )?.dataset.g || 'month');

  // breakdown + funds + users, each independent
  api('/api/breakdown/type' + qs).then(renderTypeChart).catch(() => {});
  api('/api/breakdown/status' + qs).then(renderStatusChart).catch(() => {});
  api('/api/users/verification').then(renderVerifyChart).catch(() => {});
  api('/api/funds/types').then(renderFundTypeChart).catch(() => {});
  api('/api/funds/top?limit=10').then(renderTopFunds).catch(() => {});
  api('/api/users/by-province').then(renderGeoChart).catch(() => {});
  api('/api/users/top-cities?limit=15').then(renderTopCities).catch(() => {});
  api('/api/users/top-cities-aum?limit=15').then(renderTopCitiesAum).catch(() => {});
}

// ---- Investor distribution map (chartjs-chart-geo choropleth) -------------
// Registered once — the plugin script (loaded via CDN, see index.html) attaches
// its controllers to the shared Chart global but doesn't auto-register them.
let geoControllersRegistered = false;
function ensureGeoControllers() {
  if (geoControllersRegistered) return;
  Chart.register(ChartGeo.ChoroplethController, ChartGeo.GeoFeature, ChartGeo.ColorScale, ChartGeo.ProjectionScale);
  geoControllersRegistered = true;
}

// Fetched once and cached — see public/data/README.md for what this file is
// and the winding-order gotcha if it's ever regenerated.
let indonesiaGeoJson = null;
function loadIndonesiaGeoJson() {
  if (indonesiaGeoJson) return Promise.resolve(indonesiaGeoJson);
  return fetch('data/indonesia-provinces.json').then((r) => r.json()).then((d) => (indonesiaGeoJson = d));
}

// Sequential OPAQUE tint from a pale neutral up to the app's own indigo accent.
// Deliberately opaque (not rgba alpha-blended over the panel background) —
// an alpha-based fill picks up whatever's behind it, which is exactly why the
// zero-investor provinces used to nearly vanish in dark mode (a faint tint
// over a dark panel reads as "nothing"). Opaque colors look identical in
// both themes since there's nothing behind them to blend with.
function geoColor(t) {
  const hex = (C.indigo || '#3a50ab').replace('#', '');
  const r2 = parseInt(hex.slice(0, 2), 16), g2 = parseInt(hex.slice(2, 4), 16), b2 = parseInt(hex.slice(4, 6), 16);
  const r1 = 223, g1 = 227, b1 = 240; // pale indigo-tinted gray — the "0" end, still visible as a shape
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

async function renderGeoChart(rows) {
  ensureGeoControllers();
  let geo;
  try { geo = await loadIndonesiaGeoJson(); } catch { return; }
  const byProvince = {};
  (rows || []).forEach((r) => {
    byProvince[val(r.province_name)] = { investors: Number(val(r.investor_count)) || 0, aum: Number(val(r.total_aum)) || 0 };
  });
  paint('geoChart', {
    type: 'choropleth',
    data: {
      labels: geo.features.map((f) => f.properties.province_name),
      datasets: [{
        label: 'Investors',
        outline: geo,
        // Fixed, opaque, theme-independent border — province boundaries stay
        // legible regardless of fill color or light/dark mode.
        borderColor: '#7c8aa5',
        borderWidth: 1,
        data: geo.features.map((f) => {
          const d = byProvince[f.properties.province_name];
          return { feature: f, value: d ? d.investors : 0, aum: d ? d.aum : 0 };
        }),
      }],
    },
    options: {
      maintainAspectRatio: false,
      showOutline: false,
      showGraticule: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => [`${c.raw.feature.properties.province_name}`,
              `${num(c.raw.value)} investors`, `AUM ${idrFull(c.raw.aum)}`],
          },
        },
      },
      scales: {
        projection: { axis: 'x', projection: 'mercator' },
        color: { axis: 'x', quantize: 5, interpolate: geoColor, legend: { position: 'bottom-right', align: 'right' } },
      },
    },
  });
}

function renderTopCities(rows) {
  if (!rows.length) { $('#topCitiesTable').innerHTML = '<div class="empty">No data.</div>'; return; }
  const body = rows.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${val(r.city_name)}</td>
      <td>${val(r.province_name)}</td>
      <td class="num">${num(val(r.investor_count))}</td>
    </tr>`).join('');
  $('#topCitiesTable').innerHTML = `<table><thead><tr>
      <th></th><th>City</th><th>Province</th><th class="num">Investors</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function renderTopCitiesAum(rows) {
  if (!rows.length) { $('#topCitiesAumTable').innerHTML = '<div class="empty">No data.</div>'; return; }
  const body = rows.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${val(r.city_name)}</td>
      <td>${val(r.province_name)}</td>
      <td class="num">${idrFull(val(r.total_aum))}</td>
    </tr>`).join('');
  $('#topCitiesAumTable').innerHTML = `<table><thead><tr>
      <th></th><th>City</th><th>Province</th><th class="num">AUM</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function kpi(label, value, sub, cls = '', icon = '') {
  return `<div class="kpi ${cls}">${icon ? `<span class="kpi-icon">${icon}</span>` : ''}<div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div><div class="kpi-sub">${sub || ''}</div></div>`;
}
function renderKpis(o) {
  $('#kpis').innerHTML = [
    kpi(t('kpi_platform_aum'), idr(val(o.platform_aum)), `${num(val(o.investing_users))} ${t('kpi_investing_users')}`, 'accent', '💰'),
    kpi(t('kpi_total_users'), num(val(o.total_users)), `${num(val(o.verified_users))} ${t('kpi_verified')} (${pct(val(o.verified_users), val(o.total_users))})`, '', '👥'),
    kpi(t('kpi_buy_volume'), idr(val(o.buy_volume)), `${num(val(o.buy_count))} ${t('kpi_completed_buys')}`, 'accent', '📈'),
    kpi(t('kpi_sell_volume'), idr(val(o.sell_volume)), `${num(val(o.sell_count))} ${t('kpi_completed_sells')}`, 'warn', '📉'),
    kpi(t('kpi_active_users'), num(val(o.active_users)), t('kpi_ge1_tx'), 'amber', '⚡'),
    kpi(t('kpi_transactions'), num(val(o.total_tx)), t('kpi_all_statuses'), '', '🧾'),
    kpi(t('kpi_active_funds'), num(val(o.active_funds)), `${num(val(o.total_funds))} ${t('kpi_total_in_catalog')}`, 'amber', '🗂️'),
    kpi(t('kpi_new_users_30d'), num(val(o.new_users_30d)), t('kpi_rolling_window'), '', '✨'),
  ].join('');
}

async function loadTrends(gran) {
  const r = currentRange();
  try {
    const data = await api(`/api/trends?from=${r.from}&to=${r.to}&granularity=${gran}`);
    const labels = data.map((d) => val(d.bucket));
    paint('trendChart', {
      type: 'bar',
      data: { labels, datasets: [
        { label: t('chart_buy_volume'), data: data.map((d) => val(d.buy_volume)), backgroundColor: C.teal, borderRadius: 4, order: 2 },
        { label: t('chart_sell_volume'), data: data.map((d) => val(d.sell_volume)), backgroundColor: C.rose, borderRadius: 4, order: 2 },
        { label: t('chart_active_users'), data: data.map((d) => val(d.active_users)), type: 'line', yAxisID: 'y1',
          borderColor: C.indigo, backgroundColor: C.indigo, tension: .3, pointRadius: 2, order: 1 },
      ] },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          y: { grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => num(v) } },
          x: { grid: { display: false } },
        },
        plugins: { legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.datasetIndex === 2 ? num(c.raw) : idrFull(c.raw)}` } } },
      },
    });
  } catch (e) { toast(e.message); }
}

function doughnut(id, rows, labelKey, valueKey, fmt) {
  if (!rows.length) { return; }
  paint(id, {
    type: 'doughnut',
    data: { labels: rows.map((r) => val(r[labelKey])),
      datasets: [{ data: rows.map((r) => Number(val(r[valueKey]))), backgroundColor: pie(), borderWidth: 2, borderColor: C.surface }] },
    options: { maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt ? fmt(c.raw) : num(c.raw)}` } } } },
  });
}
const renderTypeChart = (rows) => doughnut('typeChart', rows, 'label', 'count', num);
const renderStatusChart = (rows) => doughnut('statusChart', rows, 'label', 'count', num);
const renderVerifyChart = (rows) => doughnut('verifyChart', rows, 'label', 'count', num);
const renderFundTypeChart = (rows) => doughnut('fundTypeChart', rows, 'label', 'aum', idrFull);

let topFundsCache = [];
function renderTopFunds(rows) {
  topFundsCache = rows;
  if (!rows.length) { $('#topFunds').innerHTML = '<div class="empty">No funds.</div>'; return; }
  const body = rows.map((f) => `<tr>
      <td>${val(f.name)}</td>
      <td><span class="tag other">${val(f.type)}</span></td>
      <td>${f.is_sharia ? 'Sharia' : '—'}</td>
      <td class="num">${num(val(f.latest_nav_value))}</td>
      <td class="num">${idrFull(val(f.latest_aum_value))}</td>
      <td class="num">${val(f.management_fee)}%</td>
    </tr>`).join('');
  $('#topFunds').innerHTML = `<table><thead><tr>
      <th>Fund</th><th>Type</th><th>Class</th><th class="num">NAV</th><th class="num">AUM</th><th class="num">Mgmt fee</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

// ====================================================================
//  PREDICT (ML: forecasts, churn, retention)
// ====================================================================
let predictLoaded = false;
let fcHorizon = 30;

async function loadPredict() {
  // model-dependent vs always-available are loaded independently
  let ready = false;
  try { const s = await api('/api/ml/status'); ready = s.ready; } catch { ready = false; }
  $('#mlBanner').classList.toggle('hidden', ready);
  ['aumFcPanel', 'txFcPanel', 'churnPanel'].forEach((id) => $('#' + id).classList.toggle('hidden', !ready));

  if (ready) { loadAumForecast(); loadTxForecast(); loadChurn(); }
  loadChurnOverview();
  loadRetention();
  loadAumRetention();
  predictLoaded = true;
}

function renderForecast(canvasId, data, label) {
  const hist = data.history || [], fc = data.forecast || [];
  const histDays = hist.map((d) => val(d.day));
  const fcDays = fc.map((d) => val(d.day));
  const labels = [...histDays, ...fcDays];
  const pad = (arr, before) => before ? [...histDays.map(() => null), ...arr] : [...arr, ...fcDays.map(() => null)];
  const histVals = pad(hist.map((d) => +val(d.value)), false);
  const fcVals = pad(fc.map((d) => +val(d.value)), true);
  if (hist.length) fcVals[histDays.length - 1] = +val(hist[hist.length - 1].value);
  const upper = pad(fc.map((d) => +val(d.upper)), true);
  const lower = pad(fc.map((d) => +val(d.lower)), true);

  paint(canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Confidence band', data: upper, borderColor: 'transparent', backgroundColor: 'rgba(224,163,62,.15)', fill: '+1', pointRadius: 0 },
        { label: '_lower', data: lower, borderColor: 'transparent', fill: false, pointRadius: 0 },
        { label: label || 'History', data: histVals, borderColor: C.indigo, backgroundColor: C.indigo, tension: .3, pointRadius: 0, borderWidth: 2 },
        { label: 'Forecast', data: fcVals, borderColor: C.amber, backgroundColor: C.amber, borderDash: [6, 4], tension: .3, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { y: { grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } },
      plugins: {
        legend: { position: 'bottom', labels: { filter: (i) => i.text !== '_lower' } },
        tooltip: { filter: (i) => i.dataset.label !== '_lower', callbacks: { label: (c) => c.raw == null ? null : `${c.dataset.label}: ${idrFull(c.raw)}` } },
      },
    },
  });
}

async function loadAumForecast() {
  try { renderForecast('aumFcChart', await api(`/api/predict/aum?horizon=${fcHorizon}`), 'AUM'); }
  catch (e) { toast(e.message); }
}
async function loadTxForecast() {
  try { renderForecast('txFcChart', await api(`/api/predict/transactions?horizon=${fcHorizon}`), 'Buy volume'); }
  catch (e) { toast(e.message); }
}

async function loadChurn() {
  $('#churnTable').innerHTML = '<div class="loading">Scoring holders…</div>';
  try {
    const { summary, top } = await api('/api/predict/churn?limit=100');
    $('#churnCards').innerHTML = [
      kpi(t('kpi_high_risk'), num(val(summary.high_risk)), t('kpi_ge50_churn_prob'), 'warn'),
      kpi(t('kpi_medium_risk'), num(val(summary.medium_risk)), '20–50%'),
      kpi(t('kpi_low_risk'), num(val(summary.low_risk)), '< 20%', 'accent'),
      kpi(t('kpi_avg_probability'), (val(summary.avg_prob) != null ? (val(summary.avg_prob) * 100).toFixed(1) + '%' : '—'), `${num(val(summary.scored))} ${t('kpi_holders_scored')}`),
    ].join('');
    renderChurnTable(top);
  } catch (e) { $('#churnTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function riskTag(p) {
  p = Number(p);
  if (p >= 0.5) return '<span class="tag risk-high">High</span>';
  if (p >= 0.2) return '<span class="tag risk-med">Medium</span>';
  return '<span class="tag risk-low">Low</span>';
}
function renderChurnTable(rows) {
  if (!rows.length) { $('#churnTable').innerHTML = '<div class="empty">No holders to score.</div>'; return; }
  const body = rows.map((r) => `<tr>
      <td>${val(r.name) || val(r.user_id)}</td>
      <td>${val(r.email) || '—'}</td>
      <td class="num">${(Number(val(r.churn_prob)) * 100).toFixed(1)}%</td>
      <td>${riskTag(val(r.churn_prob))}</td>
      <td class="num">${num(val(r.buys))}</td>
      <td class="num">${num(val(r.sells))}</td>
      <td class="num">${num(val(r.recency_days))}d</td>
      <td class="num">${idrFull(val(r.total_buy_amount))}</td>
    </tr>`).join('');
  $('#churnTable').innerHTML = `<table><thead><tr>
      <th>Investor</th><th>Email</th><th class="num">Churn prob</th><th>Risk</th>
      <th class="num">Buys</th><th class="num">Sells</th><th class="num">Recency</th><th class="num">Invested</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

async function loadChurnOverview() {
  try {
    const { overall, byTenure } = await api('/api/churn/overview');
    const churnRate = val(overall.total_investors) ? (val(overall.churned) / val(overall.total_investors) * 100).toFixed(1) : '—';
    $('#churnOverviewCards').innerHTML = [
      kpi(t('kpi_overall_churn_rate'), churnRate + '%', t('kpi_investors_fully_redeemed').replace('{churned}', num(val(overall.churned))).replace('{total}', num(val(overall.total_investors))), 'warn'),
      kpi(t('kpi_active_holders'), num(val(overall.active_holders)), t('kpi_currently_hold_1fund'), 'accent'),
    ].join('');
    const body = byTenure.map((r) => `<tr>
        <td>${val(r.tenure_bucket)}</td>
        <td class="num">${num(val(r.investors))}</td>
        <td class="num">${num(val(r.churned))}</td>
        <td class="num">${val(r.churn_rate)}%</td>
      </tr>`).join('');
    $('#churnTenure').innerHTML = `<table><thead><tr>
        <th>Tenure</th><th class="num">Investors</th><th class="num">Churned</th><th class="num">Churn rate</th>
      </tr></thead><tbody>${body}</tbody></table>`;
  } catch (e) { $('#churnTenure').innerHTML = `<div class="empty">${e.message}</div>`; }
}

async function loadRetention() {
  $('#retentionHeatmap').innerHTML = '<div class="loading">Building cohorts…</div>';
  try {
    const rows = await api('/api/retention/cohorts?months=12');
    if (!rows.length) { $('#retentionHeatmap').innerHTML = '<div class="empty">Not enough data.</div>'; return; }
    // pivot: cohort -> {offset: users}
    const cohorts = {};
    let maxOffset = 0;
    rows.forEach((r) => {
      const c = val(r.cohort), o = Number(val(r.month_offset)), u = Number(val(r.users));
      (cohorts[c] = cohorts[c] || {})[o] = u;
      if (o > maxOffset) maxOffset = o;
    });
    maxOffset = Math.min(maxOffset, 12);
    const heads = ['<th class="coh">Cohort</th>', '<th class="num">Size</th>'];
    for (let o = 0; o <= maxOffset; o++) heads.push(`<th>M${o}</th>`);
    const body = Object.keys(cohorts).sort().map((c) => {
      const size = cohorts[c][0] || 0;
      let tds = `<td class="coh">${c}</td><td class="num">${num(size)}</td>`;
      for (let o = 0; o <= maxOffset; o++) {
        const u = cohorts[c][o];
        if (u == null || !size) { tds += '<td>·</td>'; continue; }
        const pctv = u / size;
        const bg = `rgba(${C.heatRgb},${(0.12 + pctv * 0.8).toFixed(2)})`;
        tds += `<td class="heat" style="background:${bg}">${Math.round(pctv * 100)}%</td>`;
      }
      return `<tr>${tds}</tr>`;
    }).join('');
    $('#retentionHeatmap').innerHTML = `<table><thead><tr>${heads.join('')}</tr></thead><tbody>${body}</tbody></table>`;
  } catch (e) { $('#retentionHeatmap').innerHTML = `<div class="empty">${e.message}</div>`; }
}

// Retained-by-capital cohort: same cohort basis as loadRetention (first
// transaction month), but a month counts a user as retained if they still
// have AUM that month OR their cumulative netflow since month 0 is still
// >= 0. Each cell also carries that cumulative netflow so a retention drop
// caused by net redemptions is visible, not just the resulting %.
async function loadAumRetention() {
  $('#aumRetentionHeatmap').innerHTML = '<div class="loading">Building cohorts…</div>';
  try {
    const rows = await api('/api/retention/aum-cohorts?months=12');
    if (!rows.length) { $('#aumRetentionHeatmap').innerHTML = '<div class="empty">Not enough data.</div>'; return; }
    const cohorts = {};
    const sizes = {};
    let maxOffset = 0;
    rows.forEach((r) => {
      const c = val(r.cohort), o = Number(val(r.month_offset));
      const u = Number(val(r.users)), nf = val(r.netflow) == null ? null : Number(val(r.netflow));
      (cohorts[c] = cohorts[c] || {})[o] = { u, nf };
      sizes[c] = Number(val(r.cohort_size)); // constant per cohort across offsets
      if (o > maxOffset) maxOffset = o;
    });
    maxOffset = Math.min(maxOffset, 12);
    const heads = ['<th class="coh">Cohort</th>', '<th class="num">Size</th>'];
    for (let o = 0; o <= maxOffset; o++) heads.push(`<th>M${o}</th>`);
    const body = Object.keys(cohorts).sort().map((c) => {
      const size = sizes[c] || 0;
      let tds = `<td class="coh">${c}</td><td class="num">${num(size)}</td>`;
      for (let o = 0; o <= maxOffset; o++) {
        const cell = cohorts[c][o];
        if (!cell || !size) { tds += '<td>·</td>'; continue; }
        const pctv = cell.u / size;
        const bg = `rgba(${C.heatRgb},${(0.12 + pctv * 0.8).toFixed(2)})`;
        const nfColor = cell.nf == null ? 'inherit' : (cell.nf >= 0 ? 'var(--teal)' : 'var(--rose)');
        const nfLabel = cell.nf == null ? '' : `<div style="font-size:10px;color:${nfColor}">${idr(cell.nf)}</div>`;
        tds += `<td class="heat" style="background:${bg}" title="Cumulative netflow: ${idrFull(cell.nf)}">${Math.round(pctv * 100)}%${nfLabel}</td>`;
      }
      return `<tr>${tds}</tr>`;
    }).join('');
    $('#aumRetentionHeatmap').innerHTML = `<table><thead><tr>${heads.join('')}</tr></thead><tbody>${body}</tbody></table>`;
  } catch (e) { $('#aumRetentionHeatmap').innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ====================================================================
//  AUM HISTORY
// ====================================================================
let aumGran = 'month';
let aumCache = [];

async function loadAumHistory() {
  const r = currentRange();
  $('#aumTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  try {
    const data = await api(`/api/aum-history?from=${r.from}&to=${r.to}&granularity=${aumGran}`);
    aumCache = data;
    renderAumChart(data);
    renderAumTable(data);
  } catch (e) { $('#aumTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderAumChart(data) {
  const labels = data.map((d) => val(d.bucket));
  paint('aumChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'line', label: 'AUM (end of period)', data: data.map((d) => val(d.aum)),
          borderColor: C.indigo, backgroundColor: 'rgba(30,42,74,.08)', fill: true,
          tension: .3, pointRadius: 2, yAxisID: 'y', order: 1 },
        { label: 'Revenue', data: data.map((d) => val(d.revenue)),
          backgroundColor: C.amber, borderRadius: 4, yAxisID: 'y1', order: 2 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position: 'left', grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => idr(v) } },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${idrFull(c.raw)}` } },
      },
    },
  });
}

function renderAumTable(data) {
  if (!data.length) { $('#aumTable').innerHTML = '<div class="empty">No data in this range.</div>'; return; }
  const rows = data.map((d, i) => {
    const aum = Number(val(d.aum)) || 0;
    const prev = i > 0 ? Number(val(data[i - 1].aum)) || 0 : null;
    const chg = prev ? ((aum - prev) / prev * 100) : null;
    return { bucket: val(d.bucket), aum, revenue: val(d.revenue), funds: val(d.funds), chg };
  });
  const body = rows.map((r) => `<tr>
      <td class="mono">${r.bucket}</td>
      <td class="num">${idrFull(r.aum)}</td>
      <td class="num">${r.chg == null ? '—' : `<span style="color:${r.chg >= 0 ? 'var(--teal)' : 'var(--rose)'}">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</span>`}</td>
      <td class="num">${idrFull(r.revenue)}</td>
      <td class="num">${num(r.funds)}</td>
    </tr>`).join('');
  $('#aumTable').innerHTML = `<table><thead><tr>
      <th>Period</th><th class="num">AUM</th><th class="num">Δ AUM</th><th class="num">Revenue</th><th class="num">Funds</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

// ====================================================================
//  PRODUCT PERFORMANCE (NAV % change per fund type, external Apollo DB)
// ====================================================================
const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];
let perfCache = [];
let perfTrendLoaded = false;
let perfTrendCache = [];

async function loadPerfTrendTypes() {
  const sel = $('#perfTrendType');
  if (sel.options.length > 1) return; // built once
  try {
    const types = await api('/api/funds/types');
    types.forEach((t) => sel.insertAdjacentHTML('beforeend', `<option value="${val(t.label)}">${val(t.label)}</option>`));
  } catch (e) { /* filter is optional; chart still works with "All fund types" */ }
}

// Repopulates the fund checkbox list for the currently selected type. Resets
// any prior selection/search since the candidate set changes with the type filter.
async function loadPerfTrendFunds() {
  const type = $('#perfTrendType').value;
  $('#perfTrendFundSearch').value = '';
  try {
    const funds = await api(`/api/funds/list?type=${encodeURIComponent(type)}`);
    $('#perfTrendFunds').innerHTML = funds.map((f) =>
      `<label class="ask-table-chk"><input type="checkbox" value="${val(f.name)}"> ${val(f.name)}</label>`).join('');
  } catch (e) { $('#perfTrendFunds').innerHTML = ''; }
  updatePerfTrendFundsBtn();
}

// Client-side substring filter over the already-loaded checkbox list (at most
// ~80 funds, no need for a server round trip).
function filterPerfTrendFunds() {
  const q = $('#perfTrendFundSearch').value.trim().toLowerCase();
  $$('#perfTrendFunds label').forEach((lbl) => {
    lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function updatePerfTrendFundsBtn() {
  const n = $$('#perfTrendFunds input:checked').length;
  $('#perfTrendFundsBtn').textContent = n ? `${n} fund${n === 1 ? '' : 's'} picked` : 'Pick funds';
}

async function loadPerfTrend() {
  perfTrendLoaded = true;
  const type = $('#perfTrendType').value;
  const period = $('#perfTrendPeriod').value;
  const limit = $('#perfTrendLimit').value;
  const picked = $$('#perfTrendFunds input:checked').map((el) => el.value);
  const qs = new URLSearchParams({ type, period, limit });
  picked.forEach((f) => qs.append('funds', f));
  try {
    perfTrendCache = await api(`/api/product-performance/trend?${qs.toString()}`);
    renderPerfTrendChart(perfTrendCache);
  } catch (e) { /* leave the previous chart in place rather than blanking it */ }
}

function renderPerfTrendChart(rows) {
  const byFund = {};
  const dateSet = new Set();
  rows.forEach((r) => {
    const name = val(r.name), d = val(r.d);
    dateSet.add(d);
    (byFund[name] = byFund[name] || {})[d] = Number(val(r.value));
  });
  const labels = [...dateSet].sort();
  const palette = pie();
  const datasets = Object.keys(byFund).map((name, i) => ({
    label: name,
    data: labels.map((d) => (byFund[name][d] != null ? byFund[name][d] : null)),
    borderColor: palette[i % palette.length], backgroundColor: 'transparent',
    spanGaps: true, pointRadius: 0, tension: .25,
  }));
  paint('perfTrendChart', {
    type: 'line',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { y: { grid: { color: C.grid }, title: { display: true, text: 'NAV' } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } },
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : num(c.raw)}` } } },
    },
  });
}

async function loadPerformance() {
  $('#perfTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  try {
    perfCache = await api('/api/product-performance');
    renderPerformance(perfCache);
  } catch (e) { $('#perfTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPerformance(rows) {
  if (!rows.length) { $('#perfTable').innerHTML = '<div class="empty">No NAV data.</div>'; return; }
  const byType = {};
  rows.forEach((r) => {
    const type = val(r.type);
    (byType[type] = byType[type] || {})[val(r.period)] = { pct: val(r.pct_change), funds: val(r.fund_count) };
  });
  const head = PERF_PERIODS.map((p) => `<th class="num">${p}</th>`).join('');
  const body = Object.keys(byType).sort().map((type) => {
    const cells = PERF_PERIODS.map((p) => {
      const c = byType[type][p];
      if (!c || c.pct == null) return '<td class="num">—</td>';
      const pct = Number(c.pct);
      return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span></td>`;
    }).join('');
    return `<tr><td>${type}</td>${cells}</tr>`;
  }).join('');
  $('#perfTable').innerHTML = `<table><thead><tr><th>Fund type</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

let perfDetailCache = [];

async function loadPerformanceDetail() {
  $('#perfDetailTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  try {
    perfDetailCache = await api('/api/product-performance/detail');
    buildPerfTypeFilter(perfDetailCache);
    renderPerformanceDetail();
  } catch (e) { $('#perfDetailTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function buildPerfTypeFilter(rows) {
  const sel = $('#perfTypeFilter');
  if (sel.options.length > 1) return; // built once
  const types = [...new Set(rows.map((r) => val(r.type)))].sort();
  types.forEach((t) => sel.insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));
}

// pivot flat (type, name, period, pct_change) rows into one row per fund
function pivotByFund(rows) {
  const byFund = {};
  rows.forEach((r) => {
    const name = val(r.name), type = val(r.type);
    const key = type + '||' + name;
    const f = (byFund[key] = byFund[key] || { name, type, nav: val(r.latest_nav) });
    f[val(r.period)] = val(r.pct_change);
  });
  return Object.values(byFund);
}

function renderPerformanceDetail() {
  const typeFilter = $('#perfTypeFilter').value;
  const search = $('#perfDetailSearch').value.trim().toLowerCase();
  const rows = typeFilter ? perfDetailCache.filter((r) => val(r.type) === typeFilter) : perfDetailCache;
  const funds = pivotByFund(rows)
    .filter((f) => !search || f.name.toLowerCase().includes(search))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  if (!funds.length) { $('#perfDetailTable').innerHTML = '<div class="empty">No matching fund.</div>'; return; }
  const head = PERF_PERIODS.map((p) => `<th class="num">${p}</th>`).join('');
  const body = funds.map((f) => {
    const cells = PERF_PERIODS.map((p) => {
      const pct = f[p];
      if (pct == null) return '<td class="num">—</td>';
      return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
    }).join('');
    return `<tr><td>${f.name}</td><td><span class="tag other">${f.type}</span></td><td class="num">${num(f.nav)}</td>${cells}</tr>`;
  }).join('');
  $('#perfDetailTable').innerHTML = `<table><thead><tr><th>Fund</th><th>Type</th><th class="num">NAV</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ====================================================================
//  GROWTH (campaigns, referrals, switching, manager/demographic AUM)
// ====================================================================
let growthLoaded = false;
function genTable(sel, rows, cols, emptyMsg) {
  if (!rows.length) { $(sel).innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
  const numTypes = ['idr', 'idrx', 'num', 'pct'];
  const head = cols.map((c) => `<th class="${numTypes.includes(c.type) ? 'num' : ''}">${c.label}</th>`).join('');
  const body = rows.map((r) => '<tr>' + cols.map((c) => {
    const v = val(r[c.key]);
    let out = v == null ? '—' : v;
    if (c.type === 'idr') out = idrFull(v);
    if (c.type === 'idrx') out = idrExact(v);
    if (c.type === 'num') out = num(v);
    if (c.type === 'pct') out = v == null ? '—' : `${Number(v).toFixed(1)}%`;
    if (c.type === 'date') out = v == null ? '—' : String(v).slice(0, 10);
    return `<td class="${numTypes.includes(c.type) ? 'num' : ''}">${out}</td>`;
  }).join('') + '</tr>').join('');
  $(sel).innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function loadGrowth() {
  growthLoaded = true;
  api('/api/campaigns/performance').then((rows) => genTable('#campTable', rows, [
    { key: 'name', label: 'Campaign' }, { key: 'campaign_type', label: 'Type' },
    { key: 'promo_code', label: 'Promo' }, { key: 'quota', label: 'Quota', type: 'num' },
    { key: 'used_quota', label: 'Used', type: 'num' }, { key: 'redemption_pct', label: 'Redemption', type: 'pct' },
    { key: 'bonus_amount', label: 'Bonus/redemption', type: 'idr' }, { key: 'est_cost', label: 'Est. cost', type: 'idr' },
  ], 'No campaigns.')).catch((e) => $('#campTable').innerHTML = `<div class="empty">${e.message}</div>`);

  api('/api/referrals/top').then((rows) => genTable('#refTable', rows, [
    { key: 'referral_code', label: 'Code' }, { key: 'referrer', label: 'Referrer' },
    { key: 'referred_count', label: 'Referred', type: 'num' }, { key: 'referred_volume', label: 'Volume brought', type: 'idr' },
  ], 'No referrals yet.')).catch((e) => $('#refTable').innerHTML = `<div class="empty">${e.message}</div>`);

  api('/api/switching/top-pairs').then((rows) => genTable('#switchTable', rows, [
    { key: 'from_fund', label: 'From fund' }, { key: 'to_fund', label: 'To fund' },
    { key: 'switches', label: 'Switches', type: 'num' }, { key: 'amount', label: 'Amount', type: 'idr' },
  ], 'No switching transactions.')).catch((e) => $('#switchTable').innerHTML = `<div class="empty">${e.message}</div>`);

  api('/api/funds/by-manager').then((rows) => doughnut('managerChart', rows, 'label', 'aum', idrFull))
    .catch(() => {});

  api('/api/users/aum-by-risk').then((rows) => doughnut('riskChart', rows, 'label', 'aum', idrFull))
    .catch(() => {});

  api('/api/users/aum-by-income').then((rows) => genTable('#incomeTable', rows, [
    { key: 'label', label: 'Income bracket' }, { key: 'investors', label: 'Investors', type: 'num' },
    { key: 'aum', label: 'AUM', type: 'idr' },
  ], 'No data.')).catch((e) => $('#incomeTable').innerHTML = `<div class="empty">${e.message}</div>`);
}

// ====================================================================
//  RECONCILIATION (app ledger vs custodian feed)
// ====================================================================
async function loadReconciliation() {
  const r = currentRange();
  $('#recTable').innerHTML = '<div class="loading">Comparing ledgers…</div>';
  try {
    const rows = await api(`/api/reconciliation?from=${r.from}&to=${r.to}`);
    genTable('#recTable', rows, [
      { key: 'bucket', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'app_count', label: 'App tx', type: 'num' }, { key: 'app_amount', label: 'App amount', type: 'idr' },
      { key: 'sinvest_count', label: 'Custodian tx', type: 'num' }, { key: 'sinvest_amount', label: 'Custodian amount', type: 'idr' },
      { key: 'amount_diff', label: 'Diff', type: 'idr' },
    ], 'No data in this range.');
  } catch (e) { $('#recTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ====================================================================
//  REVENUE (management fee earned per fund/month)
// ====================================================================
function renderRevenueTrend(rows, chartId = 'revTrendChart') {
  if (!rows.length) return;
  paint(chartId, {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.period)),
      datasets: [
        { label: 'AperD share', data: rows.map((d) => Number(val(d.total_aperd_share))), backgroundColor: C.teal, borderRadius: 4, stack: 'fee', order: 2 },
        { label: 'MI share', data: rows.map((d) => Number(val(d.total_mi_share))), backgroundColor: C.amber, borderRadius: 4, stack: 'fee', order: 2 },
        { label: 'Total AUM', data: rows.map((d) => Number(val(d.total_aum))), type: 'line', yAxisID: 'y1',
          borderColor: C.indigo, backgroundColor: C.indigo, tension: .3, pointRadius: 2, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        y: { stacked: true, grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => idr(v) } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${idrFull(c.raw)}` } } },
    },
  });
}

let revGran = 'month';

async function loadRevenue() {
  const r = revRange();
  $('#revDetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#revSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  try {
    const qs = `from=${r.from}&to=${r.to}&granularity=${revGran}&fund=${encodeURIComponent(r.fund)}&mi=${encodeURIComponent(r.mi)}`;
    const [detail, summary] = await Promise.all([
      api(`/api/revenue?${qs}`),
      api(`/api/revenue/summary?${qs}`),
    ]);
    renderRevenueTrend(summary);
    genTable('#revDetailTable', detail, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'fund_name', label: 'Fund' }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'mi_name', label: 'Investment Manager' },
      { key: 'management_fee', label: 'Mgmt fee rate', type: 'num' },
      { key: 'aperd_share', label: 'AperD share', type: 'num' }, { key: 'mi_share', label: 'MI share', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idr' }, { key: 'aum_eom', label: 'AUM EOM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
    genTable('#revSummaryTable', summary, [
      { key: 'period', label: 'Period', type: 'date' }, { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'total_aum', label: 'Total AUM (EOM)', type: 'idr' }, { key: 'avg_aum', label: 'Avg AUM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#revDetailTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#revSummaryTable').innerHTML = '';
  }
}

// ====================================================================
//  REVENUE v2 (same calculation as Revenue above, AUM from goal_snapshots)
// ====================================================================
let rev2Gran = 'month';

async function loadRevenue2() {
  const r = rev2Range();
  $('#rev2DetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#rev2SummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  try {
    const qs = `from=${r.from}&to=${r.to}&granularity=${rev2Gran}&fund=${encodeURIComponent(r.fund)}&mi=${encodeURIComponent(r.mi)}`;
    const [detail, summary] = await Promise.all([
      api(`/api/revenue-v2?${qs}`),
      api(`/api/revenue-v2/summary?${qs}`),
    ]);
    renderRevenueTrend(summary, 'rev2TrendChart');
    genTable('#rev2DetailTable', detail, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'fund_name', label: 'Fund' }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'mi_name', label: 'Investment Manager' },
      { key: 'management_fee', label: 'Mgmt fee rate', type: 'num' },
      { key: 'aperd_share', label: 'AperD share', type: 'num' }, { key: 'mi_share', label: 'MI share', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idr' }, { key: 'aum_eom', label: 'AUM EOM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
    genTable('#rev2SummaryTable', summary, [
      { key: 'period', label: 'Period', type: 'date' }, { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'total_aum', label: 'Total AUM (EOM)', type: 'idr' }, { key: 'avg_aum', label: 'Avg AUM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#rev2DetailTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#rev2SummaryTable').innerHTML = '';
  }
}

// ====================================================================
//  REMISIER SHARING (goal_snapshots — one remisier's users, AperD share
//  split between remisier and Sayakaya)
// ====================================================================
let remGranularity = 'day';

// UI takes a whole percent (e.g. 60); the API/DB deal in fractions (0.6),
// same units as management_fee_logs.aperd_share/mi_share.
function remPortionFraction() { return (Number($('#remPortion').value) || 0) / 100; }

function remParams() {
  return {
    field: $('#remField').value,
    code: $('#remCode').value.trim(),
    from: $('#remFrom').value,
    to: $('#remTo').value,
    granularity: remGranularity,
    portion: remPortionFraction(),
  };
}

async function loadRemisier() {
  const p = remParams();
  if (!p.code) { toast('Enter a remisier code first.'); return; }
  $('#remUsersTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#remDetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#remSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  const qs = `field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}&from=${p.from}&to=${p.to}&granularity=${p.granularity}&portion=${p.portion}`;
  try {
    const [users, detail, summary] = await Promise.all([
      api(`/api/remisier/users?field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}`),
      api(`/api/remisier/revenue?${qs}`),
      api(`/api/remisier/revenue/summary?${qs}`),
    ]);
    genTable('#remUsersTable', users, [
      { key: 'sid', label: 'SID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'referrer_code', label: 'Referrer code' }, { key: 'sales_code', label: 'Sales code' },
    ], 'No users under this remisier code.');
    genTable('#remDetailTable', detail, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'sid', label: 'SID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'fund_name', label: 'Fund' }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'management_fee', label: 'Mgmt fee rate', type: 'num' },
      { key: 'aperd_share', label: 'AperD share', type: 'num' }, { key: 'mi_share', label: 'MI share', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idr' }, { key: 'aum_eom', label: 'AUM (EOP)', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
      { key: 'total_remisier_fee', label: 'Remisier fee (gross)', type: 'idr' },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idr' }, { key: 'total_remisier_fee_net', label: 'Remisier fee (net)', type: 'idr' },
      { key: 'total_sayakaya_fee', label: 'Sayakaya fee', type: 'idr' },
    ], 'No revenue in this range.');
    genTable('#remSummaryTable', summary, [
      { key: 'period', label: 'Period', type: 'date' }, { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'total_aum', label: 'Total AUM (EOP)', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
      { key: 'total_remisier_fee', label: 'Remisier fee (gross)', type: 'idr' },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idr' }, { key: 'total_remisier_fee_net', label: 'Remisier fee (net)', type: 'idr' },
      { key: 'total_sayakaya_fee', label: 'Sayakaya fee', type: 'idr' },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#remUsersTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#remDetailTable').innerHTML = '';
    $('#remSummaryTable').innerHTML = '';
  }
}

// ====================================================================
//  REMISIER SHARING (portfolio_with_code — same math, AUM from the
//  original Revenue tab's source instead of goal_snapshots)
// ====================================================================
let remPwcGranularity = 'day';

function remPwcPortionFraction() { return (Number($('#remPwcPortion').value) || 0) / 100; }

function remPwcParams() {
  return {
    field: $('#remPwcField').value,
    code: $('#remPwcCode').value.trim(),
    from: $('#remPwcFrom').value,
    to: $('#remPwcTo').value,
    granularity: remPwcGranularity,
    portion: remPwcPortionFraction(),
  };
}

async function loadRemisierPwc() {
  const p = remPwcParams();
  if (!p.code) { toast('Enter a remisier code first.'); return; }
  $('#remPwcUsersTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#remPwcDetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#remPwcSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  const qs = `field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}&from=${p.from}&to=${p.to}&granularity=${p.granularity}&portion=${p.portion}`;
  try {
    const [users, detail, summary] = await Promise.all([
      api(`/api/remisier/users?field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}`),
      api(`/api/remisier/revenue-pwc?${qs}`),
      api(`/api/remisier/revenue-pwc/summary?${qs}`),
    ]);
    genTable('#remPwcUsersTable', users, [
      { key: 'sid', label: 'SID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'referrer_code', label: 'Referrer code' }, { key: 'sales_code', label: 'Sales code' },
    ], 'No users under this remisier code.');
    genTable('#remPwcDetailTable', detail, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'sid', label: 'SID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'fund_name', label: 'Fund' }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'management_fee', label: 'Mgmt fee rate', type: 'num' },
      { key: 'aperd_share', label: 'AperD share', type: 'num' }, { key: 'mi_share', label: 'MI share', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idrx' }, { key: 'aum_eom', label: 'AUM (EOP)', type: 'idrx' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idrx' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idrx' }, { key: 'total_mi_share', label: 'Total MI', type: 'idrx' },
      { key: 'total_remisier_fee', label: 'Remisier fee (gross)', type: 'idrx' },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idrx' }, { key: 'total_remisier_fee_net', label: 'Remisier fee (net)', type: 'idrx' },
      { key: 'total_sayakaya_fee', label: 'Sayakaya fee', type: 'idrx' },
    ], 'No revenue in this range.');
    genTable('#remPwcSummaryTable', summary, [
      { key: 'period', label: 'Period', type: 'date' }, { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'total_aum', label: 'Total AUM (EOP)', type: 'idrx' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idrx' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idrx' }, { key: 'total_mi_share', label: 'Total MI', type: 'idrx' },
      { key: 'total_remisier_fee', label: 'Remisier fee (gross)', type: 'idrx' },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idrx' }, { key: 'total_remisier_fee_net', label: 'Remisier fee (net)', type: 'idrx' },
      { key: 'total_sayakaya_fee', label: 'Sayakaya fee', type: 'idrx' },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#remPwcUsersTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#remPwcDetailTable').innerHTML = '';
    $('#remPwcSummaryTable').innerHTML = '';
  }
}

// ---- nested: remisier transactions (per-transaction detail, own filters) --
const remTx = { limit: 100, offset: 0, total: 0 };

function remTxCodesArr(sel) {
  return $(sel).value.split(',').map((s) => s.trim()).filter(Boolean);
}

function remTxParams() {
  return {
    referrerCodes: remTxCodesArr('#remTxReferrerCodes'),
    salesCodes: remTxCodesArr('#remTxSalesCodes'),
    type: $('#remTxType').value,
    status: $('#remTxStatus').value,
    from: $('#remTxFrom').value,
    to: $('#remTxTo').value,
  };
}

async function loadRemTxFilterOptions() {
  try {
    const { types, statuses } = await api('/api/transactions/filters');
    (types || []).forEach((t) => $('#remTxType').insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));
    (statuses || []).forEach((s) => $('#remTxStatus').insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
  } catch { /* filter dropdowns just stay at "All" */ }
}

async function loadRemTx() {
  const p = remTxParams();
  if (!p.referrerCodes.length && !p.salesCodes.length) { toast('Enter at least one referrer_code or sales_code.'); return; }
  $('#remTxTable').innerHTML = '<div class="loading">Loading…</div>';
  const qs = new URLSearchParams();
  p.referrerCodes.forEach((c) => qs.append('referrerCodes', c));
  p.salesCodes.forEach((c) => qs.append('salesCodes', c));
  if (p.type) qs.set('type', p.type);
  if (p.status) qs.set('status', p.status);
  qs.set('from', p.from); qs.set('to', p.to);
  qs.set('limit', remTx.limit); qs.set('offset', remTx.offset);
  try {
    const { rows, total } = await api(`/api/remisier/transactions?${qs}`);
    remTx.total = total;
    genTable('#remTxTable', rows, [
      { key: 'created_at', label: 'Date', type: 'date' },
      { key: 'transaction_number', label: 'Trx #' },
      { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'sid', label: 'SID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
      { key: 'fund_name', label: 'Fund' }, { key: 'fund_type', label: 'Fund type' },
      { key: 'unit', label: 'Unit', type: 'num' },
      { key: 'value_per_unit', label: 'NAV', type: 'num' },
      { key: 'amount', label: 'Amount', type: 'idr' }, { key: 'final_amount', label: 'Final amount', type: 'idr' },
      { key: 'realized_gain_loss', label: 'Realized G/L', type: 'idr' },
      { key: 'referrer_code', label: 'Referrer code' }, { key: 'sales_code', label: 'Sales code' },
    ], 'No transactions match these filters.');
    const start = total ? remTx.offset + 1 : 0;
    const end = Math.min(remTx.offset + remTx.limit, total);
    $('#remTxPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#remTxPrev').disabled = remTx.offset === 0;
    $('#remTxNext').disabled = end >= total;
  } catch (e) { $('#remTxTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ====================================================================
//  EXPLORER (multi-table)
// ====================================================================
function tagClass(v) {
  const k = String(v).toLowerCase();
  if (['buy', 'completed', 'active', 'verified'].includes(k)) return k === 'completed' || k === 'buy' ? k : 'completed';
  if (k === 'sell') return 'sell';
  if (['cancelled', 'expired', 'failed', 'inactive', 'unverified'].includes(k)) return 'cancelled';
  return 'other';
}

const ex = { meta: [], current: null, offset: 0, limit: 50, total: 0 };

function fmtCell(v, type) {
  v = val(v);
  if (v == null || v === '') return '—';
  switch (type) {
    case 'idr': return idrFull(v);
    case 'num': return num(v);
    case 'num4': return Number(v).toFixed(4);
    case 'bool': return (v === true || v === 'true') ? 'Yes' : 'No';
    case 'datetime': return `<span class="mono">${String(v).replace('T', ' ').slice(0, 19)}</span>`;
    case 'date': return `<span class="mono">${String(v).slice(0, 10)}</span>`;
    case 'tag': return `<span class="tag ${tagClass(v)}">${v}</span>`;
    default: return String(v);
  }
}

async function loadExplorerMeta() {
  try { ex.meta = await api('/api/explore/_meta'); } catch { ex.meta = []; }
  $('#exTabs').innerHTML = ex.meta.map((d, i) =>
    `<button class="ex-tab ${i === 0 ? 'on' : ''}" data-ds="${d.key}">${d.label}</button>`).join('');
  $$('#exTabs .ex-tab').forEach((b) => b.addEventListener('click', () => selectDataset(b.dataset.ds)));
  if (ex.meta.length) selectDataset(ex.meta[0].key);
}

function currentDataset() { return ex.meta.find((d) => d.key === ex.current); }

async function selectDataset(key) {
  ex.current = key; ex.offset = 0;
  $$('#exTabs .ex-tab').forEach((b) => b.classList.toggle('on', b.dataset.ds === key));
  const d = currentDataset();
  $('#exTitle').textContent = d.label;
  buildExFilters(d);
  loadExplore();
}

function buildExFilters(d) {
  const box = $('#exFilters');
  box.innerHTML = '';
  for (const f of d.filters) {
    const sel = document.createElement('select');
    sel.id = `exf-${f.key}`;
    sel.innerHTML = `<option value="">All ${f.key.replace(/_/g, ' ')}</option>`;
    box.appendChild(sel);
    if (f.bool) {
      sel.insertAdjacentHTML('beforeend', '<option value="true">Yes</option><option value="false">No</option>');
    } else if (f.values) {
      f.values.forEach((v) => sel.insertAdjacentHTML('beforeend', `<option value="${v}">${v}</option>`));
    } else {
      api(`/api/explore/${d.key}/filters/${f.key}`)
        .then(({ values }) => (values || []).forEach((v) =>
          sel.insertAdjacentHTML('beforeend', `<option value="${String(v).replace(/"/g, '&quot;')}">${v}</option>`)))
        .catch(() => {});
    }
  }
  const search = document.createElement('input');
  search.type = 'text'; search.id = 'exf-search'; search.placeholder = 'Search…';
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ex.offset = 0; loadExplore(); } });
  box.appendChild(search);

  const apply = document.createElement('button');
  apply.className = 'btn-primary'; apply.textContent = 'Search';
  apply.addEventListener('click', () => { ex.offset = 0; loadExplore(); });
  box.appendChild(apply);

  box.insertAdjacentHTML('beforeend', '<span class="divider"></span>');
  [['csv', 'CSV'], ['xlsx', 'Excel'], ['txt', 'TXT (|)']].forEach(([fmt, label]) => {
    const b = document.createElement('button');
    b.className = 'btn-ghost'; b.textContent = label;
    b.addEventListener('click', () => download(
      { source: 'explore', dataset: ex.current, format: fmt, filename: ex.current, filters: exFilterValues(), limit: 100000 },
      `${ex.current}.${fmt}`));
    box.appendChild(b);
  });
}

function exFilterValues() {
  const d = currentDataset();
  const out = {};
  if (d.hasDate) { const r = currentRange(); out.from = r.from; out.to = r.to; }
  for (const f of d.filters) { const el = $(`#exf-${f.key}`); if (el && el.value) out[f.key] = el.value; }
  const s = $('#exf-search'); if (s && s.value.trim()) out.search = s.value.trim();
  return out;
}

async function loadExplore() {
  $('#exTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  const d = currentDataset();
  const qs = new URLSearchParams({ ...exFilterValues(), limit: ex.limit, offset: ex.offset });
  try {
    const { rows, total } = await api(`/api/explore/${ex.current}?${qs}`);
    ex.total = total;
    renderExTable(d, rows);
    const start = total ? ex.offset + 1 : 0;
    const end = Math.min(ex.offset + ex.limit, total);
    $('#exPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#exPrev').disabled = ex.offset === 0;
    $('#exNext').disabled = end >= total;
  } catch (e) { $('#exTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderExTable(d, rows) {
  if (!rows.length) { $('#exTable').innerHTML = '<div class="empty">No rows match these filters.</div>'; return; }
  const numTypes = ['idr', 'num', 'num4'];
  const head = d.columns.map((c) => `<th class="${numTypes.includes(c.type) ? 'num' : ''}">${c.label}</th>`).join('');
  const body = rows.map((r) => '<tr>' + d.columns.map((c) =>
    `<td class="${numTypes.includes(c.type) ? 'num' : ''}">${fmtCell(r[c.key], c.type)}</td>`).join('') + '</tr>').join('');
  $('#exTable').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ====================================================================
//  SQL LAB
// ====================================================================
let sqlCache = [];

async function runSql() {
  const sql = $('#sqlInput').value;
  const unredact = $('#sqlUnredact').checked;
  const password = $('#sqlUnredactPassword').value;
  if (unredact && !password) { setSqlMsg('Enter your password to include restricted columns.', 'err'); return; }
  setSqlMsg('Running…', '');
  $('#sqlResult').innerHTML = '<div class="loading">Executing query…</div>';
  $('#sqlCsv').disabled = $('#sqlXlsx').disabled = true;
  try {
    const body = { sql };
    if (unredact) { body.unredact = true; body.password = password; }
    const { rows, count } = await api('/api/sql/run', { method: 'POST', body: JSON.stringify(body) });
    sqlCache = rows;
    renderGenericTable('#sqlResult', rows);
    setSqlMsg(`${num(count)} row${count === 1 ? '' : 's'}`, 'ok');
    $('#sqlCsv').disabled = $('#sqlXlsx').disabled = rows.length === 0;
  } catch (e) {
    $('#sqlResult').innerHTML = '';
    setSqlMsg(e.message, 'err');
  } finally {
    // Never keep a typed password around longer than the one request it authorized.
    $('#sqlUnredactPassword').value = '';
  }
}

async function estimateSql() {
  setSqlMsg('Estimating…', '');
  try {
    const { bytes, withinLimit } = await api('/api/sql/estimate', { method: 'POST', body: JSON.stringify({ sql: $('#sqlInput').value }) });
    const mb = (bytes / 1e6).toFixed(1);
    setSqlMsg(`Would scan ≈ ${mb} MB ${withinLimit ? '(within limit)' : '(EXCEEDS limit)'}`, withinLimit ? 'ok' : 'err');
  } catch (e) { setSqlMsg(e.message, 'err'); }
}

function setSqlMsg(msg, cls) { const m = $('#sqlMsg'); m.textContent = msg; m.className = 'sql-msg ' + (cls || ''); }

function renderGenericTable(sel, rows) {
  if (!rows.length) { $(sel).innerHTML = '<div class="empty">Query returned no rows.</div>'; return; }
  const cols = Object.keys(rows[0]);
  const head = cols.map((c) => `<th>${c}</th>`).join('');
  const body = rows.slice(0, 1000).map((r) => '<tr>' + cols.map((c) => {
    const v = val(r[c]);
    const isNum = typeof v === 'number';
    return `<td class="${isNum ? 'num' : ''}">${v == null ? '—' : (isNum ? num(v) : String(v))}</td>`;
  }).join('') + '</tr>').join('');
  const note = rows.length > 1000 ? `<div class="hint" style="padding:8px 12px">Showing first 1,000 of ${num(rows.length)} rows. Export for the full set.</div>` : '';
  $(sel).innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${note}`;
}

// ====================================================================
//  EXPORTS
// ====================================================================

// Portfolio PDF column picker. 'Fund Name' isn't listed — it's always kept
// server-side as the row identity column.
const PDF_COLS_KEY = 'sk_pdf_cols';
const PDF_COLUMNS = [
  { key: 'fund_type', label: 'Fund Type' },
  { key: 'unit', label: 'Unit Balance' },
  { key: 'avg_buy_price', label: 'Average NAV' },
  { key: 'nav', label: 'Close NAV' },
  { key: 'fund_value', label: 'Fund Value' },
  { key: 'value', label: 'Market Value' },
  { key: 'gain_loss', label: 'Unrealized Gain/Loss' },
  { key: 'gain_pct', label: '%' },
];

function loadPdfColumnPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PDF_COLS_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (e) { /* corrupt or missing prefs — fall back to all columns */ }
  return PDF_COLUMNS.map((c) => c.key);
}

// Shared by the Portfolio tab (#pfPdfCols) and Portfolio Explorer (#pePdfCols)
// — same column set and localStorage prefs, just two picker widgets.
function renderPdfColumnPicker(containerId = 'pfPdfCols') {
  const checked = new Set(loadPdfColumnPrefs());
  $('#' + containerId).innerHTML = PDF_COLUMNS.map((c) =>
    `<label class="ask-table-chk"><input type="checkbox" value="${c.key}" ${checked.has(c.key) ? 'checked' : ''}> ${c.label}</label>`).join('');
}

function savePdfColumnPrefs(containerId = 'pfPdfCols') {
  localStorage.setItem(PDF_COLS_KEY, JSON.stringify($$('#' + containerId + ' input:checked').map((el) => el.value)));
}

// null (all columns picked) keeps the request body free of a redundant list.
function selectedPdfColumns() {
  const picked = loadPdfColumnPrefs();
  return picked.length === PDF_COLUMNS.length ? null : ['fund', ...picked];
}

// The server watermarks the actual filename with username + timestamp (see
// server/app.js's filenameWithUser) via Content-Disposition — read it back
// here instead of the plain name the caller asked for, or the watermark
// would never make it into the downloaded file's name.
function filenameFromResponse(res, fallback) {
  const m = (res.headers.get('content-disposition') || '').match(/filename="?([^"]+)"?/);
  return m ? m[1] : fallback;
}

async function download(body, filename) {
  const res = await fetch(API_BASE + '/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.error || 'Export failed'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filenameFromResponse(res, filename); a.click();
  URL.revokeObjectURL(url);
  toast('Export ready');
}

// ====================================================================
//  ASK (natural language)
// ====================================================================
let askSqlCache = '';
let askTablesLoaded = false;
let askRowsCache = [];
let lastAskQuestion = '';
// Conversation history for follow-up questions ("now split that by month") —
// sent back to the server so the model can see what "that" refers to.
let askHistory = [];

// Renders the running conversation as a numbered list of past questions, with
// its own header explaining what's going on (this is the thing people found
// confusing: a plain "New" button next to Ask, with no indication anything
// was being remembered) and the reset action right there instead of off in
// the ask-bar looking like a third, unrelated button.
function renderAskThread() {
  const el = $('#askThread');
  el.innerHTML = '';
  if (!askHistory.length) {
    el.classList.add('hidden');
    $('#askHint').textContent = t('ask_hint_default');
    return;
  }
  el.classList.remove('hidden');
  $('#askHint').textContent = t('ask_hint_followup').replace('{n}', askHistory.length);

  const head = document.createElement('div');
  head.className = 'ask-thread-head';
  const title = document.createElement('span');
  title.className = 'ask-thread-title';
  title.textContent = t('ask_conversation_count').replace('{n}', askHistory.length).replace('{s}', askHistory.length === 1 ? '' : 's');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-ghost';
  resetBtn.id = 'askNewChat';
  resetBtn.title = t('ask_new_chat_title');
  resetBtn.textContent = t('ask_new_chat_btn');
  resetBtn.addEventListener('click', clearAskConversation);
  head.appendChild(title);
  head.appendChild(resetBtn);
  el.appendChild(head);

  const list = document.createElement('div');
  list.className = 'ask-thread-list';
  askHistory.forEach((h, i) => {
    const row = document.createElement('div');
    row.className = 'ask-thread-item';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${i + 1}.`;
    row.appendChild(n);
    row.appendChild(document.createTextNode(h.question));
    list.appendChild(row);
  });
  el.appendChild(list);
}

function clearAskConversation() {
  askHistory = [];
  renderAskThread();
}

function setAskMsg(msg, cls) { const m = $('#askMsg'); m.textContent = msg || ''; m.className = 'sql-msg ' + (cls || ''); }

async function loadAskTables() {
  if (askTablesLoaded) return;
  askTablesLoaded = true;
  try {
    const res = await fetch(API_BASE + '/api/ask/tables', { headers: authHeaders() });
    const data = await res.json();
    $('#askTables').innerHTML = (data.tables || [])
      .map((t) => `<label class="ask-table-chk"><input type="checkbox" value="${t}"> ${t}</label>`)
      .join('');
  } catch (e) { /* table picker is optional; silently skip on failure */ }
}

function selectedAskTables() {
  return $$('#askTables input:checked').map((el) => el.value);
}

// Reads the Ask tab's superuser-only "include restricted columns" control.
// Shared by runAsk (the LLM-generated query) and runAskSql (the edited
// re-run), since both ultimately hit an ask-redaction-aware endpoint.
function askUnredactBody() {
  const unredact = $('#askUnredact').checked;
  const password = $('#askUnredactPassword').value;
  return unredact ? { unredact: true, password } : {};
}

async function runAsk(q) {
  const question = (q != null ? q : $('#askInput').value).trim();
  if (!question) return;
  if (q != null) $('#askInput').value = question;
  const unredactBody = askUnredactBody();
  if (unredactBody.unredact && !unredactBody.password) {
    setAskMsg('Enter your password to include restricted columns.', 'err');
    return;
  }
  lastAskQuestion = question;
  setAskMsg('Thinking…', '');
  $('#askResult').innerHTML = '<div class="loading">Generating SQL and querying BigQuery…</div>';
  $('#askSql').classList.add('hidden');
  $('#askChartControls').classList.add('hidden');
  $('#askChartWrap').classList.add('hidden');
  setAskEditable(false);
  $('#askCsv').disabled = $('#askXlsx').disabled = true;
  try {
    const tables = selectedAskTables();
    const free = $('#askContext').value.trim();
    const context = [
      tables.length ? `Limit to these tables: ${tables.join(', ')}` : '',
      free,
    ].filter(Boolean).join('\n');
    const res = await fetch(API_BASE + '/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ question, context: context || undefined, history: askHistory, ...unredactBody }),
    });
    const data = await res.json().catch(() => ({}));
    // Show the generated SQL even if it was blocked, so the user can see it.
    // Some answers (e.g. the dashboard's own activity log) never touch
    // BigQuery at all, so there's no SQL — keep the box hidden for those.
    if (data.sql) { askSqlCache = data.sql; $('#askSqlText').value = data.sql; $('#askSql').classList.remove('hidden'); }
    else { askSqlCache = ''; $('#askSql').classList.add('hidden'); }
    if (!res.ok) { $('#askResult').innerHTML = ''; setAskMsg(data.error || 'Request failed', 'err'); return; }
    $('#askInput').value = '';
    renderGenericTable('#askResult', data.rows || []);
    const c = data.count || 0;
    setAskMsg(`${num(c)} row${c === 1 ? '' : 's'}`, 'ok');
    // CSV/XLSX export re-runs askSqlCache server-side against BigQuery, so it
    // can't work for a non-SQL answer even though there are rows to show.
    $('#askCsv').disabled = $('#askXlsx').disabled = (data.rows || []).length === 0 || !data.sql;
    // Only SQL-backed turns join the follow-up conversation — there's no SQL
    // to hand back to the model as an assistant turn otherwise.
    if (data.sql) {
      askHistory = [...askHistory, { question, sql: data.sql }].slice(-6);
      renderAskThread();
    }
    prepareAskChart(data.rows || []);
  } catch (e) {
    $('#askResult').innerHTML = '';
    setAskMsg(e.message, 'err');
  } finally {
    // Never keep a typed password around longer than the one request it authorized.
    $('#askUnredactPassword').value = '';
  }
}

function setAskEditable(on) {
  $('#askSqlText').toggleAttribute('readonly', !on);
  $('#askEdit').textContent = on ? 'Done' : 'Edit';
  if (on) $('#askSqlText').focus();
}

function copyAskSql() {
  navigator.clipboard.writeText($('#askSqlText').value).then(() => toast('SQL copied'));
}

// Runs whatever is currently in the SQL box (edited or not) via the same
// read-only SQL Lab endpoint, so a tweaked query (e.g. an extra column) can
// be re-run without going through the model again.
async function runAskSql() {
  const sql = $('#askSqlText').value.trim();
  if (!sql) return;
  const unredactBody = askUnredactBody();
  if (unredactBody.unredact && !unredactBody.password) {
    setAskMsg('Enter your password to include restricted columns.', 'err');
    return;
  }
  askSqlCache = sql;
  setAskMsg('Running…', '');
  $('#askResult').innerHTML = '<div class="loading">Executing query…</div>';
  $('#askCsv').disabled = $('#askXlsx').disabled = true;
  try {
    const { rows, count } = await api('/api/sql/run', { method: 'POST', body: JSON.stringify({ sql, ...unredactBody }) });
    renderGenericTable('#askResult', rows);
    setAskMsg(`${num(count)} row${count === 1 ? '' : 's'}`, 'ok');
    $('#askCsv').disabled = $('#askXlsx').disabled = rows.length === 0;
    prepareAskChart(rows);
  } catch (e) {
    $('#askResult').innerHTML = '';
    setAskMsg(e.message, 'err');
  } finally {
    $('#askUnredactPassword').value = '';
  }
}

// The four accent colors this app's theme actually defines (see readThemeColors
// above) — an explicit allowlist rather than trusting a raw `C[key]` lookup,
// since that would also resolve to inherited Object properties (e.g. a
// "__proto__" key) for anything not a real palette entry.
const ASK_CHART_COLOR_KEYS = ['indigo', 'amber', 'teal', 'rose'];
function resolveAskChartColor(key) { return ASK_CHART_COLOR_KEYS.includes(key) ? C[key] : C.indigo; }
function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return `rgba(30,42,74,${alpha})`;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---- Chart: Claude picks a type/x/y(/color), or the user overrides them by hand ----
function buildAskChartConfig(type, rows, x, y, label, colorKey) {
  const capped = rows.slice(0, 50);
  const color = resolveAskChartColor(colorKey);
  if (type === 'scatter') {
    return { type: 'scatter', data: { datasets: [{ label: label || `${y} vs ${x}`,
      data: capped.map((r) => ({ x: Number(val(r[x])) || 0, y: Number(val(r[y])) || 0 })),
      backgroundColor: color }] },
      options: { maintainAspectRatio: false,
        scales: { x: { title: { display: true, text: x } }, y: { title: { display: true, text: y } } } } };
  }
  const labels = capped.map((r) => String(val(r[x]) ?? ''));
  const values = capped.map((r) => Number(val(r[y])) || 0);
  if (type === 'pie' || type === 'doughnut') {
    return { type, data: { labels, datasets: [{ data: values, backgroundColor: pie() }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } };
  }
  return { type, data: { labels, datasets: [{ label: label || y, data: values,
      backgroundColor: type === 'bar' ? color : hexToRgba(color, .12), borderColor: color,
      fill: type === 'line', tension: .3 }] },
    options: { maintainAspectRatio: false,
      scales: { y: { grid: { color: C.grid } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } } } };
}

function populateAskChartFields(rows, spec) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const opts = cols.map((c) => `<option value="${c}">${c}</option>`).join('');
  $('#askChartX').innerHTML = opts;
  $('#askChartY').innerHTML = opts;
  if (spec && cols.includes(spec.x)) $('#askChartX').value = spec.x;
  if (spec && cols.includes(spec.y)) $('#askChartY').value = spec.y;
}

// Set by the last chart suggestion (if it named a color) and reused on every
// re-render — e.g. dragging the X/Y dropdowns afterward keeps the requested
// color instead of reverting to the default on the very next redraw.
let askChartColor = null;

function renderAskChart() {
  const type = $('#askChartType').value;
  const x = $('#askChartX').value, y = $('#askChartY').value;
  if (type === 'none' || !askRowsCache.length || !x || !y) { $('#askChartWrap').classList.add('hidden'); return; }
  $('#askChartWrap').classList.remove('hidden');
  paint('askChart', buildAskChartConfig(type, askRowsCache, x, y, undefined, askChartColor));
}

function setAskChartMsg(text, isProblem) {
  const el = $('#askChartMsg');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
  el.classList.toggle('err', !!isProblem);
}

// Caches new rows and reveals the chart controls, but does NOT call Claude —
// charting only happens when the user clicks "Suggest" or picks a type by
// hand, instead of firing an extra model call on every question automatically.
function prepareAskChart(rows) {
  askRowsCache = rows || [];
  $('#askChartType').value = 'none';
  askChartColor = null;
  setAskChartMsg('');
  if (!askRowsCache.length) {
    $('#askChartControls').classList.add('hidden');
    $('#askChartWrap').classList.add('hidden');
    return;
  }
  $('#askChartControls').classList.remove('hidden');
  populateAskChartFields(askRowsCache);
  renderAskChart();
}

// Asks Claude to suggest a chart type/x/y for the current rows; only called
// from the explicit "✨ Suggest" button, never automatically. `hint` carries
// an optional free-text ask (e.g. "as a donut chart"). If the model can't
// (or won't) honor the request, it always comes back with a plain-language
// "reason" instead of silently doing nothing — show that instead of leaving
// the person guessing why nothing changed.
async function suggestAskChart(question, rows, hint) {
  askRowsCache = rows || [];
  if (!askRowsCache.length) {
    $('#askChartControls').classList.add('hidden');
    $('#askChartWrap').classList.add('hidden');
    setAskChartMsg('');
    return;
  }
  $('#askChartControls').classList.remove('hidden');
  populateAskChartFields(askRowsCache);
  try {
    const spec = await api('/api/ask/chart', {
      method: 'POST',
      body: JSON.stringify({ question, rows: askRowsCache.slice(0, 50), hint }),
    });
    const validTypes = $$('#askChartType option').map((o) => o.value);
    const type = validTypes.includes(spec.type) ? spec.type : 'none';
    $('#askChartType').value = type;
    askChartColor = ASK_CHART_COLOR_KEYS.includes(spec.color) ? spec.color : null;
    populateAskChartFields(askRowsCache, spec);
    setAskChartMsg(spec.reason || '', type === 'none');
  } catch (e) {
    $('#askChartType').value = 'none';
    askChartColor = null;
    setAskChartMsg(e.message || 'Could not get a chart suggestion — try again.', true);
  }
  renderAskChart();
}

// ====================================================================
//  ADMIN (superuser only — manage dashboard accounts + tab permissions)
// ====================================================================
// Derives the tab list from the nav itself (id + visible label) rather than
// hardcoding a second copy — adding a tab to the nav automatically makes it
// selectable here too.
function allTabs() {
  return $$('.nav-link[data-tab]')
    .filter((t) => !SUPERUSER_ONLY_TABS.includes(t.dataset.tab) && !ALWAYS_ALLOWED_TABS.includes(t.dataset.tab))
    .map((t) => ({ id: t.dataset.tab, label: t.textContent.trim() }));
}

function renderAdminTabsPicker(selected = []) {
  const checked = new Set(selected);
  $('#adminTabsPicker').innerHTML = allTabs().map((t) =>
    `<label class="ask-table-chk"><input type="checkbox" value="${t.id}" ${checked.has(t.id) ? 'checked' : ''}> ${t.label}</label>`
  ).join('');
}

let editingUserId = null;

function resetAdminForm() {
  editingUserId = null;
  $('#adminFormTitle').textContent = t('admin_add_user_title');
  $('#adminSaveBtn').textContent = t('admin_create_user');
  $('#adminUsername').value = '';
  $('#adminUsername').disabled = false;
  $('#adminPassword').value = '';
  $('#adminPassword').placeholder = t('gate_password_ph');
  $('#adminIsSuperuser').checked = false;
  $('#adminFormErr').textContent = '';
  renderAdminTabsPicker([]);
}

function startEditUser(user) {
  editingUserId = user.id;
  $('#adminFormTitle').textContent = `${t('admin_edit_user_prefix')} ${user.username}`;
  $('#adminSaveBtn').textContent = t('admin_save_changes');
  $('#adminUsername').value = user.username;
  $('#adminUsername').disabled = true; // username is immutable once created
  $('#adminPassword').value = '';
  $('#adminPassword').placeholder = t('admin_password_keep_current_ph');
  $('#adminIsSuperuser').checked = user.isSuperuser;
  $('#adminFormErr').textContent = '';
  renderAdminTabsPicker(user.allowedTabs || []);
}

let adminUsersCache = [];

function renderAdminUsers(users) {
  const labelFor = (id) => (allTabs().find((t) => t.id === id) || {}).label || id;
  const accessCell = (u) => {
    if (u.isSuperuser) return '<span class="tag completed">Superuser</span>';
    const tabs = u.allowedTabs || [];
    if (!tabs.length) return '—';
    return `<div class="access-list">${tabs.map((id) => `<span class="tag other">${labelFor(id)}</span>`).join('')}</div>`;
  };
  const body = users.map((u) => `
    <tr>
      <td>${u.username}</td>
      <td>${accessCell(u)}</td>
      <td class="mono">${String(u.createdAt || '').slice(0, 10)}</td>
      <td>
        <div class="dropdown-multi row-actions">
          <button type="button" class="dropdown-multi-btn row-menu-btn" data-row-menu="${u.id}" aria-label="Actions">⚙</button>
          <div class="dropdown-multi-panel menu-sm">
            <button type="button" class="row-menu-item" data-edit="${u.id}">Edit access</button>
            <button type="button" class="row-menu-item danger" data-delete="${u.id}" data-username="${u.username}">Delete</button>
          </div>
        </div>
      </td>
    </tr>`).join('');
  $('#adminUsersTable').innerHTML = `<table>
    <thead><tr><th>Username</th><th>Access</th><th>Created</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
  adminUsersCache = users;
  $$('#adminUsersTable .row-menu-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = b.nextElementSibling;
    const wasOpen = panel.classList.contains('open');
    $$('#adminUsersTable .dropdown-multi-panel.open').forEach((p) => p.classList.remove('open'));
    if (!wasOpen) panel.classList.add('open');
  }));
  $$('#adminUsersTable [data-edit]').forEach((b) => b.addEventListener('click', () => {
    const u = adminUsersCache.find((x) => x.id === b.dataset.edit);
    if (u) { startEditUser(u); $('#adminUserModal').showModal(); }
  }));
  $$('#adminUsersTable [data-delete]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete user "${b.dataset.username}"? This can't be undone.`)) return;
    try {
      await api(`/api/admin/users/${b.dataset.delete}`, { method: 'DELETE' });
      if (editingUserId === b.dataset.delete) resetAdminForm();
      loadAdminUsers();
    } catch (e) { toast(e.message); }
  }));
}

async function loadAdminUsers() {
  $('#adminUsersTable').innerHTML = '<div class="loading">Loading users…</div>';
  try {
    const users = await api('/api/admin/users');
    renderAdminUsers(users);
  } catch (e) { $('#adminUsersTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

async function saveAdminUser() {
  const username = $('#adminUsername').value.trim();
  const password = $('#adminPassword').value;
  const isSuperuser = $('#adminIsSuperuser').checked;
  const allowedTabs = $$('#adminTabsPicker input:checked').map((el) => el.value);
  $('#adminFormErr').textContent = '';
  if (!editingUserId && (!username || !password)) {
    $('#adminFormErr').textContent = 'Username and password are required.';
    return;
  }
  try {
    if (editingUserId) {
      const patch = { isSuperuser, allowedTabs };
      if (password) patch.password = password;
      await api(`/api/admin/users/${editingUserId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      toast('User updated');
    } else {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, password, isSuperuser, allowedTabs }) });
      toast('User created');
    }
    $('#adminUserModal').close();
    resetAdminForm();
    loadAdminUsers();
  } catch (e) { $('#adminFormErr').textContent = e.message; }
}

// Supabase stores created_at in UTC; the team reads the activity log from
// Jakarta, so render it in Asia/Jakarta (GMT+7) instead of raw UTC.
function toJakartaTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v ?? '');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

let adminAuditUsersLoaded = false;

// Populates the "filter by user" dropdown from the same account list the
// Admin tab manages — cached like loadAskTables() so re-opening the tab
// doesn't refetch it every time.
async function loadAdminAuditUserOptions() {
  if (adminAuditUsersLoaded) return;
  adminAuditUsersLoaded = true;
  try {
    const users = await api('/api/admin/users');
    const sel = $('#adminAuditUser');
    const opts = users.map((u) => `<option value="${u.username}">${u.username}</option>`).join('');
    sel.insertAdjacentHTML('beforeend', opts);
  } catch { /* dropdown is a filter convenience; silently skip on failure */ }
}

async function loadAdminAuditLog() {
  $('#adminAuditTable').innerHTML = '<div class="loading">Loading activity…</div>';
  const qs = new URLSearchParams({ limit: 200 });
  const user = $('#adminAuditUser').value;
  const search = $('#adminAuditSearch').value.trim();
  const from = $('#adminAuditFrom').value;
  const to = $('#adminAuditTo').value;
  if (user) qs.set('user', user);
  if (search) qs.set('search', search);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  try {
    const rows = await api(`/api/admin/audit-log?${qs}`);
    const mapped = rows.map((r) => ({ ...r, created_at: toJakartaTime(val(r.created_at)) }));
    genTable('#adminAuditTable', mapped, [
      { key: 'created_at', label: 'Time (WIB)' },
      { key: 'username', label: 'User' },
      { key: 'action', label: 'Action' },
      { key: 'detail', label: 'Detail' },
    ], 'No activity matches these filters.');
  } catch (e) { $('#adminAuditTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function wireAdmin() {
  renderAdminTabsPicker([]);
  $('#adminAddUserBtn').addEventListener('click', () => {
    resetAdminForm();
    $('#adminUserModal').showModal();
  });
  $('#adminSaveBtn').addEventListener('click', saveAdminUser);
  $('#adminCancelEditBtn').addEventListener('click', () => $('#adminUserModal').close());
  $('#adminUserModal').addEventListener('close', resetAdminForm);
  // Click on the backdrop (the dialog element itself, outside its content box) dismisses it.
  $('#adminUserModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.row-actions')) $$('#adminUsersTable .dropdown-multi-panel.open').forEach((p) => p.classList.remove('open'));
  });
  $('#adminAuditRefresh').addEventListener('click', loadAdminAuditLog);
  $('#adminAuditApply').addEventListener('click', loadAdminAuditLog);
  $('#adminAuditUser').addEventListener('change', loadAdminAuditLog);
  $('#adminAuditSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAdminAuditLog(); });
}

// ---------- change own password (sidebar) ----------
function wireChangePassword() {
  $('#changePwBtn').addEventListener('click', () => {
    $('#changePwPanel').classList.toggle('hidden');
    $('#changePwCurrent').focus();
  });
  $('#changePwSave').addEventListener('click', async () => {
    const currentPassword = $('#changePwCurrent').value;
    const newPassword = $('#changePwNew').value;
    $('#changePwErr').textContent = '';
    if (!currentPassword || !newPassword) { $('#changePwErr').textContent = 'Both fields are required.'; return; }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      $('#changePwCurrent').value = ''; $('#changePwNew').value = '';
      $('#changePwPanel').classList.add('hidden');
      toast('Password updated');
    } catch (e) { $('#changePwErr').textContent = e.message; }
  });
}

// ====================================================================
//  WIRING
// ====================================================================
// Set on login/session-restore (applyPermissions) — null until then.
let currentUser = null;
// Visible to every logged-in user regardless of their allowedTabs — it's a
// plain-language help page, not sensitive data, so there's no reason to
// gate it like the rest of the tabs.
const ALWAYS_ALLOWED_TABS = ['docs'];
function userCan(tab) {
  if (!currentUser) return false;
  if (ALWAYS_ALLOWED_TABS.includes(tab)) return true;
  if (currentUser.isSuperuser) return true;
  return (currentUser.allowedTabs || []).includes(tab);
}

// Wraps each nav-link's trailing label text in its own <span> once, on init —
// so CSS can hide just the text (not the icon) when the sidebar is collapsed
// to icon-only mode, and so a hover tooltip can show it then too. The
// breadcrumb below reads from this same span, so there's one source of truth
// for "this nav-link's label" instead of a parallel name-mapping table.
function wrapNavLabels() {
  $$('.nav-link').forEach((link) => {
    const label = Array.from(link.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent.trim()).join(' ');
    Array.from(link.childNodes).forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
    const span = document.createElement('span');
    span.className = 'nav-label-text';
    span.textContent = label;
    link.appendChild(span);
    link.setAttribute('aria-label', label);
    link.addEventListener('mouseenter', () => showNavTooltip(link, label));
    link.addEventListener('mouseleave', hideNavTooltip);
  });
}

// Only meaningful when the sidebar is icon-only (mini) mode — the label is
// already visible next to the icon otherwise. Positioned with the viewport
// (not the link's own offset parent) because .nav's overflow-y:auto for the
// scrollable tab list also clips horizontal overflow, which would hide an
// absolutely-positioned tooltip poking out past the sidebar's edge.
function showNavTooltip(link, label) {
  // The collapsed class persists across sessions regardless of viewport, but
  // icon-only mode (and thus the need for a tooltip) is desktop-only — on a
  // narrow screen the sidebar reverts to its normal full-label drawer.
  if (window.matchMedia('(max-width: 900px)').matches) return;
  if (!$('#appShell').classList.contains('sidebar-collapsed')) return;
  const r = link.getBoundingClientRect();
  const tip = $('#navTooltip');
  tip.textContent = label;
  tip.style.left = `${r.right + 10}px`;
  tip.style.top = `${r.top + r.height / 2}px`;
  tip.style.transform = 'translateY(-50%)';
  tip.classList.add('show');
}
function hideNavTooltip() { $('#navTooltip').classList.remove('show'); }

function switchTab(name) {
  // Real enforcement is the backend 403 on every route — this is just UX
  // polish so a restricted user never even sees a tab they can't use.
  if (!userCan(name)) return;
  $$('.nav-link').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === name));
  $('#appShell').classList.remove('nav-open'); // close the mobile drawer after navigating
  // Navbar breadcrumb/page title — reuses the matching nav-link's own label.
  const activeLink = $$('.nav-link').find((t) => t.dataset.tab === name);
  if (activeLink) {
    $('#pageTitle').textContent = activeLink.querySelector('.nav-label-text')?.textContent || '';
  }
  if (name === 'explorer' && !ex.meta.length) loadExplorerMeta();
  if (name === 'aum' && !aumCache.length) loadAumHistory();
  if (name === 'performance' && !perfCache.length) loadPerformance();
  if (name === 'performance' && !perfDetailCache.length) loadPerformanceDetail();
  if (name === 'performance' && !perfTrendLoaded) { loadPerfTrendTypes(); loadPerfTrendFunds(); loadPerfTrend(); }
  if (name === 'growth' && !growthLoaded) loadGrowth();
  if (name === 'reconciliation') loadReconciliation();
  if (name === 'revenue') loadRevenue();
  if (name === 'revenue2') loadRevenue2();
  if (name === 'predict' && !predictLoaded) loadPredict();
  if (name === 'overview' && !overviewLoaded) loadOverview();
  if (name === 'hnwi') loadHnwi();
  if (name === 'admin') loadAdminUsers();
  if (name === 'activity-log') { loadAdminAuditUserOptions(); loadAdminAuditLog(); }
}

// Called once after login/session-restore: hides nav links + the Admin group
// the current user isn't allowed to see, and lands on the first tab they can
// actually use (the HTML defaults to "portfolio" active, which may not be
// permitted).
const SUPERUSER_ONLY_TABS = ['admin', 'activity-log'];
function applyPermissions(user) {
  currentUser = user;
  $('#userBadgeName').textContent = user.username + (user.isSuperuser ? ' (superuser)' : '');
  $('#userAvatar').textContent = user.username.slice(0, 2).toUpperCase();
  $('#adminNavGroup').classList.toggle('hidden', !user.isSuperuser);
  $('#askActivityLogChip').classList.toggle('hidden', !user.isSuperuser);
  $('#docsAdminSection').classList.toggle('hidden', !user.isSuperuser);
  $('#sqlUnredactRow').classList.toggle('hidden', !user.isSuperuser);
  $('#askUnredactRow').classList.toggle('hidden', !user.isSuperuser);
  $$('.nav-link[data-tab]').forEach((t) => {
    const allowed = SUPERUSER_ONLY_TABS.includes(t.dataset.tab) ? user.isSuperuser : userCan(t.dataset.tab);
    t.classList.toggle('hidden', !allowed);
  });
  // Hide a whole nav-group (its section label included) when every link in
  // it is hidden, so a narrowly-scoped user doesn't see empty headers.
  $$('.nav-group').forEach((g) => {
    const links = Array.from(g.querySelectorAll('.nav-link[data-tab]'));
    if (links.length) g.classList.toggle('hidden', links.every((t) => t.classList.contains('hidden')));
  });
  const active = document.querySelector('.view.active');
  if (active && !userCan(active.id)) {
    const first = $$('.nav-link[data-tab]').find((t) => !t.classList.contains('hidden'));
    if (first) switchTab(first.dataset.tab);
  }
}

// Re-render whatever charts are on the currently visible tab with fresh theme
// colors. Cheap dashboard queries only, scoped to the one tab the user is
// looking at — not a full-page reload, and not every tab's data at once.
function repaintActiveTab() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  switch (active.id) {
    case 'overview': overviewLoaded = false; loadOverview(); break;
    case 'aum': aumCache = []; loadAumHistory(); break;
    case 'growth': growthLoaded = false; loadGrowth(); break;
    case 'predict': predictLoaded = false; loadPredict(); break;
    case 'performance': renderPerfTrendChart(perfTrendCache); break;
    case 'portfolio': if (pfSelected) loadPortfolioUser(); break;
  }
}

// ---------- theme: Auto (follows the OS/browser setting) / Light / Dark ----------
const THEME_KEY = 'sk_theme';
const osDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');
const getThemeChoice = () => localStorage.getItem(THEME_KEY) || 'auto';
const resolveTheme = (choice) => (choice === 'auto' ? (osDarkMedia.matches ? 'dark' : 'light') : choice);

function syncThemeSeg(choice) {
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.themeChoice === choice));
}
function applyTheme(choice) {
  document.documentElement.setAttribute('data-theme', resolveTheme(choice));
  syncThemeSeg(choice);
  C = readThemeColors();
  applyChartDefaults();
  repaintActiveTab();
}
function setThemeChoice(choice) {
  localStorage.setItem(THEME_KEY, choice);
  applyTheme(choice);
}
// "Auto" means live-follow the OS, not just "whatever it was at page load" —
// so flip with it if the user changes their system theme mid-session.
osDarkMedia.addEventListener('change', () => { if (getThemeChoice() === 'auto') applyTheme('auto'); });

// Collapsible sidebar groups (click the group label to fold it away) —
// remembered per group across reloads, same localStorage pattern as the
// sidebar-collapsed and theme choices above.
const NAV_GROUPS_COLLAPSED_KEY = 'sk_nav_groups_collapsed';
function loadCollapsedGroups() {
  try { return new Set(JSON.parse(localStorage.getItem(NAV_GROUPS_COLLAPSED_KEY)) || []); } catch { return new Set(); }
}
function wireNavGroups() {
  const collapsed = loadCollapsedGroups();
  $$('.nav-group[data-group]').forEach((g) => {
    if (collapsed.has(g.dataset.group)) g.classList.add('collapsed');
    g.querySelector('.nav-label').addEventListener('click', () => {
      g.classList.toggle('collapsed');
      const now = loadCollapsedGroups();
      if (g.classList.contains('collapsed')) now.add(g.dataset.group); else now.delete(g.dataset.group);
      localStorage.setItem(NAV_GROUPS_COLLAPSED_KEY, JSON.stringify([...now]));
    });
  });
}

const SIDEBAR_COLLAPSED_KEY = 'sk_sidebar_collapsed';
function wire() {
  wrapNavLabels();
  wireNavGroups();
  $$('.nav-link').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => setThemeChoice(b.dataset.themeChoice)));
  $$('#langSeg button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  // One hamburger, two jobs depending on viewport — a persistent icon-only
  // sidebar on desktop (remembered across reloads, like the theme choice),
  // an off-canvas drawer on mobile (never remembered — always starts closed).
  if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') $('#appShell').classList.add('sidebar-collapsed');
  $('#navToggle').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      $('#appShell').classList.toggle('nav-open');
    } else {
      const collapsed = $('#appShell').classList.toggle('sidebar-collapsed');
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    }
  });
  // Tapping the dimmed backdrop (mobile drawer) closes it.
  $('#appShell').addEventListener('click', (e) => {
    if (e.target.id === 'appShell' || (!e.target.closest('.sidebar') && !e.target.closest('.nav-toggle'))) {
      $('#appShell').classList.remove('nav-open');
    }
  });

  // portfolio
  $('#pfSearchBtn').addEventListener('click', searchPortfolioUsers);
  $('#pfSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPortfolioUsers(); });
  // filename/body carry the currently viewed date (if any) so an export
  // matches whatever's on screen, not always the live holdings.
  const pfFilename = () => `portfolio_${pfSelected.sid}${pfSelected.date ? '_' + pfSelected.date : ''}`;
  const pfExportBody = () => ({ userId: pfSelected.userId, sid: pfSelected.sid, ...(pfSelected.date ? { date: pfSelected.date } : {}) });
  $('#pfCsv').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'csv', filename: pfFilename(), ...pfExportBody() },
    `${pfFilename()}.csv`));
  $('#pfXlsx').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'xlsx', filename: pfFilename(), ...pfExportBody() },
    `${pfFilename()}.xlsx`));
  renderPdfColumnPicker('pfPdfCols');
  $('#pfPdfCols').addEventListener('change', () => savePdfColumnPrefs('pfPdfCols'));
  $('#pfPdfColsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#pfPdfColsPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#pfPdfColsDropdown')) $('#pfPdfColsPanel').classList.remove('open');
  });
  $('#pfPdf').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'pdf', filename: pfFilename(), ...pfExportBody(), columns: selectedPdfColumns() },
    `${pfFilename()}.pdf`));
  $('#pfPdfOnly').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'pdf', filename: pfFilename(), ...pfExportBody(), includePerformance: false, columns: selectedPdfColumns() },
    `${pfFilename()}.pdf`));
  $('#pfDateApply').addEventListener('click', loadPortfolioUser);

  // portfolio explorer (goal_snapshots)
  $('#peSearchBtn').addEventListener('click', searchExplorerUsers);
  $('#peSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchExplorerUsers(); });
  // Explicit "Go" rather than firing on every `change` — a native date input
  // fires `change` per field segment in some browsers, mid-edit.
  $('#peDateApply').addEventListener('click', loadExplorerPortfolio);
  $('#peCsv').addEventListener('click', () => peSelected && download(
    { source: 'portfolio_explorer_full', format: 'csv', filename: `portfolio_explorer_${peSelected.sid}_${peSelected.date}`, userId: peSelected.userId, date: peSelected.date },
    `portfolio_explorer_${peSelected.sid}_${peSelected.date}.csv`));
  $('#peXlsx').addEventListener('click', () => peSelected && download(
    { source: 'portfolio_explorer_full', format: 'xlsx', filename: `portfolio_explorer_${peSelected.sid}_${peSelected.date}`, userId: peSelected.userId, date: peSelected.date },
    `portfolio_explorer_${peSelected.sid}_${peSelected.date}.xlsx`));
  renderPdfColumnPicker('pePdfCols');
  $('#pePdfCols').addEventListener('change', () => savePdfColumnPrefs('pePdfCols'));
  $('#pePdfColsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#pePdfColsPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#pePdfColsDropdown')) $('#pePdfColsPanel').classList.remove('open');
  });
  $('#pePdf').addEventListener('click', () => peSelected && download(
    { source: 'portfolio_explorer_full', format: 'pdf', filename: `portfolio_explorer_${peSelected.sid}_${peSelected.date}`, userId: peSelected.userId, date: peSelected.date, columns: selectedPdfColumns() },
    `portfolio_explorer_${peSelected.sid}_${peSelected.date}.pdf`));
  $('#pePdfOnly').addEventListener('click', () => peSelected && download(
    { source: 'portfolio_explorer_full', format: 'pdf', filename: `portfolio_explorer_${peSelected.sid}_${peSelected.date}`, userId: peSelected.userId, date: peSelected.date, includePerformance: false, columns: selectedPdfColumns() },
    `portfolio_explorer_${peSelected.sid}_${peSelected.date}.pdf`));

  // HNWI
  $('#hnwiApply').addEventListener('click', loadHnwi);
  $('#hnwiTotalCsv').addEventListener('click', () => { const p = hnwiParams(); download({ source: 'hnwi_total', format: 'csv', filename: 'hnwi_total', ...p }, 'hnwi_total.csv'); });
  $('#hnwiTotalXlsx').addEventListener('click', () => { const p = hnwiParams(); download({ source: 'hnwi_total', format: 'xlsx', filename: 'hnwi_total', ...p }, 'hnwi_total.xlsx'); });
  $('#hnwiByFundCsv').addEventListener('click', () => { const p = hnwiParams(); download({ source: 'hnwi_by_fund', format: 'csv', filename: 'hnwi_by_fund', ...p }, 'hnwi_by_fund.csv'); });
  $('#hnwiByFundXlsx').addEventListener('click', () => { const p = hnwiParams(); download({ source: 'hnwi_by_fund', format: 'xlsx', filename: 'hnwi_by_fund', ...p }, 'hnwi_by_fund.xlsx'); });

  $('#apply').addEventListener('click', () => { if ($('#overview').classList.contains('active')) loadOverview(); if ($('#explorer').classList.contains('active')) { ex.offset = 0; loadExplore(); } if ($('#aum').classList.contains('active')) loadAumHistory(); if ($('#reconciliation').classList.contains('active')) loadReconciliation(); });
  $('#revApply').addEventListener('click', loadRevenue);
  $('#rev2Apply').addEventListener('click', loadRevenue2);

  // predict
  $('#fcHorizon').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#fcHorizon button').forEach((x) => x.classList.toggle('on', x === b));
    fcHorizon = parseInt(b.dataset.h, 10); loadAumForecast(); loadTxForecast();
  });
  $('#churnCsv').addEventListener('click', () => download({ source: 'churn_risk', format: 'csv', filename: 'churn_risk', limit: 5000 }, 'churn_risk.csv'));
  $('#churnXlsx').addEventListener('click', () => download({ source: 'churn_risk', format: 'xlsx', filename: 'churn_risk', limit: 5000 }, 'churn_risk.xlsx'));

  // aum history
  $('#aumGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#aumGran button').forEach((x) => x.classList.toggle('on', x === b));
    aumGran = b.dataset.g; loadAumHistory();
  });
  $('#aumCsv').addEventListener('click', () => { const r = currentRange(); download({ source: 'aum_history', format: 'csv', filename: 'aum_history', from: r.from, to: r.to, granularity: aumGran }, 'aum_history.csv'); });
  $('#aumXlsx').addEventListener('click', () => { const r = currentRange(); download({ source: 'aum_history', format: 'xlsx', filename: 'aum_history', from: r.from, to: r.to, granularity: aumGran }, 'aum_history.xlsx'); });

  // product performance
  $('#perfCsv').addEventListener('click', () => download({ source: 'product_performance', format: 'csv', filename: 'product_performance' }, 'product_performance.csv'));
  $('#perfXlsx').addEventListener('click', () => download({ source: 'product_performance', format: 'xlsx', filename: 'product_performance' }, 'product_performance.xlsx'));
  $('#perfTypeFilter').addEventListener('change', renderPerformanceDetail);
  $('#perfDetailSearch').addEventListener('input', renderPerformanceDetail);
  $('#perfTrendType').addEventListener('change', () => { loadPerfTrendFunds(); loadPerfTrend(); });
  $('#perfTrendPeriod').addEventListener('change', loadPerfTrend);
  $('#perfTrendLimit').addEventListener('change', loadPerfTrend);
  $('#perfTrendFunds').addEventListener('change', () => { updatePerfTrendFundsBtn(); loadPerfTrend(); });
  $('#perfTrendFundSearch').addEventListener('input', filterPerfTrendFunds);
  $('#perfTrendFundsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#perfTrendFundsPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#perfTrendFundsDropdown')) $('#perfTrendFundsPanel').classList.remove('open');
  });
  $('#perfDetailCsv').addEventListener('click', () => download({ source: 'product_performance_detail', format: 'csv', filename: 'product_performance_detail' }, 'product_performance_detail.csv'));
  $('#perfDetailXlsx').addEventListener('click', () => download({ source: 'product_performance_detail', format: 'xlsx', filename: 'product_performance_detail' }, 'product_performance_detail.xlsx'));

  // growth
  $('#campCsv').addEventListener('click', () => download({ source: 'campaigns_performance', format: 'csv', filename: 'campaign_performance' }, 'campaign_performance.csv'));
  $('#campXlsx').addEventListener('click', () => download({ source: 'campaigns_performance', format: 'xlsx', filename: 'campaign_performance' }, 'campaign_performance.xlsx'));
  $('#refCsv').addEventListener('click', () => download({ source: 'referrals_top', format: 'csv', filename: 'top_referrers' }, 'top_referrers.csv'));
  $('#refXlsx').addEventListener('click', () => download({ source: 'referrals_top', format: 'xlsx', filename: 'top_referrers' }, 'top_referrers.xlsx'));
  $('#switchCsv').addEventListener('click', () => download({ source: 'switching_pairs', format: 'csv', filename: 'switching_pairs' }, 'switching_pairs.csv'));
  $('#switchXlsx').addEventListener('click', () => download({ source: 'switching_pairs', format: 'xlsx', filename: 'switching_pairs' }, 'switching_pairs.xlsx'));

  // reconciliation
  $('#recCsv').addEventListener('click', () => { const r = currentRange(); download({ source: 'reconciliation', format: 'csv', filename: 'reconciliation', from: r.from, to: r.to }, 'reconciliation.csv'); });
  $('#recXlsx').addEventListener('click', () => { const r = currentRange(); download({ source: 'reconciliation', format: 'xlsx', filename: 'reconciliation', from: r.from, to: r.to }, 'reconciliation.xlsx'); });

  // revenue
  $('#revGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#revGran button').forEach((x) => x.classList.toggle('on', x === b));
    revGran = b.dataset.g; loadRevenue();
  });
  $('#revDetailCsv').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_detail', format: 'csv', filename: 'revenue_detail', ...r, granularity: revGran }, 'revenue_detail.csv'); });
  $('#revDetailXlsx').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_detail', format: 'xlsx', filename: 'revenue_detail', ...r, granularity: revGran, splitBy: $('#revSplitBy').value }, 'revenue_detail.xlsx'); });
  $('#revSummaryCsv').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_summary', format: 'csv', filename: 'revenue_summary', ...r, granularity: revGran }, 'revenue_summary.csv'); });
  $('#revSummaryXlsx').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_summary', format: 'xlsx', filename: 'revenue_summary', ...r, granularity: revGran }, 'revenue_summary.xlsx'); });

  // revenue v2 (goal_snapshots)
  $('#rev2Gran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#rev2Gran button').forEach((x) => x.classList.toggle('on', x === b));
    rev2Gran = b.dataset.g; loadRevenue2();
  });
  $('#rev2DetailCsv').addEventListener('click', () => { const r = rev2Range(); download({ source: 'revenue_v2_detail', format: 'csv', filename: 'revenue_v2_detail', ...r, granularity: rev2Gran }, 'revenue_v2_detail.csv'); });
  $('#rev2DetailXlsx').addEventListener('click', () => { const r = rev2Range(); download({ source: 'revenue_v2_detail', format: 'xlsx', filename: 'revenue_v2_detail', ...r, granularity: rev2Gran, splitBy: $('#rev2SplitBy').value }, 'revenue_v2_detail.xlsx'); });
  $('#rev2SummaryCsv').addEventListener('click', () => { const r = rev2Range(); download({ source: 'revenue_v2_summary', format: 'csv', filename: 'revenue_v2_summary', ...r, granularity: rev2Gran }, 'revenue_v2_summary.csv'); });
  $('#rev2SummaryXlsx').addEventListener('click', () => { const r = rev2Range(); download({ source: 'revenue_v2_summary', format: 'xlsx', filename: 'revenue_v2_summary', ...r, granularity: rev2Gran }, 'revenue_v2_summary.xlsx'); });

  // remisier sharing
  $('#remRun').addEventListener('click', loadRemisier);
  $('#remGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#remGran button').forEach((x) => x.classList.toggle('on', x === b));
    remGranularity = b.dataset.g;
    if ($('#remCode').value.trim()) loadRemisier();
  });
  $('#remDetailCsv').addEventListener('click', () => download(
    { source: 'remisier_revenue_detail', format: 'csv', filename: 'remisier_revenue_detail', ...remParams() }, 'remisier_revenue_detail.csv'));
  $('#remDetailXlsx').addEventListener('click', () => download(
    { source: 'remisier_revenue_detail', format: 'xlsx', filename: 'remisier_revenue_detail', ...remParams() }, 'remisier_revenue_detail.xlsx'));
  $('#remSummaryCsv').addEventListener('click', () => download(
    { source: 'remisier_revenue_summary', format: 'csv', filename: 'remisier_revenue_summary', ...remParams() }, 'remisier_revenue_summary.csv'));
  $('#remSummaryXlsx').addEventListener('click', () => download(
    { source: 'remisier_revenue_summary', format: 'xlsx', filename: 'remisier_revenue_summary', ...remParams() }, 'remisier_revenue_summary.xlsx'));

  // remisier sharing (portfolio_with_code)
  $('#remPwcRun').addEventListener('click', loadRemisierPwc);
  $('#remPwcGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#remPwcGran button').forEach((x) => x.classList.toggle('on', x === b));
    remPwcGranularity = b.dataset.g;
    if ($('#remPwcCode').value.trim()) loadRemisierPwc();
  });
  $('#remPwcDetailCsv').addEventListener('click', () => download(
    { source: 'remisier_revenue_pwc_detail', format: 'csv', filename: 'remisier_revenue_pwc_detail', ...remPwcParams() }, 'remisier_revenue_pwc_detail.csv'));
  $('#remPwcDetailXlsx').addEventListener('click', () => download(
    { source: 'remisier_revenue_pwc_detail', format: 'xlsx', filename: 'remisier_revenue_pwc_detail', ...remPwcParams() }, 'remisier_revenue_pwc_detail.xlsx'));
  $('#remPwcSummaryCsv').addEventListener('click', () => download(
    { source: 'remisier_revenue_pwc_summary', format: 'csv', filename: 'remisier_revenue_pwc_summary', ...remPwcParams() }, 'remisier_revenue_pwc_summary.csv'));
  $('#remPwcSummaryXlsx').addEventListener('click', () => download(
    { source: 'remisier_revenue_pwc_summary', format: 'xlsx', filename: 'remisier_revenue_pwc_summary', ...remPwcParams() }, 'remisier_revenue_pwc_summary.xlsx'));

  // remisier transactions
  $('#remTxRun').addEventListener('click', () => { remTx.offset = 0; loadRemTx(); });
  $('#remTxPrev').addEventListener('click', () => { remTx.offset = Math.max(0, remTx.offset - remTx.limit); loadRemTx(); });
  $('#remTxNext').addEventListener('click', () => { remTx.offset += remTx.limit; loadRemTx(); });
  $('#remTxCsv').addEventListener('click', () => download(
    { source: 'remisier_transactions', format: 'csv', filename: 'remisier_transactions', ...remTxParams() }, 'remisier_transactions.csv'));
  $('#remTxXlsx').addEventListener('click', () => download(
    { source: 'remisier_transactions', format: 'xlsx', filename: 'remisier_transactions', ...remTxParams() }, 'remisier_transactions.xlsx'));

  $('#gran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#gran button').forEach((x) => x.classList.toggle('on', x === b));
    loadTrends(b.dataset.g);
  });

  // explorer (multi-table) — sub-tabs, filters and export buttons are wired dynamically
  $('#exPrev').addEventListener('click', () => { ex.offset = Math.max(0, ex.offset - ex.limit); loadExplore(); });
  $('#exNext').addEventListener('click', () => { ex.offset += ex.limit; loadExplore(); });

  // top funds export (dedicated source — a proper query builder server-side,
  // not raw client SQL, so this doesn't need SQL Lab-level access)
  $$('[data-export="topfunds"]').forEach((b) => b.addEventListener('click', () => {
    const fmt = b.dataset.fmt;
    download({ source: 'growth_top_funds', format: fmt, filename: 'top_funds' }, `top_funds.${fmt}`);
  }));

  // ask
  $('#askAdvanced').addEventListener('toggle', (e) => { if (e.target.open) loadAskTables(); });
  $('#askBtn').addEventListener('click', () => runAsk());
  $('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk(); });
  $('#askCopy').addEventListener('click', copyAskSql);
  $('#askEdit').addEventListener('click', () => setAskEditable($('#askSqlText').hasAttribute('readonly')));
  $('#askRun').addEventListener('click', () => runAskSql());
  $('#askChartType').addEventListener('change', renderAskChart);
  $('#askChartX').addEventListener('change', renderAskChart);
  $('#askChartY').addEventListener('change', renderAskChart);
  $('#askChartSuggest').addEventListener('click', () =>
    suggestAskChart(lastAskQuestion, askRowsCache, $('#askChartHint').value.trim()));
  // Example chips are standalone demo questions, not a continuation of
  // whatever's currently being asked about — start a fresh conversation.
  $$('#ask .chip').forEach((c) => c.addEventListener('click', () => { clearAskConversation(); runAsk(c.textContent); }));
  $('#askCsv').addEventListener('click', () => askSqlCache && download({ source: 'ask_result', format: 'csv', filename: 'ask_result', sql: askSqlCache, limit: 100000 }, 'ask_result.csv'));
  $('#askXlsx').addEventListener('click', () => askSqlCache && download({ source: 'ask_result', format: 'xlsx', filename: 'ask_result', sql: askSqlCache, limit: 100000 }, 'ask_result.xlsx'));

  // sql lab
  $('#sqlRun').addEventListener('click', runSql);
  $('#sqlEst').addEventListener('click', estimateSql);
  $('#sqlUnredact').addEventListener('change', (e) => {
    $('#sqlUnredactPassword').classList.toggle('hidden', !e.target.checked);
    if (!e.target.checked) $('#sqlUnredactPassword').value = '';
  });
  $('#askUnredact').addEventListener('change', (e) => {
    $('#askUnredactPassword').classList.toggle('hidden', !e.target.checked);
    if (!e.target.checked) $('#askUnredactPassword').value = '';
  });
  $('#sqlInput').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSql(); });
  $('#sqlCsv').addEventListener('click', () => download({ source: 'sql', format: 'csv', filename: 'query_result', sql: $('#sqlInput').value, limit: 100000 }, 'query_result.csv'));
  $('#sqlXlsx').addEventListener('click', () => download({ source: 'sql', format: 'xlsx', filename: 'query_result', sql: $('#sqlInput').value, limit: 100000 }, 'query_result.xlsx'));
}

// ---------- login gate ----------
function showGate(err) {
  $('#appShell').classList.add('hidden');
  $('#gate').classList.remove('hidden');
  $('#gate-err').textContent = err || '';
  $('#gate-username').focus();
}
function hideGate() {
  $('#gate').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
}
function wireGate() {
  const submit = async () => {
    const username = $('#gate-username').value.trim();
    const password = $('#gate-input').value;
    if (!username || !password) { $('#gate-err').textContent = 'Enter a username and password.'; return; }
    try {
      const res = await fetch(API_BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('#gate-err').textContent = body.error || 'Incorrect username or password.'; return; }
      setAuth({ token: body.token, user: body.user });
      $('#gate-input').value = '';
      hideGate();
      applyPermissions(body.user);
      boot();
    } catch (e) {
      $('#gate-err').textContent = 'Could not reach the server.';
    }
  };
  $('#gate-btn').addEventListener('click', submit);
  $('#gate-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('#gate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* token already invalid — fine */ }
    clearAuth();
    currentUser = null;
    showGate();
  });
}

// ---------- boot ----------
// Runs once we know who's logged in (fresh login or a restored session).
async function boot() {
  loadRemTxFilterOptions();
  // Overview is the landing tab. If this user isn't allowed on it,
  // applyPermissions() already switched to their first allowed tab (and
  // triggered that tab's own loader) before boot() runs — don't double-load.
  if (document.querySelector('.view.active')?.id === 'overview') loadOverview();
}

let lastConnLive = null;
function setConnStatus(live) {
  lastConnLive = live;
  $('#connDot').classList.toggle('live', live === true);
  $('#connDot').classList.toggle('down', live === false);
  $('#connLabel').textContent = live === true ? t('conn_live') : live === false ? t('conn_down') : t('conn_checking');
}
// i18n.js calls this after a language switch, to re-render text this app
// builds dynamically in JS rather than via a static data-i18n attribute.
window.onLanguageChange = () => { setConnStatus(lastConnLive); renderAskThread(); repaintActiveTab(); };

async function pollHealth() {
  try {
    const h = await api('/api/health');
    setConnStatus(!!h.bigquery);
  } catch { setConnStatus(false); }
}

async function init() {
  const r = defaultRange();
  $('#from').value = r.from; $('#to').value = r.to;
  $('#revFrom').value = r.from; $('#revTo').value = r.to;
  $('#rev2From').value = r.from; $('#rev2To').value = r.to;
  $('#remFrom').value = r.from; $('#remTo').value = r.to;
  $('#remTxFrom').value = r.from; $('#remTxTo').value = r.to;
  syncThemeSeg(getThemeChoice());
  translatePage();
  syncLangSeg(getLang());
  wire(); wireGate(); wireAdmin(); wireChangePassword();

  // Health is the one route that doesn't need a session — check it either way.
  try {
    const h = await api('/api/health');
    setConnStatus(!!h.bigquery);
    setInterval(pollHealth, 30000);
    const askOn = !!h.askEnabled;
    $('#askDisabled').classList.toggle('hidden', askOn);
    $('#askBox').classList.toggle('hidden', !askOn);
  } catch { setConnStatus(false); }

  const auth = getAuth();
  if (!auth) { showGate(); return; }
  try {
    const me = await api('/api/auth/me');
    hideGate();
    applyPermissions(me.user);
    boot();
  } catch {
    clearAuth();
    showGate();
  }
}

init();
