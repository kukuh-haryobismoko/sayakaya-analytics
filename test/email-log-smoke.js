// SES webhook + email log checks, run with `npm test`.
// fetch is stubbed: nothing leaves the machine.
const assert = require('assert');

const calls = [];
let logRows = []; // what GET /dashboard_email_log returns
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  const body = String(url).includes('/dashboard_email_log?') && (opts.method || 'GET') === 'GET' ? logRows : [];
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
};
process.env.SUPABASE_URL = 'https://example.supabase.co';
const EL = require('../server/email-log');

(async () => {
  assert.strictEqual(EL.sesMessageId('250 Ok 0100019abc-def-000000'), '0100019abc-def-000000');
  assert.strictEqual(EL.sesMessageId('550 nope'), null);

  // No configuration set configured: no SES headers (naming one that doesn't exist makes SES reject the email).
  delete process.env.SES_CONFIGURATION_SET;
  assert.deepStrictEqual(EL.sesHeaders('id', 'statement'), {});
  process.env.SES_CONFIGURATION_SET = 'dashboard';
  assert.strictEqual(EL.sesHeaders('11111111-1111-4111-8111-111111111111', 'statement')['X-SES-MESSAGE-TAGS'],
    'log_id=11111111-1111-4111-8111-111111111111, category=statement');

  const logId = '22222222-2222-4222-8222-222222222222';
  const click = EL.parseSesEvent({
    eventType: 'Click',
    mail: { messageId: 'm1', timestamp: '2026-10-01T00:00:00Z', destination: ['a@b.c'], tags: { log_id: [logId], category: ['invite'] } },
    click: { timestamp: '2026-10-01T01:00:00Z', link: 'https://app.example/?reset=SECRET', userAgent: 'UA' },
  });
  assert.strictEqual(click.logId, logId);
  assert.strictEqual(click.link, 'https://app.example/', 'one-time token in the query string must not be stored');
  assert.strictEqual(click.occurredAt, '2026-10-01T01:00:00Z');
  const bounce = EL.parseSesEvent({ notificationType: 'Bounce', mail: { messageId: 'm2' }, bounce: { bounceType: 'Permanent', timestamp: 't' } });
  assert.strictEqual(bounce.detail.bounceType, 'Permanent');
  assert.strictEqual(EL.parseSesEvent({ eventType: 'Subscription', mail: {} }), null);

  assert.ok(EL.secretMatches('s3cret', 's3cret'));
  assert.ok(!EL.secretMatches('wrong', 's3cret'));
  assert.ok(!EL.secretMatches(undefined, 's3cret'));

  assert.strictEqual((await EL.handleSnsMessage('not json')).status, 400);
  const sub = await EL.handleSnsMessage(JSON.stringify({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://evil.example/confirm' }));
  assert.strictEqual(sub.status, 400, 'only Amazon SNS hosts may be fetched');

  // Tagged event whose log row exists: one event row written against it.
  logRows = [{ id: logId }];
  calls.length = 0;
  const ok = await EL.handleSnsMessage(JSON.stringify({ Type: 'Notification', MessageId: 'sns-1', Message: JSON.stringify({
    eventType: 'Open', mail: { messageId: 'm1', timestamp: '2026-10-01T00:00:00Z', tags: { log_id: [logId] } }, open: { timestamp: '2026-10-01T02:00:00Z' },
  }) }));
  assert.strictEqual(ok.status, 200);
  const insert = calls.find((c) => c.url.includes('/dashboard_email_events'));
  assert.deepStrictEqual([insert.body.log_id, insert.body.event_type, insert.body.sns_message_id], [logId, 'Open', 'sns-1']);

  // A brand-new message with no log row yet: answer 503 so SNS retries once
  // the sender has written its row, instead of filing it as foreign mail.
  logRows = [];
  const fresh = await EL.handleSnsMessage(JSON.stringify({
    eventType: 'Delivery', mail: { messageId: 'm9', timestamp: new Date().toISOString() }, delivery: { timestamp: new Date().toISOString() },
  }));
  assert.strictEqual(fresh.status, 503);

  console.log('email-log checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
