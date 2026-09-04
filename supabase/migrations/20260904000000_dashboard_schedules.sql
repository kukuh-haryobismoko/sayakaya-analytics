-- Scheduled/automated sending for Send statement and Send fund performance.
-- Same access pattern as dashboard_users etc.: reached only via the
-- service_role key over PostgREST (server/app.js), never anon/authenticated,
-- so RLS is enabled with no policies (default-deny) as defense-in-depth.
--
-- dashboard_scheduled_jobs: the recurring schedule itself (who/what/when).
-- dashboard_schedule_otps: a pending, unconfirmed schedule — the OTP email
--   flow stores the full schedule payload here first; confirming the code
--   moves it into dashboard_scheduled_jobs, so nothing is scheduled until
--   the person setting it up has proven they control the confirmation
--   email. Self-expiring (10 min) the same way dashboard_password_resets is.
-- dashboard_schedule_queue: one row per (job, recipient) send, created when
--   a job comes due. Decouples "the job fired" from "each recipient's
--   email/PDF", so /api/cron/run-due-schedules can drain a bounded number of
--   rows per invocation regardless of how many recipients a job resolved to
--   (e.g. "all registered users") — required to stay inside a serverless
--   function's time limit, and harmless once that limit is generous (GCP).

create table dashboard_scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('statement', 'fund_performance')),
  recipient_type text not null check (recipient_type in ('single_email', 'csv_list', 'all_aum', 'all_registered')),
  recipient_email text,       -- recipient_type = 'single_email'
  recipient_list jsonb,       -- recipient_type = 'csv_list' — array of email strings
  send_portfolio boolean not null default false,  -- kind = 'statement'
  send_statement boolean not null default false,  -- kind = 'statement'
  subject text,
  body text,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly_last_day', 'monthly_day')),
  day_of_week smallint,       -- 0=Sunday..6=Saturday, frequency = 'weekly'
  day_of_month smallint,      -- 1-31 (clamped to month length), frequency = 'monthly_day'
  run_time text not null default '08:00', -- HH:mm, Asia/Jakarta
  status text not null default 'active' check (status in ('active', 'paused')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  run_count integer not null default 0,
  created_by_user_id uuid references dashboard_users(id) on delete set null,
  created_by_username text,
  confirmation_email text not null,
  created_at timestamptz not null default now()
);

create table dashboard_schedule_otps (
  id uuid primary key default gen_random_uuid(),
  confirmation_email text not null,
  code_hash text not null,   -- sha256(6-digit code), hex
  payload jsonb not null,    -- the dashboard_scheduled_jobs row to insert once verified
  created_by_user_id uuid references dashboard_users(id) on delete set null,
  created_by_username text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table dashboard_schedule_queue (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references dashboard_scheduled_jobs(id) on delete cascade,
  recipient_email text,
  recipient_user_id text,   -- sayakaya.main.users.id (BigQuery) — not a local FK
  recipient_sid text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index dashboard_scheduled_jobs_due_idx on dashboard_scheduled_jobs (status, next_run_at);
create index dashboard_schedule_queue_pending_idx on dashboard_schedule_queue (status, created_at);

alter table dashboard_scheduled_jobs enable row level security;
alter table dashboard_schedule_otps enable row level security;
alter table dashboard_schedule_queue enable row level security;
