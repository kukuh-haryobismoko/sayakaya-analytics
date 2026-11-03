# Autodebet: Metrics and Data Mapping (simple, metrics-focused)

Companion to `autodebet-success-metrics-2027-simple.md`. Full SQL, schemas and tracking spec: `autodebet-success-metrics-2027.md`.

Labels: **[measured]** from BigQuery on 2026-10-27/28, internal staff excluded. **[assumption]** not verified in repo or data. Targets are always assumptions.

## 1. Terms

| Term | Meaning |
|---|---|
| Autodebet | The user allows their bank to let SayaKaya pull the Nabung Rutin amount from their account on schedule. No invoice to pay by hand. |
| Mandate | That permission. One record per user per bank, with a limit and an expiry. Without an active mandate there is no debit. |
| Mandate approval | The bank confirms the permission. The user is sent to the bank, authorises there, and comes back. Approved = status `ACTIVE`. Other outcomes: rejected, expired (user never returned), still pending. |
| Mandate approval rate | Mandates approved / mandates started. Low = the bank step is too hard or the bank declines. |
| Debit attempt | One try to pull money for one plan cycle. A cycle can have several attempts (retries). |
| Cycle | One due date of a plan (for example the monthly saving). |
| Activation transaction | The user's first buy that starts Nabung Rutin. It has no `investment_plan_id`. Never counted as recurring. |
| Recurring transaction | `transactions.investment_plan_id` is not null. |

The exact bank screens (redirect, PIN or OTP) are not in the repo. [assumption] Bank rules (limits, retries, settlement files) for BNI and Mandiri are unknown.

## 2. How a user moves through Autodebet

1. Sees the Autodebet option when creating or editing a Nabung Rutin plan.
2. Picks Autodebet, then picks a bank.
3. Is sent to the bank, authorises, returns to the app.
4. Mandate becomes `ACTIVE` (this is mandate approval).
5. On each due date the system tries a debit. Success creates a normal `buy` transaction with `investment_plan_id` set.
6. Failure: retry if the reason allows it. After the last retry the cycle fails.
7. User can pause, change bank or cancel (revoke) the mandate.

## 3. Metrics

Every metric can be sliced by bank, plan cohort month, plan amount band, frequency, acquisition channel (GA `traffic_source.medium`) and device (GA `platform`). Dates use Asia/Jakarta.

### 3.1 Adoption

| Metric | Formula | Source | Baseline |
|---|---|---|---|
| Registration start rate | users who select Autodebet / users who see the payment method sheet | GA events | none, no event today |
| Registration completion rate | mandates returned from bank / mandates sent to bank | mandate table, GA | none |
| **Mandate approval rate** | mandates approved / mandates started (leave out ones still inside the timeout) | mandate table | none |
| Time to approval | median and p90 of approved time minus start time | mandate table | none |
| Adoption among Nabung Rutin users | users with an active mandate / users with a live plan and paid activation | mandate-to-plan link, `investment_plans`, `transactions` | 0% [measured]: 15 external users with a plan |
| New plans choosing Autodebet | plans with a mandate within 24 h of creation / new plans with paid activation | same | 0% [measured]: 14 plans with paid activation since 2026-07-31 |

### 3.2 Funnel

Each user counts once per step (distinct `user_id`). Step rate = users at this step / users at the previous step. Overall rate = users at the last step / users at the first step. The `autodebet_*` events do not exist yet; the names are proposed (full spec in the full file, section 5). Slices: bank, device, channel.

| Step | What the user does | Step rate (formula) | Source | Baseline |
|---|---|---|---|---|
| F1 | Sees the Autodebet entry point | users `autodebet_entry_view` / users who see the payment method sheet (`SubscriptionPaymentMethodBottomSheet`) | GA | none, no event today |
| F2 | Picks Autodebet | users `autodebet_method_select` / users at F1 | GA | none |
| F3 | Picks a bank | users `autodebet_bank_select` / users at F2 | GA | none |
| F4 | Finishes authorisation at the bank | users `autodebet_auth_return` with `result = success` / users `autodebet_auth_redirect` | GA | none |
| F5 | Mandate becomes `ACTIVE` | mandates `ACTIVE` / authorisations returned from the bank (success, failed and rejected) | mandate table | none |
| F6 | First debit succeeds | users with a `SUCCESS` debit within 35 days / mandates `ACTIVE` | debit attempts | none |
| Overall | Entry to first debit | users at F6 / users at F1 | GA + tables | none |

Mandate approval rate (3.1) is F5 seen from the mandate side. If F4 is high but F5 is low, the problem is at the bank, not on the app screens.

Shape reference [measured]: the current subscription flow, 30 days (2026-09-27 to 2026-10-26), distinct users, query `k3`. This is the normal subscription buy flow, not Autodebet, and not a baseline for F1 to F6. Use it as a picture of normal drop-off.

| Step (screen or GA event) | Users | Step rate | From first step |
|---|---|---|---|
| Form (`SubscriptionFormBottomSheet`) | 346 | - | 100% |
| Checkout (`SubscriptionCheckoutScreen`) | 311 | 89.9% | 89.9% |
| Payment method sheet (`SubscriptionPaymentMethodBottomSheet`) | 300 | 96.5% | 86.7% |
| Order button (`order_button`) | 252 | 84.0% | 72.8% |
| Order created (`order_created`) | 247 | 98.0% | 71.4% |
| Payment screen (`PaymentScreen`) | 250 | 101.2% | 72.3% |
| Payment complete (`payment_complete`) | 188 | 75.2% | 54.3% |

Payment screen is larger than order created (rate above 100%). Cause not checked; the payment screen may be reached from another path, or some `order_created` events are not sent. The current GA events carry no plan or payment method parameter, so Nabung Rutin cannot be separated from a normal buy. In the same period `InvestmentPlanListScreen` was viewed by 43 users and `InvestmentPlanSuccessScreen` by 8; a rough hint only, not the same funnel.

### 3.3 Debit performance

| Metric | Formula | Baseline (manual invoices) |
|---|---|---|
| Debit success rate | cycles whose last attempt succeeded / cycles due with a final outcome | 23.3% paid of settled invoices, 7 of 30, CI 11.8% to 40.9% [measured] |
| First-attempt success | cycles paid on attempt 1 / cycles due | none |
| Failure rate by reason | failed attempts per reason group / all attempts | none; today only expiry (23 of 32 settled invoices expired) |
| Retry recovery | cycles failed first then paid / cycles failed first | none |
| Insufficient balance rate | attempts with that reason / all attempts | none |
| On-time rate | cycles paid by end of due date / cycles due | median time to pay 649 min, p75 3,036 min |
| Days to successful debit | mean days from due date to paid | median about 0.45 days |

### 3.4 Retention

| Metric | Formula | Baseline |
|---|---|---|
| Retention M1, M3, M6, M12 | cohort = plans with paid activation, by activation month; retained = plan has a paid recurring transaction in month +k; only count plans whose month +k has ended | not computable yet: 1 plan has a matured month 1 |
| Plan survival | plans not deleted at +k / plans with paid activation | 18 of 44 external plans live (41%) |
| Consecutive paid cycles | longest run of paid cycles from cycle 1 | none |
| Churn and mandate revocation | plans deleted or mandates revoked in month / live at start | 26 of 44 plans deleted (59%) |
| Reactivation | users who revoked and get a new active mandate within 90 days / users who revoked | none |

Proxies [measured]: 5 of 14 external plans with paid activation have 1 or more paid recurring invoice (36%); 1 of 14 has 2 or more. 19 of the 24 plans whose first order was cancelled were deleted. All users, any buy (not Nabung Rutin): repeat in month 1 35.8%, month 3 10.7%.

### 3.5 Value

| Metric | Formula | Baseline |
|---|---|---|
| Average transaction value | mean and median `amount` of paid recurring transactions | 7 paid external invoices totalling IDR 10,795,000; one is 10M, median at most about 200,000 |
| Savings volume per user | paid `amount` per active user per month | Oct 2026, all buys: 899 buys, 430 buyers |
| Lifetime savings value | paid `amount` in 12 months after activation | not measurable yet |
| Incremental volume | volume per user in Autodebet group minus control group | needs the experiment (3.7) |
| Share of volume from Autodebet | paid Autodebet amount / paid buy amount | 0%; all plan buys are 0.66% of buys by count |
| Fee per transaction | `payment_fee`, `app_covered_fee`, `user_fee` by method | average payment fee IDR: BNI VA 55, MANDIRI VA 260, BCA VA 120 |

Autodebet fee per debit is unknown (bank contract). [assumption] SayaKaya revenue effect cannot be measured from `main`.

### 3.6 Operations and risk

| Metric | Formula | Source |
|---|---|---|
| Bank error rate | attempts with bank-down or timeout / attempts, per bank per day | debit attempts, response codes |
| Reconciliation mismatch | settlement lines not matching our records / all lines | bank settlement file |
| Support ticket rate | Autodebet tickets / 1,000 debits | not in repo or BigQuery [assumption] |
| Dispute rate | disputed debits / successful debits | bank dispute file [assumption] |

### 3.7 Fair comparison

Users who accept a mandate are probably better savers anyway. Two ways to handle it:

1. Preferred: for 8 weeks, show the Autodebet option to a random 50% of new plan creators (hash of user id). Compare offered vs not offered.
2. Fallback: match Autodebet users to manual users on 90-day pre-period buying, tenure, device, channel and amount band.

Both exclude the activation transaction.

Sample size, 95% confidence, 80% power [measured baseline, assumed targets]:

| Metric | Baseline | Detect | Units per arm |
|---|---|---|---|
| Recurring invoice paid rate | 23.3% | 60% | 28 invoices |
| Repeat in month 1 (proxy) | 35.8% | 45.8% | 378 users |
| Repeat in month 3 (proxy) | 10.7% | 20.7% | 207 users |

A success rate near 90% needs about 139 attempts for +/-5 points and 385 for +/-3 points. At 6 new external plans in Oct 2026, 100 plans per arm takes about 33 months, so early readouts must use debit-level metrics, or marketing must raise plan creation.

## 4. Data mapping

| What we need | Where it is today | What to add |
|---|---|---|
| Recurring Nabung Rutin transaction | `transactions.investment_plan_id` not null (verified: 61 rows, all `type = buy`, no orphan plans, no user mismatch) | nothing |
| Activation transaction | guessed: first `buy` without `investment_plan_id` within 10 min of plan creation (62 of 63 plans match) | `investment_plans.activation_transaction_id` |
| Which bank | `transactions.virtual_account_bank`, `investment_plans.virtual_account_bank` | `bank_code` column in the new tables; BCA is a new row, not a schema change |
| Payment method | `transactions.payment_method` | new value `autodebet` |
| Signup funnel | not tracked | GA events with prefix `autodebet_`, `user_id` on every event |
| Channel and device | GA `traffic_source.medium`, `platform` | nothing, join on `user_id` |
| Mandate status and dates | does not exist | `autodebet_mandates` |
| Which plan uses which mandate | does not exist | `autodebet_mandate_plans` |
| Every debit try and failure reason | does not exist | `autodebet_debit_attempts`, `autodebet_response_codes` |
| Bank messages | does not exist | `autodebet_bank_events` (stored raw, for audit and dedupe) |
| Did bank money match our records | does not exist | `autodebet_settlement_lines`, loaded from the bank file |

Tell Autodebet from manual:

| Group | Rule |
|---|---|
| Manual recurring | `investment_plan_id` not null and no debit attempt linked |
| Autodebet recurring | `investment_plan_id` not null and a debit attempt linked (`payment_method = 'autodebet'`) |
| Plan on Autodebet | plan linked to an `ACTIVE` mandate |

Until the tables ship, all recurring transactions count as manual.

Rules that keep the data trustworthy:
- Each debit has a unique key, so a repeated bank callback never creates a second payment.
- Timestamps stored in UTC, business dates in Asia/Jakarta. Open point: current plan invoices are created at 00:00 UTC (07:00 Jakarta); pick one rule for the due date.
- No bank account numbers. Only a token and a masked value. Samples hash user ids: `SUBSTR(TO_HEX(MD5(user_id)),1,6)`.
- Status changes are kept as history, never overwritten.

## 5. Data pipeline (plain version)

Four steps. Same steps for every metric.

| Step | What happens | Data in | Data out | Refresh |
|---|---|---|---|---|
| 1. Collect | The app database already mirrors into BigQuery `sayakaya.main`. New Autodebet tables join that mirror. GA already exports to `analytics_266759216`. Bank settlement files get loaded once a day. | app DB, GA, bank callbacks, bank files | raw tables | DB: hours (existing). GA: daily plus intraday. Bank file: daily |
| 2. Clean | Remove internal staff, convert to Asia/Jakarta dates, drop duplicate callbacks, flatten GA event parameters, hash user ids. | raw tables | staging tables | hourly |
| 3. Calculate | One row per mandate, one row per debit attempt, one daily snapshot per user, one funnel table, one metrics table. | staging tables | marts | daily 02:00 Asia/Jakarta |
| 4. Show | Dashboards read only the metrics table. | metrics table | 4 dashboards | daily |

The metrics table has one shape for all metrics: metric id, period, bank, numerator, denominator, value. A new metric is a new set of rows, not a new dashboard query.

The repo has no dbt, Dataform or Airflow. Smallest start: BigQuery scheduled queries for steps 2 and 3, and a GitHub Actions job (like `cron-run-schedules.yml`) for the bank file. [assumption]

### One debit, end to end

1. Plan cycle is due: a `SCHEDULED` row appears in `autodebet_debit_attempts`.
2. The backend sends it to the bank. Row becomes `SUBMITTED`; the bank reply is stored in `autodebet_bank_events`.
3. On success: a `buy` transaction is created with `investment_plan_id` and `payment_method = 'autodebet'`; the attempt links to it.
4. Next day the bank settlement file lands in `autodebet_settlement_lines`; matching on bank reference and amount sets `MATCHED` or a mismatch.
5. The 02:00 job recomputes debit success, failure reasons and mismatch rate.
6. Dashboards update. Alerts fire if a threshold is crossed.

### Checks and alerts

Run after every load; a failure sends an alert.
- Row counts never go down; mart row count equals raw.
- `bank_code`, mandate id, due date and unique key are never empty.
- One `SUCCESS` per plan per due date.
- Every `SUCCESS` attempt has a transaction with `investment_plan_id` set.
- No debit attempt for a plan without a paid activation transaction.
- Freshness: attempts under 2 hours old; yesterday's GA table present by 12:00; bank file loaded daily.
- `SUCCESS` attempts without a matched settlement line after 2 days.

Alerts [assumption on thresholds]: debit success below 80% for any bank-day; bank error rate above 5% in an hour; mismatch above 0.5%; revocations above 3 times the 7-day mean.

### Dashboards

| View | For | Shows |
|---|---|---|
| Executive (Raker) | leadership | North Star trend, debit success, mandate approval, Autodebet share of recurring cycles, M3 survival, guardrails (green, amber, red), BCA gate scorecard |
| Product | product, design | funnel by bank and device, adoption, time to approval, experiment readout |
| Operations | ops, support | debit success by bank and day, failure reasons, retries, bank errors, mismatch list (hashed ids) |
| Finance | finance | Autodebet share of volume, fee per transaction by bank and method, settlement vs transactions by day |

The dashboard app already reads BigQuery from `server/queries.js` and `supabase/functions/api/queries.ts`; new panels follow the same pattern.

### Effort and order [assumption]

| Step | Work | Time | Owner |
|---|---|---|---|
| 1 | Decide open questions, sign off tables | 1 week | Product, Backend lead |
| 2 | Tables, mandate and debit services, bank callbacks | 4 to 6 weeks | Backend |
| 3 | GA events and QA (parallel with 2) | 2 weeks | Mobile, Data |
| 4 | Backfill `activation_transaction_id`, staging | 1 week | Data |
| 5 | Marts, checks, alerts | 2 weeks | Data |
| 6 | Dashboards | 2 weeks | Data |
| 7 | Settlement load and reconciliation | 2 weeks | Backend, Finance |
| 8 | Staged rollout, first readout after 8 weeks live | 8 weeks | Product, Data |

First full readout about 14 to 16 weeks after the decisions.

## 6. Targets (assumptions)

North Star: active recurring savers per month, users with at least one paid recurring transaction. Baseline 3 in Oct 2026 [measured].

| Metric | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| Active recurring savers (conservative / base / ambitious) | 6 / 10 / 20 | 12 / 25 / 45 | 20 / 40 / 80 | 30 / 60 / 120 |
| Debit success rate (base) | 80% | 83% | 85% | 87% |
| Mandate approval rate (base) | 60% | 65% | 70% | 72% |
| Autodebet share of recurring cycles (base) | 30% | 45% | 60% | 70% |

Guardrails: manual plus one-off buy volume per active buyer not below -5% of the pre-launch 3-month mean; failed-debit rate 15% or lower after week 8 (stop at 30% in any week); revocation 5% or lower per month; reconciliation mismatch 0.5% or lower.

BCA gate, after 8 weeks live on BNI and Mandiri: at least 385 debit attempts; debit success 85% or higher per bank (no-go under 80%); mandate approval 60% or higher (no-go under 45%); revocation 5% or lower (no-go over 10%); mismatch 0.5% or lower (no-go over 2%); volume per active buyer within -5% (no-go below -10%). In between: extend 4 weeks.

## 7. Open decisions

1. BNI and Mandiri launch date, BCA window.
2. Approve the 50/50 randomised rollout for 8 weeks.
3. Who pays the Autodebet fee.
4. First transaction paid by VA or QRIS, or by the first debit.
5. Due date rule: UTC or Asia/Jakarta.
6. Source for support tickets and disputes.
