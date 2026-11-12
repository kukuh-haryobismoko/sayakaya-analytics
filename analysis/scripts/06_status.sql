SELECT 'users.verification_status' k, IFNULL(verification_status,'NULL') v, COUNT(*) n FROM `sayakaya.main.users` GROUP BY 2
UNION ALL SELECT 'txn.status', CONCAT(IFNULL(type,'NULL'),'|',IFNULL(status,'NULL')), COUNT(*) FROM `sayakaya.main.transactions` GROUP BY 2
UNION ALL SELECT 'txn.payment_method', IFNULL(payment_method,'NULL'), COUNT(*) FROM `sayakaya.main.transactions` GROUP BY 2
UNION ALL SELECT 'status_logs', CONCAT(IFNULL(origin_status,'NULL'),'>',IFNULL(status,'NULL')), COUNT(*) FROM `sayakaya.main.user_status_logs` GROUP BY 2
UNION ALL SELECT 'is_institution', CAST(is_institution AS STRING), COUNT(*) FROM `sayakaya.main.users` GROUP BY 2
UNION ALL SELECT 'first_sub_flag', CAST(has_completed_first_subscription AS STRING), COUNT(*) FROM `sayakaya.main.users` GROUP BY 2
