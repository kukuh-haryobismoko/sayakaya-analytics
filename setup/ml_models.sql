-- =====================================================================
--  Sayakaya Analytics — predictive model setup (BigQuery ML)
--  RUN THIS ONCE, with an account that can CREATE models (BigQuery Data
--  Editor on the `ml` dataset + Job User). The app itself stays read-only
--  and only CALLS these models via ML.FORECAST / ML.PREDICT.
--
--  How to run:
--    bq query --use_legacy_sql=false --project_id=sayakaya < setup/ml_models.sql
--  or paste each statement into the BigQuery console.
--  Re-run anytime to retrain on the latest data.
-- =====================================================================

-- 0) Dataset to hold the models (same region as your data).
CREATE SCHEMA IF NOT EXISTS `sayakaya.ml`
OPTIONS(location = 'asia-southeast2');


-- 1) AUM FORECAST — ARIMA_PLUS on total daily AUM (from mi_fee_logs.mi_fee).
CREATE OR REPLACE MODEL `sayakaya.ml.aum_forecast`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'day',
  time_series_data_col = 'aum',
  data_frequency = 'DAILY',
  clean_spikes_and_dips = TRUE,
  holiday_region = 'ID'
) AS
SELECT
  TIMESTAMP(DATE(created_at)) AS day,
  SUM(AUM) AS aum
FROM `sayakaya.mi_fee_logs.mi_fee`
GROUP BY day;


-- 2) TRANSACTION FORECAST — ARIMA_PLUS on daily completed buy volume.
CREATE OR REPLACE MODEL `sayakaya.ml.tx_forecast`
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'day',
  time_series_data_col = 'volume',
  data_frequency = 'DAILY',
  clean_spikes_and_dips = TRUE,
  holiday_region = 'ID'
) AS
SELECT
  TIMESTAMP(DATE(created_at)) AS day,
  SUM(final_amount) AS volume
FROM `sayakaya.main.transactions`
WHERE type = 'buy' AND status = 'completed'
GROUP BY day;


-- 3) CHURN FEATURES — one row per investor, behavioural features + label.
--    Label: churned = ever bought, but has NO active holdings now (redeemed all).
--    Note: current AUM/units are deliberately excluded (they'd leak the label).
CREATE OR REPLACE VIEW `sayakaya.ml.churn_features` AS
WITH tx AS (
  SELECT
    user_id,
    COUNTIF(type = 'buy'  AND status = 'completed') AS buys,
    COUNTIF(type = 'sell' AND status = 'completed') AS sells,
    SUM(IF(type = 'buy' AND status = 'completed', final_amount, 0)) AS total_buy_amount,
    COUNT(DISTINCT IF(status = 'completed', fund_id, NULL)) AS n_funds,
    MAX(IF(status = 'completed', created_at, NULL)) AS last_tx,
    MIN(IF(status = 'completed', created_at, NULL)) AS first_tx
  FROM `sayakaya.main.transactions`
  GROUP BY user_id
),
holders AS (
  SELECT DISTINCT user_id FROM `sayakaya.main.portfolios`
  WHERE deleted_at IS NULL AND unit > 0
)
SELECT
  t.user_id,
  t.buys,
  t.sells,
  t.total_buy_amount,
  t.n_funds,
  SAFE_DIVIDE(t.total_buy_amount, NULLIF(t.buys, 0)) AS avg_buy_amount,
  DATE_DIFF(CURRENT_DATE(), DATE(t.first_tx), DAY) AS tenure_days,
  DATE_DIFF(CURRENT_DATE(), DATE(t.last_tx),  DAY) AS recency_days,
  IFNULL(u.verification_status, 'unknown') AS verification_status,
  IFNULL(up.investment_risk_tolerance, 'unknown') AS risk,
  IF(h.user_id IS NULL, 1, 0) AS churned
FROM tx t
JOIN `sayakaya.main.users` u ON u.id = t.user_id
LEFT JOIN `sayakaya.main.user_profiles` up ON up.user_id = t.user_id
LEFT JOIN holders h ON h.user_id = t.user_id
WHERE t.buys >= 1;


-- 4) CHURN MODEL — logistic regression, class-weighted for the ~2% churn rate.
CREATE OR REPLACE MODEL `sayakaya.ml.churn_model`
OPTIONS(
  model_type = 'LOGISTIC_REG',
  input_label_cols = ['churned'],
  auto_class_weights = TRUE
) AS
SELECT * EXCEPT(user_id) FROM `sayakaya.ml.churn_features`;


-- Optional: inspect quality after training
-- SELECT * FROM ML.EVALUATE(MODEL `sayakaya.ml.churn_model`);
-- SELECT * FROM ML.ARIMA_EVALUATE(MODEL `sayakaya.ml.aum_forecast`);
