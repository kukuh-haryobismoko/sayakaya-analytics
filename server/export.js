'use strict';

const ExcelJS = require('exceljs');

function inferColumns(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

// BigQuery returns some types as objects (e.g. BigQueryTimestamp, Big numbers).
// Normalize them to plain primitives for export.
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('value' in value) return value.value;     // BigQueryDate/Timestamp/Numeric
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

async function toXlsxBuffer(rows, sheetName = 'Data') {
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
    for (const c of cols) out[c] = cell(r[c]);
    ws.addRow(out);
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length || 1 } };

  return wb.xlsx.writeBuffer();
}

module.exports = { toCsv, toXlsxBuffer };
