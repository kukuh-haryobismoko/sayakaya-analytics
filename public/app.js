'use strict';

// tiny helpers
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
  if (n == null) return 'n/a';
  return 'Rp ' + new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(n));
};
const idrFull = (n) => (n == null ? 'n/a' : 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n))));
const idrExact = (n) => (n == null ? 'n/a' : 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n)));
const num = (n) => (n == null ? 'n/a' : new Intl.NumberFormat('en-US').format(Number(n)));
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : 'n/a');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

// SVG icon references for spots app.js builds HTML itself (KPI cards, a
// couple of callouts) — reuses the same sprite defined once in index.html,
// see antislop pass: real icons instead of emoji.
const icon = (id) => `<svg viewBox="0 0 24 24"><use href="#i-${id}"></use></svg>`;
const ICONS = {
  coin: icon('coin'), users: icon('users'), user: icon('user'), userPlus: icon('user-plus'),
  trendUp: icon('trend-up'), trendDown: icon('trend-down'), activity: icon('activity'),
  receipt: icon('receipt'), folder: icon('folder'), check: icon('check'),
  hourglass: icon('hourglass'), xCircle: icon('x-circle'), eye: icon('eye'), eyeOff: icon('eye-off'), more: icon('more'),
  monitor: icon('monitor'),
};

function val(x) { return x && typeof x === 'object' && 'value' in x ? x.value : x; }
// Cell text from data: keep our own span/strong markup, escape everything else
// (so a name like <img onerror=...> renders as text). Attributes other than
// class/style never pass.
const SAFE_TAG = /<(\/?)(span|strong|b|em|small|code|br)((?:\s+(?:class|style)="[^"<>]*")*)\s*\/?>/gi;
function safeCell(v) {
  const keep = [];
  const marked = String(v).replace(SAFE_TAG, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  return escapeHtml(marked).replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}
// Clickable table rows (tabindex=0) act on Enter/Space like a button.
document.addEventListener('keydown', (e) => {
  const tr = e.target.closest && e.target.closest('tr[tabindex="0"]');
  if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
});
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// date range
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

// chart palette (theme-aware: read from CSS custom properties)
function readThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    indigo: v('--indigo'), soft: v('--indigo-soft'), amber: v('--amber'),
    teal: v('--teal'), rose: v('--rose'), muted: v('--muted'), ink: v('--ink'), amberMark: v('--amber-mark'),
    grid: v('--line'), surface: v('--surface'), heatRgb: v('--heat-rgb'),
    chartAmber: v('--chart-amber'), chartGreen: v('--chart-green'),
  };
}
let C = readThemeColors();
const pie = () => [C.indigo, C.amber, C.teal, C.rose, C.soft, '#9aa3bd', '#c9a06a', '#7fbfa6'];
const charts = {};
function paint(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($('#' + id), config);
  wireChartExportBar(id);
}
function applyChartDefaults() {
  Chart.defaults.font.family = 'Inter, sans-serif';
  Chart.defaults.color = C.muted;
}
applyChartDefaults();

// CHART EXPORT (PNG download + copy to clipboard)
// Wired automatically by paint() above onto every chart in the app — no
// per-chart code needed anywhere else.
function wireChartExportBar(id) {
  const canvas = $('#' + id);
  const wrap = canvas && canvas.closest('.chart-wrap');
  if (!wrap || wrap.querySelector('.chart-export-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'chart-export-bar';
  bar.innerHTML = `<button type="button" data-action="png" title="Download PNG">⤓</button>
    <button type="button" data-action="copy" title="Copy image to clipboard">⧉</button>`;
  bar.querySelector('[data-action="png"]').addEventListener('click', () => downloadChartPng(id));
  bar.querySelector('[data-action="copy"]').addEventListener('click', () => copyChartPng(id));
  wrap.appendChild(bar);
}
function downloadChartPng(id) {
  const chart = charts[id];
  if (!chart) return;
  const a = document.createElement('a');
  a.href = chart.toBase64Image('image/png', 1);
  a.download = `${id}.png`;
  a.click();
}
function copyChartPng(id) {
  const chart = charts[id];
  if (!chart) return;
  chart.canvas.toBlob((blob) => {
    if (!blob) return;
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      .then(() => toast(t('msg_chart_copied_to_clipboard')))
      .catch(() => toast(t('msg_copy_failed_try_download_instead')));
  });
}

// TABLE EXPORT (CSV / Excel / PDF / PNG, on every table)
// A MutationObserver watches every .table-wrap in the app (there are dozens,
// each rendered by its own function) and injects one small export bar the
// first time it sees a real <table> inside — covers every table, present and
// future, without touching each render call site individually.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Every <tr> in document order (thead + tbody + tfoot), so a Total row in
// tfoot comes out the same as any other row.
function tableToAoa(table) {
  return [...table.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()));
}
function aoaToCsv(aoa) {
  // Cells that start like a formula get a leading ' so Excel shows them as text;
  // plain numbers (-1,000.5, 12%) are left alone.
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?[\d.,]+%?$/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + aoa.map((r) => r.map(esc).join(',')).join('\n');
}
function exportTableCsv(table, name) {
  downloadBlob(new Blob([aoaToCsv(tableToAoa(table))], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}
// Export-only libraries load on first use instead of render-blocking every
// page from <head>: ~470KB gzipped (~1.5MB of JS to parse) that most visits
// never touch. Scripts within one entry load in order (autotable is a jsPDF
// plugin); `ready` skips the fetch when the global already exists.
const EXPORT_LIBS = {
  xlsx: { ready: () => window.XLSX, src: ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'] },
  pdf: { ready: () => window.jspdf, src: ['https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'] },
  zip: { ready: () => window.JSZip, src: ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'] },
};
const scriptLoads = {};
function loadScript(src) {
  return scriptLoads[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete scriptLoads[src]; reject(new Error('Could not load the export library. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
}
async function loadExportLib(name) {
  const lib = EXPORT_LIBS[name];
  if (lib.ready()) return;
  for (const src of lib.src) await loadScript(src);
}
async function exportTableXlsx(table, name) {
  await loadExportLib('xlsx');
  XLSX.writeFile(XLSX.utils.table_to_book(table), `${name}.xlsx`);
}
async function exportTablePdf(table, name) {
  const rows = tableToAoa(table);
  if (!rows.length) return;
  await loadExportLib('pdf');
  // Each column is sized to its longest cell (capped, so long text wraps at
  // word breaks) and the page grows to fit them, instead of squeezing every
  // column onto A4 where narrow columns break words letter by letter.
  const fontSize = 7, pad = 3, margin = 20, maxCol = 150;
  const probe = new window.jspdf.jsPDF({ unit: 'pt' });
  probe.setFont('helvetica', 'bold').setFontSize(fontSize);
  const widths = rows[0].map((_, c) => Math.min(maxCol,
    Math.ceil(Math.max(...rows.map((r) => probe.getTextWidth(r[c] || ''))) + pad * 2 + 2)));
  const pageW = Math.max(842, widths.reduce((a, w) => a + w, 0) + margin * 2);
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: [pageW, 595] });
  doc.autoTable({
    head: [rows[0]], body: rows.slice(1), margin,
    styles: { fontSize, cellPadding: pad, overflow: 'linebreak' },
    columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])),
  });
  doc.save(`${name}.pdf`);
}
// Drawn on a plain <canvas> rather than pulled in via a screenshot library —
// the rows are already parsed for CSV/PDF above, so laying them out as a
// simple grid is a few dozen lines, not a new dependency.
function exportTablePng(table, name) {
  const rows = tableToAoa(table);
  if (!rows.length) return;
  const colCount = Math.max(...rows.map((r) => r.length));
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  const font = '13px Inter, sans-serif';
  const pad = 14, rowH = 30;
  ctx.font = font;
  const colW = new Array(colCount).fill(0);
  rows.forEach((r) => r.forEach((cell, i) => { colW[i] = Math.max(colW[i], ctx.measureText(cell).width); }));
  const width = colW.reduce((a, w) => a + w + pad * 2, 0);
  const height = rowH * rows.length;
  const dpr = window.devicePixelRatio || 1;
  cvs.width = width * dpr; cvs.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  const cs = getComputedStyle(document.body);
  const bg = cs.getPropertyValue('--surface').trim() || '#fff';
  const ink = cs.getPropertyValue('--ink').trim() || '#111';
  const line = cs.getPropertyValue('--line').trim() || '#ddd';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  rows.forEach((r, ri) => {
    const y = ri * rowH;
    if (ri === 0) { ctx.fillStyle = '#1E2A4A'; ctx.fillRect(0, y, width, rowH); }
    let x = 0;
    r.forEach((cell, ci) => {
      ctx.fillStyle = ri === 0 ? '#fff' : ink;
      ctx.fillText(cell, x + pad, y + rowH / 2);
      x += colW[ci] + pad * 2;
    });
    ctx.strokeStyle = line;
    ctx.beginPath(); ctx.moveTo(0, y + rowH); ctx.lineTo(width, y + rowH); ctx.stroke();
  });
  cvs.toBlob((blob) => downloadBlob(blob, `${name}.png`));
}
// Same text the CSV gets, as tab-separated plain text (pastes cell-per-cell
// into Sheets/Excel) plus an HTML table (pastes as a table into docs/email).
function copyTable(table) {
  const rows = tableToAoa(table).map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')));
  const tsv = rows.map((r) => r.join('\t')).join('\n');
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = '<table>' + rows.map((r, i) => '<tr>' + r.map((c) => `<${i ? 'td' : 'th'}>${esc(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>';
  const ok = () => toast(t('msg_table_copied_to_clipboard'));
  const fail = () => toast(t('msg_copy_failed_try_csv_instead'));
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([tsv], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).then(ok).catch(fail);
  } else if (navigator.clipboard) navigator.clipboard.writeText(tsv).then(ok).catch(fail);
  else fail();
}
function wireTableExportBar(wrap) {
  if (wrap.dataset.exportWired) return;
  wrap.dataset.exportWired = '1';
  const bar = document.createElement('div');
  bar.className = 'table-export-bar hidden';
  bar.innerHTML = ['copy', 'csv', 'xlsx', 'pdf', 'png'].map((fmt) =>
    `<button type="button" data-fmt="${fmt}">${fmt.toUpperCase()}</button>`).join('');
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn) return;
    const table = wrap.querySelector('table');
    if (!table) return;
    const name = wrap.id || 'table';
    Promise.resolve(({ copy: copyTable, csv: exportTableCsv, xlsx: exportTableXlsx, pdf: exportTablePdf, png: exportTablePng })[btn.dataset.fmt](table, name))
      .catch((err) => toast(err.message));
  });
  wrap.parentNode.insertBefore(bar, wrap);
}
function refreshTableToolbars(root) {
  [...root.querySelectorAll('.table-wrap')].forEach((wrap) => {
    wireTableExportBar(wrap);
    markSortable(wrap);
    const bar = wrap.previousElementSibling;
    if (bar && bar.classList.contains('table-export-bar')) bar.classList.toggle('hidden', !wrap.querySelector('table'));
  });
}
let tableToolbarQueued = false;
function queueTableToolbarRefresh() {
  if (tableToolbarQueued) return;
  tableToolbarQueued = true;
  requestAnimationFrame(() => { tableToolbarQueued = false; refreshTableToolbars(document); });
}
new MutationObserver(queueTableToolbarRefresh).observe(document.body, { childList: true, subtree: true });

// TABLE SORT (every table: click, Enter or Space on a header)
// Lists paged on the server register a reload in SERVER_SORT under their
// .table-wrap id and render their headers with data-sort (the server's column
// name): a click reloads page one in that order, so the whole result is
// sorted, not only the rows on screen. Every other table sorts its rendered
// rows in place, remembered per table so a re-render (new data, theme or
// language switch) keeps the order. <tfoot> totals never move, blanks (n/a,
// ·) stay last either way, and the first click on a number or date column
// puts the biggest or newest first.
const SERVER_SORT = {};
const tableSorts = {};
const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const ID_COMPACT = { rb: 1e3, jt: 1e6, m: 1e9, t: 1e12 };
function sortValue(text) {
  const s = text.trim();
  if (!s || s === 'n/a' || s === '·') return null;
  let m = s.match(/^Rp\s*([-−]?)([\d.,]+)\s*(rb|jt|M|T)?$/);
  if (m) { // id-ID money: dots group thousands, the comma is the decimal mark
    const n = Number(m[2].replace(/\./g, '').replace(',', '.')) * (ID_COMPACT[(m[3] || '').toLowerCase()] || 1);
    return m[1] ? -n : n;
  }
  m = s.match(/^([+-]?\d[\d,]*(?:\.\d+)?)%?$/); // counts, percentages and signed deltas
  return m ? Number(m[1].replace(/,/g, '')) : s;
}
const sortTh = (label, key, state, cls, first) => `<th class="${cls} sortable" data-sort="${key}" data-first="${first}" tabindex="0" aria-sort="${
  state && state.key === key ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}</th>`;
const sortParams = (state) => (state ? { sort: state.key, dir: state.dir } : {});
function columnRows(table, i) {
  return [...table.tBodies[0].rows].map((r, k) => {
    const text = r.cells[i] ? r.cells[i].textContent.trim() : '';
    return { r, k, text, v: sortValue(text) };
  });
}
const isDateLike = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
function applyDomSort(table, i, dir) {
  const rows = columnRows(table, i);
  const nums = rows.every((x) => x.v == null || typeof x.v === 'number');
  const m = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    if (a.v == null || b.v == null) return (a.v == null) - (b.v == null) || a.k - b.k;
    return m * (nums ? a.v - b.v : sortCollator.compare(a.text, b.text)) || a.k - b.k;
  });
  table.tBodies[0].append(...rows.map((x) => x.r));
  [...table.tHead.rows[0].cells].forEach((th, j) => {
    if (th.classList.contains('sortable')) th.setAttribute('aria-sort', j === i ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}
function markSortable(wrap) {
  const table = wrap.querySelector('table');
  if (!table || table.dataset.sortReady || !table.tHead || !table.tBodies[0]) return;
  table.dataset.sortReady = '1';
  if (table.tHead.rows.length !== 1 || table.querySelector('[colspan], [rowspan]')) return;
  const heads = [...table.tHead.rows[0].cells];
  if (heads.some((th) => th.dataset.sort)) return; // sorted on the server, headers come from the page
  heads.forEach((th) => {
    if (!th.textContent.trim() || th.querySelector('input, button, select, a')) return;
    th.classList.add('sortable'); th.tabIndex = 0; th.setAttribute('aria-sort', 'none');
  });
  // The sorted column is found again by its header text (a new column can
  // shift it), or by position when the text changed but the shape didn't
  // (a language switch).
  const saved = tableSorts[wrap.id];
  if (!saved) return;
  const byLabel = heads.findIndex((th) => th.textContent.trim() === saved.label);
  const i = byLabel >= 0 ? byLabel : saved.n === heads.length ? saved.i : -1;
  if (i >= 0 && heads[i].classList.contains('sortable')) applyDomSort(table, i, saved.dir);
}
function onTableSort(e) {
  const th = e.target.closest && e.target.closest('.table-wrap th.sortable');
  if (!th) return;
  if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
  const wrap = th.closest('.table-wrap');
  const table = th.closest('table');
  const i = [...th.parentNode.cells].indexOf(th);
  const now = th.getAttribute('aria-sort');
  let dir = now === 'ascending' ? 'desc' : now === 'descending' ? 'asc' : th.dataset.first;
  if (!dir) {
    const vals = columnRows(table, i).map((x) => x.v).filter((v) => v != null);
    dir = vals.length && vals.every((v) => typeof v === 'number' || isDateLike(v)) ? 'desc' : 'asc';
  }
  if (th.dataset.sort) { if (SERVER_SORT[wrap.id]) SERVER_SORT[wrap.id]({ key: th.dataset.sort, dir }); return; }
  applyDomSort(table, i, dir);
  if (wrap.id) tableSorts[wrap.id] = { i, dir, n: th.parentNode.cells.length, label: th.textContent.trim() };
}
document.addEventListener('click', onTableSort);
document.addEventListener('keydown', onTableSort);

// Exports follow the on-screen sort. An export button belongs to the first
// table after it in its tab (they sit above their table, sometimes in the
// chart panel before it). The server orders by the sorted column's field
// (data-key) when the export has it, else by the on-screen order of the
// first column (pivots, columns computed on the page). See sortExportRows.
let lastClickTarget = null;
document.addEventListener('click', (e) => { lastClickTarget = e.target; }, true);
function screenSortFor(el) {
  const view = el && el.closest && el.closest('.view');
  if (!view) return {};
  const wrap = [...view.querySelectorAll('.table-wrap')].find((w) => el.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING);
  const table = wrap && tableSorts[wrap.id] && wrap.querySelector('table');
  if (!table || !table.tHead) return {};
  const heads = [...table.tHead.rows[0].cells];
  const th = heads.find((h) => ['ascending', 'descending'].includes(h.getAttribute('aria-sort')));
  if (!th) return {};
  const out = { sortDir: th.getAttribute('aria-sort') === 'ascending' ? 'asc' : 'desc' };
  if (th.dataset.key) out.sortKey = th.dataset.key;
  if (heads[0].dataset.key) {
    out.orderKey = heads[0].dataset.key;
    out.order = [...table.tBodies[0].rows].map((r) => r.cells[0].textContent.trim());
  }
  return out;
}
// Client-built exports (the Event code workbook): rows in the order their
// table shows them, matched on the first column; rows not on screen follow.
function inScreenOrder(rows, wrapId, firstText) {
  const table = tableSorts[wrapId] && $(`#${wrapId} table`);
  if (!table) return rows;
  const pos = new Map([...table.tBodies[0].rows].map((r, i) => [r.cells[0].textContent.trim(), i]));
  return rows.map((r, i) => ({ r, i, p: pos.get(String(firstText(r))) ?? Infinity }))
    .sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.r);
}

// USER PORTFOLIO (search by SID, print one investor's holdings)
async function searchPortfolioUsers() {
  const q = $('#pfSearchInput').value.trim();
  if (!q) return;
  $('#pfResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPfResults(rows);
  } catch (e) { $('#pfResults').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPfResults(rows) {
  if (!rows.length) { $('#pfResults').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
  const body = rows.map((r) => `<tr class="pf-row" tabindex="0" role="button" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${escapeHtml(val(r.name) || '')}" data-email="${escapeHtml(val(r.email) || '')}" style="cursor:pointer">
      <td>${escapeHtml(val(r.sid) || 'n/a')}</td><td>${escapeHtml(val(r.name) || 'n/a')}</td><td>${escapeHtml(val(r.email) || 'n/a')}</td><td>${escapeHtml(val(r.ifua) || 'n/a')}</td>${bulkAddCell(r)}
    </tr>`).join('');
  $('#pfResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#pfResults .pf-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPortfolioUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
  wireBulkAddButtons('#pfResults', pfBulk);
}

let pfSelected = null; // { userId, sid, name, date }, used by the export buttons

// New user picked from search results — resets the date filter to live.
async function selectPortfolioUser(userId, sid, name, email) {
  pfSelected = { userId, sid, name: name || sid, date: '' };
  $('#pfNarrative').innerHTML = '';
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
  // A newer click or date change supersedes this load; drop its late response.
  const sel = pfSelected, reqId = (sel.reqId = (sel.reqId || 0) + 1);
  const { userId, sid } = pfSelected;
  const dateVal = $('#pfDate').value;
  $('#pfKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#pfHoldings').innerHTML = '';
  $('#pfPerformance').innerHTML = '';
  $('#pfRecentTx').innerHTML = '';
  $('#pfGrowthFinding').hidden = true;
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, recentTx, asOfDate, latestDate } = await api(`/api/portfolio?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    if (pfSelected !== sel || sel.reqId !== reqId) return;
    pfSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate), latest = val(latestDate);
    $('#pfSnapshotInfo').textContent = asOf
      ? `Snapshot date: ${asOf}${latest && latest !== asOf ? ` (latest available: ${latest})` : ''}, from mi_fee_logs.portfolio_with_code.`
      : `Live holdings (current units × today's NAV).${latest ? ` Latest historical snapshot available: ${latest}.` : ''}`;
    renderPfKpis(holdings, split);
    renderPfHoldings(holdings);
    renderPfPerformance(performance);
    renderPfAumChart(history);
    renderSeriesTrendFinding('#pfGrowthFinding', history, 'amount', 'Portfolio value');
    genTable('#pfRecentTx', recentTx, [
      { key: 'completed_at', label: t('col_date'), type: 'date' }, { key: 'type', label: t('col_type') },
      { key: 'fund', label: t('col_fund') }, { key: 'final_amount', label: t('col_amount'), type: 'idr' },
    ], 'No transactions yet.');
  } catch (e) { $('#pfKpis').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
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
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : 'n/a', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : 'n/a', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
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
    if (v == null) return '<td class="num">n/a</td>';
    const n = Number(v);
    return `<td class="num"><span style="color:${n >= 0 ? 'var(--pos-text)' : 'var(--neg-text)'}">${idrFull(n)}</span></td>`;
  };
  const glPct = (v) => {
    if (v == null) return '<td class="num">n/a</td>';
    const n = Number(v);
    return `<td class="num"><span style="color:${n >= 0 ? 'var(--pos-text)' : 'var(--neg-text)'}">${n >= 0 ? '+' : ''}${n.toFixed(2)}%</span></td>`;
  };
  // G/L % in the Total row only covers funds with a known average buy price.
  const tot = { fund: 0, market: 0, gain: 0 };
  const body = rows.map((h) => {
    // Derived client-side so the table works regardless of API version:
    // fund value = units x avg buy NAV; gain = market - fund value.
    const avg = h.avg_buy_price == null ? null : Number(val(h.avg_buy_price));
    const market = Number(val(h.value));
    const fundValue = avg == null ? null : Math.round(Number(val(h.unit)) * avg);
    const gain = fundValue == null ? null : market - fundValue;
    const pct = fundValue ? (gain / fundValue) * 100 : null;
    tot.market += market;
    if (fundValue != null) { tot.fund += fundValue; tot.gain += gain; }
    const fund = val(h.fund);
    const chkTd = selectable
      ? `<td><input type="checkbox" class="hld-export-chk" data-fund="${escapeHtml(fund)}" ${excluded.has(fund) ? '' : 'checked'}></td>`
      : '';
    return `<tr>
      ${chkTd}
      <td>${escapeHtml(fund)}</td>
      <td><span class="tag other">${escapeHtml(val(h.fund_type))}</span></td>
      <td class="num">${Number(val(h.unit)).toFixed(4)}</td>
      <td class="num">${avg == null ? 'n/a' : num(avg)}</td>
      <td class="num">${num(val(h.nav))}</td>
      <td class="num">${fundValue == null ? 'n/a' : idrFull(fundValue)}</td>
      <td class="num">${idrFull(market)}</td>
      ${gl(gain)}
      ${glPct(pct)}
    </tr>`;
  }).join('');
  const chkTh = selectable ? '<th>Export</th>' : '';
  const foot = rows.length ? `<tfoot><tr>
      ${selectable ? '<td></td>' : ''}<td>Total</td><td></td><td></td><td></td><td></td>
      <td class="num">${idrFull(tot.fund)}</td>
      <td class="num">${idrFull(tot.market)}</td>
      ${gl(tot.gain)}
      ${glPct(tot.fund ? (tot.gain / tot.fund) * 100 : null)}
    </tr></tfoot>` : '';
  return `<table><thead><tr>
      ${chkTh}<th>Fund</th><th>Type</th><th class="num">Unit Balance</th><th class="num">Average NAV</th><th class="num">Close NAV</th><th class="num">Fund Value</th><th class="num">Market Value</th><th class="num">Unrealized G/L</th><th class="num">%</th>
    </tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

function renderPfHoldings(rows) {
  if (!rows.length) { $('#pfHoldings').innerHTML = `<div class="empty">${t('msg_no_active_holdings')}</div>`; return; }
  $('#pfHoldings').innerHTML = holdingsTableHtml(rows);
}

function renderPfPerformance(rows) {
  if (!rows.length) { $('#pfPerformance').innerHTML = `<div class="empty">${t('msg_no_aum_history_for_this_sid')}</div>`; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">n/a</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#pfPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// PORTFOLIO (FIX) — same feature/logic as Portfolio (PWC) above, but the
// as-of-date snapshot reads from mi_fee_logs.portfolio_fix (unit-weighted
// avg_buy_price) instead of portfolio_with_code.
async function searchPfxUsers() {
  const q = $('#pfxSearchInput').value.trim();
  if (!q) return;
  $('#pfxResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPfxResults(rows);
  } catch (e) { $('#pfxResults').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPfxResults(rows) {
  if (!rows.length) { $('#pfxResults').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
  const body = rows.map((r) => `<tr class="pfx-row" tabindex="0" role="button" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${escapeHtml(val(r.name) || '')}" data-email="${escapeHtml(val(r.email) || '')}" style="cursor:pointer">
      <td>${escapeHtml(val(r.sid) || 'n/a')}</td><td>${escapeHtml(val(r.name) || 'n/a')}</td><td>${escapeHtml(val(r.email) || 'n/a')}</td><td>${escapeHtml(val(r.ifua) || 'n/a')}</td>${bulkAddCell(r)}
    </tr>`).join('');
  $('#pfxResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#pfxResults .pfx-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPfxUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
  wireBulkAddButtons('#pfxResults', pfxBulk);
}

let pfxSelected = null; // { userId, sid, name, date }, used by the export buttons

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
  const sel = pfxSelected, reqId = (sel.reqId = (sel.reqId || 0) + 1);
  const { userId, sid } = pfxSelected;
  const dateVal = $('#pfxDate').value;
  $('#pfxKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#pfxHoldings').innerHTML = '';
  $('#pfxPerformance').innerHTML = '';
  $('#pfxRecentTx').innerHTML = '';
  $('#pfxGrowthFinding').hidden = true;
  pfxSelected.excludedFunds = null; // re-derive dust defaults for whatever holdings this load returns
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, recentTx, asOfDate, latestDate } = await api(`/api/portfolio-fix?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    if (pfxSelected !== sel || sel.reqId !== reqId) return;
    pfxSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate), latest = val(latestDate);
    $('#pfxSnapshotInfo').textContent = asOf
      ? `Snapshot date: ${asOf}${latest && latest !== asOf ? ` (latest available: ${latest})` : ''}, from mi_fee_logs.portfolio_fix.`
      : `Live holdings (current units × today's NAV).${latest ? ` Latest historical snapshot available: ${latest}.` : ''}`;
    renderPfxKpis(holdings, split);
    renderPfxHoldings(holdings);
    renderPfxPerformance(performance);
    renderPfxAumChart(history);
    renderSeriesTrendFinding('#pfxGrowthFinding', history, 'amount', 'Portfolio value');
    genTable('#pfxRecentTx', recentTx, [
      { key: 'completed_at', label: t('col_date'), type: 'date' }, { key: 'type', label: t('col_type') },
      { key: 'fund', label: t('col_fund') }, { key: 'final_amount', label: t('col_amount'), type: 'idr' },
    ], 'No transactions yet.');
  } catch (e) { $('#pfxKpis').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPfxAumChart(rows, canvasId = 'pfxAumChart') {
  if (!rows.length) { charts[canvasId]?.destroy(); delete charts[canvasId]; return; }
  paint(canvasId, {
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
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : 'n/a', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : 'n/a', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

function renderPfxHoldings(rows) {
  if (!rows.length) { $('#pfxHoldings').innerHTML = `<div class="empty">${t('msg_no_active_holdings')}</div>`; return; }
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

function renderPfxPerformance(rows, target = '#pfxPerformance') {
  if (!rows.length) { $(target).innerHTML = `<div class="empty">${t('msg_no_aum_history_for_this_sid')}</div>`; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">n/a</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $(target).innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// PORTFOLIO (TX) — holdings with avg_buy_price computed from the
// transaction ledger instead of portfolios.initial_price. As-of-date
// reconstructs units/average purely from transactions up to that date;
// bonus holdings only ever show in the live view (no bonus history exists).
// AUM chart/performance reuse portfolio_fix (market-value history, never
// affected by the cost-basis bug).
async function searchPtxUsers() {
  const q = $('#ptxSearchInput').value.trim();
  if (!q) return;
  $('#ptxResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPtxResults(rows);
  } catch (e) { $('#ptxResults').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPtxResults(rows) {
  if (!rows.length) { $('#ptxResults').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
  const body = rows.map((r) => `<tr class="ptx-row" tabindex="0" role="button" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${escapeHtml(val(r.name) || '')}" data-email="${escapeHtml(val(r.email) || '')}" style="cursor:pointer">
      <td>${escapeHtml(val(r.sid) || 'n/a')}</td><td>${escapeHtml(val(r.name) || 'n/a')}</td><td>${escapeHtml(val(r.email) || 'n/a')}</td><td>${escapeHtml(val(r.ifua) || 'n/a')}</td>${bulkAddCell(r)}
    </tr>`).join('');
  $('#ptxResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#ptxResults .ptx-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPtxUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
  wireBulkAddButtons('#ptxResults', ptxBulk);
}

let ptxSelected = null; // { userId, sid, name, excludedFunds }, used by the export buttons

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
  const sel = ptxSelected, reqId = (sel.reqId = (sel.reqId || 0) + 1);
  const { userId, sid } = ptxSelected;
  const dateVal = $('#ptxDate').value;
  $('#ptxKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#ptxHoldings').innerHTML = '';
  $('#ptxPerformance').innerHTML = '';
  $('#ptxRecentTx').innerHTML = '';
  $('#ptxGrowthFinding').hidden = true;
  ptxSelected.excludedFunds = null;
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, recentTx, asOfDate } = await api(`/api/portfolio-tx?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    if (ptxSelected !== sel || sel.reqId !== reqId) return;
    ptxSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate);
    $('#ptxSnapshotInfo').textContent = asOf
      ? `As of ${asOf}: units and average buy price reconstructed from transactions up to that date; bonus holdings excluded (no historical data). Use the Export checkbox below to leave a row out of CSV/XLSX/PDF.`
      : `Live holdings (current units × today's NAV). Average buy price is computed from completed buy/SWITCH_IN/reinvestment/transfer_in transactions, sells never change it. Use the Export checkbox below to leave a row out of CSV/XLSX/PDF (e.g. a leftover 1-unit balance).`;
    renderPtxKpis(holdings, split);
    renderPtxHoldings(holdings);
    renderPtxPerformance(performance);
    renderPtxAumChart(history);
    renderSeriesTrendFinding('#ptxGrowthFinding', history, 'amount', 'Portfolio value');
    genTable('#ptxRecentTx', recentTx, [
      { key: 'completed_at', label: t('col_date'), type: 'date' }, { key: 'type', label: t('col_type') },
      { key: 'fund', label: t('col_fund') }, { key: 'final_amount', label: t('col_amount'), type: 'idr' },
    ], 'No transactions yet.');
  } catch (e) { $('#ptxKpis').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
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
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : 'n/a', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : 'n/a', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

function renderPtxHoldings(rows) {
  if (!rows.length) { $('#ptxHoldings').innerHTML = `<div class="empty">${t('msg_no_active_holdings')}</div>`; return; }
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
  if (!rows.length) { $('#ptxPerformance').innerHTML = `<div class="empty">${t('msg_no_aum_history_for_this_sid')}</div>`; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">n/a</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#ptxPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// PORTFOLIO (SINVEST) — same as Portfolio (TX) above, but holdings are
// built entirely from the KSEI/SInvest custodian feed (sinvest.trx_history)
// instead of the app's own transactions table. AUM chart/performance still
// reuse portfolio_fix, same as Portfolio (TX).
async function searchPsiUsers() {
  const q = $('#psiSearchInput').value.trim();
  if (!q) return;
  $('#psiResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPsiResults(rows);
  } catch (e) { $('#psiResults').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPsiResults(rows) {
  if (!rows.length) { $('#psiResults').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
  const body = rows.map((r) => `<tr class="psi-row" tabindex="0" role="button" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${escapeHtml(val(r.name) || '')}" data-email="${escapeHtml(val(r.email) || '')}" style="cursor:pointer">
      <td>${escapeHtml(val(r.sid) || 'n/a')}</td><td>${escapeHtml(val(r.name) || 'n/a')}</td><td>${escapeHtml(val(r.email) || 'n/a')}</td><td>${escapeHtml(val(r.ifua) || 'n/a')}</td>${bulkAddCell(r)}
    </tr>`).join('');
  $('#psiResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#psiResults .psi-row').forEach((tr) => tr.addEventListener('click', () =>
    selectPsiUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
  wireBulkAddButtons('#psiResults', psiBulk);
}

let psiSelected = null; // { userId, sid, name, date, excludedFunds }, used by the export buttons

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
  const sel = psiSelected, reqId = (sel.reqId = (sel.reqId || 0) + 1);
  const { userId, sid } = psiSelected;
  const dateVal = $('#psiDate').value;
  $('#psiKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#psiHoldings').innerHTML = '';
  $('#psiPerformance').innerHTML = '';
  $('#psiRecentTx').innerHTML = '';
  $('#psiGrowthFinding').hidden = true;
  psiSelected.excludedFunds = null;
  try {
    const dateParam = dateVal ? `&date=${dateVal}` : '';
    const { holdings, split, performance, history, recentTx, asOfDate } = await api(`/api/portfolio-sinvest?userId=${encodeURIComponent(userId)}&sid=${encodeURIComponent(sid)}${dateParam}`);
    if (psiSelected !== sel || sel.reqId !== reqId) return;
    psiSelected.date = val(asOfDate) || '';
    const asOf = val(asOfDate);
    $('#psiSnapshotInfo').textContent = asOf
      ? `As of ${asOf}: units and average buy price reconstructed from the SInvest custodian feed up to that date; bonus holdings excluded (no historical data). Use the Export checkbox below to leave a row out of CSV/XLSX/PDF.`
      : `Live holdings (current units × today's NAV), built from the KSEI/SInvest custodian feed (sinvest.trx_history) instead of the app's own transactions table. Average buy price only reflects completed BUY/SWITCH_IN/REINVESTMENT/TRANSFER_IN rows, sells never change it. Use the Export checkbox below to leave a row out of CSV/XLSX/PDF.`;
    renderPsiKpis(holdings, split);
    renderPsiHoldings(holdings);
    renderPsiPerformance(performance);
    renderPsiAumChart(history);
    renderSeriesTrendFinding('#psiGrowthFinding', history, 'amount', 'Portfolio value');
    genTable('#psiRecentTx', recentTx, [
      { key: 'transaction_date', label: t('col_date'), type: 'date' }, { key: 'type', label: t('col_type') },
      { key: 'fund_name', label: t('col_fund') }, { key: 'net_amount', label: t('col_amount'), type: 'idr' },
    ], 'No transactions yet.');
  } catch (e) { $('#psiKpis').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
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
    kpi(t('kpi_regular_portfolio'), split ? idrFull(Number(val(split.regular_value)) || 0) : 'n/a', split ? 'portfolios' : t('kpi_not_available_past_date')),
    kpi(t('kpi_bonus_portfolio'), split ? idrFull(Number(val(split.bonus_value)) || 0) : 'n/a', split ? 'bonus_portfolios (on_going)' : t('kpi_not_available_past_date')),
  ].join('');
}

function renderPsiHoldings(rows) {
  if (!rows.length) { $('#psiHoldings').innerHTML = `<div class="empty">${t('msg_no_active_holdings')}</div>`; return; }
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
  if (!rows.length) { $('#psiPerformance').innerHTML = `<div class="empty">${t('msg_no_aum_history_for_this_sid')}</div>`; return; }
  const head = rows.map((r) => `<th class="num">${val(r.period)}</th>`).join('');
  const cells = rows.map((r) => {
    const pct = val(r.pct_change);
    if (pct == null) return '<td class="num">n/a</td>';
    return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
  }).join('');
  $('#psiPerformance').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

// AI INSIGHTS
// Every panel loads on demand from its own button: the digest calls the model,
// the churn list and the watchdog scan real tables, none should run just
// because the tab was opened.
async function aiRun(btnSel, outSel, fn) {
  const btn = $(btnSel), out = $(outSel);
  btn.disabled = true;
  out.innerHTML = `<div class="loading">${t('ai_working')}</div>`;
  try { await fn(out); }
  catch (e) { out.innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
  finally { btn.disabled = false; }
}

// Model text as real paragraphs: blank lines split them, stray line breaks inside one
// are joined, so spacing comes from the stylesheet and not from the model's newlines.
const aiText = (text) => '<div class="ai-text">' + String(text).split(/\n\s*\n/)
  .map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('') + '</div>';

function loadAiDigest() {
  return aiRun('#aiDigestBtn', '#aiDigestOut', async (out) => {
    const { facts, text } = await api(`/api/ai/digest?lang=${getLang()}`);
    const chg = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
    const flow = facts.last_7d.net_flow;
    out.innerHTML = `<div class="kpi-grid">${[
      kpi(t('ai_kpi_aum'), idr(facts.aum_now), `${t('ai_as_of')} ${escapeHtml(val(facts.as_of))}`, 'accent'),
      kpi(t('ai_kpi_chg'), chg(facts.aum_change_7d_pct), `${t('ai_kpi_30d')}: ${chg(facts.aum_change_30d_pct)}`),
      kpi(t('ai_kpi_flow'), `${flow > 0 ? '+' : ''}${idr(flow)}`, `${t('ai_kpi_prev')}: ${idr(facts.previous_7d.net_flow)}`, flow < 0 ? 'warn' : ''),
      kpi(t('ai_kpi_users'), num(facts.new_users_last_7d), `${t('ai_kpi_prev')}: ${num(facts.new_users_previous_7d)}`),
    ].join('')}</div>${aiText(text)}`;
  });
}

function loadAiAnomalies() {
  return aiRun('#aiAnomBtn', '#aiAnomOut', async () => {
    const rows = await api('/api/ai/anomalies');
    genTable('#aiAnomOut', rows, [
      { key: 'day', label: t('col_date'), type: 'date' }, { key: 'metric', label: t('ai_col_metric') },
      { key: 'value', label: t('ai_col_value'), type: 'idr' },
      { key: 'change_pct', label: t('ai_col_change'), fmt: (v) => (v == null ? 'n/a' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%`) },
      { key: 'z', label: 'Z-score', type: 'num' },
    ], t('ai_anom_empty'));
  });
}

function loadAiChurn() {
  return aiRun('#aiChurnBtn', '#aiChurnOut', async () => {
    const { summary, rows } = await api('/api/ai/churn-actions');
    $('#aiChurnSummary').textContent = [
      `${t('ai_churn_p1')}: ${num(val(summary.priority_1))}`, `${t('ai_churn_p2')}: ${num(val(summary.priority_2))}`, `${t('ai_churn_p3')}: ${num(val(summary.priority_3))}`,
      `${t('ai_churn_redeemed')}: ${num(val(summary.redeemed_all))}`, `${t('ai_churn_lost')}: ${idrFull(val(summary.aum_lost))}`,
    ].join(' · ');
    const days = (v) => (v == null ? '' : num(v));
    const tr = (key, fallback) => { const v = t(key); return v === key ? fallback : v; };
    const shown = rows.map((r) => ({
      ...r, action: tr(`ai_action_${val(r.action_key)}`, val(r.action)),
      status: val(r.status) === 'Redeemed all' ? t('ai_status_redeemed') : t('ai_status_dropped'),
    }));
    genTable('#aiChurnOut', shown, [
      { key: 'priority', label: t('ai_col_priority'), type: 'num' }, { key: 'status', label: t('ai_col_status') },
      { key: 'name', label: t('col_name') }, { key: 'is_institution', label: t('ai_col_type'), fmt: (v) => (v ? t('ai_type_institution') : t('ai_type_individual')) },
      { key: 'email', label: 'Email' }, { key: 'phone', label: t('ai_col_phone'), text: true },
      { key: 'peak_aum', label: t('ai_col_peak'), type: 'idr' }, { key: 'peak_date', label: t('ai_col_peak_date'), type: 'date' },
      { key: 'current_aum', label: t('ai_col_now'), type: 'idr' },
      { key: 'change_pct', label: t('ai_col_change_peak'), fmt: (v) => (v == null ? 'n/a' : `${Number(v).toFixed(0)}%`) },
      { key: 'days_since_redeem_all', label: t('ai_col_gone_days'), type: 'num', fmt: days },
      { key: 'last_buy', label: t('ai_col_last_buy'), type: 'date' }, { key: 'last_sell', label: t('ai_col_last_sell'), type: 'date' },
      { key: 'action', label: t('ai_col_action') },
    ], t('ai_churn_empty'));
  });
}

function loadAiWatchdog() {
  return aiRun('#aiWdBtn', '#aiWdOut', async (out) => {
    const { checks, diffs, text } = await api(`/api/ai/watchdog?lang=${getLang()}`);
    out.innerHTML = aiText(text);
    const flag = (v) => `<span style="color:${v === 'ok' ? 'var(--teal)' : 'var(--rose)'}">${escapeHtml(v)}</span>`;
    genTable('#aiWdFresh', checks, [
      { key: 'source', label: t('ai_col_source') }, { key: 'latest', label: t('ai_col_latest'), type: 'date' },
      { key: 'age_days', label: t('ai_col_age'), type: 'num' }, { key: 'status', label: 'Status', fmt: flag },
    ], '');
    const gap = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
    genTable('#aiWdDiff', diffs, [
      { key: 'day', label: t('col_date'), type: 'date' },
      { key: 'portfolio_with_code', label: 'portfolio_with_code', type: 'idr' }, { key: 'portfolio_fix', label: 'portfolio_fix', type: 'idr' },
      { key: 'goal_snapshots', label: 'goal_snapshots', type: 'idr' }, { key: 'portfolio_with_code_stored', label: t('ai_col_stored'), type: 'idr' },
      { key: 'portfolio_fix_vs_pwc_pct', label: t('ai_col_fix_gap'), fmt: gap }, { key: 'goal_snapshots_vs_pwc_pct', label: t('ai_col_gs_gap'), fmt: gap },
      { key: 'stored_vs_pwc_pct', label: t('ai_col_stored_gap'), fmt: gap },
      { key: 'status', label: 'Status', fmt: (v) => flag(v === 'ok' ? 'ok' : 'differs') },
    ], '');
  });
}

// "Portfolio note": one short written summary of the selected investor,
// shared by the Portfolio and Portfolio Explorer tabs.
function writeNarrative(btnSel, outSel, selected) {
  if (!selected) return;
  return aiRun(btnSel, outSel, async (out) => {
    const { text } = await api('/api/ai/portfolio-narrative', { method: 'POST', body: JSON.stringify({ userId: selected.userId, sid: selected.sid, lang: getLang() }) });
    out.innerHTML = aiText(text);
  });
}

// Ask: the written answer comes first; the SQL and the table sit folded underneath.
// A question that needs no data arrives as data.answer and has nothing to fold.
async function showAskAnswer(data, question) {
  const box = $('#askAnswer'), details = $('#askData');
  const rows = data.rows || [];
  box.classList.remove('hidden');
  if (data.answer) {
    box.innerHTML = aiText(data.answer);
    details.classList.add('hidden');
    return;
  }
  details.classList.remove('hidden');
  details.open = false;
  $('#askDataSummary').textContent = t('ask_data_summary').replace('{n}', num(rows.length));
  if (!rows.length) { box.innerHTML = `<p class="hint">${t('ask_answer_empty')}</p>`; details.open = true; return; }
  box.innerHTML = `<div class="loading">${t('ask_answering')}</div>`;
  try {
    const { text } = await api('/api/ask/explain', { method: 'POST', body: JSON.stringify({ question, rows: rows.slice(0, 40), lang: getLang() }) });
    if (question !== lastAskQuestion) return;
    box.innerHTML = aiText(text);
  } catch (e) {
    // The table is still a valid answer, so show it and say why the sentence is missing.
    box.innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    details.open = true;
  }
}


// PORTFOLIO EXPLORER (goal_snapshots — point-in-time holdings by date,
// merged by fund and also broken out by goal for the preview only)
async function searchExplorerUsers() {
  const q = $('#peSearchInput').value.trim();
  if (!q) return;
  $('#peResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderPeResults(rows);
  } catch (e) { $('#peResults').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPeResults(rows) {
  if (!rows.length) { $('#peResults').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
  const body = rows.map((r) => `<tr class="pe-row" tabindex="0" role="button" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${escapeHtml(val(r.name) || '')}" data-email="${escapeHtml(val(r.email) || '')}" style="cursor:pointer">
      <td>${escapeHtml(val(r.sid) || 'n/a')}</td><td>${escapeHtml(val(r.name) || 'n/a')}</td><td>${escapeHtml(val(r.email) || 'n/a')}</td><td>${escapeHtml(val(r.ifua) || 'n/a')}</td>${bulkAddCell(r)}
    </tr>`).join('');
  $('#peResults').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>IFUA</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  $$('#peResults .pe-row').forEach((tr) => tr.addEventListener('click', () =>
    selectExplorerUser(tr.dataset.id, tr.dataset.sid, tr.dataset.name, tr.dataset.email)));
  wireBulkAddButtons('#peResults', peBulk);
}

let peSelected = null; // { userId, sid, name, date }, used by the export buttons

async function selectExplorerUser(userId, sid, name, email) {
  peSelected = { userId, sid, name: name || sid, date: '' };
  $('#peDetail').classList.remove('hidden');
  $('#peUserName').textContent = name || sid;
  $('#peUserSub').textContent = `SID ${sid}${email ? ' · ' + email : ''}`;
  $('#peSnapshotInfo').textContent = '';
  $('#peKpis').innerHTML = '<div class="loading">Loading portfolio…</div>';
  $('#peHoldings').innerHTML = '';
  $('#peByGoal').innerHTML = '';
  $('#peNarrative').innerHTML = '';
  $('#pePerformance').innerHTML = '';
  $('#peGrowthFinding').hidden = true;
  await loadExplorerPortfolio();
}

async function loadExplorerPortfolio() {
  if (!peSelected) return;
  const sel = peSelected, reqId = (sel.reqId = (sel.reqId || 0) + 1);
  $('#peFinding').hidden = true;
  const dateParam = $('#peDate').value ? `&date=${$('#peDate').value}` : '';
  try {
    const { asOfDate, latestDate, holdings, byGoal, performance, history } = await api(`/api/portfolio-explorer?userId=${encodeURIComponent(peSelected.userId)}&sid=${encodeURIComponent(peSelected.sid)}${dateParam}`);
    if (peSelected !== sel || sel.reqId !== reqId) return;
    const asOf = val(asOfDate), latest = val(latestDate);
    peSelected.date = asOf || '';
    $('#peDate').value = asOf || '';
    $('#peSnapshotInfo').textContent = asOf
      ? `Snapshot date: ${asOf}${latest && latest !== asOf ? ` (latest available: ${latest})` : ''}`
      : (latest ? `No snapshot for this date. Latest available: ${latest}` : 'No goal_snapshots found for this user.');
    renderPeKpis(holdings, byGoal);
    renderPeHoldings(holdings);
    renderPeByGoal(byGoal);
    renderPeFinding(holdings);
    renderPfxPerformance(performance, '#pePerformance');
    renderPfxAumChart(history, 'peAumChart');
    renderSeriesTrendFinding('#peGrowthFinding', history, 'amount', 'Portfolio value');
  } catch (e) { $('#peKpis').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// Live best/worst gain headline from this snapshot's own held funds —
// gain_pct is already computed per fund by the goalUserHoldings query.
function renderPeFinding(holdings) {
  const el = $('#peFinding');
  const withPct = holdings.filter((h) => val(h.gain_pct) != null);
  if (withPct.length < 2) { el.hidden = true; return; }
  const best = withPct.reduce((a, b) => (Number(val(b.gain_pct)) > Number(val(a.gain_pct)) ? b : a));
  const worst = withPct.reduce((a, b) => (Number(val(b.gain_pct)) < Number(val(a.gain_pct)) ? b : a));
  const bestPct = Number(val(best.gain_pct));
  el.className = 'trend-finding';
  el.innerHTML = `Best holding: <span style="color:var(--teal)">${val(best.fund)} ${bestPct >= 0 ? '+' : ''}${bestPct.toFixed(2)}%</span>` +
    ` &nbsp;·&nbsp; Worst holding: <span style="color:var(--rose)">${val(worst.fund)} ${Number(val(worst.gain_pct)).toFixed(2)}%</span>`;
  el.hidden = false;
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
  if (!rows.length) { $('#peHoldings').innerHTML = `<div class="empty">${t('msg_no_holdings_for_this_date')}</div>`; return; }
  $('#peHoldings').innerHTML = holdingsTableHtml(rows);
}

// Preview-only breakdown: one mini table per goal, headed by the goal's name.
// Exports never use this grouping — they always use the merged holdings above.
function renderPeByGoal(rows) {
  if (!rows.length) { $('#peByGoal').innerHTML = `<div class="empty">${t('msg_no_goals_with_holdings_for_this_date')}</div>`; return; }
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

// HNWI (High Net Worth Individual) — investors at/above an AUM threshold,
// as of a date, from portfolio_with_code (mirrors Portfolio's -1 day
// correction: created_at is a day ahead of the AUM date it represents).
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
  { key: 'name', label: t('col_name') }, { key: 'sid_code', label: 'SID code' }, { key: 'ifua', label: 'IFUA code' },
  { key: 'phone', label: t('col_phone') }, { key: 'email', label: 'Email' }, { key: 'birthdate', label: t('col_birthdate'), type: 'date' },
];
const HNWI_RISK_COLS = [
  { key: 'risk_level', label: t('col_risk_level') },
  { key: 'investment_priorities', label: t('col_investment_priorities') },
  { key: 'investment_risk_tolerance', label: t('col_investment_risk_tolerance') },
];
async function hnwiEnsureDate() {
  if (!hnwiDateDefaulted) {
    try {
      const { latestDate } = await api('/api/hnwi/latest-date');
      if (latestDate) {
        hnwiDateDefaulted = true;
        if (!$('#hnwiDate').value) $('#hnwiDate').value = val(latestDate);
      }
    } catch { /* leave blank and retry on next load, user can still pick a date manually */ }
  }
  return !!$('#hnwiDate').value;
}
async function loadHnwiTotal() {
  if (!(await hnwiEnsureDate())) { $('#hnwiTotalTable').innerHTML = `<div class="empty">${t('msg_pick_a_date')}</div>`; return; }
  const p = hnwiTotalParams();
  $('#hnwiTotalTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const totals = await api(`/api/hnwi/total?date=${p.date}&minAum=${p.minAum}&maxAum=${p.maxAum}`);
    genTable('#hnwiTotalTable', totals, [
      ...HNWI_CONTACT_COLS, ...HNWI_RISK_COLS,
      { key: 'total_aum', label: 'Total AUM', type: 'idr', sum: true }, { key: 'aum_date', label: t('col_aum_date'), type: 'date' },
    ], 'No investors at or above this AUM threshold.');
    renderHnwiFinding(totals);
  } catch (e) {
    $('#hnwiTotalTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#hnwiFinding').hidden = true;
  }
}
// Live headline for the HNWI list — count + combined AUM at whatever
// threshold is currently filtered, recomputed every time the filter changes.
function renderHnwiFinding(rows) {
  const el = $('#hnwiFinding');
  if (!rows.length) { el.hidden = true; return; }
  const totalAum = rows.reduce((s, r) => s + (Number(val(r.total_aum)) || 0), 0);
  el.className = 'trend-finding';
  el.textContent = `${rows.length} investor${rows.length === 1 ? '' : 's'} qualify, ${idrFull(totalAum)} combined AUM.`;
  el.hidden = false;
}
async function loadHnwiByFund(useOwnFilter = hnwiByFundOwnFilter) {
  hnwiByFundOwnFilter = useOwnFilter;
  if (!(await hnwiEnsureDate())) { $('#hnwiByFundTable').innerHTML = `<div class="empty">${t('msg_pick_a_date')}</div>`; return; }
  const p = hnwiByFundParams(useOwnFilter);
  $('#hnwiByFundTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const byFund = await api(`/api/hnwi/by-fund?date=${p.date}&minAum=${p.minAum}&maxAum=${p.maxAum}&minFundAum=${p.minFundAum}&maxFundAum=${p.maxFundAum}`);
    genTable('#hnwiByFundTable', byFund, [
      ...HNWI_CONTACT_COLS, ...HNWI_RISK_COLS,
      { key: 'fund_name', label: t('col_fund') }, { key: 'fund_aum', label: t('col_fund_aum'), type: 'idr', sum: true },
      { key: 'aum_date', label: t('col_aum_date'), type: 'date' }, { key: 'total_aum', label: 'Total AUM', type: 'idr' },
    ], 'No fund holdings at or above this AUM threshold.');
  } catch (e) {
    $('#hnwiByFundTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  }
}
function loadHnwi() {
  return Promise.all([loadHnwiTotal(), loadHnwiByFund(false)]);
}

// DORMANT WIN-BACK: computed live from main.transactions (see queries.js),
// so this just loads once per session, same as e.g. loadReconciliation:
// there's no date filter to re-apply, just a fresh server round-trip.
let dormantLoaded = false;
function renderDormantKpis(summaryRows) {
  const totalPeriods = summaryRows.reduce((s, r) => s + (Number(val(r.total_dormancy_periods)) || 0), 0);
  const converted = summaryRows.reduce((s, r) => s + (Number(val(r.converted_periods)) || 0), 0);
  const revenue = summaryRows.reduce((s, r) => s + (Number(val(r.total_revenue)) || 0), 0);
  $('#dwKpis').innerHTML = [
    kpi(t('dw_kpi_population'), num(totalPeriods), t('dw_kpi_population_sub'), '', ICONS.users),
    kpi(t('dw_kpi_converted'), num(converted), t('dw_kpi_converted_sub'), 'accent', ICONS.userPlus),
    kpi(t('dw_kpi_rate'), pct(converted, totalPeriods), t('dw_kpi_rate_sub'), '', ICONS.trendUp),
    kpi(t('dw_kpi_revenue'), idr(revenue), t('dw_kpi_revenue_sub'), 'accent', ICONS.coin),
  ].join('');
}
function loadDormant() {
  ['#dwConversionTable', '#dwRepeatTable', '#dwTtcTable'].forEach((s) =>
    $(s).innerHTML = '<div class="loading">Loading…</div>');
  const pSummary = api('/api/dormant/conversion-summary');
  const pRepeat = api('/api/dormant/repeat-buyers');
  const pTtc = api('/api/dormant/time-to-convert');
  gateTabLoad((v) => { dormantLoaded = v; }, [pSummary, pRepeat, pTtc]);

  pSummary.then((summary) => {
    renderDormantKpis(summary);
    genTable('#dwConversionTable', summary, [
      { key: 'dormant_category', label: t('col_dormancy_length') },
      { key: 'total_dormancy_periods', label: t('col_episodes'), type: 'num', sum: true },
      { key: 'converted_periods', label: t('col_converted'), type: 'num', sum: true },
      { key: 'conversion_rate_pct', label: t('col_conversion'), type: 'pct' },
      { key: 'total_revenue', label: t('col_revenue'), type: 'idr', sum: true },
      { key: 'avg_revenue_per_conversion', label: t('col_avg_per_conversion'), type: 'idr' },
      { key: 'median_revenue_per_conversion', label: t('col_median_per_conversion'), type: 'idr' },
      { key: 'max_revenue_per_conversion', label: t('col_max_per_conversion'), type: 'idr' },
    ], 'No dormancy episodes found.');
  }).catch((e) => {
    $('#dwKpis').innerHTML = '';
    $('#dwConversionTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  });
  pRepeat.then((rows) => genTable('#dwRepeatTable', rows, [
    { key: 'user_id', label: t('col_user_id') }, { key: 'dormant_category', label: t('col_longest_dormancy_recovered') },
    { key: 'buyer_type', label: t('col_buyer_type') },
    { key: 'txn_count', label: t('col_lifetime_buys'), type: 'num' }, { key: 'total_spent', label: t('col_lifetime_spend'), type: 'idr' },
  ], 'No repeat-buyer data.')).catch((e) => $('#dwRepeatTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);
  pTtc.then((rows) => genTable('#dwTtcTable', rows, [
    { key: 'user_id', label: t('col_user_id') }, { key: 'dormant_category', label: t('col_dormancy_length') },
    { key: 'first_txn_date', label: t('col_comeback_buy'), type: 'date' }, { key: 'days_to_convert', label: t('col_days_to_convert'), type: 'num' },
  ], 'No time-to-convert data.')).catch((e) => $('#dwTtcTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);
  // Each fetch above already renders its own error into its table on failure,
  // so the combined promise never needs to reject: callers (and the smoke
  // test) just await "every panel has settled, one way or another."
  return Promise.allSettled([pSummary, pRepeat, pTtc]);
}

// REFERRAL ACTIVITY (tab id "kalcer", kept so saved access rights still
// match): raw main.user_referrals links + dated AUM, no bonus math (see
// queries.js). An "as of" date picker, same pattern as HNWI, plus
// a free-text search shared by both tables below.
let kalcerLoaded = false;
let kalcerDateDefaulted = false;
async function kalcerEnsureDate() {
  if (!kalcerDateDefaulted) {
    try {
      const { latestDate } = await api('/api/kalcer/latest-date');
      if (latestDate) {
        kalcerDateDefaulted = true;
        if (!$('#kalcerDate').value) $('#kalcerDate').value = val(latestDate);
      }
    } catch { /* leave blank and retry on next load: user can still pick a date manually */ }
  }
  return !!$('#kalcerDate').value;
}
function renderKalcerKpis(rows) {
  const ambassadors = rows.length;
  const referred = rows.reduce((s, r) => s + (Number(val(r.referred_count)) || 0), 0);
  const aum = rows.reduce((s, r) => s + (Number(val(r.total_aum_referred)) || 0), 0);
  const mostRecent = rows.reduce((max, r) => {
    const d = val(r.last_referral_date);
    return !max || (d && d > max) ? d : max;
  }, null);
  $('#kalcerKpis').innerHTML = [
    kpi(t('kalcer_kpi_ambassadors'), num(ambassadors), t('kalcer_kpi_ambassadors_sub'), '', ICONS.users),
    kpi(t('kalcer_kpi_referred'), num(referred), t('kalcer_kpi_referred_sub'), '', ICONS.userPlus),
    kpi(t('kalcer_kpi_aum'), idr(aum), t('kalcer_kpi_aum_sub'), 'accent', ICONS.coin),
    kpi(t('kalcer_kpi_recent'), mostRecent ? String(mostRecent).slice(0, 10) : 'n/a', t('kalcer_kpi_recent_sub'), '', ICONS.hourglass),
  ].join('');
}
function kalcerParams() {
  return { date: $('#kalcerDate').value, q: $('#kalcerSearchInput').value.trim() };
}
async function loadKalcer() {
  if (!(await kalcerEnsureDate())) { $('#kalcerSummaryTable').innerHTML = `<div class="empty">${t('msg_pick_a_date')}</div>`; return; }
  ['#kalcerSummaryTable', '#kalcerDetailTable'].forEach((s) => $(s).innerHTML = '<div class="loading">Loading…</div>');
  const p = kalcerParams();
  const qs = `date=${p.date}&q=${encodeURIComponent(p.q)}`;
  const pSummary = api(`/api/kalcer/summary?${qs}`);
  const pDetail = api(`/api/kalcer/detail?${qs}`);
  gateTabLoad((v) => { kalcerLoaded = v; }, [pSummary, pDetail]);

  pSummary.then((rows) => {
    renderKalcerKpis(rows);
    genTable('#kalcerSummaryTable', rows, [
      { key: 'referrer_name', label: t('col_name') }, { key: 'referrer_sid', label: 'SID' }, { key: 'referrer_email', label: 'Email' },
      { key: 'referred_count', label: t('col_referred'), type: 'num', sum: true },
      { key: 'first_referral_date', label: t('col_first_referral'), type: 'date' },
      { key: 'last_referral_date', label: t('col_last_referral'), type: 'date' },
      { key: 'total_aum_referred', label: t('col_aum_referred'), type: 'idr', sum: true },
    ], 'No referrers match.');
  }).catch((e) => {
    $('#kalcerKpis').innerHTML = '';
    $('#kalcerSummaryTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  });
  pDetail.then((rows) => genTable('#kalcerDetailTable', rows, [
    { key: 'referrer_name', label: t('col_referrer') }, { key: 'referrer_sid', label: t('col_referrer_sid') },
    { key: 'invitee_name', label: t('col_referred_investor') }, { key: 'invitee_sid', label: t('col_investor_sid') },
    { key: 'referral_date', label: t('col_referral_date'), type: 'date' },
    { key: 'invitee_aum', label: t('col_investor_aum'), type: 'idr', sum: true },
  ], 'No referrals match.')).catch((e) => $('#kalcerDetailTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  return Promise.allSettled([pSummary, pDetail]);
}

// PUSH DELIVERY: Firebase Cloud Messaging's own send-pipeline health log
// (own dataset). Send/delivery only, no open/click/revenue data exists here.
let pushLoaded = false;
function pushRange() {
  return { from: $('#pushFrom').value, to: $('#pushTo').value };
}
function renderPushKpis(platformRows) {
  const totalSends = platformRows.reduce((s, r) => s + (Number(val(r.total_sends)) || 0), 0);
  const accepted = platformRows.reduce((s, r) => s + (Number(val(r.accepted)) || 0), 0);
  const android = platformRows.find((r) => val(r.sdk_platform) === 'ANDROID');
  const ios = platformRows.find((r) => val(r.sdk_platform) === 'IOS');
  $('#pushKpis').innerHTML = [
    kpi(t('push_kpi_sends'), num(totalSends), t('push_kpi_sends_sub'), '', ICONS.activity),
    kpi(t('push_kpi_rate'), pct(accepted, totalSends), t('push_kpi_rate_sub'), 'accent', ICONS.check),
    kpi(t('push_kpi_android_rate'), android ? pct(Number(val(android.accepted)), Number(val(android.total_sends))) : 'n/a', t('push_kpi_android_rate_sub'), '', ICONS.trendUp),
    kpi(t('push_kpi_ios_rate'), ios ? pct(Number(val(ios.accepted)), Number(val(ios.total_sends))) : 'n/a', t('push_kpi_ios_rate_sub'), '', ICONS.trendUp),
  ].join('');
}
// Single-axis bar chart: send volume over time only. Delivery rate (0-100%)
// and send volume (raw counts) are different scales, so it stays off this
// chart rather than becoming a second y-axis: it's already in the KPIs and
// the platform/campaign tables below.
function renderPushTrendChart(rows) {
  paint('pushTrendChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.bucket)),
      datasets: [{ label: t('col_sends'), data: rows.map((d) => Number(val(d.total_sends))), backgroundColor: C.indigo, borderRadius: 4 }],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: C.grid }, ticks: { callback: (v) => num(v) } },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${num(c.raw)} sends` } },
      },
    },
  });
}
function loadPush() {
  ['#pushPlatformTable', '#pushCampaignTable'].forEach((s) => $(s).innerHTML = '<div class="loading">Loading…</div>');
  const r = pushRange();
  const qs = `from=${r.from}&to=${r.to}`;
  const pTrend = api(`/api/push/trend?${qs}&granularity=week`);
  const pPlatform = api(`/api/push/by-platform?${qs}`);
  const pCampaign = api(`/api/push/by-campaign?${qs}`);
  gateTabLoad((v) => { pushLoaded = v; }, [pTrend, pPlatform, pCampaign]);

  pTrend.then(renderPushTrendChart).catch((e) => showFail('pushTrendChart', e));
  pPlatform.then((rows) => {
    renderPushKpis(rows);
    genTable('#pushPlatformTable', rows, [
      { key: 'sdk_platform', label: 'Platform' },
      { key: 'total_sends', label: t('col_sends'), type: 'num', sum: true },
      { key: 'accepted', label: t('col_accepted'), type: 'num', sum: true },
      { key: 'delivery_rate_pct', label: t('col_delivery_rate'), type: 'pct' },
    ], 'No data in this period.');
  }).catch((e) => {
    $('#pushKpis').innerHTML = '';
    $('#pushPlatformTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  });
  pCampaign.then((rows) => genTable('#pushCampaignTable', rows, [
    { key: 'analytics_label', label: t('col_campaign') },
    { key: 'total_sends', label: t('col_sends'), type: 'num', sum: true },
    { key: 'accepted', label: t('col_accepted'), type: 'num', sum: true },
    { key: 'missing_registrations', label: t('col_missing_registrations'), type: 'num', sum: true },
    { key: 'other_errors', label: t('col_other_errors'), type: 'num', sum: true },
    { key: 'delivery_rate_pct', label: t('col_delivery_rate'), type: 'pct' },
  ], 'No campaigns in this period.')).catch((e) => $('#pushCampaignTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  return Promise.allSettled([pTrend, pPlatform, pCampaign]);
}

// MARKETING ATTRIBUTION: Adjust's mobile attribution events (own dataset),
// one row per channel: clicks through to a completed payment.
let marketingLoaded = false;
function mktRange() {
  return { from: $('#mktFrom').value, to: $('#mktTo').value };
}
function renderMarketingKpis(rows) {
  const installs = rows.reduce((s, r) => s + (Number(val(r.installs)) || 0), 0);
  const registered = rows.reduce((s, r) => s + (Number(val(r.registrations)) || 0), 0);
  const kyc = rows.reduce((s, r) => s + (Number(val(r.kyc_verified)) || 0), 0);
  const revenue = rows.reduce((s, r) => s + (Number(val(r.total_revenue)) || 0), 0);
  const payments = rows.reduce((s, r) => s + (Number(val(r.payments_completed)) || 0), 0);
  $('#mktKpis').innerHTML = [
    kpi(t('mkt_kpi_installs'), num(installs), t('mkt_kpi_installs_sub'), '', ICONS.userPlus),
    kpi(t('mkt_kpi_registered'), pct(registered, installs), t('mkt_kpi_registered_sub'), '', ICONS.check),
    kpi(t('mkt_kpi_kyc'), pct(kyc, installs), t('mkt_kpi_kyc_sub'), '', ICONS.check),
    kpi(t('mkt_kpi_revenue'), idr(revenue), `${num(payments)} ${t('mkt_kpi_revenue_sub')}`, 'accent', ICONS.coin),
  ].join('');
}
function loadMarketing() {
  $('#mktTable').innerHTML = '<div class="loading">Loading…</div>';
  const r = mktRange();
  const p = api(`/api/marketing/funnel?from=${r.from}&to=${r.to}`);
  gateTabLoad((v) => { marketingLoaded = v; }, [p]);
  return p.then((rows) => {
    renderMarketingKpis(rows);
    genTable('#mktTable', rows, [
      { key: 'channel', label: t('col_channel') },
      { key: 'clicks', label: t('col_clicks'), type: 'num', sum: true },
      { key: 'installs', label: t('col_installs'), type: 'num', sum: true },
      { key: 'otp_verified', label: t('col_otp_verified'), type: 'num', sum: true },
      { key: 'registrations', label: t('col_registered'), type: 'num', sum: true },
      { key: 'kyc_verified', label: t('col_kyc_verified'), type: 'num', sum: true },
      { key: 'orders_created', label: t('col_orders_created'), type: 'num', sum: true },
      { key: 'payments_completed', label: t('col_payments'), type: 'num', sum: true },
      { key: 'total_revenue', label: t('col_revenue'), type: 'idr', sum: true },
    ], 'No channel activity in this period.');
  }).catch((e) => {
    $('#mktKpis').innerHTML = '';
    $('#mktTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  });
}

// APP HEALTH: Crashlytics + Performance Monitoring (own datasets, Android +
// iOS unioned server-side).
let appHealthLoaded = false;
function ahRange() {
  return { from: $('#ahFrom').value, to: $('#ahTo').value };
}
function renderAppHealthKpis(crashRows, perfRows) {
  const totalErrors = crashRows.reduce((s, r) => s + (Number(val(r.event_count)) || 0), 0);
  const fatalRows = crashRows.filter((r) => val(r.is_fatal) === true);
  const fatalEvents = fatalRows.reduce((s, r) => s + (Number(val(r.event_count)) || 0), 0);
  const fatalDevices = fatalRows.reduce((s, r) => s + (Number(val(r.affected_devices)) || 0), 0);
  const samples = perfRows.reduce((s, r) => s + (Number(val(r.sample_count)) || 0), 0);
  const slowest = perfRows[0]; // perfRows already sorted by median_duration_ms DESC
  $('#ahKpis').innerHTML = [
    kpi(t('ah_kpi_errors'), num(totalErrors), t('ah_kpi_errors_sub'), '', ICONS.xCircle),
    kpi(t('ah_kpi_fatal'), num(fatalEvents), `${num(fatalDevices)} ${t('ah_kpi_fatal_sub')}`, 'warn', ICONS.xCircle),
    kpi(t('ah_kpi_slowest'), slowest ? `${(Number(val(slowest.median_duration_ms)) / 1000).toFixed(1)}s` : 'n/a',
      slowest ? `${val(slowest.event_name)} (${val(slowest.platform)})` : t('ah_kpi_slowest_sub'), '', ICONS.hourglass),
    kpi(t('ah_kpi_samples'), num(samples), t('ah_kpi_samples_sub'), '', ICONS.activity),
  ].join('');
}
function loadAppHealth() {
  ['#ahCrashTable', '#ahPerfTable'].forEach((s) => $(s).innerHTML = '<div class="loading">Loading…</div>');
  const r = ahRange();
  const qs = `from=${r.from}&to=${r.to}`;
  const pCrash = api(`/api/app-health/crashes?${qs}`);
  const pPerf = api(`/api/app-health/performance?${qs}`);
  gateTabLoad((v) => { appHealthLoaded = v; }, [pCrash, pPerf]);

  Promise.all([pCrash, pPerf]).then(([crashRows, perfRows]) => renderAppHealthKpis(crashRows, perfRows))
    .catch(() => { $('#ahKpis').innerHTML = ''; });
  pCrash.then((rows) => genTable('#ahCrashTable', rows, [
    { key: 'platform', label: 'Platform' },
    { key: 'issue_title', label: t('col_issue') },
    { key: 'is_fatal', label: 'Fatal' },
    { key: 'event_count', label: t('col_events'), type: 'num', sum: true },
    { key: 'affected_devices', label: t('col_affected_devices'), type: 'num', sum: true },
    { key: 'latest_app_version', label: t('col_latest_version') },
  ], 'No crash/error issues in this period.')).catch((e) => $('#ahCrashTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);
  pPerf.then((rows) => genTable('#ahPerfTable', rows, [
    { key: 'platform', label: 'Platform' },
    { key: 'event_name', label: t('col_operation') },
    { key: 'sample_count', label: t('col_samples'), type: 'num', sum: true },
    { key: 'median_duration_ms', label: 'Median (ms)', type: 'num' },
    { key: 'avg_duration_ms', label: t('col_avg_ms'), type: 'num' },
  ], 'No performance data in this period.')).catch((e) => $('#ahPerfTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  return Promise.allSettled([pCrash, pPerf]);
}

// genTable writes cell values as raw HTML; text that comes from people
// (email subjects, campaign names, investor names) is escaped first.
const escRows = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, val(r[k]) == null ? null : escapeHtml(val(r[k]))])) }));
const ratePct = (a, b) => (Number(b) ? (Number(a) / Number(b)) * 100 : null);
// Jakarta wall-clock time for a Postgres timestamptz string.
const wib = (ts) => (ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16) : 'n/a');
function daysAgoRange(days) {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - days);
  return { from: isoDate(from), to: isoDate(to) };
}

// EMAIL RECAP: every email the dashboard sends (dashboard_email_log in
// Supabase, written by server/mail.js) and the delivery/open/click events
// Amazon SES reports back for each one.
let emailRecapLoaded = false;
let erSummary = null;
const er = { offset: 0, limit: 50, total: 0, rows: null, sort: null };
const ER_CATEGORY_KEYS = {
  statement: 'er_cat_statement', fund_performance: 'er_cat_fund_performance', invite: 'er_cat_invite',
  password_reset: 'er_cat_password_reset', schedule_otp: 'er_cat_schedule_otp', other: 'er_cat_other',
};
const ER_SOURCE_KEYS = {
  manual: 'er_src_manual', batch: 'er_src_batch', schedule: 'er_src_schedule', system: 'er_src_system', script: 'er_src_script', ses: 'er_src_ses',
};
// outcome -> [label key, tag class]; problems red, engagement green, delivered blue, nothing-back grey.
const ER_OUTCOME = {
  failed: ['er_out_failed', 'sell'], bounced: ['er_out_bounced', 'sell'], complained: ['er_out_complained', 'sell'], rejected: ['er_out_rejected', 'sell'],
  clicked: ['er_out_clicked', 'buy'], opened: ['er_out_opened', 'buy'], delivered: ['er_out_delivered', 'other'], sent: ['er_out_sent', 'expired'],
};
const ER_EVENT_KEYS = {
  Send: 'er_ev_send', Delivery: 'er_ev_delivery', Open: 'er_ev_open', Click: 'er_ev_click', Bounce: 'er_ev_bounce',
  Complaint: 'er_ev_complaint', Reject: 'er_ev_reject', DeliveryDelay: 'er_ev_delay', RenderingFailure: 'er_ev_rendering',
};
const erLabel = (keys, k) => (keys[k] ? t(keys[k]) : escapeHtml(k || 'n/a'));
function erFilters() {
  return { from: $('#erFrom').value, to: $('#erTo').value, category: $('#erCategory').value, source: $('#erSource').value };
}
const erQs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const erWithRates = (r) => ({ ...r, open_rate: ratePct(r.opened, r.delivered), click_rate: ratePct(r.clicked, r.delivered) });

function renderEmailRecapKpis(x) {
  const n = (k) => Number(x[k]) || 0;
  $('#erKpis').innerHTML = [
    kpi(t('er_kpi_sent'), num(n('sent')), `${num(n('failed'))} ${t('er_kpi_failed_sub')} · ${num(n('recipients'))} ${t('er_kpi_recipients_sub')}`, 'accent', ICONS.activity),
    kpi(t('er_kpi_delivered'), num(n('delivered')), `${pct(n('delivered'), n('sent'))} ${t('er_kpi_of_sent')}`, '', ICONS.check),
    kpi(t('er_kpi_opened'), num(n('opened')), `${pct(n('opened'), n('delivered'))} ${t('er_kpi_of_delivered')} · ${num(n('opens'))} ${t('er_kpi_opens_total')}`, '', ICONS.eye),
    kpi(t('er_kpi_clicked'), num(n('clicked')), `${pct(n('clicked'), n('delivered'))} ${t('er_kpi_of_delivered')} · ${pct(n('clicked'), n('opened'))} ${t('er_kpi_of_openers')}`, '', ICONS.trendUp),
    kpi(t('er_kpi_bounced'), num(n('bounced')), `${pct(n('bounced'), n('sent'))} ${t('er_kpi_of_sent')}`, n('bounced') ? 'warn' : '', ICONS.xCircle),
    kpi(t('er_kpi_complained'), num(n('complained')), t('er_kpi_complained_sub'), n('complained') ? 'warn' : '', ICONS.xCircle),
  ].join('');
}
// Sent as bars, opened/clicked as lines: all three are email counts, so
// they share one axis.
function renderEmailTrendChart(days) {
  $('#erTrendEmpty').hidden = days.length > 0;
  paint('erTrendChart', {
    type: 'bar',
    data: {
      labels: days.map((d) => d.day),
      datasets: [
        { type: 'bar', label: t('er_series_sent'), data: days.map((d) => d.sent), backgroundColor: C.indigo, borderRadius: 4, order: 3 },
        { type: 'line', label: t('er_series_opened'), data: days.map((d) => d.opened), borderColor: C.chartAmber, backgroundColor: C.chartAmber, borderWidth: 2, pointRadius: 4, order: 1 },
        { type: 'line', label: t('er_series_clicked'), data: days.map((d) => d.clicked), borderColor: C.chartGreen, backgroundColor: C.chartGreen, borderWidth: 2, pointRadius: 4, order: 2 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, grid: { color: C.grid }, ticks: { precision: 0, callback: (v) => num(v) } },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.raw)}` } },
      },
    },
  });
}
function renderEmailRecap(d) {
  const tr = d.tracking || {};
  $('#erTracking').textContent = Number(tr.events)
    ? t('er_tracking_on').replace('{time}', wib(tr.last_event_at))
    : t('er_tracking_off');
  renderEmailRecapKpis(d.totals || {});
  renderEmailTrendChart(d.by_day || []);
  const rateCols = [
    { key: 'sent', label: t('er_col_sent'), type: 'num', sum: true },
    { key: 'failed', label: t('er_col_failed'), type: 'num', sum: true },
    { key: 'delivered', label: t('er_col_delivered'), type: 'num', sum: true },
    { key: 'opened', label: t('er_col_opened'), type: 'num', sum: true },
    { key: 'open_rate', label: t('er_col_open_rate'), type: 'pct' },
    { key: 'clicked', label: t('er_col_clicked'), type: 'num', sum: true },
    { key: 'click_rate', label: t('er_col_click_rate'), type: 'pct' },
    { key: 'bounced', label: t('er_col_bounced'), type: 'num', sum: true },
  ];
  genTable('#erCategoryTable', (d.by_category || []).map((r) => ({ ...erWithRates(r), category: erLabel(ER_CATEGORY_KEYS, r.category) })), [
    { key: 'category', label: t('er_col_category') }, ...rateCols,
    { key: 'complained', label: t('er_col_complained'), type: 'num', sum: true },
  ], t('er_empty'));
  genTable('#erSubjectTable', escRows(d.by_subject || [], ['subject']).map((r) => ({
    ...erWithRates(r), subject: r.subject || t('er_no_subject'), category: erLabel(ER_CATEGORY_KEYS, r.category),
    first_sent: wib(r.first_sent), last_sent: wib(r.last_sent),
  })), [
    { key: 'subject', label: t('er_col_subject') }, { key: 'category', label: t('er_col_category') },
    { key: 'first_sent', label: t('er_col_first_sent') }, { key: 'last_sent', label: t('er_col_last_sent') }, ...rateCols,
  ], t('er_empty'));
  genTable('#erLinksTable', escRows(d.top_links || [], ['link']), [
    { key: 'link', label: t('er_col_link') },
    { key: 'clicks', label: t('er_col_clicks'), type: 'num', sum: true },
    { key: 'emails', label: t('er_col_emails'), type: 'num' },
  ], t('er_links_empty'));
}

function renderEmailLog() {
  const rows = er.rows || [];
  $('#erPageInfo').textContent = er.total ? `${num(er.offset + 1)}-${num(er.offset + rows.length)} / ${num(er.total)}` : '';
  $('#erPrev').disabled = er.offset === 0;
  $('#erNext').disabled = er.offset + rows.length >= er.total;
  if (!rows.length) { $('#erLogTable').innerHTML = `<div class="empty">${t('er_log_empty')}</div>`; return; }
  const cell = (v) => (v == null || v === '' ? 'n/a' : escapeHtml(v));
  const when = (ts) => `<td class="mono">${ts ? wib(ts) : 'n/a'}</td>`;
  const body = rows.map((r) => {
    const [key, cls] = ER_OUTCOME[r.outcome] || ['er_out_sent', 'expired'];
    return `<tr>${when(r.created_at)}<td>${cell(r.recipient)}</td><td>${cell(r.subject)}</td>
      <td>${erLabel(ER_CATEGORY_KEYS, r.category)}</td><td>${erLabel(ER_SOURCE_KEYS, r.source)}</td>
      <td>${cell(r.description)}</td><td>${cell(r.sent_by)}</td>
      <td><span class="tag ${cls}">${t(key)}</span></td>
      ${when(r.delivered_at)}${when(r.opened_at)}<td class="num">${num(r.open_count || 0)}</td>
      ${when(r.clicked_at)}<td class="num">${num(r.click_count || 0)}</td>
      <td>${cell(r.error || r.bounce_type)}</td>
      <td><button type="button" class="btn-ghost" data-er-events="${escapeHtml(r.id)}">${t('er_events_btn')}</button></td></tr>`;
  }).join('');
  // [label key, column of dashboard_email_overview the server sorts by]
  const head = [['er_col_sent_at', 'created_at'], ['er_col_recipient', 'recipient'], ['er_col_subject', 'subject'],
    ['er_col_category', 'category'], ['er_col_source', 'source'], ['er_col_description', 'description'], ['er_col_sent_by', 'sent_by'],
    ['er_col_outcome', 'outcome'], ['er_col_delivered_at', 'delivered_at'], ['er_col_first_open', 'opened_at'], ['er_col_opens', 'open_count'],
    ['er_col_first_click', 'clicked_at'], ['er_col_clicks', 'click_count'], ['er_col_error', 'error']]
    .map(([k, col]) => { const n = ['open_count', 'click_count'].includes(col); return sortTh(t(k), col, er.sort, n ? 'num' : '', n || col.endsWith('_at') ? 'desc' : 'asc'); }).join('');
  $('#erLogTable').innerHTML = `<table><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody></table>`;
}
function loadEmailLog() {
  $('#erLogTable').innerHTML = `<div class="loading">${t('common_loading')}</div>`;
  const p = api(`/api/email-recap/log?${erQs({ ...erFilters(), outcome: $('#erOutcome').value, search: $('#erSearch').value.trim(), ...sortParams(er.sort), limit: er.limit, offset: er.offset })}`);
  p.then((d) => { er.rows = d.rows || []; er.total = d.total || 0; renderEmailLog(); })
    .catch((e) => { $('#erLogTable').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; });
  return p;
}
function loadEmailRecap() {
  ['#erCategoryTable', '#erSubjectTable', '#erLinksTable'].forEach((s) => $(s).innerHTML = `<div class="loading">${t('common_loading')}</div>`);
  $('#erKpis').innerHTML = '';
  er.offset = 0;
  const pSummary = api(`/api/email-recap/summary?${erQs(erFilters())}`);
  const pLog = loadEmailLog();
  gateTabLoad((v) => { emailRecapLoaded = v; }, [pSummary, pLog]);
  pSummary.then((d) => { erSummary = d; renderEmailRecap(d); }).catch((e) => {
    $('#erTracking').textContent = '';
    ['#erCategoryTable', '#erSubjectTable', '#erLinksTable'].forEach((s) => $(s).innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`);
  });
  return Promise.allSettled([pSummary, pLog]);
}
function emailEventDetail(ev) {
  const d = ev.detail || {};
  if (ev.event_type === 'Click') return ev.link;
  if (ev.event_type === 'Bounce') return [d.bounceType, d.bounceSubType].filter(Boolean).join(' / ') + (d.diagnostic ? `: ${d.diagnostic}` : '');
  return d.smtpResponse || d.feedbackType || d.reason || d.delayType || d.error || '';
}
async function openEmailEvents(id) {
  const row = (er.rows || []).find((r) => r.id === id);
  $('#erEventsMeta').textContent = row ? `${row.recipient} · ${row.subject || t('er_no_subject')} · ${wib(row.created_at)}` : '';
  $('#erEventsBody').innerHTML = `<div class="loading">${t('common_loading')}</div>`;
  $('#erEventsModal').showModal();
  try {
    const events = await api(`/api/email-recap/log/${encodeURIComponent(id)}/events`);
    if (!events.length) { $('#erEventsBody').innerHTML = `<div class="empty">${t('er_events_empty')}</div>`; return; }
    const body = events.map((ev) => `<tr><td class="mono">${wib(ev.occurred_at)}</td><td>${erLabel(ER_EVENT_KEYS, ev.event_type)}</td>
      <td>${escapeHtml(emailEventDetail(ev) || 'n/a')}</td><td>${escapeHtml(ev.user_agent || 'n/a')}</td></tr>`).join('');
    $('#erEventsBody').innerHTML = `<table><thead><tr><th>${t('er_col_time')}</th><th>${t('er_col_event')}</th><th>${t('er_col_detail')}</th><th>${t('er_col_mail_app')}</th></tr></thead><tbody>${body}</tbody></table>`;
  } catch (e) { $('#erEventsBody').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

// INVESTOR JOURNEY (tab id user-behavior): one investor's app events and
// transactions on one timeline. The period-wide app-use panels live in
// Engagement and Subscription analysis.
const bhCache = {};
let bhSelected = null; // { userId, sid, name, email }
function bhRange() { return { from: $('#bhFrom').value, to: $('#bhTo').value }; }
function repaintBehavior() { if (bhCache.user) renderBehaviorUser(bhCache.user); }

async function searchBehaviorUsers() {
  const q = $('#bhSearchInput').value.trim();
  if (!q) return;
  $('#bhResults').innerHTML = `<div class="loading">${t('bh_searching')}</div>`;
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    if (!rows.length) { $('#bhResults').innerHTML = `<div class="empty">${t('bh_no_match')}</div>`; return; }
    const a = (v) => escapeHtml(val(v) || '');
    const body = rows.map((u) => `<tr><td>${a(u.sid) || 'n/a'}</td><td>${a(u.name) || 'n/a'}</td><td>${a(u.email) || 'n/a'}</td>
      <td><button type="button" class="btn-ghost" data-bh-user="${a(u.user_id)}" data-sid="${a(u.sid)}" data-name="${a(u.name)}" data-email="${a(u.email)}">${t('bh_show_journey')}</button></td></tr>`).join('');
    $('#bhResults').innerHTML = `<table><thead><tr><th>SID</th><th>${t('bh_col_name')}</th><th>${t('bh_col_email')}</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  } catch (e) { $('#bhResults').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}
function renderBehaviorUser({ profile: p, timeline }) {
  if (!p) { $('#bhUserKpis').innerHTML = `<div class="empty">${t('bh_user_missing')}</div>`; $('#bhTimeline').innerHTML = ''; return; }
  const v = (k) => escapeHtml(val(p[k]) ?? '');
  $('#bhUserKpis').innerHTML = [
    kpi(t('bh_user_registered'), v('registered_on') || 'n/a', `${t('bh_col_kyc')}: ${v('verification_status') || 'n/a'}${v('verified_on') ? ` (${v('verified_on')})` : ''}`, '', ICONS.user),
    kpi(t('bh_user_aum'), idr(val(p.aum_now)), `${num(val(p.lifetime_buys) || 0)} ${t('bh_user_buys_since')} ${v('first_buy') || 'n/a'}`, 'accent', ICONS.coin),
    kpi(t('bh_user_activity'), `${num(val(p.active_days) || 0)} ${t('bh_user_days')}`, `${num(val(p.sessions) || 0)} ${t('bh_user_sessions')} · ${t('bh_user_last_seen')} ${v('last_seen_wib') || 'n/a'}`, '', ICONS.activity),
    kpi(t('bh_user_device'), v('platform') || 'n/a', [v('device'), v('app_version') && `v${v('app_version')}`].filter(Boolean).join(' · ') || t('bh_user_no_app'), '', ICONS.monitor),
  ].join('');
  const rows = escRows(timeline, ['event', 'detail', 'status', 'platform']).map((r) => ({
    ...r,
    source: r.source === 'transaction' ? `<span class="tag buy">${t('bh_src_transaction')}</span>` : `<span class="tag other">${t('bh_src_app')}</span>`,
  }));
  genTable('#bhTimeline', rows, [
    { key: 'time_wib', label: t('bh_col_time') },
    { key: 'source', label: t('bh_col_source') },
    { key: 'event', label: t('bh_col_event') },
    { key: 'detail', label: t('bh_col_detail') },
    { key: 'amount', label: t('bh_col_amount'), type: 'idr' },
    { key: 'status', label: t('bh_col_tx_status') },
    { key: 'session_id', label: t('bh_col_session') },
  ], t('bh_timeline_empty'));
}
async function loadBehaviorUser() {
  if (!bhSelected) return;
  const r = bhRange();
  $('#bhJourney').classList.remove('hidden');
  $('#bhUserName').textContent = bhSelected.name || bhSelected.sid;
  $('#bhUserSub').textContent = `SID ${bhSelected.sid}${bhSelected.email ? ` · ${bhSelected.email}` : ''} · ${t('range_from')} ${r.from} ${t('range_to').toLowerCase()} ${r.to}`;
  $('#bhUserKpis').innerHTML = `<div class="loading">${t('common_loading')}</div>`;
  $('#bhTimeline').innerHTML = '';
  try {
    bhCache.user = await api(`/api/behavior/user?userId=${encodeURIComponent(bhSelected.userId)}&from=${r.from}&to=${r.to}`);
    renderBehaviorUser(bhCache.user);
  } catch (e) { $('#bhUserKpis').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

// ANALYSIS TABS (Subscription, Onboarding, Redemption, Engagement): GA4 app
// events joined to the main database by user_id = main.users.id; matching
// rules live with the queries (server/queries.js). Every panel names the
// tables it joins and opens with a finding written from the rows it loaded,
// so a reader can check each sentence against the table under it.
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const nval = (v) => Number(val(v)) || 0;
const pctOf = (a, b) => (b ? (a / b) * 100 : 0);
function story(sel, sentences) {
  const text = sentences.filter(Boolean).join(' ');
  $(sel).innerHTML = text ? `<strong>${t('an_finding')}</strong>${text}` : '';
}
// Loading and error text for a section's own spot: a table div, a chart's
// message line, or the data-map list.
function anStatus(sel, cls, text) {
  const el = $(sel);
  if (el.tagName === 'P') { el.textContent = text; el.hidden = false; return; }
  el.innerHTML = el.tagName === 'UL' ? `<li>${escapeHtml(text)}</li>` : `<div class="${cls}">${escapeHtml(text)}</div>`;
}
function renderCoverage(sel, rows) {
  const c = rows && rows[0];
  if (!c) return;
  const line = (key, matched, total) => `<li>${tf(key, { pct: pct(nval(c[matched]), nval(c[total])), n: num(nval(c[total])) })}</li>`;
  $(sel).innerHTML = [
    line('an_cov_users', 'app_users_in_db', 'app_users'),
    line('an_cov_buys', 'db_buys_in_app', 'db_buys'),
    line('an_cov_sells', 'db_sells_in_app', 'db_sells'),
    line('an_cov_switches', 'db_switches_in_app', 'db_switches'),
    line('an_cov_signups', 'db_signups_in_app', 'db_signups'),
  ].join('');
}
// Every section of one tab: [endpoint, where loading and errors show (one
// selector or several), renderer]. Rows land in tab.cache under the
// endpoint's last segment, so a language or theme switch repaints from the
// cache. A tab with coverage: false has no data map.
function loadAnalysis(tab) {
  const r = { from: $(`#${tab.prefix}From`).value, to: $(`#${tab.prefix}To`).value };
  tab.charts.forEach((id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
  $(`#${tab.prefix}Kpis`).innerHTML = '';
  $$(`#${tab.id} .story`).forEach((el) => { el.innerHTML = ''; });
  if (tab.reset) tab.reset();
  const coverage = tab.coverage === false ? [] : [['analysis/coverage', `#${tab.prefix}Coverage`, () => renderCoverage(`#${tab.prefix}Coverage`, tab.cache.coverage)]];
  const promises = [...coverage, ...tab.sections]
    .map(([path, sel, render]) => {
      const key = path.split('/').pop();
      const status = (cls, text) => [].concat(sel).forEach((s) => anStatus(s, cls, text));
      delete tab.cache[key];
      status('loading', t('common_loading'));
      const p = api(`/api/${path}?from=${r.from}&to=${r.to}`);
      p.then((rows) => { tab.cache[key] = rows; render(); }).catch((e) => status('empty', e.message));
      return p;
    });
  gateTabLoad((v) => { tab.loaded = v; }, promises);
  return Promise.allSettled(promises);
}
function repaintAnalysis(tab) {
  renderCoverage(`#${tab.prefix}Coverage`, tab.cache.coverage);
  tab.sections.forEach(([path, , render]) => tab.cache[path.split('/').pop()] && render());
}
// Seg-style buttons: one pressed at a time, pressed state for screen readers.
function wireSeg(sel, attr, apply) {
  $(sel).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$(`${sel} button`).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    apply(b.dataset[attr]);
  });
}
function segButtons(sel, attr, values, current, label) {
  $(sel).innerHTML = values.map((v) => {
    const on = v === current;
    return `<button data-${attr}="${escapeHtml(v)}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label(v)}</button>`;
  }).join('');
}
// Largest share lost between two consecutive steps, over steps[from..].
function biggestDrop(steps, counts, from = 1) {
  let drop = null;
  for (let i = Math.max(1, from); i < steps.length; i++) {
    const d = counts[i - 1] ? ((counts[i - 1] - counts[i]) / counts[i - 1]) * 100 : 0;
    if (!drop || d > drop.pct) drop = { pct: d, key: steps[i][1] };
  }
  return drop;
}
// One segment's steps: horizontal bars as a share of the first step, and
// optionally a table with each step against the first and the one before.
// A step's optional third element is an i18n key naming where it comes from.
function renderSteps({ chartId, tableSel, steps, row, color, unit = 'an_people' }) {
  const counts = steps.map(([k]) => nval(row && row[k]));
  const first = counts[0];
  paint(chartId, {
    type: 'bar',
    data: {
      labels: steps.map(([, l]) => t(l)),
      datasets: [{ label: t(unit), data: counts.map((c) => pctOf(c, first)), counts, backgroundColor: color || C.indigo, borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, max: 100, grid: { color: C.grid }, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${num(c.dataset.counts[c.dataIndex])} (${c.raw.toFixed(1)}%)` } } },
    },
  });
  if (tableSel) {
    genTable(tableSel, steps.map(([, l, src], i) => ({
      step: t(l), source: src ? t(src) : '', people: counts[i], of_first: first ? pctOf(counts[i], first) : null, of_prev: i && counts[i - 1] ? pctOf(counts[i], counts[i - 1]) : null,
    })), [
      { key: 'step', label: t('an_col_step') }, ...(steps.some((x) => x[2]) ? [{ key: 'source', label: t('an_col_source') }] : []),
      { key: 'people', label: t(unit), type: 'num' },
      { key: 'of_first', label: t('an_col_of_first'), type: 'pct' }, { key: 'of_prev', label: t('an_col_of_prev'), type: 'pct' },
    ], t('an_empty'));
  }
  return counts;
}
function segLabel(v) {
  if (v === 'all') return t('sa_split_all');
  if (v === 'first' || v === 'repeat') return t(`sa_buyer_${v}`);
  if (v === '(not in app)') return t('ob_not_in_app');
  return { ANDROID: 'Android', IOS: 'iOS' }[v] || escapeHtml(v);
}
// The "screen or action vs outcome" table shared by Subscription drivers and
// Redemption signals. The first row is everyone counted (unique people, from
// the population columns every row repeats), so a reader can see where the
// outcome total comes from: one person sits in many rows below, so those rows
// never add up to it.
function driverRows(rows, withFlow, allLabel) {
  const r0 = rows[0];
  const all = r0 ? [{
    name: `<strong>${t(allLabel)}</strong>`, kind: '', users: val(r0.population), converted: val(r0.population_converted),
    rate_pct: pctOf(nval(r0.population_converted), nval(r0.population)), rate_without_pct: null, lift: '', share_of_converted_pct: 100,
  }] : [];
  return all.concat(rows.filter((r) => withFlow || !val(r.in_flow)).map((r) => ({
    ...r,
    name: `${escapeHtml(val(r.name))}${val(r.in_flow) ? ` <span class="tag other">${t('an_tag_flow')}</span>` : ''}`,
    kind: t(val(r.kind) === 'screen' ? 'sa_kind_screen' : 'sa_kind_action'),
    lift: val(r.lift) == null ? null : `${Number(val(r.lift)).toFixed(2)}×`,
  })));
}
function renderDriverTable(sel, rows, withFlow, labels) {
  genTable(sel, driverRows(rows, withFlow, labels.all), [
    { key: 'name', label: t('sa_col_name') }, { key: 'kind', label: t('sa_col_kind') },
    { key: 'users', label: t('sa_col_did_it'), type: 'num' },
    { key: 'converted', label: t(labels.converted), type: 'num' },
    { key: 'rate_pct', label: t(labels.rate), type: 'pct' },
    { key: 'rate_without_pct', label: t('sa_col_rate_without'), type: 'pct' },
    { key: 'lift', label: t('sa_col_lift') },
    { key: 'share_of_converted_pct', label: t(labels.share), type: 'pct' },
  ], t('sa_driver_empty'));
}
// Top three non-flow rows by lift, at least 30 people each.
function driverStory(sel, rows, key) {
  const top = (rows || []).filter((r) => !val(r.in_flow) && nval(r.users) >= 30 && nval(r.lift) > 1).slice(0, 3);
  if (!rows || !rows.length) { story(sel, []); return; }
  const r0 = rows[0];
  story(sel, [
    tf(`${key}_base`, { n: num(nval(r0.population)), c: num(nval(r0.population_converted)), pct: pct(nval(r0.population_converted), nval(r0.population)) }),
    top.length ? tf(key, { list: top.map((r) => `${escapeHtml(val(r.name))} (${Number(val(r.lift)).toFixed(1)}×)`).join(', ') }) : '',
    t('an_story_correlation'),
  ]);
}

// Subscription analysis
const SA_TAB = { id: 'subscription-analysis', prefix: 'sa', cache: {}, loaded: false, charts: ['saFunnelChart', 'saHoursChart'] };
const saCache = SA_TAB.cache;
const saView = { split: 'all', level: 'screen', step: 1, by: 'hour', dim: 'age_band' };
const SA_STEPS = [
  ['opened_form', 'sa_step_form'], ['checkout', 'sa_step_checkout'], ['payment_method', 'sa_step_payment'],
  ['ordered', 'sa_step_ordered'], ['paid', 'sa_step_paid'],
];
const SA_DROP_STEPS = { 1: 'sa_step_form', 2: 'sa_step_checkout', 3: 'sa_step_payment' };
// Screen, event and version names come from the app's analytics payloads, so
// they are escaped; the two placeholders the server adds are translated.
const SA_PLACEHOLDERS = { '(session start)': 'sa_session_start', '(left the app)': 'sa_left_app' };
const saName = (v) => (SA_PLACEHOLDERS[v] ? t(SA_PLACEHOLDERS[v]) : escapeHtml(v ?? ''));
const saSegment = segLabel;
// Profile values: bucket keys are translated, free-text profile answers
// (occupation, purpose) are shown as stored.
function profileLabel(dim, v) {
  if (v === 'unknown') return t('an_unknown');
  if (dim === 'age_band' || dim === 'tenure') return t(`sa_${dim}_${v}`);
  if (dim === 'gender') return t(`an_gender_${v}`) === `an_gender_${v}` ? escapeHtml(v) : t(`an_gender_${v}`);
  if (dim === 'risk_level') return tf('an_risk_level', { n: escapeHtml(v) });
  const s = escapeHtml(v);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderSaKpis() {
  const all = (saCache.funnel || []).find((r) => val(r.split) === 'all');
  const cards = [];
  if (all) {
    const counts = SA_STEPS.map(([k]) => nval(all[k]));
    const drop = biggestDrop(SA_STEPS, counts);
    cards.push(
      kpi(t('sa_kpi_opened'), num(counts[0]), t('sa_kpi_opened_sub'), '', ICONS.users),
      kpi(t('sa_kpi_paid'), pct(counts[4], counts[0]), `${num(counts[4])} ${t('sa_kpi_paid_sub')}`, 'accent', ICONS.coin),
      kpi(t('sa_kpi_drop'), counts[0] ? `${drop.pct.toFixed(0)}%` : 'n/a', counts[0] ? `${t('sa_kpi_drop_sub')} ${t(drop.key)}` : '', 'warn', ICONS.trendDown),
    );
  }
  const pay = saCache.payment || [];
  if (pay.length) {
    const s = (k) => pay.reduce((a, r) => a + nval(r[k]), 0);
    const lost = s('expired') + s('cancelled');
    cards.push(kpi(t('sa_kpi_unpaid'), pct(lost, s('orders')), `${num(lost)} ${t('sa_kpi_unpaid_sub')} · ${idr(s('lost_amount'))}`, 'warn', ICONS.xCircle));
  }
  $('#saKpis').innerHTML = cards.join('');
}

// Each step as a share of the people who opened the form, so segments of
// different sizes compare. Up to 5 segments on the chart; the table has all.
function renderSaFunnel() {
  if (!saCache.funnel) return;
  const all = saCache.funnel.find((r) => val(r.split) === 'all');
  const rows = saCache.funnel.filter((r) => val(r.split) === saView.split);
  $('#saFunnelEmpty').hidden = Boolean(all && nval(all.opened_form));
  const series = rows.slice(0, 5);
  const colors = pie();
  paint('saFunnelChart', {
    type: 'bar',
    data: {
      labels: SA_STEPS.map(([, k]) => t(k)),
      datasets: series.map((r, i) => {
        const counts = SA_STEPS.map(([k]) => nval(r[k]));
        return { label: saSegment(val(r.segment)), backgroundColor: colors[i], borderRadius: 4, counts, data: counts.map((c) => pctOf(c, counts[0])) };
      }),
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: C.grid }, ticks: { callback: (v) => `${v}%` } },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { display: series.length > 1, position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}% (${num(c.dataset.counts[c.dataIndex])})` } },
      },
    },
  });
  genTable('#saFunnelTable', rows.map((r) => ({ ...r, segment: saSegment(val(r.segment)) })), [
    { key: 'segment', label: t('sa_col_segment') },
    ...SA_STEPS.map(([k, label]) => ({ key: k, label: t(label), type: 'num' })),
    { key: 'paid_pct', label: t('sa_col_paid_pct'), type: 'pct' },
    { key: 'median_min_to_order', label: t('sa_col_min_to_order') },
    { key: 'median_min_to_pay', label: t('sa_col_min_to_pay') },
  ], t('sa_funnel_empty'));
  if (!all || !nval(all.opened_form)) { story('#saFunnelStory', []); return; }
  const counts = SA_STEPS.map(([k]) => nval(all[k]));
  const drop = biggestDrop(SA_STEPS, counts);
  const seg = (split, v) => saCache.funnel.find((r) => val(r.split) === split && val(r.segment) === v);
  const and = seg('platform', 'ANDROID'), ios = seg('platform', 'IOS');
  const first = seg('buyer_type', 'first'), repeat = seg('buyer_type', 'repeat');
  story('#saFunnelStory', [
    tf('sa_story_funnel', {
      opened: num(counts[0]), paid: num(counts[4]), paidPct: pct(counts[4], counts[0]),
      step: t(drop.key), drop: drop.pct.toFixed(0), min: val(all.median_min_to_order) ?? 'n/a',
    }),
    and && ios ? tf('sa_story_funnel_platform', { a: `${nval(and.paid_pct).toFixed(1)}%`, i: `${nval(ios.paid_pct).toFixed(1)}%` }) : '',
    first && repeat ? tf('sa_story_funnel_buyer', { first: `${nval(first.paid_pct).toFixed(1)}%`, repeat: `${nval(repeat.paid_pct).toFixed(1)}%`, n: num(nval(first.opened_form)) }) : '',
  ]);
}

function renderSaProfile() {
  if (!saCache.profile) return;
  const dim = saView.dim;
  const rows = saCache.profile.filter((r) => val(r.dimension) === dim);
  genTable('#saProfileTable', rows.map((r) => ({ ...r, value: profileLabel(dim, val(r.value)) })), [
    { key: 'value', label: t(`sa_dim_${dim}`) },
    { key: 'opened_form', label: t('sa_step_form'), type: 'num', sum: true },
    { key: 'paid', label: t('sa_step_paid'), type: 'num', sum: true },
    { key: 'paid_pct', label: t('sa_col_paid_pct'), type: 'pct' },
    { key: 'paid_amount', label: t('sa_col_paid_amount'), type: 'idr', sum: true },
    { key: 'median_paid_amount', label: t('sa_col_median_paid'), type: 'idr' },
  ], t('sa_funnel_empty'));
  const known = rows.filter((r) => val(r.value) !== 'unknown' && nval(r.opened_form) >= 10);
  if (known.length < 2) { story('#saProfileStory', []); return; }
  const byRate = [...known].sort((a, b) => nval(b.paid_pct) - nval(a.paid_pct));
  const totalAmount = rows.reduce((a, r) => a + nval(r.paid_amount), 0);
  const big = [...known].sort((a, b) => nval(b.paid_amount) - nval(a.paid_amount))[0];
  const label = (r) => profileLabel(dim, val(r.value));
  story('#saProfileStory', [
    tf('sa_story_profile', {
      dim: t(`sa_dim_${dim}`).toLowerCase(),
      best: label(byRate[0]), bestPct: `${nval(byRate[0].paid_pct).toFixed(1)}%`, bestN: num(nval(byRate[0].opened_form)),
      worst: label(byRate[byRate.length - 1]), worstPct: `${nval(byRate[byRate.length - 1].paid_pct).toFixed(1)}%`, worstN: num(nval(byRate[byRate.length - 1].opened_form)),
    }),
    tf('sa_story_profile_amount', { big: label(big), share: pct(nval(big.paid_amount), totalAmount), median: idr(val(big.median_paid_amount)) }),
  ]);
}

function renderSaEntry() {
  if (!saCache.entry) return;
  const path = saView.level === 'path';
  const rows = saCache.entry.filter((r) => val(r.level) === saView.level)
    .map((r) => ({ ...r, came_from: saName(val(r.came_from)), before_that: saName(val(r.before_that)) }));
  genTable('#saEntryTable', rows, [
    ...(path ? [{ key: 'before_that', label: t('sa_col_before_that') }] : []),
    { key: 'came_from', label: t('sa_col_came_from') },
    { key: 'opens', label: t('sa_col_opens'), type: 'num' },
    { key: 'users', label: t('sa_col_people'), type: 'num' },
    { key: 'ordered_users', label: t('sa_col_ordered'), type: 'num' },
    { key: 'paid_users', label: t('sa_col_paid'), type: 'num' },
    { key: 'paid_pct', label: t('sa_col_paid_pct'), type: 'pct' },
  ], t('sa_entry_empty'));
  const screens = saCache.entry.filter((r) => val(r.level) === 'screen');
  const solid = screens.filter((r) => nval(r.users) >= 10).sort((a, b) => nval(b.paid_pct) - nval(a.paid_pct));
  if (!screens.length) { story('#saEntryStory', []); return; }
  const top = [...screens].sort((a, b) => nval(b.opens) - nval(a.opens))[0];
  story('#saEntryStory', [
    tf('sa_story_entry_top', { top: saName(val(top.came_from)), opens: num(nval(top.opens)), users: num(nval(top.users)), pct: `${nval(top.paid_pct).toFixed(1)}%` }),
    solid.length >= 2 ? tf('sa_story_entry_range', {
      best: saName(val(solid[0].came_from)), bestPct: `${nval(solid[0].paid_pct).toFixed(1)}%`,
      worst: saName(val(solid[solid.length - 1].came_from)), worstPct: `${nval(solid[solid.length - 1].paid_pct).toFixed(1)}%`,
    }) : '',
  ]);
}

// The step buttons carry each step's session count; the table opens with
// that step's total row, then its most common next screens.
function renderSaDrop() {
  if (!saCache.dropoff) return;
  const totals = saCache.dropoff.filter((r) => val(r.exit_screen) == null);
  if (totals.length && !totals.some((r) => nval(r.step) === saView.step)) saView.step = nval(totals[0].step);
  segButtons('#saDropStep', 'step', totals.map((r) => String(nval(r.step))), String(saView.step),
    (s) => `${t(SA_DROP_STEPS[s])} (${num(nval(totals.find((r) => String(nval(r.step)) === s).sessions))})`);
  const inStep = (r) => nval(r.step) === saView.step;
  const total = totals.filter(inStep).map((r) => ({ ...r, exit_screen: `<strong>${t('sa_all_exits')}</strong>` }));
  const detail = saCache.dropoff.filter((r) => inStep(r) && val(r.exit_screen) != null)
    .map((r) => ({ ...r, exit_screen: saName(val(r.exit_screen)) }));
  genTable('#saDropTable', [...total, ...detail], [
    { key: 'exit_screen', label: t('sa_col_next_screen') },
    { key: 'sessions', label: t('sa_col_sessions'), type: 'num' },
    { key: 'users', label: t('sa_col_people'), type: 'num' },
    { key: 'paid_later_users', label: t('sa_col_paid_7d'), type: 'num' },
    { key: 'paid_later_pct', label: t('sa_col_paid_pct'), type: 'pct' },
  ], t('sa_drop_empty'));
  if (!totals.length) { story('#saDropStory', []); return; }
  const worst = [...totals].sort((a, b) => nval(b.sessions) - nval(a.sessions))[0];
  const exit = saCache.dropoff.filter((r) => nval(r.step) === nval(worst.step) && val(r.exit_screen) != null)[0];
  story('#saDropStory', [
    tf('sa_story_drop', {
      sessions: num(totals.reduce((a, r) => a + nval(r.sessions), 0)),
      step: t(SA_DROP_STEPS[nval(worst.step)]), stepSessions: num(nval(worst.sessions)),
      exit: exit ? saName(val(exit.exit_screen)) : 'n/a', exitSessions: exit ? num(nval(exit.sessions)) : '0',
      paidLater: `${nval(worst.paid_later_pct).toFixed(1)}%`,
    }),
  ]);
}

function renderSaPayment() {
  if (!saCache.payment) return;
  const rows = saCache.payment;
  genTable('#saPayTable', escRows(rows, ['method']), [
    { key: 'method', label: t('sa_col_method') },
    { key: 'orders', label: t('sa_col_orders'), type: 'num', sum: true },
    { key: 'users', label: t('sa_col_people'), type: 'num' },
    { key: 'paid', label: t('sa_col_paid'), type: 'num', sum: true },
    { key: 'expired', label: t('sa_col_expired'), type: 'num', sum: true },
    { key: 'cancelled', label: t('sa_col_cancelled'), type: 'num', sum: true },
    { key: 'waiting', label: t('sa_col_waiting'), type: 'num', sum: true },
    { key: 'paid_pct', label: t('sa_col_paid_pct'), type: 'pct' },
    { key: 'median_min_to_pay', label: t('sa_col_min_to_pay') },
    { key: 'paid_amount', label: t('sa_col_paid_amount'), type: 'idr', sum: true },
    { key: 'lost_amount', label: t('sa_col_lost_amount'), type: 'idr', sum: true },
    { key: 'lost_users', label: t('sa_col_lost_users'), type: 'num' },
    { key: 'lost_then_paid_users', label: t('sa_col_lost_then_paid'), type: 'num' },
  ], t('sa_pay_empty'));
  const s = (k) => rows.reduce((a, r) => a + nval(r[k]), 0);
  const solid = rows.filter((r) => nval(r.orders) >= 20).sort((a, b) => nval(b.paid_pct) - nval(a.paid_pct));
  if (!rows.length) { story('#saPayStory', []); return; }
  const lost = s('expired') + s('cancelled');
  const worst = solid[solid.length - 1];
  story('#saPayStory', [
    tf('sa_story_pay', { lostPct: pct(lost, s('orders')), orders: num(s('orders')), lost: num(lost), amount: idr(s('lost_amount')) }),
    solid.length >= 2 ? tf('sa_story_pay_range', {
      worst: escapeHtml(val(worst.method)), worstPct: `${nval(worst.paid_pct).toFixed(1)}%`,
      best: escapeHtml(val(solid[0].method)), bestPct: `${nval(solid[0].paid_pct).toFixed(1)}%`,
    }) : '',
    worst && nval(worst.lost_users) ? tf('sa_story_pay_recover', { worst: escapeHtml(val(worst.method)), lost: num(nval(worst.lost_users)), recovered: num(nval(worst.lost_then_paid_users)) }) : '',
  ]);
}

function renderSaDrivers() {
  if (!saCache.drivers) return;
  renderDriverTable('#saDriverTable', saCache.drivers, $('#saDriverFlow').checked,
    { converted: 'sa_col_subscribed', rate: 'sa_col_rate', share: 'sa_col_share_subs', all: 'sa_driver_all' });
  driverStory('#saDriverStory', saCache.drivers, 'sa_story_driver');
}

// Shares, not counts: sessions run in the hundreds per hour and paid orders
// in single digits, so on one count axis the orders line would sit flat on
// zero. Equal shares mean people buy as often as they open the app then.
const DOW_ORDER = [2, 3, 4, 5, 6, 7, 1]; // BigQuery DAYOFWEEK, Monday first
function hourShares(rows, byHour) {
  const keys = byHour ? [...Array(24).keys()] : DOW_ORDER;
  const field = byHour ? 'hour' : 'dow';
  const counts = (k) => keys.map((x) => rows.filter((r) => nval(r[field]) === x).reduce((a, r) => a + nval(r[k]), 0));
  const share = (arr) => { const total = arr.reduce((a, b) => a + b, 0); return arr.map((v) => pctOf(v, total)); };
  const sessions = counts('sessions');
  const paid = counts('paid');
  return { keys, sessions, paid, sessionShare: share(sessions), paidShare: share(paid) };
}
function renderSaHours() {
  if (!saCache.hours) return;
  const rows = saCache.hours;
  const byHour = saView.by === 'hour';
  const h = hourShares(rows, byHour);
  $('#saHoursEmpty').textContent = t('sa_hours_empty');
  $('#saHoursEmpty').hidden = rows.length > 0;
  paint('saHoursChart', {
    type: 'bar',
    data: {
      labels: h.keys.map((x) => (byHour ? String(x).padStart(2, '0') : t(`sa_dow_${x}`))),
      datasets: [
        { type: 'bar', label: t('sa_series_sessions'), data: h.sessionShare, counts: h.sessions, backgroundColor: C.soft, borderRadius: 4 },
        { type: 'line', label: t('sa_series_paid'), data: h.paidShare, counts: h.paid, borderColor: C.chartAmber, backgroundColor: C.chartAmber, borderWidth: 2, pointRadius: 2, tension: 0.25 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true, grid: { color: C.grid }, ticks: { callback: (v) => `${v}%` } }, x: { grid: { display: false } } },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}% (${num(c.dataset.counts[c.dataIndex])})` } },
      },
    },
  });
  const hr = hourShares(rows, true), dw = hourShares(rows, false);
  if (!hr.paid.some(Boolean)) { story('#saHoursStory', []); return; }
  const peak = (x) => x.paidShare.indexOf(Math.max(...x.paidShare));
  const ph = peak(hr), pd = peak(dw);
  // Busiest 4-hour stretch for payments, picked from the data and allowed to wrap past midnight.
  const win = hr.keys
    .map((start) => [0, 1, 2, 3].reduce((a, d) => ({ start, paid: a.paid + hr.paidShare[(start + d) % 24], sessions: a.sessions + hr.sessionShare[(start + d) % 24] }), { paid: 0, sessions: 0 }))
    .reduce((a, b) => (b.paid > a.paid ? b : a));
  story('#saHoursStory', [
    tf('sa_story_hours', { hour: String(hr.keys[ph]).padStart(2, '0'), paid: `${hr.paidShare[ph].toFixed(1)}%`, sessions: `${hr.sessionShare[ph].toFixed(1)}%` }),
    tf('sa_story_hours_window', { from: String(win.start).padStart(2, '0'), to: String((win.start + 3) % 24).padStart(2, '0'), paid: `${win.paid.toFixed(0)}%`, sessions: `${win.sessions.toFixed(0)}%` }),
    tf('sa_story_hours_day', { day: t(`sa_dow_${dw.keys[pd]}`), paid: `${dw.paidShare[pd].toFixed(1)}%` }),
  ]);
}

function renderSaChips() {
  if (!saCache.chips) return;
  const rows = saCache.chips;
  genTable('#saChipTable', rows, [
    { key: 'chip', label: t('sa_col_chip'), type: 'idr' },
    { key: 'taps', label: t('sa_col_taps'), type: 'num', sum: true },
    { key: 'users', label: t('sa_col_people'), type: 'num' },
    { key: 'paid_users', label: t('sa_col_paid_1d'), type: 'num' },
    { key: 'paid_pct', label: t('sa_col_paid_pct'), type: 'pct' },
    { key: 'paid_chip_amount', label: t('sa_col_kept_amount'), type: 'num' },
    { key: 'median_paid_amount', label: t('sa_col_median_paid'), type: 'idr' },
  ], t('sa_chip_empty'));
  if (!rows.length) { story('#saChipStory', []); return; }
  const top = [...rows].sort((a, b) => nval(b.users) - nval(a.users))[0];
  const big = rows.filter((r) => nval(r.chip) >= 1e8).sort((a, b) => nval(b.users) - nval(a.users))[0];
  story('#saChipStory', [
    tf('sa_story_chip', { chip: idrFull(val(top.chip)), users: num(nval(top.users)), pct: `${nval(top.paid_pct).toFixed(1)}%` }),
    big && nval(big.paid_users) ? tf('sa_story_chip_big', { chip: idrFull(val(big.chip)), paid: num(nval(big.paid_users)), kept: num(nval(big.paid_chip_amount)), median: idrFull(val(big.median_paid_amount)) }) : '',
  ]);
}

// A follow-up list with contact details: the people behind the drop-off
// and unpaid orders above.
function renderSaIntent() {
  const rows = saCache.intent;
  if (!rows) return;
  genTable('#saIntentTable', escRows(rows, ['name', 'sid', 'email', 'phone', 'verification_status', 'order_statuses', 'last_fund_viewed'])
    .map((r) => ({ ...r, order_statuses: r.order_statuses === 'no order created' ? t('bh_no_order') : r.order_statuses })), [
    { key: 'name', label: t('bh_col_name') }, { key: 'sid', label: 'SID' },
    { key: 'email', label: t('bh_col_email') }, { key: 'phone', label: t('bh_col_phone') },
    { key: 'verification_status', label: t('bh_col_kyc') },
    { key: 'last_try_wib', label: t('bh_col_last_try') },
    { key: 'buy_sheet_opens', label: t('bh_col_sheet_opens'), type: 'num' },
    { key: 'orders_created', label: t('bh_col_orders'), type: 'num' },
    { key: 'order_statuses', label: t('bh_col_order_outcome') },
    { key: 'last_fund_viewed', label: t('bh_col_last_fund') },
    { key: 'aum_now', label: t('bh_col_aum_now'), type: 'idr' },
    { key: 'last_completed_buy', label: t('bh_col_last_buy'), type: 'date' },
  ], t('bh_intent_empty'));
  const status = (r) => String(val(r.order_statuses) || '');
  story('#saIntentStory', rows.length ? [tf('sa_story_intent', {
    n: num(rows.length), noOrder: num(rows.filter((r) => status(r) === 'no order created').length),
    expired: num(rows.filter((r) => status(r).includes('expired')).length),
  })] : []);
}

SA_TAB.sections = [
  ['subscription/funnel', '#saFunnelTable', () => { renderSaFunnel(); renderSaKpis(); }],
  ['subscription/profile', '#saProfileTable', renderSaProfile],
  ['subscription/entry', '#saEntryTable', renderSaEntry],
  ['subscription/dropoff', '#saDropTable', renderSaDrop],
  ['subscription/payment', '#saPayTable', () => { renderSaPayment(); renderSaKpis(); }],
  ['subscription/intent', '#saIntentTable', renderSaIntent],
  ['subscription/drivers', '#saDriverTable', renderSaDrivers],
  ['subscription/hours', '#saHoursEmpty', renderSaHours],
  ['subscription/chips', '#saChipTable', renderSaChips],
];
SA_TAB.reset = () => { $('#saDropStep').innerHTML = ''; $('#saFunnelEmpty').hidden = true; };

// Onboarding analysis
const OB_TAB = { id: 'onboarding-analysis', prefix: 'ob', cache: {}, loaded: false, charts: ['obFunnelChart'] };
const obView = { segment: 'all' };
const OB_STEPS = [
  ['signed_up', 'ob_step_signed_up'], ['in_app', 'ob_step_in_app'], ['kyc_intro', 'ob_step_kyc_intro'], ['ktp', 'ob_step_ktp'],
  ['selfie', 'ob_step_selfie'], ['personal', 'ob_step_personal'], ['occupation', 'ob_step_occupation'], ['addr_step', 'ob_step_address'],
  ['bank', 'ob_step_bank'], ['sign_step', 'ob_step_signature'], ['submitted', 'ob_step_submitted'], ['verified', 'ob_step_verified'],
  ['risk_profiled', 'ob_step_risk'],
];
const OB_REJECTED = {
  IdentityRejectedScreen: 'ob_rej_identity', ProfileRejectedScreen: 'ob_rej_profile', OccupationRejectedScreen: 'ob_rej_occupation',
  AddressRejectedScreen: 'ob_rej_address', BankRejectedScreen: 'ob_rej_bank',
};
function renderObFunnel() {
  if (!OB_TAB.cache.funnel) return;
  const rows = OB_TAB.cache.funnel;
  if (!rows.some((r) => val(r.segment) === obView.segment)) obView.segment = 'all';
  segButtons('#obSegment', 'segment', rows.map((r) => val(r.segment)), obView.segment, segLabel);
  const row = rows.find((r) => val(r.segment) === obView.segment);
  const counts = renderSteps({ chartId: 'obFunnelChart', tableSel: '#obFunnelTable', steps: OB_STEPS, row });
  const all = rows.find((r) => val(r.segment) === 'all');
  if (all) {
    const n = (k) => nval(all[k]);
    $('#obKpis').innerHTML = [
      kpi(t('ob_kpi_signed'), num(n('signed_up')), t('ob_kpi_signed_sub'), '', ICONS.userPlus),
      kpi(t('ob_kpi_opened'), pct(n('kyc_intro'), n('signed_up')), `${num(n('kyc_intro'))} ${t('ob_kpi_opened_sub')}`, '', ICONS.user),
      kpi(t('ob_kpi_submitted'), pct(n('submitted'), n('signed_up')), `${num(n('submitted'))} ${t('ob_kpi_submitted_sub')}`, '', ICONS.check),
      kpi(t('ob_kpi_verified'), pct(n('verified'), n('signed_up')), `${num(n('failed'))} ${t('ob_kpi_verified_sub')}`, 'accent', ICONS.check),
    ].join('');
  }
  if (!row || !counts[0]) { story('#obFunnelStory', []); return; }
  const at = (k) => counts[OB_STEPS.findIndex(([key]) => key === k)];
  // Biggest drop inside the app's KYC screens only (in_app to submitted).
  const drop = biggestDrop(OB_STEPS.slice(1, 11), counts.slice(1, 11));
  const and = rows.find((r) => val(r.segment) === 'ANDROID'), ios = rows.find((r) => val(r.segment) === 'IOS');
  story('#obFunnelStory', [
    tf('ob_story_funnel', {
      signed: num(at('signed_up')), inApp: num(at('in_app')), submitted: num(at('submitted')), submittedPct: pct(at('submitted'), at('signed_up')),
      verified: num(at('verified')), verifiedPct: pct(at('verified'), at('signed_up')),
    }),
    drop ? tf('ob_story_funnel_drop', { step: t(drop.key), drop: drop.pct.toFixed(0) }) : '',
    obView.segment === 'all' && and && ios ? tf('ob_story_funnel_platform', {
      a: pct(nval(and.verified), nval(and.signed_up)), i: pct(nval(ios.verified), nval(ios.signed_up)),
    }) : '',
  ]);
}
function renderObOutcome() {
  if (!OB_TAB.cache.outcome) return;
  const rows = OB_TAB.cache.outcome;
  const outcomes = rows.filter((r) => val(r.kind) === 'outcome');
  const rejected = rows.filter((r) => val(r.kind) === 'rejected');
  genTable('#obOutcomeTable', outcomes.map((r) => ({ ...r, name: t(`ob_outcome_${String(val(r.name)).slice(2)}`) })), [
    { key: 'name', label: t('ob_col_outcome') },
    { key: 'users', label: t('an_people'), type: 'num', sum: true },
    { key: 'median_fill_min', label: t('ob_col_fill_min') },
    { key: 'median_sessions', label: t('ob_col_sessions') },
    { key: 'median_review_hours', label: t('ob_col_review_hours') },
    { key: 'bought_7d', label: t('ob_col_bought_7d'), type: 'num', sum: true },
    { key: 'bought', label: t('ob_col_bought'), type: 'num', sum: true },
    { key: 'median_first_buy', label: t('ob_col_first_buy'), type: 'idr' },
  ], t('ob_empty'));
  genTable('#obRejectedTable', rejected.map((r) => ({ ...r, name: OB_REJECTED[val(r.name)] ? t(OB_REJECTED[val(r.name)]) : escapeHtml(val(r.name)) })), [
    { key: 'name', label: t('ob_col_part') },
    { key: 'users', label: t('an_people'), type: 'num' },
    { key: 'verified_now', label: t('ob_col_verified_now'), type: 'num' },
  ], t('ob_rejected_empty'));
  const o = (k) => outcomes.find((r) => String(val(r.name)).slice(2) === k) || {};
  const v1 = o('verified'), v2 = o('verified_after_fail'), f = o('failed');
  const verified = nval(v1.users) + nval(v2.users);
  if (!outcomes.length) { story('#obOutcomeStory', []); return; }
  const topRej = [...rejected].sort((a, b) => nval(b.users) - nval(a.users))[0];
  story('#obOutcomeStory', [
    verified ? tf('ob_story_outcome', {
      v1: num(nval(v1.users)), review: val(v1.median_review_hours) ?? 'n/a', fill: val(v1.median_fill_min) ?? 'n/a', sessions: val(v1.median_sessions) ?? 'n/a',
    }) : '',
    nval(f.users) + nval(v2.users) ? tf('ob_story_outcome_fail', { failed: num(nval(f.users) + nval(v2.users)), fixed: num(nval(v2.users)) }) : '',
    verified ? tf('ob_story_outcome_buy', { verified: num(verified), b7: num(nval(v1.bought_7d) + nval(v2.bought_7d)), b: num(nval(v1.bought) + nval(v2.bought)) }) : '',
    topRej ? tf('ob_story_outcome_rejected', { part: OB_REJECTED[val(topRej.name)] ? t(OB_REJECTED[val(topRej.name)]) : escapeHtml(val(topRej.name)), n: num(nval(topRej.users)) }) : '',
  ]);
}
OB_TAB.sections = [
  ['onboarding/funnel', '#obFunnelTable', renderObFunnel],
  ['onboarding/outcome', '#obOutcomeTable', renderObOutcome],
];
OB_TAB.reset = () => { $('#obSegment').innerHTML = ''; $('#obRejectedTable').innerHTML = ''; };

// Redemption analysis
const RD_TAB = { id: 'redemption-analysis', prefix: 'rd', cache: {}, loaded: false, charts: ['rdFunnelChart', 'rdSwitchChart'] };
const rdView = { dim: 'held' };
const RD_STEPS = [['step1', 'rd_step_form'], ['step2', 'rd_step_checkout'], ['step3', 'rd_step_confirm'], ['done', 'rd_step_done']];
const SW_STEPS = [['step1', 'sw_step_form'], ['step2', 'sw_step_list'], ['step3', 'sw_step_confirm_screen'], ['step4', 'sw_step_confirm'], ['done', 'sw_step_done']];
function renderRdKpis() {
  const f = (RD_TAB.cache.funnel || []).find((r) => val(r.segment) === 'all');
  const p = (RD_TAB.cache.profile || []).find((r) => val(r.dimension) === 'all');
  const cards = [];
  if (f) {
    cards.push(
      kpi(t('rd_kpi_opened'), num(nval(f.step1)), t('rd_kpi_opened_sub'), '', ICONS.users),
      kpi(t('rd_kpi_sold'), pct(nval(f.done), nval(f.step1)), `${num(nval(f.done))} ${t('rd_kpi_sold_sub')}`, 'warn', ICONS.trendDown),
    );
  }
  if (p) {
    cards.push(
      kpi(t('rd_kpi_amount'), idr(val(p.amount)), tf('rd_kpi_amount_sub', { sells: num(nval(p.sells)), people: num(nval(p.people)) }), '', ICONS.coin),
      kpi(t('rd_kpi_rebought'), pct(nval(p.rebought_people), nval(p.people)), tf('rd_kpi_rebought_sub', { left: num(nval(p.left_people)) }), 'accent', ICONS.trendUp),
    );
  }
  $('#rdKpis').innerHTML = cards.join('');
}
// Steps chart for everyone, table with one row per platform.
function renderFlow({ rows, chartId, tableSel, steps, storySel, storyKey, color }) {
  const all = rows.find((r) => val(r.segment) === 'all');
  const counts = renderSteps({ chartId, steps, row: all, color });
  genTable(tableSel, rows.map((r) => ({ ...r, segment: segLabel(val(r.segment)) })), [
    { key: 'segment', label: t('sa_col_segment') },
    ...steps.map(([k, l]) => ({ key: k, label: t(l), type: 'num' })),
    { key: 'done_pct', label: t('rd_col_done_pct'), type: 'pct' },
    { key: 'median_min_to_confirm', label: t('rd_col_min_to_confirm') },
  ], t('an_empty'));
  if (!all || !counts[0]) { story(storySel, []); return; }
  const drop = biggestDrop(steps, counts);
  const and = rows.find((r) => val(r.segment) === 'ANDROID'), ios = rows.find((r) => val(r.segment) === 'IOS');
  story(storySel, [
    tf(storyKey, { opened: num(counts[0]), done: num(counts[counts.length - 1]), donePct: pct(counts[counts.length - 1], counts[0]), min: val(all.median_min_to_confirm) ?? 'n/a' }),
    tf('an_story_drop', { step: t(drop.key), drop: drop.pct.toFixed(0) }),
    and && ios ? tf('an_story_platform', { a: `${nval(and.done_pct).toFixed(1)}%`, i: `${nval(ios.done_pct).toFixed(1)}%` }) : '',
  ]);
}
function renderRdFunnel() {
  if (!RD_TAB.cache.funnel) return;
  renderFlow({ rows: RD_TAB.cache.funnel, chartId: 'rdFunnelChart', tableSel: '#rdFunnelTable', steps: RD_STEPS, storySel: '#rdFunnelStory', storyKey: 'rd_story_funnel', color: C.rose });
  renderRdKpis();
}
function renderRdSwitch() {
  if (!RD_TAB.cache.switching) return;
  renderFlow({ rows: RD_TAB.cache.switching, chartId: 'rdSwitchChart', tableSel: '#rdSwitchTable', steps: SW_STEPS, storySel: '#rdSwitchStory', storyKey: 'rd_story_switch', color: C.teal });
}
function rdValueLabel(dim, v) {
  if (v === 'unknown') return t('an_unknown');
  if (dim === 'held') return t(`rd_held_${v}`);
  if (dim === 'size') return t(`rd_size_${v}`);
  return escapeHtml(v);
}
function renderRdProfile() {
  if (!RD_TAB.cache.profile) return;
  renderRdKpis();
  const dim = rdView.dim;
  const rows = RD_TAB.cache.profile.filter((r) => val(r.dimension) === dim);
  genTable('#rdProfileTable', rows.map((r) => ({ ...r, value: rdValueLabel(dim, val(r.value)) })), [
    { key: 'value', label: t(`rd_dim_${dim}`) },
    { key: 'sells', label: t('rd_col_sells'), type: 'num', sum: true },
    { key: 'people', label: t('an_people'), type: 'num' },
    { key: 'amount', label: t('rd_col_amount'), type: 'idr', sum: true },
    { key: 'full_pct', label: t('rd_col_full_pct'), type: 'pct' },
    { key: 'median_held_days', label: t('rd_col_held_days') },
    { key: 'rebought_people', label: t('rd_col_rebought'), type: 'num' },
    { key: 'left_people', label: t('rd_col_left'), type: 'num' },
    { key: 'via_app', label: t('rd_col_via_app'), type: 'num', sum: true },
  ], t('rd_empty'));
  const all = RD_TAB.cache.profile.find((r) => val(r.dimension) === 'all');
  if (!all) { story('#rdProfileStory', []); return; }
  const top = [...rows].sort((a, b) => nval(b.sells) - nval(a.sells))[0];
  const solid = rows.filter((r) => nval(r.people) >= 10 && val(r.value) !== 'unknown').sort((a, b) => pctOf(nval(b.left_people), nval(b.people)) - pctOf(nval(a.left_people), nval(a.people)));
  story('#rdProfileStory', [
    tf('rd_story_profile', {
      sells: num(nval(all.sells)), people: num(nval(all.people)), amount: idr(val(all.amount)), full: `${nval(all.full_pct).toFixed(1)}%`,
      rebought: num(nval(all.rebought_people)), reboughtPct: pct(nval(all.rebought_people), nval(all.people)),
      left: num(nval(all.left_people)), leftPct: pct(nval(all.left_people), nval(all.people)), held: val(all.median_held_days) ?? 'n/a',
    }),
    top ? tf('rd_story_profile_dim', {
      dim: t(`rd_dim_${dim}`).toLowerCase(), top: rdValueLabel(dim, val(top.value)), topSells: num(nval(top.sells)),
      left: solid[0] ? rdValueLabel(dim, val(solid[0].value)) : 'n/a', leftPct: solid[0] ? pct(nval(solid[0].left_people), nval(solid[0].people)) : 'n/a',
    }) : '',
  ]);
}
function renderRdSignals() {
  if (!RD_TAB.cache.signals) return;
  renderDriverTable('#rdSignalTable', RD_TAB.cache.signals, $('#rdSignalFlow').checked,
    { converted: 'rd_col_sold', rate: 'rd_col_sold_rate', share: 'rd_col_share_sellers', all: 'rd_signal_all' });
  driverStory('#rdSignalStory', RD_TAB.cache.signals, 'rd_story_signal');
}
RD_TAB.sections = [
  ['redemption/funnel', '#rdFunnelTable', renderRdFunnel],
  ['redemption/profile', '#rdProfileTable', renderRdProfile],
  ['redemption/signals', '#rdSignalTable', renderRdSignals],
  ['redemption/switching', '#rdSwitchTable', renderRdSwitch],
];

// Engagement analysis
const EG_TAB = { id: 'engagement-analysis', prefix: 'eg', cache: {}, loaded: false, charts: ['egFeatureChart', 'egDailyChart'] };
const egView = { kind: 'sort' };
const EG_TIERS = ['1_under_1m', '2_1m_10m', '3_10m_100m', '4_100m_1b', '5_over_1b'];
const EG_BANDS = ['0_none', '1_1_2', '2_3_9', '3_10_plus'];
const featLabel = (v) => (v === 'all' ? t('eg_feat_all') : t(`eg_feat_${v}`));
function renderEgFeatures() {
  if (!EG_TAB.cache.features) return;
  const rows = EG_TAB.cache.features;
  const all = rows.find((r) => val(r.feature) === 'all');
  paint('egFeatureChart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => featLabel(val(r.feature))),
      datasets: [{
        label: t('eg_col_buyer_pct'), data: rows.map((r) => nval(r.buyer_pct)), counts: rows.map((r) => nval(r.users)),
        backgroundColor: rows.map((r) => (val(r.feature) === 'all' ? C.muted : C.indigo)), borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, grid: { color: C.grid }, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw.toFixed(1)}% · ${num(c.dataset.counts[c.dataIndex])} ${t('an_people').toLowerCase()}` } } },
    },
  });
  genTable('#egFeatureTable', rows.map((r) => ({ ...r, feature: val(r.feature) === 'all' ? `<strong>${featLabel('all')}</strong>` : featLabel(val(r.feature)) })), [
    { key: 'feature', label: t('eg_col_feature') },
    { key: 'users', label: t('an_people'), type: 'num' },
    { key: 'holders', label: t('eg_col_holders'), type: 'num' },
    { key: 'holder_pct', label: t('eg_col_holder_pct'), type: 'pct' },
    { key: 'median_aum', label: t('eg_col_median_aum'), type: 'idr' },
    { key: 'buyers', label: t('eg_col_buyers'), type: 'num' },
    { key: 'buyer_pct', label: t('eg_col_buyer_pct'), type: 'pct' },
    { key: 'buy_amount', label: t('eg_col_buy_amount'), type: 'idr' },
    { key: 'sellers', label: t('eg_col_sellers'), type: 'num' },
    { key: 'seller_pct', label: t('eg_col_seller_pct'), type: 'pct' },
  ], t('an_empty'));
  renderEgKpis();
  if (!all) { story('#egFeatureStory', []); return; }
  const feats = rows.filter((r) => val(r.feature) !== 'all');
  const used = [...feats].sort((a, b) => nval(b.users) - nval(a.users))[0];
  const solid = feats.filter((r) => nval(r.users) >= 20).sort((a, b) => nval(b.buyer_pct) - nval(a.buyer_pct));
  story('#egFeatureStory', [
    tf('eg_story_feature', { all: num(nval(all.users)), holderPct: `${nval(all.holder_pct).toFixed(1)}%`, buyerPct: `${nval(all.buyer_pct).toFixed(1)}%` }),
    used ? tf('eg_story_feature_top', { top: featLabel(val(used.feature)), users: num(nval(used.users)) }) : '',
    solid.length >= 2 ? tf('eg_story_feature_range', {
      best: featLabel(val(solid[0].feature)), bestPct: `${nval(solid[0].buyer_pct).toFixed(1)}%`,
      low: featLabel(val(solid[solid.length - 1].feature)), lowPct: `${nval(solid[solid.length - 1].buyer_pct).toFixed(1)}%`,
      allPct: `${nval(all.buyer_pct).toFixed(1)}%`,
    }) : '',
    t('an_story_correlation'),
  ]);
}
function renderEgKpis() {
  const all = (EG_TAB.cache.features || []).find((r) => val(r.feature) === 'all');
  const act = EG_TAB.cache.activity || [];
  const cards = [];
  if (all) {
    cards.push(
      kpi(t('eg_kpi_users'), num(nval(all.users)), t('eg_kpi_users_sub'), '', ICONS.users),
      kpi(t('eg_kpi_holders'), `${nval(all.holder_pct).toFixed(1)}%`, `${num(nval(all.holders))} ${t('eg_kpi_holders_sub')}`, 'accent', ICONS.coin),
      kpi(t('eg_kpi_buyers'), `${nval(all.buyer_pct).toFixed(1)}%`, `${num(nval(all.buyers))} ${t('eg_kpi_buyers_sub')}`, '', ICONS.trendUp),
    );
  }
  if (act.length) {
    const silent = act.filter((r) => val(r.activity) === '0_none' && val(r.aum_tier) !== '1_under_1m');
    cards.push(kpi(t('eg_kpi_silent'), idr(silent.reduce((a, r) => a + nval(r.aum), 0)), tf('eg_kpi_silent_sub', { n: num(silent.reduce((a, r) => a + nval(r.holders), 0)) }), 'warn', ICONS.eyeOff));
  }
  $('#egKpis').innerHTML = cards.join('');
}
// Pivot: one row per portfolio size, one column per app-use band.
function renderEgActivity() {
  if (!EG_TAB.cache.activity) return;
  const rows = EG_TAB.cache.activity;
  const cell = (tier, band) => rows.find((r) => val(r.aum_tier) === tier && val(r.activity) === band);
  const pivot = EG_TIERS.filter((tier) => rows.some((r) => val(r.aum_tier) === tier)).map((tier) => {
    const out = { tier: t(`eg_tier_${tier}`) };
    let holders = 0, aum = 0, bought = 0;
    EG_BANDS.forEach((band) => {
      const c = cell(tier, band);
      out[band] = c ? `${num(nval(c.holders))}<span class="hint">${idr(nval(c.aum))}</span>` : '0';
      holders += c ? nval(c.holders) : 0; aum += c ? nval(c.aum) : 0; bought += c ? nval(c.bought) : 0;
    });
    out.total = `${num(holders)}<span class="hint">${idr(aum)}</span>`;
    out.bought_pct = pctOf(bought, holders);
    return out;
  });
  genTable('#egActivityTable', pivot, [
    { key: 'tier', label: t('eg_col_tier') },
    ...EG_BANDS.map((b) => ({ key: b, label: t(`eg_band_${b}`) })),
    { key: 'total', label: t('eg_col_total') },
    { key: 'bought_pct', label: t('eg_col_bought_pct'), type: 'pct' },
  ], t('an_empty'));
  $('#egActivityTable table')?.classList.add('pivot');
  renderEgKpis();
  if (!rows.length) { story('#egActivityStory', []); return; }
  const sum = (pred, k) => rows.filter(pred).reduce((a, r) => a + nval(r[k]), 0);
  const notSmall = (r) => val(r.aum_tier) !== '1_under_1m';
  const big = (r) => ['4_100m_1b', '5_over_1b'].includes(val(r.aum_tier));
  const silent = (r) => val(r.activity) === '0_none';
  const holders = sum(notSmall, 'holders'), aum = sum(notSmall, 'aum');
  const sh = sum((r) => notSmall(r) && silent(r), 'holders'), sa = sum((r) => notSmall(r) && silent(r), 'aum');
  const band = (b) => (r) => notSmall(r) && val(r.activity) === b;
  const small = sum((r) => !notSmall(r), 'holders'), smallSilent = sum((r) => !notSmall(r) && silent(r), 'holders');
  story('#egActivityStory', [
    tf('eg_story_activity', { holders: num(holders), silent: num(sh), silentPct: pct(sh, holders), aum: idr(sa), aumPct: pct(sa, aum) }),
    tf('eg_story_activity_big', { n: num(sum((r) => big(r) && silent(r), 'holders')), aum: idr(sum((r) => big(r) && silent(r), 'aum')) }),
    tf('eg_story_activity_buy', {
      active: pct(sum(band('3_10_plus'), 'bought'), sum(band('3_10_plus'), 'holders')),
      quiet: pct(sum(band('1_1_2'), 'bought'), sum(band('1_1_2'), 'holders')),
    }),
    small ? tf('eg_story_activity_small', { n: num(small), pct: pct(smallSilent, small) }) : '',
  ]);
}
function renderEgSearch() {
  if (!EG_TAB.cache.search) return;
  const rows = EG_TAB.cache.search;
  genTable('#egSearchTable', escRows(rows, ['term', 'top_tapped']), [
    { key: 'term', label: t('eg_col_term') },
    { key: 'searches', label: t('eg_col_searches'), type: 'num' },
    { key: 'users', label: t('an_people'), type: 'num' },
    { key: 'tapped_users', label: t('eg_col_tapped'), type: 'num' },
    { key: 'bought_users', label: t('eg_col_bought_7d'), type: 'num' },
    { key: 'bought_tapped_users', label: t('eg_col_bought_tapped'), type: 'num' },
    { key: 'top_tapped', label: t('eg_col_top_tapped') },
  ], t('eg_search_empty'));
  if (!rows.length) { story('#egSearchStory', []); return; }
  const top = rows[0];
  story('#egSearchStory', [
    tf('eg_story_search', { terms: rows.slice(0, 3).map((r) => `"${escapeHtml(val(r.term))}"`).join(', ') }),
    tf('eg_story_search_top', {
      term: escapeHtml(val(top.term)), n: num(nval(top.users)), tapped: num(nval(top.tapped_users)),
      bought: num(nval(top.bought_users)), boughtTapped: num(nval(top.bought_tapped_users)),
    }),
  ]);
}
function discoveryLabel(kind, v) {
  if (kind === 'risk_gate') return tf('an_risk_level', { n: escapeHtml(v) });
  // Sort values are "sort_by / return period"; "none" means that part was not set.
  if (kind === 'sort') return escapeHtml(v.split(' / ').filter((x) => x !== 'none' && x !== '-').join(' / ').replace(/_/g, ' ')) || t('eg_sort_default');
  return escapeHtml(v);
}
function renderEgDiscovery() {
  if (!EG_TAB.cache.discovery) return;
  const kind = egView.kind;
  const rows = EG_TAB.cache.discovery.filter((r) => val(r.kind) === kind);
  genTable('#egDiscoveryTable', rows.map((r) => ({ ...r, value: discoveryLabel(kind, val(r.value)) })), [
    { key: 'value', label: t(`eg_kind_${kind}`) },
    { key: 'events', label: t('eg_col_events'), type: 'num' },
    { key: 'users', label: t('an_people'), type: 'num' },
    { key: 'paid_users', label: t('eg_col_paid_7d'), type: 'num' },
    { key: 'paid_pct', label: t('sa_col_paid_pct'), type: 'pct' },
  ], t('an_empty'));
  if (!rows.length) { story('#egDiscoveryStory', []); return; }
  const top = rows[0];
  const best = rows.filter((r) => nval(r.users) >= 5).sort((a, b) => nval(b.paid_pct) - nval(a.paid_pct))[0];
  story('#egDiscoveryStory', [
    tf('eg_story_discovery', { kind: t(`eg_kind_${kind}`).toLowerCase(), top: discoveryLabel(kind, val(top.value)), users: num(nval(top.users)), pct: `${nval(top.paid_pct).toFixed(1)}%` }),
    best ? tf('eg_story_discovery_best', { best: discoveryLabel(kind, val(best.value)), pct: `${nval(best.paid_pct).toFixed(1)}%`, users: num(nval(best.users)) }) : '',
  ]);
}
// People per day on one count axis: two lines for app users, bars for the
// much smaller number who bought.
function renderEgDaily() {
  const rows = EG_TAB.cache.daily;
  if (!rows) return;
  $('#egDailyEmpty').textContent = t('bh_empty');
  $('#egDailyEmpty').hidden = rows.length > 0;
  const line = (key, label, color) => ({
    label, data: rows.map((d) => nval(d[key])), borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25,
  });
  paint('egDailyChart', {
    type: 'line',
    data: {
      labels: rows.map((d) => val(d.day)),
      datasets: [
        line('app_users', t('bh_series_app_users'), C.indigo),
        line('holding_users', t('bh_series_holding'), C.chartGreen),
        { type: 'bar', label: t('bh_series_buyers'), data: rows.map((d) => nval(d.buyers)), backgroundColor: C.chartAmber, borderRadius: 4 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, grid: { color: C.grid }, ticks: { precision: 0, callback: (v) => num(v) } },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.raw)}` } },
      },
    },
  });
  if (!rows.length) { story('#egDailyStory', []); return; }
  const avg = (k) => num(Math.round(rows.reduce((a, r) => a + nval(r[k]), 0) / rows.length));
  const peak = [...rows].sort((a, b) => nval(b.app_users) - nval(a.app_users))[0];
  story('#egDailyStory', [tf('eg_story_daily', { users: avg('app_users'), buyers: avg('buyers'), day: val(peak.day), peak: num(nval(peak.app_users)) })]);
}
const BH_SEGMENT_KEYS = { holding: 'bh_seg_holding', redeemed: 'bh_seg_redeemed', verified_no_buy: 'bh_seg_verified_no_buy', not_verified: 'bh_seg_not_verified' };
function renderEgSegments() {
  const rows = EG_TAB.cache.segments;
  if (!rows) return;
  genTable('#egSegmentTable', rows.map((r) => ({ ...r, segment: erLabel(BH_SEGMENT_KEYS, val(r.segment)) })), [
    { key: 'segment', label: t('bh_col_status') },
    { key: 'app_users', label: t('bh_col_app_users'), type: 'num', sum: true },
    { key: 'avg_active_days', label: t('bh_col_active_days') },
    { key: 'avg_sessions', label: t('bh_col_sessions') },
    { key: 'avg_screen_views', label: t('bh_col_screens') },
    { key: 'median_engaged_min', label: t('bh_col_engaged_min') },
    { key: 'buyers', label: t('bh_col_bought'), type: 'num', sum: true },
    { key: 'buyer_rate_pct', label: t('bh_col_bought_pct'), type: 'pct' },
    { key: 'buy_amount', label: t('bh_col_buy_amount'), type: 'idr', sum: true },
    { key: 'sellers', label: t('bh_col_sold'), type: 'num', sum: true },
    { key: 'sell_amount', label: t('bh_col_sell_amount'), type: 'idr', sum: true },
  ], t('bh_empty'));
  if (!rows.length) { story('#egSegmentStory', []); return; }
  const users = rows.reduce((a, r) => a + nval(r.app_users), 0);
  const big = [...rows].sort((a, b) => nval(b.app_users) - nval(a.app_users))[0];
  const best = [...rows].sort((a, b) => nval(b.buyer_rate_pct) - nval(a.buyer_rate_pct))[0];
  const label = (r) => erLabel(BH_SEGMENT_KEYS, val(r.segment));
  story('#egSegmentStory', [tf(best === big ? 'eg_story_segment_same' : 'eg_story_segment', {
    big: label(big), n: num(nval(big.app_users)), pct: pct(nval(big.app_users), users), best: label(best), bestPct: `${nval(best.buyer_rate_pct).toFixed(1)}%`,
  })]);
}
function renderEgPush() {
  const rows = EG_TAB.cache.push;
  if (!rows) return;
  genTable('#egPushTable', escRows(rows, ['campaign']), [
    { key: 'campaign', label: t('bh_col_campaign') },
    { key: 'first_seen', label: t('bh_col_first_seen'), type: 'date' },
    { key: 'last_seen', label: t('bh_col_last_seen'), type: 'date' },
    { key: 'received_users', label: t('bh_col_received'), type: 'num' },
    { key: 'opened_users', label: t('bh_col_opened'), type: 'num' },
    { key: 'open_rate_pct', label: t('bh_col_open_rate'), type: 'pct' },
    { key: 'opened_then_bought', label: t('bh_col_opened_bought'), type: 'num' },
    { key: 'opened_buy_amount', label: t('bh_col_opened_amount'), type: 'idr' },
    { key: 'buyers_72h', label: t('bh_col_bought_72h'), type: 'num' },
    { key: 'buy_rate_pct', label: t('bh_col_rate'), type: 'pct' },
    { key: 'buy_amount_72h', label: t('bh_col_amount_72h'), type: 'idr' },
  ], t('bh_empty'));
  if (!rows.length) { story('#egPushStory', []); return; }
  const top = [...rows].sort((a, b) => nval(b.received_users) - nval(a.received_users))[0];
  story('#egPushStory', [tf('eg_story_push', {
    campaign: escapeHtml(val(top.campaign)), received: num(nval(top.received_users)), openRate: `${nval(top.open_rate_pct).toFixed(1)}%`,
    opened: num(nval(top.opened_then_bought)),
  })]);
}
function renderEgProducts() {
  const rows = EG_TAB.cache.products;
  if (!rows) return;
  genTable('#egProductTable', escRows(rows, ['fund', 'fund_type']), [
    { key: 'fund', label: t('bh_col_fund') },
    { key: 'fund_type', label: t('bh_col_type') },
    { key: 'views', label: t('bh_col_views'), type: 'num', sum: true },
    { key: 'viewers', label: t('bh_col_viewers'), type: 'num' },
    { key: 'buyers_7d', label: t('bh_col_bought_7d'), type: 'num' },
    { key: 'view_to_buy_pct', label: t('bh_col_view_to_buy'), type: 'pct' },
    { key: 'buy_amount_7d', label: t('bh_col_buy_amount'), type: 'idr', sum: true },
    { key: 'viewers_holding_now', label: t('bh_col_already_holding'), type: 'num' },
  ], t('bh_empty'));
  if (!rows.length) { story('#egProductStory', []); return; }
  const top = [...rows].sort((a, b) => nval(b.viewers) - nval(a.viewers))[0];
  const best = rows.filter((r) => nval(r.viewers) >= 10).sort((a, b) => nval(b.view_to_buy_pct) - nval(a.view_to_buy_pct))[0];
  story('#egProductStory', [
    tf('eg_story_product', { fund: escapeHtml(val(top.fund)), viewers: num(nval(top.viewers)), pct: `${nval(top.view_to_buy_pct).toFixed(1)}%` }),
    best && best !== top ? tf('eg_story_product_best', { fund: escapeHtml(val(best.fund)), pct: `${nval(best.view_to_buy_pct).toFixed(1)}%`, viewers: num(nval(best.viewers)) }) : '',
  ]);
}
EG_TAB.sections = [
  ['engagement/daily', '#egDailyEmpty', renderEgDaily],
  ['engagement/segments', '#egSegmentTable', renderEgSegments],
  ['engagement/push', '#egPushTable', renderEgPush],
  ['engagement/products', '#egProductTable', renderEgProducts],
  ['engagement/features', '#egFeatureTable', renderEgFeatures],
  ['engagement/activity', '#egActivityTable', renderEgActivity],
  ['engagement/search', '#egSearchTable', renderEgSearch],
  ['engagement/discovery', '#egDiscoveryTable', renderEgDiscovery],
];
// Product funnel
// Phones that started sign-up in the period (GA4), followed into the main
// database once they log in. The funnel, the groups and the weeks all come
// from one query (steps); see queries.js productFunnel*.
const PFN_TAB = { id: 'product-funnel', prefix: 'pfn', cache: {}, loaded: false, coverage: false, charts: ['pfnFunnelChart', 'pfnWeeksChart', 'pfnDailyChart'] };
const pfnView = { segment: 'all:all', dim: 'method', weeks: '7d', daily: 'all', un: 'day' };
const PFN_STEPS = ['started', 'otp', 'account', 'kyc_started', 'kyc_sent', 'verified', 'ordered', 'paid'].map((k) => [k, `pfn_step_${k}`, `pfn_src_${k}`]);
const pfnRows = (dim) => (PFN_TAB.cache.steps || []).filter((r) => val(r.dimension) === dim);
const pfnRow = (dim, v) => pfnRows(dim).find((r) => val(r.value) === v);
const pfnRate = (r, k) => pctOf(nval(r[k]), nval(r.started));
function pfnLabel(dim, v) {
  if (dim === 'all') return t('sa_split_all');
  if (v === 'unknown') return t('an_unknown');
  if (dim === 'method' || dim === 'code') return t(`pfn_${dim}_${v}`);
  return segLabel(v);
}
function pfnDur(h) {
  if (h == null) return 'n/a';
  const n = Number(h);
  if (n < 1) return tf('pfn_dur_min', { n: Math.max(1, Math.round(n * 60)) });
  if (n < 48) return tf('pfn_dur_h', { n: n.toFixed(1) });
  return tf('pfn_dur_d', { n: (n / 24).toFixed(1) });
}

function renderPfnKpis() {
  const all = pfnRow('all', 'all');
  if (!all) { $('#pfnKpis').innerHTML = ''; return; }
  const n = (k) => nval(all[k]);
  const drop = biggestDrop(PFN_STEPS, PFN_STEPS.map(([k]) => n(k)));
  const existing = nval(pfnRow('excluded', 'existing_account')?.started);
  $('#pfnKpis').innerHTML = [
    kpi(t('pfn_kpi_started'), num(n('started')), tf('pfn_kpi_started_sub', { n: num(existing) }), '', ICONS.userPlus),
    kpi(t('pfn_kpi_verified'), pct(n('verified'), n('started')), tf('pfn_kpi_verified_sub', { n: num(n('verified')) }), '', ICONS.check),
    kpi(t('pfn_kpi_paid'), pct(n('paid'), n('started')), n('paid') ? tf('pfn_kpi_paid_sub', { n: num(n('paid')), days: val(all.median_days_to_paid) }) : '', 'accent', ICONS.coin),
    kpi(t('pfn_kpi_drop'), `${drop.pct.toFixed(0)}%`, tf('pfn_kpi_drop_sub', { step: t(drop.key) }), 'warn', ICONS.trendDown),
  ].join('');
}

function renderPfnFunnel() {
  if (!PFN_TAB.cache.steps) return;
  renderPfnKpis();
  // Platform and sign-up method are two splits of the same phones, so each
  // gets its own labelled group; the three groups act as one choice.
  const keys = (d) => pfnRows(d).map((r) => `${d}:${val(r.value)}`);
  if (!['all', 'platform', 'method'].flatMap(keys).includes(pfnView.segment)) pfnView.segment = 'all:all';
  [['#pfnSegAll', 'all'], ['#pfnSegPlatform', 'platform'], ['#pfnSegMethod', 'method']]
    .forEach(([sel, d]) => segButtons(sel, 'segment', keys(d), pfnView.segment, (k) => pfnLabel(...k.split(':'))));
  if (!pfnRow('all', 'all')) {
    $('#pfnFunnelTable').innerHTML = `<div class="empty">${t('pfn_empty')}</div>`;
    story('#pfnFunnelStory', []);
    return;
  }
  const row = pfnRow(...pfnView.segment.split(':'));
  const counts = renderSteps({ chartId: 'pfnFunnelChart', tableSel: '#pfnFunnelTable', steps: PFN_STEPS, row, unit: 'pfn_col_phones' });
  const at = (k) => counts[PFN_STEPS.findIndex(([key]) => key === k)];
  const drop = biggestDrop(PFN_STEPS, counts);
  const everyone = pfnView.segment === 'all:all';
  const email = pfnRow('method', 'email'), google = pfnRow('method', 'google');
  const existing = pfnRow('excluded', 'existing_account');
  const share = (r, k) => pct(nval(r[k]), nval(r.started));
  story('#pfnFunnelStory', [
    tf('pfn_story_funnel', {
      started: num(at('started')), account: num(at('account')), accountPct: pct(at('account'), at('started')),
      verified: num(at('verified')), verifiedPct: pct(at('verified'), at('started')), paid: num(at('paid')), paidPct: pct(at('paid'), at('started')),
    }),
    at('started') ? tf('pfn_story_drop', { step: t(drop.key), drop: drop.pct.toFixed(0) }) : '',
    everyone && email && google ? tf('pfn_story_method', { ea: share(email, 'account'), ep: share(email, 'paid'), ga: share(google, 'account'), gp: share(google, 'paid') }) : '',
    everyone && existing ? tf('pfn_story_existing', { n: num(nval(existing.started)) }) : '',
  ]);
}

// Server rows are one per (furthest step, last screen), top 5 screens per
// step, each carrying its step's totals; folded here into one row per step.
function renderPfnStops() {
  const rows = PFN_TAB.cache.stops;
  if (!rows) return;
  const started = nval(pfnRow('all', 'all')?.started);
  const groups = [];
  rows.forEach((r) => {
    const i = nval(r.reached) - 1;
    let g = groups.find((x) => x.i === i);
    if (!g) groups.push(g = { i, r, screens: [] });
    g.screens.push(`${escapeHtml(val(r.last_screen))} (${num(nval(r.devices))})`);
  });
  genTable('#pfnStopsTable', groups.map(({ i, r, screens }) => ({
    step: t(PFN_STEPS[i][1]), phones: nval(r.step_devices), of_started: started ? pctOf(nval(r.step_devices), started) : null,
    uninstalled: nval(r.step_android) ? pctOf(nval(r.step_uninstalled), nval(r.step_android)) : null,
    active: nval(r.step_active_7d), failed: PFN_STEPS[i][0] === 'kyc_sent' ? num(nval(r.step_kyc_failed)) : '',
    screens: screens.join(' · '),
  })), [
    { key: 'step', label: t('pfn_col_furthest') }, { key: 'phones', label: t('pfn_col_phones'), type: 'num' },
    { key: 'of_started', label: t('pfn_col_of_started'), type: 'pct' }, { key: 'uninstalled', label: t('pfn_col_uninstalled'), type: 'pct' },
    { key: 'active', label: t('pfn_col_active_7d'), type: 'num' }, { key: 'failed', label: t('pfn_col_kyc_failed') },
    { key: 'screens', label: t('pfn_col_last_screens') },
  ], t('pfn_empty'));
  if (!groups.length) { story('#pfnStopsStory', []); return; }
  const big = [...groups].sort((a, b) => nval(b.r.step_devices) - nval(a.r.step_devices))[0];
  const verified = groups.find((g) => PFN_STEPS[g.i][0] === 'verified');
  story('#pfnStopsStory', [
    tf('pfn_story_stops', {
      n: num(nval(big.r.step_devices)), pct: pct(nval(big.r.step_devices), started), step: t(PFN_STEPS[big.i][1]),
      screen: escapeHtml(val(big.r.last_screen)), un: pct(nval(big.r.step_uninstalled), nval(big.r.step_android)),
    }),
    verified ? tf('pfn_story_stops_verified', { n: num(nval(verified.r.step_devices)), active: num(nval(verified.r.step_active_7d)) }) : '',
  ]);
}

function renderPfnSplit() {
  if (!PFN_TAB.cache.steps) return;
  const dim = pfnView.dim;
  const rows = pfnRows(dim);
  genTable('#pfnSplitTable', rows.map((r) => ({
    ...r, value: pfnLabel(dim, val(r.value)),
    account_pct: pfnRate(r, 'account'), verified_pct: pfnRate(r, 'verified'), paid_pct: pfnRate(r, 'paid'),
    paid_7d_pct: nval(r.started_7d_ago) ? pctOf(nval(r.paid_7d), nval(r.started_7d_ago)) : null,
  })), [
    { key: 'value', label: t(`pfn_dim_${dim}`) },
    ...['started', 'account', 'verified', 'paid'].map((k) => ({ key: k, label: t(`pfn_step_${k}`), type: 'num', sum: true })),
    { key: 'account_pct', label: t('pfn_col_account_pct'), type: 'pct' },
    { key: 'verified_pct', label: t('pfn_col_verified_pct'), type: 'pct' },
    { key: 'paid_pct', label: t('pfn_col_paid_pct'), type: 'pct' },
    { key: 'paid_7d_pct', label: t('pfn_col_paid_7d'), type: 'pct' },
    { key: 'median_days_to_paid', label: t('pfn_col_days_to_paid') },
    { key: 'median_first_paid', label: t('pfn_col_first_paid'), type: 'idr' },
  ], t('pfn_empty'));
  const solid = rows.filter((r) => nval(r.started) >= 20 && !['unknown', 'no_account'].includes(val(r.value)))
    .sort((a, b) => pfnRate(b, 'paid') - pfnRate(a, 'paid'));
  if (solid.length < 2) { story('#pfnSplitStory', []); return; }
  const best = solid[0], worst = solid[solid.length - 1];
  story('#pfnSplitStory', [tf('pfn_story_split', {
    dim: t(`pfn_dim_${dim}`).toLowerCase(),
    best: pfnLabel(dim, val(best.value)), bestPct: pct(nval(best.paid), nval(best.started)), bestN: num(nval(best.started)),
    worst: pfnLabel(dim, val(worst.value)), worstPct: pct(nval(worst.paid), nval(worst.started)), worstN: num(nval(worst.started)),
  })]);
}

// Rates only on the chart (one % axis); weekly volume is in the table.
// Indigo, chart amber and chart green pass the colour-blind checks in both
// themes. A 7-day rate shows only once every phone in the week is 7 days old;
// "Any time" switches the chart to everyone who got there so far.
function renderPfnWeeks() {
  if (!PFN_TAB.cache.steps) return;
  const r7 = (r, k) => (nval(r.started_7d_ago) && nval(r.started_7d_ago) === nval(r.started) ? pctOf(nval(r[k]), nval(r.started)) : null);
  const weeks = pfnRows('week').sort((a, b) => String(val(a.value)).localeCompare(String(val(b.value)))).map((r) => ({
    week: val(r.value), started: nval(r.started), account_pct: pfnRate(r, 'account'), verified_pct: pfnRate(r, 'verified'),
    verified_7d_pct: r7(r, 'verified_7d'), paid_pct: pfnRate(r, 'paid'), paid_7d_pct: r7(r, 'paid_7d'),
  }));
  const line = (key, label, color) => ({
    label: t(label), data: weeks.map((w) => w[key]), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 4, tension: .3,
  });
  const any = pfnView.weeks === 'all';
  paint('pfnWeeksChart', {
    type: 'line',
    data: {
      labels: weeks.map((w) => w.week),
      datasets: [
        line('account_pct', 'pfn_chart_account', C.indigo),
        any ? line('verified_pct', 'pfn_col_verified_pct', C.chartGreen) : line('verified_7d_pct', 'pfn_chart_verified_7d', C.chartGreen),
        any ? line('paid_pct', 'pfn_col_paid_pct', C.chartAmber) : line('paid_7d_pct', 'pfn_chart_paid_7d', C.chartAmber),
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true, max: 100, grid: { color: C.grid }, ticks: { callback: (v) => `${v}%` } }, x: { grid: { display: false } } },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? 'n/a' : `${c.raw.toFixed(1)}%`}` } },
      },
    },
  });
  genTable('#pfnWeeksTable', weeks, [
    { key: 'week', label: t('pfn_col_week'), type: 'date' },
    { key: 'started', label: t('pfn_step_started'), type: 'num', sum: true },
    { key: 'account_pct', label: t('pfn_col_account_pct'), type: 'pct' },
    { key: 'verified_pct', label: t('pfn_col_verified_pct'), type: 'pct' },
    { key: 'verified_7d_pct', label: t('pfn_col_verified_7d'), type: 'pct' },
    { key: 'paid_pct', label: t('pfn_col_paid_pct'), type: 'pct' },
    { key: 'paid_7d_pct', label: t('pfn_col_paid_7d'), type: 'pct' },
  ], t('pfn_empty'));
  const all = pfnRow('all', 'all');
  const last = [...weeks].reverse().find((w) => w.paid_7d_pct != null);
  if (!all || !last || !nval(all.started_7d_ago)) { story('#pfnWeeksStory', []); return; }
  const fmt = (v) => `${v.toFixed(1)}%`;
  story('#pfnWeeksStory', [tf('pfn_story_weeks', {
    week: last.week, verified: fmt(last.verified_7d_pct), paid: fmt(last.paid_7d_pct),
    avgVerified: pct(nval(all.verified_7d), nval(all.started_7d_ago)), avgPaid: pct(nval(all.paid_7d), nval(all.started_7d_ago)),
  })]);
}

function renderPfnTiming() {
  const rows = PFN_TAB.cache.timing;
  if (!rows) return;
  const share = (r, k) => pctOf(nval(r[k]), nval(r.reached));
  genTable('#pfnTimingTable', rows.map((r) => ({
    step: t(`pfn_step_${val(r.step)}`), reached: nval(r.reached), median: pfnDur(val(r.median_hours)), p75: pfnDur(val(r.p75_hours)),
    h1: share(r, 'within_1h'), d1: share(r, 'within_1d'), d7: share(r, 'within_7d'), d30: share(r, 'within_30d'),
  })), [
    { key: 'step', label: t('an_col_step') }, { key: 'reached', label: t('pfn_col_reached'), type: 'num' },
    { key: 'median', label: t('pfn_col_median') }, { key: 'p75', label: t('pfn_col_p75') },
    { key: 'h1', label: t('pfn_col_within_1h'), type: 'pct' }, { key: 'd1', label: t('pfn_col_within_1d'), type: 'pct' },
    { key: 'd7', label: t('pfn_col_within_7d'), type: 'pct' }, { key: 'd30', label: t('pfn_col_within_30d'), type: 'pct' },
  ], t('pfn_empty'));
  const step = (k) => rows.find((r) => val(r.step) === k);
  const account = step('account'), verified = step('verified'), paid = step('paid');
  if (!account || !verified || !paid || !nval(paid.reached)) { story('#pfnTimingStory', []); return; }
  story('#pfnTimingStory', [tf('pfn_story_timing', {
    account: pfnDur(val(account.median_hours)), verified: pfnDur(val(verified.median_hours)), paid: pfnDur(val(paid.median_hours)), paid7: pct(nval(paid.within_7d), nval(paid.reached)),
  })]);
}

function renderPfnInstalls() {
  const rows = PFN_TAB.cache.installs;
  if (!rows) return;
  // Day rows feed the Downloads per day panel, not this table.
  const groups = rows.filter((r) => val(r.dimension) !== 'day');
  genTable('#pfnInstallsTable', groups.map((r) => ({
    ...r, value: val(r.dimension) === 'all' ? `<strong>${t('sa_split_all')}</strong>` : pfnLabel(val(r.dimension), val(r.value)),
    new_account_pct: nval(r.new_device) ? pctOf(nval(r.new_account), nval(r.new_device)) : null,
    uninstalled_pct: nval(r.android) ? pctOf(nval(r.uninstalled), nval(r.android)) : null,
  })), [
    { key: 'value', label: t('pfn_col_group') },
    { key: 'installs', label: t('pfn_col_installs'), type: 'num' },
    { key: 'existing_account', label: t('pfn_col_existing'), type: 'num' },
    { key: 'new_device', label: t('pfn_col_new_device'), type: 'num' },
    { key: 'guest', label: t('pfn_col_guest'), type: 'num' },
    { key: 'viewed_fund', label: t('pfn_col_viewed_fund'), type: 'num' },
    { key: 'started_signup', label: t('pfn_col_started'), type: 'num' },
    { key: 'new_account', label: t('pfn_col_new_account'), type: 'num' },
    { key: 'new_account_pct', label: t('pfn_col_new_account_pct'), type: 'pct' },
    { key: 'new_verified', label: t('pfn_col_new_verified'), type: 'num' },
    { key: 'new_paid', label: t('pfn_col_new_paid'), type: 'num' },
    { key: 'uninstalled_pct', label: t('pfn_col_uninstalled'), type: 'pct' },
    { key: 'median_min_to_start', label: t('pfn_col_min_to_start') },
  ], t('pfn_installs_empty'));
  const all = rows.find((r) => val(r.dimension) === 'all');
  if (!all) { story('#pfnInstallsStory', []); return; }
  const n = (k) => nval(all[k]);
  story('#pfnInstallsStory', [
    tf('pfn_story_installs', {
      installs: num(n('installs')), existing: num(n('existing_account')), existingPct: pct(n('existing_account'), n('installs')),
      fresh: num(n('new_device')), started: num(n('started_signup')), startedPct: pct(n('started_signup'), n('new_device')),
      newAcc: num(n('new_account')), newPct: pct(n('new_account'), n('new_device')),
    }),
    n('android') ? tf('pfn_story_installs_removed', { un: num(n('uninstalled')), android: num(n('android')), pct: pct(n('uninstalled'), n('android')) }) : '',
  ]);
}

// Downloads per day from the installs query's day rows (one per day and
// platform). "Everyone" puts Android and iOS side by side, the shape of the
// daily download report; one platform shows that platform's own funnel.
// The chart always stacks both platforms. Uninstalls exist for Android only,
// so the iOS view shows n/a there rather than a misleading 0.
function renderPfnDaily() {
  const rows = PFN_TAB.cache.installs;
  if (!rows) return;
  const days = new Map();
  rows.filter((r) => val(r.dimension) === 'day').forEach((r) => {
    const d = String(val(r.day));
    if (!days.has(d)) days.set(d, {});
    days.get(d)[val(r.value)] = r;
  });
  const keys = [...days.keys()].sort();
  const n = (p, k) => (p ? nval(p[k]) : 0);
  const sum = (g, k) => Object.values(g).reduce((a, r) => a + nval(r[k]), 0);
  const plat = pfnView.daily;
  const data = plat === 'all'
    ? keys.map((d) => {
      const g = days.get(d);
      return {
        day: d, dl_android: n(g.ANDROID, 'installs'), dl_ios: n(g.IOS, 'installs'), dl_total: sum(g, 'installs'),
        new_android: n(g.ANDROID, 'new_device'), new_ios: n(g.IOS, 'new_device'), new_total: sum(g, 'new_device'),
        new_account: sum(g, 'new_account'), new_verified: sum(g, 'new_verified'), new_paid: sum(g, 'new_paid'),
        uninstalled: sum(g, 'uninstalled'),
      };
    })
    : keys.map((d) => {
      const p = days.get(d)[plat];
      return {
        day: d, installs: n(p, 'installs'), existing_account: n(p, 'existing_account'), new_device: n(p, 'new_device'),
        guest: n(p, 'guest'), started_signup: n(p, 'started_signup'), new_account: n(p, 'new_account'),
        new_verified: n(p, 'new_verified'), new_paid: n(p, 'new_paid'), uninstalled: plat === 'IOS' ? null : n(p, 'uninstalled'),
      };
    });
  const col = (key, label) => ({ key, label: t(label), type: 'num', sum: true });
  const tail = [
    col('new_account', 'pfn_col_new_account'), col('new_verified', 'pfn_col_new_verified'), col('new_paid', 'pfn_col_new_paid'),
    { ...col('uninstalled', 'pfn_col_uninstalled_n'), sum: plat !== 'IOS' },
  ];
  genTable('#pfnDailyTable', data, [
    { key: 'day', label: t('pfn_col_day'), type: 'date' },
    ...(plat === 'all' ? [
      col('dl_android', 'pfn_col_dl_android'), col('dl_ios', 'pfn_col_dl_ios'), col('dl_total', 'pfn_col_dl_total'),
      col('new_android', 'pfn_col_new_android'), col('new_ios', 'pfn_col_new_ios'), col('new_total', 'pfn_col_new_total'),
    ] : [
      col('installs', 'pfn_col_downloads'), col('existing_account', 'pfn_col_existing'), col('new_device', 'pfn_col_new_users'),
      col('guest', 'pfn_col_guest'), col('started_signup', 'pfn_col_started'),
    ]),
    ...tail,
  ], t('pfn_installs_empty'));
  paint('pfnDailyChart', {
    type: 'bar',
    data: {
      labels: keys,
      datasets: [
        { label: 'Android', data: keys.map((d) => n(days.get(d).ANDROID, 'installs')), backgroundColor: C.indigo, stack: 'dl' },
        { label: 'iOS', data: keys.map((d) => n(days.get(d).IOS, 'installs')), backgroundColor: C.chartAmber, stack: 'dl' },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: C.grid } } },
      plugins: { legend: { position: 'bottom' } },
    },
  });
  const all = rows.find((r) => val(r.dimension) === 'all');
  if (!all || !keys.length) { story('#pfnDailyStory', []); return; }
  const platRow = (p) => rows.find((r) => val(r.dimension) === 'platform' && val(r.value) === p);
  const top = keys.reduce((a, d) => (sum(days.get(d), 'installs') > sum(days.get(a), 'installs') ? d : a), keys[0]);
  story('#pfnDailyStory', [tf('pfn_story_daily', {
    installs: num(nval(all.installs)), android: num(n(platRow('ANDROID'), 'installs')), ios: num(n(platRow('IOS'), 'installs')),
    fresh: num(nval(all.new_device)), day: top, top: num(sum(days.get(top), 'installs')),
  })]);
}

// Android uninstalls (app_remove) in the period, one cut at a time. Stage and
// time installed keep a fixed order (earliest to furthest); days run in date
// order; screens and versions by count, screens capped at the top 15, so
// that cut gets no total row.
const PFN_UN_ORDER = {
  stage: ['no_account', 'account', 'verified', 'paid_no_holdings', 'holder'],
  tenure: ['d0_1', 'd1_7', 'd8_30', 'd31_90', 'd90_plus', 'unknown'],
};
function pfnUnLabel(dim, v) {
  if (v === 'unknown') return t('an_unknown');
  if (dim === 'stage') return t(`pfn_stage_${v}`);
  if (dim === 'tenure') return t(`pfn_tenure_${v}`);
  if (dim === 'last_screen' && v === '(none)') return t('pfn_un_no_screen');
  return escapeHtml(v);
}
function renderPfnUninstalls() {
  const rows = PFN_TAB.cache.uninstalls;
  if (!rows) return;
  const dim = pfnView.un;
  let cut = rows.filter((r) => val(r.dimension) === dim);
  if (dim === 'day') cut.sort((a, b) => String(val(a.value)).localeCompare(String(val(b.value))));
  if (PFN_UN_ORDER[dim]) cut.sort((a, b) => PFN_UN_ORDER[dim].indexOf(val(a.value)) - PFN_UN_ORDER[dim].indexOf(val(b.value)));
  if (dim === 'last_screen') cut = cut.slice(0, 15);
  const sum = dim !== 'last_screen';
  const col = (key, label, type = 'num') => ({ key, label: t(label), type, sum });
  genTable('#pfnUninstallsTable', cut.map((r) => ({ ...r, value: pfnUnLabel(dim, String(val(r.value))) })), [
    { key: 'value', label: t(`pfn_un_dim_${dim}`) },
    col('uninstalls', 'pfn_col_uninstalls'), col('with_account', 'pfn_col_with_account'), col('verified', 'pfn_col_new_verified'),
    col('paid_before', 'pfn_col_paid_before'), col('holders', 'pfn_col_holders'), col('holder_aum', 'pfn_col_holder_aum', 'idr'),
    col('came_back', 'pfn_col_came_back'), { key: 'median_days_installed', label: t('pfn_col_days_installed') },
  ], t('pfn_un_empty'));
  const all = rows.find((r) => val(r.dimension) === 'all');
  if (!all) { story('#pfnUninstallsStory', []); return; }
  const fast = nval(rows.find((r) => val(r.dimension) === 'tenure' && val(r.value) === 'd0_1')?.uninstalls);
  story('#pfnUninstallsStory', [
    tf('pfn_story_un', {
      n: num(nval(all.uninstalls)), acc: num(nval(all.with_account)), holders: num(nval(all.holders)),
      aum: idr(nval(all.holder_aum)), back: num(nval(all.came_back)),
    }),
    fast ? tf('pfn_story_un_fast', { fast: num(fast), pct: pct(fast, nval(all.uninstalls)) }) : '',
  ]);
}

PFN_TAB.sections = [
  ['product-funnel/steps', ['#pfnFunnelTable', '#pfnSplitTable', '#pfnWeeksTable'], () => { renderPfnFunnel(); renderPfnSplit(); renderPfnWeeks(); renderPfnStops(); }],
  ['product-funnel/stops', '#pfnStopsTable', renderPfnStops],
  ['product-funnel/timing', '#pfnTimingTable', renderPfnTiming],
  ['product-funnel/installs', ['#pfnInstallsTable', '#pfnDailyTable'], () => { renderPfnInstalls(); renderPfnDaily(); }],
  ['product-funnel/uninstalls', '#pfnUninstallsTable', renderPfnUninstalls],
];
const ANALYSIS_TABS = [SA_TAB, OB_TAB, RD_TAB, EG_TAB, PFN_TAB];
function loadSubscription() { return loadAnalysis(SA_TAB); }
function loadOnboarding() { return loadAnalysis(OB_TAB); }
function loadRedemption() { return loadAnalysis(RD_TAB); }
function loadEngagement() { return loadAnalysis(EG_TAB); }
function loadProductFunnel() { return loadAnalysis(PFN_TAB); }

// Marks a tab's "loaded" gate true right away (so a fast repeat tab-switch
// doesn't double-fire its fetches) but un-latches it if any of its fetches
// end up failing, so switchTab retries the whole tab on the next visit
// instead of leaving it stuck on a stale/error view for the rest of the
// session (see e774f55, which fixed this for 3 date-defaulting flags —
// this generalizes the same fix to every tab's own loaded flag).
function gateTabLoad(setLoaded, promises) {
  setLoaded(true);
  Promise.allSettled(promises).then((results) => {
    if (results.some((r) => r.status === 'rejected')) setLoaded(false);
  });
}

// OVERVIEW
let overviewLoaded = false;

// Overview-wide fund filter — a separate multi-select from the "Select funds"
// exclude-list further down this tab (that one only narrows the Largest
// funds table). Reads straight from the checklist, same as topFundsExcluded()
// below, so there's no separate state var to keep in sync.
let overviewFundOptionsLoaded = false;
async function loadOverviewFundOptions() {
  let funds = [];
  try { funds = await api('/api/funds/list'); } catch { return; }
  $('#ovFundFilterList').innerHTML = funds.map((f) =>
    `<label class="ask-table-chk"><input type="checkbox" value="${val(f.id)}"> ${val(f.name)}</label>`).join('');
}
function overviewFundIdsPicked() {
  return $$('#ovFundFilterList input:checked').map((el) => el.value).filter(Boolean);
}
function overviewFundQs() {
  const ids = overviewFundIdsPicked();
  return ids.length ? `fundIds=${ids.join(',')}` : '';
}
function updateOverviewFundFilterBtn() {
  const n = overviewFundIdsPicked().length;
  $('#ovFundFilterBtn').textContent = n
    ? t('ov_funds_selected').replace('{n}', n).replace('{s}', n === 1 ? '' : 's')
    : t('ov_all_funds');
}
function filterOverviewFundList() {
  const q = $('#ovFundFilterSearch').value.trim().toLowerCase();
  $$('#ovFundFilterList label').forEach((lbl) => {
    lbl.style.display = lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function overviewFundFilterSelectAll() {
  $$('#ovFundFilterList input[type=checkbox]').forEach((cb) => { cb.checked = true; });
  updateOverviewFundFilterBtn();
}
function overviewFundFilterClear() {
  $$('#ovFundFilterList input[type=checkbox]').forEach((cb) => { cb.checked = false; });
  updateOverviewFundFilterBtn();
}

// Overview user filter: include/exclude rules on referrer code, sales code,
// SID, email, or institution accounts (see normalizeUserFilter in
// server/queries.js for the matching rules). The panel is a draft;
// ovUserFilter holds what was last applied, so a granularity click or a
// Largest funds re-query never picks up half-typed rules.
const UF_FIELDS = ['referrer_code', 'sales_code', 'sid', 'email', 'institution'];
const UF_MAX_VALUES = 300; // same cap the server enforces
let ovUserFilter = [];
function addOverviewUserRule() {
  const row = document.createElement('div');
  row.className = 'uf-rule';
  row.innerHTML = `
    <select class="uf-mode" data-i18n-title="ov_uf_mode" title="${t('ov_uf_mode')}">
      <option value="exclude" data-i18n="ov_uf_exclude">${t('ov_uf_exclude')}</option>
      <option value="include" data-i18n="ov_uf_include">${t('ov_uf_include')}</option>
    </select>
    <select class="uf-field" data-i18n-title="ov_uf_field" title="${t('ov_uf_field')}">
      ${UF_FIELDS.map((f) => `<option value="${f}" data-i18n="ov_uf_f_${f}">${t('ov_uf_f_' + f)}</option>`).join('')}
    </select>
    <button type="button" class="link-btn uf-remove" data-i18n="ov_uf_remove">${t('ov_uf_remove')}</button>
    <textarea class="uf-values" rows="2"></textarea>`;
  $('#ovUserFilterRules').appendChild(row);
  syncOverviewUserRule(row);
  row.querySelector('.uf-values').focus();
}
// Institution accounts is a yes/no flag, so its row has no values box.
function syncOverviewUserRule(row) {
  const field = row.querySelector('.uf-field').value;
  const box = row.querySelector('.uf-values');
  box.hidden = field === 'institution';
  box.dataset.i18nPlaceholder = `ov_uf_ph_${field}`;
  box.placeholder = t(`ov_uf_ph_${field}`);
}
function overviewUserRulesDraft() {
  return $$('#ovUserFilterRules .uf-rule').map((row) => {
    const field = row.querySelector('.uf-field').value;
    const values = field === 'institution' ? [] : row.querySelector('.uf-values').value.split(/[\s,;]+/).filter(Boolean);
    return { field, mode: row.querySelector('.uf-mode').value, values };
  }).filter((r) => r.field === 'institution' || r.values.length);
}
function overviewUserQs() {
  return ovUserFilter.length ? `userFilter=${encodeURIComponent(JSON.stringify(ovUserFilter))}` : '';
}
// Accent border while rules are on: the filter can shrink every number on the
// tab (RAIZKAYA alone is ~80% of users), so it has to be visible at a glance.
function updateOverviewUserFilterBtn() {
  const n = ovUserFilter.length;
  $('#ovUserFilterBtn').textContent = n
    ? t('ov_uf_rules').replace('{n}', n).replace('{s}', n === 1 ? '' : 's')
    : t('ov_uf_all_users');
  $('#ovUserFilterBtn').classList.toggle('is-active', n > 0);
}
function setOverviewUserPanel(open) {
  $('#ovUserFilterPanel').classList.toggle('open', open);
  $('#ovUserFilterBtn').setAttribute('aria-expanded', String(open));
}
// Fund + user filter, as one query-string fragment for every Overview call.
function overviewScopeQs() {
  return [overviewFundQs(), overviewUserQs()].filter(Boolean).join('&');
}

// Platform AUM's own "as of" date — deliberately separate from the from/to
// range above (that range only ever scoped buy/sell/transaction figures,
// never AUM, which was confusing with both pickers sitting side by side).
// It and the Largest funds table both default to the latest snapshot date,
// fetched once and shared; a failed lookup is cleared so the next load retries.
let latestDateLoad = null;
function latestSnapshotDate() {
  return latestDateLoad ||= api('/api/funds/top/latest-date').then((r) => r.latestDate, (err) => { latestDateLoad = null; throw err; });
}
async function defaultToLatestDate(sel) {
  if ($(sel).value) return;
  try {
    const d = await latestSnapshotDate();
    if (d && !$(sel).value) $(sel).value = val(d);
  } catch { /* left blank: the request that needs the date reports the error */ }
}

async function loadOverview() {
  if (!overviewFundOptionsLoaded) { overviewFundOptionsLoaded = true; loadOverviewFundOptions(); }
  const r = currentRange();
  const scopeQs = overviewScopeQs();
  const qs = `?from=${r.from}&to=${r.to}${scopeQs ? '&' + scopeQs : ''}`;
  $('#kpis').innerHTML = '<div class="loading">Loading metrics…</div>';

  // Every request goes out at once. Only the KPI call and the Largest funds
  // table wait for the latest-date lookup; the charts used to queue behind
  // both of them even though they never needed the AUM date.
  const overviewFetch = defaultToLatestDate('#ovAumDate').then(() =>
    api(`/api/overview?aumDate=${$('#ovAumDate').value}${scopeQs ? '&' + scopeQs : ''}&from=${r.from}&to=${r.to}`));
  gateTabLoad((v) => { overviewLoaded = v; }, [overviewFetch]);
  overviewFetch.then(renderKpis, (e) => { $('#kpis').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; });

  loadTrends($('.seg button.on', )?.dataset.g || 'month');
  api('/api/breakdown/type' + qs).then(renderTypeChart).catch((e) => showFail('typeChart', e));
  api('/api/breakdown/status' + qs).then(renderStatusChart).catch((e) => showFail('statusChart', e));
  api('/api/users/verification' + (scopeQs ? '?' + scopeQs : '')).then(renderVerifyChart).catch((e) => showFail('verifyChart', e));
  api('/api/funds/types' + (scopeQs ? '?' + scopeQs : '')).then(renderFundTypeChart).catch((e) => showFail('fundTypeChart', e));
  loadTopFunds();
  api('/api/users/by-province' + (scopeQs ? '?' + scopeQs : '')).then(renderGeoChart).catch((e) => showFail('geoChart', e));
  api('/api/users/top-cities?limit=15' + (scopeQs ? '&' + scopeQs : '')).then(renderTopCities).catch((e) => showFail('topCitiesTable', e));
  api('/api/users/top-cities-aum?limit=15' + (scopeQs ? '&' + scopeQs : '')).then(renderTopCitiesAum).catch((e) => showFail('topCitiesAumTable', e));
}

// Investor distribution map (chartjs-chart-geo choropleth)
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
  const r1 = 223, g1 = 227, b1 = 240; // pale indigo-tinted gray, the "0" end, still visible as a shape
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
        label: t('col_investors'),
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
  if (!rows.length) { $('#topCitiesTable').innerHTML = `<div class="empty">${t('ov_no_investors_match')}</div>`; return; }
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
  if (!rows.length) { $('#topCitiesAumTable').innerHTML = `<div class="empty">${t('ov_no_investors_match')}</div>`; return; }
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
    kpi(t('kpi_platform_aum'), idr(val(o.platform_aum)), `${num(val(o.investing_users))} ${t('kpi_investing_users')}`, 'accent', ICONS.coin),
    kpi(t('kpi_total_investors'), num(val(o.investing_users)),
      `${num(val(o.total_users))} ${t('kpi_total_users')}<br>${num(val(o.verified_users))} ${t('kpi_verified')} (${pct(val(o.verified_users), val(o.total_users))})`,
      '', ICONS.users),
    kpi(t('kpi_buy_volume'), idr(val(o.buy_volume)), `${num(val(o.buy_count))} ${t('kpi_completed_buys')}`, 'accent', ICONS.trendUp),
    kpi(t('kpi_sell_volume'), idr(val(o.sell_volume)), `${num(val(o.sell_count))} ${t('kpi_completed_sells')}`, 'warn', ICONS.trendDown),
    kpi(t('kpi_active_users'), num(val(o.active_users)), t('kpi_ge1_tx'), 'amber', ICONS.activity),
    kpi(t('kpi_transactions'), num(val(o.total_tx)), t('kpi_all_statuses'), '', ICONS.receipt),
    kpi(t('kpi_active_funds'), num(val(o.active_funds)), `${num(val(o.total_funds))} ${t('kpi_total_in_catalog')}`, 'amber', ICONS.folder),
    kpi(t('kpi_new_users_30d'), num(val(o.new_users_30d)), t('kpi_rolling_window'), '', ICONS.userPlus),
  ].join('');
}

async function loadTrends(gran) {
  const r = currentRange();
  const scopeQs = overviewScopeQs();
  $('#trendFinding').hidden = true;
  try {
    const data = await api(`/api/trends?from=${r.from}&to=${r.to}&granularity=${gran}${scopeQs ? '&' + scopeQs : ''}`);
    renderSeriesTrendFinding('#trendFinding', data, 'buy_volume', 'Buy volume');
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

// An empty result (now common once the Overview user filter narrows things
// down) clears the old chart and says so, instead of leaving stale slices up.
function setChartEmpty(id, empty) {
  const wrap = $('#' + id).parentElement;
  let msg = wrap.querySelector('.chart-empty');
  if (empty && !msg) { msg = document.createElement('div'); msg.className = 'empty chart-empty'; wrap.appendChild(msg); }
  if (msg) { msg.hidden = !empty; msg.textContent = t('chart_empty'); msg.classList.remove('error'); }
}
// A chart or table slot whose request failed says so, instead of staying blank.
function showFail(id, e) {
  const el = $('#' + id);
  if (el.tagName !== 'CANVAS') { el.innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; return; }
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  setChartEmpty(id, true);
  const m = el.parentElement.querySelector('.chart-empty');
  m.textContent = `Could not load: ${e.message}`; m.classList.add('error');
}
function doughnut(id, rows, labelKey, valueKey, fmt) {
  setChartEmpty(id, !rows.length);
  if (!rows.length) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } return; }
  const values = rows.map((r) => Number(val(r[valueKey])) || 0);
  const total = values.reduce((a, b) => a + b, 0);
  paint(id, {
    type: 'doughnut',
    data: { labels: rows.map((r, i) => `${val(r[labelKey])} (${pct(values[i], total)})`),
      datasets: [{ data: values, backgroundColor: pie(), borderWidth: 2, borderColor: C.surface }] },
    options: { maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt ? fmt(c.raw) : num(c.raw)}` } } } },
  });
}
const renderTypeChart = (rows) => doughnut('typeChart', rows, 'label', 'count', num);
const renderStatusChart = (rows) => doughnut('statusChart', rows, 'label', 'count', num);
const renderVerifyChart = (rows) => doughnut('verifyChart', rows, 'label', 'count', num);
// Types nobody holds (possible under a user filter) come back as 0; leave them off the donut.
const renderFundTypeChart = (rows) => doughnut('fundTypeChart', rows.filter((r) => nval(r.aum) > 0), 'label', 'aum', idrFull);

let topFundsCache = [];
let topFundsGroup = 'fund';
function renderTopFunds(rows) {
  topFundsCache = rows;
  const funds = rows.filter((f) => !val(f.is_total));
  const total = rows.find((f) => val(f.is_total));
  if (!funds.length) { $('#topFunds').innerHTML = `<div class="empty">${t('msg_no_funds')}</div>`; return; }
  const nameCol = topFundsGroup === 'manager' ? 'Investment manager' : 'Fund';
  const cells = (f) => `
      <td>${val(f.label)}</td>
      <td class="num">${idrFull(val(f.aum))}</td>
      <td class="num">${val(f.pct_of_total) == null ? 'n/a' : `${Number(val(f.pct_of_total)).toFixed(1)}%`}</td>
      <td class="num">${num(val(f.investors))}</td>`;
  $('#topFunds').innerHTML = `<table><thead><tr>
      <th data-key="label">${nameCol}</th><th class="num" data-key="aum">AUM</th><th class="num" data-key="pct_of_total">% of total</th><th class="num" data-key="investors">Investors</th>
    </tr></thead><tbody>${funds.map((f) => `<tr>${cells(f)}</tr>`).join('')}</tbody>${total ? `<tfoot><tr>${cells(total)}</tr></tfoot>` : ''}</table>`;
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
  $('#topFundsExcludeList').innerHTML = rows.filter((f) => !val(f.is_total)).map((f) => {
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
  if (!date) { $('#topFunds').innerHTML = `<div class="empty">${t('msg_pick_a_date')}</div>`; return; }
  const exclude = topFundsExcluded();
  const userQs = overviewUserQs();
  const qs = `groupBy=${topFundsGroup}&date=${date}` + (exclude.length ? `&excludeFunds=${encodeURIComponent(exclude.join(','))}` : '') + (userQs ? `&${userQs}` : '');
  api(`/api/funds/top?${qs}`).then(renderTopFunds).catch((e) => showFail('topFunds', e));
}
async function loadTopFunds() {
  await defaultToLatestDate('#topFundsDate');
  const date = $('#topFundsDate').value;
  if (!date) { $('#topFunds').innerHTML = `<div class="empty">${t('msg_pick_a_date')}</div>`; return; }
  // Checklist and table in parallel: the table reads the exclusions already
  // on screen, and the rebuilt checklist keeps them by name.
  loadTopFundsOptions(date);
  loadTopFundsTable();
}

// PREDICT (ML: forecasts, churn, retention)
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
  loadMlRetrainStatus();
  predictLoaded = true;
}

// "Last retrained" line above the forecast panels — read from the audit log
// (see /api/ml/retrain-status) rather than a live model timestamp, since the
// audit log already records who/what triggered each retrain.
async function loadMlRetrainStatus() {
  try {
    const { lastRetrainedAt, lastRetrainedBy } = await api('/api/ml/retrain-status');
    $('#mlRetrainStatus').textContent = lastRetrainedAt
      ? `Last retrained ${toJakartaTime(lastRetrainedAt)} WIB by ${lastRetrainedBy}.`
      : 'Never retrained through the app yet, models may still be from a manual setup/ml_models.sql run.';
  } catch (e) { $('#mlRetrainStatus').textContent = e.message; }
}

async function retrainMlModels() {
  const btn = $('#mlRetrainBtn');
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = 'Retraining… this can take a few minutes';
  $('#mlRetrainStatus').textContent = 'Retraining models now, forecasts/churn scores will use the new fit once this finishes.';
  try {
    const result = await api('/api/ml/retrain', { method: 'POST' });
    const failed = result.steps.filter((s) => !s.ok);
    toast(failed.length ? `Retrain finished with ${failed.length} failed step(s), see Model status.` : 'Models retrained.');
    await loadMlRetrainStatus();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
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
        { label: t('col_confidence_band'), data: upper, borderColor: 'transparent', backgroundColor: 'rgba(224,163,62,.15)', fill: '+1', pointRadius: 0 },
        { label: '_lower', data: lower, borderColor: 'transparent', fill: false, pointRadius: 0 },
        { label: label || 'History', data: histVals, borderColor: C.indigo, backgroundColor: C.indigo, tension: .3, pointRadius: 0, borderWidth: 2 },
        { label: t('col_forecast'), data: fcVals, borderColor: C.amber, backgroundColor: C.amber, borderDash: [6, 4], tension: .3, pointRadius: 0, borderWidth: 2 },
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
      kpi(t('kpi_avg_probability'), (val(summary.avg_prob) != null ? (val(summary.avg_prob) * 100).toFixed(1) + '%' : 'n/a'), `${num(val(summary.scored))} ${t('kpi_holders_scored')}`),
    ].join('');
    renderChurnTable(top);
  } catch (e) { $('#churnTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function riskTag(p) {
  p = Number(p);
  if (p >= 0.5) return '<span class="tag risk-high">High</span>';
  if (p >= 0.2) return '<span class="tag risk-med">Medium</span>';
  return '<span class="tag risk-low">Low</span>';
}
function renderChurnTable(rows) {
  if (!rows.length) { $('#churnTable').innerHTML = `<div class="empty">${t('msg_no_holders_to_score')}</div>`; return; }
  const body = rows.map((r) => `<tr>
      <td>${val(r.name) || val(r.user_id)}</td>
      <td>${val(r.email) || 'n/a'}</td>
      <td class="num">${(Number(val(r.churn_prob)) * 100).toFixed(1)}%</td>
      <td>${riskTag(val(r.churn_prob))}</td>
      <td class="num">${num(val(r.buys))}</td>
      <td class="num">${num(val(r.sells))}</td>
      <td class="num">${num(val(r.recency_days))}d</td>
      <td class="num">${idrFull(val(r.total_buy_amount))}</td>
    </tr>`).join('');
  $('#churnTable').innerHTML = `<table><thead><tr>
      <th data-key="name">Investor</th><th data-key="email">Email</th><th class="num" data-key="churn_prob">Churn prob</th><th data-key="churn_prob">Risk</th>
      <th class="num" data-key="buys">Buys</th><th class="num" data-key="sells">Sells</th><th class="num" data-key="recency_days">Recency</th><th class="num" data-key="total_buy_amount">Invested</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

async function loadChurnOverview() {
  try {
    const { overall, byTenure } = await api('/api/churn/overview');
    const churnRate = val(overall.total_investors) ? (val(overall.churned) / val(overall.total_investors) * 100).toFixed(1) : 'n/a';
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
  } catch (e) { $('#churnTenure').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

async function loadRetention() {
  $('#retentionHeatmap').innerHTML = '<div class="loading">Building cohorts…</div>';
  try {
    const rows = await api('/api/retention/cohorts?months=12');
    if (!rows.length) { $('#retentionHeatmap').innerHTML = `<div class="empty">${t('msg_not_enough_buy_history_yet_to_build_coho')}</div>`; return; }
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
  } catch (e) { $('#retentionHeatmap').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
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
    if (!rows.length) { $('#aumRetentionHeatmap').innerHTML = `<div class="empty">${t('msg_not_enough_data')}</div>`; return; }
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
  } catch (e) { $('#aumRetentionHeatmap').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// AUM HISTORY
let aumGran = 'month';
let aumCache = [];

async function loadAumHistory() {
  const r = currentRange();
  $('#aumTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  try {
    const data = await api(`/api/aum-history?from=${r.from}&to=${r.to}&granularity=${aumGran}`);
    aumCache = data;
    $('#aumDrillPanel').classList.add('hidden');
    renderAumChart(data);
    renderAumCauseChart(data);
    renderAumTable(data);
    renderAumTrendFinding(data);
  } catch (e) {
    $('#aumTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    showAumCauseMessage(e.message);
  }
}

function renderAumChart(data) {
  const labels = data.map((d) => val(d.bucket));
  paint('aumChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'line', label: t('col_aum_end_of_period'), data: data.map((d) => val(d.aum)),
          borderColor: C.indigo, backgroundColor: 'rgba(30,42,74,.08)', fill: true,
          tension: .3, pointRadius: 2, yAxisID: 'y', order: 1 },
        { label: t('col_revenue'), data: data.map((d) => val(d.revenue)),
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

// Live panel headlines — a real, specific finding computed from whatever
// data the panel just fetched, instead of a generic static title. Never a
// fixed claim: re-runs on every load, so it can't go stale the way a
// hardcoded subtitle would, and hides itself when there isn't enough data
// to say anything.
//
// renderSeriesTrendFinding: for a first-vs-last time series (AUM, revenue).
function renderSeriesTrendFinding(elId, rows, key, label) {
  const el = $(elId);
  if (!el) return;
  const points = rows.map((d) => Number(val(d[key])) || 0).filter((v) => v > 0);
  if (points.length < 2) { el.hidden = true; return; }
  const first = points[0], last = points[points.length - 1];
  const pct = (last - first) / first * 100;
  const dir = pct >= 0 ? 'up' : 'down';
  el.className = `trend-finding ${dir}`;
  el.textContent = `${label} ${dir} ${Math.abs(pct).toFixed(1)}% over this range: ${idrFull(first)} → ${idrFull(last)}`;
  el.hidden = false;
}

function renderAumTrendFinding(data) {
  renderSeriesTrendFinding('#aumTrendFinding', data, 'aum', 'AUM');
  // First row has no prior period, so its flows aren't part of first → last.
  const rest = data.slice(1);
  if ($('#aumTrendFinding').hidden || !rest.length) return;
  const sum = (k) => rest.reduce((a, d) => a + (Number(val(d[k])) || 0), 0);
  $('#aumTrendFinding').textContent += ` · net flow ${idrFull(sum('net_flow'))}, market effect ${idrFull(sum('market_effect'))}`;
}

function showAumCauseMessage(msg) {
  $('#aumCauseWrap').classList.toggle('hidden', !!msg);
  $('#aumCauseEmpty').classList.toggle('hidden', !msg);
  $('#aumCauseEmpty').textContent = msg || '';
}

function renderAumCauseChart(data) {
  const rows = data.slice(1); // first row has no ΔAUM to explain
  showAumCauseMessage(rows.length ? '' : t('aum_cause_empty'));
  if (!rows.length) return;
  // Blue vs ochre stays distinguishable with red-green color blindness; the
  // surface-colored border separates stacked segments (1.83:1 against each other).
  const bar = { borderRadius: 4, borderColor: C.surface, borderWidth: 2, stack: 'cause', order: 1 };
  paint('aumCauseChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.bucket)),
      datasets: [
        { type: 'line', label: 'Δ AUM', data: rows.map((d) => Number(val(d.net_flow)) + Number(val(d.market_effect))),
          borderColor: C.ink, backgroundColor: C.ink, showLine: false, pointRadius: 4, stack: 'delta', order: 0 },
        { label: t('col_net_flow'), data: rows.map((d) => val(d.net_flow)), backgroundColor: C.indigo, ...bar },
        { label: t('col_market_effect'), data: rows.map((d) => val(d.market_effect)), backgroundColor: C.amberMark, ...bar },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${idrFull(c.raw)}` } },
      },
    },
  });
}

// Bucket → the day range its AUM history row covers: the whole day/month,
// with the end clipped to the page's "to" date so the drill diffs the same
// end-of-period AUM the row shows.
function aumBucketRange(bucket) {
  if (aumGran === 'day') return { start: bucket, end: bucket };
  const [y, m] = bucket.split('-').map(Number);
  const last = isoDate(new Date(Date.UTC(y, m, 0)));
  const { to } = currentRange();
  return { start: `${bucket}-01`, end: to && to < last ? to : last };
}

let aumDrillRange = null;
async function loadAumDrill(bucket) {
  aumDrillRange = aumBucketRange(bucket);
  $('#aumDrillPanel').classList.remove('hidden');
  $('#aumDrillTitle').textContent = `${t('aum_drill_title')} ${bucket}`;
  $('#aumDrillTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  $('#aumDrillPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const rows = await api(`/api/aum-history/drill?start=${aumDrillRange.start}&end=${aumDrillRange.end}`);
    genTable('#aumDrillTable', rows, [
      { key: 'fund', label: t('col_fund') }, { key: 'manager', label: t('col_investment_manager') },
      { key: 'aum_start', label: t('col_aum_start'), type: 'idr', sum: true }, { key: 'aum_end', label: t('col_aum_end'), type: 'idr', sum: true },
      { key: 'aum_change', label: 'Δ AUM', type: 'idr', sum: true },
      { key: 'subscriptions', label: t('col_subscriptions'), type: 'idr', sum: true }, { key: 'redemptions', label: t('col_redemptions'), type: 'idr', sum: true },
      { key: 'switch_net', label: t('col_switch_net'), type: 'idr', sum: true }, { key: 'market_effect', label: t('col_market_effect'), type: 'idr', sum: true },
    ], 'No fund moved in this period.');
  } catch (e) { $('#aumDrillTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderAumTable(data) {
  if (!data.length) { $('#aumTable').innerHTML = `<div class="empty">${t('msg_no_aum_snapshots_in_this_date_range_wide')}</div>`; return; }
  const tone = (v) => `color:${v >= 0 ? 'var(--pos-text)' : 'var(--neg-text)'}`;
  const signed = (v) => (v == null ? 'n/a' : `<span style="${tone(v)}">${v >= 0 ? '+' : '-'}${idrFull(Math.abs(v))}</span>`);
  const rows = data.map((d, i) => {
    const aum = Number(val(d.aum)) || 0;
    const prev = i > 0 ? Number(val(data[i - 1].aum)) || 0 : null;
    const chg = prev ? ((aum - prev) / prev * 100) : null;
    const mkt = val(d.market_effect);
    return { bucket: val(d.bucket), aum, revenue: val(d.revenue), funds: val(d.funds), chg,
      subs: val(d.subscriptions), reds: val(d.redemptions), net: Number(val(d.net_flow)), mkt: mkt == null ? null : Number(mkt) };
  });
  const body = rows.map((r, i) => `<tr${i > 0 ? ` class="clickable" data-bucket="${r.bucket}"` : ''}>
      <td class="mono">${i > 0 ? `<button type="button" class="link-btn mono" title="${t('aum_drill_row_title')}">${r.bucket}</button>` : r.bucket}</td>
      <td class="num">${idrFull(r.aum)}</td>
      <td class="num">${r.chg == null ? 'n/a' : `<span style="${tone(r.chg)}">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</span>`}</td>
      <td class="num">${signed(r.net)}</td>
      <td class="num">${signed(r.mkt)}</td>
      <td class="num">${idrFull(r.subs)}</td>
      <td class="num">${idrFull(r.reds)}</td>
      <td class="num">${idrFull(r.revenue)}</td>
      <td class="num">${num(r.funds)}</td>
    </tr>`).join('');
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const foot = `<tfoot><tr>
      <td>Total</td><td></td><td></td>
      <td class="num">${signed(sum('net'))}</td>
      <td class="num">${signed(sum('mkt'))}</td>
      <td class="num">${idrFull(sum('subs'))}</td>
      <td class="num">${idrFull(sum('reds'))}</td>
      <td class="num">${idrFull(sum('revenue'))}</td>
      <td></td>
    </tr></tfoot>`;
  $('#aumTable').innerHTML = `<table><thead><tr>
      <th data-key="bucket">Period</th><th class="num" data-key="aum">AUM</th><th class="num">Δ AUM</th><th class="num" data-key="net_flow">Net flow</th><th class="num" data-key="market_effect">Market effect</th>
      <th class="num" data-key="subscriptions">Subscriptions</th><th class="num" data-key="redemptions">Redemptions</th><th class="num" data-key="revenue">Revenue</th><th class="num" data-key="funds">Funds</th>
    </tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

// REVENUE TREND
let revTrendGran = 'month';
let revTrendLoaded = false;

async function loadRevenueTrend() {
  const r = currentRange();
  $('#revTrendTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  try {
    const data = await api(`/api/revenue-trend?from=${r.from}&to=${r.to}&granularity=${revTrendGran}`);
    revTrendLoaded = true;
    $('#revDrillPanel').classList.add('hidden');
    renderRevTrendChart(data);
    renderRevCauseChart(data);
    renderRevTrendTable(data);
    renderSeriesTrendFinding('#rvtFinding', data, 'revenue', 'Revenue');
  } catch (e) {
    $('#revTrendTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    showRevCauseMessage(e.message);
  }
}

function renderRevTrendChart(data) {
  paint('rvtChart', {
    type: 'bar',
    data: {
      labels: data.map((d) => val(d.bucket)),
      datasets: [{ label: t('col_revenue'), data: data.map((d) => val(d.revenue)), backgroundColor: C.amber, borderRadius: 4 }],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Revenue: ${idrFull(c.raw)}` } } },
    },
  });
}

const revSigned = (v) => (v == null ? 'n/a' : `<span style="color:${v >= 0 ? 'var(--pos-text)' : 'var(--neg-text)'}">${v >= 0 ? '+' : '-'}${idrFull(Math.abs(v))}</span>`);

function renderRevTrendTable(data) {
  if (!data.length) { $('#revTrendTable').innerHTML = `<div class="empty">${t('rev_trend_empty')}</div>`; return; }
  const n = (v) => (v == null ? null : Number(v));
  const rows = data.map((d) => ({ bucket: val(d.bucket), revenue: n(val(d.revenue)) || 0, chg: n(val(d.change_pct)), days: val(d.days),
    avgAum: val(d.avg_aum), de: n(val(d.days_effect)), ae: n(val(d.aum_effect)), re: n(val(d.rate_effect)) }));
  const body = rows.map((r, i) => `<tr${i > 0 ? ` class="clickable" data-bucket="${r.bucket}"` : ''}>
      <td class="mono">${i > 0 ? `<button type="button" class="link-btn mono" title="${t('rev_drill_row_title')}">${r.bucket}</button>` : r.bucket}</td>
      <td class="num">${idrFull(r.revenue)}</td>
      <td class="num">${r.chg == null ? 'n/a' : `<span style="color:${r.chg >= 0 ? 'var(--pos-text)' : 'var(--neg-text)'}">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</span>`}</td>
      <td class="num">${revSigned(r.de)}</td><td class="num">${revSigned(r.ae)}</td><td class="num">${revSigned(r.re)}</td>
      <td class="num">${idrFull(r.avgAum)}</td><td class="num">${num(r.days)}</td></tr>`).join('');
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  $('#revTrendTable').innerHTML = `<table><thead><tr><th data-key="bucket">Period</th><th class="num" data-key="revenue">Revenue</th><th class="num" data-key="change_pct">vs previous</th>
      <th class="num" data-key="days_effect">Days effect</th><th class="num" data-key="aum_effect">AUM effect</th><th class="num" data-key="rate_effect">Rate &amp; mix effect</th><th class="num" data-key="avg_aum">Avg AUM</th><th class="num" data-key="days">Days</th></tr></thead>
    <tbody>${body}</tbody><tfoot><tr><td>Total</td><td class="num">${idrFull(sum('revenue'))}</td><td></td>
      <td class="num">${revSigned(sum('de'))}</td><td class="num">${revSigned(sum('ae'))}</td><td class="num">${revSigned(sum('re'))}</td><td></td><td></td></tr></tfoot></table>`;
}

function showRevCauseMessage(msg) {
  $('#revCauseWrap').classList.toggle('hidden', !!msg);
  $('#revCauseEmpty').classList.toggle('hidden', !msg);
  $('#revCauseEmpty').textContent = msg || '';
}

function renderRevCauseChart(data) {
  const rows = data.slice(1); // first row has no prior period to explain
  showRevCauseMessage(rows.length ? '' : t('rev_cause_empty'));
  if (!rows.length) return;
  const bar = { borderRadius: 4, borderColor: C.surface, borderWidth: 2, stack: 'cause', order: 1 };
  const g = (k) => rows.map((d) => val(d[k]));
  paint('revCauseChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.bucket)),
      datasets: [
        { type: 'line', label: t('col_revenue_2'), data: rows.map((d) => Number(val(d.days_effect)) + Number(val(d.aum_effect)) + Number(val(d.rate_effect))),
          borderColor: C.ink, backgroundColor: C.ink, showLine: false, pointRadius: 4, stack: 'delta', order: 0 },
        { label: t('col_days_effect'), data: g('days_effect'), backgroundColor: C.muted, ...bar },
        { label: t('col_aum_effect'), data: g('aum_effect'), backgroundColor: C.indigo, ...bar },
        { label: t('col_rate_mix_effect'), data: g('rate_effect'), backgroundColor: C.amberMark, ...bar },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: C.grid }, ticks: { callback: (v) => idr(v) } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${idrFull(c.raw)}` } },
      },
    },
  });
}

// Bucket label -> the period's first day (month labels are YYYY-MM).
let revDrillParams = null;
async function loadRevDrill(bucket) {
  const r = currentRange();
  revDrillParams = { from: r.from, to: r.to, granularity: revTrendGran, period: revTrendGran === 'month' ? `${bucket}-01` : bucket };
  $('#revDrillPanel').classList.remove('hidden');
  $('#revDrillTitle').textContent = `${t('rev_drill_title')} ${bucket}`;
  $('#revDrillTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  $('#revDrillPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const q = new URLSearchParams(revDrillParams).toString();
    const rows = await api(`/api/revenue-trend/drill?${q}`);
    genTable('#revDrillTable', rows, [
      { key: 'fund', label: t('col_fund') }, { key: 'manager', label: t('col_investment_manager') },
      { key: 'revenue_prev', label: t('col_revenue_previous'), type: 'idr', sum: true }, { key: 'revenue_cur', label: t('col_revenue'), type: 'idr', sum: true },
      { key: 'change', label: t('col_revenue_2'), type: 'idr', sum: true },
      { key: 'days_effect', label: t('col_days_effect'), type: 'idr', sum: true }, { key: 'aum_effect', label: t('col_aum_effect'), type: 'idr', sum: true },
      { key: 'rate_effect', label: t('col_rate_mix_effect'), type: 'idr', sum: true },
    ], 'No fund moved in this period.');
  } catch (e) { $('#revDrillTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// PRODUCT PERFORMANCE (NAV % change per fund type, external Apollo DB)
const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', '10Y'];
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
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? 'n/a' : num(c.raw)}` } } },
    },
  });
}

async function loadPerformance() {
  $('#perfTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  try {
    perfCache = await api('/api/product-performance');
    renderPerformance(perfCache);
  } catch (e) { $('#perfTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderPerformance(rows) {
  if (!rows.length) { $('#perfTable').innerHTML = `<div class="empty">${t('msg_no_nav_data')}</div>`; return; }
  const byType = {};
  rows.forEach((r) => {
    const type = val(r.type);
    (byType[type] = byType[type] || {})[val(r.period)] = { pct: val(r.pct_change), funds: val(r.fund_count) };
  });
  const head = PERF_PERIODS.map((p) => `<th class="num">${p}</th>`).join('');
  const body = Object.keys(byType).sort().map((type) => {
    const cells = PERF_PERIODS.map((p) => {
      const c = byType[type][p];
      if (!c || c.pct == null) return '<td class="num">n/a</td>';
      const pct = Number(c.pct);
      return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span></td>`;
    }).join('');
    return `<tr><td>${type}</td>${cells}</tr>`;
  }).join('');
  $('#perfTable').innerHTML = `<table><thead><tr><th data-key="type">Fund type</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

let perfDetailCache = [];

async function loadPerformanceDetail() {
  $('#perfDetailTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  const asOf = $('#perfDetailAsOf').value;
  try {
    perfDetailCache = await api(`/api/product-performance/detail${asOf ? `?asOf=${asOf}` : ''}`);
    buildPerfTypeFilter(perfDetailCache);
    renderPerformanceDetail();
  } catch (e) { $('#perfDetailTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function buildPerfTypeFilter(rows) {
  const list = $('#perfTypeFilterList');
  if (list.children.length) return; // built once
  const types = [...new Set(rows.map((r) => val(r.type)))].sort();
  list.innerHTML = types.map((ty) =>
    `<label class="ask-table-chk"><input type="checkbox" value="${ty}"> ${ty}</label>`).join('');
}

// None checked = no filter (show every type) — mirrors the old select's
// blank "All fund types" default. Button label shows the pick count.
function updatePerfTypeFilterBtn() {
  const n = $$('#perfTypeFilterList input:checked').length;
  $('#perfTypeFilterBtn').textContent = n ? `${n} type${n === 1 ? '' : 's'} picked` : t('common_all_fund_types');
}

// Live best/worst headline for whatever funds are currently filtered —
// 1-month return, the shortest period with enough history to mean anything
// but not so short it's just daily noise. Falls back to 1D if too few funds
// have a full month of NAV history yet.
function renderPerfDetailFinding(funds) {
  const el = $('#perfDetailFinding');
  const period = funds.filter((f) => f['1M'] != null).length >= 2 ? '1M' : '1D';
  const withPct = funds.filter((f) => f[period] != null);
  if (withPct.length < 2) { el.hidden = true; return; }
  const best = withPct.reduce((a, b) => (Number(b[period]) > Number(a[period]) ? b : a));
  const worst = withPct.reduce((a, b) => (Number(b[period]) < Number(a[period]) ? b : a));
  el.className = 'trend-finding';
  el.innerHTML = `Best ${period}: <span style="color:var(--teal)">${best.name} +${Number(best[period]).toFixed(2)}%</span>` +
    ` &nbsp;·&nbsp; Worst ${period}: <span style="color:var(--rose)">${worst.name} ${Number(worst[period]).toFixed(2)}%</span>`;
  el.hidden = false;
}

// pivot flat (type, name, period, pct_change) rows into one row per fund
function pivotByFund(rows) {
  const byFund = {};
  rows.forEach((r) => {
    const name = val(r.name), type = val(r.type);
    const key = type + '||' + name;
    const f = (byFund[key] = byFund[key] || { name, type, nav: val(r.latest_nav), navDate: val(r.latest_nav_date), ipoDate: val(r.ipo_date) });
    f[val(r.period)] = val(r.pct_change);
  });
  return Object.values(byFund);
}

function renderPerformanceDetail() {
  const pickedTypes = $$('#perfTypeFilterList input:checked').map((el) => el.value);
  const search = $('#perfDetailSearch').value.trim().toLowerCase();
  const rows = pickedTypes.length ? perfDetailCache.filter((r) => pickedTypes.includes(val(r.type))) : perfDetailCache;
  const funds = pivotByFund(rows)
    .filter((f) => !search || f.name.toLowerCase().includes(search))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  // Surfaces the real NAV date behind these numbers — not "today", since NAV
  // can lag — so it's obvious what date is about to go on an export/PDF.
  const latestDate = funds.reduce((max, f) => (f.navDate && (!max || f.navDate > max) ? f.navDate : max), null);
  $('#perfDetailAsOfInfo').textContent = latestDate
    ? `Showing NAV as of ${latestDate}${$('#perfDetailAsOf').value ? ' (most recent on or before the date picked above)' : ' (latest available)'}.`
    : '';
  if (!funds.length) { $('#perfDetailTable').innerHTML = `<div class="empty">${t('msg_no_matching_fund')}</div>`; $('#perfDetailFinding').hidden = true; return; }
  renderPerfDetailFinding(funds);
  const head = PERF_PERIODS.map((p) => `<th class="num">${p}</th>`).join('');
  const body = funds.map((f) => {
    const cells = PERF_PERIODS.map((p) => {
      const pct = f[p];
      if (pct == null) return '<td class="num">n/a</td>';
      return `<td class="num"><span style="color:${pct >= 0 ? 'var(--teal)' : 'var(--rose)'}">${pct >= 0 ? '+' : ''}${Number(pct).toFixed(2)}%</span></td>`;
    }).join('');
    const ipoDate = f.ipoDate ? String(f.ipoDate).slice(0, 10) : 'n/a';
    return `<tr><td>${f.name}</td><td><span class="tag other">${f.type}</span></td><td>${ipoDate}</td><td class="num">${num(f.nav)}</td>${cells}</tr>`;
  }).join('');
  $('#perfDetailTable').innerHTML = `<table><thead><tr><th data-key="name">Fund</th><th>Type</th><th>Tanggal Emisi</th><th class="num">NAV</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// GROWTH (campaigns, referrals, switching, manager/demographic AUM)
let growthLoaded = false;
// Columns flagged `sum: true` get a Total row at the bottom. Only flag
// columns that add up across rows: money and counts per fund/period, not
// averages, rates, dates, or investor counts that overlap between rows.
function genTable(sel, rows, cols, emptyMsg, sortState) {
  if (!rows.length) { $(sel).innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
  const numTypes = ['idr', 'idrx', 'num', 'pct', 'delta'];
  const td = (c, v) => {
    let out = v == null ? 'n/a' : safeCell(v);
    if (c.type === 'idr') out = idrFull(v);
    if (c.type === 'idrx') out = idrExact(v);
    if (c.type === 'num') out = num(v);
    if (c.type === 'pct') out = v == null ? 'n/a' : `${Number(v).toFixed(1)}%`;
    if (c.type === 'date') out = v == null ? 'n/a' : String(v).slice(0, 10);
    // delta: signed difference from a target, green at or above it, red below.
    if (c.type === 'delta') out = v == null ? '' : (v > 0 ? '+' : '') + num(v);
    // c.fmt: draw the cell yourself (a signed net flow in red/green), last so
    // it wins; c.type still supplies the column class and the footer sum.
    if (c.fmt) out = c.fmt(v);
    const tone = c.type === 'delta' && v != null ? (v < 0 ? ' neg' : ' pos') : '';
    // c.text: keep the cell text in the XLSX export (phone 0812..., SID, timestamps).
    return `<td class="${numTypes.includes(c.type) ? 'num' : ''}${tone}"${c.text ? ' data-t="s"' : ''}>${out}</td>`;
  };
  // c.sort (true, or the server column name) makes the header a server sort
  // control, see TABLE SORT; the arrow is drawn by CSS from aria-sort so it
  // never lands in copied or exported text. Other headers sort on the page.
  const head = cols.map((c) => {
    const cls = numTypes.includes(c.type) ? 'num' : '';
    if (!c.sort) return `<th class="${cls}" data-key="${c.key}">${c.label}</th>`;
    const first = numTypes.includes(c.type) || c.type === 'date' ? 'desc' : 'asc';
    return sortTh(c.label, typeof c.sort === 'string' ? c.sort : c.key, sortState, cls, first);
  }).join('');
  const body = rows.map((r) => '<tr>' + cols.map((c) => td(c, val(r[c.key]))).join('') + '</tr>').join('');
  const foot = cols.some((c) => c.sum)
    ? '<tfoot><tr>' + cols.map((c, i) => (c.sum
      ? td(c, rows.reduce((a, r) => a + (Number(val(r[c.key])) || 0), 0))
      : `<td>${i === 0 ? 'Total' : ''}</td>`)).join('') + '</tr></tfoot>'
    : '';
  $(sel).innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

async function loadGrowth() {
  const pCamp = api('/api/campaigns/performance');
  pCamp.then((rows) => genTable('#campTable', rows, [
    { key: 'name', label: t('col_campaign') }, { key: 'campaign_type', label: t('col_type') },
    { key: 'promo_code', label: 'Promo' }, { key: 'quota', label: t('col_quota'), type: 'num' },
    { key: 'used_quota', label: t('col_used'), type: 'num' }, { key: 'redemption_pct', label: 'Redemption', type: 'pct' },
    { key: 'bonus_amount', label: 'Bonus/redemption', type: 'idr' }, { key: 'est_cost', label: t('col_est_cost'), type: 'idr' },
  ], 'No campaigns in this range, widen the date filter.')).catch((e) => $('#campTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  const pRef = api('/api/referrals/top');
  pRef.then((rows) => genTable('#refTable', rows, [
    { key: 'referral_code', label: t('col_code') }, { key: 'referrer', label: t('col_referrer') },
    { key: 'referred_count', label: t('col_referred'), type: 'num' }, { key: 'referred_volume', label: t('col_volume_brought'), type: 'idr' },
  ], 'No referrals yet.')).catch((e) => $('#refTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  const pSwitch = api('/api/switching/top-pairs');
  pSwitch.then((rows) => genTable('#switchTable', rows, [
    { key: 'from_fund', label: t('col_from_fund') }, { key: 'to_fund', label: t('col_to_fund') },
    { key: 'switches', label: t('col_switches'), type: 'num' }, { key: 'amount', label: t('col_amount'), type: 'idr' },
  ], 'No switching transactions.')).catch((e) => $('#switchTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  const pManager = api('/api/funds/by-manager');
  pManager.then((rows) => doughnut('managerChart', rows, 'label', 'aum', idrFull)).catch((e) => showFail('managerChart', e));

  const pRisk = api('/api/users/aum-by-risk');
  pRisk.then((rows) => doughnut('riskChart', rows, 'label', 'aum', idrFull)).catch((e) => showFail('riskChart', e));

  const pIncome = api('/api/users/aum-by-income');
  pIncome.then((rows) => {
    const total = rows.reduce((a, r) => a + (Number(val(r.aum)) || 0), 0);
    genTable('#incomeTable', rows.map((r) => ({ ...r, share: total ? Number(val(r.aum)) / total * 100 : null })), [
      { key: 'label', label: t('col_income_bracket') }, { key: 'investors', label: t('col_investors'), type: 'num', sum: true },
      { key: 'aum', label: 'AUM', type: 'idr', sum: true }, { key: 'share', label: t('col_of_aum'), type: 'pct', sum: true },
    ], 'No data.');
  }).catch((e) => $('#incomeTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`);

  gateTabLoad((v) => { growthLoaded = v; }, [pCamp, pRef, pSwitch, pManager, pRisk, pIncome]);
}

// RECONCILIATION (app ledger vs custodian feed)
// Different shape from the trend panels above — there's no "first vs last"
// here, the real question is "how much is actually off right now" — so this
// reports a live discrepancy total instead of a % change.
function renderReconciliationFinding(rows) {
  const el = $('#recTrendFinding');
  if (!rows.length) { el.hidden = true; return; }
  const totalDiff = rows.reduce((s, r) => s + Math.abs(Number(val(r.amount_diff)) || 0), 0);
  const flagged = rows.filter((r) => Math.abs(Number(val(r.amount_diff)) || 0) > 0).length;
  if (flagged === 0) {
    el.className = 'trend-finding up';
    el.textContent = `No discrepancies in this range, ${rows.length} rows checked, all reconciled.`;
  } else {
    el.className = 'trend-finding down';
    el.textContent = `${flagged} of ${rows.length} rows show a discrepancy, totalling ${idrFull(totalDiff)}.`;
  }
  el.hidden = false;
}

async function loadReconciliation() {
  const r = currentRange();
  $('#recTable').innerHTML = '<div class="loading">Comparing ledgers…</div>';
  try {
    const rows = await api(`/api/reconciliation?from=${r.from}&to=${r.to}`);
    genTable('#recTable', rows, [
      { key: 'bucket', label: t('col_date') },
      { key: 'type', label: t('col_type') },
      { key: 'app_count', label: t('col_app_tx'), type: 'num' }, { key: 'app_amount', label: t('col_app_amount'), type: 'idr' },
      { key: 'sinvest_count', label: t('col_custodian_tx'), type: 'num' }, { key: 'sinvest_amount', label: t('col_custodian_amount'), type: 'idr' },
      { key: 'amount_diff', label: t('col_diff'), type: 'idr' },
    ], 'No data in this range.');
    renderReconciliationFinding(rows);
  } catch (e) {
    $('#recTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#recTrendFinding').hidden = true;
  }
}

// REVENUE (management fee earned per fund/month)
function renderRevenueTrend(rows, chartId = 'revTrendChart') {
  if (!rows.length) return;
  paint(chartId, {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.period)),
      datasets: [
        { label: t('col_aperd_share'), data: rows.map((d) => Number(val(d.total_aperd_share))), backgroundColor: C.teal, borderRadius: 4, stack: 'fee', order: 2 },
        { label: t('col_mi_share'), data: rows.map((d) => Number(val(d.total_mi_share))), backgroundColor: C.amber, borderRadius: 4, stack: 'fee', order: 2 },
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
    renderSeriesTrendFinding('#revTrendFinding', summary, 'total_management_fee', 'Management fee revenue');
    genTable('#revDetailTable', detail, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'fund_name', label: t('col_fund') }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'mi_name', label: t('col_investment_manager_2') },
      { key: 'management_fee', label: t('col_mgmt_fee_rate'), type: 'num' },
      { key: 'aperd_share', label: t('col_aperd_share'), type: 'num' }, { key: 'mi_share', label: t('col_mi_share'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' }, { key: 'aum_eom', label: t('col_aum_eom'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No revenue in this range.');
    genTable('#revSummaryTable', summary, [
      { key: 'period', label: t('col_period'), type: 'date' }, { key: 'funds', label: t('col_funds'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'total_aum', label: t('col_total_aum_eom'), type: 'idr' }, { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#revDetailTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#revSummaryTable').innerHTML = '';
    $('#revTrendFinding').hidden = true;
  }
}

// REVENUE v2 (same calculation as Revenue above, AUM from goal_snapshots)
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
    renderSeriesTrendFinding('#rev2TrendFinding', summary, 'total_management_fee', 'Management fee revenue');
    genTable('#rev2DetailTable', detail, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'fund_name', label: t('col_fund') }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'mi_name', label: t('col_investment_manager_2') },
      { key: 'management_fee', label: t('col_mgmt_fee_rate'), type: 'num' },
      { key: 'aperd_share', label: t('col_aperd_share'), type: 'num' }, { key: 'mi_share', label: t('col_mi_share'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' }, { key: 'aum_eom', label: t('col_aum_eom'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No revenue in this range.');
    genTable('#rev2SummaryTable', summary, [
      { key: 'period', label: t('col_period'), type: 'date' }, { key: 'funds', label: t('col_funds'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'total_aum', label: t('col_total_aum_eom'), type: 'idr' }, { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#rev2DetailTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#rev2SummaryTable').innerHTML = '';
    $('#rev2TrendFinding').hidden = true;
  }
}

// USER LIFETIME (Revenue (PWC) math per investor + lifetime dates)
let ulGran = 'month';
let ulLoaded = false;
let ulSelected = null; // { sid, name }, used by the drill-down + its exports

function renderUlTrend(rows) {
  if (!rows.length) return;
  paint('ulTrendChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.period)),
      datasets: [
        { label: t('col_aperd_share'), data: rows.map((d) => Number(val(d.total_aperd_share))), backgroundColor: C.teal, borderRadius: 4, order: 2 },
        { label: t('col_investors'), data: rows.map((d) => Number(val(d.investors))), type: 'line', yAxisID: 'y1',
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
  { key: 'sid_code', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
  { key: 'registered_at', label: t('col_registered'), type: 'date' },
  { key: 'first_buy', label: t('col_first_buy'), type: 'date' },
  { key: 'last_tx', label: t('col_last_transaction'), type: 'date' },
  { key: 'account_age_days', label: t('col_account_age_d'), type: 'num' },
  { key: 'days_to_first_buy', label: t('col_days_to_first_buy'), type: 'num' },
  { key: 'tx_span_days', label: t('col_transacting_span_d'), type: 'num' },
  { key: 'holding_lifetime_days', label: t('col_holding_lifetime_d'), type: 'num' },
  { key: 'tx_count', label: t('col_transactions'), type: 'num' },
  { key: 'total_invested', label: t('col_lifetime_invested'), type: 'idr' },
  { key: 'first_hold', label: t('col_first_hold_feed'), type: 'date' },
  { key: 'last_hold', label: t('col_last_hold_feed'), type: 'date' },
  { key: 'active_days', label: t('col_days_in_range'), type: 'num' },
  { key: 'funds', label: t('col_funds'), type: 'num' },
  { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' }, { key: 'last_aum', label: t('col_latest_aum'), type: 'idr' },
  { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr' },
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
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'fund_name', label: t('col_fund') }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'mi_name', label: t('col_investment_manager_2') },
      { key: 'management_fee', label: t('col_mgmt_fee_rate'), type: 'num' },
      { key: 'days_running', label: t('col_days'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' }, { key: 'aum_eop', label: t('col_aum_end_of_period_2'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No holdings for this investor in this range.');
  } catch (e) { $('#ulDetailTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

async function loadUserLifetime() {
  const r = ulRange();
  ulSelected = null;
  $('#ulDetailPanel').classList.add('hidden');
  $('#ulUsersTable').innerHTML = '<div class="loading">Computing per-investor revenue…</div>';
  $('#ulSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#ulTrendFinding').hidden = true;
  const qs = `from=${r.from}&to=${r.to}&fund=${encodeURIComponent(r.fund)}&mi=${encodeURIComponent(r.mi)}`;
  const ulFetch = Promise.all([
    api(`/api/user-lifetime?${qs}&sid=${encodeURIComponent(r.sid)}&limit=${r.limit}`),
    api(`/api/user-lifetime/summary?${qs}&granularity=${ulGran}`),
  ]);
  gateTabLoad((v) => { ulLoaded = v; }, [ulFetch]);
  try {
    const [users, summary] = await ulFetch;
    renderUlTrend(summary);
    renderSeriesTrendFinding('#ulTrendFinding', summary, 'total_aperd_share', 'AperD revenue');
    renderUlUsers(users);
    genTable('#ulSummaryTable', summary, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'investors', label: t('col_investors'), type: 'num' },
      { key: 'days_running', label: t('col_days'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' },
      { key: 'aperd_per_investor', label: 'AperD per investor', type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#ulUsersTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#ulSummaryTable').innerHTML = '';
  }
}

// CAMPAIGN REVENUE (management fee earned on promo-locked units)
let crGran = 'month';
let crLoaded = false;

function renderCrTrend(rows) {
  if (!rows.length) return;
  paint('crTrendChart', {
    type: 'bar',
    data: {
      labels: rows.map((d) => val(d.period)),
      datasets: [
        { label: t('col_aperd_share'), data: rows.map((d) => Number(val(d.total_aperd_share))), backgroundColor: C.teal, borderRadius: 4, order: 2 },
        { label: t('col_aperd_share_alt'), data: rows.map((d) => Number(val(d.total_aperd_share_alt))), backgroundColor: C.amber, borderRadius: 4, order: 2 },
        { label: t('col_locked_aum'), data: rows.map((d) => Number(val(d.avg_aum))), type: 'line', yAxisID: 'y1',
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
  $('#crTrendFinding').hidden = true;
  const qs = `from=${r.from}&to=${r.to}&promo=${encodeURIComponent(r.promo)}`;
  const crFetch = Promise.all([
    api(`/api/campaign-revenue/campaigns?${qs}`),
    api(`/api/campaign-revenue?${qs}&granularity=${crGran}`),
    api(`/api/campaign-revenue/summary?${qs}&granularity=${crGran}`),
  ]);
  gateTabLoad((v) => { crLoaded = v; }, [crFetch]);
  try {
    const [campaigns, detail, summary] = await crFetch;
    renderCrTrend(summary);
    renderSeriesTrendFinding('#crTrendFinding', summary, 'total_aperd_share', 'AperD revenue');
    genTable('#crCampaignsTable', campaigns, [
      { key: 'promo_code', label: 'Promo' }, { key: 'campaign_name', label: t('col_campaign') },
      { key: 'campaign_type', label: t('col_type') },
      { key: 'start_date', label: t('col_starts'), type: 'date' }, { key: 'end_date', label: t('col_ends'), type: 'date' },
      { key: 'holding_date', label: t('col_holding_until'), type: 'date' },
      { key: 'participations', label: t('col_participations'), type: 'num', sum: true },
      { key: 'investors', label: t('col_investors'), type: 'num' },
      { key: 'still_locked', label: t('col_still_locked'), type: 'num', sum: true },
      { key: 'funds', label: t('col_funds'), type: 'num' },
      { key: 'first_lock', label: t('col_first_lock'), type: 'date' },
      { key: 'days_running', label: t('col_days'), type: 'num' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true },
      { key: 'total_aperd_share_alt', label: 'Total AperD (alt)', type: 'idr', sum: true },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
      { key: 'est_cost', label: t('col_est_cost'), type: 'idr', sum: true },
      { key: 'net_vs_cost', label: t('col_net_vs_cost'), type: 'idr', sum: true },
    ], 'No campaign holdings in this range.');
    genTable('#crDetailTable', detail, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'promo_code', label: 'Promo' }, { key: 'campaign_name', label: t('col_campaign') },
      { key: 'participations', label: t('col_participations'), type: 'num' },
      { key: 'investors', label: t('col_investors'), type: 'num' },
      { key: 'still_locked', label: t('col_still_locked'), type: 'num' },
      { key: 'funds', label: t('col_funds'), type: 'num' },
      { key: 'days_running', label: t('col_days'), type: 'num' },
      { key: 'avg_units', label: t('col_avg_units'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_locked_aum'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true },
      { key: 'total_aperd_share_alt', label: 'Total AperD (alt)', type: 'idr', sum: true },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No campaign holdings in this range.');
    genTable('#crSummaryTable', summary, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'campaigns', label: t('col_campaigns'), type: 'num' },
      { key: 'participations', label: t('col_participations'), type: 'num' },
      { key: 'investors', label: t('col_investors'), type: 'num' },
      { key: 'days_running', label: t('col_days'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_locked_aum'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true },
      { key: 'total_aperd_share_alt', label: 'Total AperD (alt)', type: 'idr', sum: true },
      { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
    ], 'No campaign holdings in this range.');
  } catch (e) {
    $('#crCampaignsTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#crDetailTable').innerHTML = '';
    $('#crSummaryTable').innerHTML = '';
  }
}

// REFERRAL PROGRAM (Sep-Dec 2026 T&C eligibility report)
let refProgLoaded = false;

function refProgRange() {
  return { from: $('#refProgFrom').value || '2026-09-01', to: $('#refProgTo').value || '2026-12-31' };
}

async function loadReferralProgram() {
  $('#refProgTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#refProgLeaderboardTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#refProgInvitedTable').innerHTML = '<div class="loading">Loading…</div>';
  const r = refProgRange();
  const refProgFetch = Promise.all([
    api(`/api/referral-program/detail?from=${r.from}&to=${r.to}`),
    api(`/api/referral-program/inviter-stats?from=${r.from}&to=${r.to}`),
    api(`/api/referral-program/invited?from=${r.from}&to=${r.to}`),
  ]);
  gateTabLoad((v) => { refProgLoaded = v; }, [refProgFetch]);
  try {
    const [rows, stats, invited] = await refProgFetch;
    renderReferralProgram(rows, stats, invited);
  } catch (e) {
    $('#refProgKpis').innerHTML = '';
    $('#refProgTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#refProgLeaderboardTable').innerHTML = '';
    $('#refProgInvitedTable').innerHTML = '';
  }
}

// Groups the detail rows (one per qualifying invitee, from computeReferralEligibility)
// by inviter, then merges in the broader invited/transacted counts from
// inviter-stats — "invited"/"transacted" cover every referral regardless of
// product/amount, while qualifying/pending/eligible only cover invitees whose
// first-ever transaction met the campaign's own rule.
function buildReferralLeaderboard(rows, stats) {
  const bySid = new Map();
  stats.forEach((s) => {
    const sid = val(s.inviter_sid);
    if (!sid) return;
    bySid.set(sid, {
      inviter_sid: sid, inviter_referral_code: val(s.inviter_referral_code), inviter_name: val(s.inviter_name),
      invited: Number(val(s.invited_count)) || 0, transacted: Number(val(s.transacted_count)) || 0,
      qualifying: 0, pending: 0, eligible: 0, not_eligible: 0,
    });
  });
  rows.forEach((r) => {
    const sid = val(r.inviter_sid);
    if (!sid) return;
    if (!bySid.has(sid)) {
      bySid.set(sid, { inviter_sid: sid, inviter_referral_code: null, inviter_name: val(r.inviter_name), invited: 0, transacted: 0, qualifying: 0, pending: 0, eligible: 0, not_eligible: 0 });
    }
    const row = bySid.get(sid);
    row.qualifying += 1;
    if (r.status === 'Eligible') row.eligible += 1;
    else if (r.status === 'Pending') row.pending += 1;
    else row.not_eligible += 1;
  });
  return [...bySid.values()].sort((a, b) => b.qualifying - a.qualifying || b.invited - a.invited);
}

// Shared by both Referral program and Referral Program (kyc based) — same KPI/
// detail/leaderboard shape, different data source (see loadReferralProgram
// vs loadReferralProgramAlt). `sel` picks which section's DOM ids to fill.
function renderReferralProgram(rows, stats, invited, sel = { kpis: '#refProgKpis', table: '#refProgTable', leaderboard: '#refProgLeaderboardTable', invited: '#refProgInvitedTable' }) {
  const eligible = rows.filter((r) => r.status === 'Eligible').length;
  const pending = rows.filter((r) => r.status === 'Pending').length;
  const notEligible = rows.filter((r) => r.status === 'Not eligible').length;
  const inviters = new Set(rows.map((r) => val(r.inviter_sid)).filter(Boolean)).size;
  const bonusTotal = eligible * 50000; // Rp25,000 to inviter + Rp25,000 to invitee, per eligible referral.
  $(sel.kpis).innerHTML = [
    kpi(t('refprog_kpi_inviters'), num(inviters), '', '', ICONS.users),
    kpi(t('refprog_kpi_invitees'), num(rows.length), '', '', ICONS.user),
    kpi(t('refprog_kpi_eligible'), num(eligible), '', 'accent', ICONS.check),
    kpi(t('refprog_kpi_pending'), num(pending), '', 'amber', ICONS.hourglass),
    kpi(t('refprog_kpi_not_eligible'), num(notEligible), '', 'warn', ICONS.xCircle),
    kpi(t('refprog_kpi_bonus_total'), idr(bonusTotal), t('refprog_kpi_bonus_total_sub'), 'accent', ICONS.coin),
  ].join('');

  genTable(sel.table, rows, [
    { key: 'inviter_sid', label: t('col_inviter_sid') }, { key: 'inviter_name', label: t('col_inviter_name') },
    { key: 'inviter_ifua', label: t('col_inviter_ifua') }, { key: 'inviter_email', label: t('col_inviter_email') },
    { key: 'inviter_phone', label: t('col_inviter_phone') },
    { key: 'invitee_sid', label: t('col_invitee_sid') }, { key: 'invitee_name', label: t('col_invitee_name') },
    { key: 'invitee_ifua', label: t('col_invitee_ifua') }, { key: 'invitee_email', label: t('col_invitee_email') },
    { key: 'invitee_phone', label: t('col_invitee_phone') },
    { key: 'fund_name', label: t('col_fund') }, { key: 'amount', label: t('col_amount'), type: 'idr' },
    { key: 'tx_date', label: t('col_transaction_date'), type: 'date' }, { key: 'days_held', label: t('col_days_held'), type: 'num' },
    { key: 'baseline_unit', label: t('col_baseline_units'), type: 'num' }, { key: 'min_unit_in_window', label: t('col_min_units_seen'), type: 'num' },
    { key: 'status', label: 'Status' }, { key: 'reason', label: t('col_reason') },
  ], 'No qualifying referrals in this period.');

  genTable(sel.leaderboard, buildReferralLeaderboard(rows, stats), [
    { key: 'inviter_sid', label: t('col_inviter_sid') }, { key: 'inviter_name', label: t('col_inviter_name') },
    { key: 'inviter_referral_code', label: t('col_referral_code') },
    { key: 'invited', label: t('col_invited'), type: 'num' },
    { key: 'transacted', label: t('col_transacted'), type: 'num' },
    { key: 'qualifying', label: t('col_transacted_rp1jt'), type: 'num' },
    { key: 'pending', label: t('col_pending'), type: 'num' },
    { key: 'eligible', label: t('col_eligible'), type: 'num' },
    { key: 'not_eligible', label: t('col_not_eligible'), type: 'num' },
  ], 'No referral activity in this period.');

  genTable(sel.invited, invited, [
    { key: 'inviter_sid', label: t('col_inviter_sid') }, { key: 'inviter_name', label: t('col_inviter_name') },
    { key: 'invitee_name', label: t('col_name') }, { key: 'invitee_created_at', label: t('col_created_at'), type: 'date' },
    { key: 'invitee_verified_at', label: t('col_verified_at'), type: 'date' },
    { key: 'invitee_sid', label: 'SID' }, { key: 'invitee_email', label: 'Email' },
    { key: 'invitee_phone', label: t('col_phone_number') },
    { key: 'invitee_referral_code', label: t('col_referral_code') }, { key: 'inviter_referral_code', label: t('col_referrer_code') },
    { key: 'kyc_status', label: t('col_kyc_status') }, { key: 'transaction_status', label: t('col_transaction_status') },
  ], 'No invited users in this period.');
}

// REFERRAL PROGRAM (ALT.) — same eligibility/detail rows as the section
// above, but a looser leaderboard (see queries.js:referralInviterStatsAlt):
// "Invited" doesn't require the invitee to have registered in the period,
// only that their first-ever transaction (if any) isn't already outside it.
let refProgAltLoaded = false;

function refProgAltRange() {
  return { from: $('#refProgAltFrom').value || '2026-09-01', to: $('#refProgAltTo').value || '2026-12-31' };
}

async function loadReferralProgramAlt() {
  $('#refProgAltTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#refProgAltLeaderboardTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#refProgAltInvitedTable').innerHTML = '<div class="loading">Loading…</div>';
  const r = refProgAltRange();
  const refProgAltFetch = Promise.all([
    api(`/api/referral-program-alt/detail?from=${r.from}&to=${r.to}`),
    api(`/api/referral-program-alt/inviter-stats?from=${r.from}&to=${r.to}`),
    api(`/api/referral-program-alt/invited?from=${r.from}&to=${r.to}`),
  ]);
  gateTabLoad((v) => { refProgAltLoaded = v; }, [refProgAltFetch]);
  try {
    const [rows, stats, invited] = await refProgAltFetch;
    renderReferralProgram(rows, stats, invited, { kpis: '#refProgAltKpis', table: '#refProgAltTable', leaderboard: '#refProgAltLeaderboardTable', invited: '#refProgAltInvitedTable' });
  } catch (e) {
    $('#refProgAltKpis').innerHTML = '';
    $('#refProgAltTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#refProgAltLeaderboardTable').innerHTML = '';
    $('#refProgAltInvitedTable').innerHTML = '';
  }
}

// REMISIER SHARING (goal_snapshots — one remisier's users, AperD share
// split between remisier and Sayakaya)
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
  if (!p.code) { toast(t('msg_enter_a_remisier_code_first')); return; }
  $('#remUsersTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#remDetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#remSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#remSummaryFinding').hidden = true;
  const qs = `field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}&from=${p.from}&to=${p.to}&granularity=${p.granularity}&portion=${p.portion}`;
  try {
    const [users, detail, summary] = await Promise.all([
      api(`/api/remisier/users?field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}`),
      api(`/api/remisier/revenue?${qs}`),
      api(`/api/remisier/revenue/summary?${qs}`),
    ]);
    renderSeriesTrendFinding('#remSummaryFinding', summary, 'total_remisier_fee_net', 'Remisier fee (net)');
    genTable('#remUsersTable', users, [
      { key: 'sid', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
      { key: 'referrer_code', label: t('col_referrer_code') }, { key: 'sales_code', label: t('col_sales_code') },
    ], 'No users under this remisier code.');
    genTable('#remDetailTable', detail, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'sid', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
      { key: 'fund_name', label: t('col_fund') }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'management_fee', label: t('col_mgmt_fee_rate'), type: 'num' },
      { key: 'aperd_share', label: t('col_aperd_share'), type: 'num' }, { key: 'mi_share', label: t('col_mi_share'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_aum'), type: 'idr' }, { key: 'aum_eom', label: t('col_aum_eop'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
      { key: 'total_remisier_fee', label: t('col_remisier_fee_gross'), type: 'idr', sum: true },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idr', sum: true }, { key: 'total_remisier_fee_net', label: t('col_remisier_fee_net'), type: 'idr', sum: true },
      { key: 'total_sayakaya_fee', label: t('col_sayakaya_fee'), type: 'idr', sum: true },
    ], 'No revenue in this range.');
    genTable('#remSummaryTable', summary, [
      { key: 'period', label: t('col_period'), type: 'date' }, { key: 'funds', label: t('col_funds'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'total_aum', label: t('col_total_aum_eop'), type: 'idr' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idr', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idr', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idr', sum: true },
      { key: 'total_remisier_fee', label: t('col_remisier_fee_gross'), type: 'idr', sum: true },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idr', sum: true }, { key: 'total_remisier_fee_net', label: t('col_remisier_fee_net'), type: 'idr', sum: true },
      { key: 'total_sayakaya_fee', label: t('col_sayakaya_fee'), type: 'idr', sum: true },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#remUsersTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#remDetailTable').innerHTML = '';
    $('#remSummaryTable').innerHTML = '';
  }
}

// REMISIER SHARING (portfolio_with_code — same math, AUM from the
// original Revenue tab's source instead of goal_snapshots)
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
  if (!p.code) { toast(t('msg_enter_a_remisier_code_first')); return; }
  $('#remPwcUsersTable').innerHTML = '<div class="loading">Loading…</div>';
  $('#remPwcDetailTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#remPwcSummaryTable').innerHTML = '<div class="loading">Computing revenue…</div>';
  $('#remPwcSummaryFinding').hidden = true;
  const qs = `field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}&from=${p.from}&to=${p.to}&granularity=${p.granularity}&portion=${p.portion}`;
  try {
    const [users, detail, summary] = await Promise.all([
      api(`/api/remisier/users?field=${encodeURIComponent(p.field)}&code=${encodeURIComponent(p.code)}`),
      api(`/api/remisier/revenue-pwc?${qs}`),
      api(`/api/remisier/revenue-pwc/summary?${qs}`),
    ]);
    renderSeriesTrendFinding('#remPwcSummaryFinding', summary, 'total_remisier_fee_net', 'Remisier fee (net)');
    genTable('#remPwcUsersTable', users, [
      { key: 'sid', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
      { key: 'referrer_code', label: t('col_referrer_code') }, { key: 'sales_code', label: t('col_sales_code') },
    ], 'No users under this remisier code.');
    genTable('#remPwcDetailTable', detail, [
      { key: 'period', label: t('col_period'), type: 'date' },
      { key: 'sid', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
      { key: 'fund_name', label: t('col_fund') }, { key: 'sinvest_code', label: 'Sinvest code' },
      { key: 'management_fee', label: t('col_mgmt_fee_rate'), type: 'num' },
      { key: 'aperd_share', label: t('col_aperd_share'), type: 'num' }, { key: 'mi_share', label: t('col_mi_share'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'avg_aum', label: t('col_avg_aum'), type: 'idrx' }, { key: 'aum_eom', label: t('col_aum_eop'), type: 'idrx' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idrx', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idrx', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idrx', sum: true },
      { key: 'total_remisier_fee', label: t('col_remisier_fee_gross'), type: 'idrx', sum: true },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idrx', sum: true }, { key: 'total_remisier_fee_net', label: t('col_remisier_fee_net'), type: 'idrx', sum: true },
      { key: 'total_sayakaya_fee', label: t('col_sayakaya_fee'), type: 'idrx', sum: true },
    ], 'No revenue in this range.');
    genTable('#remPwcSummaryTable', summary, [
      { key: 'period', label: t('col_period'), type: 'date' }, { key: 'funds', label: t('col_funds'), type: 'num' },
      { key: 'days_running', label: t('col_days_running'), type: 'num' },
      { key: 'total_aum', label: t('col_total_aum_eop'), type: 'idrx' },
      { key: 'total_management_fee', label: t('col_total_mgmt_fee'), type: 'idrx', sum: true },
      { key: 'total_aperd_share', label: 'Total AperD', type: 'idrx', sum: true }, { key: 'total_mi_share', label: 'Total MI', type: 'idrx', sum: true },
      { key: 'total_remisier_fee', label: t('col_remisier_fee_gross'), type: 'idrx', sum: true },
      { key: 'total_remisier_pph', label: 'PPh 2.5%', type: 'idrx', sum: true }, { key: 'total_remisier_fee_net', label: t('col_remisier_fee_net'), type: 'idrx', sum: true },
      { key: 'total_sayakaya_fee', label: t('col_sayakaya_fee'), type: 'idrx', sum: true },
    ], 'No revenue in this range.');
  } catch (e) {
    $('#remPwcUsersTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    $('#remPwcDetailTable').innerHTML = '';
    $('#remPwcSummaryTable').innerHTML = '';
  }
}

// nested: remisier transactions (per-transaction detail, own filters) --
const remTx = { limit: 100, offset: 0, total: 0, sort: null };

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
    ...sortParams(remTx.sort),
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
  if (!p.referrerCodes.length && !p.salesCodes.length) { toast(t('msg_enter_at_least_one_referrer_code_or_sale')); return; }
  $('#remTxTable').innerHTML = '<div class="loading">Loading…</div>';
  const qs = new URLSearchParams();
  p.referrerCodes.forEach((c) => qs.append('referrerCodes', c));
  p.salesCodes.forEach((c) => qs.append('salesCodes', c));
  if (p.type) qs.set('type', p.type);
  if (p.status) qs.set('status', p.status);
  qs.set('from', p.from); qs.set('to', p.to);
  if (p.sort) { qs.set('sort', p.sort); qs.set('dir', p.dir); }
  qs.set('limit', remTx.limit); qs.set('offset', remTx.offset);
  try {
    const { rows, total } = await api(`/api/remisier/transactions?${qs}`);
    remTx.total = total;
    genTable('#remTxTable', rows, [
      { key: 'created_at', label: t('col_date'), type: 'date', sort: true },
      { key: 'transaction_number', label: t('col_trx'), sort: true },
      { key: 'type', label: t('col_type'), sort: true }, { key: 'status', label: 'Status', sort: true },
      { key: 'sid', label: 'SID', sort: true }, { key: 'name', label: t('col_name'), sort: true }, { key: 'email', label: 'Email', sort: true }, { key: 'phone', label: t('col_phone'), sort: true },
      { key: 'fund_name', label: t('col_fund'), sort: true }, { key: 'fund_type', label: t('col_fund_type'), sort: true },
      { key: 'unit', label: 'Unit', type: 'num', sort: true },
      { key: 'value_per_unit', label: 'NAV', type: 'num', sort: true },
      { key: 'amount', label: t('col_amount'), type: 'idr', sort: true }, { key: 'final_amount', label: t('col_final_amount'), type: 'idr', sort: true },
      { key: 'realized_gain_loss', label: t('col_realized_g_l'), type: 'idr', sort: true },
      { key: 'referrer_code', label: t('col_referrer_code'), sort: true }, { key: 'sales_code', label: t('col_sales_code'), sort: true },
    ], 'No transactions match these filters.', remTx.sort);
    const start = total ? remTx.offset + 1 : 0;
    const end = Math.min(remTx.offset + remTx.limit, total);
    $('#remTxPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#remTxPrev').disabled = remTx.offset === 0;
    $('#remTxNext').disabled = end >= total;
  } catch (e) { $('#remTxTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// nested: SInvest transactions (raw KSEI/SInvest custodian feed)
const sitx = { limit: 50, offset: 0, total: 0, sort: null };
let sitxLoaded = false;

function sitxParams() {
  return {
    sid: $('#sitxSid').value.trim(),
    search: $('#sitxSearch').value.trim(),
    type: $('#sitxType').value,
    from: $('#sitxFrom').value,
    to: $('#sitxTo').value,
    ...sortParams(sitx.sort),
  };
}

async function loadSitx() {
  const p = sitxParams();
  $('#sitxTable').innerHTML = '<div class="loading">Loading…</div>';
  const qs = new URLSearchParams();
  if (p.sid) qs.set('sid', p.sid);
  if (p.search) qs.set('search', p.search);
  if (p.type) qs.set('type', p.type);
  if (p.from) qs.set('from', p.from);
  if (p.to) qs.set('to', p.to);
  if (p.sort) { qs.set('sort', p.sort); qs.set('dir', p.dir); }
  qs.set('limit', sitx.limit); qs.set('offset', sitx.offset);
  const sitxFetch = api(`/api/sinvest-transactions?${qs}`);
  gateTabLoad((v) => { sitxLoaded = v; }, [sitxFetch]);
  try {
    const { rows, total } = await sitxFetch;
    sitx.total = total;
    genTable('#sitxTable', rows, [
      { key: 'transaction_date', label: t('col_date'), type: 'date', sort: true },
      { key: 'type', label: t('col_type'), sort: true },
      { key: 'sid', label: 'SID', sort: true }, { key: 'investor_name', label: 'Investor', sort: true },
      { key: 'fund_code', label: t('col_fund_code'), sort: true }, { key: 'fund_name', label: t('col_fund'), sort: true },
      { key: 'unit', label: 'Unit', type: 'num', sort: true },
      { key: 'nav_per_unit', label: 'NAV', type: 'num', sort: true },
      { key: 'gross_amount', label: t('col_gross_amount'), type: 'idr', sort: true },
      { key: 'fee', label: t('col_fee'), type: 'idr', sort: true },
      { key: 'net_amount', label: t('col_net_amount'), type: 'idr', sort: true },
      { key: 'input_date', label: t('col_input_date'), type: 'date', sort: true },
      { key: 'reference_no', label: t('col_reference'), sort: true },
    ], 'No transactions match these filters.', sitx.sort);
    const start = total ? sitx.offset + 1 : 0;
    const end = Math.min(sitx.offset + sitx.limit, total);
    $('#sitxPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#sitxPrev').disabled = sitx.offset === 0;
    $('#sitxNext').disabled = end >= total;
  } catch (e) { $('#sitxTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// nested: Users transactions (any investor, by SID/email/name)
const utx = { limit: 50, offset: 0, total: 0, sort: null };

async function loadUtxFundOptions() {
  let funds = [];
  try { funds = await api('/api/funds/list'); } catch { return; }
  $('#utxFund').insertAdjacentHTML('beforeend', funds.map((f) =>
    `<option value="${val(f.id)}">${val(f.name)}</option>`).join(''));
}

function utxParams() {
  return {
    q: $('#utxSearch').value.trim(),
    fundName: $('#utxFundName').value.trim(),
    promo: $('#utxPromo').value.trim(),
    type: $('#utxType').value,
    status: $('#utxStatus').value,
    fundId: $('#utxFund').value,
    from: $('#utxFrom').value,
    to: $('#utxTo').value,
    ...sortParams(utx.sort),
  };
}

async function loadUtx() {
  const p = utxParams();
  $('#utxTable').innerHTML = '<div class="loading">Loading…</div>';
  const qs = new URLSearchParams();
  for (const k of ['q', 'fundName', 'promo']) if (p[k]) qs.set(k, p[k]);
  if (p.type) qs.set('type', p.type);
  if (p.status) qs.set('status', p.status);
  if (p.fundId) qs.set('fundId', p.fundId);
  if (p.from) qs.set('from', p.from);
  if (p.to) qs.set('to', p.to);
  if (p.sort) { qs.set('sort', p.sort); qs.set('dir', p.dir); }
  qs.set('limit', utx.limit); qs.set('offset', utx.offset);
  try {
    const { rows, total } = await api(`/api/users-transactions?${qs}`);
    utx.total = total;
    // created_at is a UTC instant; show it as Jakarta time so the day matches the summary above.
    genTable('#utxTable', rows.map((r) => ({ ...r, created_at: toJakartaTime(val(r.created_at)) })), [
      { key: 'created_at', label: t('col_date_wib'), sort: true, text: true },
      { key: 'transaction_number', label: t('col_trx'), sort: true },
      { key: 'type', label: t('col_type'), sort: true }, { key: 'status', label: 'Status', sort: true },
      { key: 'sid', label: 'SID', sort: true }, { key: 'name', label: t('col_name'), sort: true }, { key: 'email', label: 'Email', sort: true }, { key: 'phone', label: t('col_phone'), sort: true },
      { key: 'fund_name', label: t('col_fund'), sort: true }, { key: 'promo_code', label: 'Promo', sort: true },
      { key: 'unit', label: 'Unit', type: 'num', sort: true },
      { key: 'value_per_unit', label: 'NAV', type: 'num', sort: true },
      { key: 'amount', label: t('col_amount'), type: 'idr', sort: true }, { key: 'final_amount', label: t('col_final_amount'), type: 'idr', sort: true },
    ], 'No transactions match these filters.', utx.sort);
    const start = total ? utx.offset + 1 : 0;
    const end = Math.min(utx.offset + utx.limit, total);
    $('#utxPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#utxPrev').disabled = utx.offset === 0;
    $('#utxNext').disabled = end >= total;
  } catch (e) { $('#utxTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// Users transactions summary (panel above the list)
// Subscription (buy), redemption (sell) and net flow per day, Monday week or
// month, over the same investor/fund/promo filters as the list. Type and
// status are deliberately not sent: the panel always counts both sides, and
// the server keeps only settled orders without bonus top-ups, so it stays a
// whole-of-range picture even while the table below is filtered to one type.
const utxSum = { granularity: 'week', loaded: false };

function utxSumGranLabel() {
  if (utxSum.granularity === 'day') return 'Date';
  if (utxSum.granularity === 'month') return 'Month';
  return 'Week of (Mon)';
}

// Net flow cell: green with a plus when money came in, red with a minus when
// it went out; the footer total goes through the same formatter.
function signedIdr(v) {
  if (v == null) return 'n/a';
  const n = Number(v) || 0;
  return `<span style="color:${n >= 0 ? 'var(--pos-text)' : 'var(--neg-text)'}">${n >= 0 ? '+' : '-'}${idrFull(Math.abs(n))}</span>`;
}

async function loadUtxSummary() {
  const p = utxParams();
  if (!p.from || !p.to) {
    utxSum.loaded = false;
    $('#utxSumKpis').innerHTML = '';
    $('#utxSumTable').innerHTML = `<div class="empty">${t('utx_sum_pick_range')}</div>`;
    return;
  }
  const qs = new URLSearchParams();
  for (const k of ['q', 'fundName', 'promo', 'fundId', 'from', 'to']) if (p[k]) qs.set(k, p[k]);
  qs.set('granularity', utxSum.granularity);
  $('#utxSumKpis').innerHTML = '';
  $('#utxSumTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const { rows } = await api(`/api/users-transactions/summary?${qs}`);
    utxSum.loaded = true;
    const total = (k) => rows.reduce((a, r) => a + (Number(val(r[k])) || 0), 0);
    const subs = total('subscriptions');
    const reds = total('redemptions');
    const net = subs - reds;
    if (rows.length) {
      $('#utxSumKpis').innerHTML = [
        kpi(t('utx_sum_subscriptions'), idr(subs), `${num(total('buys'))} ${t('utx_sum_buys')}`, 'accent', ICONS.trendUp),
        kpi(t('utx_sum_redemptions'), idr(reds), `${num(total('sells'))} ${t('utx_sum_sells')}`, 'warn', ICONS.trendDown),
        kpi(t('utx_sum_net'), idr(net), `${idr(subs)} − ${idr(reds)}`, net < 0 ? 'warn' : 'accent', ICONS.activity),
      ].join('');
    }
    // Newest bucket first, like the table below it; the query returns them oldest first.
    genTable('#utxSumTable', rows.slice().reverse(), [
      { key: 'bucket', label: utxSumGranLabel() },
      { key: 'subscriptions', label: t('col_subscriptions'), type: 'idr', sum: true },
      { key: 'buys', label: t('col_buys'), type: 'num', sum: true },
      { key: 'redemptions', label: t('col_redemptions'), type: 'idr', sum: true },
      { key: 'sells', label: t('col_sells'), type: 'num', sum: true },
      { key: 'net_flow', label: t('col_net_flow'), type: 'idr', sum: true, fmt: signedIdr },
    ], t('utx_sum_empty'));
  } catch (e) {
    utxSum.loaded = false;
    $('#utxSumKpis').innerHTML = '';
    $('#utxSumTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  }
}

// TOP INVESTORS — Day/Week/Month resolve to the day, Mon–Sun week, or
// calendar month containing #tiDate; Custom reads From/To directly.
let tiMetric = 'subscriptions';
let tiDir = 'desc';
let tiRows = [];
let tiPeriod = 'month';
let tiLoaded = false;

function tiParams() {
  const limit = Math.min(Math.max(parseInt($('#tiLimit').value, 10) || 100, 1), 1000);
  $('#tiLimit').value = limit;
  const base = { metric: tiMetric, limit, direction: tiDir };
  if (tiPeriod === 'custom') return { ...base, from: $('#tiFrom').value, to: $('#tiTo').value };
  const d = new Date(`${$('#tiDate').value || isoDate(new Date())}T00:00:00Z`);
  if (tiPeriod === 'day') return { ...base, from: isoDate(d), to: isoDate(d) };
  if (tiPeriod === 'week') {
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    return { ...base, from: isoDate(mon), to: isoDate(sun) };
  }
  return { ...base, from: isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
    to: isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
}

const TI_COLS = {
  subscriptions: [
    { key: 'subscriptions', label: t('col_subscriptions'), type: 'idr', sum: true }, { key: 'buys', label: t('col_buys'), type: 'num', sum: true },
    { key: 'pct_of_subscriptions', label: t('col_of_all_subscriptions'), type: 'pct', sum: true },
    { key: 'redemptions', label: t('col_redemptions'), type: 'idr', sum: true }, { key: 'net_deposit', label: t('col_net_deposit'), type: 'idr', sum: true },
  ],
  redemptions: [
    { key: 'redemptions', label: t('col_redemptions'), type: 'idr', sum: true }, { key: 'sells', label: t('col_sells'), type: 'num', sum: true },
    { key: 'pct_of_redemptions', label: t('col_of_all_redemptions'), type: 'pct', sum: true },
    { key: 'subscriptions', label: t('col_subscriptions'), type: 'idr', sum: true }, { key: 'net_deposit', label: t('col_net_deposit'), type: 'idr', sum: true },
  ],
  net: [
    { key: 'net_deposit', label: t('col_net_deposit'), type: 'idr', sum: true },
    { key: 'subscriptions', label: t('col_subscriptions'), type: 'idr', sum: true }, { key: 'redemptions', label: t('col_redemptions'), type: 'idr', sum: true },
  ],
};

async function loadTopInvestors() {
  const p = tiParams();
  if (!p.from || !p.to) { toast(t('msg_pick_a_date_range_first')); return; }
  $('#tiSummary').hidden = true;
  $('#tiTable').innerHTML = '<div class="loading">Querying BigQuery…</div>';
  const tiFetch = api(`/api/top-investors?${new URLSearchParams(p)}`);
  gateTabLoad((v) => { tiLoaded = v; }, [tiFetch]);
  try {
    const rows = await tiFetch;
    tiRows = rows;
    renderTiCompact();
    genTable('#tiTable', rows.map((r, i) => ({ ...r, rank: i + 1 })), [
      { key: 'rank', label: '#', type: 'num' },
      { key: 'sid', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
      ...TI_COLS[p.metric],
    ], t('ti_empty'));
    if (!rows.length) return;
    const sum = (k) => rows.reduce((a, r) => a + (Number(val(r[k])) || 0), 0);
    const range = p.from === p.to ? p.from : `${p.from} → ${p.to}`;
    const which = p.direction === 'asc' ? 'lowest' : 'top';
    $('#tiSummary').textContent = p.metric === 'net'
      ? `${range}: ${which} ${rows.length} net deposit ${idrFull(sum('net_deposit'))}`
      : `${range}: ${which} ${rows.length} = ${sum(`pct_of_${p.metric}`).toFixed(1)}% of all ${p.metric} (${idrFull(sum(p.metric))})`;
    $('#tiSummary').hidden = false;
  } catch (e) {
    tiRows = [];
    renderTiCompact();
    $('#tiTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  }
}

// Short version of the same rows: Buys/Sell are the rupiah amounts (same as
// Subscriptions/Redemptions above), Net increase = Buys - Sell. Header clicks
// re-sort the rows already fetched; they don't hit BigQuery again.
function renderTiCompact() {
  const rows = tiRows.map((r) => ({ name: val(r.name) || val(r.sid), buys: Number(val(r.subscriptions)) || 0,
    sell: Number(val(r.redemptions)) || 0, net: Number(val(r.net_deposit)) || 0 }));
  genTable('#tiCompactTable', rows, [
    { key: 'name', label: t('col_name') },
    { key: 'buys', label: t('col_buys_2'), type: 'idr', sum: true },
    { key: 'sell', label: t('col_sell'), type: 'idr', sum: true },
    { key: 'net', label: t('col_net_increase'), type: 'idr', sum: true },
  ], t('ti_empty'));
}

// EVENT CODE TRACKING (generic — no event/code table exists yet, see
// queries.js:eventCodeWhere; field still picks referrer_code/sales_code like
// Remisier does, since that's where a code would live today). No tab-switch
// auto-load, same as Remisier: needs a code typed in first. Every count in
// this tab uses completed transactions only; ongoing and failed show as their
// own columns and never feed a total, a target or a retention cell.
let evcGranularity = 'week';
const evcUsers = { limit: 100, offset: 0, total: 0, rows: null, sort: null };
const evcTx = { limit: 100, offset: 0, total: 0, sort: null };
let evcCohortRows = { reg: null, tx: null };
// ponytail: exports fetch in one request; page through if an event ever passes this.
const EVC_EXPORT_MAX = 50000;

function evcCodesArr() {
  return $('#evcCodes').value.split(',').map((s) => s.trim()).filter(Boolean);
}
function evcBaseQs(extra = {}) {
  const qs = new URLSearchParams({ field: $('#evcField').value, from: $('#evcFrom').value, to: $('#evcTo').value, ...extra });
  evcCodesArr().forEach((c) => qs.append('codes', c));
  return qs;
}
const fillT = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(key));

// Export cells keep raw values (numbers stay numbers) instead of the
// formatted text the on-screen tables show.
const EVC_NUM_TYPES = ['num', 'idr', 'pct', 'delta'];
const evcCell = (c, r) => {
  const v = val(r[c.key]);
  if (v == null || v === '') return '';
  if (EVC_NUM_TYPES.includes(c.type)) return Number(v);
  return c.type === 'date' ? String(v).slice(0, 10) : v;
};
const evcAoa = (rows, cols) => [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => evcCell(c, r)))];
async function downloadAoa(aoa, name, fmt) {
  if (fmt === 'csv') { downloadBlob(new Blob([aoaToCsv(aoa)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`); return; }
  await loadExportLib('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31));
  XLSX.writeFile(wb, `${name}.xlsx`);
}
const evcFileSlug = () => `${evcCodesArr().join('_').replace(/[^A-Za-z0-9]+/g, '-')}_${$('#evcFrom').value}_${$('#evcTo').value}`;

function renderEvcFunnel(f) {
  const tagged = Number(val(f.tagged)) || 0;
  const verified = Number(val(f.verified)) || 0;
  const transacted = Number(val(f.transacted)) || 0;
  const repeat = Number(val(f.repeat_transacted)) || 0;
  $('#evcFunnel').innerHTML = [
    kpi(t('evc_kpi_tagged'), num(tagged), '', 'accent', ICONS.userPlus),
    kpi(t('evc_kpi_verified'), num(verified), pct(verified, tagged), '', ICONS.check),
    kpi(t('evc_kpi_transacted'), num(transacted), pct(transacted, tagged), 'accent', ICONS.activity),
    kpi(t('evc_kpi_repeat'), num(repeat), pct(repeat, tagged), '', ICONS.hourglass),
  ].join('');
}

// Tagged users plus their portfolio (queries.js:eventCodePortfolioCtes).
const evcPfLabel = (s) => t(`evc_pf_${s}`);
const evcUserRows = (rows) => rows.map((r) => ({ ...r, portfolio_status_label: evcPfLabel(val(r.portfolio_status)) }));
const evcUserCols = () => [
  { key: 'sid', label: 'SID', sort: true }, { key: 'name', label: t('evc_col_name'), sort: true }, { key: 'email', label: 'Email', sort: true },
  { key: 'referrer_code', label: t('evc_col_referrer'), sort: true }, { key: 'sales_code', label: t('evc_col_sales'), sort: true },
  { key: 'created_at', label: t('evc_col_registered'), type: 'date', sort: true }, { key: 'verified_at', label: t('evc_col_verified_at'), type: 'date', sort: true },
  { key: 'verification_status', label: t('evc_col_kyc_status'), sort: true },
  { key: 'portfolio_status_label', label: t('evc_col_pf_status'), sort: 'portfolio_status' },
  { key: 'aum_now', label: t('evc_col_aum_now'), type: 'idr', sort: true },
  { key: 'first_buy_at', label: t('evc_col_first_buy'), type: 'date', sort: true },
  { key: 'last_tx_at', label: t('evc_col_last_tx'), type: 'date', sort: true },
  { key: 'completed_buys', label: t('evc_col_buys'), type: 'num', sort: true },
  { key: 'bought', label: t('evc_col_bought'), type: 'idr', sort: true },
  { key: 'sold', label: t('evc_col_sold'), type: 'idr', sort: true },
];
function renderEvcUsers() {
  if (!evcUsers.rows) return;
  genTable('#evcUsersTable', evcUserRows(evcUsers.rows), evcUserCols(), t('evc_users_empty'), evcUsers.sort);
}
async function loadEvcUsers() {
  const qs = evcBaseQs({ limit: evcUsers.limit, offset: evcUsers.offset, ...sortParams(evcUsers.sort) });
  $('#evcUsersTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const { rows, total } = await api(`/api/event-code/users?${qs}`);
    evcUsers.total = total; evcUsers.rows = rows;
    renderEvcUsers();
    const start = total ? evcUsers.offset + 1 : 0;
    const end = Math.min(evcUsers.offset + evcUsers.limit, total);
    $('#evcUsersPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#evcUsersPrev').disabled = evcUsers.offset === 0;
    $('#evcUsersNext').disabled = end >= total;
  } catch (e) { evcUsers.rows = null; $('#evcUsersTable').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}
const evcFetchAllUsers = () => api(`/api/event-code/users?${evcBaseQs({ limit: EVC_EXPORT_MAX, offset: 0, ...sortParams(evcUsers.sort) })}`);
async function exportEvcUsers(fmt) {
  if (!evcCodesArr().length) { toast(t('evc_enter_code')); return; }
  try {
    const { rows, total } = await evcFetchAllUsers();
    await downloadAoa(evcAoa(evcUserRows(rows), evcUserCols()), `event_code_users_${evcFileSlug()}`, fmt);
    if (total > rows.length) toast(fillT('evc_export_truncated', { n: num(rows.length), total: num(total) }));
  } catch (e) { toast(e.message); }
}

async function loadEventCode() {
  if (!evcCodesArr().length) { toast(t('evc_enter_code')); return; }
  evcUsers.offset = 0;
  loadEvcRecap();
  loadEvcUsers();
  loadEvcCohort();
  loadEvcPortfolio();
  $('#evcFunnel').innerHTML = '<div class="loading">Loading…</div>';
  try {
    renderEvcFunnel(await api(`/api/event-code/funnel?${evcBaseQs()}`));
  } catch (e) { $('#evcFunnel').innerHTML = ''; toast(e.message); }
}

// Daily recap + per-code breakdown (queries.js:eventCodeRecap). Transaction
// type and "only new sign-ups" refetch; targets, the day filter and the
// per-code sort only re-render the rows already fetched.
let evcRecap = null;
let evcRecapSeq = 0;
let evcDayFilter = 'all';
const EVC_NUM_KEYS = ['registrations', 'kyc_verified', 'tx_total', 'tx_completed', 'tx_ongoing', 'tx_failed',
  'amount_completed', 'amount_ongoing', 'transacting_users', 'new_transactors'];

function evcNums(r) {
  const o = {};
  EVC_NUM_KEYS.forEach((k) => { o[k] = Number(val(r[k])) || 0; });
  return o;
}
function evcTargets() {
  const read = (sel) => {
    const v = $(sel).value.trim();
    const n = v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };
  return { reg: read('#evcTargetReg'), tx: read('#evcTargetTx') };
}
function evcRecapQs() {
  const qs = evcBaseQs();
  if ($('#evcRecapType').value) qs.set('type', $('#evcRecapType').value);
  if ($('#evcNewOnly').checked) qs.set('newOnly', '1');
  return qs;
}

async function loadEvcRecap() {
  if (!evcCodesArr().length) return;
  const seq = ++evcRecapSeq;
  $('#evcRecapKpis').innerHTML = '';
  $('#evcDailyChartWrap').style.display = 'none';
  $('#evcDailyTable').innerHTML = `<div class="loading">${t('evc_loading')}</div>`;
  $('#evcCodeTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const data = await api(`/api/event-code/recap?${evcRecapQs()}`);
    if (seq !== evcRecapSeq) return; // a newer request (type/checkbox changed) owns the panel now
    evcRecap = data;
    renderEvcRecap();
  } catch (e) {
    if (seq !== evcRecapSeq) return;
    evcRecap = null;
    $('#evcDailyTable').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    $('#evcCodeTable').innerHTML = '';
  }
}

// Targets compare against completed transactions only.
function evcDayRows(recap, targets) {
  return recap.days.map((r) => {
    const d = { day: val(r.day), ...evcNums(r) };
    d.reg_vs = targets.reg == null ? null : d.registrations - targets.reg;
    d.tx_vs = targets.tx == null ? null : d.tx_completed - targets.tx;
    d.hit = (d.reg_vs == null || d.reg_vs >= 0) && (d.tx_vs == null || d.tx_vs >= 0);
    return d;
  });
}
const evcDailyCols = (targets) => [
  { key: 'day', label: t('evc_col_date') },
  { key: 'registrations', label: t('evc_col_regs'), type: 'num', sum: true },
  ...(targets.reg == null ? [] : [{ key: 'reg_vs', label: t('evc_col_reg_vs'), type: 'delta' }]),
  { key: 'kyc_verified', label: t('evc_col_kyc'), type: 'num', sum: true },
  { key: 'tx_completed', label: t('evc_col_completed'), type: 'num', sum: true },
  ...(targets.tx == null ? [] : [{ key: 'tx_vs', label: t('evc_col_tx_vs'), type: 'delta' }]),
  { key: 'tx_ongoing', label: t('evc_col_ongoing'), type: 'num', sum: true },
  { key: 'tx_failed', label: t('evc_col_failed'), type: 'num', sum: true },
  { key: 'tx_total', label: t('evc_col_tx_total'), type: 'num', sum: true },
  { key: 'amount_completed', label: t('evc_col_amt_completed'), type: 'idr', sum: true },
  { key: 'amount_ongoing', label: t('evc_col_amt_ongoing'), type: 'idr', sum: true },
  // Distinct per day, so the column has no total: the KPI above has the window's distinct count.
  { key: 'transacting_users', label: t('evc_col_users'), type: 'num' },
  { key: 'new_transactors', label: t('evc_col_new'), type: 'num', sum: true },
];

function renderEvcRecap() {
  if (!evcRecap) return;
  const targets = evcTargets();
  const hasTarget = targets.reg != null || targets.tx != null;
  const days = evcDayRows(evcRecap, targets);
  const sum = (k) => days.reduce((a, d) => a + d[k], 0);
  const n = days.length;
  const hit = days.filter((d) => d.hit).length;
  const any = sum('registrations') + sum('tx_total') > 0;

  if (!hasTarget) evcDayFilter = 'all';
  $('#evcDayFilter').style.display = hasTarget && any ? '' : 'none';
  $$('#evcDayFilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === evcDayFilter));

  $('#evcRecapKpis').innerHTML = [
    kpi(t('evc_kpi_regs'), num(sum('registrations')),
      fillT('evc_kpi_regs_sub', { avg: n ? (sum('registrations') / n).toFixed(1) : '0', kyc: num(sum('kyc_verified')) }), 'accent', ICONS.userPlus),
    kpi(t('evc_kpi_tx'), num(sum('tx_completed')),
      fillT('evc_kpi_tx_sub', { o: num(sum('tx_ongoing')), f: num(sum('tx_failed')) }), 'accent', ICONS.receipt),
    kpi(t('evc_kpi_amount'), idr(sum('amount_completed')), fillT('evc_kpi_amount_sub', { o: idr(sum('amount_ongoing')) }), '', ICONS.coin),
    kpi(t('evc_kpi_users'), num(evcRecap.transacting_users), fillT('evc_kpi_users_sub', { n: num(sum('new_transactors')) }), '', ICONS.users),
    hasTarget ? kpi(t('evc_kpi_days'), pct(hit, n), fillT('evc_kpi_days_sub', { h: num(hit), n: num(n) }), '', ICONS.check) : '',
  ].join('');

  $('#evcDailyChartWrap').style.display = any ? '' : 'none';
  if (any) renderEvcDailyChart(days, targets);

  const rows = evcDayFilter === 'all' ? days : days.filter((d) => (evcDayFilter === 'hit' ? d.hit : !d.hit));
  if (!any) $('#evcDailyTable').innerHTML = `<div class="empty">${t('evc_daily_empty')}</div>`;
  else genTable('#evcDailyTable', rows, evcDailyCols(targets), t('evc_days_none'));
  renderEvcCodes();
}

// Completed transactions as bars (what the transaction target is measured
// against), registrations as a line, targets as dashed lines. Ongoing stays
// in the table only, since it never counts. No animation: typing a target
// repaints on every keystroke.
function renderEvcDailyChart(days, targets) {
  const dot = days.length > 45 ? 0 : 3;
  const flat = (v) => days.map(() => v);
  const datasets = [
    { type: 'bar', label: t('evc_series_completed'), data: days.map((d) => d.tx_completed), backgroundColor: C.chartGreen, order: 3 },
    { type: 'line', label: t('evc_series_regs'), data: days.map((d) => d.registrations), borderColor: C.indigo, backgroundColor: C.indigo, borderWidth: 2, pointRadius: dot, order: 1 },
  ];
  if (targets.reg != null) datasets.push({ type: 'line', label: t('evc_series_target_reg'), data: flat(targets.reg), borderColor: C.indigo, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, order: 0 });
  if (targets.tx != null) datasets.push({ type: 'line', label: t('evc_series_target_tx'), data: flat(targets.tx), borderColor: C.ink, borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0, order: 0 });
  paint('evcDailyChart', {
    type: 'bar',
    data: { labels: days.map((d) => d.day), datasets },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: C.grid }, ticks: { precision: 0, callback: (v) => num(v) } },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.raw)}` } },
      },
    },
  });
}

function evcCodeRows(recap) {
  const n = recap.days.length || 1;
  const perDay = (v) => Math.round((v / n) * 10) / 10;
  return recap.byCode.map((r) => {
    const o = { code: val(r.code), ...evcNums(r) };
    o.reg_day = perDay(o.registrations);
    o.tx_day = perDay(o.tx_completed);
    return o;
  });
}
const evcCodeCols = () => [
  { key: 'code', label: t('evc_col_code') },
  { key: 'registrations', label: t('evc_col_regs'), type: 'num', sum: true },
  { key: 'reg_day', label: t('evc_col_reg_day'), type: 'num' },
  { key: 'kyc_verified', label: t('evc_col_kyc'), type: 'num', sum: true },
  { key: 'tx_completed', label: t('evc_col_completed'), type: 'num', sum: true },
  { key: 'tx_day', label: t('evc_col_tx_day'), type: 'num' },
  { key: 'tx_ongoing', label: t('evc_col_ongoing'), type: 'num', sum: true },
  { key: 'tx_failed', label: t('evc_col_failed'), type: 'num', sum: true },
  { key: 'amount_completed', label: t('evc_col_amt_completed'), type: 'idr', sum: true },
  { key: 'amount_ongoing', label: t('evc_col_amt_ongoing'), type: 'idr', sum: true },
  // A user carries one code, so per-code distinct users do add up.
  { key: 'transacting_users', label: t('evc_col_users'), type: 'num', sum: true },
  { key: 'new_transactors', label: t('evc_col_new'), type: 'num', sum: true },
];
function renderEvcCodes() {
  genTable('#evcCodeTable', evcCodeRows(evcRecap), evcCodeCols(), t('evc_bycode_empty'));
}

// Period arithmetic for the cohort grids, in UTC like BigQuery's DATE_TRUNC
// (weeks start on Sunday there too).
const evcIso = (d) => d.toISOString().slice(0, 10);
const evcDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
function evcPeriodStart(iso, grain) {
  const d = evcDate(iso);
  if (grain === 'week') d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  if (grain === 'month') d.setUTCDate(1);
  return evcIso(d);
}
function evcNextPeriod(iso, grain) {
  const d = evcDate(iso);
  if (grain === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + (grain === 'week' ? 7 : 1));
  return evcIso(d);
}
function evcPeriodsBetween(a, b, grain) {
  const x = evcDate(a), y = evcDate(b);
  if (grain === 'month') return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth();
  return Math.round((y - x) / 86400000 / (grain === 'week' ? 7 : 1));
}
// Every period of the event window, oldest first, To capped at today.
// ponytail: capped at 1,000 rows (a day grain over ~3 years); page it if that ever matters.
function evcWindowPeriods(grain) {
  const today = evcIso(new Date());
  const to = $('#evcTo').value && $('#evcTo').value < today ? $('#evcTo').value : today;
  const out = [];
  for (let p = evcPeriodStart($('#evcFrom').value || to, grain); p <= to && out.length < 1000; p = evcNextPeriod(p, grain)) out.push(p);
  return out;
}
// Rows for a cohort heatmap: every period of the window (size 0 when nobody
// started then) plus any cohort that started before the window, oldest first.
function evcGridRows(grain, fromData) {
  const by = new Map(evcWindowPeriods(grain).map((k) => [k, { cohort: k, size: 0, cells: {} }]));
  fromData.forEach(({ cohort, size }) => { if (!by.has(cohort)) by.set(cohort, { cohort, size: 0, cells: {} }); by.get(cohort).size = size; });
  return [...by.values()].sort((a, b) => (a.cohort < b.cohort ? -1 : 1));
}

// One heatmap for every retention table in this tab. `cell(cohort, col)`
// returns { text, ratio, title } (ratio 0..1 sets the shade) or null for a
// period the cohort has not reached yet, drawn as ·.
const EVC_GRAIN_LABEL = { day: 'D', week: 'W', month: 'M' };
function evcHeatmap(sel, cohorts, cols, label, cell) {
  const heads = [`<th class="coh">${t('evc_col_cohort')}</th>`, `<th class="num">${t('evc_col_size')}</th>`, ...cols.map((k) => `<th>${label(k)}</th>`)];
  const body = cohorts.map((c) => {
    let tds = `<td class="coh">${c.cohort}</td><td class="num">${num(c.size)}</td>`;
    for (const k of cols) {
      const v = cell(c, k);
      if (!v) { tds += '<td>·</td>'; continue; }
      const bg = `rgba(${C.heatRgb},${(0.12 + Math.min(1, Math.max(0, v.ratio)) * 0.8).toFixed(2)})`;
      tds += `<td class="heat" style="background:${bg}"${v.title ? ` title="${escapeHtml(v.title)}"` : ''}>${v.text}</td>`;
    }
    return `<tr>${tds}</tr>`;
  }).join('');
  $(sel).innerHTML = `<table><thead><tr>${heads.join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

// Transaction cohorts as a full grid: every reached offset (up to 12) gets a
// value, 0 when nobody bought; offsets after today stay empty.
function evcTxCohortGrid(rows) {
  const n = 12, grain = evcGranularity;
  const today = evcPeriodStart(evcIso(new Date()), grain);
  const sizes = new Map();
  rows.forEach((r) => sizes.set(val(r.cohort), Number(val(r.cohort_size)) || 0));
  const cohorts = evcGridRows(grain, [...sizes].map(([cohort, size]) => ({ cohort, size })));
  const byKey = new Map(cohorts.map((c) => [c.cohort, c]));
  rows.forEach((r) => { if (r.period_offset != null) byKey.get(val(r.cohort)).cells[Number(val(r.period_offset))] = Number(val(r.users)) || 0; });
  cohorts.forEach((c) => { c.reach = Math.max(0, Math.min(n, evcPeriodsBetween(c.cohort, today, grain))); });
  const cols = Array.from({ length: Math.max(0, ...cohorts.map((c) => c.reach)) + 1 }, (_, o) => o);
  return { cohorts, cols };
}
const evcTxCohortCell = (c, o) => {
  if (o > c.reach) return null;
  const users = c.cells[o] || 0;
  return { users, pct: c.size ? (users / c.size) * 100 : 0 };
};
function renderEvcCohort(sel, rows) {
  if (!rows) return;
  const { cohorts, cols } = evcTxCohortGrid(rows);
  if (!cohorts.length) { $(sel).innerHTML = `<div class="empty">${t('evc_cohort_empty')}</div>`; return; }
  const prefix = EVC_GRAIN_LABEL[evcGranularity] || 'P';
  evcHeatmap(sel, cohorts, cols, (o) => `${prefix}${o}`, (c, o) => {
    const v = evcTxCohortCell(c, o);
    return v && { text: `${Math.round(v.pct)}%`, ratio: v.pct / 100, title: `${num(v.users)} / ${num(c.size)}` };
  });
}
// Long format of the same grid for the workbook.
function evcTxCohortExportRows(rows) {
  const { cohorts, cols } = evcTxCohortGrid(rows);
  return cohorts.flatMap((c) => cols.map((o) => [o, evcTxCohortCell(c, o)]).filter(([, v]) => v)
    .map(([o, v]) => ({ cohort: c.cohort, period_offset: o, cohort_size: c.size, users: v.users, pct: v.pct })));
}

// Two separate cohorts, same grain, fetched side by side — see
// queries.js:eventCodeCohort for why "cohort" needs both a registration and
// a first-transaction basis for an acquisition code.
const evcCohortQs = (basis) => evcBaseQs({ grain: evcGranularity, basis });
async function loadEvcCohort() {
  if (!evcCodesArr().length) return;
  $('#evcCohortRegHeatmap').innerHTML = '<div class="loading">Building cohorts…</div>';
  $('#evcCohortTxHeatmap').innerHTML = '<div class="loading">Building cohorts…</div>';
  // Both cohorts at once: they're independent queries.
  await Promise.all([['registration', 'reg', '#evcCohortRegHeatmap'], ['first_tx', 'tx', '#evcCohortTxHeatmap']].map(([basis, k, el]) =>
    api(`/api/event-code/cohort?${evcCohortQs(basis)}`).then(
      (rows) => { evcCohortRows[k] = rows; renderEvcCohort(el, rows); },
      (e) => { evcCohortRows[k] = null; $(el).innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; })));
}

// Portfolio retention (queries.js:eventCodePortfolio): status summary now,
// plus a cohort heatmap read three ways from the same rows.
let evcPf = null;
let evcPfSeq = 0;
let evcPfGrain = 'month';
let evcPfMode = 'holders';
const EVC_PF_ORDER = ['invested', 'redeemed', 'never'];
const evcPfQs = () => evcBaseQs({ grain: evcPfGrain });
async function loadEvcPortfolio() {
  if (!evcCodesArr().length) return;
  const seq = ++evcPfSeq;
  $('#evcPfSummary').innerHTML = '<div class="loading">Loading…</div>';
  $('#evcPfHeatmap').innerHTML = '<div class="loading">Building cohorts…</div>';
  try {
    const data = await api(`/api/event-code/portfolio?${evcPfQs()}`);
    if (seq !== evcPfSeq) return;
    evcPf = data;
    renderEvcPortfolio();
  } catch (e) {
    if (seq !== evcPfSeq) return;
    evcPf = null;
    $('#evcPfSummary').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    $('#evcPfHeatmap').innerHTML = '';
  }
}
function evcPfSummaryRows(pf) {
  const by = Object.fromEntries(pf.summary.map((r) => [val(r.portfolio_status), r]));
  const total = pf.summary.reduce((a, r) => a + (Number(val(r.investors)) || 0), 0);
  return EVC_PF_ORDER.map((s) => {
    const investors = Number(val(by[s]?.investors)) || 0;
    const aum = Number(val(by[s]?.aum)) || 0;
    return { status: evcPfLabel(s), investors, share: total ? (investors / total) * 100 : 0, aum, avg_aum: investors && aum ? aum / investors : null };
  });
}
const evcPfSummaryCols = () => [
  { key: 'status', label: t('evc_col_pf_status') },
  { key: 'investors', label: t('evc_col_investors'), type: 'num', sum: true },
  { key: 'share', label: t('evc_col_share'), type: 'pct', sum: true },
  { key: 'aum', label: t('evc_col_aum_now'), type: 'idr', sum: true },
  { key: 'avg_aum', label: t('evc_col_avg_aum'), type: 'idr' },
];
// AUM vs first reading: each cohort's AUM against its own first column with
// data (rows arrive sorted by cohort, then period), so a top-up shows above
// 100%. Rows without a cohort only carry the period columns (see the query).
function evcPfRetentionRows(pf) {
  const rows = pf.retention.filter((r) => r.cohort != null);
  const first = {};
  rows.forEach((r) => { if (!(val(r.cohort) in first)) first[val(r.cohort)] = Number(val(r.aum)) || 0; });
  return rows.map((r) => {
    const size = Number(val(r.cohort_size)) || 0, holders = Number(val(r.holders)) || 0, aum = Number(val(r.aum)) || 0;
    const base = first[val(r.cohort)];
    return { cohort: val(r.cohort), period: val(r.period), period_end: val(r.period_end), cohort_size: size,
      holders, holders_pct: size ? (holders / size) * 100 : 0, aum, aum_vs_first: base ? (aum / base) * 100 : null };
  });
}
// Full grid: every period of the window as a row, every portfolio_fix period
// from the cohort's own period onward as a cell (0 when nobody holds).
function evcPfGrid(pf) {
  const rows = evcPfRetentionRows(pf);
  const ends = Object.fromEntries(pf.retention.map((r) => [val(r.period), val(r.period_end)]));
  const cols = Object.keys(ends).sort();
  const sizes = new Map(rows.map((r) => [r.cohort, r.cohort_size]));
  const cohorts = evcGridRows(evcPfGrain, [...sizes].map(([cohort, size]) => ({ cohort, size })));
  const byKey = new Map(cohorts.map((c) => [c.cohort, c]));
  rows.forEach((r) => { byKey.get(r.cohort).cells[r.period] = r; });
  const cell = (c, k) => (k < c.cohort ? null : c.cells[k] || { cohort: c.cohort, period: k, period_end: ends[k], cohort_size: c.size,
    holders: 0, holders_pct: 0, aum: 0, aum_vs_first: null });
  return { cohorts, cols, cell };
}
const evcPfRetentionCols = () => [
  { key: 'cohort', label: t('evc_col_cohort') }, { key: 'period', label: t('evc_col_period') },
  { key: 'period_end', label: t('evc_col_period_end') }, { key: 'cohort_size', label: t('evc_col_size'), type: 'num' },
  { key: 'holders', label: t('evc_col_holders'), type: 'num' }, { key: 'holders_pct', label: t('evc_pf_mode_holders'), type: 'pct' },
  { key: 'aum', label: t('evc_col_aum'), type: 'idr' }, { key: 'aum_vs_first', label: t('evc_pf_mode_aum_pct'), type: 'pct' },
];
const evcPfExportRows = (pf) => { const g = evcPfGrid(pf); return g.cohorts.flatMap((c) => g.cols.map((k) => g.cell(c, k)).filter(Boolean)); };
function renderEvcPortfolio() {
  if (!evcPf) return;
  $$('#evcPfGran button').forEach((b) => b.classList.toggle('on', b.dataset.g === evcPfGrain));
  $$('#evcPfMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === evcPfMode));
  const summary = evcPfSummaryRows(evcPf);
  if (!summary.some((r) => r.investors)) $('#evcPfSummary').innerHTML = `<div class="empty">${t('evc_users_empty')}</div>`;
  else genTable('#evcPfSummary', summary, evcPfSummaryCols(), '');
  const { cohorts, cols, cell } = evcPfGrid(evcPf);
  if (!cohorts.length || !cols.length) { $('#evcPfHeatmap').innerHTML = `<div class="empty">${t('evc_pf_empty')}</div>`; return; }
  const cellFor = {
    holders: (r) => ({ text: `${Math.round(r.holders_pct)}%`, ratio: r.holders_pct / 100 }),
    aum: (r) => ({ text: idr(r.aum), ratio: (r.aum_vs_first || 0) / 100 }),
    aum_pct: (r) => ({ text: r.aum_vs_first == null ? 'n/a' : `${Math.round(r.aum_vs_first)}%`, ratio: (r.aum_vs_first || 0) / 100 }),
  }[evcPfMode];
  // Columns are calendar periods: a month shows as 2026-09, a week by its first day.
  const label = (k) => (evcPfGrain === 'month' ? k.slice(0, 7) : k);
  evcHeatmap('#evcPfHeatmap', cohorts, cols, label, (c, k) => {
    const r = cell(c, k);
    return r && { ...cellFor(r), title: fillT('evc_pf_cell_title', { d: r.period_end, h: num(r.holders), n: num(r.cohort_size), a: idrFull(r.aum) }) };
  });
}

function evcTxParams() {
  return {
    field: $('#evcField').value,
    codes: evcCodesArr(),
    type: $('#evcTxType').value,
    status: $('#evcTxStatus').value,
    from: $('#evcTxFrom').value,
    to: $('#evcTxTo').value,
    ...sortParams(evcTx.sort),
  };
}
function evcTxQs(limit, offset) {
  const p = evcTxParams();
  const qs = new URLSearchParams({ field: p.field });
  p.codes.forEach((c) => qs.append('codes', c));
  ['type', 'status', 'from', 'to', 'sort', 'dir'].forEach((k) => { if (p[k]) qs.set(k, p[k]); });
  qs.set('limit', limit); qs.set('offset', offset);
  return qs;
}
const EVC_TX_COLS = [
  { key: 'created_at', label: t('col_date'), type: 'date', sort: true },
  { key: 'transaction_number', label: t('col_trx'), sort: true },
  { key: 'type', label: t('col_type'), sort: true }, { key: 'status', label: 'Status', sort: true },
  { key: 'sid', label: 'SID', sort: true }, { key: 'name', label: t('col_name'), sort: true }, { key: 'email', label: 'Email', sort: true }, { key: 'phone', label: t('col_phone'), sort: true },
  { key: 'fund_name', label: t('col_fund'), sort: true }, { key: 'fund_type', label: t('col_fund_type'), sort: true },
  { key: 'unit', label: 'Unit', type: 'num', sort: true },
  { key: 'amount', label: t('col_amount'), type: 'idr', sort: true }, { key: 'final_amount', label: t('col_final_amount'), type: 'idr', sort: true },
  { key: 'referrer_code', label: t('col_referrer_code'), sort: true }, { key: 'sales_code', label: t('col_sales_code'), sort: true },
];

async function loadEvcTx() {
  if (!evcCodesArr().length) { toast(t('evc_enter_code')); return; }
  $('#evcTxTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const { rows, total } = await api(`/api/event-code/transactions?${evcTxQs(evcTx.limit, evcTx.offset)}`);
    evcTx.total = total;
    genTable('#evcTxTable', rows, EVC_TX_COLS, 'No transactions match these filters.', evcTx.sort);
    const start = total ? evcTx.offset + 1 : 0;
    const end = Math.min(evcTx.offset + evcTx.limit, total);
    $('#evcTxPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#evcTxPrev').disabled = evcTx.offset === 0;
    $('#evcTxNext').disabled = end >= total;
  } catch (e) { $('#evcTxTable').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

// One workbook with every panel of the tab, fetched fresh with the current
// filters: summary (filters, funnel, recap totals, portfolio status), daily
// recap, per code, users with portfolio, transactions (Transaction detail's
// own filters), both transaction cohorts and portfolio retention.
async function exportEvcWorkbook() {
  if (!evcCodesArr().length) { toast(t('evc_enter_code')); return; }
  const btn = $('#evcExportAll');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t('evc_export_building');
  try {
    const [funnel, recap, users, pf, cohReg, cohTx, tx] = await Promise.all([
      api(`/api/event-code/funnel?${evcBaseQs()}`),
      api(`/api/event-code/recap?${evcRecapQs()}`),
      evcFetchAllUsers(),
      api(`/api/event-code/portfolio?${evcPfQs()}`),
      api(`/api/event-code/cohort?${evcCohortQs('registration')}`),
      api(`/api/event-code/cohort?${evcCohortQs('first_tx')}`),
      api(`/api/event-code/transactions?${evcTxQs(EVC_EXPORT_MAX, 0)}`),
      loadExportLib('xlsx'),
    ]);
    const targets = evcTargets();
    const days = evcDayRows(recap, targets);
    const sum = (k) => days.reduce((a, d) => a + d[k], 0);
    const pfSummary = evcPfSummaryRows(pf);
    const yes = (b) => (b ? t('evc_yes') : t('evc_no'));
    const summary = [
      [t('evc_sheet_summary'), `${$('#evcFrom').value} – ${$('#evcTo').value}`],
      ['Field', $('#evcField').value],
      [t('evc_filters_title'), evcCodesArr().join(', ')],
      [t('evc_recap_type'), $('#evcRecapType').value || t('common_all_types')],
      [t('evc_new_only'), yes($('#evcNewOnly').checked)],
      [t('evc_target_reg'), targets.reg ?? ''],
      [t('evc_target_tx'), targets.tx ?? ''],
      [],
      [t('evc_funnel_title')],
      [t('evc_kpi_tagged'), Number(val(funnel.tagged)) || 0],
      [t('evc_kpi_verified'), Number(val(funnel.verified)) || 0],
      [t('evc_kpi_transacted'), Number(val(funnel.transacted)) || 0],
      [t('evc_kpi_repeat'), Number(val(funnel.repeat_transacted)) || 0],
      [],
      [t('evc_daily_title')],
      [t('evc_col_regs'), sum('registrations')],
      [t('evc_col_kyc'), sum('kyc_verified')],
      [t('evc_col_completed'), sum('tx_completed')],
      [t('evc_col_ongoing'), sum('tx_ongoing')],
      [t('evc_col_failed'), sum('tx_failed')],
      [t('evc_col_amt_completed'), sum('amount_completed')],
      [t('evc_col_amt_ongoing'), sum('amount_ongoing')],
      [t('evc_kpi_users'), Number(recap.transacting_users) || 0],
      [t('evc_col_new'), sum('new_transactors')],
      ...(targets.reg != null || targets.tx != null
        ? [[t('evc_kpi_days'), days.filter((d) => d.hit).length, fillT('evc_kpi_days_sub', { h: days.filter((d) => d.hit).length, n: days.length })]] : []),
      [],
      [t('evc_pf_title')],
      ...evcAoa(inScreenOrder(pfSummary, 'evcPfSummary', (r) => r.status), evcPfSummaryCols()),
      [],
      [t('evc_sheet_users'), fillT('evc_export_rows', { n: users.rows.length, total: users.total })],
      [t('evc_sheet_tx'), fillT('evc_export_rows', { n: tx.rows.length, total: tx.total }),
        fillT('evc_export_tx_filters', { from: $('#evcTxFrom').value || '…', to: $('#evcTxTo').value || '…',
          status: $('#evcTxStatus').value || t('common_all_statuses'), type: $('#evcTxType').value || t('common_all_types') })],
    ];
    const cohortAoa = (rows, wrapId) => evcAoa(inScreenOrder(evcTxCohortExportRows(rows), wrapId, (r) => r.cohort), [
      { key: 'cohort', label: t('evc_col_cohort') }, { key: 'period_offset', label: t('evc_col_offset'), type: 'num' },
      { key: 'cohort_size', label: t('evc_col_size'), type: 'num' }, { key: 'users', label: t('evc_col_users'), type: 'num' },
      { key: 'pct', label: t('evc_col_pct'), type: 'pct' },
    ]);
    const wb = XLSX.utils.book_new();
    const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31));
    add(t('evc_sheet_summary'), summary);
    add(t('evc_sheet_daily'), evcAoa(inScreenOrder(days, 'evcDailyTable', (d) => d.day), evcDailyCols(targets)));
    add(t('evc_sheet_codes'), evcAoa(inScreenOrder(evcCodeRows(recap), 'evcCodeTable', (r) => r.code), evcCodeCols()));
    add(t('evc_sheet_users'), evcAoa(evcUserRows(users.rows), evcUserCols()));
    add(t('evc_sheet_tx'), evcAoa(tx.rows, EVC_TX_COLS));
    add(t('evc_sheet_cohort_reg'), cohortAoa(cohReg, 'evcCohortRegHeatmap'));
    add(t('evc_sheet_cohort_tx'), cohortAoa(cohTx, 'evcCohortTxHeatmap'));
    add(t('evc_sheet_pf'), evcAoa(inScreenOrder(evcPfExportRows(pf), 'evcPfHeatmap', (r) => r.cohort), evcPfRetentionCols()));
    XLSX.writeFile(wb, `event_code_${evcFileSlug()}.xlsx`);
    if (users.total > users.rows.length || tx.total > tx.rows.length) toast(t('evc_export_truncated_any'));
  } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = label; }
}

// EXPLORER (multi-table)
function tagClass(v) {
  const k = String(v).toLowerCase();
  if (['buy', 'completed', 'active', 'verified'].includes(k)) return k === 'completed' || k === 'buy' ? k : 'completed';
  if (k === 'sell') return 'sell';
  if (['cancelled', 'expired', 'failed', 'inactive', 'unverified'].includes(k)) return 'cancelled';
  return 'other';
}

const ex = { meta: [], current: null, offset: 0, limit: 50, total: 0, sort: null };

function fmtCell(v, type) {
  v = val(v);
  if (v == null || v === '') return 'n/a';
  switch (type) {
    case 'idr': return idrFull(v);
    case 'num': return num(v);
    case 'num4': return Number(v).toFixed(4);
    case 'bool': return (v === true || v === 'true') ? 'Yes' : 'No';
    case 'datetime': return `<span class="mono">${String(v).replace('T', ' ').slice(0, 19)}</span>`;
    case 'date': return `<span class="mono">${String(v).slice(0, 10)}</span>`;
    case 'tag': return `<span class="tag ${tagClass(v)}">${escapeHtml(v)}</span>`;
    default: return escapeHtml(v);
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
  ex.current = key; ex.offset = 0; ex.sort = null;
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
      { source: 'explore', dataset: ex.current, format: fmt, filename: ex.current, filters: { ...exFilterValues(), ...sortParams(ex.sort) }, limit: 100000 },
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
  const qs = new URLSearchParams({ ...exFilterValues(), ...sortParams(ex.sort), limit: ex.limit, offset: ex.offset });
  try {
    const { rows, total } = await api(`/api/explore/${ex.current}?${qs}`);
    ex.total = total;
    renderExTable(d, rows);
    const start = total ? ex.offset + 1 : 0;
    const end = Math.min(ex.offset + ex.limit, total);
    $('#exPageinfo').textContent = `${num(start)}–${num(end)} of ${num(total)}`;
    $('#exPrev').disabled = ex.offset === 0;
    $('#exNext').disabled = end >= total;
  } catch (e) { $('#exTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderExTable(d, rows) {
  if (!rows.length) { $('#exTable').innerHTML = `<div class="empty">${t('msg_no_rows_match_these_filters')}</div>`; return; }
  const numTypes = ['idr', 'num', 'num4'];
  const head = d.columns.map((c) => sortTh(c.label, c.key, ex.sort, numTypes.includes(c.type) ? 'num' : '',
    numTypes.includes(c.type) || c.type === 'datetime' ? 'desc' : 'asc')).join('');
  const body = rows.map((r) => '<tr>' + d.columns.map((c) =>
    `<td class="${numTypes.includes(c.type) ? 'num' : ''}">${fmtCell(r[c.key], c.type)}</td>`).join('') + '</tr>').join('');
  $('#exTable').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// SQL LAB
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

function renderGenericTable(sel, rows, emptyMsg = 'Query returned no rows.') {
  if (!rows.length) { $(sel).innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
  const cols = Object.keys(rows[0]);
  const head = cols.map((c) => `<th data-key="${escapeHtml(c)}">${escapeHtml(c)}</th>`).join('');
  const body = rows.slice(0, 1000).map((r) => '<tr>' + cols.map((c) => {
    const v = val(r[c]);
    const isNum = typeof v === 'number';
    return `<td class="${isNum ? 'num' : ''}">${v == null ? 'n/a' : (isNum ? num(v) : escapeHtml(v))}</td>`;
  }).join('') + '</tr>').join('');
  const note = rows.length > 1000 ? `<div class="hint" style="padding:8px 12px">Showing first 1,000 of ${num(rows.length)} rows. Export for the full set.</div>` : '';
  $(sel).innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${note}`;
}

// EXPORTS

// Portfolio PDF column picker. 'Fund Name' isn't listed — it's always kept
// server-side as the row identity column.
const PDF_COLS_KEY = 'sk_pdf_cols';
const PDF_COLUMNS = [
  { key: 'fund_type', label: t('col_fund_type_2') },
  { key: 'unit', label: t('col_unit_balance') },
  { key: 'avg_buy_price', label: t('col_average_nav') },
  { key: 'nav', label: t('col_close_nav') },
  { key: 'fund_value', label: t('col_fund_value') },
  { key: 'value', label: t('col_market_value') },
  { key: 'gain_loss', label: t('col_unrealized_gain_loss') },
  { key: 'gain_pct', label: '%' },
];

function loadPdfColumnPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PDF_COLS_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (e) { /* corrupt or missing prefs, fall back to all columns */ }
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
  try {
    toast('Preparing export…');
    const res = await fetch(API_BASE + '/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ...body, ...screenSortFor(lastClickTarget) }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.error || 'Export failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filenameFromResponse(res, filename); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('msg_export_ready'));
  } catch (e) { toast(`Export failed: ${e.message}`); }
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
  try {
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
    toast(t('msg_google_sheet_ready'));
  } catch (e) {
    if (tab) tab.close();
    toast(`Google Sheets export failed: ${e.message}`);
  }
}

// Runs up to `limit` of these async calls at once instead of one after
// another — used where each item is an independent request (no ordering or
// shared-state dependency between them) so serializing them would only add
// latency without adding safety.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// BULK EXPORT — shared by the 5 Portfolio tabs (PWC, Fix, TX, SInvest,
// Explorer). Builds a list of investors — one at a time via that tab's own
// search results ("+" on a row, see bulkAddCell/wireBulkAddButtons below), or
// in bulk by referrer_code/sales_code — shown as a tick list with both codes,
// everyone ticked by default. A code search matches any code containing the
// text (alex also finds ALEXANDER), so only ticked investors are summarised
// or exported:
// "combined" hits /api/export/batch for one file (CSV rows tagged with
// SID/name, XLSX one sheet per investor, PDF one page per investor);
// "separate" just calls the normal single-investor download() once per
// investor in the list, same as clicking each one's own Export button in turn.
function setupBulkExport({ prefix: p, source }) {
  const basket = new Map(); // userId -> { userId, sid, name, email, referrerCode, salesCode, checked }
  const picked = () => [...basket.values()].filter((u) => u.checked);

  // Ticking only updates the count, so keyboard focus stays on the box.
  function syncPicked() {
    const n = picked().length;
    $(`#${p}BulkCount`).textContent = `${n} / ${basket.size}`;
    const all = $(`#${p}BulkList .bulk-all`);
    if (all) { all.checked = n === basket.size; all.indeterminate = n > 0 && n < basket.size; }
    // The selection changed, so any summary already on screen is stale —
    // hide it rather than leave numbers up that no longer match the basket.
    $(`#${p}BulkSummary`).classList.add('hidden');
  }

  function render() {
    const entries = [...basket.values()];
    $(`#${p}BulkBar`).classList.toggle('hidden', !entries.length);
    const cell = (v) => (v ? escapeHtml(v) : 'n/a');
    $(`#${p}BulkList`).innerHTML = entries.length ? `<table><thead><tr>
        <th class="pick"><label><input type="checkbox" class="bulk-all" aria-label="${t('bulk_tick_all')}"></label></th>
        <th>SID</th><th>${t('bulk_col_name')}</th><th>${t('bulk_field_referrer')}</th><th>${t('bulk_field_sales')}</th>
      </tr></thead><tbody>${entries.map((u) => `<tr>
        <td class="pick"><label><input type="checkbox" data-id="${escapeHtml(u.userId)}" aria-label="${escapeHtml(u.name || u.sid)}"${u.checked ? ' checked' : ''}></label></td>
        <td>${cell(u.sid)}</td><td>${cell(u.name)}</td><td>${cell(u.referrerCode)}</td><td>${cell(u.salesCode)}</td>
      </tr>`).join('')}</tbody></table>` : '';
    syncPicked();
  }

  function addOne(u) {
    if (!u || !u.userId || basket.has(u.userId)) return false;
    basket.set(u.userId, { ...u, checked: true });
    return true;
  }

  function addMany(rows, label) {
    let added = 0;
    (rows || []).forEach((r) => {
      if (addOne({
        userId: val(r.user_id), sid: val(r.sid) || '', name: val(r.name) || val(r.sid) || '', email: val(r.email) || '',
        referrerCode: val(r.referrer_code) || '', salesCode: val(r.sales_code) || '',
      })) added++;
    });
    render();
    const skipped = (rows || []).length - added;
    toast((rows || []).length
      ? `${added} investor${added === 1 ? '' : 's'} added${label ? ` from ${label}` : ''}${skipped ? `, ${skipped} already in the list` : ''}.`
      : 'No matching investor.');
  }

  async function searchByCode() {
    const field = $(`#${p}BulkField`).value;
    const code = $(`#${p}BulkCode`).value.trim();
    if (!code) return;
    try { addMany(await api(`/api/users/by-code?field=${field}&code=${encodeURIComponent(code)}`), code); }
    catch (e) { toast(e.message); }
  }

  const batchFilename = (format) => `${source.replace('_full', '')}_batch_${picked().length}_${new Date().toISOString().slice(0, 10)}.${format}`;

  // Both export modes hit /api/export/batch (never /api/export) so both stay
  // portfolio-only — that route never appends fund-performance sheets/pages,
  // unlike the single-investor export, which is exactly what bulk export
  // should never include (a list of holdings, not a full fund report).
  async function fetchBatchBlob(body, filenameFallback) {
    const res = await fetch(API_BASE + '/api/export/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.error || 'Export failed'); return null; }
    const blob = await res.blob();
    return { blob, filename: filenameFromResponse(res, filenameFallback) };
  }

  async function exportCombined(format) {
    const date = $(`#${p}BulkDate`).value;
    const filename = batchFilename(format);
    const body = {
      source, format, filename,
      users: picked().map((u) => ({ userId: u.userId, sid: u.sid, ...(date ? { date } : {}) })),
      ...(format === 'pdf' ? { columns: selectedPdfColumns() } : {}),
    };
    const result = await fetchBatchBlob(body, filename);
    if (!result) return;
    downloadBlob(result.blob, result.filename);
    toast(t('msg_export_ready'));
  }

  // One /api/export/batch call per investor (a 1-element users array each),
  // zipped into a single download — a real .zip, not N separate browser
  // downloads landing one after another. Up to 5 investors in flight at once
  // — each request is independent, so running them one at a time only added
  // wait time (50 investors serially could take 50-150+s); unbounded
  // parallelism would just trade that for a 50-request burst on one call.
  async function exportSeparate(format) {
    const date = $(`#${p}BulkDate`).value;
    await loadExportLib('zip');
    const zip = new JSZip();
    const results = await mapLimit(picked(), 5, (u) => {
      const filename = `${source.replace('_full', '')}_${u.sid || u.userId}${date ? '_' + date : ''}`;
      const body = {
        source, format, filename,
        users: [{ userId: u.userId, sid: u.sid, ...(date ? { date } : {}) }],
        ...(format === 'pdf' ? { columns: selectedPdfColumns() } : {}),
      };
      return fetchBatchBlob(body, `${filename}.${format}`);
    });
    let ok = 0;
    results.forEach((result) => { if (result) { zip.file(result.filename, result.blob); ok++; } });
    if (!ok) return; // fetchBatchBlob already toasted whatever went wrong
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${source.replace('_full', '')}_batch_${ok}_${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`Export ready (${ok} file${ok === 1 ? '' : 's'} zipped)`);
  }

  function runExport(format) {
    if (!basket.size) { toast(t('msg_add_at_least_one_investor_first')); return; }
    if (!picked().length) { toast(t('bulk_none_ticked')); return; }
    ($(`#${p}BulkMode`).value === 'separate' ? exportSeparate : exportCombined)(format);
  }

  // Combined AUM and holdings-by-fund across every investor currently in the
  // basket, so an admin can sanity-check a selection before spending an
  // export on it. avg_buy_price is derived (fund_value / unit) purely so the
  // existing holdingsTableHtml() renderer — built for one investor's rows —
  // can be reused as-is for the aggregated ones, instead of a second table
  // renderer that would just recompute the same fundValue/gain/pct math.
  async function loadSummary() {
    const users = picked();
    if (!users.length) { toast(t(basket.size ? 'bulk_none_ticked' : 'bulk_add_first')); return; }
    const date = $(`#${p}BulkDate`).value;
    $(`#${p}BulkSummary`).classList.remove('hidden');
    $(`#${p}BulkSummaryKpis`).innerHTML = '<div class="loading">Loading…</div>';
    $(`#${p}BulkSummaryHoldings`).innerHTML = '';
    $(`#${p}BulkSummaryInvestors`).innerHTML = '';
    try {
      const summary = await api('/api/portfolio/bulk-summary', {
        method: 'POST',
        body: JSON.stringify({ source, users: users.map((u) => ({ userId: u.userId, sid: u.sid, ...(date ? { date } : {}) })) }),
      });
      $(`#${p}BulkSummaryKpis`).innerHTML = [
        kpi(t('bulk_kpi_total_aum'), idrFull(summary.totalAum), t('bulk_kpi_investor_count').replace('{n}', summary.count).replace('{s}', summary.count === 1 ? '' : 's'), 'accent'),
        kpi(t('bulk_kpi_funds_held'), num(summary.funds.length), t('bulk_kpi_funds_held_sub')),
      ].join('');
      const fundsWithAvg = summary.funds.map((f) => ({ ...f, avg_buy_price: f.unit ? f.fund_value / f.unit : null }));
      $(`#${p}BulkSummaryHoldings`).innerHTML = holdingsTableHtml(fundsWithAvg);
      // Contact detail (email/phone/referrer/sales code) is shown here only —
      // the actual export files never include it, just SID/name.
      genTable(`#${p}BulkSummaryInvestors`, summary.investors, [
        { key: 'sid', label: 'SID' }, { key: 'name', label: t('col_name') }, { key: 'email', label: 'Email' },
        { key: 'phone', label: t('col_phone') }, { key: 'referrer_code', label: t('col_referrer_code') }, { key: 'sales_code', label: t('col_sales_code') },
        { key: 'aum', label: 'AUM', type: 'idr' },
      ], 'No holdings found.');
    } catch (e) {
      $(`#${p}BulkSummaryKpis`).innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    }
  }

  $(`#${p}BulkSearchBtn`).addEventListener('click', searchByCode);
  $(`#${p}BulkCode`).addEventListener('keydown', (e) => { if (e.key === 'Enter') searchByCode(); });
  $(`#${p}BulkClear`).addEventListener('click', () => { basket.clear(); render(); });
  $(`#${p}BulkList`).addEventListener('change', (e) => {
    const box = e.target;
    if (box.classList.contains('bulk-all')) {
      basket.forEach((u) => { u.checked = box.checked; });
      $$(`#${p}BulkList tbody input`).forEach((c) => { c.checked = box.checked; });
    } else if (basket.has(box.dataset.id)) {
      basket.get(box.dataset.id).checked = box.checked;
    }
    syncPicked();
  });
  $(`#${p}BulkSummaryBtn`).addEventListener('click', loadSummary);
  $(`#${p}BulkCsv`).addEventListener('click', () => runExport('csv'));
  $(`#${p}BulkXlsx`).addEventListener('click', () => runExport('xlsx'));
  $(`#${p}BulkPdf`).addEventListener('click', () => runExport('pdf'));

  return { addOne: (u) => { const ok = addOne(u); render(); if (!ok) toast(t('msg_already_in_the_list')); return ok; } };
}

// "+" button appended to a Portfolio-tab search-results row — adds that
// investor straight to the tab's bulk-export basket without opening their
// full detail view (which fires several extra queries the basket doesn't need).
function bulkAddCell(r) {
  const name = String(val(r.name) || val(r.sid) || '').replace(/"/g, '&quot;');
  const attr = (v) => escapeHtml(val(v) || '');
  return `<td><button type="button" class="btn-ghost bulk-add-btn" data-id="${val(r.user_id)}" data-sid="${val(r.sid) || ''}" data-name="${name}" data-email="${val(r.email) || ''}" data-ref="${attr(r.referrer_code)}" data-sales="${attr(r.sales_code)}" title="Add to export list">+ Add</button></td>`;
}
function wireBulkAddButtons(containerSel, bulk) {
  $$(`${containerSel} .bulk-add-btn`).forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    bulk.addOne({
      userId: btn.dataset.id, sid: btn.dataset.sid, name: btn.dataset.name, email: btn.dataset.email,
      referrerCode: btn.dataset.ref, salesCode: btn.dataset.sales,
    });
  }));
}

let pfBulk, pfxBulk, ptxBulk, psiBulk, peBulk;

// SEND STATEMENT (email an investor their portfolio — holdings only, no
// fund performance — and/or their monthly transaction e-statement).
// Separate tab from Portfolio (PWC) on purpose: this is a sending tool,
// not a lookup dashboard, so it gets its own search + selection state.
async function searchSendStatementUsers() {
  const q = $('#ssSearchInput').value.trim();
  if (!q) return;
  $('#ssResults').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const rows = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderSsResults(rows);
  } catch (e) { $('#ssResults').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function renderSsResults(rows) {
  if (!rows.length) { $('#ssResults').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
  const body = rows.map((r) => `<tr class="pf-row" tabindex="0" role="button" data-id="${val(r.user_id)}" data-sid="${val(r.sid)}" data-name="${escapeHtml(val(r.name) || '')}" data-email="${escapeHtml(val(r.email) || '')}" style="cursor:pointer">
      <td>${escapeHtml(val(r.sid) || 'n/a')}</td><td>${escapeHtml(val(r.name) || 'n/a')}</td><td>${escapeHtml(val(r.email) || 'n/a')}</td><td>${escapeHtml(val(r.ifua) || 'n/a')}</td>
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
  loadSsPreview();
}

// Same holdings/transactions the PDFs would contain (see /api/statement/preview),
// shown as a sanity check before the admin actually sends anything. Re-fetched
// whenever the checkboxes or date/month change.
async function loadSsPreview() {
  if (!ssSelected) return;
  const sendPortfolio = $('#ssSendPortfolio').checked;
  const portfolioDate = $('#ssPortfolioDate').value;
  const sendStatement = $('#ssSendStatement').checked && !!$('#ssStatementMonth').value;
  const statementMonth = $('#ssStatementMonth').value;

  $('#ssPreviewPortfolio').classList.toggle('hidden', !sendPortfolio);
  $('#ssPreviewStatement').classList.toggle('hidden', !sendStatement);
  if (!sendPortfolio && !sendStatement) return;

  if (sendPortfolio) $('#ssPreviewPortfolioTable').innerHTML = '<div class="loading">Loading…</div>';
  if (sendStatement) $('#ssPreviewStatementTable').innerHTML = '<div class="loading">Loading…</div>';
  const params = new URLSearchParams({
    userId: ssSelected.userId, sid: ssSelected.sid,
    sendPortfolio: String(sendPortfolio), portfolioDate,
    sendStatement: String(sendStatement), statementMonth,
  });
  try {
    const data = await api(`/api/statement/preview?${params}`);
    if (sendPortfolio) renderGenericTable('#ssPreviewPortfolioTable', data.holdings || [], 'No active holdings.');
    if (sendStatement) renderGenericTable('#ssPreviewStatementTable', data.transactions || [], 'No transactions this period.');
  } catch (e) {
    if (sendPortfolio) $('#ssPreviewPortfolioTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
    if (sendStatement) $('#ssPreviewStatementTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`;
  }
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
    subject: `Your Sayakaya Statement, ${periodLabel}`,
    body: `Dear ${name || 'Investor'},\n\nPlease find attached ${parts.join(' and ')}, issued by PT Sayakaya Lahir Batin.\n\nTo open the attached PDF file(s), use your date of birth as registered with us in DDMMYYYY format (e.g. 17081990 for 17 August 1990).\n\nIf any details appear incorrect, please contact our support team.\n\nBest regards,\nPT Sayakaya Lahir Batin`,
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
  loadSsLog();
}

// Who sent what to whom, from this tool — not the superuser-only Activity
// log, so anyone with the Send statement tab can see the send history.
async function loadSsLog() {
  $('#ssLogTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const rows = await api('/api/statement/log');
    const mapped = rows.map((r) => ({ ...r, created_at: toJakartaTime(val(r.created_at)) }));
    genTable('#ssLogTable', mapped, [
      { key: 'created_at', label: t('col_when_wib') },
      { key: 'username', label: t('col_sent_by') },
      { key: 'detail', label: t('col_sent') },
    ], 'No statements sent yet.');
  } catch (e) { $('#ssLogTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// Send statement (batch): same portfolio/e-statement documents to
// picked and/or pasted investors (emails/SIDs), resolved server-side (one
// email per matching recipient — see /api/statement/email-batch).

// Search-and-pick list behind both Send tabs' bulk sends: search by name
// (* wildcard), SID, email, or phone (see queries.js userSearch), then
// "+ Add" one person at a time. Only people with an email on file can be
// added, since every send goes to the email on file.
function setupRecipientPicker(p) {
  const picked = new Map(); // user_id -> { sid, name, email }
  const el = (n) => $(`#${p}${n}`);

  async function search() {
    const q = el('SearchInput').value.trim();
    if (!q) return;
    el('Results').innerHTML = '<div class="loading">Searching…</div>';
    try { renderResults(await api(`/api/users/search?q=${encodeURIComponent(q)}`)); }
    catch (e) { el('Results').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
  }

  function renderResults(rows) {
    if (!rows.length) { el('Results').innerHTML = `<div class="empty">${t('msg_no_matching_investor')}</div>`; return; }
    const body = rows.map((r, i) => {
      const action = val(r.email)
        ? `<button type="button" class="btn-ghost picker-add-btn" data-i="${i}">+ Add</button>`
        : '<span class="hint">No email</span>';
      const cell = (v) => `<td>${escapeHtml(val(v) || 'n/a')}</td>`;
      return `<tr>${cell(r.sid)}${cell(r.name)}${cell(r.email)}${cell(r.phone)}<td>${action}</td></tr>`;
    }).join('');
    el('Results').innerHTML = `<table><thead><tr><th>SID</th><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
    $$(`#${p}Results .picker-add-btn`).forEach((btn) => btn.addEventListener('click', () => {
      const r = rows[btn.dataset.i];
      const id = String(val(r.user_id));
      if (picked.has(id)) { toast(t('msg_already_added')); return; }
      picked.set(id, { sid: val(r.sid) || '', name: val(r.name) || '', email: val(r.email) });
      render();
    }));
  }

  function render() {
    el('PickedCount').textContent = picked.size;
    el('PickedList').innerHTML = picked.size
      ? [...picked].map(([id, u]) => {
        const label = `${u.name || u.email}${u.sid ? ` · ${u.sid}` : ''}`;
        return `<button type="button" class="chip" data-id="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(label)}">${escapeHtml(label)} ✕</button>`;
      }).join('')
      : '<span class="hint">None picked yet.</span>';
    $$(`#${p}PickedList .chip`).forEach((c) => c.addEventListener('click', () => { picked.delete(c.dataset.id); render(); }));
  }

  el('SearchBtn').addEventListener('click', search);
  el('SearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  render();
  return { list: () => [...picked.values()] };
}
let ssBatchPicker, fpePicker;

// Splits on newlines/commas/semicolons — each entry is either a SID or an
// email, so (unlike parsePastedEmails) nothing is filtered by an email regex.
// A direct batch send builds every email in one request, and an edge
// function gets ~2 s of CPU (a statement's two PDFs take ~40 ms), so longer
// lists go through the schedule queue as a one-off send (openSchedOnce).
const BATCH_DIRECT_MAX = { statement: 10, fund_performance: 50 };

function parseBatchIdentifiers(text) {
  return [...new Set((text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))];
}

let ssBatchIdentifiers = [];
function openSsBatchCompose() {
  const sendPortfolio = $('#ssBatchSendPortfolio').checked;
  const sendStatement = $('#ssBatchSendStatement').checked;
  if (!sendPortfolio && !sendStatement) { toast(t('msg_pick_at_least_one_document_to_send')); return; }
  const portfolioDate = $('#ssBatchPortfolioDate').value;
  const statementMonth = $('#ssBatchStatementMonth').value;
  if (sendStatement && !statementMonth) { toast(t('msg_pick_a_month_for_the_transaction_e_state')); return; }
  const group = $('#ssBatchRecipientType').value;
  const docs = [sendPortfolio && 'the live portfolio (as of the send date)', sendStatement && `the transaction e-statement for ${statementMonth}`].filter(Boolean).join(' and ');
  if (group !== 'list') {
    openSchedOnce('statement', group, { sendPortfolio, sendStatement, statementMonth: sendStatement ? statementMonth : null },
      `Sends once, right away: ${docs}, as chosen in Batch send.`,
      defaultStatementEmail({ sendPortfolio, portfolioDate: '', sendStatement, statementMonth }));
    return;
  }
  // A picked investor goes by SID (exact match server-side), or their email
  // if they have no SID yet.
  const picked = ssBatchPicker.list().map((u) => u.sid || u.email);
  ssBatchIdentifiers = [...new Set([...picked, ...parseBatchIdentifiers($('#ssBatchInput').value)])];
  if (!ssBatchIdentifiers.length) { toast(t('msg_add_or_paste_at_least_one_investor')); return; }
  if (ssBatchIdentifiers.length > BATCH_DIRECT_MAX.statement) {
    openSchedOnce('statement', 'csv_list', { sendPortfolio, sendStatement, statementMonth: sendStatement ? statementMonth : null },
      `${num(ssBatchIdentifiers.length)} emails/SIDs is more than ${BATCH_DIRECT_MAX.statement}, so they go out once, right away, from the queue: ${docs}.`
        + (portfolioDate ? ' The portfolio date is not used; queued sends attach the live portfolio.' : ''),
      defaultStatementEmail({ sendPortfolio, portfolioDate: '', sendStatement, statementMonth }), ssBatchIdentifiers);
    return;
  }
  const { subject, body } = defaultStatementEmail({ sendPortfolio, portfolioDate, sendStatement, statementMonth });
  $('#ssBatchEmailTo').textContent = `Will be matched against ${ssBatchIdentifiers.length} picked or pasted email/SID${ssBatchIdentifiers.length === 1 ? '' : 's'} and sent to each investor found.`;
  $('#ssBatchEmailSubject').value = subject;
  $('#ssBatchEmailBody').value = body;
  $('#ssBatchEmailModal').showModal();
}

async function sendSsBatchEmail() {
  try {
    const res = await fetch(API_BASE + '/api/statement/email-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        identifiers: ssBatchIdentifiers,
        sendPortfolio: $('#ssBatchSendPortfolio').checked, portfolioDate: $('#ssBatchPortfolioDate').value,
        sendStatement: $('#ssBatchSendStatement').checked, statementMonth: $('#ssBatchStatementMonth').value,
        subject: $('#ssBatchEmailSubject').value, body: $('#ssBatchEmailBody').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Batch email failed'); return; }
    const parts = [`${data.sent.length} sent`];
    if (data.failed?.length) parts.push(`${data.failed.length} failed`);
    if (data.notFound?.length) parts.push(`${data.notFound.length} not found`);
    if (data.excluded?.length) parts.push(`${data.excluded.length} skipped (exclusion list)`);
    toast(parts.join(', '));
    loadSsLog();
  } catch (e) { toast(e.message); }
}

// SEND FUND PERFORMANCE (broadcast the Reksa Dana Update PDF to a picked
// or pasted list of emails). Separate tool from Send statement, which is
// scoped to one investor's own portfolio/e-statement.
// Splits on newlines, commas, and semicolons so either a one-per-line paste
// or a comma-separated list works; silently drops anything that isn't a
// plausible email instead of blocking the whole paste on one typo.
function parsePastedEmails(text) {
  return [...new Set((text || '').split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
}

// "Funds in the report" (Send fund performance page + its schedule modal):
// all funds, by category, or picked funds. The fund list loads on first use
// and is shared by both. read() returns the API's fundFilter: null for all
// funds, otherwise { types } or { fundIds }.
let fpeFundsPromise = null;
function setupFundScope(p) {
  const el = (n) => $(`#${p}FundScope${n}`);
  const chk = (value, label, sub) => `<label class="ask-table-chk"><input type="checkbox" value="${escapeHtml(value)}"> ${escapeHtml(label)}${sub ? ` <small>${escapeHtml(sub)}</small>` : ''}</label>`;
  let loaded = false;

  async function load() {
    if (loaded) return;
    el('Types').innerHTML = el('FundList').innerHTML = '<div class="loading">Loading funds…</div>';
    try {
      const funds = (await (fpeFundsPromise ||= api('/api/funds/list')))
        .map((f) => ({ id: val(f.id), name: val(f.name) || val(f.id), type: val(f.type) || '(none)' }));
      if (!funds.length) { el('Types').innerHTML = el('FundList').innerHTML = `<div class="empty">${t('msg_no_active_funds_found')}</div>`; return; }
      el('Types').innerHTML = [...new Set(funds.map((f) => f.type))].sort().map((ty) => chk(ty, ty)).join('');
      el('FundList').innerHTML = funds.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
        .map((f) => chk(f.id, f.name, f.type)).join('');
      loaded = true;
    } catch (e) {
      fpeFundsPromise = null; // next open retries instead of reusing the failure
      el('Types').innerHTML = el('FundList').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    }
  }
  function sync() {
    const scope = el('').value;
    el('Types').classList.toggle('hidden', scope !== 'types');
    el('Funds').classList.toggle('hidden', scope !== 'funds');
    if (scope !== 'all') load();
  }
  el('').addEventListener('change', sync);
  el('Filter').addEventListener('input', () => {
    const q = el('Filter').value.trim().toLowerCase();
    $$(`#${p}FundScopeFundList label`).forEach((l) => l.classList.toggle('hidden', !!q && !l.textContent.toLowerCase().includes(q)));
  });
  return {
    read() {
      const scope = el('').value;
      if (scope === 'all') return null;
      const picked = $$(`#${p}FundScope${scope === 'types' ? 'Types' : 'FundList'} input:checked`).map((c) => c.value);
      if (!picked.length) throw new Error(scope === 'types' ? 'Pick at least one fund category.' : 'Pick at least one fund.');
      return scope === 'types' ? { types: picked } : { fundIds: picked };
    },
    reset() {
      el('').value = 'all';
      el('Filter').value = '';
      $$(`#${p}FundScopeTypes input, #${p}FundScopeFundList input`).forEach((c) => { c.checked = false; });
      $$(`#${p}FundScopeFundList label`).forEach((l) => l.classList.remove('hidden'));
      sync();
    },
  };
}
let fpeScope, fpeSchedScope;
function fundScopeSummary(f) {
  if (!f) return 'all funds';
  return f.types?.length ? f.types.join(', ') : `${f.fundIds.length} fund${f.fundIds.length === 1 ? '' : 's'}`;
}

let fpeRecipients = [];
let fpeFundFilter = null;
function fpeDefaultEmail(asOf) {
  return {
    subject: `Sayakaya Fund Performance Update${asOf ? `, ${asOf}` : ''}`,
    body: 'Dear Investor,\n\nPlease find attached our latest fund performance update (Reksa Dana Update), issued by PT Sayakaya Lahir Batin.\n\nBest regards,\nPT Sayakaya Lahir Batin',
  };
}

function openFpeCompose() {
  const pasted = parsePastedEmails($('#fpePasteEmails').value);
  try { fpeFundFilter = fpeScope.read(); } catch (e) { toast(e.message); return; }
  const asOf = $('#fpeAsOf').value;
  const group = $('#fpeRecipientType').value;
  if (group !== 'list') {
    openSchedOnce('fund_performance', group, { fundFilter: fpeFundFilter, navAsOf: asOf || null },
      `Sends once, right away: the Reksa Dana Update PDF (${fundScopeSummary(fpeFundFilter)}, NAV ${asOf ? `as of ${asOf}` : 'of the latest date'}), as chosen on this page.`,
      fpeDefaultEmail(asOf));
    return;
  }
  fpeRecipients = [...new Set([...fpePicker.list().map((u) => u.email.toLowerCase()), ...pasted])];
  if (!fpeRecipients.length) { toast(t('msg_add_at_least_one_recipient')); return; }
  if (fpeRecipients.length > BATCH_DIRECT_MAX.fund_performance) {
    openSchedOnce('fund_performance', 'csv_list', { fundFilter: fpeFundFilter, navAsOf: asOf || null },
      `${num(fpeRecipients.length)} emails is more than ${BATCH_DIRECT_MAX.fund_performance}, so they go out once, right away, from the queue: the Reksa Dana Update PDF (${fundScopeSummary(fpeFundFilter)}, NAV ${asOf ? `as of ${asOf}` : 'of the latest date'}).`,
      fpeDefaultEmail(asOf), fpeRecipients);
    return;
  }
  $('#fpeEmailTo').textContent = `Will be sent to ${fpeRecipients.length} recipient${fpeRecipients.length === 1 ? '' : 's'}.`;
  const { subject, body } = fpeDefaultEmail(asOf);
  $('#fpeEmailSubject').value = subject;
  $('#fpeEmailBody').value = body;
  $('#fpeEmailModal').showModal();
}

async function sendFpeEmail() {
  try {
    const res = await fetch(API_BASE + '/api/fund-performance/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        to: fpeRecipients, subject: $('#fpeEmailSubject').value, body: $('#fpeEmailBody').value, asOf: $('#fpeAsOf').value,
        fundFilter: fpeFundFilter,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Email failed'); return; }
    const failedNote = data.failed?.length ? `, ${data.failed.length} failed` : '';
    const exclNoteText = data.excluded?.length ? `, ${data.excluded.length} skipped (exclusion list)` : '';
    toast(`Sent to ${data.sent.length} recipient${data.sent.length === 1 ? '' : 's'}${failedNote}${exclNoteText}`);
    loadFpeLog();
  } catch { toast(t('msg_could_not_reach_the_server')); }
}

async function loadFpeLog() {
  $('#fpeLogTable').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const rows = await api('/api/fund-performance/log');
    const mapped = rows.map((r) => ({ ...r, created_at: toJakartaTime(val(r.created_at)) }));
    genTable('#fpeLogTable', mapped, [
      { key: 'created_at', label: t('col_when_wib') },
      { key: 'username', label: t('col_sent_by') },
      { key: 'detail', label: t('col_sent') },
    ], 'No fund performance emails sent yet.');
  } catch (e) { $('#fpeLogTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

// SCHEDULED / AUTOMATED SENDING — shared by Send statement ('statement')
// and Send fund performance ('fund_performance'); server/schedules.js does
// the actual scheduling/OTP/recipient-resolution work. A schedule is only
// ever created via the OTP request/confirm pair — there's no direct
// "create" call from here.
function schedCfg(kind) {
  return kind === 'statement' ? { kind, prefix: 'ssSched' } : { kind, prefix: 'fpeSched' };
}
function schedEl(prefix, name) { return $('#' + prefix + name); }

let schedOtpState = null; // { kind, otpId }, set once step 1 succeeds

async function loadSchedules(kind) {
  const { prefix } = schedCfg(kind);
  schedEl(prefix, 'Table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const rows = await api(`/api/schedules?kind=${kind}`);
    renderSchedules(kind, rows);
    // Keep the Emails column moving while a send is in progress.
    clearTimeout(schedRefreshTimer[kind]);
    if (rows.some((r) => r.progress && r.progress.waiting)) schedRefreshTimer[kind] = setTimeout(() => loadSchedules(kind), 15000);
  } catch (e) { schedEl(prefix, 'Table').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}
const schedRefreshTimer = {};

const SCHED_RECIPIENT_LABEL = { single_email: null, csv_list: null, all_aum: 'All investors with AUM', active_aum: 'Investors with AUM in active funds', active_aum_verified: 'Verified investors with AUM in active funds', all_registered: 'All registered users' };
function schedRecipientSummary(row) {
  if (row.recipient_type === 'single_email') return val(row.recipient_email);
  if (row.recipient_type === 'csv_list') return `${(row.recipient_list || []).length} emails`;
  return SCHED_RECIPIENT_LABEL[row.recipient_type] || row.recipient_type;
}
const SCHED_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// A group send ('once') ends the moment it is queued, but its emails keep
// going out for a while: label it by its queue, and let it be paused until done.
const schedSending = (r) => r.frequency === 'once' && !!(r.progress && r.progress.waiting);
function schedStatusLabel(r) {
  if (r.status === 'paused') return 'Paused';
  if (r.frequency === 'once') return schedSending(r) ? 'Sending' : 'Done';
  return r.status === 'active' ? 'Active' : 'Ended';
}
const schedCanToggle = (r) => r.status !== 'ended' || schedSending(r);
// Emails queued for a schedule, all runs together (listJobs adds `progress`).
function schedProgressSummary(p) {
  if (!p) return 'n/a';
  return [`${num(p.sent)} sent`, p.waiting && `${num(p.waiting)} waiting`, p.failed && `${num(p.failed)} failed`, p.skipped && `${num(p.skipped)} skipped`].filter(Boolean).join(' · ');
}
function schedFrequencySummary(row) {
  if (row.frequency === 'once') return 'Once, right away';
  if (row.frequency === 'daily') return `Daily @ ${row.run_time}`;
  if (row.frequency === 'weekly') return `Weekly (${SCHED_WEEKDAYS[row.day_of_week] || '?'}) @ ${row.run_time}`;
  if (row.frequency === 'monthly_last_day') return `End of month @ ${row.run_time}`;
  if (row.frequency === 'monthly_day') return `Day ${row.day_of_month} of month @ ${row.run_time}`;
  return row.frequency;
}

// Not built with genTable() — schedules need per-row Pause/Resume/Delete
// buttons, which genTable's plain-cell renderer doesn't support.
function renderSchedules(kind, rows) {
  const { prefix } = schedCfg(kind);
  const tableEl = schedEl(prefix, 'Table');
  if (!rows.length) { tableEl.innerHTML = `<div class="empty">${t('msg_no_schedules_yet')}</div>`; return; }
  const body = rows.map((r) => `<tr>
      <td>${escapeHtml(schedRecipientSummary(r))}</td>
      <td>${escapeHtml(schedFrequencySummary(r))}</td>
      <td>${r.kind === 'statement' ? [r.send_portfolio && 'Portfolio', r.send_statement && `E-statement${r.statement_month ? ` ${escapeHtml(r.statement_month)}` : ''}`].filter(Boolean).join(' + ') : `Fund performance (${escapeHtml(fundScopeSummary(r.fund_filter))}${r.nav_as_of ? `, NAV ${escapeHtml(r.nav_as_of)}` : ''})`}</td>
      <td>${schedStatusLabel(r)}</td>
      <td>${r.end_date || 'n/a'}</td>
      <td>${r.next_run_at ? toJakartaTime(r.next_run_at) : 'n/a'}</td>
      <td>${r.last_run_at ? toJakartaTime(r.last_run_at) : 'n/a'}</td>
      <td class="num">${num(r.run_count)}</td>
      <td>${escapeHtml(schedProgressSummary(r.progress))}</td>
      <td>${escapeHtml(r.created_by_username || 'n/a')}</td>
      <td>
        <button type="button" class="btn-ghost sched-detail-btn" data-id="${r.id}">Detail</button>
        ${schedCanToggle(r) ? `<button type="button" class="btn-ghost sched-toggle-btn" data-id="${r.id}" data-status="${r.status === 'paused' ? 'paused' : 'active'}">${r.status === 'paused' ? 'Resume' : 'Pause'}</button>` : ''}
        <button type="button" class="btn-ghost sched-delete-btn" data-id="${r.id}">Delete</button>
      </td>
    </tr>`).join('');
  tableEl.innerHTML = `<table><thead><tr>
      <th>Recipients</th><th>Schedule</th><th>Sends</th><th>Status</th><th>Ends</th><th>Next run (WIB)</th><th>Last run (WIB)</th><th class="num">Times sent</th><th>Emails</th><th>Created by</th><th></th>
    </tr></thead><tbody>${body}</tbody></table>`;
  $$(`#${prefix}Table .sched-detail-btn`).forEach((btn) => btn.addEventListener('click', () => openSchedDetail(kind, btn.dataset.id)));
  $$(`#${prefix}Table .sched-toggle-btn`).forEach((btn) => btn.addEventListener('click', async () => {
    const pausing = btn.dataset.status === 'active';
    if (!confirm(pausing
      ? 'Pause this schedule? It will stop sending until resumed.'
      : 'Resume this schedule? If a send came due while it was paused, it goes out now, then the next run date is refreshed.')) return;
    // Resuming runs the job's due send before answering, so it can take a while.
    btn.disabled = true;
    btn.textContent = pausing ? 'Pausing…' : 'Resuming…';
    try {
      const { job } = await api(`/api/schedules/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: pausing ? 'paused' : 'active' }) });
      if (pausing) toast(t('msg_schedule_paused'));
      else if (job.status === 'ended') toast(t('msg_schedule_resumed_and_finished_its_end_da'));
      else toast(`Schedule resumed. Next run: ${job.next_run_at ? `${toJakartaTime(job.next_run_at)} WIB` : 'n/a'}.`);
    } catch (e) { toast(e.message); }
    loadSchedules(kind);
  }));
  $$(`#${prefix}Table .sched-delete-btn`).forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this schedule? This cannot be undone.')) return;
    try { await api(`/api/schedules/${btn.dataset.id}`, { method: 'DELETE' }); loadSchedules(kind); } catch (e) { toast(e.message); }
  }));
}

// Per-recipient breakdown: name/SID (resolved server-side), send status, and
// whether they currently hold a portfolio / transacted last month — "n/a" for
// recipients that never resolved to a known investor (a plain email on a
// Send fund performance list), not a false "No".
const SCHED_YN = (v) => (v == null ? 'n/a' : v ? 'Yes' : 'No');
async function openSchedDetail(kind, id) {
  const { prefix } = schedCfg(kind);
  schedEl(prefix, 'DetailBody').innerHTML = '<div class="loading">Loading…</div>';
  schedEl(prefix, 'DetailModal').showModal();
  try {
    const { job, recipients, preview } = await api(`/api/schedules/${id}/detail`);
    schedEl(prefix, 'DetailTitle').textContent = `${schedFrequencySummary(job)}, ${schedRecipientSummary(job)}`;
    if (!recipients.length) {
      schedEl(prefix, 'DetailBody').innerHTML = `<div class="empty">${t('msg_no_recipients_match_this_schedules_filte')}</div>`;
      return;
    }
    const note = preview
      ? `<div class="callout" style="margin-bottom:12px"><span class="callout-icon" aria-hidden="true">${ICONS.eye}</span><span>Preview, this schedule hasn't run yet. Recipients below are resolved live and may change by the time it actually sends.</span></div>`
      : '';
    const rows = recipients.map((r) => {
      const sentLabel = num(r.sent_count || 0) + (r.failed_count ? ` sent · ${num(r.failed_count)} failed` : ' sent');
      const lastLabel = r.status
        ? `${escapeHtml(r.status)}${r.processed_at ? ` · ${toJakartaTime(r.processed_at)}` : ''}${r.error ? `, ${escapeHtml(r.error)}` : ''}`
        : 'Not sent yet';
      return `<tr>
        <td>${escapeHtml(r.name || 'n/a')}</td>
        <td>${escapeHtml(r.sid || 'n/a')}</td>
        <td>${escapeHtml(r.email || 'n/a')}</td>
        <td>${SCHED_YN(r.has_portfolio)}</td>
        <td>${SCHED_YN(r.had_transaction_last_month)}</td>
        <td>${sentLabel}</td>
        <td>${lastLabel}</td>
      </tr>`;
    }).join('');
    // Own scroll box: the recipient list can run to thousands of rows and
    // seven columns, and its column headers stay in view inside it.
    schedEl(prefix, 'DetailBody').innerHTML = `${note}<div class="table-wrap" style="max-height:60vh"><table><thead><tr>
        <th>Name</th><th>SID</th><th>Email</th><th>Has portfolio</th><th>Tx last month</th><th>Sent</th><th>Last send (WIB)</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { schedEl(prefix, 'DetailBody').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

function schedResetModal(kind) {
  const { prefix } = schedCfg(kind);
  schedSetOnceMode(kind, false);
  schedEl(prefix, 'Step1').classList.remove('hidden');
  schedEl(prefix, 'Step2').classList.add('hidden');
  schedEl(prefix, 'RecipientType').value = 'single_email';
  schedEl(prefix, 'SingleEmail').value = '';
  schedEl(prefix, 'CsvFile').value = '';
  schedEl(prefix, 'CsvPaste').value = '';
  schedEl(prefix, 'CountPreview').classList.add('hidden');
  schedEl(prefix, 'Frequency').value = 'daily';
  schedEl(prefix, 'DayOfWeek').value = '1';
  schedEl(prefix, 'DayOfMonth').value = '1';
  schedEl(prefix, 'RunTime').value = '08:00';
  schedEl(prefix, 'Endless').checked = true;
  schedEl(prefix, 'EndDate').value = '';
  schedEl(prefix, 'EndDate').min = new Date().toISOString().slice(0, 10);
  schedEl(prefix, 'Subject').value = kind === 'statement' ? 'Your Sayakaya Statement' : 'Sayakaya Fund Performance Update';
  schedEl(prefix, 'Body').value = kind === 'statement'
    ? 'Dear Investor,\n\nPlease find your portfolio/e-statement attached, issued by PT Sayakaya Lahir Batin.\n\nTo open the attached PDF file(s), use your date of birth as registered with us in DDMMYYYY format (e.g. 17081990 for 17 August 1990).\n\nIf any details appear incorrect, please contact our support team.\n\nBest regards,\nPT Sayakaya Lahir Batin'
    : 'Dear Investor,\n\nPlease find attached our latest fund performance update (Reksa Dana Update), issued by PT Sayakaya Lahir Batin.\n\nBest regards,\nPT Sayakaya Lahir Batin';
  schedEl(prefix, 'ConfirmEmail').value = '';
  if (kind === 'statement') { schedEl(prefix, 'SendPortfolio').checked = true; schedEl(prefix, 'SendStatement').checked = true; }
  else fpeSchedScope.reset();
  schedUpdateFieldVisibility(kind);
}

// EXCLUSION LIST: one list shared by both Send tabs (each entry says which
// sends skip it); the server applies it to schedules, group sends and batch
// sends. Both tabs render the same rows, each with its own filter box.
const EXCL_PANELS = ['ssExcl', 'fpeExcl'];
const EXCL_SCOPE_LABEL = { all: 'Every send', statement: 'E-statement & portfolio', fund_performance: 'Fund performance' };
let exclRows = [];
async function loadExclusions() {
  EXCL_PANELS.forEach((p) => { $(`#${p}Table`).innerHTML = '<div class="loading">Loading…</div>'; });
  try {
    exclRows = await api('/api/send-exclusions');
    EXCL_PANELS.forEach(renderExclusions);
  } catch (e) {
    EXCL_PANELS.forEach((p) => { $(`#${p}Table`).innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; });
  }
}
function renderExclusions(p) {
  const el = $(`#${p}Table`);
  const q = $(`#${p}Filter`).value.trim().toLowerCase();
  const rows = exclRows.filter((r) => !q || [r.name, r.sid, r.email, r.identifier, r.reason].some((v) => String(v || '').toLowerCase().includes(q)));
  if (!exclRows.length) { el.innerHTML = `<div class="empty">${t('msg_no_one_is_excluded')}</div>`; return; }
  if (!rows.length) { el.innerHTML = `<div class="empty">${t('msg_no_one_on_the_list_matches_this_filter')}</div>`; return; }
  el.innerHTML = `<table><thead><tr>
      <th>Name</th><th>SID</th><th>Email</th><th>Skipped from</th><th>Reason</th><th>Added by</th><th>Added (WIB)</th><th></th>
    </tr></thead><tbody>${rows.map((r) => `<tr>
      <td>${escapeHtml(r.name || 'n/a')}</td>
      <td>${escapeHtml(r.sid || 'n/a')}</td>
      <td>${escapeHtml(r.email || r.identifier)}</td>
      <td>${escapeHtml(EXCL_SCOPE_LABEL[r.scope] || r.scope)}</td>
      <td>${escapeHtml(r.reason || '')}</td>
      <td>${escapeHtml(r.created_by_username || 'n/a')}</td>
      <td>${toJakartaTime(r.created_at)}</td>
      <td><button type="button" class="btn-ghost excl-remove-btn" data-id="${r.id}" data-who="${escapeHtml(r.name || r.sid || r.email || r.identifier)}">Remove</button></td>
    </tr>`).join('')}</tbody></table>`;
  el.querySelectorAll('.excl-remove-btn').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(`Remove ${btn.dataset.who} from the exclusion list? Schedules and group sends will reach them again.`)) return;
    try {
      await api(`/api/send-exclusions/${btn.dataset.id}`, { method: 'DELETE' });
      toast(`${btn.dataset.who} removed from the exclusion list.`);
      loadExclusions();
    } catch (e) { toast(e.message); }
  }));
}
async function addExclusions(p) {
  const identifiers = parseBatchIdentifiers($(`#${p}Input`).value);
  if (!identifiers.length) { toast(t('msg_enter_at_least_one_email_or_sid')); return; }
  const btn = $(`#${p}AddBtn`);
  btn.disabled = true;
  try {
    const { added, invalid } = await api('/api/send-exclusions', {
      method: 'POST',
      body: JSON.stringify({ identifiers, scope: $(`#${p}Scope`).value, reason: $(`#${p}Reason`).value }),
    });
    // Unknown SIDs stay in the box so they can be corrected.
    $(`#${p}Input`).value = invalid.join('\n');
    if (!invalid.length) $(`#${p}Reason`).value = '';
    toast(`${num(added)} added to the exclusion list.${invalid.length ? ` No investor has ${invalid.join(', ')}; left in the box.` : ''}`);
    loadExclusions();
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
}
const exclNote = (n) => (n ? ` ${num(n)} on the exclusion list ${n === 1 ? 'is' : 'are'} skipped.` : '');

// Batch send to a recipient group goes through the schedule queue as a
// one-off job (frequency 'once'): confirmed with an emailed code like a
// schedule, sent by parallel runners, progress in the Automated sending
// table. The Batch send form already chose the documents (extras), so the
// modal only asks for the email text and the code.
let schedOnce = null; // { kind, extras } while a modal is in send-now mode
function schedSetOnceMode(kind, on) {
  const { prefix } = schedCfg(kind);
  ['WhenRow', 'EndRow', kind === 'statement' ? 'DocsRow' : 'ScopeField'].forEach((n) => schedEl(prefix, n).classList.toggle('hidden', on));
  if (on && kind === 'fund_performance') ['FundScopeTypes', 'FundScopeFunds'].forEach((n) => schedEl(prefix, n).classList.add('hidden'));
  schedEl(prefix, 'OnceNote').classList.toggle('hidden', !on);
  schedEl(prefix, 'Title').textContent = t(on ? 'sched_once_title' : 'sched_modal_title');
  schedEl(prefix, 'ConfirmBtn').textContent = t(on ? 'sched_once_confirm' : 'sched_confirm');
  if (!on && schedOnce && schedOnce.kind === kind) schedOnce = null;
}
function openSchedOnce(kind, recipientType, extras, note, { subject, body }, list = null) {
  const { prefix } = schedCfg(kind);
  schedResetModal(kind);
  schedSetOnceMode(kind, true);
  schedOnce = { kind, extras };
  schedEl(prefix, 'RecipientType').value = recipientType;
  if (list) schedEl(prefix, 'CsvPaste').value = list.join('\n');
  schedEl(prefix, 'OnceNoteText').textContent = note;
  schedEl(prefix, 'Subject').value = subject;
  schedEl(prefix, 'Body').value = body;
  schedUpdateFieldVisibility(kind);
  schedEl(prefix, 'Modal').showModal();
  schedPreviewCount(kind);
}

// Batch send's Recipients dropdown: a group hides the pick/paste fields and
// shows how many people it reaches now; Compose then opens openSchedOnce.
let batchGroupSeq = 0;
async function batchGroupChanged(kind, px) {
  const type = $(`#${px}RecipientType`).value;
  const group = type !== 'list';
  $(`#${px}ListFields`).classList.toggle('hidden', group);
  $(`#${px}GroupCount`).classList.toggle('hidden', !group);
  if (kind === 'statement') $('#ssBatchPortfolioDate').disabled = group; // groups always get the live portfolio
  if (!group) return;
  const textEl = $(`#${px}GroupCountText`);
  const seq = ++batchGroupSeq;
  textEl.textContent = 'Checking recipient count…';
  try {
    const { count, excluded } = await api('/api/schedules/preview', { method: 'POST', body: JSON.stringify({ kind, recipientType: type }) });
    if (seq !== batchGroupSeq) return;
    textEl.textContent = `${num(count)} ${kind === 'statement' ? 'investor' : 'recipient'}${count === 1 ? '' : 's'} right now.${exclNote(excluded)}`
      + ' Compose asks for a confirmation code, then the emails go out from a queue, several at a time; progress shows under Automated sending.'
      + (kind === 'statement' ? ' A group always gets the live portfolio as of the send date.' : '');
  } catch (e) { if (seq === batchGroupSeq) textEl.textContent = e.message; }
}

function schedUpdateFieldVisibility(kind) {
  const { prefix } = schedCfg(kind);
  const type = schedEl(prefix, 'RecipientType').value;
  schedEl(prefix, 'SingleEmailField').classList.toggle('hidden', type !== 'single_email');
  schedEl(prefix, 'CsvField').classList.toggle('hidden', type !== 'csv_list');
  const freq = schedEl(prefix, 'Frequency').value;
  schedEl(prefix, 'WeekdayField').classList.toggle('hidden', freq !== 'weekly');
  schedEl(prefix, 'DayOfMonthField').classList.toggle('hidden', freq !== 'monthly_day');
  schedEl(prefix, 'EndDateField').classList.toggle('hidden', schedEl(prefix, 'Endless').checked);
}

// Emails (and, for e-statement sends, SIDs) found anywhere in pasted text or
// an uploaded CSV. Other cells (names, phone numbers, amounts, a header row)
// are dropped, and so are quotes and spaces around values. The server turns
// a SID into that investor's email; fund performance goes to emails only.
const RECIPIENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SID_RE = /^[a-z]{3}\d{4}[a-z0-9]{8}$/i; // every SID on file: 3 letters, 4 digits, 8 letters/digits
function extractRecipients(text, withSids) {
  return [...new Set((text || '').split(/[\s,;"'<>()]+/)
    .filter((c) => RECIPIENT_EMAIL_RE.test(c) || (withSids && SID_RE.test(c)))
    .map((c) => (c.includes('@') ? c.toLowerCase() : c.toUpperCase())))];
}

// Batch send's CSV upload: what the file holds is added to the paste box, so
// it can be checked or edited before sending.
async function loadBatchCsv(fileInput, textarea, withSids) {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const found = extractRecipients(await schedReadFileAsText(file), withSids);
    const current = textarea.value.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
    const known = new Set(current.map((v) => v.toLowerCase()));
    const added = found.filter((v) => !known.has(v.toLowerCase()));
    textarea.value = [...current, ...added].join('\n');
    const what = withSids ? 'emails/SIDs' : 'emails';
    const dupes = found.length - added.length;
    toast(found.length
      ? `${num(added.length)} ${what} added from ${file.name}${dupes ? ` (${num(dupes)} already in the box)` : ''}.`
      : `No ${what} found in ${file.name}.`);
  } catch (e) { toast(e.message); }
  fileInput.value = ''; // so the same file can be picked again
}

// Reads the CSV file (if one was chosen) or falls back to the pasted textarea.
function schedReadFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}
async function schedCollectRecipients(kind) {
  const { prefix } = schedCfg(kind);
  const file = schedEl(prefix, 'CsvFile').files[0];
  const text = file ? await schedReadFileAsText(file) : schedEl(prefix, 'CsvPaste').value;
  return extractRecipients(text, kind === 'statement');
}

async function schedBuildSpec(kind) {
  const { prefix } = schedCfg(kind);
  const recipientType = schedEl(prefix, 'RecipientType').value;
  const spec = { kind, recipientType };
  if (recipientType === 'single_email') spec.recipientEmail = schedEl(prefix, 'SingleEmail').value.trim();
  if (recipientType === 'csv_list') spec.recipientList = await schedCollectRecipients(kind);
  return spec;
}

// Shown for every recipient choice so the count can be checked before the
// OTP step; single email / CSV wait until something is entered. A pool count
// can take seconds (all_aum returns ~232k rows), so a reply that lands after
// the choice changed is dropped instead of overwriting the newer count.
let schedPreviewSeq = 0;
async function schedPreviewCount(kind) {
  const { prefix } = schedCfg(kind);
  const el = schedEl(prefix, 'CountPreview');
  const textEl = schedEl(prefix, 'CountPreviewText');
  const type = schedEl(prefix, 'RecipientType').value;
  const seq = ++schedPreviewSeq;
  const empty = type === 'single_email' ? !schedEl(prefix, 'SingleEmail').value.trim()
    : type === 'csv_list' ? !schedEl(prefix, 'CsvFile').files.length && !schedEl(prefix, 'CsvPaste').value.trim()
    : false;
  if (empty) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  textEl.textContent = 'Checking recipient count…';
  try {
    const spec = await schedBuildSpec(kind);
    const { count, excluded } = await api('/api/schedules/preview', { method: 'POST', body: JSON.stringify(spec) });
    if (seq !== schedPreviewSeq) return;
    const people = `${num(count)} ${kind === 'statement' ? 'investor' : 'recipient'}${count === 1 ? '' : 's'}`;
    textEl.textContent = (schedOnce && schedOnce.kind === kind ? `This will reach ${people}.` : `This will reach approximately ${people} per send.`) + exclNote(excluded);
  } catch (e) { if (seq === schedPreviewSeq) textEl.textContent = e.message; }
}

async function schedSendOtp(kind) {
  const { prefix } = schedCfg(kind);
  try {
    const spec = await schedBuildSpec(kind);
    const frequency = schedEl(prefix, 'Frequency').value;
    const payload = {
      ...spec,
      frequency,
      dayOfWeek: frequency === 'weekly' ? Number(schedEl(prefix, 'DayOfWeek').value) : undefined,
      dayOfMonth: frequency === 'monthly_day' ? Number(schedEl(prefix, 'DayOfMonth').value) : undefined,
      runTime: schedEl(prefix, 'RunTime').value || '08:00',
      endDate: schedEl(prefix, 'Endless').checked ? null : (schedEl(prefix, 'EndDate').value || null),
      subject: schedEl(prefix, 'Subject').value,
      body: schedEl(prefix, 'Body').value,
      confirmationEmail: schedEl(prefix, 'ConfirmEmail').value.trim(),
    };
    if (kind === 'statement') {
      payload.sendPortfolio = schedEl(prefix, 'SendPortfolio').checked;
      payload.sendStatement = schedEl(prefix, 'SendStatement').checked;
    } else {
      payload.fundFilter = fpeSchedScope.read();
    }
    if (schedOnce && schedOnce.kind === kind) Object.assign(payload, { frequency: 'once', endDate: null }, schedOnce.extras);
    const { otpId, recipientCount } = await api('/api/schedules/otp/request', { method: 'POST', body: JSON.stringify(payload) });
    schedOtpState = { kind, otpId };
    schedEl(prefix, 'Step1').classList.add('hidden');
    schedEl(prefix, 'Step2').classList.remove('hidden');
    const people = `${num(recipientCount)} recipient${recipientCount === 1 ? '' : 's'}`;
    schedEl(prefix, 'Step2Hint').textContent = payload.frequency === 'once'
      ? `We sent a 6-digit code to ${payload.confirmationEmail}. Enter it below to start sending to ${people}.`
      : `We sent a 6-digit code to ${payload.confirmationEmail}. Enter it below to create this schedule (reaches ~${people} per send).`;
    schedEl(prefix, 'Code').value = '';
  } catch (e) { toast(e.message); }
}

async function schedConfirmOtp(kind) {
  const { prefix } = schedCfg(kind);
  if (!schedOtpState || schedOtpState.kind !== kind) { toast(t('msg_start_over_session_lost')); return; }
  try {
    await api('/api/schedules/otp/confirm', { method: 'POST', body: JSON.stringify({ otpId: schedOtpState.otpId, code: schedEl(prefix, 'Code').value.trim() }) });
    const once = schedOnce && schedOnce.kind === kind;
    schedEl(prefix, 'Modal').close();
    toast(once ? 'Sending started. Progress shows under Automated sending.' : 'Schedule created.');
    loadSchedules(kind);
  } catch (e) { toast(e.message); }
}

// HNWI BONUS: monthly bonus in Sucorinvest Money Market Fund units for
// customers with 500 jt+ AUM who add fresh money to SAM funds. Every rule is
// in HNWI_BONUS (public/hnwi-bonus-config.js); the server returns the
// candidates (with their daily AUM check) and their SAM transactions, and
// hnwiCustomer below works out lots, FIFO, accrual and the monthly payable.
const hMonth = (iso) => iso.slice(0, 7);
const hMonthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const hNextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
// Same day n months later, clamped to the month's last day (31 Jan + 1 = 28 Feb).
function hAddMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
// n weekdays after iso (exchange holidays other than weekends are not known here).
function hAddTradingDays(iso, n) {
  let d = iso;
  while (n > 0) { d = bAddDays(d, 1); const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) n--; }
  return d;
}

function hnwiCustomer(c, txs, cfg, today) {
  const rateOf = new Map(cfg.rates.flatMap((tier) => tier.funds.map((f) => [f.id, tier.pct])));
  const end = today < cfg.programTo ? today : cfg.programTo;
  // Under the AUM minimum on the start date: not eligible at all (treated as out from day one).
  const unqualified = Number(c.start_aum) < cfg.minAum;
  const F = unqualified ? cfg.programFrom : c.first_below || null; // first day under the AUM minimum: out for good from that day
  const codes = new Set(cfg.promoCodes.map((x) => x.toUpperCase()));
  const lots = txs.filter((t) => t.type === 'buy' && t.day >= cfg.purchaseFrom && t.day <= cfg.purchaseTo && (!cfg.promoPurchasesOnly || codes.has(t.promo)))
    .map((t) => {
      const start = t.done_day > t.day ? t.done_day : t.day;
      return { tx_id: t.tx_id, fund_id: t.fund_id, fund: t.fund, rate: rateOf.get(t.fund_id) || 0, orderDay: t.day, start,
        amount: Number(t.amount) || 0, remaining: Number(t.amount) || 0, mark: hAddMonths(start, cfg.holdMonths), base: null, bonus: 0 };
    })
    .sort((a, b) => (a.orderDay < b.orderDay ? -1 : a.orderDay > b.orderDay ? 1 : 0));
  const reds = txs.filter((t) => (t.type === 'sell' || (t.type === 'SWITCH_OUT' && !t.to_sam)) && t.day >= cfg.programFrom && t.day <= cfg.programTo);
  const credits = new Map();
  const credit = (day, amt, lot) => { if (amt <= 0) return; credits.set(hMonth(day), (credits.get(hMonth(day)) || 0) + amt); lot.bonus += amt; };
  let debt = 0, subs = 0, redeemed = 0, Q = null;
  for (let d = cfg.programFrom; d <= end; d = bAddDays(d, 1)) {
    const live = !F || d < F;
    // A redemption with no program purchase left to take from waits for the next one (net = subs - redemptions).
    for (const lot of lots.filter((l) => l.orderDay === d)) {
      subs += lot.amount;
      const take = Math.min(debt, lot.remaining); lot.remaining -= take; debt -= take;
    }
    // At the one-month mark the first month is paid on what was not redeemed before it.
    for (const lot of lots) {
      if (d === lot.mark && live) { lot.base = lot.remaining; credit(d, (lot.remaining * lot.rate) / 100 / 365 * bDays(lot.start, lot.mark), lot); }
    }
    for (const r of reds.filter((x) => x.day === d)) {
      redeemed += Number(r.amount) || 0;
      let left = Number(r.amount) || 0;
      for (const lot of lots) {
        if (left <= 0) break;
        if (lot.orderDay > d || lot.remaining <= 0) continue;
        const take = Math.min(left, lot.remaining); lot.remaining -= take; left -= take;
      }
      debt += left;
    }
    if (!Q && d <= cfg.purchaseTo && subs - redeemed >= cfg.minNetSubs) Q = d;
    if (live) for (const lot of lots) if (d >= lot.mark && lot.remaining > 0) credit(d, (lot.remaining * lot.rate) / 100 / 365, lot);
  }
  // Months of the program, each with what was earned in it after the 100 jt rule
  // (earlier months paid in the month it was reached), the AUM rule (that
  // month on is lost) and the overall cap.
  const months = [];
  for (let m = hMonth(cfg.programFrom); m <= hMonth(cfg.programTo); m = hNextMonth(m)) months.push(m);
  const raw = new Map(months.map((m) => [m, credits.get(m) || 0]));
  const qm = Q ? hMonth(Q) : null;
  const fm = F ? hMonth(F) : null;
  let pending = 0, forfeited = 0, paidSoFar = 0;
  const rows = months.map((m) => {
    let amount = raw.get(m);
    if (qm && m === qm) amount += months.filter((x) => x < qm).reduce((a, x) => a + raw.get(x), 0);
    else if (qm && m < qm) amount = 0;
    const state = hMonthEnd(m) < today ? 'done' : hMonth(today) === m ? 'running' : 'future';
    if (!qm) {
      // Never reached the minimum: waiting until the purchase period ends, lost after it or once out on AUM.
      if (F || today > cfg.purchaseTo) forfeited += amount; else pending += amount;
      return { m, amount: 0, state: F ? 'lapsed' : today > cfg.purchaseTo ? 'not_reached' : state === 'future' ? 'future' : 'pending' };
    }
    if (fm && m >= fm) { forfeited += amount; return { m, amount: 0, state: 'lapsed' }; }
    const room = Math.max(0, cfg.maxBonus - paidSoFar);
    const pay = Math.min(Math.round(amount), room);
    forfeited += Math.max(0, Math.round(amount) - pay);
    paidSoFar += pay;
    return { m, amount: pay, state, due: hAddTradingDays(hMonthEnd(m), cfg.payoutTradingDays) };
  });
  const earned = rows.filter((r) => r.state === 'done').reduce((a, r) => a + r.amount, 0);
  const running = rows.filter((r) => r.state === 'running').reduce((a, r) => a + r.amount, 0);
  const status = unqualified ? 'not_eligible' : F ? 'lapsed_aum' : Q ? 'active' : !subs ? 'not_joined' : today > cfg.purchaseTo ? 'not_reached' : 'building';
  return {
    ...c, lots, reds, subs, redeemed, net: subs - redeemed, netNow: lots.reduce((a, l) => a + l.remaining, 0),
    qualifiedOn: Q, months: rows, earned, running, pending: Math.round(pending), forfeited: Math.round(forfeited),
    capReached: paidSoFar >= cfg.maxBonus, status,
  };
}

function hnwiCompute({ candidates, transactions }, cfg, today) {
  const txBy = new Map();
  for (const t of transactions) { if (!txBy.has(t.user_id)) txBy.set(t.user_id, []); txBy.get(t.user_id).push(t); }
  return candidates.map((c) => hnwiCustomer(c, txBy.get(c.user_id) || [], cfg, today));
}

const HB = { data: null, loading: false };
const hbStatus = (k, x) => ({
  active: bL('Active', 'Aktif'),
  building: bL(`Below ${idr(HNWI_BONUS.minNetSubs)} so far`, `Belum ${idr(HNWI_BONUS.minNetSubs)}`),
  not_reached: bL(`Did not reach ${idr(HNWI_BONUS.minNetSubs)}`, `Tidak mencapai ${idr(HNWI_BONUS.minNetSubs)}`),
  not_joined: bL('No program purchase', 'Belum ada pembelian program'),
  lapsed_aum: bL(`Out: AUM under ${idr(HNWI_BONUS.minAum)} on ${x && x.first_below}`, `Gugur: AUM di bawah ${idr(HNWI_BONUS.minAum)} pada ${x && x.first_below}`),
  not_eligible: bL(`Not eligible: AUM under ${idr(HNWI_BONUS.minAum)} on ${HNWI_BONUS.aumStartDate}`, `Tidak memenuhi: AUM di bawah ${idr(HNWI_BONUS.minAum)} pada ${HNWI_BONUS.aumStartDate}`),
  done: bL('To send', 'Siap dikirim'), running: bL('Month running (estimate)', 'Bulan berjalan (sementara)'),
  pending: bL(`Waits for ${idr(HNWI_BONUS.minNetSubs)}`, `Menunggu ${idr(HNWI_BONUS.minNetSubs)}`),
  lapsed: bL('Lost: out on AUM', 'Hangus: gugur AUM'),
}[k] || k);

async function loadHnwiBonus() {
  const cfg = HNWI_BONUS;
  HB.loading = true;
  ['#hbKpis', '#hbCustomers', '#hbMonthly', '#hbLots'].forEach((sel) => { $(sel).innerHTML = `<div class="loading">${t('common_loading')}</div>`; });
  try {
    const qs = new URLSearchParams({ startDate: cfg.aumStartDate, purchaseFrom: cfg.purchaseFrom, purchaseTo: cfg.purchaseTo, programTo: cfg.programTo, minAum: cfg.minAum, sam: cfg.samManager });
    cfg.promoCodes.forEach((c) => qs.append('promo', c));
    HB.data = await api(`/api/hnwi-bonus/data?${qs}`);
    renderHnwiBonus();
  } catch (e) {
    ['#hbKpis', '#hbCustomers', '#hbMonthly', '#hbLots'].forEach((sel) => { $(sel).innerHTML = `<div class="empty">${bEsc(e.message)}</div>`; });
  } finally { HB.loading = false; }
}

function renderHnwiBonus() {
  if (!HB.data) return;
  const cfg = HNWI_BONUS;
  const today = bWibToday();
  const people = hnwiCompute(HB.data, cfg, today);
  const joined = people.filter((x) => x.subs > 0);
  const lastDone = [...new Set(people.flatMap((x) => x.months.filter((r) => r.state === 'done').map((r) => r.m)))].sort().pop();
  const codesText = cfg.promoCodes.join(', ');
  $('#hbHint').textContent = bL(
    `${cfg.name}: participants = completed buys with promo code ${codesText}, ${cfg.purchaseFrom} to ${cfg.purchaseTo}; bonus until ${cfg.programTo}. They need AUM ${idr(cfg.minAum)}+ on ${cfg.aumStartDate}, checked every day after (data up to ${people[0] ? people[0].last_day || 'n/a' : 'n/a'}). Today ${today} WIB.`,
    `${cfg.name}: peserta = beli completed dengan kode promo ${codesText}, ${cfg.purchaseFrom} s.d. ${cfg.purchaseTo}; bonus sampai ${cfg.programTo}. Syarat AUM ${idr(cfg.minAum)}+ pada ${cfg.aumStartDate}, dicek setiap hari sesudahnya (data s.d. ${people[0] ? people[0].last_day || 'n/a' : 'n/a'}). Hari ini ${today} WIB.`);
  $('#hbKpis').innerHTML = [
    kpi(bL('Participants', 'Peserta'), num(people.length), bL(`used ${codesText}; ${num(people.filter((x) => x.status === 'not_eligible').length)} without the AUM minimum`, `pakai ${codesText}; ${num(people.filter((x) => x.status === 'not_eligible').length)} tanpa AUM minimum`), 'accent', ICONS.users),
    kpi(bL('Bought in the program', 'Beli di program'), num(joined.length), bL(`${num(people.filter((x) => x.status === 'active').length)} reached ${idr(cfg.minNetSubs)}`, `${num(people.filter((x) => x.status === 'active').length)} mencapai ${idr(cfg.minNetSubs)}`), '', ICONS.userPlus),
    kpi(bL('Out on AUM', 'Gugur AUM'), num(people.filter((x) => x.status === 'lapsed_aum').length), bL(`AUM fell under ${idr(cfg.minAum)}`, `AUM turun di bawah ${idr(cfg.minAum)}`), '', ICONS.xCircle),
    kpi(bL('Net subs', 'Nett subs'), idr(joined.reduce((a, x) => a + x.netNow, 0)), bL(`of ${idr(joined.reduce((a, x) => a + x.subs, 0))} bought`, `dari ${idr(joined.reduce((a, x) => a + x.subs, 0))} dibeli`), '', ICONS.coin),
    kpi(bL('Bonus to send', 'Bonus siap dikirim'), idr(people.reduce((a, x) => a + x.earned, 0)), lastDone ? bL(`months done, last ${lastDone}`, `bulan selesai, terakhir ${lastDone}`) : bL('no month finished yet', 'belum ada bulan selesai'), '', ICONS.coin),
    kpi(bL('This month so far', 'Bulan ini sejauh ini'), idr(people.reduce((a, x) => a + x.running, 0)), bL(`+ ${idr(people.reduce((a, x) => a + x.pending, 0))} waiting for ${idr(cfg.minNetSubs)}`, `+ ${idr(people.reduce((a, x) => a + x.pending, 0))} menunggu ${idr(cfg.minNetSubs)}`), '', ICONS.hourglass),
  ].join('');

  genTable('#hbCustomers', people.map((x) => ({
    name: bEsc(x.name || 'n/a'), sid: bEsc(x.sid || ''), ifua: bEsc(x.ifua || ''), email: bEsc(x.email || ''), phone: bEsc(x.phone || ''),
    start_aum: x.start_aum, lowest_aum: x.lowest_aum, avg_aum: x.avg_aum, latest_aum: x.latest_aum,
    subs: x.subs, redeemed: x.redeemed, net: x.netNow, qualified: x.qualifiedOn, earned: x.earned, running: x.running,
    pending: x.pending, forfeited: x.forfeited, status: hbStatus(x.status, x) + (x.capReached ? bL(', cap reached', ', batas tercapai') : ''),
  })).sort((a, b) => b.subs - a.subs || b.start_aum - a.start_aum), [
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'ifua', label: 'IFUA' }, { key: 'email', label: 'Email' }, { key: 'phone', label: bL('Phone', 'HP') },
    { key: 'start_aum', label: bL(`AUM ${cfg.aumStartDate}`, `AUM ${cfg.aumStartDate}`), type: 'idr' }, { key: 'lowest_aum', label: bL('Lowest AUM since', 'AUM terendah sejak itu'), type: 'idr' },
    { key: 'avg_aum', label: bL(`Avg daily AUM since ${cfg.programFrom}`, `Rata-rata AUM harian sejak ${cfg.programFrom}`), type: 'idr' },
    { key: 'latest_aum', label: bL('Latest AUM', 'AUM terbaru'), type: 'idr' },
    { key: 'subs', label: bL('Program buys', 'Beli program'), type: 'idr', sum: true }, { key: 'redeemed', label: bL('SAM redemptions', 'Redemption SAM'), type: 'idr', sum: true },
    { key: 'net', label: bL('Net subs now', 'Nett subs sekarang'), type: 'idr', sum: true },
    { key: 'qualified', label: bL(`Reached ${idr(cfg.minNetSubs)} on`, `Capai ${idr(cfg.minNetSubs)}`), type: 'date' },
    { key: 'earned', label: bL('Bonus, months done', 'Bonus bulan selesai'), type: 'idr', sum: true }, { key: 'running', label: bL('This month so far', 'Bulan ini sejauh ini'), type: 'idr', sum: true },
    { key: 'pending', label: bL('Waiting', 'Tertunda'), type: 'idr', sum: true }, { key: 'forfeited', label: bL('Lost', 'Hangus'), type: 'idr', sum: true },
    { key: 'status', label: 'Status' },
  ], bL(`Nobody has used ${codesText} yet.`, `Belum ada yang memakai ${codesText}.`));

  const monthSel = $('#hbMonth');
  const monthsAll = [...new Set(people.flatMap((x) => x.months.filter((r) => r.amount > 0).map((r) => r.m)))].sort();
  if (monthSel.dataset.filled !== monthsAll.join()) {
    const keep = monthSel.value;
    monthSel.innerHTML = `<option value="">${bL('Every month', 'Semua bulan')}</option>` + monthsAll.map((m) => `<option${m === keep ? ' selected' : ''}>${m}</option>`).join('');
    monthSel.dataset.filled = monthsAll.join();
  }
  const pickM = monthSel.value;
  genTable('#hbMonthly', people.flatMap((x) => x.months.filter((r) => r.amount > 0 && (!pickM || r.m === pickM)).map((r) => ({
    m: r.m, name: bEsc(x.name || 'n/a'), sid: bEsc(x.sid || ''), ifua: bEsc(x.ifua || ''), email: bEsc(x.email || ''),
    amount: r.amount, due: r.due, status: hbStatus(r.state),
  }))).sort((a, b) => (a.m < b.m ? 1 : a.m > b.m ? -1 : 0)), [
    { key: 'm', label: bL('Month', 'Bulan') }, { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'ifua', label: 'IFUA' }, { key: 'email', label: 'Email' },
    { key: 'amount', label: bL(`Bonus in ${cfg.bonusFund} units`, `Bonus dalam unit ${cfg.bonusFund}`), type: 'idr', sum: true },
    { key: 'due', label: bL(`Send by (${cfg.payoutTradingDays} trading days)`, `Kirim paling lambat (${cfg.payoutTradingDays} hari bursa)`), type: 'date' }, { key: 'status', label: 'Status' },
  ], bL('No bonus to send yet.', 'Belum ada bonus untuk dikirim.'));

  genTable('#hbLots', joined.flatMap((x) => [
    ...x.lots.map((l) => ({ name: bEsc(x.name || 'n/a'), sid: bEsc(x.sid || ''), kind: bL('Buy', 'Beli'), fund: bEsc(l.fund || ''), rate: l.rate ? `${l.rate}%` : '0%',
      day: l.orderDay, start: l.start, amount: l.amount, remaining: l.remaining, mark: l.mark, bonus: Math.round(l.bonus) })),
    ...x.reds.map((r) => ({ name: bEsc(x.name || 'n/a'), sid: bEsc(x.sid || ''), kind: r.type === 'sell' ? bL('Redemption', 'Redemption') : bL('Switch to a non-SAM fund', 'Switching ke non-SAM'),
      fund: bEsc(r.fund || ''), rate: '', day: r.day, start: null, amount: -r.amount, remaining: null, mark: null, bonus: null })),
  ]).sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : a.day < b.day ? -1 : 1)), [
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'kind', label: bL('Type', 'Jenis') }, { key: 'fund', label: bL('Product', 'Produk') },
    { key: 'rate', label: bL('Rate p.a.', 'Rate p.a.') }, { key: 'day', label: bL('Order date', 'Tanggal order'), type: 'date' }, { key: 'start', label: bL('Completed', 'Berhasil'), type: 'date' },
    { key: 'amount', label: bL('Amount', 'Nominal'), type: 'idr' }, { key: 'remaining', label: bL('Left after FIFO', 'Sisa setelah FIFO'), type: 'idr' },
    { key: 'mark', label: bL(`${cfg.holdMonths} month held on`, `Genap ${cfg.holdMonths} bulan`), type: 'date' }, { key: 'bonus', label: bL('Bonus accrued', 'Bonus terkumpul'), type: 'idr', sum: true },
  ], bL('No program purchase yet.', 'Belum ada pembelian program.'));

  renderHnwiRules(cfg);
}

function renderHnwiRules(cfg) {
  const li = (en, id) => `<li>${bL(en, id)}</li>`;
  $('#hbRules').innerHTML = `<ul>
    ${li(`Participants: customers with a completed buy using promo code ${bEsc(cfg.promoCodes.join(', '))} from ${cfg.purchaseFrom} to ${cfg.purchaseTo}, individuals and institutions alike.`, `Peserta: nasabah dengan beli completed memakai kode promo ${bEsc(cfg.promoCodes.join(', '))} dari ${cfg.purchaseFrom} s.d. ${cfg.purchaseTo}, perorangan maupun institusi.`)}
    ${li(`They need total AUM (every product) of ${idr(cfg.minAum)}+ on ${cfg.aumStartDate}, from the daily portfolio_with_code snapshot, or they are not eligible. AUM is then checked every day; one day under ${idr(cfg.minAum)} and the customer is out for good, and bonus not yet paid is lost.`, `Syaratnya AUM total (semua produk) ${idr(cfg.minAum)}+ pada ${cfg.aumStartDate}, dari snapshot harian portfolio_with_code; kalau tidak, tidak memenuhi syarat. Lalu AUM dicek setiap hari; sekali saja di bawah ${idr(cfg.minAum)}, nasabah gugur permanen dan bonus yang belum dibayar hangus.`)}
    ${li(cfg.promoPurchasesOnly
      ? `Program purchases: completed buys of ${bEsc(cfg.samManager)} funds with the promo code, ordered ${cfg.purchaseFrom} to ${cfg.purchaseTo}, fresh money only (switching in and bonus payouts do not count). Buys without the code do not count.`
      : `Program purchases: every completed fresh-money buy of ${bEsc(cfg.samManager)} funds by a participant, ordered ${cfg.purchaseFrom} to ${cfg.purchaseTo}, with or without the code.`,
    cfg.promoPurchasesOnly
      ? `Pembelian program: beli completed produk ${bEsc(cfg.samManager)} dengan kode promo, diorder ${cfg.purchaseFrom} s.d. ${cfg.purchaseTo}, hanya fresh fund (switching masuk dan pembayaran bonus tidak dihitung). Beli tanpa kode tidak dihitung.`
      : `Pembelian program: semua beli fresh fund completed produk ${bEsc(cfg.samManager)} oleh peserta, diorder ${cfg.purchaseFrom} s.d. ${cfg.purchaseTo}, dengan atau tanpa kode.`)}
    ${li(`Every redemption of a ${bEsc(cfg.samManager)} fund from ${cfg.programFrom} to ${cfg.programTo} (a sale, or switching to a fund of another manager) reduces the program purchases, oldest first (FIFO), across products; one made before a purchase reduces the next one. Switching between their own funds is not a redemption and keeps the rate of the product first bought.`, `Setiap redemption produk ${bEsc(cfg.samManager)} dari ${cfg.programFrom} s.d. ${cfg.programTo} (jual, atau switching ke produk manajer lain) mengurangi pembelian program, yang tertua dulu (FIFO), lintas produk; redemption sebelum ada pembelian memotong pembelian berikutnya. Switching antar produk mereka sendiri bukan redemption dan rate tetap rate produk pembelian awal.`)}
    ${li(`Bonus per day = what is left of each purchase x its rate a year / 365, from the day it completed. The part redeemed before ${cfg.holdMonths} month(s) earns nothing; the first month is paid in the month the purchase completes ${cfg.holdMonths} month(s).`, `Bonus per hari = sisa tiap pembelian x rate per tahun / 365, sejak hari transaksi berhasil. Bagian yang di-redeem sebelum ${cfg.holdMonths} bulan tidak dapat bonus; bulan pertama dibayar di bulan saat pembelian genap ${cfg.holdMonths} bulan.`)}
    ${li(`Net subs (program purchases minus redemptions) must reach ${idr(cfg.minNetSubs)} by ${cfg.purchaseTo}; bonus before that waits and is paid in the month it is reached. Not reached by then: no bonus.`, `Nett subs (pembelian program dikurangi redemption) harus mencapai ${idr(cfg.minNetSubs)} paling lambat ${cfg.purchaseTo}; bonus sebelum itu tertunda dan dibayar di bulan saat tercapai. Tidak tercapai: tidak ada bonus.`)}
    ${li(`At most ${idrFull(cfg.maxBonus)} per customer over the program. Paid monthly in ${bEsc(cfg.bonusFund)} units, within ${cfg.payoutTradingDays} trading days after the month (weekends skipped; other exchange holidays are not).`, `Maksimal ${idrFull(cfg.maxBonus)} per nasabah selama program. Dibayar tiap bulan dalam unit ${bEsc(cfg.bonusFund)}, paling lambat ${cfg.payoutTradingDays} hari bursa setelah bulan selesai (akhir pekan dilewati; libur bursa lain tidak).`)}
    ${li(`Funds of ${bEsc(cfg.samManager)} not in the rate table count toward the minimum but earn 0.`, `Produk ${bEsc(cfg.samManager)} yang tidak ada di tabel rate dihitung untuk minimum tapi rate-nya 0.`)}
  </ul>`;
  genTable('#hbRates', cfg.rates.flatMap((tier) => tier.funds.map((f) => ({ fund: bEsc(f.name), rate: `${tier.pct}%`, example: Math.round(500000000 * tier.pct / 100) }))), [
    { key: 'fund', label: bL('Product', 'Produk') }, { key: 'rate', label: bL('Bonus rate a year', 'Rate bonus per tahun') },
    { key: 'example', label: bL('A year on Rp 500 jt', 'Setahun untuk Rp 500 jt'), type: 'idr' },
  ], '');
}

// PROMO RECAP: who bought with a promo code (payouts excluded), every promo
// participation (bonus_portfolios: on_going = waiting for the holding date,
// succeeded = eligible, redeemed = withdrawn early) with how long the promo
// units stayed and the fee they earned (portfolio_with_code, server side),
// and the bonus already sent. The per-promo summary is built here.
const PR = { data: null, loading: false };
const prStatus = (k) => ({
  on_going: bL('Waiting for the holding date', 'Menunggu holding selesai'),
  succeeded: bL('Eligible', 'Layak'),
  redeemed: bL('Lapsed: withdrawn before the holding date', 'Gugur: ditarik sebelum holding selesai'),
  none: bL('No bonus: did not qualify', 'Tidak dapat bonus: tidak memenuhi syarat'),
}[k] || k);
// Bonus owed to one participation by the campaign rule: a fixed amount, or a
// percentage of the locked value; null when the campaign sets neither (decided by hand).
function prBonusDue(r) {
  if (r.status !== 'succeeded') return 0;
  if (Number(r.bonus_amount) > 0) return Number(r.bonus_amount);
  if (Number(r.bonus_percentage) > 0) return Math.round((Number(r.locked_value) * Number(r.bonus_percentage)) / 100);
  return null;
}
function prBonusRule(r) {
  if (Number(r.bonus_amount) > 0) return idrFull(r.bonus_amount);
  if (Number(r.bonus_percentage) > 0) return `${r.bonus_percentage}%`;
  return bL('set by hand', 'manual');
}
// One row per promo code from the raw rows.
function promoSummary(transactions, participants) {
  const by = new Map();
  const row = (promo, src) => {
    if (!by.has(promo)) {
      by.set(promo, {
        promo, campaign: src.campaign || '', campaign_start: src.campaign_start, campaign_end: src.campaign_end,
        min_amount: src.min_amount, campaign_holding: src.campaign_holding, rule: prBonusRule(src),
        buys: 0, users: new Set(), amount: 0, failed: 0, no_bonus: 0,
        parts: 0, waiting: 0, eligible: 0, lapsed: 0, due: 0, dueManual: 0, sent: new Map(),
        value_now: 0, days: 0, fee_total: 0, fee_aperd: 0,
      });
    }
    return by.get(promo);
  };
  for (const t of transactions) {
    const r = row(t.promo, t);
    if (t.status !== 'completed') { r.failed++; continue; }
    r.buys++; r.users.add(t.user_id); r.amount += Number(t.amount) || 0;
    if (!t.bonus) r.no_bonus++;
  }
  for (const p of participants) {
    const r = row(p.promo, p);
    r.parts++;
    if (p.status === 'on_going') r.waiting++;
    else if (p.status === 'succeeded') r.eligible++;
    else if (p.status === 'redeemed') r.lapsed++;
    const due = prBonusDue(p);
    if (due == null) r.dueManual++; else r.due += due;
    r.sent.set(p.user_id, Number(p.bonus_paid) || 0); // a payout is per customer and promo, not per participation
    r.value_now += Number(p.value_now) || 0; r.days += Number(p.days_held) || 0;
    r.fee_total += Number(p.fee_total) || 0; r.fee_aperd += Number(p.fee_aperd) || 0;
  }
  return [...by.values()].map((r) => ({
    ...r, users: r.users.size, sent: [...r.sent.values()].reduce((a, v) => a + v, 0),
    avg_days: r.parts ? Math.round(r.days / r.parts) : null,
  })).sort((a, b) => b.amount - a.amount);
}

async function loadPromoRecap() {
  if (!$('#prFrom').value) {
    const today = bWibToday();
    $('#prFrom').value = `${today.slice(0, 4)}-01-01`;
    $('#prTo').value = today;
  }
  PR.loading = true;
  ['#prKpis', '#prSummary', '#prParticipants', '#prTransactions'].forEach((sel) => { $(sel).innerHTML = `<div class="loading">${t('common_loading')}</div>`; });
  try {
    const qs = new URLSearchParams({ from: $('#prFrom').value, to: $('#prTo').value });
    $('#prCodes').value.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean).forEach((c) => qs.append('promo', c));
    PR.data = await api(`/api/promo-recap/data?${qs}`);
    renderPromoRecap();
  } catch (e) {
    ['#prKpis', '#prSummary', '#prParticipants', '#prTransactions'].forEach((sel) => { $(sel).innerHTML = `<div class="empty">${bEsc(e.message)}</div>`; });
  } finally { PR.loading = false; }
}

function renderPromoRecap() {
  if (!PR.data) return;
  const { transactions, participants } = PR.data;
  const sum = promoSummary(transactions, participants);
  const total = (k) => sum.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  $('#prKpis').innerHTML = [
    kpi(bL('Promo buys', 'Beli dengan promo'), num(total('buys')), bL(`${num(new Set(transactions.filter((x) => x.status === 'completed').map((x) => x.user_id)).size)} customers, ${idr(total('amount'))}`, `${num(new Set(transactions.filter((x) => x.status === 'completed').map((x) => x.user_id)).size)} nasabah, ${idr(total('amount'))}`), 'accent', ICONS.receipt),
    kpi(bL('Eligible', 'Layak'), num(total('eligible')), bL('holding period done', 'holding selesai'), '', ICONS.check),
    kpi(bL('Waiting', 'Menunggu'), num(total('waiting')), bL('still locked', 'masih terkunci'), '', ICONS.hourglass),
    kpi(bL('Lapsed', 'Gugur'), num(total('lapsed')), bL(`withdrawn early; ${num(total('no_bonus'))} buys got no bonus`, `ditarik lebih awal; ${num(total('no_bonus'))} beli tidak dapat bonus`), '', ICONS.xCircle),
    kpi(bL('Bonus owed / sent', 'Bonus harus / sudah dikirim'), `${idr(total('due'))} / ${idr(total('sent'))}`, total('dueManual') ? bL(`+ ${num(total('dueManual'))} set by hand`, `+ ${num(total('dueManual'))} ditentukan manual`) : '', '', ICONS.coin),
    kpi(bL('Fee earned (AperD)', 'Fee didapat (AperD)'), idr(total('fee_aperd')), bL(`of ${idr(total('fee_total'))} management fee`, `dari ${idr(total('fee_total'))} management fee`), '', ICONS.trendUp),
  ].join('');

  genTable('#prSummary', sum.map((r) => ({
    ...r, promo: bEsc(r.promo), campaign: bEsc(r.campaign),
    window: r.campaign_start ? `${r.campaign_start} s.d. ${r.campaign_end || ''}` : 'n/a',
  })), [
    { key: 'promo', label: 'Promo' }, { key: 'campaign', label: t('col_campaign') }, { key: 'window', label: bL('Campaign dates', 'Periode campaign') },
    { key: 'min_amount', label: bL('Minimum', 'Minimum'), type: 'idr' }, { key: 'campaign_holding', label: bL('Holding until', 'Holding sampai'), type: 'date' },
    { key: 'rule', label: bL('Bonus rule', 'Aturan bonus') },
    { key: 'buys', label: bL('Buys', 'Beli'), type: 'num', sum: true }, { key: 'users', label: bL('Customers', 'Nasabah'), type: 'num', sum: true },
    { key: 'amount', label: bL('Amount', 'Nominal'), type: 'idr', sum: true }, { key: 'failed', label: bL('Expired or cancelled', 'Expired atau batal'), type: 'num', sum: true },
    { key: 'no_bonus', label: bL('No bonus', 'Tanpa bonus'), type: 'num', sum: true },
    { key: 'waiting', label: bL('Waiting', 'Menunggu'), type: 'num', sum: true }, { key: 'eligible', label: bL('Eligible', 'Layak'), type: 'num', sum: true },
    { key: 'lapsed', label: bL('Lapsed', 'Gugur'), type: 'num', sum: true },
    { key: 'due', label: bL('Bonus owed', 'Bonus harus dikirim'), type: 'idr', sum: true }, { key: 'sent', label: bL('Bonus sent', 'Bonus terkirim'), type: 'idr', sum: true },
    { key: 'value_now', label: bL('Still held today', 'Masih dipegang hari ini'), type: 'idr', sum: true }, { key: 'avg_days', label: bL('Avg days held', 'Rata-rata hari holding'), type: 'num' },
    { key: 'fee_total', label: bL('Management fee', 'Management fee'), type: 'idr', sum: true }, { key: 'fee_aperd', label: bL('Fee AperD', 'Fee AperD'), type: 'idr', sum: true },
  ], bL('No promo buys in this window.', 'Tidak ada pembelian promo di rentang ini.'));

  const status = $('#prStatus').value;
  genTable('#prParticipants', participants.filter((r) => !status || r.status === status).map((r) => {
    const due = prBonusDue(r);
    return {
      promo: bEsc(r.promo), campaign: bEsc(r.campaign || ''), name: bEsc(r.name || 'n/a'), email: bEsc(r.email), phone: bEsc(r.phone || ''),
      sid: bEsc(r.sid || ''), ifua: bEsc(r.ifua || ''), fund: bEsc(r.fund || ''), manager: bEsc(r.manager || ''),
      unit: Math.round(Number(r.unit) * 10000) / 10000, locked_value: r.locked_value, start_d: r.start_d, holding_d: r.holding_d,
      status: r.status === 'redeemed' && r.redeemed_d ? `${prStatus(r.status)} (${r.redeemed_d})` : prStatus(r.status),
      due: due == null ? bL('set by hand', 'manual') : due, sent: Number(r.bonus_paid) || 0, sent_on: r.bonus_paid_on,
      days: r.days_held, value_now: r.value_now, fee_total: r.fee_total, fee_aperd: r.fee_aperd,
    };
  }), [
    { key: 'promo', label: 'Promo' }, { key: 'campaign', label: t('col_campaign') }, { key: 'name', label: bL('Customer', 'Nasabah') },
    { key: 'email', label: 'Email' }, { key: 'phone', label: bL('Phone', 'HP') }, { key: 'sid', label: 'SID' }, { key: 'ifua', label: 'IFUA' },
    { key: 'fund', label: bL('Product', 'Produk') }, { key: 'manager', label: 'MI' },
    { key: 'unit', label: bL('Units locked', 'Unit dikunci'), type: 'num' }, { key: 'locked_value', label: bL('Value locked', 'Nilai dikunci'), type: 'idr', sum: true },
    { key: 'start_d', label: bL('Locked on', 'Mulai dikunci'), type: 'date' }, { key: 'holding_d', label: bL('Holding until', 'Holding sampai'), type: 'date' },
    { key: 'status', label: 'Status' }, { key: 'due', label: bL('Bonus owed', 'Bonus harus dikirim'), type: 'idr', sum: true },
    { key: 'sent', label: bL('Bonus sent', 'Bonus terkirim'), type: 'idr', sum: true }, { key: 'sent_on', label: bL('Sent on', 'Dikirim'), type: 'date' },
    { key: 'days', label: bL('Days held', 'Hari holding'), type: 'num' }, { key: 'value_now', label: bL('Still held today', 'Masih dipegang hari ini'), type: 'idr', sum: true },
    { key: 'fee_total', label: t('col_management_fee'), type: 'idr', sum: true }, { key: 'fee_aperd', label: t('col_fee_aperd'), type: 'idr', sum: true },
  ], bL('No promo participation matches.', 'Tidak ada peserta promo yang cocok.'));

  genTable('#prTransactions', transactions.map((r) => ({
    day: r.day, promo: bEsc(r.promo), campaign: bEsc(r.campaign || ''), name: bEsc(r.name || 'n/a'), email: bEsc(r.email), phone: bEsc(r.phone || ''),
    sid: bEsc(r.sid || ''), ifua: bEsc(r.ifua || ''), fund: bEsc(r.fund || ''), manager: bEsc(r.manager || ''),
    amount: r.amount, unit: r.unit == null ? null : Math.round(Number(r.unit) * 10000) / 10000, status: bEsc(r.status), payment: bEsc(r.payment_method || ''),
    bonus: r.status !== 'completed' ? '' : prStatus(r.bonus ? r.bonus.status : 'none'), holding: r.bonus ? r.bonus.holding_until : null,
  })), [
    { key: 'day', label: bL('Day (WIB)', 'Tanggal (WIB)'), type: 'date' }, { key: 'promo', label: 'Promo' }, { key: 'campaign', label: t('col_campaign') },
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'email', label: 'Email' }, { key: 'phone', label: bL('Phone', 'HP') },
    { key: 'sid', label: 'SID' }, { key: 'ifua', label: 'IFUA' }, { key: 'fund', label: bL('Product', 'Produk') }, { key: 'manager', label: 'MI' },
    { key: 'amount', label: bL('Amount', 'Nominal'), type: 'idr', sum: true }, { key: 'unit', label: 'Unit', type: 'num' },
    { key: 'status', label: bL('Transaction', 'Transaksi') }, { key: 'payment', label: bL('Payment', 'Pembayaran') },
    { key: 'bonus', label: bL('Bonus status', 'Status bonus') }, { key: 'holding', label: bL('Holding until', 'Holding sampai'), type: 'date' },
  ], bL('No promo buys in this window.', 'Tidak ada pembelian promo di rentang ini.'));
}

// BOOTH EVENT: offline booths in three malls. Every rule and number comes
// from BOOTH_EVENT (public/booth-event-config.js); the server only returns
// raw rows (customers, completed transactions, recurring plans) and
// boothCompute / boothIncentives / boothCustomerBonuses below turn them into
// the recaps, incentives and customer bonuses, so a rule change is a config
// change. Days are WIB dates as YYYY-MM-DD strings.
const bL = (en, id) => (getLang() === 'id' ? id : en);
const bAddDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const bWibToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
// Tier list -> amount of the highest tier reached.
const bTier = (tiers, reached) => tiers.reduce((amt, tr) => (reached(tr) ? tr.amount : amt), 0);

function boothCompute({ customers, transactions }, cfg, today) {
  const roster = new Map(cfg.roster.map((r) => [r.code.toUpperCase(), r]));
  const last = cfg.periods[cfg.periods.length - 1];
  // A verification after the event lands in the last period.
  const periodOf = (day) => cfg.periods.find((pd) => day >= pd.from && day <= pd.to) || (day > last.to ? last : null);
  const txBy = new Map();
  for (const t of transactions) {
    if (!txBy.has(t.user_id)) txBy.set(t.user_id, []);
    txBy.get(t.user_id).push({ ...t, amount: Number(t.amount) || 0 });
  }
  const people = customers.map((c) => {
    const r = roster.get(String(c.code || '').toUpperCase()) || null;
    const txs = (txBy.get(c.user_id) || []).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const buys = txs.filter((t) => t.type === 'buy');
    const sells = txs.filter((t) => t.type === 'sell');
    const sum = (list, ok) => list.reduce((a, t) => a + (ok(t) ? t.amount : 0), 0);
    let cum = 0, fundedOn = null;
    for (const t of txs) {
      cum += t.type === 'buy' ? t.amount : -t.amount;
      if (!fundedOn && cum >= cfg.sales.minFunded) fundedOn = t.day;
    }
    const aumNow = Number(c.aum_now) || 0;
    const firstBuy = buys[0] || null;
    const lastSell = sells.length ? sells[sells.length - 1].day : null;
    const isNew = c.via === 'code';
    return {
      ...c, aumNow, txs, buys, sells, isNew,
      person: r ? r.person : null, booth: r ? r.booth : null, role: r ? r.role : null,
      verified: c.verification_status === 'verified' && !!c.verified_on,
      sidPeriod: isNew && c.verification_status === 'verified' && c.verified_on ? periodOf(c.verified_on) : null,
      firstBuy, fundedOn,
      totalBuy: sum(buys, () => true), totalSell: sum(sells, () => true),
      // Money in minus money out, up to and including `day`.
      netUpTo: (day) => sum(buys, (t) => t.day <= day) - sum(sells, (t) => t.day <= day),
      buysBetween: (from, to) => sum(buys, (t) => t.day >= from && t.day <= to),
      samBuys: sum(buys, (t) => t.sam),
      // Days from the first buy until today while still holding, or until the last sell.
      heldDays: firstBuy ? bDays(firstBuy.day, aumNow > 0 || !lastSell ? today : lastSell) : null,
      holding: firstBuy ? (aumNow > 0 ? 'holding' : 'sold') : 'none',
    };
  });
  return { people, roster };
}

// Recap per booth (panels "Recap per booth"): new customers counted under the booth of
// the code they registered with, for the WIB days from..to (inclusive). Always every
// booth, whatever the page's booth and sales filters say. Returns one row per booth in
// the config's order plus a last row with booth '' for all booths together.
//   registered = registered_on in range.
//   kyc        = of those registered in range, how many verified (any day), so it never
//                exceeds registered.
//   firstBuy   = first completed buy in range, funded = net purchases first reached the
//                funded minimum in range (each customer once, on that day).
//   buy / sell = completed transactions in range. Amounts are what was paid in or out.
const BOOTH_RECAP_OPEN = '9999-12-31';
function boothRecap(people, cfg, from, to) {
  const blank = () => ({ registered: 0, kyc: 0, firstBuy: 0, funded: 0, buy: 0, sell: 0 });
  const by = new Map(Object.keys(cfg.booths).map((k) => [k, blank()]));
  const all = blank();
  const inR = (d) => d != null && d >= from && d <= to;
  const bump = (booth, field, n = 1) => { by.get(booth)[field] += n; all[field] += n; };
  for (const x of people) {
    if (!x.isNew || !by.has(x.booth)) continue;
    if (inR(x.registered_on)) { bump(x.booth, 'registered'); if (x.verified) bump(x.booth, 'kyc'); }
    if (x.firstBuy && inR(x.firstBuy.day)) bump(x.booth, 'firstBuy');
    if (inR(x.fundedOn)) bump(x.booth, 'funded');
    for (const tx of x.txs) if (inR(tx.day)) bump(x.booth, tx.type === 'buy' ? 'buy' : 'sell', tx.amount);
  }
  const rows = [...by].map(([booth, r]) => ({ booth, name: cfg.booths[booth], ...r }));
  return by.size > 1 ? rows.concat({ booth: '', name: '', ...all }) : rows;
}

// Transaction list (panel "Transactions"): server rows plus the roster's booth and
// person for the matched code, filtered by the page's booth / sales filters and the
// panel's own customer kind, status, type and amount filters. amount min / max are
// inclusive; '' or null means no limit. kind: 'new' = registered with an event code
// (via 'code'); 'existing' = registered before the event and bought with a sales code
// as promo code (the top up rule, same test as boothCustomerBonuses); 'other' = signed
// up during the event without an event code but used one as promo code, which neither
// bonus counts.
function boothTxFilter(rows, cfg, f = {}) {
  const roster = new Map(cfg.roster.map((r) => [r.code.toUpperCase(), r]));
  const lim = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const min = lim(f.min), max = lim(f.max);
  return rows.map((r) => {
    const ro = roster.get(String(r.code || '').toUpperCase()) || null;
    return { ...r, amount: Number(r.amount) || 0, person: ro ? ro.person : null, booth: ro ? ro.booth : null, kind: r.via === 'code' ? 'new' : (r.registered_on || '9999') < cfg.start ? 'existing' : 'other' };
  }).filter((r) => (!f.booth || r.booth === f.booth) && (!f.person || r.person === f.person)
    && (!f.kind || r.kind === f.kind) && (!f.status || r.status === f.status) && (!f.type || r.type === f.type)
    && (min == null || r.amount >= min) && (max == null || r.amount <= max));
}
// Holding check of one completed buy (server: hold_days, hold_broken_on; same rule as
// the referral program). null for any other row. A buy with no snapshot yet is
// "pending" for a week (the snapshot job runs about a day behind), after that
// "no_snapshot": most likely sold out before the first daily snapshot.
function boothHoldState(r, cfg, today) {
  if (r.type !== 'buy' || r.status !== 'completed') return null;
  const need = cfg.txHoldDays || 30;
  if (r.hold_days == null) return { key: bDays(r.done_day, today) <= 7 ? 'pending' : 'no_snapshot', days: null };
  const days = Number(r.hold_days);
  if (r.hold_broken_on) return { key: 'broken', days, on: r.hold_broken_on };
  return { key: days >= need ? 'held' : 'holding', days };
}

// Incentives for one period: sales and flying team per person, team leads per booth.
function boothIncentives(people, cfg, period, today) {
  const scale = period.workDays / cfg.fullMonthWorkDays;
  const needSid = (n) => Math.ceil(n * scale - 1e-9);
  const status = today <= period.to ? 'running' : today <= period.m1.to ? 'waiting_m1' : 'final';
  const measure = (cohort, minFunded, minRepeat) => {
    const sid = cohort.length;
    const funded = cohort.filter((x) => x.netUpTo(period.to) >= minFunded).length;
    const repeat = cohort.filter((x) => x.buysBetween(period.m1.from, period.m1.to) >= minRepeat).length;
    return {
      sid, funded, fundedPct: sid ? (funded / sid) * 100 : 0,
      aum: cohort.reduce((a, x) => a + Math.max(0, x.netUpTo(period.to)), 0),
      repeat, repeatPct: sid ? (repeat / sid) * 100 : 0,
    };
  };
  const inPeriod = people.filter((x) => x.sidPeriod === period);
  const S = cfg.sales;
  const persons = [...new Set(cfg.roster.filter((r) => r.role === 'sales' || r.role === 'flying').map((r) => r.person))];
  const sales = persons.map((person) => {
    const codes = cfg.roster.filter((r) => r.person === person);
    const m = measure(inPeriod.filter((x) => x.person === person), S.minFunded, S.rule4.minAmount);
    const target = S.dailySidTarget * period.workDays;
    const gateSid = needSid(S.gate.minSid);
    const gate = m.sid >= gateSid && m.fundedPct >= S.gate.minFundedPct;
    const r1 = gate ? bTier(S.rule1, (tr) => m.sid >= needSid(tr.minSid)) : 0;
    const r2 = gate ? bTier(S.rule2, (tr) => m.fundedPct >= tr.minPct) : 0;
    const r3 = gate ? bTier(S.rule3, (tr) => m.aum >= Math.round(tr.minAum * scale)) : 0;
    const r4 = gate && m.repeatPct >= S.rule4.minPct ? S.rule4.amount : 0;
    const total = r1 + r2 + r3 + r4;
    return {
      person, role: codes[0].role, codes: codes.map((r) => r.code).join(', '),
      booth: [...new Set(codes.map((r) => r.booth))].join(', '),
      target, gateSid, ...m, gate, r1, r2, r3, r4, total, paid: Math.min(total, S.cap),
      aumTarget: Math.round(S.aumTarget * scale), status,
    };
  });
  const T = cfg.teamLead;
  const leads = Object.keys(cfg.booths).map((booth) => {
    const lead = cfg.roster.find((r) => r.role === 'team_lead' && r.booth === booth);
    const m = measure(inPeriod.filter((x) => x.booth === booth), T.minFunded, T.rule4.minAmount);
    const target = T.salesPerBooth * T.dailySidTarget * period.workDays;
    const sidPct = target ? (m.sid / target) * 100 : 0;
    const gate = sidPct >= T.gate.minSidPct && m.fundedPct >= T.gate.minFundedPct;
    const r1 = gate ? bTier(T.rule1, (tr) => sidPct >= tr.minSidPct) : 0;
    const r2 = gate ? bTier(T.rule2, (tr) => m.fundedPct >= tr.minPct) : 0;
    const r3 = gate ? bTier(T.rule3, (tr) => m.aum >= Math.round(tr.minAum * scale)) : 0;
    const r4 = gate && m.repeatPct >= T.rule4.minPct ? T.rule4.amount : 0;
    const total = r1 + r2 + r3 + r4;
    return {
      booth, person: lead ? lead.person : 'n/a', code: lead ? lead.code : '', target, sidPct, ...m, gate,
      r1, r2, r3, r4, total, paid: Math.min(total, T.cap), status,
      aumTarget: Math.round(T.aumTarget * scale),
    };
  });
  return { sales, leads, scale, status };
}

// Customer bonus programs: welcome bonus, nabung rutin, top up of existing customers.
function boothCustomerBonuses(people, plans, cfg, today) {
  const C = cfg.customer;
  const promo = new Set([...cfg.roster.map((r) => r.code.toUpperCase()), ...C.promoCodes.map((c) => String(c).toUpperCase())]);
  const samSoldBetween = (x, from, to) => x.sells.find((t) => t.sam && t.day > from && t.day <= to);
  const holdState = (x, from, days) => {
    const until = bAddDays(from, days);
    const sold = samSoldBetween(x, from, until);
    if (sold) return { key: 'lapsed', until, soldOn: sold.day };
    return { key: today >= until ? 'eligible' : 'holding', until };
  };
  const welcome = people.filter((x) => x.isNew && x.firstBuy).map((x) => {
    const f = x.firstBuy;
    const ok = f.sam && f.amount >= C.welcome.minFirstBuy;
    const st = ok ? holdState(x, f.day, C.welcome.holdingDays) : { key: f.sam ? 'below_min' : 'not_sam' };
    return { x, day: f.day, fund: f.fund, amount: f.amount, sam: f.sam, ...st, bonus: st.key === 'eligible' ? C.welcome.bonus : 0 };
  });
  const byUser = new Map(people.map((x) => [x.user_id, x]));
  const nabung = (plans || []).filter((pl) => byUser.has(pl.user_id) && pl.created_on >= cfg.start).map((pl) => {
    const x = byUser.get(pl.user_id);
    const months = [...new Set(x.buys.filter((t) => t.plan_id === pl.plan_id).map((t) => t.day.slice(0, 7)))].sort();
    let streak = 0, best = 0, prev = null;
    for (const mo of months) {
      const next = prev && (() => { const [y, m] = prev.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
      streak = prev && mo === next ? streak + 1 : 1;
      best = Math.max(best, streak);
      prev = mo;
    }
    const samAmount = Number(pl.sam_amount) || 0;
    const fits = pl.frequency === 'MONTHLY' && samAmount >= C.nabungRutin.minMonthly;
    const key = !fits ? 'not_eligible' : best >= C.nabungRutin.minMonths ? 'eligible' : pl.deleted ? 'stopped' : 'running';
    return { x, plan: pl, samAmount, months: best, key, bonus: key === 'eligible' ? C.nabungRutin.bonus : 0 };
  });
  const topUp = people.filter((x) => x.registered_on < cfg.start).map((x) => {
    const qual = x.buys.filter((t) => t.sam && t.amount >= C.topUp.minAmount && promo.has(t.promo) && t.day >= cfg.start && t.day <= cfg.end);
    if (!qual.length) return null;
    const amount = qual.reduce((a, t) => a + t.amount, 0);
    const st = holdState(x, qual[0].day, C.topUp.holdingDays);
    const cashback = Math.min(amount * C.topUp.cashbackPct / 100, C.topUp.cashbackMax);
    const r = cfg.roster.find((rr) => rr.code.toUpperCase() === qual[0].promo);
    return { x, day: qual[0].day, promo: qual[0].promo, person: r ? r.person : '', amount, cashback, ...st, payable: st.key === 'eligible' ? cashback : 0 };
  }).filter(Boolean);
  return { welcome, nabung, topUp };
}

// "Data as of" line: the warehouse copies of users, user_profiles and
// transactions are refreshed by scheduled queries, so the oldest copy time is
// the moment up to which registrations and purchases are guaranteed to show.
// `fresh` is [{ table_id, modified_at (UTC ISO) }]; returns '' when unknown.
function boothFreshText(fresh) {
  const times = (fresh || []).map((r) => Date.parse(r.modified_at)).filter((n) => !Number.isNaN(n));
  if (!times.length) return '';
  const wib = new Date(Math.min(...times) + 7 * 3600000).toISOString();
  const at = `${wib.slice(0, 10)} ${wib.slice(11, 16)}`;
  return bL(
    `Data as of ${at} WIB. Registrations, KYC and purchases come from copies of the main database that refresh on a schedule, so anyone who signed up after that time appears after the next refresh.`,
    `Data per ${at} WIB. Pendaftaran, KYC, dan transaksi dibaca dari salinan database utama yang diperbarui berkala, jadi yang daftar setelah jam itu baru muncul di refresh berikutnya.`);
}

const BOOTH = { data: null, people: null, loading: false, tx: null, txToken: 0 };
const bEsc = (v) => escapeHtml(v == null ? '' : v);
// "Viki Setiadi (Sales PIM 1)" once the roster has the name, else just the
// position. `person` stays the filter key; this is display only. A flying team
// person has three codes, so the first filled name of that person is used.
const bWho = (cfg, person) => {
  if (!person) return '';
  const r = cfg.roster.find((x) => x.person === person && x.name);
  return r ? `${r.name} (${person})` : person;
};
const bStatusLabel = (k, x) => ({
  running: bL('Running (estimate)', 'Berjalan (sementara)'),
  waiting_m1: bL('Rules 1-3 final, rule 4 waits for M1', 'Rule 1-3 final, rule 4 menunggu M1'),
  final: bL('Final', 'Final'),
  eligible: bL('Eligible', 'Layak'),
  holding: bL(`Holding until ${x && x.until}`, `Holding sampai ${x && x.until}`),
  lapsed: bL(`Lapsed: sold SAM on ${x && x.soldOn}`, `Gugur: jual SAM ${x && x.soldOn}`),
  below_min: bL('First buy below minimum', 'Beli pertama di bawah minimum'),
  not_sam: bL('First buy not a SAM fund', 'Beli pertama bukan produk SAM'),
  not_eligible: bL('Not monthly, or SAM part below minimum', 'Bukan bulanan, atau porsi SAM di bawah minimum'),
  stopped: bL('Plan stopped', 'Rencana berhenti'),
}[k] || k);

async function loadBoothEvent() {
  const cfg = BOOTH_EVENT;
  if (!$('#bePeriod').options.length) {
    const today = bWibToday();
    const current = cfg.periods.find((pd) => today >= pd.from && today <= pd.to) || (today < cfg.periods[0].from ? cfg.periods[0] : cfg.periods[cfg.periods.length - 1]);
    $('#bePeriod').innerHTML = cfg.periods.map((pd) => `<option value="${pd.id}"${pd === current ? ' selected' : ''}>${bEsc(pd.label)}</option>`).join('');
    $('#beBooth').innerHTML = `<option value="">${bL('All booths', 'Semua booth')}</option>` + Object.entries(cfg.booths).map(([k, v]) => `<option value="${k}">${bEsc(v)}</option>`).join('');
    $('#bePerson').innerHTML = `<option value="">${bL('Everyone', 'Semua')}</option>` + [...new Set(cfg.roster.map((r) => r.person))].map((n) => `<option value="${bEsc(n)}">${bEsc(bWho(cfg, n))}</option>`).join('');
  }
  BOOTH.loading = true;
  $('#beKpis').innerHTML = `<div class="loading">${t('common_loading')}</div>`;
  try {
    const qs = new URLSearchParams({ from: cfg.start, to: cfg.end, sam: cfg.customer.samManager });
    cfg.roster.forEach((r) => qs.append('codes', r.code));
    cfg.customer.promoCodes.forEach((c) => qs.append('promo', c));
    BOOTH.data = await api(`/api/booth-event/data?${qs}`);
    renderBoothEvent();
    loadBoothTx(qs);
  } catch (e) {
    $('#beKpis').innerHTML = `<div class="empty">${bEsc(e.message)}</div>`;
  } finally { BOOTH.loading = false; }
}

// The transaction list is its own call (it reads more of portfolio_fix), so the rest of
// the tab shows first and this panel fills in when it arrives. A reload that starts
// while an older call is running makes the older answer get dropped.
async function loadBoothTx(qs) {
  const mine = ++BOOTH.txToken;
  BOOTH.tx = { loading: true };
  renderBoothTx();
  const q = new URLSearchParams(qs);
  q.set('hold', String(BOOTH_EVENT.txHoldDays || 30));
  try {
    const res = await api(`/api/booth-event/transactions?${q}`);
    if (mine !== BOOTH.txToken) return;
    BOOTH.tx = { rows: res.rows || [] };
  } catch (e) {
    if (mine !== BOOTH.txToken) return;
    BOOTH.tx = { error: e.message };
  }
  renderBoothTx();
}

function renderBoothTx() {
  const tx = BOOTH.tx;
  if (!tx || !$('#beTx')) return;
  const cfg = BOOTH_EVENT;
  const need = cfg.txHoldDays || 30;
  $('#beTxHint').textContent = bL(
    `Every transaction except expired and cancelled, one row each, of the new customers above and of existing users who bought with a sales code as promo code. Customer type: New = registered with an event code during the event; Existing = registered before the event; Other = signed up during the event without an event code (counts for neither bonus). The promo code column is the code typed on that transaction (the top up cashback needs a SAM purchase of ${idr(cfg.customer.topUp.minAmount)}+ with a sales code, see the rules at the top of the tab). Hold days (completed buys only): days in a row the fund's units stayed at or above the units right after the purchase, up to ${need}. Same check as the referral program, read from the daily snapshot, so it runs about a day behind.`,
    `Semua transaksi kecuali expired dan cancelled, satu baris per transaksi, milik nasabah baru di atas dan user existing yang beli dengan kode sales sebagai kode promo. Tipe nasabah: Baru = daftar dengan kode event selama event; Existing = daftar sebelum event; Lainnya = daftar saat event tanpa kode event (tidak masuk bonus apa pun). Kolom kode promo = kode yang dipakai di transaksi itu (cashback top up butuh pembelian SAM ${idr(cfg.customer.topUp.minAmount)}+ dengan kode sales, aturannya ada di atas tab ini). Hari holding (hanya beli completed): berapa hari berturut-turut unit produk tidak turun di bawah unit sesaat setelah pembelian, maksimal ${need} hari. Pengecekannya sama dengan program referral, dibaca dari snapshot harian, jadi tertinggal sekitar sehari.`);
  if (tx.loading) {
    $('#beTx').innerHTML = `<div class="loading">${t('common_loading')}</div>`;
    $('#beTxSummary').textContent = '';
    return;
  }
  if (tx.error) {
    $('#beTx').innerHTML = `<div class="empty">${bEsc(tx.error)}</div>`;
    $('#beTxSummary').textContent = '';
    return;
  }
  // Status and type choices come from the data; keep the pick across re-renders.
  const fill = (sel, values, all) => {
    const el = $(sel), keep = el.value;
    el.innerHTML = `<option value="">${all}</option>` + values.map((v) => `<option value="${bEsc(v)}">${bEsc(v)}</option>`).join('');
    el.value = values.includes(keep) ? keep : '';
  };
  const kindEl = $('#beTxKind'), keepKind = kindEl.value;
  kindEl.innerHTML = `<option value="">${bL('All customers', 'Semua nasabah')}</option><option value="new">${bL('New customers', 'Nasabah baru')}</option><option value="existing">${bL('Existing users', 'User existing')}</option><option value="other">${bL('Other (signed up in the event, no code)', 'Lainnya (daftar saat event, tanpa kode)')}</option>`;
  kindEl.value = keepKind;
  fill('#beTxStatus', [...new Set(tx.rows.map((r) => r.status))].sort(), t('common_all_statuses'));
  fill('#beTxType', [...new Set(tx.rows.map((r) => r.type))].sort(), t('common_all_types'));

  const today = bWibToday();
  const rows = boothTxFilter(tx.rows, cfg, {
    booth: $('#beBooth').value, person: $('#bePerson').value, kind: $('#beTxKind').value,
    status: $('#beTxStatus').value, type: $('#beTxType').value, min: $('#beTxMin').value, max: $('#beTxMax').value,
  });
  const buys = rows.filter((r) => r.type === 'buy');
  $('#beTxSummary').textContent = bL(
    `${num(rows.length)} of ${num(tx.rows.length)} transactions from ${num(new Set(rows.map((r) => r.user_id)).size)} ${new Set(rows.map((r) => r.user_id)).size === 1 ? 'customer' : 'customers'}. Buys in this list: ${num(buys.length)}, ${idrFull(buys.reduce((a, r) => a + r.amount, 0))}.`,
    `${num(rows.length)} dari ${num(tx.rows.length)} transaksi, ${num(new Set(rows.map((r) => r.user_id)).size)} nasabah. Beli di daftar ini: ${num(buys.length)}, ${idrFull(buys.reduce((a, r) => a + r.amount, 0))}.`);
  const holdText = (r) => {
    const h = boothHoldState(r, cfg, today);
    if (!h) return '';
    return {
      held: bL(`Held ${need} days`, `Lolos ${need} hari`),
      holding: bL(`Still holding, day ${h.days} of ${need}`, `Masih menahan, hari ke-${h.days} dari ${need}`),
      broken: bL(`Units dropped on ${h.on} (held ${h.days} days)`, `Unit turun pada ${h.on} (tertahan ${h.days} hari)`),
      pending: bL('Waiting for the first snapshot', 'Menunggu snapshot pertama'),
      no_snapshot: bL('No snapshot found (sold before the first one?)', 'Tidak ada snapshot (dijual sebelum snapshot pertama?)'),
    }[h.key];
  };
  genTable('#beTx', rows.map((r) => ({
    when: r.created_wib, kind: { new: bL('New', 'Baru'), existing: 'Existing', other: bL('Other', 'Lainnya') }[r.kind], registered: r.registered_on || '',
    promo: bEsc(r.promo || ''), name: bEsc(r.name || 'n/a'), email: bEsc(r.email), phone: bEsc(r.phone || ''), sid: bEsc(r.sid || ''), ifua: bEsc(r.ifua || ''),
    booth: bEsc(r.booth || ''), person: bEsc(bWho(cfg, r.person)), referrer: bEsc(r.referrer_code || ''), sales: bEsc(r.sales_code || ''),
    type: bEsc(r.type), status: bEsc(r.status), payment: bEsc(r.payment_method || ''), fund: bEsc(r.fund || ''), amount: r.amount,
    hold_days: r.type === 'buy' && r.status === 'completed' && r.hold_days != null ? Number(r.hold_days) : null, hold: bEsc(holdText(r)),
  })), [
    { key: 'when', label: bL('Date (WIB)', 'Tanggal (WIB)'), text: true }, { key: 'kind', label: bL('Customer type', 'Tipe nasabah') },
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'email', label: 'Email' },
    { key: 'phone', label: bL('Phone', 'HP'), text: true }, { key: 'sid', label: 'SID', text: true }, { key: 'ifua', label: 'IFUA', text: true },
    { key: 'booth', label: 'Booth' }, { key: 'person', label: 'Sales' }, { key: 'referrer', label: bL('Referrer code', 'Kode referrer') }, { key: 'sales', label: bL('Sales code', 'Kode sales') },
    { key: 'registered', label: bL('Registered', 'Daftar'), text: true }, { key: 'promo', label: bL('Promo code', 'Kode promo') },
    { key: 'type', label: bL('Type', 'Tipe') }, { key: 'status', label: 'Status' }, { key: 'payment', label: bL('Payment', 'Pembayaran') }, { key: 'fund', label: bL('Fund', 'Produk') },
    { key: 'amount', label: bL('Amount (Rp)', 'Nominal (Rp)'), type: 'num' },
    { key: 'hold_days', label: bL('Hold days', 'Hari holding'), type: 'num' }, { key: 'hold', label: bL('Holding', 'Status holding') },
  ], bL('No transaction matches.', 'Tidak ada transaksi yang cocok.'));
  renderBoothRecapNote();
}

// Both recap tables have their own dates and follow the booth and sales filters above,
// so they only list the booths those filters leave. The overall table starts as the
// whole event and, when its end date is the event's last day, also takes verifications
// and purchases after the event, so the totals match the KPI cards. The daily table
// starts as today, one block per day, and stays inside the event days.
function renderBoothRecap(people) {
  const cfg = BOOTH_EVENT;
  const view = { booth: $('#beBooth').value, person: $('#bePerson').value };
  const pick = (x) => (!view.booth || x.booth === view.booth) && (!view.person || x.person === view.person);
  const ppl = people.filter(pick);
  const shown = view.booth ? { [view.booth]: cfg.booths[view.booth] }
    : view.person
      ? Object.fromEntries([...new Set(cfg.roster.filter((r) => r.person === view.person).map((r) => r.booth))].map((b) => [b, cfg.booths[b]]))
      : cfg.booths;
  const rcfg = { ...cfg, booths: shown };
  const today = bWibToday();
  const lastDay = today < cfg.end ? today : cfg.end;
  const dates = (fromSel, toSel, dFrom, dTo) => {
    const f = $(fromSel), t = $(toSel);
    f.min = t.min = cfg.start; f.max = t.max = cfg.end;
    if (!f.value) f.value = dFrom;
    if (!t.value) t.value = dTo;
    return f.value > t.value ? [t.value, f.value] : [f.value, t.value];
  };
  const label = (r) => (r.booth ? bEsc(r.name) : `<strong>${bL('All booths', 'Semua booth')}</strong>`);
  const line = (r, extra) => ({
    ...extra, booth: label(r), registered: r.registered, kyc: r.kyc,
    kycPct: r.registered ? (r.kyc / r.registered) * 100 : null,
    firstBuy: r.firstBuy, funded: r.funded, buy: r.buy, sell: r.sell, net: r.buy - r.sell,
  });
  const cols = (withDay) => [
    ...(withDay ? [{ key: 'day', label: bL('Day (WIB)', 'Tanggal (WIB)') }] : []),
    { key: 'booth', label: 'Booth' },
    { key: 'registered', label: bL('Registered', 'Daftar'), type: 'num' },
    { key: 'kyc', label: bL('KYC verified', 'KYC verified'), type: 'num' },
    ...(withDay ? [] : [{ key: 'kycPct', label: bL('% KYC of registered', '% KYC dari daftar'), type: 'pct' }]),
    { key: 'firstBuy', label: bL('First purchase', 'Transaksi pertama'), type: 'num' },
    { key: 'funded', label: bL(`Reached ${idr(cfg.sales.minFunded)}`, `Capai ${idr(cfg.sales.minFunded)}`), type: 'num' },
    { key: 'buy', label: bL('Bought', 'Beli'), type: 'idr' },
    { key: 'sell', label: bL('Sold', 'Jual'), type: 'idr' },
    ...(withDay ? [] : [{ key: 'net', label: bL('Net money in', 'Dana bersih masuk'), type: 'idr' }]),
  ];

  const [aFrom, aTo] = dates('#beRecapAllFrom', '#beRecapAllTo', cfg.start, cfg.end);
  genTable('#beRecapAll', boothRecap(ppl, rcfg, aFrom, aTo >= cfg.end ? BOOTH_RECAP_OPEN : aTo).map((r) => line(r, {})),
    cols(false), bL('No data.', 'Tidak ada data.'));

  const [dFrom, dTo] = dates('#beRecapDayFrom', '#beRecapDayTo', today < cfg.start ? cfg.start : lastDay, today < cfg.start ? cfg.start : lastDay);
  const upto = dTo < lastDay ? dTo : lastDay;
  const rows = [];
  if (dFrom <= upto && dFrom !== upto) {
    boothRecap(ppl, rcfg, dFrom, upto).forEach((r) => rows.push(line(r, { day: `<strong>${bL('Total', 'Total')} ${dFrom} s.d. ${upto}</strong>` })));
  }
  for (let d = upto; d >= dFrom; d = bAddDays(d, -1)) {
    boothRecap(ppl, rcfg, d, d).forEach((r) => rows.push(line(r, { day: d })));
  }
  genTable('#beRecapDay', rows, cols(true), bL('No event day in these dates yet.', 'Belum ada hari event di tanggal ini.'));
  renderBoothRecapNote();
}

// The recap's money columns count completed transactions only, so a buy whose payment
// is in but which has not settled yet (completed_payment, pending_payment,
// verified_by_operational) is missing there. The transaction list has those rows, so
// name them under the table instead of letting the numbers look short.
function renderBoothRecapNote() {
  const el = $('#beRecapNote');
  if (!el) return;
  const tx = BOOTH.tx;
  el.textContent = '';
  if (!tx || !tx.rows) return;
  const from = $('#beRecapAllFrom').value, to = $('#beRecapAllTo').value;
  if (!from || !to) return;
  const pending = boothTxFilter(tx.rows, BOOTH_EVENT, { kind: 'new', booth: $('#beBooth').value, person: $('#bePerson').value })
    .filter((r) => r.type === 'buy' && r.status !== 'completed' && r.created_wib.slice(0, 10) >= from && r.created_wib.slice(0, 10) <= to);
  if (!pending.length) return;
  const money = pending.reduce((a, r) => a + r.amount, 0);
  const statuses = [...new Set(pending.map((r) => r.status))].join(', ');
  el.textContent = bL(
    `Not in the money columns because the payment has not settled yet: ${num(pending.length)} ${pending.length === 1 ? 'buy' : 'buys'}, ${idrFull(money)} (${statuses}). Those rows are in the Transactions panel below.`,
    `Tidak masuk kolom nominal karena pembayarannya belum settle: ${num(pending.length)} pembelian, ${idrFull(money)} (${statuses}). Barisnya ada di panel Transaksi di bawah.`);
}

function renderBoothEvent() {
  if (!BOOTH.data) return;
  const cfg = BOOTH_EVENT;
  const today = bWibToday();
  const { people } = boothCompute(BOOTH.data, cfg, today);
  const period = cfg.periods.find((pd) => pd.id === $('#bePeriod').value) || cfg.periods[0];
  const booth = $('#beBooth').value;
  const person = $('#bePerson').value;
  const pick = (x) => (!booth || x.booth === booth) && (!person || x.person === person);
  const mine = people.filter((x) => x.isNew && pick(x));
  const yes = bL('Yes', 'Ya');
  const no = bL('No', 'Tidak');

  $('#beHint').textContent = bL(
    `${cfg.name}, ${cfg.start} to ${cfg.end}. New customers = registered with one of the ${cfg.roster.length} codes (referral or sales code). Today ${today} WIB. Rules: see "Rules and how it's counted" at the bottom.`,
    `${cfg.name}, ${cfg.start} s.d. ${cfg.end}. Nasabah baru = daftar dengan salah satu dari ${cfg.roster.length} kode (kode referral atau sales). Hari ini ${today} WIB. Aturan: lihat "Aturan dan cara hitung" di bawah.`);

  $('#beFresh').textContent = boothFreshText(BOOTH.data.fresh);
  BOOTH.people = people;
  renderBoothRecap(people);

  const held = mine.filter((x) => x.heldDays != null);
  $('#beKpis').innerHTML = [
    kpi(bL('Registered', 'Daftar'), num(mine.length), bL('with an event code', 'dengan kode event'), 'accent', ICONS.userPlus),
    kpi(bL('KYC verified (new SID)', 'KYC verified (SID baru)'), num(mine.filter((x) => x.verified).length), '', '', ICONS.check),
    kpi(bL('Made a purchase', 'Sudah transaksi'), num(mine.filter((x) => x.firstBuy).length), '', '', ICONS.receipt),
    kpi(bL('Funded', 'Funded'), num(mine.filter((x) => x.fundedOn).length), bL(`net purchases reached ${idr(cfg.sales.minFunded)}`, `dana bersih pernah mencapai ${idr(cfg.sales.minFunded)}`), '', ICONS.coin),
    kpi(bL('Net money in', 'Dana bersih masuk'), idr(mine.reduce((a, x) => a + x.totalBuy - x.totalSell, 0)), bL('buys minus sells', 'beli dikurangi jual'), '', ICONS.trendUp),
    kpi(bL('Avg days holding', 'Rata-rata lama menahan'), held.length ? `${num(Math.round(held.reduce((a, x) => a + x.heldDays, 0) / held.length))} ${bL('days', 'hari')}` : 'n/a',
      bL(`${num(mine.filter((x) => x.holding === 'holding').length)} still hold today`, `${num(mine.filter((x) => x.holding === 'holding').length)} masih menahan hari ini`), '', ICONS.hourglass),
  ].join('');

  // Daily recap, one row per event day up to today.
  const days = [];
  for (let d = cfg.start; d <= cfg.end && d <= today; d = bAddDays(d, 1)) days.push(d);
  const daily = days.map((d) => {
    const txs = mine.flatMap((x) => x.txs.filter((tx) => tx.day === d));
    return {
      day: d,
      registered: mine.filter((x) => x.registered_on === d).length,
      verified: mine.filter((x) => x.verified && x.registered_on === d).length,
      first_buy: mine.filter((x) => x.firstBuy && x.firstBuy.day === d).length,
      funded: mine.filter((x) => x.fundedOn === d).length,
      buy: txs.filter((tx) => tx.type === 'buy').reduce((a, tx) => a + tx.amount, 0),
      sell: txs.filter((tx) => tx.type === 'sell').reduce((a, tx) => a + tx.amount, 0),
    };
  }).reverse();
  genTable('#beDaily', daily, [
    { key: 'day', label: bL('Day (WIB)', 'Tanggal (WIB)'), type: 'date' },
    { key: 'registered', label: bL('Registered', 'Daftar'), type: 'num', sum: true },
    { key: 'verified', label: bL('KYC verified', 'KYC verified'), type: 'num', sum: true },
    { key: 'first_buy', label: bL('First purchase', 'Transaksi pertama'), type: 'num', sum: true },
    { key: 'funded', label: bL(`Reached ${idr(cfg.sales.minFunded)}`, `Capai ${idr(cfg.sales.minFunded)}`), type: 'num', sum: true },
    { key: 'buy', label: bL('Bought', 'Beli'), type: 'idr', sum: true },
    { key: 'sell', label: bL('Sold', 'Jual'), type: 'idr', sum: true },
  ], bL('The event has not started yet.', 'Event belum dimulai.'));

  // Incentives for the chosen period.
  const inc = boothIncentives(people, cfg, period, today);
  const st = bStatusLabel(inc.status);
  const gateText = (r, sidNeed, sidHave, pctNeed) => (r.gate ? bL('Met', 'Tercapai')
    : bL(`Not yet: SID ${sidHave}/${sidNeed}, funded ${r.fundedPct.toFixed(0)}%/${pctNeed}%`, `Belum: SID ${sidHave}/${sidNeed}, funded ${r.fundedPct.toFixed(0)}%/${pctNeed}%`));
  const salesRows = inc.sales.filter((r) => (!booth || r.booth.split(', ').includes(booth)) && (!person || r.person === person)).map((r) => ({
    ...r, person: bEsc(bWho(cfg, r.person)), codes: bEsc(r.codes), target: Math.round(r.target * 10) / 10,
    gate_text: gateText(r, r.gateSid, r.sid, cfg.sales.gate.minFundedPct), status_text: st,
  }));
  genTable('#beSales', salesRows, [
    { key: 'person', label: bL('Sales', 'Sales') }, { key: 'codes', label: bL('Code', 'Kode') }, { key: 'booth', label: 'Booth' },
    { key: 'target', label: bL('SID target', 'Target SID'), type: 'num' }, { key: 'sid', label: 'SID', type: 'num', sum: true },
    { key: 'funded', label: `Funded ${idr(cfg.sales.minFunded)}+`, type: 'num', sum: true }, { key: 'fundedPct', label: t('col_funded'), type: 'pct' },
    { key: 'gate_text', label: bL('Threshold (rules 1+2)', 'Syarat (rule 1+2)') },
    { key: 'r1', label: t('col_rule_1_sid'), type: 'idr', sum: true }, { key: 'r2', label: t('col_rule_2_funded'), type: 'idr', sum: true },
    { key: 'aum', label: bL('Net money in', 'Dana bersih'), type: 'idr', sum: true }, { key: 'aumTarget', label: bL('AUM target', 'Target AUM'), type: 'idr' },
    { key: 'r3', label: t('col_rule_3_aum'), type: 'idr', sum: true }, { key: 'repeatPct', label: bL('Bought again in M1', 'Beli lagi di M1'), type: 'pct' },
    { key: 'r4', label: t('col_rule_4_m1'), type: 'idr', sum: true }, { key: 'total', label: 'Total', type: 'idr', sum: true },
    { key: 'paid', label: bL(`Paid (max ${idr(cfg.sales.cap)})`, `Dibayar (maks. ${idr(cfg.sales.cap)})`), type: 'idr', sum: true },
    { key: 'status_text', label: 'Status' },
  ], bL('No sales in this filter.', 'Tidak ada sales di filter ini.'));

  const personBooths = person ? new Set(cfg.roster.filter((r) => r.person === person).map((r) => r.booth)) : null;
  const leadRows = inc.leads.filter((r) => (!booth || r.booth === booth) && (!personBooths || personBooths.has(r.booth))).map((r) => ({
    ...r, booth: bEsc(cfg.booths[r.booth] || r.booth), person: bEsc(bWho(cfg, r.person)), target: Math.round(r.target * 10) / 10,
    gate_text: r.gate ? bL('Met', 'Tercapai') : bL(`Not yet: SID ${r.sidPct.toFixed(0)}%/${cfg.teamLead.gate.minSidPct}%, funded ${r.fundedPct.toFixed(0)}%/${cfg.teamLead.gate.minFundedPct}%`,
      `Belum: SID ${r.sidPct.toFixed(0)}%/${cfg.teamLead.gate.minSidPct}%, funded ${r.fundedPct.toFixed(0)}%/${cfg.teamLead.gate.minFundedPct}%`),
    status_text: st,
  }));
  genTable('#beLeads', leadRows, [
    { key: 'booth', label: 'Booth' }, { key: 'person', label: 'Team lead' },
    { key: 'target', label: bL('Team SID target', 'Target SID tim'), type: 'num' }, { key: 'sid', label: bL('Team SID', 'SID tim'), type: 'num', sum: true },
    { key: 'sidPct', label: bL('Of target', 'Dari target'), type: 'pct' },
    { key: 'funded', label: `Funded ${idr(cfg.teamLead.minFunded)}+`, type: 'num', sum: true }, { key: 'fundedPct', label: t('col_funded'), type: 'pct' },
    { key: 'gate_text', label: bL('Threshold (rules 1+2)', 'Syarat (rule 1+2)') },
    { key: 'r1', label: t('col_rule_1_sid'), type: 'idr', sum: true }, { key: 'r2', label: t('col_rule_2_funded'), type: 'idr', sum: true },
    { key: 'aum', label: bL('Team net money in', 'Dana bersih tim'), type: 'idr', sum: true }, { key: 'aumTarget', label: bL('AUM target', 'Target AUM'), type: 'idr' },
    { key: 'r3', label: t('col_rule_3_aum'), type: 'idr', sum: true }, { key: 'repeatPct', label: bL('Bought again in M1', 'Beli lagi di M1'), type: 'pct' },
    { key: 'r4', label: t('col_rule_4_m1'), type: 'idr', sum: true }, { key: 'total', label: 'Total', type: 'idr', sum: true },
    { key: 'paid', label: bL(`Paid (max ${idr(cfg.teamLead.cap)})`, `Dibayar (maks. ${idr(cfg.teamLead.cap)})`), type: 'idr', sum: true },
    { key: 'status_text', label: 'Status' },
  ], bL('No booth in this filter.', 'Tidak ada booth di filter ini.'));
  $('#beIncentiveNote').textContent = bL(
    `${period.label}: ${period.from} to ${period.to}, ${period.workDays.toFixed(1)} working days (${(inc.scale * 100).toFixed(0)}% of a full month, so every target and threshold is scaled by that). M1 for rule 4: ${period.m1.from} to ${period.m1.to}. ${st}.`,
    `${period.label}: ${period.from} s.d. ${period.to}, ${period.workDays.toFixed(1)} hari kerja (${(inc.scale * 100).toFixed(0)}% dari bulan penuh, semua target dan threshold dikali angka itu). M1 untuk rule 4: ${period.m1.from} s.d. ${period.m1.to}. ${st}.`);

  // Customers: who registered, verified, bought, and how long they hold.
  genTable('#beCustomers', mine.map((x) => ({
    name: bEsc(x.name || 'n/a'), sid: bEsc(x.sid || 'n/a'), email: bEsc(x.email), phone: bEsc(x.phone || ''),
    code: bEsc(x.code), person: bEsc(bWho(cfg, x.person)), booth: bEsc(x.booth || ''),
    registered_on: x.registered_on, verified_on: x.verified ? x.verified_on : null,
    first_buy: x.firstBuy ? x.firstBuy.day : null, total_buy: x.totalBuy, net: x.totalBuy - x.totalSell,
    funded: x.fundedOn ? yes : no, aum_now: x.aumNow, held: x.heldDays,
    holding: { holding: bL('Still holding', 'Masih menahan'), sold: bL('Sold everything', 'Sudah jual semua'), none: bL('No purchase yet', 'Belum beli') }[x.holding],
  })).sort((a, b) => (a.registered_on < b.registered_on ? 1 : -1)), [
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'email', label: 'Email' }, { key: 'phone', label: bL('Phone', 'HP') },
    { key: 'code', label: bL('Code', 'Kode') }, { key: 'person', label: 'Sales' }, { key: 'booth', label: 'Booth' },
    { key: 'registered_on', label: bL('Registered', 'Daftar'), type: 'date' }, { key: 'verified_on', label: bL('KYC verified', 'KYC verified'), type: 'date' },
    { key: 'first_buy', label: bL('First purchase', 'Beli pertama'), type: 'date' }, { key: 'total_buy', label: bL('Total bought', 'Total beli'), type: 'idr', sum: true },
    { key: 'net', label: bL('Net money in', 'Dana bersih'), type: 'idr', sum: true }, { key: 'funded', label: `${idr(cfg.sales.minFunded)}+` },
    { key: 'aum_now', label: bL('Balance today', 'Saldo hari ini'), type: 'idr', sum: true }, { key: 'held', label: bL('Days holding', 'Lama menahan (hari)'), type: 'num' },
    { key: 'holding', label: bL('Holding', 'Status dana') },
  ], bL('No customer has registered with an event code yet.', 'Belum ada nasabah yang daftar dengan kode event.'));
  renderBoothTx();

  // Customer bonuses.
  const bon = boothCustomerBonuses(people.filter(pick), BOOTH.data.plans, cfg, today);
  const C = cfg.customer;
  genTable('#beWelcome', bon.welcome.map((w) => ({
    name: bEsc(w.x.name || 'n/a'), sid: bEsc(w.x.sid || ''), person: bEsc(bWho(cfg, w.x.person)), day: w.day, fund: bEsc(w.fund || ''),
    sam: w.sam ? yes : no, amount: w.amount, status: bStatusLabel(w.key, w), bonus: w.bonus,
  })), [
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'person', label: 'Sales' },
    { key: 'day', label: bL('First purchase', 'Beli pertama'), type: 'date' }, { key: 'fund', label: bL('Fund', 'Produk') }, { key: 'sam', label: 'SAM' },
    { key: 'amount', label: bL('Amount', 'Nominal'), type: 'idr' }, { key: 'status', label: 'Status' },
    { key: 'bonus', label: bL('Bonus units', 'Bonus unit'), type: 'idr', sum: true },
  ], bL('No new customer has bought yet.', 'Belum ada nasabah baru yang beli.'));
  genTable('#bePlans', bon.nabung.map((n) => ({
    name: bEsc(n.x.name || 'n/a'), sid: bEsc(n.x.sid || ''), person: bEsc(bWho(cfg, n.x.person)), created: n.plan.created_on,
    frequency: bEsc(n.plan.frequency), sam_amount: n.samAmount, months: n.months, status: bStatusLabel(n.key), bonus: n.bonus,
  })), [
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'person', label: 'Sales' },
    { key: 'created', label: bL('Plan created', 'Rencana dibuat'), type: 'date' }, { key: 'frequency', label: bL('Frequency', 'Frekuensi') },
    { key: 'sam_amount', label: bL('SAM per run', 'SAM per debit'), type: 'idr' },
    { key: 'months', label: bL(`Months in a row (need ${C.nabungRutin.minMonths})`, `Bulan berturut-turut (perlu ${C.nabungRutin.minMonths})`), type: 'num' },
    { key: 'status', label: 'Status' }, { key: 'bonus', label: bL('Bonus units', 'Bonus unit'), type: 'idr', sum: true },
  ], bL('No recurring plan started since the event began.', 'Belum ada rencana nabung rutin sejak event mulai.'));
  genTable('#beTopUp', bon.topUp.map((u) => ({
    name: bEsc(u.x.name || 'n/a'), sid: bEsc(u.x.sid || ''), email: bEsc(u.x.email), promo: bEsc(u.promo), person: bEsc(bWho(cfg, u.person)),
    day: u.day, amount: u.amount, cashback: u.cashback, status: bStatusLabel(u.key, u), payable: u.payable,
  })), [
    { key: 'name', label: bL('Customer', 'Nasabah') }, { key: 'sid', label: 'SID' }, { key: 'email', label: 'Email' },
    { key: 'promo', label: bL('Promo code', 'Kode promo') }, { key: 'person', label: 'Sales' }, { key: 'day', label: bL('First top up', 'Top up pertama'), type: 'date' },
    { key: 'amount', label: bL('SAM top ups', 'Top up SAM'), type: 'idr', sum: true }, { key: 'cashback', label: 'Cashback', type: 'idr', sum: true },
    { key: 'status', label: 'Status' }, { key: 'payable', label: bL('Payable', 'Dibayar'), type: 'idr', sum: true },
  ], bL('No existing customer has topped up with an event code yet.', 'Belum ada nasabah existing yang top up dengan kode event.'));
  const sw = mine;
  genTable('#beSucorwave', [
    { step: bL('Journey 1: registered and KYC verified', 'Journey 1: daftar dan KYC verified'), n: sw.filter((x) => x.verified).length },
    { step: bL('Journey 2: bought any fund', 'Journey 2: beli reksa dana apa pun'), n: sw.filter((x) => x.firstBuy).length },
    { step: bL(`Benefit 3: verified and SAM purchases ${idr(C.welcome.minFirstBuy)}+`, `Benefit 3: verified dan beli SAM ${idr(C.welcome.minFirstBuy)}+`), n: sw.filter((x) => x.verified && x.samBuys >= C.welcome.minFirstBuy).length },
  ], [{ key: 'step', label: 'Sucorwave' }, { key: 'n', label: bL('Customers', 'Nasabah'), type: 'num' }], '');

  renderBoothRules(cfg, period, inc.scale);
}

// The rules panel is written from the same config the numbers use.
function renderBoothRules(cfg, period, scale) {
  const S = cfg.sales, T = cfg.teamLead, C = cfg.customer;
  const need = (n) => Math.ceil(n * scale - 1e-9);
  const li = (en, id) => `<li>${bL(en, id)}</li>`;
  const tiers = (list, fmt) => list.map(fmt).join('; ');
  $('#beRules').innerHTML = `
    <h3>${bL('Periods', 'Periode')}</h3><ul>${cfg.periods.map((pd) => li(
      `${bEsc(pd.label)}: ${pd.from} to ${pd.to}, ${pd.workDays.toFixed(1)} working days, sales target ${(S.dailySidTarget * pd.workDays).toFixed(1)} SID, booth target ${(T.salesPerBooth * T.dailySidTarget * pd.workDays).toFixed(1)} SID; M1 ${pd.m1.from} to ${pd.m1.to}.`,
      `${bEsc(pd.label)}: ${pd.from} s.d. ${pd.to}, ${pd.workDays.toFixed(1)} hari kerja, target sales ${(S.dailySidTarget * pd.workDays).toFixed(1)} SID, target booth ${(T.salesPerBooth * T.dailySidTarget * pd.workDays).toFixed(1)} SID; M1 ${pd.m1.from} s.d. ${pd.m1.to}.`)).join('')}</ul>
    <h3>${bL('Definitions', 'Definisi')}</h3><ul>
      ${li('New SID: registered with an event code during the event (referral or sales code, exact match) and KYC verified. Counted in the period of the verification date; a verification after the event counts in the last period.', 'SID baru: daftar dengan kode event selama event (kode referral atau sales, sama persis) dan KYC verified. Dihitung di periode tanggal verifikasi; verifikasi sesudah event masuk periode terakhir.')}
      ${li('Transactions: completed buys and sells only; bonus units given by admin (manual_bonus) do not count. Net money in = buys minus sells from registration to the end of the period.', 'Transaksi: hanya beli dan jual berstatus completed; bonus unit dari admin (manual_bonus) tidak dihitung. Dana bersih = beli dikurangi jual dari daftar sampai akhir periode.')}
      ${li(`Working days are each sales person's shift days, ${cfg.fullMonthWorkDays} in a full month, weekends included; which dates are shifts does not change the count. A month that is not full is scaled by calendar days.`, `Hari kerja = hari shift tiap sales, ${cfg.fullMonthWorkDays} di bulan penuh, termasuk akhir pekan; tanggal mana yang jadi shift tidak memengaruhi hitungan. Bulan yang tidak penuh diprorate per hari kalender.`)}
      ${li('Flying team: one person, three codes (one per mall). Their SID add up for their own incentive and count in the team target of the mall the code belongs to. A team lead\'s own code counts for the team.', 'Flying team: satu orang, tiga kode (satu per mall). SID ketiganya dijumlah untuk insentif sendiri dan masuk target tim mall pemilik kode. Kode team lead sendiri dihitung ke tim.')}
      ${li('Recap per booth: a customer counts under the booth of the code they registered with, and the tables follow the booth and sales filters. KYC = of the customers who registered in the dates, how many have verified, whatever the verification day, so it never exceeds Registered. Bought and Sold only include completed transactions, so a payment that has not settled yet is named under the overall table.', 'Rekap per booth: nasabah dihitung ke booth dari kode yang dipakai saat daftar, dan tabelnya mengikuti filter booth dan sales. KYC = dari nasabah yang daftar di tanggal itu, berapa yang sudah verified, kapan pun hari verifikasinya, jadi tidak mungkin lebih besar dari Daftar. Beli dan Jual hanya transaksi completed, jadi pembayaran yang belum settle disebutkan di bawah tabel overall.')}
    </ul>
    <h3>${bL('Sales and flying team, this period', 'Sales dan flying team, periode ini')} (${bEsc(period.label)})</h3><ul>
      ${li(`Threshold: at least ${need(S.gate.minSid)} SID (${S.gate.minSid} in a full month) AND at least ${S.gate.minFundedPct}% of them funded ${idr(S.minFunded)}+. Missing either means no incentive for the period.`, `Syarat: minimal ${need(S.gate.minSid)} SID (${S.gate.minSid} di bulan penuh) DAN minimal ${S.gate.minFundedPct}% di antaranya funded ${idr(S.minFunded)}+. Salah satu tidak tercapai = tidak ada insentif periode itu.`)}
      ${li(`Rule 1, SID: ${tiers(S.rule1, (tr) => `${need(tr.minSid)}+ SID ${idrFull(tr.amount)}`)}.`, `Rule 1, SID: ${tiers(S.rule1, (tr) => `${need(tr.minSid)}+ SID ${idrFull(tr.amount)}`)}.`)}
      ${li(`Rule 2, funded share of the SID they got: ${tiers(S.rule2, (tr) => `${tr.minPct}%+ ${idrFull(tr.amount)}`)}.`, `Rule 2, persen funded dari SID yang didapat: ${tiers(S.rule2, (tr) => `${tr.minPct}%+ ${idrFull(tr.amount)}`)}.`)}
      ${li(`Rule 3, net money in from the period's new SID (no holding requirement): ${tiers(S.rule3, (tr) => `${idrFull(Math.round(tr.minAum * scale))}+ ${idrFull(tr.amount)}`)}.`, `Rule 3, dana bersih nasabah baru periode ini (tanpa syarat holding): ${tiers(S.rule3, (tr) => `${idrFull(Math.round(tr.minAum * scale))}+ ${idrFull(tr.amount)}`)}.`)}
      ${li(`Rule 4, retention: ${S.rule4.minPct}%+ of the period's SID buy again for ${idr(S.rule4.minAmount)}+ in M1: ${idrFull(S.rule4.amount)}.`, `Rule 4, retensi: ${S.rule4.minPct}%+ SID periode ini beli lagi total ${idr(S.rule4.minAmount)}+ di M1: ${idrFull(S.rule4.amount)}.`)}
      ${li(`Maximum ${idrFull(S.cap)} per person per period.`, `Maksimal ${idrFull(S.cap)} per orang per periode.`)}
    </ul>
    <h3>${bL('Team lead, this period', 'Team lead, periode ini')}</h3><ul>
      ${li(`Team = every code of the booth. Threshold: team SID at least ${T.gate.minSidPct}% of the booth target AND at least ${T.gate.minFundedPct}% of the team SID funded ${idr(T.minFunded)}+ (a share of the SID they got, so "60% of the 80%").`, `Tim = semua kode di booth. Syarat: SID tim minimal ${T.gate.minSidPct}% target booth DAN minimal ${T.gate.minFundedPct}% SID tim funded ${idr(T.minFunded)}+ (persen dari SID yang didapat, jadi "60% dari 80%").`)}
      ${li(`Rule 1: ${tiers(T.rule1, (tr) => `${tr.minSidPct}%+ of target ${idrFull(tr.amount)}`)}. Rule 2: ${tiers(T.rule2, (tr) => `${tr.minPct}%+ ${idrFull(tr.amount)}`)}.`, `Rule 1: ${tiers(T.rule1, (tr) => `${tr.minSidPct}%+ target ${idrFull(tr.amount)}`)}. Rule 2: ${tiers(T.rule2, (tr) => `${tr.minPct}%+ ${idrFull(tr.amount)}`)}.`)}
      ${li(`Rule 3, team net money in: ${tiers(T.rule3, (tr) => `${idrFull(Math.round(tr.minAum * scale))}+ ${idrFull(tr.amount)}`)}. Rule 4: ${T.rule4.minPct}%+ buy again for ${idr(T.rule4.minAmount)}+ in M1: ${idrFull(T.rule4.amount)}. Maximum ${idrFull(T.cap)}.`, `Rule 3, dana bersih tim: ${tiers(T.rule3, (tr) => `${idrFull(Math.round(tr.minAum * scale))}+ ${idrFull(tr.amount)}`)}. Rule 4: ${T.rule4.minPct}%+ beli lagi ${idr(T.rule4.minAmount)}+ di M1: ${idrFull(T.rule4.amount)}. Maksimal ${idrFull(T.cap)}.`)}
    </ul>
    <h3>${bL('Customer bonuses', 'Bonus nasabah')}</h3><ul>
      ${li(`Welcome bonus (new customers): first purchase is a ${bEsc(C.samManager)} fund for ${idr(C.welcome.minFirstBuy)}+; ${idrFull(C.welcome.bonus)} in SAM units after ${C.welcome.holdingDays} days, lapses if a SAM fund is sold before that; plus ${bEsc(C.welcome.extra)}.`, `Welcome bonus (nasabah baru): pembelian pertama produk ${bEsc(C.samManager)} ${idr(C.welcome.minFirstBuy)}+; ${idrFull(C.welcome.bonus)} unit SAM setelah ${C.welcome.holdingDays} hari, gugur kalau menjual produk SAM sebelum itu; plus ${bEsc(C.welcome.extra)}.`)}
      ${li(`Nabung rutin: a monthly plan started during the event with ${idr(C.nabungRutin.minMonthly)}+ going to SAM funds, paid ${C.nabungRutin.minMonths} months in a row: ${idrFull(C.nabungRutin.bonus)} in SAM units.`, `Nabung rutin: rencana bulanan yang dibuat selama event dengan ${idr(C.nabungRutin.minMonthly)}+ ke produk SAM, terbayar ${C.nabungRutin.minMonths} bulan berturut-turut: ${idrFull(C.nabungRutin.bonus)} unit SAM.`)}
      ${li(`Top up (customers registered before the event): SAM purchases of ${idr(C.topUp.minAmount)}+ each with a sales code${C.promoCodes.length ? ` or ${C.promoCodes.map(bEsc).join(', ')}` : ''} as promo code; ${C.topUp.cashbackPct}% cashback, at most ${idrFull(C.topUp.cashbackMax)} per customer, after ${C.topUp.holdingDays} days without selling a SAM fund; plus ${bEsc(C.topUp.extra)}.`, `Top up (nasabah yang daftar sebelum event): pembelian SAM ${idr(C.topUp.minAmount)}+ per transaksi dengan kode sales${C.promoCodes.length ? ` atau ${C.promoCodes.map(bEsc).join(', ')}` : ''} sebagai kode promo; cashback ${C.topUp.cashbackPct}%, maks. ${idrFull(C.topUp.cashbackMax)} per nasabah, setelah ${C.topUp.holdingDays} hari tanpa menjual produk SAM; plus ${bEsc(C.topUp.extra)}.`)}
      ${li('Social media follow and app store rating (small SAM merchandise) and Sucorwave sign-ups happen outside SayaKaya, so they are not in this data; the Sucorwave table counts the SayaKaya steps of each journey.', 'Follow media sosial dan rating app store (merchandise SAM kecil) serta pendaftaran Sucorwave terjadi di luar SayaKaya, jadi tidak ada di data ini; tabel Sucorwave menghitung langkah SayaKaya dari tiap journey.')}
    </ul>`;
  genTable('#beRoster', cfg.roster.map((r) => ({
    code: bEsc(r.code), person: bEsc(r.person), name: bEsc(r.name || ''), role: { sales: 'Sales', team_lead: 'Team lead', flying: 'Flying team' }[r.role] || bEsc(r.role),
    booth: bEsc(cfg.booths[r.booth] || r.booth), email: bEsc(r.email),
  })), [{ key: 'code', label: bL('Code', 'Kode') }, { key: 'person', label: bL('Position', 'Posisi') }, { key: 'name', label: bL('Name', 'Nama') }, { key: 'role', label: bL('Role', 'Peran') },
    { key: 'booth', label: 'Booth' }, { key: 'email', label: bL('Sales account', 'Akun sales') }], '');
}

// ASK (natural language)
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
  $('#askAnswer').classList.add('hidden');
  $('#askData').classList.add('hidden');
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
    if (!res.ok) {
      $('#askResult').innerHTML = '';
      setAskMsg(data.error || 'Request failed', 'err');
      // A blocked query still shows its SQL, so open the folded section for it.
      if (data.sql) { $('#askData').classList.remove('hidden'); $('#askData').open = true; }
      return;
    }
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
    showAskAnswer(data, question);
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
  navigator.clipboard.writeText($('#askSqlText').value).then(() => toast(t('msg_sql_copied')));
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

// Chart: Claude picks a type/x/y(/color), or the user overrides them by hand
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
// from the explicit "Suggest" button, never automatically. `hint` carries
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
    setAskChartMsg(e.message || 'Could not get a chart suggestion, try again.', true);
  }
  renderAskChart();
}

// ADMIN (superuser only — manage dashboard accounts + tab permissions)
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
  $('#adminModalHint').textContent = t('admin_modal_hint_invite');
  $('#adminUsername').value = '';
  $('#adminUsername').disabled = false;
  $('#adminPassword').value = '';
  $('#adminPassword').classList.add('hidden'); // no password up front, set via the emailed activation link
  $('#adminEmail').value = '';
  $('#adminIsSuperuser').checked = false;
  $('#adminFormErr').textContent = '';
  renderAdminTabsPicker([]);
}

function startEditUser(user) {
  editingUserId = user.id;
  $('#adminFormTitle').textContent = `${t('admin_edit_user_prefix')} ${user.username || user.email}`;
  $('#adminSaveBtn').textContent = t('admin_save_changes');
  $('#adminModalHint').textContent = t('admin_modal_hint');
  $('#adminUsername').value = user.username || '';
  $('#adminUsername').disabled = !!user.username; // username is immutable once set
  $('#adminPassword').value = '';
  $('#adminPassword').placeholder = t('admin_password_keep_current_ph');
  $('#adminPassword').classList.remove('hidden');
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
    if (!tabs.length) return 'n/a';
    return `<div class="access-list">${tabs.map((id) => `<span class="tag other">${labelFor(id)}</span>`).join('')}</div>`;
  };
  const body = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username || 'n/a')}</td>
      <td>${escapeHtml(u.email || 'n/a')}</td>
      <td>${accessCell(u)}</td>
      <td class="mono">${String(u.createdAt || '').slice(0, 10)}</td>
      <td>
        <div class="dropdown-multi row-actions">
          <button type="button" class="dropdown-multi-btn row-menu-btn" data-row-menu="${u.id}" aria-label="Actions">${ICONS.more}</button>
          <div class="dropdown-multi-panel menu-sm">
            <button type="button" class="row-menu-item" data-edit="${u.id}">Edit access</button>
            <button type="button" class="row-menu-item danger" data-delete="${u.id}" data-username="${escapeHtml(u.username || u.email)}">Delete</button>
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
  } catch (e) { $('#adminUsersTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
}

async function saveAdminUser() {
  const username = $('#adminUsername').value.trim();
  const password = $('#adminPassword').value;
  const email = $('#adminEmail').value.trim();
  const isSuperuser = $('#adminIsSuperuser').checked;
  const allowedTabs = $$('#adminTabsPicker input:checked').map((el) => el.value);
  $('#adminFormErr').textContent = '';
  if (!editingUserId && !email) {
    $('#adminFormErr').textContent = 'Email is required.';
    return;
  }
  try {
    if (editingUserId) {
      const patch = { email, username, isSuperuser, allowedTabs };
      if (password) patch.password = password;
      await api(`/api/admin/users/${editingUserId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      toast(t('msg_user_updated'));
    } else {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, email, isSuperuser, allowedTabs }) });
      toast(t('msg_invitation_sent_they_can_activate_their_'));
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
    const opts = users.map((u) => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.username)}</option>`).join('');
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
      { key: 'created_at', label: t('col_time_wib') },
      { key: 'username', label: 'User' },
      { key: 'action', label: t('col_action') },
      { key: 'detail', label: 'Detail' },
    ], 'No activity matches these filters.');
  } catch (e) { $('#adminAuditTable').innerHTML = `<div class="empty error" role="alert">${escapeHtml(e.message)}</div>`; }
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
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.row-actions')) $$('#adminUsersTable .dropdown-multi-panel.open').forEach((p) => p.classList.remove('open'));
  });
  $('#adminAuditRefresh').addEventListener('click', loadAdminAuditLog);
  $('#adminAuditApply').addEventListener('click', loadAdminAuditLog);
  $('#adminAuditUser').addEventListener('change', loadAdminAuditLog);
  $('#adminAuditSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAdminAuditLog(); });
}

// set own username, once (sidebar)
// Only for accounts created via email-only invite — hidden once a username
// exists, matching the admin edit form's disabled-once-set field.
function wireSetUsername() {
  $('#setUsernameBtn').addEventListener('click', () => {
    $('#setUsernamePanel').classList.toggle('hidden');
    $('#setUsernameInput').focus();
  });
  $('#setUsernameSave').addEventListener('click', async () => {
    const username = $('#setUsernameInput').value.trim();
    $('#setUsernameErr').textContent = '';
    if (!username) { $('#setUsernameErr').textContent = 'Username is required.'; return; }
    try {
      const body = await api('/api/auth/set-username', { method: 'POST', body: JSON.stringify({ username }) });
      $('#setUsernamePanel').classList.add('hidden');
      $('#setUsernameInput').value = '';
      applyPermissions(body.user);
      toast(t('msg_username_set'));
    } catch (e) { $('#setUsernameErr').textContent = e.message; }
  });
}

// change own password (sidebar)
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
      btn.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
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
        btn.innerHTML = ICONS.eye; btn.setAttribute('aria-label', 'Show password');
      });
      $('#changePwPanel').classList.add('hidden');
      toast(t('msg_password_updated'));
    } catch (e) { $('#changePwErr').textContent = e.message; }
  });
}

// WIRING
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
  if (name === 'revenue-trend' && !revTrendLoaded) loadRevenueTrend();
  if (name === 'performance' && !perfCache.length) loadPerformance();
  if (name === 'performance' && !perfDetailCache.length) loadPerformanceDetail();
  if (name === 'performance' && !perfTrendLoaded) { loadPerfTrendTypes(); loadPerfTrendFunds(); loadPerfTrend(); }
  if (name === 'growth' && !growthLoaded) loadGrowth();
  if (name === 'reconciliation') loadReconciliation();
  if (name === 'sinvest-tx' && !sitxLoaded) loadSitx();
  if (name === 'users-tx' && !utxSum.loaded) loadUtxSummary();
  if (name === 'top-investors' && !tiLoaded) loadTopInvestors();
  if (name === 'revenue') loadRevenue();
  if (name === 'revenue2') loadRevenue2();
  // Both are loaded once per session rather than on every visit: User lifetime
  // scans ~3.7 GB of portfolio_with_code per run (the table is unpartitioned,
  // so the date filter prunes nothing). Apply re-runs them on demand.
  if (name === 'user-lifetime' && !ulLoaded) loadUserLifetime();
  if (name === 'campaign-revenue' && !crLoaded) loadCampaignRevenue();
  if (name === 'referral-program' && !refProgLoaded) loadReferralProgram();
  if (name === 'referral-program-alt' && !refProgAltLoaded) loadReferralProgramAlt();
  if (name === 'predict' && !predictLoaded) loadPredict();
  if (name === 'overview' && !overviewLoaded) loadOverview();
  if (name === 'hnwi') loadHnwi();
  if (name === 'dormant' && !dormantLoaded) loadDormant();
  if (name === 'kalcer' && !kalcerLoaded) loadKalcer();
  if (name === 'push' && !pushLoaded) loadPush();
  if (name === 'marketing' && !marketingLoaded) loadMarketing();
  if (name === 'app-health' && !appHealthLoaded) loadAppHealth();
  if (name === 'email-recap' && !emailRecapLoaded) loadEmailRecap();
  // Loaded analysis tabs repaint from cache: a language or theme switch made
  // while another tab was open would otherwise leave them in the old one.
  ANALYSIS_TABS.forEach((tab) => { if (name === tab.id) (tab.loaded ? repaintAnalysis(tab) : loadAnalysis(tab)); });
  if (name === 'admin') loadAdminUsers();
  if (name === 'activity-log') { loadAdminAuditUserOptions(); loadAdminAuditLog(); }
  if (name === 'presentation' || name === 'monthly-review') {
    const cfg = PRES_VIEWS[name];
    (name === 'monthly-review' ? loadReviewMonths() : Promise.resolve()).then(() => loadPresentation(name, $(`${cfg.seg} .on`)?.dataset.month || cfg.defaultMonth));
  }
  if (name === 'booth-event' && !BOOTH.data && !BOOTH.loading) loadBoothEvent();
  if (name === 'promo-recap' && !PR.data && !PR.loading) loadPromoRecap();
  if (name === 'hnwi-bonus' && !HB.data && !HB.loading) loadHnwiBonus();
  if (name === 'send-statement') { loadSsLog(); loadSchedules('statement'); loadExclusions(); }
  if (name === 'send-fund-performance') { loadFpeLog(); loadSchedules('fund_performance'); loadExclusions(); }
}

// Decks are PDFs fetched with the Bearer token (not linked directly — a plain
// <iframe src> can't attach it, and the file lives outside public/ so it
// isn't reachable without one) and rendered page-by-page onto a canvas with
// pdf.js, rather than shown in the browser's built-in PDF viewer — that
// viewer scrolls continuously and can't be driven to "exactly one page,
// full-screen, no scrolling" from our own Prev/Next buttons.
//
// Two independent tabs (AI Taskforce, Monthly Review) share this one viewer —
// only one is ever visible at a time, so a single set of "current deck" vars
// is enough; PRES_VIEWS maps each tab name to its own DOM elements.
const PRES_VIEWS = {
  presentation: { seg: '#presentationMonthSeg', stage: '#presentationStage', canvas: '#presentationCanvas', counter: '#presentationCounter', defaultMonth: 'september' },
  'monthly-review': { seg: '#monthlyReviewMonthSeg', stage: '#monthlyReviewStage', canvas: '#monthlyReviewCanvas', counter: '#monthlyReviewCounter', defaultMonth: 'review-october' },
};
const presentationCache = {}; // month -> pdf.js PDFDocumentProxy
let presActiveView = 'presentation'; // which PRES_VIEWS entry is on-screen
let presPdfDoc = null;
let presPageNum = 1;
// pdf.js (an ES module) loads on the first deck opened, not on every page
// load: only the presentation tabs use it.
let pdfJsLoad = null;
function loadPdfJs() {
  return pdfJsLoad ||= import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs';
    return lib;
  }, (err) => { pdfJsLoad = null; throw err; });
}
function bindPresSeg(view, b) {
  b.addEventListener('click', () => {
    $$(`${PRES_VIEWS[view].seg} button`).forEach((x) => x.classList.toggle('on', x === b));
    loadPresentation(view, b.dataset.month);
  });
}
// Months published by the daily refresh (review-YYYY-MM) become buttons here; the
// newest one opens first. A failed request leaves the buttons in index.html as is.
let reviewMonthsLoad = null;
function loadReviewMonths() {
  return reviewMonthsLoad ||= fetch(`${API_BASE}/api/presentations`, { headers: authHeaders() })
    .then((res) => (res.ok ? res.json() : { decks: [] }))
    .then(({ decks = [] }) => {
      const seg = $(PRES_VIEWS['monthly-review'].seg);
      decks.forEach((key) => {
        if (seg.querySelector(`[data-month="${key}"]`)) return;
        const [y, m] = key.slice(7).split('-').map(Number);
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.month = key;
        b.textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleString(getLang() === 'id' ? 'id-ID' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        bindPresSeg('monthly-review', b);
        seg.append(b);
      });
      const newest = decks.at(-1);
      if (newest) $$(`${PRES_VIEWS['monthly-review'].seg} button`).forEach((x) => x.classList.toggle('on', x.dataset.month === newest));
    })
    .catch(() => { reviewMonthsLoad = null; });
}
async function loadPresentation(view, month) {
  presActiveView = view;
  presPageNum = 1;
  try {
    if (!presentationCache[month]) {
      const res = await fetch(`${API_BASE}/api/presentations/${month}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
      const data = await res.arrayBuffer();
      presentationCache[month] = await (await loadPdfJs()).getDocument({ data }).promise;
    }
    presPdfDoc = presentationCache[month];
    await presRenderPage(1);
  } catch (e) {
    toast(e.message);
  }
}

async function presRenderPage(n) {
  if (!presPdfDoc) return;
  presPageNum = Math.max(1, Math.min(n, presPdfDoc.numPages));
  const page = await presPdfDoc.getPage(presPageNum);
  const cfg = PRES_VIEWS[presActiveView];
  const stage = $(cfg.stage);
  const dpr = window.devicePixelRatio || 1;
  const unscaled = page.getViewport({ scale: 1 });
  const fitScale = Math.min(stage.clientWidth / unscaled.width, stage.clientHeight / unscaled.height);
  const viewport = page.getViewport({ scale: fitScale * dpr });
  const canvas = $(cfg.canvas);
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  $(cfg.counter).textContent = `${presPageNum} / ${presPdfDoc.numPages}`;
}
function presNext() { presRenderPage(presPageNum + 1); }
function presPrev() { presRenderPage(presPageNum - 1); }

// Called once after login/session-restore: hides nav links + the Admin group
// the current user isn't allowed to see, and lands on the first tab they can
// actually use (the HTML defaults to "portfolio" active, which may not be
// permitted).
const SUPERUSER_ONLY_TABS = ['admin', 'activity-log'];
function applyPermissions(user) {
  currentUser = user;
  const displayName = user.username || user.email || '';
  $('#userBadgeName').textContent = displayName + (user.isSuperuser ? ' (superuser)' : '');
  $('#userAvatar').textContent = (displayName.slice(0, 2) || '?').toUpperCase();
  $('#setUsernameBtn').classList.toggle('hidden', !!user.username);
  $('#adminNavGroup').classList.toggle('hidden', !user.isSuperuser);
  $('#askActivityLogChip').classList.toggle('hidden', !user.isSuperuser);
  $('#docsAdminSection').classList.toggle('hidden', !user.isSuperuser);
  $('#sqlUnredactRow').classList.toggle('hidden', !user.isSuperuser);
  $('#askUnredactRow').classList.toggle('hidden', !user.isSuperuser);
  $('#mlRetrainBtn').classList.toggle('hidden', !user.isSuperuser);
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
  const analysis = ANALYSIS_TABS.find((tab) => tab.id === active.id);
  if (analysis) { repaintAnalysis(analysis); return; }
  switch (active.id) {
    case 'overview': overviewLoaded = false; loadOverview(); break;
    case 'aum': aumCache = []; loadAumHistory(); break;
    case 'revenue-trend': loadRevenueTrend(); break;
    case 'growth': growthLoaded = false; loadGrowth(); break;
    case 'predict': predictLoaded = false; loadPredict(); break;
    case 'push': pushLoaded = false; loadPush(); break;
    case 'email-recap': if (erSummary) renderEmailRecap(erSummary); if (er.rows) renderEmailLog(); break;
    case 'user-behavior': repaintBehavior(); break;
    case 'performance': renderPerfTrendChart(perfTrendCache); break;
    case 'portfolio': if (pfSelected) loadPortfolioUser(); break;
    case 'portfolio-fix': if (pfxSelected) loadPfxUser(); break;
    case 'portfolio-tx': if (ptxSelected) loadPtxUser(); break;
    case 'portfolio-sinvest': if (psiSelected) loadPsiUser(); break;
    case 'booth-event': renderBoothEvent(); break;
    case 'promo-recap': renderPromoRecap(); break;
    case 'hnwi-bonus': renderHnwiBonus(); break;
    case 'event-code':
      renderEvcRecap(); renderEvcPortfolio(); renderEvcUsers();
      renderEvcCohort('#evcCohortRegHeatmap', evcCohortRows.reg); renderEvcCohort('#evcCohortTxHeatmap', evcCohortRows.tx);
      break;
  }
}

// theme: Auto (follows the OS/browser setting) / Light / Dark
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

// Live sidebar tab search: filters the nav as you type (no Enter/click). Every
// whitespace-separated word must appear in the tab's name or its group name,
// ignoring case and punctuation ("estatement" finds "e-statement"). Matches
// inside folded groups are shown while searching without changing the saved
// fold state. Up/Down move the highlight, Enter opens it, Esc clears, and "/"
// focuses the box from anywhere that isn't a text field.
const navNorm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, '');
function wireNavSearch() {
  const input = $('#navSearchInput'), clearBtn = $('#navSearchClear'), nav = document.querySelector('.nav');
  if (!input || !nav) return;
  let hits = [], cursor = 0;
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const links = () => $$('.nav-link[data-tab]');
  const labelOf = (l) => l.querySelector('.nav-label-text') || l;
  const resetLabel = (l) => { const el = labelOf(l); if (el.querySelector && el.querySelector('mark')) el.textContent = el.textContent; };
  const mark = (l, words) => {
    const el = labelOf(l), text = el.textContent;
    const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    if (re.test(text)) el.innerHTML = text.split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
  };
  const setCursor = (i) => {
    hits.forEach((l) => l.classList.remove('nav-kbd'));
    if (!hits.length) return;
    cursor = (i + hits.length) % hits.length;
    hits[cursor].classList.add('nav-kbd');
    hits[cursor].scrollIntoView({ block: 'nearest' });
  };
  function run() {
    const raw = input.value.trim(), words = raw.toLowerCase().split(/\s+/).filter(Boolean);
    clearBtn.classList.toggle('hidden', !input.value);
    nav.classList.toggle('nav-searching', words.length > 0);
    hits = [];
    links().forEach((l) => { l.classList.remove('nav-kbd'); resetLabel(l); });
    $$('.nav-group').forEach((g) => {
      const groupName = g.querySelector('.nav-label span')?.textContent || '';
      const gl = Array.from(g.querySelectorAll('.nav-link[data-tab]'));
      let shown = 0;
      gl.forEach((l) => {
        const permitted = !l.classList.contains('hidden');
        const hay = navNorm(labelOf(l).textContent + ' ' + groupName);
        const ok = permitted && words.every((w) => hay.includes(navNorm(w)));
        l.classList.toggle('nav-filtered', words.length > 0 && !ok);
        if (ok && words.length) { shown++; hits.push(l); mark(l, words); }
      });
      if (gl.length) g.classList.toggle('nav-filtered', words.length > 0 && shown === 0);
    });
    $('#navSearchEmpty').classList.toggle('hidden', !(words.length && !hits.length));
    cursor = 0; setCursor(0);
  }
  function clear(keepFocus) {
    input.value = ''; run();
    if (!keepFocus) input.blur();
    const act = document.querySelector('.nav-link.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  }
  function open(link) { if (!link) return; switchTab(link.dataset.tab); clear(false); }
  input.addEventListener('input', run);
  clearBtn.addEventListener('click', () => clear(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(cursor - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); open(hits[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value ? clear(true) : input.blur(); }
  });
  // Opening a tab by click while a search is active returns the list to normal.
  links().forEach((l) => l.addEventListener('click', () => { if (input.value) clear(false); }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (!input.offsetParent) return; // sidebar hidden (icon-only mode / closed mobile drawer)
    e.preventDefault(); input.focus(); input.select();
  });
}

const SIDEBAR_COLLAPSED_KEY = 'sk_sidebar_collapsed';
function wire() {
  // Modals only close via the explicit X or a Cancel/Close button — an
  // accidental click on the backdrop while dismissing a dropdown elsewhere
  // used to cancel whatever was open in the dialog.
  document.addEventListener('click', (e) => { e.target.closest('.modal-close')?.closest('dialog')?.close(); });
  wrapNavLabels();
  wireNavGroups();
  wireNavSearch();
  $$('.nav-link').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  const presPresentBtn = { presentation: '#presentBtn', 'monthly-review': '#mrPresentBtn' };
  const presPrevBtnId = { presentation: '#presPrevBtn', 'monthly-review': '#mrPrevBtn' };
  const presNextBtnId = { presentation: '#presNextBtn', 'monthly-review': '#mrNextBtn' };
  Object.keys(PRES_VIEWS).forEach((view) => {
    const cfg = PRES_VIEWS[view];
    $$(`${cfg.seg} button`).forEach((b) => bindPresSeg(view, b));
    $(presPresentBtn[view]).addEventListener('click', () => {
      const stage = $(cfg.stage);
      (stage.requestFullscreen || stage.webkitRequestFullscreen)?.call(stage);
    });
    $(presPrevBtnId[view]).addEventListener('click', presPrev);
    $(presNextBtnId[view]).addEventListener('click', presNext);
  });
  // Re-fit the current page to the stage's new size — on entering/exiting
  // fullscreen, and on any plain window resize while the tab is open.
  ['resize', 'fullscreenchange', 'webkitfullscreenchange'].forEach((evt) => {
    window.addEventListener(evt, () => { if (presPdfDoc) presRenderPage(presPageNum); });
  });
  // Scoped to whichever presentation tab is open so arrow keys/space don't
  // hijack navigation elsewhere in the dashboard.
  document.addEventListener('keydown', (e) => {
    if (!$(`#${presActiveView}`).classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); presNext(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); presPrev(); }
  });
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
  pfBulk = setupBulkExport({ prefix: 'pf', source: 'portfolio_full' });
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
  $('#ssSendPortfolio').addEventListener('change', loadSsPreview);
  $('#ssPortfolioDate').addEventListener('change', loadSsPreview);
  $('#ssSendStatement').addEventListener('change', loadSsPreview);
  $('#ssStatementMonth').addEventListener('change', loadSsPreview);
  $('#ssComposeBtn').addEventListener('click', () => {
    if (!ssSelected) return;
    const sendPortfolio = $('#ssSendPortfolio').checked;
    const sendStatement = $('#ssSendStatement').checked;
    if (!sendPortfolio && !sendStatement) { toast(t('msg_pick_at_least_one_document_to_send')); return; }
    const portfolioDate = $('#ssPortfolioDate').value;
    const statementMonth = $('#ssStatementMonth').value;
    if (sendStatement && !statementMonth) { toast(t('msg_pick_a_month_for_the_transaction_e_state')); return; }
    const { subject, body } = defaultStatementEmail({ name: ssSelected.name, sendPortfolio, portfolioDate, sendStatement, statementMonth });
    $('#ssEmailTo').textContent = `Will be sent to ${ssSelected.name}'s email on file.`;
    $('#ssEmailSubject').value = subject;
    $('#ssEmailBody').value = body;
    $('#ssEmailModal').showModal();
  });
  $('#ssLogRefresh').addEventListener('click', loadSsLog);
  $('#ssEmailCancelBtn').addEventListener('click', () => $('#ssEmailModal').close());
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

  // send statement (batch)
  ssBatchPicker = setupRecipientPicker('ssBatch');
  $('#ssBatchStatementMonth').value = new Date().toISOString().slice(0, 7);
  $('#ssBatchComposeBtn').addEventListener('click', openSsBatchCompose);
  ['bePeriod', 'beBooth', 'bePerson'].forEach((id) => $(`#${id}`).addEventListener('change', renderBoothEvent));
  ['beTxKind', 'beTxStatus', 'beTxType'].forEach((id) => $(`#${id}`).addEventListener('change', renderBoothTx));
  ['beTxMin', 'beTxMax'].forEach((id) => $(`#${id}`).addEventListener('input', renderBoothTx));
  $('#beReload').addEventListener('click', loadBoothEvent);
  ['beRecapAllFrom', 'beRecapAllTo', 'beRecapDayFrom', 'beRecapDayTo'].forEach((id) => $(`#${id}`).addEventListener('change', () => { if (BOOTH.people) renderBoothRecap(BOOTH.people); }));
  $('#prApply').addEventListener('click', loadPromoRecap);
  $('#prStatus').addEventListener('change', renderPromoRecap);
  $('#hbMonth').addEventListener('change', renderHnwiBonus);
  $('#hbReload').addEventListener('click', loadHnwiBonus);
  $('#ssBatchRecipientType').addEventListener('change', () => batchGroupChanged('statement', 'ssBatch'));
  $('#ssBatchCsv').addEventListener('change', () => loadBatchCsv($('#ssBatchCsv'), $('#ssBatchInput'), true));
  $('#fpeCsv').addEventListener('change', () => loadBatchCsv($('#fpeCsv'), $('#fpePasteEmails'), false));
  EXCL_PANELS.forEach((p) => {
    $(`#${p}AddBtn`).addEventListener('click', () => addExclusions(p));
    $(`#${p}Filter`).addEventListener('input', () => renderExclusions(p));
  });
  $('#ssBatchEmailCancelBtn').addEventListener('click', () => $('#ssBatchEmailModal').close());
  $('#ssBatchEmailSendBtn').addEventListener('click', () => { $('#ssBatchEmailModal').close(); sendSsBatchEmail(); });

  // send fund performance
  fpePicker = setupRecipientPicker('fpe');
  fpeScope = setupFundScope('fpe');
  fpeSchedScope = setupFundScope('fpeSched');
  $('#fpeLogRefresh').addEventListener('click', loadFpeLog);
  $('#fpeComposeBtn').addEventListener('click', openFpeCompose);
  $('#fpeRecipientType').addEventListener('change', () => batchGroupChanged('fund_performance', 'fpe'));
  $('#fpeEmailCancelBtn').addEventListener('click', () => $('#fpeEmailModal').close());
  $('#fpeEmailSendBtn').addEventListener('click', () => { $('#fpeEmailModal').close(); sendFpeEmail(); });

  // scheduled/automated sending — same wiring shape for both tabs
  function wireSchedModal(kind) {
    const { prefix } = schedCfg(kind);
    schedEl(prefix, 'NewBtn').addEventListener('click', () => { schedResetModal(kind); schedEl(prefix, 'Modal').showModal(); });
    schedEl(prefix, 'RecipientType').addEventListener('change', () => { schedUpdateFieldVisibility(kind); schedPreviewCount(kind); });
    schedEl(prefix, 'SingleEmail').addEventListener('change', () => schedPreviewCount(kind));
    schedEl(prefix, 'Frequency').addEventListener('change', () => schedUpdateFieldVisibility(kind));
    schedEl(prefix, 'Endless').addEventListener('change', () => schedUpdateFieldVisibility(kind));
    schedEl(prefix, 'CsvFile').addEventListener('change', () => schedPreviewCount(kind));
    schedEl(prefix, 'CsvPaste').addEventListener('change', () => schedPreviewCount(kind));
    schedEl(prefix, 'SendCodeBtn').addEventListener('click', () => schedSendOtp(kind));
    schedEl(prefix, 'CancelBtn1').addEventListener('click', () => schedEl(prefix, 'Modal').close());
    schedEl(prefix, 'BackBtn').addEventListener('click', () => { schedEl(prefix, 'Step2').classList.add('hidden'); schedEl(prefix, 'Step1').classList.remove('hidden'); });
    schedEl(prefix, 'ConfirmBtn').addEventListener('click', () => schedConfirmOtp(kind));
    schedEl(prefix, 'DetailCloseBtn').addEventListener('click', () => schedEl(prefix, 'DetailModal').close());
  }
  wireSchedModal('statement');
  wireSchedModal('fund_performance');

  // portfolio (fix) — same wiring as portfolio (pwc) above, different source table
  pfxBulk = setupBulkExport({ prefix: 'pfx', source: 'portfolio_fix_full' });
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
  ptxBulk = setupBulkExport({ prefix: 'ptx', source: 'portfolio_tx_full' });
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
  psiBulk = setupBulkExport({ prefix: 'psi', source: 'portfolio_sinvest_full' });
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
  peBulk = setupBulkExport({ prefix: 'pe', source: 'portfolio_explorer_full' });
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
  $('#dwConversionCsv').addEventListener('click', () => download({ source: 'dormant_conversion_summary', format: 'csv', filename: 'dormant_conversion_summary' }, 'dormant_conversion_summary.csv'));
  $('#dwConversionXlsx').addEventListener('click', () => download({ source: 'dormant_conversion_summary', format: 'xlsx', filename: 'dormant_conversion_summary' }, 'dormant_conversion_summary.xlsx'));
  $('#dwRepeatCsv').addEventListener('click', () => download({ source: 'dormant_repeat_buyers', format: 'csv', filename: 'dormant_repeat_buyers' }, 'dormant_repeat_buyers.csv'));
  $('#dwRepeatXlsx').addEventListener('click', () => download({ source: 'dormant_repeat_buyers', format: 'xlsx', filename: 'dormant_repeat_buyers' }, 'dormant_repeat_buyers.xlsx'));
  $('#dwTtcCsv').addEventListener('click', () => download({ source: 'dormant_time_to_convert', format: 'csv', filename: 'dormant_time_to_convert' }, 'dormant_time_to_convert.csv'));
  $('#dwTtcXlsx').addEventListener('click', () => download({ source: 'dormant_time_to_convert', format: 'xlsx', filename: 'dormant_time_to_convert' }, 'dormant_time_to_convert.xlsx'));
  $('#kalcerDateApply').addEventListener('click', loadKalcer);
  $('#kalcerSearchBtn').addEventListener('click', loadKalcer);
  $('#kalcerSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadKalcer(); });
  $('#kalcerSummaryCsv').addEventListener('click', () => download({ source: 'kalcer_ambassador_summary', format: 'csv', filename: 'referrers', ...kalcerParams() }, 'referrers.csv'));
  $('#kalcerSummaryXlsx').addEventListener('click', () => download({ source: 'kalcer_ambassador_summary', format: 'xlsx', filename: 'referrers', ...kalcerParams() }, 'referrers.xlsx'));
  $('#kalcerDetailCsv').addEventListener('click', () => download({ source: 'kalcer_referral_detail', format: 'csv', filename: 'referrals', ...kalcerParams() }, 'referrals.csv'));
  $('#kalcerDetailXlsx').addEventListener('click', () => download({ source: 'kalcer_referral_detail', format: 'xlsx', filename: 'referrals', ...kalcerParams() }, 'referrals.xlsx'));
  $('#pushApply').addEventListener('click', loadPush);
  $('#erApply').addEventListener('click', loadEmailRecap);
  const erReloadLog = () => { er.offset = 0; loadEmailLog(); };
  $('#erSearchBtn').addEventListener('click', erReloadLog);
  $('#erSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') erReloadLog(); });
  $('#erOutcome').addEventListener('change', erReloadLog);
  $('#erPrev').addEventListener('click', () => { if (er.offset > 0) { er.offset = Math.max(0, er.offset - er.limit); loadEmailLog(); } });
  $('#erNext').addEventListener('click', () => { if (er.offset + er.limit < er.total) { er.offset += er.limit; loadEmailLog(); } });
  $('#erLogTable').addEventListener('click', (e) => { const b = e.target.closest('[data-er-events]'); if (b) openEmailEvents(b.dataset.erEvents); });
  $('#bhApply').addEventListener('click', loadBehaviorUser);
  $('#bhSearchBtn').addEventListener('click', searchBehaviorUsers);
  ANALYSIS_TABS.forEach((tab) => $(`#${tab.prefix}Apply`).addEventListener('click', () => loadAnalysis(tab)));
  $('#saDriverFlow').addEventListener('change', renderSaDrivers);
  $('#rdSignalFlow').addEventListener('change', renderRdSignals);
  wireSeg('#saSplit', 'split', (v) => { saView.split = v; renderSaFunnel(); });
  wireSeg('#saProfileDim', 'dim', (v) => { saView.dim = v; renderSaProfile(); });
  wireSeg('#saEntryLevel', 'level', (v) => { saView.level = v; renderSaEntry(); });
  wireSeg('#saDropStep', 'step', (v) => { saView.step = Number(v); renderSaDrop(); });
  wireSeg('#saHoursBy', 'by', (v) => { saView.by = v; renderSaHours(); });
  wireSeg('#obSegment', 'segment', (v) => { obView.segment = v; renderObFunnel(); });
  wireSeg('#pfnSegment', 'segment', (v) => { pfnView.segment = v; renderPfnFunnel(); });
  wireSeg('#pfnDim', 'dim', (v) => { pfnView.dim = v; renderPfnSplit(); });
  wireSeg('#pfnWeeksMode', 'mode', (v) => { pfnView.weeks = v; renderPfnWeeks(); });
  wireSeg('#pfnDailyPlatform', 'platform', (v) => { pfnView.daily = v; renderPfnDaily(); });
  wireSeg('#pfnUnDim', 'dim', (v) => { pfnView.un = v; renderPfnUninstalls(); });
  wireSeg('#rdProfileDim', 'dim', (v) => { rdView.dim = v; renderRdProfile(); });
  wireSeg('#egDiscoveryKind', 'kind', (v) => { egView.kind = v; renderEgDiscovery(); });
  $('#bhSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchBehaviorUsers(); });
  $('#bhResults').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bh-user]');
    if (!b) return;
    bhSelected = { userId: b.dataset.bhUser, sid: b.dataset.sid, name: b.dataset.name, email: b.dataset.email };
    loadBehaviorUser();
  });
  $('#pushPlatformCsv').addEventListener('click', () => download({ source: 'push_by_platform', format: 'csv', filename: 'push_by_platform', ...pushRange() }, 'push_by_platform.csv'));
  $('#pushPlatformXlsx').addEventListener('click', () => download({ source: 'push_by_platform', format: 'xlsx', filename: 'push_by_platform', ...pushRange() }, 'push_by_platform.xlsx'));
  $('#pushCampaignCsv').addEventListener('click', () => download({ source: 'push_by_campaign', format: 'csv', filename: 'push_by_campaign', ...pushRange() }, 'push_by_campaign.csv'));
  $('#pushCampaignXlsx').addEventListener('click', () => download({ source: 'push_by_campaign', format: 'xlsx', filename: 'push_by_campaign', ...pushRange() }, 'push_by_campaign.xlsx'));
  $('#mktApply').addEventListener('click', loadMarketing);
  $('#mktCsv').addEventListener('click', () => download({ source: 'marketing_funnel', format: 'csv', filename: 'marketing_funnel', ...mktRange() }, 'marketing_funnel.csv'));
  $('#mktXlsx').addEventListener('click', () => download({ source: 'marketing_funnel', format: 'xlsx', filename: 'marketing_funnel', ...mktRange() }, 'marketing_funnel.xlsx'));
  $('#ahApply').addEventListener('click', loadAppHealth);
  $('#ahCrashCsv').addEventListener('click', () => download({ source: 'app_crash_issues', format: 'csv', filename: 'app_crash_issues', ...ahRange() }, 'app_crash_issues.csv'));
  $('#ahCrashXlsx').addEventListener('click', () => download({ source: 'app_crash_issues', format: 'xlsx', filename: 'app_crash_issues', ...ahRange() }, 'app_crash_issues.xlsx'));
  $('#ahPerfCsv').addEventListener('click', () => download({ source: 'app_perf_traces', format: 'csv', filename: 'app_perf_traces', ...ahRange() }, 'app_perf_traces.csv'));
  $('#ahPerfXlsx').addEventListener('click', () => download({ source: 'app_perf_traces', format: 'xlsx', filename: 'app_perf_traces', ...ahRange() }, 'app_perf_traces.xlsx'));

  $('#apply').addEventListener('click', () => { if ($('#overview').classList.contains('active')) loadOverview(); if ($('#explorer').classList.contains('active')) { ex.offset = 0; loadExplore(); } if ($('#aum').classList.contains('active')) loadAumHistory(); if ($('#revenue-trend').classList.contains('active')) loadRevenueTrend(); if ($('#reconciliation').classList.contains('active')) loadReconciliation(); });
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
  $('#mlRetrainBtn').addEventListener('click', retrainMlModels);

  // Overview-wide fund filter (KPIs, trend/breakdown charts, AUM by fund
  // type, investor map, top cities) — separate from the exclude-list below.
  // #ovAumDate rides along on the same Apply click (read directly inside
  // loadOverview()), matching how #topFundsDate below only re-queries on its
  // own explicit Apply too.
  $('#ovFundFilterApply').addEventListener('click', () => {
    const rules = overviewUserRulesDraft();
    if (rules.reduce((n, r) => n + r.values.length, 0) > UF_MAX_VALUES) { toast(t('ov_uf_too_many')); return; }
    ovUserFilter = rules;
    setOverviewUserPanel(false);
    updateOverviewFundFilterBtn(); updateOverviewUserFilterBtn(); loadOverview();
  });
  $('#ovUserFilterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !$('#ovUserFilterPanel').classList.contains('open');
    setOverviewUserPanel(open);
    if (open && !$('#ovUserFilterRules .uf-rule')) addOverviewUserRule();
  });
  $('#ovUserFilterAdd').addEventListener('click', addOverviewUserRule);
  $('#ovUserFilterClear').addEventListener('click', () => { $('#ovUserFilterRules').innerHTML = ''; });
  $('#ovUserFilterRules').addEventListener('change', (e) => { if (e.target.matches('.uf-field')) syncOverviewUserRule(e.target.closest('.uf-rule')); });
  $('#ovUserFilterRules').addEventListener('click', (e) => { if (e.target.matches('.uf-remove')) e.target.closest('.uf-rule').remove(); });
  $('#ovUserFilterDropdown').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setOverviewUserPanel(false); $('#ovUserFilterBtn').focus(); }
  });
  // isConnected: a click on "Remove" lands here after its row is already
  // gone from the DOM, and closest() on a detached node would close the panel.
  document.addEventListener('click', (e) => {
    if (e.target.isConnected && !e.target.closest('#ovUserFilterDropdown')) setOverviewUserPanel(false);
  });
  updateOverviewUserFilterBtn();
  $('#ovFundFilterSearch').addEventListener('input', filterOverviewFundList);
  $('#ovFundFilterSelectAll').addEventListener('click', overviewFundFilterSelectAll);
  $('#ovFundFilterClear').addEventListener('click', overviewFundFilterClear);
  $('#ovFundFilterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#ovFundFilterPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ovFundFilterDropdown')) $('#ovFundFilterPanel').classList.remove('open');
  });

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
  $('#revTrendGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#revTrendGran button').forEach((x) => x.classList.toggle('on', x === b));
    revTrendGran = b.dataset.g; loadRevenueTrend();
  });
  const revTrendDl = (format) => { const r = currentRange(); download({ source: 'revenue_trend', format, filename: 'revenue_trend', from: r.from, to: r.to, granularity: revTrendGran }, `revenue_trend.${format}`); };
  $('#revTrendTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-bucket]'); if (tr) loadRevDrill(tr.dataset.bucket); });
  const revDrillDl = (format) => download({ source: 'revenue_trend_drill', format, filename: 'revenue_trend_drill', ...revDrillParams }, `revenue_trend_drill.${format}`);
  $('#revDrillCsv').addEventListener('click', () => revDrillDl('csv'));
  $('#revDrillXlsx').addEventListener('click', () => revDrillDl('xlsx'));
  $('#revTrendCsv').addEventListener('click', () => revTrendDl('csv'));
  $('#revTrendXlsx').addEventListener('click', () => revTrendDl('xlsx'));
  $('#aumCsv').addEventListener('click', () => { const r = currentRange(); download({ source: 'aum_history', format: 'csv', filename: 'aum_history', from: r.from, to: r.to, granularity: aumGran }, 'aum_history.csv'); });
  $('#aumXlsx').addEventListener('click', () => { const r = currentRange(); download({ source: 'aum_history', format: 'xlsx', filename: 'aum_history', from: r.from, to: r.to, granularity: aumGran }, 'aum_history.xlsx'); });
  $('#aumTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-bucket]'); if (tr) loadAumDrill(tr.dataset.bucket); });
  $('#aumDrillCsv').addEventListener('click', () => download({ source: 'aum_history_drill', format: 'csv', filename: 'aum_history_drill', ...aumDrillRange }, 'aum_history_drill.csv'));
  $('#aumDrillXlsx').addEventListener('click', () => download({ source: 'aum_history_drill', format: 'xlsx', filename: 'aum_history_drill', ...aumDrillRange }, 'aum_history_drill.xlsx'));

  // product performance
  $('#perfCsv').addEventListener('click', () => download({ source: 'product_performance', format: 'csv', filename: 'product_performance' }, 'product_performance.csv'));
  $('#perfXlsx').addEventListener('click', () => download({ source: 'product_performance', format: 'xlsx', filename: 'product_performance' }, 'product_performance.xlsx'));
  $('#perfTypeFilterList').addEventListener('change', () => { updatePerfTypeFilterBtn(); renderPerformanceDetail(); });
  $('#perfTypeFilterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#perfTypeFilterPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#perfTypeFilterDropdown')) $('#perfTypeFilterPanel').classList.remove('open');
  });
  $('#perfDetailSearch').addEventListener('input', renderPerformanceDetail);
  $('#perfDetailAsOf').addEventListener('change', loadPerformanceDetail);
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
  $('#perfDetailCsv').addEventListener('click', () => download({ source: 'product_performance_detail', format: 'csv', filename: 'product_performance_detail', asOf: $('#perfDetailAsOf').value }, 'product_performance_detail.csv'));
  $('#perfDetailXlsx').addEventListener('click', () => download({ source: 'product_performance_detail', format: 'xlsx', filename: 'product_performance_detail', asOf: $('#perfDetailAsOf').value }, 'product_performance_detail.xlsx'));
  $('#perfDetailPdf').addEventListener('click', () => download({ source: 'product_performance_detail', format: 'pdf', filename: 'product_performance_detail', asOf: $('#perfDetailAsOf').value }, 'product_performance_detail.pdf'));

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
  $('#refProgInvitedCsv').addEventListener('click', () => { const r = refProgRange(); download({ source: 'referral_program_invited', format: 'csv', filename: 'referral_program_invited', ...r }, 'referral_program_invited.csv'); });
  $('#refProgInvitedXlsx').addEventListener('click', () => { const r = refProgRange(); download({ source: 'referral_program_invited', format: 'xlsx', filename: 'referral_program_invited', ...r }, 'referral_program_invited.xlsx'); });

  // referral program (alt.)
  $('#refProgAltApply').addEventListener('click', loadReferralProgramAlt);
  $('#refProgAltCsv').addEventListener('click', () => { const r = refProgAltRange(); download({ source: 'referral_program_alt_detail', format: 'csv', filename: 'referral_program_alt_detail', ...r }, 'referral_program_alt_detail.csv'); });
  $('#refProgAltXlsx').addEventListener('click', () => { const r = refProgAltRange(); download({ source: 'referral_program_alt_detail', format: 'xlsx', filename: 'referral_program_alt_detail', ...r }, 'referral_program_alt_detail.xlsx'); });
  $('#refProgAltInvitedCsv').addEventListener('click', () => { const r = refProgAltRange(); download({ source: 'referral_program_alt_invited', format: 'csv', filename: 'referral_program_alt_invited', ...r }, 'referral_program_alt_invited.csv'); });
  $('#refProgAltInvitedXlsx').addEventListener('click', () => { const r = refProgAltRange(); download({ source: 'referral_program_alt_invited', format: 'xlsx', filename: 'referral_program_alt_invited', ...r }, 'referral_program_alt_invited.xlsx'); });

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

  // users transactions — Run drives the summary panel above the list too, so
  // both always describe the same filters and date range.
  const runUtx = () => { utx.offset = 0; loadUtx(); loadUtxSummary(); };
  $('#utxRun').addEventListener('click', runUtx);
  for (const id of ['#utxSearch', '#utxFundName', '#utxPromo']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') runUtx(); });
  }
  wireSeg('#utxSumGran', 'g', (v) => { utxSum.granularity = v; loadUtxSummary(); });
  $('#tiDate').value = isoDate(new Date());
  $('#tiMetric').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tiMetric button').forEach((x) => x.classList.toggle('on', x === b));
    tiMetric = b.dataset.m; loadTopInvestors();
  });
  $('#tiPeriod').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tiPeriod button').forEach((x) => x.classList.toggle('on', x === b));
    tiPeriod = b.dataset.p;
    $('#tiDateWrap').classList.toggle('hidden', tiPeriod === 'custom');
    $$('.ti-custom').forEach((el) => el.classList.toggle('hidden', tiPeriod !== 'custom'));
    if (tiPeriod !== 'custom') loadTopInvestors();
  });
  $('#tiRun').addEventListener('click', loadTopInvestors);
  $('#tiLimit').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTopInvestors(); });
  $('#tiOrder').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tiOrder button').forEach((x) => x.classList.toggle('on', x === b));
    tiDir = b.dataset.d; loadTopInvestors();
  });
  $('#tiCsv').addEventListener('click', () => download({ source: 'top_investors', format: 'csv', filename: 'top_investors', ...tiParams() }, 'top_investors.csv'));
  $('#tiXlsx').addEventListener('click', () => download({ source: 'top_investors', format: 'xlsx', filename: 'top_investors', ...tiParams() }, 'top_investors.xlsx'));
  // Recap table above: same client-side exporters as the generic table bar.
  const sumExport = (fn) => () => {
    const table = $('#utxSumTable table');
    if (!table) return toast(t('utx_sum_pick_range'));
    Promise.resolve(fn(table, 'users_transactions_summary')).catch((err) => toast(err.message));
  };
  $('#utxSumCsv').addEventListener('click', sumExport(exportTableCsv));
  $('#utxSumXlsx').addEventListener('click', sumExport(exportTableXlsx));
  $('#utxSumPdf').addEventListener('click', sumExport(exportTablePdf));
  $('#utxPrev').addEventListener('click', () => { utx.offset = Math.max(0, utx.offset - utx.limit); loadUtx(); });
  $('#utxNext').addEventListener('click', () => { utx.offset += utx.limit; loadUtx(); });
  $('#utxCsv').addEventListener('click', () => download(
    { source: 'users_transactions', format: 'csv', filename: 'users_transactions', ...utxParams() }, 'users_transactions.csv'));
  $('#utxXlsx').addEventListener('click', () => download(
    { source: 'users_transactions', format: 'xlsx', filename: 'users_transactions', ...utxParams() }, 'users_transactions.xlsx'));
  $('#utxPdf').addEventListener('click', () => download(
    { source: 'users_transactions', format: 'pdf', filename: 'users_transactions', ...utxParams() }, 'users_transactions.pdf'));

  // Paged lists sort on the server (see TABLE SORT): page one in the new order.
  const pagedSort = (state, load) => (sort) => { state.sort = sort; state.offset = 0; load(); };
  Object.assign(SERVER_SORT, {
    utxTable: pagedSort(utx, loadUtx), remTxTable: pagedSort(remTx, loadRemTx), sitxTable: pagedSort(sitx, loadSitx),
    evcUsersTable: pagedSort(evcUsers, loadEvcUsers), evcTxTable: pagedSort(evcTx, loadEvcTx),
    exTable: pagedSort(ex, loadExplore), erLogTable: pagedSort(er, loadEmailLog),
  });

  // event code tracking
  $('#evcApply').addEventListener('click', loadEventCode);
  $('#evcExportAll').addEventListener('click', exportEvcWorkbook);
  $('#evcUsersCsv').addEventListener('click', () => exportEvcUsers('csv'));
  $('#evcUsersXlsx').addEventListener('click', () => exportEvcUsers('xlsx'));
  $('#evcPfGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    evcPfGrain = b.dataset.g; loadEvcPortfolio();
  });
  $('#evcPfMode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    evcPfMode = b.dataset.m; renderEvcPortfolio();
  });
  $('#evcCodes').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadEventCode(); });
  $('#evcRecapType').addEventListener('change', loadEvcRecap);
  $('#evcNewOnly').addEventListener('change', loadEvcRecap);
  $('#evcTargetReg').addEventListener('input', renderEvcRecap);
  $('#evcTargetTx').addEventListener('input', renderEvcRecap);
  $('#evcDayFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    evcDayFilter = b.dataset.f; renderEvcRecap();
  });
  $('#evcUsersPrev').addEventListener('click', () => { evcUsers.offset = Math.max(0, evcUsers.offset - evcUsers.limit); loadEvcUsers(); });
  $('#evcUsersNext').addEventListener('click', () => { evcUsers.offset += evcUsers.limit; loadEvcUsers(); });
  $('#evcGran').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#evcGran button').forEach((x) => x.classList.toggle('on', x === b));
    evcGranularity = b.dataset.g; loadEvcCohort();
  });
  $('#evcTxRun').addEventListener('click', () => { evcTx.offset = 0; loadEvcTx(); });
  $('#evcTxPrev').addEventListener('click', () => { evcTx.offset = Math.max(0, evcTx.offset - evcTx.limit); loadEvcTx(); });
  $('#evcTxNext').addEventListener('click', () => { evcTx.offset += evcTx.limit; loadEvcTx(); });
  $('#evcTxCsv').addEventListener('click', () => download(
    { source: 'event_code_transactions', format: 'csv', filename: 'event_code_transactions', ...evcTxParams() }, 'event_code_transactions.csv'));
  $('#evcTxXlsx').addEventListener('click', () => download(
    { source: 'event_code_transactions', format: 'xlsx', filename: 'event_code_transactions', ...evcTxParams() }, 'event_code_transactions.xlsx'));

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
    if (!date) { toast(t('msg_pick_a_date_first')); return; }
    download({ source: 'growth_top_funds', format: fmt, filename: 'top_funds', groupBy: topFundsGroup, date, excludeFunds: topFundsExcluded(), userFilter: ovUserFilter }, `top_funds.${fmt}`);
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
  $('#aiDigestBtn').addEventListener('click', loadAiDigest);
  $('#aiAnomBtn').addEventListener('click', loadAiAnomalies);
  $('#aiChurnBtn').addEventListener('click', loadAiChurn);
  $('#aiWdBtn').addEventListener('click', loadAiWatchdog);
  $('#peNarrativeBtn').addEventListener('click', () => writeNarrative('#peNarrativeBtn', '#peNarrative', peSelected));
  $('#pfNarrativeBtn').addEventListener('click', () => writeNarrative('#pfNarrativeBtn', '#pfNarrative', pfSelected));
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

// login gate
// Three cards share the same #gate overlay — login, forgot-password, and
// set-new-password — only one visible at a time.
let resetGateToken = null; // set in init() from ?reset=<token>, consumed by wireGate()'s submitReset
function showGateCard(which) {
  $('#gate').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
  ['gate-login', 'gate-forgot', 'gate-reset'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== which));
}
function showGate(err) {
  showGateCard('gate-login');
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
    if (!username || !password) { $('#gate-err').textContent = 'Enter a username/email and password.'; return; }
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
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* token already invalid, fine */ }
    clearAuth();
    currentUser = null;
    showGate();
  });

  // forgot password — always shows the same generic message, whether or not
  // the username exists / has an email on file (the server never reveals that).
  $('#gate-forgot-link').addEventListener('click', () => {
    $('#forgot-username').value = $('#gate-username').value;
    $('#forgot-msg').textContent = '';
    showGateCard('gate-forgot');
    $('#forgot-username').focus();
  });
  $('#forgot-cancel-btn').addEventListener('click', () => showGate());
  const submitForgot = async () => {
    const username = $('#forgot-username').value.trim();
    if (!username) { $('#forgot-msg').textContent = 'Enter your username.'; return; }
    $('#forgot-submit-btn').disabled = true;
    try {
      const res = await fetch(API_BASE + '/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
      });
      const body = await res.json().catch(() => ({}));
      $('#forgot-msg').textContent = body.message || 'If that account has an email on file, a reset link has been sent.';
    } catch {
      $('#forgot-msg').textContent = 'Could not reach the server.';
    } finally {
      $('#forgot-submit-btn').disabled = false;
    }
  };
  $('#forgot-submit-btn').addEventListener('click', submitForgot);
  $('#forgot-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitForgot(); });

  // set new password — landed here via the emailed reset link (?reset=<token>),
  // wired unconditionally so Enter/click work even if the token turns out to
  // be missing/expired; resetGateToken (set in init()) gates the actual call.
  const submitReset = async () => {
    if (!resetGateToken) return;
    const p1 = $('#reset-password').value;
    const p2 = $('#reset-password-confirm').value;
    if (!p1) { $('#reset-err').textContent = 'Enter a new password.'; return; }
    if (p1 !== p2) { $('#reset-err').textContent = 'Passwords do not match.'; return; }
    $('#reset-submit-btn').disabled = true;
    try {
      const res = await fetch(API_BASE + '/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetGateToken, newPassword: p1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('#reset-err').textContent = body.error || 'Could not reset password.'; return; }
      history.replaceState(null, '', location.pathname);
      showGate();
      toast(t('msg_password_updated_sign_in_with_your_new_p'));
    } catch {
      $('#reset-err').textContent = 'Could not reach the server.';
    } finally {
      $('#reset-submit-btn').disabled = false;
    }
  };
  $('#reset-submit-btn').addEventListener('click', submitReset);
  $('#reset-password-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitReset(); });
}

// boot
// Runs once we know who's logged in (fresh login or a restored session).
async function boot() {
  loadRemTxFilterOptions();
  loadUtxFundOptions();
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
window.onLanguageChange = () => { setConnStatus(lastConnLive); renderAskThread(); updateOverviewUserFilterBtn(); repaintActiveTab(); };

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
  $('#pushFrom').value = r.from; $('#pushTo').value = r.to;
  $('#mktFrom').value = r.from; $('#mktTo').value = r.to;
  $('#ahFrom').value = r.from; $('#ahTo').value = r.to;
  // Shorter defaults than the 12 months above: the email log is new, and
  // every User behavior and analysis-tab query scans GA4 for the whole range
  // (about 100 MB a month).
  const er90 = daysAgoRange(90); $('#erFrom').value = er90.from; $('#erTo').value = er90.to;
  const bh30 = daysAgoRange(30); $('#bhFrom').value = bh30.from; $('#bhTo').value = bh30.to;
  ANALYSIS_TABS.forEach((tab) => { $(`#${tab.prefix}From`).value = bh30.from; $(`#${tab.prefix}To`).value = bh30.to; });
  // Product funnel follows sign-ups for weeks, so it opens on 90 days.
  const pfn90 = daysAgoRange(90); $('#pfnFrom').value = pfn90.from; $('#pfnTo').value = pfn90.to;
  $('#remFrom').value = r.from; $('#remTo').value = r.to;
  $('#remTxFrom').value = r.from; $('#remTxTo').value = r.to;
  // The event window drives a one-row-per-day recap, so it starts bounded.
  const evc30 = daysAgoRange(30); $('#evcFrom').value = evc30.from; $('#evcTo').value = evc30.to;
  $('#evcTxFrom').value = evc30.from; $('#evcTxTo').value = evc30.to;
  $('#sitxFrom').value = r.from; $('#sitxTo').value = r.to;
  syncThemeSeg(getThemeChoice());
  translatePage();
  syncLangSeg(getLang());
  wire(); wireGate(); wireAdmin(); wireChangePassword(); wireSetUsername();

  // A reset-password link takes priority over any existing session — even a
  // logged-in user who clicks one should land on "set a new password", not
  // their dashboard. Skips the auto-login check below entirely.
  resetGateToken = new URLSearchParams(location.search).get('reset');
  if (resetGateToken) { showGateCard('gate-reset'); return; }

  // Health is the one route that doesn't need a session — check it either way.
  // Not awaited: it runs a real BigQuery query (up to its 5s timeout) and only
  // drives the connection pill and the Ask box, so it must never hold the
  // login check below.
  api('/api/health').then((h) => {
    setConnStatus(!!h.bigquery);
    setInterval(pollHealth, 30000);
    const askOn = !!h.askEnabled;
    $('#askDisabled').classList.toggle('hidden', askOn);
    $('#askBox').classList.toggle('hidden', !askOn);
  }).catch(() => setConnStatus(false));

  const auth = getAuth();
  if (!auth) { showGate(); return; }
  // A stored session opens the app straight away with the cached user, and
  // /api/auth/me re-checks it in the background. An expired or revoked token
  // comes back 401, which api() turns into clearAuth() + the login card. The
  // server enforces every permission itself, so the cached user only decides
  // which nav links show until the fresh copy arrives.
  hideGate();
  applyPermissions(auth.user);
  boot();
  try {
    const me = await api('/api/auth/me');
    setAuth({ ...auth, user: me.user });
    applyPermissions(me.user);
  } catch {
    clearAuth();
    showGate();
  }
}

init();

// Installable app (PWA): register the service worker so Chrome/Android offers
// "Install app"; iOS uses Share > Add to Home Screen. Failure is harmless.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
