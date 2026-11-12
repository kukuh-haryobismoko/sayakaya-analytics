-- Q:users
SELECT COUNT(*) n, COUNTIF(verification_status='verified') ver, COUNTIF(verification_status='failed') failed, COUNTIF(is_institution) inst, COUNTIF(referrer_code IS NULL) null_rc, COUNTIF(referrer_code='') empty_rc, COUNTIF(referrer_code='RAIZKAYA') raizkaya, COUNTIF(referrer_code='RAIZ') raiz, COUNT(DISTINCT referrer_code) distinct_rc, MAX(created_at) max_created FROM `sayakaya.main.users`
-- Q:txn
SELECT COUNT(*) n, COUNTIF(IFNULL(payment_method,'') IN ('bonus','manual_bonus')) bonus, MAX(created_at) mx FROM `sayakaya.main.transactions`
-- Q:txn_types
SELECT type, COUNT(*) n FROM `sayakaya.main.transactions` GROUP BY 1 ORDER BY 2 DESC
-- Q:txn_status
SELECT status, COUNT(*) n FROM `sayakaya.main.transactions` GROUP BY 1 ORDER BY 2 DESC
-- Q:logs
SELECT COUNT(*) n, MIN(created_at) mn, MAX(created_at) mx FROM `sayakaya.main.user_status_logs`
-- Q:rows
SELECT 'profiles' t, COUNT(*) n FROM `sayakaya.main.user_profiles` UNION ALL SELECT 'portfolios', COUNT(*) FROM `sayakaya.main.portfolios` UNION ALL SELECT 'internal', COUNT(*) FROM `sayakaya.main.internal_syky`
-- Q:ga_events
SELECT event_name, COUNT(*) n, COUNT(DISTINCT user_id) users, COUNT(DISTINCT user_pseudo_id) devices FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX>='20261001' AND _TABLE_SUFFIX<='20261108' AND event_date BETWEEN '20261001' AND '20261108' GROUP BY 1 ORDER BY n DESC LIMIT 45
