'use strict';

const { runQuery, validateAdHoc, capRows } = require('./bigquery');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

function askEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

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

portfolios (current holdings; one row per user+fund)
  id, user_id, fund_id, unit FLOAT, deleted_at TIMESTAMP (NULL = active holding)
  current holding value = unit * funds.latest_nav_value

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
- "AUM" of a fund = funds.latest_aum_value. Platform AUM = SUM(portfolios.unit * funds.latest_nav_value) for active holdings.
- transactions.created_at is TIMESTAMP; users.created_at is DATETIME — use DATE()/EXTRACT accordingly.
`;

function systemPrompt() {
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

async function questionToSql(question) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');

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
      messages: [{ role: 'user', content: question }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Strip accidental markdown fences if the model added them.
  return text
    .replace(/^```sql\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/, '')
    .trim();
}

/**
 * Full flow: question -> SQL -> validate (read-only) -> run -> rows.
 * On a rejected query we still surface the SQL so the user can see/fix it.
 */
async function ask(question) {
  const sql = await questionToSql(question);
  const v = validateAdHoc(sql);
  if (!v.ok) {
    const err = new Error(`The generated query was blocked: ${v.error}`);
    err.sql = sql;
    throw err;
  }
  const rows = await runQuery(capRows(v.sql, 1000), {});
  return { sql: v.sql, rows };
}

module.exports = { ask, askEnabled };
