-- Q:decisions_by_month
WITH {{BASE}} SELECT FORMAT_DATE('%Y-%m',DATE(l.created_at,'Asia/Jakarta')) m, l.status, COUNT(*) n, COUNT(DISTINCT l.user_id) u FROM `sayakaya.main.user_status_logs` l JOIN U ON U.id=l.user_id WHERE l.origin_status='pending_verification' GROUP BY 1,2 ORDER BY 1,2
-- Q:decision_dow_hour
WITH {{BASE}} SELECT FORMAT_DATE('%a',DATE(l.created_at,'Asia/Jakarta')) dow, EXTRACT(DAYOFWEEK FROM DATE(l.created_at,'Asia/Jakarta')) dn, COUNT(*) n, COUNTIF(l.status='failed') failed FROM `sayakaya.main.user_status_logs` l JOIN U ON U.id=l.user_id WHERE l.origin_status='pending_verification' GROUP BY 1,2 ORDER BY 2
-- Q:decision_hour
WITH {{BASE}} SELECT EXTRACT(HOUR FROM DATETIME(l.created_at,'Asia/Jakarta')) h, COUNT(*) n FROM `sayakaya.main.user_status_logs` l JOIN U ON U.id=l.user_id WHERE l.origin_status='pending_verification' GROUP BY 1 ORDER BY 1
-- Q:sla_ga_submit_to_decision
WITH {{BASE}}, S AS (SELECT user_id, MIN(TIMESTAMP_MICROS(event_timestamp)) s FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='kyc_success' AND user_id IS NOT NULL GROUP BY 1),
D AS (SELECT l.user_id, l.status, MIN(l.created_at) dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' GROUP BY 1,2),
J AS (SELECT D.status, TIMESTAMP_DIFF(D.dt,S.s,MINUTE)/60.0 h, EXTRACT(DAYOFWEEK FROM DATE(S.s,'Asia/Jakarta')) dow FROM S JOIN D USING(user_id) JOIN U ON U.id=S.user_id WHERE D.dt>=S.s)
SELECT status, COUNT(*) n, ROUND(APPROX_QUANTILES(h,100)[OFFSET(50)],2) p50_h, ROUND(APPROX_QUANTILES(h,100)[OFFSET(90)],2) p90_h, COUNTIF(h>24) over24h, COUNTIF(h>72) over72h FROM J GROUP BY 1
-- Q:sla_by_submit_weekend
WITH {{BASE}}, S AS (SELECT user_id, MIN(TIMESTAMP_MICROS(event_timestamp)) s FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='kyc_success' AND user_id IS NOT NULL GROUP BY 1),
D AS (SELECT l.user_id, MIN(l.created_at) dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' GROUP BY 1),
J AS (SELECT TIMESTAMP_DIFF(D.dt,S.s,MINUTE)/60.0 h, EXTRACT(DAYOFWEEK FROM DATE(S.s,'Asia/Jakarta')) dow FROM S JOIN D USING(user_id) JOIN U ON U.id=S.user_id WHERE D.dt>=S.s)
SELECT dow IN (1,7) weekend_submit, COUNT(*) n, ROUND(APPROX_QUANTILES(h,100)[OFFSET(50)],2) p50_h, ROUND(APPROX_QUANTILES(h,100)[OFFSET(90)],2) p90_h FROM J GROUP BY 1
-- Q:resubmit_after_fail
WITH {{BASE}}, F AS (SELECT l.user_id, MIN(l.created_at) ft FROM `sayakaya.main.user_status_logs` l JOIN U ON U.id=l.user_id WHERE l.status='failed' GROUP BY 1),
S AS (SELECT user_id, TIMESTAMP_MICROS(event_timestamp) s FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='kyc_success' AND user_id IS NOT NULL),
O AS (SELECT F.user_id, MAX(U.verification_status) st, COUNTIF(S.s>F.ft) resub FROM F JOIN U ON U.id=F.user_id LEFT JOIN S ON S.user_id=F.user_id GROUP BY 1)
SELECT st, COUNT(*) failed_users, COUNTIF(resub>0) resubmitted FROM O GROUP BY 1
-- Q:wait_vs_buy
WITH {{BASE}}, D AS (SELECT l.user_id, MIN(l.created_at) dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' AND l.status='verified' GROUP BY 1),
S AS (SELECT user_id, MIN(TIMESTAMP_MICROS(event_timestamp)) s FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name='kyc_success' AND user_id IS NOT NULL GROUP BY 1),
J AS (SELECT S.user_id, D.dt, TIMESTAMP_DIFF(D.dt,S.s,MINUTE)/60.0 h FROM S JOIN D USING(user_id) JOIN U ON U.id=S.user_id WHERE D.dt>=S.s AND D.dt<=TIMESTAMP '2026-10-25'),
X AS (SELECT J.*, (SELECT MIN(t.created_at) FROM `sayakaya.main.transactions` t WHERE t.user_id=J.user_id AND t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') AND t.created_at>=J.dt) bt FROM J)
SELECT CASE WHEN h<2 THEN 'a<2h' WHEN h<24 THEN 'b2-24h' ELSE 'c>=24h' END wait, COUNT(*) n, COUNTIF(bt<=TIMESTAMP_ADD(dt,INTERVAL 14 DAY)) bought14d FROM X GROUP BY 1 ORDER BY 1
