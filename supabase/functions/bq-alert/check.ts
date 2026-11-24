// Self-check, no network: deno run -A supabase/functions/bq-alert/check.ts
import { assert, assertEquals } from 'jsr:@std/assert';
const { attachment, summary, kind, route, auditAttachment, requestAttachment } = await import('./index.ts');
const j = { job_id: 'j1', user_email: 'a@b.id', project_id: 'sayakaya', end_time: '2026-11-24T07:00:10Z', start_time: '2026-11-24T07:00:00Z', err: null,
  cache_hit: false, statement_type: 'SELECT', billed: 2 ** 40, processed: 2 ** 40, slot_ms: 5000, query: 'select 1 <x>', dest: 'main.t', dts: 'cfg', requestor: null, refs: ['main.x'], dash_user: null, dash_route: null, dash_req: null };
const a = attachment(j, 18000);
assert(a.text.includes('Scheduled query') && a.text.includes('1024.000 GB'));
assert(a.text.includes('$7.5000 ≈ Rp 135.000'), a.text);
assert(a.text.includes('2026-11-24 14:00:10 WIB') && a.text.includes('&lt;x&gt;'));
assertEquals(a.color, '#f9a825');
assertEquals(attachment({ ...j, err: 'boom' }, 1).color, '#d32f2f');
assertEquals(kind({ dts: null, requestor: 'looker_studio', user_email: 'x' }), 'Looker Studio');
assertEquals(summary([], 1, 'x'), null);
assertEquals(route(j), 'scheduled');
assertEquals(route({ dts: null, user_email: 'syky-big-query@sayakaya.iam.gserviceaccount.com' }), 'dashboard');
assertEquals(route({ dts: null, user_email: 'kukuh@sayakaya.id' }), 'manual');
const au = auditAttachment({ username: 'kukuh', action: 'login_failure', detail: 'x<y', created_at: '2026-11-24T07:00:00Z' });
assert(au.text.includes('kukuh') && au.text.includes('14:00:00 WIB') && au.text.includes('x&lt;y'));
assertEquals(au.color, '#d32f2f');
const ra = requestAttachment([{ ...j, dts: null, dash_user: 'kukuh', dash_route: 'get__api_portfolio__sid', dash_req: 'r1' }, { ...j, dts: null, err: 'boom', dash_user: 'kukuh', dash_route: 'x', dash_req: 'r1' }], 18000);
assert(ra.text.includes('kukuh') && ra.text.includes('GET ') && ra.text.includes('Queries* 2 (1 failed)') && ra.text.includes('main.x') && ra.text.includes('2048.000 GB'), ra.text);
console.log('bq-alert check ok');
