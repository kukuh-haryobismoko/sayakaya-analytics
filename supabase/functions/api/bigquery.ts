// BigQuery access for the Supabase Edge Function deployment target.
//
// Deliberately does NOT use the @google-cloud/bigquery Node SDK — its
// auth/streaming behavior under Deno's Node-compat layer is unverified, and
// this app already broke once on a Node serverless host (Netlify) over a
// library's disk-file assumption (pdfkit's .afm fonts). Betting the entire
// backend on an unverified SDK behaving correctly under a *different*
// runtime is the wrong risk for a financial dashboard, so this talks to
// BigQuery's REST API directly: fetch + a service-account JWT signed with
// Deno's built-in Web Crypto API. Same external behavior as server/bigquery.js,
// different implementation.

const PROJECT_ID = Deno.env.get('GCP_PROJECT_ID') || 'sayakaya';
const LOCATION = Deno.env.get('BQ_LOCATION') || 'asia-southeast2';
const MAX_BYTES_BILLED = String(Deno.env.get('MAX_BYTES_BILLED') || 2_000_000_000);

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

// Cached across requests within the same isolate — a fresh JWT/token exchange
// on every single query would be wasteful; tokens are valid for 1 hour.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const sa = loadServiceAccount();
  const key = await importPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery',
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

// ---- Query parameter typing --------------------------------------------
// BigQuery's REST API requires each parameter's type spelled out explicitly
// (the Node SDK infers this client-side; here we do the same inference by
// hand). Every param this app actually passes is a string, an integer, a
// boolean, or an array of strings — see server/queries.js / explore.js.
function toQueryParameter(name: string, value: unknown) {
  if (Array.isArray(value)) {
    return {
      name,
      parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } },
      parameterValue: { arrayValues: value.map((v) => ({ value: String(v) })) },
    };
  }
  if (typeof value === 'boolean') {
    return { name, parameterType: { type: 'BOOL' }, parameterValue: { value: String(value) } };
  }
  if (typeof value === 'number') {
    const type = Number.isInteger(value) ? 'INT64' : 'FLOAT64';
    return { name, parameterType: { type }, parameterValue: { value: String(value) } };
  }
  // Dates ('YYYY-MM-DD'), ids, search text, etc. — plain STRING, same as the
  // Node SDK does for un-wrapped JS strings. BigQuery's coercion rules accept
  // a STRING parameter compared against a DATE/TIMESTAMP expression (this
  // app's queries always compare via DATE(col) BETWEEN @from AND @to), which
  // is the same behavior the SDK has been relying on all along.
  return { name, parameterType: { type: 'STRING' }, parameterValue: { value: String(value) } };
}

// ---- Row parsing ---------------------------------------------------------
// The REST API returns every value as a string, keyed positionally
// (row.f[i].v) against schema.fields[i] — turn that into plain objects
// keyed by column name, coercing to native JS types where that's lossless.
// NUMERIC/BIGNUMERIC stay as strings (preserves full precision — the same
// reason the Node SDK returns those as big.js instances instead of numbers).
function coerceValue(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
      return Number(v);
    case 'BOOLEAN':
    case 'BOOL':
      return v === 'true' || v === true;
    case 'RECORD':
    case 'STRUCT':
      return v; // not used by this app's final SELECT output; pass through
    default:
      // STRING, NUMERIC, BIGNUMERIC, DATE, DATETIME, TIMESTAMP, TIME, BYTES
      return v;
  }
}

function parseRows(schema: { fields: { name: string; type: string; mode?: string }[] } | undefined, rows: { f: { v: unknown }[] }[] | undefined): Record<string, unknown>[] {
  const fields = schema?.fields || [];
  return (rows || []).map((row) => {
    const out: Record<string, unknown> = {};
    fields.forEach((field, i) => {
      const raw = row.f[i]?.v;
      // REPEATED fields (e.g. ARRAY_AGG) come back as an array of {v: ...}
      // wrapper objects, not plain scalars — unwrap each element too.
      out[field.name] = field.mode === 'REPEATED'
        ? ((raw as { v: unknown }[] | null) || []).map((item) => coerceValue(field.type, item.v))
        : coerceValue(field.type, raw);
    });
    return out;
  });
}

async function bqFetch(path: string, body: Record<string, unknown>) {
  const token = await getAccessToken();
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `BigQuery error ${res.status}`);
  return data;
}

// Belt-and-suspenders redaction: strip these columns out of EVERY query
// result, regardless of dataset/table, so a `SELECT *` — from the SQL Lab or
// from SQL the Ask LLM writes — can never leak a credential or KYC identity
// field even though no curated query (queries.ts/explore.ts) ever selects
// them on purpose. Matched by column name only, so it's a free no-op for the
// curated queries that don't touch these columns at all. Mirrors
// server/bigquery.js's redactSensitiveColumns — keep both in sync.
const SENSITIVE_COLUMN_RE = /^(password|password_hash|id_number|mothers_maiden_name|address|full_address|home_address)$|_photo_url$|signature/i;

function redactSensitiveColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!rows.length) return rows;
  const hit = Object.keys(rows[0]).filter((k) => SENSITIVE_COLUMN_RE.test(k));
  if (!hit.length) return rows;
  return rows.map((row) => {
    const clean = { ...row };
    for (const k of hit) delete clean[k];
    return clean;
  });
}

/**
 * Run a parameterized query that this app controls (trusted SQL, untrusted params).
 * Always prefer named parameters for any user-supplied value.
 */
export async function runQuery(
  sql: string,
  params: Record<string, unknown> = {},
  { maxBytes = MAX_BYTES_BILLED, redact = true }: { maxBytes?: string | number; redact?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const queryParameters = Object.entries(params).map(([name, value]) => toQueryParameter(name, value));
  let data = await bqFetch(`projects/${PROJECT_ID}/queries`, {
    query: sql,
    useLegacySql: false,
    location: LOCATION,
    maximumBytesBilled: String(maxBytes),
    useQueryCache: false, // every report must reflect live table state, not a cached job result
    ...(queryParameters.length ? { parameterMode: 'NAMED', queryParameters } : {}),
  });

  // A slow query can come back with jobComplete:false; poll getQueryResults
  // (same endpoint also paginates — collect every page for large exports).
  let rows = data.rows || [];
  const jobId = data.jobReference?.jobId;
  while (!data.jobComplete || data.pageToken) {
    const qs = new URLSearchParams({ location: LOCATION });
    if (data.pageToken) qs.set('pageToken', data.pageToken);
    const token = await getAccessToken();
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?${qs}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `BigQuery error ${res.status}`);
    rows = rows.concat(data.rows || []);
    if (!data.pageToken) break;
  }

  const parsed = parseRows(data.schema, rows);
  return redact ? redactSensitiveColumns(parsed) : parsed;
}

/**
 * Estimate bytes a query would scan, without running it. Used by the SQL Lab
 * to show cost before execution.
 */
export async function dryRun(sql: string, params: Record<string, unknown> = {}): Promise<{ bytes: number }> {
  const queryParameters = Object.entries(params).map(([name, value]) => toQueryParameter(name, value));
  const data = await bqFetch(`projects/${PROJECT_ID}/queries`, {
    query: sql,
    useLegacySql: false,
    location: LOCATION,
    dryRun: true,
    ...(queryParameters.length ? { parameterMode: 'NAMED', queryParameters } : {}),
  });
  return { bytes: Number(data.totalBytesProcessed || 0) };
}

// Tokens that must never appear in an ad-hoc query. Keeps the SQL Lab read-only
// and prevents pulling the password column or mutating data.
const BLOCKED = [
  'insert', 'update', 'delete', 'merge', 'drop', 'create', 'alter', 'truncate',
  'grant', 'revoke', 'call', 'replace', 'load', 'export', 'password',
];

/**
 * Validate ad-hoc SQL from the SQL Lab. Returns { ok, error }.
 * Rules: exactly one statement, must start with SELECT or WITH, no blocked tokens.
 */
export function validateAdHoc(sqlRaw: string): { ok: true; sql: string } | { ok: false; error: string } {
  if (!sqlRaw || !sqlRaw.trim()) return { ok: false, error: 'Query is empty.' };

  const sql = sqlRaw
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();

  const withoutTrailing = sql.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { ok: false, error: 'Only a single statement is allowed.' };
  }

  const lowered = withoutTrailing.toLowerCase();
  if (!/^(\s*with\b|\s*select\b)/.test(lowered)) {
    return { ok: false, error: 'Only SELECT (or WITH … SELECT) queries are allowed.' };
  }

  for (const word of BLOCKED) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(lowered)) {
      return { ok: false, error: `Blocked keyword "${word}" is not permitted here.` };
    }
  }
  return { ok: true, sql: withoutTrailing };
}

/**
 * Wrap a validated ad-hoc query with an enforced row cap so the UI never tries
 * to render millions of rows.
 */
export function capRows(sql: string, limit: number | string = 5000): string {
  return `SELECT * FROM (\n${sql}\n) LIMIT ${parseInt(String(limit), 10)}`;
}

export { redactSensitiveColumns };

// Self-check: `deno run bigquery.ts` — does not touch BigQuery, only
// exercises the redaction regex/filter used by runQuery above.
if (import.meta.main) {
  const { assertEquals } = await import('jsr:@std/assert');
  const out = redactSensitiveColumns([
    { user_id: 1, email: 'a@b.com', password: 'x', id_number: '123', ktp_photo_url: 'u', signature_url: 'u', id_address_city: 'Jakarta' },
  ]);
  assertEquals(out, [{ user_id: 1, email: 'a@b.com', id_address_city: 'Jakarta' }]);
  assertEquals(redactSensitiveColumns([]), []);
  console.log('bigquery.ts redaction self-check passed');
}

export { PROJECT_ID, LOCATION, MAX_BYTES_BILLED };
