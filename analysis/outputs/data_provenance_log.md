# Data provenance log

> **Terms used in this document.**
> **Repeat** = the user bought on 2 or more different days (WIB), counting valid non-bonus purchases only.
> **Mature** = first purchase at least 120 days before the data pull (2026-11-22), so every user had the same time to buy again (first purchase on or before 2026-07-25). Mature repeat = % of mature investors who are repeat. Rates on non-mature users are not comparable.
> **Data window** = all registrations and transactions up to 2026-11-22 unless a section states another window (GA4 events: 2026-10-01 to 2026-11-21, 52 days).
> **Raw file** = path under `analysis/outputs/`. Phase 2 files now sit in `raw/phase2/`. Files in `raw/hnwi_incl/` are the same queries with HNWI included.
Run timestamps Asia/Jakarta. Scripts in `analysis/scripts/`. Cohort = excl. RAIZ/RAIZKAYA (and HNWI where stated). Refresh 2026-11-22: see the last section.

## Phase 1 (re-run 2026-11-22; first run 2026-11-09)

| Metric | Value | n | Window | Source | Script | Raw file |
|---|---|---|---|---|---|---|
| Registered users, raw | 321,087 | 321,087 | all, to 2026-11-22 | main.users | 30_facts.sql (users) | `raw/phase2/30_facts.txt` |
| RAIZKAYA / RAIZ / NULL / empty referrer | 255,195 / 1,499 / 57,997 / 8 | 321,087 | all | main.users | 30_facts.sql (users); first run used 10_dq_users.sql (referrer_values) | `raw/phase2/30_facts.txt` |
| Registered after RAIZ exclusion | 64,393 | 64,393 | all | main.users | 20_cohort_stages.sql | `raw/phase2/20_cohort_stages.txt` |
| Registered after RAIZ + HNWI exclusion | 64,274 | 64,274 | all | main.users + mi_fee_logs.portfolio_with_code | 20_cohort_stages.sql | `raw/phase2/20_cohort_stages.txt` |
| Verified (raw / B / C) | 17,536 / 17,100 / 16,981 | | all | main.users | 20_cohort_stages.sql | `raw/phase2/20_cohort_stages.txt` |
| Failed (raw / B / C) | 6,256 / 6,150 / 6,150 | | all | main.users | 20_cohort_stages.sql | `raw/phase2/20_cohort_stages.txt` |
| Investors (raw / B / C) | 260,249 / 3,736 / 3,617 | | all | main.transactions | 20_cohort_stages.sql | `raw/phase2/20_cohort_stages.txt` |
| HNWI users ever (SID AUM >= 500M) | 119 | 119 | 2026-01-14 to 2026-11-22 | mi_fee_logs.portfolio_with_code | 16_hnwi_ever.sql, 20_cohort_stages.sql | `raw/phase2/16_hnwi_ever.txt` (SID list, not printed here), `raw/phase2/20_cohort_stages.txt` |
| HNWI on 2026-11-22 snapshot | 65 (7 institutions) of 232,606 SIDs with AUM > 0 | 232,606 | snapshot 2026-11-22 (checked 2026-11-19 to 2026-11-22) | mi_fee_logs.portfolio_with_code | 15_hnwi.sql | `raw/phase2/15_hnwi.txt` |
| Gap percentiles p50/p75/p90/p95/p99 | 13/32/86/168/525 days | 40,875 gaps, 3,193 users | all, cohort C | main.transactions | 23_gap_dist.sql | `raw/phase2/23_gap_dist.txt` |
| Came-back share by threshold | 75.1% (30d) ... 53.7% (90d) ... 25.7% (365d) | 3,951 users | all, cohort C | main.transactions | 21_churn_final.sql | `raw/phase2/21_churn_final.txt` |
| Silent > 90 / > 180 days (buys only) | 3,163 / 3,026 of 3,617 | 3,617 | to 2026-11-22 | main.transactions | 22_churn_ga.sql (churn_now) | `raw/phase2/22_churn_ga.txt` |
| GA users, exclusion split | 2,767 = 3 not in DB + 155 RAIZ + 78 HNWI + 2,531 kept | 2,767 | 2026-10-01 to 2026-11-21 | analytics_266759216 + main.users | 22_churn_ga.sql (ga_exclusion) | `raw/phase2/22_churn_ga.txt` |
| GA devices / devices with null-user_id rows | 4,031 / 3,577 | | 2026-10-01 to 2026-11-21 | analytics_266759216 | 22_churn_ga.sql | `raw/phase2/22_churn_ga.txt` |
| GA event counts and users | see data_dictionary.md | | 2026-10-01 to 2026-11-21 | analytics_266759216 | 30_facts.sql (ga_events) | `raw/phase2/30_facts.txt` (top 50 events; 04_ga_events.sql not re-run) |
| GA vs DB first look (cohort B, Oct-Nov) | register GA 1,239 vs DB 1,298; KYC GA 962 vs DB 906 | | 2026-10-01 to 2026-11-21 | both | 22_churn_ga.sql (db_vs_ga_stage_octnov) | `raw/phase2/22_churn_ga.txt` |
| Data quality counts | see data_quality.md | | all | main.* | 10_dq_users.sql, 11_dq_txn.sql, 13_cohort_dq.sql | none: not re-run (as of 2026-11-09, not refreshed) |

## Phase 2 (re-run 2026-11-22; first run 2026-11-09)

| Metric | Value | n | Window | Source | Script | Raw file |
|---|---|---|---|---|---|---|
| Phase 2 funnel: registered / submitted / approved / rejected / investor / repeat | 64,274 / 23,131 / 16,981 / 6,150 / 3,617 / 2,142 | 64,274 | all to 2026-11-22 | main.users, main.transactions | 40_funnel.sql; cross-check: 42_cohorts.sql monthly registrations sum to 64,274 (asserted in this refresh) and 20_cohort_stages.sql (cohort C) | `raw/phase2/40_funnel.txt`, `raw/phase2/42_cohorts.txt`, `raw/phase2/20_cohort_stages.txt` |
| Churn (activity >90d) / >180d / active | 3,008 (83.2%) / 2,753 (76.1%) / 609 | 3,617 | to 2026-11-22 | main.transactions | 40_funnel.sql; cross-check 49_chk.sql (act_churn 3,008; buys-only 3,163, diff 155) | `raw/phase2/40_funnel.txt`, `raw/phase2/49_chk.txt` |
| Median / P90 days: reg->approved, approved->buy, reg->buy | 0.6/3.58; 1.02/85.15; 5.47/240.03 | 12,958; 2,399; 3,617 | all | main.users, main.transactions | 41_timing.sql | `raw/phase2/41_timing.txt` |
| Monthly cohorts | cohorts.csv | 64,274 | 2021-11 to 2026-11 | main.users, main.transactions | 42_cohorts.sql | `raw/phase2/42_cohorts.txt` |
| Approved->buy within 7d by approval month (Oct 2026 vs Jan-Sep 2026) | 33/430=7.7% vs 197/730=27.0% (Nov 2026 not comparable: approvals still inside the 7-day window) | 430; 730 | 2025-10 to 2026-11 (Oct vs Jan-Sep shown) | main.users, main.transactions | 46_leak.sql | `raw/phase2/46_leak.txt` |
| Oct 2026 cohort split by sales code | 363 reg/273 appr/29 inv; 219/131/17 (no referrer code) | 582 | 2026-10 | main.users, main.transactions | 52_oct_split.sql | `raw/phase2/52_oct_split.txt` |
| Churn profile (survival, indicators) | see churn_profile.md | 3,617 | to 2026-11-22 | main.transactions | 43_dur.sql, 50_indicators.sql | `raw/phase2/43_dur.txt`, `raw/phase2/50_indicators.txt` |
| Segment cuts DB | see segments.md | 64,274 | all | main.users, user_profiles | 44_segments.sql | `raw/phase2/44_segments.txt` |
| Segment cuts GA | see segments.md | 1,229 registered users | 2026-10-01 to 2026-11-21 | analytics_266759216 | 48_ga_seg.sql, 51_ga_src.sql | `raw/phase2/48_ga_seg.txt`, `raw/phase2/51_ga_src.txt` |
| GA vs DB per stage | see ga_vs_db.md | | 2026-10-01 to 2026-11-21 | both | 45_ga_db.sql | `raw/phase2/45_ga_db.txt` |

## Phase 3 (re-run 2026-11-22; first run 2026-11-09)

| Metric | Value | n | Window | Source | Script | Raw file |
|---|---|---|---|---|---|---|
| Acquisition groups: sales_code / referrer_code / none | reg 1,428 / 6,130 / 56,716; inv 255 / 1,262 / 2,100 | 64,274 | all to 2026-11-22 | main.users, main.transactions | 73_more.sql (acq_funnel); retention 70_mkt_quality.sql, 75_mature_repeat.sql, 76_bonus_chk.sql | `raw/73_more.txt`, `raw/70_mkt_quality.txt`, `raw/75_mature_repeat.txt`, `raw/76_bonus_chk.txt` |
| Bonus (retail cohort): users / never paid / value to non-payers | 6,134 / 3,632 (59.2%) / Rp469,200,000 | 6,134 | all | main.transactions | 75_mature_repeat.sql (bonus_before_paid), 76_bonus_chk.sql (6,132 with valid status) | `raw/75_mature_repeat.txt`, `raw/76_bonus_chk.txt` |
| Promo on first buy vs none: repeat | 489/927 = 52.8% vs 1,653/2,690 = 61.4% | 3,617 | all | main.transactions | 70_mkt_quality.sql (promo_first_buy), promo_any_paid | `raw/70_mkt_quality.txt` |
| Email batch (Supabase), as of 2026-11-09 (not refreshed) | 650 sent / 93 failed (454 throttling, all re-sent); 500 logs with events, 497 with open; 0 click; 650/650 no user_id | 743 | 2026-10-13 to 2026-11-03 | Supabase dashboard_email_log, dashboard_email_events | Supabase MCP execute_sql; cached file, not re-run | `raw/supabase_email.json` |
| Push reach by segment (GA, Android receivers) | investor 707, approved-never-bought 560, not approved 262 users with notifications (clicked: 218 / 149 / 30) | 1,529 | 2026-10-01 to 2026-11-21 | analytics_266759216 | 77_final.sql (push_android_by_seg), 82_push_buy.sql | `raw/77_final.txt`, `raw/82_push_buy.txt` |
| KYC decision SLA | verified n=857 P50 0.15 h / P90 15.43 h / >24 h 30; failed n=158 P90 15.15 h | 1015 | GA submit 2026-10-01 to 2026-11-21 | main.user_status_logs + analytics_266759216 | 71_ops_kyc.sql; 79_kyc_screens.sql (wait_buckets, wait_night) | `raw/71_ops_kyc.txt`, `raw/79.txt` |
| Decision actor concentration | rank1 903 (67.4%), rank2 212, rank3 183 of 1,339 (top 3 = 96.9%) | 1,339 | 2026-07-21 to 2026-11-22 | main.user_status_logs | 83_actor.sql, 85_actor_rank.sql | `raw/83_actor.txt`, `raw/85_actor_rank.txt` |
| Decision hour | hour 10 WIB = 386 of 1,339 (28.8%); 21:00-08:59 = 40 (3.0%) | 1,339 | 2026-07-21 to 2026-11-22 | main.user_status_logs | 71_ops_kyc.sql (decision_hour, decision_dow_hour) | `raw/71_ops_kyc.txt` |
| Resubmission after rejection, Oct | still failed 12/105; ended verified 50/71 (resubmitted after first failure) | 176 | 2026-10-01 to 2026-11-21 | main.user_status_logs + analytics_266759216 | 77_final.sql (resub_oct); 71_ops_kyc.sql (resubmit_after_fail, all months: 65/82 verified, 15/121 failed) | `raw/77_final.txt`, `raw/71_ops_kyc.txt` |
| Wait submit->approved vs buy 14 d | <2 h 13/221 = 5.9%; 2-24 h 6/53; >=24 h 3/17 | 291 | GA submit 2026-10-01 to 2026-10-25 (fixed cap in script) | both | 71_ops_kyc.sql (wait_vs_buy) | `raw/71_ops_kyc.txt` |
| KYC funnel by platform | Android 600/745 = 80.5%; iOS 354/412 = 85.9% | 1,157 | 2026-10-01 to 2026-11-21 | analytics_266759216 | 73_more.sql (kyc_platform), 79_kyc_screens.sql | `raw/73_more.txt`, `raw/79.txt` |
| KYC screens | Intro 1,260 -> Identity 1,156 -> SelfieCamera 1,024 -> ... -> VerificationSuccess 955 | | 2026-10-01 to 2026-11-21 | analytics_266759216 | 79_kyc_screens.sql (kyc_screen_view_all) | `raw/79.txt` |
| Payment fail by method (retail) | VA 427/3,811; bank 283/2,427; QRIS 183/834 (21.9%); INSTANT 5/264 (HNWI incl.: QRIS 184/835) | 7,336 | all | main.transactions | 78_gate_pay.sql (pay_fail_cohort) | `raw/78.txt`, `raw/hnwi_incl/78_gate_pay.txt` |
| Approved-never-bought in GA | 317 seen, 56 buy sheet, 14 order | 317 | 2026-10-01 to 2026-11-21 | analytics_266759216 + main.* | 77_final.sql (approved_nobuy_ga), 78_gate_pay.sql (gate_outcome) | `raw/77_final.txt`, `raw/78.txt` |
| Approved -> buy within 7 d (V1), all approved decisions, no GA link | Jul-Sep 42/145 = 29.0%; Oct (approved 1 Oct-14 Nov) 75/714 = 10.5% (z=-5.9); HNWI incl.: 42/146 = 28.8% vs 76/715 = 10.6% | 859; HNWI incl. 861 | approvals 2026-07-21 to 2026-11-14 (capped) | main.user_status_logs + main.* | 84_oct_lag.sql (oct_lag), 86_oct_week.sql | `raw/84_oct_lag.txt`, `raw/86_oct_week.txt`, `raw/hnwi_incl/84_oct_lag.txt` |

Notes: V1 now uses all approved decisions (no GA link needed), capped at approvals before 2026-11-15 so each has 7 full days before the 2026-11-22 cutoff. The 2026-11-09 text used a GA-linked subset (31/416 = 7.5%) that has no raw file now; the like-for-like earlier figure was 33/430 = 7.7% (same direction as the Phase 2 approved->buy cut). Supabase numbers are cached in `raw/supabase_email.json`, not re-run. All queries SELECT-only with 5e9 bytes cap except Supabase, which is read-only by role. Numbers in this log are read from the raw files by a script at refresh time; the findings files were refreshed by their own agents and are not rebuilt by `build_phase*.py`.

## Product & Tech 2027 alignment (2026-11-12)

No new queries. Numbers from the PDF *Product & Tech 2027 — Targets, Direction, Objectives* are Targets, not Observed. Used in `raker_preparation.md` section 0 and one paragraph of `SayaKaya_Funnel_Analysis.md`.

| Figure | Value | Type | Source |
|---|---|---|---|
| End-2027 AUM; new funded customers; net revenue | Rp700.9 billion; 10,982; Rp3.53 billion | Target | PDF p.1 |
| Customers / AUM per channel | RM 732 / Rp394.9 billion; Booth 7,938 / Rp26.9 billion; B2B2C 2,031 / Rp18.7 billion; Marketing 163 / Rp1.0 billion; Ads 118 / Rp0.1 billion; SBN Rp1.3 billion | Target | PDF p.2 |
| Non-RM channels 93.3% of customers, 10.5% of AUM; per-quarter run rate; booth registrations needed (36,581-86,283) | Arithmetic from the Targets above and Observed 21.7% (232/1,068), 9.2% (79/858) (hand-typed, as of 2026-11-09, not refreshed) | Derived (as of 2026-11-09, not refreshed) | cohorts.csv, segments.md, findings_marketing.md |
| Monthly funded-customer baseline, AUM retention, revenue, RM channel, O1, release punctuality | none | Gap | no data yet |

## HNWI-inclusive raker prep and KR mapping (2026-11-15; baselines refreshed 2026-11-22)

HNWI are in scope for the raker preparation because they are the RM target segment (user instruction 2026-11-15). PDF versions -2 and -3 have identical text (same 6,011-character extraction); all PDF numbers remain Targets. Baselines below were re-run 2026-11-22 into `raw/hnwi_incl/` with `q_hn.py` (HNWI-inclusive runner); the decision 9 gap from 2026-11-15 is closed for the queries listed.

| Figure | Value | Type | Source |
|---|---|---|---|
| Retail cohort (HNWI excluded) | 64,274 registered / 23,131 submitted / 16,981 approved / 3,617 investors | Observed | `definitions.md` table B; `raw/phase2/20_cohort_stages.txt`, `raw/phase2/40_funnel.txt` |
| HNWI included | 64,393 / 23,250 / 17,100 / 3,736; registered to investor 5.8%, approved to investor 21.8% | Observed | `raw/hnwi_incl/40_funnel.txt` |
| HNWI users | 119 ever (all verified, all investors); 65 SIDs >= Rp500 million on 2026-11-22 (7 institutions); 78 of 2,767 GA users in 2026-10-01..11-21 | Observed | `raw/phase2/16_hnwi_ever.txt`, `raw/phase2/15_hnwi.txt`, `raw/phase2/22_churn_ga.txt` |
| KR3 mature repeat, HNWI included vs retail | 62.3% (2,220/3,565) vs 61.0% (2,104/3,448); the bounded estimate is replaced by the exact re-run | Observed | `raw/hnwi_incl/75_mature_repeat.txt`, `raw/75_mature_repeat.txt` |
| RM Target pace vs observed HNWI crossings | 732 in 2027 = about 61/month vs at most 119 since 2026-01-14 = about 11.6/month (upper bound; 2026-01-14 to 2026-11-22 = 10.3 months) | Target vs Observed ceiling | PDF + `16_hnwi_ever.sql` |
| KR1 approved to buy in 7 d (HNWI incl.) | Oct 76/715 = 10.6% vs Jul-Sep 42/146 = 28.8% | Observed baseline | `raw/hnwi_incl/84_oct_lag.txt` |
| KR2 Android KYC start to submit (HNWI incl.) | Android 600/745 = 80.5%; iOS 355/413 = 86.0% | Observed baseline | `raw/hnwi_incl/73_more.txt` |
| KR5 QRIS failure 22.0% (184/835) vs VA 11.2% (477/4,276); retail QRIS 21.9% (183/834) | targets in `raker_preparation.md` | Observed baseline, proposed target | `raw/hnwi_incl/78_gate_pay.txt` |
| KR6 sales code mature repeat 43.1% (88/204) vs organic 61.2% (1,293/2,114); retail sales code 39.6% (76/192) | targets in `raker_preparation.md` | Observed, proposed | `raw/hnwi_incl/75_mature_repeat.txt` |
| KR8 GA/DB user coverage: payment complete 87.4% (318/364); register 94.6% (1,228/1,298); order 93.5% (372/398) | targets in `raker_preparation.md` (2% tolerance is an assumption) | Observed, proposed | `raw/hnwi_incl/45_ga_db.txt` |
| KR9 weekend submits >4 hours waiting 41.8% (100/239) vs workdays 11.1% (79/712) | targets in `raker_preparation.md` | Observed, proposed | `raw/hnwi_incl/79_kyc_screens.txt` (wait_buckets) |
| KR10 crash/ANR monitoring: 63 `continue_with_google_failed` + 12 `app_exception` (retail 63 + 12), no alert; milestone KR, no numeric baseline | | Observed, no target | `raw/hnwi_incl/72_tech_mkt_ga.txt`, `raw/72_tech_mkt_ga.txt` |
| O1 KRs (O1-a to O1-c) | No data; Product and Data must set starting points | Gap | none |
| KR4 bonus to payer, HNWI incl. | 6,214 bonus users, 3,632 never paid, Rp469,200,000 | Observed | `raw/hnwi_incl/75_mature_repeat.txt` |

Document shape: `raker_preparation.md` 334 lines at this refresh.

## Refresh 2026-11-22

- **Cutoff change.** Data pull 2026-11-09 -> 2026-11-22. GA4 window 2026-10-01..2026-11-08 (39 days) -> 2026-10-01..2026-11-21 (52 days). Mature threshold (first purchase >=120 days before cutoff) moved from about 2026-07-12 to 2026-07-25 (`75_mature_repeat.sql`: `DATE_DIFF(DATE '2026-11-22', first buy, DAY) >= 120`).
- **Files re-run.** Read-only SQL re-run via `q.py` (HNWI-inclusive set via `q_hn.py`). Raw outputs: `raw/*.txt` (phase 3), `raw/phase2/*.txt` (phase 1 and 2 files 15..52, moved into `phase2/`), `raw/hnwi_incl/*.txt` (HNWI-inclusive, 11 KR-relevant files). Old cutoff outputs kept outside the repo (`~/.hermes/cache/scratch/bak5/outputs/raw/`). Counts: raw registrations 321,087; after RAIZ exclusion 64,393; after RAIZ + HNWI exclusion 64,274.
- **Date snapshot.** HNWI snapshot is 2026-11-22 (`15_hnwi.sql` checked 2026-11-19..22): 65 SIDs >= Rp500 million in 7 institutions (was 65 in 8 on 2026-11-09). HNWI ever: 119, unchanged.
- **Not re-run.** `raw/supabase_email.json` (email batch): numbers kept and labelled "as of 2026-11-09, not refreshed". Data quality counts (`10_dq_users.sql`, `11_dq_txn.sql`, `13_cohort_dq.sql`) and `04_ga_events.sql` have no raw file in this refresh.
- **Hand-typed numbers not refreshed.** The Product & Tech 2027 section (PDF Targets, plus 21.7% (232/1,068) and 9.2% (79/858) in the non-RM channel arithmetic) is labelled "as of 2026-11-09, not refreshed". Findings files (`ga_vs_db.md`, `data_quality.md`, etc.) were not re-read for this log; any figure typed in them keeps its own date.
- **oct_lag cap.** `84_oct_lag.sql` and `86_oct_week.sql` count approvals before 2026-11-15, so every approval has 7 full days before the cutoff. "Oct" = approvals 1 Oct-14 Nov. They use all approved decisions with no GA link, so the 31/416 (7.5%) GA-linked figure from 2026-11-09 has no raw file; the earlier like-for-like figure was 33/430 = 7.7%. New: 75/714 = 10.5% (Oct) vs 42/145 = 29.0% (Jul-Sep). Direction unchanged (Phase 2 cut in `46_leak.sql` still 33/430 = 7.7% vs 197/730 = 27.0%, approval-month basis).
- **q_hn.py.** `scripts/q_hn.py` is the HNWI-inclusive runner: its cohort CTE `U` excludes only RAIZ/RAIZKAYA; the HNWI SID filter is `NOT IN ('__none__')`, so no HNWI are removed. It wrote `raw/hnwi_incl/*.txt` (queries 40, 45, 70-73, 75, 76, 78, 79, 84). It still builds the HNWI SID cache but does not use it; its docstring is stale on this point.
- **Window labels.** HNWI-inclusive files cover the same windows as the retail files; only the cohort definition differs.
