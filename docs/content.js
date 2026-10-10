'use strict';

// Hand-written part of DOKUMENTASI.md, in Indonesian. scripts/generate-docs.js
// combines it with what it reads from the code (tabs, routes, the BigQuery
// tables each query touches, libraries, workflows, Supabase tables) and the
// plain-language text of the in-app Documentation tab.
//
// TABS: one entry per sidebar tab id (data-tab in public/index.html).
//   summary      what the tab is for, one or two sentences
//   datasets     tables it reads, as people talk about them
//   computation  how the numbers are worked out
//   docKey       the Documentation tab entry to quote, when its name differs
//                from the sidebar label
// A new tab without an entry here still appears in the document, with a
// warning from the generator, until it gets one.
const TABS = {
  "overview": {
    summary: "Snapshot bisnis: total AUM, jumlah user, volume buy/sell, tren transaksi, breakdown per fund, dan peta sebaran investor. Bisa difilter per produk dan per pengguna (sertakan atau kecualikan berdasarkan kode referrer, kode sales, SID, email, atau akun institusi).",
    datasets: "main.users, main.user_profiles, main.funds, main.portfolios, main.bonus_portfolios, main.transactions, mi_fee_logs.portfolio_with_code, main.geo",
    computation: "KPI buy/sell dan transaksi dari main.transactions pada rentang tanggal terpilih. Platform AUM dan tabel Largest funds dari snapshot portfolio_with_code pada tanggal as-of (koreksi -1 hari, hanya fund ACTIVE untuk Platform AUM). Donat AUM per jenis produk menjumlahkan holding live nasabah Sayakaya (unit x latest_nav_value, termasuk unit kampanye yang masih terkunci), bukan funds.latest_aum_value yang merupakan total AUM produk di seluruh pasar. Peta dan top kota memakai holding live (unit x latest_nav_value), provinsi dan kota dari main.geo. Filter pengguna: aturan digabung AND, nilai dalam satu aturan OR, tidak peka huruf besar/kecil, * sebagai wildcard, maksimal 300 nilai. Berlaku ke semua angka di tab (dicocokkan lewat users.id, atau sid_code untuk snapshot portfolio_with_code), termasuk export Largest funds. Selama filter aktif, donat itu hanya menjumlahkan holding pengguna tersebut.",
  },
  "aum": {
    summary: "Pergerakan total AUM dan revenue platform dari waktu ke waktu.",
    datasets: "mi_fee_logs.mi_fee, main.funds, main.transactions",
    computation: "AUM per periode = nilai hari terakhir periode (bukan jumlah). Revenue = jumlah aperd_share_per_day. Net flow = buy dikurangi sell. Market effect = perubahan AUM dikurangi net flow. Tanggal transaksi digeser +1 hari karena baris mi_fee hari D sudah memuat transaksi D-1. Hanya fund ACTIVE.",
  },
  "revenue-trend": {
    summary: "Tren revenue AperD per hari, minggu, atau bulan, dengan penjelasan penyebab perubahan dan rincian per fund.",
    datasets: "mi_fee_logs.portfolio_with_code, main.management_fee_logs, main.funds, main.investment_managers",
    computation: "Memakai perhitungan yang sama persis dengan Revenue (PWC), jadi totalnya sama: AUM harian dikali rate fee, bagian AperD dijumlah per periode. Minggu mulai hari Minggu, sama seperti tab Revenue (PWC). Revenue = hari x rata-rata AUM x rate harian, sehingga perubahan tiap periode dipecah tepat menjadi efek hari (jumlah hari berbeda, termasuk periode awal atau akhir yang terpotong rentang tanggal), efek AUM (rata-rata AUM bergerak, pada rate lama), dan efek rate dan mix (sisanya: rate fee dan komposisi fund). Klik baris untuk melihat fund yang menggerakkannya. Fund yang baru atau hilang di salah satu periode tidak punya rate pembanding, jadi hanya perubahan revenue yang tampil.",
  },
  "performance": {
    summary: "Performa NAV tiap fund dari 1 hari sampai 5 tahun, dibandingkan antar fund.",
    datasets: "main.snapshots (type NAV), main.funds",
    computation: "% perubahan = (NAV terbaru dikurangi NAV pada awal periode) dibagi NAV awal periode. Periode: 1D, 1W, 1M, 3M, YTD, 1Y, 3Y, 5Y. Tanggal acuan relatif terhadap data terbaru tiap fund, bukan hari ini. Rata-rata per tipe fund.",
  },
  "growth": {
    summary: "Kinerja campaign promo, referrer teratas, dan alur switching antar fund.",
    datasets: "main.campaigns, main.users, main.transactions, main.switching_transactions, main.portfolios, main.bonus_portfolios, main.funds, main.investment_managers, main.user_profiles",
    computation: "Redemption % = used_quota / quota. Estimasi biaya = used_quota x bonus_amount. Leaderboard referrer = jumlah user dengan referrer_code yang sama plus total buy mereka. Switching = jumlah dan nilai per pasangan fund asal dan tujuan. AUM per manajer investasi dan per toleransi risiko = holding live nasabah Sayakaya (unit x latest_nav_value, termasuk unit kampanye yang masih terkunci), bukan funds.latest_aum_value yang merupakan total AUM produk di seluruh pasar.",
  },
  "predict": {
    summary: "Forecast AUM dan volume transaksi, risiko churn investor, dan tren retensi. Sebelumnya bernama Predict.",
    datasets: "Model BigQuery ML: sayakaya.ml.aum_forecast, tx_forecast, churn_model",
    computation: "Forecast AUM dan transaksi memakai ARIMA_PLUS. Churn memakai regresi logistik (LOGISTIC_REG) yang menghasilkan probabilitas per investor. Retensi dihitung sebagai cohort bulanan, untuk user dan untuk AUM.",
  },
  "portfolio": {
    summary: "Cari satu investor (SID, nama, email): holding saat ini, performa, dan riwayat AUM.",
    datasets: "mi_fee_logs.portfolio_with_code, main.users",
    computation: "Holding dan AUM dari snapshot harian portfolio_with_code. Bisa dipilih as-of date. Ada tombol PDF, Google Sheet, dan Bulk export.",
  },
  "portfolio-explorer": {
    summary: "Sama dengan PWC tapi dari sumber kedua, per goal tabungan investor.",
    datasets: "main.goals, main.goal_snapshots",
    computation: "Holding dari goal_snapshots, dikelompokkan per goal, bisa dilihat as-of tanggal lampau.",
  },
  "portfolio-fix": {
    summary: "Sama dengan PWC, tapi dari tabel harian yang sudah dikoreksi.",
    datasets: "mi_fee_logs.portfolio_fix",
    computation: "Harga beli rata-rata dibobot per unit, bukan dirata-rata per lot. Ini memperbaiki bug cost basis di pipeline portfolio_with_code.",
  },
  "portfolio-tx": {
    summary: "Lookup investor dengan harga beli rata-rata dari ledger transaksi.",
    datasets: "main.transactions, main.funds, main.snapshots, main.bonus_portfolios",
    computation: "Hanya buy, SWITCH_IN, reinvestment, dan transfer_in completed yang mengubah rata-rata. Sell tidak mengubahnya. As-of date direkonstruksi dari transaksi sampai tanggal itu. Holding bonus hanya tersedia live. Baris fund bisa di-uncheck sebelum export.",
  },
  "portfolio-sinvest": {
    summary: "Sama dengan Portfolio (TX) tapi dari feed kustodian KSEI/SInvest, sebagai sumber independen untuk cross-check.",
    datasets: "sinvest.trx_history, main.funds",
    computation: "Semua kolom di sumbernya bertipe STRING, jadi tanggal (YYYYMMDD) dan nominal di-parse dulu. Rumus rata-rata sama dengan versi TX.",
  },
  "hnwi": {
    summary: "Investor dengan AUM dalam rentang min/max pilihan, per tanggal pilihan, lengkap dengan profil risiko.",
    datasets: "mi_fee_logs.portfolio_with_code, main.users, main.user_profiles",
    computation: "AUM = jumlah amount per SID pada tanggal itu, dengan koreksi -1 hari pada created_at. Breakdown per fund punya filter Min/Max sendiri yang menghasilkan daftar investor sendiri.",
  },
  "top-investors": {
    summary: "Peringkat investor berdasarkan Subscribers, Redeemers, atau Net deposit.",
    datasets: "main.transactions, main.users",
    computation: "Hanya buy dan sell completed, dibucket per tanggal created_at. Net = buy dikurangi sell. Share % dihitung terhadap total semua investor di periode itu, bukan hanya baris yang ditampilkan. Urutan menurun atau menaik, jumlah baris diketik manual (1 sampai 1.000). Untuk Net deposit, menurun hanya memuat net positif dan menaik hanya net negatif (penarik bersih terbesar). Di bawahnya ada versi singkat (Name, Buys, Sell, Net increase; Buys dan Sell adalah nominal rupiah, Net increase = Buys dikurangi Sell) yang bisa diurutkan per kolom dari baris yang sudah diambil. Semua tabel punya tombol Copy (tab-separated plus HTML) untuk menyalin tanpa mengunduh.",
  },
  "user-lifetime": {
    summary: "Revenue fee per investor, dibandingkan dengan lama mereka bersama Sayakaya.",
    datasets: "mi_fee_logs.portfolio_with_code, main.transactions, main.users",
    computation: "Kolom uang dihitung seperti Revenue (PWC). Tanggal register, beli pertama, dan lama bertahan diambil dari transaksi dan users.created_at, karena portfolio_with_code baru mulai 14 Januari 2026. Klik investor untuk rincian per bulan dan per fund.",
  },
  "dormant": {
    summary: "Dari investor yang lama tidak beli, berapa yang akhirnya beli lagi dan berapa nilainya.",
    datasets: "main.transactions (buy completed)",
    computation: "Per user, selisih dua pembelian berturut-turut (LEAD) di atas 14 hari = satu episode dormant. Bucket 2 Weeks, 1 Month, 2 Month, 3 Month (30 sampai 179 hari ke atas sesuai tingkatnya). Gap 180 hari ke atas dibuang karena dianggap churn. Converted = ada pembelian berikutnya. Revenue dari final_amount pembelian penutup (total, rata-rata, median, maksimum). Ada tabel repeat buyers dan time-to-convert, masing-masing maksimal 1.000 baris.",
  },
  "users-tx": {
    summary: "Telusuri transaksi investor mana pun lewat SID, email, atau nama.",
    datasets: "main.transactions, main.users, main.user_profiles, main.funds",
    computation: "Pencarian parsial. Filter tipe, status, fund, dan tanggal. Tiap baris memuat kontak pembeli dan nama fund. Export CSV, Excel, PDF.",
  },
  "sinvest-tx": {
    summary: "Browse mentah feed KSEI/SInvest, per baris, bisa difilter dan di-export.",
    datasets: "sinvest.trx_history",
    computation: "Tanggal diformat ke ISO dan nominal di-cast ke NUMERIC untuk tampilan. Filter tetap memakai string YYYYMMDD.",
  },
  "remisier-tx": {
    summary: "Detail transaksi di balik angka remisier.",
    datasets: "main.transactions, main.users",
    computation: "Filter berdasarkan referrer_code atau sales_code, tipe, status, dan tanggal.",
  },
  "reconciliation": {
    summary: "Cek harian apakah angka ledger aplikasi sama dengan feed kustodian.",
    datasets: "sinvest.trx_history, main.transactions",
    computation: "Kedua sisi dijumlah per tanggal dan tipe (dengan baris ALL), lalu di-FULL JOIN. Selisih = nominal app dikurangi nominal SInvest. Kode tipe SInvest 1 sampai 9 dipetakan ke BUY, SELL, SWITCH, dst. Liquidation, transfer, dan unit adjustment belum dibukukan backoffice, jadi tampil hanya di sisi SInvest.",
  },
  "send-statement": {
    summary: "Kirim email portfolio, e-statement transaksi bulanan, atau keduanya ke satu investor atau batch. Dulu bernama Send statement.",
    datasets: "Portfolio tanpa tanggal: main.portfolios + main.bonus_portfolios + main.funds (live). Portfolio dengan tanggal: mi_fee_logs.portfolio_fix + main.snapshots. E-statement: main.transactions + main.funds. Kontak: main.users + main.user_profiles",
    computation: "Portfolio tanpa tanggal = holding live (unit > 0 plus bonus on_going), nilai = unit x latest_nav_value, harga beli rata-rata dari portfolios.initial_price. Dengan tanggal = snapshot portfolio_fix pada (created_at - 1 hari) itu, NAV dari snapshots tanggal itu (fallback latest_nav_value). E-statement = transaksi status completed, verified, completed_payment dalam bulan terpilih. PDF dikunci tanggal lahir (DDMMYYYY). Batch: cari investor per nama (* sebagai wildcard), SID, email, atau nomor HP (0812/+62 812/812 dianggap sama), tambahkan satu per satu, dan/atau tempel daftar email/SID. Jadwal (OTP email, tanggal akhir opsional) selalu memakai portfolio live dan e-statement bulan lalu. Melanjutkan jadwal yang dijeda langsung mengirim yang terlewat sekali dan memperbarui tanggal kirim berikutnya.",
  },
  "send-fund-performance": {
    summary: "Kirim PDF \"Reksa Dana Update\" ke daftar email, untuk semua fund, kategori fund tertentu, atau fund pilihan, dengan NAV per tanggal pilihan.",
    datasets: "main.snapshots (type NAV), main.funds; pencarian penerima dari main.users + main.user_profiles",
    computation: "% perubahan per periode sama dengan tab Performance. Filter fund diterapkan sebelum PDF dibuat (kategori = funds.type, fund = funds.id); jika filter tidak cocok dengan fund mana pun, kiriman gagal alih-alih mengirim PDF kosong. Penerima dicari per nama (* sebagai wildcard), SID, email, atau nomor HP, atau ditempel. Satu email per penerima. Jadwal menyimpan pilihan fund yang sama (kolom fund_filter); melanjutkan jadwal yang dijeda langsung mengirim yang terlewat sekali dan memperbarui tanggal kirim berikutnya.",
  },
  "email-recap": {
    summary: "Rekap setiap email yang dikirim dashboard: penerima, subjek, kategori, asal kiriman (manual, batch, jadwal, email akun), keterangan isi, pengirim, lalu status sampai, dibuka, diklik, bounce, dan spam.",
    datasets: "Supabase: dashboard_email_log, dashboard_email_events, view dashboard_email_overview, fungsi dashboard_email_recap (bukan BigQuery)",
    computation: "Satu baris ditulis setiap kali email dikirim (status sent atau failed = diterima atau ditolak SMTP Amazon SES). Event dari SES (Delivery, Open, Click, Bounce, Complaint, Reject, DeliveryDelay) masuk lewat webhook SNS /api/webhooks/ses dan dicocokkan lewat tag log_id atau message id SES. Tingkat buka dan klik = jumlah email dengan minimal satu Open atau Click dibagi email yang Delivered. Hari dihitung dalam WIB. Kode OTP jadwal tidak disimpan, query string tautan yang diklik dibuang (bisa berisi token login). Kiriman sebelum 8 Oktober 2026 diisi ulang dari antrean jadwal dan activity log, tanpa data sampai atau dibuka. Pelacakan sampai, dibuka, diklik aktif setelah configuration set SES disiapkan (SUPABASE-DEPLOY.md, Email tracking).",
  },
  "revenue": {
    docKey: "docs_revenue_desc",
    summary: "Fee manajemen yang diterima Sayakaya per fund dan manajer investasi.",
    datasets: "mi_fee_logs.portfolio_with_code, main.management_fee_logs, main.funds, main.investment_managers",
    computation: "AUM harian dikali rate fee manajemen yang berlaku (latest per management_fee_id) menjadi akrual harian, dipecah ke bagian AperD dan MI. Dikelompokkan per periode dan fund. Ada koreksi -1 hari. Dipakai juga oleh tab Revenue trend.",
  },
  "revenue2": {
    docKey: "docs_revenue_desc",
    summary: "Perhitungan revenue yang sama dari sumber data kedua.",
    datasets: "main.goal_snapshots, main.management_fee_logs",
    computation: "Sama dengan Revenue (PWC), AUM harian dari goal_snapshots. Tanggalnya sudah benar, jadi tidak perlu koreksi -1 hari.",
  },
  "campaign-revenue": {
    summary: "Berapa fee yang didapat balik dari tiap campaign promo.",
    datasets: "main.campaigns, main.bonus_portfolios, main.transactions, main.management_fee_logs",
    computation: "Unit yang dikunci campaign menghasilkan fee selama masih ditahan: on_going sampai hari ini, redeemed sampai tanggal redeem, succeeded sampai unit dijual (dilacak dari ledger). Dua atribusi penjualan ditampilkan berdampingan: sell memakai unit campaign dulu (utama) atau unit sendiri dulu (kolom alt).",
  },
  "remisier": {
    docKey: "docs_remisier_sharing_desc",
    summary: "Revenue-share untuk remisier berdasarkan AUM yang mereka bawa.",
    datasets: "main.users, main.goal_snapshots, main.management_fee_logs",
    computation: "Fee remisier adalah porsi tertentu dari bagian AperD (bukan dari fee mentah). Potong PPh 23 sebesar 2,5%, sisanya fee neto. Bagian Sayakaya = AperD dikali (1 - porsi remisier).",
  },
  "remisier-pwc": {
    docKey: "docs_remisier_sharing_desc",
    summary: "Perhitungan yang sama dengan sumber AUM berbeda, untuk dibandingkan.",
    datasets: "mi_fee_logs.portfolio_with_code, main.users, main.management_fee_logs",
    computation: "Sama dengan versi GS, tetapi AUM dari portfolio_with_code dengan koreksi -1 hari.",
  },
  "marketing": {
    summary: "Funnel per channel iklan dari klik sampai pembayaran, beserta revenue.",
    datasets: "adjust_analytics.events",
    computation: "COUNTIF per activity kind dan event name, per _tracker_name_. Revenue = jumlah _amount_ pada payment_completed. Hanya nama event polos yang dihitung, varian seperti payment_completed_1M_plus dibuang agar pembayaran tidak terhitung 2 sampai 3 kali.",
  },
  "referral-program": {
    summary: "Laporan eligibility bonus referral Sep sampai Des 2026.",
    datasets: "main.users, main.user_referrals, main.transactions",
    computation: "Referral sah jika transaksi pertama sepanjang masa si invitee adalah pembelian fund Sucor Asset Management minimal Rp1.000.000 dengan kode referral. Bonus Rp25.000 per sisi baru berlaku jika unit ditahan 30 hari. Status: Eligible, Pending (masih masa 30 hari), atau Not eligible beserta alasannya. Leaderboard invitee dihitung dari tanggal registrasi.",
  },
  "referral-program-alt": {
    summary: "Aturan dan detail sama dengan Referral program, definisi \"Invited\" berbeda.",
    datasets: "Sama dengan Referral program",
    computation: "Invited ditentukan oleh tanggal verifikasi KYC invitee (dengan grace 1 hari), bukan tanggal registrasi.",
  },
  "kalcer": {
    summary: "Siapa mengajak siapa dan kapan, dari semua referral antar pengguna di aplikasi (bukan hanya ambassador satu program), plus AUM investor yang diajak pada tanggal pilihan. Dulu bernama Kalcer ambassadors.",
    datasets: "main.user_referrals, main.users, main.user_profiles, mi_fee_logs.portfolio_with_code",
    computation: "Link referral dari user_referrals (permanen, berbasis user id: referrer_id = yang mengajak, user_id = yang diajak, created_at = tanggal referral); 6.227 link dari 643 referrer sejak Januari 2022. main.users di-join dua kali (referrer dan invitee) plus user_profiles untuk nama. AUM = jumlah amount positif per SID invitee pada tanggal itu, koreksi -1 hari. Ringkasan per referrer: jumlah referral, referral pertama dan terakhir, total AUM. Tidak memakai dataset kalcer.* (data bonus program Kalcer), yang menghitung referral dengan logika lain sehingga angkanya bisa berbeda. Tidak ada hitungan bonus atau tier. Pencarian bebas berdasarkan SID, nama, atau email.",
  },
  "push": {
    summary: "Kesehatan pengiriman push notification: tren, per campaign, per platform.",
    datasets: "firebase_messaging.data",
    computation: "Delivery rate = baris MESSAGE_ACCEPTED dibagi total baris. MISSING_REGISTRATIONS (token device basi) dipisah dari error lain. Hanya kesehatan pengiriman, bukan open atau click, dan tidak ada user_id sehingga tidak bisa dikaitkan ke revenue.",
  },
  "app-health": {
    summary: "Crash dan trace paling lambat, Android dan iOS digabung.",
    datasets: "firebase_crashlytics (android + ios), firebase_performance (android + ios)",
    computation: "Crash: per platform, judul issue, dan fatal/non-fatal, dengan jumlah event, device terdampak (DISTINCT installation_uuid), dan versi app terbaru. Performance: hanya DURATION_TRACE, median dan rata-rata dalam ms, minimal 20 sampel. Dwell time layar dan app di background dikecualikan. Tidak ada total pengguna aktif, jadi tidak bisa menghitung crash-free %.",
  },
  "product-funnel": {
    summary: "Dari device yang klik Register, berapa yang lanjut OTP, KYC, order, sampai bayar, per platform.",
    datasets: "analytics_266759216.events_* (ekspor GA4)",
    computation: "Berbasis cohort: device dengan register_click pertama di rentang tanggal, lalu dicek tanpa batas tanggal apakah pernah mencapai tiap milestone. Cohort dipilih agar funnel tidak naik di tengah, karena orang bisa daftar dan bayar di periode berbeda. Query selalu membaca seluruh histori GA4.",
  },
  "user-behavior": {
    summary: "Menghubungkan aktivitas aplikasi (Google Analytics) dengan database utama: pengguna harian, perilaku per status investor, aksi sebelum pembelian, dampak push, halaman fund dilihat vs dibeli, daftar yang mulai beli tapi tidak bayar, dan linimasa per investor.",
    datasets: "analytics_266759216.events_* (GA4) dengan user_id = main.users.id, main.transactions, main.portfolios, main.bonus_portfolios, main.users, main.user_profiles, main.funds",
    computation: "Hanya event yang punya user_id (setelah login). Event pasif (push masuk, push ditutup, update app/OS) tidak dihitung sebagai aktivitas. Status investor = kondisi hari ini: Holding (unit > 0 atau bonus on_going), Redeemed (pernah beli completed, tidak memegang), Verified belum beli, Belum verifikasi. Beli = transaksi buy completed (final_amount), dicocokkan mulai 10 menit sebelum event app karena backend menulis transaksi beberapa detik sebelum app mencatat order_created. Lift aksi = persen yang beli dalam 7 hari sejak pertama melakukan aksi dibagi baseline semua pengguna app (7 hari sejak aktivitas pertama). Push: per message_name, penerima, pembuka, dan pembeli dalam 72 jam. Halaman fund: screen_view ProductDetailScreen (param id = funds.id) lalu beli fund yang sama dalam 7 hari. Daftar tidak bayar: buka form beli atau order_created tanpa buy berstatus completed, completed_payment, atau verified sampai 3 hari setelah percobaan terakhir. Setiap lihat linimasa investor tercatat di Activity log (view_user_journey). Default 30 hari terakhir karena tiap query memindai GA4 sepanjang rentang (sekitar 100 MB per bulan).",
  },
  "subscription-analysis": {
    summary: "Analisis alur beli (subscription) di aplikasi: funnel dari form beli sampai dibayar, dari layar mana orang membuka form beli, di mana mereka keluar dari alur beli, order per metode pembayaran (dibayar, kedaluwarsa, dibatalkan), layar dan aksi yang dilakukan pembeli sebelum membeli, waktu dari daftar ke pembelian pertama, jam dan hari beli, serta tombol nominal cepat.",
    datasets: "analytics_266759216.events_* (GA4) dengan user_id = main.users.id, main.transactions, main.users",
    computation: "Hanya event yang punya user_id (setelah login). Dibayar = buy berstatus completed, completed_payment, atau verified; pembelian manual_bonus (input admin) tidak dihitung. Funnel per orang: form beli (SubscriptionFormBottomSheet, MultipleSubscriptionFormBottomSheet, atau event buy_bottom_sheet), SubscriptionCheckoutScreen, SubscriptionPaymentMethodBottomSheet, order_created, lalu dibayar (buy dibayar mulai 10 menit sebelum order pertama sampai 1 hari setelah akhir periode). Tiap langkah hanya dihitung jika terjadi setelah langkah sebelumnya, jadi angkanya hanya turun. Dipisah per platform, pembeli pertama atau ulang (ada buy dibayar sebelum pertama buka form), dan versi app saat pertama buka form (GROUPING SETS). Asal form: screen_view tepat sebelumnya di sesi yang sama (LAG per ga_session_id) dan dua layar sebelumnya; dibayar = buy dibayar dalam 3 hari setelah membuka form dari layar itu; kembali ke form dari checkout tidak dihitung. Titik keluar: sesi yang sampai ke form tanpa order_created, per langkah terjauh, dengan layar berikutnya (LEAD) atau keluar aplikasi, dan berapa orang yang membayar dalam 7 hari. Metode pembayaran: semua order buy di periode per payment_method dan bank; nominal tidak dibayar dari amount (final_amount bernilai 0 untuk order yang tidak dibayar); median menit dari created_at ke paid_at; berapa yang ordernya kedaluwarsa atau dibatalkan lalu membayar order lain dalam 7 hari. Pendorong: per layar dan aksi, tingkat bayar orang yang melakukannya dibanding yang tidak melakukannya (lift); pembeli hanya dihitung dari yang dilakukan sebelum buy dibayar pertama (toleransi 2 menit karena app mencatat order_created sampai sekitar 90 detik setelah transaksi tertulis); push yang masuk saat app terbuka (notification_foreground) tidak dihitung; langkah alur beli disembunyikan kecuali dicentang; minimal 20 orang. Waktu ke pembelian pertama: user yang daftar di periode (users.created_at), hari ke verified_at dan ke buy dibayar pertama, median sesi login sebelum beli. Jam beli: porsi session_start (login) dibanding porsi order dibayar per jam atau hari, WIB. Tombol nominal: event price_chips (param nominal), dibayar dalam 1 hari setelah ketukan pertama, dan apakah amount sama dengan nominal tombol. Default 30 hari terakhir (sekitar 100 MB GA4 per bulan per query). Ditambah 9 Oktober 2026: panel profil pembeli dari database utama (usia dari user_profiles.birthdate 17 sampai 90, gender, occupation, investment_purpose, risk_level, umur akun dari users.created_at saat pertama buka form), tingkat bayar dan nominal per kelompok. Setiap panel punya baris Data (tabel dan kunci join) dan kotak Temuan yang dihitung dari baris yang dimuat. Panel peta data menampilkan validitas join untuk periode terpilih (analysisCoverage): persen user_id GA4 yang ada di main.users, persen order beli, penjualan, dan switching di database yang punya event aplikasi yang cocok dalam 10 menit, dan persen pendaftar yang terlihat login.",
  },
  "onboarding-analysis": {
    summary: "Dari akun dibuat sampai pembelian pertama: layar KYC yang dicapai di aplikasi, hasil review KYC, profil risiko, pembelian dibayar pertama, waktu mengisi KYC, jam review, dan bagian KYC yang dikembalikan.",
    datasets: "main.users (cohort), analytics_266759216.events_* (GA4, user_id = main.users.id), main.user_status_logs, main.user_profiles, main.transactions",
    computation: "Cohort = akun dengan users.created_at di periode, akun institusi (is_institution) tidak dihitung. Layar KYC GA4 dicari tanpa batas akhir (_TABLE_SUFFIX >= awal periode), urutan aplikasi Sep 2026: VerificationIntroScreen, IdentityPreviewScreen (foto KTP), SelfiePreviewScreen, ProfileVerificationScreen, OccupationVerificationScreen, Address/CorrespondenceAddressVerificationScreen, BankVerificationScreen, SignatureVerificationScreen, VerificationSuccessScreen atau kyc_success (dikirim). Setiap langkah menghitung yang pernah mencapainya (LOGICAL_OR), jadi langkah berikutnya bisa sedikit lebih besar bila event layar hilang. KYC terverifikasi dari users.verification_status, profil risiko dari user_profiles.risk_level, pembelian pertama = buy berstatus completed, completed_payment, atau verified (bukan manual_bonus). Dipisah per platform pertama di GA4 atau tidak terlihat di aplikasi (GROUPING SETS). Hasil KYC: verified pertama kali, verified setelah gagal (ada log failed di user_status_logs), failed, pending, dikirim tapi belum direview, tidak pernah dikirim; median menit dari buka KYC ke kirim, median sesi (ga_session_id) sampai kirim, median jam dari kirim ke keputusan di user_status_logs (sejak 21 Jul 2026), beli dalam 7 hari sejak daftar. Bagian yang dikembalikan dari layar IdentityRejectedScreen, ProfileRejectedScreen, OccupationRejectedScreen, AddressRejectedScreen, BankRejectedScreen beserta yang sekarang terverifikasi. Kolom langkah bernama addr_step dan sign_step karena runQuery menghapus kolom bernama address atau yang mengandung signature (redaksi KYC).",
  },
  "redemption-analysis": {
    summary: "Alur jual dan switching di aplikasi dicocokkan dengan database, profil penjualan (lama memegang, jenis fund, penuh atau sebagian, membeli lagi, tidak memegang apa pun), dan perilaku di aplikasi sebelum menjual.",
    datasets: "analytics_266759216.events_* (GA4, user_id), main.transactions, main.switching_transactions, main.funds, main.portfolios, main.bonus_portfolios",
    computation: "Funnel berurutan per orang (ga4OrderedFunnel): jual = redeem_click atau RedemptionFormBottomSheet, redeem_product_click atau RedemptionCheckoutScreen, confirm_redeem_click, lalu sell selesai di database (status completed, completed_payment, verified, verified_by_operational) mulai 10 menit sebelum konfirmasi; kuesioner redemption muncul setelah konfirmasi jadi bukan langkah. Switching = switch_click atau SwitchProductFormBottomSheet, SwitchProductFundListScreen, switch_product_click atau SwitchProductConfirmationScreen, confirm_switch_click, lalu switching_transactions selesai. Profil: setiap sell selesai di periode (aplikasi atau bukan), nominal COALESCE(NULLIF(final_amount, 0), amount); lama memegang = hari sejak buy atau SWITCH_IN pertama ke fund yang sama; penuh = is_all_unit; membeli lagi = buy dibayar dalam 30 hari; tidak memegang apa pun = AUM live 0; dikonfirmasi di aplikasi = ada confirm_redeem_click dalam 10 menit. Sinyal sebelum menjual: populasi investor yang punya buy dibayar sebelum periode dan terlihat login, lift per layar dan aksi (sama dengan pendorong di Subscription analysis) dengan batas waktu 2 detik sebelum baris sell tertulis, karena baris ditulis median 8 detik setelah konfirmasi dan aplikasi membuka daftar transaksi di detik yang sama. Jalan menuju tombol jual (GoalDetailScreen, product_in_portfolio_click) dan PIN ditandai sebagai alur dan disembunyikan secara bawaan.",
  },
  "engagement-analysis": {
    summary: "Fitur aplikasi yang dipakai dibandingkan dengan kepemilikan dan transaksi, investor menurut besar portofolio dan hari aktif di aplikasi (termasuk uang yang dipegang investor yang tidak membuka aplikasi), kata kunci pencarian sampai fund yang dibeli, dan pilihan urutan, rekomendasi ahli, serta level risiko.",
    datasets: "analytics_266759216.events_* (GA4, user_id), main.portfolios, main.bonus_portfolios, main.funds, main.transactions, main.users",
    computation: "Fitur = event dan layar GA4 dikelompokkan (pencarian, urutkan dan filter, watchlist, perbandingan, rekomendasi ahli, perencanaan tujuan, kalkulator, berita dan edukasi, promo, referral, notifikasi, bantuan, halaman manajer dan grup fund, e-statement dan pajak; daftar di ENG_FEATURES). Per fitur: pengguna login, yang memegang portofolio hari ini (unit x latest_nav_value, termasuk bonus), median AUM, membeli dan menjual di periode (buy dibayar, sell selesai), dibandingkan baris semua pengguna aplikasi. Aktivitas: investor yang memegang unit hasil beli di main.portfolios (bukan hanya bonus, bukan institusi), tier AUM (di bawah 1 jt, 1 sampai 10 jt, 10 sampai 100 jt, 100 jt sampai 1 M, 1 M ke atas) x hari aktif GA4 di periode (0, 1 sampai 2, 3 sampai 9, 10 ke atas; event pasif tidak dihitung). Pencarian: search_trigger param name (huruf kecil), search_result_click di sesi yang sama dalam 30 menit, buy dibayar dalam 7 hari, dan buy fund yang diketuk (product_name dicocokkan ke funds.name); kata kunci yang dipakai kurang dari 2 orang disembunyikan karena bisa berisi nomor referensi atau nama. Pilihan: sort_filter_apply (sort_by, sort_return_period), mutual_fund_by_expert_click (goal_name), risk_profile_gate_completed (level), lalu buy dibayar dalam 7 hari.",
  },
  "event-code": {
    summary: "Tab generik untuk melacak kode referral/sales sebuah event, dibangun sebelum event-nya ada.",
    datasets: "main.users, main.transactions",
    computation: "Pilih users.sales_code atau users.referrer_code, lalu isi kode. Funnel: ditandai kode, KYC verified, transaksi, transaksi lagi. Ada daftar user, detail transaksi, dan tabel retensi cohort per Day/Week/Month. Perlu diperbarui saat aturan event aslinya ada.",
  },
  "ask": {
    summary: "Tanya dalam bahasa biasa (mis. \"top 10 funds by AUM\") dan dapatkan jawaban dengan chart.",
    datasets: "Dataset BigQuery utama, lewat server/ask.js",
    computation: "Pertanyaan diterjemahkan jadi query read-only, bisa ditindaklanjuti dan diminta tipe chart. Kolom terbatas (password, KYC) selalu dibuang, kecuali superuser mencentang opsi dan mengonfirmasi password.",
  },
  "explorer": {
    summary: "Browse tabel data mentah dengan filter.",
    datasets: "Tabel BigQuery, lewat server/explore.js",
    computation: "Menampilkan record asli tanpa agregasi.",
  },
  "sql": {
    summary: "Menjalankan query read-only sendiri.",
    datasets: "BigQuery",
    computation: "Aturan kolom terbatas sama dengan Ask.",
  },
  "docs": {
    summary: "Panduan bahasa sederhana untuk setiap tab, dalam English dan Bahasa Indonesia. Dulu berada di grup Help, sekarang di Tools.",
    datasets: "Teks di public/index.html dan public/i18n.js",
    computation: "Panel dokumentasi mengikuti pengelompokan sidebar. Selalu bisa dibuka semua akun, tanpa perlu dicentang di Manage users.",
  },
  "presentation": {
    docKey: "docs_presentation_desc",
    summary: "Deck rapat internal, ditampilkan satu halaman per layar.",
    datasets: "Berkas deck statis, daftar di PRESENTATIONS (server/app.js)",
    computation: "Hanya tampil untuk akun yang diberi akses tab ini. Dua sidebar tab diberi akses terpisah.",
  },
  "monthly-review": {
    docKey: "docs_presentation_desc",
    summary: "Deck rapat internal, ditampilkan satu halaman per layar.",
    datasets: "Berkas deck statis, daftar di PRESENTATIONS (server/app.js)",
    computation: "Hanya tampil untuk akun yang diberi akses tab ini. Dua sidebar tab diberi akses terpisah.",
  },
  "admin": {
    summary: "Membuat akun login dan memilih section yang boleh dilihat tiap orang (superuser).",
    datasets: "Auth internal aplikasi",
    computation: "Akses diatur per tab lewat requireTab. Daftar centang akses mengikuti grup sidebar, jadi pengelompokan ulang tidak mengubah akses yang sudah diberikan (yang disimpan adalah id tab).",
  },
  "activity-log": {
    summary: "Riwayat login, export, pertanyaan Ask, query SQL, lihat portfolio, lihat linimasa investor di User behavior, dan perubahan akun (superuser).",
    datasets: "Log aktivitas aplikasi",
    computation: "Mencatat siapa, apa, dan kapan.",
  },
};

// BigQuery datasets: what each one is, in plain words. The generator lists
// the tables it finds in the code under each dataset and warns about any
// dataset that has no entry here.
const DATASETS = {
  main: 'Salinan database produksi aplikasi Sayakaya di BigQuery: akun dan profil pengguna, transaksi, kepemilikan (portofolio), produk reksa dana, kampanye promo, referral, dan snapshot NAV/AUM harian. Sumber kebenaran untuk uang dan pengguna.',
  mi_fee_logs: 'Hasil pipeline perhitungan fee: fee harian per manajer investasi dan snapshot portofolio harian per investor (per SID), dipakai untuk AUM historis dan revenue.',
  analytics_266759216: 'Ekspor Google Analytics 4 (Firebase) dari aplikasi mobile Android dan iOS: setiap layar yang dibuka dan setiap aksi, satu tabel per hari (events_YYYYMMDD), sejak Februari 2026. Setelah login setiap event membawa user_id, yaitu main.users.id, dan itulah kunci join ke database utama.',
  firebase_crashlytics: 'Ekspor Firebase Crashlytics: crash dan error aplikasi, satu tabel per platform.',
  firebase_performance: 'Ekspor Firebase Performance Monitoring: durasi pemanggilan API (GraphQL) dan pemuatan layar, satu tabel per platform.',
  firebase_messaging: 'Log pengiriman push notification Firebase Cloud Messaging (FCM): diterima atau gagal per pesan. Tidak berisi user_id, jadi tidak bisa dihubungkan ke investor.',
  adjust_analytics: 'Ekspor Adjust (atribusi iklan): klik, install, dan event dari setiap channel iklan, termasuk pembayaran yang dilaporkan aplikasi.',
  sinvest: 'Feed transaksi dari S-INVEST (KSEI), sistem kustodian. Sumber independen untuk mencocokkan transaksi aplikasi; semua kolomnya bertipe teks.',
  ml: 'Model BigQuery ML yang dibuat oleh dashboard (forecast AUM dan transaksi, model churn) beserta tabel fiturnya.',
};

// Short notes for the tables most tabs read. Tables without a note are
// still listed, just without the explanation.
const TABLE_NOTES = {
  'main.users': 'Akun pengguna: email, SID, status KYC (verification_status, verified_at), kode referral dan sales, tanggal daftar, akun institusi.',
  'main.user_profiles': 'Profil KYC: nama, nomor HP, tanggal lahir, gender, pekerjaan, tujuan investasi, level risiko. Kolom identitas sensitif disaring oleh dashboard.',
  'main.user_status_logs': 'Riwayat perubahan status KYC (pending ke verified atau failed) beserta waktunya, sejak 21 Juli 2026.',
  'main.transactions': 'Semua transaksi: buy, sell, SWITCH_IN/OUT, reinvestment; status, nominal (amount, final_amount), metode pembayaran, waktu dibuat dan dibayar.',
  'main.portfolios': 'Kepemilikan unit per investor per fund saat ini, beserta harga beli awal.',
  'main.bonus_portfolios': 'Unit bonus dari kampanye promo, dengan status on_going, redeemed, atau succeeded.',
  'main.funds': 'Daftar reksa dana: nama, jenis, manajer investasi, NAV dan AUM terbaru, fee.',
  'main.snapshots': 'Riwayat harian NAV (dan AUM) per fund.',
  'main.goals': 'Tujuan/portofolio tabungan yang dibuat investor di aplikasi.',
  'main.goal_snapshots': 'Snapshot harian nilai per goal (sumber "GS").',
  'main.campaigns': 'Kampanye promo: kode, kuota, bonus, periode.',
  'main.user_referrals': 'Hubungan referral: siapa mengajak siapa dan kapan.',
  'main.switching_transactions': 'Transaksi switching antar fund: fund asal dan tujuan, nominal, status.',
  'main.management_fee_logs': 'Rate fee manajemen per fund dan perubahannya, termasuk bagian AperD dan MI.',
  'main.investment_managers': 'Daftar manajer investasi.',
  'main.geo': 'Provinsi dan kota untuk peta sebaran investor.',
  'mi_fee_logs.mi_fee': 'Fee harian per fund dan AUM harian platform.',
  'mi_fee_logs.portfolio_with_code': 'Snapshot portofolio harian per investor (sumber "PWC"), mulai 14 Januari 2026.',
  'mi_fee_logs.portfolio_fix': 'Versi portfolio_with_code dengan harga beli rata-rata yang sudah dikoreksi.',
  'analytics_266759216.events_*': 'Semua event aplikasi; dibaca per rentang tanggal lewat _TABLE_SUFFIX.',
  'sinvest.trx_history': 'Riwayat transaksi dari kustodian.',
  'adjust_analytics.events': 'Event atribusi iklan per tracker/channel.',
  'firebase_messaging.data': 'Satu baris per status pengiriman push.',
};

// Supabase (Postgres) tables the dashboard owns: logins, schedules, logs.
const SUPABASE_TABLES = {
  dashboard_users: 'Akun login dashboard: username/email, hash password, superuser atau bukan, daftar tab yang boleh dibuka, status undangan.',
  dashboard_sessions: 'Token sesi login (berlaku 7 hari) untuk setiap perangkat yang login.',
  dashboard_password_resets: 'Token sekali pakai untuk tautan reset password dan undangan.',
  dashboard_audit_log: 'Activity log: login, export, pertanyaan Ask, query SQL lab, lihat portofolio atau linimasa investor, perubahan akun.',
  dashboard_scheduled_jobs: 'Jadwal kirim email berulang (e-statement, portofolio, performa fund) dan pengaturannya.',
  dashboard_schedule_queue: 'Antrean pengiriman per jadwal dan per penerima.',
  dashboard_schedule_otps: 'Kode OTP email untuk mengonfirmasi pembuatan jadwal.',
  dashboard_email_log: 'Satu baris per email yang dikirim dashboard: penerima, subjek, kategori, asal, pengirim.',
  dashboard_email_events: 'Event dari Amazon SES per email: terkirim, dibuka, diklik, bounce, spam.',
  dashboard_email_overview: 'View: setiap email beserta status terakhirnya (terkirim, dibuka, diklik, bounce), gabungan dua tabel di atas.',
  dashboard_email_recap: 'Fungsi SQL: rekap email per hari, kategori, dan subjek untuk tab Email recap.',
};

// Words a non-technical reader will meet in this document.
const GLOSSARY = [
  ['AUM (Assets Under Management)', 'Total nilai uang investor yang dikelola, dalam rupiah: unit yang dipegang dikali NAV.'],
  ['NAV (Net Asset Value)', 'Harga satu unit reksa dana pada suatu hari.'],
  ['Unit', 'Satuan kepemilikan reksa dana. Membeli Rp1 juta saat NAV Rp1.000 berarti mendapat 1.000 unit.'],
  ['Subscription / pembelian (buy)', 'Investor membeli unit reksa dana. Dianggap berhasil setelah dibayar.'],
  ['Redemption / penjualan (sell)', 'Investor menjual unit dan menerima uangnya kembali. Penuh = semua unit fund itu dijual.'],
  ['Switching', 'Memindahkan uang dari satu fund ke fund lain tanpa menariknya keluar.'],
  ['KYC', 'Verifikasi identitas (KTP, selfie, data diri, rekening bank) yang wajib sebelum bisa membeli.'],
  ['SID', 'Single Investor Identification dari KSEI, nomor unik setiap investor pasar modal.'],
  ['IFUA', 'Investor Fund Unit Account: nomor rekening unit reksa dana investor di sistem kustodian (S-INVEST).'],
  ['AperD / MI', 'Agen Penjual Efek Reksa Dana (Sayakaya) dan Manajer Investasi. Fee manajemen dibagi di antara keduanya.'],
  ['Remisier', 'Mitra perujuk yang mendapat bagi hasil dari AUM nasabah yang dibawanya.'],
  ['PWC / GS', 'Dua sumber snapshot portofolio: mi_fee_logs.portfolio_with_code (PWC) dan main.goal_snapshots (GS). Beberapa tab punya versi dari keduanya untuk dibandingkan.'],
  ['HNWI', 'High Net Worth Individual: investor dengan AUM besar.'],
  ['GA4 / Google Analytics', 'Sistem yang mencatat setiap layar dan tombol yang dipakai orang di aplikasi.'],
  ['user_id', 'Nomor akun yang ditempelkan aplikasi ke setiap event setelah login. Sama dengan main.users.id, sehingga perilaku di aplikasi bisa dicocokkan dengan transaksi.'],
  ['Event / screen view / sesi', 'Event = satu aksi tercatat; screen view = satu layar dibuka; sesi = satu kali pemakaian aplikasi (berakhir setelah 30 menit tidak aktif).'],
  ['Funnel', 'Urutan langkah menuju suatu tujuan (misalnya buka form sampai bayar) dan berapa orang yang bertahan di setiap langkah.'],
  ['Cohort', 'Sekelompok orang yang dimulai pada waktu yang sama (misalnya mendaftar di bulan yang sama), lalu diikuti perjalanannya.'],
  ['Lift', 'Berapa kali lebih sering sesuatu terjadi pada orang yang melakukan X dibanding yang tidak. Lift 2 = dua kali lebih sering. Menunjukkan pola, bukan sebab.'],
  ['Median', 'Nilai tengah setelah diurutkan. Lebih tahan terhadap nilai ekstrem dibanding rata-rata.'],
  ['WIB', 'Waktu Indonesia Barat (UTC+7). Data mentah disimpan dalam UTC.'],
  ['BigQuery', 'Gudang data Google tempat semua data analitik disimpan dan dihitung dengan SQL.'],
  ['Supabase', 'Database dan server kecil (Edge Function) yang menjalankan backend dashboard versi live serta menyimpan akun dan log.'],
];

// Repository layout, one line per path. The generator checks each path
// still exists and flags the ones that do not.
const REPO_MAP = [
  ['public/index.html', 'Seluruh halaman dashboard: sidebar, setiap tab (section), dan tab Documentation.'],
  ['public/app.js', 'Logika frontend: memanggil API, menggambar tabel dan grafik, ekspor, pengaturan akun.'],
  ['public/i18n.js', 'Teks dalam Bahasa Inggris dan Indonesia untuk semua label dan penjelasan.'],
  ['public/styles.css', 'Tampilan: warna, tema terang/gelap, layout responsif.'],
  ['server/app.js', 'Backend Node.js (Express): semua endpoint /api, cek login dan hak akses tab.'],
  ['server/queries.js', 'Semua query SQL BigQuery, satu fungsi (builder) per kebutuhan data. Komentar di atas setiap builder menjelaskan aturannya.'],
  ['server/bigquery.js', 'Koneksi BigQuery, batas biaya per query, dan penyaringan kolom sensitif.'],
  ['server/auth.js', 'Akun, sesi, reset password, dan activity log (di Supabase).'],
  ['server/ask.js', 'Fitur Ask: pertanyaan bahasa biasa diubah menjadi SQL read-only oleh model Claude (Anthropic).'],
  ['server/explore.js', 'Fitur Data explorer: daftar tabel yang boleh dijelajahi beserta filternya.'],
  ['server/export.js', 'Ekspor CSV dan Excel.'],
  ['server/pdf.js', 'Pembuatan PDF laporan portofolio, e-statement, dan performa fund.'],
  ['server/sheets.js', 'Ekspor ke Google Sheets.'],
  ['server/mail.js', 'Pengiriman email lewat Amazon SES, setiap kirim dicatat ke email log.'],
  ['server/schedules.js', 'Jadwal kirim email berulang dan OTP konfirmasinya.'],
  ['server/ml.js', 'Membaca hasil model BigQuery ML (forecast dan churn).'],
  ['server/ml-train.js', 'Melatih ulang model BigQuery ML secara berkala.'],
  ['server/index.js', 'Menjalankan server lokal (npm start).'],
  ['supabase/functions/api', 'Salinan backend dalam Deno (TypeScript) yang berjalan sebagai Supabase Edge Function. Ini backend yang dipakai situs live.'],
  ['supabase/migrations', 'Struktur tabel Supabase (akun, sesi, jadwal, log).'],
  ['netlify/functions', 'Pembungkus backend untuk Netlify (target deploy cadangan).'],
  ['setup/ml_models.sql', 'SQL pembuatan awal model BigQuery ML.'],
  ['.github/workflows', 'GitHub Actions: deploy GitHub Pages, cron jadwal email, deploy Cloud Run.'],
  ['test', 'Tes otomatis (npm test): render setiap tab dengan data contoh, ekspor, format, dan aturan lain.'],
  ['presentation-docs', 'Deck presentasi internal (AI Taskforce, Monthly Review) dan skrip pembuatnya.'],
  ['docs/content.js', 'Teks dokumentasi yang ditulis manusia: ringkasan, dataset, dan cara hitung per tab, deskripsi dataset, istilah.'],
  ['scripts/generate-docs.js', 'Membuat DOKUMENTASI.md dari kode dan docs/content.js.'],
  ['scripts/deploy-all.sh', 'Rutinitas "deploy all": dokumentasi, tes, migrasi, deploy function, push.'],
];

// Settings from .env.example, explained. A variable missing here falls back
// to its comment in .env.example and the generator warns.
const ENV_NOTES = {
  GCP_PROJECT_ID: 'Project Google Cloud tempat query BigQuery dijalankan dan ditagih (sayakaya).',
  GOOGLE_APPLICATION_CREDENTIALS: 'Path file kunci service account Google untuk pengembangan lokal. Tidak dipakai di Cloud Run.',
  GCP_SA_KEY: 'Isi lengkap kunci service account (JSON) sebagai satu variabel, untuk host yang tidak bisa menyimpan file (Supabase, Netlify).',
  PORT: 'Port server lokal (default 8080).',
  MAX_BYTES_BILLED: 'Batas byte yang boleh ditagih per query BigQuery, pengaman biaya.',
  BQ_LOCATION: 'Lokasi dataset BigQuery (asia-southeast2, Jakarta).',
  APP_PASSWORD: 'Sisa sistem login lama; tidak dipakai lagi.',
  ANTHROPIC_API_KEY: 'Kunci API Anthropic untuk fitur Ask. Kosong = fitur Ask mati.',
  ANTHROPIC_MODEL: 'Model Claude yang dipakai fitur Ask (opsional).',
  SUPABASE_URL: 'Alamat project Supabase (akun, sesi, jadwal, log).',
  SUPABASE_SERVICE_ROLE_KEY: 'Kunci server Supabase; rahasia, hanya di server.',
  GSHEET_TRACKER_ID: 'Id Google Sheet tujuan ekspor portofolio. Sheet harus dibagikan ke service account sebagai Editor.',
  SMTP_HOST: 'Server SMTP Amazon SES untuk mengirim email.',
  SMTP_PORT: 'Port SMTP (587).',
  SMTP_USER: 'Username SMTP SES (bukan access key IAM biasa).',
  SMTP_PASS: 'Password SMTP SES.',
  SMTP_FROM: 'Alamat pengirim email; harus identitas yang sudah diverifikasi di SES.',
  CRON_SECRET: 'Kunci rahasia yang wajib dikirim pemanggil endpoint cron (jadwal email, latih ulang model) di header X-Cron-Key.',
  SES_WEBHOOK_SECRET: 'Kunci rahasia di URL webhook SNS untuk event email (terkirim, dibuka, diklik).',
  SES_CONFIGURATION_SET: 'Configuration set SES untuk pelacakan email. Biarkan kosong sampai configuration set itu benar-benar ada di SES, karena SES menolak email yang menyebut configuration set yang tidak ada.',
};

// Inside each tab, in plain words: a sentence or two per panel, the few
// columns whose meaning is not obvious from their name, and caveats. Panel
// keys are the panel title as shown in English (or #tableId for a panel
// without a title). The generator adds the Indonesian label of each panel
// and column, and warns when a key or label no longer exists in the app.
const TAB_DETAILS = {
  overview: {
    kpis: [
      ['Platform AUM', 'Total nilai kepemilikan semua investor pada tanggal "Platform AUM as of" (snapshot harian portfolio_with_code, hanya fund yang masih ACTIVE). Baris kecil di bawahnya: jumlah investor yang memegang unit pada tanggal itu.'],
      ['Total investors', 'Jumlah SID unik yang memegang unit pada tanggal AUM tersebut. Di bawahnya: total akun terdaftar dan berapa yang sudah KYC verified (persen dari total akun).'],
      ['Buy volume (range)', 'Jumlah final_amount pembelian berstatus completed yang dibuat dalam rentang tanggal di atas, beserta jumlah transaksinya.'],
      ['Active users (range)', 'Pengguna unik yang punya minimal satu transaksi (tipe dan status apa pun) dalam rentang tanggal.'],
      ['New users (30d)', 'Akun baru dalam 30 hari terakhir dihitung dari hari ini, tidak mengikuti rentang tanggal.'],
    ],
    panels: {
      'Transaction volume': { note: 'Volume beli dan jual (completed) per hari, minggu, atau bulan, dengan garis jumlah pengguna aktif.', },
      'By transaction type': { note: 'Jumlah transaksi per tipe dalam rentang: buy, sell, SWITCH_IN, SWITCH_OUT, reinvestment. Semua status ikut dihitung.', },
      'By status': { note: 'Jumlah transaksi per status dalam rentang: completed, expired, cancelled, completed_payment, verified, dan lainnya.', },
      'User verification': { note: 'Semua akun per status KYC (unverified, verified, failed, pending_verification). Tidak mengikuti rentang tanggal.', },
      'AUM by fund type': { note: 'Dana nasabah Sayakaya per jenis fund: unit yang dipegang hari ini (termasuk unit kampanye yang masih terkunci) dikali NAV terbaru. Totalnya seharusnya sama dengan kartu Platform AUM pada tanggal data terbaru; selisih kecil bisa muncul karena kartu itu memakai snapshot harian.', },
      'Investor distribution by province': { note: 'Peta per provinsi berdasarkan kota di KTP (user_profiles.id_address_city dicocokkan ke main.geo). Arahkan kursor untuk jumlah orang dan AUM live.', },
      'Top cities by investors': { note: '15 kota dengan pengguna terbanyak menurut alamat KTP.', columns: [
        ['Investors', 'Jumlah orang dengan alamat KTP di kota itu. Tanpa filter fund, ini mencakup semua pengguna yang sudah mengisi alamat, termasuk yang belum memegang unit.'],
      ],
      },
      'Top cities by AUM': { note: '15 kota dengan nilai kepemilikan terbesar.', columns: [
        ['AUM', 'Nilai kepemilikan live orang-orang di kota itu: unit saat ini (main.portfolios) dikali NAV terbaru fund.'],
      ],
      },
      'Largest funds by AUM': { note: 'Semua fund (atau manajer investasi) yang dipegang nasabah pada tanggal terpilih, dari yang terbesar. Fund bisa dikeluarkan dari hitungan lewat pilihan fund.', columns: [
        ['AUM', 'Jumlah nilai kepemilikan nasabah Sayakaya di fund itu pada tanggal AUM (portfolio_with_code).'],
      ],
      },
    },
    notes: [
      'Tab ini memakai dua sumber AUM: snapshot portfolio_with_code (kartu Platform AUM, Largest funds) dan kepemilikan live (AUM by fund type, peta, tabel kota). Keduanya hanya dana nasabah Sayakaya; selisih kecil wajar karena snapshot dan NAV terbaru bisa berbeda hari.',
      'Rentang tanggal di bagian atas hanya berlaku untuk angka transaksi (volume, pengguna aktif, grafik tren, tipe, status). Platform AUM punya tanggalnya sendiri.',
      'Tanggal transaksi memakai tanggal created_at dalam UTC, jadi transaksi pukul 00:00 sampai 06:59 WIB tercatat di hari sebelumnya.',
    ],
  },
  aum: {
    panels: {
      'AUM & revenue history': { note: 'Garis AUM platform per hari atau bulan dan batang revenue AperD per periode, dari mi_fee_logs.mi_fee (hanya fund ACTIVE).', },
      'What moved AUM': { note: 'Memecah perubahan AUM tiap periode menjadi arus bersih (beli dikurangi jual) dan efek pasar (sisanya). Klik batang untuk rincian per fund.', },
      Detail: { note: 'Angka per periode di balik grafik, dengan baris total di bawah.', columns: [
        ['AUM', 'AUM platform pada hari terakhir periode itu (bukan jumlah harian).'],
        ['Δ AUM', 'Perubahan AUM dibanding periode sebelumnya.'],
        ['Net flow', 'Pembelian completed dikurangi penjualan completed pada periode itu. Tanggal transaksi digeser +1 hari karena baris mi_fee hari D sudah memuat transaksi hari D-1.'],
        ['Market effect', 'Δ AUM dikurangi Net flow: pergerakan NAV, reinvestasi, dan unit bonus. Kosong di baris pertama karena tidak ada periode pembanding.'],
        ['Revenue', 'Jumlah aperd_share_per_day: bagian fee manajemen yang menjadi hak Sayakaya sebagai agen penjual.'],
      ],
      },
      '#aumDrillTable': { title: 'Rincian per fund (setelah klik batang)', note: 'Fund mana yang menggerakkan AUM pada periode yang diklik, diurutkan dari perubahan terbesar.', columns: [
        ['Switch (net)', 'Switch masuk dikurangi switch keluar. Secara platform hampir nol, tetapi per fund bisa besar.'],
        ['Market effect', 'Sisa perubahan setelah dikurangi beli, jual, dan switch: efek NAV.'],
      ],
      },
    },
  },
  'revenue-trend': {
    panels: {
      'Revenue trend': { note: 'Revenue AperD per hari, minggu (mulai hari Minggu), atau bulan, dihitung sama persis dengan tab Revenue (PWC).', },
      'What moved revenue': { note: 'Memecah perubahan revenue dibanding periode sebelumnya menjadi tiga efek. Klik baris atau batang untuk rincian per fund.', },
      Detail: { note: 'Angka per periode di balik grafik. Klik baris untuk melihat fund penyebab perubahannya.', columns: [
        ['vs previous', 'Persen perubahan revenue dibanding periode sebelumnya.'],
        ['Days effect', 'Bagian perubahan yang datang dari beda jumlah hari (misalnya Februari lebih pendek, atau periode terpotong).'],
        ['AUM effect', 'Bagian perubahan dari naik turunnya rata-rata AUM, dihitung dengan rate periode sebelumnya.'],
        ['Rate & mix effect', 'Sisanya: perubahan rate fee dan pergeseran dana ke fund dengan fee lebih tinggi atau rendah.'],
      ],
      },
    },
    notes: [
      'Ketiga efek selalu berjumlah persis sama dengan perubahan revenue, sehingga bisa dibaca sebagai "penyebab" perubahan.',
    ],
  },
  performance: {
    panels: {
      'Fund performance trend': { note: 'Grafik NAV harian fund yang dipilih (main.snapshots tipe NAV).', },
      'Fund performance by type': { note: 'Ringkasan imbal hasil NAV per jenis fund untuk delapan periode.', columns: [
        ['1D, 1W, 1M, 3M, YTD, 1Y, 3Y, 5Y', 'Rata-rata persen perubahan NAV fund-fund jenis itu selama periode tersebut. Hijau naik, merah turun.'],
      ],
      },
      'Fund detail': { note: 'Imbal hasil NAV setiap fund, bisa disaring per jenis dan dihitung per tanggal tertentu. Kalimat di atas tabel menyebut fund terbaik dan terburuk 1 bulan.', columns: [
        ['Tanggal Emisi', 'Tanggal fund pertama kali diterbitkan (funds.ipo_date).'],
        ['1D sampai 5Y', 'Persen perubahan NAV fund itu: (NAV terakhir dikurangi NAV pada awal periode) dibagi NAV awal periode.'],
      ],
      },
    },
    notes: [
      'Periode dihitung mundur dari tanggal NAV terbaru masing-masing fund, bukan dari hari ini. Bila NAV awal periode tidak ada tepat di tanggalnya, dipakai NAV terdekat sebelumnya; fund yang lebih muda dari periodenya tampil n/a.',
    ],
  },
  growth: {
    panels: {
      'Campaign performance': { note: 'Pemakaian dan perkiraan biaya setiap kampanye promo.', columns: [
        ['Redemption', 'Used dibagi Quota, dalam persen.'],
        ['Est. cost', 'Perkiraan biaya: Used dikali Bonus/redemption.'],
      ],
      },
      'Top referrers': { note: 'Pengajak yang membawa volume pembelian terbesar.', columns: [
        ['Referred', 'Jumlah akun yang mendaftar dengan kode itu (users.referrer_code), terverifikasi atau belum.'],
        ['Volume brought', 'Total seluruh pembelian completed sepanjang masa dari akun-akun yang diajak.'],
      ],
      },
      'AUM by investment manager': { note: 'Dana nasabah Sayakaya per manajer investasi (15 teratas): unit yang dipegang hari ini, termasuk unit kampanye yang masih terkunci, dikali NAV terbaru. Persentase tiap irisan dihitung dari total manajer yang tampil.', },
      'Platform AUM by risk tolerance': { note: 'Kepemilikan live nasabah Sayakaya dikelompokkan menurut user_profiles.investment_risk_tolerance.', },
    },
    notes: [
      'Data penghasilan dan toleransi risiko di profil hampir semuanya kosong, jadi panel income bracket dan risk tolerance hampir seluruhnya berisi "(unknown)".',
      'Panel kampanye, referrer, dan switching tidak mengikuti rentang tanggal: semuanya sepanjang masa.',
    ],
  },
  predict: {
    panels: {
      'Model status': { note: 'Kapan model terakhir dilatih, dan tombol Retrain now untuk melatih ulang. Jadwal bulanannya ada di Netlify, jadi cek tanggal di panel ini untuk memastikan masih berjalan.', },
      'AUM forecast': { note: 'AUM harian historis dan perkiraan ke depan dari model ARIMA_PLUS (sayakaya.ml.aum_forecast), dengan rentang ketidakpastian (batas bawah dan atas).', },
      'Transaction (buy volume) forecast': { note: 'Volume pembelian completed harian dan perkiraannya (sayakaya.ml.tx_forecast), memperhitungkan hari libur Indonesia.', },
      'Churn risk (current holders)': { note: 'Investor yang masih memegang unit, diurutkan dari risiko churn tertinggi.', columns: [
        ['Churn prob', 'Peluang (0 sampai 100%) investor ini akan menjual habis semua unitnya, menurut model regresi logistik.'],
        ['Risk', 'High = 50% ke atas, Medium = 20% sampai 50%, Low = di bawah 20%.'],
        ['Recency', 'Hari sejak transaksi completed terakhir.'],
      ],
      },
      'Churn rate by tenure': { note: 'Seberapa banyak investor yang sudah keluar, dikelompokkan menurut lama sejak pembelian pertama.', columns: [
        ['Tenure', 'Lama sejak pembelian pertama: 0-3 bulan, 3-6 bulan, 6-12 bulan, lebih dari 12 bulan.'],
        ['Churn rate', 'Churned dibagi Investors.'],
      ],
      },
      'Churn overview': { note: 'Overall churn rate = orang yang pernah membeli tetapi sekarang tidak memegang apa pun, dibagi semua orang yang pernah membeli. Active holders = yang sekarang memegang minimal satu fund.', },
      'Retention cohorts': { note: 'Setiap baris adalah cohort bulan transaksi completed pertama. Kolom M0, M1, M2, dan seterusnya: persen anggota cohort yang punya transaksi completed lagi pada bulan ke-n sesudahnya. Size = jumlah anggota cohort.', },
      'AUM retention cohorts': { note: 'Cohort berdasarkan bulan pertama SID itu punya AUM (mi_fee_logs.portfolios). Bulan ke-n dihitung bertahan bila arus bersih kumulatif (beli dikurangi jual sejak bulan cohort) masih nol atau positif.', },
    },
    notes: [
      '"Churn" di sini berarti pernah membeli tetapi sekarang sudah tidak memegang unit sama sekali. Model tidak memakai AUM saat ini sebagai fitur karena itu sama saja dengan membocorkan jawabannya.',
    ],
  },
  portfolio: {
    kpis: [
      ['Total AUM', 'Jumlah Market Value semua kepemilikan investor ini, beserta jumlah fund yang dipegang.'],
      ['Regular portfolio', 'Bagian dari unit hasil pembelian sendiri (main.portfolios). Tidak tersedia untuk tanggal lampau.'],
      ['Bonus portfolio', 'Bagian dari unit bonus kampanye yang masih on_going (main.bonus_portfolios). Tidak tersedia untuk tanggal lampau.'],
    ],
    panels: {
      'Bulk export': { note: 'Kumpulkan beberapa investor (per kode referral atau sales, atau satu per satu) untuk melihat AUM gabungannya atau mengekspor portofolio mereka sekaligus. Kontak hanya tampil di layar, tidak ikut file ekspor.', },
      'AUM over time': { note: 'AUM harian investor ini dari mi_fee_logs.portfolio_with_code (data mulai 14 Januari 2026).', },
      Holdings: { note: 'Tanpa tanggal: kepemilikan live (unit bonus ikut) dengan harga beli dari portfolios.initial_price. Dengan tanggal: snapshot portfolio_with_code pada tanggal itu.', columns: [
        ['Average NAV', 'Harga beli rata-rata per unit (sumbernya berbeda per tab, lihat catatan tab).'],
        ['Fund Value', 'Modal: Unit Balance dikali Average NAV.'],
        ['Unrealized G/L', 'Untung atau rugi yang belum direalisasikan: Market Value dikurangi Fund Value. Hijau untung, merah rugi.'],
        ['%', 'Unrealized G/L dibagi Fund Value. Di baris Total hanya menghitung fund yang harga beli rata-ratanya diketahui.'],
      ],
      },
      'AUM performance': { note: 'Persen perubahan total AUM investor ini dibanding 1 hari, 1 minggu, 1, 3 bulan, awal tahun, 1, 3, dan 5 tahun sebelum data terakhirnya.', },
    },
    notes: [
      'AUM performance adalah perubahan nilai total, sehingga setoran dan penarikan ikut terhitung. Investor yang menambah dana akan terlihat "naik" walau NAV turun. Untuk imbal hasil investasi, lihat kolom % di Holdings.',
      'Harga beli rata-rata dari portfolios.initial_price bisa berbeda dari harga beli sebenarnya untuk sebagian investor. Untuk harga beli yang dikoreksi lihat Portfolio Explorer (Main), untuk yang dihitung dari ledger transaksi lihat Portfolio (TX).',
    ],
  },
  'portfolio-fix': {
    kpis: [
      ['Total AUM', 'Jumlah Market Value semua kepemilikan investor ini, beserta jumlah fund yang dipegang.'],
      ['Regular portfolio', 'Bagian dari unit hasil pembelian sendiri (main.portfolios). Tidak tersedia untuk tanggal lampau.'],
      ['Bonus portfolio', 'Bagian dari unit bonus kampanye yang masih on_going (main.bonus_portfolios). Tidak tersedia untuk tanggal lampau.'],
    ],
    panels: {
      'Bulk export': { note: 'Kumpulkan beberapa investor (per kode referral atau sales, atau satu per satu) untuk melihat AUM gabungannya atau mengekspor portofolio mereka sekaligus. Kontak hanya tampil di layar, tidak ikut file ekspor.', },
      'AUM over time': { note: 'AUM harian investor ini dari mi_fee_logs.portfolio_fix (data mulai awal Agustus 2026).', },
      Holdings: { note: 'Dengan tanggal: snapshot portfolio_fix, yang harga beli rata-ratanya sudah dikoreksi. Tanpa tanggal: kepemilikan live. Centang Export memilih fund yang ikut file ekspor.', columns: [
        ['Average NAV', 'Harga beli rata-rata per unit (sumbernya berbeda per tab, lihat catatan tab).'],
        ['Fund Value', 'Modal: Unit Balance dikali Average NAV.'],
        ['Unrealized G/L', 'Untung atau rugi yang belum direalisasikan: Market Value dikurangi Fund Value. Hijau untung, merah rugi.'],
        ['%', 'Unrealized G/L dibagi Fund Value. Di baris Total hanya menghitung fund yang harga beli rata-ratanya diketahui.'],
      ],
      },
      'AUM performance': { note: 'Persen perubahan total AUM investor ini dibanding 1 hari, 1 minggu, 1, 3 bulan, awal tahun, 1, 3, dan 5 tahun sebelum data terakhirnya.', },
    },
    notes: [
      'AUM performance adalah perubahan nilai total, sehingga setoran dan penarikan ikut terhitung. Investor yang menambah dana akan terlihat "naik" walau NAV turun. Untuk imbal hasil investasi, lihat kolom % di Holdings.',
    ],
  },
  'portfolio-tx': {
    kpis: [
      ['Total AUM', 'Jumlah Market Value semua kepemilikan investor ini, beserta jumlah fund yang dipegang.'],
      ['Regular portfolio', 'Bagian dari unit hasil pembelian sendiri (main.portfolios). Tidak tersedia untuk tanggal lampau.'],
      ['Bonus portfolio', 'Bagian dari unit bonus kampanye yang masih on_going (main.bonus_portfolios). Tidak tersedia untuk tanggal lampau.'],
    ],
    panels: {
      'Bulk export': { note: 'Kumpulkan beberapa investor (per kode referral atau sales, atau satu per satu) untuk melihat AUM gabungannya atau mengekspor portofolio mereka sekaligus. Kontak hanya tampil di layar, tidak ikut file ekspor.', },
      'AUM over time': { note: 'AUM harian investor ini dari mi_fee_logs.portfolio_fix.', },
      Holdings: { note: 'Harga beli rata-rata dihitung ulang dari riwayat transaksi: hanya pembelian dan switch masuk yang mengubah rata-rata, penjualan hanya mengurangi unit. Centang Export memilih fund yang ikut file ekspor.', columns: [
        ['Average NAV', 'Harga beli rata-rata per unit (sumbernya berbeda per tab, lihat catatan tab).'],
        ['Fund Value', 'Modal: Unit Balance dikali Average NAV.'],
        ['Unrealized G/L', 'Untung atau rugi yang belum direalisasikan: Market Value dikurangi Fund Value. Hijau untung, merah rugi.'],
        ['%', 'Unrealized G/L dibagi Fund Value. Di baris Total hanya menghitung fund yang harga beli rata-ratanya diketahui.'],
      ],
      },
      'AUM performance': { note: 'Persen perubahan total AUM investor ini dibanding 1 hari, 1 minggu, 1, 3 bulan, awal tahun, 1, 3, dan 5 tahun sebelum data terakhirnya.', },
    },
    notes: [
      'AUM performance adalah perubahan nilai total, sehingga setoran dan penarikan ikut terhitung. Investor yang menambah dana akan terlihat "naik" walau NAV turun. Untuk imbal hasil investasi, lihat kolom % di Holdings.',
      'Unit bonus hanya tersedia live, tidak untuk tanggal lampau.',
    ],
  },
  'portfolio-sinvest': {
    kpis: [
      ['Total AUM', 'Jumlah Market Value semua kepemilikan investor ini, beserta jumlah fund yang dipegang.'],
      ['Regular portfolio', 'Bagian dari unit hasil pembelian sendiri (main.portfolios). Tidak tersedia untuk tanggal lampau.'],
      ['Bonus portfolio', 'Bagian dari unit bonus kampanye yang masih on_going (main.bonus_portfolios). Tidak tersedia untuk tanggal lampau.'],
    ],
    panels: {
      'Bulk export': { note: 'Kumpulkan beberapa investor (per kode referral atau sales, atau satu per satu) untuk melihat AUM gabungannya atau mengekspor portofolio mereka sekaligus. Kontak hanya tampil di layar, tidak ikut file ekspor.', },
      'AUM over time': { note: 'AUM harian investor ini dari mi_fee_logs.portfolio_fix.', },
      Holdings: { note: 'Kepemilikan dihitung dari catatan kustodian (S-INVEST) dengan aturan yang sama seperti Portfolio (TX), untuk mengecek apakah catatan aplikasi cocok dengan kustodian.', columns: [
        ['Average NAV', 'Harga beli rata-rata per unit (sumbernya berbeda per tab, lihat catatan tab).'],
        ['Fund Value', 'Modal: Unit Balance dikali Average NAV.'],
        ['Unrealized G/L', 'Untung atau rugi yang belum direalisasikan: Market Value dikurangi Fund Value. Hijau untung, merah rugi.'],
        ['%', 'Unrealized G/L dibagi Fund Value. Di baris Total hanya menghitung fund yang harga beli rata-ratanya diketahui.'],
      ],
      },
      'AUM performance': { note: 'Persen perubahan total AUM investor ini dibanding 1 hari, 1 minggu, 1, 3 bulan, awal tahun, 1, 3, dan 5 tahun sebelum data terakhirnya.', },
    },
    notes: [
      'AUM performance adalah perubahan nilai total, sehingga setoran dan penarikan ikut terhitung. Investor yang menambah dana akan terlihat "naik" walau NAV turun. Untuk imbal hasil investasi, lihat kolom % di Holdings.',
      'Semua kolom di sinvest.trx_history bertipe teks; tanggal (YYYYMMDD) dan nominal di-parse dulu, jadi data yang formatnya rusak bisa terlewat.',
    ],
  },
  'portfolio-explorer': {
    kpis: [
      ['Total AUM (as of date)', 'Jumlah Market Value semua kepemilikan investor ini pada tanggal snapshot (main.goal_snapshots), beserta jumlah fund.'],
      ['Goals', 'Jumlah goal (tujuan investasi di aplikasi) yang punya kepemilikan pada tanggal itu.'],
    ],
    panels: {
      'Bulk export': { note: 'Kumpulkan beberapa investor (per kode referral atau sales, atau satu per satu) untuk melihat AUM gabungannya atau mengekspor portofolio mereka sekaligus. Kontak hanya tampil di layar, tidak ikut file ekspor.', },
      'Holdings by fund': { note: 'Kepemilikan digabung per fund dari semua goal, pada tanggal snapshot terpilih (default: terbaru).', columns: [
        ['Average NAV', 'Harga beli rata-rata per unit (sumbernya berbeda per tab, lihat catatan tab).'],
        ['Fund Value', 'Modal: Unit Balance dikali Average NAV.'],
        ['Unrealized G/L', 'Untung atau rugi yang belum direalisasikan: Market Value dikurangi Fund Value. Hijau untung, merah rugi.'],
        ['%', 'Unrealized G/L dibagi Fund Value. Di baris Total hanya menghitung fund yang harga beli rata-ratanya diketahui.'],
      ],
      },
      'Holdings by goal': { note: 'Kepemilikan yang sama dipisah per goal (tujuan investasi yang dibuat investor di aplikasi). Hanya tampilan; ekspor tetap digabung.', },
    },
    notes: [
      'Sumber "GS" (main.goal_snapshots) dan "PWC" (portfolio_with_code) dihitung oleh pipeline yang berbeda, jadi angkanya bisa sedikit berbeda untuk investor yang sama.',
    ],
  },
  hnwi: {
    panels: {
      Filters: { note: 'Pilih tanggal AUM dan rentang AUM minimum dan maksimum. Panel per fund punya filter AUM per fund sendiri.', },
      'AUM per investor (total)': { note: 'Investor dengan total AUM dalam rentang pilihan, dari yang terbesar (maksimal 500), lengkap dengan kontak dan profil risiko.', columns: [
        ['Risk level', 'Hasil kuesioner profil risiko di aplikasi (user_profiles.risk_level, 1 sampai 6).'],
        ['Investment risk tolerance', 'Toleransi risiko yang diisi saat KYC (sering kosong).'],
      ],
      },
    },
    notes: [
      'Sumber AUM: mi_fee_logs.portfolio_with_code. Kolom kontak (nama sampai tanggal lahir) juga ada di tabel per fund.',
    ],
  },
  'top-investors': {
    panels: {
      'Top investors': { note: 'Peringkat investor menurut pembelian, penjualan, atau net deposit dalam rentang tanggal.', columns: [
        ['% of all subscriptions', 'Porsi investor ini dari total pembelian semua investor dalam rentang (bukan hanya baris yang tampil).'],
        ['Net deposit', 'Subscriptions dikurangi Redemptions. Positif = uang masuk bersih, negatif = uang keluar bersih.'],
      ],
      },
      'Short version': { note: 'Versi ringkas dari tabel di atas yang bisa diurutkan per kolom, untuk disalin ke laporan.', columns: [
        ['Net increase', 'Buys dikurangi Sell.'],
      ],
      },
    },
    notes: [
      'Mode Net deposit menurun hanya menampilkan net positif (penabung terbesar); menaik hanya net negatif (penarik terbesar).',
    ],
  },
  'user-lifetime': {
    panels: {
      'Revenue & investors over time': { note: 'Revenue fee (mgmt fee, AperD, MI) dan jumlah investor per periode.', },
      'Revenue & lifetime per investor': { note: 'Satu baris per investor (maksimal 200), diurutkan dari Total AperD terbesar. Klik baris untuk rincian per bulan dan fund.', columns: [
        ['Transacting span (d)', 'Hari dari transaksi pertama sampai terakhir.'],
        ['Holding lifetime (d)', 'Hari dari pembelian pertama sampai hari ini (bila masih memegang) atau sampai penjualan terakhir.'],
        ['First hold (feed)', 'Hari pertama investor ini muncul di snapshot portfolio_with_code dalam rentang.'],
        ['Total AperD', 'Bagian fee untuk Sayakaya (agen penjual).'],
      ],
      },
      Investor: { note: 'Rincian investor yang diklik, per periode dan fund.', columns: [
        ['Mgmt fee rate', 'Rate fee manajemen tahunan yang berlaku.'],
      ],
      },
      'Period summary (all funds)': { note: 'Rekap revenue fee semua investor per periode.', columns: [
        ['AperD per investor', 'Total AperD dibagi jumlah investor.'],
      ],
      },
    },
    notes: [
      'Kolom uang memakai perhitungan yang sama dengan Revenue (PWC): AUM harian dikali rate fee. Tanggal daftar, beli pertama, dan transaksi diambil dari database utama karena snapshot portfolio_with_code baru mulai 14 Januari 2026.',
    ],
  },
  dormant: {
    kpis: [
      ['Dormancy episodes', 'Jumlah jeda lebih dari 14 hari di antara dua pembelian berturut-turut seorang investor, semua panjang jeda, termasuk yang belum berakhir.'],
      ['Episodes converted', 'Jeda yang ditutup oleh pembelian berikutnya.'],
      ['Conversion rate', 'Episodes converted dibagi Dormancy episodes.'],
      ['Reactivation revenue', 'Total nominal pembelian yang menutup setiap jeda.'],
    ],
    panels: {
      'Conversion by dormancy length': { note: 'Berapa jeda pembelian yang akhirnya ditutup pembelian baru, per panjang jeda.', columns: [
        ['Dormancy length', 'Kelompok panjang jeda: 2 Weeks, 1 Month, 2 Month, 3 Month. Jeda 180 hari ke atas dibuang karena dianggap churn.'],
        ['Conversion', 'Converted dibagi Episodes.'],
      ],
      },
      'Repeat buyers': { note: 'Investor yang pernah kembali membeli setelah jeda, beserta seberapa sering mereka membeli.', columns: [
        ['Longest dormancy recovered', 'Kelompok jeda terpanjang yang pernah dia tutup dengan membeli lagi.'],
        ['Buyer type', 'One-time (1 pembelian), Light (2 sampai 3), atau Power (4 ke atas), dihitung dari pembelian completed sepanjang masa.'],
      ],
      },
    },
    notes: [
      'Tab ini tidak punya filter tanggal: dihitung dari seluruh riwayat pembelian completed. Tabel daftar maksimal 1.000 baris.',
    ],
  },
  'users-tx': {
    panels: {
      'Users transactions': { note: 'Cari investor (SID, email, atau nama, sebagian kata cukup) dan saring menurut tipe, status, fund, dan tanggal. Ekspor CSV, Excel, atau PDF.', },
      'Transaction detail': { note: 'Satu baris per transaksi, terbaru di atas, dengan kontak pembeli.', columns: [
        ['Type', 'buy (pembelian), sell (penjualan), SWITCH_IN dan SWITCH_OUT (dua sisi switching), reinvestment (pembagian hasil yang diinvestasikan ulang).'],
        ['Status', 'completed (selesai), expired (batas bayar habis), cancelled (dibatalkan), completed_payment (uang diterima, unit belum dialokasikan), verified, verified_by_operational, dan lainnya.'],
        ['NAV', 'Harga per unit yang dipakai untuk transaksi itu (value_per_unit).'],
        ['Final amount', 'Nominal akhir setelah fee dan promo. Untuk order yang tidak dibayar biasanya 0.'],
      ],
      },
    },
    notes: [
      'Semua status ikut tampil kecuali disaring. Untuk angka bisnis (volume, revenue) biasanya hanya status completed yang dihitung.',
    ],
  },
  'sinvest-tx': {
    panels: {
      'SInvest transactions': { note: 'Data mentah dari kustodian (sinvest.trx_history), bisa disaring per SID, kata kunci, tipe, dan tanggal.', },
      'Transaction detail': { note: 'Satu baris per transaksi di feed kustodian.', columns: [
        ['Type', 'Tipe transaksi kustodian: BUY, SELL, SWITCH_IN, SWITCH_OUT, REINVESTMENT, LIQUIDATION, TRANSFER_IN, TRANSFER_OUT, UNIT_ADJUSTMENT (kode 1 sampai 9 di data asli).'],
        ['Input date', 'Tanggal transaksi diinput ke sistem kustodian (dipakai tab Reconciliation).'],
      ],
      },
    },
    notes: [
      'Semua kolom di sumbernya bertipe teks; tanggal dan nominal diubah formatnya hanya untuk tampilan.',
    ],
  },
  'remisier-tx': {
    panels: {
      'Remisier transactions': { note: 'Transaksi milik nasabah seorang remisier, dipilih lewat referrer_code atau sales_code, plus filter tipe, status, dan tanggal.', },
      'Transaction detail': { note: 'Satu baris per transaksi nasabah remisier.', columns: [
        ['Status', 'completed (selesai), expired (batas bayar habis), cancelled (dibatalkan), completed_payment (uang diterima, unit belum dialokasikan), verified, verified_by_operational, dan lainnya.'],
        ['Final amount', 'Nominal akhir setelah fee dan promo. Untuk order yang tidak dibayar biasanya 0.'],
        ['Realized G/L', 'Untung atau rugi yang terealisasi saat menjual (dari main.transactions.realized_gain_loss).'],
      ],
      },
    },
  },
  reconciliation: {
    panels: {
      'App ledger vs custodian feed': { note: 'Perbandingan harian jumlah dan nominal transaksi antara aplikasi dan kustodian, per tipe.', columns: [
        ['Date', 'Tanggal. Sisi aplikasi memakai tanggal transaksi selesai (completed_at); sisi kustodian memakai Input_Date.'],
        ['Type', 'Tipe transaksi. Baris ALL menjumlah semua tipe di tanggal itu.'],
        ['Diff', 'App amount dikurangi Custodian amount. Nol berarti cocok.'],
      ],
      },
    },
    notes: [
      'Liquidation, transfer, dan unit adjustment belum dibukukan di aplikasi, jadi tipe-tipe itu hanya punya angka di sisi kustodian; selisihnya bukan berarti salah.',
    ],
  },
  'send-statement': {
    panels: {
      'Portfolio preview': { note: 'Isi lampiran portofolio sebelum dikirim: tanpa tanggal memakai kepemilikan live (unit dikali NAV terbaru, harga beli dari portfolios.initial_price); dengan tanggal memakai snapshot portfolio_fix pada tanggal itu.', },
      'Transaction e-statement preview': { note: 'Transaksi berstatus completed, verified, atau completed_payment pada bulan terpilih yang akan masuk e-statement.', },
      'Batch send': { note: 'Kirim dokumen yang sama ke banyak investor sekaligus: cari per nama (* sebagai wildcard), SID, email, atau nomor HP, atau tempel daftar email/SID. Satu email per penerima.', },
      'Automated sending': { note: 'Jadwal kirim berulang. Membuat jadwal meminta kode OTP lewat email. Jadwal selalu memakai portofolio live dan e-statement bulan lalu.', columns: [
        ['Sends', 'Apa yang dikirim: Portfolio, E-statement, atau Fund performance beserta cakupan fund-nya.'],
        ['Status', 'Active (berjalan), Paused (dijeda), Ended (melewati tanggal akhir).'],
      ],
      },
    },
    notes: [
      'PDF dikunci dengan tanggal lahir investor (format DDMMYYYY).',
      'Setiap pengiriman dicatat di tab Email recap (sampai, dibuka, diklik) dan di Activity log.',
    ],
  },
  'send-fund-performance': {
    panels: {
      Recipients: { note: 'Daftar penerima: cari investor per nama, SID, email, atau nomor HP, atau tempel daftar email.', },
      'Fund performance report': { note: 'PDF "Reksa Dana Update": persen perubahan NAV per periode (sama dengan tab Performance) untuk semua fund, kategori tertentu, atau fund pilihan, dengan NAV per tanggal terpilih.', },
      'Automated sending': { note: 'Jadwal kirim laporan performa fund berulang.', columns: [
        ['Sends', 'Apa yang dikirim: Portfolio, E-statement, atau Fund performance beserta cakupan fund-nya.'],
        ['Status', 'Active (berjalan), Paused (dijeda), Ended (melewati tanggal akhir).'],
      ],
      },
    },
    notes: [
      'Bila filter fund tidak cocok dengan fund mana pun, pengiriman gagal alih-alih mengirim PDF kosong.',
    ],
  },
  'email-recap': {
    kpis: [
      ['Sent', 'Email yang diterima server SES untuk dikirim; di bawahnya yang gagal dikirim dan jumlah penerima unik.'],
      ['Delivered', 'Email yang dilaporkan SES sampai ke server penerima (persen dari Sent).'],
      ['Opened', 'Email yang dibuka minimal sekali (persen dari Delivered) dan total kali dibuka.'],
      ['Clicked', 'Email yang tautannya diklik minimal sekali (persen dari Delivered dan dari yang membuka).'],
      ['Bounced', 'Email yang ditolak server penerima (alamat salah atau penuh).'],
      ['Marked as spam', 'Penerima menandai email sebagai spam.'],
    ],
    panels: {
      'Emails per day': { note: 'Batang: email terkirim per hari (WIB). Garis: yang dibuka dan diklik, tetap dicatat di hari email dikirim.', },
      'By category': { note: 'Hasil pengiriman per jenis email.', columns: [
        ['Category', 'Jenis email: E-statement & portfolio, Fund performance, Account invite, Password reset, Schedule confirmation code, Other sender.'],
        ['Open rate', 'Opened dibagi Delivered.'],
        ['Click rate', 'Clicked dibagi Delivered.'],
      ],
      },
      'By subject': { note: 'Satu baris per subjek dan kategori; jadwal berulang dengan subjek sama digabung.', },
      'Every email': { note: 'Satu baris per email, bisa dicari dan disaring per hasil. Tombol di ujung baris membuka riwayat event email itu.', columns: [
        ['Category', 'Jenis email.'],
        ['Sent from', 'Asal kiriman: Manual send, Batch send, Schedule, Account emails, Script.'],
        ['Outcome', 'Status terakhir: Sent (belum ada kabar), Delivered, Opened, Clicked, Bounced, Marked as spam, Rejected by SES, Failed to send.'],
      ],
      },
    },
    notes: [
      'Data dari Supabase (dashboard_email_log dan dashboard_email_events), bukan BigQuery.',
      'Sampai, dibuka, dan diklik hanya terisi setelah pelacakan Amazon SES disambungkan (lihat kalimat status di atas tab). "Dibuka" bergantung pada gambar pelacak yang bisa diblokir aplikasi email, jadi angka sebenarnya bisa lebih tinggi.',
      'Kiriman sebelum 8 Oktober 2026 diisi ulang dari antrean jadwal dan activity log, tanpa data sampai atau dibuka.',
    ],
  },
  revenue: {
    panels: {
      'Revenue trend': { note: 'Total fee manajemen, bagian AperD, dan bagian MI per periode.', },
      'Management fee revenue (per fund, per period)': { note: 'Fee dihitung per hari: AUM fund hari itu (mi_fee_logs.portfolio_with_code, dengan koreksi -1 hari) dikali rate tahunan, dibagi jumlah hari dalam tahun itu, lalu dibagi menjadi bagian AperD dan MI.', columns: [
        ['Mgmt fee rate', 'Rate fee manajemen per tahun yang dibebankan fund (misalnya 1,5%).'],
        ['AperD share', 'Porsi fee manajemen yang menjadi hak Sayakaya sebagai agen penjual.'],
        ['MI share', 'Porsi fee manajemen yang menjadi hak manajer investasi.'],
        ['AUM EOM', 'AUM pada hari terakhir periode (end of month).'],
        ['Total AperD', 'Revenue Sayakaya: jumlah fee harian bagian AperD selama periode.'],
      ],
      },
      'Period summary (all funds)': { note: 'Rekap semua fund per periode; Total AUM (EOM) adalah AUM platform di hari terakhir periode.', },
    },
    notes: [
      'Rate yang dipakai adalah rate terbaru setiap fund (baris terakhir di management_fee_logs) untuk seluruh periode. Bila rate fund pernah berubah, periode sebelum perubahan ikut dihitung dengan rate baru.',
    ],
  },
  revenue2: {
    panels: {
      'Revenue trend': { note: 'Total fee manajemen, bagian AperD, dan bagian MI per periode.', },
      'Management fee revenue (per fund, per period)': { note: 'Fee dihitung per hari: AUM fund hari itu (main.goal_snapshots, tanpa koreksi tanggal) dikali rate tahunan, dibagi jumlah hari dalam tahun itu, lalu dibagi menjadi bagian AperD dan MI.', columns: [
        ['Mgmt fee rate', 'Rate fee manajemen per tahun yang dibebankan fund (misalnya 1,5%).'],
        ['AperD share', 'Porsi fee manajemen yang menjadi hak Sayakaya sebagai agen penjual.'],
        ['MI share', 'Porsi fee manajemen yang menjadi hak manajer investasi.'],
        ['AUM EOM', 'AUM pada hari terakhir periode (end of month).'],
        ['Total AperD', 'Revenue Sayakaya: jumlah fee harian bagian AperD selama periode.'],
      ],
      },
      'Period summary (all funds)': { note: 'Rekap semua fund per periode; Total AUM (EOM) adalah AUM platform di hari terakhir periode.', },
    },
    notes: [
      'Rate yang dipakai adalah rate terbaru setiap fund (baris terakhir di management_fee_logs) untuk seluruh periode. Bila rate fund pernah berubah, periode sebelum perubahan ikut dihitung dengan rate baru.',
    ],
  },
  'campaign-revenue': {
    panels: {
      'Campaign revenue trend': { note: 'Fee yang dihasilkan unit-unit yang terkunci kampanye promo, per periode.', },
      'Per campaign (whole range)': { note: 'Satu baris per kampanye untuk seluruh rentang.', columns: [
        ['Participations', 'Jumlah pembelian yang ikut kampanye (baris bonus_portfolios).'],
        ['Still locked', 'Partisipasi yang unitnya masih terkunci masa tahan (status on_going).'],
        ['Total AperD (alt)', 'Total AperD bila penjualan dianggap memakai unit milik investor dulu, unit kampanye terakhir (atribusi optimis).'],
        ['Est. cost', 'Biaya kampanye: bonus per pemakaian dikali kuota terpakai.'],
        ['Net vs cost', 'Total AperD dikurangi Est. cost. Negatif berarti fee belum menutup biaya bonus.'],
      ],
      },
      'Per campaign, per period': { note: 'Fee setiap kampanye dipecah per periode.', columns: [
        ['Avg locked AUM', 'Rata-rata nilai unit kampanye per hari.'],
      ],
      },
      'Period summary (all funds)': { note: 'Rekap semua kampanye per periode.', },
    },
    notes: [
      'Unit kampanye menghasilkan fee selama masih dipegang. Kolom utama menganggap penjualan memakai unit kampanye dulu (konservatif); kolom "(alt)" menganggap unit kampanye dipakai terakhir (optimis).',
    ],
  },
  remisier: {
    panels: {
      'Users under this remisier': { note: 'Daftar nasabah yang referrer_code atau sales_code-nya cocok dengan kode remisier (pencarian sebagian kata). Cek daftar ini dulu sebelum menghitung.', },
      'Revenue detail (per fund)': { note: 'Fee AperD dari dana setiap nasabah remisier per fund (AUM dari main.goal_snapshots), lalu dibagi antara remisier dan Sayakaya.', columns: [
        ['Remisier fee (gross)', 'Porsi remisier dari bagian AperD (porsinya diisi di form, misalnya 50%).'],
        ['PPh 2.5%', 'Potongan pajak PPh 23 sebesar 2,5% dari fee remisier.'],
        ['Remisier fee (net)', 'Fee remisier setelah dipotong PPh.'],
        ['Sayakaya fee', 'Sisa bagian AperD untuk Sayakaya: AperD dikali (1 dikurangi porsi remisier).'],
      ],
      },
      'Revenue summary (all funds)': { note: 'Rekap per periode dari tabel detail.', },
    },
    notes: [
      'Fee remisier selalu dihitung dari bagian AperD, bukan dari fee manajemen kotor.',
    ],
  },
  'remisier-pwc': {
    panels: {
      'Users under this remisier': { note: 'Daftar nasabah yang referrer_code atau sales_code-nya cocok dengan kode remisier (pencarian sebagian kata). Cek daftar ini dulu sebelum menghitung.', },
      'Revenue detail (per fund)': { note: 'Fee AperD dari dana setiap nasabah remisier per fund (AUM dari mi_fee_logs.portfolio_with_code, dengan koreksi -1 hari), lalu dibagi antara remisier dan Sayakaya.', columns: [
        ['Remisier fee (gross)', 'Porsi remisier dari bagian AperD (porsinya diisi di form, misalnya 50%).'],
        ['PPh 2.5%', 'Potongan pajak PPh 23 sebesar 2,5% dari fee remisier.'],
        ['Remisier fee (net)', 'Fee remisier setelah dipotong PPh.'],
        ['Sayakaya fee', 'Sisa bagian AperD untuk Sayakaya: AperD dikali (1 dikurangi porsi remisier).'],
      ],
      },
      'Revenue summary (all funds)': { note: 'Rekap per periode dari tabel detail.', },
    },
    notes: [
      'Fee remisier selalu dihitung dari bagian AperD, bukan dari fee manajemen kotor.',
    ],
  },
  marketing: {
    kpis: [
      ['Total installs', 'Install aplikasi dari semua channel iklan menurut Adjust.'],
      ['Revenue', 'Jumlah nominal pembayaran yang dilaporkan aplikasi ke Adjust (event payment_completed).'],
    ],
    panels: {
      'Funnel by channel': { note: 'Satu baris per channel atau tracker iklan Adjust, dari klik sampai pembayaran.', columns: [
        ['Channel', 'Nama tracker Adjust (sumber iklan atau kampanye).'],
        ['OTP verified', 'Pengguna yang memverifikasi nomor HP lewat OTP.'],
      ],
      },
    },
    notes: [
      'Hanya nama event polos yang dihitung; varian seperti payment_completed_1M_plus dibuang supaya satu pembayaran tidak terhitung dua atau tiga kali. Angka Adjust bisa berbeda dengan database utama karena atribusi iklan punya aturannya sendiri.',
    ],
  },
  'referral-program': {
    kpis: [
      ['Eligible', 'Referral yang memenuhi semua syarat dan sudah lewat masa tahan 30 hari.'],
      ['Pending', 'Memenuhi syarat pembelian tetapi masa tahan 30 harinya belum selesai.'],
      ['Est. bonus payable', 'Perkiraan bonus yang harus dibayar: Rp25.000 untuk pengajak dan Rp25.000 untuk yang diajak, per referral Eligible.'],
    ],
    panels: {
      'Inviter leaderboard': { note: 'Satu baris per pengajak. "Invited" dihitung dari tanggal invitee mendaftar di periode program.', columns: [
        ['Transacted ≥ Rp1jt', 'Yang transaksi pertamanya memenuhi syarat program: beli fund Sucor Asset Management minimal Rp1.000.000.'],
        ['Not eligible', 'Bertransaksi tetapi gagal salah satu syarat; alasannya ada di tabel Referral detail.'],
      ],
      },
      'Invited users': { note: 'Semua orang yang diajak, beserta tanggal daftar dan verifikasi.', },
      'Referral detail': { note: 'Satu baris per referral yang transaksi pertamanya masuk periode program.', columns: [
        ['Baseline units', 'Saldo unit fund itu tepat setelah pembelian selesai.'],
        ['Min units seen', 'Saldo unit terendah selama 30 hari setelahnya. Bila lebih kecil dari Baseline units, investor sudah menjual sebagian dan bonus gugur.'],
        ['Reason', 'Alasan bila tidak eligible (misalnya transaksi pertama bukan fund Sucor, nominal di bawah Rp1 juta, unit dijual sebelum 30 hari).'],
      ],
      },
    },
    notes: [
      'Syarat bonus Rp25.000 per pihak: transaksi pertama si invitee adalah pembelian fund Sucor Asset Management minimal Rp1.000.000 dengan kode referral, dan unitnya ditahan 30 hari.',
    ],
  },
  'referral-program-alt': {
    kpis: [
      ['Eligible', 'Referral yang memenuhi semua syarat dan sudah lewat masa tahan 30 hari.'],
      ['Pending', 'Memenuhi syarat pembelian tetapi masa tahan 30 harinya belum selesai.'],
      ['Est. bonus payable', 'Perkiraan bonus yang harus dibayar: Rp25.000 untuk pengajak dan Rp25.000 untuk yang diajak, per referral Eligible.'],
    ],
    panels: {
      'Inviter leaderboard': { note: 'Satu baris per pengajak. "Invited" dihitung dari tanggal KYC invitee terverifikasi (dengan kelonggaran 1 hari), bukan tanggal daftar.', columns: [
        ['Transacted ≥ Rp1jt', 'Yang transaksi pertamanya memenuhi syarat program: beli fund Sucor Asset Management minimal Rp1.000.000.'],
        ['Not eligible', 'Bertransaksi tetapi gagal salah satu syarat; alasannya ada di tabel Referral detail.'],
      ],
      },
      'Invited users': { note: 'Semua orang yang diajak, beserta tanggal daftar dan verifikasi.', },
      'Referral detail': { note: 'Satu baris per referral yang transaksi pertamanya masuk periode program.', columns: [
        ['Baseline units', 'Saldo unit fund itu tepat setelah pembelian selesai.'],
        ['Min units seen', 'Saldo unit terendah selama 30 hari setelahnya. Bila lebih kecil dari Baseline units, investor sudah menjual sebagian dan bonus gugur.'],
        ['Reason', 'Alasan bila tidak eligible (misalnya transaksi pertama bukan fund Sucor, nominal di bawah Rp1 juta, unit dijual sebelum 30 hari).'],
      ],
      },
    },
    notes: [
      'Syarat bonus Rp25.000 per pihak: transaksi pertama si invitee adalah pembelian fund Sucor Asset Management minimal Rp1.000.000 dengan kode referral, dan unitnya ditahan 30 hari.',
    ],
  },
  kalcer: {
    kpis: [
      ['Referrers', 'Pengguna yang pernah mengajak minimal satu orang.'],
      ['AUM referred', 'Total AUM semua orang yang diajak pada tanggal di atas.'],
    ],
    panels: {
      Referrers: { note: 'Satu baris per pengajak, beserta jumlah dan nilai orang yang dia ajak.', columns: [
        ['AUM referred', 'Total AUM orang-orang yang dia ajak pada tanggal terpilih.'],
      ],
      },
      Referrals: { note: 'Satu baris per hubungan pengajak dan yang diajak.', columns: [
        ['Investor AUM', 'AUM orang yang diajak pada tanggal terpilih (snapshot portfolio_with_code, koreksi -1 hari).'],
      ],
      },
    },
    notes: [
      'Tab ini mencakup semua referral antar pengguna, bukan hanya ambassador satu program, dan tidak menghitung bonus.',
    ],
  },
  push: {
    kpis: [
      ['Delivery rate', 'Pesan yang diterima server Firebase untuk dikirim dibagi semua pesan.'],
    ],
    panels: {
      'Send volume': { note: 'Jumlah pesan push per hari.', },
      'By campaign': { note: 'Keberhasilan pengiriman per nama kampanye push.', columns: [
        ['Accepted', 'Pesan dengan status MESSAGE_ACCEPTED.'],
        ['Missing registrations', 'Gagal karena token perangkat sudah tidak berlaku (aplikasi dihapus atau token kedaluwarsa).'],
      ],
      },
    },
    notes: [
      'Data ini hanya kesehatan pengiriman, bukan dibuka atau diklik, dan tidak punya user_id. Untuk push yang dibuka lalu membeli, lihat tab User behavior.',
    ],
  },
  'app-health': {
    panels: {
      'Crash & error issues': { note: 'Satu baris per masalah, platform, dan jenis (fatal atau tidak).', columns: [
        ['Fatal', 'Ya bila aplikasi tertutup paksa (crash), tidak bila hanya error yang tercatat.'],
        ['Affected devices', 'Jumlah perangkat berbeda yang mengalaminya (installation_uuid).'],
      ],
      },
      'Slowest operations': { note: 'Pemanggilan API GraphQL dan pemuatan layar, minimal 20 sampel.', columns: [
        ['Median (ms)', 'Durasi tengah dalam milidetik; lebih mewakili pengalaman pengguna daripada rata-rata.'],
      ],
      },
    },
    notes: [
      'Crashlytics tidak menyimpan jumlah pengguna aktif, jadi tab ini tidak bisa menghitung persentase crash-free.',
    ],
  },
  'product-funnel': {
    panels: {
      'Funnel by platform': { note: 'Perangkat yang klik Register pada periode ini, lalu dicek tanpa batas tanggal apakah perangkat yang sama pernah mencapai setiap langkah.', },
    },
    notes: [
      'Dihitung per perangkat (user_pseudo_id), bukan per akun, karena orang belum login saat mendaftar. Untuk funnel per akun yang dicocokkan ke database, lihat Onboarding analysis.',
    ],
  },
  'user-behavior': {
    panels: {
      'By investor status': { note: 'Status adalah kondisi hari ini: Holding (memegang unit), Redeemed (pernah beli, sekarang kosong), Verified, never bought, dan Not verified.', columns: [
        ['Minutes in app (median)', 'Median total menit aktif di aplikasi (engagement_time_msec).'],
      ],
      },
      'In-app actions that come before a purchase': { note: 'Aksi di aplikasi yang paling sering mendahului pembelian dalam 7 hari.', columns: [
        ['Baseline', 'Persen semua pengguna aplikasi yang membeli dalam 7 hari sejak aktivitas pertamanya.'],
        ['Lift', 'Rate dibagi Baseline. 2.0 berarti dua kali lebih sering membeli dibanding pengguna rata-rata.'],
      ],
      },
      'Push campaigns: opened, then bought': { note: 'Per kampanye push: penerima, pembuka, dan pembeli dalam 72 jam.', columns: [
        ['Bought within 72h', 'Semua penerima yang membeli dalam 72 jam, dibuka atau tidak (termasuk yang memang akan membeli).'],
      ],
      },
      'Fund pages: viewed, then bought': { note: 'Halaman fund yang dibuka dibandingkan dengan pembelian fund yang sama.', columns: [
        ['Viewer to buyer', 'Persen yang membuka halaman fund lalu membeli fund yang sama dalam 7 hari.'],
      ],
      },
      'Started buying, never paid': { note: 'Daftar tindak lanjut: membuka form beli atau membuat order, tanpa pembayaran sampai 3 hari setelah percobaan terakhir.', columns: [
        ['What happened to the order', '"No order created" berarti berhenti di form; "expired" berarti order dibuat tapi tidak dibayar.'],
      ],
      },
      'One investor\'s journey': { note: 'Aktivitas aplikasi dan transaksi satu investor pada satu linimasa. Setiap pencarian dicatat di Activity log.', },
    },
  },
  'subscription-analysis': {
    panels: {
      'Buy flow, step by step': { note: 'Berapa orang yang lanjut dari form beli sampai membayar, bisa dipisah per platform, pembeli pertama atau ulang, dan versi aplikasi.', columns: [
        ['Minutes to pay (median)', 'Median menit dari order dibuat sampai dibayar (paid_at).'],
      ],
      },
      'Where people open the buy form from': { note: 'Layar asal pembukaan form beli dan seberapa sering berakhir dibayar.', columns: [
        ['Screen before', 'Layar terakhir sebelum form beli terbuka, di sesi yang sama.'],
        ['Paid %', 'Persen orang yang membayar dalam 3 hari setelah membuka form dari layar itu.'],
      ],
      },
      'Where people leave the buy flow': { note: 'Sesi yang berhenti sebelum membuat order, per langkah terjauh, dan ke mana orang pergi.', columns: [
        ['Next screen', 'Tujuan setelah layar alur beli terakhir; "(left the app)" berarti tidak ada aktivitas lagi di sesi itu.'],
      ],
      },
      'Orders by payment method': { note: 'Semua order beli per metode pembayaran: dibayar, kedaluwarsa, atau dibatalkan.', columns: [
        ['Waiting', 'Belum dibayar dan belum kedaluwarsa.'],
        ['Paid another order within 7 days', 'Orang yang ordernya tidak dibayar lalu membayar order lain dalam seminggu.'],
      ],
      },
      'What people did before subscribing': { note: 'Layar dan aksi yang membedakan pembeli dari yang tidak membeli.', columns: [
        ['Rate without it', 'Persen membeli di antara orang yang tidak melakukan layar atau aksi itu.'],
        ['Lift', 'Rate dibagi Rate without it.'],
        ['Share of subscribers', 'Persen dari semua pembeli yang melakukannya sebelum membeli.'],
      ],
      },
      'Preset amount buttons': { note: 'Tombol nominal di form beli dan apakah orang tetap di nominal itu saat membayar.', columns: [
        ['Kept that amount', 'Yang membayar dengan nominal persis sama dengan tombol yang diketuk.'],
      ],
      },
    },
  },
  'onboarding-analysis': {
    panels: {
      'Where KYC ended up': { note: 'Hasil KYC setiap pendaftar baru, dengan waktu mengisi, waktu review, dan pembelian pertama.', columns: [
        ['Review hours (median)', 'Jam dari KYC dikirim sampai keputusan review di user_status_logs.'],
        ['Sessions to submit (median)', 'Berapa kali membuka aplikasi sampai KYC terkirim.'],
      ],
      },
    },
  },
  'redemption-analysis': {
    panels: {
      'Who sells, and what happens after': { note: 'Semua penjualan selesai pada periode ini, bisa dipisah menurut lama memegang, jenis fund, atau penuh dan sebagian.', columns: [
        ['Full %', 'Persen penjualan yang menghabiskan semua unit fund itu (is_all_unit).'],
        ['Days held (median)', 'Median hari sejak pertama membeli atau switch masuk ke fund itu.'],
        ['Holding nothing now', 'Penjual yang hari ini tidak memegang unit apa pun.'],
        ['Confirmed in app', 'Penjualan yang punya event konfirmasi di aplikasi; sisanya lewat jalur lain.'],
      ],
      },
    },
  },
  'engagement-analysis': {
    panels: {
      'Features and the people who use them': { note: 'Setiap kelompok fitur dibandingkan dengan semua pengguna aplikasi.', columns: [
        ['Median portfolio', 'Median nilai portofolio hari ini, di antara pemakai fitur yang memegang unit.'],
      ],
      },
      'What people search for': { note: 'Kata kunci pencarian fund dan apakah berujung pada pembelian.', columns: [
        ['Bought what they tapped', 'Membeli fund yang mereka ketuk dari hasil pencarian dalam 7 hari.'],
      ],
      },
    },
  },
  'event-code': {
    kpis: [
      ['Repeat transacted', 'Orang bertanda kode yang punya lebih dari satu transaksi.'],
    ],
    panels: {
      'Cohort retention — by registration date': { note: 'Setiap baris: kelompok orang bertanda kode yang mendaftar pada hari, minggu, atau bulan yang sama; kolom berikutnya persen yang bertransaksi pada periode ke-n sesudahnya.', },
      'Cohort retention — by first transaction date': { note: 'Sama, tetapi kelompok berdasarkan tanggal transaksi pertama.', },
    },
    notes: [
      'Tab generik yang disiapkan sebelum event-nya ada; aturan funnel dan cohort perlu disesuaikan saat event sebenarnya berjalan.',
    ],
  },
  ask: {
    panels: {
      'Talk with Data': { note: 'Ketik pertanyaan dalam bahasa biasa; jawaban berupa tabel dan grafik, beserta SQL yang dipakai (bisa disalin, diedit, dan dijalankan ulang). Kolom hasil mengikuti pertanyaan.', },
    },
    notes: [
      'Jawaban dibuat oleh model AI, jadi periksa SQL-nya untuk angka penting. Kolom sensitif (password, data KYC) selalu disaring kecuali superuser mengonfirmasi password.',
    ],
  },
  explorer: {
    panels: {
      Explorer: { note: 'Pilih tabel, saring, dan lihat baris aslinya tanpa agregasi. Kolom mengikuti tabel yang dipilih.', },
    },
  },
  sql: {
    panels: {
      'SQL lab': { note: 'Tulis query SELECT atau WITH sendiri. Tombol perkiraan menampilkan berapa byte yang akan dibaca sebelum query dijalankan.', },
    },
    notes: [
      'Hanya bisa membaca: satu statement, tanpa perubahan data, dan kolom sensitif disaring dari hasil.',
    ],
  },
  admin: {
    panels: {
      Users: { note: 'Daftar akun dashboard (superuser). Tambah akun, pilih tab yang boleh dibuka, kirim undangan, atau reset password.', columns: [
        ['Access', 'Tab yang boleh dibuka akun itu. Superuser bisa membuka semuanya.'],
      ],
      },
    },
  },
  'activity-log': {
    panels: {
      'Activity log': { note: 'Riwayat aktivitas semua akun (superuser), bisa disaring per akun, jenis aktivitas, dan tanggal.', columns: [
        ['Action', 'Jenis aktivitas: login, ekspor, Ask, SQL, lihat portofolio, lihat linimasa investor, perubahan akun, dan lainnya.'],
        ['Detail', 'Rincian aktivitas, misalnya SID yang dilihat atau nama file yang diekspor.'],
      ],
      },
    },
  },
};

module.exports = { TABS, TAB_DETAILS, DATASETS, TABLE_NOTES, SUPABASE_TABLES, GLOSSARY, REPO_MAP, ENV_NOTES };
