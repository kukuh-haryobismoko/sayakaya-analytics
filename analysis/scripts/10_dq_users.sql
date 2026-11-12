-- Q:users_basic
SELECT COUNT(*) n, COUNT(DISTINCT id) ids, COUNT(DISTINCT LOWER(TRIM(email))) emails, COUNTIF(email IS NULL) null_email,
 COUNTIF(created_at IS NULL) null_created, COUNT(DISTINCT sid_code) sids, COUNTIF(sid_code IS NULL) null_sid,
 COUNTIF(verification_status='verified' AND sid_code IS NULL) verified_no_sid,
 COUNTIF(verification_status='verified' AND verified_at IS NULL) verified_no_verified_at,
 COUNTIF(verification_status!='verified' AND verified_at IS NOT NULL) notverified_has_verified_at,
 COUNTIF(verified_at < created_at) verified_before_created,
 COUNTIF(created_at > CURRENT_DATETIME()) future_created,
 MIN(created_at) min_created, MAX(created_at) max_created,
 COUNTIF(email_verified_at IS NOT NULL) email_verified, COUNTIF(phone_number_verified_at IS NOT NULL) phone_verified
FROM `sayakaya.main.users`
-- Q:dup_email_sid
SELECT 'dup_email' k, COUNT(*) groups, SUM(c) rows_ FROM (SELECT LOWER(TRIM(email)) e, COUNT(*) c FROM `sayakaya.main.users` GROUP BY 1 HAVING c>1)
UNION ALL SELECT 'dup_sid', COUNT(*), SUM(c) FROM (SELECT sid_code, COUNT(*) c FROM `sayakaya.main.users` WHERE sid_code IS NOT NULL GROUP BY 1 HAVING c>1)
-- Q:test_internal
SELECT COUNTIF(LOWER(email) LIKE '%@sayakaya.id' OR LOWER(email) LIKE '%@sayakaya.com') sayakaya_domain,
 COUNTIF(LOWER(email) LIKE '%test%' OR LOWER(email) LIKE '%dummy%' OR LOWER(email) LIKE '%demo%') test_like,
 COUNTIF(email IN (SELECT email FROM `sayakaya.main.internal_syky`)) in_internal_syky,
 (SELECT COUNT(*) FROM `sayakaya.main.internal_syky`) internal_rows
FROM `sayakaya.main.users`
-- Q:referrer_values
SELECT IFNULL(referrer_code,'<NULL>') rc, COUNT(*) n FROM `sayakaya.main.users` WHERE referrer_code IS NULL OR UPPER(TRIM(referrer_code)) LIKE 'RAIZ%' OR TRIM(referrer_code)='' GROUP BY 1 ORDER BY n DESC
-- Q:referrer_summary
SELECT COUNTIF(referrer_code IS NULL) null_rc, COUNTIF(referrer_code IS NOT NULL AND TRIM(referrer_code)='') empty_rc,
 COUNTIF(UPPER(TRIM(referrer_code)) IN ('RAIZ','RAIZKAYA')) raiz_norm, COUNTIF(referrer_code IN ('RAIZ','RAIZKAYA')) raiz_exact,
 COUNTIF(referrer_code != UPPER(TRIM(referrer_code))) rc_case_or_space_variants, COUNT(DISTINCT UPPER(TRIM(referrer_code))) distinct_rc
FROM `sayakaya.main.users`
-- Q:profiles
SELECT (SELECT COUNT(*) FROM `sayakaya.main.user_profiles`) profiles, (SELECT COUNT(DISTINCT user_id) FROM `sayakaya.main.user_profiles`) distinct_profile_users,
 (SELECT COUNT(*) FROM `sayakaya.main.user_profiles` p LEFT JOIN `sayakaya.main.users` u ON u.id=p.user_id WHERE u.id IS NULL) orphan_profiles,
 (SELECT COUNT(*) FROM `sayakaya.main.users` u LEFT JOIN `sayakaya.main.user_profiles` p ON u.id=p.user_id WHERE p.user_id IS NULL) users_without_profile,
 (SELECT COUNTIF(u.verification_status='verified') FROM `sayakaya.main.users` u LEFT JOIN `sayakaya.main.user_profiles` p ON u.id=p.user_id WHERE p.user_id IS NULL) verified_without_profile
