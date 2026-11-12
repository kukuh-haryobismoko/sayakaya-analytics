-- Q:retention_by_acq
WITH {{BASE}}, GG AS (SELECT U.id, CASE WHEN U.sales_code IS NOT NULL THEN 'sales_code' WHEN NULLIF(TRIM(U.referrer_code),'') IS NOT NULL THEN 'referrer_code' ELSE 'none' END grp, B.first_buy, B.buy_days, (SELECT MAX(d) FROM A WHERE A.user_id=U.id) last_d FROM U JOIN B ON B.user_id=U.id)
SELECT grp, COUNT(*) inv, COUNTIF(DATE_DIFF(DATE '2026-11-09', last_d, DAY)>90) churn90, COUNTIF(buy_days>=2) repeat_inv, COUNTIF(DATE_DIFF(DATE '2026-11-09', DATE(first_buy), DAY)>=120) mature, COUNTIF(DATE_DIFF(DATE '2026-11-09', DATE(first_buy), DAY)>=120 AND DATE_DIFF(DATE '2026-11-09', last_d, DAY)>90) mature_churn FROM GG GROUP BY 1 ORDER BY 2 DESC
-- Q:promo_first_buy
WITH {{BASE}}, FB AS (SELECT t.user_id, ARRAY_AGG(t.promo_code IGNORE NULLS ORDER BY t.created_at LIMIT 1)[SAFE_OFFSET(0)] p, MIN(t.created_at) c FROM `sayakaya.main.transactions` t JOIN B ON B.user_id=t.user_id AND DATETIME(t.created_at,'Asia/Jakarta')=B.first_buy WHERE t.type='buy' GROUP BY 1)
SELECT FB.p IS NOT NULL promo_on_first_buy, COUNT(*) inv, COUNTIF(B.buy_days>=2) repeat_inv, COUNTIF(DATE_DIFF(DATE '2026-11-09',(SELECT MAX(d) FROM A WHERE A.user_id=B.user_id),DAY)>90) churn90 FROM B JOIN FB USING(user_id) GROUP BY 1
-- Q:promo_any_paid
WITH {{BASE}}, P AS (SELECT t.user_id, COUNTIF(t.promo_code IS NOT NULL) promo_buys FROM `sayakaya.main.transactions` t JOIN B ON B.user_id=t.user_id WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1)
SELECT promo_buys>0 used_promo_paid, COUNT(*) inv, COUNTIF(B.buy_days>=2) repeat_inv, COUNTIF(DATE_DIFF(DATE '2026-11-09',(SELECT MAX(d) FROM A WHERE A.user_id=B.user_id),DAY)>90) churn90 FROM B JOIN P USING(user_id) GROUP BY 1
-- Q:bonus_exposure
WITH {{BASE}}, BO AS (SELECT DISTINCT t.user_id FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.payment_method IN ('manual_bonus','bonus'))
SELECT BO.user_id IS NOT NULL got_bonus, COUNT(*) users, COUNTIF(B.user_id IS NOT NULL) inv, COUNTIF(B.buy_days>=2) repeat_inv, COUNTIF(B.user_id IS NOT NULL AND DATE_DIFF(DATE '2026-11-09',(SELECT MAX(d) FROM A WHERE A.user_id=B.user_id),DAY)>90) churn90 FROM U LEFT JOIN BO ON BO.user_id=U.id LEFT JOIN B ON B.user_id=U.id WHERE U.verification_status='verified' GROUP BY 1
-- Q:stuck_sizes
WITH {{BASE}}, LB AS (SELECT user_id, MAX(d) last_d FROM A GROUP BY 1)
SELECT 'registered_unverified_30d' k, COUNT(*) n FROM U WHERE verification_status='unverified' AND DATE(reg_at) >= DATE_SUB(DATE '2026-11-09', INTERVAL 30 DAY)
UNION ALL SELECT 'failed_kyc_total', COUNT(*) FROM U WHERE verification_status='failed'
UNION ALL SELECT 'failed_kyc_30d_reg', COUNT(*) FROM U WHERE verification_status='failed' AND DATE(reg_at) >= DATE_SUB(DATE '2026-11-09', INTERVAL 30 DAY)
UNION ALL SELECT 'approved_never_bought', COUNT(*) FROM U LEFT JOIN B ON B.user_id=U.id WHERE verification_status='verified' AND B.user_id IS NULL
UNION ALL SELECT 'approved_never_bought_ver_last_30d', COUNT(*) FROM U LEFT JOIN B ON B.user_id=U.id WHERE verification_status='verified' AND B.user_id IS NULL AND DATE(ver_at)>=DATE_SUB(DATE '2026-11-09', INTERVAL 30 DAY)
UNION ALL SELECT 'investors_active_60_90d_silent', COUNT(*) FROM LB WHERE DATE_DIFF(DATE '2026-11-09', last_d, DAY) BETWEEN 60 AND 90
UNION ALL SELECT 'investors_not_churned', COUNT(*) FROM LB WHERE DATE_DIFF(DATE '2026-11-09', last_d, DAY)<=90
