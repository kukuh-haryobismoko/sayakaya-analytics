'use strict';

const PDFDocument = require('pdfkit');

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

const idr = (n) => {
  const v = val(n);
  if (v == null) return '—';
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(v)));
};
const numFmt = (n, digits = 4) => {
  const v = val(n);
  return v == null ? '—' : Number(v).toFixed(digits);
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
function table(doc, columns, rows, { rowHeight = 16 } = {}) {
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  function drawHeader() {
    const y = doc.y;
    doc.rect(left, y, totalWidth, rowHeight).fill('#f4f2ec');
    let x = left;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INDIGO);
    columns.forEach((c) => {
      doc.text(c.label, x + 4, y + 4, { width: c.width - 8, align: c.align || 'left' });
      x += c.width;
    });
    doc.y = y + rowHeight;
    doc.strokeColor(LINE).moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).stroke();
  }

  drawHeader();
  doc.font('Helvetica').fontSize(8).fillColor(INK);
  rows.forEach((r) => {
    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(8).fillColor(INK);
    }
    const y = doc.y;
    let x = left;
    columns.forEach((c) => {
      const raw = r[c.key];
      const text = c.format ? c.format(raw) : (val(raw) ?? '—');
      doc.text(String(text), x + 4, y + 4, { width: c.width - 8, align: c.align || 'left' });
      x += c.width;
    });
    doc.y = y + rowHeight;
  });
  doc.strokeColor(LINE).moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).stroke();
  doc.moveDown(0.8);
}

const HOLDINGS_COLS = (width) => [
  { key: 'fund', label: 'Fund', width: width * 0.32 },
  { key: 'fund_type', label: 'Type', width: width * 0.16 },
  { key: 'source', label: 'Source', width: width * 0.12 },
  { key: 'unit', label: 'Units', width: width * 0.13, align: 'right', format: (v) => numFmt(v, 4) },
  { key: 'nav', label: 'NAV', width: width * 0.12, align: 'right', format: (v) => numFmt(v, 2) },
  { key: 'value', label: 'Value', width: width * 0.15, align: 'right', format: idr },
];

const PERF_PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '3Y', '5Y'];
const PERF_COLS = (width) => [
  { key: 'Fund', label: 'Fund', width: width * 0.28 },
  ...PERF_PERIODS.map((p) => ({ key: p, label: p, width: (width * 0.72) / PERF_PERIODS.length, align: 'right', format: pctFmt })),
];

// contact: { name, sid, ifua, email, phone }
// holdings: rows from queries.userHoldings()
// performanceSheets: [{ name: fundType, rows: [{ Fund, '1D': pct, ... }] }] — from pivotPerformanceByType()
function portfolioReport({ contact, holdings }, performanceSheets) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Page 1: investor card + holdings ----
  pageHeader(doc, 'Investor Portfolio Report', `Sayakaya Analytics · generated ${new Date().toISOString().slice(0, 10)}`);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(val(contact?.name) || '—');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const line = (label, v) => doc.text(`${label}: ${val(v) || '—'}`);
  line('SID', contact?.sid);
  line('IFUA', contact?.ifua);
  line('Email', contact?.email);
  line('Phone', contact?.phone);
  doc.moveDown(0.8);

  const totalAum = holdings.reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  const regular = holdings.filter((h) => val(h.source) === 'regular').reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  const bonus = holdings.filter((h) => val(h.source) === 'bonus').reduce((s, h) => s + (Number(val(h.value)) || 0), 0);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INDIGO).text(`Total AUM: ${idr(totalAum)}`);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Regular: ${idr(regular)}  ·  Bonus: ${idr(bonus)}  ·  ${holdings.length} holding${holdings.length === 1 ? '' : 's'}`);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Holdings');
  doc.moveDown(0.3);
  if (holdings.length) {
    table(doc, HOLDINGS_COLS(width), holdings);
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No active holdings.');
  }

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
