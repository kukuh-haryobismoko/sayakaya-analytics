// Schedule input validation and next-run hardening (loop / duplicate-send guards).
const assert = require('assert');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:0';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
const Sched = require('../server/schedules');

(async () => {
  const base = { confirmationEmail: 'a@b.co', frequency: 'monthly_day', dayOfMonth: 5, runTime: '08:00' };
  for (const bad of [
    { dayOfMonth: -5 }, { dayOfMonth: 0 }, { dayOfMonth: 32 }, { dayOfMonth: 1.5 },
    { frequency: 'hourly' }, { runTime: '25:00' }, { runTime: '8am' },
    { frequency: 'weekly', dayOfWeek: 9 },
    { recipientType: 'all_registered' }, { recipientType: 'all_aum' }, // groups turned off for now
  ]) {
    await assert.rejects(Sched.requestOtp({ ...base, ...bad }), /./, `rejects ${JSON.stringify(bad)}`);
  }

  // A bad stored day_of_month (pre-validation rows) must still land in the future, never in the past (that re-fires every tick).
  const from = new Date('2026-10-25T20:00:00Z');
  for (const dom of [-5, 0, 99, null]) {
    const n = Sched.computeNextRun({ frequency: 'monthly_day', day_of_month: dom, run_time: '08:00' }, from);
    assert.ok(n > from, `day_of_month ${dom}: next run is in the future`);
  }
  // 1st of month 08:00 WIB = 01:00Z
  assert.strictEqual(Sched.computeNextRun({ frequency: 'monthly_day', day_of_month: 1, run_time: '08:00' }, from).toISOString(), '2026-11-01T01:00:00.000Z');
  console.log('sched-validate ok');
})().catch((e) => { console.error(e); process.exit(1); });
