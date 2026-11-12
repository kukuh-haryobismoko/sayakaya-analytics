# Data quality (Phase 1)

Run 2026-11-09 17:30-17:45 WIB. Scripts: `scripts/10_dq_users.sql`, `11_dq_txn.sql`, `13_cohort_dq.sql`, `15_hnwi.sql`, `22_churn_ga.sql` (run with `scripts/run_many.py`). All counts are over all users unless marked "cohort" (cohort = after RAIZ/RAIZKAYA exclusion, before HNWI exclusion; n = 63,912).

| # | Issue | Count | Handling |
|---|---|---|---|
| 1 | Duplicate user id / email | 0 / 0 (320,606 users) | None needed |
| 2 | Duplicate `sid_code` | 2 SIDs, 4 users (all in cohort) | Keep. SID is not a join key for the funnel; use `user_id` |
| 3 | Users with no `sid_code` | 47,194 (cohort: 47,187 = 63,912 minus 16,725 with SID) | Expected: SID is issued after KYC (cohort: 41,022 unverified, 6,114 failed, of which 23 have a SID). Not an error |
| 4 | `verified` but no `sid_code` | 74 (cohort: 16,776 verified, 74 without SID) | Keep as verified; SID only matters for the HNWI join |
| 5 | `verified` but `verified_at` NULL | 4,118 (all users); cohort 4,101 (16,776 verified, 12,675 with date) | Do not use `verified_at` alone for old users. Use `verification_status` for state and `verified_at` only for timing, state n |
| 6 | Not verified but `verified_at` set | 3 (cohort: failed with date) | Ignore the date, use status |
| 7 | `user_status_logs` coverage | 1,000 rows, starts 2026-07-21. 0 logs for verifications before 2026-07 (Oct 2025 to Jun 2026 have 0 logs, Jul 2026: 17 of 48) | Cannot build KYC timing/rejection-reason funnel before 2026-07-21. Use logs only from Aug 2026 |
| 8 | `has_completed_first_subscription` unreliable | 655 true vs 260,219 users with a real buy in all users | Do not use this flag. Derive Investor from `transactions` |
| 9 | Buy before the user's `created_at` | 39,591 buys overall (39,324 are RAIZ users, bulk migration); cohort 267 of 47,290 buys | Keep the buy, use the buy date as first investment. Report as timestamp anomaly; Phase 2 will measure funnel timing with and without them |
| 10 | Buy before `verified_at` | 446 overall; cohort 34 | Same as #9 |
| 11 | Buyers whose status is not `verified` | 256,183 buys overall (RAIZ migrated users); cohort 21 buys | Investor definition does not require status `verified`. Cohort: 21 buys |
| 12 | Transactions with null `transaction_number` | 27,719 (liquidation 25,022 + reinvestment 76 etc.) | Not a join key; ignore |
| 13 | `amount` <= 0 | 30 | Excluded from any amount totals in Phase 2 (count kept for events) |
| 14 | `completed_at` / `paid_at` before `created_at` | 2 / 3 | Immaterial; use `created_at` for dates |
| 15 | Settled status without `completed_at` | 143 | Use `created_at` as the activity date |
| 16 | Bonus transactions (`payment_method` `bonus` / `manual_bonus`) | 11,544 | Excluded from Investor and churn activity (not paid by the user) |
| 17 | Referrer values | NULL 57,538; empty string 8; `RAIZKAYA` 255,195; `RAIZ` 1,499; 666 distinct; 0 case or whitespace variants | Exclusion expression from `00_rules.md` used as is; empty string stays in the cohort |
| 18 | Internal / test accounts | 27 in `main.internal_syky` (all in cohort); 85 emails at @sayakaya.id/.com (84 in cohort); 57 emails matching test/dummy/demo (pattern only, not checked) | Kept in the cohort, as the rules do not exclude them (27 = 0.04% of 63,793). Open question 2 in `progress.md` |
| 19 | Institutions (`is_institution`) | 39 overall; cohort after HNWI exclusion: 15 (5 investors) | Kept. Open question 3 in `progress.md` |
| 20 | Inconsistent status values | `users.verification_status`: unverified / verified / failed only. `pending_verification` exists only as `origin_status` in logs. Transactions: completed 381,636; expired 2,811; cancelled 2,673; verified_by_operational 75; completed_payment 34; verified 27; pending_payment 3 | Successful = completed, completed_payment, verified, verified_by_operational |
| 21 | Unverified users with KYC data | cohort unverified 41,022: 1,439 have ID number, 3,322 have selfie | These are in-progress or abandoned KYC; not counted as submitted until resolved (see definitions.md) |
| 22 | Orphans | `user_profiles` vs `users`: 0 orphans both ways; transactions without user: 0; portfolios without user: 0 | None needed |
| 23 | Snapshot AUM table | `portfolio_with_code` has 235,735 rows per day, 2026-01-14 to 2026-11-09; `created_at` is one day after the AUM day it represents | HNWI uses the table by `created_at` date as is (consistent with the dashboard HNWI tab) |
| 24 | Timezone DB vs GA | DB: `users.created_at`, `verified_at` are naive DATETIME in UTC (latest 10:22 at 17:32 WIB); `transactions` and logs are TIMESTAMP UTC. GA: `event_date` is already WIB (table `events_20261105` spans 2026-11-04 17:02Z to 2026-11-05 16:59Z, checked for one day) | DB: convert with `DATETIME_ADD(x, INTERVAL 7 HOUR)` / `DATE(ts,'Asia/Jakarta')`. GA: use `event_date` as is |
| 25 | GA `user_id` coverage | Only set after login. 2,869 of 3,375 devices (85%) have rows without `user_id` in 2026-10-01 to 2026-11-08; `first_open` has 0 users. 2,254 of 2,257 GA `user_id`s match `main.users.id` | Pre-login steps can only be counted by device (`user_pseudo_id`); device-to-user mapping only after login. Funnel stages before login are device-level |
| 26 | GA exclusion mapping | 2,257 GA users (2026-10-01 to 2026-11-08): 3 not in DB, 144 RAIZ/RAIZKAYA, 77 HNWI, 2,033 kept | Exclusion applied through `user_id`; non-login devices cannot be excluded (see #25) |
| 27 | GA vs DB, first look (not like-for-like) | GA `register_success` 797 users (all users) vs DB registered 833 (cohort B), 2026-10-01 to 2026-11-08. GA `kyc_success` 623 users vs DB verified 573 | Not comparable: GA side is not yet excluded. Phase 2 redoes it with the same exclusion on both sides |

Not checked this phase: email/notification logs (in Supabase, not BigQuery), refreshed freshness of the scheduled copies of `main.*`, `kalcer`, `dormant` and `ml.churn_features` datasets.
