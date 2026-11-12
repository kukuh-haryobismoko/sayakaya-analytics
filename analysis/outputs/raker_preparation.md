# Persiapan Raker — Funnel Akuisisi ke Investasi Pertama

Disusun 2026-11-09 20:20 WIB (Asia/Jakarta) untuk leadership dan team lead. Bahasa bisnis, data agregat. Semua angka sama dengan dokumen induk `SayaKaya_Funnel_Analysis.md` (rujukan bagian dicantumkan); tidak ada PII. Periode perencanaan: tahun kalender **2027**, dibagi per kuartal (asumsi: Raker menetapkan target 2027; bila periode berbeda, skala target mengikuti, bukan definisi metrik).

Dokumen ini memisahkan **Fakta** (Observed, ada di data), **Asumsi** (belum diuji), dan **Usulan** (target, keputusan yang diminta). Angka dari *Product & Tech 2027 — Targets, Direction, Objectives* (PDF) berlabel **Target** dan tidak pernah dipakai sebagai Fakta; bagian 0 memetakan PDF ke analisis ini, termasuk yang tidak punya dukungan data.

## 0. Rencana 2027 dan posisi analisis ini

Sumber: *Product & Tech 2027 — Targets, Direction, Objectives* (draf; rencana bisnis CEO-approved Scenario 3 plus existing business). **Semua angka di bagian ini yang berasal dari PDF adalah Target atau Arah, bukan Fakta.** Fakta hanya angka yang berasal dari data analisis (rujukan ke dokumen induk). Bagian ini hanya menyelaraskan; tidak ada kueri baru dijalankan.

### 0.1 Apa yang diminta rencana (Target, dari PDF)

| Item | Target 2027 |
|---|---|
| AUM total akhir Desember | Rp700,9 miliar (Rp258 miliar existing, ditahan datar, + Rp442,9 miliar baru) |
| Nasabah baru berdana (new funded customers) | 10.982; kumulatif 1.770 (Mar), 4.464 (Jun), 7.274 (Sep) |
| Net revenue setahun | Rp3,53 miliar (Rp144 juta/bulan di Januari ke Rp571 juta/bulan di Desember) |
| Objective Product & Tech (draf) | O1 Tawarkan lebih dari reksa dana (Product, Data); O2 Mudahkan mulai dan lanjut berinvestasi, nasabah baru dan lama (Product, Data); O3 Rilis tepat waktu tanpa merusak produksi, platform yang skala (Engineering, QA) |
| KR | Belum ada angka. PDF: KR ditulis tiap tim objective, dengan titik awal dan target |

Laju yang tersirat (aritmetika dari target kumulatif): Q1 1.770 (590/bulan), Q2 2.694 (898/bulan), Q3 2.810 (937/bulan), Q4 3.708 (1.236/bulan).

### 0.2 Cakupan: analisis ini menutup nasabah ritel, bukan kanal RM

| Kanal (Target, PDF) | Nasabah baru berdana | AUM baru | Rata-rata AUM/nasabah |
|---|---|---|---|
| RM & Advisory | 732 | Rp394,9 miliar (89%) | sekitar Rp540 juta |
| Sales Booth (3 mal) | 7.938 (72%) | Rp26,9 miliar | sekitar Rp3,4 juta |
| B2B2C | 2.031 | Rp18,7 miliar | sekitar Rp9,2 juta |
| Marketing & Community | 163 | Rp1,0 miliar | sekitar Rp6,3 juta |
| Digital Ads | 118 | Rp0,1 miliar | sekitar Rp0,7 juta |
| SBN ke nasabah existing | nasabah existing | Rp1,3 miliar | – |

Aritmetika dari tabel: kanal non-RM = 10.250 dari 10.982 nasabah (93,3%) tetapi hanya Rp46,7 miliar dari Rp442,9 miliar AUM baru (10,5%). Analisis funnel (daftar, KYC, beli pertama, retensi) relevan untuk bagian pertama; ia tidak mengatakan apa pun tentang kanal RM, yang membawa sebagian besar AUM.

- **Fakta:** kohort analisis mengeluarkan 119 user HNWI (AUM ≥Rp500 juta pada satu snapshot harian) dan referrer RAIZ/RAIZKAYA (`definitions.md`, provenance log).
- **Inferred (keyakinan rendah):** user HNWI kemungkinan beririsan dengan nasabah RM (rata-rata AUM RM sekitar Rp540 juta). Data tidak punya penanda kanal RM, jadi irisan ini tidak bisa diuji.
- **Gap:** tidak ada data RM, B2B2C, atau SBN dalam analisis ini; tidak ada data revenue.

### 0.3 Keselarasan Objective

| Objective P&T 2027 | Bagian analisis yang mendukung | Dukungan data | Catatan |
|---|---|---|---|
| O2 Mudahkan mulai dan lanjut berinvestasi | Seluruh Objective dan KR1-KR3 dokumen ini (aktivasi, KYC Android, repeat). Temuan V1, V2, T1, T2, T3, O1-O3, M1, M6 | **Kuat** (baseline Observed ada) | "Mulai" = KR1, KR2. "Lanjut" = KR3. Kolam approved belum beli 13.093 user (78,6%) adalah tuas terbesar yang terukur |
| O3 Rilis tepat waktu, platform yang skala | T5 (error klien tanpa crash/ANR/alert), kualitas data (GA vs DB), O2 (satu akun review memikul 75,9% dari 922 keputusan, relevan dengan arah "KYC otomatis, tanpa tambah headcount ops") | **Parsial.** Ada baseline instrumentasi dan beban review; tidak ada data ketepatan rilis, insiden produksi, atau bug | Rekomendasi: KR3 = instrumentasi (Crashlytics/ANR, `user_id` GA, event server-side). Titik awal ketepatan rilis harus dari tim Engineering/QA |
| O1 Tawarkan lebih dari reksa dana | Tidak ada | **Tidak ada data** | SBN, ekuitas, multi-asset, DPLK, alokasi rekomendasi: tidak dianalisis. Tidak ada baseline dan tidak diisi di sini |

Objective dokumen ini (*setiap user yang lolos KYC membeli dalam 30 hari, dan setiap pembeli pertama membeli lagi dalam 90 hari*) adalah **turunan O2**, bukan pengganti objective P&T. Empat KR di bagian 3 adalah **draf usulan** untuk slot KR O2 (dan KR instrumentasi untuk O3); PDF belum menetapkan KR, jadi tidak ada angka KR yang berasal dari PDF.

### 0.4 Keselarasan target bisnis dengan data (Fakta vs Target)

| Pertanyaan | Fakta (analisis ini) | Target (PDF) | Kesimpulan |
|---|---|---|---|
| Booth: berapa registrasi untuk 7.938 nasabah berdana? | Registrasi sales code 2026-10-01..2026-11-09: 858, investor 79 = 9,2% (kohort muda). Sales code seluruh riwayat: 21,7% (232/1.068) | 7.938 nasabah booth | Aritmetika: pada 9,2% perlu 86.283 registrasi; pada 21,7% perlu 36.581. Konversi riil di antara dua angka itu belum diketahui (§3.2, §4.2 M1) |
| Booth: apakah nasabah bertahan? | Sales code: repeat mature 39,3% vs 60,0% organik; churn mature >90 hari 90,1% (inaktif, bukan penarikan dana) | AUM booth Rp26,9 miliar, rata-rata sekitar Rp3,4 juta | Median tiket pertama sales code Rp125.950 (tiket, bukan AUM). Retensi booth adalah risiko Observed terhadap target AUM booth |
| Laju bulanan | Kohort registrasi Okt 2026: 43 investor sampai 2026-11-09. Kohort Jan-Sep 2026: 233 investor dari 1.800 registrasi (26 per bulan registrasi) | Q1 590/bulan | **Tidak sebanding**: kohort registrasi (bukan bulan beli pertama), belum matang, tanpa RAIZ/HNWI. Baseline nasabah berdana bulanan sesuai definisi rencana belum ada |
| Definisi "funded" | Investor = pembelian sukses non-bonus pertama | "New funded customers" (definisi tidak ada di PDF) | **Asumsi:** keduanya sama. Perlu konfirmasi (ambang dana minimal? bonus dihitung?) |
| AUM existing datar | Tidak diukur. Churn 83,6% adalah inaktivitas >90 hari (transaksi), bukan arus keluar AUM | Rp258 miliar ditahan datar | Gap: retensi AUM per kohort belum dihitung |

### 0.5 Keselarasan roadmap P&T 2027 dengan temuan

| Item roadmap (draf, PDF) | Objective | Temuan terkait | Baseline Observed yang bisa dipakai |
|---|---|---|---|
| Migrasi payment gateway (VA), Q1 | O2 | T2 | Fail rate VA 11,1% (420/3.782), QRIS 22,2% (170/765), transfer bank 11,0%. Metrik sukses migrasi: fail rate VA vs 11,1% |
| Auto debit Mandiri dan BNI (live Jan, roadmap 2026), BCA (Q2) | O2 | Belum ada | Auto debit tidak muncul sebagai metode di tabel T2 (VA, bank transfer, QRIS, instant payment). Apakah tercatat sebagai metode terpisah belum dicek; data request |
| Redesain website (Q2), redesain app (Q3) | O2 | T1, T3, T4 | KYC start ke submit Android 79,6% vs iOS 88,1% (KR2); approved yang membuka buy sheet 43 dari 257 (T3); gate risk profile ditinggalkan 28 dari 97 (T4). Jadikan baseline pra-redesain |
| Dukungan B2B2C dan RM, S-Invest H2H (Q2) | O2, O3 | Belum ada | Tidak ada data B2B2C/RM |
| Alokasi rekomendasi, SBN primary, multi-asset (Q1), DPLK (Q3), ekuitas (Q4) | O1 | Belum ada | Tidak ada baseline |
| Arah: KYC otomatis tanpa tambah headcount ops | O3 | O1, O2, O3 (Ops & KYC) | 1 akun = 75,9% dari 922 keputusan; 34,5% keputusan di jam 10 WIB; P90 15,7 jam. Belum diketahui berapa persen otomatis vs manual (data request) |
| Arah: onboarding lebih cepat di booth dan event korporat | O2 | M1, T1, T3, V1 | Registrasi sales code ke approved 70,5%; ke investor 21,7% seluruh riwayat; booth-era 9,2% (muda) |

Roadmap kuartalan di bagian 5 tetap dipakai sebagai urutan kerja analisis. Item P&T yang sudah ada di roadmap (gateway VA, redesain web/app) menjadi wadah bagi perbaikan T1, T2, T3: jangan tambahkan proyek baru bila bisa masuk ke item itu.

## 1. Situasi saat ini

**Fakta — funnel (kohort 63.795, tarik 2026-11-09, §3 dokumen induk).**

| Tahap | User | Konversi tahap |
|---|---|---|
| Terdaftar | 63.795 | — |
| Submit KYC | 22.773 | 35,7% dari terdaftar |
| KYC disetujui | 16.659 | 73,2% dari submit |
| Investor pertama | 3.587 | 21,5% dari approved, 5,6% dari terdaftar |
| Repeat (2+ hari) | 2.132 | 59,4% dari investor |
| Masih aktif | 587 | 16,4% dari investor |
| Churn >90 hari | 3.000 | 83,6% dari investor |

**Tiga kebocoran terbesar.**

1. **Approved tidak pernah membeli: 13.093 user (78,6% dari approved).** Ini kolam terbesar dan paling murah disentuh: mereka sudah lolos KYC. Di antara yang masih terlihat di aplikasi (257 user dalam 39 hari), hanya 43 membuka layar beli dan 8 membuat order (§4.4 T3).
2. **Konversi pasca-approval jatuh di Oktober: 7,5% beli dalam 7 hari vs 29,2% pada Juli-September.** Bukan karena antrean KYC: penurunan sama besar pada approval hari yang sama (7,4% vs 29,5%). Pada rate lama, Oktober kehilangan sekitar 90 pembeli (§4.5 V1). Penyebab belum teridentifikasi.
3. **Insentif tidak menghasilkan pembayar: 3.629 dari 6.130 penerima bonus (59,2%) tidak pernah membeli berbayar; Rp469,4 juta kredit berakhir di non-pembayar.** Hanya 407 penerima (6,6%) menerima kredit sebelum pembelian berbayar pertamanya (§4.2 M2).

**Yang berhasil.** Sign-up lewat sales code dan referral sama-sama berkonversi tinggi ke investor (21,7% dan 20,6% per registrasi vs 3,7% organik, §4.2 M1): kanal berpeople-power efektif membawa user sampai membeli. KYC tidak lambat di median: 50% keputusan selesai dalam 10 menit (§4.3 O1).

**Yang tidak berhasil.** Retensi: repeat mature sales code 39,3% vs 60,0% organik, dan churn investor 83,6%. Bonus sebagai insentif akuisisi. Email lifecycle: hanya batch laporan performa, tanpa click tracking, tanpa email untuk approved-belum-beli atau KYC gagal (§4.2 M4, M6).

## 2. Objective perusahaan (satu, lintas tim)

**Usulan Objective 2027:** *Setiap user yang lolos KYC membeli dalam 30 hari, dan setiap pembeli pertama membeli lagi dalam 90 hari.*

**Posisi terhadap P&T 2027.** Objective ini adalah turunan O2 (*Mudahkan mulai dan lanjut berinvestasi*, bagian 0.3). O1 dan sebagian O3 tidak punya data di analisis ini.

**Mengapa ini, mengapa sekarang.** Hampir seluruh kerugian yang bisa dikendalikan terjadi setelah KYC, bukan sebelum: 13.093 user approved belum membeli, dan 83,6% investor berhenti. Akuisisi bukan bottleneck utama — funnel pra-approval sudah menyaring, dan dua kanal berbayar-people (sales code, referral) berkonversi 21% per registrasi. Artinya pertumbuhan tercepat tidak datang dari menambah user, tetapi dari memonetisasi user yang sudah lolos KYC dan mempertahankan yang sudah membeli.

**Yang TIDAK diprioritaskan 2027 (usulan, sadar dan tertulis).**

- Menambah volume registrasi berbayar: kanal organik berkonversi 3,7%, dan penyebab penurunan Oktober belum diketahui; menambah volume di atas funnel yang bocor memperbesar kebocoran.
- Desain ulang alur KYC secara besar-besaran: median 10 menit dan approval 73,2%; yang perlu diperbaiki adalah titik putus di dalam aplikasi (T1), bukan prosesnya.
- Program promo baru: belum ada bukti promo menaikkan retensi; bukti yang ada justru korelasi negatif (M3).

## 3. Key Results

Empat KR, semuanya outcome (bukan aktivitas), mencakup kualitas akuisisi, KYC, aktivasi, dan retensi. Target diturunkan dari baseline yang ada di data; tidak ada angka yang dikarang. Target KR di bawah adalah usulan analisis, bukan angka dari PDF (PDF belum menetapkan KR). Pemetaan ke objective P&T: KR1, KR2 = "mulai" (O2); KR3 = "lanjut" (O2); KR4 dimiliki Marketing/Finance, hanya tidak langsung terkait O2, dan bisa dikeluarkan dari OKR P&T tanpa mengubah baseline. Draf KR O3: instrumentasi (bagian 7, keputusan 4); titik awal ketepatan rilis belum ada.

### KR1 — Aktivasi: approved ke pembelian pertama dalam 7 hari

| Item | Isi |
|---|---|
| Definisi metrik | % user dengan keputusan KYC verified yang membuat pembelian sukses non-bonus dalam 7 hari setelah keputusan |
| Baseline | 7,5% (31/416 keputusan Oktober 2026, submit terhubung GA; §4.5 V1) |
| Target konservatif / base / stretch | 12% / 18% / 25% |
| Cara menurunkan target | Base = separuh jalan dari 7,5% ke rate historis 29,2% (7,5 + 10,85 = 18,35 → 18%). Konservatif = sepertiga jalan (≈12%). Stretch = 25%, sedikit di bawah level historis Juli-September |
| Sumber | `84_oct_lag.sql`, `86_oct_week.sql`; provenance log |
| Pemilik | Ops & KYC (keputusan + antrean) dan Tech (permukaan pasca-approval); didukung Marketing (trigger CRM) |
| Irama review | Bulanan, per kanal akuisisi di dalam bulan itu |
| Keyakinan | Sedang — baseline kuat, penyebab penurunan Oktober belum diketahui |
| Terukur hari ini? | Partial — submit KYC hanya terhubung ke GA untuk sebagian user; perlu event server-side |

### KR2 — KYC: start ke submit di Android

| Item | Isi |
|---|---|
| Definisi metrik | % user Android yang `kyc_start` dan mencapai `kyc_success` (submit) dalam 30 hari |
| Baseline | {AND:.1f}% (386/485, GA 2026-10-01..2026-11-08; §4.4 T1). iOS {IOS:.1f}% sebagai pembanding |
| Target konservatif / base / stretch | 83% / 85% / 88% |
| Cara menurunkan target | Konservatif = +3,4 pp (separuh gap ke iOS), base = +5,4 pp, stretch = paritas iOS (88%) |
| Sumber | `73_more.sql` (kyc_platform), `79_kyc_screens.sql`; provenance log |
| Pemilik | Tech (instrumentasi + perbaikan layar selfie); didukung Ops (pesan bantuan) |
| Irama review | Bulanan, per layar |
| Keyakinan | Sedang — titik putus terlokalisasi, penyebab teknis belum |
| Terukur hari ini? | Yes (level layar), Partial (penyebab) |

### KR3 — Retensi: repeat mature seluruh investor

| Item | Isi |
|---|---|
| Definisi metrik | % investor yang membeli pada 2+ hari berbeda, diukur hanya pada investor mature (pembelian pertama ≥120 hari lalu) |
| Baseline | {REPEAT_ALL:.1f}% ({_repeat:,}/{_mature:,}; §4.2 M1). Sales code 39,3% vs organik 60,0% |
| Target konservatif / base / stretch | +3 pp / +6 pp / +9 pp dari baseline |
| Cara menurunkan target | Tiga pp setara menutup seperempat gap sales-code–organik (20,7 pp) pada kelompok itu saja; sembilan pp menutup gap hampir penuh |
| Sumber | `75_mature_repeat.sql`; provenance log |
| Pemilik | Marketing (follow-up agen, lifecycle) dan Tech (permukaan repeat); didukung Ops |
| Irama review | Bulanan, per kanal akuisisi |
| Keyakinan | Sedang — baseline kuat, tuas perbaikan belum diuji |
| Terukur hari ini? | Yes |

### KR4 — Kualitas insentif: penerima bonus yang menjadi pembayar berbayar

| Item | Isi |
|---|---|
| Definisi metrik | % penerima kredit bonus yang punya minimal satu pembelian berbayar (di luar metode bonus) |
| Baseline | {BONUS_PAID:.1f}% ({_bonus['bonus_users']-_bonus['never_paid']:,}/{_bonus['bonus_users']:,}; 59,2% tidak pernah bayar; §4.2 M2) |
| Target konservatif / base / stretch | 45% / 55% / 65% |
| Cara menurunkan target | Baseline berlaku walau kebijakan tidak diubah; konservatif = kredit hanya setelah pembelian berbayar pertama untuk kohort baru (menghapus 59,2% non-pembayar dari program), base = ditambah nudge 30 hari, stretch = ditambah konversi dari email/push |
| Sumber | `76_bonus_chk.sql` (bonus_before_paid, bonus_exposure); provenance log |
| Pemilik | Marketing (kebijakan) dan Finance (anggaran); didukung Tech (flag kredit) |
| Irama review | Kuartalan |
| Keyakinan | Tinggi untuk baseline, rendah untuk proyeksi |
| Terukur hari ini? | Yes |

Catatan: bila leadership ingin KR churn (83,6% baseline), metrik itu bergerak lambat dan tumpang tindih dengan KR3; usul: KR3 dipakai sebagai leading indicator retensi, churn dilaporkan sebagai metrik pemantau, bukan KR.

## 4. Peta kontribusi tim

| KR | Marketing | Ops & KYC | Tech | Kontribusi terukur | Usaha |
|---|---|---|---|---|---|
| KR1 approved→beli 7 hari | Trigger CRM pasca-approval, pesan investasi pertama (M6) | Antrean keputusan dengan due date, slot malam/akhir pekan (O1, O2) | Permukaan buy sheet pasca-approval (T3) | +10,5 pp base; 476 approval/bulan menjadi sasaran langsung | M |
| KR2 KYC Android | Pesan bantuan capture, panduan selfie | Dukungan user yang gagal capture | Instrumentasi hasil per layar + perbaikan izin/capture (T1) | +21 submit/39 hari bila separuh gap ditutup | M |
| KR3 repeat mature | Follow-up agen hari 7 dan 30, lifecycle email (M1, M6) | — (dependensi tak langsung: kecepatan balasan) | Permukaan repeat di aplikasi | 191 investor mature sales code x 20,7 pp gap = 40 tambahan bila gap tertutup penuh | M |
| KR4 bonus→pembayar | Kebijakan kredit + nudge 30 hari (M2) | — | Flag kredit, event konversi | Rp469,4 juta eksposur dipindahkan ke syarat pembelian berbayar | S |

Setiap KR punya dependensi lintas tim. Tidak ada KR yang bisa dicapai satu tim saja: KR1 butuh keputusan (Ops), trigger (Marketing), dan permukaan (Tech) pada user yang sama.

## 5. Roadmap kuartalan 2027

| Kuartal | Milestone | Dependensi |
|---|---|---|
| Q1 | Quick win 30-60 hari: kebijakan bonus baru (KR4), trigger CRM pasca-approval, slot review malam/akhir pekan, `user_id` pada log email | keputusan program bonus, roster Ops, skema Supabase |
| Q1-Q2 | Permukaan pasca-approval di aplikasi (KR1), instrumentasi layar KYC + perbaikan selfie Android (KR2) | desain, rilis aplikasi |
| Q2 | Follow-up agen hari 7/30 untuk kohort sales code (KR3); holdout promo 10% | data agen, CRM |
| Q3 | Lifecycle email penuh (onboarding, approved, reaktivasi); holdout push dengan `campaign_id` | click tracking, skema event |
| Q3-Q4 | Server-side event register/approve/order/pay; diagnosis penurunan Oktober tuntas | pipeline data |
| Q4 | Review KR vs baseline, reset target 2028 | seluruh data 2027 |

**Quick win 30-60 hari (Q1):** kebijakan bonus (S, tanpa kode), trigger CRM pasca-approval (tanpa rilis aplikasi), slot review malam, dan kolom alasan penolakan KYC. Keempatnya bisa jalan sebelum rilis aplikasi pertama 2027.

## 6. Risiko dan asumsi

| Risiko / asumsi | Dampak | Mitigasi |
|---|---|---|
| Penyebab penurunan Oktober tidak diketahui | KR1 bisa salah tuas | Diagnosis bauran kanal di Q1; kalau penyebabnya eksternal, target KR1 diturunkan, bukan dinaikkan usahanya |
| Submit KYC tidak tercatat di DB (hanya GA, user_id parsial) | KR1 sulit diukur | Event server-side; sebelum itu, ukur di level keputusan + order DB |
| Tidak ada click tracking email | KR4 dan lifecycle tidak bisa diatribusi | Tambah click event di Q1 |
| Alasan penolakan KYC tidak disimpan | Perbaikan tertarget buta | Kolom reason di Q1 |
| Musiman: Oktober turun drastis vs Juli-September | Target kuartalan bisa menyesatkan | Bandingkan YoY dan per kanal, bukan bulan ke bulan |
| Regulasi KYC/e-KYC tidak berubah selama 13 bulan data | Rekomendasi tetap valid | Konfirmasi ke compliance sebelum rilis |
| Basis retensi dari investor mature (≥120 hari) | Perbaikan baru terlihat 4 bulan kemudian | KR3 di-review bulanan tetapi dinilai kuartalan |

## 7. Keputusan yang diminta dari leadership

1. **Kebijakan bonus:** setujui syarat kredit hanya setelah pembelian berbayar pertama. Dasar: Rp469,4 juta kredit berakhir di 3.629 non-pembayar; hanya 6,6% penerima menerima kredit sebelum membeli (§4.2 M2).
2. **SLA KYC:** setujui target P90 ≤24 jam dengan slot review malam/akhir pekan. Dasar: 23 keputusan >24 jam dalam 39 hari, seluruhnya menumpuk di luar jam batch 10:00 (§4.3 O1).
3. **Headcount/reviewer:** setujui reviewer kedua atau delegasi terdokumentasi. Dasar: satu akun memikul 75,9% dari 922 keputusan (§4.3 O2).
4. **Instrumentasi:** setujui pekerjaan tracking (user_id GA, click email, campaign_id, alasan penolakan, crash). Dasar: lima KR di atas hanya bisa dinilai sebagian tanpa itu; tanpa itu 2027 akan mengulang perdebatan 2026.
5. **Periode target:** konfirmasi tahun kalender 2027 dan definisi kuartal yang dipakai.
6. **Definisi "new funded customer":** tetapkan apakah sama dengan investor di dokumen ini (pembelian sukses non-bonus pertama) dan apakah ada ambang dana minimal. Tanpa ini baseline bulanan untuk target 10.982 tidak bisa dihitung (bagian 0.4).
7. **Kepemilikan data O1 dan O3:** tunjuk pemilik baseline untuk O1 (SBN, ekuitas, multi-asset) dan O3 (ketepatan rilis, insiden produksi). Analisis ini tidak punya datanya.

## 8. Agenda Raker (75 menit) dan pertanyaan diskusi

| Waktu | Sesi |
|---|---|
| 0-10 | Rencana 2027, cakupan data, situasi: funnel, tiga kebocoran (bagian 0-1) |
| 10-25 | Objective dan apa yang tidak diprioritaskan (bagian 2) |
| 25-45 | Key Results: baseline, target, cara menurunkan (bagian 3) |
| 45-60 | Peta kontribusi dan dependensi (bagian 4) |
| 60-70 | Roadmap dan quick win Q1 (bagian 5) |
| 70-75 | Keputusan yang diminta (bagian 7) |

**Marketing.** (1) Kanal mana yang siap menerima tambahan volume setelah Oktober? (2) Siapa pemilik follow-up agen hari 7 dan 30? (3) Apakah program bonus bisa diubah kuartal ini? (4) Kanal mana yang tidak boleh ditambah sampai penyebab Oktober jelas? (5) Data bauran kanal per bulan bisa disiapkan kapan?

**Ops & KYC.** (1) Berapa reviewer yang tersedia untuk slot malam/akhir pekan? (2) Siapa yang memutuskan delegasi akun review? (3) Apakah alasan penolakan bisa dicatat mulai Q1? (4) Berapa lama proses pengajuan ulang yang realistis? (5) Apakah ada batas regulasi pada kecepatan keputusan?

**Tech.** (1) Berapa lama instrumentasi layar KYC dan perbaikan selfie Android? (2) Kapasitas untuk event server-side kuartal ini? (3) Siapa pemilik permukaan pasca-approval? (4) Apakah click tracking email dan `user_id` bisa masuk Q1? (5) Apakah Crashlytics bisa diekspor?

## 9. Ringkasan satu halaman

| Objective | Key Result | Baseline | Target (konservatif / base / stretch) | Pemilik |
|---|---|---|---|---|
| Setiap user yang lolos KYC membeli dalam 30 hari, dan setiap pembeli pertama membeli lagi dalam 90 hari | KR1 Approved→beli 7 hari | 7,5% (Okt 2026, n=416) | 12% / 18% / 25% | Ops + Tech, didukung Marketing |
| | KR2 KYC start→submit Android | {AND:.1f}% (n=485) | 83% / 85% / 88% | Tech, didukung Ops |
| | KR3 Repeat mature | {REPEAT_ALL:.1f}% (n={_mature:,}) | +3 / +6 / +9 pp | Marketing + Tech |
| | KR4 Bonus→pembayar berbayar | {BONUS_PAID:.1f}% (n={_bonus['bonus_users']:,}) | 45% / 55% / 65% | Marketing + Finance |

*Catatan: kolom Objective di tabel di atas adalah turunan O2 (P&T 2027). Angka PDF: lihat bagian 0.*
