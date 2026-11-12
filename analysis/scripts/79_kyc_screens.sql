-- Q:kyc_screen_view
WITH {{BASE}} SELECT (SELECT value.string_value FROM UNNEST(event_params) WHERE key='firebase_screen') scr, COUNT(DISTINCT e.user_id) users, COUNT(*) n FROM `sayakaya.analytics_266759216.events_*` e JOIN U ON U.id=e.user_id WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='screen_view' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key='firebase_screen') LIKE '%Verification%' GROUP BY 1 ORDER BY 2 DESC
-- Q:kyc_screen_view_all
WITH {{BASE}} SELECT (SELECT value.string_value FROM UNNEST(event_params) WHERE key='firebase_screen') scr, COUNT(DISTINCT e.user_id) users FROM `sayakaya.analytics_266759216.events_*` e JOIN U ON U.id=e.user_id WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='screen_view' AND REGEXP_CONTAINS((SELECT value.string_value FROM UNNEST(event_params) WHERE key='firebase_screen'), r'(?i)selfie|identity|signature|occupation|bank|address|profile|ktp|camera|liveness|intro|success|rejected') GROUP BY 1 ORDER BY 2 DESC LIMIT 25
-- Q:wait_buckets
WITH {{BASE}}, S AS (SELECT user_id, MIN(TIMESTAMP_MICROS(event_timestamp)) s FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='kyc_success' AND user_id IS NOT NULL GROUP BY 1),
D AS (SELECT l.user_id, MIN(l.created_at) dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' GROUP BY 1),
J AS (SELECT TIMESTAMP_DIFF(D.dt,S.s,MINUTE)/60.0 h, EXTRACT(DAYOFWEEK FROM DATE(S.s,'Asia/Jakarta')) dow, EXTRACT(HOUR FROM DATETIME(S.s,'Asia/Jakarta')) hr FROM S JOIN D USING(user_id) JOIN U ON U.id=S.user_id WHERE D.dt>=S.s)
SELECT dow IN (1,7) weekend, COUNT(*) n, COUNTIF(h>4) over4h, COUNTIF(h>24) over24h FROM J GROUP BY 1
-- Q:wait_night
WITH {{BASE}}, S AS (SELECT user_id, MIN(TIMESTAMP_MICROS(event_timestamp)) s FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='kyc_success' AND user_id IS NOT NULL GROUP BY 1),
D AS (SELECT l.user_id, MIN(l.created_at) dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' GROUP BY 1),
J AS (SELECT TIMESTAMP_DIFF(D.dt,S.s,MINUTE)/60.0 h, EXTRACT(HOUR FROM DATETIME(S.s,'Asia/Jakarta')) hr FROM S JOIN D USING(user_id) JOIN U ON U.id=S.user_id WHERE D.dt>=S.s)
SELECT hr BETWEEN 9 AND 20 AS office_submit, COUNT(*) n, COUNTIF(h>4) over4h, COUNTIF(h>12) over12h FROM J GROUP BY 1
