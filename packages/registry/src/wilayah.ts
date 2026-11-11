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

const INDEKS_KATA = INDEKS.map((x) => ({ w: x.w, kata: x.inti.split(' ') }));

/** Satu sebutan wilayah di teks warga. */
export type SebutanWilayah = {
  wilayah: Wilayah;
  /** Teks nama inti yang disebut (huruf kecil), mis. "bekasi". Sama untuk Kota dan Kabupaten bernama ganda. */
  teks: string;
  /** Posisi kata pertama nama inti pada teks yang dinormalkan (urutan sebutan). */
  mulai: number;
  /** Jenis yang disebut tepat sebelum nama ("kota"/"kabupaten"), bila ada. */
  jenisDisebut: Wilayah['jenis'] | null;
  /** Kata sebelum nama (melewati "kota"/"kabupaten"/"administrasi"), mis. "ke" untuk tujuan pindah. */
  sebelum: string | null;
};

/**
 * Semua kab/kota yang disebut di teks. Nama terpanjang menang: "Luwu Utara" tidak juga dihitung sebagai "Luwu",
 * "Padang Pariaman" bukan "Kota Padang". Jenis yang disebut ("Kota Bekasi") menyaring nama ganda. Kode 4 digit
 * hanya dihitung bila berdiri sendiri ("3312", "33.12") atau didahului kata "kode" ("tahun 1971" bukan kode).
 */
export function temukanWilayah(teksAsli: string): SebutanWilayah[] {
  const kodeSaja = /^\s*(\d{2})\.?(\d{2})\s*$/.exec(teksAsli);
  const kata = normal(teksAsli).split(' ').filter(Boolean);
  const out: SebutanWilayah[] = [];
  const tambahKode = (kode: string, mulai: number) => {
    const w = BY_KODE.get(kode);
    if (w) out.push({ wilayah: w, teks: kode, mulai, jenisDisebut: null, sebelum: null });
  };
  if (kodeSaja) tambahKode(`${kodeSaja[1]}${kodeSaja[2]}`, 0);
  kata.forEach((k, i) => {
    if (k === 'kode' && /^\d{4}$/.test(kata[i + 1] ?? '')) tambahKode(kata[i + 1]!, i + 1);
  });

  type Calon = { w: Wilayah; mulai: number; panjang: number };
  const calon: Calon[] = [];
  for (const x of INDEKS_KATA)
    for (let i = 0; i + x.kata.length <= kata.length; i++)
      if (x.kata.every((t, j) => kata[i + j] === t)) calon.push({ w: x.w, mulai: i, panjang: x.kata.length });
  // Nama terpanjang dulu; nama yang tumpang tindih dengan nama yang LEBIH panjang dibuang.
  calon.sort((a, b) => b.panjang - a.panjang);
  const diterima: Calon[] = [];
  for (const c of calon) {
    const kalah = diterima.some(
      (d) => d.panjang > c.panjang && c.mulai < d.mulai + d.panjang && d.mulai < c.mulai + c.panjang,
    );
    if (!kalah) diterima.push(c);
  }
  const perPosisi = new Map<number, Calon[]>();
  for (const c of diterima) perPosisi.set(c.mulai, [...(perPosisi.get(c.mulai) ?? []), c]);
  for (const [mulai, daftar] of perPosisi) {
    let j = mulai - 1;
    if (kata[j] === 'administrasi') j--;
    const jenisDisebut = kata[j] === 'kota' ? 'kota' : kata[j] === 'kabupaten' ? 'kabupaten' : null;
    if (jenisDisebut) j--;
    const sesuaiJenis = daftar.filter((c) => c.w.jenis === jenisDisebut);
    for (const c of sesuaiJenis.length ? sesuaiJenis : daftar)
      out.push({
        wilayah: c.w,
        teks: kata.slice(mulai, mulai + c.panjang).join(' '),
        mulai,
        jenisDisebut,
        sebelum: kata[j] ?? null,
      });
  }
  return out.sort((a, b) => a.mulai - b.mulai);
}

/** Apakah teks menyebut wilayah ini (lihat `temukanWilayah`: nama terpanjang menang, kode hanya berdiri sendiri). */
export function menyebutWilayah(teks: string, w: Wilayah): boolean {
  return temukanWilayah(teks).some((x) => x.wilayah.kodeKabKota === w.kodeKabKota);
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
