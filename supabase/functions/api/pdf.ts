// Ported from server/pdf.js, using npm:pdfkit.
import PDFDocument from 'npm:pdfkit@0.19.1';
import { Buffer } from 'node:buffer';
import LOGO_BASE64 from './logo.ts';
import LOGO_H_BASE64 from './logo-horizontal.ts';

// pdfkit's .image() does a Buffer.isBuffer() check to decide "is this image
// data or a file path" — a plain Uint8Array fails that check and falls
// through to the file-path branch, throwing. Must be a real Node Buffer.
const LOGO_BUFFER = Buffer.from(LOGO_BASE64, 'base64');
const LOGO_RATIO = 490 / 720; // source PNG is 720x490 (sayakaya-kotak.png)
const LOGO_H_BUFFER = Buffer.from(LOGO_H_BASE64, 'base64');
const LOGO_H_RATIO = 456 / 1856; // source PNG is 1856x456 (sayakaya-horizontal.png)

export function val(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('value' in (v as Record<string, unknown>)) return (v as { value: unknown }).value;
    if (typeof (v as { toString?: unknown }).toString === 'function' && (v as { toString: () => string }).toString !== Object.prototype.toString) {
      return (v as { toString: () => string }).toString();
    }
  }
  return v;
}

const numFmt = (n: unknown, digits = 4): string => {
  const v = val(n);
  return v == null ? '—' : Number(v).toFixed(digits);
};
// Indonesian number format, as on the official statement: 51.038,7052 / 100.239.429
export const idNum = (n: unknown, digits = 0): string => {
  const v = val(n);
  if (v == null) return '—';
  return new Intl.NumberFormat('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v));
};
// Accountant-style negatives for gain/loss cells: (214.800.256)
export const idParen = (n: unknown): string => {
  const v = val(n);
  if (v == null) return '—';
  const num = Number(v);
  return num < 0 ? `(${idNum(-num)})` : idNum(num);
};
// funds.type enum → the statement's friendly label ("MIXED" is sold as balanced).
const FUND_TYPE_LABELS: Record<string, string> = { MIXED: 'Balanced Fund' };
export const fundTypeLabel = (t: unknown): string => {
  const v = val(t);
  if (!v) return '—';
  return FUND_TYPE_LABELS[String(v)] || String(v).split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') + ' Fund';
};
// funds.type enum → Indonesian label, matching the official "Reksa Dana
// Update" sheet (e.g. MONEY_MARKET -> "Pasar Uang").
const FUND_TYPE_LABELS_ID: Record<string, string> = {
  MONEY_MARKET: 'Pasar Uang',
  FIXED_INCOME: 'Pendapatan Tetap',
  MIXED: 'Campuran',
  EQUITY: 'Saham',
  PROTECTED: 'Terproteksi',
};
const fundTypeLabelID = (t: unknown): string => {
  const v = val(t);
  if (!v) return '—';
  return FUND_TYPE_LABELS_ID[String(v)] || String(v).split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
};
export const pctFmt = (n: unknown): string => {
  const v = val(n);
  if (v == null) return '—';
  const num = Number(v);
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
};

const INDIGO = '#1e2a4a';
const MUTED = '#6b7280';
const LINE = '#e7e4dc';
const INK = '#1a1d2e';
const BLUE = '#2f5fdc';
const GREEN = '#14c687';
const RED = '#ff3165';
const ZEBRA = '#eef0f8';
// App's actual brand blue (--indigo in public/style.css) — used for the perf
// table's header band instead of the near-black INDIGO above, which read as
// too dark next to the reference "Reksa Dana Update" sheet.
const TABLE_HEADER = '#3a50ab';

// deno-lint-ignore no-explicit-any
function bufferDoc(doc: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // deno-lint-ignore no-explicit-any
    const chunks: any[] = [];
    doc.on('data', (c: unknown) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Shared "Page 1" header for every statement PDF: square logo + issuer
// address block, then an investor info block (left) with a title/date block
// (right) — the only bits that vary per statement type. Leaves doc.y past
// the investor block, ready for a table.
// deno-lint-ignore no-explicit-any
function printLetterhead(doc: any, { left, width, contact, title, dateLabel, dateValue }: {
  left: number; width: number; contact?: Contact; title: string; dateLabel: string; dateValue: string;
}) {
  const logoWidth = 54;
  doc.image(LOGO_BUFFER, left, doc.y, { width: logoWidth });
  const headX = left + logoWidth + 16;
  const headY = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('PT Sayakaya Lahir Batin', headX, headY);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text('Sahid Sudirman Center, 12th Floor', headX)
    .text('Jl Jenderal Sudirman Kav. 86, Jakarta 10220', headX);
  doc.y = Math.max(doc.y, headY + logoWidth * LOGO_RATIO) + 24;

  const labelW = 60;
  const valueW = width * 0.55 - labelW;
  const rightW = 200;
  const rightX = left + width - rightW;
  const blockY = doc.y;
  let y = blockY;
  ([['NAME', contact?.name], ['SID', contact?.sid], ['IFUA', contact?.ifua], ['Address', contact?.address]] as [string, unknown][]).forEach(([label, v]) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(label, left, y, { width: labelW });
    const text = String(val(v) || '—');
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(text, left + labelW, y, { width: valueW });
    y += Math.max(13, doc.heightOfString(text, { width: valueW }) + 2);
  });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, rightX, blockY, { width: rightW, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(dateLabel, rightX, blockY + 19, { width: rightW });
  doc.text(dateValue, rightX, blockY + 19, { width: rightW, align: 'right' });
  doc.x = left;
  doc.y = y + 24;
}

export interface Column { key: string; label: string; width: number; align?: string; format?: (v: unknown) => string }

// Minimal table renderer: header row + data rows, with column widths and
// per-row page breaks. headerFill/headerText style the header band;
// zebraFill (if set) shades every other data row; cellColor(key, rawValue)
// (if set) overrides a body cell's text color, e.g. green/red for % change —
// mirrors the official "Reksa Dana Update" NAV sheet look.
// deno-lint-ignore no-explicit-any
function table(doc: any, columns: Column[], rows: Record<string, unknown>[], {
  rowHeight = 16, fontSize = 8, headerFill = '#f4f2ec', headerText = INDIGO, zebraFill = null as string | null,
  cellColor = null as ((key: string, raw: unknown) => string | null) | null,
} = {}) {
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  // Row height grows when a cell wraps (long fund names, two-line headers).
  // Caller must have the row's font set before measuring.
  const measure = (texts: string[]) => Math.max(rowHeight,
    8 + Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: columns[i].width - 8 }) as number)));
  const drawCells = (texts: string[], y: number, colorFn?: ((key: string) => string | null) | null) => {
    let x = left;
    columns.forEach((c, i) => {
      if (colorFn) doc.fillColor(colorFn(c.key) || INK);
      doc.text(texts[i], x + 4, y + 4, { width: c.width - 8, align: c.align || 'left' });
      x += c.width;
    });
  };

  function drawHeader() {
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(headerText);
    const labels = columns.map((c) => c.label);
    const h = measure(labels);
    const y = doc.y;
    doc.rect(left, y, totalWidth, h).fill(headerFill);
    doc.fillColor(headerText);
    drawCells(labels, y);
    doc.y = y + h;
    doc.strokeColor(LINE).moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).stroke();
  }

  drawHeader();
  doc.font('Helvetica').fontSize(fontSize).fillColor(INK);
  rows.forEach((r, i) => {
    const texts = columns.map((c) => {
      const raw = r[c.key];
      return String(c.format ? c.format(raw) : (val(raw) ?? '—'));
    });
    const h = measure(texts);
    if (doc.y + h > bottom) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(fontSize).fillColor(INK);
    }
    const y = doc.y;
    if (zebraFill && i % 2 === 1) doc.rect(left, y, totalWidth, h).fill(zebraFill);
    drawCells(texts, y, cellColor ? (key: string) => cellColor(key, r[key]) : null);
    doc.y = y + h;
  });
  doc.strokeColor(LINE).moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).stroke();
  doc.moveDown(0.8);
}

// Statement columns, mirroring the official "CUSTOMER PORTFOLIO" layout:
// fund value = avg buy NAV x units; market value = close NAV x units;
// unrealized gain/loss = market - fund value; % = gain/loss over fund value.
export const HOLDINGS_COLS = (width: number): Column[] => [
  { key: 'fund', label: 'Fund Name', width: width * 0.15 },
  { key: 'fund_type', label: 'Fund Type', width: width * 0.09, format: fundTypeLabel },
  { key: 'unit', label: 'Unit Balance', width: width * 0.11, align: 'right', format: (v) => idNum(v, 4) },
  { key: 'avg_buy_price', label: 'Average NAV', width: width * 0.10, align: 'right', format: (v) => idNum(v, 4) },
  { key: 'nav', label: 'Close NAV', width: width * 0.10, align: 'right', format: (v) => idNum(v, 4) },
  { key: 'fund_value', label: 'Fund Value', width: width * 0.13, align: 'right', format: idNum },
  { key: 'value', label: 'Market Value', width: width * 0.13, align: 'right', format: idNum },
  { key: 'gain_loss', label: 'Unrealized Gain/Loss', width: width * 0.12, align: 'right', format: idParen },
  { key: 'gain_pct', label: '%', width: width * 0.07, align: 'right', format: (v) => (val(v) == null ? '—' : idNum(v, 2) + '%') },
];

// Drops columns not in `keys` (if given), keeping 'fund' always, and renormalizes
// widths so the remaining columns still fill the full table width.
export function filterCols(cols: Column[], totalWidth: number, keys?: string[]): Column[] {
  if (!keys) return cols;
  const keep = cols.filter((c) => c.key === 'fund' || keys.includes(c.key));
  const sumW = keep.reduce((s, c) => s + c.width, 0);
  return keep.map((c) => ({ ...c, width: (c.width / sumW) * totalWidth }));
}

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', '10Y'];
// Period key -> the official "Reksa Dana Update" sheet's Indonesian header.
const PERF_PERIOD_LABELS_ID: Record<string, string> = {
  '1D': '1 Hari', '1W': '1 Minggu', '1M': '1 Bulan', '3M': '3 Bulan',
  YTD: 'YTD', '1Y': '1 Tahun', '3Y': '3 Tahun', '5Y': '5 Tahun', '10Y': '10 Tahun',
};
export const PERF_COLS = (width: number): Column[] => [
  { key: 'Fund', label: 'Nama Produk', width: width * 0.19 },
  { key: 'ipoDate', label: 'Tanggal Emisi', width: width * 0.09, format: (v) => formatDateStrID(v as string) || '—' },
  { key: 'NAV', label: 'NAB/UP', width: width * 0.09, align: 'right', format: (v) => numFmt(v, 2) },
  ...PERF_PERIODS.map((p) => ({ key: p, label: PERF_PERIOD_LABELS_ID[p] || p, width: (width * 0.63) / PERF_PERIODS.length, align: 'right', format: pctFmt })),
];
// Same as PERF_COLS but with a leading row-number column, for the standalone
// "Reksa Dana Update" style report — mirrors the official NAV update sheet.
const PERF_COLS_NUMBERED = (width: number): Column[] => {
  const noWidth = width * 0.045;
  return [{ key: '__no', label: 'No', width: noWidth, align: 'center' }, ...PERF_COLS(width - noWidth)];
};
// Colors a period-change cell green (up) or red (down); leaves other columns alone.
const perfCellColor = (key: string, raw: unknown): string | null => {
  if (!PERF_PERIODS.includes(key)) return null;
  const v = val(raw);
  return v == null ? null : (Number(v) >= 0 ? GREEN : RED);
};

interface Contact { name?: unknown; sid?: unknown; ifua?: unknown; email?: unknown; phone?: unknown; address?: unknown }
interface PerfSheet { name: string; rows: Record<string, unknown>[]; asOf?: string | null }

export const DISCLAIMER = 'Dokumen ini dipersiapkan oleh PT SAYAKAYA LAHIR BATIN dan hanya bisa digunakan untuk kepentingan investor tersebut di atas dan tidak untuk pihak lainnya. Laporan ini bukan merupakan konfirmasi dari PT SAYAKAYA LAHIR BATIN dan tidak untuk menggantikan laporan yang wajib diterbitkan oleh Bank Kustodian, jika ada perbedaan antara laporan ini dengan laporan Bank Kustodian, maka laporan Bank Kustodian adalah yang benar. Laporan ini diproses oleh komputer dan tidak memerlukan tandatangan.';
export const OJK_LINE = 'PT SAYAKAYA LAHIR BATIN terdaftar dan diawasi oleh OJK, dengan nomor registrasi KEP-17/PM.21/2021';

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Statement date is the latest NAV date across the holdings (NAV publishes
// H-1, so "today's" statement is dated yesterday). Formatted like "4 Agustus 2025".
export function statementDate(holdings: Record<string, unknown>[]): string {
  const latest = holdings.map((h) => String(val(h.nav_date) || '')).filter(Boolean).sort().pop();
  if (!latest) return '—';
  const [y, m, d] = latest.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

const formatDateID = (d: Date = new Date()) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
// Formats a 'YYYY-MM-DD' string (e.g. from a BigQuery DATE column) the same
// way — returns null (not "today") when there's nothing to format, so the
// caller can tell "no NAV date available" apart from an actual date.
const formatDateStrID = (dateStr: string | null | undefined): string | null => {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${String(d).padStart(2, '0')} ${MONTHS_ID[m - 1]} ${y}`;
};

// Header for the "Reksa Dana Update" style report: bold title top-left,
// blue date line below it, horizontal wordmark logo top-right.
// deno-lint-ignore no-explicit-any
function perfReportHeader(doc: any, title: string, dateStr: string) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const logoWidth = 110;
  const y0 = doc.y;
  doc.image(LOGO_H_BUFFER, right - logoWidth, y0, { width: logoWidth });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INDIGO).text(title.toUpperCase(), left, y0, { width: right - logoWidth - left - 10 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BLUE).text(dateStr, left, doc.y + 2);
  doc.y = Math.max(doc.y, y0 + logoWidth * LOGO_H_RATIO) + 16;
  doc.x = left;
}

// One "Reksa Dana Update" page for a single fund-type sheet: { name, rows,
// asOf }. asOf is the actual latest NAV date behind these rows (from the
// data, not "today" — NAV can lag, so the printed date must match what the
// numbers are really as-of). Falls back to today only if the query somehow
// returned no date at all. Caller owns page breaks (addPage) between sheets.
// deno-lint-ignore no-explicit-any
function perfSheetPage(doc: any, sheet: PerfSheet, width: number) {
  const dateLabel = formatDateStrID(sheet.asOf) || formatDateID();
  perfReportHeader(doc, `Reksa Dana Update - ${fundTypeLabelID(sheet.name)}`, dateLabel);
  if (sheet.rows.length) {
    const numbered = sheet.rows.map((r, i) => ({ ...r, __no: i + 1 }));
    table(doc, PERF_COLS_NUMBERED(width), numbered, {
      headerFill: TABLE_HEADER, headerText: '#ffffff', zebraFill: ZEBRA, cellColor: perfCellColor, fontSize: 7,
    });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No NAV data for this fund type.');
  }
}

// sheets: [{ name: fundType, rows: [{ Fund, NAV, '1D': pct, ... }] }] — from
// pivotPerformanceByType(). Standalone export for the Fund Performance section,
// styled like the official "Reksa Dana Update" NAV sheet (one page per type).
export function fundPerformanceReport(sheets: PerfSheet[], options: { username?: string } = {}): Promise<Buffer> {
  // deno-lint-ignore no-explicit-any
  const doc: any = new PDFDocument({ size: 'A4', margin: 40 });
  if (options.username) doc.info.Author = options.username;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (!sheets.length) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No NAV data.');
  }
  sheets.forEach((sheet, i) => {
    if (i > 0) doc.addPage();
    perfSheetPage(doc, sheet, width);
  });
  return bufferDoc(doc);
}

// contact: { name, sid, ifua, address, ... }
// holdings: rows from queries.userHoldings()
// performanceSheets: [{ name: fundType, rows: [{ Fund, '1D': pct, ... }] }]
// options.columns: optional list of HOLDINGS_COLS keys to keep (plus 'fund', always kept)
export function portfolioReport(
  { contact, holdings }: { contact?: Contact; holdings: Record<string, unknown>[] },
  performanceSheets: PerfSheet[],
  options: { columns?: string[]; username?: string } = {},
): Promise<Buffer> {
  // pdfkit's bundled .d.ts doesn't fully describe PDFDocument's fluent
  // instance API (font/text/moveDown etc. all really exist at runtime) —
  // `any` here matches the same pragmatism already used in the helpers below.
  // deno-lint-ignore no-explicit-any
  const doc: any = new PDFDocument({ size: 'A4', margin: 40 });
  if (options.username) doc.info.Author = options.username;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Page 1: CUSTOMER PORTFOLIO statement ----
  printLetterhead(doc, { left, width, contact, title: 'CUSTOMER PORTFOLIO', dateLabel: 'CLOSE NAV', dateValue: statementDate(holdings) });

  const cols = filterCols(HOLDINGS_COLS(width), width, options.columns);
  if (holdings.length) {
    table(doc, cols, holdings, { fontSize: 7 });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No active holdings.');
    doc.moveDown(0.8);
  }

  // Total row (multiple funds only), spanning Close NAV → % like the statement.
  // Anchored at the first non-identity column still visible, so it holds up
  // when hidden columns shift what's left in the table.
  const anchorCol = cols.find((c) => c.key !== 'fund' && c.key !== 'fund_type');
  if (holdings.length > 1 && anchorCol) {
    const sum = (k: string) => holdings.reduce((s, h) => s + (Number(val(h[k])) || 0), 0);
    const totalFund = sum('fund_value');
    const totalMarket = sum('value');
    const totalGain = totalMarket - totalFund;
    const totalPct = totalFund ? (totalGain / totalFund) * 100 : null;
    const colX: Record<string, number> = {};
    let x = left;
    cols.forEach((c) => { colX[c.key] = x; x += c.width; });
    const rowY = doc.y + 2;
    const totX = colX[anchorCol.key];
    doc.strokeColor(INK).lineWidth(0.7).moveTo(totX, rowY).lineTo(left + width, rowY).stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(INK);
    const sumKeys = ['fund_value', 'value', 'gain_loss', 'gain_pct'];
    const cell = (key: string, text: string) => {
      const c = cols.find((col) => col.key === key);
      if (!c) return;
      doc.text(text, colX[key] + 4, rowY + 4, { width: c.width - 8, align: 'right' });
    };
    if (!sumKeys.includes(anchorCol.key)) cell(anchorCol.key, 'Total');
    cell('fund_value', idNum(totalFund));
    cell('value', idNum(totalMarket));
    cell('gain_loss', idNum(totalGain));
    cell('gain_pct', totalPct == null ? '—' : idNum(totalPct, 2) + '%');
    doc.y = rowY + 15;
    doc.strokeColor(INK).moveTo(totX, doc.y).lineTo(left + width, doc.y).stroke();
    doc.y += 12;
    doc.x = left;
  }

  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(DISCLAIMER, left, doc.y, { width })
    .text(OJK_LINE, { width });

  // ---- One page per fund type: NAV % change table, "Reksa Dana Update" style ----
  performanceSheets.forEach((sheet) => {
    doc.addPage();
    perfSheetPage(doc, sheet, width);
  });

  return bufferDoc(doc);
}

export const TX_COLS = (width: number): Column[] => [
  { key: 'created_at', label: 'Date', width: width * 0.14, format: (v) => { const s = String(val(v) || ''); return s ? s.slice(0, 10) : '—'; } },
  { key: 'fund', label: 'Fund', width: width * 0.30 },
  { key: 'type', label: 'Type', width: width * 0.16 },
  { key: 'status', label: 'Status', width: width * 0.14 },
  { key: 'unit', label: 'Unit', width: width * 0.12, align: 'right', format: (v) => (val(v) == null ? '—' : idNum(v, 4)) },
  { key: 'amount', label: 'Amount', width: width * 0.14, align: 'right', format: idNum },
];

// contact: { name, sid, ifua, address, ... }
// transactions: rows from queries.ts userTransactions(), one calendar month
export function transactionStatement(
  { contact, transactions }: { contact?: Contact; transactions: Record<string, unknown>[] },
  monthLabel: string,
  options: { username?: string } = {},
): Promise<Buffer> {
  // deno-lint-ignore no-explicit-any
  const doc: any = new PDFDocument({ size: 'A4', margin: 40 });
  if (options.username) doc.info.Author = options.username;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  printLetterhead(doc, { left, width, contact, title: 'TRANSACTION E-STATEMENT', dateLabel: 'PERIOD', dateValue: monthLabel });

  if (transactions.length) {
    table(doc, TX_COLS(width), transactions, { fontSize: 7 });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No transactions this period.');
    doc.moveDown(0.8);
  }

  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(DISCLAIMER, left, doc.y, { width })
    .text(OJK_LINE, { width });

  return bufferDoc(doc);
}
