-- Q:gate_outcome
WITH {{BASE}}, G AS (SELECT e.user_id, MIN(IF(event_name='risk_profile_gate_triggered',event_timestamp,NULL)) tg, MAX(event_name='risk_profile_gate_abandoned') ab FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND e.user_id IS NOT NULL AND event_name IN ('risk_profile_gate_triggered','risk_profile_gate_abandoned') GROUP BY 1 HAVING tg IS NOT NULL),
O AS (SELECT G.user_id, G.ab, EXISTS(SELECT 1 FROM `sayakaya.analytics_266759216.events_*` e WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND e.user_id=G.user_id AND e.event_name='order_created' AND e.event_timestamp>G.tg) ordered FROM G)
SELECT ab abandoned, COUNT(*) users, COUNTIF(ordered) ordered_after FROM O JOIN U ON U.id=O.user_id GROUP BY 1
-- Q:pay_fail_cohort
WITH {{BASE}} SELECT t.payment_method pm, COUNT(*) orders, COUNTIF(t.status IN ('expired','cancelled')) failed FROM `sayakaya.main.transactions` t JOIN U ON U.id=t.user_id WHERE t.type='buy' AND t.created_at>=TIMESTAMP '2026-01-01' AND IFNULL(t.payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1 ORDER BY 2 DESC
