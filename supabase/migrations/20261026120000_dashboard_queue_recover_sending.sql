-- A runner that dies mid-send (edge function time/CPU limit) leaves its rows in
-- 'sending'. Before, dashboard_claim_queue failed them after 10 minutes without
-- looking: a 500-email test lost 3 emails and showed a 4th as failed although
-- SES had sent it. Now an expired 'sending' row is settled from the email log:
--   - a 'sent' log row for the same job + recipient since the row was queued
--     -> the email went out, mark it sent;
--   - otherwise nothing went out -> back to 'pending'. A row that gets
--     interrupted 3 times is failed for good, so a row that always kills the
--     runner cannot loop forever.
-- Only the claim function changes; the signature and the rest of it stay as in
-- 20261013130000_dashboard_schedules_fast_queue.sql.
create or replace function dashboard_claim_queue(p_statement_limit int default 10, p_fund_limit int default 50)
returns setof dashboard_schedule_queue
language plpgsql
as $$
declare
  v_job uuid;
  v_kind text;
begin
  update dashboard_schedule_queue q
    set status = 'sent', error = null, processed_at = now()
    where q.status = 'sending' and q.processed_at < now() - interval '10 minutes'
      and exists (
        select 1 from dashboard_email_log l
        where l.job_id = q.job_id and l.status = 'sent' and l.created_at >= q.created_at
          and (lower(l.recipient) = lower(q.recipient_email) or l.user_id = q.recipient_user_id)
      );

  update dashboard_schedule_queue q
    set status = case when coalesce(substring(q.error from '^requeued (\d+):')::int, 0) >= 2 then 'failed' else 'pending' end,
        error = case when coalesce(substring(q.error from '^requeued (\d+):')::int, 0) >= 2
                     then 'Interrupted while sending 3 times; not retried again.'
                     else 'requeued ' || (coalesce(substring(q.error from '^requeued (\d+):')::int, 0) + 1) || ': runner stopped mid-send, nothing was sent' end,
        processed_at = now()
    where q.status = 'sending' and q.processed_at < now() - interval '10 minutes';

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
