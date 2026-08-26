-- Each dashboard user's own Google account, used only as the recipient when
-- they push a portfolio report to Google Sheets (server/sheets.js /
-- supabase/functions/api/sheets.ts) — the sheet is created by the shared GCP
-- service account, which has no visible Drive of its own, so it must be
-- shared to a real person's account to show up anywhere. Nullable: existing
-- users just can't use the Sheets export until an admin sets it.

alter table dashboard_users add column email text;
