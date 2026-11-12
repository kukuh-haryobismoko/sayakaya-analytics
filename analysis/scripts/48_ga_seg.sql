WITH {{BASE}},
E AS (SELECT user_id, event_name, device.operating_system os, app_info.version ver, geo.region reg, traffic_source.source src, traffic_source.medium med, traffic_source.name camp
  FROM `sayakaya.analytics_266759216.events_*` WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261108' AND event_date BETWEEN '20261001' AND '20261108'
  AND user_id IS NOT NULL AND event_name IN ('register_success','kyc_success','payment_complete')),
R AS (SELECT user_id, ARRAY_AGG(STRUCT(os,ver,reg,src,med,camp) ORDER BY ver DESC LIMIT 1)[OFFSET(0)] a FROM E WHERE event_name='register_success' GROUP BY 1),
X AS (SELECT R.user_id, R.a.os os, R.a.ver ver, R.a.reg reg, CONCAT(IFNULL(R.a.src,'(null)'),' / ',IFNULL(R.a.med,'(null)')) sm, IFNULL(R.a.camp,'(null)') camp,
  EXISTS(SELECT 1 FROM E WHERE E.user_id=R.user_id AND event_name='kyc_success') kyc, EXISTS(SELECT 1 FROM E WHERE E.user_id=R.user_id AND event_name='payment_complete') pay
  FROM R JOIN U ON U.id=R.user_id),
S AS (SELECT 'source_medium' dim, sm seg, * FROM X UNION ALL SELECT 'campaign', camp, * FROM X UNION ALL SELECT 'os', IFNULL(os,'(null)'), * FROM X
  UNION ALL SELECT 'app_version', IFNULL(ver,'(null)'), * FROM X UNION ALL SELECT 'region', IFNULL(reg,'(null)'), * FROM X)
SELECT dim, seg, COUNT(*) reg, COUNTIF(kyc) kyc, COUNTIF(pay) pay FROM S GROUP BY 1,2 ORDER BY 1,3 DESC
