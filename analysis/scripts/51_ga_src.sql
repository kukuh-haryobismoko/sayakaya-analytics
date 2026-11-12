SELECT CONCAT(IFNULL(traffic_source.source,'(null)'),' / ',IFNULL(traffic_source.medium,'(null)')) sm,
 COUNT(DISTINCT user_pseudo_id) devices,
 COUNT(DISTINCT IF(event_name='first_open',user_pseudo_id,NULL)) first_open,
 COUNT(DISTINCT IF(event_name='register_success',user_pseudo_id,NULL)) reg_dev,
 COUNT(DISTINCT IF(event_name='kyc_success',user_pseudo_id,NULL)) kyc_dev,
 COUNT(DISTINCT IF(event_name='payment_complete',user_pseudo_id,NULL)) pay_dev
FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_date BETWEEN '20261001' AND '20261108'
GROUP BY 1 ORDER BY 2 DESC LIMIT 12
