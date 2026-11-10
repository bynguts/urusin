import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ekstrakKontak,
  entriDariHalaman,
  gabungEntri,
  tautanKontak,
  type EntriKanal,
  type LayananKanal,
} from './kanal-layanan.js';
import type { Kontak, ProbeGet } from './kontak.js';

/** Halaman resmi tambahan (dipilih tangan) untuk wilayah yang situsnya tidak terdeteksi otomatis. */
export type SumberHalaman = {
  kode: string[];
  layanan: LayananKanal;
  instansi: string;
  url: string;
  /** Layanan online yang ditautkan dari halaman ini (diperiksa: host-nya benar-benar disebut di halaman). */
  layananOnline?: { nama: string; url: string }[];
};

export type KanalRunOpts = {
  kontakPath: string;
  sumberPath: string;
  outPath: string;
  only?: string | undefined;
  deps: { get: ProbeGet; now: () => Date };
  log: (line: string) => void;
};

type Target = {
  kode: string[];
  layanan: LayananKanal;
  instansi: string;
  url: string;
  layananOnline: SumberHalaman['layananOnline'];
};

const goId = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.go.id');
  } catch {
    return false;
  }
};

/** Kumpulkan entri dari situs Disdukcapil terverifikasi + halaman sumber tambahan; tulis berkas kanal-layanan. */
export async function runKanalLayanan(o: KanalRunOpts): Promise<EntriKanal[]> {
  const kontak = (JSON.parse(readFileSync(o.kontakPath, 'utf8')) as { kontak: Kontak[] }).kontak;
  const berkasSumber = JSON.parse(readFileSync(o.sumberPath, 'utf8')) as {
    sumber: SumberHalaman[];
    entri?: EntriKanal[];
  };
  const sumber = berkasSumber.sumber;
  const targets: Target[] = [
    ...sumber.map((s) => ({ ...s, layananOnline: s.layananOnline ?? [] })),
    // Situs terverifikasi yang ternyata portal pemda (bukan subdomain Disdukcapil) memuat kontak instansi lain.
    ...kontak.flatMap((k) =>
      k.status === 'terverifikasi' && /capil|duk/i.test(new URL(k.website).hostname)
        ? [
            {
              kode: [k.kode],
              layanan: 'adminduk' as const,
              instansi: `Dinas Kependudukan dan Pencatatan Sipil ${k.nama}`,
              url: `${k.website}/`,
              layananOnline: [],
            },
          ]
        : [],
    ),
  ].filter((t) => !o.only || t.kode.some((k) => k.startsWith(o.only!)));

  const dicekPada = o.deps.now().toISOString().slice(0, 10);
  const halaman = new Map<string, { finalUrl: string; body: string } | null>();
  const ambil = async (url: string) => {
    if (!halaman.has(url)) {
      try {
        const r = await o.deps.get(url);
        halaman.set(
          url,
          r.status === 200 && /html/i.test(r.contentType) && goId(r.finalUrl)
            ? { finalUrl: r.finalUrl, body: r.body }
            : null,
        );
      } catch {
        halaman.set(url, null);
      }
    }
    return halaman.get(url) ?? null;
  };

  let lama: EntriKanal[] = [];
  try {
    lama = (JSON.parse(readFileSync(o.outPath, 'utf8')) as { entri: EntriKanal[] }).entri;
  } catch {
    /* berkas belum ada */
  }
  /** kode|layanan yang halamannya berhasil dibaca pada putaran ini; selebihnya entri lama dipertahankan. */
  const terbaca = new Set<string>();
  const semua: EntriKanal[] = [];
  let n = 0;
  for (const t of targets) {
    if (!goId(t.url)) continue;
    const depan = await ambil(t.url);
    if (!depan) continue;
    for (const kode of t.kode) terbaca.add(`${kode}|${t.layanan}`);
    // Halaman kontak lebih spesifik daripada beranda: diproses lebih dulu.
    const urutan = [...tautanKontak(depan.body, depan.finalUrl), t.url];
    for (const url of urutan) {
      const h = url === t.url ? depan : await ambil(url);
      if (!h) continue;
      const k = ekstrakKontak(h.body);
      for (const kode of t.kode)
        semua.push(
          ...entriDariHalaman({ kode, layanan: t.layanan, instansi: t.instansi }, k, h.finalUrl, dicekPada),
        );
    }
    for (const lo of t.layananOnline ?? []) {
      if (!goId(lo.url) || !depan.body.includes(new URL(lo.url).hostname)) continue;
      for (const kode of t.kode)
        semua.push({
          kode,
          layanan: t.layanan,
          instansi: t.instansi,
          jenis: 'layanan_online',
          nilai: lo.nama,
          url: lo.url,
          sumberUrl: depan.finalUrl,
          dicekPada,
        });
    }
    n++;
    if (n % 10 === 0) o.log(`diproses ${n}/${targets.length}`);
  }

  // Entri yang dibaca tangan dari halaman resmi yang menolak klien otomatis (tetap wajib bersumber .go.id).
  const manual = (berkasSumber.entri ?? []).filter(
    (e) => goId(e.sumberUrl) && (!o.only || e.kode.startsWith(o.only)),
  );
  // Situs yang gagal dibaca kali ini (timeout, gangguan) tidak menghapus kontak yang sudah tercatat.
  const tetap = lama.filter((e) => !terbaca.has(`${e.kode}|${e.layanan}`));
  const entri = gabungEntri([...semua, ...manual, ...tetap]);
  const wilayah = new Set(entri.map((e) => e.kode));
  mkdirSync(dirname(o.outPath), { recursive: true });
  writeFileSync(
    o.outPath,
    JSON.stringify(
      {
        catatan:
          'Kontak layanan resmi per kab/kota, dibaca otomatis dari halaman .go.id instansinya (situs Disdukcapil terverifikasi di kontak-dukcapil.json dan halaman di sumber-kanal.json). Setiap nilai membawa sumberUrl dan dicekPada. Wilayah yang tidak tercantum berarti belum ada data, bukan tidak punya kontak.',
        wilayah: wilayah.size,
        total: entri.length,
        entri,
      },
      null,
      2,
    ) + '\n',
  );
  o.log(`${entri.length} entri untuk ${wilayah.size} wilayah`);
  return entri;
}
