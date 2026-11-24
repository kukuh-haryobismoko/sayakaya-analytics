// Slack alert for every finished BigQuery query job (scheduled queries, Looker, humans).
// pg_cron calls this every 5 min (migration 20261124120000). Each tick posts the jobs that
// ended since the last tick; the cursor lives in bq_alert_state. The dashboard's own
// service account runs thousands of queries a day, so it is rolled up into one line.
// Env: SLACK_WEBHOOK_SCHEDULED, SLACK_WEBHOOK_MANUAL, SLACK_WEBHOOK_DASHBOARD, CRON_SECRET (same as api), GCP_SA_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Test without posting or moving the cursor: POST ?dry=1[&since=<ISO>] with the x-cron-key header.
import { runQuery, LOCATION } from '../api/bigquery.ts';

const USD_PER_TIB = 7.5; // asia-southeast2 on-demand list price; the free 1 TiB/month is ignored
const WARN_USD = Number(Deno.env.get('BQ_ALERT_WARN_USD') || 1); // orange attachment at/above this
const MAX_POST = 25; // per tick, errors and biggest cost first; the rest is summed in one line
const DASH_SA = 'syky-big-query@sayakaya.iam.gserviceaccount.com';
const GB = 2 ** 30;
// One Slack webhook (= one channel) per route.
const ROUTES = ['scheduled', 'manual', 'dashboard'] as const;
type Route = typeof ROUTES[number];
const HOOK_ENV: Record<Route, string> = { scheduled: 'SLACK_WEBHOOK_SCHEDULED', manual: 'SLACK_WEBHOOK_MANUAL', dashboard: 'SLACK_WEBHOOK_DASHBOARD' };
// DTS runs -> scheduled; the dashboard's service account -> dashboard; everything else (people, Looker, other SAs) -> manual.
export const route = (j: Pick<Job, 'dts' | 'user_email'>): Route => j.dts ? 'scheduled' : j.user_email === DASH_SA ? 'dashboard' : 'manual';

type Job = {
  job_id: string; user_email: string; end_time: string; start_time: string | null; err: string | null;
  cache_hit: boolean | null; statement_type: string | null; billed: number | null; processed: number | null;
  slot_ms: number | null; query: string; dest: string | null; dts: string | null; requestor: string | null;
  refs: string[]; project_id: string; dash_user: string | null; dash_route: string | null; dash_req: string | null;
};

type Audit = { username: string | null; action: string; detail: string | null; created_at: string };
const enc = encodeURIComponent;
// Blue = reads, yellow = writes / sensitive actions, red = failures.
const YELLOW = /^(sql_run|ask|export|email_|schedule_|exclusion_|admin_|password_|username_set|ml_retrain|api_write)/;
const RED = /fail|error/;
export function auditAttachment(a: Audit) {
  const text = `*${esc(a.username || '?')}* · \`${a.action}\` · ${wib(a.created_at)}` + (a.detail ? `\n${esc(a.detail.slice(0, 500))}` : '');
  return { color: RED.test(a.action) ? '#d32f2f' : YELLOW.test(a.action) ? '#f9a825' : '#1976d2', text, mrkdwn_in: ['text'] };
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (j: { billed: number | null }) => ((j.billed || 0) / 2 ** 40) * USD_PER_TIB;
const fmtIdr = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const wib = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') + ' WIB';

export function kind(j: Pick<Job, 'dts' | 'requestor' | 'user_email'>): string {
  if (j.dts) return 'Scheduled query';
  if (j.requestor === 'looker_studio') return 'Looker Studio';
  return j.user_email.endsWith('.gserviceaccount.com') ? 'Service account' : 'Ad-hoc query';
}

export function attachment(j: Job, rate: number) {
  const cost = usd(j);
  const secs = j.start_time ? Math.max(0, (Date.parse(j.end_time) - Date.parse(j.start_time)) / 1000) : null;
  const link = `https://console.cloud.google.com/bigquery?project=${j.project_id}&j=bq:${LOCATION}:${j.job_id}&page=queryresults`;
  const lines = [
    `${j.err ? ':x:' : ':white_check_mark:'} *${kind(j)}*${j.dest ? ` → \`${j.dest}\`` : ''}${j.cache_hit ? ' (cache hit)' : ''}`,
    `*User* ${j.user_email}${j.dts ? ` · *Config* \`${j.dts}\`` : ''}`,
    `*Ended* ${wib(j.end_time)}${secs === null ? '' : ` · *Took* ${secs.toFixed(1)}s`} · *Slot* ${((j.slot_ms || 0) / 1000).toFixed(1)}s`,
    `*Billed* ${((j.billed || 0) / GB).toFixed(3)} GB (scanned ${((j.processed || 0) / GB).toFixed(3)} GB) · *Cost* $${cost.toFixed(4)} ≈ ${fmtIdr(cost * rate)}`,
    ...(j.refs.length ? [`*Tables* ${j.refs.slice(0, 8).map((t) => `\`${t}\``).join(', ')}${j.refs.length > 8 ? ` +${j.refs.length - 8}` : ''}`] : []),
    ...(j.err ? [`*Error* ${esc(j.err.slice(0, 400))}`] : []),
    `*Job* <${link}|${j.job_id}>`,
    '```' + esc(j.query.replace(/`{3}/g, "'''").trim().slice(0, 700)) + (j.query.length > 700 ? '\n…' : '') + '```',
  ];
  return { color: j.err ? '#d32f2f' : cost >= WARN_USD ? '#f9a825' : '#2e7d32', text: lines.join('\n'), mrkdwn_in: ['text'] };
}

// Dashboard channel: one message per user per tick. Page-load reads (GET) of a user are merged into
// one "page loads" message; writes, exports, asks and SQL runs keep their own message.
export function groupDashboard(jobs: Job[]) {
  const m = new Map<string, { user: string; reads: boolean; jobs: Job[] }>();
  for (const j of jobs) {
    if (!j.dash_user) continue; // the dashboard SA also runs background/warm-up queries: not user activity
    const reads = /^get_/.test(j.dash_route || '');
    const k = `${j.dash_user}\u0000${reads ? '' : j.dash_route || '?'}`;
    const g = m.get(k) || { user: j.dash_user, reads, jobs: [] };
    g.jobs.push(j);
    m.set(k, g);
  }
  return [...m.values()];
}

const pretty = (r: string | null) => (r || '?').replace(/^(get|post|put|patch|delete)_/, (m) => m.slice(0, -1).toUpperCase() + ' ').replace(/_+/g, '/').replace(/^((?:GET|POST|PUT|PATCH|DELETE)) (?!\/)/, '$1 /');

export function requestAttachment(g: Job[], rate: number, reads = false) {
  const bytes = g.reduce((n, j) => n + (j.billed || 0), 0), cost = usd({ billed: bytes });
  const fails = g.filter((j) => j.err);
  const tables = [...new Set(g.flatMap((j) => j.refs))];
  const routes = [...new Set(g.map((j) => pretty(j.dash_route)))].sort();
  const reqs = new Set(g.map((j) => j.dash_req)).size;
  const shown = [...g].sort((a, b) => usd(b) - usd(a)).slice(0, reads ? 3 : 5);
  const qs = shown.map((j) => {
    const link = `https://console.cloud.google.com/bigquery?project=${j.project_id}&j=bq:${LOCATION}:${j.job_id}&page=queryresults`;
    const sql = esc(j.query.replace(/`{3}/g, "'''").replace(/\s+/g, ' ').trim().slice(0, 300));
    return `${j.err ? ':x:' : '•'} \`${pretty(j.dash_route)}\` ${((j.billed || 0) / GB).toFixed(3)} GB · $${usd(j).toFixed(4)}${j.cache_hit ? ' (cache)' : ''} · <${link}|job>${j.err ? ` · ${esc(j.err.slice(0, 150))}` : ''}\n\`\`\`${sql}\`\`\``;
  });
  const head = reads
    ? `${reqs} page load${reqs === 1 ? '' : 's'} · ${routes.length} route${routes.length === 1 ? '' : 's'}`
    : `\`${routes[0]}\``;
  const lines = [
    `${fails.length ? ':x:' : reads ? ':eyes:' : ':bar_chart:'} *${esc(g[0].dash_user || '?')}* · ${head} · ${wib(g[g.length - 1].end_time)}`,
    `*Queries* ${g.length}${fails.length ? ` (${fails.length} failed)` : ''} · *Billed* ${(bytes / GB).toFixed(3)} GB · *Cost* $${cost.toFixed(4)} ≈ ${fmtIdr(cost * rate)}`,
    ...(reads ? [`*Routes* ${routes.slice(0, 8).map((r) => `\`${r}\``).join(', ')}${routes.length > 8 ? ` +${routes.length - 8}` : ''}`] : []),
    ...(tables.length ? [`*Tables* ${tables.slice(0, 10).map((t) => `\`${t}\``).join(', ')}${tables.length > 10 ? ` +${tables.length - 10}` : ''}`] : []),
    ...qs,
    ...(g.length > shown.length ? [`+${g.length - shown.length} more queries`] : []),
  ];
  return { color: fails.length ? '#d32f2f' : cost >= WARN_USD ? '#f9a825' : reads ? '#1976d2' : '#2e7d32', text: lines.join('\n'), mrkdwn_in: ['text'] };
}

export function summary(jobs: Job[], rate: number, label: string): string | null {
  if (!jobs.length) return null;
  const bytes = jobs.reduce((s, j) => s + (j.billed || 0), 0);
  const c = usd({ billed: bytes });
  return `*${label}*: ${jobs.length} queries (${jobs.filter((j) => j.err).length} failed) · ${(bytes / GB).toFixed(2)} GB billed · $${c.toFixed(4)} ≈ ${fmtIdr(c * rate)}`;
}

async function sb(path: string, init: RequestInit = {}) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1${path}`, {
    ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function tick(dry: boolean, sinceOverride: string | null) {
  const until = new Date(Date.now() - 60_000).toISOString(); // INFORMATION_SCHEMA lags a little
  let since = sinceOverride;
  if (!since) {
    const [row] = await sb('/bq_alert_state?id=eq.1&select=last_end');
    if (!row) {
      if (!dry) await sb('/bq_alert_state', { method: 'POST', body: JSON.stringify({ id: 1, last_end: until }) });
      return { initialized: until };
    }
    since = row.last_end;
  }
  const jobs = (await runQuery(
    `SELECT job_id, user_email, project_id, FORMAT_TIMESTAMP('%FT%TZ', end_time) AS end_time, FORMAT_TIMESTAMP('%FT%TZ', start_time) AS start_time,
       error_result.message AS err, cache_hit, statement_type, total_bytes_billed AS billed, total_bytes_processed AS processed,
       total_slot_ms AS slot_ms, query,
       IF(STARTS_WITH(destination_table.dataset_id, '_'), NULL, CONCAT(destination_table.dataset_id, '.', destination_table.table_id)) AS dest,
       (SELECT value FROM UNNEST(labels) WHERE key = 'dts_config_id') AS dts,
       (SELECT value FROM UNNEST(labels) WHERE key = 'requestor') AS requestor,
       (SELECT value FROM UNNEST(labels) WHERE key = 'dashboard_user') AS dash_user,
       (SELECT value FROM UNNEST(labels) WHERE key = 'dashboard_route') AS dash_route,
       (SELECT value FROM UNNEST(labels) WHERE key = 'dashboard_req') AS dash_req,
       ARRAY(SELECT CONCAT(dataset_id, '.', table_id) FROM UNNEST(referenced_tables)) AS refs
     FROM \`region-${LOCATION}\`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
     WHERE creation_time >= TIMESTAMP_SUB(TIMESTAMP(@since), INTERVAL 6 HOUR) -- prunes partitions; a job lives 6h max
       AND end_time > TIMESTAMP(@since) AND end_time <= TIMESTAMP(@until)
       AND job_type = 'QUERY' AND state = 'DONE' AND parent_job_id IS NULL
     ORDER BY end_time`, { since, until },
  )) as unknown as Job[];
  const [{ rate = 0 } = {}] = await runQuery('SELECT rate FROM `sayakaya.main.fx_rates` ORDER BY rate_date DESC LIMIT 1') as { rate?: string }[];
  const fx = Number(rate);
  const out: Record<Route, unknown[]> = { scheduled: [], manual: [], dashboard: [] };
  const by: Record<Route, Job[]> = { scheduled: [], manual: [], dashboard: [] };
  for (const j of jobs) by[route(j)].push(j);
  for (const r of ['scheduled', 'manual'] as const) {
    const list = by[r].sort((a, b) => Number(!!b.err) - Number(!!a.err) || usd(b) - usd(a));
    const more = summary(list.slice(MAX_POST), fx, `+${Math.max(0, list.length - MAX_POST)} more not shown`);
    out[r] = [...list.slice(0, MAX_POST).map((j) => ({ attachments: [attachment(j, fx)] })), ...(more ? [{ text: more }] : [])];
  }
  // Dashboard: one message per web request (all its queries grouped by the dashboard_req label),
  // interleaved by time with the audit-log events (login, export, view_portfolio, ask, ...).
  const audit: Audit[] = await sb(`/dashboard_audit_log?created_at=gt.${enc(since!)}&created_at=lte.${enc(until)}&order=created_at&select=username,action,detail,created_at`) || [];
  const groups = groupDashboard(by.dashboard);
  const items: { t: string; m: unknown }[] = [
    ...audit.filter((a) => a.action !== 'api_request').map((a) => ({ t: a.created_at, m: { attachments: [auditAttachment(a)] } })),
    ...groups.map((g) => ({ t: g.jobs[g.jobs.length - 1].end_time, m: { attachments: [requestAttachment(g.jobs, fx, g.reads)] } })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  out.dashboard = items.slice(-MAX_POST).map((i) => i.m);
  if (items.length > MAX_POST) out.dashboard.unshift({ text: `${items.length - MAX_POST} earlier dashboard events not shown` });
  if (dry) return { since, until, jobs: jobs.length, ...out };
  const hooks = Object.fromEntries(ROUTES.map((r) => [r, Deno.env.get(HOOK_ENV[r])]));
  const missing = ROUTES.filter((r) => out[r].length && !hooks[r]).map((r) => HOOK_ENV[r]);
  if (missing.length) throw new Error(`Not set: ${missing.join(', ')}`);
  let posted = 0;
  for (const r of ROUTES) for (const m of out[r]) {
    const res = await fetch(hooks[r]!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    if (!res.ok) throw new Error(`Slack ${r} ${res.status}: ${await res.text()}`);
    posted++;
    await new Promise((r) => setTimeout(r, 1100)); // Slack webhooks allow ~1 msg/s
  }
  await sb('/bq_alert_state', { method: 'POST', body: JSON.stringify({ id: 1, last_end: until }) });
  return { since, until, jobs: jobs.length, posted };
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    const key = req.headers.get('x-cron-key') || '', want = Deno.env.get('CRON_SECRET') || '';
    if (!want || key !== want) return new Response('Unauthorized', { status: 401 });
    const u = new URL(req.url);
    try {
      return Response.json(await tick(u.searchParams.has('dry'), u.searchParams.get('since')));
    } catch (e) {
      console.error('[bq-alert]', (e as Error).message);
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  });
}
