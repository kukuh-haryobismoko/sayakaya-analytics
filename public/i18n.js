'use strict';

// Sitewide EN/ID translation.
//
// Static text: tag the element with data-i18n (textContent), data-i18n-html
// (innerHTML, for entries with inline <b>/<code> markup), or
// data-i18n-placeholder / data-i18n-title, and add the same key to both
// dictionaries below. translatePage() re-applies all of them on load and on
// language switch.
//
// Dynamic text built in JS (toasts, status labels, etc.) should call t('key')
// instead of hardcoding an English string — see setConnStatus() in app.js
// for the pattern.
//
// By product decision, nav item names and the Tools / Portfolio / Portfolio
// Explorer / Remisier sections are left English-only in both languages —
// they're treated as feature/technical names, not translatable UI copy — so
// there are deliberately no data-i18n hooks on that markup.
const I18N = {
  en: {
    sign_in_subtitle: `Sign in to continue.`,
    gate_username_ph: `Username`,
    gate_password_ph: `Password`,
    sign_in: `Sign in`,

    password_btn: `Password`,
    logout_btn: `Log out`,
    change_pw_current_ph: `Current password`,
    change_pw_new_ph: `New password`,
    change_pw_save: `Update password`,

    nav_group_dashboards: `Dashboards`,
    nav_group_investor: `Investor`,
    nav_group_operations: `Operations & Finance`,
    nav_group_help: `Help`,
    nav_group_admin: `Admin`,

    range_from: `From`,
    range_to: `To`,
    apply: `Apply`,
    theme_auto: `Auto`,
    theme_light: `Light`,
    theme_dark: `Dark`,
    conn_checking: `Checking…`,
    conn_live: `BigQuery live`,
    conn_down: `Connection down`,

    docs_getting_started: `Getting started`,
    docs_intro: `This dashboard shows live data pulled directly from the database — there's nothing to configure, just pick a section from the menu on the left. A few things that apply everywhere:`,
    docs_li_date_range: `<b>Date range</b> — the "From / To" fields at the top of the page and the <b>Apply</b> button next to them control the time window for whichever dashboard you're looking at.`,
    docs_li_menu: `<b>Menu (sidebar)</b> — click the <b>☰</b> button top-left to collapse it to icons-only (desktop) or open/close it (on phone/tablet). Click a section title (like "Dashboards") to fold that group away if you don't use it often.`,
    docs_li_theme: `<b>Theme</b> — top-right: <b>Auto</b> follows your device's light/dark setting automatically, or pick <b>Light</b>/<b>Dark</b> to fix it.`,
    docs_li_export: `<b>Exporting</b> — wherever you see <b>CSV</b> or <b>Excel</b> buttons, that downloads exactly what's on screen as a file.`,
    docs_li_account: `<b>Your account</b> — your name is in the box under the logo; <b>Password</b> lets you change it, <b>Log out</b> signs you out.`,
    docs_li_language: `<b>Language</b> — top-right: switch between English and Bahasa Indonesia at any time; your choice is remembered.`,

    docs_panel_dashboards: `Dashboards`,
    docs_overview_desc: `The single-page snapshot of the whole business: total assets under management, user counts, buy/sell volume, a transaction trend chart, fund breakdowns, and a map of where investors are located across Indonesia.`,
    docs_aum_desc: `How total assets under management (and the platform's own revenue) have moved over time.`,
    docs_performance_desc: `How each fund's price (NAV) has performed — pick a time window from 1 day up to 5 years and compare funds side by side.`,
    docs_growth_desc: `Marketing and growth numbers: how well promo campaigns performed, who's referring the most new investors, and which funds people switch between most.`,

    docs_panel_investor: `Investor`,
    docs_hnwi_desc: `"High-Net-Worth Individuals" — the list of investors holding above a chosen amount (you set the threshold) as of a chosen date, with a total-across-everyone summary and an export.`,

    docs_panel_operations: `Operations & Finance`,
    docs_reconciliation_desc: `A daily check that the numbers line up across systems — use this to catch discrepancies before they become a real problem.`,
    docs_revenue_desc: `How much revenue/fees Sayakaya itself has earned, broken down by fund and investment manager, from each of the two data sources the platform tracks (PWC and GS).`,
    docs_predict_desc: `Machine-learning forecasts: projected AUM and transaction volume, which investors are at risk of leaving (churn), and retention trends over time.`,

    docs_panel_admin: `Admin (superuser only)`,
    docs_manage_users_desc: `Create dashboard login accounts for your team, and choose exactly which sections each person is allowed to see.`,
    docs_activity_log_desc: `See who logged in, exported a file, asked an Ask question, ran a SQL query, viewed an investor's portfolio, or changed an account — and when.`,
  },
  id: {
    sign_in_subtitle: `Masuk untuk melanjutkan.`,
    gate_username_ph: `Nama pengguna`,
    gate_password_ph: `Kata sandi`,
    sign_in: `Masuk`,

    password_btn: `Kata sandi`,
    logout_btn: `Keluar`,
    change_pw_current_ph: `Kata sandi saat ini`,
    change_pw_new_ph: `Kata sandi baru`,
    change_pw_save: `Perbarui kata sandi`,

    nav_group_dashboards: `Dasbor`,
    nav_group_investor: `Investor`,
    nav_group_operations: `Operasional & Keuangan`,
    nav_group_help: `Bantuan`,
    nav_group_admin: `Admin`,

    range_from: `Dari`,
    range_to: `Sampai`,
    apply: `Terapkan`,
    theme_auto: `Otomatis`,
    theme_light: `Terang`,
    theme_dark: `Gelap`,
    conn_checking: `Memeriksa…`,
    conn_live: `BigQuery aktif`,
    conn_down: `Koneksi terputus`,

    docs_getting_started: `Mulai di sini`,
    docs_intro: `Dasbor ini menampilkan data langsung dari database — tidak ada yang perlu dikonfigurasi, cukup pilih bagian dari menu di sebelah kiri. Beberapa hal berikut berlaku di semua halaman:`,
    docs_li_date_range: `<b>Rentang tanggal</b> — kolom "Dari / Sampai" di bagian atas halaman beserta tombol <b>Terapkan</b> di sebelahnya mengatur rentang waktu untuk dasbor yang sedang Anda lihat.`,
    docs_li_menu: `<b>Menu (sidebar)</b> — klik tombol <b>☰</b> di kiri atas untuk menciutkannya menjadi ikon saja (desktop) atau membuka/menutupnya (di ponsel/tablet). Klik judul bagian (seperti "Dasbor") untuk melipat grup tersebut jika jarang digunakan.`,
    docs_li_theme: `<b>Tema</b> — kanan atas: <b>Otomatis</b> mengikuti pengaturan terang/gelap perangkat Anda secara otomatis, atau pilih <b>Terang</b>/<b>Gelap</b> untuk menguncinya.`,
    docs_li_export: `<b>Ekspor</b> — di mana pun Anda melihat tombol <b>CSV</b> atau <b>Excel</b>, tombol itu mengunduh persis apa yang tampil di layar sebagai file.`,
    docs_li_account: `<b>Akun Anda</b> — nama Anda ada di kotak di bawah logo; <b>Kata sandi</b> untuk menggantinya, <b>Keluar</b> untuk keluar dari sesi.`,
    docs_li_language: `<b>Bahasa</b> — kanan atas: beralih antara Bahasa Inggris dan Bahasa Indonesia kapan saja; pilihan Anda akan diingat.`,

    docs_panel_dashboards: `Dasbor`,
    docs_overview_desc: `Ringkasan satu halaman untuk seluruh bisnis: total dana kelolaan (AUM), jumlah pengguna, volume beli/jual, grafik tren transaksi, rincian per produk, dan peta sebaran investor di seluruh Indonesia.`,
    docs_aum_desc: `Bagaimana total dana kelolaan (AUM) dan pendapatan platform berubah dari waktu ke waktu.`,
    docs_performance_desc: `Bagaimana kinerja harga (NAV) tiap produk — pilih rentang waktu dari 1 hari hingga 5 tahun dan bandingkan beberapa produk sekaligus.`,
    docs_growth_desc: `Angka pemasaran dan pertumbuhan: seberapa efektif kampanye promo, siapa yang paling banyak mereferensikan investor baru, dan produk apa yang paling sering dipindahkan (switching) investor.`,

    docs_panel_investor: `Investor`,
    docs_hnwi_desc: `"High-Net-Worth Individuals" — daftar investor dengan kepemilikan di atas nilai tertentu (Anda tentukan ambang batasnya) per tanggal yang dipilih, lengkap dengan ringkasan total dan fitur ekspor.`,

    docs_panel_operations: `Operasional & Keuangan`,
    docs_reconciliation_desc: `Pengecekan harian untuk memastikan angka di berbagai sistem sudah cocok — gunakan ini untuk menangkap selisih sebelum menjadi masalah nyata.`,
    docs_revenue_desc: `Berapa banyak pendapatan/fee yang diperoleh Sayakaya, dirinci per produk dan manajer investasi, dari masing-masing dari dua sumber data yang dilacak platform (PWC dan GS).`,
    docs_predict_desc: `Prediksi berbasis machine learning: proyeksi AUM dan volume transaksi, investor mana yang berisiko keluar (churn), dan tren retensi dari waktu ke waktu.`,

    docs_panel_admin: `Admin (khusus superuser)`,
    docs_manage_users_desc: `Buat akun login dasbor untuk tim Anda, dan tentukan persis bagian mana saja yang boleh dilihat masing-masing orang.`,
    docs_activity_log_desc: `Lihat siapa yang login, mengekspor file, mengajukan pertanyaan Ask, menjalankan query SQL, melihat portofolio seorang investor, atau mengubah akun — dan kapan.`,
  },
};

const LANG_KEY = 'sk_lang';
function getLang() { return localStorage.getItem(LANG_KEY) || 'en'; }
function t(key) { return I18N[getLang()]?.[key] ?? I18N.en[key] ?? key; }

function translatePage() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

function syncLangSeg(lang) {
  document.querySelectorAll('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

// app.js assigns this to re-render whatever it builds dynamically with t()
// (e.g. the connection status label) — kept as a plain hook rather than a
// hard dependency so i18n.js doesn't need to know app.js's internals.
window.onLanguageChange = null;

function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  translatePage();
  syncLangSeg(lang);
  if (typeof window.onLanguageChange === 'function') window.onLanguageChange(lang);
}
