# SayaKaya — Analisis Funnel Akuisisi ke Investasi Pertama

Disusun 2026-11-09 20:20 WIB (Asia/Jakarta). Semua angka dari BigQuery `sayakaya` (read-only, cap 5 GB per kueri) dan Supabase `dashboard_email_log`/`dashboard_email_events` (read-only), tarik data 2026-11-09. Tidak ada PII di dokumen ini; semua sel <10 disembunyikan.

## 1. Ringkasan eksekutif

Kohort: 63.795 user terdaftar (tanpa referrer RAIZ/RAIZKAYA, tanpa HNWI). Funnel: 35,7% submit KYC, 73,2% dari submit disetujui, 21,5% dari approved menjadi investor. Artinya 5,6% user terdaftar pernah membeli, dan 83,6% investor kemudian diam lebih dari 90 hari.

Lima temuan terpenting:

1. **Kolam approved yang tidak pernah membeli adalah kebocoran terbesar: 13.093 user (78,6% dari approved).** Ini satu masalah yang dilihat tiga tim: tidak ada trigger CRM, tidak ada permukaan di aplikasi, tidak ada antrean operasi. Dari 257 user kolam itu yang terlihat di GA dalam 39 hari, 43 membuka buy sheet dan 8 membuat order (§4.4 T3, §4.5 V2).
2. **Konversi approved ke pembelian jatuh di Oktober: 7,5% vs 29,2% (Juli-September), dan bukan karena waktu tunggu.** Penurunan tetap ada di bucket approval hari yang sama (7,4% vs 29,5%). Pada rate lama, Oktober kehilangan sekitar 90 pembeli (z=-6,6, §4.5 V1).
3. **Bonus kredit tidak menciptakan pembayar: 3.629 dari 6.130 penerima (59,2%) tidak pernah membeli berbayar; Rp469.400.000 kredit berakhir di non-pembayar.** Hanya 407 penerima (6,6%) menerima kredit sebelum pembelian berbayar pertamanya; 2.094 (34,2%) sudah pembayar, jadi program ini lebih mirip reward daripada akuisisi (§4.2 M2).
4. **Funnel KYC putus di dalam aplikasi, bukan di KYC itu sendiri: identity verification ke selfie camera −11,3%, submit Android 79,6% vs iOS 88,1% (z=-2,93).** Menutup separuh gap Android-iOS ≈ 21 submit tambahan per 39 hari (§4.4 T1).
5. **Sign-up sales code berkonversi setara referral (21,7% vs 20,6% investor/registrasi) tetapi retensi mature-nya terburuk: 39,3% repeat vs 60,0% grup organik, median tiket pertama Rp125.950.** Gap repeat = 191 investor mature x 20,7 pp (§4.2 M1).

**User yang bisa dipulihkan.** Tidak dijumlahkan lintas temuan karena beberapa tindakan menyasar kolam yang sama (V2/T3/M6 semuanya kolam approved). Estimasi per tindakan, semua aritmetika dan bukan hasil eksperimen:

| Tindakan | Dasar | Estimasi |
|---|---|---|
| Permukaan + CRM pasca-approval (V2/T3) | 10% dari 257 user GA-visible x rate order→bayar 84,3% | 22 investor / 39 hari (≈206/tahun) |
| Nudge investasi pertama (M6) | 476 approval 30 hari terakhir x 10% gap 21,7 pp | 10 investor / 30 hari |
| Perbaikan gap KYC Android (T1) | 485 start x 8,5 pp / 2 x 73,2% x 21,5% | 21 submit → 3,3 investor / 39 hari |
| Pengajuan ulang pasca-penolakan (O3) | 10% dari 70 user gagal Okt x 67,5% verified x 73,2% | 3,5 investor / bulan |
| QRIS ke fail rate VA (T2) | (22,2% − 11,1%) x 765 order | 85 order terselamatkan (batas atas) |

**Batasan yang harus dibaca bersama angka di atas.** Tidak ada eksperimen acak di data ini: seluruh klaim sebab-akibat berlabel Inferred. Penyebab penurunan Oktober belum teridentifikasi (tiga hipotesis terbuka). GA tidak membawa `user_id` pra-login (85% device), jadi funnel GA adalah sampel, bukan sensus. Alasan penolakan KYC tidak disimpan. Email tidak punya click tracking dan baris batch tidak punya `user_id`.

**Keselarasan dengan rencana Product & Tech 2027.** Rencana (PDF *Product & Tech 2027*, angka berlabel Target) menargetkan 10.982 nasabah baru berdana dan AUM Rp700,9 miliar. Analisis ini menutup nasabah ritel: kanal non-RM = 93,3% nasabah target tetapi 10,5% AUM baru. Temuan memetakan ke Objective 2 (*mudahkan mulai dan lanjut berinvestasi*); tidak ada data untuk Objective 1 (produk non-reksa dana) dan hanya sebagian untuk Objective 3 (T5, kualitas data). Pemetaan, gap, dan perbandingan Fakta vs Target ada di `raker_preparation.md` bagian 0. Angka di dokumen ini tidak berubah.

## 2. Lingkup, definisi, dan kualitas data

### 2.1 Sumber

| Sumber | Isi | Window | Catatan |
|---|---|---|---|
| BigQuery `sayakaya.main.*` | users, user_profiles, transactions, user_status_logs, funds | seluruh riwayat | salinan terjadwal dari Postgres produksi |
| BigQuery `sayakaya.mi_fee_logs` | snapshot AUM harian | sejak 2026-01-14 | dasar definisi HNWI |
| BigQuery `analytics_266759216.events_*` | GA4 app events | 2026-10-01..2026-11-08 | tanpa `user_id` sebelum login |
| Supabase `dashboard_email_log`, `dashboard_email_events` | log kirim email + event | 2026-08-31..2026-11-03 | tanpa click event, `user_id` NULL pada batch |

### 2.2 Definisi kunci

| Istilah | Definisi |
|---|---|
| Registrasi | baris di `main.users` (`created_at` +7 jam) |
| KYC submitted / approved / rejected | status `verified` atau `failed` / `verified` / `failed` |
| Investor | pembelian sukses non-bonus pertama (`completed`, `completed_payment`, `verified`, `verified_by_operational`; bukan `manual_bonus`/`bonus`) |
| Repeat | pembelian pada 2 hari berbeda atau lebih |
| Churn | tidak ada beli/jual/switch-in selama >90 hari (gap p90 = 86 hari; peluang kembali 53,7% pada 90 hari). 180 hari dipakai sebagai sensitivitas |
| Mature (repeat) | pembelian pertama ≥120 hari sebelum tarik data |
| HNWI | SID dengan AUM ≥Rp500.000.000 pada salah satu snapshot harian (119 user), dikeluarkan dari kohort |

### 2.3 Pengecualian dan ukuran kohort

320.606 registrasi → 63.912 setelah mengeluarkan referrer RAIZ/RAIZKAYA → 63.793 setelah mengeluarkan HNWI (Fase 1). Fase 2 memakai 63.795 karena dua registrasi baru di antara dua run. 27 akun internal dan 15 institusi tetap di dalam kohort sesuai aturan; bila dikeluarkan, angka bergeser <1 pp.

### 2.4 Kualitas data (ringkas)

- `user_status_logs` baru ada sejak 2026-07-21, jadi analisis waktu keputusan hanya mencakup periode itu.
- 4.118 user berstatus verified tidak punya `verified_at`.
- GA tidak membawa `user_id` pada 85% device pra-login; `kyc_success` menyala saat submit, bukan saat approve; `register_success` terkirim ganda pada 4,3%; `payment_complete` melewatkan status yang diset operasi.
- `has_completed_first_subscription` tidak dapat dipakai (tidak konsisten dengan transaksi).
- Seluruh detail ada di `outputs/data_quality.md` dan `outputs/data_provenance_log.md`.

## 3. Funnel dan rekonsiliasi GA vs DB

### Stage conversion (n = 63,795 registered)
| Stage | Users | % of registered | Step conversion | 95% CI of step |
|---|---|---|---|---|
| Registered | 63,795 | 100% | | |
| KYC submitted (verified or failed) | 22,773 | 35.7% | 35.7% of registered | 35.3-36.1% |
| KYC approved | 16,659 | 26.1% | 73.2% of submitted | 72.6-73.7% |
| KYC rejected | 6,114 | 9.6% | 26.8% of submitted | 26.3-27.4% |
| Investor (first paid buy) | 3,587 | 5.6% | 21.5% of approved | 20.9-22.2% |
| Repeat investor (buys on 2+ days) | 2,132 | 3.3% | 59.4% of investors | 57.8-61.0% |
| Still active (last activity within 90 d) | 587 | 0.9% | 16.4% of investors | 15.2-17.6% |
| Churned (no activity > 90 d) | 3,000 | | 83.6% of investors | 82.4-84.8% |

Not finished KYC (status unverified): 41,021 = 64.3% of registered. Investors not verified: 21. Verified, never bought: 13,093 = 78.6% of approved.
Churn base note: 128 investors made their first buy within 90 days, so are not yet classifiable; excluding them churn is 3,000 / 3,459 = 86.7%.
Sensitivity: with a 180-day line, 2,742 of 3,587 investors are churned (76.4%) vs 83.6% at 90 days; the funnel shape does not change.
Cohort size is 63,795, 2 more than the 63,793 of Phase 1: users who registered after the Phase 1 run (Observed; same rules).
Churn count here (activity = buy, sell, SWITCH_IN) is 3,000. Phase 1 `definitions.md` quoted 3,165 using buys only; the 165 difference are users whose last buy is older than 90 d but who sold or switched in the last 90 d (`49_chk.sql`). Phase 2 uses the activity definition.

Before/after exclusion (Observed, Phase 1 `20_cohort_stages.sql`): registered 320,606 -> 63,912 (excl. RAIZ/RAIZKAYA) -> 63,793 (excl. HNWI); approved 17,210 -> 16,776 -> 16,657; investors 260,219 -> 3,706 -> 3,587.

### Time between stages (days, cohort C; users with a valid timestamp pair)
| Transition | n | p50 | p90 | Pairs with negative gap (dropped) |
|---|---|---|---|---|
| Register -> approved | 12,636 | 0.62 | 3.63 | 0 |
| Approved -> first buy | 2,369 | 1.03 | 90.77 | 10 |
| Register -> first buy | 3,587 | 5.58 | 243.7 | 19 |

n for register -> approved is lower than 16,659 approved because `verified_at` is empty for 4,023 approved users (data quality #5). Reading: half of approved users are approved within a day, 90% within about 4 days; buyers who buy do it fast (median about 1 day after approval) but the p90 is 91 days, so a long tail buys much later.

### Register cohorts by month (full table: `cohorts.csv`, chart: `charts/cohort_monthly.png`)
| Reg month | Registered | Approved | Approved % | Investor within 7 d | Within 7 d % | Investor ever % |
|---|---|---|---|---|---|---|
| 2025-10 | 450 | 233 | 51.8% | 36 | 8.0% | 11.1% |
| 2025-11 | 220 | 95 | 43.2% | 43 | 19.5% | 24.1% |
| 2025-12 | 208 | 78 | 37.5% | 26 | 12.5% | 17.3% |
| 2026-01 | 448 | 167 | 37.3% | 54 | 12.1% | 15.8% |
| 2026-02 | 235 | 91 | 38.7% | 22 | 9.4% | 13.6% |
| 2026-03 | 260 | 105 | 40.4% | 21 | 8.1% | 10.8% |
| 2026-04 | 217 | 75 | 34.6% | 13 | 6.0% | 7.8% |
| 2026-05 | 147 | 59 | 40.1% | 12 | 8.2% | 11.6% |
| 2026-06 | 138 | 54 | 39.1% | 8 | 5.8% | 10.1% |
| 2026-07 | 126 | 46 | 36.5% | 7 | 5.6% | 8.7% |
| 2026-08 | 97 | 58 | 59.8% | 11 | 11.3% | 17.5% |
| 2026-09 | 132 | 68 | 51.5% | 21 | 15.9% | 19.7% |
| 2026-10 | 611 | 425 | 69.6% | 31 | 5.1% | 7.0% |
| 2026-11 | 247 | 157 | 63.6% | 36 | 14.6% | 14.6% |

Recent months are not mature (a 2026-11 user has had at most 9 days). Compare 7-day conversion, which is mature for all months through 2026-11-02.

### Biggest leaks and recoverable users (arithmetic shown)

#### Leak 1. Registered but KYC not finished
- Observed: 41,021 of 63,795 (64.3%) never reached a KYC result. Last 13 registration months (2025-11 to 2026-11): 1,315 of 3,086 (42.6%).
- Observed: Jan-Sep 2026 cohorts left 892 of 1,800 (49.6%) unfinished; the Oct 2026 cohort (booth month) left 141 of 611 (23.1%). Difference significant (z = -11.4).
- Estimate: if Jan-Sep cohorts had finished like Oct, 892 - 1,800 x 141/611 = 477 more users reach KYC result. At the Jan-Sep investor-per-approved rate (233 / 723 = 32.2% ever) that is about 154 investors; at the Oct verified-to-buy-within-7-days rate (33 / 430 = 7.7%) about 37. Assumption: the Oct pattern is reproducible outside booths (not tested).

#### Leak 2. Approved but never buys (largest in user count)
- Observed: 13,093 of 16,659 approved users (78.6%) never made a paid buy. Approved from 2025-11 on: 1,094 of 1,506 (72.6%) never bought.
- Observed: users approved in Oct 2026 bought within 7 days at 33 / 430 = 7.7% (5.5-10.6%) vs Jan-Sep 2026 197 / 730 = 27.0% (23.9-30.3%); z = -8.0. More approvals did not bring more buyers.
- Estimate: Oct approvals at the Jan-Sep rate would be 430 x 197/730 = 116 buyers within 7 days; observed 33; shortfall 83 investors. Oct cohort buying may still arrive later, so treat the shortfall as an upper bound (Observed: the 30-day figure for early-Oct approvals is 44 of 430).
- Pool: each +1 percentage point of the 1,094 recent never-buyers = 11 investors.
- Observed (`52_oct_split.sql` cut of the Oct 2026 cohort, 611 registered): with a sales code 363 registered, 271 approved, 26 bought ever = 7.2%; without 219 registered, 130 approved, 14 bought = 6.4%. Both are low, so the Oct drop is not only a booth effect. Cause not identified; Phase 3 should look at what the booth sign-up flow asks users to do after KYC.

#### Leak 3. First-time investors who do not come back (churn)
- Observed: 3,000 of 3,587 investors are silent for more than 90 days (83.6%); 2,742 for more than 180 d. 1,455 (40.6%) bought on only one day. See `churn_profile.md`.
- Estimate: each +10% of churned users reactivated = 300 users (Proposed; no observed reactivation campaign rate in data yet).

#### Leak 4. KYC rejection
- Observed: 6,114 rejected of 22,773 submitted (26.8%); last 13 months 293 of 1771 (16.5%). Rejection reasons are not in BigQuery (data request).
- Estimate (Proposed): halving the last-13-month rejection count recovers 146 approved users, about 31 investors at the all-time investor-per-approved rate (21.5%).

### Verified-to-buy by month of approval (`46_leak.sql`)
| Approval month | Approved | Bought within 7 d | % | Never bought (to date) |
|---|---|---|---|---|
| 2025-10 | 229 | 39 | 17.0% | 178 |
| 2025-11 | 96 | 46 | 47.9% | 44 |
| 2025-12 | 83 | 31 | 37.3% | 43 |
| 2026-01 | 149 | 55 | 36.9% | 86 |
| 2026-02 | 92 | 27 | 29.3% | 58 |
| 2026-03 | 120 | 29 | 24.2% | 84 |
| 2026-04 | 77 | 16 | 20.8% | 60 |
| 2026-05 | 56 | 14 | 25.0% | 38 |
| 2026-06 | 60 | 10 | 16.7% | 44 |
| 2026-07 | 47 | 8 | 17.0% | 36 |
| 2026-08 | 55 | 12 | 21.8% | 41 |
| 2026-09 | 74 | 26 | 35.1% | 44 |
| 2026-10 | 430 | 33 | 7.7% | 386 |
| 2026-11 | 167 | 37 | 22.2% | 130 |

Within-7-day count includes the few users who bought before `verified_at` (data quality #10).

### 3.1 Churn profile

### Who and when (Observed)
- 3,000 of 3,587 investors churned (83.6%). To avoid counting young accounts, tables below use the 3,459 investors whose first buy is more than 90 days ago (3,000 churned = 86.7%).
- Among churned users, last activity falls: same day as first buy 11.6%; within 7 days 14.4%; within 30 days 23.8%; median 203 days after first buy; p75 585 days.

### Survival curve (Kaplan-Meier, share of investors not yet churned, days since first buy)
Churn is dated 90 days after the last activity; users still active or inside the window are censored at their age.

| Days since first buy | 90 | 120 | 180 | 270 | 365 | 450 |
|---|---|---|---|---|---|---|
| Not churned | 89.9% | 79.3% | 68.1% | 58.3% | 50.7% | 46.2% |

Reading: 10% churn before day 90 (they never came back after the first buy day); half are gone by about one year. This chart is dominated by the 2022-2025 buyers (older buyers outnumber recent ones, see "By first-buy half-year").

### After what behaviour (Observed, correlation)
Active days in first life (all activity days, users with first buy over 90 d ago):
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 1 | 349 | 349 | 100.0% | 98.9-100.0% |
| 2-3 | 1,230 | 1,186 | 96.4% | 95.2-97.3% |
| 4-9 | 867 | 799 | 92.2% | 90.2-93.8% |
| 10+ | 1,013 | 666 | 65.7% | 62.8-68.6% |

Read: all 349 one-day users churned by definition (one active day cannot be followed by a return), so this table mostly says "repeat buyers survive". Not independent of the definition.

Leading indicators measured at first buy / first 30 days (users with first buy at least 120 days ago, so every user has had the same observation time; churn = silent > 90 d now). Indicators are measured before churn, so they are usable for early warning, but these are Correlation, not Causal:

Activity in the 30 days after first buy (count of active days):
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 0 | 1,641 | 1,491 | 90.9% | 89.4-92.2% |
| 1 | 978 | 853 | 87.2% | 85.0-89.2% |
| 2-3 | 623 | 504 | 80.9% | 77.6-83.8% |
| 4+ | 201 | 149 | 74.1% | 67.7-79.7% |

z-test 0 vs 4+ days: 7.2. Evidence: High (large n, big gap).

Size of the first buy:
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| <100k | 598 | 571 | 95.5% | 93.5-96.9% |
| 100-500k | 1,245 | 1,117 | 89.7% | 87.9-91.3% |
| 0.5-5jt | 954 | 775 | 81.2% | 78.6-83.6% |
| 5jt+ | 646 | 534 | 82.7% | 79.6-85.4% |

z-test <100k vs 0.5-5jt: 8.1. Evidence: Med (could reflect testers or bonus-triggered tiny buys).

Fund type of the first buy:
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| EQUITY | 606 | 550 | 90.8% | 88.2-92.8% |
| FIXED_INCOME | 907 | 759 | 83.7% | 81.1-85.9% |
| MIXED | 860 | 744 | 86.5% | 84.1-88.6% |
| MONEY_MARKET | 1,030 | 913 | 88.6% | 86.6-90.4% |
| PROTECTED | 40 | 31 | 77.5% | 62.5-87.7% |

Payment method of the first buy:
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| INSTANT_PAYMENT | 40 | 37 | 92.5% | 80.1-97.4% |
| QRIS | 67 | 58 | 86.6% | 76.4-92.8% |
| bank_transfer | 2,439 | 2,111 | 86.6% | 85.1-87.8% |
| virtual_account | 897 | 791 | 88.2% | 85.9-90.1% |

Types or methods with fewer than 10 users are shown as `<10`; PROTECTED n = 40 is low-confidence.

### By first-buy half-year (Simpson / survivorship check)
| Group | Users | Churned | Churn % | 95% CI |
|---|---|---|---|---|
| 2021-H2 | 25 | 20 | 80.0% | 60.9-91.1% |
| 2022-H1 | 977 | 830 | 85.0% | 82.6-87.1% |
| 2022-H2 | 367 | 328 | 89.4% | 85.8-92.1% |
| 2023-H1 | 193 | 162 | 83.9% | 78.1-88.4% |
| 2023-H2 | 219 | 192 | 87.7% | 82.7-91.4% |
| 2024-H1 | 247 | 221 | 89.5% | 85.0-92.7% |
| 2024-H2 | 250 | 220 | 88.0% | 83.4-91.5% |
| 2025-H1 | 642 | 603 | 93.9% | 91.8-95.5% |
| 2025-H2 | 313 | 260 | 83.1% | 78.5-86.8% |
| 2026-H1 | 203 | 156 | 76.8% | 70.6-82.1% |
| 2026-H2 | 23 | <10 | 34.8% | 18.8-55.1% |

Newer cohorts show lower churn mainly because they have had less time to churn (right-censoring), so do not read 2026-H1 as an improvement without the survival curve.

### Leading indicator summary
- Observed: no follow-up activity in the 30 days after the first buy -> 90.9% churn vs 74.1% with 4+ active days.
- Observed: first buy under Rp100k -> 95.5% churn vs 81.2% for Rp0.5-5 million.
- Inferred: a 30-day reactivation push after first buy is the earliest lever; first buy size under Rp100k marks low commitment. Proposed for Phase 3.
- Not available: churn by marketing source/device (the DB has no acquisition field; GA user mapping covers only Oct-Nov 2026). Added to Data Requests.

### 3.2 Segmen

Profile fields (gender, age, occupation, income, city) are filled only after KYC, so for those cuts the useful denominator is approved users. For approved users the 'Investor % of approved' column is the fair comparison; the `(null)` rows are users who never reached the profile step.
Monthly income and city are not analysed: income is empty for all 63,795 users (Observed, `44_segments.sql`); city has about 500 values, most cells under 10.

### Acquisition: referrer code (DB)
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

### Sales code (booth / sales rep)
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| no | 62,727 | 15,906 | 25.4% (25.0-25.7%) | 3,355 | 21.1% (20.5-21.7%) | 5.3% |
| yes | 1,068 | 753 | 70.5% (67.7-73.2%) | 232 | 30.8% (27.6-34.2%) | 21.7% |

- Observed: users with a sales code reach investor at 21.7% of registered vs 5.3%; approval 70.5% vs 25.4%. Investor per approved: 30.8% vs 21.1% (z = 6.3). Selection: sales-code users were helped through KYC, so approval is not comparable.

### Registration period
| Segment | Registered | Approved | Approved % (95% CI) | Investors | Investor % of approved (95% CI) | Investor % of registered |
|---|---|---|---|---|---|---|
| before 2026-10 | 62,937 | 16,077 | 25.5% (25.2-25.9%) | 3,508 | 21.8% (21.2-22.5%) | 5.6% |
| 2026-10+ (booth era) | 858 | 582 | 67.8% (64.6-70.9%) | 79 | 13.6% (11.0-16.6%) | 9.2% |

- Observed: Oct 2026 onward (booth event) approval 67.8% vs 25.5% before. Investor rate is not comparable yet because the Oct-Nov cohort is young; use the 7-day columns in `funnel_overview.md` (Oct 2026: 5.1% within 7 d vs Jan-Sep 9.4%; z = -3.3).

### Demographics (approved users only are comparable)
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

### Acquisition source, device and region (GA, Oct 1 - Nov 8, 2026, users who registered and logged in)
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

### 3.3 GA vs DB

| Stage | GA metric | GA | DB metric | DB | GA / DB | Likely cause (Inferred unless stated) | Fix |
|---|---|---|---|---|---|---|---|
| Register | `register_success`, users in cohort C | 788 | users with `created_at` in window | 832 | 94.7% | Missing events: 45 DB registrations (5.4%) have no GA `register_success` for the same user_id (Observed). Possible: event not sent offline/ad-block/consent, web or non-app registration path | Log register server-side; check whether web sign-up exists |
| Register (duplicates) | `register_success` events vs users, all users | 831 events | distinct users | 797 | 4.3% extra events | Event fires more than once per user (Observed) | Fire once per user_id; dedupe in reports |
| KYC | `kyc_success`, users in cohort C | 617 | KYC approved (`verified_at` in window) | 572 | 107.9% | GA fires on submission, not approval: 68 GA users are not approved in the DB (Observed). DB approved matched in GA 542 of 572 (94.8%) | Rename to `kyc_submitted`; add `kyc_approved` from the server |
| KYC (compare to submitted) | `kyc_success`, users in cohort C | 617 | registered in window, status verified or failed | 636 | 97.0% | Closer match supports "GA = submission". Windows differ (registered in window vs event date), so approximate | |
| KYC start | `kyc_start`, users in cohort C | 746 | no DB equivalent | n/a | | Not available: DB records no 'started' state | |
| Order | `order_created`, users in cohort C | 287 | users with a buy transaction (any status, not bonus) | 304 | 94.4% | Missing events (Observed gap 17 users) | Same as register |
| Paid | `payment_complete`, users in cohort C | 242 | users with successful buy | 278 | 87.1% | DB successful buyers matched in GA: 238 of 278 (85.6%). Statuses set by operations (`verified_by_operational` 27 users, `verified` 10) are not triggered in the app, so GA cannot see them | Server-side purchase event on status change |
| Paid (events) | `payment_complete` events, cohort C | 500 | successful buy transactions | 626 | 79.9% | Fewer events than transactions; payment on a different day than creation also shifts counts (window by event date vs `created_at`) | |

### Other checks (Observed)
- `user_id` is set only after login: `first_open` has 0 users with `user_id`, and 2,869 of 3,375 devices (85%) have rows without it (Phase 1 DQ #25). Pre-login steps (install, open, sign-up start) can only be counted per device.
- GA to DB mapping: 2,254 of 2,257 GA user_ids exist in `main.users`. Of 2,257 GA users: 144 are RAIZ/RAIZKAYA, 77 HNWI, 2,033 kept (Phase 1 DQ #26).
- Timezone: GA `event_date` is WIB; DB `created_at` is UTC and shifted +7 h. Checked on one day only.
- Not tested: bot traffic (no bot flag in the export), consent mode / ad-block (no consent field read), consent rate.

### Fix list (Proposed, order by value)
1. Server-side events for register, KYC approved, order created, payment complete (closes 45 register and 40 paid user gaps in this window).
2. Rename or split `kyc_success` into submitted and approved.
3. Dedupe `register_success`.
4. Send `user_id` (or a hashed id) from the first screen so pre-login funnel steps can be tied to users.
5. Fill `campaign`/`source` consistently (campaign is empty for most registrations).

## 4. Analisis per tim

Format temuan mengikuti `00_rules.md`: Pain point, Evidence (Observed), Root cause (Inferred, keyakinan), Expected impact (aritmetika), Effort, Priority, KPI/validation. Interval kepercayaan Wilson 95%; sel <10 disembunyikan.

Pemetaan temuan ke Objective Product & Tech 2027 (draf):

| Objective P&T 2027 | Temuan |
|---|---|
| O2 Mudahkan mulai | V1, V2, T1, T2, T3, T4, O1, O2, O3, M6 |
| O2 Mudahkan lanjut berinvestasi | M1, M3, M6 |
| O3 Platform yang skala | T5, O2 (beban review, arah KYC otomatis), kualitas data §2.4 |
| Di luar objective P&T (Marketing/Finance), mendukung data O2 | M2, M4, M5 |
| O1 Lebih dari reksa dana | tidak ada data |

### 4.1 Temuan lintas tim

### V1 — Approved ke beli jatuh di Oktober, dan ini bukan soal waktu tunggu

**Pain point.** User approved Oktober membeli dalam 7 hari pada 7.5%, vs 29.2% untuk approval Juli-September. Ini penurunan terbesar yang ditemukan di seluruh Fase 3.

**Evidence (Observed).** Keputusan verified dengan submit GA di window, dipecah bulan approval dan jeda registrasi ke approval. Pembelian = order sukses dalam 7 hari setelah approval.

- Juli-September (jeda <=30 hari): 40/137 = 29.2% (95% CI 22.2-37.3%). Oktober: 31/416 = 7.5% (95% CI 5.3-10.4%). z=-6.6, p<0.0001.

| Minggu approval | Approved | Beli <=7 hari | Rate |
|---|---|---|---|
| 2026-08-03 | 18 | 5 | 27.8% ⚠n<30 |
| 2026-08-10 | 16 | 2 | 12.5% ⚠n<30 |
| 2026-08-17 | 4 | 0 | 0.0% ⚠n<30 |
| 2026-08-24 | 11 | 2 | 18.2% ⚠n<30 |
| 2026-08-31 | 23 | 9 | 39.1% ⚠n<30 |
| 2026-09-07 | 22 | 11 | 50.0% ⚠n<30 |
| 2026-09-14 | 8 | 2 | 25.0% ⚠n<30 |
| 2026-09-21 | 19 | 2 | 10.5% ⚠n<30 |
| 2026-09-28 | 22 | 6 | 27.3% ⚠n<30 |
| 2026-10-05 | 31 | 1 | 3.2% |
| 2026-10-12 | 97 | 5 | 5.2% |
| 2026-10-19 | 183 | 12 | 6.6% |
| 2026-10-26 | 105 | 13 | 12.4% |

- Jeda bukan penjelas: pada bucket approval hari yang sama (jeda <=1 hari), Juli-September 29.5% (28/95) vs Oktober 7.4% (28/377). Penurunan sama besar di dalam bucket tercepat, jadi bukan efek antrean (O1/O4).

- Waktu tunggu juga tidak menjelaskan: O4 menunjukkan tidak ada korelasi tunggu ke beli, dan penurunan tetap ada di bucket hari yang sama.

**Root cause (Inferred, keyakinan rendah).** Tiga penjelasan yang sejalan dengan temuan lain, semuanya belum diuji: (a) bauran akuisisi berubah ke kanal dengan niat rendah (lihat M1: sales code tumbuh, repeat mature 39,3%); (b) kolam approved menumpuk tanpa messaging lifecycle (M6) dan tanpa jalur kembali ke investasi (T3); (c) ada perubahan produk atau operasi pada minggu 2026-10-05. Data tidak bisa memilih di antara ketiganya.

**Expected impact (aritmetika).** Bila Oktober berjalan pada rate Juli-September: 416 x 29.2% = 121 pembeli, vs 31 aktual = 90 pembeli hilang di Oktober saja.

**Effort.** M (diagnosis: uji bauran kanal vs perubahan produk pada kohort Oktober).

**Priority.** P0.

**KPI / validation.** Approved ke beli 7 hari per bulan approval, dan per kanal akuisisi di dalam bulan itu. Uji ulang November dengan data lengkap.

### V2 — Kolam approved yang menumpuk adalah satu masalah dengan tiga wajah

**Pain point.** Marketing melihatnya sebagai tidak ada lifecycle (M6), engineering sebagai tidak ada jalur kembali (T3), operasi sebagai antrean yang tidak memicu apa pun (O1/O2). Semuanya merujuk ke 13,093 user approved-belum-beli.

**Evidence (Observed).** 13,093 user approved tanpa pembelian selesai; 476 approved dalam 30 hari terakhir; 257 dari kolam itu terlihat di GA dalam 39 hari, 43 membuka buy sheet, 8 membuat order.

**Root cause (Inferred, keyakinan sedang).** Approval adalah akhir dari proses, bukan awal dari proses berikutnya. Tidak ada trigger (CRM), tidak ada permukaan (produk), tidak ada antrean (operasi) yang membawa user approved ke investasi pertama. Ini kegagalan koordinasi, bukan kegagalan satu tim.

**Expected impact (aritmetika).** Titik acuan konservatif: 10% dari 257 user GA-visible terkonversi ke order pada rate order ke pembayaran 84.3% = 22 investor per 39 hari (206/tahun). Skenario penuh memakai 13,093 user; jangan dilaporkan sebelum diukur.

**Effort.** M (satu program: trigger approval ke CRM + permukaan di aplikasi + antrean operasi dengan due date).

**Priority.** P0.

**KPI / validation.** Approved ke investasi pertama 7/30 hari, satu dashboard lintas tim; target +10 pp dari basis Oktober.

### Ringkasan prioritas

| Prioritas | Temuan | Alasan |
|---|---|---|
| P0 | V1 / V2 / T3 (kolam approved), M2 (bonus ke non-pembayar), T1 (funnel KYC) | Dampak terbesar, angka bisa dihitung, sebagian besar bisa dikendalikan produk/kebijakan |
| P1 | M1 (retensi sales code), M4 (email tak terukur), M6 (lifecycle), O1/O2/O3 (SLA, key-person, penolakan), T2 (QRIS) | Dampak sedang, usaha kecil-menengah |
| P2 | M3 (promo), M5 (push), O4 (wait), T4 (gate), T5 (error) | Bukti lemah atau bersifat korelasi |

### Semua angka yang belum bisa diuji

- Lift bonus (M2), promo (M3), push (M5), messaging lifecycle (M6), dan permukaan pasca-approval (T3/V2) adalah estimasi aritmetika dari korelasi. Tidak ada eksperimen acak di data ini.

- T1 dan T4: n kecil di bucket tertentu; flag `n<30` ditandai di tabel.

- V1: penyebab belum diidentifikasi; tiga hipotesis terbuka, semuanya butuh data bauran kanal Oktober.


### Follow-up Fase 2 yang terjawab di sini

- Approved-belum-beli (Fase 2: 78,6%) diperdalam: 257 terlihat di GA, 43 buka buy sheet, 8 order (T3), dan penurunan Oktober diukur (V1).

- Pertanyaan Fase 2 'apa yang terjadi setelah KYC': alur berhenti tanpa trigger, tanpa permukaan, tanpa antrean (V2).

- Pertanyaan Fase 2 soal bauran booth: sales code berkontribusi pada bauran berintensi rendah tetapi bukan penjelas tunggal (M1).

### 4.2 Marketing

Kohort = Fase 1/2 (tanpa referrer RAIZ/RAIZKAYA, tanpa HNWI): 63,795 registrasi, 3,587 investor. Tarik data 2026-11-09.

| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |
|---|---|---|---|---|---|---|
| M1 | Sign-up sales code: konversi setara referral, retensi mature terburuk | 21,7% investor/reg vs 20,6% referral, 3,7% none; repeat mature 39,3% vs 60,0% | Tinggi (observasional) | Tinggi | M | P1 |
| M2 | Bonus kredit 6.130 user, 59,2% tidak pernah beli berbayar | Rp469.400.000 kredit ke 3.629 non-pembayar | Tinggi | Tinggi | S (policy) | P0 |
| M3 | Promo di beli-pertama berkorelasi repeat lebih rendah | 52,9% vs 61,7% | Sedang (confounded) | Sedang | S | P2 |
| M4 | Email lifecycle tidak terukur; batch kena throttle, 0 click | 93/743 gagal (454), semua dikirim ulang; 0 click event; open 497/497 dalam 2 jam | Tinggi | Sedang | S | P1 |
| M5 | Push menjangkau non-investor, konversi pasca-klik tak terukur | 252 approved-belum-beli klik; uji klik→beli hanya 103 user | Rendah | Sedang | M | P2 |
| M6 | Tiga kolam macet tanpa messaging lifecycle | 13.093 approved-belum-beli; 191 unverified <30 h; 92 investor diam 60-90 h | Tinggi | Tinggi | M | P1 |

### M1 — Sales code: konversi setara referral, retensi mature terburuk

**Pain point.** Sign-up dengan sales code (booth/agen) menghasilkan investor hampir 6x grup organik, tetapi repeat rate mature-nya terendah dan tiket pertamanya terkecil.

**Evidence (Observed).** Kohort penuh, registrasi s.d. 2026-11-09.

| Grup | Registrasi | Submit KYC | Approved | Investor | Investor/reg | Approved/submit | Investor/approved |
|---|---|---|---|---|---|---|---|
| sales_code | 1,068 | 835 (78.2%) | 753 (70.5%) | 232 | 21.7% | 90.2% | 30.8% |
| referrer_code | 6,109 | 3,472 (56.8%) | 3,206 (52.5%) | 1,259 | 20.6% | 92.3% | 39.3% |
| none | 56,618 | 18,466 (32.6%) | 12,700 (22.4%) | 2,096 | 3.7% | 68.8% | 16.5% |

- Sales code vs none, investor/reg: 21.7% (95% CI 19.4-24.3%) vs 3.7% (95% CI 3.5-3.9%); z=29.6, p<0.0001.

- Sales code vs none, approved/submit: 90.2% (95% CI 88.0-92.0%) vs 68.8% (95% CI 68.1-69.4%); z=13.2, p<0.0001.

| Grup | Investor | Repeat (2+ hari beli) | Mature (beli-1 ≥120 h) | Repeat mature | Churn mature >90 h | Median tiket-1 | Tiket-1 <Rp100k |
|---|---|---|---|---|---|---|---|
| sales_code | 232 | 34.1% | 191 | 39.3% | 90.1% | Rp125,950 | 8.2% |
| referrer_code | 1,259 | 63.8% | 1,197 | 65.8% | 86.9% | Rp500,000 | 10.0% |
| none | 2,096 | 59.6% | 2,055 | 60.0% | 86.9% | Rp200,000 | 22.3% |

- Repeat mature, sales code vs none: 39.3% (95% CI 32.6-46.3%) vs 60.0% (95% CI 57.9-62.1%); z=-5.6, p<0.0001. Vs referral: 65.8%.

- Churn dihitung pada investor mature saja; churn mentah seluruh investor menyesatkan karena kohort sales code lebih muda.

- Median tiket pertama Rp125,950 vs Rp500,000 (referral) dan Rp200,000 (none). Gap tiket adalah efek bauran akuisisi (minimum agen), bukan bukti penyebab churn.

**Root cause (Inferred, keyakinan sedang).** Investor sales code masuk dengan tiket kecil yang dibantu agen dan tetap bergantung pada agen, bukan dorongan diri sendiri, sehingga lebih jarang repeat. Belum diuji: follow-up agen setelah beli pertama; apakah kode dipakai untuk beli sekali saat promo.

**Expected impact (aritmetika).** 191 investor mature x gap repeat 20.8 pp = 40 investor repeat tambahan bila gap tertutup penuh. Menutup 30% lewat follow-up agen hari ke-7 dan ke-30 = 12 user. Asumsi: gap bisa diperbaiki, bukan seleksi.

**Effort.** M (alur kerja agen + task CRM, tanpa ubah produk).

**Priority.** P1.

**KPI / validation.** Repeat rate mature per grup akuisisi, bulanan. Uji before/after follow-up agen hari ke-7 dan ke-30 pada kohort sales code baru; target +5 pp dalam 90 hari.

### M2 — Bonus kredit adalah kebocoran belanja marketing terbesar

**Pain point.** 3,629 dari 6,130 penerima bonus organik tidak pernah membuat pembelian berbayar; Rp469,400,000 kredit habis ke non-pembayar.

**Evidence (Observed).** Seluruh data s.d. 2026-11-09. Bonus = transaksi beli dengan `payment_method` in ('manual_bonus','bonus'); berbayar = beli sukses di luar metode itu.

- Penerima bonus 6,130 (status valid 6,128); tidak pernah bayar 3,629 = 59.2% (95% CI 58.0-60.4%); nilai ke non-pembayar Rp469,400,000.

- Status pembayaran penerima: sudah pembayar sebelum kredit 2,094 (34.2% — bonus berfungsi sebagai reward); dapat kredit sebelum beli berbayar 407 (6.6% — ini satu-satunya kelompok yang bisa dibaca sebagai akuisisi); tidak pernah beli berbayar 3,629 (59.2%).

- Status transaksi bonus: completed 11,378; cancelled 166.

- User approved dengan bonus 6,130: investor 40.8%, repeat 25.8%. Tanpa bonus 10,529: investor 10.1%, repeat 5.2%. Grup bonus terseleksi post-hoc (2,094 dapat bonus setelah bayar); ini korelasi, bukan estimasi lift.

**Root cause (Inferred, keyakinan sedang).** Hanya 407 penerima (6.6%) menerima kredit sebelum pembelian berbayar, jadi program ini bukan mesin akuisisi; ia reward untuk pembayar yang sudah ada. Masalahnya 3,629 penerima (59.2%) tidak pernah menghasilkan pembayaran berbayar sama sekali, dan Rp469,400,000 kredit mereka tidak menciptakan pendapatan. Aturan program tidak ada di data; konfirmasi ke pemilik konfigurasi bonus.

**Expected impact (aritmetika).** Kredit rata-rata per non-pembayar Rp129,347. Mengonversi 10% dari 3,629 = 363 user; pada median tiket-1 grup none Rp200,000 = Rp72,580,000 tiket pertama. Alternatif: syaratkan kredit pada pembelian berbayar pertama, memangkas eksposur Rp469,400,000.

**Effort.** S (kebijakan/konfigurasi: siapa dapat kredit dan kapan).

**Priority.** P0 (nilai terbesar, usaha terkecil).

**KPI / validation.** Share penerima bonus yang beli berbayar dalam 30 hari; biaya bonus per user yang terkonversi. Uji kohort kredit-saat-beli-pertama vs kredit-saat-signup.

### M3 — Promo di pembelian pertama berkorelasi dengan repeat lebih rendah (confounded)

**Pain point.** Investor yang beli pertama memakai promo repeat 52.9% vs 61.7% tanpa promo.

**Evidence (Observed).** Beli pertama berpromo n=919: repeat 486 = 52.9% (95% CI 49.7-56.1%), churn90 86.0%. Tanpa promo n=2,668: repeat 61.7%, churn90 82.8%. z=-4.7, p<0.0001.

- Kontradiksi: menghitung promo di pembelian mana pun membalik tanda. Pemakai promo 72.6% repeat (n=1,601) vs 48.8% (n=1,986). Pemakaian promo adalah akibat dari sering beli, jadi potongan ini tidak boleh dibaca sebagai lift.

**Root cause (Inferred, keyakinan rendah).** Promo kemungkinan menarik pembeli sekali-jalan yang sensitif harga, tetapi promo beli-pertama juga ditargetkan ke kelompok ini. Seleksi tidak bisa dipisahkan tanpa eksposur acak.

**Expected impact.** Tidak dikuantifikasi. Gap 8.8 pp x 919 investor promo = 81 investor repeat hanya batas atas bila gap sepenuhnya kausal; data tidak bisa menunjukkan itu.

**Effort.** S (analisis: holdout acak).

**Priority.** P2.

**KPI / validation.** Repeat 90 hari untuk user baru eligible promo, acak promo vs tanpa promo (holdout 10%).

### M4 — Email lifecycle: throttle, tanpa click tracking, lift tak terukur

**Pain point.** Satu-satunya batch email di log (`fund_performance`/`batch`) punya 93 kiriman gagal karena throttle, 0 click event, dan 650 kiriman tanpa `user_id`, sehingga konversi pasca-klik tidak bisa diukur.

**Evidence (Observed).** Supabase `dashboard_email_log`/`dashboard_email_events`, tarik 2026-11-09. Batch per hari: 2026-10-13 = 150, 2026-10-26 = 497, 2026-11-03 = 3.

- Gagal 93 (semua 2026-10-26), error `454 Throttling failure: Maximum sending rate exceeded.`. Semua 93 penerima gagal terkirim kemudian, tidak ada kehilangan permanen.

- Cakupan tracking: 500/650 log terkirim punya event; batch 2026-10-13 (150 kiriman) nol event.

- Open: 497/500 log berevent punya Open (99.4%), 993 open event. Semua open datang dalam dua jam setelah kirim (2026-10-26 07:00Z: 478, 2026-10-26 08:00Z: 201), tanda prefetch/security scanning aplikasi mail, bukan dibaca. Jangan laporkan sebagai engagement.

- Click event: 0 (tipe yang ada hanya Open/Delivery/Send). Konversi pasca-klik: **tidak tersedia**.

- Kategori lain di log: fund_performance/batch sent 650; fund_performance/batch failed 93; statement/schedule sent 93; statement/manual sent 13; fund_performance/manual sent 12; fund_performance/schedule sent 10; schedule_otp/system sent 3; password_reset/system sent 1. Tidak ada kategori onboarding, KYC-macet, belum-investasi, atau reaktivasi.

- Suppression 0 baris; scheduled jobs 9; queue 753.

**Root cause (Inferred, keyakinan tinggi untuk mekaniknya).** Batch dikirim serentak melewati rate limit provider (454) dan event hanya tercatat untuk batch berikutnya, jadi pipeline pelaporan mulai dari kiriman 2026-10-26. Apakah ada email lifecycle di luar dashboard ini belum diketahui.

**Expected impact.** Tidak bisa dikuantifikasi tanpa `user_id` per kiriman dan click/open yang terhubung ke hasil investasi. Perbaikan throughput hanya melindungi pengiriman: 93 dari 743 batch (12.5%) butuh retry.

**Effort.** S (tambah `user_id` + click event; sebar pengiriman batch).

**Priority.** P1.

**KPI / validation.** % kiriman batch dengan `user_id`; click rate per kategori/segmen; lalu uji holdout pada batch reaktivasi.

### M5 — Push menjangkau non-investor, klik ke beli tak terukur

**Pain point.** Push menjangkau approved-belum-beli dan user yang belum approved, tetapi uji klik ke beli hanya 103 user tanpa grup kontrol; tidak ada klaim lift.

**Evidence (Observed).** GA4, 2026-10-01..2026-11-08 (39 hari).

| Segmen | User dengan notifikasi | User Android terima | Receive | Klik/buka | Klik/receiver (Android) |
|---|---|---|---|---|---|
| investor | 897 | 680 | 37,450 | 1,744 | 27.2% |
| approved, belum beli | 567 | 396 | 12,149 | 1,076 | 27.8% |
| belum approved | 212 | 196 | 5,360 | 38 | 10.2% |

- Receive 54,959 vs dismiss 30,924 event (56.3% dismiss per event). iOS tidak mencatat receive/dismiss, jadi pengiriman iOS tak terukur.

- Pemegang klik: 659 user klik; 373 sudah investor, 252 approved-belum-beli, 34 belum approved.

- Uji klik ke beli (Android, approved sebelum 2026-10-01, belum beli): klik 24 user menghasilkan 2 beli; tidak klik 79 menghasilkan 1. **Sel klik n<30; tidak diuji.**

**Root cause (Inferred, keyakinan rendah).** Konten push generik (tidak ada id kampanye/segmen di GA), jadi tidak ada yang menghubungkan pesan ke perilaku.

**Expected impact.** Tidak dikuantifikasi. Satu-satunya klaim sah: 567 user approved-belum-beli menerima notifikasi dalam 39 hari.

**Effort.** M (id kampanye + param segmen di event notifikasi; siapkan holdout).

**Priority.** P2.

**KPI / validation.** Beli pertama dalam 7 hari pasca-klik vs holdout tanpa push 10%, per id kampanye.

### M6 — Tiga kolam macet tanpa messaging lifecycle

**Pain point.** Email dan push hanya mencakup statement, fund performance, OTP, dan notifikasi sekali-jalan. Kolam macet terbesar tidak punya pesan berulang yang tertarget di log.

**Evidence (Observed).** `stuck_sizes` + kategori email, 2026-11-09.

| Kolam | Ukuran | Yang ada sekarang |
|---|---|---|
| Approved, belum beli | 13,093 (approved 30 hari terakhir: 476) | tidak ada kategori email investasi-pertama; push ada (M5) |
| Registrasi, belum verifikasi (30 hari) | 191 | tidak ada kategori pengingat KYC; push ada |
| KYC gagal (all time) | 6,114 (daftar 30 hari: 66) | tidak ada kategori email penolakan; alasan tidak disimpan (O3) |
| Investor diam 60-90 hari | 92 (dari 587 belum churn) | tidak ada kategori reaktivasi |

**Root cause (Inferred, keyakinan sedang).** Messaging dipicu produk/event (statement, performa, OTP), bukan status lifecycle.

**Expected impact (aritmetika).** Approval terbaru (n=476) beli dalam 7 hari 7.5% sekarang vs 29.2% Jul-Sep (V1). Nudge investasi-pertama yang menutup 10% gap: 476 x 0.022 = 10 investor per 30 hari. Asumsi: 10% gap bisa dipulihkan lewat messaging; belum diuji.

**Effort.** M (tiga urutan berbasis trigger + holdout).

**Priority.** P1.

**KPI / validation.** Beli-pertama 7 hari, nudged vs holdout, per kolam; re-KYC rate kolam gagal.


### Data requests (Marketing)

- Tidak ada id kampanye di push/email; sumber registrasi GA kosong hampir sepanjang window (Fase 2). Tambahkan `campaign_id` ke event `notification_*` dan `dashboard_email_log`.

- Baris batch `dashboard_email_log` punya `user_id` NULL (650/650); tanpa itu tidak ada join email ke investasi.

- Tidak ada tipe event klik di `dashboard_email_events`.

- Aturan program bonus (siapa, kapan, berapa) tidak ada di BigQuery; dibutuhkan untuk mengukur M2 dengan benar.

### 4.3 Operations & KYC

Basis: baris keputusan di `main.user_status_logs` dengan `origin_status='pending_verification'` (status verified/failed), di-join ke kohort Fase 1/2. `user_status_logs` baru ada sejak 2026-07-21 dan GA tidak membawa `user_id` pra-login, jadi waktu submit diambil dari event GA `kyc_success` (event ini menyala saat submit, lihat rekonsiliasi Fase 2).

| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |
|---|---|---|---|---|---|---|
| O1 | Ekor keputusan: P90 15,7 jam; submit di luar jam kerja dan akhir pekan menunggu paling lama | 548 keputusan verified, 21 >24 jam; P90 akhir pekan 17,2 jam vs 11,9 jam hari kerja | Tinggi | Sedang | S | P1 |
| O2 | Review terkonsentrasi di satu akun dan berbentuk batch | 1 aktor = 75,9% dari 922 keputusan; 3 aktor = 97%; 34,5% keputusan di jam 10 | Tinggi | Tinggi | M | P1 |
| O3 | User ditolak jarang mengajukan ulang; alasan penolakan tidak disimpan | Oktober: 6/70 mengajukan ulang; 27/40 yang akhirnya verified mengajukan ulang | Sedang | Sedang | M | P1 |
| O4 | Keputusan lebih cepat tidak berkorelasi dengan pembelian lebih tinggi | <2 jam 5,9% vs 2-24 jam 11,3% beli dalam 14 hari, semua sel kecil | Rendah | Rendah | S | P2 |

### O1 — Masalah SLA ada di ekor, bukan median

**Pain point.** Median submit ke keputusan 10 menit, tetapi P90 15,7 jam dan 21 keputusan verified butuh lebih dari 24 jam.

**Evidence (Observed).** Submit GA 2026-10-01..2026-11-08, keputusan >= submit.

| Status | n | P50 | P90 | >24 jam | >72 jam |
|---|---|---|---|---|---|
| verified | 548 | 0.17 jam | 15.70 jam | 21 | 3 |
| failed | 102 | 0.17 jam | 15.73 jam | 2 | 0 |

- Submit akhir pekan: n=152, >4 jam 68 = 44.7% (95% CI 37.1-52.7%), >24 jam 9. Hari kerja: n=461, >4 jam 60 = 13.0% (95% CI 10.2-16.4%), >24 jam 6. z=8.3, p<0.0001.

- P90 submit ke keputusan: akhir pekan 17.2 jam (n=152) vs hari kerja 11.9 jam (n=461).

- Submit di luar 09:00-20:00 WIB: n=92, >4 jam 52 (56.5%), >12 jam 30 (32.6%). Di dalam jam kerja: n=521, >4 jam 76 (14.6%), >12 jam 76 (14.6%). z=9.1, p<0.0001.

- Petunjuk penting: setiap kasus jam kerja yang lewat 4 jam juga lewat 12 jam (76/76). Artinya diantrekan ke hari kerja berikutnya, bukan dikerjakan lambat.

- Jam keputusan (semua keputusan, n=922): puncak jam 10:00 WIB = 318 (34.5%); 21:00-08:59 hanya 23 (2.5%). Keputusan Sabtu 66 + Minggu 77 = 143 (15.5%).

**Root cause (Inferred, keyakinan tinggi).** Keputusan dieksekusi sebagai batch pagi (jam 10) oleh satu operator; submit setelah batch menunggu pagi hari kerja berikutnya. Ekor malam dan akhir pekan adalah waktu antre, bukan waktu proses.

**Expected impact (aritmetika).** 23 keputusan >24 jam dalam 39 hari = 18/bulan di ekor. Bila satu slot review malam/akhir pekan memindahkan 10 dari 21 kasus verified ke dalam 24 jam, dan mereka membeli dalam 14 hari pada laju populasi approved (7,7% Okt / 27,0% Jan-Sep, Fase 2), investor yang pulih = 10 x 0,077 = 0.8 sampai 10 x 0,27 = 2.7. Kecil: nilai utamanya kredibilitas SLA dan kecepatan siklus penolakan, bukan volume investor.

**Effort.** S (ubah roster/antrean, tanpa kode).

**Priority.** P1 (murah dan terlihat, dampak investor kecil; peringkat di bawah O2).

**KPI / validation.** P90 submit ke keputusan dan jumlah >24 jam, mingguan; before/after slot tambahan.

### O2 — Satu reviewer dan satu jam batch memikul hampir semua keputusan

**Pain point.** 75,9% keputusan berasal dari satu aktor; tiga aktor menutup 97%. Keputusan menumpuk di jam 10. Ini risiko key-person pada langkah yang diregulasi.

**Evidence (Observed).** `user_status_logs.auth_user_id` atas keputusan kohort, seluruh data sejak 2026-07-21.

| Peringkat aktor | Keputusan | Share |
|---|---|---|
| 1 | 700 | 75.9% |
| 2 | 102 | 11.1% |
| 3 | 92 | 10.0% |
| 4 | 13 | 1.4% |
| 5 | 6 | 0.7% |
| 6 | 5 | 0.5% |
| 7 | 4 | 0.4% |

- Aktor per status: verified 7 aktor (740 keputusan), failed 6 aktor (182 keputusan); keputusan tanpa aktor 0.

- Keputusan per bulan: 2026-07 verified 16 / failed 8; 2026-08 verified 55 / failed 16; 2026-09 verified 74 / failed 19; 2026-10 verified 432 / failed 91; 2026-11 verified 163 / failed 48.

**Root cause (Inferred, keyakinan sedang).** Satu akun operasi mengerjakan mayoritas (kemungkinan otomatis, atau login bersama yang dipakai satu anggota tim), dengan akun kedua dan ketiga menutup sisanya. Data tidak bisa membedakan approval otomatis dari manusia yang login di akun bersama.

**Expected impact.** Tidak bisa dikuantifikasi langsung; risikonya antrean berhenti. Eksposur konkret: jam batch 10:00 saja memuat 318 keputusan (34.5%). Bila akun itu tidak tersedia satu hari kerja, semua submit non-batch menunggu minimal 24 jam; ekor yang sudah teramati menunjukkan biayanya.

**Effort.** M (reviewer kedua / delegasi terdokumentasi + alert umur antrean).

**Priority.** P1 (risiko operasional tinggi, usaha sedang).

**KPI / validation.** Share keputusan per aktor (target: tidak ada aktor >50%); alert umur antrean 12 jam.

### O3 — Penolakan hampir final, dan alasannya tidak dicatat

**Pain point.** Dari user yang ditolak Oktober, 6 dari 70 mengajukan ulang; yang tidak mengajukan ulang hilang tanpa alasan tercatat.

**Evidence (Observed).** Kegagalan Oktober + potongan seluruh window, event GA 2026-10-01..2026-11-08.

| Potongan | User gagal | Ajukan ulang | Rate | Akhirnya verified |
|---|---|---|---|---|
| Oktober, masih failed | 70 | 6 | 8.6% (95% CI 4.0-17.5%) | - |
| Oktober, akhirnya verified | 40 | 27 | 67.5% (95% CI 52.0-79.9%) | 40 |
| Window, masih failed | 86 | 7 | 8.1% | - |
| Window, akhirnya verified | 51 | 37 | 72.5% | 51 |

- Pengajuan ulang memisahkan hasil dengan tajam: Oktober, yang akhirnya verified mengajukan ulang 67.5% (27/40), yang masih failed 8.6% (6/70). Korelasional: pengaju ulang adalah kelompok yang lebih gigih, terseleksi sendiri.

- Keputusan Oktober: 432 verified, 91 failed = 17.4% baris keputusan gagal. Share rejected Fase 2 (level user, 13 bulan) 26,8%; baris keputusan berbeda dari user.

- Alasan penolakan: **tidak tersedia**. Tidak ada kolom reason/note di `user_status_logs` maupun `user_problems`. GA punya layar penolakan (`BankRejectedScreen`, `OccupationRejectedScreen`) tetapi tanpa param alasan.

**Root cause (Inferred, keyakinan sedang).** Tidak ada nudge pasca-penolakan: tidak ada email atau push untuk user KYC gagal (lihat M6), jadi 91,4% yang tidak mengajukan ulang tidak pernah dihubungi. Alasan tidak dicatat memblokir perbaikan tertarget.

**Expected impact (aritmetika).** Memindahkan 10% dari 70 user masih-failed Oktober ke pengajuan ulang = 7 user; pada rate ajukan-ulang ke verified 67.5% = 4.7 verified; pada rate approved ke investor 73.2% (Fase 2) = 3.5 investor/bulan. Kecil tetapi murah.

**Effort.** M (simpan alasan + email/push pengajuan ulang berbasis trigger).

**Priority.** P1.

**KPI / validation.** Rate pengajuan ulang dalam 14 hari pasca-penolakan (target 10% dari 8,6%); konversi rejected ke approved.

### O4 — Waktu tunggu tidak berkorelasi dengan pembelian

**Pain point.** Asumsi umum bahwa approval KYC lebih cepat menaikkan investasi tidak didukung data ini; estimasi titik malah berlawanan arah.

**Evidence (Observed).** Keputusan approved s.d. 2026-10-25 dengan waktu submit GA di window, n=291.

| Tunggu submit ke approved | n | Beli dalam 14 hari |
|---|---|---|
| a<2h | 221 | 13 (5.9%) |
| b2-24h | 53 | 6 (11.3%) |
| c>=24h | 17 | 3 (17.6%) ⚠n<30 |

- <2 jam vs >=2 jam: 5.9% vs 12.9% (z=-1.92, p=0.054, tidak signifikan). Hanya bucket >=24 jam yang n<30.

- Seleksi: keputusan cepat berasal dari submit di batch pagi, yang mungkin user dengan dokumen lengkap pada jam kerja. n terlalu kecil untuk mengontrolnya.

**Root cause (Inferred, keyakinan rendah).** Tidak ada efek kausal yang terdeteksi; penurunan approved ke beli Oktober vs Jan-Sep (Fase 2: 7,7% vs 27,0%) tidak dijelaskan waktu tunggu, lihat V1: penurunan tetap ada di bucket approval hari yang sama.

**Expected impact.** Tidak ada klaim. Jangan jadikan kenaikan investor sebagai alasan program SLA; pakai untuk kepatuhan dan pengalaman.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Ulangi dengan window lebih besar (n>100 per bucket) sebelum ada klaim.


### Data requests (Ops & KYC)

- Alasan penolakan / catatan reviewer per keputusan gagal (dibutuhkan O3).

- Timestamp submit KYC di DB (join GA kehilangan user tanpa `user_id`; `user_status_logs` mulai 2026-07-21).

- Pembedaan keputusan otomatis vs manual (`auth_user_id` bisa akun bersama atau bot).

### 4.4 Product & Engineering

| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |
|---|---|---|---|---|---|---|
| T1 | KYC putus di dalam aplikasi: identity ke selfie −11,3%, Android 8,5 pp di bawah iOS | 745 identity ke 661 selfie; submit Android 79,6% vs iOS 88,1% | Tinggi | Tinggi | M | P0 |
| T2 | QRIS gagal dua kali lebih sering dari metode lain | 170/765 (22,2%) vs 11,0-11,1% VA/bank | Tinggi | Sedang | S | P1 |
| T3 | User approved yang belum beli tidak pernah kembali ke alur beli | dari 257 yang terlihat pasca-approval, 43 buka buy sheet, 8 buat order | Tinggi | Tinggi | M | P0 |
| T4 | Gate risk profile ditinggalkan 28,9%, tanpa kerugian hilir yang signifikan | 28/97 abandon; 46,4% abandoner tetap order vs 59,4% | Sedang | Rendah | S | P2 |
| T5 | Error klien tercatat di GA, tanpa crash/ANR dan tanpa alert | 45 `continue_with_google_failed`, 10 `app_exception`, tanpa monitoring | Tinggi | Rendah | S | P2 |

### T1 — Alur KYC kehilangan user di dalam aplikasi, terburuk di Android pada langkah selfie

**Pain point.** KYC dimulai 746 kali, hanya 617 user sampai submit (82.7%). Setelah submit, alur investasi kehilangan 47% lagi sebelum order. Di dalam KYC, penurunan terbesar yang bisa dilokalisasi ke satu layar adalah identity verification ke selfie camera, dan Android 8,5 pp lebih buruk dari iOS.

**Evidence (Observed).** GA4 user per event, 2026-10-01..2026-11-08.

| Langkah | User | Perubahan |
|---|---|---|
| `kyc_start` | 746 | - |
| `kyc_success` (submit) | 617 | -129 (-17.3%) |

Funnel investasi di window yang sama (populasi user, bukan kohort): `buy_bottom_sheet` 343 ke `order_button` 290 (-15.5%) ke `order_created` 287 (-1.0%) ke `payment_complete` 242 (84.3% dari order).

| Platform | KYC dimulai | Submit | Submit rate |
|---|---|---|---|
| ANDROID | 485 | 386 | 79.6% (95% CI 75.8-82.9%) |
| IOS | 261 | 230 | 88.1% (95% CI 83.6-91.5%) |

- Android vs iOS: 79.6% vs 88.1% (z=-2.93, p<0.0001). Selisih absolut: 99 user Android tidak selesai vs 31 iOS.

- Abandonment per layar (user yang melihat): `IntroScreen` 816 ke `IdentityVerificationScreen` 745 (-71, -8.7%); `IdentityVerificationScreen` ke `SelfieCameraScreen` 661 (-84, -11.3%). Setelah selfie semua layar tetap di atas 617, jadi kehilangan terkonsentrasi sebelum selfie diambil.

- `IdentityCameraScreen` hanya 440 user, padahal layar sebelumnya 745. Kemungkinan besar event hanya menyala untuk sebagian user (bukan semua yang membuka kamera), atau ada drop nyata di capture dokumen. Tidak bisa dibedakan dari data ini.

- Versi 2.28.2 memuat 577 dari 619 submit KYC (93.2%). Versi 2.29.0: 76.9% start ke submit (n=26) vs 82.9% pada 2.28.2. Arahnya lebih buruk di build terbaru tetapi n<30, tidak signifikan.

**Root cause (Inferred, keyakinan sedang).** Dua hipotesis, keduanya belum diuji: (a) izin/capture kamera selfie gagal atau membingungkan di perangkat Android; (b) capture dokumen identitas adalah penghalang sebenarnya dan user keluar sebelum selfie. `kyc_screen_view` tidak memisahkan 'melihat lalu keluar' dari 'capture lalu gagal'; butuh data level perangkat.

**Expected impact (aritmetika).** Menutup separuh gap Android-iOS: 485 start x gap 8.5 pp / 2 = 21 submit tambahan per 39 hari. Pada share approved/submit 73.2% dan approved ke investor 21.5%: 3.3 investor per 39 hari = 31/tahun. Asumsi: gap berasal dari friksi produk, bukan bauran perangkat/demografi.

**Effort.** M (instrumentasi tiap layar KYC dengan event hasil: izin diberikan, capture dicoba, capture gagal, back ditekan).

**Priority.** P0 (kebocoran funnel terbesar yang bisa dikendalikan produk).

**KPI / validation.** KYC start ke submit per platform dan per layar; target Android dalam 3 pp dari iOS.

### T2 — Pembayaran: QRIS gagal dua kali lebih sering dari VA atau transfer bank

**Pain point.** QRIS memegang 10.8% order dan gagal 22.2%, vs 11.1% virtual account dan 11.0% transfer bank. Instant payment hanya 1.9%.

**Evidence (Observed).** `main.transactions`, order pada kohort, seluruh data s.d. 2026-11-09.

| Metode | Order | Gagal/expired | Fail rate |
|---|---|---|---|
| virtual_account | 3,782 | 420 | 11.1% (95% CI 10.1-12.1%) |
| bank_transfer | 2,279 | 250 | 11.0% (95% CI 9.8-12.3%) |
| QRIS | 765 | 170 | 22.2% (95% CI 19.4-25.3%) |
| INSTANT_PAYMENT | 264 | 5 | 1.9% (95% CI 0.8-4.4%) |

- QRIS vs VA: z=8.3, p<0.0001.

- Percobaan order: 1,016 user membuat order; 36 (3.5%) punya order gagal dan tidak pernah menyelesaikan satu pun. Itu inti yang bisa dipulihkan; 304 user pernah gagal tetapi 268 di antaranya berhasil dengan cara lain.

**Root cause (Inferred, keyakinan rendah).** Kegagalan QRIS kemungkinan besar expiry/timeout (user scan lalu pergi), bukan reject teknis; data hanya berisi status, tanpa kode error provider. Verifikasi kode error gateway sebelum mengubah apa pun.

**Expected impact (aritmetika).** Menurunkan QRIS ke fail rate VA menyelamatkan (22.2% − 11.1%) x 765 order QRIS = 85 order yang sekarang mati (batas atas, karena sebagian user mengulang dengan metode lain).

**Effort.** S (tampilkan kode error provider; tambah pengingat expiry di layar pembayaran).

**Priority.** P1.

**KPI / validation.** Fail rate per metode dan per kode error provider, mingguan; target QRIS <15%.

### T3 — User approved yang belum beli tidak kembali ke alur beli

**Pain point.** Dari 13,093 user approved-belum-beli, hanya 257 yang terlihat di GA (window 39 hari, cakupan `user_id` parsial), dan dari jumlah itu 43 membuka buy sheet; 8 sampai membuat order.

**Evidence (Observed).** GA4, user dengan keputusan verified dan tanpa pembelian selesai, 2026-10-01..2026-11-08.

- Approved-belum-beli terlihat di GA: 257; buka `buy_bottom_sheet` 43 (16.7% (95% CI 12.7-21.8%)); buat order 8 (3.1%).

- Bandingkan dengan user yang submit KYC di window yang sama: 617 submit vs 287 user membuat order (46.5%). Dua populasi berbeda (bukan funnel), tetapi skalanya menunjukkan alur beli bekerja untuk user yang baru submit, dan tidak bekerja untuk kolam pasca-approval.

- Funnel investasi keseluruhan: `kyc_success` 617 ke `buy_bottom_sheet` 343 (55.6%) ke `order_created` 287 (83.7%) ke `payment_complete` 242 (84.3%). Order ke pembayaran selesai 84.3%.

- Gate risk profile 28 user di kohort ini, 8 ditinggalkan (28.6%).

**Root cause (Inferred, keyakinan sedang).** Aplikasi tidak punya jalur kembali ke investasi setelah approval: approval berakhir sebagai notifikasi, dan entry point beli tidak ditonjolkan saat user kembali. Ini sejalan dengan M6 (tanpa messaging lifecycle) dan V1 (penurunan pasca-Oktober): tiga sudut pandang atas gap yang sama.

**Expected impact (aritmetika).** Bila buy sheet ditampilkan ke user approved saat membuka aplikasi, dan 10% dari 257 user GA-visible itu terkonversi pada rate order ke pembayaran 84.3%: 22 investor per 39 hari. Skala ke seluruh 13,093 user (asumsi perilaku setara, belum diuji) jauh lebih besar; jangan pakai angka itu sebelum diukur.

**Effort.** M (state pendaratan pasca-approval + entry point buy sheet).

**Priority.** P0.

**KPI / validation.** % user approved yang membuka buy sheet dalam 7/30 hari; rate order ke pembayaran kohort pasca-approval.

### T4 — Gate risk profile: tidak ada kerugian hilir yang terukur

**Pain point.** 28 dari 97 user yang memicu gate risk profile meninggalkannya, tetapi abandoner tetap berkonversi pada rate yang tidak berbeda signifikan.

**Evidence (Observed).** GA `risk_profile_gate_triggered`/`abandoned`, 2026-10-01..2026-11-08.

- Trigger 97, abandon 28 (28.9%). Order setelahnya: abandoner 13/28 (46.4%), non-abandoner 41/69 (59.4%). z=-1.17, p=0.243.

**Root cause (Inferred, keyakinan rendah).** Abandonment nyata tetapi sementara; gate ditampilkan ulang belakangan. Dengan n<100 di kedua sisi, ini bisa jadi kurang bertenaga, bukan benar-benar tidak berbahaya.

**Expected impact.** Tidak ada klaim; hanya 75 user per 30 hari. Instrumentasi dulu, jangan desain ulang.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Gate abandonment rate dan rate order 7 hari, bulanan, dengan n>=100.

### T5 — Error klien tercatat, tanpa crash/ANR dan tanpa alert

**Pain point.** `continue_with_google_failed` 45 event di 9+ perangkat, `app_exception` 10 event, tanpa alert atau SLA. Tidak ada data crash/ANR sama sekali.

**Evidence (Observed).** GA4, 2026-10-01..2026-11-08.

| Event | Event | Perangkat | Android | iOS |
|---|---|---|---|---|
| `continue_with_google_failed` | 45 | 9+ | 38 | 7 |
| `app_exception` | 10 | 5+ | 9 | 1 |

- Volume kecil, tetapi berada di jalur registrasi (`continue_with_google_failed`) dan tanpa jejak tumpukan. Fase 2 sudah menunjukkan event registrasi tidak andal, jadi ini indikatif, bukan sensus.

**Root cause (Inferred, keyakinan rendah).** Tidak ada data crash/ANR di GA (Crashlytics tidak diekspor), dan `app_exception` adalah event serba-guna tanpa stack trace di export. Severity tidak bisa diperingkat.

**Expected impact.** Tidak bisa dikuantifikasi tanpa stack trace. Alasan memperbaiki adalah proses: error di jalur signup dan pembayaran harus memicu alert, bukan menumpuk.

**Effort.** S (alert pada rate `continue_with_google_failed` dan `app_exception`; ekspor Crashlytics).

**Priority.** P2.

**KPI / validation.** Rate event error per 1.000 sesi, mingguan, dengan ambang alert.


### Data requests (Product & Engineering)

- Event hasil per layar KYC (capture dicoba/gagal, izin ditolak, back ditekan): memblokir T1.

- Kode error provider pada transaksi gagal: memblokir sizing T2.

- Ekspor Crashlytics/ANR: memblokir severity T5.

- `user_id` pada event GA pra-login, dan id kampanye pada event notifikasi.

## 5. Roadmap lintas tim (now / next / later)

Selaras dengan roadmap P&T 2027 (draf): gateway VA (Q1) menampung T2; redesain website (Q2) dan app (Q3) menampung T1, T3, T4. Lihat `raker_preparation.md` bagian 0.5.

**Now (0-30 hari) — tanpa kode baru, atau kode kecil.**

| Aksi | Pemilik | Dependensi | Ukuran keberhasilan |
|---|---|---|---|
| Ubah kebijakan bonus: kredit hanya setelah pembelian berbayar pertama (M2) | Marketing + Finance | keputusan pemilik program | eksposur kredit ke non-pembayar |
| Trigger CRM pasca-approval + pesan investasi pertama (M6, V2) | Marketing + Ops | daftar approved harian | beli pertama 7 hari vs holdout |
| Slot review malam/akhir pekan + alert umur antrean 12 jam (O1, O2) | Ops | roster reviewer | P90 dan jumlah >24 jam |
| Simpan alasan penolakan KYC + email pengajuan ulang (O3) | Ops + Tech | kolom reason | rate pengajuan ulang 14 hari |
| `user_id` pada log email batch + click event (M4) | Tech | skema Supabase | % kiriman ter-join |

**Next (30-90 hari) — perubahan produk.**

| Aksi | Pemilik | Dependensi | Ukuran keberhasilan |
|---|---|---|---|
| Permukaan pasca-approval: buy sheet saat user approved membuka aplikasi (T3, V2) | Tech + Product | desain + state | % approved buka buy sheet 7/30 hari |
| Instrumentasi hasil per layar KYC (T1) | Tech | event baru | KYC start→submit Android vs iOS |
| Follow-up agen hari ke-7 dan ke-30 untuk kohort sales code (M1) | Marketing | CRM task | repeat mature +5 pp dalam 90 hari |
| Tampilkan kode error provider pembayaran + pengingat expiry QRIS (T2) | Tech | gateway | fail rate QRIS <15% |
| Holdout 10% untuk promo beli pertama (M3) | Marketing | eksperimen | repeat 90 hari promo vs kontrol |

**Later (90-180 hari) — data dan skala.**

| Aksi | Pemilik | Dependensi | Ukuran keberhasilan |
|---|---|---|---|
| Ekspor Crashlytics/ANR + alert error jalur signup/pembayaran (T5) | Tech | SDK | rate error per 1.000 sesi |
| `campaign_id` pada push/email + holdout push (M5) | Marketing + Tech | skema event | beli pertama 7 hari pasca-klik vs holdout |
| Diagnosis penurunan Oktober: bauran kanal vs perubahan produk (V1) | semua tim | data bauran kanal | penyebab teridentifikasi |
| Server-side event untuk register/approve/order/pay (rekonsiliasi Fase 2) | Tech | pipeline | selisih GA vs DB <2% |

Dependensi lintas tim: tidak ada satu pun P0 yang bisa selesai di dalam satu tim. Kolam approved butuh Marketing (trigger), Tech (permukaan), dan Ops (antrean dengan due date) sekaligus; itulah alasan V2 ditulis sebagai satu program, bukan tiga tiket.

## 6. Lampiran

### 6.1 Data dictionary, definisi, kualitas

Lihat `outputs/data_dictionary.md`, `outputs/definitions.md`, `outputs/data_quality.md`.

### 6.2 Skrip dan kueri

Fase 1: `01`-`06`, `10`-`16`, `20`-`22`, `30`, `31`. Fase 2: `40`-`42`, `44`-`52`. Fase 3: `60`-`62`, `70`-`73`, `75`-`86`. Pembangun dokumen: `build_phase2.py`, `build_phase3.py`, `build_phase4.py`. Runner: `bq.js` (kueri tunggal, JSON), `q.py` (blok `-- Q:`), `run_many.py`. Semua kueri SELECT-only dengan `maximumBytesBilled` 5e9.

### 6.3 Provenance

Lihat `outputs/data_provenance_log.md` (setiap angka utama dengan sumber, window, dan skrip).

### 6.4 Data requests (gabungan)

- Alasan penolakan KYC per keputusan, dan timestamp submit KYC di DB.
- Pembedaan keputusan otomatis vs manual pada `user_status_logs.auth_user_id`.
- `user_id` pada event GA pra-login; `campaign_id` pada event notifikasi dan log email; tipe event klik pada email.
- Kode error provider pada transaksi gagal.
- Ekspor Crashlytics/ANR.
- Aturan program bonus (siapa, kapan, berapa).
- Bauran kanal akuisisi per bulan (untuk menjelaskan V1).

### 6.5 Skill dan alat

Skill `gcp-bigquery` (aturan proyek dan definisi). `@google-cloud/bigquery` via `scripts/bq.js`. Supabase MCP read-only (project `josptpfisrsdjeggkqke`). Tidak ada dependensi baru yang dipasang.
