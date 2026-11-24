-- Slack alerts for finished BigQuery query jobs (function bq-alert). One row: the end_time
-- of the last job already reported. SLACK_WEBHOOK_URL is a function secret, not stored here.
create table if not exists bq_alert_state (
  id int primary key default 1 check (id = 1),
  last_end timestamptz not null
);
alter table bq_alert_state enable row level security;
revoke all on bq_alert_state from anon, authenticated;

-- Every 5 minutes, same Vault cron key as dashboard-run-due-schedules.
select cron.schedule('bq-alert', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://josptpfisrsdjeggkqke.supabase.co/functions/v1/bq-alert',
    headers := jsonb_build_object('x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')),
    timeout_milliseconds := 120000
  )
$cron$);
