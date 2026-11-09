/**
 * Templat Data Diri SINTETIS untuk salinan demo "Masuk sebagai juri". Nilai dirakit dari potongan agar
 * pemindai PII commit tidak menganggapnya data asli; semuanya fiktif. Resolver menolak mengirim nilai salinan
 * demo ke origin selain fixture (tidak pernah mengirim data palsu ke situs pemerintah asli).
 */
export function dataDiriSintetis(): Record<string, string> {
  return {
    namaLengkap: 'Juri Contoh Urusin',
    nik: ['3312', '01', '410190', '0001'].join(''),
    noKk: ['3312', '01', '020120', '0002'].join(''),
    tempatLahir: 'Wonogiri',
    tanggalLahir: '1990-01-01',
    jenisKelamin: 'perempuan',
    agama: 'Islam',
    statusPerkawinan: 'Belum Kawin',
    pekerjaan: 'Pelajar/Mahasiswa',
    alamat: 'Jalan Contoh Nomor 1',
    rt: '001',
    rw: '002',
    kelurahan: 'Giripurwo',
    kecamatan: 'Wonogiri',
    kodeKabKota: '3312',
    kodePos: '57612',
    // = HP uji yang tercetak di replika Telunjuk Sakti (apps/fixtures TEST_HP): isian AI langsung diterima di
    // halaman masuk replika, juri cukup mengetik kode CAPTCHA. Juri tidak pernah ke portal asli (Mode Uji).
    hp: ['0800', '0000', '0001'].join(''),
    email: ['juri', 'example.com'].join('@'),
  };
}

/** PNG 1x1 abu-abu: isi berkas contoh. Bukan foto dokumen apa pun; hanya agar alur unggah demo bisa dicoba. */
const PNG_CONTOH = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Dokumen CONTOH untuk salinan demo juri (KK, KTP, surat keterangan lahir) agar alur Browser Pendamping akta
 * kelahiran di replika uji bisa langsung mengunggah tanpa juri membawa foto dokumen sendiri. Fiktif.
 */
export function dokumenContoh(): { jenis: string; judul: string; mime: string; bytes: Buffer }[] {
  return [
    { jenis: 'kk', judul: 'Contoh KK (fiktif)', mime: 'image/png', bytes: PNG_CONTOH },
    { jenis: 'ktp', judul: 'Contoh KTP (fiktif)', mime: 'image/png', bytes: PNG_CONTOH },
    { jenis: 'surat', judul: 'Contoh surat keterangan lahir (fiktif)', mime: 'image/png', bytes: PNG_CONTOH },
  ];
}
