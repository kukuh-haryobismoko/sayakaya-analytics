WITH {{BASE}},
F AS (SELECT U.*, B.first_buy FROM U LEFT JOIN B ON B.user_id=U.id),
T AS (SELECT DATETIME_DIFF(ver_at,reg_at,MINUTE)/1440 reg_ver, DATETIME_DIFF(first_buy,ver_at,MINUTE)/1440 ver_buy, DATETIME_DIFF(first_buy,reg_at,MINUTE)/1440 reg_buy FROM F)
SELECT 'reg_to_verified' k, COUNT(reg_ver) n, COUNTIF(reg_ver<0) neg, ROUND(APPROX_QUANTILES(IF(reg_ver>=0,reg_ver,NULL),100)[OFFSET(50)],2) p50, ROUND(APPROX_QUANTILES(IF(reg_ver>=0,reg_ver,NULL),100)[OFFSET(90)],2) p90 FROM T
UNION ALL SELECT 'verified_to_first_buy', COUNT(ver_buy), COUNTIF(ver_buy<0), ROUND(APPROX_QUANTILES(IF(ver_buy>=0,ver_buy,NULL),100)[OFFSET(50)],2), ROUND(APPROX_QUANTILES(IF(ver_buy>=0,ver_buy,NULL),100)[OFFSET(90)],2) FROM T
UNION ALL SELECT 'reg_to_first_buy', COUNT(reg_buy), COUNTIF(reg_buy<0), ROUND(APPROX_QUANTILES(IF(reg_buy>=0,reg_buy,NULL),100)[OFFSET(50)],2), ROUND(APPROX_QUANTILES(IF(reg_buy>=0,reg_buy,NULL),100)[OFFSET(90)],2) FROM T
