# Findings — Product & Engineering

Refreshed 2026-11-22 (cutoff) from GA4 `analytics_266759216.events_*` (2026-10-01..2026-11-21) and `main.transactions`. Read-only.

| # | Finding | Evidence | Confidence | Impact | Effort | Priority |
|---|---|---|---|---|---|---|
| T1 | KYC drop-off inside the app: identity to selfie −11.4%, Android 5.4 pp below iOS | 1,156 identity to 1,024 selfie; submit Android 80.5% vs iOS 85.9% | High | High | M | P0 |
| T2 | QRIS fails twice as often as VA or bank transfer | 183/834 (21.9%) vs 11.2% VA, 11.7% BT | High | Medium | S | P1 |
| T3 | Approved users who haven't bought never return to the buy flow | of 317 visible post-approval, 56 open the buy sheet, 14 create an order | High | High | M | P0 |
| T4 | Risk profile gate abandoned 26.8%; downstream loss borderline (p=0.084), weaker than before | 34/127 abandon; 44.1% of abandoners order vs 61.3% | Medium | Low | S | P2 |
| T5 | Client errors logged in GA, with no crash/ANR and no alert | 63 `continue_with_google_failed`, 12 `app_exception`, no monitoring | High | Low | S | P2 |

## T1 — KYC flow loses users inside the app, worst on Android at the selfie step

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

- Android vs iOS: 80.5% vs 85.9% (z=-2.31, p=0.021). Absolute difference: 145 Android users did not finish vs 58 on iOS. The gap shrank from 8.5 pp (cutoff 2026-11-09) to 5.4 pp and is now only borderline significant: the conclusion still holds, but it is weaker.

- Abandonment per screen (users who saw it): `VerificationIntroScreen` 1,260 to `IdentityVerificationScreen` 1,156 (-104, -8.3%); `IdentityVerificationScreen` to `SelfieCameraScreen` 1,024 (-132, -11.4%). After selfie every screen stays above 950, so the loss is concentrated before the selfie is taken.

- `IdentityCameraScreen` has only 670 users, although the previous screen has 1,156. Most likely the event fires for only some users (not everyone who opens the camera), or there is a real drop at document capture. Cannot be distinguished from this data.

- Version 2.28.2: 620 users submitted, version 2.29.0: 316 (a user on two versions counts in both). Start to submit: 2.29.0 81.0% (316/390) vs 2.28.2 83.1% (620/746), z=-0.88, p=0.38. The old "latest build looks worse" signal (n=26) does not hold with the larger sample: no version difference.

**Root cause (Inferred, Confidence Medium).** Two hypotheses, neither tested: (a) selfie camera permission/capture fails or confuses on Android devices; (b) identity document capture is the real barrier and users leave before the selfie. `kyc_screen_view` does not separate 'viewed then left' from 'captured then failed'; device-level data needed.

**What this means:** Many users quit KYC just before the selfie, a bit more on Android; fixing that step is worth about 22 extra investors a year.

**Expected impact (arithmetic).** Closing half the Android-iOS gap: 745 starts x 5.4 pp gap / 2 = 20 extra submits per 52 days. At approved/submit share 73.4% (DB: 16,981 approved / 23,131 submitted, `40_funnel.sql`) and approved to investor 21.3% (3,617/16,981): 3.1 investors per 52 days = 22/year. Assumption: the gap comes from product friction, not device/demographic mix.

**Effort.** M (instrument every KYC screen with outcome events: permission granted, capture attempted, capture failed, back pressed).

**Priority.** P0 (largest funnel leak that product can control).

**KPI / validation.** KYC start to submit per platform and per screen; target Android within 3 pp of iOS.

## T2 — Payments: QRIS fails twice as often as VA or bank transfer

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

## T3 — Approved users who haven't bought do not return to the buy flow

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

## T4 — Risk profile gate: downstream loss not yet proven

**Pain point.** 34 of 127 users who triggered the risk profile gate left it, but abandoners still convert at a rate not significantly different.

**Evidence (Observed).** GA `risk_profile_gate_triggered`/`abandoned`, 2026-10-01..2026-11-21.

- Trigger 127, abandon 34 (26.8%). Orders afterward: abandoners 15/34 (44.1%), non-abandoners 57/93 (61.3%). z=-1.73, p=0.084.

**Root cause (Inferred, Confidence Low).** Abandonment is real but temporary; the gate is shown again later. With n<100 on both sides, this may be underpowered, not truly harmless. The conclusion weakened: the gap grew from 13.0 pp (p=0.24) to 17.2 pp (p=0.084), close to significant, so a real downstream loss is now plausible.

**What this means:** Users who leave the risk quiz order less often, but the sample is still too small to be sure; measure before changing it.

**Expected impact.** No claim; only 73 users per 30 days (127 in 52 days). Instrument first, do not redesign.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Gate abandonment rate and 7-day order rate, monthly, with n>=100.

## T5 — Client errors logged, with no crash/ANR and no alert

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


## Data requests (Product & Engineering)

- Outcome events per KYC screen (capture attempted/failed, permission denied, back pressed): blocks T1.

- Provider error code on failed transactions: blocks T2 sizing.

- Crashlytics/ANR export: blocks T5 severity.

- `user_id` on pre-login GA events, and campaign id on notification events.