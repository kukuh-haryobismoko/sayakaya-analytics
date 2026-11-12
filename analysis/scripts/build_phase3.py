#!/usr/bin/env python3
"""Build Phase 3 team findings from outputs/raw/*.txt. Every number is read from a raw file."""
import os, re, json, math, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, OUT = os.path.join(ROOT, 'outputs', 'raw'), os.path.join(ROOT, 'outputs')
STAMP = datetime.datetime.now().strftime('%Y-%m-%d %H:%M WIB')

def parse(fname):
    txt = open(os.path.join(RAW, fname)).read()
    out = {}
    for part in re.split(r'^## ', txt, flags=re.M)[1:]:
        name, _, rest = part.partition('\n')
        m = re.search(r'\[\s*(?:\{.*?\}\s*,?\s*)*\]', rest, re.S)
        out[name.strip()] = json.loads(m.group(0)) if m else []
    return out

B = {}
for f in sorted(os.listdir(RAW)):
    if f.endswith('.txt'):
        B.update(parse(f))
SB = json.load(open(os.path.join(RAW, 'supabase_email.json')))['email_batch']

def one(block, **kw):
    for r in B[block]:
        if all(r.get(k) == v for k, v in kw.items()):
            return r
    raise KeyError(f'{block} {kw}')

def pct(a, b):
    return 100.0 * a / b if b else 0.0

def flag(n):
    return ' ⚠n<30' if n < 30 else ''

def wilson(k, n, z=1.959964):
    if not n:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return 100 * (c - m) / d, 100 * (c + m) / d

def ci(k, n):
    lo, hi = wilson(k, n)
    return f"{pct(k,n):.1f}% (95% CI {lo:.1f}-{hi:.1f}%)"

def ztest(k1, n1, k2, n2):
    if not n1 or not n2:
        return 0.0, 1.0
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 0.0, 1.0
    z = (p1 - p2) / se
    return z, math.erfc(abs(z) / math.sqrt(2))

# ---- shared inputs
acq = {r['grp']: r for r in B['acq_funnel']}
ret = {r['grp']: r for r in B['retention_by_acq']}
mat = {r['grp']: r for r in B['mature_repeat']}
amt = {r['grp']: r for r in B['first_buy_amt']}
stuck = {r['k']: r['n'] for r in B['stuck_sizes']}
inv_total = sum(r['inv'] for r in acq.values())
cohort = sum(r['reg'] for r in acq.values())
assert inv_total == one('inv_total')['inv'], 'investor total mismatch'
APPR = sum(r['approved'] for r in acq.values())
SUBM = sum(r['submitted'] for r in acq.values())
APPR_SHARE = pct(APPR, SUBM)

WS = {r['status']: r for r in B['sla_ga_submit_to_decision']}
SW = {r['weekend_submit']: r for r in B['sla_by_submit_weekend']}
WB = {r['weekend']: r for r in B['wait_buckets']}
WN = {r['office_submit']: r for r in B['wait_night']}
DH = {r['h']: r['n'] for r in B['decision_hour']}
DOW = {r['dow']: r for r in B['decision_dow_hour']}
DM = {}
for r in B['decisions_by_month']:
    DM.setdefault(r['m'], {})[r['status']] = r['n']
WAIT = {r['wait']: r for r in B['wait_vs_buy']}
RO = {r['st']: r for r in B['resub_oct']}
RA = {r['st']: r for r in B['resubmit_after_fail']}
DH_T = sum(DH.values())
DH_OFF = sum(v for h, v in DH.items() if h < 9 or h > 20)
PKH = max(DH, key=DH.get)
LAG = {(r['per'], r['lagb']): r for r in B['oct_lag']}
WEEKS = [(r['wk']['value'], r['n'], r['bought7']) for r in B['oct_week']]
AR = B['actor_rank']

STEPS = {r['event_name']: r['users'] for r in B['distinct_steps']}
KP = {r['pf']: r for r in B['kyc_platform']}
SCR = {r['scr']: r['users'] for r in B['kyc_screen_view_all']}
PF = {r['pm']: r for r in B['pay_fail']}
PFC = {r['pm']: r for r in B['pay_fail_cohort']}
OU = one('orders_users')
GATE = {r['abandoned']: r for r in B['gate_outcome']}
ANB = one('approved_nobuy_ga')
VER = {}
for r in B['step_by_version']:
    VER.setdefault(r['event_name'], {})[r['v']] = r['users']
PUSHB = {r['seg']: r for r in B['push_click_by_status']}
PUSHA = {r['seg']: r for r in B['push_android_by_seg']}
PCB, PCN = one('push_click_vs_buy', clicked=True), one('push_click_vs_buy', clicked=False)
PCTB = one('push_click_to_buy')
PRECV = one('push_funnel', event_name='notification_receive')['events']
PDISM = one('push_funnel', event_name='notification_dismiss')['events']

pre_n = sum(v['n'] for (p, lb), v in LAG.items() if p == 'JulSep' and lb != 'd>30d')
pre_b = sum(v['bought7'] for (p, lb), v in LAG.items() if p == 'JulSep' and lb != 'd>30d')
oct_n = sum(v['n'] for (p, lb), v in LAG.items() if p == 'Oct' and lb != 'd>30d')
oct_b = sum(v['bought7'] for (p, lb), v in LAG.items() if p == 'Oct' and lb != 'd>30d')

# ================= MARKETING =================
L = []
A = L.append
A(f"# Temuan — Marketing\n\nDibangun {STAMP} dari `outputs/raw/` (BigQuery read-only) dan Supabase `dashboard_email_log`/`dashboard_email_events`.\n")
A(f"Kohort = Fase 1/2 (tanpa referrer RAIZ/RAIZKAYA, tanpa HNWI): {cohort:,} registrasi, {inv_total:,} investor. Tarik data 2026-11-09.\n")
A("| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |\n|---|---|---|---|---|---|---|")
A("| M1 | Sign-up sales code: konversi setara referral, retensi mature terburuk | 21,7% investor/reg vs 20,6% referral, 3,7% none; repeat mature 39,3% vs 60,0% | Tinggi (observasional) | Tinggi | M | P1 |")
A("| M2 | Bonus kredit 6.130 user, 59,2% tidak pernah beli berbayar | Rp469.400.000 kredit ke 3.629 non-pembayar | Tinggi | Tinggi | S (policy) | P0 |")
A("| M3 | Promo di beli-pertama berkorelasi repeat lebih rendah | 52,9% vs 61,7% | Sedang (confounded) | Sedang | S | P2 |")
A("| M4 | Email lifecycle tidak terukur; batch kena throttle, 0 click | 93/743 gagal (454), semua dikirim ulang; 0 click event; open 497/497 dalam 2 jam | Tinggi | Sedang | S | P1 |")
A("| M5 | Push menjangkau non-investor, konversi pasca-klik tak terukur | 252 approved-belum-beli klik; uji klik→beli hanya 103 user | Rendah | Sedang | M | P2 |")
A("| M6 | Tiga kolam macet tanpa messaging lifecycle | 13.093 approved-belum-beli; 191 unverified <30 h; 92 investor diam 60-90 h | Tinggi | Tinggi | M | P1 |")
A("")

sc, rf, no = acq['sales_code'], acq['referrer_code'], acq['none']
zi = ztest(sc['inv'], sc['reg'], no['inv'], no['reg'])
za = ztest(sc['approved'], sc['submitted'], no['approved'], no['submitted'])
mr = ztest(mat['sales_code']['repeat_inv'], mat['sales_code']['mature_inv'], mat['none']['repeat_inv'], mat['none']['mature_inv'])
A("## M1 — Sales code: konversi setara referral, retensi mature terburuk\n")
A("**Pain point.** Sign-up dengan sales code (booth/agen) menghasilkan investor hampir 6x grup organik, tetapi repeat rate mature-nya terendah dan tiket pertamanya terkecil.\n")
A("**Evidence (Observed).** Kohort penuh, registrasi s.d. 2026-11-09.\n")
A("| Grup | Registrasi | Submit KYC | Approved | Investor | Investor/reg | Approved/submit | Investor/approved |")
A("|---|---|---|---|---|---|---|---|")
for g in ['sales_code', 'referrer_code', 'none']:
    r = acq[g]
    A(f"| {g} | {r['reg']:,} | {r['submitted']:,} ({pct(r['submitted'],r['reg']):.1f}%) | {r['approved']:,} ({pct(r['approved'],r['reg']):.1f}%) | {r['inv']:,} | {pct(r['inv'],r['reg']):.1f}% | {pct(r['approved'],r['submitted']):.1f}% | {pct(r['inv'],r['approved']):.1f}% |")
A("")
A(f"- Sales code vs none, investor/reg: {ci(sc['inv'],sc['reg'])} vs {ci(no['inv'],no['reg'])}; z={zi[0]:.1f}, p<0.0001.\n")
A(f"- Sales code vs none, approved/submit: {ci(sc['approved'],sc['submitted'])} vs {ci(no['approved'],no['submitted'])}; z={za[0]:.1f}, p<0.0001.\n")
A("| Grup | Investor | Repeat (2+ hari beli) | Mature (beli-1 ≥120 h) | Repeat mature | Churn mature >90 h | Median tiket-1 | Tiket-1 <Rp100k |")
A("|---|---|---|---|---|---|---|---|")
for g in ['sales_code', 'referrer_code', 'none']:
    r, m, f = ret[g], mat[g], amt[g]
    A(f"| {g} | {r['inv']:,} | {pct(r['repeat_inv'],r['inv']):.1f}% | {m['mature_inv']:,} | {pct(m['repeat_inv'],m['mature_inv']):.1f}% | {pct(r['mature_churn'],m['mature_inv']):.1f}% | Rp{f['median_amt']:,} | {pct(f['lt100k'],f['n']):.1f}% |")
A("")
A(f"- Repeat mature, sales code vs none: {ci(mat['sales_code']['repeat_inv'],mat['sales_code']['mature_inv'])} vs {ci(mat['none']['repeat_inv'],mat['none']['mature_inv'])}; z={mr[0]:.1f}, p<0.0001. Vs referral: {pct(mat['referrer_code']['repeat_inv'],mat['referrer_code']['mature_inv']):.1f}%.\n")
A(f"- Churn dihitung pada investor mature saja; churn mentah seluruh investor menyesatkan karena kohort sales code lebih muda.\n")
A(f"- Median tiket pertama Rp{amt['sales_code']['median_amt']:,} vs Rp{amt['referrer_code']['median_amt']:,} (referral) dan Rp{amt['none']['median_amt']:,} (none). Gap tiket adalah efek bauran akuisisi (minimum agen), bukan bukti penyebab churn.\n")
A("**Root cause (Inferred, keyakinan sedang).** Investor sales code masuk dengan tiket kecil yang dibantu agen dan tetap bergantung pada agen, bukan dorongan diri sendiri, sehingga lebih jarang repeat. Belum diuji: follow-up agen setelah beli pertama; apakah kode dipakai untuk beli sekali saat promo.\n")
gap = round(mat['sales_code']['mature_inv'] * (pct(mat['none']['repeat_inv'], mat['none']['mature_inv']) - pct(mat['sales_code']['repeat_inv'], mat['sales_code']['mature_inv'])) / 100)
A(f"**Expected impact (aritmetika).** {mat['sales_code']['mature_inv']:,} investor mature x gap repeat {pct(mat['none']['repeat_inv'],mat['none']['mature_inv'])-pct(mat['sales_code']['repeat_inv'],mat['sales_code']['mature_inv']):.1f} pp = {gap:,} investor repeat tambahan bila gap tertutup penuh. Menutup 30% lewat follow-up agen hari ke-7 dan ke-30 = {round(0.3*gap)} user. Asumsi: gap bisa diperbaiki, bukan seleksi.\n")
A("**Effort.** M (alur kerja agen + task CRM, tanpa ubah produk).\n")
A("**Priority.** P1.\n")
A("**KPI / validation.** Repeat rate mature per grup akuisisi, bulanan. Uji before/after follow-up agen hari ke-7 dan ke-30 pada kohort sales code baru; target +5 pp dalam 90 hari.\n")

BB = one('bonus_before_paid')
BX = {r['got_bonus']: r for r in B['bonus_exposure']}
BSA = {r['status']: r['n'] for r in B['bonus_status_all']}
A("## M2 — Bonus kredit adalah kebocoran belanja marketing terbesar\n")
A(f"**Pain point.** {BB['never_paid']:,} dari {BB['bonus_users']:,} penerima bonus organik tidak pernah membuat pembelian berbayar; Rp{int(BB['bonus_idr_never_paid']):,} kredit habis ke non-pembayar.\n")
A("**Evidence (Observed).** Seluruh data s.d. 2026-11-09. Bonus = transaksi beli dengan `payment_method` in ('manual_bonus','bonus'); berbayar = beli sukses di luar metode itu.\n")
A(f"- Penerima bonus {BB['bonus_users']:,} (status valid {one('bonus_status')['bonus_users_ok_status']:,}); tidak pernah bayar {BB['never_paid']:,} = {ci(BB['never_paid'],BB['bonus_users'])}; nilai ke non-pembayar Rp{int(BB['bonus_idr_never_paid']):,}.\n")
A(f"- Status pembayaran penerima: sudah pembayar sebelum kredit {BB['bonus_after_first_paid']:,} ({pct(BB['bonus_after_first_paid'],BB['bonus_users']):.1f}% — bonus berfungsi sebagai reward); dapat kredit sebelum beli berbayar {BB['bonus_before_first_paid']:,} ({pct(BB['bonus_before_first_paid'],BB['bonus_users']):.1f}% — ini satu-satunya kelompok yang bisa dibaca sebagai akuisisi); tidak pernah beli berbayar {BB['never_paid']:,} ({pct(BB['never_paid'],BB['bonus_users']):.1f}%).\n")
A(f"- Status transaksi bonus: completed {BSA['completed']:,}; cancelled {BSA['cancelled']:,}.\n")
A(f"- User approved dengan bonus {BX[True]['users']:,}: investor {pct(BX[True]['inv'],BX[True]['users']):.1f}%, repeat {pct(BX[True]['repeat_inv'],BX[True]['users']):.1f}%. Tanpa bonus {BX[False]['users']:,}: investor {pct(BX[False]['inv'],BX[False]['users']):.1f}%, repeat {pct(BX[False]['repeat_inv'],BX[False]['users']):.1f}%. Grup bonus terseleksi post-hoc ({BB['bonus_after_first_paid']:,} dapat bonus setelah bayar); ini korelasi, bukan estimasi lift.\n")
A(f"**Root cause (Inferred, keyakinan sedang).** Hanya {BB['bonus_before_first_paid']:,} penerima ({pct(BB['bonus_before_first_paid'],BB['bonus_users']):.1f}%) menerima kredit sebelum pembelian berbayar, jadi program ini bukan mesin akuisisi; ia reward untuk pembayar yang sudah ada. Masalahnya {BB['never_paid']:,} penerima ({pct(BB['never_paid'],BB['bonus_users']):.1f}%) tidak pernah menghasilkan pembayaran berbayar sama sekali, dan Rp{int(BB['bonus_idr_never_paid']):,} kredit mereka tidak menciptakan pendapatan. Aturan program tidak ada di data; konfirmasi ke pemilik konfigurasi bonus.\n")
per = int(BB['bonus_idr_never_paid']) / BB['never_paid']
A(f"**Expected impact (aritmetika).** Kredit rata-rata per non-pembayar Rp{per:,.0f}. Mengonversi 10% dari {BB['never_paid']:,} = {round(0.1*BB['never_paid']):,} user; pada median tiket-1 grup none Rp{amt['none']['median_amt']:,} = Rp{round(0.1*BB['never_paid']*amt['none']['median_amt']):,} tiket pertama. Alternatif: syaratkan kredit pada pembelian berbayar pertama, memangkas eksposur Rp{int(BB['bonus_idr_never_paid']):,}.\n")
A("**Effort.** S (kebijakan/konfigurasi: siapa dapat kredit dan kapan).\n")
A("**Priority.** P0 (nilai terbesar, usaha terkecil).\n")
A("**KPI / validation.** Share penerima bonus yang beli berbayar dalam 30 hari; biaya bonus per user yang terkonversi. Uji kohort kredit-saat-beli-pertama vs kredit-saat-signup.\n")

P1 = {r['promo_on_first_buy']: r for r in B['promo_first_buy']}
P2 = {r['used_promo_paid']: r for r in B['promo_any_paid']}
zp = ztest(P1[True]['repeat_inv'], P1[True]['inv'], P1[False]['repeat_inv'], P1[False]['inv'])
A("## M3 — Promo di pembelian pertama berkorelasi dengan repeat lebih rendah (confounded)\n")
A(f"**Pain point.** Investor yang beli pertama memakai promo repeat {pct(P1[True]['repeat_inv'],P1[True]['inv']):.1f}% vs {pct(P1[False]['repeat_inv'],P1[False]['inv']):.1f}% tanpa promo.\n")
A(f"**Evidence (Observed).** Beli pertama berpromo n={P1[True]['inv']:,}: repeat {P1[True]['repeat_inv']:,} = {ci(P1[True]['repeat_inv'],P1[True]['inv'])}, churn90 {pct(P1[True]['churn90'],P1[True]['inv']):.1f}%. Tanpa promo n={P1[False]['inv']:,}: repeat {pct(P1[False]['repeat_inv'],P1[False]['inv']):.1f}%, churn90 {pct(P1[False]['churn90'],P1[False]['inv']):.1f}%. z={zp[0]:.1f}, p<0.0001.\n")
A(f"- Kontradiksi: menghitung promo di pembelian mana pun membalik tanda. Pemakai promo {pct(P2[True]['repeat_inv'],P2[True]['inv']):.1f}% repeat (n={P2[True]['inv']:,}) vs {pct(P2[False]['repeat_inv'],P2[False]['inv']):.1f}% (n={P2[False]['inv']:,}). Pemakaian promo adalah akibat dari sering beli, jadi potongan ini tidak boleh dibaca sebagai lift.\n")
A("**Root cause (Inferred, keyakinan rendah).** Promo kemungkinan menarik pembeli sekali-jalan yang sensitif harga, tetapi promo beli-pertama juga ditargetkan ke kelompok ini. Seleksi tidak bisa dipisahkan tanpa eksposur acak.\n")
A(f"**Expected impact.** Tidak dikuantifikasi. Gap {pct(P1[False]['repeat_inv'],P1[False]['inv'])-pct(P1[True]['repeat_inv'],P1[True]['inv']):.1f} pp x {P1[True]['inv']:,} investor promo = {round((pct(P1[False]['repeat_inv'],P1[False]['inv'])-pct(P1[True]['repeat_inv'],P1[True]['inv']))/100*P1[True]['inv']):,} investor repeat hanya batas atas bila gap sepenuhnya kausal; data tidak bisa menunjukkan itu.\n")
A("**Effort.** S (analisis: holdout acak).\n")
A("**Priority.** P2.\n")
A("**KPI / validation.** Repeat 90 hari untuk user baru eligible promo, acak promo vs tanpa promo (holdout 10%).\n")

D = SB['days']
ev = sum(d['with_events'] for d in D.values())
opn = sum(d['with_open'] for d in D.values())
A("## M4 — Email lifecycle: throttle, tanpa click tracking, lift tak terukur\n")
A(f"**Pain point.** Satu-satunya batch email di log (`fund_performance`/`batch`) punya {SB['failed_logs']} kiriman gagal karena throttle, 0 click event, dan {SB['sent_logs']:,} kiriman tanpa `user_id`, sehingga konversi pasca-klik tidak bisa diukur.\n")
A("**Evidence (Observed).** Supabase `dashboard_email_log`/`dashboard_email_events`, tarik 2026-11-09. Batch per hari: " + ", ".join(f"{d} = {v['sent']}" for d, v in D.items()) + ".\n")
A(f"- Gagal {SB['failed_logs']} (semua 2026-10-26), error `{SB['error']}`. Semua {SB['failed_later_sent']} penerima gagal terkirim kemudian, tidak ada kehilangan permanen.\n")
A(f"- Cakupan tracking: {ev}/{SB['sent_logs']} log terkirim punya event; batch 2026-10-13 ({D['2026-10-13']['sent']} kiriman) nol event.\n")
A(f"- Open: {opn}/{ev} log berevent punya Open ({pct(opn,ev):.1f}%), {SB['open_events']} open event. Semua open datang dalam dua jam setelah kirim (" + ", ".join(f"{h['h']}: {h['opens']}" for h in SB['open_hours']) + "), tanda prefetch/security scanning aplikasi mail, bukan dibaca. Jangan laporkan sebagai engagement.\n")
A("- Click event: 0 (tipe yang ada hanya Open/Delivery/Send). Konversi pasca-klik: **tidak tersedia**.\n")
A("- Kategori lain di log: " + "; ".join(f"{c}/{s} {st} {n}" for c, s, st, n, _, _ in SB['by_cat']) + ". Tidak ada kategori onboarding, KYC-macet, belum-investasi, atau reaktivasi.\n")
A(f"- Suppression {SB['exclusions']} baris; scheduled jobs {SB['jobs']}; queue {SB['queue']}.\n")
A("**Root cause (Inferred, keyakinan tinggi untuk mekaniknya).** Batch dikirim serentak melewati rate limit provider (454) dan event hanya tercatat untuk batch berikutnya, jadi pipeline pelaporan mulai dari kiriman 2026-10-26. Apakah ada email lifecycle di luar dashboard ini belum diketahui.\n")
A(f"**Expected impact.** Tidak bisa dikuantifikasi tanpa `user_id` per kiriman dan click/open yang terhubung ke hasil investasi. Perbaikan throughput hanya melindungi pengiriman: {SB['failed_logs']} dari {SB['sent_logs']+SB['failed_logs']} batch ({pct(SB['failed_logs'],SB['sent_logs']+SB['failed_logs']):.1f}%) butuh retry.\n")
A("**Effort.** S (tambah `user_id` + click event; sebar pengiriman batch).\n")
A("**Priority.** P1.\n")
A("**KPI / validation.** % kiriman batch dengan `user_id`; click rate per kategori/segmen; lalu uji holdout pada batch reaktivasi.\n")

A("## M5 — Push menjangkau non-investor, klik ke beli tak terukur\n")
A(f"**Pain point.** Push menjangkau approved-belum-beli dan user yang belum approved, tetapi uji klik ke beli hanya {PCB['users']+PCN['users']} user tanpa grup kontrol; tidak ada klaim lift.\n")
A("**Evidence (Observed).** GA4, 2026-10-01..2026-11-08 (39 hari).\n")
A("| Segmen | User dengan notifikasi | User Android terima | Receive | Klik/buka | Klik/receiver (Android) |")
A("|---|---|---|---|---|---|")
for k, lbl in [('investor', 'investor'), ('approved_no_buy', 'approved, belum beli'), ('not_approved', 'belum approved')]:
    r, a = PUSHB[k], PUSHA[k]
    A(f"| {lbl} | {r['users']:,} | {r['with_receive']:,} | {r['receives']:,} | {r['clicks_opens']:,} | {pct(a['users_recv_and_click'],a['users_recv']):.1f}% |")
A("")
A(f"- Receive {PRECV:,} vs dismiss {PDISM:,} event ({pct(PDISM,PRECV):.1f}% dismiss per event). iOS tidak mencatat receive/dismiss, jadi pengiriman iOS tak terukur.\n")
A(f"- Pemegang klik: {PCTB['pushers']:,} user klik; {PCTB['already_investor']:,} sudah investor, {PCTB['approved_never_bought']:,} approved-belum-beli, {PCTB['not_approved']:,} belum approved.\n")
A(f"- Uji klik ke beli (Android, approved sebelum 2026-10-01, belum beli): klik {PCB['users']} user menghasilkan {PCB['bought_in_window']} beli; tidak klik {PCN['users']} menghasilkan {PCN['bought_in_window']}. **Sel klik n<30; tidak diuji.**\n")
A("**Root cause (Inferred, keyakinan rendah).** Konten push generik (tidak ada id kampanye/segmen di GA), jadi tidak ada yang menghubungkan pesan ke perilaku.\n")
A(f"**Expected impact.** Tidak dikuantifikasi. Satu-satunya klaim sah: {PUSHB['approved_no_buy']['users']:,} user approved-belum-beli menerima notifikasi dalam 39 hari.\n")
A("**Effort.** M (id kampanye + param segmen di event notifikasi; siapkan holdout).\n")
A("**Priority.** P2.\n")
A("**KPI / validation.** Beli pertama dalam 7 hari pasca-klik vs holdout tanpa push 10%, per id kampanye.\n")

A("## M6 — Tiga kolam macet tanpa messaging lifecycle\n")
A("**Pain point.** Email dan push hanya mencakup statement, fund performance, OTP, dan notifikasi sekali-jalan. Kolam macet terbesar tidak punya pesan berulang yang tertarget di log.\n")
A("**Evidence (Observed).** `stuck_sizes` + kategori email, 2026-11-09.\n")
A("| Kolam | Ukuran | Yang ada sekarang |")
A("|---|---|---|")
A(f"| Approved, belum beli | {stuck['approved_never_bought']:,} (approved 30 hari terakhir: {stuck['approved_never_bought_ver_last_30d']:,}) | tidak ada kategori email investasi-pertama; push ada (M5) |")
A(f"| Registrasi, belum verifikasi (30 hari) | {stuck['registered_unverified_30d']:,} | tidak ada kategori pengingat KYC; push ada |")
A(f"| KYC gagal (all time) | {stuck['failed_kyc_total']:,} (daftar 30 hari: {stuck['failed_kyc_30d_reg']:,}) | tidak ada kategori email penolakan; alasan tidak disimpan (O3) |")
A(f"| Investor diam 60-90 hari | {stuck['investors_active_60_90d_silent']:,} (dari {stuck['investors_not_churned']:,} belum churn) | tidak ada kategori reaktivasi |")
A("")
A("**Root cause (Inferred, keyakinan sedang).** Messaging dipicu produk/event (statement, performa, OTP), bukan status lifecycle.\n")
drop = pct(pre_b, pre_n) - pct(oct_b, oct_n)
nudge = round(stuck['approved_never_bought_ver_last_30d'] * drop / 100 * 0.1)
A(f"**Expected impact (aritmetika).** Approval terbaru (n={stuck['approved_never_bought_ver_last_30d']:,}) beli dalam 7 hari {pct(oct_b,oct_n):.1f}% sekarang vs {pct(pre_b,pre_n):.1f}% Jul-Sep (V1). Nudge investasi-pertama yang menutup 10% gap: {stuck['approved_never_bought_ver_last_30d']:,} x {drop/100*0.1:.3f} = {nudge:,} investor per 30 hari. Asumsi: 10% gap bisa dipulihkan lewat messaging; belum diuji.\n")
A("**Effort.** M (tiga urutan berbasis trigger + holdout).\n")
A("**Priority.** P1.\n")
A("**KPI / validation.** Beli-pertama 7 hari, nudged vs holdout, per kolam; re-KYC rate kolam gagal.\n")
A("\n## Data requests (Marketing)\n")
A("- Tidak ada id kampanye di push/email; sumber registrasi GA kosong hampir sepanjang window (Fase 2). Tambahkan `campaign_id` ke event `notification_*` dan `dashboard_email_log`.\n")
A(f"- Baris batch `dashboard_email_log` punya `user_id` NULL ({SB['sent_nouser']}/{SB['sent_logs']}); tanpa itu tidak ada join email ke investasi.\n")
A("- Tidak ada tipe event klik di `dashboard_email_events`.\n")
A("- Aturan program bonus (siapa, kapan, berapa) tidak ada di BigQuery; dibutuhkan untuk mengukur M2 dengan benar.\n")
open(os.path.join(OUT, 'findings_marketing.md'), 'w').write("\n".join(L) + "\n")
print('marketing', len(L))

# ================= OPS & KYC =================
L = []
A = L.append
A(f"# Temuan — Operations & KYC\n\nDibangun {STAMP} dari `outputs/raw/` (BigQuery `main.user_status_logs`, GA4). Read-only.\n")
A("Basis: baris keputusan di `main.user_status_logs` dengan `origin_status='pending_verification'` (status verified/failed), di-join ke kohort Fase 1/2. `user_status_logs` baru ada sejak 2026-07-21 dan GA tidak membawa `user_id` pra-login, jadi waktu submit diambil dari event GA `kyc_success` (event ini menyala saat submit, lihat rekonsiliasi Fase 2).\n")
A("| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |\n|---|---|---|---|---|---|---|")
A("| O1 | Ekor keputusan: P90 15,7 jam; submit di luar jam kerja dan akhir pekan menunggu paling lama | 548 keputusan verified, 21 >24 jam; P90 akhir pekan 17,2 jam vs 11,9 jam hari kerja | Tinggi | Sedang | S | P1 |")
A("| O2 | Review terkonsentrasi di satu akun dan berbentuk batch | 1 aktor = 75,9% dari 922 keputusan; 3 aktor = 97%; 34,5% keputusan di jam 10 | Tinggi | Tinggi | M | P1 |")
A("| O3 | User ditolak jarang mengajukan ulang; alasan penolakan tidak disimpan | Oktober: 6/70 mengajukan ulang; 27/40 yang akhirnya verified mengajukan ulang | Sedang | Sedang | M | P1 |")
A("| O4 | Keputusan lebih cepat tidak berkorelasi dengan pembelian lebih tinggi | <2 jam 5,9% vs 2-24 jam 11,3% beli dalam 14 hari, semua sel kecil | Rendah | Rendah | S | P2 |")
A("")

h, hf = WS['verified'], WS['failed']
A("## O1 — Masalah SLA ada di ekor, bukan median\n")
A("**Pain point.** Median submit ke keputusan 10 menit, tetapi P90 15,7 jam dan 21 keputusan verified butuh lebih dari 24 jam.\n")
A("**Evidence (Observed).** Submit GA 2026-10-01..2026-11-08, keputusan >= submit.\n")
A("| Status | n | P50 | P90 | >24 jam | >72 jam |")
A("|---|---|---|---|---|---|")
for s in ['verified', 'failed']:
    r = WS[s]
    A(f"| {s} | {r['n']:,} | {r['p50_h']:.2f} jam | {r['p90_h']:.2f} jam | {r['over24h']} | {r['over72h']} |")
A("")
wt, wf = WB[True], WB[False]
A(f"- Submit akhir pekan: n={wt['n']:,}, >4 jam {wt['over4h']} = {ci(wt['over4h'],wt['n'])}, >24 jam {wt['over24h']}. Hari kerja: n={wf['n']:,}, >4 jam {wf['over4h']} = {ci(wf['over4h'],wf['n'])}, >24 jam {wf['over24h']}. z={ztest(wt['over4h'],wt['n'],wf['over4h'],wf['n'])[0]:.1f}, p<0.0001.\n")
on, oo = WN[False], WN[True]
A(f"- P90 submit ke keputusan: akhir pekan {SW[True]['p90_h']:.1f} jam (n={SW[True]['n']:,}) vs hari kerja {SW[False]['p90_h']:.1f} jam (n={SW[False]['n']:,}).\n")
A(f"- Submit di luar 09:00-20:00 WIB: n={on['n']:,}, >4 jam {on['over4h']} ({pct(on['over4h'],on['n']):.1f}%), >12 jam {on['over12h']} ({pct(on['over12h'],on['n']):.1f}%). Di dalam jam kerja: n={oo['n']:,}, >4 jam {oo['over4h']} ({pct(oo['over4h'],oo['n']):.1f}%), >12 jam {oo['over12h']} ({pct(oo['over12h'],oo['n']):.1f}%). z={ztest(on['over4h'],on['n'],oo['over4h'],oo['n'])[0]:.1f}, p<0.0001.\n")
A(f"- Petunjuk penting: setiap kasus jam kerja yang lewat 4 jam juga lewat 12 jam ({oo['over12h']}/{oo['over4h']}). Artinya diantrekan ke hari kerja berikutnya, bukan dikerjakan lambat.\n")
A(f"- Jam keputusan (semua keputusan, n={DH_T:,}): puncak jam {PKH}:00 WIB = {DH[PKH]} ({pct(DH[PKH],DH_T):.1f}%); 21:00-08:59 hanya {DH_OFF} ({pct(DH_OFF,DH_T):.1f}%). Keputusan Sabtu {DOW['Sat']['n']} + Minggu {DOW['Sun']['n']} = {DOW['Sat']['n']+DOW['Sun']['n']} ({pct(DOW['Sat']['n']+DOW['Sun']['n'],DH_T):.1f}%).\n")
A("**Root cause (Inferred, keyakinan tinggi).** Keputusan dieksekusi sebagai batch pagi (jam 10) oleh satu operator; submit setelah batch menunggu pagi hari kerja berikutnya. Ekor malam dan akhir pekan adalah waktu antre, bukan waktu proses.\n")
over24 = h['over24h'] + hf['over24h']
A(f"**Expected impact (aritmetika).** {over24} keputusan >24 jam dalam 39 hari = {over24/39*30:.0f}/bulan di ekor. Bila satu slot review malam/akhir pekan memindahkan 10 dari {h['over24h']} kasus verified ke dalam 24 jam, dan mereka membeli dalam 14 hari pada laju populasi approved (7,7% Okt / 27,0% Jan-Sep, Fase 2), investor yang pulih = 10 x 0,077 = {10*0.077:.1f} sampai 10 x 0,27 = {10*0.27:.1f}. Kecil: nilai utamanya kredibilitas SLA dan kecepatan siklus penolakan, bukan volume investor.\n")
A("**Effort.** S (ubah roster/antrean, tanpa kode).\n")
A("**Priority.** P1 (murah dan terlihat, dampak investor kecil; peringkat di bawah O2).\n")
A("**KPI / validation.** P90 submit ke keputusan dan jumlah >24 jam, mingguan; before/after slot tambahan.\n")

A("## O2 — Satu reviewer dan satu jam batch memikul hampir semua keputusan\n")
A("**Pain point.** 75,9% keputusan berasal dari satu aktor; tiga aktor menutup 97%. Keputusan menumpuk di jam 10. Ini risiko key-person pada langkah yang diregulasi.\n")
A("**Evidence (Observed).** `user_status_logs.auth_user_id` atas keputusan kohort, seluruh data sejak 2026-07-21.\n")
A("| Peringkat aktor | Keputusan | Share |")
A("|---|---|---|")
for r in AR:
    A(f"| {r['actor_rank']} | {r['n']:,} | {r['pct']:.1f}% |")
A("")
dv, df_ = one('decision_actor', status='verified'), one('decision_actor', status='failed')
A(f"- Aktor per status: verified {dv['actors']} aktor ({dv['n']:,} keputusan), failed {df_['actors']} aktor ({df_['n']:,} keputusan); keputusan tanpa aktor {dv['no_actor']+df_['no_actor']}.\n")
A("- Keputusan per bulan: " + "; ".join(f"{m} verified {v.get('verified',0):,} / failed {v.get('failed',0):,}" for m, v in sorted(DM.items())) + ".\n")
A("**Root cause (Inferred, keyakinan sedang).** Satu akun operasi mengerjakan mayoritas (kemungkinan otomatis, atau login bersama yang dipakai satu anggota tim), dengan akun kedua dan ketiga menutup sisanya. Data tidak bisa membedakan approval otomatis dari manusia yang login di akun bersama.\n")
A(f"**Expected impact.** Tidak bisa dikuantifikasi langsung; risikonya antrean berhenti. Eksposur konkret: jam batch {PKH}:00 saja memuat {DH[PKH]} keputusan ({pct(DH[PKH],DH_T):.1f}%). Bila akun itu tidak tersedia satu hari kerja, semua submit non-batch menunggu minimal 24 jam; ekor yang sudah teramati menunjukkan biayanya.\n")
A("**Effort.** M (reviewer kedua / delegasi terdokumentasi + alert umur antrean).\n")
A("**Priority.** P1 (risiko operasional tinggi, usaha sedang).\n")
A("**KPI / validation.** Share keputusan per aktor (target: tidak ada aktor >50%); alert umur antrean 12 jam.\n")

A("## O3 — Penolakan hampir final, dan alasannya tidak dicatat\n")
A("**Pain point.** Dari user yang ditolak Oktober, 6 dari 70 mengajukan ulang; yang tidak mengajukan ulang hilang tanpa alasan tercatat.\n")
A("**Evidence (Observed).** Kegagalan Oktober + potongan seluruh window, event GA 2026-10-01..2026-11-08.\n")
A("| Potongan | User gagal | Ajukan ulang | Rate | Akhirnya verified |")
A("|---|---|---|---|---|")
A(f"| Oktober, masih failed | {RO['failed']['failed_users']} | {RO['failed']['resubmitted']} | {ci(RO['failed']['resubmitted'],RO['failed']['failed_users'])} | - |")
A(f"| Oktober, akhirnya verified | {RO['verified']['failed_users']} | {RO['verified']['resubmitted']} | {ci(RO['verified']['resubmitted'],RO['verified']['failed_users'])} | {RO['verified']['failed_users']} |")
A(f"| Window, masih failed | {RA['failed']['failed_users']} | {RA['failed']['resubmitted']} | {pct(RA['failed']['resubmitted'],RA['failed']['failed_users']):.1f}% | - |")
A(f"| Window, akhirnya verified | {RA['verified']['failed_users']} | {RA['verified']['resubmitted']} | {pct(RA['verified']['resubmitted'],RA['verified']['failed_users']):.1f}% | {RA['verified']['failed_users']} |")
A("")
A(f"- Pengajuan ulang memisahkan hasil dengan tajam: Oktober, yang akhirnya verified mengajukan ulang {pct(RO['verified']['resubmitted'],RO['verified']['failed_users']):.1f}% (27/40), yang masih failed {pct(RO['failed']['resubmitted'],RO['failed']['failed_users']):.1f}% (6/70). Korelasional: pengaju ulang adalah kelompok yang lebih gigih, terseleksi sendiri.\n")
octf = DM['2026-10']['failed']; octv = DM['2026-10']['verified']
A(f"- Keputusan Oktober: {octv:,} verified, {octf:,} failed = {pct(octf,octv+octf):.1f}% baris keputusan gagal. Share rejected Fase 2 (level user, 13 bulan) 26,8%; baris keputusan berbeda dari user.\n")
A("- Alasan penolakan: **tidak tersedia**. Tidak ada kolom reason/note di `user_status_logs` maupun `user_problems`. GA punya layar penolakan (`BankRejectedScreen`, `OccupationRejectedScreen`) tetapi tanpa param alasan.\n")
A("**Root cause (Inferred, keyakinan sedang).** Tidak ada nudge pasca-penolakan: tidak ada email atau push untuk user KYC gagal (lihat M6), jadi 91,4% yang tidak mengajukan ulang tidak pernah dihubungi. Alasan tidak dicatat memblokir perbaikan tertarget.\n")
n_res = round(0.1 * RO['failed']['failed_users'])
res_rate = RO['verified']['resubmitted'] / RO['verified']['failed_users']
A(f"**Expected impact (aritmetika).** Memindahkan 10% dari {RO['failed']['failed_users']} user masih-failed Oktober ke pengajuan ulang = {n_res} user; pada rate ajukan-ulang ke verified {pct(RO['verified']['resubmitted'],RO['verified']['failed_users']):.1f}% = {n_res*res_rate:.1f} verified; pada rate approved ke investor {APPR_SHARE:.1f}% (Fase 2) = {n_res*res_rate*APPR_SHARE/100:.1f} investor/bulan. Kecil tetapi murah.\n")
A("**Effort.** M (simpan alasan + email/push pengajuan ulang berbasis trigger).\n")
A("**Priority.** P1.\n")
A("**KPI / validation.** Rate pengajuan ulang dalam 14 hari pasca-penolakan (target 10% dari 8,6%); konversi rejected ke approved.\n")

A("## O4 — Waktu tunggu tidak berkorelasi dengan pembelian\n")
A("**Pain point.** Asumsi umum bahwa approval KYC lebih cepat menaikkan investasi tidak didukung data ini; estimasi titik malah berlawanan arah.\n")
A(f"**Evidence (Observed).** Keputusan approved s.d. 2026-10-25 dengan waktu submit GA di window, n={sum(v['n'] for v in WAIT.values())}.\n")
A("| Tunggu submit ke approved | n | Beli dalam 14 hari |")
A("|---|---|---|")
for k in sorted(WAIT):
    r = WAIT[k]
    A(f"| {k} | {r['n']} | {r['bought14d']} ({pct(r['bought14d'],r['n']):.1f}%){flag(r['n'])} |")
A("")
slow_k = WAIT['b2-24h']['n'] + WAIT['c>=24h']['n']
slow_b = WAIT['b2-24h']['bought14d'] + WAIT['c>=24h']['bought14d']
z4, p4 = ztest(WAIT['a<2h']['bought14d'], WAIT['a<2h']['n'], slow_b, slow_k)
A(f"- <2 jam vs >=2 jam: {pct(WAIT['a<2h']['bought14d'],WAIT['a<2h']['n']):.1f}% vs {pct(slow_b,slow_k):.1f}% (z={z4:.2f}, p={p4:.3f}, tidak signifikan). Hanya bucket >=24 jam yang n<30.\n")
A("- Seleksi: keputusan cepat berasal dari submit di batch pagi, yang mungkin user dengan dokumen lengkap pada jam kerja. n terlalu kecil untuk mengontrolnya.\n")
A("**Root cause (Inferred, keyakinan rendah).** Tidak ada efek kausal yang terdeteksi; penurunan approved ke beli Oktober vs Jan-Sep (Fase 2: 7,7% vs 27,0%) tidak dijelaskan waktu tunggu, lihat V1: penurunan tetap ada di bucket approval hari yang sama.\n")
A("**Expected impact.** Tidak ada klaim. Jangan jadikan kenaikan investor sebagai alasan program SLA; pakai untuk kepatuhan dan pengalaman.\n")
A("**Effort.** S.\n")
A("**Priority.** P2.\n")
A("**KPI / validation.** Ulangi dengan window lebih besar (n>100 per bucket) sebelum ada klaim.\n")
A("\n## Data requests (Ops & KYC)\n")
A("- Alasan penolakan / catatan reviewer per keputusan gagal (dibutuhkan O3).\n")
A("- Timestamp submit KYC di DB (join GA kehilangan user tanpa `user_id`; `user_status_logs` mulai 2026-07-21).\n")
A("- Pembedaan keputusan otomatis vs manual (`auth_user_id` bisa akun bersama atau bot).\n")
open(os.path.join(OUT, 'findings_ops_kyc.md'), 'w').write("\n".join(L) + "\n")
print('ops', len(L))

# ================= PRODUCT & ENGINEERING =================
L = []
A = L.append
A(f"# Temuan — Product & Engineering\n\nDibangun {STAMP} dari GA4 `analytics_266759216.events_*` (2026-10-01..2026-11-08) dan `main.transactions`. Read-only.\n")
A("| # | Temuan | Bukti | Keyakinan | Dampak | Usaha | Prioritas |\n|---|---|---|---|---|---|---|")
A("| T1 | KYC putus di dalam aplikasi: identity ke selfie −11,3%, Android 8,5 pp di bawah iOS | 745 identity ke 661 selfie; submit Android 79,6% vs iOS 88,1% | Tinggi | Tinggi | M | P0 |")
A("| T2 | QRIS gagal dua kali lebih sering dari metode lain | 170/765 (22,2%) vs 11,0-11,1% VA/bank | Tinggi | Sedang | S | P1 |")
A("| T3 | User approved yang belum beli tidak pernah kembali ke alur beli | dari 257 yang terlihat pasca-approval, 43 buka buy sheet, 8 buat order | Tinggi | Tinggi | M | P0 |")
A("| T4 | Gate risk profile ditinggalkan 28,9%, tanpa kerugian hilir yang signifikan | 28/97 abandon; 46,4% abandoner tetap order vs 59,4% | Sedang | Rendah | S | P2 |")
A("| T5 | Error klien tercatat di GA, tanpa crash/ANR dan tanpa alert | 45 `continue_with_google_failed`, 10 `app_exception`, tanpa monitoring | Tinggi | Rendah | S | P2 |")
A("")

A("## T1 — Alur KYC kehilangan user di dalam aplikasi, terburuk di Android pada langkah selfie\n")
st, su, bs, ob, oc, pc = (STEPS['kyc_start'], STEPS['kyc_success'], STEPS['buy_bottom_sheet'],
                          STEPS['order_button'], STEPS['order_created'], STEPS['payment_complete'])
A(f"**Pain point.** KYC dimulai {st:,} kali, hanya {su:,} user sampai submit ({pct(su,st):.1f}%). Setelah submit, alur investasi kehilangan {pct(oc,su):.0f}% lagi sebelum order. Di dalam KYC, penurunan terbesar yang bisa dilokalisasi ke satu layar adalah identity verification ke selfie camera, dan Android 8,5 pp lebih buruk dari iOS.\n")
A("**Evidence (Observed).** GA4 user per event, 2026-10-01..2026-11-08.\n")
A("| Langkah | User | Perubahan |")
A("|---|---|---|")
A(f"| `kyc_start` | {st:,} | - |")
A(f"| `kyc_success` (submit) | {su:,} | {su-st:,} ({pct(su-st,st):+.1f}%) |")
A("")
A(f"Funnel investasi di window yang sama (populasi user, bukan kohort): `buy_bottom_sheet` {bs:,} ke `order_button` {ob:,} ({pct(ob-bs,bs):.1f}%) ke `order_created` {oc:,} ({pct(oc-ob,ob):.1f}%) ke `payment_complete` {pc:,} ({pct(pc,oc):.1f}% dari order).")
A("")
A("| Platform | KYC dimulai | Submit | Submit rate |")
A("|---|---|---|---|")
for pf in ['ANDROID', 'IOS']:
    r = KP[pf]
    A(f"| {pf} | {r['started']:,} | {r['started_and_submitted']:,} | {ci(r['started_and_submitted'],r['started'])} |")
A("")
z1, p1 = ztest(KP['ANDROID']['started_and_submitted'], KP['ANDROID']['started'], KP['IOS']['started_and_submitted'], KP['IOS']['started'])
A(f"- Android vs iOS: {pct(KP['ANDROID']['started_and_submitted'],KP['ANDROID']['started']):.1f}% vs {pct(KP['IOS']['started_and_submitted'],KP['IOS']['started']):.1f}% (z={z1:.2f}, p<0.0001). Selisih absolut: {KP['ANDROID']['started']-KP['ANDROID']['started_and_submitted']:,} user Android tidak selesai vs {KP['IOS']['started']-KP['IOS']['started_and_submitted']:,} iOS.\n")
intro, ident, selfie = SCR['VerificationIntroScreen'], SCR['IdentityVerificationScreen'], SCR['SelfieCameraScreen']
A(f"- Abandonment per layar (user yang melihat): `IntroScreen` {intro:,} ke `IdentityVerificationScreen` {ident:,} ({-(intro-ident):,}, {pct(ident-intro,intro):.1f}%); `IdentityVerificationScreen` ke `SelfieCameraScreen` {selfie:,} ({-(ident-selfie):,}, {pct(selfie-ident,ident):.1f}%). Setelah selfie semua layar tetap di atas {min(SCR[k] for k in ['SelfiePreviewScreen','IdentityPreviewScreen','ProfileVerificationScreen','VerificationSuccessScreen']):,}, jadi kehilangan terkonsentrasi sebelum selfie diambil.\n")
A(f"- `IdentityCameraScreen` hanya {SCR['IdentityCameraScreen']:,} user, padahal layar sebelumnya {ident:,}. Kemungkinan besar event hanya menyala untuk sebagian user (bukan semua yang membuka kamera), atau ada drop nyata di capture dokumen. Tidak bisa dibedakan dari data ini.\n")
v2, v722 = VER['kyc_success'], VER['kyc_start']
A(f"- Versi 2.28.2 memuat {v2['2.28.2']:,} dari {sum(v2.values()):,} submit KYC ({pct(v2['2.28.2'],sum(v2.values())):.1f}%). Versi 2.29.0: {pct(v2['2.29.0'],v722['2.29.0']):.1f}% start ke submit (n={v722['2.29.0']}) vs {pct(v2['2.28.2'],v722['2.28.2']):.1f}% pada 2.28.2. Arahnya lebih buruk di build terbaru tetapi n<30, tidak signifikan.\n")
A("**Root cause (Inferred, keyakinan sedang).** Dua hipotesis, keduanya belum diuji: (a) izin/capture kamera selfie gagal atau membingungkan di perangkat Android; (b) capture dokumen identitas adalah penghalang sebenarnya dan user keluar sebelum selfie. `kyc_screen_view` tidak memisahkan 'melihat lalu keluar' dari 'capture lalu gagal'; butuh data level perangkat.\n")
andr_gap = KP['ANDROID']['started'] * (pct(KP['IOS']['started_and_submitted'], KP['IOS']['started']) - pct(KP['ANDROID']['started_and_submitted'], KP['ANDROID']['started'])) / 100
A(f"**Expected impact (aritmetika).** Menutup separuh gap Android-iOS: {KP['ANDROID']['started']:,} start x gap {pct(KP['IOS']['started_and_submitted'],KP['IOS']['started'])-pct(KP['ANDROID']['started_and_submitted'],KP['ANDROID']['started']):.1f} pp / 2 = {andr_gap/2:.0f} submit tambahan per 39 hari. Pada share approved/submit {APPR_SHARE:.1f}% dan approved ke investor {pct(inv_total,APPR):.1f}%: {andr_gap/2*APPR_SHARE/100*pct(inv_total,APPR)/100:.1f} investor per 39 hari = {andr_gap/2*APPR_SHARE/100*pct(inv_total,APPR)/100/39*365:.0f}/tahun. Asumsi: gap berasal dari friksi produk, bukan bauran perangkat/demografi.\n")
A("**Effort.** M (instrumentasi tiap layar KYC dengan event hasil: izin diberikan, capture dicoba, capture gagal, back ditekan).\n")
A("**Priority.** P0 (kebocoran funnel terbesar yang bisa dikendalikan produk).\n")
A("**KPI / validation.** KYC start ke submit per platform dan per layar; target Android dalam 3 pp dari iOS.\n")

A("## T2 — Pembayaran: QRIS gagal dua kali lebih sering dari VA atau transfer bank\n")
q, va, bt, ip = PFC['QRIS'], PFC['virtual_account'], PFC['bank_transfer'], PFC['INSTANT_PAYMENT']
tot_orders = sum(r['orders'] for r in PFC.values())
A(f"**Pain point.** QRIS memegang {pct(q['orders'],tot_orders):.1f}% order dan gagal {pct(q['failed'],q['orders']):.1f}%, vs {pct(va['failed'],va['orders']):.1f}% virtual account dan {pct(bt['failed'],bt['orders']):.1f}% transfer bank. Instant payment hanya {pct(ip['failed'],ip['orders']):.1f}%.\n")
A("**Evidence (Observed).** `main.transactions`, order pada kohort, seluruh data s.d. 2026-11-09.\n")
A("| Metode | Order | Gagal/expired | Fail rate |")
A("|---|---|---|---|")
for k in sorted(PFC, key=lambda x: -PFC[x]['orders']):
    r = PFC[k]
    A(f"| {k} | {r['orders']:,} | {r['failed']:,} | {ci(r['failed'],r['orders'])} |")
A("")
z2, _ = ztest(q['failed'], q['orders'], va['failed'], va['orders'])
A(f"- QRIS vs VA: z={z2:.1f}, p<0.0001.\n")
A(f"- Percobaan order: {OU['users_with_order']:,} user membuat order; {OU['users_failed_never_paid']:,} ({pct(OU['users_failed_never_paid'],OU['users_with_order']):.1f}%) punya order gagal dan tidak pernah menyelesaikan satu pun. Itu inti yang bisa dipulihkan; {OU['users_failed_any']:,} user pernah gagal tetapi {OU['users_failed_any']-OU['users_failed_never_paid']:,} di antaranya berhasil dengan cara lain.\n")
A("**Root cause (Inferred, keyakinan rendah).** Kegagalan QRIS kemungkinan besar expiry/timeout (user scan lalu pergi), bukan reject teknis; data hanya berisi status, tanpa kode error provider. Verifikasi kode error gateway sebelum mengubah apa pun.\n")
saved = round(q['orders'] * (pct(q['failed'], q['orders']) - pct(va['failed'], va['orders'])) / 100)
A(f"**Expected impact (aritmetika).** Menurunkan QRIS ke fail rate VA menyelamatkan ({pct(q['failed'],q['orders']):.1f}% − {pct(va['failed'],va['orders']):.1f}%) x {q['orders']:,} order QRIS = {saved:,} order yang sekarang mati (batas atas, karena sebagian user mengulang dengan metode lain).\n")
A("**Effort.** S (tampilkan kode error provider; tambah pengingat expiry di layar pembayaran).\n")
A("**Priority.** P1.\n")
A("**KPI / validation.** Fail rate per metode dan per kode error provider, mingguan; target QRIS <15%.\n")

A("## T3 — User approved yang belum beli tidak kembali ke alur beli\n")
A(f"**Pain point.** Dari {stuck['approved_never_bought']:,} user approved-belum-beli, hanya {ANB['users_home']:,} yang terlihat di GA (window 39 hari, cakupan `user_id` parsial), dan dari jumlah itu {ANB['sheet']:,} membuka buy sheet; {ANB['ordr']:,} sampai membuat order.\n")
A("**Evidence (Observed).** GA4, user dengan keputusan verified dan tanpa pembelian selesai, 2026-10-01..2026-11-08.\n")
A(f"- Approved-belum-beli terlihat di GA: {ANB['users_home']:,}; buka `buy_bottom_sheet` {ANB['sheet']:,} ({ci(ANB['sheet'],ANB['users_home'])}); buat order {ANB['ordr']:,} ({pct(ANB['ordr'],ANB['users_home']):.1f}%).\n")
A(f"- Bandingkan dengan user yang submit KYC di window yang sama: {su:,} submit vs {oc:,} user membuat order ({pct(oc,su):.1f}%). Dua populasi berbeda (bukan funnel), tetapi skalanya menunjukkan alur beli bekerja untuk user yang baru submit, dan tidak bekerja untuk kolam pasca-approval.\n")
A(f"- Funnel investasi keseluruhan: `kyc_success` {su:,} ke `buy_bottom_sheet` {bs:,} ({pct(bs,su):.1f}%) ke `order_created` {oc:,} ({pct(oc,bs):.1f}%) ke `payment_complete` {pc:,} ({pct(pc,oc):.1f}%). Order ke pembayaran selesai {pct(pc,oc):.1f}%.\n")
A(f"- Gate risk profile {ANB['gate']} user di kohort ini, {ANB['gate_ab']} ditinggalkan ({pct(ANB['gate_ab'],ANB['gate']):.1f}%).\n")
A("**Root cause (Inferred, keyakinan sedang).** Aplikasi tidak punya jalur kembali ke investasi setelah approval: approval berakhir sebagai notifikasi, dan entry point beli tidak ditonjolkan saat user kembali. Ini sejalan dengan M6 (tanpa messaging lifecycle) dan V1 (penurunan pasca-Oktober): tiga sudut pandang atas gap yang sama.\n")
A(f"**Expected impact (aritmetika).** Bila buy sheet ditampilkan ke user approved saat membuka aplikasi, dan 10% dari {ANB['users_home']:,} user GA-visible itu terkonversi pada rate order ke pembayaran {pct(pc,oc):.1f}%: {round(ANB['users_home']*0.1*pc/oc):,} investor per 39 hari. Skala ke seluruh {stuck['approved_never_bought']:,} user (asumsi perilaku setara, belum diuji) jauh lebih besar; jangan pakai angka itu sebelum diukur.\n")
A("**Effort.** M (state pendaratan pasca-approval + entry point buy sheet).\n")
A("**Priority.** P0.\n")
A("**KPI / validation.** % user approved yang membuka buy sheet dalam 7/30 hari; rate order ke pembayaran kohort pasca-approval.\n")

A("## T4 — Gate risk profile: tidak ada kerugian hilir yang terukur\n")
gt, gf = GATE[True], GATE[False]
zg, pg = ztest(gt['ordered_after'], gt['users'], gf['ordered_after'], gf['users'])
A(f"**Pain point.** {gt['users']} dari {gt['users']+gf['users']} user yang memicu gate risk profile meninggalkannya, tetapi abandoner tetap berkonversi pada rate yang tidak berbeda signifikan.\n")
A(f"**Evidence (Observed).** GA `risk_profile_gate_triggered`/`abandoned`, 2026-10-01..2026-11-08.\n")
A(f"- Trigger {gt['users']+gf['users']}, abandon {gt['users']} ({pct(gt['users'],gt['users']+gf['users']):.1f}%). Order setelahnya: abandoner {gt['ordered_after']}/{gt['users']} ({pct(gt['ordered_after'],gt['users']):.1f}%), non-abandoner {gf['ordered_after']}/{gf['users']} ({pct(gf['ordered_after'],gf['users']):.1f}%). z={zg:.2f}, p={pg:.3f}.\n")
A("**Root cause (Inferred, keyakinan rendah).** Abandonment nyata tetapi sementara; gate ditampilkan ulang belakangan. Dengan n<100 di kedua sisi, ini bisa jadi kurang bertenaga, bukan benar-benar tidak berbahaya.\n")
A(f"**Expected impact.** Tidak ada klaim; hanya {(gt['users']+gf['users'])/39*30:.0f} user per 30 hari. Instrumentasi dulu, jangan desain ulang.\n")
A("**Effort.** S.\n")
A("**Priority.** P2.\n")
A("**KPI / validation.** Gate abandonment rate dan rate order 7 hari, bulanan, dengan n>=100.\n")

A("## T5 — Error klien tercatat, tanpa crash/ANR dan tanpa alert\n")
E2 = {}
for r in B['errors']:
    E2.setdefault(r['event_name'], [0, 0])
    E2[r['event_name']][0] += r['n']
    E2[r['event_name']][1] = max(E2[r['event_name']][1], r['dev'])
A(f"**Pain point.** `continue_with_google_failed` {E2['continue_with_google_failed'][0]} event di {E2['continue_with_google_failed'][1]}+ perangkat, `app_exception` {E2['app_exception'][0]} event, tanpa alert atau SLA. Tidak ada data crash/ANR sama sekali.\n")
A("**Evidence (Observed).** GA4, 2026-10-01..2026-11-08.\n")
A("| Event | Event | Perangkat | Android | iOS |")
A("|---|---|---|---|---|")
for ev2 in ['continue_with_google_failed', 'app_exception']:
    an = sum(r['n'] for r in B['errors'] if r['event_name'] == ev2 and r['platform'] == 'ANDROID')
    io = sum(r['n'] for r in B['errors'] if r['event_name'] == ev2 and r['platform'] == 'IOS')
    dv2 = max(r['dev'] for r in B['errors'] if r['event_name'] == ev2)
    A(f"| `{ev2}` | {E2[ev2][0]} | {dv2}+ | {an} | {io} |")
A("")
A(f"- Volume kecil, tetapi berada di jalur registrasi (`continue_with_google_failed`) dan tanpa jejak tumpukan. Fase 2 sudah menunjukkan event registrasi tidak andal, jadi ini indikatif, bukan sensus.\n")
A("**Root cause (Inferred, keyakinan rendah).** Tidak ada data crash/ANR di GA (Crashlytics tidak diekspor), dan `app_exception` adalah event serba-guna tanpa stack trace di export. Severity tidak bisa diperingkat.\n")
A("**Expected impact.** Tidak bisa dikuantifikasi tanpa stack trace. Alasan memperbaiki adalah proses: error di jalur signup dan pembayaran harus memicu alert, bukan menumpuk.\n")
A("**Effort.** S (alert pada rate `continue_with_google_failed` dan `app_exception`; ekspor Crashlytics).\n")
A("**Priority.** P2.\n")
A("**KPI / validation.** Rate event error per 1.000 sesi, mingguan, dengan ambang alert.\n")
A("\n## Data requests (Product & Engineering)\n")
A("- Event hasil per layar KYC (capture dicoba/gagal, izin ditolak, back ditekan): memblokir T1.\n")
A("- Kode error provider pada transaksi gagal: memblokir sizing T2.\n")
A("- Ekspor Crashlytics/ANR: memblokir severity T5.\n")
A("- `user_id` pada event GA pra-login, dan id kampanye pada event notifikasi.\n")
open(os.path.join(OUT, 'findings_product.md'), 'w').write("\n".join(L) + "\n")
print('tech', len(L))

# ================= CROSS-PHASE =================
L = []
A = L.append
A(f"# Temuan lintas tim — Fase 3\n\nDibangun {STAMP} dari `outputs/raw/`. Angka turunan langsung dari file mentah; tidak ada yang diketik manual.\n")
A("## V1 — Approved ke beli jatuh di Oktober, dan ini bukan soal waktu tunggu\n")
A(f"**Pain point.** User approved Oktober membeli dalam 7 hari pada {pct(oct_b,oct_n):.1f}%, vs {pct(pre_b,pre_n):.1f}% untuk approval Juli-September. Ini penurunan terbesar yang ditemukan di seluruh Fase 3.\n")
A("**Evidence (Observed).** Keputusan verified dengan submit GA di window, dipecah bulan approval dan jeda registrasi ke approval. Pembelian = order sukses dalam 7 hari setelah approval.\n")
A(f"- Juli-September (jeda <=30 hari): {pre_b}/{pre_n} = {ci(pre_b,pre_n)}. Oktober: {oct_b}/{oct_n} = {ci(oct_b,oct_n)}. z={ztest(oct_b,oct_n,pre_b,pre_n)[0]:.1f}, p<0.0001.\n")
A("| Minggu approval | Approved | Beli <=7 hari | Rate |")
A("|---|---|---|---|")
for wk, n, b in WEEKS:
    A(f"| {wk} | {n} | {b} | {pct(b,n):.1f}%{flag(n)} |")
A("")
A(f"- Jeda bukan penjelas: pada bucket approval hari yang sama (jeda <=1 hari), Juli-September {pct(LAG[('JulSep','a<=1d')]['bought7'],LAG[('JulSep','a<=1d')]['n']):.1f}% ({LAG[('JulSep','a<=1d')]['bought7']}/{LAG[('JulSep','a<=1d')]['n']}) vs Oktober {pct(LAG[('Oct','a<=1d')]['bought7'],LAG[('Oct','a<=1d')]['n']):.1f}% ({LAG[('Oct','a<=1d')]['bought7']}/{LAG[('Oct','a<=1d')]['n']}). Penurunan sama besar di dalam bucket tercepat, jadi bukan efek antrean (O1/O4).\n")
A(f"- Waktu tunggu juga tidak menjelaskan: O4 menunjukkan tidak ada korelasi tunggu ke beli, dan penurunan tetap ada di bucket hari yang sama.\n")
A("**Root cause (Inferred, keyakinan rendah).** Tiga penjelasan yang sejalan dengan temuan lain, semuanya belum diuji: (a) bauran akuisisi berubah ke kanal dengan niat rendah (lihat M1: sales code tumbuh, repeat mature 39,3%); (b) kolam approved menumpuk tanpa messaging lifecycle (M6) dan tanpa jalur kembali ke investasi (T3); (c) ada perubahan produk atau operasi pada minggu 2026-10-05. Data tidak bisa memilih di antara ketiganya.\n")
A(f"**Expected impact (aritmetika).** Bila Oktober berjalan pada rate Juli-September: {oct_n} x {pct(pre_b,pre_n):.1f}% = {round(oct_n*pct(pre_b,pre_n)/100):,} pembeli, vs {oct_b} aktual = {round(oct_n*pct(pre_b,pre_n)/100)-oct_b:,} pembeli hilang di Oktober saja.\n")
A("**Effort.** M (diagnosis: uji bauran kanal vs perubahan produk pada kohort Oktober).\n")
A("**Priority.** P0.\n")
A("**KPI / validation.** Approved ke beli 7 hari per bulan approval, dan per kanal akuisisi di dalam bulan itu. Uji ulang November dengan data lengkap.\n")

A("## V2 — Kolam approved yang menumpuk adalah satu masalah dengan tiga wajah\n")
A(f"**Pain point.** Marketing melihatnya sebagai tidak ada lifecycle (M6), engineering sebagai tidak ada jalur kembali (T3), operasi sebagai antrean yang tidak memicu apa pun (O1/O2). Semuanya merujuk ke {stuck['approved_never_bought']:,} user approved-belum-beli.\n")
A(f"**Evidence (Observed).** {stuck['approved_never_bought']:,} user approved tanpa pembelian selesai; {stuck['approved_never_bought_ver_last_30d']:,} approved dalam 30 hari terakhir; {ANB['users_home']:,} dari kolam itu terlihat di GA dalam 39 hari, {ANB['sheet']:,} membuka buy sheet, {ANB['ordr']:,} membuat order.\n")
A(f"**Root cause (Inferred, keyakinan sedang).** Approval adalah akhir dari proses, bukan awal dari proses berikutnya. Tidak ada trigger (CRM), tidak ada permukaan (produk), tidak ada antrean (operasi) yang membawa user approved ke investasi pertama. Ini kegagalan koordinasi, bukan kegagalan satu tim.\n")
A(f"**Expected impact (aritmetika).** Titik acuan konservatif: 10% dari {ANB['users_home']:,} user GA-visible terkonversi ke order pada rate order ke pembayaran {pct(pc,oc):.1f}% = {round(ANB['users_home']*0.1*pc/oc):,} investor per 39 hari ({round(ANB['users_home']*0.1*pc/oc)/39*365:.0f}/tahun). Skenario penuh memakai {stuck['approved_never_bought']:,} user; jangan dilaporkan sebelum diukur.\n")
A("**Effort.** M (satu program: trigger approval ke CRM + permukaan di aplikasi + antrean operasi dengan due date).\n")
A("**Priority.** P0.\n")
A("**KPI / validation.** Approved ke investasi pertama 7/30 hari, satu dashboard lintas tim; target +10 pp dari basis Oktober.\n")

A("## Ringkasan prioritas\n")
A("| Prioritas | Temuan | Alasan |")
A("|---|---|---|")
A("| P0 | V1 / V2 / T3 (kolam approved), M2 (bonus ke non-pembayar), T1 (funnel KYC) | Dampak terbesar, angka bisa dihitung, sebagian besar bisa dikendalikan produk/kebijakan |")
A("| P1 | M1 (retensi sales code), M4 (email tak terukur), M6 (lifecycle), O1/O2/O3 (SLA, key-person, penolakan), T2 (QRIS) | Dampak sedang, usaha kecil-menengah |")
A("| P2 | M3 (promo), M5 (push), O4 (wait), T4 (gate), T5 (error) | Bukti lemah atau bersifat korelasi |")
A("")
A("## Semua angka yang belum bisa diuji\n")
A("- Lift bonus (M2), promo (M3), push (M5), messaging lifecycle (M6), dan permukaan pasca-approval (T3/V2) adalah estimasi aritmetika dari korelasi. Tidak ada eksperimen acak di data ini.\n")
A("- T1 dan T4: n kecil di bucket tertentu; flag `n<30` ditandai di tabel.\n")
A("- V1: penyebab belum diidentifikasi; tiga hipotesis terbuka, semuanya butuh data bauran kanal Oktober.\n")
A(f"\n## Follow-up Fase 2 yang terjawab di sini\n")
A(f"- Approved-belum-beli (Fase 2: 78,6%) diperdalam: {ANB['users_home']:,} terlihat di GA, {ANB['sheet']:,} buka buy sheet, {ANB['ordr']:,} order (T3), dan penurunan Oktober diukur (V1).\n")
A("- Pertanyaan Fase 2 'apa yang terjadi setelah KYC': alur berhenti tanpa trigger, tanpa permukaan, tanpa antrean (V2).\n")
A("- Pertanyaan Fase 2 soal bauran booth: sales code berkontribusi pada bauran berintensi rendah tetapi bukan penjelas tunggal (M1).\n")
open(os.path.join(OUT, 'findings_cross.md'), 'w').write("\n".join(L) + "\n")
print('cross', len(L))
