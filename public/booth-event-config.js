// Booth event config: SEMUA aturan dan T&C tab "Booth event" ada di file ini.
// Tab itu (rekap harian, target, insentif sales dan team lead, bonus nasabah,
// panel "Aturan & cara hitung") hanya membaca dari sini, jadi perubahan rule
// cukup di file ini lalu deploy. Angka per bulan penuh ditulis seperti di
// tabel insentif; periode yang tidak penuh diprorate otomatis (lihat periods).

// Roster template: team = { booth: { lead, sales: [names] } }, flying = [names], one
// flying person per entry with a code for every booth. role: sales | team_lead | flying.
function boothRoster(team, flying) {
  const row = (code, person, name, role, booth) => ({ code, person, name, role, booth, email: `andreagibras+${code.toLowerCase()}@gmail.com` });
  const booths = Object.keys(team);
  return booths.flatMap((b) => [
    row(`TL${b}`, `Team Lead ${b}`, team[b].lead, 'team_lead', b),
    ...team[b].sales.map((name, i) => row(`S${b}${i + 1}`, `Sales ${b} ${i + 1}`, name, 'sales', b)),
  ]).concat(flying.flatMap((name, k) => booths.map((b) => row(`FT${k + 1}${b}`, `Flying Team ${k + 1}`, name, 'flying', b))));
}

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

  // Kode dari sheet "Nama Sales/TL". Nasabah dihitung ke kode ini kalau
  // users.referrer_code ATAU users.sales_code-nya sama persis (huruf besar/kecil
  // diabaikan). Roster dibuat dari template boothRoster di atas: TL<booth>,
  // S<booth><n>, FT<n><booth>. Sales baru = tambah satu nama di ujung daftar booth
  // itu (null kalau belum ada nama); kode, posisi, dan akun mengikuti template.
  // Kode yang tidak ada di roster tidak dihitung: kode baru wajib ditambah di sini.
  // person = posisi (kunci filter, kode flying team satu person untuk 3 mall);
  // name = nama orang, hanya tampilan. Satu orang boleh punya beberapa kode
  // (Widya: SCP5 dan TLCP), cukup tulis namanya di tiap posisi. booth = mall
  // tempat kode dipakai, jadi SID flying team masuk ke target tim mall itu.
  roster: boothRoster({
    PIM: { lead: 'Herlangga', sales: ['Viki Setiadi', 'Ilham Ramadhan', 'Gabriel Rizal Pratama', 'Novi Yulianti', 'M. Zhafran', 'Zulham Donni'] },
    GC: { lead: 'Sandy', sales: ['Eka Muhammad Rizki', 'Jihan', 'Arfan Herdian', 'Agus Rinaldi Rusli', 'Edi Sudrajat', null] },
    CP: { lead: 'Widya Sartika', sales: ['Nur Haliza', 'Khairy Harianto', 'M. Ilham Saputra', 'Milza Anindya Putri', 'Widya Sartika', 'Marlinda'] },
  }, [null, null]),

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
    dailySidTarget: 3,           // target booth = jumlah kode sales booth itu x 3 x hari kerja (6 sales = 378 per bulan penuh)
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
