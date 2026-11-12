WITH {{BASE}}
SELECT FORMAT_DATE('%Y-%m',DATE(reg_at)) m, COUNT(*) reg, COUNTIF(verification_status='unverified') unver, COUNTIF(verification_status='unverified' AND sid_code IS NULL) unver_nosid FROM U WHERE DATE(reg_at)>='2025-10-01' GROUP BY 1 ORDER BY 1
