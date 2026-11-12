WITH {{BASE}},
V AS (SELECT U.id, FORMAT_DATE('%Y-%m',DATE(U.ver_at)) vm, DATE(U.ver_at) vd, B.first_buy, DATETIME_DIFF(B.first_buy,U.ver_at,DAY) dd FROM U LEFT JOIN B ON B.user_id=U.id WHERE U.verification_status='verified' AND U.ver_at IS NOT NULL)
SELECT vm, COUNT(*) ver, COUNTIF(first_buy IS NOT NULL) ever_buy, COUNTIF(dd<=7) b7, COUNTIF(dd<=30) b30, COUNTIF(first_buy IS NULL) never FROM V WHERE vd>='2025-10-01' GROUP BY 1 ORDER BY 1
