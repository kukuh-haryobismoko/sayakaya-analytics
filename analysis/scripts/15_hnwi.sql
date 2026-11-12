-- Q:hnwi_counts
WITH d AS (SELECT sid_code, SUM(amount) aum FROM `sayakaya.mi_fee_logs.portfolio_with_code` WHERE DATE(created_at)='2026-11-09' AND amount>0 GROUP BY 1),
u AS (SELECT sid_code, MAX(IF(UPPER(TRIM(IFNULL(referrer_code,''))) IN ('RAIZ','RAIZKAYA'),1,0)) raiz, MAX(IF(is_institution,1,0)) inst FROM `sayakaya.main.users` WHERE sid_code IS NOT NULL GROUP BY 1)
SELECT COUNT(*) holders, COUNTIF(aum>=500000000) hnwi_all, COUNTIF(aum>=500000000 AND raiz=1) hnwi_raiz, COUNTIF(aum>=500000000 AND raiz=0) hnwi_non_raiz,
 COUNTIF(aum>=500000000 AND inst=1) hnwi_inst, COUNTIF(raiz=0) holders_non_raiz, COUNTIF(u.sid_code IS NULL) sid_not_in_users
FROM d LEFT JOIN u USING(sid_code)
-- Q:hnwi_dist
WITH d AS (SELECT sid_code, SUM(amount) aum FROM `sayakaya.mi_fee_logs.portfolio_with_code` WHERE DATE(created_at)='2026-11-09' AND amount>0 GROUP BY 1)
SELECT CASE WHEN aum<1e6 THEN '<1jt' WHEN aum<1e7 THEN '1-10jt' WHEN aum<1e8 THEN '10-100jt' WHEN aum<5e8 THEN '100-500jt' WHEN aum<1e9 THEN '500jt-1M' ELSE '>=1M' END b, COUNT(*) n FROM d GROUP BY 1 ORDER BY 1
-- Q:snapshot_check
SELECT DATE(created_at) d, COUNT(*) n FROM `sayakaya.mi_fee_logs.portfolio_with_code` WHERE DATE(created_at)>='2026-11-06' GROUP BY 1 ORDER BY 1
-- Q:ga_tz
SELECT event_date, MIN(TIMESTAMP_MICROS(event_timestamp)) mn_ts, MAX(TIMESTAMP_MICROS(event_timestamp)) mx_ts, COUNT(*) n
FROM `sayakaya.analytics_266759216.events_20261105` GROUP BY 1
-- Q:ga_tz_offset
SELECT event_date, FORMAT_TIMESTAMP('%H', TIMESTAMP_MICROS(event_timestamp),'Asia/Jakarta') h_wib, COUNT(*) n FROM `sayakaya.analytics_266759216.events_20261105` GROUP BY 1,2 ORDER BY 2
-- Q:ga_user_id_map
SELECT COUNT(DISTINCT e.user_id) ga_users, COUNT(DISTINCT u.id) matched
FROM `sayakaya.analytics_266759216.events_*` e LEFT JOIN `sayakaya.main.users` u ON u.id=e.user_id
WHERE e._TABLE_SUFFIX >= '20261001' AND e._TABLE_SUFFIX <= '20261108' AND e.user_id IS NOT NULL
-- Q:ga_funnel_params
SELECT event_name, ep.key k, COUNT(*) n, COUNT(DISTINCT IFNULL(ep.value.string_value, CAST(ep.value.int_value AS STRING))) distinct_vals
FROM `sayakaya.analytics_266759216.events_*`, UNNEST(event_params) ep
WHERE _TABLE_SUFFIX >= '20261101' AND event_date>='20261101' AND event_name IN ('register_success','kyc_start','kyc_success','order_created','payment_complete','first_open','register_click') AND ep.key NOT IN ('ga_session_id','ga_session_number','engagement_time_msec','firebase_screen_class','firebase_screen_id','firebase_previous_class','firebase_previous_id','firebase_event_origin','firebase_screen')
GROUP BY 1,2 ORDER BY 1,3 DESC
