// Ported 1:1 from server/ask.js — already just fetch() calls to the
// Anthropic API, so this needs no runtime rework beyond process.env ->
// Deno.env.get and require/module.exports -> ES modules.
import { runQuery, validateAdHoc, capRows } from './bigquery.ts';
import * as Auth from './auth.ts';

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
  'mi_fee_logs.mi_fee', 'mi_fee_logs.portfolio_with_code',
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
  id, sid_code STRING (unique investor code — the join key into portfolio_with_code below, which has no user_id)
  verification_status STRING (unverified, verified, failed, pending_verification)
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

portfolio_with_code (FULL PATH: \`sayakaya.mi_fee_logs.portfolio_with_code\` — different dataset)
  daily snapshot of every investor's holdings, one row per sid_code + fund per day (no user_id column)
  sid_code STRING (join to users.sid_code), id (this is the fund's id, i.e. fund_id), fund STRING (fund name),
  fund_type STRING, total_unit NUMERIC (units held, > 0 = open position), avg_buy_price NUMERIC,
  buy_amount NUMERIC (cost basis), latest_nav_value NUMERIC, amount NUMERIC (that holding's value on that day),
  created_at TIMESTAMP — the snapshot's actual date is created_at's date MINUS 1 day, so match a
  specific date with DATE_SUB(DATE(created_at), INTERVAL 1 DAY) = @date, not DATE(created_at) directly.
  Doesn't distinguish regular vs bonus holdings (unlike portfolios/bonus_portfolios below).

Which holdings/AUM source to use:
  - "current"/"today's"/no date mentioned -> the portfolios + bonus_portfolios union above:
    live units x today's latest_nav_value.
  - AUM/holdings "as of" or "on" a specific PAST DATE, or a historical trend over days/weeks/months
    -> portfolio_with_code instead: it's the only table with a daily record; portfolios and
    bonus_portfolios only hold today's state. Join users via sid_code (there is no user_id here):
      SELECT ... FROM \`sayakaya.mi_fee_logs.portfolio_with_code\` pwc
      JOIN \`sayakaya.main.users\` u ON u.sid_code = pwc.sid_code
      WHERE DATE_SUB(DATE(pwc.created_at), INTERVAL 1 DAY) = @date AND pwc.total_unit > 0

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
- "AUM" of a fund = funds.latest_aum_value. A user's or the platform's CURRENT AUM/holdings = the
  portfolios + bonus_portfolios union above (both count — bonus units are real holdings the
  investor did not pay cash for, but they still hold them), not portfolios alone. For AUM/holdings
  on a past date or over time, use portfolio_with_code instead (see the note under that table above).
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
- Earlier turns from this conversation may be included before the current question. Treat the
  current question as a follow-up when it reads like one ("now split that by month", "exclude
  the sharia ones too", "same but for Q2") — reuse the prior query's filters/grouping/tables
  unless the new question overrides them. If it's really a new, unrelated question, ignore the
  earlier turns.

${SCHEMA}`;
}

interface PriorAttempt { sql: string; error: string }
interface HistoryTurn { question: string; sql: string }

async function questionToSql(question: string, priorAttempt: PriorAttempt | null, context?: string | null, history?: HistoryTurn[] | null): Promise<string> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');

  const userContent = context
    ? `${question}\n\nUser-provided hint (tables/datasets to use, or a related query for context — may be partial or imprecise, verify against the schema above):\n${context}`
    : question;
  const messages: { role: string; content: string }[] = [];
  for (const turn of history || []) {
    messages.push({ role: 'user', content: turn.question });
    messages.push({ role: 'assistant', content: turn.sql });
  }
  messages.push({ role: 'user', content: userContent });
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
      // Sonnet 5 spends an unpredictable, un-opted-in chunk of this budget on
      // its own internal reasoning before ever writing SQL — for a hard
      // analytical question that reasoning alone can burn 600-800+ tokens.
      // At 800 total that leaves zero room for the actual query text, which
      // surfaced as "The generated query was blocked: Query is empty."
      // (stop_reason "max_tokens" with 0 output text). Comfortably over-budget
      // instead of chasing the exact reasoning cost per question.
      max_tokens: 4096,
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

This includes wildcard/partial-name mentions (e.g. "exclude any fund matching *syariah*",
"funds with 'index' in the name") — extract raw_text with the wildcard characters (* or %)
kept exactly as the user wrote them; they'll be matched with LIKE, not treated as one exact name.

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

// Prefer the table's own primary key over the name string — it's stable,
// unambiguous, and is what every join/filter in this schema actually uses
// (fund_id, investment_manager_id, ...), so ground the model on that instead
// of a WHERE ... name = '...' comparison. One or many candidates both matter:
// a wildcard or a loose word-order match can legitimately resolve to several
// ids (e.g. "exclude any fund matching *syariah*"), and the model needs to
// know whether the question means IN (keep only these) or NOT IN (exclude
// these) — that's the caller's call to make from the question's wording, not
// this lookup's, so both forms are spelled out for it here.
function resolvedIdLine(m: EntityMention, col: EntityColumn, candidates: Record<string, unknown>[], cap: number): string {
  const table = col.table.split('.').pop();
  const idList = candidates.map((r) => JSON.stringify(r.id)).join(', ');
  const pairs = candidates.map((r) => `id=${JSON.stringify(r.id)} (name: ${JSON.stringify(r.v)})`).join(', ');
  const truncated = candidates.length >= cap ? ` (capped at ${cap} matches — refine the wording if more exist)` : '';
  return `"${m.raw_text}" -> resolved in ${table}: ${pairs}${truncated}. Reference by id (${table}.id, or the ` +
    `matching foreign key column such as fund_id / investment_manager_id) — never by the name string. ` +
    `If the question means to EXCLUDE/OMIT/WITHOUT these, filter with NOT IN (${idList}); if it means to ` +
    `include or limit to these, filter with IN (${idList}).`;
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
      const MAX_MATCHES = 50;
      // An explicit wildcard ("*syariah*", "index%") means the user wants every
      // matching row (e.g. "exclude all funds matching *syariah*"), not a single
      // best guess — use it directly instead of the fuzzy single-match chain below.
      const hasWildcard = /[*%]/.test(String(m.raw_text));
      let rows;
      if (hasWildcard) {
        rows = await runQuery(
          `SELECT DISTINCT ${idSelect}${col.column} AS v FROM \`${col.table}\` WHERE LOWER(${col.column}) LIKE @pattern LIMIT ${MAX_MATCHES}`,
          { pattern: String(m.raw_text).toLowerCase().replace(/\*/g, '%') },
        );
        const candidates = rows.filter((r) => r.v);
        if (!candidates.length) {
          lines.push(`"${m.raw_text}" -> no matching ${m.column} value found for that wildcard pattern.`);
        } else if (col.idColumn) {
          lines.push(resolvedIdLine(m, col, candidates, MAX_MATCHES));
        } else {
          lines.push(`"${m.raw_text}" -> ${m.column} value(s) matching that wildcard: ${candidates.map((c) => `"${c.v}"`).join(', ')}.`);
        }
        continue;
      }
      const asOnePhrase = `%${String(m.raw_text).toLowerCase()}%`;
      rows = await runQuery(
        `SELECT DISTINCT ${idSelect}${col.column} AS v FROM \`${col.table}\` WHERE LOWER(${col.column}) LIKE @pattern LIMIT ${MAX_MATCHES}`,
        { pattern: asOnePhrase },
      );
      // The raw text may not be a contiguous substring of the real name (e.g.
      // "avrist lq45" for "Avrist Indeks LQ45") — retry token-by-token before
      // giving up, so the model still gets a real match instead of a guess.
      const words = String(m.raw_text).toLowerCase().split(/\s+/).filter(Boolean);
      if (!rows.length && words.length > 1) {
        rows = await runQuery(
          `SELECT DISTINCT ${idSelect}${col.column} AS v FROM \`${col.table}\` WHERE LOWER(${col.column}) LIKE @pattern LIMIT ${MAX_MATCHES}`,
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
        lines.push(resolvedIdLine(m, col, candidates, MAX_MATCHES));
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

// ---- Activity log (the dashboard's own login/export/audit trail) --------
// This is NOT BigQuery data — it's the dashboard_audit_log table in Supabase
// Postgres, reached through Auth.listAuditLog()'s PostgREST filters, not SQL.
// So a question about it can't go through questionToSql above at all; it's
// routed here instead, before BigQuery is ever considered. Kept to a cheap
// keyword check rather than an extra Claude call, since the phrasing that
// means "the dashboard's own activity" is a small, distinctive set of words
// that don't otherwise come up in questions about the investment platform.
const ACTIVITY_LOG_HINT = /\b(activity log|audit log|audit trail|log(ged|ging)? ?in|logins?\b|sign(ed)? ?in|failed logins?|who exported|export history|export activity|recent exports?|password change|chang(e|ed|ing) (their|his|her|a) password|dashboard (user|account) activity|sql lab|who (ran|used) .{0,20}\bsql\b|who (asked|used ask)|ask (feature |questions? )?(usage|history|activity)|dashboard accounts? (was |were )?(created|added|deleted|removed|updated)|admin (user|account)s? (was |were )?(created|added|deleted|removed|updated))\b/i;

function looksLikeActivityLogQuestion(question: string): boolean {
  return ACTIVITY_LOG_HINT.test(question);
}

// Supabase stores created_at in UTC; the team reads this from Jakarta (see
// the Activity log tab), so format it the same way here for consistency.
function toJakartaTime(v: unknown): string {
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return String(v ?? '');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o: Record<string, string>, p) => { o[p.type] = p.value; return o; }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} WIB`;
}

function activityLogFilterPrompt(): string {
  return `Extract search filters for the dashboard's own login/export/audit activity log from this question.
Today's date is ${new Date().toISOString().slice(0, 10)} (UTC).

Columns available: created_at (when it happened), username (who did it),
action (exactly one of: login_success, login_failure, password_change, export, ask, sql_run,
  admin_user_create, admin_user_update, admin_user_delete, view_portfolio),
detail (free text — the export's source/format/filename, the Ask question asked, the SQL run
  (sql_run), which dashboard account and what changed (the admin_user_* actions), or the investor
  SID looked up (view_portfolio)).

Respond with ONLY a JSON object, no markdown, no explanation:
{"search": "<one of the exact action values above if the question is about a specific kind of event
  (e.g. "failed logins" -> "login_failure", "exports" -> "export", "ask questions" -> "ask", "sql queries"
  -> "sql_run", "account changes" -> "admin_user_update", "portfolio lookups" -> "view_portfolio");
  otherwise a username or other keyword from the question; otherwise null>",
  "from": "<YYYY-MM-DD or null>", "to": "<YYYY-MM-DD or null>"}`;
}

interface ActivityLogFilter { search: string; from: string; to: string }

async function questionToActivityLogFilter(question: string): Promise<ActivityLogFilter> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  const empty: ActivityLogFilter = { search: '', from: '', to: '' };
  if (!key) return empty;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 200, system: activityLogFilterPrompt(),
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const text = (data.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      from: typeof parsed.from === 'string' ? parsed.from : '',
      to: typeof parsed.to === 'string' ? parsed.to : '',
    };
  } catch {
    // Filter extraction failing just means an unfiltered (most-recent) log — never block the answer.
    return empty;
  }
}

// Mirrors ask()'s return shape ({ sql, rows }) so the frontend needs no special
// case beyond sql being null — there's no SQL to show/edit/re-run for this,
// since it never touched BigQuery.
async function answerActivityLog(question: string): Promise<{ sql: null; rows: Record<string, unknown>[] }> {
  const filter = await questionToActivityLogFilter(question);
  const rows = await Auth.listAuditLog({ limit: 500, ...filter });
  const shaped = rows.map((r) => ({
    created_at: toJakartaTime(r.created_at), username: r.username, action: r.action, detail: r.detail,
  }));
  return { sql: null, rows: shaped };
}

/**
 * Full flow: question -> SQL -> validate (read-only) -> run -> rows.
 * BigQuery errors (e.g. a guessed column/table name that doesn't exist) are
 * fed back to the model once so it can self-correct before we give up.
 *
 * `user` (the authenticated dashboard account, from req.user) gates the
 * activity-log path only — the same superuser restriction the Activity log
 * tab itself enforces, since that data is every user's login/export history.
 */
export async function ask(question: string, context?: string | null, history?: HistoryTurn[] | null, user?: Auth.DashboardUser | null, opts?: { redact?: boolean }): Promise<{ sql: string | null; rows: Record<string, unknown>[] }> {
  const redact = opts?.redact ?? true;
  if (looksLikeActivityLogQuestion(question)) {
    if (!user || !user.is_superuser) {
      throw new Error('Activity log data is restricted to superusers.');
    }
    return answerActivityLog(question);
  }

  const resolved = await resolveEntityContext(question);
  const fullContext = [context, resolved].filter(Boolean).join('\n\n') || null;
  let sql = await questionToSql(question, null, fullContext, history);
  for (let attempt = 0; ; attempt++) {
    const v = validateAdHoc(sql);
    if (!v.ok) {
      if (attempt >= 1) {
        const err: AskError = new Error(`The generated query was blocked: ${v.error}`);
        err.sql = sql;
        throw err;
      }
      // A malformed/empty first attempt (e.g. the model returned no SQL at
      // all) gets the same one self-correction retry a runtime BigQuery
      // error already gets below — an empty response isn't fed back as an
      // empty assistant turn, which the Anthropic API rejects.
      sql = await questionToSql(question, { sql: sql || '(empty response)', error: v.error }, fullContext, history);
      continue;
    }
    try {
      const rows = await runQuery(capRows(v.sql, 1000), {}, { redact });
      return { sql: v.sql, rows };
    } catch (e) {
      if (attempt >= 1) {
        const err: AskError = new Error(`Query failed: ${(e as Error).message}`);
        err.sql = v.sql;
        throw err;
      }
      sql = await questionToSql(question, { sql: v.sql, error: (e as Error).message }, fullContext, history);
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
{"type": "bar"|"line"|"pie"|"doughnut"|"scatter"|"none", "x": "<column name>", "y": "<column name>", "label": "<short chart title>", "color": "indigo"|"amber"|"teal"|"rose", "reason": "<one short, plain-language sentence>"}

Rules:
- "type" must be exactly one of: bar, line, pie, doughnut, scatter, none.
- "x" and "y" must be exact column names from the sample given (omit for "none"), and "y" must be numeric.
- Keep "label" under 40 characters.
- "color" is OPTIONAL and only applies to a single-series chart (bar/line/scatter) — this app's palette has
  exactly four accent colors: indigo (blue/purple), amber (orange/gold/yellow), teal (green), rose (red/pink).
  If the user's request names or implies a color, map it to whichever of these four is closest and set
  "color" to that key. Omit "color" entirely if no color was requested, or if type is pie/doughnut (those
  already use a fixed multi-color palette, one per slice — a single "color" wouldn't mean anything there).
- "reason" is always required — one short sentence a non-technical person would understand, explaining the
  pick (or, for "none", exactly what's missing/wrong so the person knows what to change).

If the user's visualization request names a specific chart type (bar/line/pie/doughnut/scatter), HONOR it
whenever it's technically possible: a usable x column exists, and (for bar/line/pie/doughnut) at least one
numeric y column exists, or (for scatter) at least two numeric columns exist. Someone who explicitly asked
for a donut chart gets a donut chart even if it has many slices or isn't the "ideal" fit for the data —
that is their call to make, not yours to override. Only fall back to "none" for a named request when it is
genuinely impossible for this data (e.g. a line/time-series with no date-like column, a pie/donut with no
numeric column to size slices by, a scatter with fewer than two numeric columns) — and say specifically what
column/shape is missing in "reason".

If the user did NOT name a chart type, pick the best fit yourself using these defaults:
- "line" for a time series (a date/period-like x column). "bar" for comparing categories.
- "pie"/"doughnut" for a small (<= 8) set of categories that sum to a whole.
- "scatter" for two numeric columns with no natural category axis.
- "none" only if nothing charts well at all (a single scalar/row, or every column is free text with no
  numeric column to plot) — explain why in "reason".`;
}

export async function suggestChart(question: string | undefined, rows: Record<string, unknown>[], hint?: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return { type: 'none', reason: 'Ask is not configured on the server.' };
  if (!Array.isArray(rows) || !rows.length) return { type: 'none', reason: 'There are no rows to chart yet.' };

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
    if (!res.ok) return { type: 'none', reason: 'Could not reach the chart suggestion model — try again.' };
    const data = await res.json();
    text = (data.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  } catch {
    return { type: 'none', reason: 'Could not reach the chart suggestion model — try again.' };
  }

  try {
    const spec = JSON.parse(text);
    if (!CHART_TYPES.includes(spec.type)) return { type: 'none', reason: 'Got an unexpected response — try again.' };
    if (spec.type !== 'none' && (!columns.includes(spec.x) || !columns.includes(spec.y))) {
      return { type: 'none', reason: spec.reason || 'Could not match the suggested columns to this result.' };
    }
    return spec;
  } catch {
    return { type: 'none', reason: 'Got an unreadable response — try again.' };
  }
}
