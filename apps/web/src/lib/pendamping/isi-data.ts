/**
 * Pemetaan placeholder adapter (`{{PEMOHON.NIK}}`) ke field Data Diri akun, dipakai bersama peramban (label
 * lembar "Izinkan isi" + hash daftar write) dan server (jalur isi A-M1). Nilai TIDAK pernah lewat peramban:
 * server menyelesaikannya dengan token persetujuan lalu mengirimnya ke sesi lewat kanal internal.
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

/** Field Data Diri untuk sebuah placeholder, atau undefined bila bukan Data Diri. */
export function fieldDataDiri(placeholder: string): keyof DataDiriRingkas | undefined {
  const akhir = bagianAkhir(placeholder);
  return akhir && Object.hasOwn(KOLOM, akhir) ? KOLOM[akhir] : undefined;
}

export function labelPlaceholder(placeholder: string): string {
  const k = fieldDataDiri(placeholder);
  if (k) return LABEL[k];
  const akhir = bagianAkhir(placeholder);
  return (akhir && Object.hasOwn(LABEL_LAIN, akhir) ? LABEL_LAIN[akhir] : undefined) ?? 'Data lain';
}

/**
 * Daftar write persetujuan "Izinkan isi": field Data Diri dari placeholder sesi + `berkas:<nama>` untuk
 * Dokumen. Unik dan terurut, sehingga peramban dan server menghitung hash yang sama.
 */
export function daftarWrite(placeholder: readonly string[], berkas: readonly string[]): string[] {
  const f = placeholder.map(fieldDataDiri).filter((x): x is keyof DataDiriRingkas => x !== undefined);
  return [...new Set([...f, ...berkas.map((b) => `berkas:${b.toLowerCase()}`)])].sort();
}

/** sha256 hex dari nama field unik terurut dipisah baris baru (sama dengan `hashDaftarWrite` @urusin/akun). */
export async function hashDaftarWrite(fields: readonly string[]): Promise<string> {
  const teks = [...new Set(fields)].sort().join('\n');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(teks));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
