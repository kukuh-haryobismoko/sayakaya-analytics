WITH {{BASE}}
SELECT IFNULL(NULLIF(UPPER(TRIM(referrer_code)),''),'(none)') ref, sales_code IS NOT NULL has_sales, COUNT(*) reg, COUNTIF(verification_status='verified') ver, COUNTIF(user_id_b IS NOT NULL) inv
FROM (SELECT U.*, B.user_id user_id_b FROM U LEFT JOIN B ON B.user_id=U.id) WHERE DATE(reg_at) BETWEEN '2026-10-01' AND '2026-10-31'
GROUP BY 1,2 ORDER BY reg DESC LIMIT 8
