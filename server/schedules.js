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
const { buildFundPerformancePdf, fundScopeLabel, statementDocsLabel, buildStatementAttachments, previousMonthYYYYMM, statementMonthRange } = require('./report-helpers');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes — same order as dashboard_password_resets
const JAKARTA_OFFSET_MIN = 7 * 60; // WIB, UTC+7, no DST — same convention as the rest of the dashboard
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function jktDateStr(d) { return new Date(d.getTime() + JAKARTA_OFFSET_MIN * 60000).toISOString().slice(0, 10); }

// Queue rows one runner claims per call (dashboard_claim_queue): a statement
// builds its own PDFs, fund performance shares one. Throughput comes from
// parallel runners (pg_cron, migration 20261013130000), not big chunks; kept
// the same as supabase/functions/api/schedules.ts.
const DRAIN_LIMIT = {
  statement: Number(process.env.SCHEDULE_DRAIN_LIMIT_STATEMENT) || 10,
  fund_performance: Number(process.env.SCHEDULE_DRAIN_LIMIT_FUND_PERFORMANCE) || 50,
};
// Emails in flight at once per runner, to stay near the SES send rate.
const SEND_CONCURRENCY = Number(process.env.SCHEDULE_SEND_CONCURRENCY) || 5;
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

  if (job.frequency === 'once') return from; // a group send from Batch send: due now

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
  const pool = new Map([['all_aum', Q.allInvestorsWithAum], ['active_aum', Q.allActiveFundInvestors], ['all_registered', Q.allRegisteredUsersWithEmail]]).get(recipientType);
  if (pool) {
    const q = pool();
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

// ---- Exclusion (opt-out) list -----------------------------------------------
// dashboard_send_exclusions (migration 20261013160000): skipped by schedules,
// group sends and batch sends. An entry matches on what was typed and on the
// SID / email BigQuery returned for it, so one added by SID also catches that
// investor's email on a fund performance list. All lowercased.
function listExclusions() {
  return rest('/dashboard_send_exclusions?select=*&order=created_at.desc');
}

// Every excluded email/SID that applies to sends of this kind.
async function exclusionSet(kind) {
  const scope = kind === 'fund_performance' ? 'fund_performance' : 'statement';
  const rows = await rest(`/dashboard_send_exclusions?scope=in.(all,${scope})&select=identifier,sid,email`);
  const set = new Set();
  for (const r of rows) for (const v of [r.identifier, r.sid, r.email]) if (v) set.add(v.toLowerCase());
  return set;
}

function isExcluded(set, r) {
  return set.has(String(r.email || '').toLowerCase()) || set.has(String(r.sid || '').toLowerCase());
}

// What to store for each typed email/SID: the investor BigQuery finds for it,
// or the bare email for someone who is not an investor. A SID nobody has is
// returned in `invalid` instead.
async function exclusionEntries(identifiers) {
  const ids = [...new Set(identifiers.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))];
  const u = Q.usersByIdentifiers(ids);
  const users = ids.length ? await runQuery(u.sql, u.params, { redact: false }) : [];
  const c = Q.userContactBatch(users.map((x) => x.user_id));
  const contacts = users.length ? await runQuery(c.sql, c.params, { redact: false }) : [];
  const nameOf = new Map(contacts.map((r) => [r.user_id, PDF.val(r.name)]));
  const entries = [];
  const invalid = [];
  for (const id of ids) {
    const m = users.find((x) => String(PDF.val(x.sid) || '').toLowerCase() === id || String(PDF.val(x.email) || '').toLowerCase() === id);
    if (m) {
      const email = PDF.val(m.email);
      entries.push({ identifier: id, sid: PDF.val(m.sid) || null, email: email ? String(email).toLowerCase() : null, name: nameOf.get(m.user_id) || null });
    } else if (EMAIL_RE.test(id)) entries.push({ identifier: id, sid: null, email: id, name: null });
    else invalid.push(id);
  }
  return { entries, invalid };
}

function addExclusions(entries, scope, reason, username) {
  // Adding someone again updates their scope and reason instead of failing.
  return rest('/dashboard_send_exclusions?on_conflict=identifier', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(entries.map((e) => ({ ...e, scope, reason, created_by_username: username }))),
  });
}

async function removeExclusion(id) {
  const rows = await rest(`/dashboard_send_exclusions?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  return (rows && rows[0]) || null;
}

// Recipients minus the exclusion list for this kind; `excluded` = how many it dropped.
async function resolveSendable(spec) {
  const [all, ex] = await Promise.all([resolveRecipients(spec), exclusionSet(spec.kind)]);
  const recipients = all.filter((r) => !isExcluded(ex, r));
  return { recipients, excluded: all.length - recipients.length };
}

async function previewRecipientCount(spec) {
  const { recipients, excluded } = await resolveSendable(spec);
  return { count: recipients.length, excluded };
}

// ---- OTP-gated schedule creation --------------------------------------------
// payload: { kind, recipientType, recipientEmail, recipientList, sendPortfolio,
//   sendStatement, fundFilter, subject, body, frequency, dayOfWeek, dayOfMonth,
//   runTime, confirmationEmail, userId, username }
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
  await Mail.sendScheduleOtpEmail({ to: payload.confirmationEmail, code, kind: payload.kind, sentBy: payload.username });
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
  const nextRun = computeNextRun(seed, new Date());
  // If the first computed occurrence already falls after end_date, the
  // schedule would never send anything — create it already ended instead of
  // showing an Active row with a phantom Next run past its own Ends date.
  const alreadyEnded = p.endDate && jktDateStr(nextRun) > p.endDate;
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
      fund_filter: p.fundFilter || null, // kind = 'fund_performance'; null = all funds
      statement_month: p.statementMonth || null, // 'once' sends; null = previous month
      nav_as_of: p.navAsOf || null,              // 'once' sends; null = latest NAV
      subject: p.subject || null,
      body: p.body || null,
      frequency: p.frequency,
      day_of_week: p.dayOfWeek ?? null,
      day_of_month: p.dayOfMonth ?? null,
      run_time: p.runTime || '08:00',
      end_date: p.endDate || null,
      status: alreadyEnded ? 'ended' : 'active',
      next_run_at: alreadyEnded ? null : nextRun.toISOString(),
      created_by_user_id: p.userId || null,
      created_by_username: p.username || null,
      confirmation_email: p.confirmationEmail,
    }),
  });
  await rest(`/dashboard_schedule_otps?id=eq.${otpId}`, { method: 'DELETE' });
  return job;
}

// ---- CRUD used by the UI ----------------------------------------------------
// Each job carries its email counts (sent / waiting / failed) for the table.
async function listJobs(kind) {
  const jobs = await rest(`/dashboard_scheduled_jobs?kind=eq.${kind}&select=*&order=created_at.desc`);
  if (!jobs.length) return jobs;
  const progress = await rest(`/dashboard_schedule_progress?job_id=in.(${jobs.map((j) => j.id).join(',')})&select=*`);
  const byJob = new Map(progress.map((p) => [p.job_id, p]));
  return jobs.map((j) => ({ ...j, progress: byJob.get(j.id) || null }));
}

async function getJob(id) {
  const rows = await rest(`/dashboard_scheduled_jobs?id=eq.${id}&select=*`);
  return rows[0] || null;
}

// Every (job, recipient) row ever queued for this job, most recent first —
// the per-recipient breakdown behind the schedule detail view.
function listQueue(jobId) {
  return rest(`/dashboard_schedule_queue?job_id=eq.${jobId}&select=*&order=created_at.desc`);
}

// Resume = paused -> active, then run this one job's tick right away instead
// of waiting for the next cron ping (GitHub's schedule fires hours apart). A
// run missed while paused goes out once now, and next_run_at moves to the next
// future occurrence (or the job ends, if that falls past its end date). Only
// paused jobs flip: an ended job has no next run left to resume.
async function resumeJob(id) {
  const resumed = await rest(`/dashboard_scheduled_jobs?id=eq.${id}&status=eq.paused`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'active' }),
  });
  if (resumed.length) await runDueJobs(id);
  return getJob(id);
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
  const { recipients } = await resolveSendable({
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
// Runs fn over items with at most `limit` in flight.
async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// SES rejects a burst over the account's send rate (or past its daily quota)
// with a throttling error; those rows go back to the queue, nothing was sent.
const THROTTLED_RE = /throttl|rate exceeded|quota exceeded|\b454\b/i;

// Groups BigQuery rows by user_id.
function byUser(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.user_id)) m.set(r.user_id, []);
    m.get(r.user_id).push(r);
  }
  return m;
}

// One runner's share of the queue: claims a chunk of one job's rows
// (dashboard_claim_queue, so parallel runners never get the same row),
// fetches what the chunk needs in one go, then sends SEND_CONCURRENCY at a time.
async function drainChunk() {
  let rows = await rest('/rpc/dashboard_claim_queue', {
    method: 'POST',
    body: JSON.stringify({ p_statement_limit: DRAIN_LIMIT.statement, p_fund_limit: DRAIN_LIMIT.fund_performance }),
  });
  if (!rows || !rows.length) return { sent: 0, failed: 0 };
  const job = await getJob(rows[0].job_id);
  if (!job) return { sent: 0, failed: 0 }; // deleted meanwhile; its queue rows went with it

  // Excluded after these rows were queued (a long group send): skip, don't send.
  const ex = await exclusionSet(job.kind);
  const skipped = rows.filter((r) => isExcluded(ex, { email: r.recipient_email, sid: r.recipient_sid }));
  await Promise.all(skipped.map((r) => markQueueRow(r.id, 'skipped', 'On the exclusion list')));
  rows = rows.filter((r) => !skipped.includes(r));
  if (!rows.length) return { sent: 0, failed: 0 };

  const sentBy = job.created_by_username || 'schedule';
  const source = job.frequency === 'once' ? 'batch' : 'schedule';
  const label = job.frequency === 'once' ? 'Group send' : `Scheduled ${job.frequency}`;
  const senderEmail = job.kind === 'statement'
    ? (process.env.SMTP_FROM_STATEMENT || 'estatement@sayakaya.id')
    : (process.env.SMTP_FROM_FUND_PERFORMANCE || 'hi@sayakaya.id');

  let send;
  try {
    if (job.kind === 'fund_performance') {
      const asOf = job.nav_as_of || undefined;
      const pdf = await buildFundPerformancePdf({ asOf, fundFilter: job.fund_filter, username: sentBy });
      send = async (row) => {
        await Mail.sendStatementEmail({
          to: row.recipient_email, subject: job.subject, body: job.body,
          attachments: [{ filename: `Reksa_Dana_Update${asOf ? `_${asOf}` : ''}.pdf`, content: pdf }],
          from: senderEmail,
          log: {
            category: 'fund_performance', source, sentBy: job.created_by_username, jobId: job.id,
            description: `${label} Reksa Dana Update PDF${asOf ? ` as of ${asOf}` : ''} (${fundScopeLabel(job.fund_filter)})`,
          },
        });
        await Auth.logEvent(job.created_by_user_id, sentBy, 'email_fund_performance',
          `${label.toLowerCase()} fund-performance (${fundScopeLabel(job.fund_filter)}) to ${row.recipient_email}`);
      };
    } else {
      const statementMonth = job.statement_month || previousMonthYYYYMM(); // recurring sends cover the last completed month
      const { from, to } = statementMonthRange(statementMonth);
      const ids = rows.map((r) => r.recipient_user_id);
      const c = Q.userContactBatch(ids);
      const h = Q.userHoldingsBatch(ids);
      const t = Q.userTransactionsBatch(ids, from, to);
      const [contacts, holdings, transactions] = await Promise.all([
        runQuery(c.sql, c.params, { redact: false }),
        job.send_portfolio ? runQuery(h.sql, h.params) : [],
        job.send_statement ? runQuery(t.sql, t.params) : [],
      ]);
      const contactOf = new Map(contacts.map((r) => [r.user_id, r]));
      const holdingsOf = byUser(holdings);
      const txOf = byUser(transactions);
      const docs = statementDocsLabel({ sendPortfolio: job.send_portfolio, sendStatement: job.send_statement, statementMonth });
      const sentDesc = [job.send_portfolio && 'portfolio', job.send_statement && 'tx-statement'].filter(Boolean).join('+');
      send = async (row) => {
        const userId = row.recipient_user_id;
        const contact = contactOf.get(userId);
        if (!contact || !contact.email) throw new Error('no email on file');
        const attachments = await buildStatementAttachments({
          userId, sid: row.recipient_sid, contact,
          sendPortfolio: job.send_portfolio, sendStatement: job.send_statement, statementMonth,
          holdings: holdingsOf.get(userId) || [], transactions: txOf.get(userId) || [],
          username: sentBy,
        });
        const name = PDF.val(contact.name) || row.recipient_sid;
        await Mail.sendStatementEmail({
          to: contact.email, subject: job.subject, body: job.body, name: contact.name, attachments, from: senderEmail,
          log: {
            category: 'statement', source, sentBy: job.created_by_username, jobId: job.id,
            userId, sid: row.recipient_sid, description: `${label} ${docs} for ${name}`,
          },
        });
        await Auth.logEvent(job.created_by_user_id, sentBy, 'email_pdf',
          `${label.toLowerCase()} send-statement (${sentDesc}) to ${name} (SID ${row.recipient_sid}, ${contact.email})`);
      };
    }
  } catch (e) {
    // Nothing went out: the chunk's shared data (PDF, BigQuery rows) failed.
    await Promise.all(rows.map((row) => markQueueRow(row.id, 'failed', e.message)));
    return { sent: 0, failed: rows.length };
  }

  let sent = 0, failed = 0;
  await mapLimit(rows, SEND_CONCURRENCY, async (row) => {
    try {
      await send(row);
      await markQueueRow(row.id, 'sent');
      sent++;
    } catch (e) {
      if (THROTTLED_RE.test(e.message)) {
        await markQueueRow(row.id, 'pending');
      } else {
        await markQueueRow(row.id, 'failed', e.message);
        failed++;
      }
    }
  });
  return { sent, failed };
}

// tick: (1) claim newly-due jobs by populating their queue and pushing
// next_run_at forward — done first and atomically-enough (see the
// conditional PATCH below) so a job is never enqueued twice even if two
// ticks overlap; (2) send one claimed chunk of the queue (drainChunk).
// jobId (optional): limit the tick to one job — used by resumeJob().
async function runDueJobs(jobId) {
  const nowIso = new Date().toISOString();
  const only = jobId ? `&id=eq.${jobId}` : '';
  const due = await rest(`/dashboard_scheduled_jobs?status=eq.active&next_run_at=lte.${nowIso}${only}&select=*&order=next_run_at.asc&limit=${MAX_JOBS_ENQUEUED_PER_TICK}`);

  let enqueued = 0;
  for (const job of due) {
    // end_date is inclusive — a due occurrence dated after it (WIB) means the
    // schedule has run its course; stop it instead of enqueueing/re-arming.
    if (job.end_date && jktDateStr(new Date(job.next_run_at)) > job.end_date) {
      await rest(`/dashboard_scheduled_jobs?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended' }) });
      continue;
    }
    const nextRun = computeNextRun(job, new Date());
    // Today's occurrence is due and within end_date, so it still runs — but
    // if the *next* occurrence would fall after end_date, this is the last
    // run: end the job now instead of advancing next_run_at into the future,
    // so the table doesn't show a "Next run" for a schedule that's done.
    const isLastRun = job.frequency === 'once' || (job.end_date && jktDateStr(nextRun) > job.end_date);
    // Conditional claim: only proceed if next_run_at still matches what we
    // just read — if another concurrent tick already claimed it, this PATCH
    // affects zero rows and we skip, avoiding a double-enqueue.
    const claimed = await rest(
      `/dashboard_scheduled_jobs?id=eq.${job.id}&next_run_at=eq.${encodeURIComponent(job.next_run_at)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          next_run_at: isLastRun ? null : nextRun.toISOString(),
          last_run_at: nowIso,
          run_count: (job.run_count || 0) + 1,
          ...(isLastRun ? { status: 'ended' } : {}),
        }),
      },
    );
    if (!claimed || !claimed.length) continue;
    enqueued += await enqueueJob(job);
  }

  // Ended jobs still drain (a job's last run flips it to ended at claim time,
  // above); paused jobs wait (dashboard_claim_queue skips them).
  const { sent, failed } = await drainChunk();
  return { jobsClaimed: due.length, recipientsEnqueued: enqueued, sent, failed };
}

module.exports = {
  computeNextRun,
  resolveRecipients,
  resolveSendable,
  previewRecipientCount,
  listExclusions,
  exclusionSet,
  isExcluded,
  exclusionEntries,
  addExclusions,
  removeExclusion,
  requestOtp,
  confirmOtp,
  listJobs,
  getJob,
  listQueue,
  setJobStatus,
  resumeJob,
  deleteJob,
  runDueJobs,
};
