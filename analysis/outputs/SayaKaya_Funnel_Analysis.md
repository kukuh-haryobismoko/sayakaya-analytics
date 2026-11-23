# SayaKaya — First-Investment Acquisition Funnel Analysis

Compiled 2026-11-22 20:05 WIB (Asia/Jakarta). BigQuery `sayakaya` figures (read-only, 5 GB cap per query) were re-pulled on 2026-11-22; Supabase `dashboard_email_log`/`dashboard_email_events` were last pulled 2026-11-09 and are marked as not refreshed. No PII in this document; all cells <10 are suppressed.

## 1. Executive summary

Cohort: 64,274 registered users (excluding RAIZ/RAIZKAYA referrers, excluding HNWI). Funnel: 36.0% submit KYC, 73.4% of submitters are approved, 21.3% of approved users become investors. That means 5.6% of registered users have ever bought, and 83.2% of investors have now been dormant for more than 90 days.

Five key findings:

1. **The approved-but-never-bought pool is the biggest leak: 13,385 users (78.8% of approved).** One problem seen by three teams: no CRM trigger, no in-app surface, no operations queue. Of the 317 users in that pool visible in GA within 52 days, 56 opened the buy sheet and 14 created an order (§4.4 T3, §4.1 V2).
2. **Approved-to-purchase conversion fell in October and has not recovered: 10.5% (1 Oct-14 Nov) vs 29.0% (July-September), and it is not about wait time.** The drop persists in the same-day approval bucket (10.7% vs 29.5%). At the old rate, the October-November approvals lost about 132 buyers (z=-5.9, §4.1 V1).
3. **Bonus credit does not create payers: 3,632 of 6,134 recipients (59.2%) never made a paid purchase; Rp469,200,000 of credit ended up with non-payers.** Only 408 recipients (6.7%) received credit before their first paid purchase; 2,094 (34.1%) were already payers, so the program works more like a reward than acquisition (§4.2 M2).
4. **The KYC funnel breaks inside the app, not at KYC itself: identity verification to selfie camera −11.4%, Android submit 80.5% vs iOS 85.9% (z=-2.3).** Closing half the Android-iOS gap ≈ 20 extra submits and 3.1 investors per 52 days (§4.4 T1).
5. **Sign-up sales code now converts below referral (17.9% vs 20.6% investors/registrations, vs 3.7% organic) and still has the worst mature retention: 39.6% repeat vs 60.2% for the organic group, median first ticket Rp150,000.** Repeat gap = 192 mature investors x 20.6 pp (§4.2 M1).

**Recoverable users.** Not summed across findings because several actions target the same pool (V2/T3/M6 all target the approved pool). Estimate per action; all arithmetic, not experiment results:

| Action | Basis | Estimate |
|---|---|---|
| Post-approval surface + CRM (V2/T3) | 10% of 317 GA-visible users x order→pay rate 86.2% | 27 investors / 52 days (≈190/year) |
| First-investment nudge (M6) | 560 approvals in last 30 days x 10% gap 18.5 pp | 10 investors / 30 days |
| Android KYC gap fix (T1) | 745 starts x 5.4 pp / 2 x 73.4% x 21.3% | 20 submits → 3.1 investors / 52 days |
| Resubmission after rejection (O3) | 10% of 105 still-failed users since 1 Oct x 70.4% verified x 21.3% | 1.6 investors / 53 days |
| QRIS to VA fail rate (T2) | (21.9% − 11.2%) x 834 orders | 90 orders saved (upper bound) |

**Caveats to read alongside the figures above.** No randomized experiment exists in this data: every causal claim is labeled Inferred. The cause of the October drop is not yet identified (three open hypotheses). GA does not carry pre-login `user_id` (88.7% of devices), so the GA funnel is a sample, not a census. KYC rejection reasons are not stored. Email has no click tracking and batch rows have no `user_id`.

**Alignment with the Product & Tech 2027 plan.** The plan (PDF *Product & Tech 2027*, figures labeled Target) targets 10,982 new funded customers and AUM of Rp700.9 billion. This analysis covers retail customers: the non-RM channel = 93.3% of target customers but 10.5% of new AUM. Findings map to Objective 2 (*make it easy to start and keep investing*); there is no data for Objective 1 (non-mutual-fund products) and only partial data for Objective 3 (T5, data quality). The mapping, gaps, and Observed vs Target comparison are in `raker_preparation.md` section 0.

## 2. Scope, definitions, and data quality

### 2.1 Sources

| Source | Contents | Window | Notes |
|---|---|---|---|
| BigQuery `sayakaya.main.*` | users, user_profiles, transactions, user_status_logs, funds | full history | scheduled copy of production Postgres |
| BigQuery `sayakaya.mi_fee_logs` | daily AUM snapshots | since 2026-01-14 | basis for HNWI definition |
| BigQuery `analytics_266759216.events_*` | GA4 app events | 2026-10-01..2026-11-21 | no `user_id` before login |
| Supabase `dashboard_email_log`, `dashboard_email_events` | email send log + events | 2026-08-31..2026-11-03 | not refreshed (last pull 2026-11-09); no click events, `user_id` NULL on batches |

### 2.2 Key definitions

| Term | Definition |
|---|---|
| Registration | row in `main.users` (`created_at` +7 hours) |
| KYC submitted / approved / rejected | status `verified` or `failed` / `verified` / `failed` |
| Investor | first successful non-bonus purchase (`completed`, `completed_payment`, `verified`, `verified_by_operational`; not `manual_bonus`/`bonus`) |
| Repeat | purchases on 2 or more different days |
| Churn | no buy/sell/switch-in for >90 days (gap p90 = 86 days; return probability 53.7% at 90 days). 180 days used as sensitivity |
| Mature (repeat) | first purchase ≥120 days before data pull (on or before 2026-07-25 in this run) |
| HNWI | SID with AUM ≥Rp500,000,000 on any daily snapshot. 119 cohort users are excluded (`20_cohort_stages.sql`); the latest snapshot window (19-22 Nov 2026) holds 65 HNWI SIDs (`15_hnwi.sql`) |

### 2.3 Exclusions and cohort size

321,087 registrations → 64,393 after excluding RAIZ/RAIZKAYA referrers → 64,274 after excluding HNWI (Phase 1). Phase 2 uses 64,274. 27 internal accounts and 15 institutions remain in the cohort per the rules; if excluded, figures shift <1 pp.

### 2.4 Data quality (summary)

- `user_status_logs` only exists since 2026-07-21, so decision-time analysis covers that period only.
- 4,023 users with verified status have no `verified_at` (16,981 approved minus 12,958 with a usable timestamp pair).
- GA does not carry `user_id` on 88.7% of pre-login devices (3,577 of 4,031); `kyc_success` fires on submit, not on approval; `register_success` is sent twice on 3.4% of users; `payment_complete` misses statuses set by operations.
- `has_completed_first_subscription` is unusable (inconsistent with transactions).
- Full details are in `outputs/data_quality.md` and `outputs/data_provenance_log.md`.

## 3. Funnel and GA vs DB reconciliation

Run 2026-11-22 WIB. Cohort C (excl. RAIZ/RAIZKAYA and HNWI), all-time to 2026-11-22, Asia/Jakarta. Scripts: `40_funnel.sql`, `41_timing.sql`, `42_cohorts.sql`, `46_leak.sql` (via `q.py`, `build_phase2.py`). All numbers Observed unless labelled.

### Stage conversion (n = 64,274 registered)

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

### Time between stages (days, cohort C; users with a valid timestamp pair)

| Transition | n | p50 | p90 | Pairs with negative gap (dropped) |
|---|---|---|---|---|
| Register -> approved | 12,958 | 0.6 | 3.58 | 0 |
| Approved -> first buy | 2,399 | 1.02 | 85.15 | 10 |
| Register -> first buy | 3,617 | 5.47 | 240.03 | 19 |

n for register -> approved is lower than 16,981 approved because `verified_at` is empty for 4,023 approved users (data quality #5). Reading: half of approved users are approved within a day, 90% within about 4 days; buyers who buy do it fast (median about 1 day after approval) but the p90 is 85 days, so a long tail buys much later.
What this means: approval is quick, and people who are going to buy usually do it the next day; if someone has not bought within a week, the chance drops fast.

### Register cohorts by month (full table: `cohorts.csv`, chart: `charts/cohort_monthly.png`)

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

### Biggest leaks and recoverable users (arithmetic shown)

#### Leak 1. Registered but KYC not finished
- Observed: 41,139 of 64,274 (64.0%) never reached a KYC result. Last 13 registration months (2025-11 to 2026-11): 1,438 of 3,564 (40.3%).
- Observed: Jan-Sep 2026 cohorts left 892 of 1,800 (49.6%) unfinished; the Oct 2026 cohort (booth month) left 138 of 611 (22.6%). Difference significant (z = -11.6).
- Estimate: if Jan-Sep cohorts had finished like Oct, 892 - 1,800 x 138/611 = 485 more users reach KYC result. At the Jan-Sep investor-per-approved rate (233 / 723 = 32.2% ever) that is about 156 investors; at the Oct verified-to-buy-within-7-days rate (33 / 430 = 7.7%) about 37. Assumption: the Oct pattern is reproducible outside booths (not tested).
- What this means: booth sign-ups finish KYC far more often than earlier sign-ups, so the KYC step can be fixed, but finishing KYC alone did not turn into many buyers (see Leak 2).

#### Leak 2. Approved but never buys (largest in user count)
- Observed: 13,385 of 16,981 approved users (78.8%) never made a paid buy. Approved from 2025-11 on: 1,386 of 1,828 (75.8%) never bought (includes Nov 2026 approvals that have had little time to buy).
- Observed: users approved in Oct 2026 bought within 7 days at 33 / 430 = 7.7% (5.5-10.6%) vs Jan-Sep 2026 197 / 730 = 27.0% (23.9-30.3%); z = -8.0. More approvals did not bring more buyers.
- Observed (`84_oct_lag.sql`, approvals 1 Oct-14 Nov, each with 7 full days before cutoff; all approved decisions, no GA-link requirement): 75 / 714 = 10.5% (8.5-13.0%) bought within 7 days vs Jul-Sep 42 / 145 = 29.0% (22.2-36.8%); z = -5.9. Same gap on a longer window, so the drop is not a short-term blip. (Different base from the calendar-month figures above, so do not compare the two sets of percentages directly.)
- Estimate: Oct approvals at the Jan-Sep rate would be 430 x 197/730 = 116 buyers within 7 days; observed 33; shortfall 83 investors. Late buying narrows but does not close it: the 30-day figure for Oct approvals is 49 of 430 (11.4%) vs Jan-Sep 223 of 730 (30.5%), so the 30-day shortfall is 82.
- Pool: each +1 percentage point of the 1,386 recent never-buyers = 14 investors.
- Observed (`52_oct_split.sql` cut of the Oct 2026 cohort, 611 registered): with a sales code 363 registered, 273 approved, 29 bought ever = 8.0%; without 219 registered, 131 approved, 17 bought = 7.8%. Both are low, so the Oct drop is not only a booth effect. Cause not identified; Phase 3 should look at what the booth sign-up flow asks users to do after KYC.
- What this means: most approved users never buy, and the 2026 Oct-Nov approval wave is buying much less often than earlier approvals; this is the biggest pool of recoverable users.

#### Leak 3. First-time investors who do not come back (churn)
- Observed: 3,008 of 3,617 investors are silent for more than 90 days (83.2%); 2,753 for more than 180 d. 1,475 (40.8%) bought on only one day. See `churn_profile.md`.
- Estimate: each +10% of churned users reactivated = 301 users (Proposed; no observed reactivation campaign rate in data yet).
- What this means: about 5 in 6 investors have stopped using the app, and about 2 in 5 bought on a single day only.

#### Leak 4. KYC rejection
- Observed: 6,150 rejected of 23,131 submitted (26.6%); last 13 months 329 of 2,126 (15.5%). Rejection reasons are not in BigQuery (data request).
- Estimate (Proposed): halving the last-13-month rejection count recovers 164 approved users, about 35 investors at the all-time investor-per-approved rate (21.3%).
- What this means: rejection is the smallest leak; fixing it adds few buyers.

### Verified-to-buy by month of approval (`46_leak.sql`)

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

### 3.1 Churn profile

Run 2026-11-22 WIB. Cohort C investors (n = 3,617). Churned = no buy/sell/SWITCH_IN for more than 90 days at 2026-11-22 (`definitions.md`). Scripts: `43_dur.sql`, `50_indicators.sql`, `49_chk.sql`, `build_phase2.py`.

### Who and when (Observed)
- 3,008 of 3,617 investors churned (83.2%). To avoid counting young accounts, tables below use the 3,465 investors whose first buy is more than 90 days ago (3,008 churned = 86.8%).
- Among churned users, last activity falls: same day as first buy 11.6%; within 7 days 14.3%; within 30 days 23.7%; median 203 days after first buy; p75 583 days.
- What this means: about 5 in 6 investors have gone quiet for over 3 months; roughly 1 in 4 of them were gone within a month of their first buy.

### Survival curve (Kaplan-Meier, share of investors not yet churned, days since first buy)
Churn is dated 90 days after the last activity; users still active or inside the window are censored at their age.

| Days since first buy | 90 | 120 | 180 | 270 | 365 | 450 |
|---|---|---|---|---|---|---|
| Not churned | 90.0% | 79.4% | 68.1% | 58.3% | 50.7% | 46.2% |

Reading: 10% churn before day 90 (they never came back after the first buy day); half are gone by about one year. This chart is dominated by the 2022-2025 buyers (older buyers outnumber recent ones, see "By first-buy half-year").
What this means: after one year only about half of investors are still active; the biggest losses come in the first 6 months.

### After what behaviour (Observed, correlation)
Active days in first life (all activity days, users with first buy over 90 d ago):

| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 1 | 348 | 348 | 100.0% | 98.9-100.0% |
| 2-3 | 1,229 | 1,189 | 96.7% | 95.6-97.6% |
| 4-9 | 871 | 799 | 91.7% | 89.7-93.4% |
| 10+ | 1,017 | 672 | 66.1% | 63.1-68.9% |

Read: all 348 one-day users churned by definition (one active day cannot be followed by a return), so this table mostly says "repeat buyers survive". Not independent of the definition.

Leading indicators measured at first buy / first 30 days (users with first buy at least 120 days ago, so every user has had the same observation time; churn = silent > 90 d now; n = 3,448). Indicators are measured before churn, so they are usable for early warning, but these are Correlation, not Causal:

Activity in the 30 days after first buy (count of active days):

| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 0 | 1,642 | 1,496 | 91.1% | 89.6-92.4% |
| 1 | 979 | 853 | 87.1% | 84.9-89.1% |
| 2-3 | 625 | 506 | 81.0% | 77.7-83.8% |
| 4+ | 202 | 150 | 74.3% | 67.8-79.8% |

z-test 0 vs 4+ days: 7.3. Evidence: High (large n, big gap).
What this means: investors who do nothing in their first month are much more likely to leave for good.

Size of the first buy:

| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| <100k | 597 | 572 | 95.8% | 93.9-97.1% |
| 100-500k | 1,248 | 1,118 | 89.6% | 87.8-91.2% |
| 0.5-5jt | 953 | 780 | 81.8% | 79.3-84.2% |
| 5jt+ | 650 | 535 | 82.3% | 79.2-85.0% |

z-test <100k vs 0.5-5jt: 8.0. Evidence: Med (could reflect testers or bonus-triggered tiny buys).
What this means: very small first buys (under Rp100k) are the least likely to stay.

Fund type of the first buy:

| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| EQUITY | 602 | 548 | 91.0% | 88.5-93.1% |
| FIXED_INCOME | 908 | 762 | 83.9% | 81.4-86.2% |
| MIXED | 862 | 743 | 86.2% | 83.7-88.3% |
| MONEY_MARKET | 1,036 | 921 | 88.9% | 86.8-90.7% |
| PROTECTED | 40 | 31 | 77.5% | 62.5-87.7% |

Payment method of the first buy:

| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| INSTANT_PAYMENT | 40 | 37 | 92.5% | 80.1-97.4% |
| QRIS | 67 | 60 | 89.6% | 80.0-94.8% |
| bank_transfer | 2,441 | 2,113 | 86.6% | 85.2-87.9% |
| virtual_account | 900 | 795 | 88.3% | 86.1-90.3% |

Types or methods with fewer than 10 users are shown as `<10`; PROTECTED n = 40 is low-confidence.
What this means: fund type and payment method differ only a little in churn; first-buy size and first-month activity matter more.

### By first-buy half-year (Simpson / survivorship check)

| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 2021-H2 | 25 | 19 | 76.0% | 56.6-88.5% |
| 2022-H1 | 977 | 829 | 84.9% | 82.5-87.0% |
| 2022-H2 | 367 | 328 | 89.4% | 85.8-92.1% |
| 2023-H1 | 193 | 162 | 83.9% | 78.1-88.4% |
| 2023-H2 | 219 | 192 | 87.7% | 82.7-91.4% |
| 2024-H1 | 247 | 221 | 89.5% | 85.0-92.7% |
| 2024-H2 | 250 | 219 | 87.6% | 82.9-91.1% |
| 2025-H1 | 642 | 604 | 94.1% | 92.0-95.7% |
| 2025-H2 | 313 | 267 | 85.3% | 81.0-88.8% |
| 2026-H1 | 203 | 157 | 77.3% | 71.1-82.6% |
| 2026-H2 | 29 | 10 | 34.5% | 19.9-52.7% |

Newer cohorts show lower churn mainly because they have had less time to churn (right-censoring), so do not read 2026-H1 as an improvement without the survival curve. 2026-H2 (n = 29) is low-confidence.
What this means: newer groups look better only because they are younger.

### Leading indicator summary
- Observed: no follow-up activity in the 30 days after the first buy -> 91.1% churn vs 74.3% with 4+ active days.
- Observed: first buy under Rp100k -> 95.8% churn vs 81.8% for Rp0.5-5 million.
- Inferred: a 30-day reactivation push after first buy is the earliest lever; first buy size under Rp100k marks low commitment. Proposed for Phase 3.
- Not available: churn by marketing source/device (the DB has no acquisition field; GA user mapping covers only Oct-Nov 2026). Added to Data Requests.
- What this means: the cheapest moment to keep an investor is the first 30 days after the first buy.

### 3.2 Segments

Refreshed 2026-11-22 (cutoff). Cohort C, all-time. Scripts: `44_segments.sql` (DB), `48_ga_seg.sql` (GA, 2026-10-01 to 2026-11-21, 52 days), `51_ga_src.sql`. Cells under 10 are hidden (`<10`) and rows with n < 30 are marked low-confidence. 95% CI = Wilson. All Correlation.

Profile fields (gender, age, occupation, income, city) are filled only after KYC, so for those cuts the useful denominator is approved users. For approved users the 'Investor % of approved' column is the fair comparison; the `(null)` rows are users who never reached the profile step.
Monthly income and city are not analysed: income is empty for all 64,274 users (Observed, `44_segments.sql`); city has 505 values, most cells under 10.

### Acquisition: referrer code (DB)
- Observed: with a referrer code (not RAIZ/RAIZKAYA): 6,330 registered, 3,356 approved, 1,328 investors = 21.0% of registered (20.0-22.0%). No code (NULL or empty): 57,944 registered, 13,625 approved, 2,289 investors = 4.0% of registered (3.8-4.1%). z = 55.8. Referral codes: 660 distinct.
- What this means: users who sign up with a referral code are five times more likely to become investors than users without one. Most of the effect comes from a few codes (below), not from referral codes in general.
- Top codes by registered users (personal-looking codes are pseudonymised):

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (none) | 57,944 | 13,625 | 23.5% (23.2-23.9%) | 2,289 | 16.8% (16.2-17.4%) | 4.0% |
| personal-code-01 | 402 | 310 | 77.1% (72.8-81.0%) | 251 | 81.0% (76.2-84.9%) | 62.4% |
| personal-code-02 | 370 | 48 | 13.0% (9.9-16.8%) | <10 | 14.6% (7.2-27.2%) | 1.9% |
| personal-code-03 | 339 | 46 | 13.6% (10.3-17.6%) | <10 | 13.0% (6.1-25.7%) | 1.8% |
| personal-code-04 | 299 | 47 | 15.7% (12.0-20.3%) | <10 | 19.1% (10.4-32.5%) | 3.0% |
| personal-code-05 | 242 | 26 | 10.7% (7.4-15.3%) | <10 | 15.4% (6.1-33.5%) | 1.7% |
| personal-code-06 | 236 | 28 | 11.9% (8.3-16.6%) | <10 | 17.9% (7.9-35.6%) | 2.1% |
| UPNVJT | 218 | 167 | 76.6% (70.6-81.7%) | 13 | 7.8% (4.6-12.9%) | 6.0% |
| UBAYA | 200 | 165 | 82.5% (76.6-87.1%) | 20 | 12.1% (8.0-18.0%) | 10.0% |
| BEMITS | 183 | 156 | 85.2% (79.4-89.7%) | 14 | 9.0% (5.4-14.5%) | 7.7% |
| CMCUNESA | 179 | 152 | 84.9% (78.9-89.4%) | 15 | 9.9% (6.1-15.6%) | 8.4% |
| personal-code-07 | 173 | 146 | 84.4% (78.2-89.0%) | <10 | 4.8% (2.3-9.6%) | 4.0% |
| personal-code-08 | 163 | <10 | 2.5% (1.0-6.1%) | <10 | n/a (n/a) | 0.6% |

- Inferred: code `personal-code-01` converts at a very different rate from other personal codes with similar volume (1.7-3.0% investors per registered for codes 02-06 vs 62.4%); the high-volume personal codes register many users who do not finish KYC. A reward tied to registration instead of first buy could explain it; not tested. Phase 3 should use this for the incentive rule.

### Sales code (booth / sales rep)

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| no | 62,846 | 15,970 | 25.4% (25.1-25.8%) | 3,362 | 21.1% (20.4-21.7%) | 5.3% |
| yes | 1,428 | 1,011 | 70.8% (68.4-73.1%) | 255 | 25.2% (22.6-28.0%) | 17.9% |

- Observed: users with a sales code reach investor at 17.9% of registered vs 5.3%; approval 70.8% vs 25.4%. Investor per approved: 25.2% vs 21.1% (z = 3.1). Selection: sales-code users were helped through KYC, so approval is not comparable.
- Changed vs the previous run (cutoff 2026-11-09, not refreshed): the investor-per-approved edge of sales-code users shrank (30.8% vs 21.1%, z = 6.3 then; now 25.2% vs 21.1%, z = 3.1). Likely reason (Inferred): 258 more sales-code users were approved since 2026-11-09 (753 to 1,011) and many have not had time to buy yet.
- What this means: booth sign-ups get through KYC much more often, but their later buying is only a little better than other users, and the gap is smaller than the previous run reported (cutoff 2026-11-09, not refreshed).

### Registration period

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| before 2026-10 | 62,938 | 16,080 | 25.5% (25.2-25.9%) | 3,508 | 21.8% (21.2-22.5%) | 5.6% |
| 2026-10+ (booth era) | 1,336 | 901 | 67.4% (64.9-69.9%) | 109 | 12.1% (10.1-14.4%) | 8.2% |

- Observed: Oct 2026 onward (booth event) approval 67.4% vs 25.5% before. Investor rate is not comparable yet because the Oct-Nov cohort is young; use the 7-day columns in `funnel_overview.md` (Oct 2026: 5.1% within 7 d vs Jan-Sep 9.4%; z = -3.3; `42_cohorts.sql`).
- What this means: the booth event brought many more approved users, but a smaller share of them buy.

### Demographics (approved users only are comparable)
Gender:

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (null) | 37,121 | 65 | 0.2% (0.1-0.2%) | 20 | 30.8% (20.9-42.8%) | 0.1% |
| male | 18,107 | 10,535 | 58.2% (57.5-58.9%) | 1,990 | 18.9% (18.2-19.6%) | 11.0% |
| female | 9,046 | 6,381 | 70.5% (69.6-71.5%) | 1,607 | 25.2% (24.1-26.3%) | 17.8% |

- Observed: female approved users invest at 25.2% vs male 18.9%; z = 9.7. Evidence: High (large n), Correlation.
- What this means: women who pass KYC are more likely to buy than men who pass KYC.

Age (at registration):

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (null) | 37,121 | 65 | 0.2% (0.1-0.2%) | 20 | 30.8% (20.9-42.8%) | 0.1% |
| 25-34 | 9,174 | 5,954 | 64.9% (63.9-65.9%) | 1,663 | 27.9% (26.8-29.1%) | 18.1% |
| <25 | 7,622 | 4,450 | 58.4% (57.3-59.5%) | 721 | 16.2% (15.1-17.3%) | 9.5% |
| 35-44 | 6,529 | 4,089 | 62.6% (61.4-63.8%) | 761 | 18.6% (17.4-19.8%) | 11.7% |
| 45-54 | 3,028 | 1,921 | 63.4% (61.7-65.1%) | 320 | 16.7% (15.1-18.4%) | 10.6% |
| 55+ | 800 | 502 | 62.8% (59.3-66.0%) | 132 | 26.3% (22.6-30.3%) | 16.5% |

- What this means: users aged 25-34 and 55+ buy most often after approval; under-25 and 45-54 least often.

Occupation:

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (null) | 37,168 | 66 | 0.2% (0.1-0.2%) | 20 | 30.3% (20.6-42.2%) | 0.1% |
| pegawai swasta | 9,632 | 6,698 | 69.5% (68.6-70.5%) | 1,621 | 24.2% (23.2-25.2%) | 16.8% |
| lainnya | 5,458 | 3,017 | 55.3% (54.0-56.6%) | 569 | 18.9% (17.5-20.3%) | 10.4% |
| pelajar/mahasiswa | 4,533 | 2,750 | 60.7% (59.2-62.1%) | 451 | 16.4% (15.1-17.8%) | 9.9% |
| pengusaha | 3,036 | 1,959 | 64.5% (62.8-66.2%) | 369 | 18.8% (17.2-20.6%) | 12.2% |
| ibu rumah tangga | 2,782 | 1,401 | 50.4% (48.5-52.2%) | 289 | 20.6% (18.6-22.8%) | 10.4% |
| pns | 982 | 651 | 66.3% (63.3-69.2%) | 180 | 27.6% (24.4-31.2%) | 18.3% |
| guru/dosen | 372 | 259 | 69.6% (64.8-74.1%) | 80 | 30.9% (25.6-36.8%) | 21.5% |
| pensiunan | 164 | 92 | 56.1% (48.4-63.5%) | 31 | 33.7% (24.9-43.8%) | 18.9% |
| tentara/polisi | 145 | 86 | 59.3% (51.2-67.0%) | <10 | 8.1% (4.0-15.9%) | 4.8% |

- Observed: `tentara/polisi` <10 investors of 86 approved (8.1%), far below `pegawai swasta` (24.2%); `pensiunan`, `guru/dosen`, `pns` are highest. Occupation and age overlap (Simpson risk): not separated here.
- What this means: some jobs buy more often after approval, but age and job are mixed together, so do not target on job alone.

Other: bank_account_skipped = true: 653 registered, 237 approved, <10 investors; institutions: 15 registered, 15 approved, <10 investors (n=15 low-confidence).

### Acquisition source, device and region (GA, Oct 1 - Nov 21, 2026, users who registered and logged in)
Source / medium (GA first-touch of the device):

| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| google-play / organic | 749 | 552 | 73.7% (70.4-76.7%) | 49 | 6.5% (5.0-8.5%) |
| (direct) / (none) | 459 | 365 | 79.5% (75.6-83.0%) | 51 | 11.1% (8.6-14.3%) |
| card / offline (low n) | 10 | 10 | 100.0% (72.2-100.0%) | <10 | 0.0% (0.0-27.8%) |

OS:

| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| Android | 799 | 591 | 74.0% (70.8-76.9%) | 54 | 6.8% (5.2-8.7%) |
| iOS | 430 | 343 | 79.8% (75.7-83.3%) | 46 | 10.7% (8.1-14.0%) |

- Observed: iOS KYC 79.8% vs Android 74.0% (z = 2.3, significant); payment complete 10.7% vs 6.8% (z = 2.4, significant).
- Changed vs the previous run (cutoff 2026-11-09, not refreshed): iOS payment completion was not significantly different then (10.4% vs 7.5%, z = 1.4); with the longer window it is. The Android disadvantage now appears at both KYC and payment.
- What this means: Android users finish KYC and pay less often than iOS users, so Android fixes pay off twice.

App version:

| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| 2.28.2 | 794 | 610 | 76.8% (73.8-79.6%) | 77 | 9.7% (7.8-12.0%) |
| 2.29.0 | 412 | 308 | 74.8% (70.3-78.7%) | 21 | 5.1% (3.4-7.7%) |
| 2.28.1 (low n) | 21 | 16 | 76.2% (54.9-89.4%) | <10 | 9.5% (2.7-28.9%) |

- Observed: version 2.29.0 pays at 5.1% vs 9.7% on 2.28.2 (z = -2.8); KYC 74.8% vs 76.8% (z = -0.8, not significant). Inferred: 2.29.0 users registered later, so many have not paid yet; cannot separate version from registration date here.
- What this means: do not blame the new version yet; its users are newer.

Region (GA geo):

| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| Jakarta | 781 | 613 | 78.5% (75.5-81.2%) | 65 | 8.3% (6.6-10.5%) |
| West Java | 141 | 109 | 77.3% (69.7-83.4%) | 14 | 9.9% (6.0-16.0%) |
| Banten | 84 | 61 | 72.6% (62.3-81.0%) | <10 | 3.6% (1.2-10.0%) |
| East Java | 34 | 25 | 73.5% (56.9-85.4%) | <10 | 20.6% (10.3-36.8%) |
| North Sumatra (low n) | 29 | 21 | 72.4% (54.3-85.3%) | <10 | 10.3% (3.6-26.4%) |
| Lampung (low n) | 25 | 15 | 60.0% (40.7-76.6%) | <10 | 0.0% (0.0-13.3%) |

- What this means: Jakarta is almost two thirds of GA registrations (63.5%, 781 of 1,229); other regions are too small to compare.

Campaign: GA campaign is `(null)` or `(direct)` for 1,215 of 1,229 registered users: not usable for campaign analysis (Data Request).
- Observed (GA, devices, not users, `51_ga_src.sql`): `google / cpc` shows 135 devices in the window with 0 first_open, 1 registrations and 3 devices with payment_complete. Inferred: ad-attributed devices are mostly installs from before Oct 1, or the attribution field is stale; cannot judge ad performance from this table. Data Request.
- Caveats: GA attributes only users who logged in (user_id); versions 2.28.2 and 2.29.0 together hold 98.1% of users, so almost all users are on these two builds; 2.29.0 is the newer one, so version and registration date overlap.

### 3.3 GA vs DB

Run 2026-11-22 WIB. Window 2026-10-01 to 2026-11-21 (52 days; Asia/Jakarta; GA `event_date` is already WIB, DB timestamps shifted +7 h). DB is source of truth. Same exclusion on both sides: GA mapped through `user_id` to cohort C; devices without `user_id` cannot be excluded or counted. Scripts: `45_ga_db.sql`, `22_churn_ga.sql`.

| Stage | GA metric | GA | DB metric | DB | GA / DB | Likely cause (Inferred unless stated) | Fix |
|---|---|---|---|---|---|---|---|
| Register | `register_success`, users in cohort C | 1,229 | users with `created_at` in window | 1,297 | 94.8% | Missing events: 70 DB registrations (5.4%) have no GA `register_success` for the same user_id (Observed). Possible: event not sent offline/ad-block/consent, web or non-app registration path | Log register server-side; check whether web sign-up exists |
| Register (duplicates) | `register_success` events vs users, all users | 1,281 events | distinct users | 1,239 | 3.4% extra events | Event fires more than once per user (Observed) | Fire once per user_id; dedupe in reports |
| KYC | `kyc_success`, users in cohort C | 955 | KYC approved (`verified_at` in window) | 905 | 105.5% | GA fires on submission, not approval: 97 GA users are not approved in the DB (Observed). DB approved matched in GA 855 of 905 (94.5%) | Rename to `kyc_submitted`; add `kyc_approved` from the server |
| KYC (compare to submitted) | `kyc_success`, users in cohort C | 955 | registered in window, status verified or failed | 988 | 96.7% | Closer match supports "GA = submission". Windows differ (registered in window vs event date), so approximate | |
| KYC start | `kyc_start`, users in cohort C | 1,157 | no DB equivalent | n/a | | Not available: DB records no 'started' state | |
| Order | `order_created`, users in cohort C | 347 | users with a buy transaction (any status, not bonus) | 365 | 95.1% | Missing events (Observed gap 18 users) | Same as register |
| Paid | `payment_complete`, users in cohort C | 299 | users with successful buy | 332 | 90.1% | DB successful buyers matched in GA: 294 of 332 (88.6%). Status `verified` (set by operations, 7 users) is not triggered in the app, so GA cannot see it; no `verified_by_operational` buyers in this window | Server-side purchase event on status change |
| Paid (events) | `payment_complete` events, cohort C | 674 | successful buy transactions | 826 | 81.6% | Fewer events than transactions; payment on a different day than creation also shifts counts (window by event date vs `created_at`) | |

What this means: GA sees roughly 9 in 10 of the registrations, orders and payments in the DB, so use GA for trends and the DB for exact counts; `kyc_success` in GA means "KYC submitted", not "approved".

### Other checks (Observed)
- `user_id` is set only after login: `first_open` has 0 users with `user_id` (Phase 1 DQ #25, as of 2026-11-09, not refreshed), and 3,577 of 4,031 devices (88.7%) have rows without it (`22_churn_ga.sql`). Pre-login steps (install, open, sign-up start) can only be counted per device.
- GA to DB mapping: 2,764 of 2,767 GA user_ids exist in `main.users`. Of 2,767 GA users: 155 are RAIZ/RAIZKAYA, 78 HNWI, 2,531 kept (`22_churn_ga.sql`).
- Timezone: GA `event_date` is WIB; DB `created_at` is UTC and shifted +7 h. Checked on one day only (as of 2026-11-09, not refreshed).
- Not tested: bot traffic (no bot flag in the export), consent mode / ad-block (no consent field read), consent rate.
- What this means: most visitors are anonymous until they log in, so GA cannot follow one person from install to first buy.

### Fix list (Proposed, order by value)
1. Server-side events for register, KYC approved, order created, payment complete (closes 70 register and 38 paid user gaps in this window).
2. Rename or split `kyc_success` into submitted and approved.
3. Dedupe `register_success`.
4. Send `user_id` (or a hashed id) from the first screen so pre-login funnel steps can be tied to users.
5. Fill `campaign`/`source` consistently (campaign is empty for most registrations).

## 4. Analysis per team

Finding format follows `00_rules.md`: Pain point, Evidence (Observed), Root cause (Inferred, Confidence), Expected impact (arithmetic), Effort, Priority, KPI/validation. Wilson 95% confidence intervals; cells <10 hidden.

Mapping of findings to Product & Tech 2027 Objectives (draft):

| P&T 2027 Objective | Finding |
|---|---|
| O2 Make it easy to start | V1, V2, T1, T2, T3, T4, O1, O2, O3, M6 |
| O2 Make it easy to keep investing | M1, M3, M6 |
| O3 Scalable platform | T5, O2 (review load, automated KYC direction), data quality §2.4 |
| Outside P&T objectives (Marketing/Finance), supports O2 data | M2, M4, M5 |
| O1 More than mutual funds | no data |

### 4.1 Cross-team findings

### V1 — Approved to buy dropped in October, and it is not about wait time

**Pain point.** Users approved in October purchased within 7 days at 10.5%, vs 29.0% for July-September approvals. This is the largest drop found in all of Phase 3.

**Evidence (Observed).** Verified decisions split by approval month and registration-to-approval lag. Purchase = successful order within 7 days after approval. Approvals capped at 2026-11-15 (so every approval has 7 full days before cutoff).

- July-September (lag <=30 days): 40/137 = 29.2% (95% CI 22.2-37.3%). October: 73/700 = 10.4% (95% CI 8.4-12.9%). z=-5.9, p<0.0001.

- Full October (lag all): 75/714 = 10.5% (95% CI 8.5-13.0%). July-September full: 42/145 = 29.0% (95% CI 22.2-36.8%).

| Approval week | Approved | Purchased <=7 days | Rate |
|---|---|---|---|
| 2026-08-03 | 18 | 5 | 27.8% ⚠n<30 |
| 2026-08-10 | 16 | 2 | 12.5% ⚠n<30 |
| 2026-08-17 | 4 | 0 | 0.0% ⚠n<30 |
| 2026-08-24 | 11 | 2 | 18.2% ⚠n<30 |
| 2026-08-31 | 23 | 9 | 39.1% ⚠n<30 |
| 2026-09-07 | 22 | 11 | 50.0% ⚠n<30 |
| 2026-09-14 | 8 | 2 | 25.0% ⚠n<30 |
| 2026-09-21 | 19 | 2 | 10.5% ⚠n<30 |
| 2026-09-28 | 22 | 6 | 27.3% ⚠n<30 |
| 2026-10-05 | 31 | 1 | 3.2% |
| 2026-10-12 | 97 | 5 | 5.2% |
| 2026-10-19 | 183 | 12 | 6.6% |
| 2026-10-26 | 115 | 15 | 13.0% |
| 2026-11-02 | 132 | 27 | 20.5% |
| 2026-11-09 | 142 | 13 | 9.2% |

- Lag does not explain it: in the same-day approval bucket (lag <=1 day), July-September 29.5% (28/95) vs October 10.7% (69/646). The drop is just as large inside the fastest bucket, so it is not a queue effect (O1/O4).

- Wait time does not explain it either: O4 shows no correlation between wait and purchase, and the drop persists in the same-day bucket.

**Root cause (Inferred, Confidence Low).** Three explanations consistent with other findings, none tested: (a) acquisition mix shifted to low-intent channels (see M1: sales code grew, mature repeat 43.2%); (b) the approved pool piled up without lifecycle messaging (M6) and without a path back to investing (T3); (c) a product or operations change in the week of 2026-10-05. The data cannot choose among the three.

**Expected impact (arithmetic).** If October ran at the July-September rate: 714 x 29.0% = 207 buyers, vs 75 actual = 132 buyers lost in October alone.

**Effort.** M (diagnosis: test channel mix vs product change on the October cohort).

**Priority.** P0.

**KPI / validation.** Approved-to-purchase within 7 days per approval month, and per acquisition channel within that month. Retest November with complete data.

**What this means.** October first-investment rate dropped 18.5 pp vs July-September (29% → 10.5%). Same-day approvals fell from 29.5% to 10.7%, so it's not a wait-time problem. Early November shows partial recovery (20.5% then 9.2%).

### V2 — The piled-up approved pool is one problem with three faces

**Pain point.** Marketing sees it as no lifecycle (M6), engineering as no path back (T3), operations as a queue that triggers nothing (O1/O2). All point to the same 13,385 approved-not-purchased users.

**Evidence (Observed).** 13,385 approved users without a completed purchase; 560 approved in the last 30 days; 317 from that pool seen in GA within 52 days, 56 opened the buy sheet, 14 created an order.

**Root cause (Inferred, Confidence Medium).** Approval is the end of a process, not the start of the next one. No trigger (CRM), no surface (product), no queue (operations) carries approved users to a first investment. This is a coordination failure, not a failure of one team.

**Expected impact (arithmetic).** Conservative baseline: 10% of 317 GA-visible users convert to an order at an order-to-payment rate of 86.2% = 27 investors per 52 days (192/year). The full scenario uses 13,385 users; do not report it before it is measured.

**Effort.** M (one program: approval trigger to CRM + in-app surface + operations queue with due date).

**Priority.** P0.

**KPI / validation.** Approved-to-first-investment within 7/30 days, one cross-team dashboard; Target +10 pp from the October baseline.

**What this means.** 13k approved users never bought. Only 317 showed up in GA, 56 opened the buy sheet, 14 ordered. No system connects approval to first investment.

### Priority summary

| Priority | Finding | Reason |
|---|---|---|
| P0 | V1 / V2 / T3 (approved pool), M2 (bonus to non-payers), T1 (KYC funnel) | Largest impact, numbers computable, mostly controllable by product/policy |
| P1 | M1 (sales code retention), M4 (unmeasurable email), M6 (lifecycle), O1/O2/O3 (SLA, key-person, rejection), T2 (QRIS) | Medium impact, small-medium effort |
| P2 | M3 (promo), M5 (push), O4 (wait), T4 (gate), T5 (error) | Weak evidence or correlational |

### All numbers not yet testable

- Lift of bonus (M2), promo (M3), push (M5), lifecycle messaging (M6), and post-approval surface (T3/V2) are arithmetic estimates from correlation. No randomized experiment in this data.

- T1 and T4: small n in certain buckets; `n<30` flag marked in tables.

- V1: cause not identified; three open hypotheses, all need October channel-mix data.


### Phase 2 follow-ups answered here

- Approved-never-bought (Phase 2: 78.8%) deepened: 317 seen in GA, 56 opened buy sheet, 14 orders (T3), and the October drop measured (V1).

- Phase 2 question 'what happens after KYC': flow stops with no trigger, no surface, no queue (V2).

- Phase 2 question on booth mix: sales code contributes to a low-intent mix but is not the sole explanation (M1).

### 4.2 Marketing

Cohort = Phase 1/2 (excl. RAIZ/RAIZKAYA referrers, excl. HNWI): 64,274 registrations, 3,617 investors. Data pulled 2026-11-22 (BigQuery only; Supabase email tables as of 2026-11-09, not refreshed).

| # | Finding | Evidence | Confidence | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| M1 | Sales code sign-up: conversion on par with referral, worst mature retention | 17.9% investor/reg vs 20.6% referral, 3.7% none; mature repeat 39.6% vs 60.2% | High (observational) | High | M | P1 |
| M2 | Bonus credit to 6,134 users, 59.2% never made a paid buy | Rp469,200,000 credit to 3,632 non-payers | High | High | S (policy) | P0 |
| M3 | Promo on first buy correlates with lower repeat | 52.8% vs 61.4% | Medium (confounded) | Medium | S | P2 |
| M4 | Lifecycle email not measurable; batch throttled, 0 clicks | 93/743 failed (454), all resent; 0 click events; opens 497/497 within 2 hours | High | Medium | S | P1 |
| M5 | Push reaches non-investors, post-click conversion not measurable | 351 approved-never-bought clicked; click→buy test only 105 users | Low | Medium | M | P2 |
| M6 | Three stuck pools without lifecycle messaging | 13,385 approved-never-bought; 245 unverified <30 d; 101 investors silent 60-90 d | High | High | M | P1 |

### M1 — Sales code: conversion on par with referral, worst mature retention

**Pain point.** Sign-ups with a sales code (booth/agent) produce investors at almost 5x the organic group, but have the lowest mature repeat rate and the smallest first ticket.

**Evidence (Observed).** Full cohort, registrations through 2026-11-22.

| Group | Registrations | KYC submit | Approved | Investors | Investor/reg | Approved/submit | Investor/approved |
|---|---|---|---|---|---|---|---|
| sales_code | 1,428 | 1,125 (78.8%) | 1,011 (70.8%) | 255 | 17.9% | 89.9% | 25.2% |
| referrer_code | 6,130 | 3,490 (56.9%) | 3,224 (52.6%) | 1,262 | 20.6% | 92.4% | 39.1% |
| none | 56,716 | 18,516 (32.6%) | 12,746 (22.5%) | 2,100 | 3.7% | 68.8% | 16.5% |

- Sales code vs none, investor/reg: 17.9% (95% CI 16.0-19.9%) vs 3.7% (95% CI 3.6-3.9%); z=26.8, p<0.0001.

- Sales code vs none, approved/submit: 89.9% (95% CI 88.0-91.5%) vs 68.8% (95% CI 68.2-69.5%); z=15.0, p<0.0001.

| Group | Investors | Repeat (2+ purchase days) | Mature (purchase-1 ≥120 d) | Mature repeat | Mature churn >90 d | Median ticket-1 | Ticket-1 <Rp100k |
|---|---|---|---|---|---|---|---|
| sales_code | 255 | 32.5% | 192 | 43.2% | 89.6% | Rp150,000 | 9.8% |
| referrer_code | 1,262 | 63.9% | 1,197 | 67.4% | 86.7% | Rp500,000 | 10.0% |
| none | 2,100 | 59.6% | 2,059 | 60.8% | 87.2% | Rp200,000 | 22.4% |

- Mature repeat, sales code vs none: 43.2% (95% CI 36.4-50.3%) vs 60.8% (95% CI 58.7-62.9%); z=-4.7, p<0.0001. Vs referral: 67.4%.

- Churn is computed on mature investors only; raw churn across all investors is misleading because the sales-code cohort is younger.

- Median first ticket Rp150,000 vs Rp500,000 (referral) and Rp200,000 (none). The ticket gap is an acquisition-mix effect (agent minimum), not evidence of a churn cause.

**Root cause (Inferred, medium confidence).** Sales-code investors enter with a small, agent-assisted ticket and stay dependent on the agent rather than self-driven, so they repeat less often. Not yet tested: agent follow-up after the first purchase; whether the code is used for a one-off purchase during a promo.

**Expected impact (arithmetic).** 192 mature investors x 17.6 pp repeat gap = 34 additional repeat investors if the gap closes fully. Closing 30% via agent follow-up on day 7 and day 30 = 10 users. Assumption: the gap is fixable, not selection.

**Effort.** M (agent workflow + CRM task, no product change).

**Priority.** P1.

**KPI / validation.** Mature repeat rate per acquisition group, monthly. Before/after test of agent follow-up on day 7 and day 30 on the new sales-code cohort; target +5 pp within 90 days.

**What this means.** Sales-code brings in more investors per registration than organic, but those investors rarely buy again without the agent. The gap (43% vs 61% mature repeat) is real and worth fixing.

### M2 — Bonus credit is the largest marketing spend leak

**Pain point.** 3,632 of 6,134 bonus recipients never made a paid purchase; Rp469,200,000 credit went to non-payers.

**Evidence (Observed).** All data through 2026-11-22. Bonus = purchase transaction with `payment_method` in ('manual_bonus','bonus'); paid = successful purchase outside those methods.

- Bonus recipients 6,134 (valid status 6,132); never paid 3,632 = 59.2% (95% CI 58.0-60.4%); value to non-payers Rp469,200,000.

- Recipient payment status: already a payer before credit 2,094 (34.1% — bonus works as a reward); got credit before a paid purchase 408 (6.7% — the only group readable as acquisition); never made a paid purchase 3,632 (59.2%).

- Bonus transaction status: completed 11,391; cancelled 166.

- Approved users with bonus 6,134: investor 40.8%, repeat 25.8%. Without bonus 10,847: investor 10.1%, repeat 5.2%. The bonus group is post-hoc selected (2,094 got bonus after paying); this is correlation, not a lift estimate.

**Root cause (Inferred, medium confidence).** Only 408 recipients (6.7%) received credit before a paid purchase, so the program is not an acquisition engine; it is a reward for existing payers. The problem is that 3,632 recipients (59.2%) never produced any paid payment at all, and their Rp469,200,000 credit created no revenue. Program rules are not in the data; confirm with the bonus configuration owner.

**Expected impact (arithmetic).** Average credit per non-payer Rp129,185. Converting 10% of 3,632 = 363 users; at the none-group median ticket-1 of Rp200,000 = Rp72,600,000 first tickets. Alternative: require credit on first paid purchase, cutting the Rp469,200,000 exposure.

**Effort.** S (policy/configuration: who gets credit and when).

**Priority.** P0 (largest value, smallest effort).

**KPI / validation.** Share of bonus recipients who make a paid purchase within 30 days; bonus cost per converted user. Test cohort credit-at-first-purchase vs credit-at-signup.

**What this means.** Most bonus money goes to people who never buy anything. Only 1 in 15 got credit before their first paid purchase — this is a reward program, not an acquisition tool.

### M3 — Promo on first purchase correlates with lower repeat (confounded)

**Pain point.** Investors whose first purchase used a promo repeat 52.8% vs 61.4% without promo.

**Evidence (Observed).** First purchase with promo n=927: repeat 489 = 52.8% (95% CI 49.5-55.9%), churn90 85.2%. Without promo n=2,690: repeat 61.4%, churn90 82.5%. z=-4.6, p<0.0001.

- Contradiction: counting promo on any purchase flips the sign. Promo users 72.5% repeat (n=1,615) vs 48.5% (n=2,002). Promo use is a result of frequent buying, so this cut must not be read as lift.

**Root cause (Inferred, low confidence).** Promo likely attracts price-sensitive one-off buyers, but first-purchase promos are also targeted at this group. Selection cannot be separated without random exposure.

**Expected impact.** Not quantified. Gap 8.6 pp x 927 promo investors = 80 repeat investors is only an upper bound if the gap is fully causal; the data cannot show that.

**Effort.** S (analysis: random holdout).

**Priority.** P2.

**KPI / validation.** 90-day repeat for new promo-eligible users, randomized promo vs no promo (10% holdout).

**What this means.** First-purchase promo users repeat less, but that's likely because promos target one-off buyers, not because the promo causes churn. Needs a random test to know for sure.

### M4 — Lifecycle email: throttle, no click tracking, unmeasurable lift

**Pain point.** The only email batch in the log (`fund_performance`/`batch`) has 93 failed sends due to throttle, 0 click events, and 650 sends without `user_id`, so post-click conversion cannot be measured.

**Evidence (Observed).** Supabase `dashboard_email_log`/`dashboard_email_events`, pulled 2026-11-09 (as of 2026-11-09, not refreshed). Batch per day: 2026-10-13 = 150, 2026-10-26 = 497, 2026-11-03 = 3.

- Failed 93 (all 2026-10-26), error `454 Throttling failure: Maximum sending rate exceeded.`. All 93 recipients were sent later, no permanent loss.

- Tracking coverage: 500/650 sent logs have events; the 2026-10-13 batch (150 sends) has zero events.

- Open: 497/500 logs with events have an Open (99.4%), 993 open events. All opens arrived within two hours of sending (2026-10-26 07:00Z: 478, 2026-10-26 08:00Z: 201), a sign of mail-app prefetch/security scanning, not reading. Do not report as engagement.

- Click events: 0 (the only types present are Open/Delivery/Send). Post-click conversion: **not available**.

- Other categories in the log: fund_performance/batch sent 650; fund_performance/batch failed 93; statement/schedule sent 93; statement/manual sent 13; fund_performance/manual sent 12; fund_performance/schedule sent 10; schedule_otp/system sent 3; password_reset/system sent 1. No onboarding, KYC-stuck, not-yet-invested, or reactivation categories.

- Suppression 0 rows; scheduled jobs 9; queue 753.

**Root cause (Inferred, high confidence for the mechanics).** The batch was sent all at once past the provider rate limit (454) and events were only recorded for later batches, so the reporting pipeline starts from the 2026-10-26 sends. Whether lifecycle email exists outside this dashboard is unknown.

**Expected impact.** Cannot be quantified without `user_id` per send and click/open linked to investment outcomes. A throughput fix only protects delivery: 93 of 743 batch sends (12.5%) needed retry.

**Effort.** S (add `user_id` + click events; spread batch sends).

**Priority.** P1.

**KPI / validation.** % of batch sends with `user_id`; click rate per category/segment; then holdout test on a reactivation batch.

**What this means.** Email system is broken for measurement — no user IDs, no clicks, throttling. Can't tell if email drives any investment.

### M5 — Push reaches non-investors, click-to-buy not measurable

**Pain point.** Push reaches approved-not-yet-purchased and not-yet-approved users, but the click-to-purchase test covers only 26 clickers with no control group; no lift claim.

**Evidence (Observed).** GA4, 2026-10-01..2026-11-21 (52 days).

| Segment | Users with receive | Users receive+click | Click/receiver (Android) | Receive events | Click/open events | Click/open per receive |
|---|---|---|---|---|---|---|
| investor | 707 | 218 | 30.8% | 49,598 | 1,266 | 2.6% |
| approved, not yet purchased | 560 | 149 | 26.6% | 18,930 | 607 | 3.2% |
| not yet approved | 262 | 30 | 11.5% | 7,640 | 42 | 0.5% |

- Receive 76,168 vs dismiss 42,320 events (55.6% dismiss per event). iOS does not record receive/dismiss, so iOS delivery is not measurable.

- Clickers: 843 users clicked (combined click+open); 445 already investors, 351 approved-not-yet-purchased, 47 not yet approved.

- Click-to-purchase test (Android, approved before 2026-10-01, not yet purchased): 26 users who clicked produced 3 purchases; 79 who did not click produced 0. **Click cell n<30; not tested.**

**Root cause (Inferred, low confidence).** Push content is generic (no campaign/segment id in GA), so nothing links the message to behavior.

**Expected impact.** Not quantified. The only valid claim: 560 approved-not-yet-purchased users received notifications in 52 days.

**Effort.** M (campaign id + segment param in notification events; set up holdout).

**Priority.** P2.

**KPI / validation.** First purchase within 7 days post-click vs 10% no-push holdout, per campaign id.

**What this means.** Push reaches the right people (non-investors), but we can't measure if clicks turn into purchases. Need campaign IDs and holdout tests.

### M6 — Three stuck pools without lifecycle messaging

**Pain point.** Email and push only cover statements, fund performance, OTP, and one-off notifications. The largest stuck pools have no targeted recurring message in the log.

**Evidence (Observed).** `stuck_sizes` + email categories, 2026-11-22.

| Pool | Size | What exists now |
|---|---|---|
| Approved, not yet purchased | 13,385 (approved last 30 days: 560) | no first-investment email category; push exists (M5) |
| Registered, not yet verified (30 days) | 245 | no KYC reminder category; push exists |
| KYC failed (all time) | 6,150 (registered 30 days: 87) | no rejection email category; reason not stored (O3) |
| Investors dormant 60-90 days | 101 (of 609 not yet churned) | no reactivation category |

**Root cause (Inferred, medium confidence).** Messaging is triggered by product/events (statement, performance, OTP), not lifecycle status.

**Expected impact (arithmetic).** Latest approvals (n=560) purchase within 7 days 10.5% now vs 29.0% Jul-Sep (V1). A first-investment nudge that closes 10% of the gap: 560 x 0.0185 = 10 investors per 30 days. Assumption: the 10% gap can be recovered via messaging; not yet tested.

**Effort.** M (three trigger-based sequences + holdout).

**Priority.** P1.

**KPI / validation.** First purchase in 7 days, nudged vs holdout, per pool; re-KYC rate of the failed pool.

**What this means.** Three large groups get no automated message: approved-not-bought (13k), unverified registrants (245), dormant investors (101). The approved-not-bought gap vs July-September is 18.5 pp.

### Data requests (Marketing)

- No campaign id in push/email; GA registration source is empty for most of the window (Phase 2). Add `campaign_id` to `notification_*` events and `dashboard_email_log`.

- `dashboard_email_log` batch rows have `user_id` NULL (650/650); without it there is no email-to-investment join.

- No click event type in `dashboard_email_events`.

- Bonus program rules (who, when, how much) are not in BigQuery; needed to measure M2 properly.

### 4.3 Operations & KYC

Basis: decision rows in `main.user_status_logs` with `origin_status='pending_verification'` (status verified/failed), joined to the Phase 1/2 cohort. `user_status_logs` exists only since 2026-07-21 and GA carries no pre-login `user_id`, so submit time is taken from the GA `kyc_success` event (this event fires on submit, see Phase 2 reconciliation).

| # | Finding | Evidence | Confidence | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| O1 | Decision tail: P90 15.4 hours; submits outside working hours and on weekends wait longest | 857 verified decisions, 30 >24 hours; weekend P90 16.6 hours vs 8.1 hours on workdays | High | Medium | S | P1 |
| O2 | Review is concentrated in one account and runs in batches | 1 actor = 67.4% of 1,339 decisions; 3 actors = 96.9%; 28.8% of decisions at hour 10 | High | High | M | P1 |
| O3 | Rejected users rarely resubmit; rejection reason is not stored | Failed since 1 Oct: 12/105 resubmitted; 50/71 of those who ended up verified resubmitted | Medium | Medium | M | P1 |
| O4 | Faster decisions do not correlate with higher purchases | <2 hours 5.9% vs 2-24 hours 11.3% bought within 14 days, all cells small | Low | Low | S | P2 |

### O1 — SLA problem is in the tail, not the median

**Pain point.** Median submit to decision is about 9 minutes, but P90 is 15.4 hours and 30 verified decisions took more than 24 hours.

**Evidence (Observed).** GA submits 2026-10-01..2026-11-21, decision >= submit.

| Status | n | P50 | P90 | >24 hours | >72 hours |
|---|---|---|---|---|---|
| verified | 857 | 0.15 hours | 15.43 hours | 30 | 5 |
| failed | 158 | 0.13 hours | 15.15 hours | 4 | 0 |

- Weekend submits: n=239, >4 hours 100 = 41.8% (95% CI 35.8-48.2%), >24 hours 13. Workdays: n=711, >4 hours 79 = 11.1% (95% CI 9.0-13.6%), >24 hours 9. z=10.5, p<0.0001.

- P90 submit to decision: weekend 16.6 hours (n=239) vs workdays 8.1 hours (n=711). The gap widened since the previous run (cutoff 2026-11-09, not refreshed) (was 17.2 vs 11.9): workdays got faster, weekends did not.

- Submits outside 09:00-20:00 WIB: n=142, >4 hours 79 (55.6%, 95% CI 47.4-63.6%), >12 hours 42 (29.6%). Within working hours: n=808, >4 hours 100 (12.4%, 95% CI 10.3-14.8%), >12 hours 100 (12.4%). z=12.2, p<0.0001. (Weekend and outside-hours groups overlap; the weekend/workday split and this split are different cuts of the same 950 submits.)

- Key clue: every working-hours case that passes 4 hours also passes 12 hours (100/100). Meaning it is queued to the next workday, not processed slowly.

- Decision hour (all decisions, n=1,339): peak at 10:00 WIB = 386 (28.8%); 21:00-08:59 only 40 (3.0%). Saturday 108 + Sunday 144 decisions = 252 (18.8%).

**Root cause (Inferred, Confidence: High).** Decisions are executed as a morning batch (hour 10) by one operator; submits after the batch wait for the next workday morning. The night and weekend tail is queue time, not processing time.

**Expected impact (arithmetic).** 34 decisions >24 hours in 52 days = 20/month in the tail. If one evening/weekend review slot moves 10 of the 30 verified cases within 24 hours, and they buy within 7 days of approval at the approved population rate (10.5% for October approvals, 75/714; 29.0% for Jul-Sep approvals, 42/145; `84_oct_lag`), recovered investors = 10 x 0.105 = 1.1 to 10 x 0.29 = 2.9. Small: the main value is SLA credibility and rejection-cycle speed, not investor volume.

**What this means:** Most requests are decided in minutes, but a request sent at night or on a weekend usually waits until the next working morning, and that wait is getting relatively worse on weekends.

**Effort.** S (change roster/queue, no code).

**Priority.** P1 (cheap and visible, small investor impact; ranked below O2).

**KPI / validation.** P90 submit to decision and count of >24 hours, weekly; before/after the extra slot.

### O2 — One reviewer and one batch hour carry almost all decisions

**Pain point.** 67.4% of decisions come from one actor; three actors cover 96.9%. Decisions pile up at hour 10 (28.8%). Concentration eased since the previous run (cutoff 2026-11-09, not refreshed) (was 75.9% and 34.5% then) as actors 2 and 3 took more, but it is still a key-person risk on a regulated step.

**Evidence (Observed).** `user_status_logs.auth_user_id` over cohort decisions, all data since 2026-07-21.

| Actor rank | Decisions | Share |
|---|---|---|
| 1 | 903 | 67.4% |
| 2 | 212 | 15.8% |
| 3 | 183 | 13.7% |
| 4 | 26 | 1.9% |
| 5 | 6 | 0.4% |
| 6 | 5 | 0.4% |
| 7 | 4 | 0.3% |

- Actors per status: verified 7 actors (1,065 decisions), failed 6 actors (274 decisions); decisions without actor 0.

- Decisions per month: 2026-07 verified 16 / failed 8; 2026-08 verified 55 / failed 16; 2026-09 verified 74 / failed 19; 2026-10 verified 432 / failed 91; 2026-11 (to 22 Nov) verified 488 / failed 140.

**Root cause (Inferred, Confidence: Medium).** One operations account handles the majority (likely automated, or a shared login used by one team member), with the second and third accounts covering the rest. The data cannot distinguish automatic approval from a human logged into a shared account.

**Expected impact.** Cannot be quantified directly; the risk is a stalled queue. Concrete exposure: the 10:00 batch hour alone holds 386 decisions (28.8%). If that account is unavailable for one workday, all non-batch submits wait at least 24 hours; the tail already observed shows the cost.

**What this means:** One account still does two-thirds of all approvals and rejections, so if it is unavailable the queue stalls; the load is spreading, but slowly.

**Effort.** M (second reviewer / documented delegation + queue age alert).

**Priority.** P1 (high operational risk, medium effort).

**KPI / validation.** Share of decisions per actor (target: no actor >50%); queue age alert at 12 hours.

### O3 — Rejection is almost final, and the reason is not recorded

**Pain point.** Of users rejected since 1 Oct who are still failed, 12 of 105 resubmitted; those who did not resubmit are lost with no recorded reason.

**Evidence (Observed).** Failures from 2026-10-01 to cutoff, GA events 2026-10-01..2026-11-21. Rows labelled "Since 1 Oct" are users whose first failure was on or after 2026-10-01 (`77_final` resub_oct); resubmit = a later `kyc_success` more than 5 minutes after the failure. "Window" is all first failures seen in `user_status_logs` (`71_ops_kyc` resubmit_after_fail).

| Cut | Failed users | Resubmitted | Rate | Ended up verified |
|---|---|---|---|---|
| Since 1 Oct, still failed | 105 | 12 | 11.4% (95% CI 6.7-18.9%) | - |
| Since 1 Oct, ended up verified | 71 | 50 | 70.4% (95% CI 59.0-79.8%) | 71 |
| Window, still failed | 121 | 15 | 12.4% (95% CI 7.7-19.4%) | - |
| Window, ended up verified | 82 | 65 | 79.3% (95% CI 69.3-86.6%) | 82 |

- Resubmission separates outcomes sharply: Since 1 Oct, those who ended up verified resubmitted 70.4% (50/71), those still failed 11.4% (12/105). Correlational: resubmitters are a more persistent, self-selected group.

- October decisions: 432 verified, 91 failed = 17.4% of decision rows failed. November to 22 Nov: 488 verified, 140 failed = 22.3% (partial month). Phase 2 rejected share (user level, all time) 26.6% (6,150 of 23,131 decided); decision rows differ from users.

- Rejection reason: **not available**. No reason/note column in `user_status_logs` or `user_problems`. GA has rejection screens (`BankRejectedScreen`, `OccupationRejectedScreen`) but with no reason param.

**Root cause (Inferred, Confidence: Medium).** No post-rejection nudge: no email or push for users with failed KYC (see M6), so the 88.6% of still-failed users who did not resubmit (93 of 105) are never contacted. Unrecorded reason blocks targeted fixes.

**Expected impact (arithmetic).** Moving 10% of the 105 still-failed users since 1 Oct to resubmission = about 10 users; at resubmit-to-verified rate 70.4% = 7.0 verified; at approved-to-investor rate 21.3% (3,617 of 16,981 verified, Phase 2) = 1.5 investors over 52 days, about 0.9/month. The earlier version used 73.2%, which does not match the approved-to-investor rate in the raw files (73.4% is the approved share of decided users). Small but cheap.

**What this means:** Almost nobody who is rejected tries again, and we do not know why they were rejected, so we cannot help them; those who do retry mostly get approved.

**Effort.** M (store reason + trigger-based resubmission email/push).

**Priority.** P1.

**KPI / validation.** Resubmission rate within 14 days after rejection (Proposed target 15% from 11.4%); rejected to approved conversion.

### O4 — Wait time does not correlate with purchase

**Pain point.** The common assumption that faster KYC approval raises investment is not supported by this data; the point estimate even goes the opposite way.

**Evidence (Observed).** Approved decisions up to 2026-10-25 with GA submit time in the window, n=291.

| Wait submit to approved | n | Bought within 14 days |
|---|---|---|
| a<2h | 221 | 13 (5.9%) |
| b2-24h | 53 | 6 (11.3%) |
| c>=24h | 17 | 3 (17.6%) ⚠n<30 |

- <2 hours vs >=2 hours: 5.9% vs 12.9% (z=-1.92, p=0.054, not significant). Only the >=24 hours bucket has n<30.

- Selection: fast decisions come from submits in the morning batch, who may be users with complete documents during working hours. n is too small to control for it.

**Root cause (Inferred, Confidence: Low).** No causal effect detected; the drop in approved to purchase within 7 days, October approvals vs Jul-Sep approvals (10.5% = 75/714 vs 29.0% = 42/145, z=-5.9, p<0.0001; approvals capped at 2026-11-15), is not explained by wait time: it persists in the approved-within-1-day-of-registration bucket (10.7% = 69/646 vs 29.5% = 28/95; `84_oct_lag`). The October rate is higher than the 7.7% reported at the previous run (cutoff 2026-11-09, not refreshed; different cut: all approvals, longer window), but the drop is still large. Note: wait-time buckets above use submit to approval; the 1-day bucket here uses registration to approval.

**Expected impact.** No claim. Do not justify an SLA program by investor growth; use it for compliance and experience.

**What this means:** We cannot say that approving faster makes people buy; the sample is too small and the gap is not statistically significant.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Repeat with a larger window (n>100 per bucket) before any claim.

### Data requests (Ops & KYC)

- Rejection reason / reviewer note per failed decision (needed for O3).

- KYC submit timestamp in DB (GA join loses users without `user_id`; `user_status_logs` starts 2026-07-21).

- Distinction between automatic and manual decisions (`auth_user_id` can be a shared account or bot).

### 4.4 Product & Engineering

| # | Finding | Evidence | Confidence | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| T1 | KYC drops inside the app: identity to selfie −11.3%, Android 8.5 pp below iOS | 745 identity to 661 selfie; Android submit 79.6% vs iOS 88.1% | High | High | M | P0 |
| T2 | QRIS fails twice as often as other methods | 170/765 (22.2%) vs 11.0-11.1% VA/bank | High | Medium | S | P1 |
| T3 | Approved users who have not bought never return to the buy flow | of 257 seen post-approval, 43 open buy sheet, 8 create order | High | High | M | P0 |
| T4 | Risk profile gate abandoned 28.9%, without significant downstream loss | 28/97 abandon; 46.4% of abandoners still order vs 59.4% | Medium | Low | S | P2 |
| T5 | Client errors logged in GA, without crash/ANR and without alert | 45 `continue_with_google_failed`, 10 `app_exception`, no monitoring | High | Low | S | P2 |

### T1 — KYC flow loses users inside the app, worst on Android at the selfie step

**Pain point.** KYC started 1,157 times, only 955 users reached submit (82.5%). After submit, the investment flow loses another 63.7% before order (347 of 955 create one). Within KYC, the biggest drop attributable to a single screen is identity verification to selfie camera, and Android is 5.4 pp worse than iOS.

**Evidence (Observed).** GA4 users per event, 2026-10-01..2026-11-21 (52 days).

| Step | Users | Change |
|---|---|---|
| `kyc_start` | 1,157 | - |
| `kyc_success` (submit) | 955 | -202 (-17.5%) |

Investment funnel in the same window (user population, not a cohort): `buy_bottom_sheet` 423 to `order_button` 351 (-17.0%) to `order_created` 347 (-1.1%) to `payment_complete` 299 (86.2% of orders).

| Platform | KYC started | Submit | Submit rate |
|---|---|---|---|
| ANDROID | 745 | 600 | 80.5% (95% CI 77.5-83.2%) |
| IOS | 412 | 354 | 85.9% (95% CI 82.2-88.9%) |

- Android vs iOS: 80.5% vs 85.9% (z=-2.31, p=0.021). Absolute difference: 145 Android users did not finish vs 58 on iOS. The gap shrank from 8.5 pp (previous run, cutoff 2026-11-09, not refreshed) to 5.4 pp and is now only borderline significant: the conclusion still holds, but it is weaker.

- Abandonment per screen (users who saw it): `VerificationIntroScreen` 1,260 to `IdentityVerificationScreen` 1,156 (-104, -8.3%); `IdentityVerificationScreen` to `SelfieCameraScreen` 1,024 (-132, -11.4%). After selfie every screen stays above 950, so the loss is concentrated before the selfie is taken.

- `IdentityCameraScreen` has only 670 users, although the previous screen has 1,156. Most likely the event fires for only some users (not everyone who opens the camera), or there is a real drop at document capture. Cannot be distinguished from this data.

- Version 2.28.2: 620 users submitted, version 2.29.0: 316 (a user on two versions counts in both). Start to submit: 2.29.0 81.0% (316/390) vs 2.28.2 83.1% (620/746), z=-0.88, p=0.38. The old "latest build looks worse" signal (n=26) does not hold with the larger sample: no version difference.

**Root cause (Inferred, Confidence Medium).** Two hypotheses, neither tested: (a) selfie camera permission/capture fails or confuses on Android devices; (b) identity document capture is the real barrier and users leave before the selfie. `kyc_screen_view` does not separate 'viewed then left' from 'captured then failed'; device-level data needed.

**What this means:** Many users quit KYC just before the selfie, a bit more on Android; fixing that step is worth about 22 extra investors a year.

**Expected impact (arithmetic).** Closing half the Android-iOS gap: 745 starts x 5.4 pp gap / 2 = 20 extra submits per 52 days. At approved/submit share 73.4% (DB: 16,981 approved / 23,131 submitted, `40_funnel.sql`) and approved to investor 21.3% (3,617/16,981): 3.1 investors per 52 days = 22/year. Assumption: the gap comes from product friction, not device/demographic mix.

**Effort.** M (instrument every KYC screen with outcome events: permission granted, capture attempted, capture failed, back pressed).

**Priority.** P0 (largest funnel leak that product can control).

**KPI / validation.** KYC start to submit per platform and per screen; target Android within 3 pp of iOS.

### T2 — Payments: QRIS fails twice as often as VA or bank transfer

**Pain point.** QRIS holds 11.4% of orders (834 of 7,336) and fails 21.9%, vs 11.2% virtual account and 11.7% bank transfer. Instant payment is only 1.9%.

**Evidence (Observed).** `main.transactions`, orders in the cohort created 2026-01-01..2026-11-22 (`78_gate_pay.sql`).

| Method | Orders | Failed/expired | Fail rate |
|---|---|---|---|
| virtual_account | 3,811 | 427 | 11.2% (95% CI 10.2-12.2%) |
| bank_transfer | 2,427 | 283 | 11.7% (95% CI 10.4-13.0%) |
| QRIS | 834 | 183 | 21.9% (95% CI 19.3-24.9%) |
| INSTANT_PAYMENT | 264 | 5 | 1.9% (95% CI 0.8-4.4%) |

- QRIS vs VA: z=8.32, p<0.0001.

- Order attempts: 1,054 users created orders; 42 (4.0%) have a failed order and never completed one. That is the recoverable core; 321 users failed at some point but 279 of them succeeded another way.

**Root cause (Inferred, Confidence Low).** QRIS failures are most likely expiry/timeout (user scans then leaves), not technical rejects; the data holds only status, no provider error code. Verify gateway error codes before changing anything.

**What this means:** One in five QRIS payments fails, twice the rate of other methods; at most about 90 orders this year would have gone through at the VA rate.

**Expected impact (arithmetic).** Bringing QRIS down to the VA fail rate saves (21.9% − 11.2%) x 834 QRIS orders = 90 orders that are dead today (upper bound, since some users retry with another method).

**Effort.** S (surface provider error code; add expiry reminder on the payment screen).

**Priority.** P1.

**KPI / validation.** Fail rate per method and per provider error code, weekly; target QRIS <15%.

### T3 — Approved users who have not bought do not return to the buy flow

**Pain point.** Of 13,385 approved-not-bought users (78.8% of approved), only 317 are visible in GA (52-day window, partial `user_id` coverage), and of those 56 open the buy sheet; 14 reach order creation.

**Evidence (Observed).** GA4, users with verified decision and no completed purchase, 2026-10-01..2026-11-21.

- Approved-not-bought visible in GA: 317; opened `buy_bottom_sheet` 56 (17.7% (95% CI 13.9-22.2%)); created order 14 (4.4%).

- Compare with users who submitted KYC in the same window: 954 submits vs 347 users creating an order (36.3%). Two different populations (not a funnel), but the scale shows the buy flow works for users who just submitted, and does not work for the post-approval pool.

- Overall investment funnel: `kyc_success` 954 to `buy_bottom_sheet` 423 (44.3%) to `order_created` 347 (82.0%) to `payment_complete` 299 (86.2%). Order to completed payment 86.2%.

- Risk profile gate 36 users in this cohort, 12 abandoned (33.3%).

**Root cause (Inferred, Confidence Medium).** The app has no path back to investing after approval: approval ends as a notification, and the buy entry point is not prominent when the user returns. This is consistent with M6 (no lifecycle messaging) and V1 (post-October decline): three views of the same gap.

**What this means:** Approved users who come back to the app rarely see or use the buy button; a clear buy entry for them is worth about 190 investors a year (rough, untested).

**Expected impact (arithmetic).** If the buy sheet is shown to approved users when they open the app, and 10% of those 317 GA-visible users convert to an order at the order-to-payment rate 86.2%: 317 x 10% x 86.2% = 27 investors per 52 days = 192/year. Scaled to all 13,385 users (assuming equal behavior, untested) it is far larger; do not use that number before measuring.

**Effort.** M (post-approval landing state + buy sheet entry point).

**Priority.** P0.

**KPI / validation.** % of approved users who open the buy sheet within 7/30 days; order-to-payment rate of the post-approval cohort.

### T4 — Risk profile gate: no measurable downstream loss

**Pain point.** 34 of 127 users who triggered the risk profile gate left it, but abandoners still convert at a rate not significantly different.

**Evidence (Observed).** GA `risk_profile_gate_triggered`/`abandoned`, 2026-10-01..2026-11-21.

- Trigger 127, abandon 34 (26.8%). Orders afterward: abandoners 15/34 (44.1%), non-abandoners 57/93 (61.3%). z=-1.73, p=0.084.

**Root cause (Inferred, Confidence Low).** Abandonment is real but temporary; the gate is shown again later. With n<100 on both sides, this may be underpowered, not truly harmless. The conclusion weakened: the gap grew from 13.0 pp (p=0.24) to 17.2 pp (p=0.084), close to significant, so a real downstream loss is now plausible.

**What this means:** Users who leave the risk quiz order less often, but the sample is still too small to be sure; measure before changing it.

**Expected impact.** No claim; only 73 users per 30 days (127 in 52 days). Instrument first, do not redesign.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Gate abandonment rate and 7-day order rate, monthly, with n>=100.

### T5 — Client errors logged, without crash/ANR and without alert

**Pain point.** `continue_with_google_failed` 63 events across 10+ devices, `app_exception` 12 events across 6+ devices, no alert or SLA. No crash/ANR data at all.

**Evidence (Observed).** GA4, 2026-10-01..2026-11-21.

| Event | Events | Devices | Android | iOS |
|---|---|---|---|---|
| `continue_with_google_failed` | 63 | 10+ | 56 | 7 |
| `app_exception` | 12 | 6+ | 11 | 1 |

- Devices = largest per-version count (lower bound; the raw file splits devices by app version). Small volume, but on the registration path (`continue_with_google_failed`) and with no stack trace. Phase 2 already showed registration events are unreliable, so this is indicative, not a census.

**Root cause (Inferred, Confidence Low).** No crash/ANR data in GA (Crashlytics not exported), and `app_exception` is a catch-all event with no stack trace in the export. Severity cannot be ranked.

**What this means:** Login and app errors happen with nobody alerted; error volume is small but invisible to the team.

**Expected impact.** Cannot be quantified without stack traces. The reason to fix is process: errors on the signup and payment paths must trigger alerts, not pile up.

**Effort.** S (alert on rate of `continue_with_google_failed` and `app_exception`; export Crashlytics).

**Priority.** P2.

**KPI / validation.** Error event rate per 1,000 sessions, weekly, with alert threshold.

### Data requests (Product & Engineering)

- Outcome events per KYC screen (capture attempted/failed, permission denied, back pressed): blocks T1.

- Provider error code on failed transactions: blocks T2 sizing.

- Crashlytics/ANR export: blocks T5 severity.

- `user_id` on pre-login GA events, and campaign id on notification events.

## 5. Cross-team roadmap (now / next / later)

Aligned with the P&T 2027 roadmap (draft): VA gateway (Q1) covers T2; website redesign (Q2) and app redesign (Q3) cover T1, T3, T4. See `raker_preparation.md` section 0.5.

**Now (0-30 days) — no new code, or small code.**

| Action | Owner | Dependency | Success measure |
|---|---|---|---|
| Change bonus policy: credit only after first paid purchase (M2) | Marketing + Finance | program owner decision | credit exposure to non-payers |
| Post-approval CRM trigger + first-investment message (M6, V2) | Marketing + Ops | daily approved list | first purchase within 7 days vs holdout |
| Evening/weekend review slots + 12-hour queue-age alert (O1, O2) | Ops | reviewer roster | P90 and count >24 hours |
| Store KYC rejection reason + resubmission email (O3) | Ops + Tech | reason column | 14-day resubmission rate |
| `user_id` in batch email log + click events (M4) | Tech | Supabase schema | % of sends joined |

**Next (30-90 days) — product changes.**

| Action | Owner | Dependency | Success measure |
|---|---|---|---|
| Post-approval surface: buy sheet when an approved user opens the app (T3, V2) | Tech + Product | design + state | % of approved opening buy sheet at 7/30 days |
| Outcome instrumentation per KYC screen (T1) | Tech | new events | KYC start→submit Android vs iOS |
| Agent follow-up on day 7 and day 30 for sales code cohort (M1) | Marketing | CRM task | mature repeat +5 pp within 90 days |
| Show payment provider error codes + QRIS expiry reminder (T2) | Tech | gateway | QRIS fail rate <15% |
| 10% holdout for first-purchase promo (M3) | Marketing | experiment | 90-day repeat promo vs control |

**Later (90-180 days) — data and scale.**

| Action | Owner | Dependency | Success measure |
|---|---|---|---|
| Crashlytics/ANR export + error alerts on signup/payment path (T5) | Tech | SDK | error rate per 1,000 sessions |
| `campaign_id` on push/email + push holdout (M5) | Marketing + Tech | event schema | first purchase within 7 days post-click vs holdout |
| Diagnose October drop: channel mix vs product change (V1) | all teams | channel mix data | cause identified |
| Server-side events for register/approve/order/pay (Phase 2 reconciliation) | Tech | pipeline | GA vs DB gap <2% |

Cross-team dependency: no P0 can be completed within a single team. The approved pool needs Marketing (trigger), Tech (surface), and Ops (queue with due date) at once; that is why V2 is written as one program, not three tickets.

## 6. Appendix

### 6.1 Data dictionary, definitions, quality

See `outputs/data_dictionary.md`, `outputs/definitions.md`, `outputs/data_quality.md`.

### 6.2 Scripts and queries

Phase 1: `01`-`06`, `10`-`16`, `20`-`22`, `30`, `31`. Phase 2: `40`-`42`, `44`-`52`. Phase 3: `60`-`62`, `70`-`73`, `75`-`86`. Document builders: `build_phase2.py`, `build_phase3.py`, `build_phase4.py`. Runners: `bq.js` (single query, JSON), `q.py` (`-- Q:` blocks), `run_many.py`. All queries SELECT-only with `maximumBytesBilled` 5e9.

### 6.3 Provenance

See `outputs/data_provenance_log.md` (every key figure with source, window, and script).

### 6.4 Data requests (combined)

- KYC rejection reason per decision, and KYC submit timestamp in the DB.
- Distinguish automatic vs manual decisions on `user_status_logs.auth_user_id`.
- `user_id` on pre-login GA events; `campaign_id` on notification events and email log; click event type on email.
- Provider error codes on failed transactions.
- Crashlytics/ANR export.
- Bonus program rules (who, when, how much).
- Acquisition channel mix per month (to explain V1).

### 6.5 Skills and tools

Skill `gcp-bigquery` (project rules and definitions). `@google-cloud/bigquery` via `scripts/bq.js`. Supabase MCP read-only (project `josptpfisrsdjeggkqke`). No new dependencies installed.
