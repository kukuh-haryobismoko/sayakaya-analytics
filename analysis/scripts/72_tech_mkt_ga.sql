-- Q:step_by_platform
WITH {{BASE}}, E AS (SELECT e.platform, e.app_info.version v, e.event_name, e.user_id, e.user_pseudo_id FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND e.event_name IN ('kyc_start','kyc_success','buy_bottom_sheet','order_button','order_created','payment_complete','risk_profile_gate_triggered','risk_profile_gate_abandoned','hfm_ready_unverified','hfm_ready'))
SELECT platform, event_name, COUNT(DISTINCT E.user_id) users, COUNT(*) events FROM E JOIN U ON U.id=E.user_id GROUP BY 1,2 ORDER BY 2,1
-- Q:step_by_version
WITH {{BASE}}, E AS (SELECT e.app_info.version v, e.event_name, e.user_id FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND e.event_name IN ('kyc_start','kyc_success','order_button','order_created','payment_complete'))
SELECT v, event_name, COUNT(DISTINCT E.user_id) users FROM E JOIN U ON U.id=E.user_id WHERE v IN ('2.28.1','2.28.2','2.29.0','2.27.1') GROUP BY 1,2 ORDER BY 2,1
-- Q:kyc_screens
WITH {{BASE}} SELECT (SELECT value.string_value FROM UNNEST(event_params) WHERE key='firebase_screen') scr, event_name, COUNT(DISTINCT e.user_id) users, COUNT(*) n FROM `sayakaya.analytics_266759216.events_*` e JOIN U ON U.id=e.user_id WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name IN ('kyc_start','kyc_success') GROUP BY 1,2 ORDER BY 4 DESC LIMIT 14
-- Q:errors
SELECT event_name, platform, app_info.version v, COUNT(*) n, COUNT(DISTINCT user_pseudo_id) dev FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name IN ('app_exception','continue_with_google_failed') GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 12
-- Q:pay_fail
SELECT payment_method pm, COUNT(*) orders, COUNTIF(status IN ('completed','completed_payment','verified','verified_by_operational')) ok, COUNTIF(status='expired') expired, COUNTIF(status='cancelled') cancelled FROM `sayakaya.main.transactions` WHERE type='buy' AND created_at>=TIMESTAMP '2026-01-01' AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1 ORDER BY 2 DESC
-- Q:orders_users
WITH {{BASE}} SELECT COUNT(DISTINCT t.user_id) users_with_order, COUNT(DISTINCT IF(t.status IN ('completed','completed_payment','verified','verified_by_operational'),t.user_id,NULL)) users_paid, COUNT(DISTINCT IF(t.status IN ('expired','cancelled'),t.user_id,NULL)) users_failed_any, COUNT(DISTINCT IF(t.status IN ('expired','cancelled') AND NOT EXISTS(SELECT 1 FROM B WHERE B.user_id=t.user_id),t.user_id,NULL)) users_failed_never_paid FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.created_at>=TIMESTAMP '2026-01-01' AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus')
-- Q:push_funnel
WITH {{BASE}}, P AS (SELECT e.event_name, e.platform, e.user_id FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name LIKE 'notification_%')
SELECT event_name, COUNT(*) events, COUNT(DISTINCT P.user_id) users_cohort FROM P JOIN U ON U.id=P.user_id GROUP BY 1 ORDER BY 2 DESC
-- Q:push_by_platform
SELECT platform, event_name, COUNT(*) n, COUNT(DISTINCT user_pseudo_id) dev FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name IN ('notification_receive','notification_open','notification_click','notification_dismiss','notification_foreground') GROUP BY 1,2 ORDER BY 2,1
-- Q:push_click_to_buy
WITH {{BASE}}, K AS (SELECT e.user_id, MIN(TIMESTAMP_MICROS(e.event_timestamp)) k FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name IN ('notification_click','notification_open') AND e.user_id IS NOT NULL GROUP BY 1)
SELECT COUNT(*) pushers, COUNTIF(B.user_id IS NOT NULL) already_investor, COUNTIF(U.verification_status='verified' AND B.user_id IS NULL) approved_never_bought, COUNTIF(U.verification_status<>'verified') not_approved FROM K JOIN U ON U.id=K.user_id LEFT JOIN B ON B.user_id=K.user_id
-- Q:push_click_by_status
WITH {{BASE}}, R AS (SELECT e.user_id, COUNTIF(event_name='notification_receive') rc, COUNTIF(event_name IN ('notification_click','notification_open')) cl FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name LIKE 'notification_%' AND e.user_id IS NOT NULL GROUP BY 1)
SELECT CASE WHEN B.user_id IS NOT NULL THEN 'investor' WHEN U.verification_status='verified' THEN 'approved_no_buy' ELSE 'not_approved' END seg, COUNT(*) users, SUM(rc) receives, SUM(cl) clicks_opens, COUNTIF(rc>0) with_receive, COUNTIF(cl>0) with_click FROM R JOIN U ON U.id=R.user_id LEFT JOIN B ON B.user_id=R.user_id GROUP BY 1
