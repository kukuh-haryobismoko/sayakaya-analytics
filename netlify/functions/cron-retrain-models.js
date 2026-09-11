'use strict';

// Netlify Scheduled Function — the monthly "timer" that retrains the
// BigQuery ML models (see server/ml-train.js) instead of an operator
// re-running setup/ml_models.sql by hand. Same thin-trigger shape as
// cron-run-schedules.js: all the actual work lives behind
// POST /api/cron/retrain-models in server/app.js; this just calls it on a
// schedule (see netlify.toml's [functions."cron-retrain-models"] block).
exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) return { statusCode: 500, body: 'Site URL not available in this environment.' };
  if (!process.env.CRON_SECRET) return { statusCode: 500, body: 'CRON_SECRET is not configured.' };

  const res = await fetch(`${base}/api/cron/retrain-models`, {
    method: 'POST',
    headers: { 'x-cron-key': process.env.CRON_SECRET },
  });
  const text = await res.text();
  if (!res.ok) console.error('[cron-retrain-models]', res.status, text);
  return { statusCode: res.status, body: text };
};
