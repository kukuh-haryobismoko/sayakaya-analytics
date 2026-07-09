// Ported 1:1 from server/ask.js — already just fetch() calls to the
// Anthropic API, so this needs no runtime rework beyond process.env ->
// Deno.env.get and require/module.exports -> ES modules.
import { runQuery, validateAdHoc, capRows } from './bigquery.ts';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5';

export function askEnabled(): boolean {
  return Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
}

// The curated set of tables Ask is allowed to reference — kept separate from
// live BigQuery introspection so the UI's "scope to these tables" picker can
// never list a table beyond what the SCHEMA below already exposes.
export const TABLES = [
  'main.transactions', 'main.users', 'main.funds', 'main.portfolios',
  'main.bonus_portfolios', 'main.investment_managers', 'main.user_profiles',
  'mi_fee_logs.mi_fee',
  'ml.aum_forecast', 'ml.tx_forecast', 'ml.churn_model', 'ml.churn_features',
];

// Compact, accurate description of the tables the model may query. Keeping this
// tight keeps each request cheap while still giving Claude what it needs.
const SCHEMA = `
Project/dataset prefix for every table: \`sayakaya.main\`

transactions (one row per order)
  id, transaction_number, user_id, fund_id, product_id
  type     STRING  one of: buy, sell, SWITCH_IN, SWITCH_OUT, reinvestment
  status   STRING  one of: completed, expired, cancelled, verified_by_operational, verified, completed_payment, pending_payment
  unit FLOAT, amount NUMERIC, final_amount NUMERIC, value_per_unit NUMERIC, realized_gain_loss NUMERIC
  payment_method STRING, payment_gateway STRING
  created_at TIMESTAMP, completed_at TIMESTAMP, paid_at TIMESTAMP

users (one row per registered user)
  id, verification_status STRING (unverified, verified, failed, pending_verification)
  created_at DATETIME
  (the password column EXISTS but is FORBIDDEN — never select or reference it)

funds (the fund catalog, ~2350 rows)
  id, name STRING, type STRING (FIXED_INCOME, MONEY_MARKET, MIXED, EQUITY, PROTECTED)
  is_sharia BOOL, latest_nav_value NUMERIC, latest_aum_value INT64, latest_aum_date DATE
  management_fee FLOAT, listing_status STRING (ACTIVE, INACTIVE, UPDATE), investment_manager_id

portfolios (current holdings bought with cash; one row per user+fund)
  id, user_id, fund_id, unit FLOAT, deleted_at TIMESTAMP (NULL = active holding)
  active holding filter: deleted_at IS NULL AND unit > 0

bonus_portfolios (current holdings granted as a bonus/promo; one row per user+fund)
  user_id, fund_id, unit FLOAT, status STRING (on_going = active; others are not active holdings)
  active holding filter: status = 'on_going'

Both portfolios and bonus_portfolios hold the same shape (user_id, fund_id, unit) and
combine into one investor's position: for any "holdings" or "AUM" question, UNION ALL
the two tables (each filtered to active as above) before joining funds, e.g.:
  WITH active AS (
    SELECT user_id, fund_id, unit FROM portfolios WHERE deleted_at IS NULL AND unit > 0
    UNION ALL
    SELECT user_id, fund_id, unit FROM bonus_portfolios WHERE status = 'on_going'
  )
  holding value = unit * funds.latest_nav_value, summed/grouped per active row above

investment_managers
  id, name STRING

investment_managers
  id, common_name STRING, ojk_code STRING, latest_aum_value INT64, latest_aum_date DATETIME

mi_fee  (FULL PATH: \`sayakaya.mi_fee_logs.mi_fee\` — different dataset)
  daily AUM and fee snapshot, one row per fund per day
  fund_id, fund_name STRING, latest_nav_value NUMERIC, total_unit NUMERIC,
  AUM NUMERIC (the platform's AUM in that fund that day),
  aperd_share_per_day NUMERIC (Sayakaya's daily revenue), mi_share_per_day NUMERIC,
  created_at TIMESTAMP (the day of the snapshot)
  NOTE: AUM is point-in-time. For platform AUM on a day = SUM(AUM) that day.
  For monthly AUM use the last day of the month. Revenue (aperd_share_per_day) is summed.

user_profiles (one row per user; join on user_id = users.id)
  user_id, name STRING, gender STRING, occupation STRING, id_address_city STRING,
  monthly_income INT64, total_asset INT64, investment_risk_tolerance STRING, birthdate DATE
  (this table also has KYC identity fields — DO NOT use id_number, mothers_maiden_name,
   or any *_photo_url / signature columns)

Conventions:
- PREDICTIVE MODELS live in dataset \`sayakaya.ml\` (BigQuery ML). Use them for forecast/churn questions:
  * AUM forecast: SELECT * FROM ML.FORECAST(MODEL \`sayakaya.ml.aum_forecast\`, STRUCT(30 AS horizon, 0.9 AS confidence_level))
  * Buy-volume forecast: SELECT * FROM ML.FORECAST(MODEL \`sayakaya.ml.tx_forecast\`, STRUCT(30 AS horizon, 0.9 AS confidence_level))
    forecast cols: forecast_timestamp, forecast_value, prediction_interval_lower_bound, prediction_interval_upper_bound
  * Churn scoring: SELECT user_id, (SELECT prob FROM UNNEST(predicted_churned_probs) WHERE label=1) AS churn_prob
      FROM ML.PREDICT(MODEL \`sayakaya.ml.churn_model\`, (SELECT * FROM \`sayakaya.ml.churn_features\` WHERE churned=0))
      ORDER BY churn_prob DESC
  * Churn = an investor who ever bought but now holds nothing (fully redeemed).
- All monetary amounts are in Indonesian Rupiah (IDR).
- "Buy/sell volume" means SUM(final_amount) WHERE status='completed' for that type.
- "AUM" of a fund = funds.latest_aum_value. A user's or the platform's AUM/holdings = the
  portfolios + bonus_portfolios union above (both count — bonus units are real holdings the
  investor did not pay cash for, but they still hold them), not portfolios alone.
- transactions.created_at is TIMESTAMP; users.created_at is DATETIME — use DATE()/EXTRACT accordingly.
- If the message includes a "Resolved entity lookups" block, those are real lookups from the
  database for names the user mentioned. When a resolved entry gives an id, filter/join using
  that id (the table's own id column, or the matching foreign key like fund_id /
  investment_manager_id) — NOT a name = '...' comparison, and never a LIKE '%...%' guess.
  When a resolved entry has no id (occupation/city), use an exact = or IN match on the given
  value(s). Only fall back to your own LIKE guess if that block says no match was found.
`;

function systemPrompt(): string {
  return `You convert a business question about the Sayakaya mutual-fund platform into ONE BigQuery Standard SQL query.

Output rules (strict):
- Respond with ONLY the SQL. No explanation, no markdown, no code fences.
- Exactly one statement, read-only: a single SELECT, or WITH ... SELECT. Never INSERT/UPDATE/DELETE/MERGE/DDL.
- Always fully-qualify tables. Most are \`sayakaya.main.<table>\`; exceptions: \`sayakaya.mi_fee_logs.mi_fee\` and the ML models/features in \`sayakaya.ml\`.
- NEVER select or reference the users.password column.
- Include a sensible LIMIT (<= 1000) for row-level results; aggregates that return few rows don't need one.
- Use the conventions and schema below exactly.

${SCHEMA}`;
}

interface PriorAttempt { sql: string; error: string }

async function questionToSql(question: string, priorAttempt: PriorAttempt | null, context?: string | null): Promise<string> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');

  const userContent = context
    ? `${question}\n\nUser-provided hint (tables/datasets to use, or a related query for context — may be partial or imprecise, verify against the schema above):\n${context}`
    : question;
  const messages: { role: string; content: string }[] = [{ role: 'user', content: userContent }];
  if (priorAttempt) {
    messages.push({ role: 'assistant', content: priorAttempt.sql });
    messages.push({
      role: 'user',
      content: `That query failed with this BigQuery error:\n${priorAttempt.error}\n\nFix it and return only the corrected SQL.`,
    });
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system: systemPrompt(),
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
    .trim();

  // Strip accidental markdown fences if the model added them.
  return text
    .replace(/^```sql\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/, '')
    .trim();
}

// ---- Entity resolution --------------------------------------------------
// A question that names a specific fund/manager/campaign/etc. ("exclude
// Avrist Liquid Fund") gives the model nothing to match against but its own
// guess at spelling — which is how it ends up writing a fragile
// LOWER(name) LIKE '%...%' filter that can both under- and over-match. So
// before generating SQL, look the mentioned name up for real and hand the
// model the actual row value(s) to match exactly against instead.
// idColumn is the table's own primary key, used to ground the model on a
// stable identifier instead of a name string wherever one exists (funds,
// investment_managers, campaigns all have one). occupation/city are plain
// attribute values on user_profiles with no lookup table of their own — the
// resolved text value IS the filter, there's no id to fall back to.
interface EntityColumn { table: string; column: string; idColumn: string | null; label: string }

const ENTITY_COLUMNS: EntityColumn[] = [
  { table: 'sayakaya.main.funds', column: 'name', idColumn: 'id', label: 'funds.name' },
  { table: 'sayakaya.main.investment_managers', column: 'name', idColumn: 'id', label: 'investment_managers.name' },
  { table: 'sayakaya.main.campaigns', column: 'name', idColumn: 'id', label: 'campaigns.name' },
  { table: 'sayakaya.main.campaigns', column: 'promo_code', idColumn: 'id', label: 'campaigns.promo_code' },
  { table: 'sayakaya.main.user_profiles', column: 'occupation', idColumn: null, label: 'user_profiles.occupation' },
  { table: 'sayakaya.main.user_profiles', column: 'id_address_city', idColumn: null, label: 'user_profiles.id_address_city' },
];

function entitySystemPrompt(): string {
  return `Extract any specific named entities in the question that would need to be matched
against real row values in the Sayakaya database — free-text proper nouns like fund names,
investment manager names, campaign/promo names, cities, occupations.

Do NOT extract fixed enum values that are already fully known (transaction type/status,
verification_status, gender, fund type, campaign_type, is_sharia) — only extract names the
model would otherwise have to guess the exact spelling of.

Respond with ONLY a JSON array, no markdown, no explanation:
[{"column": "<one of: funds.name, investment_managers.name, campaigns.name, campaigns.promo_code, user_profiles.occupation, user_profiles.id_address_city>", "raw_text": "<the phrase from the question, as written>"}]

Return [] if the question has no such named entities.`;
}

interface EntityMention { column: string; raw_text: string }

async function extractEntityMentions(question: string): Promise<EntityMention[]> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300, system: entitySystemPrompt(),
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.filter((m) => m && m.column && m.raw_text) : [];
  } catch {
    return [];
  }
}

// Looks each extracted mention up for real and returns grounding text for the
// SQL-generation prompt. Never throws — a lookup failure just means that one
// mention falls back to the model's own guess, same as before this existed.
async function resolveEntityContext(question: string): Promise<string> {
  let mentions: EntityMention[];
  try {
    mentions = await extractEntityMentions(question);
  } catch {
    return '';
  }
  if (!mentions.length) return '';

  const lines: string[] = [];
  for (const m of mentions) {
    const col = ENTITY_COLUMNS.find((c) => c.label === m.column);
    if (!col) continue;
    try {
      const idSelect = col.idColumn ? `${col.idColumn} AS id, ` : '';
      const asOnePhrase = `%${String(m.raw_text).toLowerCase()}%`;
      let rows = await runQuery(
        `SELECT DISTINCT ${idSelect}${col.column} AS v FROM \`${col.table}\` WHERE LOWER(${col.column}) LIKE @pattern LIMIT 10`,
        { pattern: asOnePhrase },
      );
      // The raw text may not be a contiguous substring of the real name (e.g.
      // "avrist lq45" for "Avrist Indeks LQ45") — retry token-by-token before
      // giving up, so the model still gets a real match instead of a guess.
      const words = String(m.raw_text).toLowerCase().split(/\s+/).filter(Boolean);
      if (!rows.length && words.length > 1) {
        rows = await runQuery(
          `SELECT DISTINCT ${idSelect}${col.column} AS v FROM \`${col.table}\` WHERE LOWER(${col.column}) LIKE @pattern LIMIT 10`,
          { pattern: `%${words.join('%')}%` },
        );
      }
      // Still nothing? Could be a genuine typo ("liqud" for "liquid") rather
      // than a missing/reordered word — nearest-neighbor by edit distance.
      // Only commit to a single, clearly-best match (tight ratio threshold,
      // and require real separation from the runner-up) — an ambiguous or
      // genuinely novel name should fall through to the model's own guess
      // rather than get silently mapped to the wrong fund.
      if (!rows.length) {
        const term = String(m.raw_text).toLowerCase();
        const fuzzy = await runQuery(
          `SELECT DISTINCT ${idSelect}${col.column} AS v, EDIT_DISTANCE(LOWER(${col.column}), @term) AS d
           FROM \`${col.table}\` ORDER BY d ASC LIMIT 2`,
          { term },
        );
        const [best, runnerUp] = fuzzy;
        const maxD = Math.max(1, Math.round(term.length * 0.2));
        const isClearWinner = best && Number(best.d) <= maxD
          && (!runnerUp || Number(runnerUp.d) > Number(best.d) + 1);
        rows = isClearWinner ? [best] : [];
      }
      const candidates = rows.filter((r) => r.v);
      if (!candidates.length) {
        lines.push(`"${m.raw_text}" -> no matching ${m.column} value found in the database (check for a typo before falling back to a fuzzy match).`);
      } else if (col.idColumn) {
        // Prefer the table's own primary key over the name string — it's
        // stable, unambiguous, and is what every join/filter in this schema
        // actually uses (fund_id, investment_manager_id, ...), so ground the
        // model on that instead of a WHERE ... name = '...' comparison.
        const table = col.table.split('.').pop();
        const pairs = candidates.map((r) => `id=${JSON.stringify(r.id)} (name: ${JSON.stringify(r.v)})`).join(', ');
        lines.push(`"${m.raw_text}" -> resolved in ${table}: ${pairs}. Filter/join using this id (${table}.id, or the matching foreign key column such as fund_id / investment_manager_id elsewhere in the schema) — do NOT match by the name string.`);
      } else {
        lines.push(`"${m.raw_text}" -> exact ${m.column} value(s) found: ${candidates.map((c) => `"${c.v}"`).join(', ')}.`);
      }
    } catch {
      // Skip this one mention; don't let a single lookup failure block the request.
    }
  }
  return lines.length ? `Resolved entity lookups (ground truth from the database):\n${lines.join('\n')}` : '';
}

interface AskError extends Error { sql?: string }

/**
 * Full flow: question -> SQL -> validate (read-only) -> run -> rows.
 * BigQuery errors (e.g. a guessed column/table name that doesn't exist) are
 * fed back to the model once so it can self-correct before we give up.
 */
export async function ask(question: string, context?: string | null): Promise<{ sql: string; rows: Record<string, unknown>[] }> {
  const resolved = await resolveEntityContext(question);
  const fullContext = [context, resolved].filter(Boolean).join('\n\n') || null;
  let sql = await questionToSql(question, null, fullContext);
  for (let attempt = 0; ; attempt++) {
    const v = validateAdHoc(sql);
    if (!v.ok) {
      const err: AskError = new Error(`The generated query was blocked: ${v.error}`);
      err.sql = sql;
      throw err;
    }
    try {
      const rows = await runQuery(capRows(v.sql, 1000), {});
      return { sql: v.sql, rows };
    } catch (e) {
      if (attempt >= 1) {
        const err: AskError = new Error(`Query failed: ${(e as Error).message}`);
        err.sql = v.sql;
        throw err;
      }
      sql = await questionToSql(question, { sql: v.sql, error: (e as Error).message });
    }
  }
}

// ---- Chart suggestion --------------------------------------------------
// Given the question and the rows Ask (or an edited re-run) returned, ask the
// model to pick a Chart.js-friendly visualization. Cheap, separate call from
// questionToSql so a bad/no suggestion never affects the SQL generation path.
const CHART_TYPES = ['bar', 'line', 'pie', 'doughnut', 'scatter', 'none'];

function val(v: unknown): unknown { return v && typeof v === 'object' && 'value' in (v as Record<string, unknown>) ? (v as { value: unknown }).value : v; }

function chartSystemPrompt(): string {
  return `You choose how to visualize a table of query results with Chart.js.
Respond with ONLY a JSON object, no markdown, no explanation:
{"type": "bar"|"line"|"pie"|"doughnut"|"scatter"|"none", "x": "<column name>", "y": "<column name>", "label": "<short chart title>"}
Rules:
- "type" must be exactly one of: bar, line, pie, doughnut, scatter, none.
- Use "none" if the data doesn't chart well (a single scalar/row, free-text-only columns, too many categories).
- "line" for a time series (a date/period-like x column). "bar" for comparing categories.
- "pie"/"doughnut" for a small (<= 8) set of categories that sum to a whole.
- "scatter" for two numeric columns with no natural category axis.
- "x" and "y" must be exact column names from the sample given, and "y" must be numeric.
- Keep "label" under 40 characters.`;
}

export async function suggestChart(question: string | undefined, rows: Record<string, unknown>[], hint?: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key || !Array.isArray(rows) || !rows.length) return { type: 'none' };

  const columns = Object.keys(rows[0]);
  const sample = rows.slice(0, 5).map((r) => Object.fromEntries(columns.map((c) => [c, val(r[c])])));
  const userContent = [
    `Question asked: ${question || '(none — this is a manually edited query)'}`,
    hint ? `User's visualization request: ${hint}` : '',
    `Columns: ${columns.join(', ')}`,
    `Sample rows (up to 5 of ${rows.length}):\n${JSON.stringify(sample, null, 2)}`,
  ].filter(Boolean).join('\n\n');

  let text: string;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 200, system: chartSystemPrompt(),
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) return { type: 'none' };
    const data = await res.json();
    text = (data.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  } catch {
    return { type: 'none' };
  }

  try {
    const spec = JSON.parse(text);
    if (!CHART_TYPES.includes(spec.type)) return { type: 'none' };
    if (spec.type !== 'none' && (!columns.includes(spec.x) || !columns.includes(spec.y))) return { type: 'none' };
    return spec;
  } catch {
    return { type: 'none' };
  }
}
