-- Q:dup_email_sid
SELECT 'dup_email' k, COUNT(*) grp, SUM(c) n_rows FROM (SELECT LOWER(TRIM(email)) e, COUNT(*) c FROM `sayakaya.main.users` GROUP BY 1 HAVING c>1)
UNION ALL SELECT 'dup_sid', COUNT(*), SUM(c) FROM (SELECT sid_code, COUNT(*) c FROM `sayakaya.main.users` WHERE sid_code IS NOT NULL GROUP BY 1 HAVING c>1)
-- Q:status_logs
SELECT status, origin_status, COUNT(*) n, COUNT(DISTINCT user_id) u, MIN(created_at) mn, MAX(created_at) mx FROM `sayakaya.main.user_status_logs` GROUP BY 1,2
-- Q:verified_by_month
SELECT FORMAT_DATE('%Y-%m',DATE(verified_at)) m, COUNT(*) verified_users, COUNTIF(u.id IN (SELECT user_id FROM `sayakaya.main.user_status_logs`)) with_log
FROM `sayakaya.main.users` u WHERE verification_status='verified' AND verified_at IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 14
-- Q:txn_basic
SELECT COUNT(*) n, COUNT(DISTINCT id) ids, COUNT(DISTINCT transaction_number) tn, COUNTIF(transaction_number IS NULL) null_tn, COUNTIF(user_id IS NULL) null_user,
 COUNTIF(user_id NOT IN (SELECT id FROM `sayakaya.main.users`)) orphan_user, COUNTIF(amount<=0) amount_le0,
 COUNTIF(completed_at < created_at) completed_before_created, COUNTIF(paid_at < created_at) paid_before_created,
 COUNTIF(status IN ('completed','completed_payment','verified','verified_by_operational') AND completed_at IS NULL) settled_no_completed_at,
 MIN(created_at) mn, MAX(created_at) mx
FROM `sayakaya.main.transactions`
-- Q:buy_before_register
SELECT COUNT(*) buys_before_user_created FROM `sayakaya.main.transactions` t JOIN `sayakaya.main.users` u ON u.id=t.user_id
WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND t.payment_method!='manual_bonus' AND t.payment_method!='bonus' AND TIMESTAMP(u.created_at) > t.created_at
-- Q:buy_before_kyc
SELECT COUNT(*) buys, COUNTIF(u.verified_at IS NULL) buyer_no_verified_at, COUNTIF(u.verification_status!='verified') buyer_not_verified,
 COUNTIF(u.verified_at IS NOT NULL AND TIMESTAMP(u.verified_at) > t.created_at) buy_before_verified_at
FROM `sayakaya.main.transactions` t JOIN `sayakaya.main.users` u ON u.id=t.user_id
WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus')
-- Q:pm_blank
SELECT type, status, COUNT(*) n, ROUND(SUM(amount)) amt FROM `sayakaya.main.transactions` WHERE IFNULL(payment_method,'')='' GROUP BY 1,2 ORDER BY n DESC LIMIT 8
-- Q:has_completed_flag
SELECT has_completed_first_subscription f, COUNT(*) n, COUNTIF(id IN (SELECT user_id FROM `sayakaya.main.transactions` WHERE type='buy' AND status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus'))) has_real_buy FROM `sayakaya.main.users` GROUP BY 1
-- Q:portfolio_dup
SELECT COUNT(*) n, COUNT(DISTINCT id) ids, COUNTIF(deleted_at IS NOT NULL) deleted, COUNTIF(unit>0) unit_pos, COUNTIF(user_id NOT IN (SELECT id FROM `sayakaya.main.users`)) orphan FROM `sayakaya.main.portfolios`
