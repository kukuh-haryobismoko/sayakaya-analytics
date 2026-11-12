-- Q:pwc_partitions
SELECT MIN(partition_id) mn, MAX(partition_id) mx, COUNT(*) n, ROUND(SUM(total_logical_bytes)/1e9,2) gb FROM `sayakaya.mi_fee_logs.INFORMATION_SCHEMA.PARTITIONS` WHERE table_name='portfolio_with_code'
-- Q:created_dist_raiz
SELECT IF(UPPER(TRIM(IFNULL(referrer_code,''))) IN ('RAIZ','RAIZKAYA'),'raiz','other') grp, FORMAT_DATE('%Y-%m',DATE(created_at)) m, COUNT(*) n
FROM `sayakaya.main.users` WHERE created_at >= '2025-06-01' GROUP BY 1,2 ORDER BY 2,1
-- Q:raiz_created_day_top
SELECT DATE(created_at) d, COUNT(*) n FROM `sayakaya.main.users` WHERE UPPER(TRIM(IFNULL(referrer_code,''))) IN ('RAIZ','RAIZKAYA') GROUP BY 1 ORDER BY n DESC LIMIT 6
