# Autodebet: Success Metrics 2027 (simple version)

Short version of `autodebet-success-metrics-2027.md`. Queries, schema and tracking details are in the full file. Baselines are measured in BigQuery on 2026-10-27/28, internal staff excluded. Targets are assumptions.

## Why Autodebet

Nabung Rutin today is a reminder invoice. The user must open it and pay by VA or QRIS. Few do.

- 7 of 30 settled recurring invoices were paid: 23.3% (95% CI 11.8% to 40.9%).
- Normal buys settle at 88.6% (VA), 90.7% (bank transfer), 76.4% (QRIS).

Autodebet should close that gap by taking the payment without a user action.

## Nabung Rutin rule used everywhere

Recurring transaction = `transactions.investment_plan_id` is not null. The first transaction has no `investment_plan_id`; it is the activation event and never counts as recurring. Checked on data: 62 of 63 plans have this first buy within 10 minutes after `investment_plans.created_at`.

## Baseline (measured)

| Item | Value |
|---|---|
| Nabung Rutin users (external) | 15 users, 44 plans |
| Plans with a paid first transaction | 14 of 44 |
| Of those, with 1 or more paid recurring invoice | 5 of 14 |
| Users who paid a recurring invoice, Oct 2026 | 3 |
| Plans whose first order was cancelled | 24 of 44 |
| Recurring invoice paid rate | 23.3% (7 of 30) |
| Plan buys share of all completed buys, Aug-Oct 2026 | 0.66% by count |
| Repeat-buy M1 / M3 (all users, not plan-specific) | 35.8% / 10.7% |

Caution: the base is tiny. Read rates with their counts.

## North Star

**Active recurring savers per month**: distinct users with at least one paid recurring transaction in the month. Baseline 3 (Oct 2026).

## Primary metrics

1. Debit success rate (cycles paid / cycles due). Baseline 23.3% (manual invoices).
2. Mandate approval rate (mandates approved / mandates started). No baseline.
3. First successful debit within 35 days of mandate approval. No baseline.
4. Month-3 survival of Autodebet plans. No baseline.
5. Autodebet share of paid recurring cycles. Baseline 0%.

## 2027 targets (assumptions)

| Metric | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| Active recurring savers, conservative / base / ambitious | 6 / 10 / 20 | 12 / 25 / 45 | 20 / 40 / 80 | 30 / 60 / 120 |
| Debit success rate, base | 80% | 83% | 85% | 87% |
| Mandate approval rate, base | 60% | 65% | 70% | 72% |
| Autodebet share of recurring cycles, base | 30% | 45% | 60% | 70% |

Base debit success sits just under the 89-91% that normal VA and bank transfer buys reach. Recalibrate after 8 weeks of live data.

## Guardrails

- Manual Nabung Rutin plus one-off buy volume per active buyer: not below -5% of the pre-launch 3-month mean.
- Failed-debit rate: at most 15% after week 8; stop at 30% in any week.
- Mandate revocation: at most 5% per month.
- Reconciliation mismatch with bank settlement: at most 0.5%.
- Support tickets per 1,000 debits: ceiling set after the first 4 weeks.

## Gate to add BCA (Q3 2027), after 8 weeks live on BNI and Mandiri

| Check | Go | No-go |
|---|---|---|
| Debit attempts observed | 385 or more (about +/-3 points at 90%) | under 139 |
| Debit success rate, last 4 weeks, each bank | 85% or higher | under 80% |
| Mandate approval rate | 60% or higher | under 45% |
| Monthly mandate revocation | 5% or lower | over 10% |
| Reconciliation mismatch | 0.5% or lower | over 2% |
| Volume per active buyer | within -5% | below -10% |

In between: extend 4 weeks and read again.

## How to compare fairly

Randomise: show the Autodebet option to a random 50% of new plan creators for 8 weeks. Fallback is matching on past buying behaviour, which is weaker. Always start from the first recurring cycle and leave out the activation transaction.

## Data needed (details in the full file)

- New tables: mandate, mandate-to-plan link, debit attempt, bank response codes. Bank is a column, so BCA is a new row, not a schema change.
- `investment_plans.activation_transaction_id` to replace the 10-minute guess.
- New GA events with prefix `autodebet_` (method select, bank select, auth redirect and return, mandate result, debit result). GA today has no plan or payment-method parameter, so plan checkout cannot be told from a one-off buy.
- Join GA to main on `user_id` (99.9% of GA users found in `users`).

## Risks

1. Tiny base: 3 paying users in Oct 2026. Early rates are noisy.
2. 24 of 44 plans are abandoned at the first order. A bank redirect at that step may lose more users.
3. Bank terms (limits, retries, settlement files) are unknown.
4. Support ticket and dispute data are not in BigQuery.

## Decisions needed from leadership

1. Launch date for BNI and Mandiri, and the BCA window.
2. Approve the 50/50 randomised rollout for 8 weeks.
3. Who pays the Autodebet fee.
4. Is the first transaction paid by VA/QRIS or by the first debit.
5. Approve the go/no-go thresholds above.
6. Budget and owners for the build, about 14 to 16 weeks to a first readout.
