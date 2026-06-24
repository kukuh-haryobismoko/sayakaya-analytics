'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const {
  runQuery, dryRun, validateAdHoc, capRows, PROJECT_ID, MAX_BYTES_BILLED,
} = require('./bigquery');
const Q = require('./queries');
const { toCsv, toXlsxBuffer, toXlsxMultiSheet } = require('./export');
const { ask, askEnabled } = require('./ask');
const EX = require('./explore');
const ML = require('./ml');

const APP_PASSWORD = process.env.APP_PASSWORD || '';

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];

// Pivot flat (type, name, period, pct_change) rows into one fund-per-row
// table per fund type — used for the per-type Excel sheets.
function pivotPerformanceByType(rows) {
  const byType = {};
  for (const r of rows) {
    const type = r.type || '(none)';
    const byFund = (byType[type] = byType[type] || {});
    const fund = (byFund[r.name] = byFund[r.name] || { Fund: r.name });
    fund[r.period] = r.pct_change;
  }
  return Object.keys(byType).sort().map((type) => ({
    name: type,
    rows: Object.values(byType[type]).map((f) => {
      const out = { Fund: f.Fund };
      for (const p of PERF_PERIODS) out[p] = f[p] ?? null;
      return out;
    }),
  }));
}

// Friendly column names for the "Portfolio" sheet in the combined export.
function portfolioSheetRows(holdings) {
  return holdings.map((h) => ({
    Fund: h.fund, Type: h.fund_type, Source: h.source,
    Units: h.unit, NAV: h.nav, Value: h.value, Opened: h.opened_at,
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
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  // ---- Optional shared-password gate ----------------------------------------
  app.use('/api', (req, res, next) => {
    if (!APP_PASSWORD) return next();
    if (req.path === '/health') return next();
    if (req.get('x-app-password') === APP_PASSWORD) return next();
    return res.status(401).json({ error: 'Unauthorized. Check the app password.' });
  });

  const handler = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.path}]`, err.message);
      res.status(500).json({ error: err.message || 'Query failed.' });
    }
  };

  // ---- Health ---------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, project: PROJECT_ID, passwordProtected: Boolean(APP_PASSWORD), askEnabled: askEnabled() });
  });

  // ---- Overview (KPIs) ------------------------------------------------------
  app.get('/api/overview', handler(async (req, res) => {
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
  app.get('/api/trends', handler(async (req, res) => {
    const { from, to, granularity } = req.query;
    const q = Q.trends(from, to, granularity);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Breakdowns -----------------------------------------------------------
  app.get('/api/breakdown/:dimension', handler(async (req, res) => {
    const { from, to } = req.query;
    const q = Q.breakdownBy(req.params.dimension, from, to);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Funds ----------------------------------------------------------------
  app.get('/api/funds/top', handler(async (req, res) => {
    const q = Q.topFunds(req.query.limit || 10);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/funds/types', handler(async (_req, res) => {
    const q = Q.fundTypes();
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Users ----------------------------------------------------------------
  app.get('/api/users/growth', handler(async (_req, res) => {
    const q = Q.userGrowth();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/verification', handler(async (_req, res) => {
    const q = Q.verificationBreakdown();
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Transactions explorer ------------------------------------------------
  app.get('/api/transactions/filters', handler(async (_req, res) => {
    const q = Q.txFilterValues();
    const rows = await runQuery(q.sql, q.params);
    res.json(rows[0] || { types: [], statuses: [] });
  }));

  app.get('/api/transactions', handler(async (req, res) => {
    const q = Q.transactions(req.query);
    const [rows, countRows] = await Promise.all([
      runQuery(q.sql, q.params),
      runQuery(q.countSql, q.params),
    ]);
    res.json({ rows, total: Number(countRows[0]?.total || 0) });
  }));

  // ---- AUM history (mi_fee_logs.mi_fee) -------------------------------------
  app.get('/api/aum-history', handler(async (req, res) => {
    const { from, to, granularity } = req.query;
    const q = Q.aumHistory(from, to, granularity);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- User portfolio lookup (search by SID, print one user's portfolio) ----
  app.get('/api/users/search', handler(async (req, res) => {
    const q = Q.userSearch(req.query.q);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/portfolio', handler(async (req, res) => {
    const { userId, sid } = req.query;
    if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
    const h = Q.userHoldings(userId);
    const p = Q.userPerformance(sid);
    const a = Q.userAumHistory(sid);
    const [holdings, performance, history] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(p.sql, p.params),
      runQuery(a.sql, a.params),
    ]);
    res.json({ holdings, performance, history });
  }));

  // ---- Product performance (NAV % change per fund type, external Apollo DB) --
  app.get('/api/product-performance', handler(async (_req, res) => {
    const q = Q.productPerformance();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/product-performance/detail', handler(async (_req, res) => {
    const q = Q.productPerformanceDetail();
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Growth: campaigns, referrals, switching, manager/demographic AUM -----
  app.get('/api/campaigns/performance', handler(async (req, res) => {
    const q = Q.campaignPerformance(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/switching/top-pairs', handler(async (req, res) => {
    const q = Q.switchingTopPairs(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/funds/by-manager', handler(async (req, res) => {
    const q = Q.aumByManager(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/aum-by-risk', handler(async (_req, res) => {
    const q = Q.aumByRisk();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/users/aum-by-income', handler(async (_req, res) => {
    const q = Q.aumByIncome();
    res.json(await runQuery(q.sql, q.params));
  }));
  app.get('/api/referrals/top', handler(async (req, res) => {
    const q = Q.topReferrers(req.query.limit);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Reconciliation: app ledger vs custodian (sinvest) feed ----------------
  app.get('/api/reconciliation', handler(async (req, res) => {
    const { from, to } = req.query;
    const q = Q.reconciliationDaily(from, to);
    res.json(await runQuery(q.sql, q.params));
  }));

  // ---- Predictive models (BigQuery ML) --------------------------------------
  app.get('/api/ml/status', async (_req, res) => {
    try {
      const models = await ML.status();
      res.json({ ready: models.length > 0, models });
    } catch {
      res.json({ ready: false, models: [] }); // ml dataset not created yet
    }
  });
  app.get('/api/predict/aum', handler(async (req, res) => res.json(await ML.aumForecast(req.query.horizon))));
  app.get('/api/predict/transactions', handler(async (req, res) => res.json(await ML.txForecast(req.query.horizon))));
  app.get('/api/predict/churn', handler(async (req, res) => res.json(await ML.churnPredictions(req.query.limit))));
  app.get('/api/churn/overview', handler(async (_req, res) => res.json(await ML.churnOverview())));
  app.get('/api/retention/cohorts', handler(async (req, res) => res.json(await ML.retentionCohorts(req.query.months))));

  // ---- Generic multi-table explorer -----------------------------------------
  app.get('/api/explore/_meta', handler(async (_req, res) => {
    res.json(EX.meta());
  }));

  app.get('/api/explore/:dataset/filters/:filter', handler(async (req, res) => {
    const sql = EX.filterValuesSql(req.params.dataset, req.params.filter);
    if (!sql) return res.json({ values: [] });
    const rows = await runQuery(sql, {});
    res.json({ values: rows.map((r) => r.v).filter((v) => v !== null) });
  }));

  app.get('/api/explore/:dataset', handler(async (req, res) => {
    const { sql, countSql, params } = EX.buildExplore(req.params.dataset, req.query);
    const [rows, countRows] = await Promise.all([
      runQuery(sql, params),
      runQuery(countSql, params),
    ]);
    res.json({ rows, total: Number(countRows[0]?.total || 0) });
  }));

  // ---- Ask (natural language -> SQL via Anthropic) --------------------------
  app.post('/api/ask', async (req, res) => {
    const question = (req.body && req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Type a question first.' });
    try {
      const { sql, rows } = await ask(question);
      res.json({ sql, rows, count: rows.length });
    } catch (err) {
      console.error('[POST /api/ask]', err.message);
      res.status(400).json({ error: err.message, sql: err.sql || null });
    }
  });

  // ---- SQL Lab --------------------------------------------------------------
  app.post('/api/sql/estimate', handler(async (req, res) => {
    const v = validateAdHoc(req.body.sql);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { bytes } = await dryRun(capRows(v.sql, req.body.limit || 5000));
    res.json({ bytes, withinLimit: bytes <= Number(MAX_BYTES_BILLED) });
  }));

  app.post('/api/sql/run', handler(async (req, res) => {
    const v = validateAdHoc(req.body.sql);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const rows = await runQuery(capRows(v.sql, req.body.limit || 5000), {});
    res.json({ rows, count: rows.length });
  }));

  // ---- Exports --------------------------------------------------------------
  function sendCsv(res, rows, name) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.send('\uFEFF' + toCsv(rows));
  }
  async function sendXlsx(res, rows, name) {
    const buf = await toXlsxBuffer(rows, name);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(Buffer.from(buf));
  }

  app.post('/api/export', handler(async (req, res) => {
    const { source, format = 'csv', filename = 'export', sql, limit } = req.body || {};
    let rows;
    if (source === 'sql') {
      const v = validateAdHoc(sql);
      if (!v.ok) return res.status(400).json({ error: v.error });
      rows = await runQuery(capRows(v.sql, limit || 100000), {});
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
    } else if (source === 'product_performance_detail') {
      const q = Q.productPerformanceDetail();
      const detail = await runQuery(q.sql, q.params);
      if (format === 'xlsx') {
        const buf = await toXlsxMultiSheet(pivotPerformanceByType(detail));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(Buffer.from(buf));
      }
      rows = detail;
    } else if (source === 'portfolio_full') {
      const { userId, sid } = req.body;
      if (!userId || !sid) return res.status(400).json({ error: 'userId and sid are required.' });
      const h = Q.userHoldings(userId);
      const pq = Q.productPerformanceDetail();
      const [holdings, detail] = await Promise.all([
        runQuery(h.sql, h.params),
        runQuery(pq.sql, pq.params),
      ]);
      const sheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
      if (format === 'xlsx') {
        const buf = await toXlsxMultiSheet(sheets);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(Buffer.from(buf));
      }
      rows = sheets[0].rows; // CSV has no sheets — holdings only
    } else if (source === 'explore') {
      const { dataset, filters } = req.body;
      const built = EX.buildExplore(dataset, { ...filters, limit: limit || 100000, offset: 0 });
      rows = await runQuery(built.sql, built.params);
    } else if (source === 'campaigns_performance') {
      const q = Q.campaignPerformance(limit || 1000);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'switching_pairs') {
      const q = Q.switchingTopPairs(limit || 1000);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'referrals_top') {
      const q = Q.topReferrers(limit || 1000);
      rows = await runQuery(q.sql, q.params);
    } else if (source === 'reconciliation') {
      const q = Q.reconciliationDaily(req.body.from, req.body.to);
      rows = await runQuery(q.sql, q.params);
    } else {
      return res.status(400).json({ error: 'Unknown export source.' });
    }
    if (format === 'xlsx') return sendXlsx(res, rows, filename);
    return sendCsv(res, rows, filename);
  }));

  // ---- Static frontend (standalone hosts only) ------------------------------
  if (serveStatic) {
    const pub = path.join(__dirname, '..', 'public');
    app.use(express.static(pub));
    app.get('*', (_req, res) => res.sendFile(path.join(pub, 'index.html')));
  }

  return app;
}

module.exports = { createApp, APP_PASSWORD };
