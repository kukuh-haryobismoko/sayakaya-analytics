-- Q:decision_actor
WITH {{BASE}} SELECT l.status, COUNT(*) n, COUNTIF(l.auth_user_id IS NULL) no_actor, COUNT(DISTINCT l.auth_user_id) actors FROM `sayakaya.main.user_status_logs` l JOIN U ON U.id=l.user_id WHERE l.origin_status='pending_verification' GROUP BY 1 ORDER BY 1
