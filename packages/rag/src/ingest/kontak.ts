/**
 * Pencarian situs resmi Disdukcapil per kab/kota. Hanya kandidat domain `.go.id` yang dicoba; sebuah situs dianggap
 * terverifikasi bila halaman depannya benar-benar dari domain `.go.id` (setelah redirect), memuat kata kependudukan,
 * dan menyebut nama wilayahnya. Selain itu `belum_terverifikasi` dan tidak boleh ditampilkan sebagai fakta.
 */
export type KabKota = { kode: string; jenis: 'kabupaten' | 'kota'; nama: string };

export type Kontak =
  | {
      kode: string;
      nama: string;
      status: 'terverifikasi';
      website: string;
      /** Judul halaman resmi tempat situs ini diverifikasi. */
      judulHalaman: string;
      /** Alamat hanya bila tertulis di halaman resmi yang sama (teks mentah, tidak diolah). */
      alamat?: string;
      sourceUrl: string;
      verifiedAt: string;
    }
  | { kode: string; nama: string; status: 'belum_terverifikasi' };

const PREFIXES = ['disdukcapil', 'dukcapil', 'dispendukcapil', 'disduk', 'capil'];

/** Nama wilayah tanpa awalan "Kabupaten"/"Kota" dan tanpa tanda baca. */
export function shortName(nama: string): string {
  return nama
    .replace(/^(kabupaten|kota)\s+/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim();
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Kandidat host `.go.id` (urut dari yang paling umum). */
export function candidateHosts(k: Pick<KabKota, 'jenis' | 'nama'>): string[] {
  const base = slug(shortName(k.nama));
  const kind = k.jenis === 'kabupaten' ? 'kab' : 'kota';
  const out: string[] = [];
  for (const p of PREFIXES) {
    out.push(`${p}.${base}${kind}.go.id`, `${p}.${base}.go.id`);
  }
  return [...new Set(out)];
}

const strip = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? strip(m[1] ?? '').slice(0, 160) : '';
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ');

/**
 * Halaman dianggap situs Disdukcapil wilayah ini bila: domain akhir `.go.id`, teks memuat
 * kependudukan/dukcapil, dan nama wilayah (tanpa "kabupaten/kota") disebut.
 */
export function verifyPage(finalUrl: string, html: string, k: Pick<KabKota, 'nama'>): boolean {
  let host: string;
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host.endsWith('.go.id')) return false;
  const text = norm(strip(html));
  if (!/(kependudukan|dukcapil|catatan sipil)/.test(text)) return false;
  const name = norm(shortName(k.nama));
  return name.length >= 3 && text.includes(name);
}

/** Potong di awal kata/angka yang bukan alamat (telepon, hak cipta, ikon, dll.) dan buang tanda baca di ujung. */
export function cleanAlamat(raw: string): string {
  const cut = raw.search(
    /\s(?:whatsapp|wa|telp\w*|tel|call|phone|hp|fax|email|e-mail|jam|website|lokasi|copyright|kode pos)\b|\s@|\s\(?0\d{2,4}\)?[\s-]*\d{5,}|\s0\d{8,}|[^\p{L}\p{N}\s.,/()'#&-]/iu,
  );
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim().replace(/[\s,\-/:]+$/, '');
}

/** Alamat dari teks halaman bila ada pola "Alamat : ... " yang wajar; undefined bila tidak yakin. */
export function extractAlamat(html: string): string | undefined {
  const text = strip(html);
  const m =
    /\bAlamat\s*:?\s*((?:Jl\.?|Jalan)[^|]{8,140}?)(?=\s+(?:Telp|Telepon|Email|E-mail|Hp|Fax|Jam|Website|Kode Pos)\b|$|\s{2,})/i.exec(
      text,
    );
  const a = m?.[1] ? cleanAlamat(m[1]) : undefined;
  return a && a.length >= 12 && a.length <= 160 ? a : undefined;
}

export type ProbeGet = (
  url: string,
) => Promise<{ status: number; body: string; contentType: string; finalUrl: string }>;
export type ProbeDeps = { resolves: (host: string) => Promise<boolean>; get: ProbeGet; now: () => Date };

/** Coba kandidat host satu per satu; hanya halaman yang lolos `verifyPage` yang dianggap terverifikasi. */
export async function probeKontak(k: KabKota, deps: ProbeDeps): Promise<Kontak> {
  for (const host of candidateHosts(k)) {
    if (!(await deps.resolves(host))) continue;
    try {
      const r = await deps.get(`https://${host}/`);
      if (r.status !== 200 || !/html/i.test(r.contentType)) continue;
      if (!verifyPage(r.finalUrl, r.body, k)) continue;
      const alamat = extractAlamat(r.body);
      return {
        kode: k.kode,
        nama: k.nama,
        status: 'terverifikasi',
        website: new URL(r.finalUrl).origin,
        judulHalaman: pageTitle(r.body),
        ...(alamat ? { alamat } : {}),
        sourceUrl: r.finalUrl,
        verifiedAt: deps.now().toISOString(),
      };
    } catch {
      continue;
    }
  }
  return { kode: k.kode, nama: k.nama, status: 'belum_terverifikasi' };
}

/** Isi berkas kontak: urutan mengikuti daftar wilayah; yang belum diperiksa tercatat belum_terverifikasi. */
export function kontakFile(wilayah: readonly KabKota[], byKode: ReadonlyMap<string, Kontak>) {
  const kontak = wilayah.map(
    (k) => byKode.get(k.kode) ?? { kode: k.kode, nama: k.nama, status: 'belum_terverifikasi' as const },
  );
  return {
    catatan:
      'Situs resmi Disdukcapil per kab/kota. Hanya status "terverifikasi" yang boleh ditampilkan sebagai fakta; "belum_terverifikasi" berarti belum ada situs .go.id yang lolos pemeriksaan otomatis (bukan berarti tidak ada).',
    total: kontak.length,
    terverifikasi: kontak.filter((k) => k.status === 'terverifikasi').length,
    kontak,
  };
}
