SELECT event_name, COUNT(*) n, COUNT(DISTINCT user_id) users, COUNT(DISTINCT user_pseudo_id) devices, MIN(event_date) mn, MAX(event_date) mx
FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX >= '20261001' AND _TABLE_SUFFIX < '20261109' AND event_date >= '20261001'
GROUP BY 1 ORDER BY n DESC LIMIT 80
