// Ported from server/sheets.js — see that file for the full rationale
// (pushes the same holdings table as pdf.ts's portfolioReport, "PDF
// (portfolio only)" — no fund-performance pages — into one shared,
// pre-existing "tracker" Google Sheet, a new tab per export; a bare service
// account can't create its own Drive-backed files under a Google Workspace
// org like sayakaya.id).
//
// Same reasoning as bigquery.ts: no npm auth SDK, a service-account JWT
// hand-signed with Deno's Web Crypto API, talking to the Sheets REST API
// directly via fetch. If you change this, change server/sheets.js too.

import {
  val, idNum, statementDate, HOLDINGS_COLS, filterCols, DISCLAIMER, OJK_LINE,
} from './pdf.ts';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('GCP_SA_KEY');
  if (!raw) throw new Error('GCP_SA_KEY is not set (paste the whole service-account JSON key).');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GCP_SA_KEY is not valid JSON. Paste the whole key file contents.');
  }
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
}

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const sa = loadServiceAccount();
  const key = await importPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth token exchange failed: ${data.error_description || data.error || res.status}`);

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function call(method: string, url: string, data?: unknown): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google API call failed [${method} ${url}]: ${json.error?.message || res.status}`);
  return json;
}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function holdingsGrid(holdings: Record<string, unknown>[], columns?: string[]) {
  const cols = filterCols(HOLDINGS_COLS(1000), 1000, columns);
  const header = cols.map((c) => c.label);
  const rows = holdings.map((h) => cols.map((c) => {
    const raw = h[c.key];
    return String(c.format ? c.format(raw) : (val(raw) ?? '—'));
  }));
  return { cols, header, rows };
}

function totalsRow(cols: ReturnType<typeof HOLDINGS_COLS>, holdings: Record<string, unknown>[]): string[] | null {
  const anchorCol = cols.find((c) => c.key !== 'fund' && c.key !== 'fund_type');
  if (holdings.length <= 1 || !anchorCol) return null;
  const sum = (k: string) => holdings.reduce((s, h) => s + (Number(val(h[k])) || 0), 0);
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
function safeTitle(s: string): string {
  return String(s).replace(/[[\]*?/\\:]/g, '-').slice(0, 95);
}

// ponytail: same investor exported twice on the same day collides (Sheets
// API errors on a duplicate tab name) — add a counter/time suffix if that
// turns out to happen in practice.
function ddmmyyyy(date: Date = new Date()): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}${m}${date.getFullYear()}`;
}

function boldShaded(sheetId: number, rowIndex: number, colCount: number) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: colCount },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.957, green: 0.949, blue: 0.925 } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    },
  };
}

export async function portfolioReport(
  { contact, holdings }: { contact: Record<string, unknown> | undefined; holdings: Record<string, unknown>[] },
  options: { columns?: string[]; username?: string } = {},
): Promise<{ url: string }> {
  const { columns, username } = options;
  const spreadsheetId = Deno.env.get('GSHEET_TRACKER_ID');
  if (!spreadsheetId) {
    throw new Error('GSHEET_TRACKER_ID is not set — share a Google Sheet with the service account as Editor and set its ID in the environment.');
  }

  const { cols, header, rows } = holdingsGrid(holdings, columns);
  const total = totalsRow(cols, holdings);

  const sid = (val(contact?.sid) || 'SID') as string;
  const investorName = (val(contact?.name) || 'Investor') as string;
  const portfolioTitle = safeTitle(`${sid}_${investorName}_${ddmmyyyy()}`);

  const added = await call('POST', `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: portfolioTitle } } }],
  });
  const sheetId = added.replies[0].addSheet.properties.sheetId;

  const portfolioRows: (string | undefined)[][] = [
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
