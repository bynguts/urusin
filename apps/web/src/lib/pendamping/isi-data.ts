/**
 * Pemetaan placeholder adapter (`{{PEMOHON.NIK}}`) ke field Data Diri (ADR 0028). Dipakai SERVER
 * (`lib/server/pendamping/isi.ts`) untuk menyelesaikan nilai setelah warga menekan "Izinkan isi", dan peramban
 * untuk label. Peramban tidak pernah membaca nilai vault untuk Pendamping.
 */
export type DataDiriRingkas = Partial<
  Record<
    | 'namaLengkap'
    | 'nik'
    | 'noKk'
    | 'tempatLahir'
    | 'tanggalLahir'
    | 'jenisKelamin'
    | 'agama'
    | 'pekerjaan'
    | 'alamat'
    | 'rt'
    | 'rw'
    | 'kelurahan'
    | 'kecamatan'
    | 'kodePos'
    | 'hp'
    | 'email',
    string
  >
>;

const KOLOM: Record<string, keyof DataDiriRingkas> = {
  NAMA: 'namaLengkap',
  NAMA_LENGKAP: 'namaLengkap',
  NIK: 'nik',
  KK: 'noKk',
  NO_KK: 'noKk',
  NOMOR_KK: 'noKk',
  TEMPAT_LAHIR: 'tempatLahir',
  TANGGAL_LAHIR: 'tanggalLahir',
  JENIS_KELAMIN: 'jenisKelamin',
  AGAMA: 'agama',
  PEKERJAAN: 'pekerjaan',
  ALAMAT: 'alamat',
  RT: 'rt',
  RW: 'rw',
  KELURAHAN: 'kelurahan',
  DESA: 'kelurahan',
  KECAMATAN: 'kecamatan',
  KODE_POS: 'kodePos',
  HP: 'hp',
  TELEPON: 'hp',
  EMAIL: 'email',
};

/** Label warga untuk placeholder, tanpa menampilkan penanda teknis. */
const LABEL: Record<keyof DataDiriRingkas, string> = {
  namaLengkap: 'Nama lengkap',
  nik: 'NIK',
  noKk: 'Nomor KK',
  tempatLahir: 'Tempat lahir',
  tanggalLahir: 'Tanggal lahir',
  jenisKelamin: 'Jenis kelamin',
  agama: 'Agama',
  pekerjaan: 'Pekerjaan',
  alamat: 'Alamat',
  rt: 'RT',
  rw: 'RW',
  kelurahan: 'Kelurahan/desa',
  kecamatan: 'Kecamatan',
  kodePos: 'Kode pos',
  hp: 'Nomor HP',
  email: 'Email',
};

/** Placeholder adapter yang bukan Data Diri (nomor lacak, nomor polisi, NIB): diketik warga di layar. */
const LABEL_LAIN: Record<string, string> = {
  KITIR: 'Nomor kitir',
  KODE_PELAYANAN: 'Kode pelayanan',
  NOPOL_ANGKA: 'Angka nomor polisi',
  NOPOL_HURUF: 'Huruf akhir nomor polisi',
  NIB: 'NIB',
};

function bagianAkhir(placeholder: string): string | undefined {
  const m = /^\{\{[A-Z][A-Z0-9_]*\.([A-Z0-9_.]+)\}\}$/.exec(placeholder);
  return m ? m[1]!.split('.').at(-1) : undefined;
}

/**
 * Field Data Diri untuk sebuah placeholder, atau undefined bila bukan Data Diri. HANYA `{{PEMOHON.<KUNCI>}}`
 * (satu segmen): `{{ANAK.NIK}}`, `{{ORANG2.NIK}}`, `{{PEMOHON.AYAH.NAMA}}` bukan data pemohon, jadi diketik
 * warga sendiri. Cermin `kunciDataDiri` di apps/pendamping/src/isian.ts.
 */
export function fieldDataDiri(placeholder: string): keyof DataDiriRingkas | undefined {
  const kunci = /^\{\{PEMOHON\.([A-Z0-9_]+)\}\}$/.exec(placeholder)?.[1];
  return kunci !== undefined && Object.hasOwn(KOLOM, kunci) ? KOLOM[kunci] : undefined;
}

export function labelPlaceholder(placeholder: string): string {
  const k = fieldDataDiri(placeholder);
  if (k) return LABEL[k];
  const akhir = bagianAkhir(placeholder);
  return (akhir && Object.hasOwn(LABEL_LAIN, akhir) ? LABEL_LAIN[akhir] : undefined) ?? 'Data lain';
}

/** Nama field Data Diri untuk placeholder (dipakai server `lib/server/pendamping/isi.ts`). */
export const kolomDari = fieldDataDiri;

/**
 * Daftar write "Izinkan isi" (POST /api/urusan/[id]/izinkan-isi): placeholder yang bisa dipenuhi Data Diri +
 * `berkas:<JENIS>` (huruf besar) untuk Dokumen. Placeholder lain (nomor polisi, NIB, kitir) tidak ikut: server
 * menolak entri tak dikenal, dan warga mengetiknya sendiri di layar.
 */
export function daftarWrite(placeholder: readonly string[], berkas: readonly string[]): string[] {
  return [
    ...new Set([
      ...placeholder.filter((p) => fieldDataDiri(p) !== undefined),
      ...berkas.map((b) => `berkas:${b.toUpperCase()}`),
    ]),
  ];
}

/** Pesan jujur saat izin tercatat tetapi Data Diri tidak memuat sebagian data yang diminta AI. */
export function pesanDataKurang(kurang: readonly string[]): string {
  return `Data Diri Anda di Urusin belum memuat: ${[...new Set(kurang)].join(', ')}. AI tidak bisa mengisinya; isi sendiri di layar, atau lengkapi Data Diri.`;
}

/** Isian yang bisa dipenuhi dari Data Diri + daftar label yang harus warga isi sendiri. */
export function petakanIsian(
  placeholder: readonly string[],
  data: DataDiriRingkas,
): { isian: Record<string, string>; kurang: string[] } {
  const isian: Record<string, string> = {};
  const kurang: string[] = [];
  for (const p of placeholder) {
    const k = fieldDataDiri(p);
    const v = k ? data[k] : undefined;
    if (v) isian[p] = v;
    else kurang.push(labelPlaceholder(p));
  }
  return { isian, kurang };
}
