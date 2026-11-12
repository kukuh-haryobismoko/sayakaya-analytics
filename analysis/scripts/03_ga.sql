SELECT MIN(event_date) mn, MAX(event_date) mx, COUNT(*) n, COUNT(DISTINCT user_id) u FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX >= '20261101'
