# Funnel overview (Phase 2)

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22; first purchase on or before 2026-07-25), so every user had the same time to buy again. Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21).
Run 2026-11-22 WIB. Cohort C (excl. RAIZ/RAIZKAYA and HNWI), all-time to 2026-11-22, Asia/Jakarta. Scripts: `40_funnel.sql`, `41_timing.sql`, `42_cohorts.sql`, `46_leak.sql` (via `q.py`, `build_phase2.py`). All numbers Observed unless labelled.

## 1. Stage conversion (n = 64,274 registered)

| Stage | Users | % of registered | Step conversion | 95% CI of step |
|---|---|---|---|---|
| Registered | 64,274 | 100% | | |
| KYC submitted (verified or failed) | 23,131 | 36.0% | 36.0% of registered | 35.6-36.4% |
| KYC approved | 16,981 | 26.4% | 73.4% of submitted | 72.8-74.0% |
| KYC rejected | 6,150 | 9.6% | 26.6% of submitted | 26.0-27.2% |
| Investor (first paid buy) | 3,617 | 5.6% | 21.3% of approved | 20.7-21.9% |
| Repeat investor (buys on 2+ days) | 2,142 | 3.3% | 59.2% of investors | 57.6-60.8% |
| Still active (last activity within 90 d) | 609 | 0.9% | 16.8% of investors | 15.7-18.1% |
| Churned (no activity > 90 d) | 3,008 | | 83.2% of investors | 81.9-84.3% |

What this means: of every 100 people who sign up, about 36 send their KYC, about 26 get approved and about 6 ever buy; most of the loss is before and after KYC, not at the buy step itself.

Not finished KYC (status unverified): 41,139 = 64.0% of registered. Investors not verified: 21. Verified, never bought: 13,385 = 78.8% of approved.
Churn base note: 152 investors made their first buy within 90 days, so are not yet classifiable; excluding them churn is 3,008 / 3,465 = 86.8%.
Sensitivity: with a 180-day line, 2,753 of 3,617 investors are churned (76.1%) vs 83.2% at 90 days; the funnel shape does not change.
Cohort size is 64,274, 481 more than the 63,793 of Phase 1 (Phase 1 figure, not refreshed): users who registered after the Phase 1 run (Observed; same rules).
Churn count here (activity = buy, sell, SWITCH_IN) is 3,008. A buys-only definition gives 3,163; the 155 difference are users whose last buy is older than 90 d but who sold or switched in the last 90 d (`49_chk.sql`). Phase 2 uses the activity definition.

Before/after exclusion (Observed, `20_cohort_stages.sql`): registered 321,087 -> 64,393 (excl. RAIZ/RAIZKAYA) -> 64,274 (excl. HNWI); approved 17,536 -> 17,100 -> 16,981; investors 260,249 -> 3,736 -> 3,617.

## 2. Time between stages (days, cohort C; users with a valid timestamp pair)

| Transition | n | p50 | p90 | Pairs with negative gap (dropped) |
|---|---|---|---|---|
| Register -> approved | 12,958 | 0.6 | 3.58 | 0 |
| Approved -> first buy | 2,399 | 1.02 | 85.15 | 10 |
| Register -> first buy | 3,617 | 5.47 | 240.03 | 19 |

n for register -> approved is lower than 16,981 approved because `verified_at` is empty for 4,023 approved users (data quality #5). Reading: half of approved users are approved within a day, 90% within about 4 days; buyers who buy do it fast (median about 1 day after approval) but the p90 is 85 days, so a long tail buys much later.
What this means: approval is quick, and people who are going to buy usually do it the next day; if someone has not bought within a week, the chance drops fast.

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
| 2026-10 | 611 | 428 | 70.0% | 31 | 5.1% | 8.0% |
| 2026-11 | 725 | 473 | 65.2% | 59 | 8.1% | 8.3% |

Recent months are not mature (a 2026-11 user has had at most 21 days). Compare 7-day conversion, which is mature for all months through 2026-11-15.
What this means: Oct and Nov 2026 bring many more sign-ups and a higher approval rate, but the share who buy within a week is not higher than in earlier months.

## 4. Biggest leaks and recoverable users (arithmetic shown)

### Leak 1. Registered but KYC not finished
- Observed: 41,139 of 64,274 (64.0%) never reached a KYC result. Last 13 registration months (2025-11 to 2026-11): 1,438 of 3,564 (40.3%).
- Observed: Jan-Sep 2026 cohorts left 892 of 1,800 (49.6%) unfinished; the Oct 2026 cohort (booth month) left 138 of 611 (22.6%). Difference significant (z = -11.6).
- Estimate: if Jan-Sep cohorts had finished like Oct, 892 - 1,800 x 138/611 = 485 more users reach KYC result. At the Jan-Sep investor-per-approved rate (233 / 723 = 32.2% ever) that is about 156 investors; at the Oct verified-to-buy-within-7-days rate (33 / 430 = 7.7%) about 37. Assumption: the Oct pattern is reproducible outside booths (not tested).
- What this means: booth sign-ups finish KYC far more often than earlier sign-ups, so the KYC step can be fixed, but finishing KYC alone did not turn into many buyers (see Leak 2).

### Leak 2. Approved but never buys (largest in user count)
- Observed: 13,385 of 16,981 approved users (78.8%) never made a paid buy. Approved from 2025-11 on: 1,386 of 1,828 (75.8%) never bought (includes Nov 2026 approvals that have had little time to buy).
- Observed: users approved in Oct 2026 bought within 7 days at 33 / 430 = 7.7% (5.5-10.6%) vs Jan-Sep 2026 197 / 730 = 27.0% (23.9-30.3%); z = -8.0. More approvals did not bring more buyers.
- Observed (`84_oct_lag.sql`, approvals 1 Oct-14 Nov, each with 7 full days before cutoff; all approved decisions, no GA-link requirement): 75 / 714 = 10.5% (8.5-13.0%) bought within 7 days vs Jul-Sep 42 / 145 = 29.0% (22.2-36.8%); z = -5.9. Same gap on a longer window, so the drop is not a short-term blip. (Different base from the calendar-month figures above, so do not compare the two sets of percentages directly.)
- Estimate: Oct approvals at the Jan-Sep rate would be 430 x 197/730 = 116 buyers within 7 days; observed 33; shortfall 83 investors. Late buying narrows but does not close it: the 30-day figure for Oct approvals is 49 of 430 (11.4%) vs Jan-Sep 223 of 730 (30.5%), so the 30-day shortfall is 82.
- Pool: each +1 percentage point of the 1,386 recent never-buyers = 14 investors.
- Observed (`52_oct_split.sql` cut of the Oct 2026 cohort, 611 registered): with a sales code 363 registered, 273 approved, 29 bought ever = 8.0%; without 219 registered, 131 approved, 17 bought = 7.8%. Both are low, so the Oct drop is not only a booth effect. Cause not identified; Phase 3 should look at what the booth sign-up flow asks users to do after KYC.
- What this means: most approved users never buy, and the 2026 Oct-Nov approval wave is buying much less often than earlier approvals; this is the biggest pool of recoverable users.

### Leak 3. First-time investors who do not come back (churn)
- Observed: 3,008 of 3,617 investors are silent for more than 90 days (83.2%); 2,753 for more than 180 d. 1,475 (40.8%) bought on only one day. See `churn_profile.md`.
- Estimate: each +10% of churned users reactivated = 301 users (Proposed; no observed reactivation campaign rate in data yet).
- What this means: about 5 in 6 investors have stopped using the app, and about 2 in 5 bought on a single day only.

### Leak 4. KYC rejection
- Observed: 6,150 rejected of 23,131 submitted (26.6%); last 13 months 329 of 2,126 (15.5%). Rejection reasons are not in BigQuery (data request).
- Estimate (Proposed): halving the last-13-month rejection count recovers 164 approved users, about 35 investors at the all-time investor-per-approved rate (21.3%).
- What this means: rejection is the smallest leak; fixing it adds few buyers.

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
| 2026-10 | 430 | 33 | 7.7% | 380 |
| 2026-11 | 489 | 60 | 12.3% | 428 |

Within-7-day count includes the few users who bought before `verified_at` (data quality #10). 2026-11 is partial: approvals after 2026-11-15 have had fewer than 7 days, so its % is understated and its "never bought" is overstated.
What this means: the share of approved users who buy within a week fell from about 1 in 4 (27.0%) in Jan-Sep 2026 to 7.7% in Oct 2026; the partial Nov figure (12.3%) is higher but still below the Jan-Sep level.
