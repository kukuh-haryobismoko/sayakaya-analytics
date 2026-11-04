-- Flexible statement sends: portfolio basis, statement period, one-time send on a chosen date.
-- portfolio_basis: 'live' (holdings today) | 'prev_month_end' (holdings at end of last month)
-- statement_period: 'prev_month' | 'current_month'; 'current_month' = month of the send
-- frequency 'on_date': one send at run_date + run_time (WIB), then the job ends.
alter table dashboard_scheduled_jobs
  add column if not exists portfolio_basis text not null default 'live' check (portfolio_basis in ('live', 'prev_month_end')),
  add column if not exists statement_period text not null default 'prev_month' check (statement_period in ('prev_month', 'current_month')),
  add column if not exists run_date date;

do $$
declare con text;
begin
  select conname into con from pg_constraint
  where conrelid = 'dashboard_scheduled_jobs'::regclass and contype = 'c' and conname like '%frequency%';
  if con is not null then execute format('alter table dashboard_scheduled_jobs drop constraint %I', con); end if;
end $$;
alter table dashboard_scheduled_jobs add constraint dashboard_scheduled_jobs_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly_last_day', 'monthly_day', 'once', 'on_date'));
