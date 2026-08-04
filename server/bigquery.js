'use strict';

const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'sayakaya';
const LOCATION = process.env.BQ_LOCATION || 'asia-southeast2';
const MAX_BYTES_BILLED = String(process.env.MAX_BYTES_BILLED || 2_000_000_000);

// Credentials resolution, in order of preference:
//   1. GCP_SA_KEY  — the full service-account JSON as a single env var (used on
//      Netlify / any host where you can't ship a key file).
//   2. GOOGLE_APPLICATION_CREDENTIALS — path to a local key file (local dev).
//   3. Application Default Credentials — e.g. a Cloud Run runtime account.
function buildClient() {
  const opts = { projectId: PROJECT_ID };
  if (process.env.GCP_SA_KEY) {
    let creds;
    try {
      creds = JSON.parse(process.env.GCP_SA_KEY);
    } catch (e) {
      throw new Error('GCP_SA_KEY is not valid JSON. Paste the whole key file contents.');
    }
    opts.credentials = { client_email: creds.client_email, private_key: creds.private_key };
    if (creds.project_id && !process.env.GCP_PROJECT_ID) opts.projectId = creds.project_id;
  }
  return new BigQuery(opts);
}

const bq = buildClient();

// Belt-and-suspenders redaction: strip these columns out of EVERY query
// result, regardless of dataset/table, so a `SELECT *` — from the SQL Lab or
// from SQL the Ask LLM writes — can never leak a credential or KYC identity
// field even though no curated query (queries.js/explore.js) ever selects
// them on purpose. Matched by column name only — a curated query that
// legitimately needs one of these columns (e.g. Q.userContact's `address`
// for the PDF letterhead) must call runQuery with { redact: false }.
const SENSITIVE_COLUMN_RE = /^(password|password_hash|id_number|mothers_maiden_name|address|full_address|home_address)$|_photo_url$|signature/i;

function redactSensitiveColumns(rows) {
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
async function runQuery(sql, params = {}, { maxBytes = MAX_BYTES_BILLED, redact = true } = {}) {
  const [job] = await bq.createQueryJob({
    query: sql,
    params,
    location: LOCATION,
    maximumBytesBilled: maxBytes,
    useQueryCache: false, // every report must reflect live table state, not BigQuery's cached job results
  });
  const [rows] = await job.getQueryResults();
  return redact ? redactSensitiveColumns(rows) : rows;
}

/**
 * Estimate bytes a query would scan, without running it. Used by the SQL Lab
 * to show cost before execution.
 */
async function dryRun(sql, params = {}) {
  const [job] = await bq.createQueryJob({
    query: sql,
    params,
    location: LOCATION,
    dryRun: true,
  });
  const bytes = Number(job.metadata.statistics.totalBytesProcessed || 0);
  return { bytes };
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
function validateAdHoc(sqlRaw) {
  if (!sqlRaw || !sqlRaw.trim()) return { ok: false, error: 'Query is empty.' };

  // Strip line + block comments so they cannot hide blocked tokens.
  const sql = sqlRaw
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();

  // Disallow multiple statements.
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
function capRows(sql, limit = 5000) {
  return `SELECT * FROM (\n${sql}\n) LIMIT ${parseInt(limit, 10)}`;
}

module.exports = {
  bq,
  PROJECT_ID,
  LOCATION,
  MAX_BYTES_BILLED,
  runQuery,
  dryRun,
  validateAdHoc,
  capRows,
  redactSensitiveColumns,
};

// Self-check: `node server/bigquery.js` — does not touch BigQuery, only
// exercises the redaction regex/filter used by runQuery above.
if (require.main === module) {
  const assert = require('assert');
  const out = redactSensitiveColumns([
    { user_id: 1, email: 'a@b.com', password: 'x', id_number: '123', ktp_photo_url: 'u', signature_url: 'u', id_address_city: 'Jakarta' },
  ]);
  assert.deepStrictEqual(out, [{ user_id: 1, email: 'a@b.com', id_address_city: 'Jakarta' }]);
  assert.deepStrictEqual(redactSensitiveColumns([]), []);
  console.log('bigquery.js redaction self-check passed');
}
