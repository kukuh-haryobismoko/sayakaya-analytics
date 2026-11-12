# Churn profile (Phase 2)
Run 2026-11-09 18:34 WIB. Cohort C investors (n = 3,587). Churned = no buy/sell/SWITCH_IN for more than 90 days at 2026-11-09 (`definitions.md`). Scripts: `43_dur.sql`, `50_indicators.sql`, `49_chk.sql`, `build_phase2.py`.

## Who and when (Observed)
- 3,000 of 3,587 investors churned (83.6%). To avoid counting young accounts, tables below use the 3,459 investors whose first buy is more than 90 days ago (3,000 churned = 86.7%).
- Among churned users, last activity falls: same day as first buy 11.6%; within 7 days 14.4%; within 30 days 23.8%; median 203 days after first buy; p75 585 days.

## Survival curve (Kaplan-Meier, share of investors not yet churned, days since first buy)
Churn is dated 90 days after the last activity; users still active or inside the window are censored at their age.

| Days since first buy | 90 | 120 | 180 | 270 | 365 | 450 |
|---|---|---|---|---|---|---|
| Not churned | 89.9% | 79.3% | 68.1% | 58.3% | 50.7% | 46.2% |

Reading: 10% churn before day 90 (they never came back after the first buy day); half are gone by about one year. This chart is dominated by the 2022-2025 buyers (older buyers outnumber recent ones, see "By first-buy half-year").

## After what behaviour (Observed, correlation)
Active days in first life (all activity days, users with first buy over 90 d ago):
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 1 | 349 | 349 | 100.0% | 98.9-100.0% |
| 2-3 | 1,230 | 1,186 | 96.4% | 95.2-97.3% |
| 4-9 | 867 | 799 | 92.2% | 90.2-93.8% |
| 10+ | 1,013 | 666 | 65.7% | 62.8-68.6% |

Read: all 349 one-day users churned by definition (one active day cannot be followed by a return), so this table mostly says "repeat buyers survive". Not independent of the definition.

Leading indicators measured at first buy / first 30 days (users with first buy at least 120 days ago, so every user has had the same observation time; churn = silent > 90 d now). Indicators are measured before churn, so they are usable for early warning, but these are Correlation, not Causal:

Activity in the 30 days after first buy (count of active days):
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 0 | 1,641 | 1,491 | 90.9% | 89.4-92.2% |
| 1 | 978 | 853 | 87.2% | 85.0-89.2% |
| 2-3 | 623 | 504 | 80.9% | 77.6-83.8% |
| 4+ | 201 | 149 | 74.1% | 67.7-79.7% |

z-test 0 vs 4+ days: 7.2. Evidence: High (large n, big gap).

Size of the first buy:
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| <100k | 598 | 571 | 95.5% | 93.5-96.9% |
| 100-500k | 1,245 | 1,117 | 89.7% | 87.9-91.3% |
| 0.5-5jt | 954 | 775 | 81.2% | 78.6-83.6% |
| 5jt+ | 646 | 534 | 82.7% | 79.6-85.4% |

z-test <100k vs 0.5-5jt: 8.1. Evidence: Med (could reflect testers or bonus-triggered tiny buys).

Fund type of the first buy:
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| EQUITY | 606 | 550 | 90.8% | 88.2-92.8% |
| FIXED_INCOME | 907 | 759 | 83.7% | 81.1-85.9% |
| MIXED | 860 | 744 | 86.5% | 84.1-88.6% |
| MONEY_MARKET | 1,030 | 913 | 88.6% | 86.6-90.4% |
| PROTECTED | 40 | 31 | 77.5% | 62.5-87.7% |

Payment method of the first buy:
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| INSTANT_PAYMENT | 40 | 37 | 92.5% | 80.1-97.4% |
| QRIS | 67 | 58 | 86.6% | 76.4-92.8% |
| bank_transfer | 2,439 | 2,111 | 86.6% | 85.1-87.8% |
| virtual_account | 897 | 791 | 88.2% | 85.9-90.1% |

Types or methods with fewer than 10 users are shown as `<10`; PROTECTED n = 40 is low-confidence.

## By first-buy half-year (Simpson / survivorship check)
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 2021-H2 | 25 | 20 | 80.0% | 60.9-91.1% |
| 2022-H1 | 977 | 830 | 85.0% | 82.6-87.1% |
| 2022-H2 | 367 | 328 | 89.4% | 85.8-92.1% |
| 2023-H1 | 193 | 162 | 83.9% | 78.1-88.4% |
| 2023-H2 | 219 | 192 | 87.7% | 82.7-91.4% |
| 2024-H1 | 247 | 221 | 89.5% | 85.0-92.7% |
| 2024-H2 | 250 | 220 | 88.0% | 83.4-91.5% |
| 2025-H1 | 642 | 603 | 93.9% | 91.8-95.5% |
| 2025-H2 | 313 | 260 | 83.1% | 78.5-86.8% |
| 2026-H1 | 203 | 156 | 76.8% | 70.6-82.1% |
| 2026-H2 | 23 | <10 | 34.8% | 18.8-55.1% |

Newer cohorts show lower churn mainly because they have had less time to churn (right-censoring), so do not read 2026-H1 as an improvement without the survival curve.

## Leading indicator summary
- Observed: no follow-up activity in the 30 days after the first buy -> 90.9% churn vs 74.1% with 4+ active days.
- Observed: first buy under Rp100k -> 95.5% churn vs 81.2% for Rp0.5-5 million.
- Inferred: a 30-day reactivation push after first buy is the earliest lever; first buy size under Rp100k marks low commitment. Proposed for Phase 3.
- Not available: churn by marketing source/device (the DB has no acquisition field; GA user mapping covers only Oct-Nov 2026). Added to Data Requests.
