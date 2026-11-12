WITH {{BASE}},
G AS (SELECT user_id, event_name, PARSE_DATE('%Y%m%d',event_date) d FROM `sayakaya.analytics_266759216.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_date BETWEEN '20261001' AND '20261108'
  AND event_name IN ('register_success','kyc_start','kyc_success','order_created','payment_complete')),
GU AS (SELECT G.event_name, G.d, G.user_id, (U.id IS NOT NULL) in_cohort FROM G LEFT JOIN U ON U.id=G.user_id),
TX AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d, t.status, t.type FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND DATE(t.created_at,'Asia/Jakarta') BETWEEN '2026-10-01' AND '2026-11-08' AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus'))
SELECT 'register' stage, 'ga_users_all' src, COUNT(DISTINCT user_id) n FROM GU WHERE event_name='register_success'
UNION ALL SELECT 'register','ga_users_cohort', COUNT(DISTINCT user_id) FROM GU WHERE event_name='register_success' AND in_cohort
UNION ALL SELECT 'register','ga_events_all', COUNT(*) FROM GU WHERE event_name='register_success'
UNION ALL SELECT 'register','db_users', COUNT(*) FROM U WHERE DATE(reg_at) BETWEEN '2026-10-01' AND '2026-11-08'
UNION ALL SELECT 'register','db_users_ga_matched', COUNT(DISTINCT U.id) FROM U JOIN GU ON GU.user_id=U.id AND GU.event_name='register_success' WHERE DATE(reg_at) BETWEEN '2026-10-01' AND '2026-11-08'
UNION ALL SELECT 'kyc_success','ga_users_cohort', COUNT(DISTINCT user_id) FROM GU WHERE event_name='kyc_success' AND in_cohort
UNION ALL SELECT 'kyc_success','ga_users_all', COUNT(DISTINCT user_id) FROM GU WHERE event_name='kyc_success'
UNION ALL SELECT 'kyc_success','db_verified_in_window', COUNT(*) FROM U WHERE verification_status='verified' AND DATE(ver_at) BETWEEN '2026-10-01' AND '2026-11-08'
UNION ALL SELECT 'kyc_success','db_submitted_in_window(verified|failed, reg in window)', COUNTIF(verification_status IN ('verified','failed')) FROM U WHERE DATE(reg_at) BETWEEN '2026-10-01' AND '2026-11-08'
UNION ALL SELECT 'kyc_success','db_verified_ga_matched', COUNT(DISTINCT U.id) FROM U JOIN GU ON GU.user_id=U.id AND GU.event_name='kyc_success' WHERE verification_status='verified' AND DATE(ver_at) BETWEEN '2026-10-01' AND '2026-11-08'
UNION ALL SELECT 'kyc_success','ga_users_not_verified_in_db', COUNT(DISTINCT GU.user_id) FROM GU JOIN U ON U.id=GU.user_id WHERE GU.event_name='kyc_success' AND U.verification_status!='verified'
UNION ALL SELECT 'kyc_start','ga_users_cohort', COUNT(DISTINCT user_id) FROM GU WHERE event_name='kyc_start' AND in_cohort
UNION ALL SELECT 'order_created','ga_users_cohort', COUNT(DISTINCT user_id) FROM GU WHERE event_name='order_created' AND in_cohort
UNION ALL SELECT 'order_created','db_buy_orders_users(any status)', COUNT(DISTINCT user_id) FROM TX
UNION ALL SELECT 'payment_complete','ga_users_cohort', COUNT(DISTINCT user_id) FROM GU WHERE event_name='payment_complete' AND in_cohort
UNION ALL SELECT 'payment_complete','ga_events_cohort', COUNT(*) FROM GU WHERE event_name='payment_complete' AND in_cohort
UNION ALL SELECT 'payment_complete','db_buy_success_users', COUNT(DISTINCT user_id) FROM TX WHERE status IN ('completed','completed_payment','verified','verified_by_operational')
UNION ALL SELECT 'payment_complete','db_buy_success_txns', COUNT(*) FROM TX WHERE status IN ('completed','completed_payment','verified','verified_by_operational')
UNION ALL SELECT 'payment_complete','db_buy_success_users_ga_matched', COUNT(DISTINCT TX.user_id) FROM TX JOIN GU ON GU.user_id=TX.user_id AND GU.event_name='payment_complete' WHERE TX.status IN ('completed','completed_payment','verified','verified_by_operational')
UNION ALL SELECT 'payment_complete','db_buy_users_by_status:'||status, COUNT(DISTINCT user_id) FROM TX GROUP BY status
