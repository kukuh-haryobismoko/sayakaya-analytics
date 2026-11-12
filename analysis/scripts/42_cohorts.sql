WITH {{BASE}},
F AS (SELECT U.*, B.first_buy, B.buy_days FROM U LEFT JOIN B ON B.user_id=U.id),
AG AS (SELECT user_id, d, 1 x FROM A)
SELECT FORMAT_DATE('%Y-%m',DATE(reg_at)) m, COUNT(*) reg,
 COUNTIF(verification_status='verified') ver, COUNTIF(verification_status='failed') failed,
 COUNTIF(first_buy IS NOT NULL) inv,
 COUNTIF(first_buy IS NOT NULL AND DATETIME_DIFF(first_buy,reg_at,DAY)<=7) inv7,
 COUNTIF(first_buy IS NOT NULL AND DATETIME_DIFF(first_buy,reg_at,DAY)<=30) inv30,
 COUNTIF(buy_days>=2) repeat_inv
FROM F GROUP BY 1 ORDER BY 1
