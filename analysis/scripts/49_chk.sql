WITH {{BASE}},
L AS (SELECT user_id, MAX(d) last_d FROM A GROUP BY 1)
SELECT 'buy_only_churn' k, COUNTIF(DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),DATE(B.last_buy),DAY)>90) n FROM B
UNION ALL SELECT 'act_churn', COUNTIF(DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),L.last_d,DAY)>90) FROM B JOIN L USING(user_id)
UNION ALL SELECT 'buy_churn_but_act_recent', COUNTIF(DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),DATE(B.last_buy),DAY)>90 AND DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),L.last_d,DAY)<=90) FROM B JOIN L USING(user_id)
UNION ALL SELECT 'investors_in_L', COUNT(*) FROM B JOIN L USING(user_id)
