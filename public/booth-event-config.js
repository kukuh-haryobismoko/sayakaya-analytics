// Booth event config: SEMUA aturan dan T&C tab "Booth event" ada di file ini.
// Tab itu (rekap harian, target, insentif sales dan team lead, bonus nasabah,
// panel "Aturan & cara hitung") hanya membaca dari sini, jadi perubahan rule
// cukup di file ini lalu deploy. Angka per bulan penuh ditulis seperti di
// tabel insentif; periode yang tidak penuh diprorate otomatis (lihat periods).

const BOOTH_EVENT = {
  name: 'Booth SayaKaya x Sucor AM',
  start: '2026-10-19', // hari pertama booth buka (WIB)
  end: '2027-01-10',   // hari terakhir; pendaftaran dengan kode sesudah ini tidak dihitung

  // Daftar transaksi (panel Transactions): hari berturut-turut sebuah pembelian completed
  // ditahan. Unit fund itu di snapshot harian tidak boleh turun di bawah unit tepat
  // sesudah pembelian (aturan yang sama dengan program referral); sekali turun atau
  // fund hilang dari snapshot, hitungan berhenti. Dihitung maksimal sampai angka ini.
  txHoldDays: 30,

  booths: { PIM: 'Pondok Indah Mall', GC: 'Gandaria City', CP: 'Central Park' },

  // Periode insentif. workDays = hari kerja yang jadi dasar target: 21 per
  // bulan penuh. Hari kerja = hari shift tiap sales (boleh akhir pekan,
  // sesuai pembagian shift), bukan Senin-Jumat; tanggal mana yang jadi shift
  // tidak memengaruhi hitungan. Bulan yang tidak penuh diprorate per hari kalender
  // (Oktober 19-31 = 13/31 x 21; Januari 1-10 = 10/31 x 21). Desember dan Januari
  // adalah dua periode terpisah.
  // m1 = bulan berikutnya untuk rule 4 (beli lagi / retensi).
  periods: [
    { id: '2026-10', label: 'Okt 19-31', from: '2026-10-19', to: '2026-10-31', workDays: 21 * 13 / 31, m1: { from: '2026-11-01', to: '2026-11-30' } },
    { id: '2026-11', label: 'Nov', from: '2026-11-01', to: '2026-11-30', workDays: 21, m1: { from: '2026-12-01', to: '2026-12-31' } },
    { id: '2026-12', label: 'Des', from: '2026-12-01', to: '2026-12-31', workDays: 21, m1: { from: '2027-01-01', to: '2027-01-31' } },
    { id: '2027-01', label: 'Jan 1-10', from: '2027-01-01', to: '2027-01-10', workDays: 21 * 10 / 31, m1: { from: '2027-02-01', to: '2027-02-28' } },
  ],
  fullMonthWorkDays: 21,

  // Kode dari "sales_code dan email.csv". Nasabah dihitung ke kode ini kalau
  // users.referrer_code ATAU users.sales_code-nya sama persis (huruf besar/kecil
  // diabaikan). role: sales | team_lead | flying. person mengelompokkan kode
  // milik orang yang sama (flying team punya 3 kode, satu per mall); name = nama
  // orangnya dari sheet "Nama Sales/TL" (null kalau belum diisi; person tetap
  // jadi kunci filter dan pengelompokan); booth = mall
  // tempat kode itu dipakai, jadi SID flying team masuk ke target tim mall itu.
  roster: [
    { code: 'TLPIM', person: 'Team Lead PIM', name: 'Herlangga', role: 'team_lead', booth: 'PIM', email: 'andreagibras+tlpim@gmail.com' },
    { code: 'SPIM1', person: 'Sales PIM 1', name: 'Viki Setiadi', role: 'sales', booth: 'PIM', email: 'andreagibras+spim1@gmail.com' },
    { code: 'SPIM2', person: 'Sales PIM 2', name: 'Ilham Ramadhan', role: 'sales', booth: 'PIM', email: 'andreagibras+spim2@gmail.com' },
    { code: 'SPIM3', person: 'Sales PIM 3', name: 'Gabriel Rizal Pratama', role: 'sales', booth: 'PIM', email: 'andreagibras+spim3@gmail.com' },
    { code: 'SPIM4', person: 'Sales PIM 4', name: 'Novi Yulianti', role: 'sales', booth: 'PIM', email: 'andreagibras+spim4@gmail.com' },
    { code: 'SPIM5', person: 'Sales PIM 5', name: 'M. Zhafran', role: 'sales', booth: 'PIM', email: 'andreagibras+spim5@gmail.com' },
    { code: 'SPIM6', person: 'Sales PIM 6', name: 'Zulham Donni', role: 'sales', booth: 'PIM', email: 'andreagibras+spim6@gmail.com' },
    { code: 'TLGC', person: 'Team Lead GC', name: 'Sandy', role: 'team_lead', booth: 'GC', email: 'andreagibras+tlgc@gmail.com' },
    { code: 'SGC1', person: 'Sales GC 1', name: 'Eka Muhammad Rizki', role: 'sales', booth: 'GC', email: 'andreagibras+sgc1@gmail.com' },
    { code: 'SGC2', person: 'Sales GC 2', name: 'Jihan', role: 'sales', booth: 'GC', email: 'andreagibras+sgc2@gmail.com' },
    { code: 'SGC3', person: 'Sales GC 3', name: 'Arfan Herdian', role: 'sales', booth: 'GC', email: 'andreagibras+sgc3@gmail.com' },
    { code: 'SGC4', person: 'Sales GC 4', name: 'Agus Rinaldi Rusli', role: 'sales', booth: 'GC', email: 'andreagibras+sgc4@gmail.com' },
    { code: 'SGC5', person: 'Sales GC 5', name: 'Edi Sudrajat', role: 'sales', booth: 'GC', email: 'andreagibras+sgc5@gmail.com' },
    { code: 'SGC6', person: 'Sales GC 6', name: null, role: 'sales', booth: 'GC', email: 'andreagibras+sgc6@gmail.com' },
    { code: 'TLCP', person: 'Team Lead CP', name: null, role: 'team_lead', booth: 'CP', email: 'andreagibras+tlcp@gmail.com' },
    { code: 'SCP1', person: 'Sales CP 1', name: 'Nur Haliza', role: 'sales', booth: 'CP', email: 'andreagibras+scp1@gmail.com' },
    { code: 'SCP2', person: 'Sales CP 2', name: 'Khairy Harianto', role: 'sales', booth: 'CP', email: 'andreagibras+scp2@gmail.com' },
    { code: 'SCP3', person: 'Sales CP 3', name: 'M. Ilham Saputra', role: 'sales', booth: 'CP', email: 'andreagibras+scp3@gmail.com' },
    { code: 'SCP4', person: 'Sales CP 4', name: 'Milza Anindya Putri', role: 'sales', booth: 'CP', email: 'andreagibras+scp4@gmail.com' },
    { code: 'SCP5', person: 'Sales CP 5', name: 'Widya Sartika', role: 'sales', booth: 'CP', email: 'andreagibras+scp5@gmail.com' },
    { code: 'SCP6', person: 'Sales CP 6', name: 'Marlinda', role: 'sales', booth: 'CP', email: 'andreagibras+scp6@gmail.com' },
    { code: 'FT1PIM', person: 'Flying Team 1', name: null, role: 'flying', booth: 'PIM', email: 'andreagibras+ft1pim@gmail.com' },
    { code: 'FT1GC', person: 'Flying Team 1', name: null, role: 'flying', booth: 'GC', email: 'andreagibras+ft1gc@gmail.com' },
    { code: 'FT1CP', person: 'Flying Team 1', name: null, role: 'flying', booth: 'CP', email: 'andreagibras+ft1cp@gmail.com' },
    { code: 'FT2PIM', person: 'Flying Team 2', name: null, role: 'flying', booth: 'PIM', email: 'andreagibras+ft2pim@gmail.com' },
    { code: 'FT2GC', person: 'Flying Team 2', name: null, role: 'flying', booth: 'GC', email: 'andreagibras+ft2gc@gmail.com' },
    { code: 'FT2CP', person: 'Flying Team 2', name: null, role: 'flying', booth: 'CP', email: 'andreagibras+ft2cp@gmail.com' },
  ],

  // Definisi yang dipakai semua rule.
  // - SID baru: nasabah yang daftar dengan kode selama event dan KYC-nya
  //   verified (users.verification_status = verified). Masuk ke periode tanggal
  //   verifikasinya; verifikasi sesudah event selesai masuk periode terakhir.
  // - Transaksi: hanya status completed, tanpa bonus dari admin (manual_bonus).
  // - Dana bersih = beli - jual (completed) dari daftar sampai akhir periode.

  // Insentif sales dan flying team (tabel "Incentive Sales SayaKaya").
  // Flying team dihitung per orang: SID dari ketiga kodenya dijumlah.
  sales: {
    dailySidTarget: 3,           // target 3 SID baru per hari kerja = 63 per bulan penuh
    minFunded: 1000000,          // "Subs reksadana min 1 mio": dana bersih >= ini sampai akhir periode
    // Syarat (gate): DUA-DUANYA wajib tercapai, kalau tidak insentif periode itu 0.
    gate: { minSid: 50, minFundedPct: 50 },
    // Rule 1, SID per bulan penuh (diprorate). Tier tertinggi yang tercapai.
    rule1: [{ minSid: 50, amount: 150000 }, { minSid: 55, amount: 200000 }, { minSid: 63, amount: 400000 }],
    // Rule 2, % nasabah funded (>= minFunded) dari SID yang didapat sales itu.
    rule2: [{ minPct: 50, amount: 300000 }, { minPct: 65, amount: 450000 }, { minPct: 75, amount: 800000 }],
    // Rule 3, total dana bersih nasabah baru periode itu (bulan penuh, diprorate).
    // Tanpa syarat holding: cukup capaian di periode itu.
    aumTarget: 55000000,
    rule3: [{ minAum: 49500000, amount: 225000 }, { minAum: 55000000, amount: 550000 }, { minAum: 63000000, amount: 600000 }],
    // Rule 4, retensi: % dari SID periode itu yang beli lagi (total >= minAmount)
    // di bulan M1 (lihat periods.m1).
    rule4: { minPct: 30, minAmount: 1000000, amount: 250000 },
    cap: 2500000,                // maksimal insentif per orang per periode
  },

  // Insentif team lead (tabel "Incentive Team Lead"). Target tim = semua kode
  // di booth itu: kode TL sendiri, 6 sales, dan kode flying team untuk mall itu.
  teamLead: {
    salesPerBooth: 6,
    dailySidTarget: 3,           // target booth = 6 x 3 x hari kerja = 378 per bulan penuh
    minFunded: 1500000,          // dinaikkan ke 1,5 jt agar tim terdorong di atas target
    // Syarat (gate): SID booth > 80% target DAN funded >= 60% dari SID booth.
    gate: { minSidPct: 80, minFundedPct: 60 },
    rule1: [{ minSidPct: 80, amount: 750000 }],
    // Rule 2, funded rate = funded (>= 1,5 jt) / SID booth ("60% dari 80%", bukan dari 100% target).
    rule2: [{ minPct: 60, amount: 300000 }, { minPct: 70, amount: 700000 }],
    // Rule 3, total balance akhir periode (dana bersih) semua nasabah baru booth, bulan penuh diprorate.
    aumTarget: 567000000,        // 378 SID x 1,5 jt; tier 50% = 283,5 jt, 60% = 340,2 jt
    rule3: [{ minAum: 283500000, amount: 300000 }, { minAum: 340200000, amount: 700000 }],
    rule4: { minPct: 25, minAmount: 1500000, amount: 350000 },
    cap: 2500000,
  },

  // Bonus nasabah. Produk SAM = fund dengan manajer investasi samManager.
  customer: {
    samManager: 'Sucor Asset Management',
    // Welcome bonus nasabah baru: pembelian pertama produk SAM >= minFirstBuy,
    // bonus unit SAM dikreditkan setelah holding holdingDays hari (gugur kalau
    // menjual produk SAM sebelum itu) + merchandise.
    welcome: { minFirstBuy: 1000000, holdingDays: 30, bonus: 25000, extra: 'Merchandise SAM' },
    // Nabung rutin: rencana investasi bulanan dengan produk SAM >= minMonthly
    // per bulan, terbayar minMonths bulan berturut-turut.
    nabungRutin: { minMonthly: 500000, minMonths: 3, bonus: 100000 },
    // Top up nasabah existing (daftar sebelum event): beli produk SAM >= minAmount
    // dengan kode promo = kode sales (atau promoCodes di bawah), cashback
    // cashbackPct (maks. cashbackMax per nasabah), gugur kalau menjual produk SAM
    // dalam holdingDays hari + payung / tumbler.
    topUp: { minAmount: 5000000, cashbackPct: 0.5, cashbackMax: 250000, holdingDays: 30, extra: 'Payung SayaKaya / tumbler' },
    // Kode promo tambahan per program, kalau nanti dibuat (selain kode sales).
    promoCodes: ['SYKYMALL'],
  },
};
