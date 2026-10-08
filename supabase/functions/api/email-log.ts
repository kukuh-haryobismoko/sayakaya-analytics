// Ported 1:1 from server/email-log.js; see that file for the rationale
// (send log + SES events in Supabase Postgres via PostgREST, SNS webhook,
// the 30s grace before treating an event as mail this app didn't send).
// If you change this, change server/email-log.js too (or vice versa).

import crypto from 'node:crypto';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CATEGORIES = new Set(['statement', 'fund_performance', 'invite', 'password_reset', 'schedule_otp']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_ROW_GRACE_MS = 30 * 1000;

export interface EmailLogMeta {
  category?: string; source?: string; description?: string; sentBy?: string | null;
  userId?: string | null; sid?: string | null; jobId?: string | null; subject?: string;
}

// deno-lint-ignore no-explicit-any
async function rest(path: string, opts: RequestInit & { withTotal?: boolean } = {}): Promise<any> {
  const { withTotal, ...init } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase REST ${init.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  const data = text ? JSON.parse(text) : null;
  if (!withTotal) return data;
  return { rows: data, total: Number((res.headers.get('content-range') || '').split('/')[1]) || 0 };
}

export function sesMessageId(smtpResponse?: string): string | null {
  const m = /^250 Ok (\S+)/i.exec(smtpResponse || '');
  return m ? m[1] : null;
}

export function sesHeaders(logId: string, category?: string): Record<string, string> {
  const configSet = Deno.env.get('SES_CONFIGURATION_SET');
  if (!configSet) return {};
  return { 'X-SES-CONFIGURATION-SET': configSet, 'X-SES-MESSAGE-TAGS': `log_id=${logId}, category=${category}` };
}

export async function record({ id, message, log = {}, status, error, sesId }: {
  id: string;
  message: { to?: string; from?: string; subject?: string; attachments?: { filename?: string; cid?: string }[] };
  log?: EmailLogMeta; status: 'sent' | 'failed'; error?: string; sesId?: string | null;
}): Promise<void> {
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
    console.error('[email log]', (err as Error).message);
  }
}

// ---- SES events (via the SNS webhook) --------------------------------------
const EVENT_FIELD: Record<string, string> = {
  Send: 'send', Delivery: 'delivery', Open: 'open', Click: 'click', Bounce: 'bounce', Complaint: 'complaint',
  Reject: 'reject', DeliveryDelay: 'deliveryDelay', RenderingFailure: 'failure',
};

function linkWithoutQuery(link?: string): string | null {
  if (!link) return null;
  try { const u = new URL(link); return u.origin + u.pathname; } catch { return null; }
}

// deno-lint-ignore no-explicit-any
export function parseSesEvent(ev: any) {
  const type = ev && (ev.eventType || ev.notificationType);
  if (!EVENT_FIELD[type]) return null;
  const mail = ev.mail || {};
  const sub = ev[EVENT_FIELD[type]] || {};
  const tagId = mail.tags?.log_id?.[0];
  const tagCategory = mail.tags?.category?.[0];
  const detail = ({
    Bounce: { bounceType: sub.bounceType, bounceSubType: sub.bounceSubType, diagnostic: sub.bouncedRecipients?.[0]?.diagnosticCode },
    Complaint: { feedbackType: sub.complaintFeedbackType },
    Reject: { reason: sub.reason },
    DeliveryDelay: { delayType: sub.delayType },
    RenderingFailure: { error: sub.errorMessage },
    Delivery: { smtpResponse: sub.smtpResponse },
  } as Record<string, unknown>)[type] || null;
  const headers = mail.commonHeaders || {};
  return {
    type: type as string,
    sesId: (mail.messageId as string) || null,
    logId: UUID_RE.test(tagId || '') ? tagId as string : null,
    mail: {
      recipient: (mail.destination?.[0] as string) || null,
      subject: (headers.subject as string) || null,
      sender: (headers.from?.[0] as string) || mail.source || null,
      category: CATEGORIES.has(tagCategory) ? tagCategory as string : 'other',
      timestamp: (mail.timestamp as string) || null,
    },
    occurredAt: (sub.timestamp as string) || mail.timestamp || new Date().toISOString(),
    link: linkWithoutQuery(sub.link),
    userAgent: (sub.userAgent as string) || null,
    ip: (sub.ipAddress as string) || null,
    detail,
  };
}

class RetryLater extends Error {}

async function findOrCreateLogRow(p: NonNullable<ReturnType<typeof parseSesEvent>>): Promise<string | null> {
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

export async function handleSnsMessage(rawBody: string): Promise<{ status: number; body: Record<string, unknown> }> {
  // deno-lint-ignore no-explicit-any
  let msg: any;
  try { msg = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'Body is not JSON.' } }; }
  if (!msg || typeof msg !== 'object') return { status: 400, body: { error: 'Empty body.' } };

  if (msg.Type === 'SubscriptionConfirmation') {
    let url: URL;
    try { url = new URL(msg.SubscribeURL); } catch { return { status: 400, body: { error: 'Missing SubscribeURL.' } }; }
    if (url.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) {
      return { status: 400, body: { error: 'SubscribeURL is not an Amazon SNS address.' } };
    }
    const r = await fetch(url);
    await r.body?.cancel();
    return r.ok ? { status: 200, body: { ok: true, subscribed: true } } : { status: 502, body: { error: `SNS confirmation failed (${r.status}).` } };
  }
  if (msg.Type === 'UnsubscribeConfirmation') return { status: 200, body: { ok: true } };

  let ev = msg;
  if (msg.Type === 'Notification') {
    try { ev = JSON.parse(msg.Message); } catch { return { status: 200, body: { ok: true, ignored: 'non-JSON notification' } }; }
  }
  const p = parseSesEvent(ev);
  if (!p) return { status: 200, body: { ok: true, ignored: 'not an SES email event' } };

  let logId: string | null;
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

export function secretMatches(given: string | null | undefined, expected: string): boolean {
  const h = (s: string | null | undefined) => new Uint8Array(crypto.createHash('sha256').update(String(s || '')).digest());
  return crypto.timingSafeEqual(h(given), h(expected));
}

// ---- Reads for the Email recap tab ------------------------------------------
export function recap({ from, to, category, source }: { from: string; to: string; category?: string; source?: string }) {
  return rest('/rpc/dashboard_email_recap', {
    method: 'POST',
    body: JSON.stringify({ p_from: from, p_to: to, p_category: category || null, p_source: source || null }),
  });
}

const cleanSearch = (s?: string) => String(s || '').replace(/[,()"\\]/g, ' ').trim();

export function list({ from, to, category, source, outcome, search, limit, offset }: Record<string, string | undefined> = {}) {
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

export function events(logId: string) {
  if (!UUID_RE.test(logId || '')) throw new Error('Invalid email id.');
  return rest(`/dashboard_email_events?log_id=eq.${logId}&select=event_type,occurred_at,link,user_agent,ip,detail&order=occurred_at.asc`);
}
