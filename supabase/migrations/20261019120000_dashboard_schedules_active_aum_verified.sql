-- New recipient pool for schedules and group sends: 'active_aum_verified',
-- the 'active_aum' pool limited to users.verification_status = 'verified'
-- (queries verifiedActiveFundInvestors, 5,208 people on 19 Oct 2026).

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
  check (recipient_type in ('single_email', 'csv_list', 'all_aum', 'active_aum', 'active_aum_verified', 'all_registered'));
