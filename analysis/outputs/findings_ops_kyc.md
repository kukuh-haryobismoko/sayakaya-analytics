# Temuan — Operations & KYC

Dibangun 2026-11-09 20:13 WIB dari `outputs/raw/` (BigQuery `main.user_status_logs`, GA4). Read-only.

Basis: baris keputusan di `main.user_status_logs` dengan `origin_status='pending_verification'` (status verified/failed), di-join ke kohort Fase 1/2. `user_status_logs` baru ada sejak 2026-07-21 dan GA tidak membawa `user_id` pra-login, jadi waktu submit diambil dari event GA `kyc_success` (event ini menyala saat submit, lihat rekonsiliasi Fase 2).

| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |
|---|---|---|---|---|---|---|
| O1 | Ekor keputusan: P90 15,7 jam; submit di luar jam kerja dan akhir pekan menunggu paling lama | 548 keputusan verified, 21 >24 jam; P90 akhir pekan 17,2 jam vs 11,9 jam hari kerja | Tinggi | Sedang | S | P1 |
| O2 | Review terkonsentrasi di satu akun dan berbentuk batch | 1 aktor = 75,9% dari 922 keputusan; 3 aktor = 97%; 34,5% keputusan di jam 10 | Tinggi | Tinggi | M | P1 |
| O3 | User ditolak jarang mengajukan ulang; alasan penolakan tidak disimpan | Oktober: 6/70 mengajukan ulang; 27/40 yang akhirnya verified mengajukan ulang | Sedang | Sedang | M | P1 |
| O4 | Keputusan lebih cepat tidak berkorelasi dengan pembelian lebih tinggi | <2 jam 5,9% vs 2-24 jam 11,3% beli dalam 14 hari, semua sel kecil | Rendah | Rendah | S | P2 |

## O1 — Masalah SLA ada di ekor, bukan median

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

## O2 — Satu reviewer dan satu jam batch memikul hampir semua keputusan

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

## O3 — Penolakan hampir final, dan alasannya tidak dicatat

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

## O4 — Waktu tunggu tidak berkorelasi dengan pembelian

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


## Data requests (Ops & KYC)

- Alasan penolakan / catatan reviewer per keputusan gagal (dibutuhkan O3).

- Timestamp submit KYC di DB (join GA kehilangan user tanpa `user_id`; `user_status_logs` mulai 2026-07-21).

- Pembedaan keputusan otomatis vs manual (`auth_user_id` bisa akun bersama atau bot).

