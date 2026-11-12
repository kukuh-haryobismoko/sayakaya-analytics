# Temuan — Marketing

Dibangun 2026-11-09 20:13 WIB dari `outputs/raw/` (BigQuery read-only) dan Supabase `dashboard_email_log`/`dashboard_email_events`.

Kohort = Fase 1/2 (tanpa referrer RAIZ/RAIZKAYA, tanpa HNWI): 63,795 registrasi, 3,587 investor. Tarik data 2026-11-09.

| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |
|---|---|---|---|---|---|---|
| M1 | Sign-up sales code: konversi setara referral, retensi mature terburuk | 21,7% investor/reg vs 20,6% referral, 3,7% none; repeat mature 39,3% vs 60,0% | Tinggi (observasional) | Tinggi | M | P1 |
| M2 | Bonus kredit 6.130 user, 59,2% tidak pernah beli berbayar | Rp469.400.000 kredit ke 3.629 non-pembayar | Tinggi | Tinggi | S (policy) | P0 |
| M3 | Promo di beli-pertama berkorelasi repeat lebih rendah | 52,9% vs 61,7% | Sedang (confounded) | Sedang | S | P2 |
| M4 | Email lifecycle tidak terukur; batch kena throttle, 0 click | 93/743 gagal (454), semua dikirim ulang; 0 click event; open 497/497 dalam 2 jam | Tinggi | Sedang | S | P1 |
| M5 | Push menjangkau non-investor, konversi pasca-klik tak terukur | 252 approved-belum-beli klik; uji klik→beli hanya 103 user | Rendah | Sedang | M | P2 |
| M6 | Tiga kolam macet tanpa messaging lifecycle | 13.093 approved-belum-beli; 191 unverified <30 h; 92 investor diam 60-90 h | Tinggi | Tinggi | M | P1 |

## M1 — Sales code: konversi setara referral, retensi mature terburuk

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

## M2 — Bonus kredit adalah kebocoran belanja marketing terbesar

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

## M3 — Promo di pembelian pertama berkorelasi dengan repeat lebih rendah (confounded)

**Pain point.** Investor yang beli pertama memakai promo repeat 52.9% vs 61.7% tanpa promo.

**Evidence (Observed).** Beli pertama berpromo n=919: repeat 486 = 52.9% (95% CI 49.7-56.1%), churn90 86.0%. Tanpa promo n=2,668: repeat 61.7%, churn90 82.8%. z=-4.7, p<0.0001.

- Kontradiksi: menghitung promo di pembelian mana pun membalik tanda. Pemakai promo 72.6% repeat (n=1,601) vs 48.8% (n=1,986). Pemakaian promo adalah akibat dari sering beli, jadi potongan ini tidak boleh dibaca sebagai lift.

**Root cause (Inferred, keyakinan rendah).** Promo kemungkinan menarik pembeli sekali-jalan yang sensitif harga, tetapi promo beli-pertama juga ditargetkan ke kelompok ini. Seleksi tidak bisa dipisahkan tanpa eksposur acak.

**Expected impact.** Tidak dikuantifikasi. Gap 8.8 pp x 919 investor promo = 81 investor repeat hanya batas atas bila gap sepenuhnya kausal; data tidak bisa menunjukkan itu.

**Effort.** S (analisis: holdout acak).

**Priority.** P2.

**KPI / validation.** Repeat 90 hari untuk user baru eligible promo, acak promo vs tanpa promo (holdout 10%).

## M4 — Email lifecycle: throttle, tanpa click tracking, lift tak terukur

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

## M5 — Push menjangkau non-investor, klik ke beli tak terukur

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

## M6 — Tiga kolam macet tanpa messaging lifecycle

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


## Data requests (Marketing)

- Tidak ada id kampanye di push/email; sumber registrasi GA kosong hampir sepanjang window (Fase 2). Tambahkan `campaign_id` ke event `notification_*` dan `dashboard_email_log`.

- Baris batch `dashboard_email_log` punya `user_id` NULL (650/650); tanpa itu tidak ada join email ke investasi.

- Tidak ada tipe event klik di `dashboard_email_events`.

- Aturan program bonus (siapa, kapan, berapa) tidak ada di BigQuery; dibutuhkan untuk mengukur M2 dengan benar.

