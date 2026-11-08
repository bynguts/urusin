import type { Db } from './db.js';
import { reciprocalRankFusion } from './rrf.js';
import type { SourceRef } from './schema.js';

export type SearchOptions = {
  query: string;
  /** Kode kab/kota warga (4 digit). Chunk terlihat bila kodeWilayah = kab/kota, provinsi, atau nasional (null). */
  kodeKabKota?: string | undefined;
  layanan?: string | undefined;
  k?: number | undefined;
};

export type Hit = {
  id: string;
  text: string;
  skor: number;
  kutipan: SourceRef;
  verifiedAt: string | null;
  kodeWilayah: string | null;
  layanan: string | null;
};

/** Kamus sinonim istilah awam -> istilah resmi (ditambahkan ke kueri, bukan menggantikan). */
export const SINONIM: Readonly<Record<string, readonly string[]>> = {
  'ktp hilang': ['penggantian', 'ktp-el', 'kehilangan'],
  'ktp rusak': ['penggantian', 'ktp-el'],
  'surat pindah': ['skpwni', 'perpindahan'],
  'akta lahir': ['akta', 'kelahiran'],
  'akta nikah': ['perkawinan', 'akta'],
  'kk baru': ['kartu', 'keluarga'],
  'bikin ktp': ['pencetakan', 'ktp-el', 'perekaman'],
  meninggal: ['kematian', 'akta'],
};

export function tokenize(q: string): string[] {
  return (
    q
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu)
      ?.filter((t) => t.length >= 2) ?? []
  );
}

/** Bangun ekspresi MATCH aman: token dikutip, digabung OR. Null bila tidak ada token. */
export function buildMatch(q: string): string | null {
  const norm = q.toLowerCase();
  const tokens = new Set(tokenize(norm));
  for (const [phrase, extra] of Object.entries(SINONIM)) {
    if (norm.includes(phrase)) for (const e of extra) tokens.add(e);
  }
  if (tokens.size === 0) return null;
  return [...tokens].map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

export type Row = {
  id: string;
  text: string;
  judul: string;
  instansi: string;
  url: string;
  verified_at: string | null;
  kode_wilayah: string | null;
  layanan: string | null;
  skor: number;
};

export function toHit(r: Row): Hit {
  return {
    id: r.id,
    text: r.text,
    // bm25() lebih kecil = lebih relevan; balik tanda agar skor besar = baik.
    skor: -r.skor,
    kutipan: { url: r.url, judul: r.judul, instansi: r.instansi },
    verifiedAt: r.verified_at,
    kodeWilayah: r.kode_wilayah,
    layanan: r.layanan,
  };
}

/** Filter wilayah dulu, lalu BM25 (bobot kolom: judul 5, teks 1, instansi 0.5, ctx 0.7). */
export function searchBm25(db: Db, opts: SearchOptions, limit = opts.k ?? 6): Hit[] {
  const match = buildMatch(opts.query);
  if (!match) return [];
  const wilayah = opts.kodeKabKota ? [opts.kodeKabKota, opts.kodeKabKota.slice(0, 2)] : [];
  const marks = wilayah.map(() => '?').join(',');
  const sql = `
    SELECT c.id, c.text, c.judul, c.instansi, c.url, c.verified_at, c.kode_wilayah, c.layanan,
           bm25(chunks_fts, 5.0, 1.0, 0.5, 0.7) AS skor
    FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
      AND (c.kode_wilayah IS NULL${wilayah.length ? ` OR c.kode_wilayah IN (${marks})` : ''})
      ${opts.layanan ? 'AND c.layanan = ?' : ''}
    ORDER BY skor LIMIT ?`;
  const params: (string | number)[] = [match, ...wilayah];
  if (opts.layanan) params.push(opts.layanan);
  params.push(limit);
  return (db.prepare(sql).all(...params) as Row[]).map(toHit);
}

/**
 * BM25 top-20 digabung RRF dengan daftar vektor (id berurutan, sudah difilter wilayah oleh pemanggil).
 * Tanpa `vectorIds` perilaku = BM25 murni.
 */
export function searchHybrid(db: Db, opts: SearchOptions, vectorIds?: readonly string[]): Hit[] {
  const k = opts.k ?? 6;
  const bm = searchBm25(db, opts, 20);
  if (!vectorIds?.length) return bm.slice(0, k);
  const fused = reciprocalRankFusion([bm, vectorIds.map((id) => ({ id }))]).slice(0, k);
  const byId = new Map(bm.map((h) => [h.id, h]));
  const missing = fused.map((f) => f.id).filter((id) => !byId.has(id));
  if (missing.length) {
    const rows = db
      .prepare(
        `SELECT id, text, judul, instansi, url, verified_at, kode_wilayah, layanan, 0 AS skor FROM chunks WHERE id IN (${missing.map(() => '?').join(',')})`,
      )
      .all(...missing) as Row[];
    for (const r of rows) byId.set(r.id, toHit(r));
  }
  return fused.flatMap((f) => {
    const h = byId.get(f.id);
    return h ? [{ ...h, skor: f.skor }] : [];
  });
}
