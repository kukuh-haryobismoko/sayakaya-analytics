-- Self-service "forgot password" for dashboard login accounts (not investor
-- data). A reset token is single-use and short-lived: consuming it (or its
-- expiry) deletes the row, and requesting a new one deletes any earlier
-- outstanding token for that user, so only the most recently emailed link
-- ever works. Requires dashboard_users.email to be set — accounts without an
-- email on file can't self-serve and need an admin-issued password instead.

create table dashboard_password_resets (
  token_hash text primary key, -- sha256(raw token), hex — same convention as dashboard_sessions
  user_id uuid not null references dashboard_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table dashboard_password_resets enable row level security;
