-- Dashboard login accounts + sessions for the Sayakaya Analytics app itself
-- (distinct from sayakaya.main.users in BigQuery, which is investor/customer
-- data). Accessed only via the service_role key over PostgREST from both
-- server/app.js (Netlify) and supabase/functions/api (Edge Function) — never
-- via the anon/authenticated keys, so RLS is enabled with no policies
-- (default-deny) as a defense-in-depth measure that costs nothing here.

create extension if not exists pgcrypto;

create table dashboard_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null, -- scrypt: "saltHex:hashHex"
  is_superuser boolean not null default false,
  allowed_tabs text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table dashboard_sessions (
  token_hash text primary key, -- sha256(raw token), hex
  user_id uuid not null references dashboard_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table dashboard_users enable row level security;
alter table dashboard_sessions enable row level security;

-- Seed the initial superuser (username: kukuh, password set by the app owner).
insert into dashboard_users (username, password_hash, is_superuser, allowed_tabs)
values (
  'kukuh',
  '8177dad8d5ccdd6ee040a612b09b13e7:31cc1246816666c262eb77933d73d18a009307f65d87de5b64dc28bd96e5f3a4fc4cfab97d92c7bec8f037c82e7369fdce98726f9fe3f632fe9dcaf27c3c81d1',
  true,
  '{}'
);
