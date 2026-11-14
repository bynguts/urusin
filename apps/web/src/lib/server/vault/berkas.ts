import { MIME_TEMPLAT, teksTemplat, type LayananBerkas, type TemplatTurn } from '@urusin/harness';
import { fieldDataDiri } from '#lib/pendamping/isi-data.js';
import type { Runtime } from '#lib/server/runtime.js';
import { dataIsian } from './resolver.js';

/**
 * Berkas buatan agen (`berkas__buat`) di atas brankas pemilik. Pemanggil sah KEDUA penyelesai nilai PII (selain
 * jalur isi Pendamping): nilai Data Diri/keluarga pemilik ditulis HANYA ke berkas milik pemilik itu sendiri, yang
 * langsung dienkripsi ke Dokumen-nya. Nilai tidak pernah dicatat, dikembalikan ke model, atau masuk event.
 * Salinan demo memakai data sintetis wilayah urusan (sama dengan Pendamping).
 */
export function layananBerkas(rt: () => Runtime): Omit<LayananBerkas, 'batas'> {
  return {
    nilai(pemilik, placeholder, kodeWilayah) {
      const data = dataIsian(rt(), pemilik, [], kodeWilayah);
      const out: Record<string, string> = {};
      for (const p of placeholder) {
        const k = fieldDataDiri(p);
        const v = k ? data[k] : undefined;
        if (typeof v === 'string' && v !== '') out[p] = v;
      }
      return out;
    },
    simpan(pemilik, b) {
      // Jenis "lainnya": berkas susunan warga sendiri, bukan surat keterangan terbitan instansi.
      const meta = rt().akun.vault.putDocument(pemilik, {
        jenis: 'lainnya',
        judul: b.judul,
        mime: b.mime,
        bytes: b.bytes,
      });
      return { id: meta.id };
    },
  };
}

/**
 * Teks templat dari dokumen lampiran giliran ini yang SUDAH tersimpan di brankas `pemilik` (DOCX/PDF). Dokumen milik
 * orang lain, jenis lain, atau tanpa teks (PDF pindaian) dilewati. Teks belum diredaksi: agen meredaksinya.
 */
export async function templatDariBrankas(
  rt: Runtime,
  pemilik: string,
  ids: readonly string[],
): Promise<TemplatTurn[]> {
  const out: TemplatTurn[] = [];
  const milik = new Set(rt.akun.vault.listDocuments(pemilik).map((d) => d.id));
  for (const id of new Set(ids)) {
    if (!milik.has(id)) continue;
    const d = rt.akun.vault.getDocument(pemilik, id);
    if (!d || !(MIME_TEMPLAT as readonly string[]).includes(d.meta.mime)) continue;
    const teks = await teksTemplat({ mime: d.meta.mime, bytes: d.bytes });
    if (teks) out.push({ mime: d.meta.mime, teks });
  }
  return out;
}
