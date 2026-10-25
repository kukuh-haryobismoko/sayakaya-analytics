// Queue drain (drainChunk in server/schedules.js, mirrored in
// supabase/functions/api/schedules.ts), run with `node test/sched-drain-smoke.js`.
// One claimed chunk of 4 statement rows: BigQuery is asked 3 times for the
// whole chunk (not 3 times per investor), a throttled email goes back to
// 'pending', an investor without an email fails, one put on the exclusion list
// after being queued is skipped, the rest are sent. The preview count leaves
// excluded people out, and the 'active_aum_verified' pool reads only
// KYC-verified accounts.
const assert = require('assert');
const path = require('path');

process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, '../server', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const queries = [];
stub('bigquery', {
  runQuery: async (sql, params) => {
    queries.push(sql);
    if (sql.includes("u.verification_status = 'verified'")) {
      return [{ user_id: 'v1', sid: 'SIDV1', email: 'v1@example.com' }, { user_id: 'v4', sid: 'SID4', email: 'v4@example.com' }];
    }
    if (sql.includes('up.birthdate')) {
      return [
        { user_id: 'u1', sid: 'SID1', email: 'one@example.com', name: 'One', birthdate: { value: '1990-08-17' } },
        { user_id: 'u2', sid: 'SID2', email: 'two@example.com', name: 'Two', birthdate: { value: '1991-01-02' } },
      ];
    }
    if (sql.includes('avg_buy_price')) return params.userIds.map((id) => ({ user_id: id, fund: `Fund of ${id}`, fund_type: 'MONEY_MARKET', unit: 1, avg_buy_price: 1000, nav: 1100, nav_date: '2026-10-12', fund_value: 1000, value: 1100, gain_loss: 100, gain_pct: 10 }));
    return [{ user_id: 'u1', created_at: { value: '2026-09-02T01:00:00Z' }, type: 'buy', status: 'completed', fund: 'Fund of u1', unit: 1, amount: 1000, final_amount: 1000 }];
  },
});
const mails = [];
stub('mail', {
  sendStatementEmail: async (m) => {
    if (m.to === 'two@example.com') throw new Error('454 Throttling failure: Maximum sending rate exceeded.');
    mails.push(m);
  },
});
stub('auth', { logEvent: async () => {} });

const job = {
  id: 'job1', kind: 'statement', frequency: 'once', send_portfolio: true, send_statement: true,
  statement_month: '2026-09', subject: 'S', body: 'B', created_by_username: 'kukuh', created_by_user_id: null,
};
const marks = {};
global.fetch = async (url, opts = {}) => {
  const u = String(url).replace('http://supabase.test/rest/v1', '');
  let body = [];
  if (u.startsWith('/dashboard_scheduled_jobs?status=eq.active')) body = [];
  else if (u.startsWith('/rpc/dashboard_claim_queue')) {
    body = ['u1', 'u2', 'u3', 'u4'].map((id, i) => ({ id: `q${i + 1}`, job_id: 'job1', recipient_user_id: id, recipient_sid: `SID${i + 1}`, recipient_email: `${id}@example.com` }));
  } else if (u.startsWith('/dashboard_send_exclusions?scope=in.(all,')) {
    body = [{ identifier: 'sid4', sid: 'SID4', email: null }, { identifier: 'out@example.com', sid: null, email: 'out@example.com' }];
  } else if (u.startsWith('/dashboard_scheduled_jobs?id=eq.job1')) body = [job];
  else if (u.startsWith('/dashboard_schedule_queue?id=eq.')) {
    const { status, error } = JSON.parse(opts.body);
    marks[u.split('eq.')[1]] = error ? `${status}: ${error}` : status;
    body = null;
  } else throw new Error(`unexpected request ${opts.method || 'GET'} ${u}`);
  return { ok: true, status: 200, text: async () => (body === null ? '' : JSON.stringify(body)) };
};

const Sched = require('../server/schedules');
(async () => {
  const r = await Sched.runDueJobs();
  assert.strictEqual(queries.length, 3, 'contacts, holdings, transactions: one query each for the chunk');
  assert.deepStrictEqual(marks, { q1: 'sent', q2: 'pending', q3: 'failed: no email on file', q4: 'skipped: On the exclusion list' });
  assert.deepStrictEqual({ sent: r.sent, failed: r.failed }, { sent: 1, failed: 1 });
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(mails[0].attachments.length, 2, 'portfolio + e-statement');
  assert.strictEqual(mails[0].attachments[1].filename, 'Transaction_Statement_SID1_2026-09.pdf', "the job's month, not last month");
  assert.strictEqual(mails[0].log.source, 'batch', 'a group send logs as a batch send');
  await assert.rejects(
    require('../server/report-helpers').buildStatementAttachments({ userId: 'u9', sid: 'SID9', contact: { birthdate: null }, sendPortfolio: true, sendStatement: false }),
    /no birthdate on file/, 'no birthdate, no unprotected PDF',
  );
  const preview = await Sched.previewRecipientCount({ kind: 'fund_performance', recipientType: 'csv_list', recipientList: ['in@example.com', 'OUT@example.com'] });
  assert.deepStrictEqual(preview, { count: 1, excluded: 1 }, 'excluded emails match case-insensitively');
  const verified = await Sched.previewRecipientCount({ kind: 'statement', recipientType: 'active_aum_verified' });
  assert.ok(queries[queries.length - 1].includes('a.aum > 0'), 'the verified pool starts from the active-fund holders');
  assert.deepStrictEqual(verified, { count: 1, excluded: 1 }, 'verified pool, minus the excluded SID4');
  console.log('sched-drain smoke test passed');
})().catch((e) => { console.error(e); process.exit(1); });
