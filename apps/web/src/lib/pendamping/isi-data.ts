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

/** Placeholder anggota keluarga: namespace -> hubungan anggota di brankas (data keluarga). */
export const HUBUNGAN_PLACEHOLDER = {
  AYAH: ['ayah'],
  IBU: ['ibu'],
  ANAK: ['anak'],
  PASANGAN: ['pasangan', 'suami', 'istri'],
} as const satisfies Record<string, readonly string[]>;
export type PeranKeluarga = 'ayah' | 'ibu' | 'anak' | 'pasangan';

/** Field anggota keluarga yang bisa diisi dari brankas. */
export type KolomAnggota = 'namaLengkap' | 'nik' | 'tanggalLahir' | 'jenisKelamin' | 'tempatLahir';
const KOLOM_ANGGOTA: Record<string, KolomAnggota> = {
  NAMA: 'namaLengkap',
  NAMA_LENGKAP: 'namaLengkap',
  NIK: 'nik',
  TGL_LAHIR: 'tanggalLahir',
  TANGGAL_LAHIR: 'tanggalLahir',
  JK: 'jenisKelamin',
  JENIS_KELAMIN: 'jenisKelamin',
  TEMPAT_LAHIR: 'tempatLahir',
};

/** Kunci isian: field Data Diri "Saya", atau `<peran>.<field>` untuk anggota keluarga (mis. `ibu.nik`). */
export type KolomIsian = keyof DataDiriRingkas | `${PeranKeluarga}.${KolomAnggota}`;

/** Alias pemohon untuk data orang tuanya: `{{PEMOHON.NAMA_IBU}}` = nama anggota ibu. */
const ALIAS_PEMOHON: Record<string, KolomIsian> = {
  NAMA_IBU: 'ibu.namaLengkap',
  NAMA_AYAH: 'ayah.namaLengkap',
};

function kolomKeluarga(peran: string, kunci: string): KolomIsian | undefined {
  if (!Object.hasOwn(HUBUNGAN_PLACEHOLDER, peran) || !Object.hasOwn(KOLOM_ANGGOTA, kunci)) return undefined;
  return `${peran.toLowerCase() as PeranKeluarga}.${KOLOM_ANGGOTA[kunci]!}`;
}

/**
 * Field isian untuk sebuah placeholder, atau undefined bila bukan data brankas:
 * - `{{PEMOHON.<KUNCI>}}` (satu segmen) = Data Diri "Saya"; `{{PEMOHON.NAMA_IBU}}` = nama anggota ibu;
 * - `{{AYAH|IBU|ANAK|PASANGAN.<KUNCI>}}` dan `{{PEMOHON.AYAH|IBU.<KUNCI>}}` = anggota keluarga
 *   (NAMA, NIK, TGL_LAHIR, JK, TEMPAT_LAHIR).
 * `{{ORANG2.NIK}}`, `{{ANAK.AYAH.NAMA}}`, `{{PEMOHON.ALAMAT.RT}}` bukan data brankas, jadi diketik warga sendiri.
 * Cermin `kunciDataDiri` di apps/pendamping/src/isian.ts.
 */
export function fieldDataDiri(placeholder: string): KolomIsian | undefined {
  const m = /^\{\{([A-Z][A-Z0-9_]*)\.([A-Z0-9_]+)(?:\.([A-Z0-9_]+))?\}\}$/.exec(placeholder);
  if (!m) return undefined;
  const [, ns = '', a = '', b] = m;
  if (b !== undefined)
    return ns === 'PEMOHON' && (a === 'AYAH' || a === 'IBU') ? kolomKeluarga(a, b) : undefined;
  if (ns !== 'PEMOHON') return kolomKeluarga(ns, a);
  if (Object.hasOwn(KOLOM, a)) return KOLOM[a];
  return Object.hasOwn(ALIAS_PEMOHON, a) ? ALIAS_PEMOHON[a] : undefined;
}

export function labelPlaceholder(placeholder: string): string {
  const k = fieldDataDiri(placeholder);
  if (k) {
    const [peran, kolom] = k.split('.') as [string, KolomAnggota | undefined];
    return kolom ? `${LABEL[kolom]} ${peran}` : LABEL[k as keyof DataDiriRingkas];
  }
  const akhir = bagianAkhir(placeholder);
  return (akhir && Object.hasOwn(LABEL_LAIN, akhir) ? LABEL_LAIN[akhir] : undefined) ?? 'Data lain';
}

/** Anggota keluarga seperti disimpan di brankas (cermin `AnggotaKeluarga` @urusin/contracts). */
export type AnggotaRingkas = { id: string; hubungan: string } & Partial<Record<KolomAnggota, string>>;

/** Entri daftar write yang memilih "anak yang dimaksud" saat lebih dari satu anak tersimpan. */
export const AWALAN_ANAK = 'anak:';
const ANAK_RE = /^anak:agt_[0-9a-f]{32}$/;
export const entriAnak = (w: string): boolean => ANAK_RE.test(w);

/**
 * Anggota untuk tiap peran: ayah/ibu/pasangan = anggota pertama berhubungan itu; anak = `anakId` bila dipilih,
 * atau otomatis bila hanya satu anak. Lebih dari satu anak tanpa pilihan = tidak ada (warga mengisi sendiri).
 */
export function anggotaPeran(
  anggota: readonly AnggotaRingkas[],
  anakId?: string | undefined,
): Partial<Record<PeranKeluarga, AnggotaRingkas>> {
  const out: Partial<Record<PeranKeluarga, AnggotaRingkas>> = {};
  for (const [ns, hub] of Object.entries(HUBUNGAN_PLACEHOLDER)) {
    const peran = ns.toLowerCase() as PeranKeluarga;
    const calon = anggota.filter((a) => (hub as readonly string[]).includes(a.hubungan));
    const pilih =
      peran === 'anak'
        ? anakId
          ? calon.find((a) => a.id === anakId)
          : calon.length === 1
            ? calon[0]
            : undefined
        : calon[0];
    if (pilih) out[peran] = pilih;
  }
  return out;
}

/** Nilai per kunci isian dari Data Diri "Saya" + anggota keluarga (dipakai server setelah "Izinkan isi"). */
export function nilaiIsian(
  saya: Record<string, unknown>,
  anggota: readonly AnggotaRingkas[],
  anakId?: string | undefined,
): Partial<Record<KolomIsian, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(saya)) if (typeof v === 'string' && v !== '') out[k] = v;
  for (const [peran, a] of Object.entries(anggotaPeran(anggota, anakId)))
    for (const k of Object.values(KOLOM_ANGGOTA)) {
      const v = a[k];
      if (typeof v === 'string' && v !== '') out[`${peran}.${k}`] = v;
    }
  return out as Partial<Record<KolomIsian, string>>;
}

/** Nama field Data Diri untuk placeholder (dipakai server `lib/server/pendamping/isi.ts`). */
export const kolomDari = fieldDataDiri;

/**
 * Daftar write "Izinkan isi" (POST /api/urusan/[id]/izinkan-isi): placeholder yang bisa dipenuhi Data Diri +
 * `berkas:<JENIS>` (huruf besar) untuk Dokumen. Placeholder lain (nomor polisi, NIB, kitir) tidak ikut: server
 * menolak entri tak dikenal, dan warga mengetiknya sendiri di layar. `anakId` (anak yang dimaksud, bila lebih
 * dari satu anak tersimpan) ikut sebagai `anak:<id>` hanya bila ada placeholder `{{ANAK.*}}`.
 */
export function daftarWrite(
  placeholder: readonly string[],
  berkas: readonly string[],
  anakId?: string | undefined,
): string[] {
  const data = placeholder.filter((p) => fieldDataDiri(p) !== undefined);
  const anak =
    anakId && data.some((p) => fieldDataDiri(p)?.startsWith('anak.')) ? [`${AWALAN_ANAK}${anakId}`] : [];
  return [...new Set([...data, ...anak, ...berkas.map((b) => `berkas:${b.toUpperCase()}`)])];
}

/** Isian yang bisa dipenuhi dari Data Diri + daftar label yang harus warga isi sendiri. */
export function petakanIsian(
  placeholder: readonly string[],
  data: Partial<Record<KolomIsian, string>>,
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
