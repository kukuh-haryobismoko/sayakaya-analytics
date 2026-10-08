-- Email recap (the "Email recap" tab): one row per email this dashboard sends
-- through Amazon SES, plus the delivery/open/click/bounce/complaint events
-- SES publishes back for it. Same access pattern as every other dashboard_*
-- table: reached only via the service_role key over PostgREST, RLS on with no
-- policies (default-deny).
--
-- dashboard_email_log: written by server/mail.js / supabase/functions/api/mail.ts
--   at send time (status = whether SES accepted it over SMTP). Rows created
--   by the SES webhook for mail this app didn't send itself (another system
--   using the same configuration set) get source = 'ses'.
-- dashboard_email_events: written by POST /api/webhooks/ses (SNS -> SES event
--   publishing). Opens/clicks only exist once a configuration set with
--   open/click tracking is attached; see SUPABASE-DEPLOY.md "Email tracking".

create table dashboard_email_log (
  id uuid primary key default gen_random_uuid(),
  ses_message_id text unique,   -- from SES's SMTP reply ("250 Ok <id>"); events carry the same id
  recipient text not null,
  sender text,
  subject text,
  category text not null,       -- statement | fund_performance | invite | password_reset | schedule_otp | other
  source text not null,         -- manual | batch | schedule | system | script | ses
  description text,
  sent_by text,                 -- dashboard username, or the schedule's creator
  user_id text,                 -- sayakaya.main.users.id (BigQuery), not a local FK
  sid text,
  job_id uuid,                  -- dashboard_scheduled_jobs.id; no FK, the log outlives a deleted schedule
  attachments text[],
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create table dashboard_email_events (
  id bigint generated always as identity primary key,
  log_id uuid not null references dashboard_email_log(id) on delete cascade,
  sns_message_id text unique,   -- SNS retries a delivery it isn't sure landed; this dedupes it
  event_type text not null,     -- Send | Delivery | Open | Click | Bounce | Complaint | Reject | DeliveryDelay | RenderingFailure
  occurred_at timestamptz not null,
  link text,
  user_agent text,
  ip text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index dashboard_email_log_created_at_idx on dashboard_email_log (created_at desc);
create index dashboard_email_events_log_idx on dashboard_email_events (log_id, event_type);

alter table dashboard_email_log enable row level security;
alter table dashboard_email_events enable row level security;

-- One row per email with its event rollup. security_invoker so the view
-- obeys the tables' RLS instead of its owner's rights, and anon/authenticated
-- can't read it even if a key leaks.
create view dashboard_email_overview with (security_invoker = true) as
select l.*, e.delivered_at, e.opened_at, e.last_opened_at, e.open_count, e.clicked_at, e.click_count,
  e.bounced_at, e.bounce_type, e.complained_at, e.rejected_at, e.delayed_at, e.last_event_at,
  case
    when l.status = 'failed' then 'failed'
    when e.complained_at is not null then 'complained'
    when e.bounced_at is not null then 'bounced'
    when e.rejected_at is not null then 'rejected'
    when e.clicked_at is not null then 'clicked'
    when e.opened_at is not null then 'opened'
    when e.delivered_at is not null then 'delivered'
    else 'sent'
  end as outcome
from dashboard_email_log l
left join lateral (
  select
    min(occurred_at) filter (where event_type = 'Delivery') as delivered_at,
    min(occurred_at) filter (where event_type = 'Open') as opened_at,
    max(occurred_at) filter (where event_type = 'Open') as last_opened_at,
    count(*) filter (where event_type = 'Open') as open_count,
    min(occurred_at) filter (where event_type = 'Click') as clicked_at,
    count(*) filter (where event_type = 'Click') as click_count,
    min(occurred_at) filter (where event_type = 'Bounce') as bounced_at,
    max(detail ->> 'bounceType') filter (where event_type = 'Bounce') as bounce_type,
    min(occurred_at) filter (where event_type = 'Complaint') as complained_at,
    min(occurred_at) filter (where event_type in ('Reject', 'RenderingFailure')) as rejected_at,
    min(occurred_at) filter (where event_type = 'DeliveryDelay') as delayed_at,
    max(occurred_at) as last_event_at
  from dashboard_email_events ev
  where ev.log_id = l.id
) e on true;

revoke all on dashboard_email_overview from anon, authenticated;

-- Everything the Email recap tab's KPIs, chart, and summary tables need in
-- one round trip. Days are Jakarta (WIB) days, like the Activity log. Rates
-- are left to the client: opened/clicked are divided by delivered, so rows
-- sent before tracking existed (no Delivery event) never drag a rate down.
create or replace function dashboard_email_recap(p_from date, p_to date, p_category text default null, p_source text default null)
returns jsonb
language sql
stable
security invoker
as $$
  with base as (
    select * from dashboard_email_overview
    where created_at >= (p_from::timestamp at time zone 'Asia/Jakarta')
      and created_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
      and (p_category is null or category = p_category)
      and (p_source is null or source = p_source)
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'sent', count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status = 'failed'),
        'recipients', count(distinct lower(recipient)),
        'delivered', count(*) filter (where delivered_at is not null),
        'opened', count(*) filter (where opened_at is not null),
        'clicked', count(*) filter (where clicked_at is not null),
        'bounced', count(*) filter (where bounced_at is not null),
        'complained', count(*) filter (where complained_at is not null),
        'opens', coalesce(sum(open_count), 0),
        'clicks', coalesce(sum(click_count), 0)
      ) from base
    ),
    'by_category', coalesce((
      select jsonb_agg(c order by c.sent desc) from (
        select category,
          count(*) filter (where status = 'sent') as sent,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where delivered_at is not null) as delivered,
          count(*) filter (where opened_at is not null) as opened,
          count(*) filter (where clicked_at is not null) as clicked,
          count(*) filter (where bounced_at is not null) as bounced,
          count(*) filter (where complained_at is not null) as complained
        from base group by category
      ) c
    ), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(d order by d.day) from (
        select (created_at at time zone 'Asia/Jakarta')::date as day,
          count(*) filter (where status = 'sent') as sent,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where delivered_at is not null) as delivered,
          count(*) filter (where opened_at is not null) as opened,
          count(*) filter (where clicked_at is not null) as clicked
        from base group by 1
      ) d
    ), '[]'::jsonb),
    'by_subject', coalesce((
      select jsonb_agg(s order by s.last_sent desc) from (
        select coalesce(subject, '') as subject, category,
          min(created_at) as first_sent, max(created_at) as last_sent,
          count(*) filter (where status = 'sent') as sent,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where delivered_at is not null) as delivered,
          count(*) filter (where opened_at is not null) as opened,
          count(*) filter (where clicked_at is not null) as clicked,
          count(*) filter (where bounced_at is not null) as bounced
        from base group by 1, 2
        order by max(created_at) desc
        limit 500
      ) s
    ), '[]'::jsonb),
    'top_links', coalesce((
      select jsonb_agg(k order by k.clicks desc) from (
        select ev.link, count(*) as clicks, count(distinct ev.log_id) as emails
        from dashboard_email_events ev
        join base b on b.id = ev.log_id
        where ev.event_type = 'Click' and ev.link is not null
        group by ev.link
        order by clicks desc
        limit 50
      ) k
    ), '[]'::jsonb),
    'tracking', (
      select jsonb_build_object('events', count(*), 'last_event_at', max(occurred_at))
      from dashboard_email_events
    )
  );
$$;

revoke execute on function dashboard_email_recap(date, date, text, text) from public, anon, authenticated;

-- Backfill what already went out, so the tab starts with history instead of
-- empty. These rows predate tracking: no delivery/open/click events, ever.
-- Scheduled sends: exact, one queue row per recipient per run.
insert into dashboard_email_log (recipient, sender, subject, category, source, description, sent_by, user_id, sid, job_id, status, error, created_at)
select coalesce(q.recipient_email, '(unknown)'), null, j.subject, j.kind, 'schedule',
  'Scheduled ' || j.frequency || ' send (backfilled, sent before tracking)',
  j.created_by_username, q.recipient_user_id, q.recipient_sid, j.id, q.status, q.error,
  coalesce(q.processed_at, q.created_at)
from dashboard_schedule_queue q
join dashboard_scheduled_jobs j on j.id = q.job_id
where q.status in ('sent', 'failed');

-- Manual sends: the audit log only kept a free-text detail line, so each
-- address found in it becomes one row (subject was never recorded). Batch
-- statement sends only logged a count, not addresses, and are skipped.
-- Addresses listed after "failed:" were refused by SMTP.
insert into dashboard_email_log (recipient, category, source, description, sent_by, sid, status, created_at)
select m.addr[1],
  case when a.action = 'email_pdf' then 'statement' else 'fund_performance' end,
  'manual', a.detail || ' (backfilled from the activity log)', a.username,
  substring(a.detail from 'SID ([A-Za-z0-9]+)'),
  m.status, a.created_at
from dashboard_audit_log a
cross join lateral (
  select regexp_matches(split_part(a.detail, 'failed:', 1), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'g') as addr, 'sent' as status
  union all
  select regexp_matches(split_part(a.detail, 'failed:', 2), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'g'), 'failed'
) m
where a.action in ('email_pdf', 'email_fund_performance')
  and a.detail not like 'scheduled %';
