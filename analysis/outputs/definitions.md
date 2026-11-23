# Definitions (Phase 1)

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22; first purchase on or before 2026-07-25), so every user had the same time to buy again. Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21, 52 days).

Timezone: Asia/Jakarta everywhere. "Successful" transaction status = `completed`, `completed_payment`, `verified`, `verified_by_operational`. Bonus payments (`payment_method` `bonus`/`manual_bonus`) never count as user action.

## Cohort
Analysis cohort = `main.users` where `(referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA'))` AND the user is not HNWI.

## Stage counts, before and after exclusion
Source: `scripts/20_cohort_stages.sql`, refreshed 2026-11-22. Investor = first successful non-bonus `buy` (below). Window: all time, to 2026-11-22.

| Step | Registered | KYC verified | KYC failed | Investors |
|---|---|---|---|---|
| A. Raw | 321,087 | 17,536 | 6,256 | 260,249 |
| B. Minus RAIZ/RAIZKAYA (256,694 users) | 64,393 | 17,100 | 6,150 | 3,736 |
| C. Minus HNWI (analysis cohort) | 64,274 | 16,981 | 6,150 | 3,617 |
| HNWI removed from B | 119 | 119 | 0 | 119 |
| HNWI that were also RAIZ | 0 | 0 | 0 | 0 |
| Institutions still in C | 15 | 15 | 0 | 5 |

Reading: 79.9% of registered users are RAIZ/RAIZKAYA migrations, so ignoring the exclusion would inflate the register-to-investor funnel (81.1% raw vs 5.6% in cohort C). Observed.

What this means: four in five accounts are migrated from RAIZ, not new sign-ups, so counting them would make the funnel look far better than it is.

## Register
A row in `main.users` (`created_at`, WIB = UTC+7). GA counterpart: `register_success` (by `user_id`).

## KYC
- **Submitted:** `verification_status` in (`verified`, `failed`). Cohort C: 16,981 + 6,150 = 23,131. Unresolved: unverified users that hold a selfie (3,322 in cohort B, as of 2026-11-09, not refreshed) are in progress or abandoned; they are reported separately as "started, not finished", not as submitted. GA counterpart: `kyc_start` (opened) and `kyc_success` (submitted).
- **Approved:** `verification_status = 'verified'`. Timing from `verified_at` (missing for 4,023 verified users in cohort C; 4,118 in all users as of 2026-11-09, not refreshed; DQ #5). Logs for the timing only from 2026-07-21.
- **Rejected:** `verification_status = 'failed'`. Rejection reasons are not in the tables read in Phase 1 (data request below).

## Investor
First successful `buy` that is not a bonus (`type='buy'`, successful status, `payment_method` not in `bonus`/`manual_bonus`). Investor date = `MIN(created_at)` of those, WIB. Does not require `verification_status='verified'`; cohort C has 21 investors whose status is not verified (DQ #11). GA counterpart: `payment_complete`.

## Churned
Activity = successful non-bonus `buy`, `sell`, `SWITCH_IN`, one per Jakarta day (`scripts/21_churn_final.sql`, `23_gap_dist.sql`, cohort C). A user is **churned** when they have no activity for more than **90 days** (observed at the refresh date, 2026-11-22). Not churned yet if the last activity is within 90 days.

Distribution of gaps between consecutive active days (40,875 gaps, 3,193 users with at least two active days):

| Gap days | Gaps | Share |
|---|---|---|
| 0-7 | 15,604 | 38.2% |
| 8-14 | 6,395 | 15.6% |
| 15-30 | 8,066 | 19.7% |
| 31-60 | 5,152 | 12.6% |
| 61-90 | 1,801 | 4.4% |
| 91-120 | 998 | 2.4% |
| 121-180 | 946 | 2.3% |
| 181-270 | 723 | 1.8% |
| 271-365 | 368 | 0.9% |
| >365 | 822 | 2.0% |

Percentiles of the gap: p50 13, p75 32, p90 86, p95 168, p99 525 days.

Of gaps longer than T days, the share of users who came back (returned / (returned + still silent)):

| T | 30 | 60 | 90 | 120 | 150 | 180 | 270 | 365 |
|---|---|---|---|---|---|---|---|---|
| Came back | 75.1% | 62.3% | 53.7% | 46.9% | 41.9% | 38.5% | 29.7% | 25.7% |

Why 90: the p90 of normal gaps is 86 days, so 90 days sits just above 90% of the observed gaps; and beyond 90 days returning is below 54% and falls slowly (no sharp drop to pick a different cutoff). The dashboard's win-back view uses 179 days; 90 days is the stricter, earlier-warning line. Sensitivity (180 days) will be shown in Phase 2. Inferred: 90 vs 180 changes who counts as churned, not the shape of the funnel.

Result at the refresh date, cohort C (3,617 investors, buy dates only): 3,163 (87.4%) silent for more than 90 days; 3,026 (83.7%) for more than 180; 454 active within 90 days; 1,475 (40.8%) bought on only one day. Observed. Churn measured from buys only here, while the gap table also counts sells and switches (3,951 users have such activity, 334 more than the 3,617 investors: Inferred: bonus-only holders or sell/switch without a non-bonus buy; not checked). With the single activity definition used in Phase 2 (buy, sell, switch-in), 3,008 investors are churned (more than 90 days) and 609 are active.

What this means: about 7 in 8 investors have not bought, sold or switched in the last 90 days, and 4 in 10 bought on one day only, so most first-time investors do not come back.

## HNWI
**HNWI = a user whose SID had total AUM of at least Rp500,000,000 on any daily snapshot of `mi_fee_logs.portfolio_with_code` (from 2026-01-14; first partition date as of 2026-11-09, not refreshed).** AUM per SID = sum of `amount` over the SID's rows per `DATE(created_at)`.

Why: (1) the HNWI bonus program in `public/hnwi-bonus-config.js` uses `minAum: 500000000`; (2) there is no HNWI flag on the user table. Counts: 119 users ever (all verified, all investors, none RAIZ). On the latest snapshot (2026-11-22) 65 SIDs are at or above the line (7 are institutions); distribution of SIDs by AUM on that day: <1 jt 231,562; 1-10 jt 486; 10-100 jt 339; 100-500 jt 154; 500 jt-1 M 32; >=1 M 33 (232,606 SIDs with a positive balance). "Ever" is used so a user whose AUM fell later is not pulled back into the retail cohort. Alternative not used: static table `mi_fee_logs.data_hnwi` (115 rows, with PII columns; refresh date unknown; as of 2026-11-09, not refreshed). Inferred: this threshold matches the company's own program, not a legal definition; confirm with the business (open question 1).

What this means: HNWI are a small group (119 of 64,393 users) with very large balances, so they are kept out of the retail averages.

Script: `scripts/16_hnwi_ever.sql` (3.16 GB scanned as of 2026-11-09, not refreshed), `scripts/15_hnwi.sql` (snapshot 2026-11-22).

## Timezone
DB `DATETIME`/`TIMESTAMP` are UTC; shift +7h. GA export `event_date` is already WIB (re-checked on one day, DQ #24).
