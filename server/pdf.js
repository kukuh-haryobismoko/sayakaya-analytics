'use strict';

const PDFDocument = require('pdfkit');
const LOGO_BUFFER = Buffer.from(require('./logo'), 'base64');
const LOGO_RATIO = 490 / 720; // source PNG is 720x490 (sayakaya-kotak.png)

// BigQuery returns some values as wrapper objects. Date/Timestamp/Datetime/Time
// expose a `.value` string; NUMERIC/BIGNUMERIC come back as big.js instances
// (no `.value`) — use their real .toString() instead. Same convention as export.js.
function val(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('value' in v) return v.value;
    if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) return v.toString();
  }
  return v;
}

const numFmt = (n, digits = 4) => {
  const v = val(n);
  return v == null ? '—' : Number(v).toFixed(digits);
};
// Indonesian number format, as on the official statement: 51.038,7052 / 100.239.429
const idNum = (n, digits = 0) => {
  const v = val(n);
  if (v == null) return '—';
  return new Intl.NumberFormat('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v));
};
// Accountant-style negatives for gain/loss cells: (214.800.256)
const idParen = (n) => {
  const v = val(n);
  if (v == null) return '—';
  const num = Number(v);
  return num < 0 ? `(${idNum(-num)})` : idNum(num);
};
// funds.type enum → the statement's friendly label ("MIXED" is sold as balanced).
const FUND_TYPE_LABELS = { MIXED: 'Balanced Fund' };
const fundTypeLabel = (t) => {
  const v = val(t);
  if (!v) return '—';
  return FUND_TYPE_LABELS[v] || String(v).split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') + ' Fund';
};
const pctFmt = (n) => {
  const v = val(n);
  if (v == null) return '—';
  const num = Number(v);
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
};

const INDIGO = '#1e2a4a';
const MUTED = '#6b7280';
const LINE = '#e7e4dc';
const INK = '#1a1d2e';

function bufferDoc(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function pageHeader(doc, title, sub) {
  const logoWidth = 54; // square-ish kotak logo — keep it modest

  doc.image(LOGO_BUFFER, doc.page.margins.left, doc.y, { width: logoWidth });
  doc.y += logoWidth * LOGO_RATIO + 14;

  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(15).text(title);
  if (sub) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(sub);
  doc.moveDown(0.4);
  const lineY = doc.y;
  doc.strokeColor(LINE).lineWidth(1)
    .moveTo(doc.page.margins.left, lineY)
    .lineTo(doc.page.width - doc.page.margins.right, lineY)
    .stroke();
  doc.moveDown(0.6);
}

// Minimal table renderer: header row + data rows, with column widths and
// per-row page breaks. columns: [{ key, label, width, align, format }]
function table(doc, columns, rows, { rowHeight = 16, fontSize = 8 } = {}) {
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  // Row height grows when a cell wraps (long fund names, two-line headers).
  // Caller must have the row's font set before measuring.
  const measure = (texts) => Math.max(rowHeight,
    8 + Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: columns[i].width - 8 }))));
  const drawCells = (texts, y) => {
    let x = left;
    columns.forEach((c, i) => {
      doc.text(texts[i], x + 4, y + 4, { width: c.width - 8, align: c.align || 'left' });
      x += c.width;
    });
  };

  function drawHeader() {
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(INDIGO);
    const labels = columns.map((c) => c.label);
    const h = measure(labels);
    const y = doc.y;
    doc.rect(left, y, totalWidth, h).fill('#f4f2ec');
    doc.fillColor(INDIGO);
    drawCells(labels, y);
    doc.y = y + h;
    doc.strokeColor(LINE).moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).stroke();
  }

  drawHeader();
  doc.font('Helvetica').fontSize(fontSize).fillColor(INK);
  rows.forEach((r) => {
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
    drawCells(texts, y);
    doc.y = y + h;
  });
  doc.strokeColor(LINE).moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).stroke();
  doc.moveDown(0.8);
}

// Statement columns, mirroring the official "CUSTOMER PORTFOLIO" layout:
// fund value = avg buy NAV x units; market value = close NAV x units;
// unrealized gain/loss = market - fund value; % = gain/loss over fund value.
const HOLDINGS_COLS = (width) => [
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
function filterCols(cols, totalWidth, keys) {
  if (!keys) return cols;
  const keep = cols.filter((c) => c.key === 'fund' || keys.includes(c.key));
  const sumW = keep.reduce((s, c) => s + c.width, 0);
  return keep.map((c) => ({ ...c, width: (c.width / sumW) * totalWidth }));
}

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];
const PERF_COLS = (width) => [
  { key: 'Fund', label: 'Fund', width: width * 0.24 },
  { key: 'NAV', label: 'NAV', width: width * 0.1, align: 'right', format: (v) => numFmt(v, 2) },
  ...PERF_PERIODS.map((p) => ({ key: p, label: p, width: (width * 0.66) / PERF_PERIODS.length, align: 'right', format: pctFmt })),
];

const DISCLAIMER = 'Dokumen ini dipersiapkan oleh PT SAYAKAYA LAHIR BATIN dan hanya bisa digunakan untuk kepentingan investor tersebut di atas dan tidak untuk pihak lainnya. Laporan ini bukan merupakan konfirmasi dari PT SAYAKAYA LAHIR BATIN dan tidak untuk menggantikan laporan yang wajib diterbitkan oleh Bank Kustodian, jika ada perbedaan antara laporan ini dengan laporan Bank Kustodian, maka laporan Bank Kustodian adalah yang benar. Laporan ini diproses oleh komputer dan tidak memerlukan tandatangan.';
const OJK_LINE = 'PT SAYAKAYA LAHIR BATIN terdaftar dan diawasi oleh OJK, dengan nomor registrasi KEP-17/PM.21/2021';

// Statement date is the latest NAV date across the holdings (NAV publishes
// H-1, so "today's" statement is dated yesterday). Formatted d/m/yyyy.
function statementDate(holdings) {
  const latest = holdings.map((h) => String(val(h.nav_date) || '')).filter(Boolean).sort().pop();
  if (!latest) return '—';
  const [y, m, d] = latest.slice(0, 10).split('-').map(Number);
  return `${d}/${m}/${y}`;
}

// contact: { name, sid, ifua, address, ... }
// holdings: rows from queries.userHoldings()
// performanceSheets: [{ name: fundType, rows: [{ Fund, '1D': pct, ... }] }] — from pivotPerformanceByType()
// options.columns: optional list of HOLDINGS_COLS keys to keep (plus 'fund', always kept)
function portfolioReport({ contact, holdings }, performanceSheets, options = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Page 1: CUSTOMER PORTFOLIO statement ----
  // Letterhead: square logo + issuer address block.
  const logoWidth = 54;
  doc.image(LOGO_BUFFER, left, doc.y, { width: logoWidth });
  const headX = left + logoWidth + 16;
  const headY = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('PT Sayakaya Lahir Batin', headX, headY);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text('Sahid Sudirman Center, 12th Floor', headX)
    .text('Jl Jenderal Sudirman Kav. 86, Jakarta 10220', headX);
  doc.y = Math.max(doc.y, headY + logoWidth * LOGO_RATIO) + 24;

  // Investor block (left) + CUSTOMER PORTFOLIO / DATE (right).
  const labelW = 60;
  const valueW = width * 0.55 - labelW;
  const rightW = 200;
  const rightX = left + width - rightW;
  const blockY = doc.y;
  let y = blockY;
  [['NAME', contact?.name], ['SID', contact?.sid], ['IFUA', contact?.ifua], ['Address', contact?.address]].forEach(([label, v]) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(label, left, y, { width: labelW });
    const text = String(val(v) || '—');
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(text, left + labelW, y, { width: valueW });
    y += Math.max(13, doc.heightOfString(text, { width: valueW }) + 2);
  });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('CUSTOMER PORTFOLIO', rightX, blockY, { width: rightW, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text('DATE', rightX, blockY + 19, { width: rightW });
  doc.text(statementDate(holdings), rightX, blockY + 19, { width: rightW, align: 'right' });
  doc.x = left;
  doc.y = y + 24;

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
    const sum = (k) => holdings.reduce((s, h) => s + (Number(val(h[k])) || 0), 0);
    const totalFund = sum('fund_value');
    const totalMarket = sum('value');
    const totalGain = totalMarket - totalFund;
    const totalPct = totalFund ? (totalGain / totalFund) * 100 : null;
    const colX = {};
    let x = left;
    cols.forEach((c) => { colX[c.key] = x; x += c.width; });
    const rowY = doc.y + 2;
    const totX = colX[anchorCol.key];
    doc.strokeColor(INK).lineWidth(0.7).moveTo(totX, rowY).lineTo(left + width, rowY).stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(INK);
    const sumKeys = ['fund_value', 'value', 'gain_loss', 'gain_pct'];
    const cell = (key, text) => {
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

  // ---- One page per fund type: NAV % change table ----
  performanceSheets.forEach((sheet) => {
    doc.addPage();
    pageHeader(doc, `Fund performance — ${sheet.name}`, '% change in NAV vs. each period, as-of the fund\'s latest available NAV.');
    if (sheet.rows.length) {
      table(doc, PERF_COLS(width), sheet.rows);
    } else {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No NAV data for this fund type.');
    }
  });

  return bufferDoc(doc);
}

module.exports = { portfolioReport };
