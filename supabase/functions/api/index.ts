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

const APP_PASSWORD = Deno.env.get('APP_PASSWORD') || '';

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];

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

// Friendly column names for the "Portfolio" sheet in the combined export.
function portfolioSheetRows(holdings: Record<string, unknown>[]) {
  return holdings.map((h) => ({
    Fund: h.fund, Type: h.fund_type,
    Units: h.unit, 'Avg Buy Price': h.avg_buy_price, NAV: h.nav, Value: h.value, Opened: h.opened_at,
  }));
}

// ---- Response helpers -----------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type, x-app-password',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function csvResponse(rows: Record<string, unknown>[], name: string): Response {
  return new Response('﻿' + toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.csv"`,
    },
  });
}

function txtResponse(rows: Record<string, unknown>[], name: string): Response {
  return new Response('﻿' + toTxt(rows, '|'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.txt"`,
    },
  });
}

async function xlsxResponse(rows: Record<string, unknown>[], name: string, pctCols: string[] = []): Promise<Response> {
  const buf = await toXlsxBuffer(rows, name, pctCols);
  return new Response(buf, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}.xlsx"`,
    },
  });
}

async function xlsxMultiResponse(sheets: { name: string; rows: Record<string, unknown>[]; pctCols?: string[] }[], name: string): Promise<Response> {
  const buf = await toXlsxMultiSheet(sheets);
  return new Response(buf, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}.xlsx"`,
    },
  });
}

// ---- Tiny router ------------------------------------------------------------
type Handler = (req: Request, params: Record<string, string>, url: URL) => Promise<Response> | Response;
interface Route { method: string; pattern: URLPattern; handler: Handler }
const routes: Route[] = [];
function on(method: string, pathname: string, handler: Handler) {
  routes.push({ method, pattern: new URLPattern({ pathname }), handler });
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
  return json({
    ok: true, project: PROJECT_ID, bigquery,
    passwordProtected: Boolean(APP_PASSWORD), askEnabled: askEnabled(),
  });
});

// ---- Overview (KPIs) ------------------------------------------------------
on('GET', '/api/overview', async (_req, _params, url) => {
  const from = qp(url, 'from'); const to = qp(url, 'to');
  const [users, aum, tx, funds] = await Promise.all([
    runQuery(Q.overviewUsers().sql, Q.overviewUsers().params),
    runQuery(Q.overviewAum().sql, Q.overviewAum().params),
    runQuery(Q.overviewTx(from, to).sql, Q.overviewTx(from, to).params),
    runQuery(Q.overviewFunds().sql, Q.overviewFunds().params),
  ]);
  return json({ ...users[0], ...aum[0], ...tx[0], ...funds[0] });
});

// ---- Trends ---------------------------------------------------------------
on('GET', '/api/trends', async (_req, _params, url) => {
  const q = Q.trends(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'));
  return json(await runQuery(q.sql, q.params));
});

// ---- Breakdowns -----------------------------------------------------------
on('GET', '/api/breakdown/:dimension', async (_req, params, url) => {
  const q = Q.breakdownBy(params.dimension, qp(url, 'from'), qp(url, 'to'));
  return json(await runQuery(q.sql, q.params));
});

// ---- Funds ----------------------------------------------------------------
on('GET', '/api/funds/top', async (_req, _params, url) => {
  const q = Q.topFunds(qp(url, 'limit') || 10);
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/funds/types', async () => {
  const q = Q.fundTypes();
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/funds/list', async (_req, _params, url) => {
  const q = Q.fundList(qp(url, 'type'));
  return json(await runQuery(q.sql, q.params));
});

// ---- Users ----------------------------------------------------------------
on('GET', '/api/users/growth', async () => {
  const q = Q.userGrowth();
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/users/verification', async () => {
  const q = Q.verificationBreakdown();
  return json(await runQuery(q.sql, q.params));
});

// ---- Transactions explorer ------------------------------------------------
on('GET', '/api/transactions/filters', async () => {
  const q = Q.txFilterValues();
  const rows = await runQuery(q.sql, q.params);
  return json(rows[0] || { types: [], statuses: [] });
});
on('GET', '/api/transactions', async (_req, _params, url) => {
  const q = Q.transactions({
    from: qp(url, 'from'), to: qp(url, 'to'), type: qp(url, 'type'), status: qp(url, 'status'),
    search: qp(url, 'search'), limit: qp(url, 'limit') ?? 50, offset: qp(url, 'offset') ?? 0,
  });
  const [rows, countRows] = await Promise.all([
    runQuery(q.sql, q.params),
    runQuery(q.countSql!, q.params),
  ]);
  return json({ rows, total: Number(countRows[0]?.total || 0) });
});

// ---- AUM history (mi_fee_logs.mi_fee) -------------------------------------
on('GET', '/api/aum-history', async (_req, _params, url) => {
  const q = Q.aumHistory(qp(url, 'from'), qp(url, 'to'), qp(url, 'granularity'));
  return json(await runQuery(q.sql, q.params));
});

// ---- User portfolio lookup (search by SID, print one user's portfolio) ----
on('GET', '/api/users/search', async (_req, _params, url) => {
  const q = Q.userSearch(qp(url, 'q'));
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/portfolio', async (_req, _params, url) => {
  const userId = qp(url, 'userId'); const sid = qp(url, 'sid');
  if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
  const h = Q.userHoldings(userId);
  const s = Q.userPortfolioSplit(userId);
  const p = Q.userPerformance(sid);
  const a = Q.userAumHistory(sid);
  const [holdings, splitRows, performance, history] = await Promise.all([
    runQuery(h.sql, h.params),
    runQuery(s.sql, s.params),
    runQuery(p.sql, p.params),
    runQuery(a.sql, a.params),
  ]);
  return json({ holdings, split: splitRows[0], performance, history });
});

// ---- Product performance (NAV % change per fund type) ----------------------
on('GET', '/api/product-performance', async () => {
  const q = Q.productPerformance();
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/product-performance/detail', async () => {
  const q = Q.productPerformanceDetail();
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/product-performance/trend', async (_req, _params, url) => {
  const q = Q.fundNavTrend({
    type: qp(url, 'type'), period: qp(url, 'period'), limit: qp(url, 'limit'),
    funds: qpAll(url, 'funds'),
  });
  return json(await runQuery(q.sql, q.params));
});

// ---- Growth: campaigns, referrals, switching, manager/demographic AUM -----
on('GET', '/api/campaigns/performance', async (_req, _params, url) => {
  const q = Q.campaignPerformance(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/switching/top-pairs', async (_req, _params, url) => {
  const q = Q.switchingTopPairs(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/funds/by-manager', async (_req, _params, url) => {
  const q = Q.aumByManager(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/users/aum-by-risk', async () => {
  const q = Q.aumByRisk();
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/users/aum-by-income', async () => {
  const q = Q.aumByIncome();
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/referrals/top', async (_req, _params, url) => {
  const q = Q.topReferrers(qp(url, 'limit'));
  return json(await runQuery(q.sql, q.params));
});

// ---- Reconciliation: app ledger vs custodian (sinvest) feed ----------------
on('GET', '/api/reconciliation', async (_req, _params, url) => {
  const q = Q.reconciliationDaily(qp(url, 'from'), qp(url, 'to'));
  return json(await runQuery(q.sql, q.params));
});

// ---- Revenue: management fee earned per fund/month -------------------------
on('GET', '/api/revenue', async (_req, _params, url) => {
  const q = Q.revenueDetail(qp(url, 'from'), qp(url, 'to'));
  return json(await runQuery(q.sql, q.params));
});
on('GET', '/api/revenue/summary', async (_req, _params, url) => {
  const q = Q.revenueMonthlySummary(qp(url, 'from'), qp(url, 'to'));
  return json(await runQuery(q.sql, q.params));
});

// ---- Predictive models (BigQuery ML) --------------------------------------
on('GET', '/api/ml/status', async () => {
  try {
    const models = await ML.status();
    return json({ ready: models.length > 0, models });
  } catch {
    return json({ ready: false, models: [] }); // ml dataset not created yet
  }
});
on('GET', '/api/predict/aum', async (_req, _params, url) => json(await ML.aumForecast(qp(url, 'horizon'))));
on('GET', '/api/predict/transactions', async (_req, _params, url) => json(await ML.txForecast(qp(url, 'horizon'))));
on('GET', '/api/predict/churn', async (_req, _params, url) => json(await ML.churnPredictions(qp(url, 'limit'))));
on('GET', '/api/churn/overview', async () => json(await ML.churnOverview()));
on('GET', '/api/retention/cohorts', async (_req, _params, url) => json(await ML.retentionCohorts(qp(url, 'months'))));

// ---- Generic multi-table explorer -----------------------------------------
on('GET', '/api/explore/_meta', () => json(EX.meta()));

on('GET', '/api/explore/:dataset/filters/:filter', async (_req, params) => {
  const sql = EX.filterValuesSql(params.dataset, params.filter);
  if (!sql) return json({ values: [] });
  const rows = await runQuery(sql, {});
  return json({ values: rows.map((r) => r.v).filter((v) => v !== null) });
});

on('GET', '/api/explore/:dataset', async (_req, params, url) => {
  const q: Record<string, string | undefined> = Object.fromEntries(url.searchParams.entries());
  const { sql, countSql, params: bqParams } = EX.buildExplore(params.dataset, q);
  const [rows, countRows] = await Promise.all([
    runQuery(sql, bqParams),
    runQuery(countSql, bqParams),
  ]);
  return json({ rows, total: Number(countRows[0]?.total || 0) });
});

// ---- Ask (natural language -> SQL via Anthropic) --------------------------
on('GET', '/api/ask/tables', () => json({ tables: TABLES }));

on('POST', '/api/ask', async (req) => {
  const body = await bodyOf(req);
  const question = String(body.question || '').trim();
  const context = String(body.context || '').trim() || null;
  if (!question) return json({ error: 'Type a question first.' }, 400);
  try {
    const { sql, rows } = await ask(question, context);
    return json({ sql, rows, count: rows.length });
  } catch (err) {
    console.error('[POST /api/ask]', (err as Error).message);
    return json({ error: (err as Error).message, sql: (err as { sql?: string }).sql || null }, 400);
  }
});

on('POST', '/api/ask/chart', async (req) => {
  const body = await bodyOf(req);
  const { question, rows, hint } = body as { question?: string; rows?: Record<string, unknown>[]; hint?: string };
  return json(await suggestChart(question, rows || [], hint));
});

// ---- SQL Lab --------------------------------------------------------------
on('POST', '/api/sql/estimate', async (req) => {
  const body = await bodyOf(req);
  const v = validateAdHoc(String(body.sql || ''));
  if (!v.ok) return json({ error: v.error }, 400);
  const { bytes } = await dryRun(capRows(v.sql, (body.limit as number) || 5000));
  return json({ bytes, withinLimit: bytes <= Number(MAX_BYTES_BILLED) });
});

on('POST', '/api/sql/run', async (req) => {
  const body = await bodyOf(req);
  const v = validateAdHoc(String(body.sql || ''));
  if (!v.ok) return json({ error: v.error }, 400);
  const rows = await runQuery(capRows(v.sql, (body.limit as number) || 5000), {});
  return json({ rows, count: rows.length });
});

// ---- Exports --------------------------------------------------------------
on('POST', '/api/export', async (req) => {
  const body = await bodyOf(req);
  const source = body.source as string;
  const format = (body.format as string) || 'csv';
  const filename = (body.filename as string) || 'export';
  const limit = body.limit as number | undefined;
  let rows: Record<string, unknown>[] = [];
  let pctCols: string[] = [];

  if (source === 'sql') {
    const v = validateAdHoc(String(body.sql || ''));
    if (!v.ok) return json({ error: v.error }, 400);
    rows = await runQuery(capRows(v.sql, limit || 100000), {});
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
    if (format === 'xlsx') return xlsxMultiResponse(pivotPerformanceByType(detail), filename);
    rows = detail;
  } else if (source === 'portfolio_full') {
    const userId = body.userId as string; const sid = body.sid as string;
    if (!userId || !sid) return json({ error: 'userId and sid are required.' }, 400);
    const h = Q.userHoldings(userId);
    const pq = Q.productPerformanceDetail();
    const [holdings, detail] = await Promise.all([
      runQuery(h.sql, h.params),
      runQuery(pq.sql, pq.params),
    ]);
    if (format === 'pdf') {
      const c = Q.userContact(userId);
      const [contact] = await runQuery(c.sql, c.params);
      const buf = await portfolioReport({ contact, holdings }, pivotPerformanceByType(detail));
      // Buffer (Node) satisfies BodyInit (a Uint8Array) at runtime, but the
      // two libraries' type declarations don't agree — wrap to satisfy both.
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filename}.pdf"`,
        },
      });
    }
    const sheets = [{ name: 'Portfolio', rows: portfolioSheetRows(holdings) }, ...pivotPerformanceByType(detail)];
    if (format === 'xlsx') return xlsxMultiResponse(sheets, filename);
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
  } else if (source === 'revenue_detail') {
    const q = Q.revenueDetail(body.from as string, body.to as string);
    rows = await runQuery(q.sql, q.params);
  } else if (source === 'revenue_summary') {
    const q = Q.revenueMonthlySummary(body.from as string, body.to as string);
    rows = await runQuery(q.sql, q.params);
  } else {
    return json({ error: 'Unknown export source.' }, 400);
  }

  if (format === 'xlsx') return xlsxResponse(rows, filename, pctCols);
  if (format === 'txt') return txtResponse(rows, filename);
  return csvResponse(rows, filename);
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

  if (APP_PASSWORD && pathname !== '/api/health' && req.headers.get('x-app-password') !== APP_PASSWORD) {
    return withCors(json({ error: 'Unauthorized. Check the app password.' }, 401));
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.pattern.exec({ pathname });
    if (!match) continue;
    try {
      const params = Object.fromEntries(
        Object.entries(match.pathname.groups).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      return withCors(await r.handler(req, params, url));
    } catch (err) {
      console.error(`[${req.method} ${pathname}]`, (err as Error).message);
      return withCors(json({ error: (err as Error).message || 'Query failed.' }, 500));
    }
  }
  return withCors(json({ error: 'Not found' }, 404));
});
