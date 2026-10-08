'use strict';

// Email recap: one log row per email this app sends, plus the events Amazon
// SES publishes back for it (delivery, open, click, bounce, complaint).
// Same store and access pattern as server/auth.js: Supabase Postgres over
// PostgREST with the service_role key. Tables, the per-email rollup view and
// the recap function live in
// supabase/migrations/20261008120000_dashboard_email_tracking.sql.
//
// SES only publishes events for mail sent through a configuration set with
// an SNS event destination; SUPABASE-DEPLOY.md "Email tracking" has the setup.
// Until then every send is still logged, just without delivery/open/click.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CATEGORIES = new Set(['statement', 'fund_performance', 'invite', 'password_reset', 'schedule_otp']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// SNS retries a failed HTTP delivery 3 times, 20s apart (its default policy).
// An event for a message sent in the last 30s whose log row isn't there yet
// is answered 503 so SNS redelivers it once record() below has written the row.
const LOG_ROW_GRACE_MS = 30 * 1000;

async function rest(path, { withTotal, ...opts } = {}) {
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
  const data = text ? JSON.parse(text) : null;
  if (!withTotal) return data;
  return { rows: data, total: Number((res.headers.get('content-range') || '').split('/')[1]) || 0 };
}

// SES answers an accepted SMTP send with "250 Ok <message-id>"; every SES
// event for that email carries the same id in mail.messageId.
function sesMessageId(smtpResponse) {
  const m = /^250 Ok (\S+)/i.exec(smtpResponse || '');
  return m ? m[1] : null;
}

// Headers that route a send through the SES configuration set and tag it
// with its log row id, so its events find the row without relying on the
// message id. Only sent when SES_CONFIGURATION_SET is set: naming a
// configuration set that doesn't exist makes SES reject the email outright.
function sesHeaders(logId, category) {
  const configSet = process.env.SES_CONFIGURATION_SET;
  if (!configSet) return {};
  return { 'X-SES-CONFIGURATION-SET': configSet, 'X-SES-MESSAGE-TAGS': `log_id=${logId}, category=${category}` };
}

// log: { category, source, description, sentBy, userId, sid, jobId }
async function record({ id, message, log = {}, status, error, sesId }) {
  try {
    await rest('/dashboard_email_log', {
      method: 'POST',
      body: JSON.stringify({
        id,
        ses_message_id: sesId || null,
        recipient: String(message.to || '(unknown)'),
        sender: message.from || null,
        subject: message.subject || null,
        category: log.category || 'other',
        source: log.source || 'manual',
        description: log.description || null,
        sent_by: log.sentBy || null,
        user_id: log.userId || null,
        sid: log.sid || null,
        job_id: log.jobId || null,
        attachments: (message.attachments || []).filter((a) => !a.cid).map((a) => a.filename),
        status,
        error: error || null,
      }),
    });
  } catch (err) {
    // Logging must never be able to break the send it's recording.
    console.error('[email log]', err.message);
  }
}

// ---- SES events (via the SNS webhook) --------------------------------------
const EVENT_FIELD = {
  Send: 'send', Delivery: 'delivery', Open: 'open', Click: 'click', Bounce: 'bounce', Complaint: 'complaint',
  Reject: 'reject', DeliveryDelay: 'deliveryDelay', RenderingFailure: 'failure',
};

// One SES event (event publishing's `eventType`, or the older identity
// notifications' `notificationType`) flattened into an events-table row.
// Returns null for types the recap doesn't use.
function parseSesEvent(ev) {
  const type = ev && (ev.eventType || ev.notificationType);
  if (!EVENT_FIELD[type]) return null;
  const mail = ev.mail || {};
  const sub = ev[EVENT_FIELD[type]] || {};
  const tagId = mail.tags && mail.tags.log_id && mail.tags.log_id[0];
  const tagCategory = mail.tags && mail.tags.category && mail.tags.category[0];
  const detail = {
    Bounce: { bounceType: sub.bounceType, bounceSubType: sub.bounceSubType, diagnostic: sub.bouncedRecipients && sub.bouncedRecipients[0] && sub.bouncedRecipients[0].diagnosticCode },
    Complaint: { feedbackType: sub.complaintFeedbackType },
    Reject: { reason: sub.reason },
    DeliveryDelay: { delayType: sub.delayType },
    RenderingFailure: { error: sub.errorMessage },
    Delivery: { smtpResponse: sub.smtpResponse },
  }[type] || null;
  const headers = mail.commonHeaders || {};
  return {
    type,
    sesId: mail.messageId || null,
    logId: UUID_RE.test(tagId || '') ? tagId : null,
    mail: {
      recipient: (mail.destination && mail.destination[0]) || null,
      subject: headers.subject || null,
      sender: (headers.from && headers.from[0]) || mail.source || null,
      category: CATEGORIES.has(tagCategory) ? tagCategory : 'other',
      timestamp: mail.timestamp || null,
    },
    occurredAt: sub.timestamp || mail.timestamp || new Date().toISOString(),
    link: linkWithoutQuery(sub.link),
    userAgent: sub.userAgent || null,
    ip: sub.ipAddress || null,
    detail,
  };
}

// Query strings are dropped before a clicked link is stored: a dashboard
// invite or password-reset URL carries its one-time token there, and the
// recap tab is readable by more people than the token's owner.
function linkWithoutQuery(link) {
  if (!link) return null;
  try { const u = new URL(link); return u.origin + u.pathname; } catch { return null; }
}

class RetryLater extends Error {}

async function findOrCreateLogRow(p) {
  if (p.logId) {
    const rows = await rest(`/dashboard_email_log?id=eq.${p.logId}&select=id`);
    if (rows.length) return rows[0].id;
  }
  if (!p.sesId) return null;
  const bySes = `/dashboard_email_log?ses_message_id=eq.${encodeURIComponent(p.sesId)}&select=id`;
  const found = await rest(bySes);
  if (found.length) return found[0].id;
  if (p.mail.timestamp && Date.now() - new Date(p.mail.timestamp).getTime() < LOG_ROW_GRACE_MS) throw new RetryLater('log row not written yet');
  // Mail this app didn't send itself: another sender on the same configuration set.
  await rest('/dashboard_email_log?on_conflict=ses_message_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({
      ses_message_id: p.sesId,
      recipient: p.mail.recipient || '(unknown)',
      sender: p.mail.sender,
      subject: p.mail.subject,
      category: p.mail.category,
      source: 'ses',
      status: 'sent',
      ...(p.mail.timestamp ? { created_at: p.mail.timestamp } : {}),
    }),
  });
  const rows = await rest(bySes);
  return rows.length ? rows[0].id : null;
}

// rawBody: the SNS POST body as text. SNS sends a SubscriptionConfirmation
// once, then a Notification per SES event; with "raw message delivery" on,
// the body is the SES event itself. Returns { status, body } for the route.
async function handleSnsMessage(rawBody) {
  let msg;
  try { msg = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody; } catch { return { status: 400, body: { error: 'Body is not JSON.' } }; }
  if (!msg || typeof msg !== 'object') return { status: 400, body: { error: 'Empty body.' } };

  if (msg.Type === 'SubscriptionConfirmation') {
    let url;
    try { url = new URL(msg.SubscribeURL); } catch { return { status: 400, body: { error: 'Missing SubscribeURL.' } }; }
    if (url.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) {
      return { status: 400, body: { error: 'SubscribeURL is not an Amazon SNS address.' } };
    }
    const r = await fetch(url);
    return r.ok ? { status: 200, body: { ok: true, subscribed: true } } : { status: 502, body: { error: `SNS confirmation failed (${r.status}).` } };
  }
  if (msg.Type === 'UnsubscribeConfirmation') return { status: 200, body: { ok: true } };

  let ev = msg;
  if (msg.Type === 'Notification') {
    try { ev = JSON.parse(msg.Message); } catch { return { status: 200, body: { ok: true, ignored: 'non-JSON notification' } }; }
  }
  const p = parseSesEvent(ev);
  if (!p) return { status: 200, body: { ok: true, ignored: 'not an SES email event' } };

  let logId;
  try { logId = await findOrCreateLogRow(p); } catch (e) {
    if (e instanceof RetryLater) return { status: 503, body: { error: 'Retry shortly.' } };
    throw e;
  }
  if (!logId) return { status: 200, body: { ok: true, ignored: 'no message id' } };

  await rest('/dashboard_email_events?on_conflict=sns_message_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({
      log_id: logId,
      sns_message_id: msg.Type === 'Notification' ? msg.MessageId || null : null,
      event_type: p.type,
      occurred_at: p.occurredAt,
      link: p.link,
      user_agent: p.userAgent,
      ip: p.ip,
      detail: p.detail,
    }),
  });
  return { status: 200, body: { ok: true } };
}

// Constant-time compare for the webhook's ?key= secret (hashing first makes
// both sides the same length, which timingSafeEqual requires).
function secretMatches(given, expected) {
  const h = (s) => crypto.createHash('sha256').update(String(s || '')).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

// ---- Reads for the Email recap tab ------------------------------------------
function recap({ from, to, category, source }) {
  return rest('/rpc/dashboard_email_recap', {
    method: 'POST',
    body: JSON.stringify({ p_from: from, p_to: to, p_category: category || null, p_source: source || null }),
  });
}

// PostgREST's or=() syntax uses , ( ) and " as delimiters; dropping them
// from the search box is simpler than quoting and loses nothing real.
const cleanSearch = (s) => String(s || '').replace(/[,()"\\]/g, ' ').trim();

// Days are Jakarta days, same convention as the Activity log (auth.js listAuditLog).
function list({ from, to, category, source, outcome, search, limit, offset } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const params = ['select=*', 'order=created_at.desc', `limit=${n}`, `offset=${Math.max(Number(offset) || 0, 0)}`];
  if (from) params.push(`created_at=gte.${encodeURIComponent(from + 'T00:00:00+07:00')}`);
  if (to) params.push(`created_at=lte.${encodeURIComponent(to + 'T23:59:59.999+07:00')}`);
  if (category) params.push(`category=eq.${encodeURIComponent(category)}`);
  if (source) params.push(`source=eq.${encodeURIComponent(source)}`);
  if (outcome) params.push(`outcome=eq.${encodeURIComponent(outcome)}`);
  const term = cleanSearch(search);
  if (term) {
    const t = encodeURIComponent(`*${term}*`);
    params.push(`or=(recipient.ilike.${t},subject.ilike.${t},description.ilike.${t},sid.ilike.${t},sent_by.ilike.${t})`);
  }
  return rest(`/dashboard_email_overview?${params.join('&')}`, { headers: { Prefer: 'count=exact' }, withTotal: true });
}

function events(logId) {
  if (!UUID_RE.test(logId || '')) throw new Error('Invalid email id.');
  return rest(`/dashboard_email_events?log_id=eq.${logId}&select=event_type,occurred_at,link,user_agent,ip,detail&order=occurred_at.asc`);
}

module.exports = {
  sesMessageId, sesHeaders, record, parseSesEvent, handleSnsMessage, secretMatches, recap, list, events,
};
