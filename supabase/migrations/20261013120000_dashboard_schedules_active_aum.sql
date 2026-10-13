-- New recipient pool for schedules: 'active_aum', investors holding units of
-- an ACTIVE fund today (queries allActiveFundInvestors, ~13.8k in Oct 2026).
-- 'all_aum' stays as it was (latest portfolio_fix snapshot, ~232k, mostly
-- Avrist Liquid promo leftovers in an INACTIVE fund).

do $$
declare
  con text;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'dashboard_scheduled_jobs'::regclass
    and contype = 'c'
    and conname like '%recipient_type%';
  if con is not null then
    execute format('alter table dashboard_scheduled_jobs drop constraint %I', con);
  end if;
end $$;

alter table dashboard_scheduled_jobs add constraint dashboard_scheduled_jobs_recipient_type_check
  check (recipient_type in ('single_email', 'csv_list', 'all_aum', 'active_aum', 'all_registered'));
