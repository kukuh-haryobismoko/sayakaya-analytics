# Funnel overview (Phase 2)
Run 2026-11-09 18:34 WIB. Cohort C (excl. RAIZ/RAIZKAYA and HNWI), all-time to 2026-11-09, Asia/Jakarta. Scripts: `40_funnel.sql`, `41_timing.sql`, `42_cohorts.sql`, `46_leak.sql` (via `q.py`, `build_phase2.py`). All numbers Observed unless labelled.

## 1. Stage conversion (n = 63,795 registered)
| Stage | Users | % of registered | Step conversion | 95% CI of step |
|---|---|---|---|---|
| Registered | 63,795 | 100% | | |
| KYC submitted (verified or failed) | 22,773 | 35.7% | 35.7% of registered | 35.3-36.1% |
| KYC approved | 16,659 | 26.1% | 73.2% of submitted | 72.6-73.7% |
| KYC rejected | 6,114 | 9.6% | 26.8% of submitted | 26.3-27.4% |
| Investor (first paid buy) | 3,587 | 5.6% | 21.5% of approved | 20.9-22.2% |
| Repeat investor (buys on 2+ days) | 2,132 | 3.3% | 59.4% of investors | 57.8-61.0% |
| Still active (last activity within 90 d) | 587 | 0.9% | 16.4% of investors | 15.2-17.6% |
| Churned (no activity > 90 d) | 3,000 | | 83.6% of investors | 82.4-84.8% |

Not finished KYC (status unverified): 41,021 = 64.3% of registered. Investors not verified: 21. Verified, never bought: 13,093 = 78.6% of approved.
Churn base note: 128 investors made their first buy within 90 days, so are not yet classifiable; excluding them churn is 3,000 / 3,459 = 86.7%.
Sensitivity: with a 180-day line, 2,742 of 3,587 investors are churned (76.4%) vs 83.6% at 90 days; the funnel shape does not change.
Cohort size is 63,795, 2 more than the 63,793 of Phase 1: users who registered after the Phase 1 run (Observed; same rules).
Churn count here (activity = buy, sell, SWITCH_IN) is 3,000. Phase 1 `definitions.md` quoted 3,165 using buys only; the 165 difference are users whose last buy is older than 90 d but who sold or switched in the last 90 d (`49_chk.sql`). Phase 2 uses the activity definition.

Before/after exclusion (Observed, Phase 1 `20_cohort_stages.sql`): registered 320,606 -> 63,912 (excl. RAIZ/RAIZKAYA) -> 63,793 (excl. HNWI); approved 17,210 -> 16,776 -> 16,657; investors 260,219 -> 3,706 -> 3,587.

## 2. Time between stages (days, cohort C; users with a valid timestamp pair)
| Transition | n | p50 | p90 | Pairs with negative gap (dropped) |
|---|---|---|---|---|
| Register -> approved | 12,636 | 0.62 | 3.63 | 0 |
| Approved -> first buy | 2,369 | 1.03 | 90.77 | 10 |
| Register -> first buy | 3,587 | 5.58 | 243.7 | 19 |

n for register -> approved is lower than 16,659 approved because `verified_at` is empty for 4,023 approved users (data quality #5). Reading: half of approved users are approved within a day, 90% within about 4 days; buyers who buy do it fast (median about 1 day after approval) but the p90 is 91 days, so a long tail buys much later.

## 3. Register cohorts by month (full table: `cohorts.csv`, chart: `charts/cohort_monthly.png`)
| Reg month | Registered | Approved | Approved % | Investor within 7 d | Within 7 d % | Investor ever % |
|---|---|---|---|---|---|---|
| 2025-10 | 450 | 233 | 51.8% | 36 | 8.0% | 11.1% |
| 2025-11 | 220 | 95 | 43.2% | 43 | 19.5% | 24.1% |
| 2025-12 | 208 | 78 | 37.5% | 26 | 12.5% | 17.3% |
| 2026-01 | 448 | 167 | 37.3% | 54 | 12.1% | 15.8% |
| 2026-02 | 235 | 91 | 38.7% | 22 | 9.4% | 13.6% |
| 2026-03 | 260 | 105 | 40.4% | 21 | 8.1% | 10.8% |
| 2026-04 | 217 | 75 | 34.6% | 13 | 6.0% | 7.8% |
| 2026-05 | 147 | 59 | 40.1% | 12 | 8.2% | 11.6% |
| 2026-06 | 138 | 54 | 39.1% | 8 | 5.8% | 10.1% |
| 2026-07 | 126 | 46 | 36.5% | 7 | 5.6% | 8.7% |
| 2026-08 | 97 | 58 | 59.8% | 11 | 11.3% | 17.5% |
| 2026-09 | 132 | 68 | 51.5% | 21 | 15.9% | 19.7% |
| 2026-10 | 611 | 425 | 69.6% | 31 | 5.1% | 7.0% |
| 2026-11 | 247 | 157 | 63.6% | 36 | 14.6% | 14.6% |

Recent months are not mature (a 2026-11 user has had at most 9 days). Compare 7-day conversion, which is mature for all months through 2026-11-02.

## 4. Biggest leaks and recoverable users (arithmetic shown)

### Leak 1. Registered but KYC not finished
- Observed: 41,021 of 63,795 (64.3%) never reached a KYC result. Last 13 registration months (2025-11 to 2026-11): 1,315 of 3,086 (42.6%).
- Observed: Jan-Sep 2026 cohorts left 892 of 1,800 (49.6%) unfinished; the Oct 2026 cohort (booth month) left 141 of 611 (23.1%). Difference significant (z = -11.4).
- Estimate: if Jan-Sep cohorts had finished like Oct, 892 - 1,800 x 141/611 = 477 more users reach KYC result. At the Jan-Sep investor-per-approved rate (233 / 723 = 32.2% ever) that is about 154 investors; at the Oct verified-to-buy-within-7-days rate (33 / 430 = 7.7%) about 37. Assumption: the Oct pattern is reproducible outside booths (not tested).

### Leak 2. Approved but never buys (largest in user count)
- Observed: 13,093 of 16,659 approved users (78.6%) never made a paid buy. Approved from 2025-11 on: 1,094 of 1,506 (72.6%) never bought.
- Observed: users approved in Oct 2026 bought within 7 days at 33 / 430 = 7.7% (5.5-10.6%) vs Jan-Sep 2026 197 / 730 = 27.0% (23.9-30.3%); z = -8.0. More approvals did not bring more buyers.
- Estimate: Oct approvals at the Jan-Sep rate would be 430 x 197/730 = 116 buyers within 7 days; observed 33; shortfall 83 investors. Oct cohort buying may still arrive later, so treat the shortfall as an upper bound (Observed: the 30-day figure for early-Oct approvals is 44 of 430).
- Pool: each +1 percentage point of the 1,094 recent never-buyers = 11 investors.
- Observed (`52_oct_split.sql` cut of the Oct 2026 cohort, 611 registered): with a sales code 363 registered, 271 approved, 26 bought ever = 7.2%; without 219 registered, 130 approved, 14 bought = 6.4%. Both are low, so the Oct drop is not only a booth effect. Cause not identified; Phase 3 should look at what the booth sign-up flow asks users to do after KYC.

### Leak 3. First-time investors who do not come back (churn)
- Observed: 3,000 of 3,587 investors are silent for more than 90 days (83.6%); 2,742 for more than 180 d. 1,455 (40.6%) bought on only one day. See `churn_profile.md`.
- Estimate: each +10% of churned users reactivated = 300 users (Proposed; no observed reactivation campaign rate in data yet).

### Leak 4. KYC rejection
- Observed: 6,114 rejected of 22,773 submitted (26.8%); last 13 months 293 of 1771 (16.5%). Rejection reasons are not in BigQuery (data request).
- Estimate (Proposed): halving the last-13-month rejection count recovers 146 approved users, about 31 investors at the all-time investor-per-approved rate (21.5%).

## 5. Verified-to-buy by month of approval (`46_leak.sql`)
| Approval month | Approved | Bought within 7 d | % | Never bought (to date) |
|---|---|---|---|---|
| 2025-10 | 229 | 39 | 17.0% | 178 |
| 2025-11 | 96 | 46 | 47.9% | 44 |
| 2025-12 | 83 | 31 | 37.3% | 43 |
| 2026-01 | 149 | 55 | 36.9% | 86 |
| 2026-02 | 92 | 27 | 29.3% | 58 |
| 2026-03 | 120 | 29 | 24.2% | 84 |
| 2026-04 | 77 | 16 | 20.8% | 60 |
| 2026-05 | 56 | 14 | 25.0% | 38 |
| 2026-06 | 60 | 10 | 16.7% | 44 |
| 2026-07 | 47 | 8 | 17.0% | 36 |
| 2026-08 | 55 | 12 | 21.8% | 41 |
| 2026-09 | 74 | 26 | 35.1% | 44 |
| 2026-10 | 430 | 33 | 7.7% | 386 |
| 2026-11 | 167 | 37 | 22.2% | 130 |

Within-7-day count includes the few users who bought before `verified_at` (data quality #10).
