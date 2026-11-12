WITH {{BASE}},
L AS (SELECT user_id, MAX(d) last_d, COUNT(*) act_days FROM A GROUP BY 1)
SELECT DATE_DIFF(L.last_d,DATE(B.first_buy),DAY) dur, DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),L.last_d,DAY) silent, DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),DATE(B.first_buy),DAY) age, B.buy_days, L.act_days, FORMAT_DATE('%Y-%m',DATE(B.first_buy)) fm, U.verification_status, U.is_institution, (U.sales_code IS NOT NULL) has_sales
FROM B JOIN L USING(user_id) JOIN U ON U.id=B.user_id
