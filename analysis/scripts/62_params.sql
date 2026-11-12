-- Q:notif_keys
SELECT event_name, p.key, COUNT(*) n, COUNT(DISTINCT p.value.string_value) dist_s, ANY_VALUE(p.value.string_value) ex_s FROM `sayakaya.analytics_266759216.events_*`, UNNEST(event_params) p WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_name IN ('notification_receive','notification_open','notification_click','notification_foreground','notification_dismiss','app_exception','risk_profile_gate_triggered','risk_profile_gate_abandoned','continue_with_google_failed','kyc_start','kyc_success') GROUP BY 1,2 ORDER BY 1,3 DESC
-- Q:appver
SELECT platform, app_info.version v, COUNT(DISTINCT user_pseudo_id) dev, MIN(event_date) mn, MAX(event_date) mx FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' GROUP BY 1,2 ORDER BY dev DESC LIMIT 20
-- Q:buy_status
SELECT payment_method pm, status, COUNT(*) n FROM `sayakaya.main.transactions` WHERE type='buy' AND created_at>=TIMESTAMP '2026-01-01' AND IFNULL(payment_method,'') NOT IN ('manual_bonus','bonus') GROUP BY 1,2 ORDER BY n DESC LIMIT 25
