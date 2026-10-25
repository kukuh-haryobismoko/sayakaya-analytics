// Ported from server/report-helpers.js — see that file for the full
// rationale. Shared by index.ts's manual send routes and schedules.ts's
// automated scheduler so the two never drift apart on what a "statement
// send" or a "fund performance send" actually produces. If you change this,
// change server/report-helpers.js too (or vice versa) — the two are not
// auto-synced.

import { runQuery } from './bigquery.ts';
import * as Q from './queries.ts';
import { portfolioReport, transactionStatement, fundPerformanceReport, val } from './pdf.ts';

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

// Export rows in the order their table was sorted on screen. sortKey: the
// sorted column's own field, compared the way the page compares (numbers as
// numbers, text case-insensitively, blanks last). Without it (a pivot, or a
// column computed on the page), order + orderKey: the on-screen order of the
// first column's values. A key the rows don't have leaves them as queried.
const exportCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const plainValue = (v: unknown): unknown => (v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v);
export function sortExportRows<T extends Record<string, unknown>>(
  rows: T[], { sortKey, sortDir, orderKey, order }: { sortKey?: unknown; sortDir?: unknown; orderKey?: unknown; order?: unknown } = {},
): T[] {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  if (typeof sortKey === 'string' && sortKey in rows[0]) {
    const sortable = (r: T): number | string | null => {
      const v = plainValue(r[sortKey]);
      if (v == null || v === '') return null;
      const s = String(v), n = Number(s);
      return typeof v === 'number' ? v : (s.trim() !== '' && Number.isFinite(n) ? n : s);
    };
    const items = rows.map((r, i) => ({ r, i, v: sortable(r) }));
    const nums = items.every((x) => x.v == null || typeof x.v === 'number');
    const m = sortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      if (a.v == null || b.v == null) return Number(a.v == null) - Number(b.v == null) || a.i - b.i;
      return m * (nums ? (a.v as number) - (b.v as number) : exportCollator.compare(String(a.v), String(b.v))) || a.i - b.i;
    });
    return items.map((x) => x.r);
  }
  if (typeof orderKey === 'string' && orderKey in rows[0] && Array.isArray(order) && order.length) {
    const pos = new Map<string, number>();
    order.slice(0, 100000).forEach((t, i) => { const k = String(t).trim(); if (!pos.has(k)) pos.set(k, i); });
    const at = (r: T) => pos.get(String(plainValue(r[orderKey]) ?? '').trim()) ?? Infinity;
    return rows.map((r, i) => ({ r, i, p: at(r) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.r);
  }
  return rows;
}

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

// Which funds a fund-performance send covers: null = every fund, otherwise
// { types: [...categories], fundIds: [...] } (a fund matching either is in).
// Untrusted input (request body / stored schedule), so only string arrays
// survive. A filter that names nothing is null, never "match nothing".
export interface FundFilter { types: string[]; fundIds: string[] }
export function normalizeFundFilter(f: unknown): FundFilter | null {
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, 200) : []);
  const o = (f || {}) as Record<string, unknown>;
  const types = list(o.types);
  const fundIds = list(o.fundIds);
  return types.length || fundIds.length ? { types, fundIds } : null;
}

// Short audit-log label for a (normalized) fund filter.
export function fundScopeLabel(f: FundFilter | null): string {
  if (!f) return 'all funds';
  return [f.types.length && `categories: ${f.types.join(', ')}`, f.fundIds.length && `${f.fundIds.length} fund(s)`].filter(Boolean).join('; ');
}

// What a statement email carries, in words, for the Email recap log.
export function statementDocsLabel({ sendPortfolio, portfolioDate, sendStatement, statementMonth }: {
  sendPortfolio?: boolean; portfolioDate?: string; sendStatement?: boolean; statementMonth?: string;
}): string {
  return [
    sendPortfolio && `Portfolio ${portfolioDate ? `as of ${portfolioDate}` : '(current holdings)'}`,
    sendStatement && `transaction e-statement ${statementMonth}`,
  ].filter(Boolean).join(' + ');
}

// The Reksa Dana Update PDF, optionally narrowed by a fund filter — one
// builder for the manual send and the scheduler. Throws when the filter
// matches no fund (e.g. a picked fund was delisted) instead of emailing an
// empty report.
export async function buildFundPerformancePdf({ asOf, fundFilter, username }: { asOf?: string; fundFilter?: unknown; username?: string | null }): Promise<Uint8Array> {
  const q = Q.productPerformanceDetail(asOf);
  let detail = await runQuery(q.sql, q.params);
  const f = normalizeFundFilter(fundFilter);
  if (f) detail = detail.filter((r) => f.types.includes(r.type as string) || f.fundIds.includes(String(val(r.fund_id))));
  if (!detail.length) throw new Error('None of the chosen funds/categories has NAV data to report.');
  return new Uint8Array(await fundPerformanceReport(pivotPerformanceByType(detail), { username: username || undefined }));
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
  username: string | null;
  // Rows already fetched for a chunk of investors at once (the schedules
  // drain); omitted, they are queried for this investor.
  holdings?: Record<string, unknown>[];
  transactions?: Record<string, unknown>[];
}

// First and last day of a 'YYYY-MM' e-statement month.
export function statementMonthRange(statementMonth?: string): { from: string; to: string } {
  const [year, month] = String(statementMonth || '').split('-').map(Number);
  if (!year || !month) throw new Error('statementMonth is required (YYYY-MM).');
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), // last day of that month
  };
}

// Builds the 1-2 statement PDF attachments (and applies the shared
// birthdate-derived open-password) for one investor — reused by
// /api/statement/email (single), /api/statement/email-batch (many), and the
// scheduler (schedules.ts). Throws on a missing/malformed statementMonth so
// the caller decides how to report it.
export async function buildStatementAttachments(
  { userId, sid, contact, sendPortfolio, portfolioDate, sendStatement, statementMonth, username, holdings, transactions }: StatementAttachmentArgs,
): Promise<{ filename: string; content: Uint8Array }[]> {
  const password = birthdatePassword(contact.birthdate) ?? undefined;
  const attachments: { filename: string; content: Uint8Array }[] = [];

  if (sendPortfolio) {
    if (!holdings) {
      const h = portfolioDate ? Q.userHoldingsAsOfFix(sid, portfolioDate) : Q.userHoldings(userId);
      holdings = await runQuery(h.sql, h.params);
    }
    // Portfolio-only, no fund-performance pages — this tool never sends performance.
    const buf = await portfolioReport({ contact, holdings }, [], { username, password });
    attachments.push({ filename: `Portfolio_${sid}${portfolioDate ? '_' + portfolioDate : ''}.pdf`, content: new Uint8Array(buf) });
  }

  if (sendStatement) {
    const { from, to } = statementMonthRange(statementMonth);
    if (!transactions) {
      const t = Q.userTransactions(userId, from, to);
      transactions = await runQuery(t.sql, t.params);
    }
    const [year, month] = String(statementMonth).split('-').map(Number);
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const buf = await transactionStatement({ contact, transactions }, monthLabel, { username, password });
    attachments.push({ filename: `Transaction_Statement_${sid}_${statementMonth}.pdf`, content: new Uint8Array(buf) });
  }

  return attachments;
}

interface BulkEntry { contact: Record<string, unknown>; holdings: Record<string, unknown>[] }

// Aggregates holdings across many investors for the Portfolio tabs' bulk-export
// basket "Preview summary" — entries: [{ contact, holdings }], the same shape
// /api/export/batch already fetches per investor (see fetchBatchEntries in
// index.ts), just summed by fund instead of written out per investor. gain_pct
// is derived from the summed fund_value/value, not an average of each
// investor's own gain_pct (averaging percentages across different position
// sizes would misrepresent the group's real cost basis).
export function aggregateBulkHoldings(entries: BulkEntry[]) {
  const byFund = new Map<string, { fund: string; fund_type: unknown; unit: number; fund_value: number; value: number; nav: unknown }>();
  const investors: { sid: unknown; name: unknown; email: unknown; phone: unknown; referrer_code: unknown; sales_code: unknown; aum: number }[] = [];
  let totalAum = 0;
  for (const e of entries) {
    let aum = 0;
    for (const h of e.holdings) {
      const value = Number(val(h.value)) || 0;
      aum += value;
      const key = String(val(h.fund));
      const row = byFund.get(key) || { fund: key, fund_type: val(h.fund_type), unit: 0, fund_value: 0, value: 0, nav: val(h.nav) };
      row.unit += Number(val(h.unit)) || 0;
      row.fund_value += Number(val(h.fund_value)) || 0;
      row.value += value;
      byFund.set(key, row);
    }
    totalAum += aum;
    // Contact detail (email/phone/referrer_code/sales_code) is only ever
    // shown in this summary preview, never in the export files themselves —
    // /api/export/batch's CSV/XLSX/PDF only ever reads contact.sid/.name.
    investors.push({
      sid: val(e.contact.sid), name: val(e.contact.name) || val(e.contact.sid),
      email: val(e.contact.email), phone: val(e.contact.phone),
      referrer_code: val(e.contact.referrer_code), sales_code: val(e.contact.sales_code),
      aum,
    });
  }
  const funds = [...byFund.values()]
    .map((r) => ({ ...r, gain_loss: r.value - r.fund_value, gain_pct: r.fund_value ? ((r.value - r.fund_value) / r.fund_value) * 100 : null }))
    .sort((a, b) => b.value - a.value);
  investors.sort((a, b) => b.aum - a.aum);
  return { count: entries.length, totalAum, funds, investors };
}

// The previous calendar month as 'YYYY-MM' — the sensible default e-statement
// period for a recurring/automated send (there's no "chosen month" input the
// way the manual tool has one). Shifted to Asia/Jakarta (WIB, UTC+7, no DST)
// before reading the month — same convention as schedules.ts's jktDateStr/
// toJkt — so a job firing near the WIB day/month boundary reads the month
// Jakarta is actually in, not whatever the server's UTC clock is still on.
export function previousMonthYYYYMM(from: Date = new Date()): string {
  const jkt = new Date(from.getTime() + 7 * 60 * 60000); // WIB, UTC+7, no DST
  const y = jkt.getUTCFullYear();
  const m = jkt.getUTCMonth();
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
