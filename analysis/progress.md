# PROGRESS (agent updates this file at the end of every run)

| Phase | Status (TODO / IN_PROGRESS / DONE) | Output files | Last updated (Asia/Jakarta) |
|---|---|---|---|
| 1. Setup & understanding | DONE | outputs/data_dictionary.md, data_quality.md, definitions.md, data_provenance_log.md; scripts/01-06,10-16,20-23,30,31 | 2026-11-09 17:55 |
| 2. Funnel & reconciliation | DONE | outputs/funnel_overview.md, cohorts.csv, churn_profile.md, segments.md, ga_vs_db.md, charts/ (funnel, cohort_monthly, survival); scripts/40-52; build_phase2.py | 2026-11-09 18:40 |
| 3. Team analyses | DONE | outputs/findings_marketing.md, findings_ops_kyc.md, findings_product.md, findings_cross.md; scripts/60-86; build_phase3.py | 2026-11-09 20:15 |
| 4. Final deliverables | DONE | outputs/SayaKaya_Funnel_Analysis.md, raker_preparation.md, SayaKaya_Funnel_Analysis.docx, raker_preparation.docx; build_phase4.py | 2026-11-09 20:35 |

## Key definitions & decisions (from outputs/definitions.md)
- Register: row in `main.users` (`created_at` +7h). GA: `register_success`
- KYC (submitted / approved / rejected): submitted = status `verified` or `failed`; approved = `verified`; rejected = `failed` (reason not in data). Unverified with data = in progress. GA: `kyc_start` / `kyc_success`
- Investor: first successful non-bonus buy (`completed`, `completed_payment`, `verified`, `verified_by_operational`). GA: `payment_complete`
- Churned (threshold + justification): no buy/sell/switch-in for >90 days (gap p90 = 86 d; came-back share 53.7% at 90 d, falls gradually). 180 d as sensitivity in Phase 2
- HNWI rule: SID AUM >= Rp500,000,000 on any daily snapshot of `mi_fee_logs.portfolio_with_code` since 2026-01-14 (119 users). Matches hnwi-bonus-config.js minAum
- Timezone handling: DB is UTC, add 7h. GA `event_date` already WIB

## Assumptions made
- DB via repo service-account key (SELECT only, 5 GB billing cap per query), GA4 via BigQuery export analytics_266759216. No GA Data API needed.
- Investor does not require status verified (cohort C has 21 such buys).
- Empty-string referrer_code (8 users) stays in the cohort per the rule expression.
- Internal accounts (27) and institutions (15) stay in the cohort (rules do not exclude them).
- Cohort counts: raw 320,606 → excl. RAIZ 63,912 → excl. HNWI 63,793 (Phase 1); Phase 2 uses 63,795 (+2 new sign-ups between runs).

## Phase 1 findings (data quality)
1. `user_status_logs` only from 2026-07-21 → KYC timing/rejection-reason funnel only from Aug 2026.
2. 4,118 verified users missing `verified_at` → do not use `verified_at` alone for old users.
3. `has_completed_first_subscription` unreliable → derive Investor from `transactions`.
4. 85% GA devices have no `user_id` pre-login → pre-login steps are device-level only.
5. `register_success` duplicated 4.3%; `payment_complete` misses ops-set statuses.
6. Email/notification logs are in Supabase, not BigQuery; read in Phase 3.

## Phase 2 findings (biggest leaks)
1. Approved but never bought: 13,093 of 16,659 (78.6%). Oct 2026 approvals bought within 7 d at 7.7% vs 27.0% in Jan-Sep (shortfall ~83 investors vs the old rate).
2. Registered, KYC not finished: 41,021 of 63,795 (64.3%). Oct 2026 cohort left only 23.1% unfinished vs 49.6% in Jan-Sep (~477 more KYC results if repeated).
3. Churn: 3,000 of 3,587 investors (83.6%) silent >90 d; 40.6% bought on only one day. First buy <Rp100k → 95.5% churn.
4. KYC rejection 26.8% of submitted (last 13 months 16.5%).
5. GA vs DB: `kyc_success` fires at submission, not approval; `payment_complete` misses ops-set statuses; `register_success` duplicated 4.3%; 45 DB sign-ups in window have no GA event; GA `google / cpc` 130 devices with 0 registrations.
6. Not checked: age × occupation (Simpson), bot traffic, consent/ad-block.

## Phase 3 findings (per team)
Marketing: (M1) sales-code sign-ups convert like referrals (21.7% vs 20.6% investor/reg) but repeat mature 39.3% vs 60.0% and median first ticket Rp125,950; (M2) bonus credit reached 6,130 users, 3,629 (59.2%) never paid, Rp469,400,000 to non-payers, only 407 got credit before their first paid buy; (M3) promo on first buy 52.9% vs 61.7% repeat, sign flips when promo counted on any buy → confounding; (M4) only email batch is fund_performance/batch: 650 sent, 93 failed (454 throttling, all re-sent), 0 click events, 497/497 opens within 2 hours (prefetch), 650/650 rows without user_id; (M5) push reached 567 approved-never-bought, click-to-buy test only 103 users; (M6) no lifecycle email for the 13,093 approved-never-bought pool.
Ops & KYC: (O1) P50 decision 10 min, P90 15.7 h, 21 of 548 verified decisions >24 h; weekend P90 17.2 h vs 11.9 h; all >4h office-hour cases also >12h → overnight queueing, not slow work; (O2) one actor made 700 of 922 decisions (75.9%), three actors 97%, 318 decisions in hour 10 WIB; (O3) 6 of 70 rejected Oct users resubmitted vs 27 of 40 who ended verified; rejection reason not stored; (O4) wait time does not predict buying (5.9% vs 12.9%, p=0.054).
Product & Engineering: (T1) KYC start 746 → submit 617, identity screen to selfie camera −11.3%, Android submit 79.6% vs iOS 88.1% (z=−2.93); (T2) QRIS fail 22.2% vs 11.1% VA / 11.0% bank, only 36 of 1,016 orderers failed and never paid; (T3) of 257 GA-visible approved-never-bought, 43 opened buy sheet, 8 ordered; (T4) risk gate abandoned 28.9%, no significant downstream loss (p=0.243); (T5) 45 continue_with_google_failed + 10 app_exception events, no crash/ANR data.
Cross: (V1) approved-to-buy within 7 days 7.5% in Oct vs 29.2% Jul-Sep (z=−6.6); holds inside the same-day approval bucket (7.4% vs 29.5%) so it is not wait time; 90 buyers missing in Oct alone. Cause not identified: acquisition mix, missing lifecycle, or an early-Oct product/ops change. (V2) the 13,093 approved-never-bought pool is one problem seen from three teams.

## Open questions / blockers
- Is Rp500M HNWI threshold right? Default: keep.
- Exclude 27 internal accounts? Default: no.
- Exclude institutions (`is_institution`)? Default: no.
- Answers could change Phase 2/3 numbers. Freshness of scheduled `main.*` copy not checked.
- KYC rejection reasons not stored; need column in `user_status_logs`.
- GA `user_id` missing pre-login (85% devices) → cannot map pre-login events to user.
- Email batch logs lack `user_id` and click events.
- No Crashlytics/ANR data available.
- Acquisition channel mix per month not available (needed for V1 diagnosis).

## Data requests (combined)
- KYC rejection reason per decision, and submit timestamp in DB.
- Distinguish auto vs manual decision in `user_status_logs.auth_user_id`.
- `user_id` on GA pre-login events; `campaign_id` on push/email events; click event type on email.
- Provider error codes on failed transactions.
- Crashlytics/ANR export.
- Bonus program rules (who, when, how much).
- Acquisition channel mix per month (to explain Oct drop V1).

## Skills / MCP used
- `gcp-bigquery` (project rules, definitions, queries; @google-cloud/bigquery via `scripts/bq.js`)
- Supabase MCP (read-only, project `josptpfisrsdjeggkqke`): `list_projects`, `list_tables`, `execute_sql` for `dashboard_email_log`, `dashboard_email_events`, `dashboard_scheduled_jobs`, `dashboard_schedule_queue`, `dashboard_send_exclusions`
- Python (stdlib + pandas/scipy via `scripts/`) for aggregation, stats (pooled z-test, Wilson CI), charting (matplotlib), markdown→HTML (markdown), DOCX export (textutil)
- No new dependencies installed.

## File tree (analysis/)
```
analysis/
├── MASTER_PROMPT.md
├── 00_rules.md
├── phase_1_setup.md
├── phase_2_funnel.md
├── phase_3_teams.md
├── phase_4_deliverables.md
├── progress.md                    ← THIS FILE
├── outputs/
│   ├── data_dictionary.md
│   ├── data_quality.md
│   ├── definitions.md
│   ├── data_provenance_log.md
│   ├── funnel_overview.md
│   ├── churn_profile.md
│   ├── segments.md
│   ├── ga_vs_db.md
│   ├── cohorts.csv
│   ├── findings_marketing.md
│   ├── findings_ops_kyc.md
│   ├── findings_product.md
│   ├── findings_cross.md
│   ├── SayaKaya_Funnel_Analysis.md
│   ├── SayaKaya_Funnel_Analysis.html
│   ├── SayaKaya_Funnel_Analysis.docx
│   ├── raker_preparation.md
│   ├── raker_preparation.html
│   ├── raker_preparation.docx
│   ├── charts/
│   │   ├── funnel.png
│   │   ├── cohort_monthly.png
│   │   └── survival.png
│   └── raw/ (27 SQL result files + supabase_email.json)
└── scripts/
    ├── bq.js, run_many.py, q.py
    ├── build_phase2.py, build_phase3.py, build_phase4.py
    └── 70+ SQL files (01-86)
```

No duplicate `analysis/` or `outputs/` folders found. All paths in `MASTER_PROMPT.md` and `00_rules.md` are correct relative to project root.
## Penyelarasan P&T 2027 (2026-11-12)

- Input: PDF *Product & Tech 2027 — Targets, Direction, Objectives*. Angka PDF = Target, bukan Observed. Tidak ada kueri dijalankan.
- `outputs/raker_preparation.md`: bagian 0 baru (rencana, cakupan, objective, Fakta vs Target, roadmap), catatan O2 di bagian 2-3, keputusan 6-7, agenda.
- `outputs/SayaKaya_Funnel_Analysis.md`: 1 paragraf keselarasan, tabel pemetaan temuan ke objective P&T, 1 kalimat di roadmap. Angka tidak berubah.
- `.html`/`.docx` dibuat ulang. Provenance: bagian "Penyelarasan P&T 2027" di `data_provenance_log.md`.
- PERINGATAN: `scripts/build_phase4.py` menimpa kedua `.md` dari file sumber dan akan menghapus penyelarasan ini. Jangan dijalankan ulang tanpa memasukkan perubahan ke builder.
- Gap: tidak ada data O1 (non-reksa dana), kanal RM/B2B2C/SBN, revenue, ketepatan rilis, baseline bulanan "new funded customer", retensi AUM.
