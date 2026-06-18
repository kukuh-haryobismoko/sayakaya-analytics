'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const {
  runQuery, dryRun, validateAdHoc, capRows, PROJECT_ID, MAX_BYTES_BILLED,
} = require('./bigquery');
const Q = require('./queries');
const { toCsv, toXlsxBuffer } = require('./export');
const { ask, askEnabled } = require('./ask');
const EX = require('./explore');
const ML = require('./ml');

const APP_PASSWORD = process.env.APP_PASSWORD || '';

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
    } else if (source === 'explore') {
      const { dataset, filters } = req.body;
      const built = EX.buildExplore(dataset, { ...filters, limit: limit || 100000, offset: 0 });
      rows = await runQuery(built.sql, built.params);
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
