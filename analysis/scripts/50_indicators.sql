WITH {{BASE}},
FB AS (SELECT t.user_id, ARRAY_AGG(t.amount ORDER BY t.created_at LIMIT 1)[OFFSET(0)] first_amt, ARRAY_AGG(IFNULL(f.type,'?') ORDER BY t.created_at LIMIT 1)[OFFSET(0)] first_type, ARRAY_AGG(t.payment_method ORDER BY t.created_at LIMIT 1)[OFFSET(0)] first_pm
  FROM `sayakaya.main.transactions` t JOIN B ON B.user_id=t.user_id LEFT JOIN `sayakaya.main.funds` f ON f.id=t.fund_id
  WHERE t.type='buy' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1),
W AS (SELECT B.user_id, DATE(B.first_buy) fd, DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),DATE(B.first_buy),DAY) age,
  (SELECT COUNT(*) FROM A WHERE A.user_id=B.user_id AND A.d>DATE(B.first_buy) AND A.d<=DATE_ADD(DATE(B.first_buy),INTERVAL 30 DAY)) act30,
  (SELECT MAX(d) FROM A WHERE A.user_id=B.user_id) last_d FROM B)
SELECT W.age>=120 mature, CASE WHEN act30=0 THEN '0' WHEN act30=1 THEN '1' WHEN act30<=3 THEN '2-3' ELSE '4+' END act30_b,
  CASE WHEN first_amt<100000 THEN '<100k' WHEN first_amt<500000 THEN '100-500k' WHEN first_amt<5000000 THEN '0.5-5jt' ELSE '5jt+' END amt_b, FB.first_type, FB.first_pm,
  COUNT(*) n, COUNTIF(DATE_DIFF(CURRENT_DATE('Asia/Jakarta'),last_d,DAY)>90) churn
FROM W JOIN FB USING(user_id) GROUP BY 1,2,3,4,5
