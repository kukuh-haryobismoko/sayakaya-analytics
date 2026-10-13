-- Monthly model retraining (ml-train.ts) on the 1st at 00:00 UTC = 07:00 WIB,
-- the same slot the Netlify scheduled function had. That site is disabled
-- (its last automatic retrain, 1 Oct 2026, never ran), so Postgres calls the
-- api function itself, with the cron key from Vault like
-- dashboard-run-due-schedules (20261013130000).
select cron.schedule('dashboard-retrain-models', '0 0 1 * *', $cron$
  select net.http_post(
    url := 'https://josptpfisrsdjeggkqke.supabase.co/functions/v1/api/cron/retrain-models',
    headers := jsonb_build_object('x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')),
    timeout_milliseconds := 400000
  )
$cron$);
