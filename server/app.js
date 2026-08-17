'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const {
  runQuery, dryRun, validateAdHoc, capRows, PROJECT_ID, MAX_BYTES_BILLED,
} = require('./bigquery');
const Q = require('./queries');
const { toCsv, toTxt, toXlsxBuffer, toXlsxMultiSheet } = require('./export');
const { ask, askEnabled, TABLES, suggestChart } = require('./ask');
const EX = require('./explore');
const ML = require('./ml');
const PDF = require('./pdf');
const Auth = require('./auth');

// Every export `source` maps to exactly one tab, so a single permission check
// at the top of /api/export covers all of them (see requireTab below for the
// equivalent per-route check used everywhere else).
const EXPORT_SOURCE_TAB = {
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

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];

// Pivot flat (type, name, period, pct_change) rows into one fund-per-row
// table per fund type — used for the per-type Excel sheets.
function pivotPerformanceByType(rows) {
  const byType = {};
  for (const r of rows) {
    const type = r.type || '(none)';
    const byFund = (byType[type] = byType[type] || {});
    const fund = (byFund[r.name] = byFund[r.name] || { Fund: r.name, NAV: r.latest_nav });
    fund[r.period] = r.pct_change;
  }
  return Object.keys(byType).sort().map((type) => ({
    name: type,
    rows: Object.values(byType[type]).map((f) => {
      const out = { Fund: f.Fund, NAV: f.NAV };
      for (const p of PERF_PERIODS) out[p] = f[p] ?? null;
      return out;
    }),
    pctCols: PERF_PERIODS,
  }));
}

// Splits flat detail rows into one worksheet per distinct value of keyField —
// used for the revenue exports' "one sheet per fund/MI" option.
function splitRowsBySheet(rows, keyField) {
  const groups = {};
  for (const r of rows) {
    const key = r[keyField] || '(none)';
    (groups[key] = groups[key] || []).push(r);
  }
  return Object.keys(groups).sort().map((name) => ({ name, rows: groups[name] }));
}

// Friendly column names for the "Portfolio" sheet in the combined export.
function portfolioSheetRows(holdings) {
  return holdings.map((h) => ({
    Fund: h.fund, Type: h.fund_type,
    'Unit Balance': h.unit, 'Average NAV': h.avg_buy_price, 'Close NAV': h.nav,
    'Fund Value': h.fund_value, 'Market Value': h.value,
    'Unrealized Gain/Loss': h.gain_loss, '%': h.gain_pct, Opened: h.opened_at,
  }));
}

/**
 * Build the Express app.
 * @param {object} opts
 * @param {boolean} opts.serveStatic  Serve the /public frontend + SPA fallback.
 *   true  → standalone server (local / Cloud Run / any Node host)
 *   false → API only (Netlify Functions; the CDN serves the frontend)
 */
function createApp({ serveStatic = true } = {}) {
  const app = express();
  // exposedHeaders: the export routes watermark the filename into
  // Content-Disposition, which browsers otherwise hide from cross-origin
  // fetch() responses (the GitHub Pages frontend calling this cross-origin).
  app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '256kb' }));

  // ---- Per-user login (replaces the old shared APP_PASSWORD gate) -----------
  // Every /api/* route except login + health requires a valid session token
  // (Authorization: Bearer <token>). req.user is always re-read live from
  // dashboard_users on each request — never cached in the token — so a
  // permission edit or account deletion by a superuser takes effect on the
  // user's very next request, not just at their next login.
  app.use('/api', async (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/login') return next();
    try {
      const authHeader = req.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const user = await Auth.findUserByToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
      req.user = user;
      next();
    } catch (err) {
      console.error('[auth]', err.message);
      res.status(500).json({ error: 'Auth check failed.' });
    }
  });

  const handler = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.path}]`, err.message);
      res.status(500).json({ error: err.message || 'Query failed.' });
    }
  };

  // Per-tab access control — superusers always pass; everyone else needs the
  // tab in their allowed_tabs. Applied as Express middleware right after the
  // auth check above, so it always runs with req.user already set.
  const requireTab = (tab) => (req, res, next) => {
    if (Auth.userCan(req.user, tab)) return next();
    res.status(403).json({ error: `You do not have access to this section (${tab}).` });
  };

  const requireSuperuser = (req, res, next) => {
    if (req.user && req.user.is_superuser) return next();
    res.status(403).json({ error: 'Superuser access required.' });
  };

  // ---- Auth: login/logout/me --------------------------------------------
  // Login is the one route not gated by the middleware above (it's how you
  // get a token in the first place).
  app.post('/api/auth/login', handler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    const user = await Auth.findUserByUsername(username);
    if (!user || !Auth.verifyPassword(password, user.password_hash)) {
      await Auth.logEvent(user ? user.id : null, username, 'login_failure');
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }
    const token = await Auth.createSession(user.id);
    await Auth.logEvent(user.id, user.username, 'login_success');
    res.json({ token, user: Auth.publicUser(user) });
  }));

  app.post('/api/auth/logout', handler(async (req, res) => {
    const authHeader = req.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    await Auth.deleteSessionByToken(token);
    res.json({ ok: true });
  }));

  app.get('/api/auth/me', (req, res) => res.json({ user: Auth.publicUser(req.user) }));

  // ---- Admin: manage dashboard accounts (superuser only) --------------------
  app.get('/api/admin/users', requireSuperuser, handler(async (_req, res) => {
    const rows = await Auth.listUsers();
    res.json(rows.map((r) => Auth.publicUser({ ...r, password_hash: '' })));
  }));

  app.post('/api/admin/users', requireSuperuser, handler(async (req, res) => {
    const { username, password, isSuperuser, allowedTabs } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    const existing = await Auth.findUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'That username is already taken.' });
    const created = await Auth.createUser({ username, password, isSuperuser: !!isSuperuser, allowedTabs: allowedTabs || [] });
    await Auth.logEvent(req.user.id, req.user.username, 'admin_user_create',
      `created dashboard user "${username}"${isSuperuser ? ' (superuser)' : ''}`);
    res.json(Auth.publicUser(created));
  }));

  app.patch('/api/admin/users/:id', requireSuperuser, handler(async (req, res) => {
    const target = await Auth.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    // Lockout guard: refuse to demote the last remaining superuser.
    if (target.is_superuser && req.body.isSuperuser === false && (await Auth.countSuperusers()) <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last remaining superuser.' });
    }
    const updated = await Auth.updateUser(req.params.id, req.body || {});
    const changes = [];
    if (req.body.password) changes.push('password reset');
    if (req.body.isSuperuser !== undefined) changes.push(`superuser=${req.body.isSuperuser}`);
    if (req.body.allowedTabs !== undefined) changes.push(`tabs=[${(req.body.allowedTabs || []).join(',')}]`);
    await Auth.logEvent(req.user.id, req.user.username, 'admin_user_update',
      `updated "${target.username}": ${changes.join(', ') || 'no changes'}`);
    res.json(Auth.publicUser(updated));
  }));

  app.delete('/api/admin/users/:id', requireSuperuser, handler(async (req, res) => {
    const target = await Auth.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.is_superuser && (await Auth.countSuperusers()) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last remaining superuser.' });
    }
    await Auth.deleteUser(req.params.id);
    await Auth.logEvent(req.user.id, req.user.username, 'admin_user_delete', `deleted dashboard user "${target.username}"`);
    res.json({ ok: true });
  }));

  app.get('/api/admin/audit-log', requireSuperuser, handler(async (req, res) => {
    const { limit, search, from, to, user } = req.query;
    const rows = await Auth.listAuditLog({ limit, search, from, to, user });
    res.json(rows);
  }));

  // ---- Auth: change your own password ---------------------------------------
  // Requires the current password (not just a valid session) so a hijacked-
  // but-still-valid token can't lock the real owner out permanently.
  app.post('/api/auth/change-password', handler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
    if (!Auth.verifyPassword(currentPassword, req.user.password_hash)) {
      // 400, not 401 — the session itself is still valid, only the typed
      // password is wrong. The frontend's api() helper force-logs-out on any
      // 401, which a wrong-current-password typo must not trigger.
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    await Auth.updateUser(req.user.id, { password: newPassword });
    await Auth.logEvent(req.user.id, req.user.username, 'password_change');
    res.json({ ok: true });
  }));

  // ---- Health -----------------------------------------------------------
  // Pings BigQuery with a trivial query (no table scan, no cost) so the UI
  // can show a live/down connection indicator instead of just "the API server
  // itself responded".
  app.get('/api/health', async (_req, res) => {
    let bigquery = true;
    try {
      await Promise.race([
        runQuery('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
    } catch {
      bigquery = false;
    }
    res.json({ ok: true, project: PROJECT_ID, bigquery, askEnabled: askEnabled() });
  });

  // ---- Overview (KPIs) ------------------------------------------------------
  app.get('/api/overview', requireTab('overview'), handler(async (req, res) => {
    const { from, to } = req.query;
    const [users, aum, tx, funds] = await Promise.all([
      runQuery(Q.overviewUsers().sql, Q.overviewUsers().params),
      runQuery(Q.overviewAum().sql, Q.overviewAum().params),
      runQuery(Q.overviewTx(from, to).sql, Q.overviewTx(from, to).params),
      runQuery(Q.overviewFunds().sql, Q.overviewFunds().params),
    ]);
    res.json({ ...users[0], ...aum[0], ...tx[0], ...funds[0] });
  }));

  // ---- Trends ---------------------------------------------------------------
  app.get('/api/trends', requireTab('overview'), handler(async (req, res) => {
    const { from, to, granularity } = req.query;
    const q = Q.trends(from, to, granularity);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Breakdowns -----------------------------------------------------------
  app.get('/api/breakdown/:dimension', requireTab('overview'), handler(async (req, res) => {
    const { from, to } = req.query;
    const q = Q.breakdownBy(req.params.dimension, from, to);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Funds ------------------------------------------------------------
  // Largest funds/MI by AUM, as of a date, from portfolio_with_code -------
  app.get('/api/funds/top/latest-date', requireTab('overview'), handler(async (_req, res) => {
    const d = Q.largestFundsLatestDate();
    const [row] = await runQuery(d.sql, d.params);
    res.json({ latestDate: row?.latest_date || null });
  }));
  app.get('/api/funds/top', requireTab('overview'), handler(async (req, res) => {
    const { date, excludeFunds } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required.' });
    const exclude = excludeFunds ? String(excludeFunds).split(',').filter(Boolean) : [];
    const q = Q.largestFundsAum(req.query.groupBy, date, exclude);
    res.json(await runQuery(q.sql, q.params));
  }));
  // Shared by Overview and Performance — allow either.
  const requireOverviewOrPerformance = (req, res, next) => {
    if (Auth.userCan(req.user, 'overview') || Auth.userCan(req.user, 'performance')) return next();
    res.status(403).json({ error: 'You do not have access to this section.' });
  };
  app.get('/api/funds/types', requireOverviewOrPerformance, handler(async (_req, res) => {
    const q = Q.fundTypes();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/funds/list', requireTab('performance'), handler(async (req, res) => {
    const q = Q.fundList(req.query.type);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Users ----------------------------------------------------------------
  app.get('/api/users/growth', requireTab('overview'), handler(async (_req, res) => {
    const q = Q.userGrowth();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/verification', requireTab('overview'), handler(async (_req, res) => {
    const q = Q.verificationBreakdown();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/by-province', requireTab('overview'), handler(async (_req, res) => {
    const q = Q.usersByProvince();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/top-cities', requireTab('overview'), handler(async (req, res) => {
    const q = Q.topCitiesByInvestors(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/top-cities-aum', requireTab('overview'), handler(async (req, res) => {
    const q = Q.topCitiesByAum(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Transactions explorer ------------------------------------------------
  app.get('/api/transactions/filters', requireTab('remisier-tx'), handler(async (_req, res) => {
    const q = Q.txFilterValues();
    const rows = await runQuery(q.sql, q.params);
    res.json(rows[0] || { types: [], statuses: [] });
  }));

  app.get('/api/transactions', requireTab('remisier-tx'), handler(async (req, res) => {
    const q = Q.transactions(req.query);
    const [rows, countRows] = await Promise.all([
      runQuery(q.sql, q.params),
      runQuery(q.countSql, q.params),
    ]);
    res.json({ rows, total: Number(countRows[0]?.total || 0) });
  }));

  // ---- SInvest transactions (raw KSEI/SInvest custodian feed, paged) --------
  app.get('/api/sinvest-transactions', requireTab('sinvest-tx'), handler(async (req, res) => {
    const { from, to, type, sid, search, limit, offset } = req.query;
    const q = Q.sinvestTransactions({ from, to, type, sid, search, limit: limit || 50, offset: offset || 0 });
    const [rows, countRows] = await Promise.all([
      runQuery(q.sql, q.params),
      runQuery(q.countSql, q.params),
    ]);
    res.json({ rows, total: Number(countRows[0]?.total || 0) });
  }));

  // ---- AUM history (mi_fee_logs.mi_fee) -------------------------------------
  app.get('/api/aum-history', requireTab('aum'), handler(async (req, res) => {
    const { from, to, granularity } = req.query;
    const q = Q.aumHistory(from, to, granularity);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- User portfolio lookup (search by SID, print one user's portfolio) ----
  // Shared by Portfolio, Portfolio Explorer, Portfolio (Fix), Portfolio (TX), and Portfolio (SInvest) — allow any.
  const requireAnyPortfolio = (req, res, next) => {
    if (Auth.userCan(req.user, 'portfolio') || Auth.userCan(req.user, 'portfolio-explorer') || Auth.userCan(req.user, 'portfolio-fix') || Auth.userCan(req.user, 'portfolio-tx') || Auth.userCan(req.user, 'portfolio-sinvest')) return next();
    res.status(403).json({ error: 'You do not have access to this section.' });
  };
  app.get('/api/users/search', requireAnyPortfolio, handler(async (req, res) => {
    const q = Q.userSearch(req.query.q);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/portfolio', requireTab('portfolio'), handler(async (req, res) => {
    const { userId, sid, date } = req.query;
    if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
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
    const latestDate = dRows[0]?.latest_date || null;
    // Regular/bonus split is always current-live (portfolios/bonus_portfolios
    // don't have history), so it doesn't make sense to show it as if it were
    // "as of" a past date — omit it in that mode rather than show a misleading number.
    res.json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null, latestDate });
    // A named individual's holdings, not aggregate BigQuery analytics — worth
    // its own audit trail entry (who looked up which investor, and when).
    await Auth.logEvent(req.user.id, req.user.username, 'view_portfolio', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  }));

  // ---- Portfolio (Fix): same as Portfolio (PWC) above, but the as-of-date
  // snapshot is read from portfolio_fix instead of portfolio_with_code (see
  // userHoldingsAsOfFix in queries.js for why). Live (no date) holdings are
  // identical to Portfolio (PWC) — both read the same real-time userHoldings().
  app.get('/api/portfolio-fix', requireTab('portfolio-fix'), handler(async (req, res) => {
    const { userId, sid, date } = req.query;
    if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
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
    const latestDate = dRows[0]?.latest_date || null;
    res.json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null, latestDate });
    await Auth.logEvent(req.user.id, req.user.username, 'view_portfolio_fix', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  }));

  // ---- Portfolio (TX): holdings with avg_buy_price computed straight from
  // the transaction ledger (see userHoldingsFromTx in queries.js) instead of
  // trusting portfolios.initial_price. An as-of-date reconstructs holdings
  // purely from transactions up to that date (userHoldingsFromTxAsOf) —
  // bonus units are excluded in that mode since bonus_portfolios has no
  // history to reconstruct from (see its comment in queries.js). AUM
  // chart/performance reuse portfolio_fix, since that data (market value, not
  // cost basis) was never wrong.
  app.get('/api/portfolio-tx', requireTab('portfolio-tx'), handler(async (req, res) => {
    const { userId, sid, date } = req.query;
    if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
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
    res.json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null });
    await Auth.logEvent(req.user.id, req.user.username, 'view_portfolio_tx', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  }));

  // ---- Portfolio (SInvest): same as Portfolio (TX), but holdings are built
  // entirely from the custodian feed (sinvest.trx_history) instead of the
  // app's own transactions table (see sinvestHoldings/sinvestHoldingsAsOf in
  // queries.js). split/performance/history still come from the app's own
  // live state and portfolio_fix — those aren't sourced from sinvest.
  app.get('/api/portfolio-sinvest', requireTab('portfolio-sinvest'), handler(async (req, res) => {
    const { userId, sid, date } = req.query;
    if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
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
    res.json({ holdings, split: date ? null : splitRows[0], performance, history, asOfDate: date || null });
    await Auth.logEvent(req.user.id, req.user.username, 'view_portfolio_sinvest', `SID ${sid}${date ? ` as of ${date}` : ''}`);
  }));

  // ---- Portfolio Explorer (goal_snapshots, point-in-time by date) -----------
  app.get('/api/portfolio-explorer', requireTab('portfolio-explorer'), handler(async (req, res) => {
    const { userId, sid } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    // Always look up the latest available snapshot date, even when a specific
    // date was requested — the UI shows it alongside asOfDate so it's obvious
    // whether the picked date actually has data, and how it compares to "now".
    const d = Q.goalLatestSnapshotDate(userId);
    const [dRow] = await runQuery(d.sql, d.params);
    const latestDate = dRow?.latest_date || null;
    const asOfDate = req.query.date || latestDate || null;
    if (!asOfDate) return res.json({ asOfDate: null, latestDate: null, holdings: [], byGoal: [] });
    const h = Q.goalUserHoldings(userId, asOfDate);
    const b = Q.goalUserHoldingsByGoal(userId, asOfDate);
    const [holdings, byGoal] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(b.sql, b.params),
    ]);
    res.json({ asOfDate, latestDate, holdings, byGoal });
    await Auth.logEvent(req.user.id, req.user.username, 'view_portfolio', `SID ${sid || userId} as of ${asOfDate} (explorer)`);
  }));

  // ---- HNWI (High Net Worth Individual): investors above an AUM threshold,
  // as of a date, from portfolio_with_code --------------------------------
  app.get('/api/hnwi/latest-date', requireTab('hnwi'), handler(async (_req, res) => {
    const d = Q.hnwiLatestDate();
    const [row] = await runQuery(d.sql, d.params);
    res.json({ latestDate: row?.latest_date || null });
  }));
  app.get('/api/hnwi/total', requireTab('hnwi'), handler(async (req, res) => {
    const { date, minAum, limit } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required.' });
    const q = Q.hnwiTotal(date, minAum, limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/hnwi/by-fund', requireTab('hnwi'), handler(async (req, res) => {
    const { date, minAum, limit } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required.' });
    const q = Q.hnwiByFund(date, minAum, limit);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Product performance (NAV % change per fund type, external Apollo DB) --
  app.get('/api/product-performance', requireTab('performance'), handler(async (_req, res) => {
    const q = Q.productPerformance();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/product-performance/detail', requireTab('performance'), handler(async (_req, res) => {
    const q = Q.productPerformanceDetail();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/product-performance/trend', requireTab('performance'), handler(async (req, res) => {
    const { type, period, limit } = req.query;
    const funds = req.query.funds == null ? [] : [].concat(req.query.funds);
    const q = Q.fundNavTrend({ type, period, limit, funds });
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Growth: campaigns, referrals, switching, manager/demographic AUM -----
  app.get('/api/campaigns/performance', requireTab('growth'), handler(async (req, res) => {
    const q = Q.campaignPerformance(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/switching/top-pairs', requireTab('growth'), handler(async (req, res) => {
    const q = Q.switchingTopPairs(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/funds/by-manager', requireTab('growth'), handler(async (req, res) => {
    const q = Q.aumByManager(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/aum-by-risk', requireTab('growth'), handler(async (_req, res) => {
    const q = Q.aumByRisk();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/aum-by-income', requireTab('growth'), handler(async (_req, res) => {
    const q = Q.aumByIncome();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/referrals/top', requireTab('growth'), handler(async (req, res) => {
    const q = Q.topReferrers(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Reconciliation: app ledger vs custodian (sinvest) feed ----------------
  app.get('/api/reconciliation', requireTab('reconciliation'), handler(async (req, res) => {
    const { from, to } = req.query;
    const q = Q.reconciliationDaily(from, to);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Revenue: management fee earned per fund/period -------------------------
  app.get('/api/revenue', requireTab('revenue'), handler(async (req, res) => {
    const { from, to, granularity, fund, mi } = req.query;
    const q = Q.revenueDetail(from, to, granularity, fund, mi);
    res.json(await runQuery(q.sql, q.params));
  }));

  app.get('/api/revenue/summary', requireTab('revenue'), handler(async (req, res) => {
    const { from, to, granularity, fund, mi } = req.query;
    const q = Q.revenueMonthlySummary(from, to, granularity, fund, mi);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Revenue v2: same as Revenue above, but AUM sourced from goal_snapshots
  app.get('/api/revenue-v2', requireTab('revenue2'), handler(async (req, res) => {
    const { from, to, granularity, fund, mi } = req.query;
    const q = Q.revenueV2Detail(from, to, granularity, fund, mi);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/revenue-v2/summary', requireTab('revenue2'), handler(async (req, res) => {
    const { from, to, granularity, fund, mi } = req.query;
    const q = Q.revenueV2MonthlySummary(from, to, granularity, fund, mi);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- User lifetime: Revenue (PWC) math grouped per investor, plus the
  // lifetime dates (registration / first buy / holding span) around it --------
  app.get('/api/user-lifetime', requireTab('user-lifetime'), handler(async (req, res) => {
    const { from, to, fund, mi, sid, limit } = req.query;
    const q = Q.userLifetimeUsers(from, to, fund, mi, sid, Math.min(Number(limit) || 200, 2000));
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/user-lifetime/summary', requireTab('user-lifetime'), handler(async (req, res) => {
    const { from, to, granularity, fund, mi } = req.query;
    const q = Q.userLifetimeSummary(from, to, granularity, fund, mi);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/user-lifetime/detail', requireTab('user-lifetime'), handler(async (req, res) => {
    const { sid, from, to, granularity, fund, mi } = req.query;
    if (!sid) return res.status(400).json({ error: 'sid is required.' });
    const q = Q.userLifetimeDetail(sid, from, to, granularity, fund, mi);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Campaign revenue: management fee earned on promo-locked units --------
  app.get('/api/campaign-revenue', requireTab('campaign-revenue'), handler(async (req, res) => {
    const { from, to, granularity, promo } = req.query;
    const q = Q.campaignRevenueDetail(from, to, granularity, promo);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/campaign-revenue/campaigns', requireTab('campaign-revenue'), handler(async (req, res) => {
    const { from, to, promo } = req.query;
    const q = Q.campaignRevenueByCampaign(from, to, promo);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/campaign-revenue/summary', requireTab('campaign-revenue'), handler(async (req, res) => {
    const { from, to, granularity, promo } = req.query;
    const q = Q.campaignRevenueSummary(from, to, granularity, promo);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Remisier sharing: management fee revenue for one remisier's users,
  // from goal_snapshots, split as a portion of the AperD share -----------------
  // Shared by Remisier sharing and its PWC sibling — allow either.
  const requireAnyRemisier = (req, res, next) => {
    if (Auth.userCan(req.user, 'remisier') || Auth.userCan(req.user, 'remisier-pwc')) return next();
    res.status(403).json({ error: 'You do not have access to this section.' });
  };
  app.get('/api/remisier/users', requireAnyRemisier, handler(async (req, res) => {
    const { field, code } = req.query;
    if (!code) return res.status(400).json({ error: 'code is required.' });
    const q = Q.remisierUsers(field, code);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/remisier/revenue', requireTab('remisier'), handler(async (req, res) => {
    const { field, code, from, to, granularity, portion } = req.query;
    if (!code) return res.status(400).json({ error: 'code is required.' });
    const q = Q.remisierRevenueDetail(field, code, from, to, granularity, Number(portion) || 0);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/remisier/revenue/summary', requireTab('remisier'), handler(async (req, res) => {
    const { field, code, from, to, granularity, portion } = req.query;
    if (!code) return res.status(400).json({ error: 'code is required.' });
    const q = Q.remisierRevenueSummary(field, code, from, to, granularity, Number(portion) || 0);
    res.json(await runQuery(q.sql, q.params));
  }));
  // ---- Remisier sharing (portfolio_with_code): same as above, AUM sourced
  // from mi_fee_logs.portfolio_with_code instead of goal_snapshots ----------
  app.get('/api/remisier/revenue-pwc', requireTab('remisier-pwc'), handler(async (req, res) => {
    const { field, code, from, to, granularity, portion } = req.query;
    if (!code) return res.status(400).json({ error: 'code is required.' });
    const q = Q.remisierRevenuePwcDetail(field, code, from, to, granularity, Number(portion) || 0);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/remisier/revenue-pwc/summary', requireTab('remisier-pwc'), handler(async (req, res) => {
    const { field, code, from, to, granularity, portion } = req.query;
    if (!code) return res.status(400).json({ error: 'code is required.' });
    const q = Q.remisierRevenuePwcSummary(field, code, from, to, granularity, Number(portion) || 0);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/remisier/transactions', requireTab('remisier-tx'), handler(async (req, res) => {
    const referrerCodes = req.query.referrerCodes == null ? [] : [].concat(req.query.referrerCodes);
    const salesCodes = req.query.salesCodes == null ? [] : [].concat(req.query.salesCodes);
    if (!referrerCodes.length && !salesCodes.length) return res.status(400).json({ error: 'At least one referrer_code or sales_code is required.' });
    const { from, to, type, status, limit, offset } = req.query;
    const q = Q.remisierTransactions({ referrerCodes, salesCodes, type, status, from, to, limit: limit || 100, offset: offset || 0 });
    const [rows, countRows] = await Promise.all([
      runQuery(q.sql, q.params),
      runQuery(q.countSql, q.params),
    ]);
    res.json({ rows, total: Number(countRows[0]?.total || 0) });
  }));

  // ---- Predictive models (BigQuery ML) --------------------------------------
  app.get('/api/ml/status', requireTab('predict'), async (_req, res) => {
    try {
      const models = await ML.status();
      res.json({ ready: models.length > 0, models });
    } catch {
      res.json({ ready: false, models: [] }); // ml dataset not created yet
    }
  });
  app.get('/api/predict/aum', requireTab('predict'), handler(async (req, res) => res.json(await ML.aumForecast(req.query.horizon))));
  app.get('/api/predict/transactions', requireTab('predict'), handler(async (req, res) => res.json(await ML.txForecast(req.query.horizon))));
  app.get('/api/predict/churn', requireTab('predict'), handler(async (req, res) => res.json(await ML.churnPredictions(req.query.limit))));
  app.get('/api/churn/overview', requireTab('predict'), handler(async (_req, res) => res.json(await ML.churnOverview())));
  app.get('/api/retention/cohorts', requireTab('predict'), handler(async (req, res) => res.json(await ML.retentionCohorts(req.query.months))));
  app.get('/api/retention/aum-cohorts', requireTab('predict'), handler(async (req, res) => res.json(await ML.aumRetentionCohorts(req.query.months))));

  // ---- Generic multi-table explorer -----------------------------------------
  app.get('/api/explore/_meta', requireTab('explorer'), handler(async (_req, res) => {
    res.json(EX.meta());
  }));

  app.get('/api/explore/:dataset/filters/:filter', requireTab('explorer'), handler(async (req, res) => {
    const sql = EX.filterValuesSql(req.params.dataset, req.params.filter);
    if (!sql) return res.json({ values: [] });
    const rows = await runQuery(sql, {});
    res.json({ values: rows.map((r) => r.v).filter((v) => v !== null) });
  }));

  app.get('/api/explore/:dataset', requireTab('explorer'), handler(async (req, res) => {
    const { sql, countSql, params } = EX.buildExplore(req.params.dataset, req.query);
    const [rows, countRows] = await Promise.all([
      runQuery(sql, params),
      runQuery(countSql, params),
    ]);
    res.json({ rows, total: Number(countRows[0]?.total || 0) });
  }));

  // ---- Ask (natural language -> SQL via Anthropic) --------------------------
  app.get('/api/ask/tables', requireTab('ask'), (req, res) => res.json({ tables: TABLES }));

  app.post('/api/ask', requireTab('ask'), async (req, res) => {
    const question = (req.body && req.body.question || '').trim();
    const context = (req.body && req.body.context || '').trim() || null;
    // Last few turns of this conversation, for follow-up questions ("now split
    // that by month") — capped so the prompt doesn't grow unbounded.
    const rawHistory = (req.body && req.body.history) || [];
    const history = Array.isArray(rawHistory)
      ? rawHistory.filter((h) => h && typeof h.question === 'string' && typeof h.sql === 'string').slice(-6)
      : [];
    if (!question) return res.status(400).json({ error: 'Type a question first.' });
    // Same step-up check as /api/sql/run: a superuser can lift column
    // redaction for one question, but only by re-proving their password on
    // this specific request.
    let redact = true;
    if (req.body && req.body.unredact) {
      if (!req.user.is_superuser) return res.status(403).json({ error: 'Only a superuser can include restricted columns.' });
      if (!req.body.password || !Auth.verifyPassword(req.body.password, req.user.password_hash)) {
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      redact = false;
    }
    try {
      const { sql, rows } = await ask(question, context, history, req.user, { redact });
      await Auth.logEvent(req.user.id, req.user.username, 'ask', `${question} (${rows.length} rows)` + (redact ? '' : ' [unredacted]'));
      res.json({ sql, rows, count: rows.length });
    } catch (err) {
      console.error('[POST /api/ask]', err.message);
      await Auth.logEvent(req.user.id, req.user.username, 'ask', `${question} — failed: ${err.message}`);
      res.status(400).json({ error: err.message, sql: err.sql || null });
    }
  });

  app.post('/api/ask/chart', requireTab('ask'), handler(async (req, res) => {
    const { question, rows, hint } = req.body || {};
    res.json(await suggestChart(question, rows, hint));
  }));

  // ---- SQL Lab --------------------------------------------------------------
  app.post('/api/sql/estimate', requireTab('sql'), handler(async (req, res) => {
    const v = validateAdHoc(req.body.sql);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { bytes } = await dryRun(capRows(v.sql, req.body.limit || 5000));
    res.json({ bytes, withinLimit: bytes <= Number(MAX_BYTES_BILLED) });
  }));

  app.post('/api/sql/run', requireTab('sql'), handler(async (req, res) => {
    const v = validateAdHoc(req.body.sql);
    if (!v.ok) return res.status(400).json({ error: v.error });
    // Restricted columns (password, KYC fields, etc.) are redacted from every
    // result by default (see runQuery/redactSensitiveColumns in bigquery.js).
    // A superuser can lift that for one query, but only by re-proving their
    // identity with their current password on this specific request — being
    // logged in as a superuser alone isn't enough, since a bypass this wide
    // deserves its own step-up check, not just a role flag.
    let redact = true;
    if (req.body.unredact) {
      if (!req.user.is_superuser) return res.status(403).json({ error: 'Only a superuser can include restricted columns.' });
      if (!req.body.password || !Auth.verifyPassword(req.body.password, req.user.password_hash)) {
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      redact = false;
    }
    const rows = await runQuery(capRows(v.sql, req.body.limit || 5000), {}, { redact });
    await Auth.logEvent(req.user.id, req.user.username, 'sql_run', v.sql.slice(0, 300) + (redact ? '' : ' [unredacted]'));
    res.json({ rows, count: rows.length });
  }));

  // ---- Exports --------------------------------------------------------------
  // Every exported file is remarked with the requesting user: their name is
  // appended to the filename, and (for xlsx/pdf) written into the file's own
  // "last modified by" / Author document property \u2014 the server already knows
  // who's asking (validated session), so this needs no support from the
  // frontend export buttons.
  function filenameWithUser(name, username) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    return `${name}_${username}_${ts}`;
  }
  function sendCsv(res, rows, name, username) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameWithUser(name, username)}.csv"`);
    res.send('\uFEFF' + toCsv(rows));
  }
  function sendTxt(res, rows, name, username) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameWithUser(name, username)}.txt"`);
    res.send('\uFEFF' + toTxt(rows, '|'));
  }
  async function sendXlsx(res, rows, name, username, pctCols = []) {
    const buf = await toXlsxBuffer(rows, name, pctCols, username);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameWithUser(name, username)}.xlsx"`);
    res.send(Buffer.from(buf));
  }
  async function sendXlsxMulti(res, sheets, name, username) {
    const buf = await toXlsxMultiSheet(sheets, username);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameWithUser(name, username)}.xlsx"`);
    res.send(Buffer.from(buf));
  }
  function sendPdf(res, buf, name, username) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameWithUser(name, username)}.pdf"`);
    res.send(buf);
  }

  app.post('/api/export', handler(async (req, res) => {
    const { source, format = 'csv', filename = 'export', sql, limit } = req.body || {};
    const tab = EXPORT_SOURCE_TAB[source];
    if (!tab) return res.status(400).json({ error: 'Unknown export source.' });
    if (!Auth.userCan(req.user, tab)) return res.status(403).json({ error: 'You do not have access to this export.' });
    const username = req.user.username;
    await Auth.logEvent(req.user.id, username, 'export', `${source} (${format}) as "${filename}"`);
    let rows;
    let pctCols = [];
    if (source === 'sql' || source === 'ask_result') {
      const v = validateAdHoc(sql);
      if (!v.ok) return res.status(400).json({ error: v.error });
      rows = await runQuery(capRows(v.sql, limit || 100000), {});
    } else if (source === 'growth_top_funds') {
      const q = Q.largestFundsAum(req.body.groupBy, req.body.date, req.body.excludeFunds);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'transactions') {
      const q = Q.transactions({ ...req.body.filters, limit: limit || 100000, offset: 0 });
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'churn_risk') {
      const r = await ML.churnPredictions(limit || 5000);
      rows = r.top;
    } else if (source === 'aum_history') {
      const q = Q.aumHistory(req.body.from, req.body.to, req.body.granularity);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'product_performance') {
      const q = Q.productPerformance();
      rows = await runQuery(q.sql, q.params);
      pctCols = ['pct_change'];
    } else if (source === 'product_performance_detail') {
      const q = Q.productPerformanceDetail();
      const detail = await runQuery(q.sql, q.params);
      if (format === 'xlsx') return sendXlsxMulti(res, pivotPerformanceByType(detail), filename, username);
      rows = detail;
    } else if (source === 'portfolio_full') {
      const { userId, sid, date } = req.body;
      if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
      const h = date ? Q.userHoldingsAsOf(sid, date) : Q.userHoldings(userId);
      const pq = Q.productPerformanceDetail();
      const [holdings, detail] = await Promise.all([
        runQuery(h.sql, h.params),
        runQuery(pq.sql, pq.params),
      ]);
      if (format === 'pdf') {
        const { includePerformance = true, columns } = req.body;
        const c = Q.userContact(userId);
        const [contact] = await runQuery(c.sql, c.params, { redact: false });
        const perf = includePerformance ? pivotPerformanceByType(detail) : [];
        const buf = await PDF.portfolioReport({ contact, holdings }, perf, { columns, username });
        return sendPdf(res, buf, filename, username);
      }
      const sheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
      if (format === 'xlsx') return sendXlsxMulti(res, sheets, filename, username);
      rows = sheets[0].rows; // CSV has no sheets — holdings only
    } else if (source === 'portfolio_fix_full') {
      // Same as portfolio_full, sourced from portfolio_fix instead of
      // portfolio_with_code for the as-of-date snapshot (see userHoldingsAsOfFix).
      const { userId, sid, date, excludeFunds } = req.body;
      if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
      const h = date ? Q.userHoldingsAsOfFix(sid, date) : Q.userHoldings(userId);
      const pq = Q.productPerformanceDetail();
      const [holdingsRaw, detail] = await Promise.all([
        runQuery(h.sql, h.params),
        runQuery(pq.sql, pq.params),
      ]);
      // Client-side checklist for excluding dust/unwanted holdings (e.g. a
      // leftover 1-unit balance) from the export without hiding them on screen.
      const holdings = Array.isArray(excludeFunds) && excludeFunds.length
        ? holdingsRaw.filter((r) => !excludeFunds.includes(r.fund))
        : holdingsRaw;
      if (format === 'pdf') {
        const { includePerformance = true, columns } = req.body;
        const c = Q.userContact(userId);
        const [contact] = await runQuery(c.sql, c.params, { redact: false });
        const perf = includePerformance ? pivotPerformanceByType(detail) : [];
        const buf = await PDF.portfolioReport({ contact, holdings }, perf, { columns, username });
        return sendPdf(res, buf, filename, username);
      }
      const fixSheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
      if (format === 'xlsx') return sendXlsxMulti(res, fixSheets, filename, username);
      rows = fixSheets[0].rows; // CSV has no sheets — holdings only
    } else if (source === 'portfolio_tx_full') {
      // Same as portfolio_full, but holdings come from userHoldingsFromTx /
      // userHoldingsFromTxAsOf (avg_buy_price derived from the transaction ledger).
      const { userId, date, excludeFunds } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId is required.' });
      const h = date ? Q.userHoldingsFromTxAsOf(userId, date) : Q.userHoldingsFromTx(userId);
      const pq = Q.productPerformanceDetail();
      const [holdingsRaw, detail] = await Promise.all([
        runQuery(h.sql, h.params),
        runQuery(pq.sql, pq.params),
      ]);
      const holdings = Array.isArray(excludeFunds) && excludeFunds.length
        ? holdingsRaw.filter((r) => !excludeFunds.includes(r.fund))
        : holdingsRaw;
      if (format === 'pdf') {
        const { includePerformance = true, columns } = req.body;
        const c = Q.userContact(userId);
        const [contact] = await runQuery(c.sql, c.params, { redact: false });
        const perf = includePerformance ? pivotPerformanceByType(detail) : [];
        const buf = await PDF.portfolioReport({ contact, holdings }, perf, { columns, username });
        return sendPdf(res, buf, filename, username);
      }
      const txSheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
      if (format === 'xlsx') return sendXlsxMulti(res, txSheets, filename, username);
      rows = txSheets[0].rows; // CSV has no sheets — holdings only
    } else if (source === 'portfolio_sinvest_full') {
      // Same as portfolio_tx_full, but holdings come from the custodian feed
      // (sinvestHoldings / sinvestHoldingsAsOf) instead of main.transactions.
      const { userId, sid, date, excludeFunds } = req.body;
      if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
      const h = date ? Q.sinvestHoldingsAsOf(sid, date) : Q.sinvestHoldings(sid);
      const pq = Q.productPerformanceDetail();
      const [holdingsRawSi, detail] = await Promise.all([
        runQuery(h.sql, h.params),
        runQuery(pq.sql, pq.params),
      ]);
      const holdingsSi = Array.isArray(excludeFunds) && excludeFunds.length
        ? holdingsRawSi.filter((r) => !excludeFunds.includes(r.fund))
        : holdingsRawSi;
      if (format === 'pdf') {
        const { includePerformance = true, columns } = req.body;
        const c = Q.userContact(userId);
        const [contact] = await runQuery(c.sql, c.params, { redact: false });
        const perf = includePerformance ? pivotPerformanceByType(detail) : [];
        const buf = await PDF.portfolioReport({ contact, holdings: holdingsSi }, perf, { columns, username });
        return sendPdf(res, buf, filename, username);
      }
      const siSheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdingsSi) }, ...pivotPerformanceByType(detail)];
      if (format === 'xlsx') return sendXlsxMulti(res, siSheets, filename, username);
      rows = siSheets[0].rows; // CSV has no sheets — holdings only
    } else if (source === 'portfolio_explorer_full') {
      // Same shape/columns as portfolio_full, sourced from goal_snapshots as
      // of a given date instead of the live portfolios/bonus_portfolios
      // tables — always merged across goals, never split by goal, even
      // though the preview also offers a by-goal breakdown.
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId is required.' });
      let asOfDate = req.body.date;
      if (!asOfDate) {
        const d = Q.goalLatestSnapshotDate(userId);
        const [row] = await runQuery(d.sql, d.params);
        asOfDate = row?.latest_date;
      }
      if (!asOfDate) return res.status(400).json({ error: 'No goal_snapshots found for this user.' });
      const h = Q.goalUserHoldings(userId, asOfDate);
      const pq = Q.productPerformanceDetail();
      const [holdings, detail] = await Promise.all([
        runQuery(h.sql, h.params),
        runQuery(pq.sql, pq.params),
      ]);
      if (format === 'pdf') {
        const { includePerformance = true, columns } = req.body;
        const c = Q.userContact(userId);
        const [contact] = await runQuery(c.sql, c.params, { redact: false });
        const perf = includePerformance ? pivotPerformanceByType(detail) : [];
        const buf = await PDF.portfolioReport({ contact, holdings }, perf, { columns, username });
        return sendPdf(res, buf, filename, username);
      }
      const sheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
      if (format === 'xlsx') return sendXlsxMulti(res, sheets, filename, username);
      rows = sheets[0].rows; // CSV has no sheets — holdings only
    } else if (source === 'explore') {
      const { dataset, filters } = req.body;
      const built = EX.buildExplore(dataset, { ...filters, limit: limit || 100000, offset: 0 });
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
      const q = Q.reconciliationDaily(req.body.from, req.body.to);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'revenue_detail' || source === 'revenue_v2_detail') {
      const q = source === 'revenue_detail'
        ? Q.revenueDetail(req.body.from, req.body.to, req.body.granularity, req.body.fund, req.body.mi)
        : Q.revenueV2Detail(req.body.from, req.body.to, req.body.granularity, req.body.fund, req.body.mi);
      const detail = await runQuery(q.sql, q.params);
      const { splitBy } = req.body; // 'fund' | 'mi' | undefined — xlsx only, one sheet per value
      if (format === 'xlsx' && (splitBy === 'fund' || splitBy === 'mi')) {
        return sendXlsxMulti(res, splitRowsBySheet(detail, splitBy === 'fund' ? 'fund_name' : 'mi_name'), filename, username);
      }
      rows = detail;
    } else if (source === 'revenue_summary') {
      const q = Q.revenueMonthlySummary(req.body.from, req.body.to, req.body.granularity, req.body.fund, req.body.mi);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'revenue_v2_summary') {
      const q = Q.revenueV2MonthlySummary(req.body.from, req.body.to, req.body.granularity, req.body.fund, req.body.mi);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'user_lifetime_users') {
      const q = Q.userLifetimeUsers(req.body.from, req.body.to, req.body.fund, req.body.mi, req.body.sid, limit || 100000);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'user_lifetime_summary') {
      const q = Q.userLifetimeSummary(req.body.from, req.body.to, req.body.granularity, req.body.fund, req.body.mi);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'user_lifetime_detail') {
      if (!req.body.sid) return res.status(400).json({ error: 'sid is required.' });
      const q = Q.userLifetimeDetail(req.body.sid, req.body.from, req.body.to, req.body.granularity, req.body.fund, req.body.mi);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'campaign_revenue_detail') {
      const q = Q.campaignRevenueDetail(req.body.from, req.body.to, req.body.granularity, req.body.promo);
      const detail = await runQuery(q.sql, q.params);
      if (format === 'xlsx' && req.body.splitBy === 'promo') {
        return sendXlsxMulti(res, splitRowsBySheet(detail, 'promo_code'), filename, username);
      }
      rows = detail;
    } else if (source === 'campaign_revenue_campaigns') {
      const q = Q.campaignRevenueByCampaign(req.body.from, req.body.to, req.body.promo);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'campaign_revenue_summary') {
      const q = Q.campaignRevenueSummary(req.body.from, req.body.to, req.body.granularity, req.body.promo);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'remisier_revenue_detail' || source === 'remisier_revenue_summary') {
      const { field, code, from, to, granularity, portion } = req.body;
      if (!code) return res.status(400).json({ error: 'code is required.' });
      const args = [field, code, from, to, granularity, Number(portion) || 0];
      const q = source === 'remisier_revenue_detail' ? Q.remisierRevenueDetail(...args) : Q.remisierRevenueSummary(...args);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'remisier_revenue_pwc_detail' || source === 'remisier_revenue_pwc_summary') {
      const { field, code, from, to, granularity, portion } = req.body;
      if (!code) return res.status(400).json({ error: 'code is required.' });
      const args = [field, code, from, to, granularity, Number(portion) || 0];
      const q = source === 'remisier_revenue_pwc_detail' ? Q.remisierRevenuePwcDetail(...args) : Q.remisierRevenuePwcSummary(...args);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'remisier_transactions') {
      const referrerCodes = req.body.referrerCodes || [];
      const salesCodes = req.body.salesCodes || [];
      if (!referrerCodes.length && !salesCodes.length) return res.status(400).json({ error: 'At least one referrer_code or sales_code is required.' });
      const q = Q.remisierTransactions({ referrerCodes, salesCodes, type: req.body.type, status: req.body.status, from: req.body.from, to: req.body.to, limit: limit || 100000, offset: 0 });
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'sinvest_transactions') {
      const q = Q.sinvestTransactions({ from: req.body.from, to: req.body.to, type: req.body.type, sid: req.body.sid, search: req.body.search, limit: limit || 100000, offset: 0 });
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'hnwi_total') {
      if (!req.body.date) return res.status(400).json({ error: 'date is required.' });
      const q = Q.hnwiTotal(req.body.date, req.body.minAum, limit || 5000);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'hnwi_by_fund') {
      if (!req.body.date) return res.status(400).json({ error: 'date is required.' });
      const q = Q.hnwiByFund(req.body.date, req.body.minAum, limit || 20000);
      rows = await runQuery(q.sql, q.params);
    } else {
      return res.status(400).json({ error: 'Unknown export source.' });
    }
    if (format === 'xlsx') return sendXlsx(res, rows, filename, username, pctCols);
    if (format === 'txt') return sendTxt(res, rows, filename, username);
    return sendCsv(res, rows, filename, username);
  }));

  // ---- Static frontend (standalone hosts only) ------------------------------
  if (serveStatic) {
    const pub = path.join(__dirname, '..', 'public');
    app.use(express.static(pub));
    app.get('*', (_req, res) => res.sendFile(path.join(pub, 'index.html')));
  }

  return app;
}

module.exports = { createApp };
