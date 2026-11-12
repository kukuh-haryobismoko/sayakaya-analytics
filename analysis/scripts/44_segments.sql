WITH {{BASE}},
F AS (SELECT U.*, B.first_buy, B.buy_days, P.gender, P.occupation, P.monthly_income, P.id_address_city city,
  DATE_DIFF(DATE(U.reg_at), P.birthdate, YEAR) age, P.investment_purpose, P.risk_level, P.bank_account_skipped
  FROM U LEFT JOIN B ON B.user_id=U.id LEFT JOIN `sayakaya.main.user_profiles` P ON P.user_id=U.id),
S AS (
SELECT 'referrer' dim, IFNULL(NULLIF(UPPER(TRIM(referrer_code)),''),'(none)') seg, * FROM F
UNION ALL SELECT 'has_sales_code', IF(sales_code IS NULL OR sales_code='','no','yes'), * FROM F
UNION ALL SELECT 'gender', IFNULL(gender,'(null)'), * FROM F
UNION ALL SELECT 'age', CASE WHEN age IS NULL THEN '(null)' WHEN age<25 THEN '<25' WHEN age<35 THEN '25-34' WHEN age<45 THEN '35-44' WHEN age<55 THEN '45-54' ELSE '55+' END, * FROM F
UNION ALL SELECT 'income', CASE WHEN monthly_income IS NULL THEN '(null)' WHEN monthly_income<5000000 THEN '<5jt' WHEN monthly_income<10000000 THEN '5-10jt' WHEN monthly_income<25000000 THEN '10-25jt' ELSE '25jt+' END, * FROM F
UNION ALL SELECT 'occupation', IFNULL(occupation,'(null)'), * FROM F
UNION ALL SELECT 'city', IFNULL(UPPER(city),'(null)'), * FROM F
UNION ALL SELECT 'bank_skipped', IFNULL(CAST(bank_account_skipped AS STRING),'(null)'), * FROM F
UNION ALL SELECT 'is_institution', CAST(is_institution AS STRING), * FROM F
UNION ALL SELECT 'reg_period', CASE WHEN reg_at>='2026-10-01' THEN '2026-10+ (booth era)' ELSE 'before 2026-10' END, * FROM F
)
SELECT dim, seg, COUNT(*) reg, COUNTIF(verification_status='verified') ver, COUNTIF(verification_status='failed') failed, COUNTIF(first_buy IS NOT NULL) inv, COUNTIF(buy_days>=2) rep
FROM S GROUP BY 1,2 HAVING COUNT(*)>=1 ORDER BY 1,3 DESC
