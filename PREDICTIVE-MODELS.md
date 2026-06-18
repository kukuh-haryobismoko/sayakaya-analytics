# Predictive models (BigQuery ML)

The **Predict** tab adds forecasting and churn prediction. It uses **BigQuery ML**,
so the models train and run inside BigQuery — no Python service, same project,
same region. The app stays read-only: it only *calls* the trained models with
`ML.FORECAST` / `ML.PREDICT` (both are read operations).

## What's included

- **AUM forecast** — ARIMA_PLUS on daily total AUM (from `mi_fee_logs.mi_fee`), with a 90% prediction band.
- **Transaction forecast** — ARIMA_PLUS on daily completed buy volume.
- **Churn model** — logistic regression scoring each current holder's probability of fully redeeming (leaving). Churn is defined as: *ever invested, but currently holds nothing.*
- **Churn exploration** — overall churn rate, churn rate by tenure (works without the models).
- **Retention cohorts** — month-by-month engagement retention heatmap (works without the models).

The retention and churn-rate sections work immediately. The forecasts and churn
*scoring* need the models to exist first.

## One-time setup

The models are created by running `setup/ml_models.sql` **once**. Re-run anytime
to retrain on fresh data. Because creating a model is a write, this needs an
account with create-model permission — the app's read-only service account
cannot (and should not) do it.

**Permissions to run the setup:** an account (your user, or a separate setup
service account) with, on project `sayakaya`:
- `roles/bigquery.jobUser`
- `roles/bigquery.dataEditor` on (at least) the new `ml` dataset
- read access to `main` and `mi_fee_logs`

**Run it:**

```bash
# with the bq CLI (part of the gcloud SDK):
bq query --use_legacy_sql=false --project_id=sayakaya < setup/ml_models.sql
```

or paste each statement into the BigQuery console. Training takes a few minutes.

**Let the app read the models:** the app's own service account needs
`roles/bigquery.dataViewer` on the `ml` dataset (so `ML.FORECAST`/`ML.PREDICT`
can read the models). If your app service account already has project-level Data
Viewer, this is covered.

## Cost

Training scans your data and uses slot time — typically a few hundred MB to a
couple of GB per run, billed once per retrain. Calling the models (what the app
does on each page load) is cheap and stays under the app's `MAX_BYTES_BILLED`
cap. Retrain on a schedule only as often as you need (weekly/monthly is plenty).

## Checking quality

After setup you can inspect the models in BigQuery:

```sql
SELECT * FROM ML.EVALUATE(MODEL `sayakaya.ml.churn_model`);
SELECT * FROM ML.ARIMA_EVALUATE(MODEL `sayakaya.ml.aum_forecast`);
```

## Honest caveats

- The churn model is a **propensity model**: it learns the profile associated
  with having-redeemed-everything from current data. It's great for ranking
  *who looks most at-risk now*, but it is not a strict time-split forecast. For
  rigorous "will churn in the next 90 days" prediction, retrain with features
  snapshotted at a past date and labels from the following period — tell me and
  I can set that up.
- Forecast accuracy depends on history length and stability; ARIMA_PLUS gives a
  prediction interval (the shaded band) — treat the band, not just the line, as
  the real answer.
- Churn here is per-investor (redeemed all). The `mi_fee` table has no per-user
  rows, so per-user *AUM* history isn't available from it.

## Ask integration

Once the models exist, the **Ask** tab can answer questions like "forecast AUM
for the next 60 days" or "list the 50 holders most likely to churn" — it knows
the model names and the churn definition.
