-- Audit trail for dashboard logins and exports. username is a denormalized
-- snapshot (not just a join through user_id) so the record survives the
-- account later being deleted — the whole point of an audit log is that it
-- outlives the actor.
create table dashboard_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references dashboard_users(id) on delete set null,
  username text not null,
  action text not null, -- 'login_success' | 'login_failure' | 'export'
  detail text,
  created_at timestamptz not null default now()
);

create index dashboard_audit_log_created_at_idx on dashboard_audit_log (created_at desc);

alter table dashboard_audit_log enable row level security;
-- No policies — only the service_role key (which bypasses RLS) touches this
-- table, same as dashboard_users/dashboard_sessions.
