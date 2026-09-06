'use strict';

// Automated/recurring sending for Send statement and Send fund performance.
// Storage is the same Supabase Postgres used for dashboard accounts
// (server/auth.js) — reached the same way, over PostgREST with the
// service_role key. No new infrastructure dependency.
//
// Execution model: this module does NOT run its own timer. `runDueJobs()` is
// a plain function that checks what's due right now and processes a bounded
// slice of it — anything (Netlify Scheduled Functions today, GCP Cloud
// Scheduler after a migration, a crontab entry with curl, a GitHub Actions
// schedule) can invoke it by hitting POST /api/cron/run-due-schedules on a
// timer. The app itself is deliberately host-agnostic about *what* triggers
// it, only about *what happens* when triggered — so moving hosts is just
// repointing the external scheduler at the new URL, no code change.
//
// Recipients for "All AUM investors" / "All registered users" can run into
// the hundreds of thousands (see queries.js: allInvestorsWithAum /
// allRegisteredUsersWithEmail) — resolving and generating a personal
// statement PDF for every one of them cannot happen inside one invocation of
// anything, serverless or not. dashboard_schedule_queue exists exactly for
// this: resolving a due job snapshots its recipients into queue rows once,
// and runDueJobs() drains a bounded number of queue rows per call regardless
// of source, so a huge recipient list is processed across many ticks instead
// of timing out (or running forever) in one.

const crypto = require('crypto');
const { runQuery } = require('./bigquery');
const Q = require('./queries');
const PDF = require('./pdf');
const Mail = require('./mail');
const Auth = require('./auth');
const { pivotPerformanceByType, buildStatementAttachments, previousMonthYYYYMM } = require('./report-helpers');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes — same order as dashboard_password_resets
const JAKARTA_OFFSET_MIN = 7 * 60; // WIB, UTC+7, no DST — same convention as the rest of the dashboard
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per drain call: statement sends each cost a BigQuery query + PDF render;
// fund_performance sends share one already-built PDF, so they're cheap and
// can run a much larger batch. Tune via env without a code change once the
// real per-invocation time budget (Netlify vs. GCP Cloud Run) is known.
const DRAIN_LIMIT = {
  statement: Number(process.env.SCHEDULE_DRAIN_LIMIT_STATEMENT) || 25,
  fund_performance: Number(process.env.SCHEDULE_DRAIN_LIMIT_FUND_PERFORMANCE) || 100,
};
// How many due jobs get a fresh queue populated per call — separate from the
// per-job drain limit above, since populating the queue for "all registered
// users" is itself one big (cheap) query, not per-recipient work.
const MAX_JOBS_ENQUEUED_PER_TICK = 5;

async function rest(path, opts = {}) {
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

function sha256Hex(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function genOtpCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

// ---- Next-run computation ---------------------------------------------------
// Schedule times are Asia/Jakarta wall-clock (WIB, UTC+7, fixed offset, no
// DST) — computed by shifting to "Jakarta-local" UTC-ish arithmetic and
// shifting back, instead of pulling in a timezone library for one fixed
// offset.
function parseRunTime(runTime) {
  const [h, m] = String(runTime || '08:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function computeNextRun(job, from = new Date()) {
  const { h, m } = parseRunTime(job.run_time);
  const toJkt = (d) => new Date(d.getTime() + JAKARTA_OFFSET_MIN * 60000);
  const toUtc = (jktDate) => new Date(jktDate.getTime() - JAKARTA_OFFSET_MIN * 60000);
  const fromJkt = toJkt(from);
  const atTime = (y, mo, d) => new Date(Date.UTC(y, mo, d, h, m, 0, 0));

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
    const lastDayOf = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    let next = atTime(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth(), lastDayOf(fromJkt.getUTCFullYear(), fromJkt.getUTCMonth()));
    if (toUtc(next) <= from) {
      const y = fromJkt.getUTCFullYear(), mo = fromJkt.getUTCMonth() + 1;
      next = atTime(y, mo, lastDayOf(y, mo));
    }
    return toUtc(next);
  }

  if (job.frequency === 'monthly_day') {
    const targetDom = Number(job.day_of_month) || 1;
    const dayInMonth = (y, mo) => Math.min(targetDom, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate());
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
// For kind='statement' every recipient must be a real investor (their own
// portfolio/e-statement is per-person) — single_email/csv_list entries are
// matched to a BigQuery user record by exact email, same as the manual batch
// send (see queries.js:usersByIdentifiers). For kind='fund_performance' any
// syntactically valid email works since the same PDF goes to everyone.
async function resolveRecipients({ kind, recipientType, recipientEmail, recipientList }) {
  if (recipientType === 'all_aum' || recipientType === 'all_registered') {
    const q = recipientType === 'all_aum' ? Q.allInvestorsWithAum() : Q.allRegisteredUsersWithEmail();
    const rows = await runQuery(q.sql, q.params, { redact: false });
    return rows
      .map((r) => ({ email: PDF.val(r.email), userId: r.user_id, sid: PDF.val(r.sid) }))
      .filter((r) => r.email);
  }

  const raw = recipientType === 'single_email' ? [recipientEmail] : (recipientList || []);
  const idList = [...new Set(raw.map((s) => String(s || '').trim()).filter(Boolean))];
  if (!idList.length) return [];

  if (kind === 'fund_performance') {
    return idList.filter((e) => EMAIL_RE.test(e)).map((email) => ({ email, userId: null, sid: null }));
  }

  const q = Q.usersByIdentifiers(idList);
  const matches = await runQuery(q.sql, q.params, { redact: false });
  return matches
    .map((m) => ({ email: PDF.val(m.email), userId: m.user_id, sid: PDF.val(m.sid) }))
    .filter((r) => r.email);
}

// Preview for the compose UI, before the OTP step: "this will reach N people".
async function previewRecipientCount(spec) {
  const recipients = await resolveRecipients(spec);
  return recipients.length;
}

// ---- OTP-gated schedule creation --------------------------------------------
// payload: { kind, recipientType, recipientEmail, recipientList, sendPortfolio,
//   sendStatement, subject, body, frequency, dayOfWeek, dayOfMonth, runTime,
//   confirmationEmail, userId, username }
async function requestOtp(payload) {
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

async function confirmOtp(otpId, code) {
  const rows = await rest(`/dashboard_schedule_otps?id=eq.${otpId}&select=*`);
  const otp = rows[0];
  if (!otp) throw new Error('Confirmation code not found or already used.');
  if (new Date(otp.expires_at) < new Date()) {
    await rest(`/dashboard_schedule_otps?id=eq.${otpId}`, { method: 'DELETE' });
    throw new Error('Confirmation code expired — request a new one.');
  }
  if (sha256Hex(String(code || '').trim()) !== otp.code_hash) throw new Error('Incorrect confirmation code.');

  const p = otp.payload;
  const seed = { frequency: p.frequency, day_of_week: p.dayOfWeek, day_of_month: p.dayOfMonth, run_time: p.runTime };
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
function listJobs(kind) {
  return rest(`/dashboard_scheduled_jobs?kind=eq.${kind}&select=*&order=created_at.desc`);
}

async function setJobStatus(id, status) {
  const rows = await rest(`/dashboard_scheduled_jobs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
  return rows[0];
}

async function deleteJob(id) {
  await rest(`/dashboard_schedule_queue?job_id=eq.${id}`, { method: 'DELETE' });
  await rest(`/dashboard_scheduled_jobs?id=eq.${id}`, { method: 'DELETE' });
}

// ---- Execution: called by POST /api/cron/run-due-schedules -----------------

// Snapshots resolveRecipients() into queue rows for one due job. Recipients
// are fixed at this moment even if the underlying investor pool changes
// mid-drain (e.g. "all registered users" gaining a new signup partway
// through a multi-tick drain doesn't retroactively add them to this run).
async function enqueueJob(job) {
  const recipients = await resolveRecipients({
    kind: job.kind, recipientType: job.recipient_type,
    recipientEmail: job.recipient_email, recipientList: job.recipient_list,
  });
  const toInsert = recipients.map((r) => ({
    job_id: job.id, recipient_email: r.email, recipient_user_id: r.userId, recipient_sid: r.sid,
  }));
  const CHUNK = 500; // PostgREST bulk insert, kept modest per request
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    await rest('/dashboard_schedule_queue', { method: 'POST', body: JSON.stringify(toInsert.slice(i, i + CHUNK)) });
  }
  return toInsert.length;
}

async function markQueueRow(id, status, error) {
  await rest(`/dashboard_schedule_queue?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, error: error || null, processed_at: new Date().toISOString() }),
  });
}

// Drains up to `limit` pending queue rows for one job. Builds the shared fund
// performance PDF at most once per call (not once per recipient).
async function drainQueueForJob(job, limit) {
  const rows = await rest(`/dashboard_schedule_queue?job_id=eq.${job.id}&status=eq.pending&select=*&order=created_at.asc&limit=${limit}`);
  if (!rows.length) return { sent: 0, failed: 0 };

  const senderEmail = job.kind === 'statement'
    ? (process.env.SMTP_FROM_STATEMENT || 'estatement@sayakaya.id')
    : (process.env.SMTP_FROM_FUND_PERFORMANCE || 'hi@sayakaya.id');

  let fundPerfBuffer = null;
  let sent = 0, failed = 0;

  for (const row of rows) {
    try {
      if (job.kind === 'fund_performance') {
        if (!fundPerfBuffer) {
          const q = Q.productPerformanceDetail();
          const detail = await runQuery(q.sql, q.params);
          fundPerfBuffer = await PDF.fundPerformanceReport(pivotPerformanceByType(detail), { username: job.created_by_username || 'schedule' });
        }
        await Mail.sendStatementEmail({
          to: row.recipient_email, subject: job.subject, body: job.body,
          attachments: [{ filename: 'Reksa_Dana_Update.pdf', content: fundPerfBuffer }],
          from: senderEmail,
        });
        await Auth.logEvent(job.created_by_user_id, job.created_by_username || 'schedule', 'email_fund_performance',
          `scheduled fund-performance to ${row.recipient_email}`);
      } else {
        const c = Q.userContact(row.recipient_user_id);
        const [contact] = await runQuery(c.sql, c.params, { redact: false });
        if (!contact?.email) throw new Error('no email on file');
        const attachments = await buildStatementAttachments({
          userId: row.recipient_user_id, sid: row.recipient_sid, contact,
          sendPortfolio: job.send_portfolio, sendStatement: job.send_statement,
          statementMonth: previousMonthYYYYMM(), // recurring sends always cover the last completed month
          username: job.created_by_username || 'schedule',
        });
        await Mail.sendStatementEmail({ to: contact.email, subject: job.subject, body: job.body, name: contact.name, attachments, from: senderEmail });
        const sentDesc = [job.send_portfolio && 'portfolio', job.send_statement && 'tx-statement'].filter(Boolean).join('+');
        const recipient = `${PDF.val(contact.name) || row.recipient_sid} (SID ${row.recipient_sid}, ${contact.email})`;
        await Auth.logEvent(job.created_by_user_id, job.created_by_username || 'schedule', 'email_pdf',
          `scheduled send-statement (${sentDesc}) to ${recipient}`);
      }
      await markQueueRow(row.id, 'sent');
      sent++;
    } catch (e) {
      await markQueueRow(row.id, 'failed', e.message);
      failed++;
    }
  }
  return { sent, failed };
}

// The entry point invoked by POST /api/cron/run-due-schedules. Two-phase per
// tick: (1) claim newly-due jobs by populating their queue and pushing
// next_run_at forward — done first and atomically-enough (see the
// conditional PATCH below) so a job is never enqueued twice even if two
// ticks overlap; (2) drain a bounded number of pending queue rows so
// existing large jobs make steady progress across ticks.
async function runDueJobs() {
  const nowIso = new Date().toISOString();
  const due = await rest(`/dashboard_scheduled_jobs?status=eq.active&next_run_at=lte.${nowIso}&select=*&order=next_run_at.asc&limit=${MAX_JOBS_ENQUEUED_PER_TICK}`);

  let enqueued = 0;
  for (const job of due) {
    const nextRun = computeNextRun(job, new Date());
    // Conditional claim: only proceed if next_run_at still matches what we
    // just read — if another concurrent tick already claimed it, this PATCH
    // affects zero rows and we skip, avoiding a double-enqueue.
    const claimed = await rest(
      `/dashboard_scheduled_jobs?id=eq.${job.id}&next_run_at=eq.${encodeURIComponent(job.next_run_at)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ next_run_at: nextRun.toISOString(), last_run_at: nowIso, run_count: (job.run_count || 0) + 1 }),
      },
    );
    if (!claimed || !claimed.length) continue;
    enqueued += await enqueueJob(job);
  }

  const activeJobs = await rest('/dashboard_scheduled_jobs?status=eq.active&select=*');
  let sent = 0, failed = 0;
  for (const job of activeJobs) {
    const r = await drainQueueForJob(job, DRAIN_LIMIT[job.kind] || 25);
    sent += r.sent; failed += r.failed;
  }

  return { jobsClaimed: due.length, recipientsEnqueued: enqueued, sent, failed };
}

module.exports = {
  computeNextRun,
  resolveRecipients,
  previewRecipientCount,
  requestOtp,
  confirmOtp,
  listJobs,
  setJobStatus,
  deleteJob,
  runDueJobs,
};
