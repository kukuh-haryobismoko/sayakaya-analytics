# Temuan lintas tim — Fase 3

Dibangun 2026-11-09 20:13 WIB dari `outputs/raw/`. Angka turunan langsung dari file mentah; tidak ada yang diketik manual.

## V1 — Approved ke beli jatuh di Oktober, dan ini bukan soal waktu tunggu

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

## V2 — Kolam approved yang menumpuk adalah satu masalah dengan tiga wajah

**Pain point.** Marketing melihatnya sebagai tidak ada lifecycle (M6), engineering sebagai tidak ada jalur kembali (T3), operasi sebagai antrean yang tidak memicu apa pun (O1/O2). Semuanya merujuk ke 13,093 user approved-belum-beli.

**Evidence (Observed).** 13,093 user approved tanpa pembelian selesai; 476 approved dalam 30 hari terakhir; 257 dari kolam itu terlihat di GA dalam 39 hari, 43 membuka buy sheet, 8 membuat order.

**Root cause (Inferred, keyakinan sedang).** Approval adalah akhir dari proses, bukan awal dari proses berikutnya. Tidak ada trigger (CRM), tidak ada permukaan (produk), tidak ada antrean (operasi) yang membawa user approved ke investasi pertama. Ini kegagalan koordinasi, bukan kegagalan satu tim.

**Expected impact (aritmetika).** Titik acuan konservatif: 10% dari 257 user GA-visible terkonversi ke order pada rate order ke pembayaran 84.3% = 22 investor per 39 hari (206/tahun). Skenario penuh memakai 13,093 user; jangan dilaporkan sebelum diukur.

**Effort.** M (satu program: trigger approval ke CRM + permukaan di aplikasi + antrean operasi dengan due date).

**Priority.** P0.

**KPI / validation.** Approved ke investasi pertama 7/30 hari, satu dashboard lintas tim; target +10 pp dari basis Oktober.

## Ringkasan prioritas

| Prioritas | Temuan | Alasan |
|---|---|---|
| P0 | V1 / V2 / T3 (kolam approved), M2 (bonus ke non-pembayar), T1 (funnel KYC) | Dampak terbesar, angka bisa dihitung, sebagian besar bisa dikendalikan produk/kebijakan |
| P1 | M1 (retensi sales code), M4 (email tak terukur), M6 (lifecycle), O1/O2/O3 (SLA, key-person, penolakan), T2 (QRIS) | Dampak sedang, usaha kecil-menengah |
| P2 | M3 (promo), M5 (push), O4 (wait), T4 (gate), T5 (error) | Bukti lemah atau bersifat korelasi |

## Semua angka yang belum bisa diuji

- Lift bonus (M2), promo (M3), push (M5), messaging lifecycle (M6), dan permukaan pasca-approval (T3/V2) adalah estimasi aritmetika dari korelasi. Tidak ada eksperimen acak di data ini.

- T1 dan T4: n kecil di bucket tertentu; flag `n<30` ditandai di tabel.

- V1: penyebab belum diidentifikasi; tiga hipotesis terbuka, semuanya butuh data bauran kanal Oktober.


## Follow-up Fase 2 yang terjawab di sini

- Approved-belum-beli (Fase 2: 78,6%) diperdalam: 257 terlihat di GA, 43 buka buy sheet, 8 order (T3), dan penurunan Oktober diukur (V1).

- Pertanyaan Fase 2 'apa yang terjadi setelah KYC': alur berhenti tanpa trigger, tanpa permukaan, tanpa antrean (V2).

- Pertanyaan Fase 2 soal bauran booth: sales code berkontribusi pada bauran berintensi rendah tetapi bukan penjelas tunggal (M1).

