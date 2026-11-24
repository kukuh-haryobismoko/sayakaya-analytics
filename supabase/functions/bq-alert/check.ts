// Self-check, no network: deno run -A supabase/functions/bq-alert/check.ts
import { assert, assertEquals } from 'jsr:@std/assert';
const { attachment, summary, kind, route, auditAttachment, requestAttachment, groupDashboard } = await import('./index.ts');
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
const col = (action: string) => auditAttachment({ username: 'u', action, detail: null, created_at: '2026-11-24T07:00:00Z' }).color;
assertEquals([col('view_portfolio'), col('api_request'), col('login_success')], ['#1976d2', '#1976d2', '#1976d2']);
assertEquals([col('sql_run'), col('export'), col('ask'), col('api_write'), col('admin_user_delete')], Array(5).fill('#f9a825'));
assertEquals([col('login_failure'), col('api_error')], ['#d32f2f', '#d32f2f']);
console.log('bq-alert check ok');

// groupDashboard: only jobs carrying a dashboard user, reads merged per user, ops kept per route
{
  const mk = (user: string | null, route: string | null, req: string, billed = 0) => ({ ...j, dts: null, dash_user: user, dash_route: route, dash_req: req, billed });
  const groups = groupDashboard([
    mk('kukuh', 'get__api_overview', 'r1'), mk('kukuh', 'get__api_trends', 'r2'), mk('kukuh', 'post__api_export', 'r3'),
    mk('sari', 'get__api_overview', 'r4'), mk(null, 'get__api_funds_list', 'r5'), mk('kukuh', null, 'r6'),
  ]);
  assertEquals(groups.length, 4, JSON.stringify(groups.map((g) => [g.user, g.reads, g.jobs.length])));
  const reads = groups.find((g) => g.user === 'kukuh' && g.reads)!;
  assertEquals(reads.jobs.length, 2);
  assert(groups.some((g) => g.user === 'kukuh' && !g.reads && g.jobs[0].dash_route === 'post__api_export'));
  assert(groups.some((g) => g.user === 'sari' && g.reads));
  assert(!groups.some((g) => g.user === null));
  const readMsg = requestAttachment(reads.jobs, 18000, true);
  assert(readMsg.text.includes('*kukuh*') && readMsg.text.includes('2 page loads') && readMsg.text.includes('2 routes'), readMsg.text);
  assert(readMsg.text.includes('`GET /api/overview`') && readMsg.text.includes('`GET /api/trends`'), readMsg.text);
  assertEquals(readMsg.color, '#1976d2');
  assertEquals(requestAttachment(reads.jobs.map((x) => ({ ...x, dash_route: 'post_api_export' })), 1).text.split('·')[1].trim(), '`POST /api/export`');
}
