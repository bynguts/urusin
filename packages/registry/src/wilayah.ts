import { DATA_KABKOTA, DATA_KONTAK_DUKCAPIL, DATA_PROVINSI } from './wilayah-data.js';

/**
 * 514 kab/kota Kepmendagri (data/wilayah/kabkota.json) sebagai sumber tunggal nama wilayah: pemilih wilayah,
 * validasi `wilayah__tetapkan`, dan nama kota di router. Kode = empat digit pertama NIK (tanpa titik).
 */
export type Wilayah = {
  kodeKabKota: string;
  /** Nama resmi, mis. "Kabupaten Wonogiri", "Kota Administrasi Jakarta Pusat". */
  nama: string;
  jenis: 'kabupaten' | 'kota';
  provinsi: string;
};

const PROVINSI = new Map(DATA_PROVINSI.map(([kode, nama]) => [kode, nama]));

export const SEMUA_WILAYAH: readonly Wilayah[] = DATA_KABKOTA.map(([kode, nama]) => ({
  kodeKabKota: kode,
  nama,
  jenis: nama.startsWith('Kota') ? ('kota' as const) : ('kabupaten' as const),
  provinsi: PROVINSI.get(kode.slice(0, 2)) ?? '',
}));

const BY_KODE = new Map(SEMUA_WILAYAH.map((w) => [w.kodeKabKota, w]));

/** kode 4 digit → nama resmi; dipakai router default agar kode di luar seed tetap bernama benar. */
export const NAMA_WILAYAH: ReadonlyMap<string, string> = new Map(
  SEMUA_WILAYAH.map((w) => [w.kodeKabKota, w.nama]),
);

export function wilayahByKode(kode: string): Wilayah | undefined {
  return BY_KODE.get(kode);
}

/** "Kabupaten Wonogiri" → "Kab. Wonogiri"; "Kota Administrasi Jakarta Pusat" → "Jakarta Pusat". */
export function namaPendekWilayah(nama: string): string {
  return nama
    .replace(/^Kabupaten Administrasi\s+/, '')
    .replace(/^Kota Administrasi\s+/, '')
    .replace(/^Kabupaten\s+/, 'Kab. ');
}

const AWALAN = /^(kabupaten administrasi|kota administrasi|kabupaten|kota)\s+/;

/** Huruf kecil, tanpa tanda baca, singkatan umum dibakukan ("kab." → "kabupaten", "kota adm." → "kota administrasi"). */
function normal(teks: string): string {
  return teks
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\bkab\b/g, 'kabupaten')
    .replace(/\badm\b/g, 'administrasi')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nama inti tanpa awalan kab/kota: "kota administrasi jakarta pusat" → "jakarta pusat". */
function inti(namaNormal: string): string {
  return namaNormal.replace(AWALAN, '');
}

const INDEKS = SEMUA_WILAYAH.map((w) => ({ w, inti: inti(normal(w.nama)) }));

export type HasilCariWilayah =
  | { status: 'cocok'; wilayah: Wilayah }
  /** Lebih dari satu kandidat (mis. "Bekasi" = Kota atau Kabupaten), atau hanya cocok sebagian: tanyakan warga. */
  | { status: 'ambigu'; pilihan: Wilayah[] }
  | { status: 'tidak_dikenal' };

/**
 * Cocokkan kode ("3312", "33.12") atau nama kab/kota ("Kota Surabaya", "Wonogiri", "Kab. Bekasi") ke 514 kab/kota.
 * Hanya kecocokan persis nama inti yang dianggap `cocok`; nama yang dipakai Kota dan Kabupaten sekaligus
 * (Bekasi, Malang, ...) atau kecocokan sebagian (mis. "Jakarta") menjadi `ambigu`. Nama kecamatan/kota kecil
 * (mis. "Cikarang") tidak dikenal di sini: model boleh memetakannya, tetapi wajib dikonfirmasi warga.
 */
export function cariWilayah(teks: string): HasilCariWilayah {
  const raw = teks.trim();
  const kode = /^(\d{2})\.?(\d{2})$/.exec(raw);
  if (kode) {
    const w = BY_KODE.get(`${kode[1]}${kode[2]}`);
    return w ? { status: 'cocok', wilayah: w } : { status: 'tidak_dikenal' };
  }
  const n = normal(raw);
  if (n.length < 3) return { status: 'tidak_dikenal' };
  const jenis: Wilayah['jenis'] | null = n.startsWith('kabupaten ')
    ? 'kabupaten'
    : n.startsWith('kota ')
      ? 'kota'
      : null;
  const q = inti(n);
  const cocokJenis = (w: Wilayah) => jenis === null || w.jenis === jenis;
  const persis = INDEKS.filter((x) => x.inti === q && cocokJenis(x.w)).map((x) => x.w);
  if (persis.length === 1) return { status: 'cocok', wilayah: persis[0]! };
  if (persis.length > 1) return { status: 'ambigu', pilihan: persis };
  // Jenis yang disebut tidak cocok (mis. "Kab. Surabaya") atau hanya cocok sebagian: tawarkan pilihan.
  const sebagian = INDEKS.filter(
    (x) => x.inti === q || (q.length >= 4 && (` ${x.inti} `.includes(` ${q} `) || x.inti.startsWith(q))),
  ).map((x) => x.w);
  if (sebagian.length > 0) return { status: 'ambigu', pilihan: sebagian.slice(0, 8) };
  return { status: 'tidak_dikenal' };
}

/** Kata kunci untuk memeriksa apakah warga sendiri menyebut wilayah ini: nama inti ("bekasi") dan kodenya. */
export function penandaWilayah(w: Wilayah): string[] {
  return [inti(normal(w.nama)), w.kodeKabKota];
}

/** Apakah teks (huruf kecil dinormalkan) menyebut wilayah ini. */
export function menyebutWilayah(teks: string, w: Wilayah): boolean {
  const n = ` ${normal(teks)} `;
  return penandaWilayah(w).some((p) => n.includes(` ${p} `));
}

/** Situs Disdukcapil kab/kota yang terverifikasi otomatis; undefined bila belum ada (jangan mengarang). */
export type KontakDukcapil = { website: string; alamat?: string; sourceUrl: string; verifiedAt: string };

const KONTAK = new Map(DATA_KONTAK_DUKCAPIL.map((k) => [k.kode, k]));

export function kontakDukcapil(kode: string): KontakDukcapil | undefined {
  const k = KONTAK.get(kode);
  if (!k) return undefined;
  return {
    website: k.website,
    sourceUrl: k.sourceUrl,
    verifiedAt: k.verifiedAt,
    ...(k.alamat ? { alamat: k.alamat } : {}),
  };
}
