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
function ulRange() {
  return {
    from: $('#ulFrom').value, to: $('#ulTo').value,
    fund: $('#ulFund').value.trim(), mi: $('#ulMi').value.trim(),
    sid: $('#ulSid').value.trim(), limit: Number($('#ulLimit').value) || 200,
  };
}
function crRange() {
  return { from: $('#crFrom').value, to: $('#crTo').value, promo: $('#crPromo').value.trim() };
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
// opts.selectable adds a per-row "include in export" checkbox (used by
// Portfolio (Fix) so dust holdings can be excluded from CSV/XLSX/PDF without
// hiding them from the on-screen table); opts.excluded is the Set of fund
// names currently unchecked.
function holdingsTableHtml(rows, { selectable = false, excluded = new Set() } = {}) {
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
    const fund = val(h.fund);
    const chkTd = selectable
      ? `<td><input type="checkbox" class="hld-export-chk" data-fund="${String(fund).replace(/"/g, '&quot;')}" ${excluded.has(fund) ? '' : 'checked'}></td>`
      : '';
    return `<tr>
      ${chkTd}
      <td>${fund}</td>
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
  const chkTh = selectable ? '<th>Export</th>' : '';
  return `<table><thead><tr>
      ${chkTh}<th>Fund</th><th>Type</th><th class="num">Unit Balance</th><th class="num">Average NAV</th><th class="num">Close NAV</th><th class="num">Fund Value</th><th class="num">Market Value</th><th class="num">Unrealized G/L</th><th class="num">%</th>
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
//  PORTFOLIO (FIX) — same feature/logic as Portfolio (PWC) above, but the
//  as-of-date snapshot reads from mi_fee_logs.portfolio_fix (unit-weighted
//  avg_buy_price) instead of portfolio_with_code.
// ====================================================================
async function searchPfxUsers() {
  const q = $('#pfxSearchInput').value.trim();
  if (!q) return;
  $('#pfxResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPfxResults(rows);
  } catch (e) { $('#pfxResults').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPfxResults(rows) {
  if (!rows.length) { $('#pfxResults').innerHTML = '<div class="empty">No matching investor.</div>'; return; }
  const body = rows.map((r) => `<tr class="pfx-row" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${val(r.name) || ''}" data-email="${val(r.email) || ''}" style="cursor:pointer">
      <td>${val(r.sid) || '—'}</td><td>${val(r.name) || '—'}</td><td>${val(r.email) || '—'}</td><td>${val(r.ifua) || '—'}</td>
    </tr>`).join('');
  $('#pfxResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#pfxResults .pfx-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPfxUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
}

let pfxSelected = null; // { userId, sid, name, date } — used by the export buttons

async function selectPfxUser(userId, sid, name, email) {
  pfxSelected = { userId, sid, name: name || sid, date: '' };
  $('#pfxDetail').classList.remove('hidden');
  $('#pfxUserName').textContent = name || sid;
  $('#pfxUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#pfxDate').value = '';
  await loadPfxUser();
}

async function loadPfxUser() {
  if (!pfxSelected) return;
  const { userId, sid } = pfxSelected;
  const dateVal = $('#pfxDate').value;
  $('#pfxKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#pfxHoldings').innerHTML = '';
  $('#pfxPerformance').innerHTML = '';
  pfxSelected.excludedFunds = null; // re-derive dust defaults for whatever holdings this load returns
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, asOfDate, latestDate } = await api(`/api/portfolio-fix?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    pfxSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate), latest = val(latestDate);
    $('#pfxSnapshotInfo').textContent = asOf
      ? `Snapshot date: ${asOf}${latest && latest !== asOf ? ` (latest available: ${latest})` : ''} — from mi_fee_logs.portfolio_fix.`
      : `Live holdings (current units × today's NAV).${latest ? ` Latest historical snapshot available: ${latest}.` : ''}`;
    renderPfxKpis(holdings, split);
    renderPfxHoldings(holdings);
    renderPfxPerformance(performance);
    renderPfxAumChart(history);
  } catch (e) { $('#pfxKpis').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPfxAumChart(rows) {
  if (!rows.length) { return; }
  paint('pfxAumChart', {
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

function renderPfxKpis(holdings, split) {
  const totalAum = holdings.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  $('#pfxKpis').innerHTML = [
    kpi(t('kpi_total_aum'), idrFull(totalAum), t('kpi_holding_count').replace('{n}', holdings.length).replace('{s}', holdings.length === 1 ? '' : 's'), 'accent'),
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : '—', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : '—', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

function renderPfxHoldings(rows) {
  if (!rows.length) { $('#pfxHoldings').innerHTML = '<div class="empty">No active holdings.</div>'; return; }
  // Dust-sized holdings (≤1 unit) default excluded from export — still shown
  // on screen, just unchecked, since a leftover 1 unit is effectively "not held".
  if (!pfxSelected.excludedFunds) {
    pfxSelected.excludedFunds = new Set(rows.filter((h) => Number(val(h.unit)) <= 1).map((h) => val(h.fund)));
  }
  $('#pfxHoldings').innerHTML = holdingsTableHtml(rows, { selectable: true, excluded: pfxSelected.excludedFunds });
  $$('#pfxHoldings .hld-export-chk').forEach((chk) => chk.addEventListener('change', () => {
    if (chk.checked) pfxSelected.excludedFunds.delete(chk.dataset.fund);
    else pfxSelected.excludedFunds.add(chk.dataset.fund);
  }));
}

function renderPfxPerformance(rows) {
  if (!rows.length) { $('#pfxPerformance').innerHTML = '<div class="empty">No AUM history for this SID.</div>'; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">—</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#pfxPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// ====================================================================
//  PORTFOLIO (TX) — holdings with avg_buy_price computed from the
//  transaction ledger instead of portfolios.initial_price. As-of-date
//  reconstructs units/average purely from transactions up to that date;
//  bonus holdings only ever show in the live view (no bonus history exists).
//  AUM chart/performance reuse portfolio_fix (market-value history, never
//  affected by the cost-basis bug).
// ====================================================================
async function searchPtxUsers() {
  const q = $('#ptxSearchInput').value.trim();
  if (!q) return;
  $('#ptxResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPtxResults(rows);
  } catch (e) { $('#ptxResults').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPtxResults(rows) {
  if (!rows.length) { $('#ptxResults').innerHTML = '<div class="empty">No matching investor.</div>'; return; }
  const body = rows.map((r) => `<tr class="ptx-row" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${val(r.name) || ''}" data-email="${val(r.email) || ''}" style="cursor:pointer">
      <td>${val(r.sid) || '—'}</td><td>${val(r.name) || '—'}</td><td>${val(r.email) || '—'}</td><td>${val(r.ifua) || '—'}</td>
    </tr>`).join('');
  $('#ptxResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#ptxResults .ptx-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPtxUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
}

let ptxSelected = null; // { userId, sid, name, excludedFunds } — used by the export buttons

async function selectPtxUser(userId, sid, name, email) {
  ptxSelected = { userId, sid, name: name || sid, date: '', excludedFunds: null };
  $('#ptxDetail').classList.remove('hidden');
  $('#ptxUserName').textContent = name || sid;
  $('#ptxUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#ptxDate').value = '';
  await loadPtxUser();
}

async function loadPtxUser() {
  if (!ptxSelected) return;
  const { userId, sid } = ptxSelected;
  const dateVal = $('#ptxDate').value;
  $('#ptxKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#ptxHoldings').innerHTML = '';
  $('#ptxPerformance').innerHTML = '';
  ptxSelected.excludedFunds = null;
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, asOfDate } = await api(`/api/portfolio-tx?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    ptxSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate);
    $('#ptxSnapshotInfo').textContent = asOf
      ? `As of ${asOf}: units and average buy price reconstructed from transactions up to that date; bonus holdings excluded (no historical data). Use the Export checkbox below to leave a row out of CSV/XLSX/PDF.`
      : `Live holdings (current units × today's NAV). Average buy price is computed from completed buy/SWITCH_IN/reinvestment/transfer_in transactions — sells never change it. Use the Export checkbox below to leave a row out of CSV/XLSX/PDF (e.g. a leftover 1-unit balance).`;
    renderPtxKpis(holdings, split);
    renderPtxHoldings(holdings);
    renderPtxPerformance(performance);
    renderPtxAumChart(history);
  } catch (e) { $('#ptxKpis').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPtxAumChart(rows) {
  if (!rows.length) { return; }
  paint('ptxAumChart', {
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

function renderPtxKpis(holdings, split) {
  const totalAum = holdings.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  // split (and bonus units generally) is only available live — bonus_portfolios
  // has no history, so an as-of-date view can't show a real bonus figure.
  $('#ptxKpis').innerHTML = [
    kpi(t('kpi_total_aum'), idrFull(totalAum), t('kpi_holding_count').replace('{n}', holdings.length).replace('{s}', holdings.length === 1 ? '' : 's'), 'accent'),
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : '—', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : '—', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

function renderPtxHoldings(rows) {
  if (!rows.length) { $('#ptxHoldings').innerHTML = '<div class="empty">No active holdings.</div>'; return; }
  // Dust-sized holdings (≤1 unit) default excluded from export — still shown
  // on screen, just unchecked, since a leftover 1 unit is effectively "not held".
  if (!ptxSelected.excludedFunds) {
    ptxSelected.excludedFunds = new Set(rows.filter((h) => Number(val(h.unit)) <= 1).map((h) => val(h.fund)));
  }
  $('#ptxHoldings').innerHTML = holdingsTableHtml(rows, { selectable: true, excluded: ptxSelected.excludedFunds });
  $$('#ptxHoldings .hld-export-chk').forEach((chk) => chk.addEventListener('change', () => {
    if (chk.checked) ptxSelected.excludedFunds.delete(chk.dataset.fund);
    else ptxSelected.excludedFunds.add(chk.dataset.fund);
  }));
}

function renderPtxPerformance(rows) {
  if (!rows.length) { $('#ptxPerformance').innerHTML = '<div class="empty">No AUM history for this SID.</div>'; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">—</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#ptxPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// ====================================================================
//  PORTFOLIO (SINVEST) — same as Portfolio (TX) above, but holdings are
//  built entirely from the KSEI/SInvest custodian feed (sinvest.trx_history)
//  instead of the app's own transactions table. AUM chart/performance still
//  reuse portfolio_fix, same as Portfolio (TX).
// ====================================================================
async function searchPsiUsers() {
  const q = $('#psiSearchInput').value.trim();
  if (!q) return;
  $('#psiResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPsiResults(rows);
  } catch (e) { $('#psiResults').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPsiResults(rows) {
  if (!rows.length) { $('#psiResults').innerHTML = '<div class="empty">No matching investor.</div>'; return; }
  const body = rows.map((r) => `<tr class="psi-row" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${val(r.name) || ''}" data-email="${val(r.email) || ''}" style="cursor:pointer">
      <td>${val(r.sid) || '—'}</td><td>${val(r.name) || '—'}</td><td>${val(r.email) || '—'}</td><td>${val(r.ifua) || '—'}</td>
    </tr>`).join('');
  $('#psiResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#psiResults .psi-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPsiUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
}

let psiSelected = null; // { userId, sid, name, date, excludedFunds } — used by the export buttons

async function selectPsiUser(userId, sid, name, email) {
  psiSelected = { userId, sid, name: name || sid, date: '', excludedFunds: null };
  $('#psiDetail').classList.remove('hidden');
  $('#psiUserName').textContent = name || sid;
  $('#psiUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#psiDate').value = '';
  await loadPsiUser();
}

async function loadPsiUser() {
  if (!psiSelected) return;
  const { userId, sid } = psiSelected;
  const dateVal = $('#psiDate').value;
  $('#psiKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#psiHoldings').innerHTML = '';
  $('#psiPerformance').innerHTML = '';
  psiSelected.excludedFunds = null;
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, asOfDate } = await api(`/api/portfolio-sinvest?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    psiSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate);
    $('#psiSnapshotInfo').textContent = asOf
      ? `As of ${asOf}: units and average buy price reconstructed from the SInvest custodian feed up to that date; bonus holdings excluded (no historical data). Use the Export checkbox below to leave a row out of CSV/XLSX/PDF.`
      : `Live holdings (current units × today's NAV), built from the KSEI/SInvest custodian feed (sinvest.trx_history) instead of the app's own transactions table. Average buy price only reflects completed BUY/SWITCH_IN/REINVESTMENT/TRANSFER_IN rows — sells never change it. Use the Export checkbox below to leave a row out of CSV/XLSX/PDF.`;
    renderPsiKpis(holdings, split);
    renderPsiHoldings(holdings);
    renderPsiPerformance(performance);
    renderPsiAumChart(history);
  } catch (e) { $('#psiKpis').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderPsiAumChart(rows) {
  if (!rows.length) { return; }
  paint('psiAumChart', {
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

function renderPsiKpis(holdings, split) {
  const totalAum = holdings.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  $('#psiKpis').innerHTML = [
    kpi(t('kpi_total_aum'), idrFull(totalAum), t('kpi_holding_count').replace('{n}', holdings.length).replace('{s}', holdings.length === 1 ? '' : 's'), 'accent'),
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : '—', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : '—', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

function renderPsiHoldings(rows) {
  if (!rows.length) { $('#psiHoldings').innerHTML = '<div class="empty">No active holdings.</div>'; return; }
  if (!psiSelected.excludedFunds) {
    psiSelected.excludedFunds = new Set(rows.filter((h) => Number(val(h.unit)) <= 1).map((h) => val(h.fund)));
  }
  $('#psiHoldings').innerHTML = holdingsTableHtml(rows, { selectable: true, excluded: psiSelected.excludedFunds });
  $$('#psiHoldings .hld-export-chk').forEach((chk) => chk.addEventListener('change', () => {
    if (chk.checked) psiSelected.excludedFunds.delete(chk.dataset.fund);
    else psiSelected.excludedFunds.add(chk.dataset.fund);
  }));
}

function renderPsiPerformance(rows) {
  if (!rows.length) { $('#psiPerformance').innerHTML = '<div class="empty">No AUM history for this SID.</div>'; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">—</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#psiPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
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
let hnwiByFundOwnFilter = false; // tracks which of the two exclusive by-fund modes is active
function hnwiTotalParams() {
  return { date: $('#hnwiDate').value, minAum: $('#hnwiMinAum').value || 0, maxAum: $('#hnwiMaxAum').value || '' };
}
// Per-fund table has two exclusive modes: by default (or when the top
// Filters panel is applied) it inherits the top Min/Max AUM filter and
// ignores its own fields; once its own Apply is clicked, it switches to
// using only its own Min/Max fund AUM fields and ignores the top filter.
function hnwiByFundParams(useOwnFilter) {
  const date = $('#hnwiDate').value;
  if (useOwnFilter) {
    return {
      date, minAum: 0, maxAum: '',
      minFundAum: $('#hnwiMinFundAum').value || 0,
      maxFundAum: $('#hnwiMaxFundAum').value || '',
    };
  }
  return { ...hnwiTotalParams(), minFundAum: 0, maxFundAum: '' };
}
const HNWI_CONTACT_COLS = [
  { key: 'name', label: 'Name' }, { key: 'sid_code', label: 'SID code' }, { key: 'ifua', label: 'IFUA code' },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'birthdate', label: 'Birthdate', type: 'date' },
];
const HNWI_RISK_COLS = [
  { key: 'risk_level', label: 'Risk level' },
  { key: 'investment_priorities', label: 'Investment priorities' },
  { key: 'investment_risk_tolerance', label: 'Investment risk tolerance' },
];
async function hnwiEnsureDate() {
  if (!hnwiDateDefaulted) {
    hnwiDateDefaulted = true;
    try {
      const { latestDate } = await api('/api/hnwi/latest-date');
      if (latestDate && !$('#hnwiDate').value) $('#hnwiDate').value = val(latestDate);
    } catch { /* leave blank — user can still pick a date manually */ }
  }
  return !!$('#hnwiDate').value;
}
async function loadHnwiTotal() {
  if (!(await hnwiEnsureDate())) { $('#hnwiTotalTable').innerHTML = '<div class="empty">Pick a date.</div>'; return; }
  const p = hnwiTotalParams();
  $('#hnwiTotalTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const totals = await api(`/api/hnwi/total?date=${p.date}&minAum=${p.minAum}&maxAum=${p.maxAum}`);
    genTable('#hnwiTotalTable', totals, [
      ...HNWI_CONTACT_COLS, ...HNWI_RISK_COLS,
      { key: 'total_aum', label: 'Total AUM', type: 'idr' }, { key: 'aum_date', label: 'AUM date', type: 'date' },
    ], 'No investors at or above this AUM threshold.');
  } catch (e) {
    $('#hnwiTotalTable').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}
async function loadHnwiByFund(useOwnFilter = hnwiByFundOwnFilter) {
  hnwiByFundOwnFilter = useOwnFilter;
  if (!(await hnwiEnsureDate())) { $('#hnwiByFundTable').innerHTML = '<div class="empty">Pick a date.</div>'; return; }
  const p = hnwiByFundParams(useOwnFilter);
  $('#hnwiByFundTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const byFund = await api(`/api/hnwi/by-fund?date=${p.date}&minAum=${p.minAum}&maxAum=${p.maxAum}&minFundAum=${p.minFundAum}&maxFundAum=${p.maxFundAum}`);
    genTable('#hnwiByFundTable', byFund, [
      ...HNWI_CONTACT_COLS, ...HNWI_RISK_COLS,
      { key: 'fund_name', label: 'Fund' }, { key: 'fund_aum', label: 'Fund AUM', type: 'idr' },
      { key: 'aum_date', label: 'AUM date', type: 'date' }, { key: 'total_aum', label: 'Total AUM', type: 'idr' },
    ], 'No fund holdings at or above this AUM threshold.');
  } catch (e) {
    $('#hnwiByFundTable').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}
function loadHnwi() {
  return Promise.all([loadHnwiTotal(), loadHnwiByFund(false)]);
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
  loadTopFunds();
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
let topFundsGroup = 'fund';
let topFundsDateDefaulted = false;
function renderTopFunds(rows) {
  topFundsCache = rows;
  if (!rows.length) { $('#topFunds').innerHTML = '<div class="empty">No funds.</div>'; return; }
  const nameCol = topFundsGroup === 'manager' ? 'Investment manager' : 'Fund';
  const body = rows.map((f) => `<tr>
      <td>${val(f.label)}</td>
      <td class="num">${idrFull(val(f.aum))}</td>
      <td class="num">${num(val(f.investors))}</td>
    </tr>`).join('');
  $('#topFunds').innerHTML = `<table><thead><tr>
      <th>${nameCol}</th><th class="num">AUM</th><th class="num">Investors</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}
// Fund checklist for the "Select funds" dropdown — every fund starts
// checked (included); unchecking one drops it from the numbers below.
// Rebuilt from the unfiltered by-fund list whenever the date changes,
// preserving whichever funds were already unchecked (by name) across the
// rebuild.
async function loadTopFundsOptions(date) {
  const prevExcluded = new Set(topFundsExcluded());
  let rows = [];
  try { rows = await api(`/api/funds/top?groupBy=fund&date=${date}`); } catch { return; }
  $('#topFundsExcludeList').innerHTML = rows.map((f) => {
    const name = val(f.label);
    return `<label class="ask-table-chk"><input type="checkbox" value="${name}"${prevExcluded.has(name) ? '' : ' checked'}> ${name}</label>`;
  }).join('');
  updateTopFundsExcludeBtn();
}
function topFundsExcluded() {
  return $$('#topFundsExcludeList input:not(:checked)').map((el) => el.value);
}
function updateTopFundsExcludeBtn() {
  const total = $$('#topFundsExcludeList input').length;
  const checked = total - topFundsExcluded().length;
  $('#topFundsExcludeBtn').textContent = checked === total ? 'Select funds' : `${checked} of ${total} selected`;
}
function filterTopFundsExclude() {
  const q = $('#topFundsExcludeSearch').value.trim().toLowerCase();
  $$('#topFundsExcludeList label').forEach((lbl) => {
    lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function loadTopFundsTable() {
  const date = $('#topFundsDate').value;
  if (!date) { $('#topFunds').innerHTML = '<div class="empty">Pick a date.</div>'; return; }
  const exclude = topFundsExcluded();
  const qs = `groupBy=${topFundsGroup}&date=${date}` + (exclude.length ? `&excludeFunds=${encodeURIComponent(exclude.join(','))}` : '');
  api(`/api/funds/top?${qs}`).then(renderTopFunds).catch(() => {});
}
async function loadTopFunds() {
  if (!topFundsDateDefaulted) {
    topFundsDateDefaulted = true;
    try {
      const { latestDate } = await api('/api/funds/top/latest-date');
      if (latestDate && !$('#topFundsDate').value) $('#topFundsDate').value = val(latestDate);
    } catch { /* leave blank — user can still pick a date manually */ }
  }
  const date = $('#topFundsDate').value;
  if (!date) { $('#topFunds').innerHTML = '<div class="empty">Pick a date.</div>'; return; }
  await loadTopFundsOptions(date);
  loadTopFundsTable();
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
//  USER LIFETIME (Revenue (PWC) math per investor + lifetime dates)
// ====================================================================
let ulGran = 'month';
let ulLoaded = false;
let ulSelected = null; // { sid, name } — used by the drill-down + its exports

function renderUlTrend(rows) {
  if (!rows.length) return;
  paint('ulTrendChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.period)),
      datasets: [
        { label: 'AperD share', data: rows.map((d) => Number(val(d.total_aperd_share))), backgroundColor: C.teal, borderRadius: 4, order: 2 },
        { label: 'Investors', data: rows.map((d) => Number(val(d.investors))), type: 'line', yAxisID: 'y1',
          borderColor: C.indigo, backgroundColor: C.indigo, tension: .3, pointRadius: 2, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        y: { grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => num(v) } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: 'bottom' } },
    },
  });
}

const UL_USER_COLS = [
  { key: 'sid_code', label: 'SID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
  { key: 'registered_at', label: 'Registered', type: 'date' },
  { key: 'first_buy', label: 'First buy', type: 'date' },
  { key: 'last_tx', label: 'Last transaction', type: 'date' },
  { key: 'account_age_days', label: 'Account age (d)', type: 'num' },
  { key: 'days_to_first_buy', label: 'Days to first buy', type: 'num' },
  { key: 'tx_span_days', label: 'Transacting span (d)', type: 'num' },
  { key: 'holding_lifetime_days', label: 'Holding lifetime (d)', type: 'num' },
  { key: 'tx_count', label: 'Transactions', type: 'num' },
  { key: 'total_invested', label: 'Lifetime invested', type: 'idr' },
  { key: 'first_hold', label: 'First hold (feed)', type: 'date' },
  { key: 'last_hold', label: 'Last hold (feed)', type: 'date' },
  { key: 'active_days', label: 'Days in range', type: 'num' },
  { key: 'funds', label: 'Funds', type: 'num' },
  { key: 'avg_aum', label: 'Avg AUM', type: 'idr' }, { key: 'last_aum', label: 'Latest AUM', type: 'idr' },
  { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
  { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' },
  { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
];

// Same markup genTable produces, plus a clickable row carrying the SID — the
// drill-down needs one extra query per investor, so it is not prefetched.
function renderUlUsers(rows) {
  genTable('#ulUsersTable', rows, UL_USER_COLS, 'No investor holdings in this range.');
  const tbody = $('#ulUsersTable tbody');
  if (!tbody) return;
  Array.from(tbody.rows).forEach((tr, i) => {
    const r = rows[i];
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => loadUlDetail(val(r.sid_code), val(r.name) || val(r.sid_code)));
  });
}

async function loadUlDetail(sid, name) {
  const r = ulRange();
  ulSelected = { sid, name };
  $('#ulDetailPanel').classList.remove('hidden');
  $('#ulDetailName').textContent = name;
  $('#ulDetailSub').textContent = `SID ${sid} · ${r.from} → ${r.to}`;
  $('#ulDetailTable').innerHTML = '<div class="loading">Loading breakdown…</div>';
  try {
    const rows = await api(`/api/user-lifetime/detail?sid=${encodeURIComponent(sid)}&from=${r.from}&to=${r.to}&granularity=${ulGran}&fund=${encodeURIComponent(r.fund)}&mi=${encodeURIComponent(r.mi)}`);
    genTable('#ulDetailTable', rows, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'fund_name', label: 'Fund' }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'mi_name', label: 'Investment Manager' },
      { key: 'management_fee', label: 'Mgmt fee rate', type: 'num' },
      { key: 'days_running', label: 'Days', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idr' }, { key: 'aum_eop', label: 'AUM end of period', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No holdings for this investor in this range.');
  } catch (e) { $('#ulDetailTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

async function loadUserLifetime() {
  const r = ulRange();
  ulSelected = null;
  $('#ulDetailPanel').classList.add('hidden');
  $('#ulUsersTable').innerHTML = '<div class="loading">Computing per-investor revenue…</div>';
  $('#ulSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  const qs = `from=${r.from}&to=${r.to}&fund=${encodeURIComponent(r.fund)}&mi=${encodeURIComponent(r.mi)}`;
  try {
    const [users, summary] = await Promise.all([
      api(`/api/user-lifetime?${qs}&sid=${encodeURIComponent(r.sid)}&limit=${r.limit}`),
      api(`/api/user-lifetime/summary?${qs}&granularity=${ulGran}`),
    ]);
    renderUlTrend(summary);
    renderUlUsers(users);
    genTable('#ulSummaryTable', summary, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'investors', label: 'Investors', type: 'num' },
      { key: 'days_running', label: 'Days', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idr' },
      { key: 'aperd_per_investor', label: 'AperD per investor', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#ulUsersTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#ulSummaryTable').innerHTML = '';
  }
}

// ====================================================================
//  CAMPAIGN REVENUE (management fee earned on promo-locked units)
// ====================================================================
let crGran = 'month';
let crLoaded = false;

function renderCrTrend(rows) {
  if (!rows.length) return;
  paint('crTrendChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.period)),
      datasets: [
        { label: 'AperD share', data: rows.map((d) => Number(val(d.total_aperd_share))), backgroundColor: C.teal, borderRadius: 4, order: 2 },
        { label: 'AperD share (alt)', data: rows.map((d) => Number(val(d.total_aperd_share_alt))), backgroundColor: C.amber, borderRadius: 4, order: 2 },
        { label: 'Locked AUM', data: rows.map((d) => Number(val(d.avg_aum))), type: 'line', yAxisID: 'y1',
          borderColor: C.indigo, backgroundColor: C.indigo, tension: .3, pointRadius: 2, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        y: { grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => idr(v) } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${idrFull(c.raw)}` } } },
    },
  });
}

async function loadCampaignRevenue() {
  const r = crRange();
  ['#crCampaignsTable', '#crDetailTable', '#crSummaryTable'].forEach((s) =>
    $(s).innerHTML = '<div class="loading">Computing campaign revenue…</div>');
  const qs = `from=${r.from}&to=${r.to}&promo=${encodeURIComponent(r.promo)}`;
  try {
    const [campaigns, detail, summary] = await Promise.all([
      api(`/api/campaign-revenue/campaigns?${qs}`),
      api(`/api/campaign-revenue?${qs}&granularity=${crGran}`),
      api(`/api/campaign-revenue/summary?${qs}&granularity=${crGran}`),
    ]);
    renderCrTrend(summary);
    genTable('#crCampaignsTable', campaigns, [
      { key: 'promo_code', label: 'Promo' }, { key: 'campaign_name', label: 'Campaign' },
      { key: 'campaign_type', label: 'Type' },
      { key: 'start_date', label: 'Starts', type: 'date' }, { key: 'end_date', label: 'Ends', type: 'date' },
      { key: 'holding_date', label: 'Holding until', type: 'date' },
      { key: 'participations', label: 'Participations', type: 'num' },
      { key: 'investors', label: 'Investors', type: 'num' },
      { key: 'still_locked', label: 'Still locked', type: 'num' },
      { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'first_lock', label: 'First lock', type: 'date' },
      { key: 'days_running', label: 'Days', type: 'num' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' },
      { key: 'total_aperd_share_alt', label: 'Total AperD (alt)', type: 'idr' },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
      { key: 'est_cost', label: 'Est. cost', type: 'idr' },
      { key: 'net_vs_cost', label: 'Net vs cost', type: 'idr' },
    ], 'No campaign holdings in this range.');
    genTable('#crDetailTable', detail, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'promo_code', label: 'Promo' }, { key: 'campaign_name', label: 'Campaign' },
      { key: 'participations', label: 'Participations', type: 'num' },
      { key: 'investors', label: 'Investors', type: 'num' },
      { key: 'still_locked', label: 'Still locked', type: 'num' },
      { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'days_running', label: 'Days', type: 'num' },
      { key: 'avg_units', label: 'Avg units', type: 'num' },
      { key: 'avg_aum', label: 'Avg locked AUM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' },
      { key: 'total_aperd_share_alt', label: 'Total AperD (alt)', type: 'idr' },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No campaign holdings in this range.');
    genTable('#crSummaryTable', summary, [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'campaigns', label: 'Campaigns', type: 'num' },
      { key: 'participations', label: 'Participations', type: 'num' },
      { key: 'investors', label: 'Investors', type: 'num' },
      { key: 'days_running', label: 'Days', type: 'num' },
      { key: 'avg_aum', label: 'Avg locked AUM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' },
      { key: 'total_aperd_share_alt', label: 'Total AperD (alt)', type: 'idr' },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No campaign holdings in this range.');
  } catch (e) {
    $('#crCampaignsTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#crDetailTable').innerHTML = '';
    $('#crSummaryTable').innerHTML = '';
  }
}

// ====================================================================
//  REFERRAL PROGRAM (Sep-Dec 2026 T&C eligibility report)
// ====================================================================
let refProgLoaded = false;

function refProgRange() {
  return { from: $('#refProgFrom').value || '2026-09-01', to: $('#refProgTo').value || '2026-12-31' };
}

async function loadReferralProgram() {
  $('#refProgTable').innerHTML = '<div class="loading">Loading…</div>';
  const r = refProgRange();
  try {
    const rows = await api(`/api/referral-program/detail?from=${r.from}&to=${r.to}`);
    renderReferralProgram(rows);
  } catch (e) {
    $('#refProgKpis').innerHTML = '';
    $('#refProgTable').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderReferralProgram(rows) {
  const eligible = rows.filter((r) => r.status === 'Eligible').length;
  const pending = rows.filter((r) => r.status === 'Pending').length;
  const notEligible = rows.filter((r) => r.status === 'Not eligible').length;
  const inviters = new Set(rows.map((r) => val(r.inviter_sid)).filter(Boolean)).size;
  const bonusTotal = eligible * 50000; // Rp25,000 to inviter + Rp25,000 to invitee, per eligible referral.
  $('#refProgKpis').innerHTML = [
    kpi(t('refprog_kpi_inviters'), num(inviters), '', '', '🧑‍🤝‍🧑'),
    kpi(t('refprog_kpi_invitees'), num(rows.length), '', '', '➕'),
    kpi(t('refprog_kpi_eligible'), num(eligible), '', 'accent', '✅'),
    kpi(t('refprog_kpi_pending'), num(pending), '', 'amber', '⏳'),
    kpi(t('refprog_kpi_not_eligible'), num(notEligible), '', 'warn', '🚫'),
    kpi(t('refprog_kpi_bonus_total'), idr(bonusTotal), t('refprog_kpi_bonus_total_sub'), 'accent', '💰'),
  ].join('');

  genTable('#refProgTable', rows, [
    { key: 'inviter_sid', label: 'Inviter SID' }, { key: 'inviter_name', label: 'Inviter name' },
    { key: 'inviter_ifua', label: 'Inviter IFUA' }, { key: 'inviter_email', label: 'Inviter email' },
    { key: 'inviter_phone', label: 'Inviter phone' },
    { key: 'invitee_sid', label: 'Invitee SID' }, { key: 'invitee_name', label: 'Invitee name' },
    { key: 'invitee_ifua', label: 'Invitee IFUA' }, { key: 'invitee_email', label: 'Invitee email' },
    { key: 'invitee_phone', label: 'Invitee phone' },
    { key: 'fund_name', label: 'Fund' }, { key: 'amount', label: 'Amount', type: 'idr' },
    { key: 'tx_date', label: 'Transaction date', type: 'date' }, { key: 'days_held', label: 'Days held', type: 'num' },
    { key: 'baseline_unit', label: 'Baseline units', type: 'num' }, { key: 'min_unit_in_window', label: 'Min units seen', type: 'num' },
    { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason' },
  ], 'No qualifying referrals in this period.');
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

// ---- nested: SInvest transactions (raw KSEI/SInvest custodian feed) -------
const sitx = { limit: 50, offset: 0, total: 0 };
let sitxLoaded = false;

function sitxParams() {
  return {
    sid: $('#sitxSid').value.trim(),
    search: $('#sitxSearch').value.trim(),
    type: $('#sitxType').value,
    from: $('#sitxFrom').value,
    to: $('#sitxTo').value,
  };
}

async function loadSitx() {
  sitxLoaded = true;
  const p = sitxParams();
  $('#sitxTable').innerHTML = '<div class="loading">Loading…</div>';
  const qs = new URLSearchParams();
  if (p.sid) qs.set('sid', p.sid);
  if (p.search) qs.set('search', p.search);
  if (p.type) qs.set('type', p.type);
  if (p.from) qs.set('from', p.from);
  if (p.to) qs.set('to', p.to);
  qs.set('limit', sitx.limit); qs.set('offset', sitx.offset);
  try {
    const { rows, total } = await api(`/api/sinvest-transactions?${qs}`);
    sitx.total = total;
    genTable('#sitxTable', rows, [
      { key: 'transaction_date', label: 'Date', type: 'date' },
      { key: 'type', label: 'Type' },
      { key: 'sid', label: 'SID' }, { key: 'investor_name', label: 'Investor' },
      { key: 'fund_code', label: 'Fund code' }, { key: 'fund_name', label: 'Fund' },
      { key: 'unit', label: 'Unit', type: 'num' },
      { key: 'nav_per_unit', label: 'NAV', type: 'num' },
      { key: 'gross_amount', label: 'Gross amount', type: 'idr' },
      { key: 'fee', label: 'Fee', type: 'idr' },
      { key: 'net_amount', label: 'Net amount', type: 'idr' },
      { key: 'input_date', label: 'Input date', type: 'date' },
      { key: 'reference_no', label: 'Reference #' },
    ], 'No transactions match these filters.');
    const start = total ? sitx.offset + 1 : 0;
    const end = Math.min(sitx.offset + sitx.limit, total);
    $('#sitxPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#sitxPrev').disabled = sitx.offset === 0;
    $('#sitxNext').disabled = end >= total;
  } catch (e) { $('#sitxTable').innerHTML = `<div class="empty">${e.message}</div>`; }
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

// Google Sheet export has no file to hand the browser — the server creates
// the sheet and shares it with the requesting user's own email, then hands
// back its URL to open directly, same button-press UX as download() above.
//
// The tab is opened synchronously, before the `await fetch`, and only
// redirected once the URL comes back — window.open() after an await is no
// longer inside the click's user-activation window, so browsers block the
// navigation and leave it stuck on about:blank instead of an outright
// "popup blocked" warning.
async function pushToSheet(body) {
  const tab = window.open('', '_blank');
  const res = await fetch(API_BASE + '/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...body, format: 'gsheet' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (tab) tab.close();
    toast(data.error || 'Google Sheets export failed');
    return;
  }
  if (tab) tab.location.href = data.url; else window.open(data.url, '_blank');
  toast('Google Sheet ready');
}

// ====================================================================
//  SEND STATEMENT (email an investor their portfolio — holdings only, no
//  fund performance — and/or their monthly transaction e-statement).
//  Separate tab from Portfolio (PWC) on purpose: this is a sending tool,
//  not a lookup dashboard, so it gets its own search + selection state.
// ====================================================================
async function searchSendStatementUsers() {
  const q = $('#ssSearchInput').value.trim();
  if (!q) return;
  $('#ssResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderSsResults(rows);
  } catch (e) { $('#ssResults').innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderSsResults(rows) {
  if (!rows.length) { $('#ssResults').innerHTML = '<div class="empty">No matching investor.</div>'; return; }
  const body = rows.map((r) => `<tr class="pf-row" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${val(r.name) || ''}" data-email="${val(r.email) || ''}" style="cursor:pointer">
      <td>${val(r.sid) || '—'}</td><td>${val(r.name) || '—'}</td><td>${val(r.email) || '—'}</td><td>${val(r.ifua) || '—'}</td>
    </tr>`).join('');
  $('#ssResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#ssResults .pf-row').forEach((tr) => tr.addEventListener('click', () =>
    selectSendStatementUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
}

let ssSelected = null; // { userId, sid, name, email }

function selectSendStatementUser(userId, sid, name, email) {
  ssSelected = { userId, sid, name: name || sid, email };
  $('#ssDetail').classList.remove('hidden');
  $('#ssUserName').textContent = name || sid;
  $('#ssUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#ssPortfolioDate').value = '';
  $('#ssStatementMonth').value = new Date().toISOString().slice(0, 7);
}

// Editable default for the compose modal — the server falls back to similar
// text if subject/body come through blank (see server/mail.js).
function defaultStatementEmail({ name, sendPortfolio, portfolioDate, sendStatement, statementMonth }) {
  const parts = [];
  if (sendPortfolio) parts.push(`your portfolio statement${portfolioDate ? ` as of ${portfolioDate}` : ' (current holdings)'}`);
  let periodLabel = null;
  if (sendStatement) {
    periodLabel = new Date(statementMonth + '-01T00:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' });
    parts.push(`your transaction e-statement for ${periodLabel}`);
  }
  // The subject's month follows the statement being sent, not today's date —
  // falls back to the portfolio date's month, then today, when there's no
  // transaction e-statement to anchor it to.
  if (!periodLabel) {
    const anchor = portfolioDate ? new Date(portfolioDate) : new Date();
    periodLabel = anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }
  return {
    subject: `Your Sayakaya Statement — ${periodLabel}`,
    body: `Dear ${name || 'Investor'},\n\nPlease find attached ${parts.join(' and ')}, issued by PT Sayakaya Lahir Batin.\n\nIf any details appear incorrect, please contact our support team.\n\nBest regards,\nPT Sayakaya Lahir Batin`,
  };
}

async function sendStatementEmail(body) {
  const res = await fetch(API_BASE + '/api/statement/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { toast(data.error || 'Email failed'); return; }
  toast(`Emailed to ${data.to}`);
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

// Same tabs as allTabs(), but grouped and ordered like the sidebar (one
// section per nav-group) instead of one flat list — used only by the access
// picker below; allTabs() stays flat since renderAdminUsers's Access column
// just needs an id -> label lookup.
function allTabsGrouped() {
  return $$('.nav-group[data-group]')
    .filter((g) => g.dataset.group !== 'admin')
    .map((g) => {
      const icon = (t) => t.querySelector('.nav-icon')?.textContent || '';
      return {
        label: g.querySelector('.nav-label span')?.textContent.trim() || g.dataset.group,
        tabs: Array.from(g.querySelectorAll('.nav-link[data-tab]'))
          .filter((t) => !SUPERUSER_ONLY_TABS.includes(t.dataset.tab) && !ALWAYS_ALLOWED_TABS.includes(t.dataset.tab))
          .map((t) => ({ id: t.dataset.tab, icon: icon(t), label: t.textContent.replace(icon(t), '').trim() })),
      };
    })
    .filter((g) => g.tabs.length);
}

function renderAdminTabsPicker(selected = []) {
  const checked = new Set(selected);
  $('#adminTabsPicker').innerHTML = allTabsGrouped().map((g) => `
    <div class="admin-tabs-group">
      <div class="admin-tabs-group-label">${g.label}</div>
      ${g.tabs.map((t) => `<label class="admin-tab-row"><input type="checkbox" value="${t.id}" ${checked.has(t.id) ? 'checked' : ''}><span class="nav-icon">${t.icon}</span>${t.label}</label>`).join('')}
    </div>
  `).join('');
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
  $('#adminEmail').value = '';
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
  $('#adminEmail').value = user.email || '';
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
      <td>${u.email || '—'}</td>
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
    <thead><tr><th>Username</th><th>Email</th><th>Access</th><th>Created</th><th></th></tr></thead>
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
  const email = $('#adminEmail').value.trim();
  const isSuperuser = $('#adminIsSuperuser').checked;
  const allowedTabs = $$('#adminTabsPicker input:checked').map((el) => el.value);
  $('#adminFormErr').textContent = '';
  if (!editingUserId && (!username || !password)) {
    $('#adminFormErr').textContent = 'Username and password are required.';
    return;
  }
  try {
    if (editingUserId) {
      const patch = { email, isSuperuser, allowedTabs };
      if (password) patch.password = password;
      await api(`/api/admin/users/${editingUserId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      toast('User updated');
    } else {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, password, email, isSuperuser, allowedTabs }) });
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
  // Eye-icon show/hide toggle — generic so it works for any .pw-toggle button
  // paired with an input via data-for, not just this one form.
  $$('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#' + btn.dataset.for);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
  $('#changePwSave').addEventListener('click', async () => {
    const currentPassword = $('#changePwCurrent').value;
    const newPassword = $('#changePwNew').value;
    const confirmPassword = $('#changePwConfirm').value;
    $('#changePwErr').textContent = '';
    if (!currentPassword || !newPassword || !confirmPassword) { $('#changePwErr').textContent = 'All fields are required.'; return; }
    if (newPassword !== confirmPassword) { $('#changePwErr').textContent = "New passwords don't match."; return; }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      $('#changePwCurrent').value = ''; $('#changePwNew').value = ''; $('#changePwConfirm').value = '';
      $$('.pw-toggle').forEach((btn) => {
        $('#' + btn.dataset.for).type = 'password';
        btn.textContent = '👁'; btn.setAttribute('aria-label', 'Show password');
      });
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
  if (name === 'sinvest-tx' && !sitxLoaded) loadSitx();
  if (name === 'revenue') loadRevenue();
  if (name === 'revenue2') loadRevenue2();
  // Both are loaded once per session rather than on every visit: User lifetime
  // scans ~3.7 GB of portfolio_with_code per run (the table is unpartitioned,
  // so the date filter prunes nothing). Apply re-runs them on demand.
  if (name === 'user-lifetime' && !ulLoaded) { ulLoaded = true; loadUserLifetime(); }
  if (name === 'campaign-revenue' && !crLoaded) { crLoaded = true; loadCampaignRevenue(); }
  if (name === 'referral-program' && !refProgLoaded) { refProgLoaded = true; loadReferralProgram(); }
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
    case 'portfolio-fix': if (pfxSelected) loadPfxUser(); break;
    case 'portfolio-tx': if (ptxSelected) loadPtxUser(); break;
    case 'portfolio-sinvest': if (psiSelected) loadPsiUser(); break;
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
  $('#pfGsheet').addEventListener('click', () => pfSelected && pushToSheet(
    { source: 'portfolio_full', ...pfExportBody(), columns: selectedPdfColumns() }));
  $('#pfDateApply').addEventListener('click', loadPortfolioUser);

  // send statement
  $('#ssSearchBtn').addEventListener('click', searchSendStatementUsers);
  $('#ssSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchSendStatementUsers(); });
  $('#ssComposeBtn').addEventListener('click', () => {
    if (!ssSelected) return;
    const sendPortfolio = $('#ssSendPortfolio').checked;
    const sendStatement = $('#ssSendStatement').checked;
    if (!sendPortfolio && !sendStatement) { toast('Pick at least one document to send.'); return; }
    const portfolioDate = $('#ssPortfolioDate').value;
    const statementMonth = $('#ssStatementMonth').value;
    if (sendStatement && !statementMonth) { toast('Pick a month for the transaction e-statement.'); return; }
    const { subject, body } = defaultStatementEmail({ name: ssSelected.name, sendPortfolio, portfolioDate, sendStatement, statementMonth });
    $('#ssEmailTo').textContent = `Will be sent to ${ssSelected.name}'s email on file.`;
    $('#ssEmailSubject').value = subject;
    $('#ssEmailBody').value = body;
    $('#ssEmailModal').showModal();
  });
  $('#ssEmailCancelBtn').addEventListener('click', () => $('#ssEmailModal').close());
  $('#ssEmailModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#ssEmailSendBtn').addEventListener('click', () => {
    if (!ssSelected) return;
    $('#ssEmailModal').close();
    sendStatementEmail({
      userId: ssSelected.userId, sid: ssSelected.sid,
      sendPortfolio: $('#ssSendPortfolio').checked, portfolioDate: $('#ssPortfolioDate').value,
      sendStatement: $('#ssSendStatement').checked, statementMonth: $('#ssStatementMonth').value,
      subject: $('#ssEmailSubject').value, body: $('#ssEmailBody').value,
    });
  });

  // portfolio (fix) — same wiring as portfolio (pwc) above, different source table
  $('#pfxSearchBtn').addEventListener('click', searchPfxUsers);
  $('#pfxSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPfxUsers(); });
  const pfxFilename = () => `portfolio_fix_${pfxSelected.sid}${pfxSelected.date ? '_' + pfxSelected.date : ''}`;
  const pfxExportBody = () => ({
    userId: pfxSelected.userId, sid: pfxSelected.sid,
    ...(pfxSelected.date ? { date: pfxSelected.date } : {}),
    ...(pfxSelected.excludedFunds && pfxSelected.excludedFunds.size ? { excludeFunds: [...pfxSelected.excludedFunds] } : {}),
  });
  $('#pfxCsv').addEventListener('click', () => pfxSelected && download(
    { source: 'portfolio_fix_full', format: 'csv', filename: pfxFilename(), ...pfxExportBody() },
    `${pfxFilename()}.csv`));
  $('#pfxXlsx').addEventListener('click', () => pfxSelected && download(
    { source: 'portfolio_fix_full', format: 'xlsx', filename: pfxFilename(), ...pfxExportBody() },
    `${pfxFilename()}.xlsx`));
  renderPdfColumnPicker('pfxPdfCols');
  $('#pfxPdfCols').addEventListener('change', () => savePdfColumnPrefs('pfxPdfCols'));
  $('#pfxPdfColsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#pfxPdfColsPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#pfxPdfColsDropdown')) $('#pfxPdfColsPanel').classList.remove('open');
  });
  $('#pfxPdf').addEventListener('click', () => pfxSelected && download(
    { source: 'portfolio_fix_full', format: 'pdf', filename: pfxFilename(), ...pfxExportBody(), columns: selectedPdfColumns() },
    `${pfxFilename()}.pdf`));
  $('#pfxPdfOnly').addEventListener('click', () => pfxSelected && download(
    { source: 'portfolio_fix_full', format: 'pdf', filename: pfxFilename(), ...pfxExportBody(), includePerformance: false, columns: selectedPdfColumns() },
    `${pfxFilename()}.pdf`));
  $('#pfxGsheet').addEventListener('click', () => pfxSelected && pushToSheet(
    { source: 'portfolio_fix_full', ...pfxExportBody(), columns: selectedPdfColumns() }));
  $('#pfxDateApply').addEventListener('click', loadPfxUser);

  // portfolio (tx) — export carries the as-of date (if any) plus the fund checklist
  $('#ptxSearchBtn').addEventListener('click', searchPtxUsers);
  $('#ptxSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPtxUsers(); });
  const ptxFilename = () => `portfolio_tx_${ptxSelected.sid}${ptxSelected.date ? '_' + ptxSelected.date : ''}`;
  const ptxExportBody = () => ({
    userId: ptxSelected.userId, sid: ptxSelected.sid,
    ...(ptxSelected.date ? { date: ptxSelected.date } : {}),
    ...(ptxSelected.excludedFunds && ptxSelected.excludedFunds.size ? { excludeFunds: [...ptxSelected.excludedFunds] } : {}),
  });
  $('#ptxCsv').addEventListener('click', () => ptxSelected && download(
    { source: 'portfolio_tx_full', format: 'csv', filename: ptxFilename(), ...ptxExportBody() },
    `${ptxFilename()}.csv`));
  $('#ptxXlsx').addEventListener('click', () => ptxSelected && download(
    { source: 'portfolio_tx_full', format: 'xlsx', filename: ptxFilename(), ...ptxExportBody() },
    `${ptxFilename()}.xlsx`));
  renderPdfColumnPicker('ptxPdfCols');
  $('#ptxPdfCols').addEventListener('change', () => savePdfColumnPrefs('ptxPdfCols'));
  $('#ptxPdfColsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#ptxPdfColsPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ptxPdfColsDropdown')) $('#ptxPdfColsPanel').classList.remove('open');
  });
  $('#ptxPdf').addEventListener('click', () => ptxSelected && download(
    { source: 'portfolio_tx_full', format: 'pdf', filename: ptxFilename(), ...ptxExportBody(), columns: selectedPdfColumns() },
    `${ptxFilename()}.pdf`));
  $('#ptxPdfOnly').addEventListener('click', () => ptxSelected && download(
    { source: 'portfolio_tx_full', format: 'pdf', filename: ptxFilename(), ...ptxExportBody(), includePerformance: false, columns: selectedPdfColumns() },
    `${ptxFilename()}.pdf`));
  $('#ptxGsheet').addEventListener('click', () => ptxSelected && pushToSheet(
    { source: 'portfolio_tx_full', ...ptxExportBody(), columns: selectedPdfColumns() }));
  $('#ptxDateApply').addEventListener('click', loadPtxUser);

  // portfolio (sinvest) — same wiring as portfolio (tx), sourced from the custodian feed
  $('#psiSearchBtn').addEventListener('click', searchPsiUsers);
  $('#psiSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPsiUsers(); });
  const psiFilename = () => `portfolio_sinvest_${psiSelected.sid}${psiSelected.date ? '_' + psiSelected.date : ''}`;
  const psiExportBody = () => ({
    userId: psiSelected.userId, sid: psiSelected.sid,
    ...(psiSelected.date ? { date: psiSelected.date } : {}),
    ...(psiSelected.excludedFunds && psiSelected.excludedFunds.size ? { excludeFunds: [...psiSelected.excludedFunds] } : {}),
  });
  $('#psiCsv').addEventListener('click', () => psiSelected && download(
    { source: 'portfolio_sinvest_full', format: 'csv', filename: psiFilename(), ...psiExportBody() },
    `${psiFilename()}.csv`));
  $('#psiXlsx').addEventListener('click', () => psiSelected && download(
    { source: 'portfolio_sinvest_full', format: 'xlsx', filename: psiFilename(), ...psiExportBody() },
    `${psiFilename()}.xlsx`));
  renderPdfColumnPicker('psiPdfCols');
  $('#psiPdfCols').addEventListener('change', () => savePdfColumnPrefs('psiPdfCols'));
  $('#psiPdfColsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#psiPdfColsPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#psiPdfColsDropdown')) $('#psiPdfColsPanel').classList.remove('open');
  });
  $('#psiPdf').addEventListener('click', () => psiSelected && download(
    { source: 'portfolio_sinvest_full', format: 'pdf', filename: psiFilename(), ...psiExportBody(), columns: selectedPdfColumns() },
    `${psiFilename()}.pdf`));
  $('#psiPdfOnly').addEventListener('click', () => psiSelected && download(
    { source: 'portfolio_sinvest_full', format: 'pdf', filename: psiFilename(), ...psiExportBody(), includePerformance: false, columns: selectedPdfColumns() },
    `${psiFilename()}.pdf`));
  $('#psiGsheet').addEventListener('click', () => psiSelected && pushToSheet(
    { source: 'portfolio_sinvest_full', ...psiExportBody(), columns: selectedPdfColumns() }));
  $('#psiDateApply').addEventListener('click', loadPsiUser);

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
  $('#peGsheet').addEventListener('click', () => peSelected && pushToSheet(
    { source: 'portfolio_explorer_full', userId: peSelected.userId, date: peSelected.date, columns: selectedPdfColumns() }));

  // HNWI
  $('#hnwiApply').addEventListener('click', loadHnwi);
  $('#hnwiByFundApply').addEventListener('click', () => loadHnwiByFund(true));
  $('#hnwiTotalCsv').addEventListener('click', () => { const p = hnwiTotalParams(); download({ source: 'hnwi_total', format: 'csv', filename: 'hnwi_total', ...p }, 'hnwi_total.csv'); });
  $('#hnwiTotalXlsx').addEventListener('click', () => { const p = hnwiTotalParams(); download({ source: 'hnwi_total', format: 'xlsx', filename: 'hnwi_total', ...p }, 'hnwi_total.xlsx'); });
  $('#hnwiByFundCsv').addEventListener('click', () => { const p = hnwiByFundParams(hnwiByFundOwnFilter); download({ source: 'hnwi_by_fund', format: 'csv', filename: 'hnwi_by_fund', ...p }, 'hnwi_by_fund.csv'); });
  $('#hnwiByFundXlsx').addEventListener('click', () => { const p = hnwiByFundParams(hnwiByFundOwnFilter); download({ source: 'hnwi_by_fund', format: 'xlsx', filename: 'hnwi_by_fund', ...p }, 'hnwi_by_fund.xlsx'); });

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

  // largest funds by AUM — by fund / by investment manager, as of a date,
  // with an exclude-funds menu (also affects the MI rollup)
  $('#topFundsGroup').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#topFundsGroup button').forEach((x) => x.classList.toggle('on', x === b));
    topFundsGroup = b.dataset.g; loadTopFundsTable();
  });
  $('#topFundsApply').addEventListener('click', () => loadTopFunds());
  $('#topFundsExcludeList').addEventListener('change', () => { updateTopFundsExcludeBtn(); loadTopFundsTable(); });
  $('#topFundsExcludeSearch').addEventListener('input', filterTopFundsExclude);
  $('#topFundsExcludeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#topFundsExcludePanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#topFundsExcludeDropdown')) $('#topFundsExcludePanel').classList.remove('open');
  });

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

  // user lifetime
  $('#ulApply').addEventListener('click', loadUserLifetime);
  $('#ulGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#ulGran button').forEach((x) => x.classList.toggle('on', x === b));
    ulGran = b.dataset.g; loadUserLifetime();
  });
  $('#ulUsersCsv').addEventListener('click', () => { const r = ulRange(); download({ source: 'user_lifetime_users', format: 'csv', filename: 'user_lifetime', ...r }, 'user_lifetime.csv'); });
  $('#ulUsersXlsx').addEventListener('click', () => { const r = ulRange(); download({ source: 'user_lifetime_users', format: 'xlsx', filename: 'user_lifetime', ...r }, 'user_lifetime.xlsx'); });
  $('#ulSummaryCsv').addEventListener('click', () => { const r = ulRange(); download({ source: 'user_lifetime_summary', format: 'csv', filename: 'user_lifetime_summary', ...r, granularity: ulGran }, 'user_lifetime_summary.csv'); });
  $('#ulSummaryXlsx').addEventListener('click', () => { const r = ulRange(); download({ source: 'user_lifetime_summary', format: 'xlsx', filename: 'user_lifetime_summary', ...r, granularity: ulGran }, 'user_lifetime_summary.xlsx'); });
  $('#ulDetailCsv').addEventListener('click', () => ulSelected && download({ source: 'user_lifetime_detail', format: 'csv', filename: `user_lifetime_${ulSelected.sid}`, ...ulRange(), sid: ulSelected.sid, granularity: ulGran }, `user_lifetime_${ulSelected.sid}.csv`));
  $('#ulDetailXlsx').addEventListener('click', () => ulSelected && download({ source: 'user_lifetime_detail', format: 'xlsx', filename: `user_lifetime_${ulSelected.sid}`, ...ulRange(), sid: ulSelected.sid, granularity: ulGran }, `user_lifetime_${ulSelected.sid}.xlsx`));

  // campaign revenue
  $('#crApply').addEventListener('click', loadCampaignRevenue);
  $('#crGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#crGran button').forEach((x) => x.classList.toggle('on', x === b));
    crGran = b.dataset.g; loadCampaignRevenue();
  });
  $('#crCampaignsCsv').addEventListener('click', () => { const r = crRange(); download({ source: 'campaign_revenue_campaigns', format: 'csv', filename: 'campaign_revenue_by_campaign', ...r }, 'campaign_revenue_by_campaign.csv'); });
  $('#crCampaignsXlsx').addEventListener('click', () => { const r = crRange(); download({ source: 'campaign_revenue_campaigns', format: 'xlsx', filename: 'campaign_revenue_by_campaign', ...r }, 'campaign_revenue_by_campaign.xlsx'); });
  $('#crDetailCsv').addEventListener('click', () => { const r = crRange(); download({ source: 'campaign_revenue_detail', format: 'csv', filename: 'campaign_revenue_detail', ...r, granularity: crGran }, 'campaign_revenue_detail.csv'); });
  $('#crDetailXlsx').addEventListener('click', () => { const r = crRange(); download({ source: 'campaign_revenue_detail', format: 'xlsx', filename: 'campaign_revenue_detail', ...r, granularity: crGran, splitBy: $('#crSplitBy').value }, 'campaign_revenue_detail.xlsx'); });
  $('#crSummaryCsv').addEventListener('click', () => { const r = crRange(); download({ source: 'campaign_revenue_summary', format: 'csv', filename: 'campaign_revenue_summary', ...r, granularity: crGran }, 'campaign_revenue_summary.csv'); });
  $('#crSummaryXlsx').addEventListener('click', () => { const r = crRange(); download({ source: 'campaign_revenue_summary', format: 'xlsx', filename: 'campaign_revenue_summary', ...r, granularity: crGran }, 'campaign_revenue_summary.xlsx'); });

  // referral program
  $('#refProgApply').addEventListener('click', loadReferralProgram);
  $('#refProgCsv').addEventListener('click', () => { const r = refProgRange(); download({ source: 'referral_program_detail', format: 'csv', filename: 'referral_program_detail', ...r }, 'referral_program_detail.csv'); });
  $('#refProgXlsx').addEventListener('click', () => { const r = refProgRange(); download({ source: 'referral_program_detail', format: 'xlsx', filename: 'referral_program_detail', ...r }, 'referral_program_detail.xlsx'); });

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

  // sinvest transactions
  $('#sitxRun').addEventListener('click', () => { sitx.offset = 0; loadSitx(); });
  $('#sitxPrev').addEventListener('click', () => { sitx.offset = Math.max(0, sitx.offset - sitx.limit); loadSitx(); });
  $('#sitxNext').addEventListener('click', () => { sitx.offset += sitx.limit; loadSitx(); });
  $('#sitxCsv').addEventListener('click', () => download(
    { source: 'sinvest_transactions', format: 'csv', filename: 'sinvest_transactions', ...sitxParams() }, 'sinvest_transactions.csv'));
  $('#sitxXlsx').addEventListener('click', () => download(
    { source: 'sinvest_transactions', format: 'xlsx', filename: 'sinvest_transactions', ...sitxParams() }, 'sinvest_transactions.xlsx'));

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
    const date = $('#topFundsDate').value;
    if (!date) { toast('Pick a date first.'); return; }
    download({ source: 'growth_top_funds', format: fmt, filename: 'top_funds', groupBy: topFundsGroup, date, excludeFunds: topFundsExcluded() }, `top_funds.${fmt}`);
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
  $('#ulFrom').value = r.from; $('#ulTo').value = r.to;
  $('#crFrom').value = r.from; $('#crTo').value = r.to;
  $('#remFrom').value = r.from; $('#remTo').value = r.to;
  $('#remTxFrom').value = r.from; $('#remTxTo').value = r.to;
  $('#sitxFrom').value = r.from; $('#sitxTo').value = r.to;
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
