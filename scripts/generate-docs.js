'use strict';

// Writes DOKUMENTASI.md: the whole project explained, from "what is this
// tab for" down to the tables and joins behind it. Everything that can be
// read from the code is read from it on every run, so the document follows
// the code: sidebar tabs and groups, each tab's endpoints, the BigQuery
// tables its queries touch, the Supabase tables and ML models behind it,
// libraries, workflows, settings, and the column redaction rule. The prose
// comes from docs/content.js and the in-app Documentation tab (Indonesian).
//
// Run: npm run docs (npm run deploy:all runs it first). Nothing here calls
// BigQuery or any network service: query builders are only called to read
// the SQL they would send. Gaps (a tab or dataset with no written
// explanation yet) are printed as warnings and marked in the document.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'DOKUMENTASI.md');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const C = require('../docs/content.js');
const Q = require('../server/queries.js');

const warnings = [];
const warn = (m) => warnings.push(m);
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// Older in-app texts still carry em dashes; this document does not.
const clean = (s) => strip(s).replace(/\s*[—–]\s*/g, ', ');
const md = (s) => String(s).replace(/\|/g, '\\|');
const code = (s) => `\`${s}\``;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- what the code says ----------

const html = read('public/index.html');
const i18nSrc = read('public/i18n.js');
const I18N = new Function(`${i18nSrc.split('const LANG_KEY')[0]}; return I18N;`)();
const tr = (key) => I18N.id[key] ?? I18N.en[key];

// Sidebar: groups in order, each with its tabs (id and label).
const nav = html.slice(html.indexOf('<nav class="nav">'), html.indexOf('</nav>'));
const groups = nav.split('<div class="nav-group"').slice(1).map((chunk) => {
  const labelKey = (chunk.match(/data-i18n="(nav_group_[a-z_]+)"/) || [])[1];
  return {
    id: (chunk.match(/data-group="([a-z0-9-]+)"/) || [])[1],
    label: labelKey ? `${strip(I18N.en[labelKey])}${I18N.id[labelKey] && I18N.id[labelKey] !== I18N.en[labelKey] ? ` (${strip(I18N.id[labelKey])})` : ''}` : strip((chunk.match(/nav-label">([\s\S]*?)<\/div>/) || [])[1]),
    tabs: [...chunk.matchAll(/data-tab="([a-z0-9-]+)"[^>]*>[\s\S]*?<\/span>([^<]+)<\/button>/g)].map((m) => ({ id: m[1], label: strip(m[2]) })),
  };
}).filter((g) => g.tabs.length);
const allTabs = groups.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.label })));

// In-app Documentation entries by their heading, for the plain explanation.
const docItems = [...html.matchAll(/<div class="doc-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p data-i18n(?:-html)?="([a-z0-9_]+)"/g)]
  .map((m) => ({ name: strip(m[1]).toLowerCase(), key: m[2] }));
const docKeyFor = (tab) => (C.TABS[tab.id] && C.TABS[tab.id].docKey) || (docItems.find((d) => d.name === tab.label.toLowerCase()) || {}).key;

// End of the call that opens at src[open] ('(' or '['), skipping strings,
// template-literal text and comments, so a route's builders are read from
// that route's own registration only.
function callEnd(src, open) {
  const closeOf = { '(': ')', '[': ']', '{': '}' };
  const stack = [src[open]];
  const tpl = []; // brace depth at which each open template literal resumes
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (tpl.length && stack.length === tpl[tpl.length - 1]) {
      // inside template text
      if (c === '\\') { i++; continue; }
      if (c === '`') { tpl.pop(); continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push('{'); i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '`') { tpl.push(stack.length); continue; }
    if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return src.length;
}

// Top-level comma-separated arguments of the call whose '(' is at src[open].
function callArgs(src, open) {
  const end = callEnd(src, open);
  const body = src.slice(open + 1, end);
  const args = [];
  let depth = 0, start = 0, quote = null, tplDepth = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (quote === '`' && c === '$' && body[i + 1] === '{') { tplDepth.push(depth); depth++; quote = null; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      depth--;
      if (c === '}' && tplDepth.length && depth === tplDepth[tplDepth.length - 1]) { tplDepth.pop(); quote = '`'; }
    } else if (c === ',' && depth === 0) { args.push(body.slice(start, i)); start = i + 1; }
  }
  args.push(body.slice(start));
  return args.map((a) => a.trim());
}

// Column labels of every table the frontend draws, by its element id:
// genTable('#id', rows, [{ key, label }]) and hand-built <th> headers.
const frontJs = read('public/app.js');
const labelOf = (expr) => {
  let m = expr.match(/^t\('([a-z0-9_]+)'\)$/);
  if (m) return { key: m[1], en: strip(I18N.en[m[1]] || m[1]) };
  m = expr.match(/^'([^']*)'$/) || expr.match(/^`([^`$]*)`$/);
  return m ? { en: m[1] } : null;
};
const tableColumns = {};
for (const m of frontJs.matchAll(/genTable\(\s*'#([A-Za-z0-9]+)'/g)) {
  const args = callArgs(frontJs, m.index + 'genTable'.length);
  const cols = [...(args[2] || '').matchAll(/label:\s*(t\('[a-z0-9_]+'\)|'[^']*'|`[^`]*`)/g)].map((x) => labelOf(x[1])).filter((x) => x && x.en);
  tableColumns[m[1]] = [...(tableColumns[m[1]] || []), ...cols];
}
for (const m of frontJs.matchAll(/\$\('#([A-Za-z0-9]+)'\)\.innerHTML = `<table><thead><tr>([\s\S]*?)<\/tr><\/thead>/g)) {
  const cols = [...m[2].matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((x) => {
    const k = x[1].match(/^\$\{t\('([a-z0-9_]+)'\)\}$/);
    return k ? { key: k[1], en: strip(I18N.en[k[1]] || k[1]) } : x[1].includes('${') ? null : { en: strip(x[1]) };
  }).filter((x) => x && x.en);
  tableColumns[m[1]] = [...(tableColumns[m[1]] || []), ...cols];
}
// The ID label for an English one, when the dictionaries have it.
const enToId = {};
Object.entries(I18N.en).forEach(([k, v]) => { if (I18N.id[k] && !enToId[strip(v)]) enToId[strip(v)] = strip(I18N.id[k]); });
const withId = (en) => (enToId[en] && enToId[en] !== en ? `${en} / ${enToId[en]}` : en);

// Panels of a tab, from its <section>: title, hints, and the tables,
// charts and KPI cards inside.
function panelsOf(tabId) {
  const open = html.indexOf(`<section id="${tabId}"`);
  if (open < 0) return [];
  const section = html.slice(open, html.indexOf('</section>', open));
  return section.split(/<div class="panel(?:"| [^"]*")/).slice(1).map((chunk) => {
    const h2 = chunk.match(/<h2(?: data-i18n="([a-z0-9_]+)")?[^>]*>([\s\S]*?)<\/h2>/);
    const titleKey = h2 && h2[1];
    const title = h2 ? strip(titleKey ? I18N.en[titleKey] || h2[2] : h2[2]) : '';
    const hintKeys = [...chunk.matchAll(/<span class="hint" data-i18n(?:-html)?="([a-z0-9_]+)"/g), ...chunk.matchAll(/<span data-i18n(?:-html)?="([a-z0-9_]+)">[^<]*<\/span>\s*<\/div>/g)].map((x) => x[1]);
    return {
      title,
      titleId: titleKey && I18N.id[titleKey] && I18N.id[titleKey] !== I18N.en[titleKey] ? strip(I18N.id[titleKey]) : '',
      hints: [...new Set(hintKeys)].map((k) => clean(tr(k))).filter(Boolean),
      tables: [...chunk.matchAll(/id="([A-Za-z0-9]+)" class="table-wrap/g)].map((x) => x[1]),
      charts: [...chunk.matchAll(/<canvas id="([A-Za-z0-9]+)"/g)].map((x) => x[1]),
      kpis: [...chunk.matchAll(/id="([A-Za-z0-9]+)" class="kpi-grid/g)].map((x) => x[1]),
    };
  }).filter((pn) => pn.title || pn.tables.length || pn.charts.length || pn.kpis.length);
}

const appJs = read('server/app.js');
const aliases = Object.fromEntries([...appJs.matchAll(/const (\w+) = require\('\.\/([a-z0-9-]+)'\)/g)].map((m) => [m[1], `server/${m[2]}.js`]));
const TABLE_RE = /`?(sayakaya\.[a-z0-9_]+\.[A-Za-z0-9_*]+)`?/g;
const SUPA_RE = /\b(dashboard_[a-z_]+)\b/g;
const supabaseTables = [...new Set(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
  .flatMap((f) => [...read(`supabase/migrations/${f}`).matchAll(/create (?:or replace )?(?:table|view|function) (?:if not exists )?(?:public\.)?([a-z_]+)/gi)].map((m) => m[1])))];
const fileFacts = {};
// Tables a module touches, per top-level function, so a route that calls
// Auth.listAuditLog is credited with the audit log only.
function factsOf(file) {
  if (!fileFacts[file]) {
    const src = exists(file) ? read(file) : '';
    const supaIn = (text) => [...new Set([...text.matchAll(SUPA_RE)].map((m) => m[1]).filter((t) => supabaseTables.includes(t)))];
    const starts = [...src.matchAll(/^(?:async )?function (\w+)|^const (\w+) = (?:async )?(?:\([^)]*\)|\w+) =>/gm)].map((m) => ({ name: m[1] || m[2], i: m.index }));
    const fns = {};
    starts.forEach((f, k) => { fns[f.name] = supaIn(src.slice(f.i, k + 1 < starts.length ? starts[k + 1].i : src.length)); });
    fileFacts[file] = { bq: [...new Set([...src.matchAll(TABLE_RE)].map((m) => m[1]))], supa: supaIn(src), fns };
  }
  return fileFacts[file];
}
// The SQL a builder would send, read by calling it with sample arguments.
const SAMPLE_ARGS = [['2026-01-01', '2026-01-31'], [], [{}], ['x', '2026-01-01', '2026-01-31']];
function builderTables(name) {
  const fn = Q[name];
  const out = new Set();
  if (typeof fn !== 'function') return out;
  for (const args of SAMPLE_ARGS) {
    try {
      const q = fn(...args);
      const sql = typeof q === 'string' ? q : q && q.sql;
      if (sql) for (const m of sql.matchAll(TABLE_RE)) out.add(m[1]);
    } catch { /* this argument shape does not fit; try the next */ }
  }
  return out;
}

// Routes: method, path, tabs allowed, builders and other modules used.
const routes = [];
function addRoute(method, routePath, tabs, body) {
  const builders = [...new Set([...body.matchAll(/\bQ\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  const modules = Object.keys(aliases).filter((a) => a !== 'Q' && new RegExp(`\\b${a}\\.`).test(body));
  routes.push({ method, path: routePath, tabs, builders, modules, body });
}
for (const m of appJs.matchAll(/app\.(get|post|put|patch|delete)\(/g)) {
  const open = m.index + m[0].length - 1;
  const body = appJs.slice(m.index, callEnd(appJs, open) + 1);
  const lit = body.match(/^app\.\w+\(\s*(['`])([^'`]+)\1/);
  if (!lit || lit[2].includes('${')) continue; // helper or table-driven routes, read below
  const tabs = [...new Set([...body.matchAll(/requireTab\('([a-z0-9-]+)'\)|userCan\(req\.user, '([a-z0-9-]+)'\)/g)].map((x) => x[1] || x[2]))];
  addRoute(m[1].toUpperCase(), lit[2], tabs, body);
}
// Helper-registered routes, e.g. behaviorRoute('/api/behavior/x', Q.builder).
for (const h of appJs.matchAll(/const (\w+) = \((\w+), (\w+)\) => app\.(get|post)\(\2, requireTab\('([a-z0-9-]+)'\)/g)) {
  for (const call of appJs.matchAll(new RegExp(`\\b${h[1]}\\('([^']+)', (Q\\.[A-Za-z0-9_]+)\\)`, 'g'))) {
    addRoute(h[4].toUpperCase(), call[1], [h[5]], call[2]);
  }
}
// Table-driven routes: ANALYSIS_ROUTES = [[tab, prefix, { key: Q.builder }]].
const arStart = appJs.indexOf('const ANALYSIS_ROUTES = [');
const analysisTabs = [];
if (arStart >= 0) {
  const open = appJs.indexOf('[', arStart);
  const block = appJs.slice(open, callEnd(appJs, open) + 1);
  for (const e of block.matchAll(/\['([a-z0-9-]+)', '([a-z0-9-]+)', \{([\s\S]*?)\}\]/g)) {
    analysisTabs.push(e[1]);
    for (const b of e[3].matchAll(/(\w+): (Q\.[A-Za-z0-9_]+)/g)) addRoute('GET', `/api/${e[2]}/${b[1]}`, [e[1]], b[2]);
  }
}
// Routes gated by something other than a literal tab id: superuser-only
// account pages, decks gated by their own config, and the analysis tabs'
// shared endpoint.
const PATH_TABS = [
  [/^\/api\/admin\/users/, ['admin']],
  [/^\/api\/admin\/audit-log/, ['activity-log']],
  [/^\/api\/presentations\//, ['presentation', 'monthly-review']],
  [/^\/api\/analysis\/coverage/, analysisTabs],
];
routes.forEach((r) => {
  const hit = !r.tabs.length && PATH_TABS.find(([re]) => re.test(r.path));
  if (hit) r.tabs = hit[1].slice();
});

// What each route reads: BigQuery tables from its builders and from the
// modules it calls, Supabase tables from those modules.
routes.forEach((r) => {
  const bq = new Set();
  const supa = new Set();
  r.builders.forEach((b) => builderTables(b).forEach((t) => bq.add(t)));
  r.modules.forEach((a) => {
    const f = factsOf(aliases[a]);
    if (['ML', 'MLTrain', 'EX'].includes(a)) f.bq.forEach((t) => bq.add(t));
    // Supabase tables of the module functions this route calls. userCan only
    // checks the account already loaded for the request.
    for (const m of r.body.matchAll(new RegExp(`\\b${a}\\.(\\w+)`, 'g'))) {
      if (m[1] !== 'userCan') (f.fns[m[1]] || []).forEach((t) => supa.add(t));
    }
  });
  r.bq = [...bq].sort();
  r.supa = [...supa].sort();
});
const routesOf = (tabId) => routes.filter((r) => r.tabs.includes(tabId));
const sharedRoutes = routes.filter((r) => !r.tabs.length);

// Libraries and services.
const pkg = JSON.parse(read('package.json'));
const cdn = [...new Set([...html.matchAll(/<script src="(https:[^"]+)"/g)].map((m) => m[1]))];
const fonts = (html.match(/fonts\.googleapis\.com\/css2\?([^"]+)"/) || [])[1];
const fontFamilies = fonts ? [...fonts.matchAll(/family=([^:&]+)/g)].map((m) => m[1].replace(/\+/g, ' ')) : [];
const denoImports = [...new Set([...read('supabase/functions/api/index.ts').matchAll(/from '(npm:[^']+|jsr:[^']+|https:[^']+)'/g)].map((m) => m[1]))];
const workflows = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => {
  const y = read(`.github/workflows/${f}`);
  return {
    file: f,
    name: (y.match(/^name:\s*(.+)$/m) || [])[1] || f,
    cron: [...y.matchAll(/cron:\s*["']([^"']+)["']/g)].map((m) => m[1]),
    push: /^\s*push:/m.test(y),
    paths: /^\s*paths:/m.test(y),
    dispatch: /workflow_dispatch/.test(y),
  };
});
const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
const migrationTables = supabaseTables;
const envVars = [];
read('.env.example').split('\n').reduce((note, line) => {
  const m = line.match(/^#?\s*([A-Z][A-Z0-9_]+)=/);
  if (m && !line.startsWith('# ') ) { envVars.push({ key: m[1], note: note.trim(), optional: line.startsWith('#') }); return ''; }
  if (line.startsWith('#')) return `${note} ${line.replace(/^#+\s?/, '')}`;
  return '';
}, '');
const redaction = (read('server/bigquery.js').match(/const SENSITIVE_COLUMN_RE = (\/.+\/[a-z]*);/) || [])[1];
const maxBytes = (read('server/bigquery.js').match(/MAX_BYTES_BILLED \|\| ([0-9_]+)/) || [])[1];
const askModel = (read('server/ask.js').match(/ANTHROPIC_MODEL \|\| '([^']+)'/) || [])[1];
const apiBase = (read('public/app.js').match(/const API_BASE = ([^\n]+)/) || [])[1];
const sessionTtl = (read('server/auth.js').match(/SESSION_TTL_MS = ([^;]+);/) || [])[1];
let commit = 'tidak diketahui';
try {
  // The last commit that changed anything but this document, so running the
  // generator twice on the same code gives the same file.
  commit = execSync("git log -1 --format='%h (%cs)' -- . ':(exclude)DOKUMENTASI.md'", { cwd: ROOT }).toString().trim();
} catch { /* not a git checkout */ }

// Every BigQuery table used anywhere, with the tabs that read it.
const tableUse = {};
routes.forEach((r) => r.bq.forEach((t) => {
  tableUse[t] = tableUse[t] || new Set();
  r.tabs.forEach((x) => tableUse[t].add(x));
}));
fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js')).forEach((f) => factsOf(`server/${f}`).bq.forEach((t) => { tableUse[t] = tableUse[t] || new Set(); }));
const datasets = {};
Object.keys(tableUse).sort().forEach((t) => {
  const [, ds, table] = t.split('.');
  (datasets[ds] = datasets[ds] || []).push(table);
});
const tabLabel = Object.fromEntries(allTabs.map((t) => [t.id, t.label]));

// --inventory: what each tab shows, for writing docs/content.js entries.
if (process.argv.includes('--inventory')) {
  allTabs.forEach((t) => {
    console.log(`\n## ${t.label} (${t.id})`);
    panelsOf(t.id).forEach((pn) => {
      console.log(`- ${pn.title || '(tanpa judul)'}${pn.kpis.length ? ' [KPI]' : ''}${pn.charts.length ? ` [grafik: ${pn.charts.join(', ')}]` : ''}`);
      pn.tables.forEach((tb) => console.log(`    ${tb}: ${(tableColumns[tb] || []).map((c) => c.en).join(' | ') || '(kolom dinamis atau dibuat helper)'}`));
    });
  });
  process.exit(0);
}

// ---------- gaps ----------

allTabs.forEach((t) => {
  if (!C.TABS[t.id]) warn(`Tab "${t.label}" (${t.id}) belum punya entri di docs/content.js TABS.`);
  if (!docKeyFor(t) && !['ask', 'explorer', 'sql', 'docs'].includes(t.id)) warn(`Tab "${t.label}" (${t.id}) tidak punya entri di tab Documentation.`);
});
Object.keys(C.TABS).filter((id) => !tabLabel[id]).forEach((id) => warn(`docs/content.js TABS punya "${id}", tapi tab itu tidak ada lagi di sidebar.`));
Object.keys(datasets).filter((d) => !C.DATASETS[d]).forEach((d) => warn(`Dataset BigQuery "${d}" belum punya deskripsi di docs/content.js DATASETS.`));
migrationTables.filter((t) => !C.SUPABASE_TABLES[t]).forEach((t) => warn(`Tabel Supabase "${t}" belum punya deskripsi di docs/content.js SUPABASE_TABLES.`));
C.REPO_MAP.filter(([p]) => !exists(p)).forEach(([p]) => warn(`Path "${p}" di docs/content.js REPO_MAP tidak ada lagi.`));

// UI strings a documented label can refer to: every English dictionary
// value and every quoted string or table header in the frontend.
const uiStrings = new Set([
  ...Object.values(I18N.en).map(strip),
  ...[...frontJs.matchAll(/'([^'\\\n]{1,80})'/g)].map((m) => m[1]),
  ...[...(frontJs + html).matchAll(/<th[^>]*>([^<$]{1,80})<\/th>/g)].map((m) => strip(m[1])),
]);
const knownLabel = (l) => uiStrings.has(l) || /,| sampai /.test(l);
Object.entries(C.TAB_DETAILS || {}).forEach(([id, d]) => {
  if (!tabLabel[id]) { warn(`docs/content.js TAB_DETAILS punya "${id}", tapi tab itu tidak ada di sidebar.`); return; }
  const panels = panelsOf(id);
  Object.keys(d.panels || {}).forEach((key) => {
    const found = key.startsWith('#') ? panels.some((pn) => pn.tables.includes(key.slice(1))) : panels.some((pn) => pn.title === key);
    if (!found) warn(`Tab "${tabLabel[id]}": panel "${key}" di TAB_DETAILS tidak ditemukan di halaman.`);
  });
  const labels = [...(d.kpis || []).map(([l]) => l), ...Object.values(d.panels || {}).flatMap((pn) => (pn.columns || []).map(([l]) => l))];
  labels.filter((l) => !knownLabel(l)).forEach((l) => warn(`Tab "${tabLabel[id]}": label "${l}" di TAB_DETAILS tidak ditemukan di aplikasi.`));
});

// "Isi tab" and "Catatan penting" for one tab, panels in page order.
function renderDetails(t) {
  const d = C.TAB_DETAILS && C.TAB_DETAILS[t.id];
  if (!d) return;
  const items = [];
  if (d.kpis && d.kpis.length) {
    items.push('  - *Kartu ringkasan di atas tab*:');
    d.kpis.forEach(([l, m]) => items.push(`    - **${withId(l)}**: ${m}`));
  }
  const used = new Set();
  const panelLine = (title, titleId, pd) => {
    items.push(`  - *${clean(title)}*${titleId ? ` (${clean(titleId)})` : ''}${pd.note ? `: ${pd.note}` : ''}`);
    (pd.columns || []).forEach(([l, m]) => items.push(`    - **${withId(l)}**: ${m}`));
  };
  panelsOf(t.id).forEach((pn) => {
    const key = (d.panels || {})[pn.title] && !used.has(pn.title) ? pn.title : Object.keys(d.panels || {}).find((k) => k.startsWith('#') && pn.tables.includes(k.slice(1)) && !used.has(k));
    if (!key) return;
    used.add(key);
    const pd = d.panels[key];
    panelLine(pd.title || pn.title, pd.title ? '' : pn.titleId, pd);
  });
  if (items.length) { p('- **Isi tab**:'); items.forEach((x) => p(x)); }
  if (d.notes && d.notes.length) { p('- **Catatan penting**:'); d.notes.forEach((n) => p(`  - ${n}`)); }
}

// ---------- document ----------

const L = [];
const p = (...lines) => L.push(...lines);
const tabAnchor = (t) => `tab-${slug(t.id)}`;

p('# Dokumentasi Sayakaya Analytics', '');
p(`> File ini dibuat otomatis oleh ${code('scripts/generate-docs.js')} setiap kali ${code('npm run docs')} atau ${code('npm run deploy:all')} dijalankan. Jangan mengedit file ini langsung: ubah kodenya, teks di ${code('docs/content.js')}, atau teks tab Documentation di aplikasi, lalu jalankan ulang. Isi ini sesuai kode pada commit ${code(commit)}.`, '');
p('## Cara membaca dokumen ini', '');
p('Dokumen ini ditulis untuk dua jenis pembaca:', '');
p('- **Bukan orang teknis** (bisnis, operasional, marketing): baca bagian 1 sampai 3, lalu di bagian 6 baca baris **Untuk apa** dan **Penjelasan sederhana** pada tab yang Anda pakai. Istilah yang asing ada di bagian 2.');
p('- **Orang teknis** (engineer, data analyst): semua bagian. Baris **Cara hitung** dan **Detail teknis** di setiap tab menyebut tabel, kunci join, endpoint API, dan fungsi query di kode. Bagian 4 dan 5 menjelaskan arsitektur dan sumber data.', '');
p('## Daftar isi', '');
p('1. [Apa itu Sayakaya Analytics](#1-apa-itu-sayakaya-analytics)', '2. [Istilah penting](#2-istilah-penting)', '3. [Daftar tab](#3-daftar-tab)', '4. [Arsitektur dan teknologi](#4-arsitektur-dan-teknologi)', '5. [Sumber data](#5-sumber-data)', '6. [Tab demi tab](#6-tab-demi-tab)', '7. [Deploy dan pemeliharaan](#7-deploy-dan-pemeliharaan)', '8. [Lampiran: endpoint bersama](#8-lampiran-endpoint-bersama)', '');

p('## 1. Apa itu Sayakaya Analytics', '');
p('Sayakaya Analytics adalah dashboard internal untuk platform reksa dana Sayakaya. Dashboard ini membaca data langsung dari gudang data perusahaan (Google BigQuery) dan menampilkannya sebagai angka, grafik, dan tabel yang bisa diunduh. Tidak ada angka yang diketik manual: setiap angka dihitung ulang dari data saat halaman dibuka.', '');
p('Yang bisa dilakukan, secara garis besar:', '');
p('- **Memantau bisnis**: total dana kelolaan (AUM), pembelian dan penjualan, pertumbuhan pengguna, revenue fee.');
p('- **Melihat investor**: portofolio satu investor dari beberapa sumber data, investor terbesar, investor yang lama tidak membeli.');
p('- **Operasional**: menelusuri transaksi, mencocokkan data aplikasi dengan kustodian, mengirim e-statement dan laporan lewat email (termasuk terjadwal).');
p('- **Revenue dan mitra**: fee yang diterima Sayakaya, bagi hasil remisier, hasil kampanye promo.');
p('- **Marketing dan produk**: atribusi iklan, program referral, push notification, kesehatan aplikasi, dan perilaku pengguna di aplikasi yang dicocokkan dengan database (siapa membeli, di mana orang berhenti, fitur apa yang dipakai).');
p('- **Alat bantu**: bertanya dalam bahasa biasa (Ask), menjelajah tabel mentah, dan menulis query SQL sendiri (read-only).', '');
p(`Akses diatur per orang: admin (superuser) memilih tab mana yang boleh dibuka setiap akun. Saat ini ada ${allTabs.length} tab dalam ${groups.length} grup.`, '');

p('## 2. Istilah penting', '');
p('| Istilah | Artinya |', '|---|---|');
C.GLOSSARY.forEach(([k, v]) => p(`| ${md(k)} | ${md(v)} |`));
p('');

p('## 3. Daftar tab', '');
p('Urutan dan pengelompokan mengikuti sidebar aplikasi. Klik nama tab untuk penjelasan lengkapnya.', '');
groups.forEach((g) => {
  p(`**${g.label}**`, '');
  p('| Tab | Untuk apa |', '|---|---|');
  g.tabs.forEach((t) => p(`| [${md(t.label)}](#${tabAnchor(t)}) | ${md(C.TABS[t.id] ? C.TABS[t.id].summary : '(belum ada ringkasan)')} |`));
  p('');
});

p('## 4. Arsitektur dan teknologi', '');
p('### 4.1 Gambaran sederhana', '');
p('Bayangkan tiga lapis:', '');
p('1. **Data**: semua data perusahaan disalin ke Google BigQuery: database aplikasi (pengguna, transaksi, portofolio), hasil perhitungan fee, catatan aktivitas aplikasi dari Google Analytics, data Firebase, Adjust, dan feed kustodian.');
p('2. **Server**: program kecil yang menerima permintaan dari halaman dashboard, mengecek apakah orang itu boleh melihat tab tersebut, menjalankan query SQL yang sudah disiapkan ke BigQuery, lalu mengembalikan hasilnya. Akun, sesi login, jadwal email, dan log disimpan di Supabase.');
p('3. **Halaman**: satu halaman web yang menggambar tabel dan grafik dari hasil server, dalam Bahasa Inggris atau Indonesia, tema terang atau gelap.', '');
p('Orang yang membuka dashboard tidak pernah menyentuh BigQuery langsung. Server hanya menjalankan query yang sudah ditulis di kode. SQL lab dan Ask dibatasi read-only, dan kolom sensitif disaring dari setiap hasil.', '');
p('### 4.2 Diagram alur data', '');
p('```mermaid', 'flowchart LR');
p('  subgraph Sumber', '    APP[Aplikasi mobile Sayakaya]', '    PROD[(Database produksi)]', '    KSEI[S-INVEST / KSEI]', '    ADJ[Adjust]', '  end');
p('  subgraph BigQuery["Google BigQuery (project sayakaya)"]', '    MAIN[(main)]', '    FEE[(mi_fee_logs)]', '    GA4[(analytics_266759216)]', '    FB[(firebase_*)]', '    ADJD[(adjust_analytics)]', '    SINV[(sinvest)]', '    ML[(ml)]', '  end');
p('  PROD --> MAIN', '  MAIN --> FEE', '  APP -- event + user_id --> GA4', '  APP --> FB', '  ADJ --> ADJD', '  KSEI --> SINV', '  MAIN --> ML');
p('  subgraph Backend', '    EDGE[Supabase Edge Function api, Deno]', '    NODE[Server Node.js Express, lokal]', '  end');
p('  BigQuery --> EDGE', '  BigQuery --> NODE', '  SUPA[(Supabase Postgres: akun, sesi, jadwal, log)] <--> EDGE', '  EDGE --> SES[Amazon SES email]', '  EDGE --> CLAUDE[Anthropic Claude untuk Ask]');
p('  WEB[Halaman dashboard di GitHub Pages] -- /api --> EDGE', '  GHA[GitHub Actions cron] -- jadwal email --> EDGE');
p('```', '');
p(`Dari mana halaman tahu server mana yang dipakai: ${code(`const API_BASE = ${apiBase}`)}. Di situs live (github.io) halaman memanggil Supabase Edge Function; saat dijalankan lokal, halaman memanggil server Node di mesin yang sama.`, '');

p('### 4.3 Komponen dan teknologi', '');
p('| Lapis | Teknologi | Peran |', '|---|---|---|');
p(`| Halaman (frontend) | HTML, CSS, dan JavaScript biasa tanpa build step (${code('public/')}) | Seluruh tampilan dan interaksi dashboard. |`);
cdn.forEach((u) => {
  const m = u.match(/npm\/([^@/]+)@([^/]+)/);
  p(`| Halaman (frontend) | ${m ? `${m[1]} ${m[2]}` : u} (CDN) | ${/chartjs-chart-geo/.test(u) ? 'Peta sebaran investor (choropleth).' : /chart\.js/.test(u) ? 'Semua grafik.' : 'Library pihak ketiga.'} |`);
});
if (fontFamilies.length) p(`| Halaman (frontend) | Google Fonts: ${fontFamilies.join(', ')} | Huruf tampilan. |`);
p(`| Server lokal | Node.js ${md(pkg.engines && pkg.engines.node || '')} + Express (${code('server/')}) | Backend untuk pengembangan lokal (${code('npm start')}), Netlify, dan Cloud Run. |`);
p(`| Server live | Supabase Edge Function ${code('api')} di Deno/TypeScript (${code('supabase/functions/api/')}) | Backend yang dipakai situs live. Isinya port dari server Node; query SQL keduanya dijaga identik. |`);
p('| Data | Google BigQuery (project `sayakaya`, lokasi asia-southeast2) | Semua data analitik; query dijalankan di sini. |');
p('| Data | BigQuery ML (ARIMA_PLUS, regresi logistik) | Forecast AUM dan transaksi, model risiko churn. |');
p('| Penyimpanan aplikasi | Supabase (Postgres + Storage) | Akun dashboard, sesi, jadwal email, activity log, email log, file deck presentasi. |');
p(`| Email | Amazon SES (SMTP lewat nodemailer di Node, API di Deno) | Kirim e-statement, laporan, undangan, reset password; event dibuka/diklik lewat webhook SNS. |`);
p(`| AI | Anthropic Claude (model default ${code(askModel || '?')}, bisa diganti lewat ${code('ANTHROPIC_MODEL')}) | Fitur Ask: mengubah pertanyaan bahasa biasa menjadi SQL read-only dan memilih grafik. |`);
p('| Hosting halaman | GitHub Pages | Menyajikan folder `public/` untuk situs live. |');
p('| Otomasi | GitHub Actions | Deploy halaman, cron jadwal email. |');
p('| Tes | Node (skrip di `test/`) + jsdom | Merender setiap tab dengan data contoh dan mengecek aturan penting. |');
p('');
p(`Library Node (dari ${code('package.json')}):`, '');
p('| Paket | Versi | Dipakai untuk |', '|---|---|---|');
const PKG_NOTES = {
  '@google-cloud/bigquery': 'Menjalankan query BigQuery.', cors: 'Mengizinkan halaman memanggil API dari domain lain.', dotenv: 'Membaca pengaturan dari file .env.',
  exceljs: 'Membuat file Excel.', express: 'Server HTTP dan routing /api.', 'google-auth-library': 'Login ke Google API (Sheets).', nodemailer: 'Kirim email lewat SMTP SES.',
  pdfkit: 'Membuat PDF.', 'serverless-http': 'Menjalankan Express di Netlify Functions.', jsdom: 'DOM palsu untuk tes.',
};
Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).forEach(([n, v]) => p(`| ${code(n)} | ${md(v)} | ${md(PKG_NOTES[n] || '')} |`));
p('');
if (denoImports.length) {
  p(`Impor di Edge Function (${code('supabase/functions/api/index.ts')}): ${denoImports.map(code).join(', ')}.`, '');
}

p('### 4.4 Struktur repo', '');
p('| Path | Isi |', '|---|---|');
C.REPO_MAP.filter(([q]) => exists(q)).forEach(([q, v]) => p(`| ${code(q)} | ${md(v)} |`));
p('');

p('### 4.5 Pengaturan (environment variables)', '');
p(`Diambil dari ${code('.env.example')}. Nilai rahasia disimpan di ${code('.env')} (lokal) atau sebagai secret Supabase (live), tidak pernah di repo.`, '');
p('| Variabel | Keterangan |', '|---|---|');
envVars.forEach((e) => {
  if (!C.ENV_NOTES[e.key]) warn(`Variabel ${e.key} belum punya keterangan di docs/content.js ENV_NOTES.`);
  const note = C.ENV_NOTES[e.key] || e.note.replace(/\s*[—–]\s*/g, ', ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  p(`| ${code(e.key)}${e.optional ? ' (opsional)' : ''} | ${md(note)} |`);
});
p('');

p('### 4.6 Akses dan keamanan', '');
const ttlDays = sessionTtl && /^[0-9 *]+$/.test(sessionTtl.trim()) ? sessionTtl.split('*').reduce((a, x) => a * Number(x), 1) / 86400000 : null;
p(`- **Login**: email/username dan password; password disimpan sebagai hash. Sesi login berlaku ${ttlDays ? `${ttlDays} hari` : 'sesuai SESSION_TTL_MS di server/auth.js'} sejak login, tanpa diperpanjang otomatis.`);
p('- **Hak akses per tab**: setiap endpoint dijaga `requireTab(<id tab>)`. Superuser boleh semua tab; akun lain hanya tab yang dicentang di Manage users. Tab Documentation selalu terbuka.');
p(`- **Kolom sensitif disaring** dari setiap hasil query, termasuk SQL lab dan Ask, berdasarkan nama kolom: ${code(redaction || '?')}. Akibatnya query tidak boleh memakai nama kolom yang cocok dengan pola ini untuk data biasa.`);
const maxGb = maxBytes ? Number(maxBytes.replace(/_/g, '')) / 1e9 : null;
p(`- **Batas biaya**: setiap query BigQuery dibatasi ${maxGb ? `${maxGb} GB` : '?'} yang ditagih secara bawaan (bisa diubah lewat ${code('MAX_BYTES_BILLED')}). Query yang melebihi batas ditolak BigQuery sebelum berjalan.`);
p('- **SQL lab dan Ask hanya membaca**: hanya SELECT/WITH, satu statement, dan tabel yang diizinkan.');
p('- **Activity log**: login, ekspor, pertanyaan Ask, query SQL, melihat portofolio atau linimasa satu investor, dan perubahan akun dicatat.', '');

p('### 4.7 Proses otomatis', '');
p('| Workflow | Kapan jalan | Fungsi |', '|---|---|---|');
workflows.forEach((w) => {
  const when = [w.cron.length ? `cron ${w.cron.map(code).join(', ')} (UTC)` : '', w.push ? `push ke main${w.paths ? ' yang mengubah path tertentu' : ''}` : '', w.dispatch ? 'manual' : ''].filter(Boolean).join('; ');
  p(`| ${md(w.name)} (${code(w.file)}) | ${when || '-'} | ${/schedule/i.test(w.name) ? 'Memanggil endpoint cron untuk mengirim email terjadwal yang sudah jatuh tempo. Dalam praktik GitHub menjalankannya tiap beberapa jam, bukan tiap 15 menit.' : /pages/i.test(w.name) ? 'Menerbitkan folder public/ ke GitHub Pages saat ada perubahan di public/.' : /cloud run/i.test(w.name) ? `Deploy server Node ke Cloud Run${w.push ? '' : ' (pemicu push sedang dimatikan, hanya manual)'}.` : ''} |`);
});
p('');

p('## 5. Sumber data', '');
p('### 5.1 Dataset BigQuery', '');
p('Daftar tabel di bawah dibaca langsung dari SQL di kode, jadi selalu sesuai dengan yang benar-benar dipakai.', '');
Object.entries(datasets).forEach(([ds, tables]) => {
  p(`#### ${code(ds)}`, '');
  p(C.DATASETS[ds] || '(Belum ada deskripsi.)', '');
  p('| Tabel | Isi | Dipakai di tab |', '|---|---|---|');
  tables.forEach((tb) => {
    const full = `sayakaya.${ds}.${tb}`;
    const used = [...(tableUse[full] || [])].map((id) => tabLabel[id] || id).sort();
    p(`| ${code(tb)} | ${md(C.TABLE_NOTES[`${ds}.${tb}`] || '')} | ${md(used.join(', ') || 'alat bantu (Ask, Data explorer, ML)')} |`);
  });
  p('');
});
p('### 5.2 Tabel, view, dan fungsi Supabase', '');
p(`Dibuat oleh migrasi di ${code('supabase/migrations/')} (${migrations.length} file).`, '');
p('| Nama | Isi |', '|---|---|');
migrationTables.forEach((tb) => p(`| ${code(tb)} | ${md(C.SUPABASE_TABLES[tb] || '(Belum ada deskripsi.)')} |`));
p('');
p('### 5.3 Menghubungkan aktivitas aplikasi dengan database', '');
p('Setelah login, aplikasi mobile menempelkan `user_id` ke setiap event yang dikirim ke Google Analytics. `user_id` itu sama dengan `main.users.id`. Dengan satu kunci ini, apa yang dilakukan seseorang di aplikasi (layar yang dibuka, tombol yang ditekan) bisa dicocokkan dengan siapa dia (`main.users`, `main.user_profiles`), apa yang dia beli atau jual (`main.transactions`, `main.switching_transactions`), dan apa yang dia pegang (`main.portfolios`).', '');
p('Aturan pencocokan yang dipakai di seluruh tab analisis:', '');
p('- Event sebelum login tidak punya `user_id`, jadi tidak ikut dihitung di analisis per orang.');
p('- Event pasif (push masuk, push ditutup, update aplikasi atau OS) tidak dihitung sebagai memakai aplikasi.');
p('- Transaksi dicocokkan dengan jendela waktu, karena backend dan aplikasi mencatat di detik yang berbeda: baris pembelian ditulis beberapa detik sebelum event `order_created`, sedangkan baris penjualan ditulis sekitar 8 detik setelah `confirm_redeem_click`.');
p('- Pembelian dianggap berhasil bila statusnya completed, completed_payment, atau verified; pembelian bonus yang diinput admin (`manual_bonus`) tidak dihitung.');
p('- Setiap tab analisis menampilkan peta data yang mengukur kecocokan kedua sisi untuk periode yang dipilih: berapa persen `user_id` GA4 ditemukan di `main.users`, dan berapa persen transaksi di database punya event aplikasi yang cocok.', '');

p('## 6. Tab demi tab', '');
p('Setiap tab berisi: **Untuk apa** (ringkas), **Penjelasan sederhana** (sama dengan tab Documentation di aplikasi), **Data yang dibaca**, **Cara hitung**, **Isi tab** (narasi singkat per panel dan arti kolom yang tidak jelas dari namanya), **Catatan penting**, dan **Detail teknis** yang dibaca otomatis dari kode (id tab untuk hak akses, endpoint API, fungsi query, dan tabel yang benar-benar disentuh query). Label kolom ditulis seperti di aplikasi (Bahasa Inggris), dengan label Bahasa Indonesia di dalam kurung bila ada.', '');
groups.forEach((g) => {
  p(`### ${g.label}`, '');
  g.tabs.forEach((t) => {
    const c = C.TABS[t.id];
    const docKey = docKeyFor(t);
    const rs = routesOf(t.id);
    p(`<a id="${tabAnchor(t)}"></a>`, `#### ${t.label}`, '');
    p(`- **Untuk apa**: ${c ? c.summary : '_(belum ada ringkasan di docs/content.js)_'}`);
    if (docKey && tr(docKey)) p(`- **Penjelasan sederhana**: ${clean(tr(docKey))}`);
    p(`- **Data yang dibaca**: ${c ? c.datasets : '_(belum diisi)_'}`);
    p(`- **Cara hitung**: ${c ? c.computation : '_(belum diisi)_'}`);
    renderDetails(t);
    const bq = [...new Set(rs.flatMap((r) => r.bq))].sort();
    const supa = [...new Set(rs.flatMap((r) => r.supa))].sort();
    const builders = [...new Set(rs.flatMap((r) => r.builders))].filter((b) => typeof Q[b] === 'function' && b !== 'normalizeUserFilter').sort();
    p(`- **Detail teknis** (otomatis dari kode):`);
    p(`  - Id tab untuk hak akses: ${code(t.id)}`);
    if (rs.length) p(`  - Endpoint: ${rs.map((r) => code(`${r.method} ${r.path}`)).join(', ')}`);
    if (builders.length) p(`  - Fungsi query (${code('server/queries.js')}): ${builders.map(code).join(', ')}`);
    if (bq.length) p(`  - Tabel BigQuery yang disentuh: ${bq.map((x) => code(x.replace(/^sayakaya\./, ''))).join(', ')}`);
    if (supa.length) p(`  - Tabel Supabase: ${supa.map(code).join(', ')}`);
    if (!rs.length) p('  - Tidak punya endpoint sendiri (konten statis atau memakai endpoint bersama di bagian 8).');
    p('');
  });
});

p('## 7. Deploy dan pemeliharaan', '');
p('### 7.1 Situs live', '');
p('- **Halaman**: GitHub Pages dari repo `kukuh-haryobismoko/sayakaya-analytics`, terbit otomatis setiap push ke `main` yang mengubah `public/`.');
p('- **Backend**: Supabase Edge Function `api` (project `josptpfisrsdjeggkqke`). Tidak deploy otomatis; dijalankan oleh `deploy all`.');
p('- **Repo kantor** (`kukuh-sayakaya/sayakaya-analytics`) menerima push yang sama sebagai salinan.', '');
p('### 7.2 Deploy all', '');
p(`Satu perintah, ${code('npm run deploy:all')} (${code('scripts/deploy-all.sh')}), menjalankan berurutan:`, '');
p('1. Berhenti bila ada perubahan yang belum di-commit (selain dokumen ini), supaya yang di-deploy selalu kode yang sudah tercatat.');
p(`2. Membuat ulang dokumen ini (${code('npm run docs')}) dan meng-commit-nya bila berubah.`);
p(`3. Menjalankan semua tes (${code('npm test')}); deploy berhenti bila ada yang gagal.`);
p('4. Menerapkan migrasi Supabase yang belum ada di server (`supabase db push`), sebelum function baru yang mungkin membutuhkannya.');
p('5. Deploy Supabase Edge Function `api`.');
p('6. Push `main` ke kedua repo GitHub (masing-masing dengan akun `gh` miliknya), yang memicu terbitnya GitHub Pages.', '');
p('### 7.3 Menambah atau mengubah tab', '');
p('1. Tambah tombol di sidebar dan `<section>` di `public/index.html`, logika di `public/app.js`, teks EN dan ID di `public/i18n.js`.');
p('2. Tambah query di `server/queries.js` dan endpoint di `server/app.js`, lalu salin ke `supabase/functions/api/queries.ts` dan `index.ts` (SQL harus identik).');
p('3. Tambah entri tab di Documentation (`public/index.html`), di `docs/content.js` TABS (ringkasan, dataset, cara hitung), dan di TAB_DETAILS (narasi singkat per panel, kolom yang tidak jelas dari namanya, catatan penting). Generator memberi peringatan bila tab belum punya entri, atau bila judul panel dan label kolom di TAB_DETAILS sudah tidak ada di aplikasi. `node scripts/generate-docs.js --inventory` mencetak panel dan kolom setiap tab sebagai bahan.');
p('4. Tambah kasus di `test/render-smoke.js`, jalankan `npm test`, lalu `npm run deploy:all`.', '');

p('## 8. Lampiran: endpoint bersama', '');
p('Endpoint yang tidak terikat pada satu tab: login dan akun, admin, ekspor, jadwal, webhook, cron, dan pencarian yang dipakai beberapa tab.', '');
p('| Endpoint | Fungsi query | Tabel |', '|---|---|---|');
sharedRoutes.forEach((r) => {
  const builders = r.builders.filter((b) => typeof Q[b] === 'function');
  p(`| ${code(`${r.method} ${r.path}`)} | ${builders.map(code).join(', ') || '-'} | ${[...r.bq.map((x) => x.replace(/^sayakaya\./, '')), ...r.supa].map(code).join(', ') || '-'} |`);
});
p('');
if (warnings.length) {
  p('## Catatan untuk pengelola', '');
  p('Bagian berikut belum lengkap saat dokumen ini dibuat:', '');
  warnings.forEach((w) => p(`- ${w}`));
  p('');
}

const out = `${L.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
// A broken parse should stop a deploy rather than publish a hollow document.
const hollow = [
  [allTabs.length >= 10, `only ${allTabs.length} sidebar tabs found`],
  [allTabs.every((t) => out.includes(`<a id="${tabAnchor(t)}"></a>`)), 'a sidebar tab has no section'],
  [routes.length >= 50, `only ${routes.length} endpoints found`],
  [Object.keys(tableUse).length >= 10, `only ${Object.keys(tableUse).length} BigQuery tables found`],
].filter(([ok]) => !ok).map(([, why]) => why);
if (hollow.length) {
  console.error(`generate-docs: not writing DOKUMENTASI.md: ${hollow.join('; ')}`);
  process.exit(1);
}
const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
fs.writeFileSync(OUT, out);
console.log(`DOKUMENTASI.md ${before === out ? 'tidak berubah' : 'diperbarui'}: ${allTabs.length} tab, ${routes.length} endpoint, ${Object.keys(tableUse).length} tabel BigQuery.`);
warnings.forEach((w) => console.warn(`peringatan: ${w}`));
