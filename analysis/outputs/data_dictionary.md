# Data dictionary (Phase 1)

Source of truth: BigQuery project `sayakaya`, location asia-southeast2. Run read-only with the repo service-account key (`analysis/scripts/bq.js`, SELECT only).
`main.*` are scheduled copies (`-sc`) of the production Postgres, not live reads. Freshness: `users.created_at` max 2026-11-09 10:22 UTC at run time; copy schedule not re-verified in this phase.

## Tables

| Table | Rows | Key columns | Use |
|---|---|---|---|
| `main.users` | 320,606 | `id`, `email`, `created_at` (DATETIME, UTC), `verification_status` (`unverified`/`verified`/`failed`), `verified_at` (DATETIME, UTC), `sid_code`, `referrer_code`, `sales_code`, `referral_code`, `is_institution`, `has_completed_first_subscription` (unreliable, see data_quality) | Register, KYC state, cohort exclusion |
| `main.user_profiles` | 320,606 (1:1 with users) | `user_id`, `id_number`, `selfie_with_id_photo_url`, `signature_image_url`, `risk_level`, `birthdate`, `monthly_income`, `occupation` | KYC form completeness (never output PII) |
| `main.user_status_logs` | 1,000 | `user_id`, `origin_status`, `status`, `created_at` (TIMESTAMP) | KYC transitions, only since 2026-07-21 |
| `main.transactions` | 387,259 | `user_id`, `type` (buy/sell/liquidation/reinvestment/SWITCH_IN/SWITCH_OUT), `status`, `payment_method`, `amount`, `final_amount`, `promo_code`, `fund_id`, `created_at`/`completed_at`/`paid_at` (TIMESTAMP, UTC), `transaction_number` | Investor, activity, churn |
| `main.portfolios` | 236,222 | `user_id`, `fund_id`, `unit`, `created_at` | Current holdings |
| `main.bonus_portfolios` | n/a | `user_id`, `promo_code`, `status` | Bonus units (not real investment) |
| `main.funds` | 50 columns | `id`, `type`, `listing_status`, `latest_nav_value`, `currency` | Fund attributes |
| `main.campaigns` | n/a | `promo_code`, `campaign_type`, `start_date`, `end_date`, `bonus_amount` | Promo / voucher |
| `main.user_referrals` | n/a | `user_id`, `referrer_id` | Referral edge |
| `main.internal_syky` | 27 | `email` | Internal accounts list |
| `mi_fee_logs.portfolio_with_code` | 235,735 rows per daily snapshot | `sid_code`, `fund`, `amount`, `created_at` (TIMESTAMP) | AUM per SID; partitions 2026-01-14 to 2026-11-09. `created_at` is a day ahead of the AUM date it represents |
| `analytics_266759216.events_YYYYMMDD` | 836 tables, 2026-02-04 to 2026-11-08 | `event_name`, `user_id` (= `main.users.id`, set at login), `user_pseudo_id` (device), `event_params`, `platform` (ANDROID/IOS), `event_timestamp` | GA4 BigQuery export |
| `adjust_analytics.events` | n/a | | Install attribution (not used yet) |

Not in the warehouse: notification and email send logs. Email logs live in the dashboard's Supabase project (`dashboard_*` tables, e.g. `dashboard_email_tracking`), not in BigQuery. Push events (`notification_receive/open/click/dismiss`) are in GA4. Supabase MCP is read-only; not queried in this phase.

## Cohort fields
- **referrer_code**: `main.users.referrer_code`. Exclusion expression from `00_rules.md`. Values: NULL 57,538; empty string 8; `RAIZKAYA` 255,195; `RAIZ` 1,499; 666 distinct codes in total; no case or whitespace variants.
- **HNWI**: no flag on the user table. Rule derived from `mi_fee_logs.portfolio_with_code` (see definitions.md). `is_institution` is a separate flag (39 users) and is not HNWI.
- **Promo / voucher**: `transactions.promo_code`, `campaigns.promo_code`, `bonus_portfolios.promo_code`. Bonus units arrive as `payment_method` `bonus` or `manual_bonus` (11,544 transactions), not as paid investment.

## GA4 events mapped to funnel stages (window 2026-10-01 to 2026-11-08, all users, before exclusion)

| Stage | Event | Events | Users (user_id) | Devices |
|---|---|---|---|---|
| Install | `first_open` | 1,159 | 0 (pre-login) | 1,159 |
| Register intent | `register_click` (param `method`, 3 values), `continue_with_google_click` | 788 / 994 | 10 / 22 | 509 / 653 |
| Register | `register_success`, `continue_with_google_success` | 831 / 732 | 797 / 14 | 816 / 561 |
| OTP | `otp_on_submit` | 2,041 | 35 | 1,112 |
| KYC start | `kyc_start` | 1,467 | 759 | 771 |
| KYC submitted | `kyc_success` | 702 | 623 | 629 |
| Verified user opens app | `hfm_view` (verified home), `hfm_ready_unverified` (unverified home) | 13,077 / 1,106 | 1,552 / 658 | |
| Order | `buy_bottom_sheet`, `order_button`, `order_created` | 1,325 / 880 / 996 | 374 / 318 / 314 | |
| First investment / payment | `payment_complete` | 565 | 265 | 274 |
| Activity | `session_start`, `screen_view`, `user_engagement`, `redeem_click`, `confirm_redeem_click`, `switch_click` | see raw | | |
| Passive (not activity) | `notification_receive`, `notification_dismiss`, `app_remove`, `os_update`, `app_update` | | | |

Params: the funnel events carry almost no custom params (only `engaged_session_event`, and `method` on `register_click`). Order amount and fund are not in GA params, so GA cannot size revenue; use the DB. `app_remove` is Android only.
Source script: `analysis/scripts/04_ga_events.sql`, `15_hnwi.sql` (ga_funnel_params).
