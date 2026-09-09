-- Private Storage bucket for internal meeting deck PDFs (Presentation tab).
-- These were previously inlined as base64 directly into the Edge Function's
-- source (supabase/functions/api/presentation-*.ts) — that worked fine with
-- one or two decks, but adding a third pushed the function's total bundle
-- size to 5.25 MB, which trips the Management API's function-deploy request
-- size limit (413 request entity too large). Storage has no such ceiling and
-- scales to any number of decks.
-- Private (public = false): objects are only fetchable via the service_role
-- key from the Edge Function itself (supabase/functions/api/index.ts), gated
-- by the same requireTab('presentation' | 'monthly-review') check as before
-- — never reachable via a public Storage URL.
insert into storage.buckets (id, name, public)
values ('presentation-decks', 'presentation-decks', false)
on conflict (id) do nothing;
