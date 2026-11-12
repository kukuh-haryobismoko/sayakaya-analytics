-- Q:status_log_cols
SELECT column_name, data_type FROM `sayakaya.main.INFORMATION_SCHEMA.COLUMNS` WHERE table_name='user_status_logs'
