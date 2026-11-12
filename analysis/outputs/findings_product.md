# Temuan — Product & Engineering

Dibangun 2026-11-09 20:13 WIB dari GA4 `analytics_266759216.events_*` (2026-10-01..2026-11-08) dan `main.transactions`. Read-only.

| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |
|---|---|---|---|---|---|---|
| T1 | KYC putus di dalam aplikasi: identity ke selfie −11,3%, Android 8,5 pp di bawah iOS | 745 identity ke 661 selfie; submit Android 79,6% vs iOS 88,1% | Tinggi | Tinggi | M | P0 |
| T2 | QRIS gagal dua kali lebih sering dari metode lain | 170/765 (22,2%) vs 11,0-11,1% VA/bank | Tinggi | Sedang | S | P1 |
| T3 | User approved yang belum beli tidak pernah kembali ke alur beli | dari 257 yang terlihat pasca-approval, 43 buka buy sheet, 8 buat order | Tinggi | Tinggi | M | P0 |
| T4 | Gate risk profile ditinggalkan 28,9%, tanpa kerugian hilir yang signifikan | 28/97 abandon; 46,4% abandoner tetap order vs 59,4% | Sedang | Rendah | S | P2 |
| T5 | Error klien tercatat di GA, tanpa crash/ANR dan tanpa alert | 45 `continue_with_google_failed`, 10 `app_exception`, tanpa monitoring | Tinggi | Rendah | S | P2 |

## T1 — Alur KYC kehilangan user di dalam aplikasi, terburuk di Android pada langkah selfie

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

## T2 — Pembayaran: QRIS gagal dua kali lebih sering dari VA atau transfer bank

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

## T3 — User approved yang belum beli tidak kembali ke alur beli

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

## T4 — Gate risk profile: tidak ada kerugian hilir yang terukur

**Pain point.** 28 dari 97 user yang memicu gate risk profile meninggalkannya, tetapi abandoner tetap berkonversi pada rate yang tidak berbeda signifikan.

**Evidence (Observed).** GA `risk_profile_gate_triggered`/`abandoned`, 2026-10-01..2026-11-08.

- Trigger 97, abandon 28 (28.9%). Order setelahnya: abandoner 13/28 (46.4%), non-abandoner 41/69 (59.4%). z=-1.17, p=0.243.

**Root cause (Inferred, keyakinan rendah).** Abandonment nyata tetapi sementara; gate ditampilkan ulang belakangan. Dengan n<100 di kedua sisi, ini bisa jadi kurang bertenaga, bukan benar-benar tidak berbahaya.

**Expected impact.** Tidak ada klaim; hanya 75 user per 30 hari. Instrumentasi dulu, jangan desain ulang.

**Effort.** S.

**Priority.** P2.

**KPI / validation.** Gate abandonment rate dan rate order 7 hari, bulanan, dengan n>=100.

## T5 — Error klien tercatat, tanpa crash/ANR dan tanpa alert

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


## Data requests (Product & Engineering)

- Event hasil per layar KYC (capture dicoba/gagal, izin ditolak, back ditekan): memblokir T1.

- Kode error provider pada transaksi gagal: memblokir sizing T2.

- Ekspor Crashlytics/ANR: memblokir severity T5.

- `user_id` pada event GA pra-login, dan id kampanye pada event notifikasi.

