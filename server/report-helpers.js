'use strict';

// Shared report-building helpers used by both the manual send routes in
// app.js and the automated scheduler in schedules.js — pulled out on their
// own so the two never drift apart on what a "statement send" or a "fund
// performance send" actually produces.

const { runQuery } = require('./bigquery');
const Q = require('./queries');
const PDF = require('./pdf');

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

// Pivot flat (type, name, period, pct_change) rows into one fund-per-row
// table per fund type — used for the per-type Excel sheets and the PDF.
// Also tracks the latest latest_nav_date seen per type as `asOf`, so the PDF
// can print the real NAV date behind the numbers instead of "today".
function pivotPerformanceByType(rows) {
  const byType = {};
  for (const r of rows) {
    const type = r.type || '(none)';
    const t = (byType[type] = byType[type] || { byFund: {}, asOf: null });
    const fund = (t.byFund[r.name] = t.byFund[r.name] || {
      Fund: r.name, NAV: r.latest_nav, ipoDate: r.ipo_date ? PDF.val(r.ipo_date) : null,
    });
    fund[r.period] = r.pct_change;
    const d = r.latest_nav_date ? PDF.val(r.latest_nav_date) : null;
    if (d && (!t.asOf || d > t.asOf)) t.asOf = d;
  }
  return Object.keys(byType).sort().map((type) => ({
    name: type,
    asOf: byType[type].asOf,
    rows: Object.values(byType[type].byFund).map((f) => {
      const out = { Fund: f.Fund, NAV: f.NAV, ipoDate: f.ipoDate };
      for (const p of PERF_PERIODS) out[p] = f[p] ?? null;
      return out;
    }),
    pctCols: PERF_PERIODS,
  }));
}

// PDF open-password: the investor's own birthdate as DDMMYYYY. null when
// there's no birthdate on file, so the caller skips encrypting the PDF.
function birthdatePassword(birthdate) {
  const s = PDF.val(birthdate);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}${m[2]}${m[1]}` : null;
}

// Builds the 1-2 statement PDF attachments (and applies the shared
// birthdate-derived open-password) for one investor — reused by
// /api/statement/email (single), /api/statement/email-batch (many), and the
// scheduler (server/schedules.js). Throws on a missing/malformed
// statementMonth so the caller decides how to report it (fail the whole
// request vs. one recipient vs. one queued send).
async function buildStatementAttachments({ userId, sid, contact, sendPortfolio, portfolioDate, sendStatement, statementMonth, username }) {
  const password = birthdatePassword(contact.birthdate);
  const attachments = [];

  if (sendPortfolio) {
    const h = portfolioDate ? Q.userHoldingsAsOfFix(sid, portfolioDate) : Q.userHoldings(userId);
    const holdings = await runQuery(h.sql, h.params);
    // Portfolio-only, no fund-performance pages — this tool never sends performance.
    const buf = await PDF.portfolioReport({ contact, holdings }, [], { username, password });
    attachments.push({ filename: `Portfolio_${sid}${portfolioDate ? '_' + portfolioDate : ''}.pdf`, content: buf });
  }

  if (sendStatement) {
    const [year, month] = String(statementMonth || '').split('-').map(Number);
    if (!year || !month) throw new Error('statementMonth is required (YYYY-MM).');
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); // last day of that month
    const t = Q.userTransactions(userId, from, to);
    const transactions = await runQuery(t.sql, t.params);
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const buf = await PDF.transactionStatement({ contact, transactions }, monthLabel, { username, password });
    attachments.push({ filename: `Transaction_Statement_${sid}_${statementMonth}.pdf`, content: buf });
  }

  return attachments;
}

// The previous calendar month as 'YYYY-MM' — the sensible default e-statement
// period for a recurring/automated send (there's no "chosen month" input the
// way the manual tool has one).
function previousMonthYYYYMM(from = new Date()) {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth(); // 0-based; m-1 is last month in the same terms
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
  pivotPerformanceByType,
  birthdatePassword,
  buildStatementAttachments,
  previousMonthYYYYMM,
};
