// Ported from server/schedules.js — see that file for the full rationale
// (host-agnostic execution via a plain HTTP endpoint, the queue table for
// large recipient pools, WIB frequency math). If you change this, change
// server/schedules.js too (or vice versa) — the two are not auto-synced,
// though both point at the same dashboard_scheduled_jobs/
// dashboard_schedule_otps/dashboard_schedule_queue tables, so a schedule
// created via one backend is visible/editable on both.

import crypto from 'node:crypto';
import { runQuery } from './bigquery.ts';
import * as Q from './queries.ts';
import { fundPerformanceReport, val } from './pdf.ts';
import * as Mail from './mail.ts';
import { pivotPerformanceByType, buildStatementAttachments, previousMonthYYYYMM } from './report-helpers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OTP_TTL_MS = 10 * 60 * 1000;
const JAKARTA_OFFSET_MIN = 7 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DRAIN_LIMIT: Record<string, number> = {
  statement: Number(Deno.env.get('SCHEDULE_DRAIN_LIMIT_STATEMENT')) || 25,
  fund_performance: Number(Deno.env.get('SCHEDULE_DRAIN_LIMIT_FUND_PERFORMANCE')) || 100,
};
const MAX_JOBS_ENQUEUED_PER_TICK = 5;

export interface ScheduledJob {
  id: string;
  kind: 'statement' | 'fund_performance';
  recipient_type: 'single_email' | 'csv_list' | 'all_aum' | 'all_registered';
  recipient_email: string | null;
  recipient_list: string[] | null;
  send_portfolio: boolean;
  send_statement: boolean;
  subject: string | null;
  body: string | null;
  frequency: 'daily' | 'weekly' | 'monthly_last_day' | 'monthly_day';
  day_of_week: number | null;
  day_of_month: number | null;
  run_time: string;
  status: 'active' | 'paused';
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  created_by_user_id: string | null;
  created_by_username: string | null;
  confirmation_email: string;
  created_at: string;
}

// deno-lint-ignore no-explicit-any
async function rest(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase REST ${opts.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function sha256Hex(v: string): string { return crypto.createHash('sha256').update(v).digest('hex'); }
function genOtpCode(): string { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

// ---- Next-run computation (Asia/Jakarta wall-clock, UTC+7 fixed, no DST) ---
interface NextRunSpec { frequency: string; day_of_week?: number | null; day_of_month?: number | null; run_time?: string | null }

function parseRunTime(runTime?: string | null) {
  const [h, m] = String(runTime || '08:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

export function computeNextRun(job: NextRunSpec, from: Date = new Date()): Date {
  const { h, m } = parseRunTime(job.run_time);
  const toJkt = (d: Date) => new Date(d.getTime() + JAKARTA_OFFSET_MIN * 60000);
  const toUtc = (jktDate: Date) => new Date(jktDate.getTime() - JAKARTA_OFFSET_MIN * 60000);
  const fromJkt = toJkt(from);
  const atTime = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d, h, m, 0, 0));

  if (job.frequency === 'daily') {
    let next = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), fromJkt.getUTCDate());
    if (toUtc(next) <= from) next = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), fromJkt.getUTCDate() + 1);
    return toUtc(next);
  }

  if (job.frequency === 'weekly') {
    const targetDow = Number(job.day_of_week) || 0;
    const base = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), fromJkt.getUTCDate());
    const diff = (targetDow - base.getUTCDay() + 7) % 7;
    let next = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), fromJkt.getUTCDate() + diff);
    if (toUtc(next) <= from) next = atTime(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate() + 7);
    return toUtc(next);
  }

  if (job.frequency === 'monthly_last_day') {
    const lastDayOf = (y: number, mo: number) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    let next = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), lastDayOf(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth()));
    if (toUtc(next) <= from) {
      const y = fromJkt.getUTCFullYear(), mo = fromJkt.getUTCMonth() + 1;
      next = atTime(y, mo, lastDayOf(y, mo));
    }
    return toUtc(next);
  }

  if (job.frequency === 'monthly_day') {
    const targetDom = Number(job.day_of_month) || 1;
    const dayInMonth = (y: number, mo: number) => Math.min(targetDom, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate());
    let next = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), dayInMonth(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth()));
    if (toUtc(next) <= from) {
      const y = fromJkt.getUTCFullYear(), mo = fromJkt.getUTCMonth() + 1;
      next = atTime(y, mo, dayInMonth(y, mo));
    }
    return toUtc(next);
  }

  throw new Error(`Unknown frequency: ${job.frequency}`);
}

// ---- Recipient resolution ---------------------------------------------------
export interface RecipientSpec {
  kind: string;
  recipientType: string;
  recipientEmail?: string;
  recipientList?: string[];
}
interface Recipient { email: string; userId: string | null; sid: string | null }

export async function resolveRecipients({ kind, recipientType, recipientEmail, recipientList }: RecipientSpec): Promise<Recipient[]> {
  if (recipientType === 'all_aum' || recipientType === 'all_registered') {
    const q = recipientType === 'all_aum' ? Q.allInvestorsWithAum() : Q.allRegisteredUsersWithEmail();
    const rows = await runQuery(q.sql, q.params);
    return rows
      .map((r) => ({ email: val(r.email) as string, userId: r.user_id as string, sid: val(r.sid) as string }))
      .filter((r) => r.email);
  }

  const raw = recipientType === 'single_email' ? [recipientEmail] : (recipientList || []);
  const idList = [...new Set(raw.map((s) => String(s || '').trim()).filter(Boolean))];
  if (!idList.length) return [];

  if (kind === 'fund_performance') {
    return idList.filter((e) => EMAIL_RE.test(e)).map((email) => ({ email, userId: null, sid: null }));
  }

  const q = Q.usersByIdentifiers(idList);
  const matches = await runQuery(q.sql, q.params);
  return matches
    .map((m) => ({ email: val(m.email) as string, userId: m.user_id as string, sid: val(m.sid) as string }))
    .filter((r) => r.email);
}

export async function previewRecipientCount(spec: RecipientSpec): Promise<number> {
  const recipients = await resolveRecipients(spec);
  return recipients.length;
}

// ---- OTP-gated schedule creation --------------------------------------------
// deno-lint-ignore no-explicit-any
export async function requestOtp(payload: any): Promise<string> {
  if (!payload.confirmationEmail || !EMAIL_RE.test(payload.confirmationEmail)) {
    throw new Error('A valid confirmation email is required.');
  }
  const code = genOtpCode();
  const [row] = await rest('/dashboard_schedule_otps', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      confirmation_email: payload.confirmationEmail,
      code_hash: sha256Hex(code),
      payload,
      created_by_user_id: payload.userId || null,
      created_by_username: payload.username || null,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    }),
  });
  await Mail.sendScheduleOtpEmail({ to: payload.confirmationEmail, code, kind: payload.kind });
  return row.id;
}

export async function confirmOtp(otpId: string, code: string): Promise<ScheduledJob> {
  const rows = await rest(`/dashboard_schedule_otps?id=eq.${otpId}&select=*`);
  const otp = rows[0];
  if (!otp) throw new Error('Confirmation code not found or already used.');
  if (new Date(otp.expires_at) < new Date()) {
    await rest(`/dashboard_schedule_otps?id=eq.${otpId}`, { method: 'DELETE' });
    throw new Error('Confirmation code expired — request a new one.');
  }
  if (sha256Hex(String(code || '').trim()) !== otp.code_hash) throw new Error('Incorrect confirmation code.');

  const p = otp.payload;
  const seed: NextRunSpec = { frequency: p.frequency, day_of_week: p.dayOfWeek, day_of_month: p.dayOfMonth, run_time: p.runTime };
  const [job] = await rest('/dashboard_scheduled_jobs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      kind: p.kind,
      recipient_type: p.recipientType,
      recipient_email: p.recipientEmail || null,
      recipient_list: p.recipientList && p.recipientList.length ? p.recipientList : null,
      send_portfolio: !!p.sendPortfolio,
      send_statement: !!p.sendStatement,
      subject: p.subject || null,
      body: p.body || null,
      frequency: p.frequency,
      day_of_week: p.dayOfWeek ?? null,
      day_of_month: p.dayOfMonth ?? null,
      run_time: p.runTime || '08:00',
      status: 'active',
      next_run_at: computeNextRun(seed, new Date()).toISOString(),
      created_by_user_id: p.userId || null,
      created_by_username: p.username || null,
      confirmation_email: p.confirmationEmail,
    }),
  });
  await rest(`/dashboard_schedule_otps?id=eq.${otpId}`, { method: 'DELETE' });
  return job;
}

// ---- CRUD used by the UI ----------------------------------------------------
export function listJobs(kind: string): Promise<ScheduledJob[]> {
  return rest(`/dashboard_scheduled_jobs?kind=eq.${kind}&select=*&order=created_at.desc`);
}

export async function setJobStatus(id: string, status: string): Promise<ScheduledJob> {
  const rows = await rest(`/dashboard_scheduled_jobs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
  return rows[0];
}

export async function deleteJob(id: string): Promise<void> {
  await rest(`/dashboard_schedule_queue?job_id=eq.${id}`, { method: 'DELETE' });
  await rest(`/dashboard_scheduled_jobs?id=eq.${id}`, { method: 'DELETE' });
}

// ---- Execution: called by POST /api/cron/run-due-schedules -----------------
async function enqueueJob(job: ScheduledJob): Promise<number> {
  const recipients = await resolveRecipients({
    kind: job.kind, recipientType: job.recipient_type,
    recipientEmail: job.recipient_email || undefined, recipientList: job.recipient_list || undefined,
  });
  const toInsert = recipients.map((r) => ({
    job_id: job.id, recipient_email: r.email, recipient_user_id: r.userId, recipient_sid: r.sid,
  }));
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    await rest('/dashboard_schedule_queue', { method: 'POST', body: JSON.stringify(toInsert.slice(i, i + CHUNK)) });
  }
  return toInsert.length;
}

async function markQueueRow(id: string, status: string, error?: string): Promise<void> {
  await rest(`/dashboard_schedule_queue?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, error: error || null, processed_at: new Date().toISOString() }),
  });
}

async function drainQueueForJob(job: ScheduledJob, limit: number): Promise<{ sent: number; failed: number }> {
  const rows = await rest(`/dashboard_schedule_queue?job_id=eq.${job.id}&status=eq.pending&select=*&order=created_at.asc&limit=${limit}`);
  if (!rows.length) return { sent: 0, failed: 0 };

  const senderEmail = job.kind === 'statement'
    ? (Deno.env.get('SMTP_FROM_STATEMENT') || 'estatement@sayakaya.id')
    : (Deno.env.get('SMTP_FROM_FUND_PERFORMANCE') || 'hi@sayakaya.id');

  let fundPerfBuffer: Uint8Array | null = null;
  let sent = 0, failed = 0;

  // deno-lint-ignore no-explicit-any
  for (const row of rows as any[]) {
    try {
      if (job.kind === 'fund_performance') {
        if (!fundPerfBuffer) {
          const q = Q.productPerformanceDetail();
          const detail = await runQuery(q.sql, q.params);
          fundPerfBuffer = new Uint8Array(await fundPerformanceReport(pivotPerformanceByType(detail), { username: job.created_by_username || 'schedule' }));
        }
        await Mail.sendStatementEmail({
          to: row.recipient_email, subject: job.subject ?? undefined, body: job.body ?? undefined,
          attachments: [{ filename: 'Reksa_Dana_Update.pdf', content: fundPerfBuffer }],
          from: senderEmail,
        });
      } else {
        const c = Q.userContact(row.recipient_user_id);
        const [contact] = await runQuery(c.sql, c.params);
        if (!contact?.email) throw new Error('no email on file');
        const attachments = await buildStatementAttachments({
          userId: row.recipient_user_id, sid: row.recipient_sid, contact,
          sendPortfolio: job.send_portfolio, sendStatement: job.send_statement,
          statementMonth: previousMonthYYYYMM(),
          username: job.created_by_username || 'schedule',
        });
        await Mail.sendStatementEmail({
          to: contact.email as string, subject: job.subject ?? undefined, body: job.body ?? undefined,
          name: contact.name as string | undefined, attachments, from: senderEmail,
        });
      }
      await markQueueRow(row.id, 'sent');
      sent++;
    } catch (e) {
      await markQueueRow(row.id, 'failed', (e as Error).message);
      failed++;
    }
  }
  return { sent, failed };
}

export async function runDueJobs(): Promise<{ jobsClaimed: number; recipientsEnqueued: number; sent: number; failed: number }> {
  const nowIso = new Date().toISOString();
  const due: ScheduledJob[] = await rest(`/dashboard_scheduled_jobs?status=eq.active&next_run_at=lte.${nowIso}&select=*&order=next_run_at.asc&limit=${MAX_JOBS_ENQUEUED_PER_TICK}`);

  let enqueued = 0;
  for (const job of due) {
    const nextRun = computeNextRun(job, new Date());
    const claimed = await rest(
      `/dashboard_scheduled_jobs?id=eq.${job.id}&next_run_at=eq.${encodeURIComponent(job.next_run_at || '')}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ next_run_at: nextRun.toISOString(), last_run_at: nowIso, run_count: (job.run_count || 0) + 1 }),
      },
    );
    if (!claimed || !claimed.length) continue;
    enqueued += await enqueueJob(job);
  }

  const activeJobs: ScheduledJob[] = await rest('/dashboard_scheduled_jobs?status=eq.active&select=id,kind,created_by_username');
  let sent = 0, failed = 0;
  for (const job of activeJobs) {
    const r = await drainQueueForJob(job, DRAIN_LIMIT[job.kind] || 25);
    sent += r.sent; failed += r.failed;
  }

  return { jobsClaimed: due.length, recipientsEnqueued: enqueued, sent, failed };
}
