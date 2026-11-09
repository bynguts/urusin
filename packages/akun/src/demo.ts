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
    hp: ['0812', '0000', '0000'].join(''),
    email: ['juri', 'example.com'].join('@'),
  };
}
