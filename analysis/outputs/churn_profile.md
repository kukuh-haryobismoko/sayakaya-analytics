# Churn profile (Phase 2)

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22; first purchase on or before 2026-07-25), so every user had the same time to buy again. Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21).
Run 2026-11-22 WIB. Cohort C investors (n = 3,617). Churned = no buy/sell/SWITCH_IN for more than 90 days at 2026-11-22 (`definitions.md`). Scripts: `43_dur.sql`, `50_indicators.sql`, `49_chk.sql`, `build_phase2.py`.

## Who and when (Observed)
- 3,008 of 3,617 investors churned (83.2%). To avoid counting young accounts, tables below use the 3,465 investors whose first buy is more than 90 days ago (3,008 churned = 86.8%).
- Among churned users, last activity falls: same day as first buy 11.6%; within 7 days 14.3%; within 30 days 23.7%; median 203 days after first buy; p75 583 days.
- What this means: about 5 in 6 investors have gone quiet for over 3 months; roughly 1 in 4 of them were gone within a month of their first buy.

## Survival curve (Kaplan-Meier, share of investors not yet churned, days since first buy)
Churn is dated 90 days after the last activity; users still active or inside the window are censored at their age.

| Days since first buy | 90 | 120 | 180 | 270 | 365 | 450 |
|---|---|---|---|---|---|---|
| Not churned | 90.0% | 79.4% | 68.1% | 58.3% | 50.7% | 46.2% |

Reading: 10% churn before day 90 (they never came back after the first buy day); half are gone by about one year. This chart is dominated by the 2022-2025 buyers (older buyers outnumber recent ones, see "By first-buy half-year").
What this means: after one year only about half of investors are still active; the biggest losses come in the first 6 months.

## After what behaviour (Observed, correlation)
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

## By first-buy half-year (Simpson / survivorship check)

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

## Leading indicator summary
- Observed: no follow-up activity in the 30 days after the first buy -> 91.1% churn vs 74.3% with 4+ active days.
- Observed: first buy under Rp100k -> 95.8% churn vs 81.8% for Rp0.5-5 million.
- Inferred: a 30-day reactivation push after first buy is the earliest lever; first buy size under Rp100k marks low commitment. Proposed for Phase 3.
- Not available: churn by marketing source/device (the DB has no acquisition field; GA user mapping covers only Oct-Nov 2026). Added to Data Requests.
- What this means: the cheapest moment to keep an investor is the first 30 days after the first buy.
