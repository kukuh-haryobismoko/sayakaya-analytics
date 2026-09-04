'use strict';

// Netlify Scheduled Function — the "timer" half of the scheduled-sending
// feature (see server/schedules.js). All the actual logic (which jobs are
// due, resolving recipients, building PDFs, sending mail) lives behind
// POST /api/cron/run-due-schedules in server/app.js; this function's only
// job is to call that endpoint on a schedule (see netlify.toml's
// [functions."cron-run-schedules"] block).
//
// Deliberately a thin HTTP trigger rather than importing server/schedules.js
// directly: migrating to GCP later is just pointing Cloud Scheduler's HTTP
// target at the new /api/cron/run-due-schedules URL with the same header —
// nothing here needs to change, and nothing in server/ needs to know which
// scheduler is calling it.
exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) return { statusCode: 500, body: 'Site URL not available in this environment.' };
  if (!process.env.CRON_SECRET) return { statusCode: 500, body: 'CRON_SECRET is not configured.' };

  const res = await fetch(`${base}/api/cron/run-due-schedules`, {
    method: 'POST',
    headers: { 'x-cron-key': process.env.CRON_SECRET },
  });
  const text = await res.text();
  if (!res.ok) console.error('[cron-run-schedules]', res.status, text);
  return { statusCode: res.status, body: text };
};
