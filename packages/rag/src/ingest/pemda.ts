import { pageTitle, shortName, type ProbeDeps } from './kontak.js';

/**
 * Situs resmi pemerintah daerah sebagai kanal cadangan bila situs Disdukcapil kab/kota belum terverifikasi
 * (data/wilayah/kontak-dukcapil.json): portal Pemerintah Kabupaten/Kota, dan per provinsi situs Dinas Dukcapil
 * provinsi (atau portal Pemerintah Provinsi). Hanya kandidat `.go.id`; terverifikasi bila halaman depannya (setelah
 * redirect) tetap `.go.id` dan menyebut "Kabupaten X"/"Kota X"/"Provinsi X" secara utuh, sehingga Kota Bogor tidak
 * tertukar dengan Kabupaten Bogor.
 */
export type WilayahPemda = { kode: string; jenis: 'kabupaten' | 'kota' | 'provinsi'; nama: string };

export type Pemda =
  | {
      kode: string;
      nama: string;
      status: 'terverifikasi';
      /** dukcapil = situs Dinas Dukcapil (provinsi); pemda = portal pemerintah daerah. */
      jenis: 'dukcapil' | 'pemda';
      website: string;
      judulHalaman: string;
      sourceUrl: string;
      verifiedAt: string;
    }
  | { kode: string; nama: string; status: 'belum_terverifikasi' };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Nama provinsi tanpa awalan resmi panjang: "Daerah Khusus Ibukota Jakarta" -> "Jakarta". */
export function namaPendekProvinsi(nama: string): string {
  return nama.replace(/^(daerah khusus ibukota|daerah istimewa|provinsi)\s+/i, '').trim();
}

/**
 * Singkatan baku yang dipakai domain provinsi (mis. sumutprov.go.id, jogjaprov.go.id). Hanya kandidat: situs tetap
 * harus lolos `verifyPemda` (menyebut nama provinsinya utuh).
 */
const ALIAS_PROVINSI: Record<string, string> = {
  Yogyakarta: 'jogja',
  'Sumatera Utara': 'sumut',
  'Sumatera Barat': 'sumbar',
  'Sumatera Selatan': 'sumsel',
  'Kepulauan Bangka Belitung': 'babel',
  'Kepulauan Riau': 'kepri',
  'Jawa Barat': 'jabar',
  'Jawa Tengah': 'jateng',
  'Jawa Timur': 'jatim',
  'Nusa Tenggara Barat': 'ntb',
  'Nusa Tenggara Timur': 'ntt',
  'Kalimantan Barat': 'kalbar',
  'Kalimantan Tengah': 'kalteng',
  'Kalimantan Selatan': 'kalsel',
  'Kalimantan Timur': 'kaltim',
  'Kalimantan Utara': 'kaltara',
  'Sulawesi Utara': 'sulut',
  'Sulawesi Tengah': 'sulteng',
  'Sulawesi Selatan': 'sulsel',
  'Sulawesi Tenggara': 'sultra',
  'Sulawesi Barat': 'sulbar',
  'Maluku Utara': 'malut',
};

/** Kandidat host `.go.id`, urut dari yang paling mungkin. Provinsi: situs Dinas Dukcapil dulu, lalu portal. */
export function candidatePemdaHosts(w: Pick<WilayahPemda, 'jenis' | 'nama'>): string[] {
  if (w.jenis === 'provinsi') {
    const pendek = namaPendekProvinsi(w.nama);
    const bases = [slug(pendek), ...(ALIAS_PROVINSI[pendek] ? [ALIAS_PROVINSI[pendek]] : [])];
    const out = bases.flatMap((b) => [`disdukcapil.${b}prov.go.id`, `dukcapil.${b}prov.go.id`]);
    for (const b of bases) out.push(`${b}prov.go.id`, `www.${b}prov.go.id`, `${b}.go.id`, `www.${b}.go.id`);
    return [...new Set(out)];
  }
  const base = slug(shortName(w.nama));
  const kind = w.jenis === 'kabupaten' ? 'kab' : 'kota';
  return [
    ...new Set([`${base}${kind}.go.id`, `www.${base}${kind}.go.id`, `${base}.go.id`, `www.${base}.go.id`]),
  ];
}

const teksHalaman = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ');

/** Jenis situs bila halaman ini sah untuk wilayah itu; null bila tidak. */
export function verifyPemda(
  finalUrl: string,
  html: string,
  w: Pick<WilayahPemda, 'jenis' | 'nama'>,
): 'dukcapil' | 'pemda' | null {
  let host: string;
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith('.go.id')) return null;
  const text = teksHalaman(html);
  const inti = teksHalaman(w.jenis === 'provinsi' ? namaPendekProvinsi(w.nama) : shortName(w.nama)).trim();
  if (inti.length < 3) return null;
  const awalan =
    w.jenis === 'provinsi'
      ? '(?:provinsi(?: dki| di)?|daerah istimewa|daerah khusus ibukota|pemerintah|pemprov)'
      : w.jenis === 'kabupaten'
        ? '(?:kabupaten|pemkab)'
        : '(?:kota|pemkot)';
  if (!new RegExp(`\\b${awalan} ${inti}\\b`).test(text)) return null;
  // Situs Dinas Dukcapil provinsi: host atau judul berkata dukcapil/kependudukan. Portal kab/kota tetap "pemda"
  // walau menunya menyebut Disdukcapil.
  const judul = teksHalaman(pageTitle(html));
  if (w.jenis === 'provinsi' && (/dukcapil/.test(host) || /(kependudukan|dukcapil)/.test(judul)))
    return 'dukcapil';
  return /(pemerintah|pemkab|pemkot|pemprov|portal resmi|situs resmi|website resmi)/.test(text)
    ? 'pemda'
    : null;
}

/** Coba kandidat satu per satu; hanya halaman yang lolos `verifyPemda` yang dianggap terverifikasi. */
export async function probePemda(w: WilayahPemda, deps: ProbeDeps): Promise<Pemda> {
  for (const host of candidatePemdaHosts(w)) {
    if (!(await deps.resolves(host))) continue;
    try {
      const r = await deps.get(`https://${host}/`);
      if (r.status !== 200 || !/html/i.test(r.contentType)) continue;
      const jenis = verifyPemda(r.finalUrl, r.body, w);
      if (!jenis) continue;
      return {
        kode: w.kode,
        nama: w.nama,
        status: 'terverifikasi',
        jenis,
        website: new URL(r.finalUrl).origin,
        judulHalaman: pageTitle(r.body),
        sourceUrl: r.finalUrl,
        verifiedAt: deps.now().toISOString(),
      };
    } catch {
      continue;
    }
  }
  return { kode: w.kode, nama: w.nama, status: 'belum_terverifikasi' };
}

export function pemdaFile(wilayah: readonly WilayahPemda[], byKode: ReadonlyMap<string, Pemda>) {
  const pemda = wilayah.map(
    (w) => byKode.get(w.kode) ?? { kode: w.kode, nama: w.nama, status: 'belum_terverifikasi' as const },
  );
  return {
    catatan:
      'Situs resmi pemerintah daerah (.go.id) sebagai kanal cadangan bila situs Disdukcapil kab/kota belum terverifikasi: portal Pemerintah Kabupaten/Kota (kode 4 digit) dan situs Dinas Dukcapil atau portal Pemerintah Provinsi (kode 2 digit). Terverifikasi = halaman depan .go.id menyebut "Kabupaten/Kota/Provinsi <nama>" utuh. Diisi oleh pnpm --filter @urusin/rag rag:pemda; belum_terverifikasi bukan berarti tidak ada.',
    total: pemda.length,
    terverifikasi: pemda.filter((p) => p.status === 'terverifikasi').length,
    pemda,
  };
}
