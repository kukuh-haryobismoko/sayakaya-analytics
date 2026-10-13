-- Exclusion (opt-out) list for Send e-statement & portfolio and Send fund
-- performance: people here are skipped by schedules, group sends and batch
-- sends, also when they are in a recipient group or on a pasted list. A send
-- to one investor (Send e-statement single) still goes out.
--
-- identifier is what was typed (email or SID, lowercased); sid / email / name
-- are what BigQuery returned for it when it was added, so an entry added by
-- SID also matches that investor's email on a fund performance list.
create table dashboard_send_exclusions (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique check (identifier = lower(identifier)),
  sid text,
  email text,
  name text,
  scope text not null default 'all' check (scope in ('all', 'statement', 'fund_performance')),
  reason text,
  created_by_username text,
  created_at timestamptz not null default now()
);
alter table dashboard_send_exclusions enable row level security;
revoke all on dashboard_send_exclusions from anon, authenticated;

-- 'skipped': a queued email whose recipient was excluded before it went out.
do $$
declare con text;
begin
  select conname into con from pg_constraint
  where conrelid = 'dashboard_schedule_queue'::regclass and contype = 'c' and conname like '%status%';
  if con is not null then execute format('alter table dashboard_schedule_queue drop constraint %I', con); end if;
end $$;
alter table dashboard_schedule_queue add constraint dashboard_schedule_queue_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

create or replace view dashboard_schedule_progress with (security_invoker = true) as
  select job_id,
    count(*) filter (where status = 'sent') as sent,
    count(*) filter (where status in ('pending', 'sending')) as waiting,
    count(*) filter (where status = 'failed') as failed,
    count(*) filter (where status = 'skipped') as skipped
  from dashboard_schedule_queue
  group by job_id;
