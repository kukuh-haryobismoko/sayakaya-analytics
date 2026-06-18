'use strict';

const { runQuery } = require('./bigquery');

const MIFEE = '`sayakaya.mi_fee_logs.mi_fee`';
const TX = '`sayakaya.main.transactions`';
const PORT = '`sayakaya.main.portfolios`';
const USERS = '`sayakaya.main.users`';

const clampHorizon = (h) => Math.min(Math.max(parseInt(h, 10) || 30, 1), 120);

// Are the models set up? Returns the list, or throws if the ml dataset is absent.
async function status() {
  await runQuery(
    'SELECT 1 AS ok FROM ML.FORECAST(MODEL `sayakaya.ml.aum_forecast`, STRUCT(1 AS horizon, 0.5 AS confidence_level)) LIMIT 1',
    {},
  );
  return ['aum_forecast', 'tx_forecast', 'churn_model'];
}

// ---- AUM forecast: recent history + ARIMA_PLUS forecast --------------------
async function aumForecast(horizon) {
  const h = clampHorizon(horizon);
  const history = await runQuery(`
    SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS day, ROUND(SUM(AUM)) AS value
    FROM ${MIFEE}
    WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
    GROUP BY day ORDER BY day`, {});
  const forecast = await runQuery(`
    SELECT FORMAT_TIMESTAMP('%Y-%m-%d', forecast_timestamp) AS day,
      ROUND(forecast_value) AS value,
      ROUND(prediction_interval_lower_bound) AS lower,
      ROUND(prediction_interval_upper_bound) AS upper
    FROM ML.FORECAST(MODEL \`sayakaya.ml.aum_forecast\`,
      STRUCT(${h} AS horizon, 0.9 AS confidence_level))
    ORDER BY day`, {});
  return { history, forecast };
}

// ---- Transaction (buy volume) forecast ------------------------------------
async function txForecast(horizon) {
  const h = clampHorizon(horizon);
  const history = await runQuery(`
    SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS day, ROUND(SUM(final_amount)) AS value
    FROM ${TX}
    WHERE type='buy' AND status='completed'
      AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
    GROUP BY day ORDER BY day`, {});
  const forecast = await runQuery(`
    SELECT FORMAT_TIMESTAMP('%Y-%m-%d', forecast_timestamp) AS day,
      ROUND(forecast_value) AS value,
      ROUND(prediction_interval_lower_bound) AS lower,
      ROUND(prediction_interval_upper_bound) AS upper
    FROM ML.FORECAST(MODEL \`sayakaya.ml.tx_forecast\`,
      STRUCT(${h} AS horizon, 0.9 AS confidence_level))
    ORDER BY day`, {});
  return { history, forecast };
}

// ---- Churn predictions: score current holders -----------------------------
async function churnPredictions(limit = 100) {
  const lim = Math.min(parseInt(limit, 10) || 100, 5000);
  // probability distribution buckets across current holders (churned=0 in features)
  const summary = await runQuery(`
    WITH p AS (
      SELECT (SELECT prob FROM UNNEST(predicted_churned_probs) WHERE label = 1) AS churn_prob
      FROM ML.PREDICT(MODEL \`sayakaya.ml.churn_model\`,
        (SELECT * FROM \`sayakaya.ml.churn_features\` WHERE churned = 0))
    )
    SELECT
      COUNT(*) AS scored,
      COUNTIF(churn_prob >= 0.5) AS high_risk,
      COUNTIF(churn_prob >= 0.2 AND churn_prob < 0.5) AS medium_risk,
      COUNTIF(churn_prob < 0.2) AS low_risk,
      ROUND(AVG(churn_prob), 4) AS avg_prob
    FROM p`, {});
  // top at-risk holders with their key features + contact
  const top = await runQuery(`
    SELECT cf.user_id, up.name, u.email,
      ROUND((SELECT prob FROM UNNEST(pred.predicted_churned_probs) WHERE label = 1), 4) AS churn_prob,
      cf.buys, cf.sells, cf.n_funds, cf.recency_days, cf.tenure_days,
      ROUND(cf.total_buy_amount) AS total_buy_amount
    FROM ML.PREDICT(MODEL \`sayakaya.ml.churn_model\`,
      (SELECT * FROM \`sayakaya.ml.churn_features\` WHERE churned = 0)) AS pred
    JOIN \`sayakaya.ml.churn_features\` cf USING(user_id)
    LEFT JOIN ${USERS} u ON u.id = cf.user_id
    LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = cf.user_id
    QUALIFY ROW_NUMBER() OVER (ORDER BY churn_prob DESC) <= ${lim}
    ORDER BY churn_prob DESC`, {});
  return { summary: summary[0] || {}, top };
}

// ---- Churn exploration (no model needed) ----------------------------------
async function churnOverview() {
  const overall = await runQuery(`
    WITH buyers AS (SELECT DISTINCT user_id FROM ${TX} WHERE type='buy' AND status='completed'),
    holders AS (SELECT DISTINCT user_id FROM ${PORT} WHERE deleted_at IS NULL AND unit>0)
    SELECT
      (SELECT COUNT(*) FROM buyers) AS total_investors,
      (SELECT COUNT(*) FROM holders) AS active_holders,
      (SELECT COUNT(*) FROM buyers b WHERE b.user_id NOT IN (SELECT user_id FROM holders)) AS churned`, {});
  // churn rate by tenure bucket
  const byTenure = await runQuery(`
    WITH tx AS (
      SELECT user_id, MIN(IF(status='completed', created_at, NULL)) AS first_tx
      FROM ${TX} WHERE type='buy' AND status='completed' GROUP BY user_id
    ),
    holders AS (SELECT DISTINCT user_id FROM ${PORT} WHERE deleted_at IS NULL AND unit>0)
    SELECT
      CASE
        WHEN DATE_DIFF(CURRENT_DATE(), DATE(first_tx), DAY) < 90 THEN '0-3 mo'
        WHEN DATE_DIFF(CURRENT_DATE(), DATE(first_tx), DAY) < 180 THEN '3-6 mo'
        WHEN DATE_DIFF(CURRENT_DATE(), DATE(first_tx), DAY) < 365 THEN '6-12 mo'
        ELSE '12+ mo' END AS tenure_bucket,
      COUNT(*) AS investors,
      COUNTIF(h.user_id IS NULL) AS churned,
      ROUND(COUNTIF(h.user_id IS NULL)/COUNT(*)*100, 1) AS churn_rate
    FROM tx t LEFT JOIN holders h USING(user_id)
    GROUP BY tenure_bucket
    ORDER BY (CASE tenure_bucket WHEN '0-3 mo' THEN 1 WHEN '3-6 mo' THEN 2 WHEN '6-12 mo' THEN 3 ELSE 4 END)`, {});
  return { overall: overall[0] || {}, byTenure };
}

// ---- Retention cohorts (engagement by months since first transaction) ------
async function retentionCohorts(months = 12) {
  const m = Math.min(parseInt(months, 10) || 12, 24);
  const rows = await runQuery(`
    WITH first_tx AS (
      SELECT user_id, DATE_TRUNC(DATE(MIN(created_at)), MONTH) AS cohort
      FROM ${TX} WHERE status='completed' GROUP BY user_id
    ),
    act AS (
      SELECT DISTINCT user_id, DATE_TRUNC(DATE(created_at), MONTH) AS m
      FROM ${TX} WHERE status='completed'
    )
    SELECT FORMAT_DATE('%Y-%m', ft.cohort) AS cohort,
      DATE_DIFF(a.m, ft.cohort, MONTH) AS month_offset,
      COUNT(DISTINCT a.user_id) AS users
    FROM first_tx ft JOIN act a USING(user_id)
    WHERE ft.cohort >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL ${m} MONTH)
      AND DATE_DIFF(a.m, ft.cohort, MONTH) >= 0
    GROUP BY cohort, month_offset
    ORDER BY cohort, month_offset`, {});
  return rows;
}

module.exports = {
  status, aumForecast, txForecast, churnPredictions, churnOverview, retentionCohorts,
};
