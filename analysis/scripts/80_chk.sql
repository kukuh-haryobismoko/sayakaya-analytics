-- Q:paid_users_2026
WITH {{BASE}} SELECT COUNT(DISTINCT t.user_id) u_paid_2026, COUNT(*) paid_orders FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.created_at>=TIMESTAMP '2026-01-01' AND t.status IN ('completed','completed_payment','verified','verified_by_operational') AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus')
-- Q:inv_total
WITH {{BASE}} SELECT COUNT(*) inv FROM B
