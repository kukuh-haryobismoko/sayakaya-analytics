# Segment cuts (Phase 2)
Run 2026-11-09 18:34 WIB. Cohort C, all-time. Scripts: `44_segments.sql` (DB), `48_ga_seg.sql` (GA, 2026-10-01 to 2026-11-08), `51_ga_src.sql`. Cells under 10 are hidden (`<10`) and rows with n < 30 are marked low-confidence. 95% CI = Wilson. All Correlation.

Profile fields (gender, age, occupation, income, city) are filled only after KYC, so for those cuts the useful denominator is approved users. For approved users the 'Investor % of approved' column is the fair comparison; the `(null)` rows are users who never reached the profile step.
Monthly income and city are not analysed: income is empty for all 63,795 users (Observed, `44_segments.sql`); city has about 500 values, most cells under 10.

## Acquisition: referrer code (DB)
- Observed: with a referrer code (not RAIZ/RAIZKAYA): 6,308 registered, 3,337 approved, 1,324 investors = 21.0% of registered (20.0-22.0%). No code (NULL or empty): 57,487 registered, 13,322 approved, 2,263 investors = 3.9% of registered (3.8-4.1%). z = 55.8. Referral codes: 658 distinct.
- Top codes by registered users (personal-looking codes are pseudonymised):
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (none) | 57,487 | 13,322 | 23.2% (22.8-23.5%) | 2,263 | 17.0% (16.4-17.6%) | 3.9% |
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
| no | 62,727 | 15,906 | 25.4% (25.0-25.7%) | 3,355 | 21.1% (20.5-21.7%) | 5.3% |
| yes | 1,068 | 753 | 70.5% (67.7-73.2%) | 232 | 30.8% (27.6-34.2%) | 21.7% |

- Observed: users with a sales code reach investor at 21.7% of registered vs 5.3%; approval 70.5% vs 25.4%. Investor per approved: 30.8% vs 21.1% (z = 6.3). Selection: sales-code users were helped through KYC, so approval is not comparable.

## Registration period
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| before 2026-10 | 62,937 | 16,077 | 25.5% (25.2-25.9%) | 3,508 | 21.8% (21.2-22.5%) | 5.6% |
| 2026-10+ (booth era) | 858 | 582 | 67.8% (64.6-70.9%) | 79 | 13.6% (11.0-16.6%) | 9.2% |

- Observed: Oct 2026 onward (booth event) approval 67.8% vs 25.5% before. Investor rate is not comparable yet because the Oct-Nov cohort is young; use the 7-day columns in `funnel_overview.md` (Oct 2026: 5.1% within 7 d vs Jan-Sep 9.4%; z = -3.3).

## Demographics (approved users only are comparable)
Gender:
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (null) | 37,013 | 65 | 0.2% (0.1-0.2%) | 20 | 30.8% (20.9-42.8%) | 0.1% |
| male | 17,909 | 10,368 | 57.9% (57.2-58.6%) | 1,976 | 19.1% (18.3-19.8%) | 11.0% |
| female | 8,873 | 6,226 | 70.2% (69.2-71.1%) | 1,591 | 25.6% (24.5-26.7%) | 17.9% |

- Observed: female approved users invest at 25.6% vs male 19.1%; z = 9.9. Evidence: High (large n), Correlation.

Age (at registration):
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (null) | 37,013 | 65 | 0.2% (0.1-0.2%) | 20 | 30.8% (20.9-42.8%) | 0.1% |
| 25-34 | 9,004 | 5,802 | 64.4% (63.4-65.4%) | 1,645 | 28.4% (27.2-29.5%) | 18.3% |
| <25 | 7,498 | 4,342 | 57.9% (56.8-59.0%) | 716 | 16.5% (15.4-17.6%) | 9.5% |
| 35-44 | 6,479 | 4,049 | 62.5% (61.3-63.7%) | 760 | 18.8% (17.6-20.0%) | 11.7% |
| 45-54 | 3,013 | 1,909 | 63.4% (61.6-65.1%) | 317 | 16.6% (15.0-18.3%) | 10.5% |
| 55+ | 788 | 492 | 62.4% (59.0-65.7%) | 129 | 26.2% (22.5-30.3%) | 16.4% |

Occupation:
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| (null) | 37,060 | 66 | 0.2% (0.1-0.2%) | 20 | 30.3% (20.6-42.2%) | 0.1% |
| pegawai swasta | 9,404 | 6,491 | 69.0% (68.1-70.0%) | 1,602 | 24.7% (23.6-25.7%) | 17.0% |
| lainnya | 5,425 | 2,990 | 55.1% (53.8-56.4%) | 567 | 19.0% (17.6-20.4%) | 10.5% |
| pelajar/mahasiswa | 4,490 | 2,719 | 60.6% (59.1-62.0%) | 449 | 16.5% (15.2-18.0%) | 10.0% |
| pengusaha | 3,006 | 1,931 | 64.2% (62.5-65.9%) | 367 | 19.0% (17.3-20.8%) | 12.2% |
| ibu rumah tangga | 2,760 | 1,383 | 50.1% (48.2-52.0%) | 286 | 20.7% (18.6-22.9%) | 10.4% |
| pns | 972 | 643 | 66.2% (63.1-69.1%) | 178 | 27.7% (24.4-31.3%) | 18.3% |
| guru/dosen | 369 | 257 | 69.6% (64.8-74.1%) | 80 | 31.1% (25.8-37.0%) | 21.7% |
| pensiunan | 163 | 91 | 55.8% (48.2-63.2%) | 31 | 34.1% (25.2-44.3%) | 19.0% |
| tentara/polisi | 144 | 86 | 59.7% (51.6-67.4%) | <10 | 8.1% (4.0-15.9%) | 4.9% |

- Observed: `tentara/polisi` <10 investors of 86 approved (8.1%), far below `pegawai swasta` (24.7%); `pensiunan`, `guru/dosen`, `pns` are highest. Occupation and age overlap (Simpson risk): not separated here.

Other: bank_account_skipped = true: 653 registered, 237 approved, <10 investors; institutions: 15 registered, <10 investors (n=15 low-confidence).

## Acquisition source, device and region (GA, Oct 1 - Nov 8, 2026, users who registered and logged in)
Source / medium (GA first-touch of the device):
| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| google-play / organic | 482 | 350 | 72.6% (68.5-76.4%) | 37 | 7.7% (5.6-10.4%) |
| (direct) / (none) | 287 | 233 | 81.2% (76.3-85.3%) | 30 | 10.5% (7.4-14.5%) |
| card / offline (low n) | 10 | 10 | 100.0% (72.2-100.0%) | <10 | 0.0% (-0.0-27.8%) |

OS:
| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| Android | 519 | 378 | 72.8% (68.8-76.5%) | 39 | 7.5% (5.5-10.1%) |
| iOS | 269 | 220 | 81.8% (76.7-85.9%) | 28 | 10.4% (7.3-14.6%) |

- Observed: iOS KYC 81.8% vs Android 72.8% (z = 2.8, significant); payment complete 10.4% vs 7.5% (z = 1.4, not significant).
App version:
| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| 2.28.2 | 741 | 565 | 76.2% (73.1-79.2%) | 60 | 8.1% (6.3-10.3%) |
| 2.29.0 (low n) | 25 | 17 | 68.0% (48.4-82.8%) | <10 | 20.0% (8.9-39.1%) |
| 2.28.1 (low n) | 21 | 16 | 76.2% (54.9-89.4%) | <10 | 9.5% (2.7-28.9%) |

Region (GA geo):
| Segment | Registered (GA, cohort C) | KYC success | KYC % (95% CI) | Payment complete | Payment % (95% CI) |
|---|---|---|---|---|---|
| Jakarta | 523 | 405 | 77.4% (73.7-80.8%) | 48 | 9.2% (7.0-12.0%) |
| West Java | 79 | 60 | 75.9% (65.5-84.0%) | <10 | 7.6% (3.5-15.6%) |
| Banten | 50 | 35 | 70.0% (56.2-80.9%) | <10 | 6.0% (2.1-16.2%) |
| East Java (low n) | 24 | 18 | 75.0% (55.1-88.0%) | <10 | 8.3% (2.3-25.8%) |
| Lampung (low n) | 20 | 12 | 60.0% (38.7-78.1%) | <10 | 0.0% (-0.0-16.1%) |
| North Sumatra (low n) | 19 | 14 | 73.7% (51.2-88.2%) | <10 | 15.8% (5.5-37.6%) |

Campaign: GA campaign is `(null)` or `(direct)` for 774 of 788 registered users: not usable for campaign analysis (Data Request).
- Observed (GA, devices, not users, `51_ga_src.sql`): `google / cpc` shows 130 devices in the window with 0 first_open, 0 registrations and 3 devices with payment_complete. Inferred: ad-attributed devices are mostly installs from before Oct 1, or the attribution field is stale; cannot judge ad performance from this table. Data Request.
- Caveats: GA attributes only users who logged in (user_id); version 2.28.2 holds almost all users so version cannot explain differences.
