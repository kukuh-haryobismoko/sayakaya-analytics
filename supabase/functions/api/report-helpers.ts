// Ported from server/report-helpers.js — see that file for the full
// rationale. Shared by index.ts's manual send routes and schedules.ts's
// automated scheduler so the two never drift apart on what a "statement
// send" or a "fund performance send" actually produces. If you change this,
// change server/report-helpers.js too (or vice versa) — the two are not
// auto-synced.

import { runQuery } from './bigquery.ts';
import * as Q from './queries.ts';
import { portfolioReport, transactionStatement, val } from './pdf.ts';

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

export function pivotPerformanceByType(rows: Record<string, unknown>[]) {
  const byType: Record<string, { byFund: Record<string, Record<string, unknown>>; asOf: string | null }> = {};
  for (const r of rows) {
    const type = (r.type as string) || '(none)';
    const t = (byType[type] = byType[type] || { byFund: {}, asOf: null });
    const name = r.name as string;
    const fund = (t.byFund[name] = t.byFund[name] || {
      Fund: r.name, NAV: r.latest_nav, ipoDate: r.ipo_date ? val(r.ipo_date) : null,
    });
    fund[r.period as string] = r.pct_change;
    const d = r.latest_nav_date ? (val(r.latest_nav_date) as string) : null;
    if (d && (!t.asOf || d > t.asOf)) t.asOf = d;
  }
  return Object.keys(byType).sort().map((type) => ({
    name: type,
    asOf: byType[type].asOf,
    rows: Object.values(byType[type].byFund).map((f) => {
      const out: Record<string, unknown> = { Fund: f.Fund, NAV: f.NAV, ipoDate: f.ipoDate };
      for (const p of PERF_PERIODS) out[p] = f[p] ?? null;
      return out;
    }),
    pctCols: PERF_PERIODS,
  }));
}

// PDF open-password: the investor's own birthdate as DDMMYYYY. null when
// there's no birthdate on file, so the caller skips encrypting the PDF.
export function birthdatePassword(birthdate: unknown): string | null {
  const s = val(birthdate) as string | null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}${m[2]}${m[1]}` : null;
}

interface StatementAttachmentArgs {
  userId: string;
  sid: string;
  contact: Record<string, unknown>;
  sendPortfolio?: boolean;
  portfolioDate?: string;
  sendStatement?: boolean;
  statementMonth?: string;
  username: string;
}

// Builds the 1-2 statement PDF attachments (and applies the shared
// birthdate-derived open-password) for one investor — reused by
// /api/statement/email (single), /api/statement/email-batch (many), and the
// scheduler (schedules.ts). Throws on a missing/malformed statementMonth so
// the caller decides how to report it.
export async function buildStatementAttachments(
  { userId, sid, contact, sendPortfolio, portfolioDate, sendStatement, statementMonth, username }: StatementAttachmentArgs,
): Promise<{ filename: string; content: Uint8Array }[]> {
  const password = birthdatePassword(contact.birthdate) ?? undefined;
  const attachments: { filename: string; content: Uint8Array }[] = [];

  if (sendPortfolio) {
    const h = portfolioDate ? Q.userHoldingsAsOfFix(sid, portfolioDate) : Q.userHoldings(userId);
    const holdings = await runQuery(h.sql, h.params);
    // Portfolio-only, no fund-performance pages — this tool never sends performance.
    const buf = await portfolioReport({ contact, holdings }, [], { username, password });
    attachments.push({ filename: `Portfolio_${sid}${portfolioDate ? '_' + portfolioDate : ''}.pdf`, content: new Uint8Array(buf) });
  }

  if (sendStatement) {
    const [year, month] = String(statementMonth || '').split('-').map(Number);
    if (!year || !month) throw new Error('statementMonth is required (YYYY-MM).');
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); // last day of that month
    const t = Q.userTransactions(userId, from, to);
    const transactions = await runQuery(t.sql, t.params);
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const buf = await transactionStatement({ contact, transactions }, monthLabel, { username, password });
    attachments.push({ filename: `Transaction_Statement_${sid}_${statementMonth}.pdf`, content: new Uint8Array(buf) });
  }

  return attachments;
}

// The previous calendar month as 'YYYY-MM' — the sensible default e-statement
// period for a recurring/automated send (there's no "chosen month" input the
// way the manual tool has one).
export function previousMonthYYYYMM(from: Date = new Date()): string {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
