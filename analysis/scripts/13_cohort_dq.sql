-- Q:buy_vs_register_cohort
WITH c AS (SELECT * FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')))
SELECT COUNT(*) buys, COUNT(DISTINCT t.user_id) buyers,
 COUNTIF(TIMESTAMP(c.created_at) > t.created_at) buy_before_register,
 COUNTIF(c.verified_at IS NULL) buyer_no_verified_at, COUNTIF(c.verification_status!='verified') buyer_not_verified,
 COUNTIF(c.verified_at IS NOT NULL AND TIMESTAMP(c.verified_at) > t.created_at) buy_before_verified_at
FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus')
-- Q:raiz_buy_vs_register
WITH c AS (SELECT * FROM `sayakaya.main.users` WHERE UPPER(TRIM(referrer_code)) IN ('RAIZ','RAIZKAYA'))
SELECT COUNT(*) buys, COUNT(DISTINCT t.user_id) buyers, COUNTIF(TIMESTAMP(c.created_at) > t.created_at) buy_before_register, COUNTIF(c.verification_status!='verified') buyer_not_verified
FROM `sayakaya.main.transactions` t JOIN c ON c.id=t.user_id
WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus')
-- Q:cohort_verification
SELECT verification_status, COUNT(*) n, COUNTIF(sid_code IS NOT NULL) has_sid, COUNTIF(verified_at IS NOT NULL) has_verified_at
FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) GROUP BY 1
-- Q:profile_completeness
SELECT u.verification_status, COUNT(*) n, COUNTIF(p.id_number IS NOT NULL AND p.id_number!='') has_idnum, COUNTIF(p.selfie_with_id_photo_url IS NOT NULL AND p.selfie_with_id_photo_url!='') has_selfie,
 COUNTIF(p.signature_image_url IS NOT NULL AND p.signature_image_url!='') has_sign, COUNTIF(p.risk_level IS NOT NULL) has_risk
FROM `sayakaya.main.users` u JOIN `sayakaya.main.user_profiles` p ON p.user_id=u.id
WHERE (u.referrer_code IS NULL OR UPPER(TRIM(u.referrer_code)) NOT IN ('RAIZ','RAIZKAYA')) GROUP BY 1
-- Q:cohort_sid_dups
SELECT sid_code, COUNT(*) c FROM `sayakaya.main.users` WHERE sid_code IS NOT NULL GROUP BY 1 HAVING c>1
-- Q:cohort_test_accounts
SELECT COUNTIF(email IN (SELECT email FROM `sayakaya.main.internal_syky`)) internal_syky, COUNTIF(LOWER(email) LIKE '%@sayakaya.id') sayakaya_id, COUNTIF(is_institution) institution
FROM `sayakaya.main.users` WHERE (referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA'))
