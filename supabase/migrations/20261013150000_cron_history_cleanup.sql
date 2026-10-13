-- pg_cron logs every run in cron.job_run_details and never prunes it; the
-- 10-second schedule tick alone adds 8,640 rows a day. Keep a week.
select cron.schedule('dashboard-cron-history-cleanup', '30 19 * * *', $cron$
  delete from cron.job_run_details where end_time < now() - interval '7 days'
$cron$);
