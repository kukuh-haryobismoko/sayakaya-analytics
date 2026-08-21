// Ported from server/app.js. Supabase Edge Functions don't run Express, so
// the routing itself is re-architected around Deno.serve() + URLPattern —
// every individual route's logic (query building, response shape, error
// handling) is otherwise unchanged from server/app.js.
import { runQuery, dryRun, validateAdHoc, capRows, PROJECT_ID, MAX_BYTES_BILLED } from './bigquery.ts';
import * as Q from './queries.ts';
import { toCsv, toTxt, toXlsxBuffer, toXlsxMultiSheet } from './export.ts';
import { ask, askEnabled, TABLES, suggestChart } from './ask.ts';
import * as EX from './explore.ts';
import * as ML from './ml.ts';
import { portfolioReport } from './pdf.ts';
import * as A from './auth.ts';

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];

// Every export `source` maps to exactly one tab — mirrors server/app.js.
const EXPORT_SOURCE_TAB: Record<string, string> = {
  sql: 'sql',
  ask_result: 'ask',
  growth_top_funds: 'growth',
  transactions: 'remisier-tx',
  churn_risk: 'predict',
  aum_history: 'aum',
  product_performance: 'performance',
  product_performance_detail: 'performance',
  portfolio_full: 'portfolio',
  portfolio_explorer_full: 'portfolio-explorer',
  portfolio_fix_full: 'portfolio-fix',
  portfolio_tx_full: 'portfolio-tx',
  portfolio_sinvest_full: 'portfolio-sinvest',
  explore: 'explorer',
  campaigns_performance: 'growth',
  switching_pairs: 'growth',
  referrals_top: 'growth',
  reconciliation: 'reconciliation',
  revenue_detail: 'revenue',
  revenue_summary: 'revenue',
  revenue_v2_detail: 'revenue2',
  revenue_v2_summary: 'revenue2',
  user_lifetime_users: 'user-lifetime',
  user_lifetime_detail: 'user-lifetime',
  user_lifetime_summary: 'user-lifetime',
  campaign_revenue_detail: 'campaign-revenue',
  campaign_revenue_campaigns: 'campaign-revenue',
  campaign_revenue_summary: 'campaign-revenue',
  remisier_revenue_detail: 'remisier',
  remisier_revenue_summary: 'remisier',
  remisier_revenue_pwc_detail: 'remisier-pwc',
  remisier_revenue_pwc_summary: 'remisier-pwc',
  remisier_transactions: 'remisier-tx',
  sinvest_transactions: 'sinvest-tx',
  hnwi_total: 'hnwi',
  hnwi_by_fund: 'hnwi',
};

// Pivot flat (type, name, period, pct_change) rows into one fund-per-row
// table per fund type — used for the per-type Excel sheets.
function pivotPerformanceByType(rows: Record<string, unknown>[]) {
  const byType: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const r of rows) {
    const type = (r.type as string) || '(none)';
    const byFund = (byType[type] = byType[type] || {});
    const name = r.name as string;
    const fund = (byFund[name] = byFund[name] || { Fund: r.name, NAV: r.latest_nav });
    fund[r.period as string] = r.pct_change;
  }
  return Object.keys(byType).sort().map((type) => ({
    name: type,
    rows: Object.values(byType[type]).map((f) => {
      const out: Record<string, unknown> = { Fund: f.Fund, NAV: f.NAV };
      for (const p of PERF_PERIODS) out[p] = f[p] ?? null;
      return out;
    }),
    pctCols: PERF_PERIODS,
  }));
}

// Splits flat detail rows into one worksheet per distinct value of keyField —
// used for the revenue exports' "one sheet per fund/MI" option.
function splitRowsBySheet(rows: Record<string, unknown>[], keyField: string) {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const r of rows) {
    const key = (r[keyField] as string) || '(none)';
    (groups[key] = groups[key] || []).push(r);
  }
  return Object.keys(groups).sort().map((name) => ({ name, rows: groups[name] }));
}

// Friendly column names for the "Portfolio" sheet in the combined export.
function portfolioSheetRows(holdings: Record<string, unknown>[]) {
  return holdings.map((h) => ({
    Fund: h.fund, Type: h.fund_type,
    'Unit Balance': h.unit, 'Average NAV': h.avg_buy_price, 'Close NAV': h.nav,
    'Fund Value': h.fund_value, 'Market Value': h.value,
    'Unrealized Gain/Loss': h.gain_loss, '%': h.gain_pct, Opened: h.opened_at,
  }));
}

// ---- Response helpers -----------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  // The export routes watermark the filename into Content-Disposition, which
  // browsers otherwise hide from cross-origin fetch() responses (this is the
  // cross-origin path — GitHub Pages calling this function).
  'access-control-expose-headers': 'Content-Disposition',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

// Every exported file is remarked with the requesting user: appended to the
// filename, and (for xlsx) written into the file's own "last modified by"
// document property — mirrors server/app.js's filenameWithUser.
function filenameWithUser(name: string, username: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  return `${name}_${username}_${ts}`;
}

function csvResponse(rows: Record<string, unknown>[], name: string, username: string): Response {
  return new Response('﻿' + toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filenameWithUser(name, username)}.csv"`,
    },
  });
}

function txtResponse(rows: Record<string, unknown>[], name: string, username: string): Response {
  return new Response('﻿' + toTxt(rows, '|'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${filenameWithUser(name, username)}.txt"`,
    },
  });
}

async function xlsxResponse(rows: Record<string, unknown>[], name: string, username: string, pctCols: string[] = []): Promise<Response> {
  const buf = await toXlsxBuffer(rows, name, pctCols, username);
  return new Response(buf, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filenameWithUser(name, username)}.xlsx"`,
    },
  });
}

async function xlsxMultiResponse(sheets: { name: string; rows: Record<string, unknown>[]; pctCols?: string[] }[], name: string, username: string): Promise<Response> {
  const buf = await toXlsxMultiSheet(sheets, username);
  return new Response(buf, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filenameWithUser(name, username)}.xlsx"`,
    },
  });
}

// ---- Tiny router ------------------------------------------------------------
// The 4th arg is the authenticated user (null only for /api/health and
// /api/auth/login, the two routes that skip the auth check below) — handlers
// that don't need it can simply omit it from their signature.
type Handler = (req: Request, params: Record<string, string>, url: URL, user: A.DashboardUser | null) => Promise<Response> | Response;
interface Route { method: string; pattern: URLPattern; handler: Handler }
const routes: Route[] = [];
function on(method: string, pathname: string, handler: Handler) {
  routes.push({ method, pattern: new URLPattern({ pathname }), handler });
}

// Per-tab access control — superuser always passes; everyone else needs the
// tab in their allowed_tabs. Mirrors requireTab in server/app.js.
function requireTab(tab: string, handler: Handler): Handler {
  return (req, params, url, user) => {
    if (!A.userCan(user, tab)) return json({ error: `You do not have access to this section (${tab}).` }, 403);
    return handler(req, params, url, user);
  };
}
// A route two tabs both legitimately use (e.g. the shared investor search) —
// allowed if the caller has at least one of them.
function requireAnyTab(tabs: string[], handler: Handler): Handler {
  return (req, params, url, user) => {
    if (!tabs.some((t) => A.userCan(user, t))) return json({ error: 'You do not have access to this section.' }, 403);
    return handler(req, params, url, user);
  };
}
function requireSuperuser(handler: Handler): Handler {
  return (req, params, url, user) => {
    if (!user?.is_superuser) return json({ error: 'Superuser access required.' }, 403);
    return handler(req, params, url, user);
  };
}

function qp(url: URL, name: string): string | undefined {
  return url.searchParams.get(name) ?? undefined;
}
function qpAll(url: URL, name: string): string[] {
  return url.searchParams.getAll(name);
}
async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) || {};
  } catch {
    return {};
  }
}

// ---- Health -----------------------------------------------------------
// Pings BigQuery with a trivial query (no table scan, no cost) so the UI
// can show a live/down connection indicator instead of just "the API server
// itself responded".
on('GET', '/api/health', async () => {
  let bigquery = true;
  try {
    await Promise.race([
      runQuery('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
  } catch {
    bigquery = false;
  }
  return json({ ok: true, project: PROJECT_ID, bigquery, askEnabled: askEnabled() });
});

// ---- Auth: login/logout/me --------------------------------------------
// Login is the one route not gated by the auth check below (it's how you get
// a token in the first place).
on('POST', '/api/auth/login', async (req) => {
  const body = await bodyOf(req);
  const username = body.username as string;
  const password = body.password as string;
  if (!username || !password) return json({ error: 'Username and password are required.' }, 400);
  const user = await A.findUserByUsername(username);
  if (!user || !A.verifyPassword(password, user.password_hash)) {
    await A.logEvent(user ? user.id : null, username, 'login_failure');
    return json({ error: 'Incorrect username or password.' }, 401);
  }
  const token = await A.createSession(user.id);
  await A.logEvent(user.id, user.username, 'login_success');
  return json({ token, user: A.publicUser(user) });
});

on('POST', '/api/auth/logout', async (req) => {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  await A.deleteSessionByToken(token);
  return json({ ok: true });
});

on('GET', '/api/auth/me', (_req, _params, _url, user) => json({ user: A.publicUser(user!) }));

// ---- Admin: manage dashboard accounts (superuser only) --------------------
on('GET', '/api/admin/users', requireSuperuser(async () => {
  const rows = await A.listUsers();
  return json(rows.map((r) => A.publicUser({ ...r, password_hash: '' })));
}));

on('POST', '/api/admin/users', requireSuperuser(async (req, _params, _url, user) => {
  const body = await bodyOf(req);
  const username = body.username as string;
  const password = body.password as string;
  if (!username || !password) return json({ error: 'Username and password are required.' }, 400);
  const existing = await A.findUserByUsername(username);
  if (existing) return json({ error: 'That username is already taken.' }, 409);
  const created = await A.createUser({
    username, password,
    isSuperuser: !!body.isSuperuser,
    allowedTabs: (body.allowedTabs as string[]) || [],
  });
  await A.logEvent(user!.id, user!.username, 'admin_user_create',
    `created dashboard user "${username}"${body.isSuperuser ? ' (superuser)' : ''}`);
  return json(A.publicUser(created));
}));

on('PATCH', '/api/admin/users/:id', requireSuperuser(async (req, params, _url, user) => {
  const target = await A.findUserById(params.id);
  if (!target) return json({ error: 'User not found.' }, 404);
  const body = await bodyOf(req);
  // Lockout guard: refuse to demote the last remaining superuser.
  if (target.is_superuser && body.isSuperuser === false && (await A.countSuperusers()) <= 1) {
    return json({ error: 'Cannot remove the last remaining superuser.' }, 400);
  }
  const updated = await A.updateUser(params.id, {
    password: body.password as string | undefined,
    isSuperuser: body.isSuperuser as boolean | undefined,
    allowedTabs: body.allowedTabs as string[] | undefined,
  });
  const changes: string[] = [];
  if (body.password) changes.push('password reset');
  if (body.isSuperuser !== undefined) changes.push(`superuser=${body.isSuperuser}`);
  if (body.allowedTabs !== undefined) changes.push(`tabs=[${((body.allowedTabs as string[]) || []).join(',')}]`);
  await A.logEvent(user!.id, user!.username, 'admin_user_update',
    `updated "${target.username}": ${changes.join(', ') || 'no changes'}`);
  return json(A.publicUser(updated));
}));

on('DELETE', '/api/admin/users/:id', requireSuperuser(async (_req, params, _url, user) => {
  const target = await A.findUserById(params.id);
  if (!target) return json({ error: 'User not found.' }, 404);
  if (target.is_superuser && (await A.countSuperusers()) <= 1) {
    return json({ error: 'Cannot delete the last remaining superuser.' }, 400);
  }
  await A.deleteUser(params.id);
  await A.logEvent(user!.id, user!.username, 'admin_user_delete', `deleted dashboard user "${target.username}"`);
  return json({ ok: true });
}));

on('GET', '/api/admin/audit-log', requireSuperuser(async (_req, _params, url) => {
  const rows = await A.listAuditLog({
    limit: Number(qp(url, 'limit')) || undefined,
    search: qp(url, 'search'),
    from: qp(url, 'from'),
    to: qp(url, 'to'),
    user: qp(url, 'user'),
  });
  return json(rows);
}));

// ---- Auth: change your own password ---------------------------------------
// Requires the current password (not just a valid session) so a hijacked-but-
// still-valid token can't lock the real owner out permanently.
on('POST', '/api/auth/change-password', async (req, _params, _url, user) => {
  const body = await bodyOf(req);
  const currentPassword = body.currentPassword as string;
  const newPassword = body.newPassword as string;
  if (!currentPassword || !newPassword) return json({ error: 'Current and new password are required.' }, 400);
  if (!A.verifyPassword(currentPassword, user!.password_hash)) {
    // 400, not 401 — the session itself is still valid, only the typed
    // password is wrong. The frontend's api() helper force-logs-out on any
    // 401, which a wrong-current-password typo must not trigger.
    return json({ error: 'Current password is incorrect.' }, 400);
  }
  await A.updateUser(user!.id, { password: newPassword });
  await A.logEvent(user!.id, user!.username, 'password_change');
  return json({ ok: true });
});

// ---- Overview (KPIs) ------------------------------------------------------
on('GET', '/api/overview', requireTab('overview', async (_req, _params, url) => {
  const from = qp(url, 'from'); const to = qp(url, 'to');
  const [users, aum, tx, funds] = await Promise.all([
    runQuery(Q.overviewUsers().sql, Q.overviewUsers().params),
    runQuery(Q.overviewAum().sql, Q.overviewAum().params),
    runQuery(Q.overviewTx(from, to).sql, Q.overviewTx(from, to).params),
    runQuery(Q.overviewFunds().sql, Q.overviewFunds().params),
  ]);
  return json({ ...users[0], ...aum[0], ...tx[0], ...funds[0] });
}));

// ---- Trends ---------------------------------------------------------------
on('GET', '/api/trends', requireTab('overview', async (_req, _params, url) => {
  const q = Q.trends(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Breakdowns -----------------------------------------------------------
on('GET', '/api/breakdown/:dimension', requireTab('overview', async (_req, params, url) => {
  const q = Q.breakdownBy(params.dimension, qp(url, 'from'), qp(url, 'to'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Funds ------------------------------------------------------------
// Largest funds/MI by AUM, as of a date, from portfolio_with_code -------
on('GET', '/api/funds/top/latest-date', requireTab('overview', async () => {
  const d = Q.largestFundsLatestDate();
  const [row] = await runQuery(d.sql, d.params);
  return json({ latestDate: (row?.latest_date as string) || null });
}));
on('GET', '/api/funds/top', requireTab('overview', async (_req, _params, url) => {
  const date = qp(url, 'date');
  if (!date) return json({ error: 'date is required.' }, 400);
  const excludeFunds = qp(url, 'excludeFunds');
  const exclude = excludeFunds ? excludeFunds.split(',').filter(Boolean) : [];
  const q = Q.largestFundsAum(qp(url, 'groupBy') || 'fund', date, exclude);
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/funds/types', requireAnyTab(['overview', 'performance'], async () => {
  const q = Q.fundTypes();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/funds/list', requireTab('performance', async (_req, _params, url) => {
  const q = Q.fundList(qp(url, 'type'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Users ----------------------------------------------------------------
on('GET', '/api/users/growth', requireTab('overview', async () => {
  const q = Q.userGrowth();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/users/verification', requireTab('overview', async () => {
  const q = Q.verificationBreakdown();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/users/by-province', requireTab('overview', async () => {
  const q = Q.usersByProvince();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/users/top-cities', requireTab('overview', async (_req, _params, url) => {
  const q = Q.topCitiesByInvestors(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/users/top-cities-aum', requireTab('overview', async (_req, _params, url) => {
  const q = Q.topCitiesByAum(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Transactions explorer ------------------------------------------------
on('GET', '/api/transactions/filters', requireTab('remisier-tx', async () => {
  const q = Q.txFilterValues();
  const rows = await runQuery(q.sql, q.params);
  return json(rows[0] || { types: [], statuses: [] });
}));
on('GET', '/api/transactions', requireTab('remisier-tx', async (_req, _params, url) => {
  const q = Q.transactions({
    from: qp(url, 'from'), to: qp(url, 'to'), type: qp(url, 'type'), status: qp(url, 'status'),
    search: qp(url, 'search'), limit: qp(url, 'limit') ?? 50, offset: qp(url, 'offset') ?? 0,
  });
  const [rows, countRows] = await Promise.all([
    runQuery(q.sql, q.params),
    runQuery(q.countSql!, q.params),
  ]);
  return json({ rows, total: Number(countRows[0]?.total || 0) });
}));

// ---- SInvest transactions (raw KSEI/SInvest custodian feed, paged) --------
on('GET', '/api/sinvest-transactions', requireTab('sinvest-tx', async (_req, _params, url) => {
  const q = Q.sinvestTransactions({
    from: qp(url, 'from'), to: qp(url, 'to'),
    type: qp(url, 'type'), sid: qp(url, 'sid'), search: qp(url, 'search'),
    limit: qp(url, 'limit') || 50, offset: qp(url, 'offset') || 0,
  });
  const [rows, countRows] = await Promise.all([
    runQuery(q.sql, q.params),
    runQuery(q.countSql!, q.params),
  ]);
  return json({ rows, total: Number(countRows[0]?.total || 0) });
}));

// ---- AUM history (mi_fee_logs.mi_fee) -------------------------------------
on('GET', '/api/aum-history', requireTab('aum', async (_req, _params, url) => {
  const q = Q.aumHistory(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- User portfolio lookup (search by SID, print one user's portfolio) ----
on('GET', '/api/users/search', requireAnyTab(['portfolio', 'portfolio-explorer', 'portfolio-fix', 'portfolio-tx', 'portfolio-sinvest'], async (_req, _params, url) => {
  const q = Q.userSearch(qp(url, 'q'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/portfolio', requireTab('portfolio', async (_req, _params, url, user) => {
  const userId = qp(url, 'userId'); const sid = qp(url, 'sid');
  if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
  const date = qp(url, 'date');
  const d = Q.userHoldingsLatestDate(sid);
  const h = date ? Q.userHoldingsAsOf(sid, date) : Q.userHoldings(userId);
  const s = Q.userPortfolioSplit(userId);
  const p = Q.userPerformance(sid);
  const a = Q.userAumHistory(sid);
  const [dRows, holdings, splitRows, performance, history] = await Promise.all([
    runQuery(d.sql, d.params),
    runQuery(h.sql, h.params),
    runQuery(s.sql, s.params),
    runQuery(p.sql, p.params),
    runQuery(a.sql, a.params),
  ]);
  const latestDate = (dRows[0]?.latest_date as string) || null;
  // A named individual's holdings, not aggregate BigQuery analytics — worth
  // its own audit trail entry (who looked up which investor, and when).
  await A.logEvent(user!.id, user!.username, 'view_portfolio', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  // Regular/bonus split is always current-live (portfolios/bonus_portfolios
  // don't have history), so it doesn't make sense to show it as if it were
  // "as of" a past date — omit it in that mode rather than show a misleading number.
  return json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null, latestDate });
}));

// ---- Portfolio (Fix): same as Portfolio (PWC) above, but the as-of-date
// snapshot is read from portfolio_fix instead of portfolio_with_code (see
// userHoldingsAsOfFix in queries.ts for why). Live (no date) holdings are
// identical to Portfolio (PWC) — both read the same real-time userHoldings().
on('GET', '/api/portfolio-fix', requireTab('portfolio-fix', async (_req, _params, url, user) => {
  const userId = qp(url, 'userId'); const sid = qp(url, 'sid');
  if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
  const date = qp(url, 'date');
  const d = Q.userHoldingsLatestDateFix(sid);
  const h = date ? Q.userHoldingsAsOfFix(sid, date) : Q.userHoldings(userId);
  const s = Q.userPortfolioSplit(userId);
  const p = Q.userPerformanceFix(sid);
  const a = Q.userAumHistoryFix(sid);
  const [dRows, holdings, splitRows, performance, history] = await Promise.all([
    runQuery(d.sql, d.params),
    runQuery(h.sql, h.params),
    runQuery(s.sql, s.params),
    runQuery(p.sql, p.params),
    runQuery(a.sql, a.params),
  ]);
  const latestDate = (dRows[0]?.latest_date as string) || null;
  await A.logEvent(user!.id, user!.username, 'view_portfolio_fix', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  return json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null, latestDate });
}));

// ---- Portfolio (TX): holdings with avg_buy_price computed straight from
// the transaction ledger (see userHoldingsFromTx in queries.ts) instead of
// trusting portfolios.initial_price. An as-of-date reconstructs holdings
// purely from transactions up to that date (userHoldingsFromTxAsOf) — bonus
// units are excluded in that mode since bonus_portfolios has no history to
// reconstruct from (see its comment in queries.ts). AUM chart/performance
// reuse portfolio_fix, since that data (market value, not cost basis) was
// never wrong.
on('GET', '/api/portfolio-tx', requireTab('portfolio-tx', async (_req, _params, url, user) => {
  const userId = qp(url, 'userId'); const sid = qp(url, 'sid');
  if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
  const date = qp(url, 'date');
  const h = date ? Q.userHoldingsFromTxAsOf(userId, date) : Q.userHoldingsFromTx(userId);
  const s = Q.userPortfolioSplit(userId);
  const p = Q.userPerformanceFix(sid);
  const a = Q.userAumHistoryFix(sid);
  const [holdings, splitRows, performance, history] = await Promise.all([
    runQuery(h.sql, h.params),
    runQuery(s.sql, s.params),
    runQuery(p.sql, p.params),
    runQuery(a.sql, a.params),
  ]);
  await A.logEvent(user!.id, user!.username, 'view_portfolio_tx', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  return json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null });
}));

// ---- Portfolio (SInvest): same as Portfolio (TX), but holdings are built
// entirely from the custodian feed (sinvest.trx_history) instead of the
// app's own transactions table (see sinvestHoldings/sinvestHoldingsAsOf in
// queries.ts). split/performance/history still come from the app's own live
// state and portfolio_fix — those aren't sourced from sinvest.
on('GET', '/api/portfolio-sinvest', requireTab('portfolio-sinvest', async (_req, _params, url, user) => {
  const userId = qp(url, 'userId'); const sid = qp(url, 'sid');
  if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
  const date = qp(url, 'date');
  const h = date ? Q.sinvestHoldingsAsOf(sid, date) : Q.sinvestHoldings(sid);
  const s = Q.userPortfolioSplit(userId);
  const p = Q.userPerformanceFix(sid);
  const a = Q.userAumHistoryFix(sid);
  const [holdings, splitRows, performance, history] = await Promise.all([
    runQuery(h.sql, h.params),
    runQuery(s.sql, s.params),
    runQuery(p.sql, p.params),
    runQuery(a.sql, a.params),
  ]);
  await A.logEvent(user!.id, user!.username, 'view_portfolio_sinvest', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  return json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null });
}));

// ---- Portfolio Explorer (goal_snapshots, point-in-time by date) -----------
on('GET', '/api/portfolio-explorer', requireTab('portfolio-explorer', async (_req, _params, url, user) => {
  const userId = qp(url, 'userId');
  if (!userId) return json({ error: 'userId is required.' }, 400);
  // Always look up the latest available snapshot date, even when a specific
  // date was requested — the UI shows it alongside asOfDate so it's obvious
  // whether the picked date actually has data, and how it compares to "now".
  const d = Q.goalLatestSnapshotDate(userId);
  const [dRow] = await runQuery(d.sql, d.params);
  const latestDate = (dRow?.latest_date as string) || null;
  const asOfDate = qp(url, 'date') || latestDate || undefined;
  if (!asOfDate) return json({ asOfDate: null, latestDate: null, holdings: [], byGoal: [] });
  const h = Q.goalUserHoldings(userId, asOfDate);
  const b = Q.goalUserHoldingsByGoal(userId, asOfDate);
  const [holdings, byGoal] = await Promise.all([
    runQuery(h.sql, h.params),
    runQuery(b.sql, b.params),
  ]);
  await A.logEvent(user!.id, user!.username, 'view_portfolio', `SID ${qp(url, 'sid') || userId} as of ${asOfDate} (explorer)`);
  return json({ asOfDate, latestDate, holdings, byGoal });
}));

// ---- HNWI (High Net Worth Individual): investors above an AUM threshold, as
// of a date, from portfolio_with_code ---------------------------------------
on('GET', '/api/hnwi/latest-date', requireTab('hnwi', async () => {
  const d = Q.hnwiLatestDate();
  const [row] = await runQuery(d.sql, d.params);
  return json({ latestDate: row?.latest_date || null });
}));
on('GET', '/api/hnwi/total', requireTab('hnwi', async (_req, _params, url) => {
  const date = qp(url, 'date');
  if (!date) return json({ error: 'date is required.' }, 400);
  const q = Q.hnwiTotal(date, qp(url, 'minAum'), qp(url, 'maxAum'), qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/hnwi/by-fund', requireTab('hnwi', async (_req, _params, url) => {
  const date = qp(url, 'date');
  if (!date) return json({ error: 'date is required.' }, 400);
  const q = Q.hnwiByFund(date, qp(url, 'minAum'), qp(url, 'maxAum'), qp(url, 'minFundAum'), qp(url, 'maxFundAum'), qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Product performance (NAV % change per fund type) ----------------------
on('GET', '/api/product-performance', requireTab('performance', async () => {
  const q = Q.productPerformance();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/product-performance/detail', requireTab('performance', async () => {
  const q = Q.productPerformanceDetail();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/product-performance/trend', requireTab('performance', async (_req, _params, url) => {
  const q = Q.fundNavTrend({
    type: qp(url, 'type'), period: qp(url, 'period'), limit: qp(url, 'limit'),
    funds: qpAll(url, 'funds'),
  });
  return json(await runQuery(q.sql, q.params));
}));

// ---- Growth: campaigns, referrals, switching, manager/demographic AUM -----
on('GET', '/api/campaigns/performance', requireTab('growth', async (_req, _params, url) => {
  const q = Q.campaignPerformance(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/switching/top-pairs', requireTab('growth', async (_req, _params, url) => {
  const q = Q.switchingTopPairs(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/funds/by-manager', requireTab('growth', async (_req, _params, url) => {
  const q = Q.aumByManager(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/users/aum-by-risk', requireTab('growth', async () => {
  const q = Q.aumByRisk();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/users/aum-by-income', requireTab('growth', async () => {
  const q = Q.aumByIncome();
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/referrals/top', requireTab('growth', async (_req, _params, url) => {
  const q = Q.topReferrers(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Reconciliation: app ledger vs custodian (sinvest) feed ----------------
on('GET', '/api/reconciliation', requireTab('reconciliation', async (_req, _params, url) => {
  const q = Q.reconciliationDaily(qp(url, 'from'), qp(url, 'to'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Revenue: management fee earned per fund/period -------------------------
on('GET', '/api/revenue', requireTab('revenue', async (_req, _params, url) => {
  const q = Q.revenueDetail(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'fund'), qp(url, 'mi'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/revenue/summary', requireTab('revenue', async (_req, _params, url) => {
  const q = Q.revenueMonthlySummary(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'fund'), qp(url, 'mi'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Revenue v2: same as Revenue above, but AUM sourced from goal_snapshots
on('GET', '/api/revenue-v2', requireTab('revenue2', async (_req, _params, url) => {
  const q = Q.revenueV2Detail(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'fund'), qp(url, 'mi'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/revenue-v2/summary', requireTab('revenue2', async (_req, _params, url) => {
  const q = Q.revenueV2MonthlySummary(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'fund'), qp(url, 'mi'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- User lifetime: Revenue (PWC) math grouped per investor, plus the
// lifetime dates (registration / first buy / holding span) around it --------
on('GET', '/api/user-lifetime', requireTab('user-lifetime', async (_req, _params, url) => {
  const limit = Math.min(Number(qp(url, 'limit')) || 200, 2000);
  const q = Q.userLifetimeUsers(qp(url, 'from'), qp(url, 'to'), qp(url, 'fund'), qp(url, 'mi'), qp(url, 'sid'), limit);
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/user-lifetime/summary', requireTab('user-lifetime', async (_req, _params, url) => {
  const q = Q.userLifetimeSummary(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'fund'), qp(url, 'mi'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/user-lifetime/detail', requireTab('user-lifetime', async (_req, _params, url) => {
  const sid = qp(url, 'sid');
  if (!sid) return json({ error: 'sid is required.' }, 400);
  const q = Q.userLifetimeDetail(sid, qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'fund'), qp(url, 'mi'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Campaign revenue: management fee earned on promo-locked units --------
on('GET', '/api/campaign-revenue', requireTab('campaign-revenue', async (_req, _params, url) => {
  const q = Q.campaignRevenueDetail(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'promo'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/campaign-revenue/campaigns', requireTab('campaign-revenue', async (_req, _params, url) => {
  const q = Q.campaignRevenueByCampaign(qp(url, 'from'), qp(url, 'to'), qp(url, 'promo'));
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/campaign-revenue/summary', requireTab('campaign-revenue', async (_req, _params, url) => {
  const q = Q.campaignRevenueSummary(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), qp(url, 'promo'));
  return json(await runQuery(q.sql, q.params));
}));

// ---- Remisier sharing: management fee revenue for one remisier's users,
// from goal_snapshots, split as a portion of the AperD share -----------------
on('GET', '/api/remisier/users', requireAnyTab(['remisier', 'remisier-pwc'], async (_req, _params, url) => {
  const code = qp(url, 'code');
  if (!code) return json({ error: 'code is required.' }, 400);
  const q = Q.remisierUsers(qp(url, 'field') || '', code);
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/remisier/revenue', requireTab('remisier', async (_req, _params, url) => {
  const code = qp(url, 'code');
  if (!code) return json({ error: 'code is required.' }, 400);
  const portion = Number(qp(url, 'portion')) || 0;
  const q = Q.remisierRevenueDetail(qp(url, 'field') || '', code, qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), portion);
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/remisier/revenue/summary', requireTab('remisier', async (_req, _params, url) => {
  const code = qp(url, 'code');
  if (!code) return json({ error: 'code is required.' }, 400);
  const portion = Number(qp(url, 'portion')) || 0;
  const q = Q.remisierRevenueSummary(qp(url, 'field') || '', code, qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), portion);
  return json(await runQuery(q.sql, q.params));
}));
// ---- Remisier sharing (portfolio_with_code): same as above, AUM sourced
// from mi_fee_logs.portfolio_with_code instead of goal_snapshots ----------
on('GET', '/api/remisier/revenue-pwc', requireTab('remisier-pwc', async (_req, _params, url) => {
  const code = qp(url, 'code');
  if (!code) return json({ error: 'code is required.' }, 400);
  const portion = Number(qp(url, 'portion')) || 0;
  const q = Q.remisierRevenuePwcDetail(qp(url, 'field') || '', code, qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), portion);
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/remisier/revenue-pwc/summary', requireTab('remisier-pwc', async (_req, _params, url) => {
  const code = qp(url, 'code');
  if (!code) return json({ error: 'code is required.' }, 400);
  const portion = Number(qp(url, 'portion')) || 0;
  const q = Q.remisierRevenuePwcSummary(qp(url, 'field') || '', code, qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'), portion);
  return json(await runQuery(q.sql, q.params));
}));
on('GET', '/api/remisier/transactions', requireTab('remisier-tx', async (_req, _params, url) => {
  const referrerCodes = qpAll(url, 'referrerCodes');
  const salesCodes = qpAll(url, 'salesCodes');
  if (!referrerCodes.length && !salesCodes.length) return json({ error: 'At least one referrer_code or sales_code is required.' }, 400);
  const q = Q.remisierTransactions({
    referrerCodes, salesCodes,
    type: qp(url, 'type'), status: qp(url, 'status'),
    from: qp(url, 'from'), to: qp(url, 'to'),
    limit: qp(url, 'limit') || 100, offset: qp(url, 'offset') || 0,
  });
  const [rows, countRows] = await Promise.all([
    runQuery(q.sql, q.params),
    runQuery(q.countSql!, q.params),
  ]);
  return json({ rows, total: Number(countRows[0]?.total || 0) });
}));

// ---- Predictive models (BigQuery ML) --------------------------------------
on('GET', '/api/ml/status', requireTab('predict', async () => {
  try {
    const models = await ML.status();
    return json({ ready: models.length > 0, models });
  } catch {
    return json({ ready: false, models: [] }); // ml dataset not created yet
  }
}));
on('GET', '/api/predict/aum', requireTab('predict', async (_req, _params, url) => json(await ML.aumForecast(qp(url, 'horizon')))));
on('GET', '/api/predict/transactions', requireTab('predict', async (_req, _params, url) => json(await ML.txForecast(qp(url, 'horizon')))));
on('GET', '/api/predict/churn', requireTab('predict', async (_req, _params, url) => json(await ML.churnPredictions(qp(url, 'limit')))));
on('GET', '/api/churn/overview', requireTab('predict', async () => json(await ML.churnOverview())));
on('GET', '/api/retention/cohorts', requireTab('predict', async (_req, _params, url) => json(await ML.retentionCohorts(qp(url, 'months')))));
on('GET', '/api/retention/aum-cohorts', requireTab('predict', async (_req, _params, url) => json(await ML.aumRetentionCohorts(qp(url, 'months')))));

// ---- Generic multi-table explorer -----------------------------------------
on('GET', '/api/explore/_meta', requireTab('explorer', () => json(EX.meta())));

on('GET', '/api/explore/:dataset/filters/:filter', requireTab('explorer', async (_req, params) => {
  const sql = EX.filterValuesSql(params.dataset, params.filter);
  if (!sql) return json({ values: [] });
  const rows = await runQuery(sql, {});
  return json({ values: rows.map((r) => r.v).filter((v) => v !== null) });
}));

on('GET', '/api/explore/:dataset', requireTab('explorer', async (_req, params, url) => {
  const q: Record<string, string | undefined> = Object.fromEntries(url.searchParams.entries());
  const { sql, countSql, params: bqParams } = EX.buildExplore(params.dataset, q);
  const [rows, countRows] = await Promise.all([
    runQuery(sql, bqParams),
    runQuery(countSql, bqParams),
  ]);
  return json({ rows, total: Number(countRows[0]?.total || 0) });
}));

// ---- Ask (natural language -> SQL via Anthropic) --------------------------
on('GET', '/api/ask/tables', requireTab('ask', () => json({ tables: TABLES })));

on('POST', '/api/ask', requireTab('ask', async (req, _params, _url, user) => {
  const body = await bodyOf(req);
  const question = String(body.question || '').trim();
  const context = String(body.context || '').trim() || null;
  // Last few turns of this conversation, for follow-up questions ("now split
  // that by month") — capped so the prompt doesn't grow unbounded.
  const rawHistory = (body.history || []) as unknown[];
  const history = Array.isArray(rawHistory)
    ? rawHistory.filter((h): h is { question: string; sql: string } =>
        !!h && typeof (h as { question?: unknown }).question === 'string' && typeof (h as { sql?: unknown }).sql === 'string')
      .slice(-6)
    : [];
  if (!question) return json({ error: 'Type a question first.' }, 400);
  // Same step-up check as /api/sql/run: a superuser can lift column
  // redaction for one question, but only by re-proving their password on
  // this specific request.
  let redact = true;
  if (body.unredact) {
    if (!user!.is_superuser) return json({ error: 'Only a superuser can include restricted columns.' }, 403);
    if (!body.password || !A.verifyPassword(String(body.password), user!.password_hash)) {
      return json({ error: 'Incorrect password.' }, 401);
    }
    redact = false;
  }
  try {
    const { sql, rows } = await ask(question, context, history, user, { redact });
    await A.logEvent(user!.id, user!.username, 'ask', `${question} (${rows.length} rows)` + (redact ? '' : ' [unredacted]'));
    return json({ sql, rows, count: rows.length });
  } catch (err) {
    console.error('[POST /api/ask]', (err as Error).message);
    await A.logEvent(user!.id, user!.username, 'ask', `${question} — failed: ${(err as Error).message}`);
    return json({ error: (err as Error).message, sql: (err as { sql?: string }).sql || null }, 400);
  }
}));

on('POST', '/api/ask/chart', requireTab('ask', async (req) => {
  const body = await bodyOf(req);
  const { question, rows, hint } = body as { question?: string; rows?: Record<string, unknown>[]; hint?: string };
  return json(await suggestChart(question, rows || [], hint));
}));

// ---- SQL Lab --------------------------------------------------------------
on('POST', '/api/sql/estimate', requireTab('sql', async (req) => {
  const body = await bodyOf(req);
  const v = validateAdHoc(String(body.sql || ''));
  if (!v.ok) return json({ error: v.error }, 400);
  const { bytes } = await dryRun(capRows(v.sql, (body.limit as number) || 5000));
  return json({ bytes, withinLimit: bytes <= Number(MAX_BYTES_BILLED) });
}));

on('POST', '/api/sql/run', requireTab('sql', async (req, _params, _url, user) => {
  const body = await bodyOf(req);
  const v = validateAdHoc(String(body.sql || ''));
  if (!v.ok) return json({ error: v.error }, 400);
  // Restricted columns (password, KYC fields, etc.) are redacted from every
  // result by default (see runQuery/redactSensitiveColumns in bigquery.ts).
  // A superuser can lift that for one query, but only by re-proving their
  // identity with their current password on this specific request.
  let redact = true;
  if (body.unredact) {
    if (!user!.is_superuser) return json({ error: 'Only a superuser can include restricted columns.' }, 403);
    if (!body.password || !A.verifyPassword(String(body.password), user!.password_hash)) {
      return json({ error: 'Incorrect password.' }, 401);
    }
    redact = false;
  }
  const rows = await runQuery(capRows(v.sql, (body.limit as number) || 5000), {}, { redact });
  await A.logEvent(user!.id, user!.username, 'sql_run', v.sql.slice(0, 300) + (redact ? '' : ' [unredacted]'));
  return json({ rows, count: rows.length });
}));

// ---- Exports --------------------------------------------------------------
on('POST', '/api/export', async (req, _params, _url, user) => {
  const body = await bodyOf(req);
  const source = body.source as string;
  const format = (body.format as string) || 'csv';
  const filename = (body.filename as string) || 'export';
  const limit = body.limit as number | undefined;
  const tab = EXPORT_SOURCE_TAB[source];
  if (!tab) return json({ error: 'Unknown export source.' }, 400);
  if (!A.userCan(user, tab)) return json({ error: 'You do not have access to this export.' }, 403);
  const username = user!.username;
  await A.logEvent(user!.id, username, 'export', `${source} (${format}) as "${filename}"`);
  let rows: Record<string, unknown>[] = [];
  let pctCols: string[] = [];

  if (source === 'sql' || source === 'ask_result') {
    const v = validateAdHoc(String(body.sql || ''));
    if (!v.ok) return json({ error: v.error }, 400);
    rows = await runQuery(capRows(v.sql, limit || 100000), {});
  } else if (source === 'growth_top_funds') {
    const q = Q.largestFundsAum((body.groupBy as string) || 'fund', body.date as string, body.excludeFunds as string[]);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'transactions') {
    const filters = (body.filters as Record<string, unknown>) || {};
    const q = Q.transactions({ ...filters, limit: limit || 100000, offset: 0 } as Q.TransactionsArgs);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'churn_risk') {
    const r = await ML.churnPredictions(limit || 5000);
    rows = r.top;
  } else if (source === 'aum_history') {
    const q = Q.aumHistory(body.from as string, body.to as string, body.granularity as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'product_performance') {
    const q = Q.productPerformance();
    rows = await runQuery(q.sql, q.params);
    pctCols = ['pct_change'];
  } else if (source === 'product_performance_detail') {
    const q = Q.productPerformanceDetail();
    const detail = await runQuery(q.sql, q.params);
    if (format === 'xlsx') return xlsxMultiResponse(pivotPerformanceByType(detail), filename, username);
    rows = detail;
  } else if (source === 'portfolio_full') {
    const userId = body.userId as string; const sid = body.sid as string;
    if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
    const date = body.date as string | undefined;
    const h = date ? Q.userHoldingsAsOf(sid, date) : Q.userHoldings(userId);
    const pq = Q.productPerformanceDetail();
    const [holdings, detail] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(pq.sql, pq.params),
    ]);
    if (format === 'pdf') {
      const includePerformance = body.includePerformance !== false;
      const columns = body.columns as string[] | undefined;
      const c = Q.userContact(userId);
      const [contact] = await runQuery(c.sql, c.params, { redact: false });
      const perf = includePerformance ? pivotPerformanceByType(detail) : [];
      const buf = await portfolioReport({ contact, holdings }, perf, { columns, username });
      // Buffer (Node) satisfies BodyInit (a Uint8Array) at runtime, but the
      // two libraries' type declarations don't agree — wrap to satisfy both.
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameWithUser(filename, username)}.pdf"`,
        },
      });
    }
    const sheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
    if (format === 'xlsx') return xlsxMultiResponse(sheets, filename, username);
    rows = sheets[0].rows; // CSV has no sheets — holdings only
  } else if (source === 'portfolio_fix_full') {
    // Same as portfolio_full, sourced from portfolio_fix instead of
    // portfolio_with_code for the as-of-date snapshot (see userHoldingsAsOfFix).
    const userId = body.userId as string; const sid = body.sid as string;
    if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
    const date = body.date as string | undefined;
    const excludeFunds = body.excludeFunds as string[] | undefined;
    const h = date ? Q.userHoldingsAsOfFix(sid, date) : Q.userHoldings(userId);
    const pq = Q.productPerformanceDetail();
    const [holdingsRaw, detail] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(pq.sql, pq.params),
    ]);
    // Client-side checklist for excluding dust/unwanted holdings (e.g. a
    // leftover 1-unit balance) from the export without hiding them on screen.
    const holdings = Array.isArray(excludeFunds) && excludeFunds.length
      ? holdingsRaw.filter((r) => !excludeFunds.includes(r.fund as string))
      : holdingsRaw;
    if (format === 'pdf') {
      const includePerformance = body.includePerformance !== false;
      const columns = body.columns as string[] | undefined;
      const c = Q.userContact(userId);
      const [contact] = await runQuery(c.sql, c.params, { redact: false });
      const perf = includePerformance ? pivotPerformanceByType(detail) : [];
      const buf = await portfolioReport({ contact, holdings }, perf, { columns, username });
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameWithUser(filename, username)}.pdf"`,
        },
      });
    }
    const fixSheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
    if (format === 'xlsx') return xlsxMultiResponse(fixSheets, filename, username);
    rows = fixSheets[0].rows; // CSV has no sheets — holdings only
  } else if (source === 'portfolio_tx_full') {
    // Same as portfolio_full, but holdings come from userHoldingsFromTx /
    // userHoldingsFromTxAsOf (avg_buy_price derived from the transaction ledger).
    const userId = body.userId as string;
    if (!userId) return json({ error: 'userId is required.' }, 400);
    const dateTx = body.date as string | undefined;
    const excludeFundsTx = body.excludeFunds as string[] | undefined;
    const h = dateTx ? Q.userHoldingsFromTxAsOf(userId, dateTx) : Q.userHoldingsFromTx(userId);
    const pq = Q.productPerformanceDetail();
    const [holdingsRawTx, detail] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(pq.sql, pq.params),
    ]);
    const holdings = Array.isArray(excludeFundsTx) && excludeFundsTx.length
      ? holdingsRawTx.filter((r) => !excludeFundsTx.includes(r.fund as string))
      : holdingsRawTx;
    if (format === 'pdf') {
      const includePerformance = body.includePerformance !== false;
      const columns = body.columns as string[] | undefined;
      const c = Q.userContact(userId);
      const [contact] = await runQuery(c.sql, c.params, { redact: false });
      const perf = includePerformance ? pivotPerformanceByType(detail) : [];
      const buf = await portfolioReport({ contact, holdings }, perf, { columns, username });
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameWithUser(filename, username)}.pdf"`,
        },
      });
    }
    const txSheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
    if (format === 'xlsx') return xlsxMultiResponse(txSheets, filename, username);
    rows = txSheets[0].rows; // CSV has no sheets — holdings only
  } else if (source === 'portfolio_sinvest_full') {
    // Same as portfolio_tx_full, but holdings come from the custodian feed
    // (sinvestHoldings / sinvestHoldingsAsOf) instead of main.transactions.
    const userId = body.userId as string; const sid = body.sid as string;
    if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
    const dateSi = body.date as string | undefined;
    const excludeFundsSi = body.excludeFunds as string[] | undefined;
    const h = dateSi ? Q.sinvestHoldingsAsOf(sid, dateSi) : Q.sinvestHoldings(sid);
    const pq = Q.productPerformanceDetail();
    const [holdingsRawSi, detail] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(pq.sql, pq.params),
    ]);
    const holdingsSi = Array.isArray(excludeFundsSi) && excludeFundsSi.length
      ? holdingsRawSi.filter((r) => !excludeFundsSi.includes(r.fund as string))
      : holdingsRawSi;
    if (format === 'pdf') {
      const includePerformance = body.includePerformance !== false;
      const columns = body.columns as string[] | undefined;
      const c = Q.userContact(userId);
      const [contact] = await runQuery(c.sql, c.params, { redact: false });
      const perf = includePerformance ? pivotPerformanceByType(detail) : [];
      const buf = await portfolioReport({ contact, holdings: holdingsSi }, perf, { columns, username });
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameWithUser(filename, username)}.pdf"`,
        },
      });
    }
    const siSheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdingsSi) }, ...pivotPerformanceByType(detail)];
    if (format === 'xlsx') return xlsxMultiResponse(siSheets, filename, username);
    rows = siSheets[0].rows; // CSV has no sheets — holdings only
  } else if (source === 'portfolio_explorer_full') {
    // Same shape/columns as portfolio_full, sourced from goal_snapshots as of
    // a given date instead of the live portfolios/bonus_portfolios tables —
    // always merged across goals, never split by goal, even in the preview
    // that split is a preview-only view.
    const userId = body.userId as string;
    if (!userId) return json({ error: 'userId is required.' }, 400);
    let asOfDate = body.date as string | undefined;
    if (!asOfDate) {
      const d = Q.goalLatestSnapshotDate(userId);
      const [row] = await runQuery(d.sql, d.params);
      asOfDate = row?.latest_date as string | undefined;
    }
    if (!asOfDate) return json({ error: 'No goal_snapshots found for this user.' }, 400);
    const h = Q.goalUserHoldings(userId, asOfDate);
    const pq = Q.productPerformanceDetail();
    const [holdings, detail] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(pq.sql, pq.params),
    ]);
    if (format === 'pdf') {
      const includePerformance = body.includePerformance !== false;
      const columns = body.columns as string[] | undefined;
      const c = Q.userContact(userId);
      const [contact] = await runQuery(c.sql, c.params, { redact: false });
      const perf = includePerformance ? pivotPerformanceByType(detail) : [];
      const buf = await portfolioReport({ contact, holdings }, perf, { columns, username });
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filenameWithUser(filename, username)}.pdf"`,
        },
      });
    }
    const sheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
    if (format === 'xlsx') return xlsxMultiResponse(sheets, filename, username);
    rows = sheets[0].rows; // CSV has no sheets — holdings only
  } else if (source === 'explore') {
    const dataset = body.dataset as string;
    const filters = (body.filters as Record<string, string>) || {};
    const built = EX.buildExplore(dataset, { ...filters, limit: String(limit || 100000), offset: '0' });
    rows = await runQuery(built.sql, built.params);
    const rename = EX.exportRename(dataset);
    if (rename) rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename[k] || k, v])));
  } else if (source === 'campaigns_performance') {
    const q = Q.campaignPerformance(limit || 1000);
    rows = await runQuery(q.sql, q.params);
    pctCols = ['redemption_pct'];
  } else if (source === 'switching_pairs') {
    const q = Q.switchingTopPairs(limit || 1000);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'referrals_top') {
    const q = Q.topReferrers(limit || 1000);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'reconciliation') {
    const q = Q.reconciliationDaily(body.from as string, body.to as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'revenue_detail' || source === 'revenue_v2_detail') {
    const q = source === 'revenue_detail'
      ? Q.revenueDetail(body.from as string, body.to as string, body.granularity as string, body.fund as string, body.mi as string)
      : Q.revenueV2Detail(body.from as string, body.to as string, body.granularity as string, body.fund as string, body.mi as string);
    const detail = await runQuery(q.sql, q.params);
    const splitBy = body.splitBy as string | undefined; // 'fund' | 'mi' | undefined — xlsx only, one sheet per value
    if (format === 'xlsx' && (splitBy === 'fund' || splitBy === 'mi')) {
      return xlsxMultiResponse(splitRowsBySheet(detail, splitBy === 'fund' ? 'fund_name' : 'mi_name'), filename, username);
    }
    rows = detail;
  } else if (source === 'revenue_summary') {
    const q = Q.revenueMonthlySummary(body.from as string, body.to as string, body.granularity as string, body.fund as string, body.mi as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'revenue_v2_summary') {
    const q = Q.revenueV2MonthlySummary(body.from as string, body.to as string, body.granularity as string, body.fund as string, body.mi as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'user_lifetime_users') {
    const q = Q.userLifetimeUsers(body.from as string, body.to as string, body.fund as string, body.mi as string, body.sid as string, limit || 100000);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'user_lifetime_summary') {
    const q = Q.userLifetimeSummary(body.from as string, body.to as string, body.granularity as string, body.fund as string, body.mi as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'user_lifetime_detail') {
    const sid = body.sid as string;
    if (!sid) return json({ error: 'sid is required.' }, 400);
    const q = Q.userLifetimeDetail(sid, body.from as string, body.to as string, body.granularity as string, body.fund as string, body.mi as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'campaign_revenue_detail') {
    const q = Q.campaignRevenueDetail(body.from as string, body.to as string, body.granularity as string, body.promo as string);
    const detail = await runQuery(q.sql, q.params);
    if (format === 'xlsx' && body.splitBy === 'promo') {
      return xlsxMultiResponse(splitRowsBySheet(detail, 'promo_code'), filename, username);
    }
    rows = detail;
  } else if (source === 'campaign_revenue_campaigns') {
    const q = Q.campaignRevenueByCampaign(body.from as string, body.to as string, body.promo as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'campaign_revenue_summary') {
    const q = Q.campaignRevenueSummary(body.from as string, body.to as string, body.granularity as string, body.promo as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'remisier_revenue_detail' || source === 'remisier_revenue_summary') {
    const code = body.code as string;
    if (!code) return json({ error: 'code is required.' }, 400);
    const portion = Number(body.portion) || 0;
    const args = [body.field as string, code, body.from as string, body.to as string, body.granularity as string, portion] as const;
    const q = source === 'remisier_revenue_detail' ? Q.remisierRevenueDetail(...args) : Q.remisierRevenueSummary(...args);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'remisier_revenue_pwc_detail' || source === 'remisier_revenue_pwc_summary') {
    const code = body.code as string;
    if (!code) return json({ error: 'code is required.' }, 400);
    const portion = Number(body.portion) || 0;
    const args = [body.field as string, code, body.from as string, body.to as string, body.granularity as string, portion] as const;
    const q = source === 'remisier_revenue_pwc_detail' ? Q.remisierRevenuePwcDetail(...args) : Q.remisierRevenuePwcSummary(...args);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'remisier_transactions') {
    const referrerCodes = (body.referrerCodes as string[]) || [];
    const salesCodes = (body.salesCodes as string[]) || [];
    if (!referrerCodes.length && !salesCodes.length) return json({ error: 'At least one referrer_code or sales_code is required.' }, 400);
    const q = Q.remisierTransactions({ referrerCodes, salesCodes, type: body.type as string, status: body.status as string, from: body.from as string, to: body.to as string, limit: limit || 100000, offset: 0 });
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'sinvest_transactions') {
    const q = Q.sinvestTransactions({ from: body.from as string, to: body.to as string, type: body.type as string, sid: body.sid as string, search: body.search as string, limit: limit || 100000, offset: 0 });
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'hnwi_total') {
    if (!body.date) return json({ error: 'date is required.' }, 400);
    const q = Q.hnwiTotal(body.date as string, body.minAum as string, body.maxAum as string, (limit as number) || 5000);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'hnwi_by_fund') {
    if (!body.date) return json({ error: 'date is required.' }, 400);
    const q = Q.hnwiByFund(body.date as string, body.minAum as string, body.maxAum as string, body.minFundAum as string, body.maxFundAum as string, (limit as number) || 20000);
    rows = await runQuery(q.sql, q.params);
  } else {
    return json({ error: 'Unknown export source.' }, 400);
  }

  if (format === 'xlsx') return xlsxResponse(rows, filename, username, pctCols);
  if (format === 'txt') return txtResponse(rows, filename, username);
  return csvResponse(rows, filename, username);
});

// ---- Serve ------------------------------------------------------------------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Supabase prefixes its own function-routing path in front of ours
  // (e.g. /functions/v1/api/... ) — anchor on the first '/api/' segment so
  // this router doesn't need to know or care what that prefix looks like.
  const idx = url.pathname.indexOf('/api/');
  const pathname = idx >= 0 ? url.pathname.slice(idx) : url.pathname;

  if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  // Per-user login (replaces the old shared APP_PASSWORD gate). Every route
  // except login + health requires a valid session token (Authorization:
  // Bearer <token>). user is always re-read live from dashboard_users — never
  // cached in the token — so a permission edit or account deletion takes
  // effect on the user's very next request, not just at their next login.
  let user: A.DashboardUser | null = null;
  if (pathname !== '/api/health' && pathname !== '/api/auth/login') {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    try {
      user = await A.findUserByToken(token);
    } catch (err) {
      console.error('[auth]', (err as Error).message);
      return withCors(json({ error: 'Auth check failed.' }, 500));
    }
    if (!user) return withCors(json({ error: 'Unauthorized. Please log in.' }, 401));
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.pattern.exec({ pathname });
    if (!match) continue;
    try {
      const params = Object.fromEntries(
        Object.entries(match.pathname.groups).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      return withCors(await r.handler(req, params, url, user));
    } catch (err) {
      console.error(`[${req.method} ${pathname}]`, (err as Error).message);
      return withCors(json({ error: (err as Error).message || 'Query failed.' }, 500));
    }
  }
  return withCors(json({ error: 'Not found' }, 404));
});
