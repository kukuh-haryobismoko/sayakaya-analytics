WITH {{BASE}},
L AS (SELECT user_id, MAX(d) last_d, COUNT(*) act_days FROM A GROUP BY 1),
F AS (SELECT U.*, B.first_buy, B.buy_days, L.last_d, L.act_days,
  DATE_DIFF(CURRENT_DATE('Asia/Jakarta'), L.last_d, DAY) silent FROM U LEFT JOIN B ON B.user_id=U.id LEFT JOIN L ON L.user_id=U.id)
SELECT 'registered' stage, COUNT(*) n FROM F
UNION ALL SELECT 'kyc_submitted(verified|failed)', COUNTIF(verification_status IN ('verified','failed')) FROM F
UNION ALL SELECT 'kyc_approved', COUNTIF(verification_status='verified') FROM F
UNION ALL SELECT 'kyc_rejected', COUNTIF(verification_status='failed') FROM F
UNION ALL SELECT 'kyc_unverified', COUNTIF(verification_status='unverified') FROM F
UNION ALL SELECT 'investor', COUNTIF(first_buy IS NOT NULL) FROM F
UNION ALL SELECT 'investor_verified', COUNTIF(first_buy IS NOT NULL AND verification_status='verified') FROM F
UNION ALL SELECT 'investor_not_verified', COUNTIF(first_buy IS NOT NULL AND verification_status!='verified') FROM F
UNION ALL SELECT 'verified_not_investor', COUNTIF(first_buy IS NULL AND verification_status='verified') FROM F
UNION ALL SELECT 'repeat_investor(buy_days>=2)', COUNTIF(buy_days>=2) FROM F
UNION ALL SELECT 'investor_active_le90', COUNTIF(first_buy IS NOT NULL AND silent<=90) FROM F
UNION ALL SELECT 'investor_churned_gt90', COUNTIF(first_buy IS NOT NULL AND silent>90) FROM F
UNION ALL SELECT 'investor_churned_gt180', COUNTIF(first_buy IS NOT NULL AND silent>180) FROM F
UNION ALL SELECT 'investor_first_buy_le90d_ago', COUNTIF(first_buy IS NOT NULL AND DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),DATE(first_buy),DAY)<=90) FROM F
