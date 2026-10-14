// HNWI bonus program config: SEMUA aturan dan T&C tab "HNWI bonus" ada di
// file ini. Tab itu (peserta, rincian pembelian FIFO, bonus per bulan, panel
// "Aturan dan cara hitung") hanya membaca dari sini; perubahan T&C cukup di
// file ini lalu deploy. Nomor pasal merujuk ke "Syarat dan Ketentuan Program
// HNWI Bonus".

const HNWI_BONUS = {
  name: 'Program HNWI Bonus',
  samManager: 'Sucor Asset Management', // produk program = fund dengan manajer investasi ini

  // Pasal 1 dan 11: AUM total semua produk minimal minAum pada aumStartDate,
  // lalu dicek SETIAP HARI selama program dari snapshot harian
  // portfolio_with_code; sekali saja di bawah minAum = gugur permanen
  // (bonus yang belum dibayar ikut hangus).
  aumStartDate: '2026-09-30',
  minAum: 500000000,
  // HNWI = perorangan: akun institusi (users.is_institution) tidak ikut.
  // Ubah ke false kalau institusi boleh ikut.
  excludeInstitutions: true,

  // Pasal 3 dan 7.
  purchaseFrom: '2026-10-01',
  purchaseTo: '2026-12-31',
  programFrom: '2026-10-01',
  programTo: '2027-12-31',

  // Pasal 2: nett subs (beli fresh fund dikurangi semua redemption produk
  // SAM) kumulatif minimal minNetSubs sampai purchaseTo. Bonus dihitung sejak
  // pembelian pertama tapi baru dibayar setelah tercapai (dirapel); kalau
  // tidak tercapai sampai purchaseTo, tidak ada bonus.
  minNetSubs: 100000000,

  // Pasal 5: maksimal bonus per nasabah selama program.
  maxBonus: 25000000,

  // Pasal 6, 8, 9, 10: bonus harian = sisa nett subs tiap pembelian x rate
  // per tahun / 365, sejak transaksi berhasil (completed). Bagian yang
  // di-redeem sebelum genap holdMonths bulan tidak dapat bonus; bonus sebelum
  // genap holdMonths dibayar di bulan saat genap. SEMUA redemption produk SAM
  // selama program (jual, atau switching ke produk non-SAM) mengurangi
  // pembelian program dengan FIFO: pembelian program tertua dipotong dulu,
  // lintas produk. Switching antar produk SAM bukan redemption; rate tetap
  // rate produk pembelian awal.
  holdMonths: 1,

  // Pasal 4 dan 12: dibayar per bulan dalam unit bonusFund, paling lambat
  // payoutTradingDays hari bursa setelah bulan itu selesai (hari libur bursa
  // di luar akhir pekan tidak dihitung otomatis).
  bonusFund: 'Sucorinvest Money Market Fund',
  payoutTradingDays: 7,

  // Rate bonus per tahun (% p.a.) per produk, dari tabel "Tiering Bonus
  // Reksa Dana". Fund SAM yang tidak ada di sini (Sucorinvest Equity Fund
  // Kelas A, IDX30, Phei AAA Corporate Bond Fund, Proteksi 49) tetap dihitung
  // untuk minimum nett subs, tapi rate bonusnya 0.
  rates: [
    { pct: 0.10, funds: [
      { id: 'PlFsTEcPFZCWZNeBOQ7Qw', name: 'Sucorinvest Money Market Fund' },
      { id: 'kCd0LSVZCvQtG9-wW4VIu', name: 'Sucorinvest Sharia Money Market Fund' },
    ] },
    { pct: 0.15, funds: [
      { id: 'daZyyZB1L-UShYEfCDJN3', name: 'Sucorinvest Bond Fund' },
      { id: 'HwDzqV3Zl8IoGOC_Fm4LL', name: 'Sucorinvest Stable Fund Kelas A' },
      { id: 'Y8P9hNBqAnNEz6m0LuJXC', name: 'Sucorinvest Sharia Sukuk Fund Kelas A' },
      { id: 's7-75TSmr6t5-RxnXLYLE', name: 'Sucorinvest Monthly Income Fund Kelas A' },
    ] },
    { pct: 0.20, funds: [
      { id: 'xpAhQzp2neGjglR-D5GJe', name: 'Sucorinvest Anak Pintar' },
      { id: '_WG6OgdT8GMd449arpipZ', name: 'Sucorinvest Citra Dana Berimbang' },
      { id: 'GjaqdXB1kzK1kAjOwQKO4', name: 'Sucorinvest Flexi Fund' },
      { id: 'U5kgeIe7rUI6F31AmGGPd', name: 'Sucorinvest Sharia Balanced Fund' },
      { id: 'Z6uXYPsFUf_m7K3TIkEJJ', name: 'Sucorinvest Premium Fund Kelas A' },
      { id: 'LONHEArrCAzJ4hZjBPJSc', name: 'Sucorinvest Dana Prioritas Sehat Kelas C' },
      { id: 'xsi7bg0mROjOqDXtnW9c6', name: 'Sucorinvest Aggressive Balanced AI Fund' },
    ] },
    { pct: 0.25, funds: [
      { id: 'Pp0Dyh3SaSBFVoyIx0Khx', name: 'Sucorinvest Maxi Fund Kelas A' },
      { id: '2_EHTTtAooXhylI2ELKP6', name: 'Sucorinvest Sharia Equity Fund Kelas A' },
      { id: 'PKEq2UtG80E7aBCJpEl5K', name: 'Sucorinvest Sustainability Equity Fund' },
      { id: 'F_DXf90_sMsNR52iR4u3-', name: 'Sucorinvest Sharia Sustainability Equity Fund' },
      { id: 'Url2l-dLSAMPpvvgCOkiD', name: 'Sucorinvest SOE Plus Equity Fund' },
      { id: 'OOhfBcetA-MfQcXfRZPE_', name: 'Sucorinvest Saham Dinamis' },
    ] },
  ],
};
