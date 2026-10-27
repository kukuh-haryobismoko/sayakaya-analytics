// Functional user-behaviour suite: real browser clicks/typing against a stateful mock API (no BigQuery).
// Not part of `npm test`: needs Playwright, which is not a dependency. Run: npm i --no-save playwright && npx playwright install chromium && npm run test:e2e
// If the installed Chromium does not match Playwright, set CHROME=/path/to/chrome.
const path = require('path');
const REPO = path.join(__dirname, '..');
const express = require(path.join(REPO, 'node_modules/express'));
const { chromium } = require('playwright');
const PORT = 8098, URL = `http://localhost:${PORT}/`;

// ---- stateful mock backend ----
const U = {
  kukuh: { id: 1, username: 'kukuh', email: 'k@x.id', password: 'correct-horse', isSuperuser: true, allowedTabs: [], createdAt: '2026-01-01' },
  viewer: { id: 2, username: 'viewer', email: 'v@x.id', password: 'viewer-pass', isSuperuser: false, allowedTabs: ['overview'], createdAt: '2026-02-01' },
};
const pub = (u) => { const { password, ...r } = u; return r; };
let reqs = [], expireAll = false, adminUsers = [pub(U.kukuh), pub(U.viewer)], nextId = 3;
const app = express();
app.use(express.json());
app.use('/api', (req, res, next) => {
  reqs.push({ m: req.method, u: req.originalUrl, b: req.body });
  if (/^\/(auth\/(login|forgot-password|reset-password)|health)/.test(req.path)) return next();
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const user = Object.values(U).find((x) => 'tok-' + x.username === tok);
  if (!user || expireAll) return res.status(401).json({ error: 'Session expired' });
  req.user = user; next();
});
app.get('/api/health', (_q, r) => r.json({ bigquery: true, askEnabled: true }));
app.post('/api/auth/login', (q, r) => {
  const u = U[q.body.username];
  if (!u || u.password !== q.body.password) return r.status(401).json({ error: 'Incorrect username or password.' });
  r.json({ token: 'tok-' + u.username, user: pub(u) });
});
app.post('/api/auth/logout', (_q, r) => r.json({ ok: true }));
app.get('/api/auth/me', (q, r) => r.json({ user: pub(q.user) }));
app.post('/api/auth/forgot-password', (_q, r) => r.json({ message: 'If that account has an email on file, a reset link has been sent.' }));
app.post('/api/auth/reset-password', (q, r) => q.body.token === 'good' ? r.json({ ok: true }) : r.status(400).json({ error: 'Link expired.' }));
app.post('/api/auth/change-password', (q, r) => q.body.currentPassword === q.user.password ? r.json({ ok: true }) : r.status(400).json({ error: 'Current password is incorrect.' }));
app.get('/api/admin/users', (q, r) => q.user.isSuperuser ? r.json(adminUsers) : r.status(403).json({ error: 'Forbidden' }));
app.post('/api/admin/users', (q, r) => { adminUsers.push({ id: nextId++, username: q.body.username, email: q.body.email, isSuperuser: !!q.body.isSuperuser, allowedTabs: q.body.allowedTabs || [], createdAt: '2026-10-27' }); r.json({ ok: true }); });
app.delete('/api/admin/users/:id', (q, r) => { adminUsers = adminUsers.filter((u) => String(u.id) !== q.params.id); r.json({ ok: true }); });
app.get('/api/overview', (_q, r) => r.json({ platform_aum: 5e12, investing_users: 1200, total_users: 5000, verified_users: 4000, buy_volume: 1e10, buy_count: 300, sell_volume: 5e9, sell_count: 100, active_users: 400, total_tx: 900, active_funds: 20, total_funds: 30, new_users_30d: 150 }));
app.get('/api/users/search', (q, r) => r.json(q.query.q === 'nomatch' ? [] : [{ user_id: 'u1', sid: 'IDD1', name: 'Budi Santoso', email: 'budi@x.id', ifua: 'IF1' }]));
app.get('/api/portfolio', (_q, r) => r.json({ holdings: [], split: null, performance: null, history: [], recentTx: [], asOfDate: '2026-10-26', latestDate: '2026-10-26' }));
app.post('/api/sql/run', (q, r) => /bad/i.test(q.body.sql) ? r.status(400).json({ error: 'Syntax error near "bad"' }) : /empty/i.test(q.body.sql) ? r.json({ rows: [], count: 0 }) : r.json({ rows: [{ type: 'buy', n: 7 }, { type: 'sell', n: 3 }], count: 2 }));
app.post('/api/ask', (q, r) => /boom/.test(q.body.question) ? r.status(500).json({ error: 'Model down' }) : r.json({ sql: 'SELECT 1 AS n', rows: [{ n: 1 }], count: 1 }));
app.use('/api', (_q, r) => r.json([]));
app.use(express.static(path.join(REPO, 'public')));

// ---- harness ----
const results = [];
let browser;
const mk = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: o.vp || { width: 1440, height: 900 } });
  if (o.auth) await ctx.addInitScript((a) => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('sk_auth', JSON.stringify(a)); localStorage.setItem('__seeded', '1'); } }, o.auth);
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(URL + (o.qs || ''), { waitUntil: 'load' });
  p.ctx = ctx; return p;
};
const authOf = (n) => ({ token: 'tok-' + n, user: pub(U[n]) });
const T = async (name, fn) => {
  reqs = []; expireAll = false; adminUsers = [pub(U.kukuh), pub(U.viewer)];
  let p;
  try { p = await fn(); results.push({ name, ok: true, errs: p && p.errs && p.errs.length ? p.errs.slice(0, 2) : [] }); }
  catch (e) { results.push({ name, ok: false, why: String(e.message).split('\n')[0].slice(0, 200) }); }
  finally { if (p && p.ctx) await p.ctx.close().catch(() => {}); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const has = (s, sub, m) => { if (!String(s).includes(sub)) throw new Error(`${m}: ${JSON.stringify(String(s).slice(0, 80))} lacks ${JSON.stringify(sub)}`); };
const vis = (p, sel) => p.locator(sel).isVisible();
const login = async (p, u, pw) => { await p.fill('#gate-username', u); await p.fill('#gate-input', pw); await p.click('#gate-btn'); };
const nav = (p, tab) => p.evaluate((t) => document.querySelector(`.nav-link[data-tab="${t}"]`).click(), tab);
const wait = (p, ms = 500) => p.waitForTimeout(ms);

(async () => {
  const srv = app.listen(PORT);
  browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

  // ---- AUTH ----
  await T('auth: logged-out user sees login gate, no app', async () => { const p = await mk(); eq(await vis(p, '#gate-login'), true, 'gate'); eq(await vis(p, '#appShell'), false, 'shell'); return p; });
  await T('auth: empty submit shows validation message', async () => { const p = await mk(); await p.click('#gate-btn'); has(await p.textContent('#gate-err'), 'Enter a username', 'err'); return p; });
  await T('auth: wrong password shows server error, stays on gate', async () => { const p = await mk(); await login(p, 'kukuh', 'nope'); await wait(p); has(await p.textContent('#gate-err'), 'Incorrect', 'err'); eq(await vis(p, '#appShell'), false, 'shell'); return p; });
  await T('auth: correct login opens app, shows name+superuser, stores sk_auth', async () => { const p = await mk(); await login(p, 'kukuh', 'correct-horse'); await p.waitForSelector('#appShell:not(.hidden)'); has(await p.textContent('#userBadgeName'), 'kukuh (superuser)', 'badge'); eq(await p.evaluate(() => JSON.parse(localStorage.sk_auth).token), 'tok-kukuh', 'token'); return p; });
  await T('auth: Enter key submits login', async () => { const p = await mk(); await p.fill('#gate-username', 'kukuh'); await p.fill('#gate-input', 'correct-horse'); await p.press('#gate-input', 'Enter'); await p.waitForSelector('#appShell:not(.hidden)'); return p; });
  await T('auth: session survives reload', async () => { const p = await mk(); await login(p, 'kukuh', 'correct-horse'); await p.waitForSelector('#appShell:not(.hidden)'); await p.reload(); await p.waitForSelector('#appShell:not(.hidden)'); eq(await vis(p, '#gate'), false, 'gate'); return p; });
  await T('auth: logout returns to gate and clears sk_auth', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#logoutBtn'); await wait(p); eq(await vis(p, '#gate-login'), true, 'gate'); eq(await p.evaluate(() => localStorage.getItem('sk_auth')), null, 'sk_auth'); return p; });
  await T('auth: expired token (401) kicks user back to gate', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); expireAll = true; await p.click('#apply'); await wait(p, 800); eq(await vis(p, '#gate-login'), true, 'gate'); return p; });
  await T('forgot password: link -> empty msg -> submit shows generic msg -> cancel', async () => { const p = await mk(); await p.click('#gate-forgot-link'); eq(await vis(p, '#gate-forgot'), true, 'card'); await p.click('#forgot-submit-btn'); has(await p.textContent('#forgot-msg'), 'Enter your username', 'empty'); await p.fill('#forgot-username', 'kukuh'); await p.click('#forgot-submit-btn'); await wait(p); has(await p.textContent('#forgot-msg'), 'reset link has been sent', 'sent'); await p.click('#forgot-cancel-btn'); eq(await vis(p, '#gate-login'), true, 'back'); return p; });
  await T('reset link: mismatch error, then success returns to login', async () => { const p = await mk({ qs: '?reset=good' }); eq(await vis(p, '#gate-reset'), true, 'card'); await p.fill('#reset-password', 'abc12345'); await p.fill('#reset-password-confirm', 'zzz'); await p.click('#reset-submit-btn'); has(await p.textContent('#reset-err'), 'do not match', 'mismatch'); await p.fill('#reset-password-confirm', 'abc12345'); await p.click('#reset-submit-btn'); await wait(p, 700); eq(await vis(p, '#gate-login'), true, 'login'); return p; });
  await T('reset link: expired token shows server error', async () => { const p = await mk({ qs: '?reset=old' }); await p.fill('#reset-password', 'abc12345'); await p.fill('#reset-password-confirm', 'abc12345'); await p.click('#reset-submit-btn'); await wait(p); has(await p.textContent('#reset-err'), 'expired', 'err'); return p; });

  // ---- PERMISSIONS ----
  await T('permissions: limited user sees only allowed tabs + no admin group', async () => { const p = await mk({ auth: authOf('viewer') }); await p.waitForSelector('#appShell:not(.hidden)'); const shown = await p.$$eval('.nav-link[data-tab]:not(.hidden)', (e) => e.map((x) => x.dataset.tab).sort()); eq(shown.join(','), 'docs,overview', 'tabs'); eq(await vis(p, '#adminNavGroup'), false, 'admin'); eq(await vis(p, '#sqlUnredactRow'), false, 'unredact'); return p; });
  await T('permissions: superuser sees admin group and many tabs', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); eq(await vis(p, '#adminNavGroup'), true, 'admin'); const n = await p.$$eval('.nav-link[data-tab]:not(.hidden)', (e) => e.length); if (n < 40) throw new Error('only ' + n + ' tabs'); return p; });

  // ---- NAVIGATION / PREFERENCES ----
  await T('nav search: filters, shows empty msg, clear restores', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.fill('#navSearchInput', 'portfolio'); await wait(p, 200); const n = await p.$$eval('.nav-link[data-tab]:not(.nav-filtered):not(.hidden)', (e) => e.length); if (!(n > 0 && n < 20)) throw new Error('filtered count ' + n); await p.fill('#navSearchInput', 'zzzzqq'); await wait(p, 200); eq(await vis(p, '#navSearchEmpty'), true, 'empty msg'); await p.click('#navSearchClear'); await wait(p, 200); eq(await p.locator('#navSearchInput').inputValue(), '', 'cleared'); eq(await vis(p, '#navSearchEmpty'), false, 'empty gone'); return p; });
  await T('nav search: "/" focuses the box', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.locator('body').click({ position: { x: 900, y: 500 } }); await p.keyboard.press('/'); eq(await p.evaluate(() => document.activeElement.id), 'navSearchInput', 'focus'); return p; });
  await T('tabs: clicking a nav link activates that view only', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'sql'); await wait(p, 300); eq(await p.$$eval('.view.active', (e) => e.map((x) => x.id).join()), 'sql', 'active view'); return p; });
  await T('language: toggle to ID translates UI text, persists on reload', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); const q = '#navSearchInput'; const before = await p.getAttribute(q, 'placeholder'); await p.click('#langSeg [data-lang="id"]'); await wait(p, 200); const after = await p.getAttribute(q, 'placeholder'); if (before === after) throw new Error('placeholder unchanged: ' + after); eq(await p.evaluate(() => document.documentElement.lang), 'id', 'html lang'); await p.reload(); await p.waitForSelector('#appShell:not(.hidden)'); eq(await p.evaluate(() => localStorage.getItem('sk_lang')), 'id', 'persisted'); eq(await p.getAttribute(q, 'placeholder'), after, 'after reload'); return p; });
  await T('language: logout resets language to English', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#langSeg [data-lang="id"]'); await p.click('#logoutBtn'); await wait(p); await login(p, 'kukuh', 'correct-horse'); await p.waitForSelector('#appShell:not(.hidden)'); eq(await p.evaluate(() => document.querySelector('#langSeg .on, #langSeg .active')?.dataset.lang), 'en', 'lang'); return p; });
  await T('theme: dark toggle sets data-theme and persists', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#themeSeg [data-theme-choice="dark"]'); eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark', 'dark'); await p.reload(); await p.waitForSelector('#appShell:not(.hidden)'); eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark', 'after reload'); await p.click('#themeSeg [data-theme-choice="light"]'); eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', 'light'); return p; });
  await T('sidebar: desktop hamburger collapses and persists', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#navToggle'); eq(await p.evaluate(() => document.getElementById('appShell').classList.contains('sidebar-collapsed')), true, 'collapsed'); await p.reload(); await p.waitForSelector('#appShell:not(.hidden)'); eq(await p.evaluate(() => document.getElementById('appShell').classList.contains('sidebar-collapsed')), true, 'persisted'); return p; });
  await T('mobile: hamburger opens drawer, backdrop tap closes', async () => { const p = await mk({ auth: authOf('kukuh'), vp: { width: 390, height: 800 } }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#navToggle'); eq(await p.evaluate(() => document.getElementById('appShell').classList.contains('nav-open')), true, 'open'); await p.mouse.click(380, 400); await wait(p, 200); eq(await p.evaluate(() => document.getElementById('appShell').classList.contains('nav-open')), false, 'closed'); return p; });

  // ---- FEATURES ----
  await T('overview: KPI cards render from API data', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#kpis .kpi, #kpis [class*=kpi]'); await wait(p, 600); const t = await p.textContent('#kpis'); has(t, 'Rp', 'currency'); has(t, '1,200', 'investors'); return p; });
  await T('overview: Apply sends the chosen From/To range', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.fill('#from', '2026-03-01'); await p.fill('#to', '2026-03-31'); reqs = []; await p.click('#apply'); await wait(p, 800); const hit = reqs.find((r) => r.u.startsWith('/api/overview') && r.u.includes('from=2026-03-01') && r.u.includes('to=2026-03-31')); if (!hit) throw new Error('no /api/overview with range; saw ' + reqs.slice(0, 4).map((r) => r.u).join(' | ')); return p; });
  await T('portfolio: search -> results -> click opens investor detail', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'portfolio'); await p.fill('#pfSearchInput', 'budi'); await p.press('#pfSearchInput', 'Enter'); await p.waitForSelector('#pfResults .pf-row'); await p.click('#pfResults .pf-row'); await p.waitForSelector('#pfDetail:not(.hidden)'); has(await p.textContent('#pfUserName'), 'Budi Santoso', 'name'); if (!reqs.some((r) => r.u.startsWith('/api/portfolio?') && r.u.includes('userId=u1'))) throw new Error('no portfolio request'); return p; });
  await T('portfolio: no match shows empty message', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'portfolio'); await p.fill('#pfSearchInput', 'nomatch'); await p.click('#pfSearchBtn'); await p.waitForSelector('#pfResults .empty'); return p; });
  await T('sql: run shows table + row count + enables CSV', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'sql'); await p.fill('#sqlInput', 'SELECT type, n FROM t'); await p.click('#sqlRun'); await p.waitForSelector('#sqlResult table'); has(await p.textContent('#sqlMsg'), '2 rows', 'count'); eq(await p.locator('#sqlCsv').isDisabled(), false, 'csv'); return p; });
  await T('sql: server error shown in message, no table', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'sql'); await p.fill('#sqlInput', 'SELECT bad'); await p.click('#sqlRun'); await wait(p, 500); has(await p.textContent('#sqlMsg'), 'Syntax error', 'msg'); eq(await p.locator('#sqlResult table').count(), 0, 'table'); return p; });
  await T('sql: zero rows keeps CSV disabled', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'sql'); await p.fill('#sqlInput', 'SELECT empty'); await p.click('#sqlRun'); await wait(p, 500); eq(await p.locator('#sqlCsv').isDisabled(), true, 'csv'); return p; });
  await T('ask: question returns SQL + result table', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'ask'); await p.fill('#askInput', 'how many users'); await p.click('#askBtn'); await p.waitForSelector('#askResult table', { state: 'attached' }); has(await p.inputValue('#askSqlText'), 'SELECT 1', 'sql'); return p; });
  await T('ask: failed request restores typed question + shows error', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'ask'); await p.fill('#askInput', 'boom now'); await p.click('#askBtn'); await wait(p, 600); eq(await p.inputValue('#askInput'), 'boom now', 'restored'); eq(await p.locator('#askBtn').isDisabled(), false, 're-enabled'); return p; });
  await T('change password: validation, wrong current, success closes panel', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#changePwBtn'); await p.click('#changePwSave'); has(await p.textContent('#changePwErr'), 'required', 'req'); await p.fill('#changePwCurrent', 'wrong'); await p.fill('#changePwNew', 'new-pass-1'); await p.fill('#changePwConfirm', 'other'); await p.click('#changePwSave'); has(await p.textContent('#changePwErr'), "don't match", 'mismatch'); await p.fill('#changePwConfirm', 'new-pass-1'); await p.click('#changePwSave'); await wait(p, 400); has(await p.textContent('#changePwErr'), 'incorrect', 'wrong current'); await p.fill('#changePwCurrent', 'correct-horse'); await p.click('#changePwSave'); await wait(p, 500); eq(await vis(p, '#changePwPanel'), false, 'closed'); return p; });
  await T('change password: eye toggle reveals field', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await p.click('#changePwBtn'); await p.locator('.pw-toggle').first().click(); const ty = await p.evaluate(() => document.querySelector('.pw-toggle').dataset.for && document.getElementById(document.querySelector('.pw-toggle').dataset.for).type); eq(ty, 'text', 'type'); return p; });
  await T('admin: users list renders both accounts', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'admin'); await p.waitForSelector('#adminUsersTable table'); const t = await p.textContent('#adminUsersTable'); has(t, 'kukuh', 'u1'); has(t, 'viewer', 'u2'); return p; });
  await T('admin: add user without email is rejected; with email POSTs and lists', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'admin'); await p.waitForSelector('#adminUsersTable table'); await p.click('#adminAddUserBtn'); await p.click('#adminSaveBtn'); has(await p.textContent('#adminFormErr'), 'Email is required', 'err'); await p.fill('#adminEmail', 'new@x.id'); await p.fill('#adminUsername', 'newbie'); await p.click('#adminSaveBtn'); await wait(p, 700); const post = reqs.find((r) => r.m === 'POST' && r.u === '/api/admin/users'); if (!post || post.b.email !== 'new@x.id') throw new Error('no POST'); has(await p.textContent('#adminUsersTable'), 'newbie', 'listed'); return p; });
  await T('admin: delete user via row menu removes row', async () => { const p = await mk({ auth: authOf('kukuh') }); await p.waitForSelector('#appShell:not(.hidden)'); await nav(p, 'admin'); await p.waitForSelector('#adminUsersTable table'); await p.click('[data-row-menu="2"]'); await p.click('[data-delete="2"]'); await wait(p, 800); if (!reqs.some((r) => r.m === 'DELETE' && r.u === '/api/admin/users/2')) throw new Error('no DELETE'); eq((await p.textContent('#adminUsersTable')).includes('viewer'), false, 'row gone'); return p; });

  await browser.close(); srv.close();
  const pass = results.filter((r) => r.ok).length;
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? (r.errs.length ? '   [pageerror: ' + r.errs.join(' || ') + ']' : '') : '\n       -> ' + r.why));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
