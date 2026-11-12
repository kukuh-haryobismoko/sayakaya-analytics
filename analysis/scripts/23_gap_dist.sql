-- Q:gap_pct
WITH u AS (SELECT id, sid_code, created_at, verification_status, is_institution,
  (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AS not_raiz,
  IFNULL(sid_code,'') IN (SELECT sid_code FROM (SELECT sid_code, DATE(created_at) d, SUM(amount) aum FROM `sayakaya.mi_fee_logs.portfolio_with_code` WHERE DATE(created_at)>='2026-01-14' GROUP BY 1,2) GROUP BY sid_code HAVING MAX(aum)>=500000000) AS hnwi FROM `sayakaya.main.users`),
b AS (SELECT user_id, MIN(created_at) first_buy FROM `sayakaya.main.transactions` WHERE type='buy' AND status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1),c AS (SELECT id FROM u WHERE not_raiz AND NOT hnwi),
a AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
  WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2),
g AS (SELECT user_id, DATE_DIFF(LEAD(d) OVER (PARTITION BY user_id ORDER BY d), d, DAY) gap FROM a)
SELECT COUNT(*) gaps, COUNT(DISTINCT user_id) users, APPROX_QUANTILES(gap,100)[OFFSET(50)] p50, APPROX_QUANTILES(gap,100)[OFFSET(75)] p75, APPROX_QUANTILES(gap,100)[OFFSET(90)] p90, APPROX_QUANTILES(gap,100)[OFFSET(95)] p95, APPROX_QUANTILES(gap,100)[OFFSET(99)] p99 FROM g WHERE gap IS NOT NULL
-- Q:gap_hist
WITH u AS (SELECT id, sid_code, created_at, verification_status, is_institution,
  (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AS not_raiz,
  IFNULL(sid_code,'') IN (SELECT sid_code FROM (SELECT sid_code, DATE(created_at) d, SUM(amount) aum FROM `sayakaya.mi_fee_logs.portfolio_with_code` WHERE DATE(created_at)>='2026-01-14' GROUP BY 1,2) GROUP BY sid_code HAVING MAX(aum)>=500000000) AS hnwi FROM `sayakaya.main.users`),
b AS (SELECT user_id, MIN(created_at) first_buy FROM `sayakaya.main.transactions` WHERE type='buy' AND status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1),c AS (SELECT id FROM u WHERE not_raiz AND NOT hnwi),
a AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
  WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2),
g AS (SELECT user_id, DATE_DIFF(LEAD(d) OVER (PARTITION BY user_id ORDER BY d), d, DAY) gap FROM a)
SELECT CASE WHEN gap<=7 THEN '01:0-7' WHEN gap<=14 THEN '02:8-14' WHEN gap<=30 THEN '03:15-30' WHEN gap<=60 THEN '04:31-60' WHEN gap<=90 THEN '05:61-90' WHEN gap<=120 THEN '06:91-120' WHEN gap<=180 THEN '07:121-180' WHEN gap<=270 THEN '08:181-270' WHEN gap<=365 THEN '09:271-365' ELSE '10:>365' END b, COUNT(*) n FROM g WHERE gap IS NOT NULL GROUP BY 1 ORDER BY 1
