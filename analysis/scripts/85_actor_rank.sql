-- Q:actor_rank
WITH {{BASE}}, AC AS (SELECT l.auth_user_id a, COUNT(*) n FROM `sayakaya.main.user_status_logs` l JOIN U ON U.id=l.user_id WHERE l.origin_status='pending_verification' GROUP BY 1)
SELECT ROW_NUMBER() OVER (ORDER BY n DESC) actor_rank, n, ROUND(100*n/SUM(n) OVER (),1) pct FROM AC ORDER BY 1
