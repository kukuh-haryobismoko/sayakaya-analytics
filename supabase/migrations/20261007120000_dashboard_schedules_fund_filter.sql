-- Send fund performance schedules can cover a subset of funds instead of
-- every fund. NULL = all funds (every schedule created before this column);
-- otherwise {"types": [...fund categories], "fundIds": [...]} and a fund
-- matching either list is in the report. See normalizeFundFilter() in
-- report-helpers.js/.ts.

alter table dashboard_scheduled_jobs add column fund_filter jsonb;
