-- Q:oct_week
WITH {{BASE}}, D AS (SELECT l.user_id, DATETIME(MIN(l.created_at),'Asia/Jakarta') dt FROM `sayakaya.main.user_status_logs` l WHERE l.origin_status='pending_verification' AND l.status='verified' GROUP BY 1)
SELECT DATE_TRUNC(DATE(D.dt),WEEK(MONDAY)) wk, COUNT(*) n, COUNTIF(B.first_buy>=D.dt AND B.first_buy<=DATETIME_ADD(D.dt,INTERVAL 7 DAY)) bought7 FROM D JOIN U ON U.id=D.user_id LEFT JOIN B ON B.user_id=D.user_id WHERE D.dt>=DATETIME '2026-08-01' AND D.dt<DATETIME '2026-11-01' GROUP BY 1 ORDER BY 1
