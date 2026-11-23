# Findings — Marketing

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22), so every user had the same time to buy again. Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21, 52 days).

Built 2026-11-22 WIB from `outputs/raw/` (BigQuery read-only) and Supabase `dashboard_email_log`/`dashboard_email_events`.

Cohort = Phase 1/2 (no RAIZ/RAIZKAYA referrer, no HNWI): 64,274 registrations, 3,617 investors. Data pulled 2026-11-22.

| # | Finding | Evidence | Confidence | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| M1 | Sales-code sign-up: conversion on par with referral, worst mature retention | 17.9% investor/reg vs 20.6% referral, 3.7% none; mature repeat 43.2% vs 60.8% | High (observational) | High | M | P1 |
| M2 | Credit bonus to 6,134 users, 59.2% never made a paid purchase | Rp469,200,000 credit to 3,632 non-payers | High | High | S (policy) | P0 |
| M3 | Promo on first purchase correlates with lower repeat | 52.8% vs 61.4% | Medium (confounded) | Medium | S | P2 |
| M4 | Lifecycle email not measurable; batch throttled, 0 clicks | 93/743 failed (454), all resent; 0 click events; open 497/497 within 2 hours (as of 2026-11-09, not refreshed) | High | Medium | S | P1 |
| M5 | Push reaches non-investors, post-click conversion not measurable | 351 approved-not-yet-purchased clicked; click→purchase test only 26 users | Low | Medium | M | P2 |
| M6 | Three stuck pools without lifecycle messaging | 13,385 approved-not-yet-purchased; 245 unverified <30 d; 101 investors dormant 60-90 d | High | High | M | P1 |

## M1 — Sales code: conversion on par with referral, worst mature retention

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

## M2 — Credit bonus is the largest marketing spend leak

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

## M3 — Promo on first purchase correlates with lower repeat (confounded)

**Pain point.** Investors whose first purchase used a promo repeat 52.8% vs 61.4% without promo.

**Evidence (Observed).** First purchase with promo n=927: repeat 489 = 52.8% (95% CI 49.5-55.9%), churn90 85.2%. Without promo n=2,690: repeat 61.4%, churn90 82.5%. z=-4.6, p<0.0001.

- Contradiction: counting promo on any purchase flips the sign. Promo users 72.5% repeat (n=1,615) vs 48.5% (n=2,002). Promo use is a result of frequent buying, so this cut must not be read as lift.

**Root cause (Inferred, low confidence).** Promo likely attracts price-sensitive one-off buyers, but first-purchase promos are also targeted at this group. Selection cannot be separated without random exposure.

**Expected impact.** Not quantified. Gap 8.6 pp x 927 promo investors = 80 repeat investors is only an upper bound if the gap is fully causal; the data cannot show that.

**Effort.** S (analysis: random holdout).

**Priority.** P2.

**KPI / validation.** 90-day repeat for new promo-eligible users, randomized promo vs no promo (10% holdout).

**What this means.** First-purchase promo users repeat less, but that's likely because promos target one-off buyers, not because the promo causes churn. Needs a random test to know for sure.

## M4 — Lifecycle email: throttle, no click tracking, lift not measurable

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

## M5 — Push reaches non-investors, click-to-purchase not measurable

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

## M6 — Three stuck pools without lifecycle messaging

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

## Data requests (Marketing)

- No campaign id in push/email; GA registration source is empty for most of the window (Phase 2). Add `campaign_id` to `notification_*` events and `dashboard_email_log`.

- `dashboard_email_log` batch rows have `user_id` NULL (650/650); without it there is no email-to-investment join.

- No click event type in `dashboard_email_events`.

- Bonus program rules (who, when, how much) are not in BigQuery; needed to measure M2 properly.