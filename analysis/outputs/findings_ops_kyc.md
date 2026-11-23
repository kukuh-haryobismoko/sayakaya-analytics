# Findings — Operations & KYC

Refreshed to data cutoff 2026-11-22 from `outputs/raw/` (BigQuery `main.user_status_logs`, GA4 2026-10-01..2026-11-21, 52 days). Read-only. HNWI excluded (retail cohort).

Basis: decision rows in `main.user_status_logs` with `origin_status='pending_verification'` (status verified/failed), joined to the Phase 1/2 cohort. `user_status_logs` only exists since 2026-07-21 and GA does not carry pre-login `user_id`, so submit time is taken from the GA `kyc_success` event (this event fires on submit, see Phase 2 reconciliation).

| # | Finding | Evidence | Confidence | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| O1 | Decision tail: P90 15.4 hours; submits outside working hours and on weekends wait longest | 857 verified decisions, 30 >24 hours; weekend P90 16.6 hours vs 8.1 hours on workdays | High | Medium | S | P1 |
| O2 | Review is concentrated in one account and runs in batches | 1 actor = 67.4% of 1,339 decisions; 3 actors = 96.9%; 28.8% of decisions at hour 10 | High | High | M | P1 |
| O3 | Rejected users rarely resubmit; rejection reason is not stored | Failed since 1 Oct: 12/105 resubmitted; 50/71 of those who ended up verified resubmitted | Medium | Medium | M | P1 |
| O4 | Faster decisions do not correlate with higher purchases | <2 hours 5.9% vs 2-24 hours 11.3% bought within 14 days, all cells small | Low | Low | S | P2 |

## O1 — SLA problem is in the tail, not the median

**Pain point.** Median submit to decision is about 9 minutes, but P90 is 15.4 hours and 30 verified decisions took more than 24 hours.

**Evidence (Observed).** GA submits 2026-10-01..2026-11-21, decision >= submit.

| Status | n | P50 | P90 | >24 hours | >72 hours |
|---|---|---|---|---|---|
| verified | 857 | 0.15 hours | 15.43 hours | 30 | 5 |
| failed | 158 | 0.13 hours | 15.15 hours | 4 | 0 |

- Weekend submits: n=239, >4 hours 100 = 41.8% (95% CI 35.8-48.2%), >24 hours 13. Workdays: n=711, >4 hours 79 = 11.1% (95% CI 9.0-13.6%), >24 hours 9. z=10.5, p<0.0001.

- P90 submit to decision: weekend 16.6 hours (n=239) vs workdays 8.1 hours (n=711). The gap widened since the 2026-11-09 cutoff (was 17.2 vs 11.9): workdays got faster, weekends did not.

- Submits outside 09:00-20:00 WIB: n=142, >4 hours 79 (55.6%, 95% CI 47.4-63.6%), >12 hours 42 (29.6%). Within working hours: n=808, >4 hours 100 (12.4%, 95% CI 10.3-14.8%), >12 hours 100 (12.4%). z=12.2, p<0.0001. (Weekend and outside-hours groups overlap; the weekend/workday split and this split are different cuts of the same 950 submits.)

- Key clue: every working-hours case that passes 4 hours also passes 12 hours (100/100). Meaning it is queued to the next workday, not processed slowly.

- Decision hour (all decisions, n=1,339): peak at 10:00 WIB = 386 (28.8%); 21:00-08:59 only 40 (3.0%). Saturday 108 + Sunday 144 decisions = 252 (18.8%).

**Root cause (Inferred, Confidence: High).** Decisions are executed as a morning batch (hour 10) by one operator; submits after the batch wait for the next workday morning. The night and weekend tail is queue time, not processing time.

**Expected impact (arithmetic).** 34 decisions >24 hours in 52 days = 20/month in the tail. If one evening/weekend review slot moves 10 of the 30 verified cases within 24 hours, and they buy within 7 days of approval at the approved population rate (10.5% for October approvals, 75/714; 29.0% for Jul-Sep approvals, 42/145; `84_oct_lag`), recovered investors = 10 x 0.105 = 1.1 to 10 x 0.29 = 2.9. Small: the main value is SLA credibility and rejection-cycle speed, not investor volume.

**What this means:** Most requests are decided in minutes, but a request sent at night or on a weekend usually waits until the next working morning, and that wait is getting relatively worse on weekends.

**Effort.** S (change roster/queue, no code).

**Priority.** P1 (cheap and visible, small investor impact; ranked below O2).

**KPI / validation.** P90 submit to decision and count of >24 hours, weekly; before/after the extra slot.

## O2 — One reviewer and one batch hour carry almost all decisions

**Pain point.** 67.4% of decisions come from one actor; three actors cover 96.9%. Decisions pile up at hour 10 (28.8%). Concentration eased since the 2026-11-09 cutoff (was 75.9% and 34.5%) as actors 2 and 3 took more, but it is still a key-person risk on a regulated step.

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

## O3 — Rejection is almost final, and the reason is not recorded

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

## O4 — Wait time does not correlate with purchase

**Pain point.** The common assumption that faster KYC approval raises investment is not supported by this data; the point estimate even goes the opposite way.

**Evidence (Observed).** Approved decisions up to 2026-10-25 with GA submit time in the window, n=291.

| Wait submit to approved | n | Bought within 14 days |
|---|---|---|
| a<2h | 221 | 13 (5.9%) |
| b2-24h | 53 | 6 (11.3%) |
| c>=24h | 17 | 3 (17.6%) ⚠n<30 |

- <2 hours vs >=2 hours: 5.9% vs 12.9% (z=-1.92, p=0.054, not significant). Only the >=24 hours bucket has n<30.

- Selection: fast decisions come from submits in the morning batch, who may be users with complete documents during working hours. n is too small to control for it.

**Root cause (Inferred, Confidence: Low).** No causal effect detected; the drop in approved to purchase within 7 days, October approvals vs Jul-Sep approvals (10.5% = 75/714 vs 29.0% = 42/145, z=-5.9, p<0.0001; approvals capped at 2026-11-15), is not explained by wait time: it persists in the approved-within-1-day-of-registration bucket (10.7% = 69/646 vs 29.5% = 28/95; `84_oct_lag`). The October rate is higher than the 7.7% reported at the 2026-11-09 cutoff (different cut: all approvals, longer window), but the drop is still large. Note: wait-time buckets above use submit to approval; the 1-day bucket here uses registration to approval.

**Expected impact.** No claim. Do not justify an SLA program by investor growth; use it for compliance and experience.

**What this means:** We cannot say that approving faster makes people buy; the sample is too small and the gap is not statistically significant.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Repeat with a larger window (n>100 per bucket) before any claim.


## Data requests (Ops & KYC)

- Rejection reason / reviewer note per failed decision (needed for O3).

- KYC submit timestamp in the DB (the GA join loses users without `user_id`; `user_status_logs` starts 2026-07-21).

- Distinction between automatic vs manual decisions (`auth_user_id` may be a shared account or a bot).

