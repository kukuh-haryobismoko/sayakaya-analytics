-- Q:buy_dq_cohort
WITH c AS (SELECT id, created_at FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AND NOT IFNULL(is_institution,FALSE))
SELECT COUNT(*) users FROM c
-- Q:investor_counts
WITH c AS (SELECT id, created_at, verification_status FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA'))),
b AS (SELECT user_id, MIN(created_at) first_buy FROM `sayakaya.main.transactions` WHERE type='buy' AND status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1),
bo AS (SELECT DISTINCT user_id FROM `sayakaya.main.transactions` WHERE type='buy' AND status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(payment_method,'') IN ('manual_bonus','bonus'))
SELECT COUNT(*) users, COUNTIF(b.user_id IS NOT NULL) investors, COUNTIF(b.user_id IS NULL AND bo.user_id IS NOT NULL) bonus_only,
 COUNTIF(b.user_id IS NOT NULL AND c.verification_status='verified') investors_verified, COUNTIF(b.user_id IS NOT NULL AND c.verification_status!='verified') investors_not_verified,
 COUNTIF(b.first_buy < TIMESTAMP(c.created_at)) investor_buy_before_register
FROM c LEFT JOIN b ON b.user_id=c.id LEFT JOIN bo ON bo.user_id=c.id
-- Q:gap_dist
WITH c AS (SELECT id FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AND NOT IFNULL(is_institution,FALSE)),
a AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
  WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2),
g AS (SELECT user_id, d, DATE_DIFF(LEAD(d) OVER (PARTITION BY user_id ORDER BY d), d, DAY) gap FROM a)
SELECT COUNT(*) gaps, COUNT(DISTINCT user_id) users_with_gap,
 APPROX_QUANTILES(gap,100)[OFFSET(25)] p25, APPROX_QUANTILES(gap,100)[OFFSET(50)] p50, APPROX_QUANTILES(gap,100)[OFFSET(75)] p75,
 APPROX_QUANTILES(gap,100)[OFFSET(90)] p90, APPROX_QUANTILES(gap,100)[OFFSET(95)] p95, APPROX_QUANTILES(gap,100)[OFFSET(99)] p99,
 COUNTIF(gap<=30) le30, COUNTIF(gap<=60) le60, COUNTIF(gap<=90) le90, COUNTIF(gap<=120) le120, COUNTIF(gap<=180) le180, COUNTIF(gap<=270) le270, COUNTIF(gap<=365) le365
FROM g WHERE gap IS NOT NULL
-- Q:gap_hist
WITH c AS (SELECT id FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AND NOT IFNULL(is_institution,FALSE)),
a AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
  WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2),
g AS (SELECT user_id, DATE_DIFF(LEAD(d) OVER (PARTITION BY user_id ORDER BY d), d, DAY) gap FROM a)
SELECT CASE WHEN gap<=7 THEN '01:0-7' WHEN gap<=14 THEN '02:8-14' WHEN gap<=30 THEN '03:15-30' WHEN gap<=60 THEN '04:31-60' WHEN gap<=90 THEN '05:61-90' WHEN gap<=120 THEN '06:91-120' WHEN gap<=180 THEN '07:121-180' WHEN gap<=270 THEN '08:181-270' WHEN gap<=365 THEN '09:271-365' ELSE '10:>365' END b, COUNT(*) n
FROM g WHERE gap IS NOT NULL GROUP BY 1 ORDER BY 1
-- Q:reactivation_by_threshold
WITH c AS (SELECT id FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) AND NOT IFNULL(is_institution,FALSE)),
a AS (SELECT t.user_id, DATE(t.created_at,'Asia/Jakarta') d FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
  WHERE t.type IN ('buy','sell','SWITCH_IN') AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2),
g AS (SELECT user_id, d, DATE_DIFF(LEAD(d) OVER (PARTITION BY user_id ORDER BY d), d, DAY) gap, DATE_DIFF(CURRENT_DATE('Asia/Jakarta'), d, DAY) age FROM a)
SELECT th, COUNTIF(gap>th) gaps_over_th_observed_return, COUNTIF(gap IS NULL AND age>th) ended_over_th_no_return,
 ROUND(SAFE_DIVIDE(COUNTIF(gap>th), COUNTIF(gap>th)+COUNTIF(gap IS NULL AND age>th)),3) pct_that_came_back
FROM g, UNNEST([30,60,90,120,150,180,270,365]) th GROUP BY th ORDER BY th
