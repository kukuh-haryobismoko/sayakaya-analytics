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
    docs_overview_desc: `The single-page snapshot of the whole business: total assets under management, user counts, buy/sell volume, a transaction trend chart, fund breakdowns, and a map of where investors are located across Indonesia. The "Largest funds by AUM" table lists every fund/MI as of a date you pick (not just the top 10), and you can select which funds to include — deselecting a fund also removes its AUM from its MI's total.`,
    docs_aum_desc: `How total assets under management (and the platform's own revenue) have moved over time.`,
    docs_performance_desc: `How each fund's price (NAV) has performed — pick a time window from 1 day up to 5 years and compare funds side by side.`,
    docs_growth_desc: `Marketing and growth numbers: how well promo campaigns performed, who's referring the most new investors, and which funds people switch between most.`,

    docs_panel_investor: `Investor`,
    docs_hnwi_desc: `"High-Net-Worth Individuals" — the list of investors holding within a chosen AUM range (you set the min/max thresholds) as of a chosen date, including each investor's risk profile (risk level, investment priorities, risk tolerance), with a total-across-everyone summary and an export. The per-fund breakdown below has its own independent Min/Max AUM filter, based on each fund holding's own amount rather than the investor's total.`,

    docs_panel_operations: `Operations & Finance`,
    docs_reconciliation_desc: `A daily check that the numbers line up across systems — use this to catch discrepancies before they become a real problem.`,
    docs_revenue_desc: `How much revenue/fees Sayakaya itself has earned, broken down by fund and investment manager, from each of the two data sources the platform tracks (PWC and GS).`,
    docs_user_lifetime_desc: `The same fee revenue as Revenue (PWC), but answered per investor instead of per fund: what each one earns the platform, next to how long they've been with us — when they registered, when they first bought, and how long they've stayed invested. Click any investor for their month-by-month, fund-by-fund breakdown.`,
    docs_campaign_revenue_desc: `What each promo campaign earned back. A buy settled with a promo code locks those units up, and this estimates the management fee they earn while they stay invested — until the investor redeems early, or sells them after the holding period ends. Shown next to the campaign's bonus payout so you can see which promos paid for themselves.`,
    docs_predict_desc: `Machine-learning forecasts: projected AUM and transaction volume, which investors are at risk of leaving (churn), and retention trends over time.`,

    docs_panel_admin: `Admin (superuser only)`,
    docs_manage_users_desc: `Create dashboard login accounts for your team, and choose exactly which sections each person is allowed to see.`,
    docs_activity_log_desc: `See who logged in, exported a file, asked an Ask question, ran a SQL query, viewed an investor's portfolio, or changed an account — and when.`,

    // ---- Phase 2: per-section dashboard UI (added 2026-08-03) ----
    common_search_hint: `Search by SID code, name, or email.`,
    common_sid_ph: `e.g. SID code`,
    common_search: `Search`,
    common_as_of: `As of`,
    common_go: `Go`,
    common_csv: `CSV`,
    common_excel: `Excel`,
    common_xlsx_portfolio_full: `Excel (portfolio + performance, all types)`,
    common_columns: `Columns`,
    common_pdf_portfolio_only: `PDF (portfolio only)`,
    common_pdf_with_performance: `PDF (with performance)`,
    common_filters: `Filters`,
    common_detail: `Detail`,
    common_day: `Day`,
    common_week: `Week`,
    common_month: `Month`,
    common_all_fund_types: `All fund types`,
    common_top3: `Top 3`,
    common_top5: `Top 5`,
    common_top10: `Top 10`,
    common_pick_funds: `Pick funds`,
    common_search_funds_ph: `Search funds…`,
    common_period: `Period`,
    common_period_summary: `Period summary (all funds)`,
    common_xlsx_single_sheet: `Excel: single sheet`,
    common_xlsx_per_fund: `Excel: one sheet per fund`,
    common_xlsx_per_mi: `Excel: one sheet per MI`,
    common_remisier_portion: `Remisier portion (%)`,
    common_daily: `Daily`,
    common_monthly: `Monthly`,
    common_quarterly: `Quarterly`,
    common_run: `Run`,
    common_users_under_remisier: `Users under this remisier`,
    common_rev_detail_per_fund: `Revenue detail (per fund)`,
    common_rev_summary_all_funds: `Revenue summary (all funds)`,
    common_all_types: `All types`,
    common_all_statuses: `All statuses`,
    common_tx_detail: `Transaction detail`,
    common_prev: `← Prev`,
    common_next: `Next →`,
    common_include_restricted: `Include restricted columns (password, KYC, etc. — superuser only)`,
    common_confirm_password_ph: `Confirm your password`,
    common_advanced_optional: `Advanced (optional)`,
    common_copy: `Copy`,
    common_edit: `Edit`,
    common_vs: `vs`,
    common_suggest: `✨ Suggest`,
    common_loading: `Loading…`,
    common_cancel: `Cancel`,
    common_refresh: `Refresh`,
    common_fund_wildcard_ph: `Fund (name or code, wildcard)`,
    common_mi_wildcard_ph: `Investment Manager (wildcard)`,
    common_remisier_code_ph: `Remisier code (partial match, e.g. CE matches CELIA/CENIA)`,

    port_find_investor: `Find investor`,
    port_aum_over_time: `AUM over time`,
    port_holdings: `Holdings`,
    port_aum_performance: `AUM performance`,
    port_aum_performance_hint: `% change in total portfolio value, from mi_fee_logs.portfolio_with_code.`,
    portfix_aum_performance_hint: `% change in total portfolio value, from mi_fee_logs.portfolio_fix.`,

    pe_holdings_by_fund: `Holdings by fund`,
    pe_holdings_by_fund_hint: `Merged across all goals, as of the picked date.`,
    pe_holdings_by_goal: `Holdings by goal`,
    pe_holdings_by_goal_hint: `Preview only — exports stay merged across goals.`,

    hnwi_min_aum: `Min AUM (Rp)`,
    hnwi_max_aum: `Max AUM (Rp)`,
    hnwi_filters_hint: `From mi_fee_logs.portfolio_with_code, one day before its own created_at (its created_at is a day ahead of the AUM date it represents). Leave Min/Max AUM blank to see everyone, sorted highest AUM first.`,
    hnwi_min_fund_aum: `Min fund AUM (Rp)`,
    hnwi_max_fund_aum: `Max fund AUM (Rp)`,
    hnwi_by_fund_filters_hint: `Filters each row by that fund's own AUM (not the investor's total). Independent from the Min/Max AUM filter above. Leave blank to see every fund holding.`,
    hnwi_total_per_investor: `AUM per investor (total)`,
    hnwi_per_fund: `AUM per investor per fund`,

    ov_transaction_volume: `Transaction volume`,
    ov_by_tx_type: `By transaction type`,
    ov_by_status: `By status`,
    ov_user_verification: `User verification`,
    ov_aum_by_fund_type: `AUM by fund type`,
    ov_investor_distribution: `Investor distribution by province`,
    ov_top_cities_investors: `Top cities by investors`,
    ov_top_cities_aum: `Top cities by AUM`,
    ov_largest_funds: `Largest funds by AUM`,
    ov_by_fund: `By fund`,
    ov_by_manager: `By investment manager`,
    ov_select_funds: `Select funds`,
    ov_largest_funds_hint: `Every fund/MI holding a position on the chosen date (not just the top 10). AUM = sum of holding value, investors = distinct investors holding a position. Deselect a fund to drop it from the numbers below — its MI's total reflects the removal too. Source: mi_fee_logs.portfolio_with_code, one day before its own created_at — this goes back further than portfolio_fix, which only starts in early August.`,

    aum_history_title: `AUM & revenue history`,
    aum_history_hint: `End-of-period AUM (point-in-time) and revenue (aperd_share, summed). Uses the date range above. Source: mi_fee_logs.mi_fee.`,

    perf_trend_title: `Fund performance trend`,
    perf_trend_hint: `Daily NAV (actual price). Pick funds to compare them directly, or leave none picked to show the top performers by % change. Source: sayakaya.main.snapshots.`,
    perf_by_type_title: `Fund performance by type`,
    perf_by_type_hint: `% change in NAV per fund type, averaged across funds of that type. Source: sayakaya.main.snapshots/funds.`,
    perf_detail_title: `Fund detail`,
    perf_xlsx_per_type: `Excel (one sheet per type)`,

    growth_campaign_title: `Campaign performance`,
    growth_campaign_hint: `Redemption % = used_quota / quota. Est. cost = used_quota × bonus_amount. Source: main.campaigns.`,
    growth_top_referrers: `Top referrers`,
    growth_top_referrers_hint: `Ranked by completed buy volume from the users they referred.`,
    growth_switching_title: `Fund switching flow`,
    growth_switching_hint: `Top origin → destination fund pairs by completed switching amount.`,
    growth_aum_by_manager: `AUM by investment manager`,
    growth_aum_by_risk: `Platform AUM by risk tolerance`,
    growth_aum_by_income: `Platform AUM by income bracket`,

    recon_title: `App ledger vs custodian feed`,
    recon_hint: `Daily completed-transaction totals by type: main.transactions.completed_at (app) vs sinvest.trx_history.Input_Date (custodian), matched on transaction type. "ALL" is the per-day total across types; the backoffice doesn't yet book Liquidation/Transfer/Unit Adjustment, so those types may show custodian-only rows. Uses the date range above. A large amount_diff flags a day worth investigating.`,

    rev_filters_hint: `Date filter for this section only — independent of the date range above. The Day/Week/Month toggle controls the bucket size of the tables and chart below. Fund/MI filters accept partial matches (e.g. "equity" matches any fund with "equity" in its name or code).`,
    rev_trend: `Revenue trend`,
    rev_detail_title: `Management fee revenue (per fund, per period)`,
    rev_detail_hint: `Management fee accrued daily from AUM (portfolio_with_code), split into AperD/MI share, summed per fund per period.`,
    rev2_filters_hint: `Same calculation as Revenue, but AUM comes from goal_snapshots instead of mi_fee_logs.portfolio_with_code — no day-offset correction needed, so this should be more accurate. Kept separate from Revenue for side-by-side comparison. The Day/Week/Month toggle controls the bucket size of the tables and chart below. Fund/MI filters accept partial matches.`,
    rev2_detail_hint: `Management fee accrued daily from AUM (goal_snapshots), split into AperD/MI share, summed per fund per period.`,

    ul_sid_ph: `SID (exact, optional)`,
    ul_filters_hint: `Same daily management-fee accrual as Revenue (PWC), grouped per investor instead of per fund. Money columns cover the selected range; lifetime columns (registered, first buy, holding lifetime) come from the full transaction history, which reaches much further back than the portfolio_with_code feed.`,
    ul_trend: `Revenue & investors over time`,
    ul_users_title: `Revenue & lifetime per investor`,
    ul_users_hint: `Ordered by the platform's own take (AperD share), highest first. Click a row for that investor's month-by-month, fund-by-fund breakdown. "First/last hold" are snapshot-feed dates and only go back as far as the feed does — use "First buy" and "Holding lifetime" for the real lifetime.`,

    cr_promo_ph: `Promo code (wildcard)`,
    cr_filters_hint: `Estimated management-fee revenue earned on the units each promo locked up. A buy settled with a promo code creates a bonus_portfolios row; those units earn a fee while they stay invested. on_going runs to today, redeemed stops at the redemption date, and succeeded runs until the transaction ledger shows those units sold out of the same goal and fund.`,
    cr_trend: `Campaign revenue trend`,
    cr_campaigns_title: `Per campaign (whole range)`,
    cr_campaigns_hint: `One row per promo code. "Est. cost" is the campaign's bonus payout (bonus amount × used quota), so "Net vs cost" shows whether the fee earned on the locked units covered what the promo paid out.`,
    cr_detail_title: `Per campaign, per period`,
    cr_detail_hint: `"AperD (alt)" is the same revenue under the opposite assumption about which units a sell consumes first — the headline column assumes the campaign's units go first, the alt column assumes they go last. The gap between them is the uncertainty in the estimate.`,
    cr_xlsx_per_promo: `Excel: one sheet per campaign`,

    rem_gs_hint: `Remisier's fee is a portion of the AperD share (not the raw management fee) — e.g. Sayakaya 40% / remisier 60% of AperD share.`,
    rem_gs_detail_hint: `Management fee accrued daily from goal_snapshots AUM, split into AperD/MI share, then AperD split into remisier/Sayakaya — summed per fund per period.`,
    rem_pwc_hint: `Same remisier/Sayakaya AperD-share split as the goal_snapshots tab, but AUM comes from mi_fee_logs.portfolio_with_code (the original Revenue tab's source) — compare the two side by side.`,
    rem_pwc_detail_hint: `Management fee accrued daily from portfolio_with_code AUM, split into AperD/MI share, then AperD split into remisier/Sayakaya — summed per fund per period.`,

    remtx_filters_hint: `Filtered by transaction date. Each code is a case-insensitive partial match (e.g. CE matches CELIA/CENIA) — fill one field for a single filter, or both to match either, and either field accepts multiple comma-separated codes.`,
    remtx_referrer_ph: `referrer_code(s), partial match, comma separated`,
    remtx_sales_ph: `sales_code(s), partial match, comma separated`,

    predict_aum_forecast: `AUM forecast`,
    predict_tx_forecast: `Transaction (buy volume) forecast`,
    predict_churn_risk: `Churn risk (current holders)`,
    predict_churn_by_tenure: `Churn rate by tenure`,
    predict_churn_overview: `Churn overview`,
    predict_retention_cohorts: `Retention cohorts`,
    predict_retention_hint: `% of each month's first-time investors still transacting in later months.`,
    predict_aum_retention_cohorts: `AUM retention cohorts`,
    predict_aum_retention_hint: `Cohort = first month a sid had AUM (mi_fee_logs.portfolios). % retained = cumulative netflow (buy − redeem, transactions) since month 0 is still ≥ 0. Cell shows cumulative netflow.`,
    predict_ml_banner: `<strong>Forecasts &amp; churn scoring need the models.</strong>
        Run <code>setup/ml_models.sql</code> once in BigQuery (see PREDICTIVE-MODELS.md), then reload.
        The retention and churn-rate sections below work without it.`,

    ask_button: `Ask`,
    ask_hint_default: `Just use your mother language to get the data — no technical skills needed.`,
    ask_hint_followup: `Follow-up mode: your next question can refer to "that"/"it" and it'll build on question {n} below.`,
    ask_conversation_count: `Conversation · {n} question{s}`,
    ask_new_chat_title: `Forget the above and ask something unrelated`,
    ask_new_chat_btn: `↺ Start new conversation`,
    ask_ex1: `Top 10 funds by AUM`,
    ask_ex2: `How many verified users do we have?`,
    ask_ex3: `Completed buy volume per month in 2025`,
    ask_ex4: `Transaction count by status`,
    ask_ex5: `Top 5 investment managers by fund count`,
    ask_ex_activity: `Who logged in today?`,
    ask_context_ph: `Optional: a related SQL query to use as extra context`,
    ask_generated_sql: `Generated SQL`,
    ask_input_ph: `e.g. top 10 funds by AUM, or total buy volume per month in 2025`,
    ask_chart_hint_ph: `Optional: describe the chart you want`,
    ask_disabled: `The Ask feature is off because no Anthropic API key is set on the server.
          Add an <code>ANTHROPIC_API_KEY</code> environment variable and restart to enable it.`,

    chart_none: `No chart`,
    chart_bar: `Bar`,
    chart_line: `Line`,
    chart_pie: `Pie`,
    chart_doughnut: `Doughnut`,
    chart_scatter: `Scatter`,

    sql_lab_title: `SQL lab`,
    sql_lab_hint: `Read-only. SELECT / WITH only. Results capped to 5,000 rows.`,
    sql_estimate_cost: `Estimate cost`,

    admin_users: `Users`,
    admin_add_user: `+ Add user`,
    admin_modal_hint: `Choose which sections this person can access. Superusers always see everything.`,
    admin_superuser_full_access: `Superuser (full access)`,
    admin_activity_log: `Activity log`,
    admin_all_users: `All users`,
    admin_activity_hint: `Every login, export, Ask question, SQL Lab query, and admin account change, most recent first. Pick a user from the dropdown for an exact match; search matches action/detail as a wildcard (e.g. "revenue" also finds revenue_detail exports) — leave blank to see everything.`,
    admin_search_action_ph: `Search action or detail (wildcard)`,
    admin_add_user_title: `Add user`,
    admin_create_user: `Create user`,
    admin_edit_user_prefix: `Edit`,
    admin_save_changes: `Save changes`,
    admin_password_keep_current_ph: `Leave blank to keep current password`,

    // ---- Phase 3: KPI cards + chart legends (added 2026-08-03) ----
    kpi_platform_aum: `Platform AUM`,
    kpi_investing_users: `investing users`,
    kpi_total_users: `Total users`,
    kpi_verified: `verified`,
    kpi_buy_volume: `Buy volume (range)`,
    kpi_completed_buys: `completed buys`,
    kpi_sell_volume: `Sell volume (range)`,
    kpi_completed_sells: `completed sells`,
    kpi_active_users: `Active users (range)`,
    kpi_ge1_tx: `with ≥1 transaction`,
    kpi_transactions: `Transactions (range)`,
    kpi_all_statuses: `all statuses`,
    kpi_active_funds: `Active funds`,
    kpi_total_in_catalog: `total in catalog`,
    kpi_new_users_30d: `New users (30d)`,
    kpi_rolling_window: `rolling window`,
    chart_buy_volume: `Buy volume`,
    chart_sell_volume: `Sell volume`,
    chart_active_users: `Active users`,

    kpi_total_aum: `Total AUM`,
    kpi_holding_count: `{n} holding{s}`,
    kpi_regular_portfolio: `Regular portfolio`,
    kpi_not_available_past_date: `not available for a past date`,
    kpi_bonus_portfolio: `Bonus portfolio`,
    kpi_total_aum_as_of: `Total AUM (as of date)`,
    kpi_goals: `Goals`,

    kpi_high_risk: `High risk`,
    kpi_ge50_churn_prob: `≥ 50% churn probability`,
    kpi_medium_risk: `Medium risk`,
    kpi_low_risk: `Low risk`,
    kpi_avg_probability: `Avg probability`,
    kpi_holders_scored: `holders scored`,
    kpi_overall_churn_rate: `Overall churn rate`,
    kpi_investors_fully_redeemed: `{churned} of {total} investors fully redeemed`,
    kpi_active_holders: `Active holders`,
    kpi_currently_hold_1fund: `currently hold ≥1 fund`,
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
    docs_overview_desc: `Ringkasan satu halaman untuk seluruh bisnis: total dana kelolaan (AUM), jumlah pengguna, volume beli/jual, grafik tren transaksi, rincian per produk, dan peta sebaran investor di seluruh Indonesia. Tabel "Produk terbesar berdasarkan AUM" menampilkan semua produk/MI per tanggal pilihan (bukan hanya 10 teratas), dan Anda bisa memilih produk mana saja yang ikut dihitung — membatalkan pilihan sebuah produk juga mengurangi AUM-nya dari total MI-nya.`,
    docs_aum_desc: `Bagaimana total dana kelolaan (AUM) dan pendapatan platform berubah dari waktu ke waktu.`,
    docs_performance_desc: `Bagaimana kinerja harga (NAV) tiap produk — pilih rentang waktu dari 1 hari hingga 5 tahun dan bandingkan beberapa produk sekaligus.`,
    docs_growth_desc: `Angka pemasaran dan pertumbuhan: seberapa efektif kampanye promo, siapa yang paling banyak mereferensikan investor baru, dan produk apa yang paling sering dipindahkan (switching) investor.`,

    docs_panel_investor: `Investor`,
    docs_hnwi_desc: `"High-Net-Worth Individuals" — daftar investor dengan kepemilikan dalam rentang AUM tertentu (Anda tentukan ambang batas min/max) per tanggal yang dipilih, termasuk profil risiko tiap investor (tingkat risiko, prioritas investasi, toleransi risiko), lengkap dengan ringkasan total dan fitur ekspor. Rincian per produk di bawah memiliki filter Min/Max AUM tersendiri yang independen, berdasarkan nilai AUM tiap produk, bukan total investor.`,

    docs_panel_operations: `Operasional & Keuangan`,
    docs_reconciliation_desc: `Pengecekan harian untuk memastikan angka di berbagai sistem sudah cocok — gunakan ini untuk menangkap selisih sebelum menjadi masalah nyata.`,
    docs_revenue_desc: `Berapa banyak pendapatan/fee yang diperoleh Sayakaya, dirinci per produk dan manajer investasi, dari masing-masing dari dua sumber data yang dilacak platform (PWC dan GS).`,
    docs_user_lifetime_desc: `Pendapatan fee yang sama seperti Revenue (PWC), tapi dijawab per nasabah, bukan per produk: berapa yang dihasilkan masing-masing untuk platform, berdampingan dengan berapa lama mereka bertahan — kapan mendaftar, kapan pertama membeli, dan berapa lama tetap berinvestasi. Klik nasabah mana pun untuk melihat rinciannya per bulan dan per produk.`,
    docs_campaign_revenue_desc: `Berapa yang dihasilkan kembali oleh setiap campaign promo. Pembelian yang settle memakai kode promo mengunci unit tersebut, dan bagian ini mengestimasi management fee yang dihasilkan selama unit itu tetap diinvestasikan — sampai nasabah redeem lebih awal, atau menjualnya setelah masa holding berakhir. Ditampilkan bersama biaya bonus campaign sehingga terlihat promo mana yang menutup biayanya sendiri.`,
    docs_predict_desc: `Prediksi berbasis machine learning: proyeksi AUM dan volume transaksi, investor mana yang berisiko keluar (churn), dan tren retensi dari waktu ke waktu.`,

    docs_panel_admin: `Admin (khusus superuser)`,
    docs_manage_users_desc: `Buat akun login dasbor untuk tim Anda, dan tentukan persis bagian mana saja yang boleh dilihat masing-masing orang.`,
    docs_activity_log_desc: `Lihat siapa yang login, mengekspor file, mengajukan pertanyaan Ask, menjalankan query SQL, melihat portofolio seorang investor, atau mengubah akun — dan kapan.`,

    // ---- Phase 2: per-section dashboard UI (added 2026-08-03) ----
    common_search_hint: `Cari berdasarkan kode SID, nama, atau email.`,
    common_sid_ph: `mis. kode SID`,
    common_search: `Cari`,
    common_as_of: `Per tanggal`,
    common_go: `Buka`,
    common_csv: `CSV`,
    common_excel: `Excel`,
    common_xlsx_portfolio_full: `Excel (portofolio + performa, semua jenis)`,
    common_columns: `Kolom`,
    common_pdf_portfolio_only: `PDF (portofolio saja)`,
    common_pdf_with_performance: `PDF (dengan performa)`,
    common_filters: `Filter`,
    common_detail: `Detail`,
    common_day: `Hari`,
    common_week: `Minggu`,
    common_month: `Bulan`,
    common_all_fund_types: `Semua jenis produk`,
    common_top3: `Top 3`,
    common_top5: `Top 5`,
    common_top10: `Top 10`,
    common_pick_funds: `Pilih produk`,
    common_search_funds_ph: `Cari produk…`,
    common_period: `Periode`,
    common_period_summary: `Ringkasan periode (semua produk)`,
    common_xlsx_single_sheet: `Excel: satu sheet`,
    common_xlsx_per_fund: `Excel: satu sheet per produk`,
    common_xlsx_per_mi: `Excel: satu sheet per MI`,
    common_remisier_portion: `Porsi remisier (%)`,
    common_daily: `Harian`,
    common_monthly: `Bulanan`,
    common_quarterly: `Kuartalan`,
    common_run: `Jalankan`,
    common_users_under_remisier: `Pengguna di bawah remisier ini`,
    common_rev_detail_per_fund: `Detail pendapatan (per produk)`,
    common_rev_summary_all_funds: `Ringkasan pendapatan (semua produk)`,
    common_all_types: `Semua jenis`,
    common_all_statuses: `Semua status`,
    common_tx_detail: `Detail transaksi`,
    common_prev: `← Sebelumnya`,
    common_next: `Berikutnya →`,
    common_include_restricted: `Sertakan kolom terbatas (kata sandi, KYC, dll. — khusus superuser)`,
    common_confirm_password_ph: `Konfirmasi kata sandi Anda`,
    common_advanced_optional: `Lanjutan (opsional)`,
    common_copy: `Salin`,
    common_edit: `Ubah`,
    common_vs: `vs`,
    common_suggest: `✨ Sarankan`,
    common_loading: `Memuat…`,
    common_cancel: `Batal`,
    common_refresh: `Segarkan`,
    common_fund_wildcard_ph: `Produk (nama atau kode, wildcard)`,
    common_mi_wildcard_ph: `Manajer Investasi (wildcard)`,
    common_remisier_code_ph: `Kode remisier (kecocokan sebagian, mis. CE cocok dengan CELIA/CENIA)`,

    port_find_investor: `Cari investor`,
    port_aum_over_time: `AUM dari waktu ke waktu`,
    port_holdings: `Kepemilikan`,
    port_aum_performance: `Performa AUM`,
    port_aum_performance_hint: `Perubahan % nilai total portofolio, dari mi_fee_logs.portfolio_with_code.`,
    portfix_aum_performance_hint: `Perubahan % nilai total portofolio, dari mi_fee_logs.portfolio_fix.`,

    pe_holdings_by_fund: `Kepemilikan per produk`,
    pe_holdings_by_fund_hint: `Digabung dari semua goal, per tanggal yang dipilih.`,
    pe_holdings_by_goal: `Kepemilikan per goal`,
    pe_holdings_by_goal_hint: `Hanya pratinjau — ekspor tetap digabung dari semua goal.`,

    hnwi_min_aum: `Min AUM (Rp)`,
    hnwi_max_aum: `Max AUM (Rp)`,
    hnwi_filters_hint: `Dari mi_fee_logs.portfolio_with_code, satu hari sebelum created_at-nya sendiri (created_at-nya lebih maju satu hari dari tanggal AUM yang diwakilinya). Kosongkan Min/Max AUM untuk melihat semua orang, diurutkan dari AUM tertinggi.`,
    hnwi_min_fund_aum: `Min AUM produk (Rp)`,
    hnwi_max_fund_aum: `Max AUM produk (Rp)`,
    hnwi_by_fund_filters_hint: `Menyaring tiap baris berdasarkan AUM produk itu sendiri (bukan total investor). Independen dari filter Min/Max AUM di atas. Kosongkan untuk melihat semua kepemilikan produk.`,
    hnwi_total_per_investor: `AUM per investor (total)`,
    hnwi_per_fund: `AUM per investor per produk`,

    ov_transaction_volume: `Volume transaksi`,
    ov_by_tx_type: `Berdasarkan jenis transaksi`,
    ov_by_status: `Berdasarkan status`,
    ov_user_verification: `Verifikasi pengguna`,
    ov_aum_by_fund_type: `AUM berdasarkan jenis produk`,
    ov_investor_distribution: `Sebaran investor per provinsi`,
    ov_top_cities_investors: `Kota teratas berdasarkan jumlah investor`,
    ov_top_cities_aum: `Kota teratas berdasarkan AUM`,
    ov_largest_funds: `Produk terbesar berdasarkan AUM`,
    ov_by_fund: `Berdasarkan produk`,
    ov_by_manager: `Berdasarkan manajer investasi`,
    ov_select_funds: `Pilih produk`,
    ov_largest_funds_hint: `Semua produk/MI yang punya posisi pada tanggal terpilih (bukan hanya 10 teratas). AUM = total nilai kepemilikan, investor = jumlah investor unik yang memiliki posisi. Hilangkan centang pada produk untuk membuangnya dari angka di bawah — total MI-nya ikut berkurang. Sumber: mi_fee_logs.portfolio_with_code, satu hari sebelum created_at-nya sendiri — datanya lebih ke belakang dibanding portfolio_fix, yang baru tersedia mulai awal Agustus.`,

    aum_history_title: `Riwayat AUM & pendapatan`,
    aum_history_hint: `AUM akhir periode (point-in-time) dan pendapatan (aperd_share, dijumlahkan). Menggunakan rentang tanggal di atas. Sumber: mi_fee_logs.mi_fee.`,

    perf_trend_title: `Tren performa produk`,
    perf_trend_hint: `NAV harian (harga aktual). Pilih produk untuk membandingkannya secara langsung, atau jangan pilih apa pun untuk melihat performa terbaik berdasarkan % perubahan. Sumber: sayakaya.main.snapshots.`,
    perf_by_type_title: `Performa produk berdasarkan jenis`,
    perf_by_type_hint: `Perubahan % NAV per jenis produk, dirata-rata di seluruh produk jenis tersebut. Sumber: sayakaya.main.snapshots/funds.`,
    perf_detail_title: `Detail produk`,
    perf_xlsx_per_type: `Excel (satu sheet per jenis)`,

    growth_campaign_title: `Performa kampanye`,
    growth_campaign_hint: `Redemption % = used_quota / quota. Estimasi biaya = used_quota × bonus_amount. Sumber: main.campaigns.`,
    growth_top_referrers: `Perekomendasi teratas`,
    growth_top_referrers_hint: `Diurutkan berdasarkan volume beli selesai dari pengguna yang mereka referensikan.`,
    growth_switching_title: `Alur perpindahan produk`,
    growth_switching_hint: `Pasangan produk asal → tujuan teratas berdasarkan jumlah switching yang selesai.`,
    growth_aum_by_manager: `AUM berdasarkan manajer investasi`,
    growth_aum_by_risk: `AUM platform berdasarkan toleransi risiko`,
    growth_aum_by_income: `AUM platform berdasarkan kelompok pendapatan`,

    recon_title: `Buku besar aplikasi vs feed kustodian`,
    recon_hint: `Total transaksi selesai harian berdasarkan jenis: main.transactions.completed_at (aplikasi) vs sinvest.trx_history.Input_Date (kustodian), dicocokkan berdasarkan jenis transaksi. "ALL" adalah total per hari di semua jenis; backoffice belum membukukan Liquidation/Transfer/Unit Adjustment, sehingga jenis tersebut mungkin menampilkan baris khusus kustodian. Menggunakan rentang tanggal di atas. amount_diff yang besar menandai hari yang perlu diselidiki.`,

    rev_filters_hint: `Filter tanggal khusus bagian ini — terpisah dari rentang tanggal di atas. Toggle Hari/Minggu/Bulan mengatur ukuran bucket tabel dan grafik di bawah. Filter Produk/MI menerima kecocokan sebagian (mis. "equity" cocok dengan produk apa pun yang mengandung "equity" di nama atau kodenya).`,
    rev_trend: `Tren pendapatan`,
    rev_detail_title: `Pendapatan management fee (per produk, per periode)`,
    rev_detail_hint: `Management fee yang bertambah harian dari AUM (portfolio_with_code), dibagi menjadi porsi AperD/MI, dijumlahkan per produk per periode.`,
    rev2_filters_hint: `Perhitungan sama seperti Revenue, tapi AUM berasal dari goal_snapshots, bukan mi_fee_logs.portfolio_with_code — tidak perlu koreksi selisih hari, sehingga seharusnya lebih akurat. Dipisahkan dari Revenue untuk perbandingan berdampingan. Toggle Hari/Minggu/Bulan mengatur ukuran bucket tabel dan grafik di bawah. Filter Produk/MI menerima kecocokan sebagian.`,
    rev2_detail_hint: `Management fee yang bertambah harian dari AUM (goal_snapshots), dibagi menjadi porsi AperD/MI, dijumlahkan per produk per periode.`,

    ul_sid_ph: `SID (persis, opsional)`,
    ul_filters_hint: `Perhitungan management fee harian yang sama seperti Revenue (PWC), tapi dikelompokkan per nasabah, bukan per produk. Kolom uang mengikuti rentang tanggal yang dipilih; kolom lifetime (terdaftar, pembelian pertama, lifetime holding) berasal dari seluruh riwayat transaksi, yang jauh lebih panjang daripada feed portfolio_with_code.`,
    ul_trend: `Pendapatan & jumlah nasabah dari waktu ke waktu`,
    ul_users_title: `Pendapatan & lifetime per nasabah`,
    ul_users_hint: `Diurutkan dari porsi milik platform (porsi AperD) terbesar. Klik satu baris untuk melihat rincian per bulan dan per produk nasabah tersebut. "Holding pertama/terakhir" adalah tanggal dari feed snapshot dan hanya mundur sejauh feed itu ada — gunakan "Pembelian pertama" dan "Lifetime holding" untuk lifetime sebenarnya.`,

    cr_promo_ph: `Kode promo (wildcard)`,
    cr_filters_hint: `Estimasi pendapatan management fee dari unit yang dikunci setiap promo. Pembelian yang settle memakai kode promo membuat baris bonus_portfolios; unit tersebut menghasilkan fee selama tetap diinvestasikan. Status on_going dihitung sampai hari ini, redeemed berhenti di tanggal redeem, dan succeeded dihitung sampai ledger transaksi menunjukkan unit itu terjual dari goal dan produk yang sama.`,
    cr_trend: `Tren pendapatan campaign`,
    cr_campaigns_title: `Per campaign (seluruh rentang)`,
    cr_campaigns_hint: `Satu baris per kode promo. "Est. biaya" adalah bonus yang dibayarkan campaign (bonus amount × kuota terpakai), sehingga "Net vs biaya" menunjukkan apakah fee dari unit yang dikunci menutup biaya promo tersebut.`,
    cr_detail_title: `Per campaign, per periode`,
    cr_detail_hint: `"AperD (alt)" adalah pendapatan yang sama dengan asumsi sebaliknya tentang unit mana yang terjual lebih dulu — kolom utama mengasumsikan unit campaign terjual duluan, kolom alt mengasumsikan terjual terakhir. Selisih keduanya adalah tingkat ketidakpastian estimasi ini.`,
    cr_xlsx_per_promo: `Excel: satu sheet per campaign`,

    rem_gs_hint: `Fee remisier adalah porsi dari porsi AperD (bukan management fee mentah) — mis. Sayakaya 40% / remisier 60% dari porsi AperD.`,
    rem_gs_detail_hint: `Management fee yang bertambah harian dari AUM goal_snapshots, dibagi menjadi porsi AperD/MI, lalu AperD dibagi menjadi porsi remisier/Sayakaya — dijumlahkan per produk per periode.`,
    rem_pwc_hint: `Pembagian porsi AperD remisier/Sayakaya yang sama seperti tab goal_snapshots, tapi AUM berasal dari mi_fee_logs.portfolio_with_code (sumber tab Revenue asli) — bandingkan keduanya berdampingan.`,
    rem_pwc_detail_hint: `Management fee yang bertambah harian dari AUM portfolio_with_code, dibagi menjadi porsi AperD/MI, lalu AperD dibagi menjadi porsi remisier/Sayakaya — dijumlahkan per produk per periode.`,

    remtx_filters_hint: `Difilter berdasarkan tanggal transaksi. Setiap kode adalah kecocokan sebagian yang tidak peka huruf besar/kecil (mis. CE cocok dengan CELIA/CENIA) — isi satu kolom untuk filter tunggal, atau keduanya agar cocok dengan salah satu, dan kedua kolom menerima banyak kode dipisah koma.`,
    remtx_referrer_ph: `referrer_code, kecocokan sebagian, dipisah koma`,
    remtx_sales_ph: `sales_code, kecocokan sebagian, dipisah koma`,

    predict_aum_forecast: `Prediksi AUM`,
    predict_tx_forecast: `Prediksi transaksi (volume beli)`,
    predict_churn_risk: `Risiko churn (pemegang saat ini)`,
    predict_churn_by_tenure: `Tingkat churn berdasarkan masa keanggotaan`,
    predict_churn_overview: `Ringkasan churn`,
    predict_retention_cohorts: `Kohort retensi`,
    predict_retention_hint: `% investor baru tiap bulan yang masih bertransaksi di bulan-bulan berikutnya.`,
    predict_aum_retention_cohorts: `Kohort retensi AUM`,
    predict_aum_retention_hint: `Kohort = bulan pertama seorang sid memiliki AUM (mi_fee_logs.portfolios). % bertahan = netflow kumulatif (beli − redeem, transaksi) sejak bulan ke-0 tetap ≥ 0. Sel menunjukkan netflow kumulatif.`,
    predict_ml_banner: `<strong>Prediksi &amp; skor churn memerlukan model.</strong>
        Jalankan <code>setup/ml_models.sql</code> sekali di BigQuery (lihat PREDICTIVE-MODELS.md), lalu muat ulang.
        Bagian retensi dan tingkat churn di bawah tetap berfungsi tanpanya.`,

    ask_button: `Tanya`,
    ask_hint_default: `Gunakan bahasa Anda sendiri untuk mendapatkan data — tidak perlu keahlian teknis.`,
    ask_hint_followup: `Mode lanjutan: pertanyaan Anda berikutnya bisa merujuk "itu"/"tersebut" dan akan dibangun dari pertanyaan {n} di bawah.`,
    ask_conversation_count: `Percakapan · {n} pertanyaan{s}`,
    ask_new_chat_title: `Lupakan yang di atas dan tanyakan hal lain yang tidak terkait`,
    ask_new_chat_btn: `↺ Mulai percakapan baru`,
    ask_ex1: `10 produk teratas berdasarkan AUM`,
    ask_ex2: `Berapa jumlah pengguna terverifikasi kita?`,
    ask_ex3: `Volume beli selesai per bulan di 2025`,
    ask_ex4: `Jumlah transaksi berdasarkan status`,
    ask_ex5: `5 manajer investasi teratas berdasarkan jumlah produk`,
    ask_ex_activity: `Siapa yang login hari ini?`,
    ask_context_ph: `Opsional: query SQL terkait untuk digunakan sebagai konteks tambahan`,
    ask_generated_sql: `SQL yang dihasilkan`,
    ask_input_ph: `mis. 10 produk teratas berdasarkan AUM, atau total volume beli per bulan di 2025`,
    ask_chart_hint_ph: `Opsional: jelaskan grafik yang Anda inginkan`,
    ask_disabled: `Fitur Ask nonaktif karena tidak ada Anthropic API key yang diset di server.
          Tambahkan variabel lingkungan <code>ANTHROPIC_API_KEY</code> lalu restart untuk mengaktifkannya.`,

    chart_none: `Tanpa grafik`,
    chart_bar: `Batang`,
    chart_line: `Garis`,
    chart_pie: `Pai`,
    chart_doughnut: `Donat`,
    chart_scatter: `Sebar`,

    sql_lab_title: `SQL lab`,
    sql_lab_hint: `Hanya baca. Hanya SELECT / WITH. Hasil dibatasi maks. 5.000 baris.`,
    sql_estimate_cost: `Estimasi biaya`,

    admin_users: `Pengguna`,
    admin_add_user: `+ Tambah pengguna`,
    admin_modal_hint: `Pilih bagian mana yang boleh diakses orang ini. Superuser selalu bisa melihat semuanya.`,
    admin_superuser_full_access: `Superuser (akses penuh)`,
    admin_activity_log: `Log aktivitas`,
    admin_all_users: `Semua pengguna`,
    admin_activity_hint: `Setiap login, ekspor, pertanyaan Ask, query SQL Lab, dan perubahan akun admin, terbaru di atas. Pilih pengguna dari dropdown untuk kecocokan persis; pencarian mencocokkan action/detail sebagai wildcard (mis. "revenue" juga menemukan ekspor revenue_detail) — kosongkan untuk melihat semuanya.`,
    admin_search_action_ph: `Cari action atau detail (wildcard)`,
    admin_add_user_title: `Tambah pengguna`,
    admin_create_user: `Buat pengguna`,
    admin_edit_user_prefix: `Ubah`,
    admin_save_changes: `Simpan perubahan`,
    admin_password_keep_current_ph: `Kosongkan untuk mempertahankan kata sandi saat ini`,

    // ---- Phase 3: KPI cards + chart legends (added 2026-08-03) ----
    kpi_platform_aum: `AUM platform`,
    kpi_investing_users: `pengguna berinvestasi`,
    kpi_total_users: `Total pengguna`,
    kpi_verified: `terverifikasi`,
    kpi_buy_volume: `Volume beli (rentang)`,
    kpi_completed_buys: `pembelian selesai`,
    kpi_sell_volume: `Volume jual (rentang)`,
    kpi_completed_sells: `penjualan selesai`,
    kpi_active_users: `Pengguna aktif (rentang)`,
    kpi_ge1_tx: `dengan ≥1 transaksi`,
    kpi_transactions: `Transaksi (rentang)`,
    kpi_all_statuses: `semua status`,
    kpi_active_funds: `Produk aktif`,
    kpi_total_in_catalog: `total dalam katalog`,
    kpi_new_users_30d: `Pengguna baru (30h)`,
    kpi_rolling_window: `jendela bergulir`,
    chart_buy_volume: `Volume beli`,
    chart_sell_volume: `Volume jual`,
    chart_active_users: `Pengguna aktif`,

    kpi_total_aum: `Total AUM`,
    kpi_holding_count: `{n} kepemilikan`,
    kpi_regular_portfolio: `Portofolio reguler`,
    kpi_not_available_past_date: `tidak tersedia untuk tanggal lampau`,
    kpi_bonus_portfolio: `Portofolio bonus`,
    kpi_total_aum_as_of: `Total AUM (per tanggal)`,
    kpi_goals: `Goal`,

    kpi_high_risk: `Risiko tinggi`,
    kpi_ge50_churn_prob: `≥ 50% probabilitas churn`,
    kpi_medium_risk: `Risiko sedang`,
    kpi_low_risk: `Risiko rendah`,
    kpi_avg_probability: `Probabilitas rata-rata`,
    kpi_holders_scored: `pemegang dinilai`,
    kpi_overall_churn_rate: `Tingkat churn keseluruhan`,
    kpi_investors_fully_redeemed: `{churned} dari {total} investor menarik seluruh dana`,
    kpi_active_holders: `Pemegang aktif`,
    kpi_currently_hold_1fund: `saat ini memiliki ≥1 produk`,
  },
};

const LANG_KEY = 'sk_lang';
function getLang() { return localStorage.getItem(LANG_KEY) || 'en'; }
function t(key) { return I18N[getLang()]?.[key] ?? I18N.en[key] ?? key; }

// A tagged element whose key isn't in either dictionary yet (mid-rollout)
// is left exactly as authored in the HTML, instead of showing the raw key —
// t() itself still returns the key as a last resort for callers that build
// strings dynamically, but translatePage() has the original markup to fall
// back to, so it should always prefer that over an ugly key name.
function translatePage() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => { if (el.dataset.i18n in I18N.en) el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { if (el.dataset.i18nHtml in I18N.en) el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { if (el.dataset.i18nPlaceholder in I18N.en) el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { if (el.dataset.i18nTitle in I18N.en) el.title = t(el.dataset.i18nTitle); });
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

// Called on logout (see clearAuth() in app.js) so a shared/kiosk computer
// always hands the next login a clean English default, regardless of
// what language a previous session was left on.
function resetLangToDefault() {
  localStorage.removeItem(LANG_KEY);
  translatePage();
  syncLangSeg(getLang());
}
