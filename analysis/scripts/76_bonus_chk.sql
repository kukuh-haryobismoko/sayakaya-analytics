-- Q:bonus_status
WITH {{BASE}}, BX AS (SELECT t.user_id, ANY_VALUE(t.status) st, SUM(t.final_amount) amt FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.payment_method IN ('manual_bonus','bonus') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') GROUP BY t.user_id)
SELECT COUNT(*) bonus_users_ok_status, COUNTIF(B.user_id IS NULL) never_paid, SUM(IF(B.user_id IS NULL,amt,0)) idr_never_paid FROM BX LEFT JOIN B USING(user_id)
-- Q:bonus_status_all
SELECT status, COUNT(*) n FROM `sayakaya.main.transactions` WHERE payment_method IN ('manual_bonus','bonus') AND type='buy' GROUP BY 1
-- Q:first_buy_amt
WITH {{BASE}}, T AS (SELECT t.user_id, t.final_amount amt, ROW_NUMBER() OVER (PARTITION BY t.user_id ORDER BY t.created_at) rn FROM `sayakaya.main.transactions` t JOIN B ON B.user_id=t.user_id WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus')),
F AS (SELECT U.id, CASE WHEN U.sales_code IS NOT NULL THEN 'sales_code' WHEN NULLIF(TRIM(U.referrer_code),'') IS NOT NULL THEN 'referrer_code' ELSE 'none' END grp, T.amt FROM U JOIN T ON T.user_id=U.id AND T.rn=1)
SELECT grp, COUNT(*) n, COUNTIF(amt<100000) lt100k, CAST(APPROX_QUANTILES(amt,2)[OFFSET(1)] AS INT64) median_amt FROM F GROUP BY 1 ORDER BY 2 DESC
