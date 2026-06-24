'use strict';

const ExcelJS = require('exceljs');

function inferColumns(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

// BigQuery returns some values as wrapper objects. Date/Timestamp/Datetime/Time
// expose a `.value` string. NUMERIC/BIGNUMERIC come back as big.js instances
// ({s, e, c} — no `.value`), so falling through to JSON.stringify() would wrap
// them in literal quotes (Big.prototype.toJSON = toString) and break Number().
// Use their real .toString() instead, which big.js provides correctly.
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('value' in value) return value.value;
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      return value.toString();
    }
    return JSON.stringify(value);
  }
  return value;
}

function toCsv(rows) {
  const cols = inferColumns(rows);
  const escape = (v) => {
    const s = String(cell(v));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

// Values in pctCols are already percentages (e.g. -16.49 means -16.49%), not
// fractions — so use a literal "%" suffix format rather than Excel's native
// percentage format, which would multiply the value by 100 again.
const PCT_FMT = '0.00"%"';

// numFmt only renders on actual numeric cells — BigQuery NUMERIC/BIGNUMERIC
// values arrive as { value: '0.20' } (a string, to keep precision), so pctCols
// must be coerced to a real number or the percent format is silently ignored.
function num(v) { return v === '' || v == null ? v : Number(v); }

async function toXlsxBuffer(rows, sheetName = 'Data', pctCols = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sayakaya Analytics';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);
  const cols = inferColumns(rows);

  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A4A' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const r of rows) {
    const out = {};
    for (const c of cols) out[c] = pctCols.includes(c) ? num(cell(r[c])) : cell(r[c]);
    ws.addRow(out);
  }
  for (const c of pctCols) if (cols.includes(c)) ws.getColumn(c).numFmt = PCT_FMT;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length || 1 } };

  return wb.xlsx.writeBuffer();
}

// sheets: [{ name, rows, pctCols }] — one worksheet per entry, e.g. one per fund type.
async function toXlsxMultiSheet(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sayakaya Analytics';
  wb.created = new Date();

  for (const { name, rows, pctCols = [] } of sheets) {
    const ws = wb.addWorksheet(String(name).slice(0, 31)); // Excel sheet name limit
    const cols = inferColumns(rows);
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A4A' } };
    for (const r of rows) {
      const out = {};
      for (const c of cols) out[c] = pctCols.includes(c) ? num(cell(r[c])) : cell(r[c]);
      ws.addRow(out);
    }
    for (const c of pctCols) if (cols.includes(c)) ws.getColumn(c).numFmt = PCT_FMT;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { toCsv, toXlsxBuffer, toXlsxMultiSheet };
