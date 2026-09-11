'use strict';

// Retrains the BigQuery ML models that server/ml.js serves predictions from.
// Mirrors setup/ml_models.sql exactly — that file stays the source of truth
// for "how to set this up from scratch"; this module is what lets the app
// re-run it itself instead of an operator pasting it into the BQ console.
//
// Training queries scan full history tables (main.transactions,
// mi_fee_logs.mi_fee), which only grow over time, so this uses its own
// higher, separately-tunable byte cap instead of the interactive dashboard
// cap (MAX_BYTES_BILLED) — retraining is infrequent (monthly, or an admin's
// manual click), so a generous cap here doesn't affect everyday query cost.

const { runQuery } = require('./bigquery');

const TRAIN_MAX_BYTES = String(process.env.ML_TRAIN_MAX_BYTES_BILLED || 50_000_000_000);

const STEPS = [
  {
    name: 'schema',
    sql: "CREATE SCHEMA IF NOT EXISTS `sayakaya.ml` OPTIONS(location = 'asia-southeast2')",
  },
  {
    name: 'aum_forecast',
    sql: `CREATE OR REPLACE MODEL \`sayakaya.ml.aum_forecast\`
      OPTIONS(
        model_type = 'ARIMA_PLUS',
        time_series_timestamp_col = 'day',
        time_series_data_col = 'aum',
        data_frequency = 'DAILY',
        clean_spikes_and_dips = TRUE,
        holiday_region = 'ID'
      ) AS
      SELECT TIMESTAMP(DATE(created_at)) AS day, SUM(AUM) AS aum
      FROM \`sayakaya.mi_fee_logs.mi_fee\`
      GROUP BY day`,
  },
  {
    name: 'tx_forecast',
    sql: `CREATE OR REPLACE MODEL \`sayakaya.ml.tx_forecast\`
      OPTIONS(
        model_type = 'ARIMA_PLUS',
        time_series_timestamp_col = 'day',
        time_series_data_col = 'volume',
        data_frequency = 'DAILY',
        clean_spikes_and_dips = TRUE,
        holiday_region = 'ID'
      ) AS
      SELECT TIMESTAMP(DATE(created_at)) AS day, SUM(final_amount) AS volume
      FROM \`sayakaya.main.transactions\`
      WHERE type = 'buy' AND status = 'completed'
      GROUP BY day`,
  },
  {
    name: 'churn_features',
    sql: `CREATE OR REPLACE VIEW \`sayakaya.ml.churn_features\` AS
      WITH tx AS (
        SELECT
          user_id,
          COUNTIF(type = 'buy'  AND status = 'completed') AS buys,
          COUNTIF(type = 'sell' AND status = 'completed') AS sells,
          SUM(IF(type = 'buy' AND status = 'completed', final_amount, 0)) AS total_buy_amount,
          COUNT(DISTINCT IF(status = 'completed', fund_id, NULL)) AS n_funds,
          MAX(IF(status = 'completed', created_at, NULL)) AS last_tx,
          MIN(IF(status = 'completed', created_at, NULL)) AS first_tx
        FROM \`sayakaya.main.transactions\`
        GROUP BY user_id
      ),
      holders AS (
        SELECT DISTINCT user_id FROM \`sayakaya.main.portfolios\`
        WHERE deleted_at IS NULL AND unit > 0
      )
      SELECT
        t.user_id, t.buys, t.sells, t.total_buy_amount, t.n_funds,
        SAFE_DIVIDE(t.total_buy_amount, NULLIF(t.buys, 0)) AS avg_buy_amount,
        DATE_DIFF(CURRENT_DATE(), DATE(t.first_tx), DAY) AS tenure_days,
        DATE_DIFF(CURRENT_DATE(), DATE(t.last_tx),  DAY) AS recency_days,
        IFNULL(u.verification_status, 'unknown') AS verification_status,
        IFNULL(up.investment_risk_tolerance, 'unknown') AS risk,
        IF(h.user_id IS NULL, 1, 0) AS churned
      FROM tx t
      JOIN \`sayakaya.main.users\` u ON u.id = t.user_id
      LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = t.user_id
      LEFT JOIN holders h ON h.user_id = t.user_id
      WHERE t.buys >= 1`,
  },
  {
    name: 'churn_model',
    sql: `CREATE OR REPLACE MODEL \`sayakaya.ml.churn_model\`
      OPTIONS(
        model_type = 'LOGISTIC_REG',
        input_label_cols = ['churned'],
        auto_class_weights = TRUE
      ) AS
      SELECT * EXCEPT(user_id) FROM \`sayakaya.ml.churn_features\``,
  },
];

// Runs every step regardless of earlier failures (churn_model will simply
// fail with its own clear error if churn_features didn't update), so one bad
// step never hides how the others did.
async function retrainModels() {
  const steps = [];
  for (const step of STEPS) {
    const startedAt = Date.now();
    try {
      await runQuery(step.sql, {}, { maxBytes: TRAIN_MAX_BYTES });
      steps.push({ step: step.name, ok: true, ms: Date.now() - startedAt });
    } catch (e) {
      steps.push({ step: step.name, ok: false, ms: Date.now() - startedAt, error: e.message });
    }
  }
  return { ok: steps.every((s) => s.ok), steps, finishedAt: new Date().toISOString() };
}

module.exports = { retrainModels };

// Self-check: `node server/ml-train.js` — does not touch BigQuery, only
// verifies the step list stays well-formed (names present, churn_model
// still runs after the view it depends on) as this file gets edited.
if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(STEPS.map((s) => s.name), ['schema', 'aum_forecast', 'tx_forecast', 'churn_features', 'churn_model']);
  STEPS.forEach((s) => assert.ok(s.sql.trim().length > 0, `${s.name} has empty sql`));
  const churnFeaturesIdx = STEPS.findIndex((s) => s.name === 'churn_features');
  const churnModelIdx = STEPS.findIndex((s) => s.name === 'churn_model');
  assert.ok(churnFeaturesIdx < churnModelIdx, 'churn_features must run before churn_model');
  assert.ok(STEPS[churnModelIdx].sql.includes('churn_features'), 'churn_model must reference churn_features');
  console.log('ml-train.js self-check passed');
}
