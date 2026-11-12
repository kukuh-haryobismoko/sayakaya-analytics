-- Q:mature_repeat
WITH {{BASE}} SELECT CASE WHEN U.sales_code IS NOT NULL THEN 'sales_code' WHEN NULLIF(TRIM(U.referrer_code),'') IS NOT NULL THEN 'referrer_code' ELSE 'none' END grp, COUNT(*) mature_inv, COUNTIF(buy_days>=2) repeat_inv FROM U JOIN B ON B.user_id=U.id WHERE DATE_DIFF(DATE '2026-11-09', DATE(first_buy), DAY)>=120 GROUP BY 1 ORDER BY 2 DESC
-- Q:bonus_before_paid
WITH {{BASE}}, BX AS (SELECT t.user_id, MIN(t.created_at) bt, SUM(t.final_amount) amt FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.payment_method IN ('manual_bonus','bonus') GROUP BY 1)
SELECT COUNT(*) bonus_users, COUNTIF(B.user_id IS NULL) never_paid, SUM(IF(B.user_id IS NULL,amt,0)) bonus_idr_never_paid, COUNTIF(B.user_id IS NOT NULL AND DATETIME(BX.bt,'Asia/Jakarta')<B.first_buy) bonus_before_first_paid, COUNTIF(B.user_id IS NOT NULL AND DATETIME(BX.bt,'Asia/Jakarta')>=B.first_buy) bonus_after_first_paid FROM BX LEFT JOIN B USING(user_id)
