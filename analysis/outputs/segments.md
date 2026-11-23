# Segment cuts (Phase 2)
Refreshed 2026-11-22 (cutoff). Cohort C, all-time. Scripts: `44_segments.sql` (DB), `48_ga_seg.sql` (GA, 2026-10-01 to 2026-11-21, 52 days), `51_ga_src.sql`. Cells under 10 are hidden (`<10`) and rows with n < 30 are marked low-confidence. 95% CI = Wilson. All Correlation.

Profile fields (gender, age, occupation, income, city) are filled only after KYC, so for those cuts the useful denominator is approved users. For approved users the 'Investor % of approved' column is the fair comparison; the `(null)` rows are users who never reached the profile step.
Monthly income and city are not analysed: income is empty for all 64,274 users (Observed, `44_segments.sql`); city has 505 values, most cells under 10.

## Acquisition: referrer code (DB)
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

## Sales code (booth / sales rep)

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| no | 62,846 | 15,970 | 25.4% (25.1-25.8%) | 3,362 | 21.1% (20.4-21.7%) | 5.3% |
| yes | 1,428 | 1,011 | 70.8% (68.4-73.1%) | 255 | 25.2% (22.6-28.0%) | 17.9% |

- Observed: users with a sales code reach investor at 17.9% of registered vs 5.3%; approval 70.8% vs 25.4%. Investor per approved: 25.2% vs 21.1% (z = 3.1). Selection: sales-code users were helped through KYC, so approval is not comparable.
- Changed vs the 2026-11-09 run: the investor-per-approved edge of sales-code users shrank (30.8% vs 21.1%, z = 6.3 then; now 25.2% vs 21.1%, z = 3.1). Likely reason (Inferred): 258 more sales-code users were approved since 2026-11-09 (753 to 1,011) and many have not had time to buy yet.
- What this means: booth sign-ups get through KYC much more often, but their later buying is only a little better than other users, and the gap is smaller than we reported on 2026-11-09.

## Registration period

| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| before 2026-10 | 62,938 | 16,080 | 25.5% (25.2-25.9%) | 3,508 | 21.8% (21.2-22.5%) | 5.6% |
| 2026-10+ (booth era) | 1,336 | 901 | 67.4% (64.9-69.9%) | 109 | 12.1% (10.1-14.4%) | 8.2% |

- Observed: Oct 2026 onward (booth event) approval 67.4% vs 25.5% before. Investor rate is not comparable yet because the Oct-Nov cohort is young; use the 7-day columns in `funnel_overview.md` (Oct 2026: 5.1% within 7 d vs Jan-Sep 9.4%; z = -3.3; `42_cohorts.sql`).
- What this means: the booth event brought many more approved users, but a smaller share of them buy.

## Demographics (approved users only are comparable)
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

## Acquisition source, device and region (GA, Oct 1 - Nov 21, 2026, users who registered and logged in)
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
- Changed vs the 2026-11-09 run: iOS payment completion was not significantly different then (10.4% vs 7.5%, z = 1.4); with the longer window it is. The Android disadvantage now appears at both KYC and payment.
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
