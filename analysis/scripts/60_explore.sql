-- Q:status_logs
SELECT origin_status, status, COUNT(*) n, COUNT(DISTINCT user_id) u, MIN(DATE(created_at,'Asia/Jakarta')) mn, MAX(DATE(created_at,'Asia/Jakarta')) mx FROM `sayakaya.main.user_status_logs` GROUP BY 1,2 ORDER BY n DESC
-- Q:campaigns_cols
SELECT column_name, data_type FROM `sayakaya.main.INFORMATION_SCHEMA.COLUMNS` WHERE table_name IN ('campaigns','user_referrals','bonus_portfolios') ORDER BY table_name, ordinal_position
-- Q:ga_events_all
SELECT event_name, COUNT(*) n, COUNT(DISTINCT user_pseudo_id) dev, COUNT(DISTINCT user_id) usr FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' GROUP BY 1 ORDER BY n DESC LIMIT 80
-- Q:promo_tx
SELECT IFNULL(promo_code,'(none)') promo, type, IFNULL(payment_method,'') pm, COUNT(*) n, COUNT(DISTINCT user_id) u FROM `sayakaya.main.transactions` WHERE promo_code IS NOT NULL GROUP BY 1,2,3 ORDER BY n DESC LIMIT 25
