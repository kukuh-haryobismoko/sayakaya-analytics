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

## Retraining

The models retrain **automatically, monthly** (the 1st of each month, via a
Netlify Scheduled Function → `POST /api/cron/retrain-models`, same shape as
the e-statement schedule cron — see `netlify/functions/cron-retrain-models.js`
and `netlify.toml`). A superuser can also trigger it on demand from the
**Predict** tab's "Retrain now" button (`POST /api/ml/retrain`) — useful right
after a data shift you don't want to wait for the schedule on. Both call the
same job, `server/ml-train.js` (`supabase/functions/api/ml-train.ts` on the
Supabase backend), which re-runs the exact statements in `setup/ml_models.sql`
against BigQuery. That file stays the source of truth for what gets trained;
the job is just what lets the app re-run it itself instead of an operator
pasting it into the BigQuery console. Each run is logged to the audit log
(`ml_retrain`) — the Predict tab reads the latest one to show "Last retrained
… by …" above the forecast panels.

You can still run `setup/ml_models.sql` by hand any time (e.g. to bootstrap
the models before the first scheduled/manual retrain, or to train outside the
app entirely) — nothing about the automated path requires it.

**Permissions:** creating/replacing a model is a write, so — unlike every
other query in this app — the retrain job needs write access. The app's
service account (the same one every dashboard query already runs as) needs
`roles/bigquery.dataEditor` scoped to the `ml` dataset, in addition to its
existing `roles/bigquery.jobUser` and `roles/bigquery.dataViewer` on `main`/
`mi_fee_logs`. This is a deliberate, narrow exception to the "read-only app
credential" rule below — scoped to one dataset, not the whole project. Grant
it once:

```bash
bq add-iam-policy-binding \
  --member='serviceAccount:YOUR_SA_EMAIL@sayakaya.iam.gserviceaccount.com' \
  --role='roles/bigquery.dataEditor' \
  sayakaya:ml
```

(or BigQuery console → the `ml` dataset → Sharing → Permissions → Add
principal → paste the service account email → role `BigQuery Data Editor`).
Until this is granted, `/api/ml/retrain` and the monthly cron will fail with
`Access Denied: ... bigquery.datasets.create` (or, once the dataset exists,
a model-create equivalent) — the audit log entry for that run will show it.

**Cost:** training scans your data and uses slot time — typically a few
hundred MB to a couple of GB per run, billed once per retrain. Training
queries use their own cap, `ML_TRAIN_MAX_BYTES_BILLED` (default 50 GB, see
`server/ml-train.js`), separate from the interactive dashboard cap
(`MAX_BYTES_BILLED`) — training reads full history tables that only grow, so
tying it to the same cap as page-load queries would mean bumping both every
time one needs headroom. Calling the models (what the app does on each page
load) is cheap and stays under `MAX_BYTES_BILLED` as usual. Monthly is the
default cadence — change it in `netlify.toml`'s `[functions."cron-retrain-models"]`
block if you need it more or less often.

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
