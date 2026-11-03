// USD funds: revenue uses ONE rate (period end date), tx uses per-tx rate. SQL-shape check only; BigQuery dry-run is done by hand.
const assert = require('assert');
const Q = require('../server/queries.js');
const rev = Q.revenueTrend('2026-10-23', '2026-11-22', 'month').sql;
assert(rev.includes('rate_date <= LEAST(CAST(@to AS DATE)'), 'revenue uses the period-end rate');
assert(!rev.includes('fx.d = DATE_SUB'), 'revenue does not use a per-day rate');
assert(Q.overviewTx('2026-10-01', '2026-10-31').sql.includes('COALESCE(t.fx_rate, fx.rate)'), 'tx converted at its own rate');
console.log('fx smoke ok');
