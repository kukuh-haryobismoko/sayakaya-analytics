-- Optional end date for scheduled/automated sending (dashboard_scheduled_jobs).
-- NULL end_date = send indefinitely. When set, the tick in schedules.ts/.js
-- stops the job (status -> 'ended') once a due occurrence falls after it,
-- instead of enqueueing a send past the requested end date.

alter table dashboard_scheduled_jobs add column end_date date;

-- Find the auto-named check constraint on the status column rather than
-- assuming Postgres's default naming, so this doesn't break if it differs.
do $$
declare
  con text;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'dashboard_scheduled_jobs'::regclass
    and contype = 'c'
    and conname like '%status%';
  if con is not null then
    execute format('alter table dashboard_scheduled_jobs drop constraint %I', con);
  end if;
end $$;

alter table dashboard_scheduled_jobs add constraint dashboard_scheduled_jobs_status_check
  check (status in ('active', 'paused', 'ended'));
