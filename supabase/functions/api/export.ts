// Ported from server/export.js. CSV/TXT are pure string building — zero risk,
// unchanged logic. XLSX uses npm:exceljs (pure in-memory computation, no
// filesystem access needed to *write* a workbook — lower risk than the
// BigQuery SDK, but unverified under Supabase's ~2s CPU budget for the
// largest exports; test with a real 100k-row export after deploying).
import ExcelJS from 'npm:exceljs@4.4.0';

function inferColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

// bigquery.ts already coerces REST API values to plain strings/numbers/
// booleans (see coerceValue there) — unlike the Node SDK, it doesn't produce
// {value:'...'} wrapper objects or big.js instances. This stays as a
// defensive fallback for the shapes the SDK used to produce, in case a value
// ever comes through unparsed.
function cell(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('value' in (value as Record<string, unknown>)) return (value as { value: unknown }).value;
    if (typeof (value as { toString?: unknown }).toString === 'function' && (value as { toString: () => string }).toString !== Object.prototype.toString) {
      return (value as { toString: () => string }).toString();
    }
    return JSON.stringify(value);
  }
  return value;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = inferColumns(rows);
  const escape = (v: unknown) => {
    const s = String(cell(v));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

// Pipe-delimited flat file (the format custodian/KSEI feeds use) — no quoting,
// just strip embedded newlines so they can't fracture the line structure.
export function toTxt(rows: Record<string, unknown>[], sep = '|'): string {
  const cols = inferColumns(rows);
  const clean = (v: unknown) => String(cell(v) ?? '').replace(/[\r\n]+/g, ' ');
  const header = cols.join(sep);
  const body = rows.map((r) => cols.map((c) => clean(r[c])).join(sep)).join('\n');
  return header + '\n' + body;
}

// Values in pctCols are already percentages (e.g. -16.49 means -16.49%), not
// fractions — so use a literal "%" suffix format rather than Excel's native
// percentage format, which would multiply the value by 100 again.
const PCT_FMT = '0.00"%"';

function num(v: unknown): unknown { return v === '' || v == null ? v : Number(v as string); }

export async function toXlsxBuffer(rows: Record<string, unknown>[], sheetName = 'Data', pctCols: string[] = [], username?: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sayakaya Analytics';
  wb.created = new Date();
  if (username) wb.lastModifiedBy = username;
  const ws = wb.addWorksheet(sheetName);
  const cols = inferColumns(rows);

  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A4A' } };

  for (const r of rows) {
    const out: Record<string, unknown> = {};
    for (const c of cols) out[c] = pctCols.includes(c) ? num(cell(r[c])) : cell(r[c]);
    ws.addRow(out);
  }
  for (const c of pctCols) if (cols.includes(c)) ws.getColumn(c).numFmt = PCT_FMT;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length || 1 } };

  return wb.xlsx.writeBuffer();
}

// sheets: [{ name, rows, pctCols }] — one worksheet per entry, e.g. one per fund type.
export async function toXlsxMultiSheet(sheets: { name: string; rows: Record<string, unknown>[]; pctCols?: string[] }[], username?: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sayakaya Analytics';
  wb.created = new Date();
  if (username) wb.lastModifiedBy = username;

  for (const { name, rows, pctCols = [] } of sheets) {
    const ws = wb.addWorksheet(String(name).slice(0, 31)); // Excel sheet name limit
    const cols = inferColumns(rows);
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A4A' } };
    for (const r of rows) {
      const out: Record<string, unknown> = {};
      for (const c of cols) out[c] = pctCols.includes(c) ? num(cell(r[c])) : cell(r[c]);
      ws.addRow(out);
    }
    for (const c of pctCols) if (cols.includes(c)) ws.getColumn(c).numFmt = PCT_FMT;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }

  return wb.xlsx.writeBuffer();
}
