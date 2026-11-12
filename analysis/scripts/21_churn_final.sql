WITH u AS (SELECT id, sid_code, created_at, verification_status, is_institution,
  (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AS not_raiz,
  IFNULL(sid_code,'') IN (SELECT sid_code FROM (SELECT sid_code, DATE(created_at) d, SUM(amount) aum FROM `sayakaya.mi_fee_logs.portfolio_with_code` WHERE DATE(created_at)>='2026-01-14' GROUP BY 1,2) GROUP BY sid_code HAVING MAX(aum)>=500000000) AS hnwi FROM `sayakaya.main.users`),
b AS (SELECT user_id, MIN(created_at) first_buy FROM `sayakaya.main.transactions` WHERE type='buy' AND status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1),c AS (SELECT id FROM u WHERE not_raiz AND NOT hnwi),
a AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
  WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2),
g AS (SELECT user_id, d, DATE_DIFF(LEAD(d) OVER (PARTITION BY user_id ORDER BY d), d, DAY) gap, DATE_DIFF(CURRENT_DATE('Asia/Jakarta'), d, DAY) age FROM a)
SELECT th, COUNT(DISTINCT user_id) users_all, COUNTIF(gap>th) returned_after_gap_gt_th, COUNTIF(gap IS NULL AND age>th) silent_gt_th_now,
 ROUND(SAFE_DIVIDE(COUNTIF(gap>th), COUNTIF(gap>th)+COUNTIF(gap IS NULL AND age>th)),3) pct_came_back
FROM g, UNNEST([30,60,90,120,150,180,270,365]) th GROUP BY th ORDER BY th