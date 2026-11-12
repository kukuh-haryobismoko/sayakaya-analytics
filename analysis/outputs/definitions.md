# Definitions (Phase 1)

Timezone: Asia/Jakarta everywhere. "Successful" transaction status = `completed`, `completed_payment`, `verified`, `verified_by_operational`. Bonus payments (`payment_method` `bonus`/`manual_bonus`) never count as user action.

## Cohort
Analysis cohort = `main.users` where `(referrer_code IS NULL OR UPPER(TRIM(referrer_code)) NOT IN ('RAIZ','RAIZKAYA'))` AND the user is not HNWI.

## Stage counts, before and after exclusion
Source: `scripts/20_cohort_stages.sql`, run 2026-11-09 17:32 WIB. Investor = first successful non-bonus `buy` (below). Window: all time, to 2026-11-09.

| Step | Registered | KYC verified | KYC failed | Investors |
|---|---|---|---|---|
| A. Raw | 320,606 | 17,210 | 6,220 | 260,219 |
| B. Minus RAIZ/RAIZKAYA (256,694 users) | 63,912 | 16,776 | 6,114 | 3,706 |
| C. Minus HNWI (analysis cohort) | 63,793 | 16,657 | 6,114 | 3,587 |
| HNWI removed from B | 119 | 119 | 0 | 119 |
| HNWI that were also RAIZ | 0 | 0 | 0 | 0 |
| Institutions still in C | 15 | 15 | 0 | 5 |

Reading: 80% of registered users are RAIZ/RAIZKAYA migrations, so ignoring the exclusion would inflate the register-to-investor funnel (81% raw vs 5.6% in cohort C). Observed.

## Register
A row in `main.users` (`created_at`, WIB = UTC+7). GA counterpart: `register_success` (by `user_id`).

## KYC
- **Submitted:** `verification_status` in (`verified`, `failed`). Cohort C: 16,657 + 6,114 = 22,771. Unresolved: unverified users that hold a selfie (3,322 in cohort B) are in progress or abandoned; they are reported separately as "started, not finished", not as submitted. GA counterpart: `kyc_start` (opened) and `kyc_success` (submitted).
- **Approved:** `verification_status = 'verified'`. Timing from `verified_at` (missing for 4,118 verified users; DQ #5). Logs for the timing only from 2026-07-21.
- **Rejected:** `verification_status = 'failed'`. Rejection reasons are not in the tables read in Phase 1 (data request below).

## Investor
First successful `buy` that is not a bonus (`type='buy'`, successful status, `payment_method` not in `bonus`/`manual_bonus`). Investor date = `MIN(created_at)` of those, WIB. Does not require `verification_status='verified'`; cohort C has 21 buys by non-verified users (DQ #11). GA counterpart: `payment_complete`.

## Churned
Activity = successful non-bonus `buy`, `sell`, `SWITCH_IN`, one per Jakarta day (`scripts/21_churn_final.sql`, `23_gap_dist.sql`, cohort C). A user is **churned** when they have no activity for more than **90 days** (observed at the run date). Not churned yet if the last activity is within 90 days.

Distribution of gaps between consecutive active days (40,658 gaps, 3,181 users with at least two active days):

| Gap days | Gaps | Share |
|---|---|---|
| 0-7 | 15,508 | 38.1% |
| 8-14 | 6,356 | 15.6% |
| 15-30 | 8,027 | 19.7% |
| 31-60 | 5,134 | 12.6% |
| 61-90 | 1,793 | 4.4% |
| 91-120 | 995 | 2.4% |
| 121-180 | 943 | 2.3% |
| 181-270 | 717 | 1.8% |
| 271-365 | 367 | 0.9% |
| >365 | 818 | 2.0% |

Percentiles of the gap: p50 13, p75 32, p90 86, p95 167, p99 523 days.

Of gaps longer than T days, the share of users who came back (returned / (returned + still silent)):

| T | 30 | 60 | 90 | 120 | 150 | 180 | 270 | 365 |
|---|---|---|---|---|---|---|---|---|
| Came back | 75.2% | 62.3% | 53.7% | 46.9% | 41.9% | 38.5% | 29.8% | 25.9% |

Why 90: the p90 of normal gaps is 86 days, so 90 days sits just above 90% of the observed gaps; and beyond 90 days returning is below 54% and falls slowly (no sharp drop to pick a different cutoff). The dashboard's win-back view uses 179 days; 90 days is the stricter, earlier-warning line. Sensitivity (180 days) will be shown in Phase 2. Inferred: 90 vs 180 changes who counts as churned, not the shape of the funnel.

Result at the run date, cohort C (3,587 investors, buy dates only): 3,165 (88.2%) silent for more than 90 days; 3,014 (84.0%) for more than 180; 422 active within 90 days; 1,455 (40.6%) bought on only one day. Observed. Churn measured from buys only here, while the gap table also counts sells and switches (3,917 users have such activity, 330 more than the 3,587 investors: Inferred: bonus-only holders or sell/switch without a non-bonus buy; not checked). Phase 2 uses a single activity definition.

## HNWI
**HNWI = a user whose SID had total AUM of at least Rp500,000,000 on any daily snapshot of `mi_fee_logs.portfolio_with_code` (from 2026-01-14).** AUM per SID = sum of `amount` over the SID's rows per `DATE(created_at)`.

Why: (1) the HNWI bonus program in `public/hnwi-bonus-config.js` uses `minAum: 500000000`; (2) there is no HNWI flag on the user table. Counts: 119 users ever (all verified, all investors, none RAIZ). On the latest snapshot (2026-11-09) 65 SIDs are at or above the line (8 are institutions); distribution of SIDs by AUM on that day: <1 jt 231,556; 1-10 jt 460; 10-100 jt 330; 100-500 jt 159; 500 jt-1 M 31; >=1 M 34. "Ever" is used so a user whose AUM fell later is not pulled back into the retail cohort. Alternative not used: static table `mi_fee_logs.data_hnwi` (115 rows, with PII columns; refresh date unknown). Inferred: this threshold matches the company's own program, not a legal definition; confirm with the business (open question 1).

Script: `scripts/16_hnwi_ever.sql` (3.16 GB scanned), `scripts/15_hnwi.sql`.

## Timezone
DB `DATETIME`/`TIMESTAMP` are UTC; shift +7h. GA export `event_date` is already WIB (checked on one day, DQ #24).
