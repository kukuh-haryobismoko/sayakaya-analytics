'use strict';

// ---------- tiny helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const PW_KEY = 'sk_app_pw';

// On Netlify this is served same-origin, so relative /api/* paths just work.
// GitHub Pages is static-only — it can't run the Express backend — so this
// mirror calls the live Netlify Functions API instead. Update the hostname
// here if the Netlify site is ever renamed/moved.
const API_BASE = location.hostname.endsWith('.github.io') ? 'https://sayakaya-analytics.netlify.app' : '';

function authHeaders() {
  const pw = sessionStorage.getItem(PW_KEY);
  return pw ? { 'x-app-password': pw } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
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

// Revenue tab has its own month/year filter (native <input type="month">),
// independent of the day-range pickers used everywhere else.
function isoMonth(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function defaultMonthRange() {
  const to = new Date();
  const from = new Date(); from.setMonth(from.getMonth() - 5);
  return { from: isoMonth(from), to: isoMonth(to) };
}
function revRange() {
  const fromM = $('#revFrom').value, toM = $('#revTo').value;
  const [ty, tm] = toM.split('-').map(Number);
  return { from: `${fromM}-01`, to: isoDate(new Date(ty, tm, 0)) }; // tm/0 = last day of month
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

let pfSelected = null; // { userId, sid, name } — used by the export buttons

async function selectPortfolioUser(userId, sid, name, email) {
  pfSelected = { userId, sid, name: name || sid };
  $('#pfDetail').classList.remove('hidden');
  $('#pfUserName').textContent = name || sid;
  $('#pfUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#pfKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#pfHoldings').innerHTML = '';
  $('#pfPerformance').innerHTML = '';
  try {
    const { holdings, split, performance, history } = await api(`/api/portfolio?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}`);
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
  $('#pfKpis').innerHTML = [
    kpi('Total AUM', idrFull(totalAum), `${holdings.length} holding${holdings.length === 1 ? '' : 's'}`, 'accent'),
    kpi('Regular portfolio', idrFull(Number(val(split?.regular_value)) || 0), 'portfolios'),
    kpi('Bonus portfolio', idrFull(Number(val(split?.bonus_value)) || 0), 'bonus_portfolios (on_going)'),
  ].join('');
}

function renderPfHoldings(rows) {
  if (!rows.length) { $('#pfHoldings').innerHTML = '<div class="empty">No active holdings.</div>'; return; }
  const body = rows.map((h) => `<tr>
      <td>${val(h.fund)}</td>
      <td><span class="tag other">${val(h.fund_type)}</span></td>
      <td class="num">${Number(val(h.unit)).toFixed(4)}</td>
      <td class="num">${h.avg_buy_price == null ? '—' : num(val(h.avg_buy_price))}</td>
      <td class="num">${num(val(h.nav))}</td>
      <td class="num">${idrFull(val(h.value))}</td>
    </tr>`).join('');
  $('#pfHoldings').innerHTML = `<table><thead><tr>
      <th>Fund</th><th>Type</th><th class="num">Units</th><th class="num">Avg Buy Price</th><th class="num">NAV</th><th class="num">Value</th>
    </tr></thead><tbody>${body}</tbody></table>`;
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
}

function kpi(label, value, sub, cls = '') {
  return `<div class="kpi ${cls}"><div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div><div class="kpi-sub">${sub || ''}</div></div>`;
}
function renderKpis(o) {
  $('#kpis').innerHTML = [
    kpi('Platform AUM', idr(val(o.platform_aum)), `${num(val(o.investing_users))} investing users`, 'accent'),
    kpi('Total users', num(val(o.total_users)), `${num(val(o.verified_users))} verified (${pct(val(o.verified_users), val(o.total_users))})`),
    kpi('Buy volume (range)', idr(val(o.buy_volume)), `${num(val(o.buy_count))} completed buys`, 'accent'),
    kpi('Sell volume (range)', idr(val(o.sell_volume)), `${num(val(o.sell_count))} completed sells`, 'warn'),
    kpi('Active users (range)', num(val(o.active_users)), 'with ≥1 transaction'),
    kpi('Transactions (range)', num(val(o.total_tx)), 'all statuses'),
    kpi('Active funds', num(val(o.active_funds)), `${num(val(o.total_funds))} total in catalog`),
    kpi('New users (30d)', num(val(o.new_users_30d)), 'rolling window'),
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
        { label: 'Buy volume', data: data.map((d) => val(d.buy_volume)), backgroundColor: C.teal, borderRadius: 4, order: 2 },
        { label: 'Sell volume', data: data.map((d) => val(d.sell_volume)), backgroundColor: C.rose, borderRadius: 4, order: 2 },
        { label: 'Active users', data: data.map((d) => val(d.active_users)), type: 'line', yAxisID: 'y1',
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
      kpi('High risk', num(val(summary.high_risk)), '≥ 50% churn probability', 'warn'),
      kpi('Medium risk', num(val(summary.medium_risk)), '20–50%'),
      kpi('Low risk', num(val(summary.low_risk)), '< 20%', 'accent'),
      kpi('Avg probability', (val(summary.avg_prob) != null ? (val(summary.avg_prob) * 100).toFixed(1) + '%' : '—'), `${num(val(summary.scored))} holders scored`),
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
      kpi('Overall churn rate', churnRate + '%', `${num(val(overall.churned))} of ${num(val(overall.total_investors))} investors fully redeemed`, 'warn'),
      kpi('Active holders', num(val(overall.active_holders)), 'currently hold ≥1 fund', 'accent'),
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
  const numTypes = ['idr', 'num', 'pct'];
  const head = cols.map((c) => `<th class="${numTypes.includes(c.type) ? 'num' : ''}">${c.label}</th>`).join('');
  const body = rows.map((r) => '<tr>' + cols.map((c) => {
    const v = val(r[c.key]);
    let out = v == null ? '—' : v;
    if (c.type === 'idr') out = idrFull(v);
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
      { key: 'app_count', label: 'App tx', type: 'num' }, { key: 'app_amount', label: 'App amount', type: 'idr' },
      { key: 'sinvest_count', label: 'Custodian tx', type: 'num' }, { key: 'sinvest_amount', label: 'Custodian amount', type: 'idr' },
      { key: 'amount_diff', label: 'Diff', type: 'idr' },
    ], 'No data in this range.');
  } catch (e) { $('#recTable').innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ====================================================================
//  REVENUE (management fee earned per fund/month)
// ====================================================================
function renderRevenueTrend(rows) {
  if (!rows.length) return;
  paint('revTrendChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.month)),
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

async function loadRevenue() {
  const r = revRange();
  $('#revDetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#revSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  try {
    const [detail, summary] = await Promise.all([
      api(`/api/revenue?from=${r.from}&to=${r.to}`),
      api(`/api/revenue/summary?from=${r.from}&to=${r.to}`),
    ]);
    renderRevenueTrend(summary);
    genTable('#revDetailTable', detail, [
      { key: 'month', label: 'Month', type: 'date' },
      { key: 'fund_name', label: 'Fund' }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'management_fee', label: 'Mgmt fee rate', type: 'num' },
      { key: 'aperd_share', label: 'AperD share', type: 'num' }, { key: 'mi_share', label: 'MI share', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'avg_aum', label: 'Avg AUM', type: 'idr' }, { key: 'aum_eom', label: 'AUM EOM', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
    genTable('#revSummaryTable', summary, [
      { key: 'month', label: 'Month', type: 'date' }, { key: 'funds', label: 'Funds', type: 'num' },
      { key: 'days_running', label: 'Days running', type: 'num' },
      { key: 'total_aum', label: 'Total AUM (EOM)', type: 'idr' },
      { key: 'total_management_fee', label: 'Total mgmt fee', type: 'idr' },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr' }, { key: 'total_mi_share', label: 'Total MI', type: 'idr' },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#revDetailTable').innerHTML = `<div class="empty">${e.message}</div>`;
    $('#revSummaryTable').innerHTML = '';
  }
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
  setSqlMsg('Running…', '');
  $('#sqlResult').innerHTML = '<div class="loading">Executing query…</div>';
  $('#sqlCsv').disabled = $('#sqlXlsx').disabled = true;
  try {
    const { rows, count } = await api('/api/sql/run', { method: 'POST', body: JSON.stringify({ sql }) });
    sqlCache = rows;
    renderGenericTable('#sqlResult', rows);
    setSqlMsg(`${num(count)} row${count === 1 ? '' : 's'}`, 'ok');
    $('#sqlCsv').disabled = $('#sqlXlsx').disabled = rows.length === 0;
  } catch (e) {
    $('#sqlResult').innerHTML = '';
    setSqlMsg(e.message, 'err');
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
  a.href = url; a.download = filename; a.click();
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

async function runAsk(q) {
  const question = (q != null ? q : $('#askInput').value).trim();
  if (!question) return;
  if (q != null) $('#askInput').value = question;
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
      body: JSON.stringify({ question, context: context || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    // Show the generated SQL even if it was blocked, so the user can see it.
    if (data.sql) { askSqlCache = data.sql; $('#askSqlText').value = data.sql; $('#askSql').classList.remove('hidden'); }
    if (!res.ok) { $('#askResult').innerHTML = ''; setAskMsg(data.error || 'Request failed', 'err'); return; }
    renderGenericTable('#askResult', data.rows || []);
    const c = data.count || 0;
    setAskMsg(`${num(c)} row${c === 1 ? '' : 's'}`, 'ok');
    $('#askCsv').disabled = $('#askXlsx').disabled = (data.rows || []).length === 0;
    suggestAskChart(question, data.rows || []);
  } catch (e) {
    $('#askResult').innerHTML = '';
    setAskMsg(e.message, 'err');
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
  askSqlCache = sql;
  setAskMsg('Running…', '');
  $('#askResult').innerHTML = '<div class="loading">Executing query…</div>';
  $('#askCsv').disabled = $('#askXlsx').disabled = true;
  try {
    const { rows, count } = await api('/api/sql/run', { method: 'POST', body: JSON.stringify({ sql }) });
    renderGenericTable('#askResult', rows);
    setAskMsg(`${num(count)} row${count === 1 ? '' : 's'}`, 'ok');
    $('#askCsv').disabled = $('#askXlsx').disabled = rows.length === 0;
    suggestAskChart(lastAskQuestion, rows);
  } catch (e) {
    $('#askResult').innerHTML = '';
    setAskMsg(e.message, 'err');
  }
}

// ---- Chart: Claude picks a type/x/y, or the user overrides them by hand ----
function buildAskChartConfig(type, rows, x, y, label) {
  const capped = rows.slice(0, 50);
  if (type === 'scatter') {
    return { type: 'scatter', data: { datasets: [{ label: label || `${y} vs ${x}`,
      data: capped.map((r) => ({ x: Number(val(r[x])) || 0, y: Number(val(r[y])) || 0 })),
      backgroundColor: C.indigo }] },
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
      backgroundColor: type === 'bar' ? C.indigo : 'rgba(30,42,74,.08)', borderColor: C.indigo,
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

function renderAskChart() {
  const type = $('#askChartType').value;
  const x = $('#askChartX').value, y = $('#askChartY').value;
  if (type === 'none' || !askRowsCache.length || !x || !y) { $('#askChartWrap').classList.add('hidden'); return; }
  $('#askChartWrap').classList.remove('hidden');
  paint('askChart', buildAskChartConfig(type, askRowsCache, x, y));
}

// Auto-suggests a chart via Claude whenever new rows arrive; `hint` carries
// an optional free-text ask (e.g. "as a pie chart") from the Suggest button.
async function suggestAskChart(question, rows, hint) {
  askRowsCache = rows || [];
  if (!askRowsCache.length) {
    $('#askChartControls').classList.add('hidden');
    $('#askChartWrap').classList.add('hidden');
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
    $('#askChartType').value = validTypes.includes(spec.type) ? spec.type : 'none';
    populateAskChartFields(askRowsCache, spec);
  } catch {
    $('#askChartType').value = 'none';
  }
  renderAskChart();
}

// ====================================================================
//  WIRING
// ====================================================================
function switchTab(name) {
  $$('.nav-link').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === name));
  $('#appShell').classList.remove('nav-open'); // close the mobile drawer after navigating
  if (name === 'explorer' && !ex.meta.length) loadExplorerMeta();
  if (name === 'aum' && !aumCache.length) loadAumHistory();
  if (name === 'performance' && !perfCache.length) loadPerformance();
  if (name === 'performance' && !perfDetailCache.length) loadPerformanceDetail();
  if (name === 'performance' && !perfTrendLoaded) { loadPerfTrendTypes(); loadPerfTrendFunds(); loadPerfTrend(); }
  if (name === 'growth' && !growthLoaded) loadGrowth();
  if (name === 'reconciliation') loadReconciliation();
  if (name === 'revenue') loadRevenue();
  if (name === 'predict' && !predictLoaded) loadPredict();
  if (name === 'overview' && !overviewLoaded) loadOverview();
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
    case 'portfolio': if (pfSelected) selectPortfolioUser(pfSelected.userId, pfSelected.sid, pfSelected.name); break;
  }
}

// ---------- theme toggle ----------
const THEME_KEY = 'sk_theme';
function setThemeButtonLabel() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('#themeIcon').textContent = dark ? '☀️' : '🌙';
  $('#themeLabel').textContent = dark ? 'Light mode' : 'Dark mode';
}
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  setThemeButtonLabel();
  C = readThemeColors();
  applyChartDefaults();
  repaintActiveTab();
}

function wire() {
  $$('.nav-link').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#navToggle').addEventListener('click', () => $('#appShell').classList.toggle('nav-open'));
  // Tapping the dimmed backdrop (mobile drawer) closes it.
  $('#appShell').addEventListener('click', (e) => {
    if (e.target.id === 'appShell' || (!e.target.closest('.sidebar') && !e.target.closest('.nav-toggle'))) {
      $('#appShell').classList.remove('nav-open');
    }
  });

  // portfolio
  $('#pfSearchBtn').addEventListener('click', searchPortfolioUsers);
  $('#pfSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPortfolioUsers(); });
  $('#pfCsv').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'csv', filename: `portfolio_${pfSelected.sid}`, userId: pfSelected.userId, sid: pfSelected.sid },
    `portfolio_${pfSelected.sid}.csv`));
  $('#pfXlsx').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'xlsx', filename: `portfolio_${pfSelected.sid}`, userId: pfSelected.userId, sid: pfSelected.sid },
    `portfolio_${pfSelected.sid}.xlsx`));
  $('#pfPdf').addEventListener('click', () => pfSelected && download(
    { source: 'portfolio_full', format: 'pdf', filename: `portfolio_${pfSelected.sid}`, userId: pfSelected.userId, sid: pfSelected.sid },
    `portfolio_${pfSelected.sid}.pdf`));
  $('#apply').addEventListener('click', () => { if ($('#overview').classList.contains('active')) loadOverview(); if ($('#explorer').classList.contains('active')) { ex.offset = 0; loadExplore(); } if ($('#aum').classList.contains('active')) loadAumHistory(); if ($('#reconciliation').classList.contains('active')) loadReconciliation(); });
  $('#revApply').addEventListener('click', loadRevenue);

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
    $('#perfTrendFundsPanel').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#perfTrendFundsDropdown')) $('#perfTrendFundsPanel').classList.add('hidden');
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
  $('#revDetailCsv').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_detail', format: 'csv', filename: 'revenue_detail', from: r.from, to: r.to }, 'revenue_detail.csv'); });
  $('#revDetailXlsx').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_detail', format: 'xlsx', filename: 'revenue_detail', from: r.from, to: r.to }, 'revenue_detail.xlsx'); });
  $('#revSummaryCsv').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_summary', format: 'csv', filename: 'revenue_summary', from: r.from, to: r.to }, 'revenue_summary.csv'); });
  $('#revSummaryXlsx').addEventListener('click', () => { const r = revRange(); download({ source: 'revenue_summary', format: 'xlsx', filename: 'revenue_summary', from: r.from, to: r.to }, 'revenue_summary.xlsx'); });

  $('#gran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#gran button').forEach((x) => x.classList.toggle('on', x === b));
    loadTrends(b.dataset.g);
  });

  // explorer (multi-table) — sub-tabs, filters and export buttons are wired dynamically
  $('#exPrev').addEventListener('click', () => { ex.offset = Math.max(0, ex.offset - ex.limit); loadExplore(); });
  $('#exNext').addEventListener('click', () => { ex.offset += ex.limit; loadExplore(); });

  // top funds export (re-query via sql source for clean column set)
  $$('[data-export="topfunds"]').forEach((b) => b.addEventListener('click', () => {
    const fmt = b.dataset.fmt;
    download({ source: 'sql', format: fmt, filename: 'top_funds',
      sql: "SELECT name, type, is_sharia, latest_nav_value, latest_aum_value, management_fee FROM `sayakaya.main.funds` WHERE listing_status='ACTIVE' AND latest_aum_value IS NOT NULL ORDER BY latest_aum_value DESC LIMIT 50" },
      `top_funds.${fmt}`);
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
  $$('#ask .chip').forEach((c) => c.addEventListener('click', () => runAsk(c.textContent)));
  $('#askCsv').addEventListener('click', () => askSqlCache && download({ source: 'sql', format: 'csv', filename: 'ask_result', sql: askSqlCache, limit: 100000 }, 'ask_result.csv'));
  $('#askXlsx').addEventListener('click', () => askSqlCache && download({ source: 'sql', format: 'xlsx', filename: 'ask_result', sql: askSqlCache, limit: 100000 }, 'ask_result.xlsx'));

  // sql lab
  $('#sqlRun').addEventListener('click', runSql);
  $('#sqlEst').addEventListener('click', estimateSql);
  $('#sqlInput').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSql(); });
  $('#sqlCsv').addEventListener('click', () => download({ source: 'sql', format: 'csv', filename: 'query_result', sql: $('#sqlInput').value, limit: 100000 }, 'query_result.csv'));
  $('#sqlXlsx').addEventListener('click', () => download({ source: 'sql', format: 'xlsx', filename: 'query_result', sql: $('#sqlInput').value, limit: 100000 }, 'query_result.xlsx'));
}

// ---------- password gate ----------
function showGate(err) {
  $('#gate').classList.remove('hidden');
  if (err) $('#gate-err').textContent = err;
  $('#gate-input').focus();
}
function wireGate() {
  const submit = async () => {
    sessionStorage.setItem(PW_KEY, $('#gate-input').value);
    try {
      await api('/api/overview?from=2025-01-01&to=2025-01-02');
      $('#gate').classList.add('hidden');
      boot();
    } catch (e) {
      sessionStorage.removeItem(PW_KEY);
      $('#gate-err').textContent = 'Incorrect password.';
    }
  };
  $('#gate-btn').addEventListener('click', submit);
  $('#gate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// ---------- boot ----------
async function boot() {
  // Portfolio is the landing tab; nothing to query until a SID is searched.
}

function setConnStatus(live) {
  $('#connDot').classList.toggle('live', live === true);
  $('#connDot').classList.toggle('down', live === false);
  $('#connLabel').textContent = live === true ? 'BigQuery live' : live === false ? 'Connection down' : 'Checking…';
}

async function pollHealth() {
  try {
    const h = await api('/api/health');
    setConnStatus(!!h.bigquery);
  } catch { setConnStatus(false); }
}

async function init() {
  const r = defaultRange();
  $('#from').value = r.from; $('#to').value = r.to;
  const rm = defaultMonthRange();
  $('#revFrom').value = rm.from; $('#revTo').value = rm.to;
  setThemeButtonLabel();
  wire(); wireGate();
  try {
    const h = await api('/api/health');
    setConnStatus(!!h.bigquery);
    setInterval(pollHealth, 30000);
    const askOn = !!h.askEnabled;
    $('#askDisabled').classList.toggle('hidden', askOn);
    $('#askBox').classList.toggle('hidden', !askOn);
    if (h.passwordProtected && !sessionStorage.getItem(PW_KEY)) { showGate(); return; }
    boot();
  } catch { setConnStatus(false); showGate('Could not reach the server.'); }
}

init();
