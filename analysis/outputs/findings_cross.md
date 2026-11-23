# Cross-team findings — Phase 3

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22), so every user had the same time to buy again. Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21, 52 days).

Built 2026-11-22 WIB from `outputs/raw/`. Figures derived directly from raw files; none typed by hand.

## V1 — Approved-to-purchase drops in October, and it is not about wait time

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

## V2 — The piled-up approved pool is one problem with three faces

**Pain point.** Marketing sees it as no lifecycle (M6), engineering as no path back (T3), operations as a queue that triggers nothing (O1/O2). All point to the same 13,385 approved-not-purchased users.

**Evidence (Observed).** 13,385 approved users without a completed purchase; 560 approved in the last 30 days; 317 from that pool seen in GA within 52 days, 56 opened the buy sheet, 14 created an order.

**Root cause (Inferred, Confidence Medium).** Approval is the end of a process, not the start of the next one. No trigger (CRM), no surface (product), no queue (operations) carries approved users to a first investment. This is a coordination failure, not a failure of one team.

**Expected impact (arithmetic).** Conservative baseline: 10% of 317 GA-visible users convert to an order at an order-to-payment rate of 86.2% = 27 investors per 52 days (192/year). The full scenario uses 13,385 users; do not report it before it is measured.

**Effort.** M (one program: approval trigger to CRM + in-app surface + operations queue with due date).

**Priority.** P0.

**KPI / validation.** Approved-to-first-investment within 7/30 days, one cross-team dashboard; Target +10 pp from the October baseline.

**What this means.** 13k approved users never bought. Only 317 showed up in GA, 56 opened the buy sheet, 14 ordered. No system connects approval to first investment.

## Priority summary

| Priority | Finding | Reason |
|---|---|---|
| P0 | V1 / V2 / T3 (approved pool), M2 (bonus to non-payers), T1 (KYC funnel) | Largest Impact, figures computable, mostly controllable by product/policy |
| P1 | M1 (sales code retention), M4 (unmeasured email), M6 (lifecycle), O1/O2/O3 (SLA, key-person, rejection), T2 (QRIS) | Medium Impact, small-to-medium Effort |
| P2 | M3 (promo), M5 (push), O4 (wait), T4 (gate), T5 (error) | Weak Evidence or correlational |

## All figures not yet testable

- Bonus lift (M2), promo (M3), push (M5), lifecycle messaging (M6), and post-approval surface (T3/V2) are arithmetic estimates from correlation. No randomized experiment exists in this data.

- T1 and T4: small n in certain buckets; the `n<30` flag is marked in the table.

- V1: cause not yet identified; three open hypotheses, all needing October channel mix data.

## Phase 2 follow-ups answered here

- Approved-not-purchased (Phase 2: 78.8%) deepened: 317 seen in GA, 56 opened buy sheet, 14 orders (T3), and the October drop measured (V1).

- Phase 2 question 'what happens after KYC': the flow stops with no trigger, no surface, no queue (V2).

- Phase 2 question on booth mix: sales code contributes to a low-intent mix but is not the sole explanation (M1).