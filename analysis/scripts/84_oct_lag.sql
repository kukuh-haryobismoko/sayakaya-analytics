-- Q:oct_lag
WITH {{BASE}}, D AS (SELECT l.user_id, DATETIME(MIN(l.created_at),'Asia/Jakarta') dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' AND l.status='verified' GROUP BY 1),
X AS (SELECT IF(D.dt<DATETIME '2026-10-01','JulSep','Oct') per, DATE_DIFF(DATE(D.dt),DATE(U.reg_at),DAY) lag, B.first_buy>=D.dt AND B.first_buy<=DATETIME_ADD(D.dt,INTERVAL 7 DAY) b7 FROM D JOIN U ON U.id=D.user_id LEFT JOIN B ON B.user_id=D.user_id WHERE D.dt<DATETIME '2026-11-01')
SELECT per, CASE WHEN lag<=1 THEN 'a<=1d' WHEN lag<=7 THEN 'b2-7d' WHEN lag<=30 THEN 'c8-30d' ELSE 'd>30d' END lagb, COUNT(*) n, COUNTIF(b7) bought7 FROM X GROUP BY 1,2 ORDER BY 1,2
