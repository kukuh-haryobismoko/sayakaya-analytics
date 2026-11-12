# Data provenance log
Run timestamps Asia/Jakarta. Scripts in `analysis/scripts/`. Cohort = excl. RAIZ/RAIZKAYA (and HNWI where stated).

## Phase 1 (run 2026-11-09 ~17:30-17:50 WIB)
| Metric | Value | n | Window | Source | Script |
|---|---|---|---|---|---|
| Registered users, raw | 320,606 | 320,606 | all, to 2026-11-09 | main.users | 30_facts.sql (users) |
| RAIZKAYA / RAIZ / NULL / empty referrer | 255,195 / 1,499 / 57,538 / 8 | 320,606 | all | main.users | 10_dq_users.sql (referrer_values) |
| Registered after RAIZ exclusion | 63,912 | | all | main.users | 20_cohort_stages.sql |
| Registered after RAIZ + HNWI exclusion | 63,793 | | all | main.users + mi_fee_logs.portfolio_with_code | 20_cohort_stages.sql |
| Verified (raw / B / C) | 17,210 / 16,776 / 16,657 | | all | main.users | 20_cohort_stages.sql |
| Failed (raw / B / C) | 6,220 / 6,114 / 6,114 | | all | main.users | 20_cohort_stages.sql |
| Investors (raw / B / C) | 260,219 / 3,706 / 3,587 | | all | main.transactions | 20_cohort_stages.sql |
| HNWI users ever (SID AUM >= 500M) | 119 | | 2026-01-14 to 2026-11-09 | mi_fee_logs.portfolio_with_code | 16_hnwi_ever.sql, 20_cohort_stages.sql |
| HNWI on 2026-11-09 snapshot | 65 (8 institution) of 232,570 SIDs with AUM > 0 | | 2026-11-09 | mi_fee_logs.portfolio_with_code | 15_hnwi.sql |
| Gap percentiles p50/p75/p90/p95/p99 | 13/32/86/167/523 days | 40,658 gaps, 3,181 users | all, cohort C | main.transactions | 23_gap_dist.sql |
| Came-back share by threshold | 75.2% (30d) ... 53.7% (90d) ... 25.9% (365d) | 3,917 users | all, cohort C | main.transactions | 21_churn_final.sql |
| Silent > 90 / > 180 days | 3,165 / 3,014 of 3,587 | 3,587 | to 2026-11-09 | main.transactions | 22_churn_ga.sql (churn_now) |
| GA users, exclusion split | 2,257 = 3 not in DB + 144 RAIZ + 77 HNWI + 2,033 kept | 2,257 | 2026-10-01 to 2026-11-08 | analytics_266759216 + main.users | 22_churn_ga.sql (ga_exclusion) |
| GA devices / devices with null-user_id rows | 3,375 / 2,869 | | 2026-10-01 to 2026-11-08 | analytics_266759216 | 22_churn_ga.sql |
| GA event counts and users | see data_dictionary.md | | 2026-10-01 to 2026-11-08 | analytics_266759216 | 30_facts.sql (ga_events), 04_ga_events.sql |
| GA vs DB first look | register 797 vs 833, KYC 623 vs 573 | | 2026-10-01 to 2026-11-08 | both | 22_churn_ga.sql (db_vs_ga_stage_octnov) |
| Data quality counts | see data_quality.md | | all | main.* | 10_dq_users.sql, 11_dq_txn.sql, 13_cohort_dq.sql |

## Phase 2 (run 2026-11-09 18:40 WIB)
| Metric | Value | n | Window | Source | Script |
|---|---|---|---|---|---|
| Phase 2 funnel: registered / submitted / approved / rejected / investor / repeat | 63,795 / 22,773 / 16,659 / 6,114 / 3,587 / 2,132 | 63,795 | all to 2026-11-09 | main.users, main.transactions | 40_funnel.sql; cross-check: 42_cohorts.sql monthly sums (asserted equal in build_phase2.py) and Phase 1 20_cohort_stages.sql (investors 3,587; registered +2 new sign-ups) |
| Churn (activity >90d) / >180d / active | 3,000 (83.6%) / 2,742 (76.4%) / 587 | 3,587 | to 2026-11-09 | main.transactions | 40_funnel.sql; cross-check 49_chk.sql (act_churn 3,000; buys-only 3,165, diff 165) |
| Median / P90 days: reg->approved, approved->buy, reg->buy | 0.62/3.63; 1.03/90.77; 5.58/243.7 | 12,636; 2,369; 3,587 | all | main.users, main.transactions | 41_timing.sql |
| Monthly cohorts | cohorts.csv | 63,795 | 2020s to 2026-11 | main.users, main.transactions | 42_cohorts.sql |
| Approved->buy within 7d by approval month (Oct 2026 vs Jan-Sep 2026) | 33/430=7.7% vs 197/730=27.0% | 430; 730 | 2026-01 to 2026-10 | main.users, main.transactions | 46_leak.sql |
| Oct 2026 cohort split by sales code | 363 reg/271 appr/26 inv; 219/130/14 | 582 | 2026-10 | main.users, main.transactions | 52_oct_split.sql |
| Churn profile (survival, indicators) | see churn_profile.md | 3,587 | to 2026-11-09 | main.transactions | 43_dur.sql, 50_indicators.sql |
| Segment cuts DB | see segments.md | 63,795 | all | main.users, user_profiles | 44_segments.sql |
| Segment cuts GA | see segments.md | 788 registered users | 2026-10-01 to 2026-11-08 | analytics_266759216 | 48_ga_seg.sql, 51_ga_src.sql |
| GA vs DB per stage | see ga_vs_db.md |  | 2026-10-01 to 2026-11-08 | both | 45_ga_db.sql |

## Phase 3 (run 2026-11-09 20:15 WIB)
| Metric | Value | n | Window | Source | Script |
|---|---|---|---|---|---|
| Acquisition groups: sales_code / referrer_code / none | reg 1,068 / 6,109 / 56,618; inv 232 / 1,259 / 2,096 | 63,795 | all to 2026-11-09 | main.users, main.transactions | 73_more.sql (acq_funnel); retention 70_mkt_quality.sql, 75_mature_repeat.sql, 76_bonus_chk.sql |
| Bonus: users / never paid / value to non-payers | 6,130 / 3,629 (59.2%) / Rp469,400,000 | 6,130 | all | main.transactions | 75_mature_repeat.sql (bonus_before_paid), 76_bonus_chk.sql |
| Promo on first buy vs none: repeat | 486/919 = 52.9% vs 1,646/2,668 = 61.7% | 3,587 | all | main.transactions | 70_mkt_quality.sql (promo_first_buy), promo_any_paid |
| Email batch (Supabase) | 650 sent / 93 failed (454 throttling, all re-sent); 500 logs with events, 497 with open; 0 click; 650/650 no user_id | 743 | 2026-10-13 to 2026-11-03 | Supabase dashboard_email_log, dashboard_email_events | Supabase MCP execute_sql; cached outputs/raw/supabase_email.json |
| Push reach by segment (GA) | investor 897, approved-never-bought 567, not approved 212 users with notifications | 1,676 | 2026-10-01 to 2026-11-08 | analytics_266759216 | 77_final.sql (push_android_by_seg), 82_push_buy.sql |
| KYC decision SLA | verified n=548 P50 0.17 h / P90 15.70 h / >24 h 21; failed n=102 P90 15.73 h | 650 | GA submit 2026-10-01 to 2026-11-08 | main.user_status_logs + analytics_266759216 | 71_ops_kyc.sql; 79_kyc_screens.sql (wait_buckets, wait_night) |
| Decision actor concentration | rank1 700 (75.9%), rank2 102, rank3 92 of 922 | 922 | since 2026-07-21 | main.user_status_logs | 83_actor.sql, 85_actor_rank.sql |
| Decision hour | hour 10 WIB = 318 of 922 (34.5%); 21:00-08:59 = 23 (2.5%) | 922 | since 2026-07-21 | main.user_status_logs | 71_ops_kyc.sql (decision_hour, decision_dow_hour) |
| Resubmission after rejection, Oct | still failed 6/70; ended verified 27/40 | 110 | 2026-10 | main.user_status_logs + analytics_266759216 | 78_gate_pay.sql (resub_oct), 70_mkt_quality.sql (resubmit_after_fail) |
| Wait submit->approved vs buy 14 d | <2 h 13/221 = 5.9%; 2-24 h 6/53; >=24 h 3/17 | 291 | 2026-10-01 to 2026-10-25 | both | 70_mkt_quality.sql (wait_vs_buy) |
| KYC funnel by platform | Android 386/485 = 79.6%; iOS 230/261 = 88.1% | 746 | 2026-10-01 to 2026-11-08 | analytics_266759216 | 73_more.sql (kyc_platform), 79_kyc_screens.sql |
| KYC screens | Intro 816 -> Identity 745 -> SelfieCamera 661 -> ... -> VerificationSuccess 617 | | 2026-10-01 to 2026-11-08 | analytics_266759216 | 79_kyc_screens.sql (kyc_screen_view_all) |
| Payment fail by method | VA 420/3,782; bank 250/2,279; QRIS 170/765 (22.2%); INSTANT 5/264 | 7,090 | all | main.transactions | 70_mkt_quality.sql (pay_fail_cohort) |
| Approved-never-bought in GA | 257 seen, 43 buy sheet, 8 order | 257 | 2026-10-01 to 2026-11-08 | analytics_266759216 + main.* | 77_final.sql (approved_nobuy_ga), 78_gate_pay.sql (gate_outcome) |
| Approved -> buy within 7 d, V1 | Jul-Sep 40/137 = 29.2%; Oct 31/416 = 7.5% (z=-6.6) | 553 | GA-linked submissions in window | analytics_266759216 + main.* | 84_oct_lag.sql (oct_lag), 86_oct_week.sql |

Notes: V1 is restricted to decisions whose KYC submit appears in GA (137 Jul-Sep, 416 Oct), so it is not directly comparable with the Phase 2 approved->buy cut (197/730 vs 33/430, which uses no GA restriction); both show the same direction and magnitude. Supabase numbers are cached in outputs/raw/supabase_email.json and were read by build_phase3.py, not retyped. build_phase3.py parses every block from outputs/raw/*.txt; no metric in the four findings files is typed by hand. All queries SELECT-only with 5e9 bytes cap except Supabase, which is read-only by role.

## Penyelarasan P&T 2027 (2026-11-12)

Tidak ada kueri baru. Angka PDF *Product & Tech 2027 — Targets, Direction, Objectives* adalah Target, bukan Observed. Dipakai di `raker_preparation.md` bagian 0 dan 1 paragraf di `SayaKaya_Funnel_Analysis.md`.

| Angka | Nilai | Jenis | Sumber |
|---|---|---|---|
| AUM akhir 2027; nasabah baru berdana; net revenue | Rp700,9 miliar; 10.982; Rp3,53 miliar | Target | PDF hal. 1 |
| Nasabah/AUM per kanal | RM 732 / Rp394,9 miliar; Booth 7.938 / Rp26,9 miliar; B2B2C 2.031 / Rp18,7 miliar; Mkt 163 / Rp1,0 miliar; Ads 118 / Rp0,1 miliar; SBN Rp1,3 miliar | Target | PDF hal. 2 |
| Kanal non-RM 93,3% nasabah, 10,5% AUM; laju per kuartal; nasabah booth per registrasi (36.581-86.283) | aritmetika dari Target di atas dan dari Observed 21,7% (232/1.068), 9,2% (79/858) | Derived | cohorts.csv, segments.md, findings_marketing.md |
| Baseline bulanan nasabah berdana, retensi AUM, revenue, kanal RM, O1, ketepatan rilis | tidak ada | Gap | belum ada data |
