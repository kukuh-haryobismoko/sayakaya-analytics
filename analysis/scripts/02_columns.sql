SELECT table_name, column_name, data_type FROM `sayakaya.main.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('users','user_profiles','transactions','portfolios','user_status_logs','user_referrals','funds','campaigns','internal_syky','bonus_portfolios','switching_transactions')
ORDER BY table_name, ordinal_position
