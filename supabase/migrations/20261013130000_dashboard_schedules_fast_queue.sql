-- Faster scheduled sending, and one-off sends to a whole recipient group.
--
-- Before: one runner drained 25 statements (100 fund performance emails) per
-- job per tick, one at a time, and the ticks came from GitHub Actions (every
-- 4-7 hours in practice) or the old Netlify site, so 13.8k investors took
-- days. Now pg_cron pings the api function every 10 seconds while there is
-- work, several requests at once; each request claims its own chunk of the
-- queue (dashboard_claim_queue, FOR UPDATE SKIP LOCKED), so parallel runners
-- never send the same row twice.

-- 'once': a one-off send (Batch send to a recipient group), due right away.
do $$
declare con text;
begin
  select conname into con from pg_constraint
  where conrelid = 'dashboard_scheduled_jobs'::regclass and contype = 'c' and conname like '%frequency%';
  if con is not null then execute format('alter table dashboard_scheduled_jobs drop constraint %I', con); end if;
end $$;
alter table dashboard_scheduled_jobs add constraint dashboard_scheduled_jobs_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly_last_day', 'monthly_day', 'once'));

-- What a one-off send carries over from the Batch send form. NULL = the
-- recurring default (previous month's e-statement, latest NAV). The portfolio
-- is always live: an as-of portfolio reads portfolio_fix, 2.5 GB per query.
alter table dashboard_scheduled_jobs
  add column statement_month text,
  add column nav_as_of date;

-- 'sending': claimed by a runner, email not confirmed yet.
do $$
declare con text;
begin
  select conname into con from pg_constraint
  where conrelid = 'dashboard_schedule_queue'::regclass and contype = 'c' and conname like '%status%';
  if con is not null then execute format('alter table dashboard_schedule_queue drop constraint %I', con); end if;
end $$;
alter table dashboard_schedule_queue add constraint dashboard_schedule_queue_status_check
  check (status in ('pending', 'sending', 'sent', 'failed'));

create index dashboard_schedule_queue_job_status_idx on dashboard_schedule_queue (job_id, status);

-- Claims the next chunk of one job's pending rows (oldest job first): 10
-- statements (each builds its own PDFs, and an edge function gets ~2 s of
-- CPU) or 50 fund performance emails (one shared PDF). A row stuck in
-- 'sending' for 10 minutes belonged to a runner that died mid-send; it is
-- failed, not retried, because the email may already have gone out.
create or replace function dashboard_claim_queue(p_statement_limit int default 10, p_fund_limit int default 50)
returns setof dashboard_schedule_queue
language plpgsql
as $$
declare
  v_job uuid;
  v_kind text;
begin
  update dashboard_schedule_queue
    set status = 'failed', error = 'Interrupted while sending; not retried so nobody gets the email twice.', processed_at = now()
    where status = 'sending' and processed_at < now() - interval '10 minutes';

  select q.job_id, j.kind into v_job, v_kind
    from dashboard_schedule_queue q
    join dashboard_scheduled_jobs j on j.id = q.job_id and j.status in ('active', 'ended')
    where q.status = 'pending'
    order by q.created_at
    limit 1;
  if v_job is null then return; end if;

  return query
    update dashboard_schedule_queue q
      set status = 'sending', processed_at = now()
      where q.id in (
        select id from dashboard_schedule_queue
        where job_id = v_job and status = 'pending'
        order by created_at
        limit case when v_kind = 'statement' then p_statement_limit else p_fund_limit end
        for update skip locked
      )
      returning q.*;
end $$;

-- How many runners the next tick starts: 5 while the queue has rows to send,
-- 1 when a schedule is due (to enqueue it), otherwise none, so an idle
-- dashboard makes no function calls at all.
create or replace function dashboard_schedule_workers()
returns int
language sql stable
as $$
  select case
    when exists (
      select 1 from dashboard_schedule_queue q
      join dashboard_scheduled_jobs j on j.id = q.job_id and j.status in ('active', 'ended')
      where q.status = 'pending'
    ) then 5
    when exists (select 1 from dashboard_scheduled_jobs where status = 'active' and next_run_at <= now()) then 1
    else 0
  end
$$;

-- Emails per schedule, for the Automated sending table.
create view dashboard_schedule_progress with (security_invoker = true) as
  select job_id,
    count(*) filter (where status = 'sent') as sent,
    count(*) filter (where status in ('pending', 'sending')) as waiting,
    count(*) filter (where status = 'failed') as failed
  from dashboard_schedule_queue
  group by job_id;

-- Reached only by the api function with the service_role key, like the tables.
revoke all on function dashboard_claim_queue(int, int) from public, anon, authenticated;
revoke all on function dashboard_schedule_workers() from public, anon, authenticated;
revoke all on dashboard_schedule_progress from anon, authenticated;
grant execute on function dashboard_claim_queue(int, int) to service_role;
grant select on dashboard_schedule_progress to service_role;

-- The tick. The cron key lives in Vault (secret 'dashboard_cron_secret', the
-- same value as the api function's CRON_SECRET), never in this file; see
-- SUPABASE-DEPLOY.md. Without it the requests get a 401 and nothing runs.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('dashboard-run-due-schedules', '10 seconds', $cron$
  select net.http_post(
    url := 'https://josptpfisrsdjeggkqke.supabase.co/functions/v1/api/cron/run-due-schedules',
    headers := jsonb_build_object('x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')),
    timeout_milliseconds := 120000
  )
  from generate_series(1, public.dashboard_schedule_workers())
$cron$);
