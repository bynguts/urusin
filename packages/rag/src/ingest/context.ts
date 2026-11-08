export type ChunkContext = {
  judulHalaman: string;
  /** Heading/bagian tempat potongan berasal (mis. "Persyaratan"). */
  heading?: string | undefined;
  instansi: string;
  /** Nama wilayah (mis. "Kota Surabaya"), bukan kode. */
  wilayah?: string | undefined;
  layanan?: string | undefined;
};

/**
 * "Contextual retrieval": header satu baris yang hanya ikut diindeks (bukan ditampilkan), supaya
 * potongan pendek seperti "Syarat: KK, surat kehilangan" tetap tahu ia dari halaman/instansi mana.
 * Urutan: judul halaman › bagian › instansi › wilayah › layanan; bagian kosong/duplikat dibuang.
 */
export function buildChunkContextHeader(c: ChunkContext): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of [c.judulHalaman, c.heading, c.instansi, c.wilayah, c.layanan]) {
    const p = raw?.replace(/\s+/g, ' ').trim();
    if (!p || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    parts.push(p);
  }
  return parts.join(' › ').slice(0, 500);
}
