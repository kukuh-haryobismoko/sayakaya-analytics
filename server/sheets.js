'use strict';

// Pushes the same holdings table as the PDF portfolio report (server/pdf.js,
// "PDF (portfolio only)" — no fund-performance pages) into one shared,
// pre-existing "tracker" Google Sheet — a new tab per export, not a new file
// each time.
//
// Why not a fresh spreadsheet per export (the original design): creating a
// new Drive-backed file requires the service account to act as its own
// identity, which sayakaya.id's Google Workspace rejects outright ("The
// caller does not have permission" on spreadsheets.create itself, before
// sharing is even attempted) — bare service accounts without domain-wide
// delegation are treated as external to the org. Writing into a spreadsheet
// a real person already owns and shared with the service account sidesteps
// that restriction entirely: every call here is a plain read/write on an
// existing file, which only needs the `spreadsheets` scope, not `drive.*`.
//
// Setup (one-time, no Workspace admin needed): create a Google Sheet, share
// it with the service account's client_email as Editor, then set that
// sheet's ID (from its URL) as GSHEET_TRACKER_ID.
//
// Auth: same service account as BigQuery (server/bigquery.js), same
// credential resolution order (GCP_SA_KEY env var on serverless hosts,
// GOOGLE_APPLICATION_CREDENTIALS key file for local dev).

const { JWT } = require('google-auth-library');
const {
  val, idNum, statementDate, HOLDINGS_COLS, filterCols, DISCLAIMER, OJK_LINE,
} = require('./pdf');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let client;
function auth() {
  if (client) return client;
  if (process.env.GCP_SA_KEY) {
    let creds;
    try {
      creds = JSON.parse(process.env.GCP_SA_KEY);
    } catch (e) {
      throw new Error('GCP_SA_KEY is not valid JSON. Paste the whole key file contents.');
    }
    client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  } else {
    client = new JWT({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: SCOPES });
  }
  return client;
}

// gaxios's default error message ("The caller does not have permission")
// drops which of the 3 calls (add tab / write values / format) it came
// from — wrap it so a permission error actually says where it happened.
async function call(method, url, data) {
  try {
    const res = await auth().request({ url, method, data });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`Google API call failed [${method} ${url}]: ${detail}`);
  }
}

// Same holdings columns/formatting as the PDF's statement table.
function holdingsGrid(holdings, columns) {
  const cols = filterCols(HOLDINGS_COLS(1000), 1000, columns);
  const header = cols.map((c) => c.label);
  const rows = holdings.map((h) => cols.map((c) => {
    const raw = h[c.key];
    return String(c.format ? c.format(raw) : (val(raw) ?? '—'));
  }));
  return { cols, header, rows };
}

// Same total row as the PDF (multiple funds only), aligned under the same
// columns filterCols left visible.
function totalsRow(cols, holdings) {
  const anchorCol = cols.find((c) => c.key !== 'fund' && c.key !== 'fund_type');
  if (holdings.length <= 1 || !anchorCol) return null;
  const sum = (k) => holdings.reduce((s, h) => s + (Number(val(h[k])) || 0), 0);
  const totalFund = sum('fund_value');
  const totalMarket = sum('value');
  const totalGain = totalMarket - totalFund;
  const totalPct = totalFund ? (totalGain / totalFund) * 100 : null;
  const sumKeys = ['fund_value', 'value', 'gain_loss', 'gain_pct'];
  return cols.map((c) => {
    if (c.key === anchorCol.key && !sumKeys.includes(anchorCol.key)) return 'Total';
    if (c.key === 'fund_value') return idNum(totalFund);
    if (c.key === 'value') return idNum(totalMarket);
    if (c.key === 'gain_loss') return idNum(totalGain);
    if (c.key === 'gain_pct') return totalPct == null ? '—' : idNum(totalPct, 2) + '%';
    return '';
  });
}

// Sheet tab titles: max 100 chars, and can't contain [ ] * ? / \ : — strip
// those out of investor names/SIDs before using them in a tab title.
function safeTitle(s) {
  return String(s).replace(/[[\]*?/\\:]/g, '-').slice(0, 95);
}

// ponytail: same investor exported twice on the same day collides (Sheets
// API errors on a duplicate tab name) — add a counter/time suffix if that
// turns out to happen in practice.
function ddmmyyyy(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}${m}${date.getFullYear()}`;
}

function boldShaded(sheetId, rowIndex, colCount) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: colCount },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.957, green: 0.949, blue: 0.925 } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    },
  };
}

// contact/holdings: same shapes as PDF.portfolioReport. options: { columns, username }
async function portfolioReport({ contact, holdings }, options = {}) {
  const { columns, username } = options;
  const spreadsheetId = process.env.GSHEET_TRACKER_ID;
  if (!spreadsheetId) {
    throw new Error('GSHEET_TRACKER_ID is not set — share a Google Sheet with the service account as Editor and set its ID in the environment.');
  }

  const { cols, header, rows } = holdingsGrid(holdings, columns);
  const total = totalsRow(cols, holdings);

  const sid = val(contact?.sid) || 'SID';
  const investorName = val(contact?.name) || 'Investor';
  const portfolioTitle = safeTitle(`${sid}_${investorName}_${ddmmyyyy()}`);

  const added = await call('POST', `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: portfolioTitle } } }],
  });
  const sheetId = added.replies[0].addSheet.properties.sheetId;

  const portfolioRows = [
    ['CUSTOMER PORTFOLIO', '', '', 'Close NAV', statementDate(holdings)],
    [`Exported by ${username || 'dashboard'} · ${new Date().toISOString()}`],
    [],
    ['NAME', String(val(contact?.name) || '—')],
    ['SID', String(val(contact?.sid) || '—')],
    ['IFUA', String(val(contact?.ifua) || '—')],
    ['Address', String(val(contact?.address) || '—')],
    [],
  ];
  const headerRowIndex = portfolioRows.length;
  portfolioRows.push(header);
  portfolioRows.push(...(rows.length ? rows : [['No active holdings.']]));
  if (total) portfolioRows.push(total);
  portfolioRows.push([]);
  portfolioRows.push([DISCLAIMER]);
  portfolioRows.push([OJK_LINE]);

  await call('POST', `${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: [{ range: `'${portfolioTitle}'!A1`, values: portfolioRows }],
  });

  await call('POST', `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [
      boldShaded(sheetId, 0, 5),
      boldShaded(sheetId, headerRowIndex, header.length),
    ],
  });

  return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}` };
}

module.exports = {
  portfolioReport,
  // Exported for test/sheets-format-smoke.js only.
  holdingsGrid, totalsRow,
};
