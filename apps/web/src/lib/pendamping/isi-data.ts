/**
 * Pemetaan placeholder adapter (`{{PEMOHON.NIK}}`) ke Data Diri akun (GET /api/vault/data-diri,
 * ADR 0028). Nilai hanya dikirim ke sesi Browser Pendamping setelah warga menekan "Izinkan isi".
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

function kolomDari(placeholder: string): keyof DataDiriRingkas | undefined {
  const m = /^\{\{[A-Z][A-Z0-9_]*\.([A-Z0-9_.]+)\}\}$/.exec(placeholder);
  if (!m) return undefined;
  const bagian = m[1]!.split('.');
  return KOLOM[bagian[bagian.length - 1]!];
}

export function labelPlaceholder(placeholder: string): string {
  const k = kolomDari(placeholder);
  return k ? LABEL[k] : 'Data lain';
}

/** Isian yang bisa dipenuhi dari Data Diri + daftar label yang harus warga isi sendiri. */
export function petakanIsian(
  placeholder: readonly string[],
  data: DataDiriRingkas,
): { isian: Record<string, string>; kurang: string[] } {
  const isian: Record<string, string> = {};
  const kurang: string[] = [];
  for (const p of placeholder) {
    const k = kolomDari(p);
    const v = k ? data[k] : undefined;
    if (v) isian[p] = v;
    else kurang.push(labelPlaceholder(p));
  }
  return { isian, kurang };
}
