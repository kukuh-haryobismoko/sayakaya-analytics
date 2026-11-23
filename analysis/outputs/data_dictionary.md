# Data dictionary (Phase 1)

Source of truth: BigQuery project `sayakaya`, location asia-southeast2. Run read-only with the repo service-account key (`analysis/scripts/bq.js`, SELECT only).
`main.*` are scheduled copies (`-sc`) of the production Postgres, not live reads. Refreshed 2026-11-22. Freshness: `users.created_at` max 2026-11-22 11:22 UTC and `transactions.created_at` max 2026-11-22 10:50 UTC at run time; copy schedule not re-verified in this phase.

## Tables

| Table | Rows | Key columns | Use |
|---|---|---|---|
| `main.users` | 321,087 | `id`, `email`, `created_at` (DATETIME, UTC), `verification_status` (`unverified`/`verified`/`failed`), `verified_at` (DATETIME, UTC), `sid_code`, `referrer_code`, `sales_code`, `referral_code`, `is_institution`, `has_completed_first_subscription` (unreliable, see data_quality) | Register, KYC state, cohort exclusion |
| `main.user_profiles` | 321,087 (1:1 with users) | `user_id`, `id_number`, `selfie_with_id_photo_url`, `signature_image_url`, `risk_level`, `birthdate`, `monthly_income`, `occupation` | KYC form completeness (never output PII) |
| `main.user_status_logs` | 1,420 | `user_id`, `origin_status`, `status`, `created_at` (TIMESTAMP) | KYC transitions, only since 2026-07-21 |
| `main.transactions` | 387,833 | `user_id`, `type` (buy/sell/liquidation/reinvestment/SWITCH_IN/SWITCH_OUT), `status`, `payment_method`, `amount`, `final_amount`, `promo_code`, `fund_id`, `created_at`/`completed_at`/`paid_at` (TIMESTAMP, UTC), `transaction_number` | Investor, activity, churn |
| `main.portfolios` | 236,203 | `user_id`, `fund_id`, `unit`, `created_at` | Current holdings |
| `main.bonus_portfolios` | n/a | `user_id`, `promo_code`, `status` | Bonus units (not real investment) |
| `main.funds` | 50 columns | `id`, `type`, `listing_status`, `latest_nav_value`, `currency` | Fund attributes |
| `main.campaigns` | n/a | `promo_code`, `campaign_type`, `start_date`, `end_date`, `bonus_amount` | Promo / voucher |
| `main.user_referrals` | n/a | `user_id`, `referrer_id` | Referral edge |
| `main.internal_syky` | 27 | `email` | Internal accounts list |
| `mi_fee_logs.portfolio_with_code` | about 235,750 rows per daily snapshot (235,748 to 235,755 on 2026-11-19 to 2026-11-22) | `sid_code`, `fund`, `amount`, `created_at` (TIMESTAMP) | AUM per SID; partitions 2026-01-14 (as of 2026-11-09, not refreshed) to 2026-11-22. `created_at` is a day ahead of the AUM date it represents |
| `analytics_266759216.events_YYYYMMDD` | 836 tables, 2026-02-04 to 2026-11-08 (as of 2026-11-09, not refreshed; this run read the tables up to 2026-11-21, so the table count is not re-counted) | `event_name`, `user_id` (= `main.users.id`, set at login), `user_pseudo_id` (device), `event_params`, `platform` (ANDROID/IOS), `event_timestamp` | GA4 BigQuery export |
| `adjust_analytics.events` | n/a | | Install attribution (not used yet) |

Not in the warehouse: notification and email send logs. Email logs live in the dashboard's Supabase project (`dashboard_*` tables, e.g. `dashboard_email_tracking`), not in BigQuery. Push events (`notification_receive/open/click/dismiss`) are in GA4. Supabase MCP is read-only; not queried in this phase.

## Cohort fields
- **referrer_code**: `main.users.referrer_code`. Exclusion expression from `00_rules.md`. Values: NULL 57,997; empty string 8; `RAIZKAYA` 255,195; `RAIZ` 1,499; 668 distinct raw codes in total (`30_facts.sql`); case or whitespace variants: none (as of 2026-11-09, not refreshed).
- **HNWI**: no flag on the user table. Rule derived from `mi_fee_logs.portfolio_with_code` (see definitions.md). `is_institution` is a separate flag (39 users) and is not HNWI. HNWI ever: 119 users; on the 2026-11-22 snapshot 65 SIDs at or above Rp500 million (7 institutions).
- **Promo / voucher**: `transactions.promo_code`, `campaigns.promo_code`, `bonus_portfolios.promo_code`. Bonus units arrive as `payment_method` `bonus` or `manual_bonus` (11,557 transactions), not as paid investment.

## GA4 events mapped to funnel stages (window 2026-10-01 to 2026-11-21, 52 days, all users, before exclusion; `30_facts.sql`)

| Stage | Event | Events | Users (user_id) | Devices |
|---|---|---|---|---|
| Install | `first_open` | 1,729 | 0 (pre-login) | 1,729 |
| Register intent | `register_click` (param `method`, 3 values), `continue_with_google_click` | 1,088 / 1,528 | 12 / 31 | 723 / 1,014 |
| Register | `register_success`, `continue_with_google_success` | 1,281 / 1,138 | 1,239 / 21 | 1,259 / 877 |
| OTP | `otp_on_submit` | 2,951 | 39 | 1,604 |
| KYC start | `kyc_start` | 2,277 | 1,174 | 1,197 |
| KYC submitted | `kyc_success` | 1,099 | 962 | 972 |
| Verified user opens app | `hfm_view` (verified home), `hfm_ready_unverified` (unverified home) | 17,955 / 1,725 | 2,059 / 1,011 | 2,438 / 1,035 |
| Order | `buy_bottom_sheet`, `order_button`, `order_created` | 1,861 / 1,188 / 1,329 | 457 / 382 / 377 | 487 / 403 / 394 |
| First investment / payment | `payment_complete` | 777 | 325 | 333 |
| Activity | `session_start`, `screen_view`, `user_engagement`, `redeem_click`, `confirm_redeem_click`, `switch_click` | see raw | | |
| Passive (not activity) | `notification_receive`, `notification_dismiss`, `app_remove`, `os_update`, `app_update` | | | |

Params: the funnel events carry almost no custom params (only `engaged_session_event`, and `method` on `register_click`). Order amount and fund are not in GA params, so GA cannot size revenue; use the DB. `app_remove` is Android only.
Source script: `analysis/scripts/04_ga_events.sql`, `15_hnwi.sql` (ga_funnel_params), `30_facts.sql` (event counts).

What this means: the app records sign-up, KYC and purchase steps, but only after the user logs in, so install and sign-up-start counts are devices, not people; and GA has no amounts, so money figures must come from the database.
