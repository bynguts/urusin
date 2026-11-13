import type { SesiPendamping } from '@urusin/contracts';
import { z } from 'zod';
import { catatHasilEksekusi, pesanAgen } from '#lib/server/eksekusi.js';
import { hasilAkhir, labelBukti } from '#lib/server/pendamping.js';
import type { Akses } from './akses';

/** "Saya sudah mengirim" ditolak worker (409): belum ada tulis warga, halaman belum sukses, atau sesi berakhir. */
export const PESAN_BELUM_TERKIRIM = 'Belum terlihat terkirim. Periksa halaman situsnya, lalu coba lagi.';

export const ExecutionPayload = z.object({
  executionId: z.string(),
  adapterId: z.string().min(1),
  flowId: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  origin: z.url().optional(),
  bacaSaja: z.boolean().optional(),
});

/** `execution_request` yang ditawarkan ke urusan ini untuk `executionId` (bukan tawaran = tidak dicatat). */
export function eksekusiDitawarkan(a: Extract<Akses, { ok: true }>, executionId: string) {
  return ExecutionPayload.safeParse(a.rt.store.findOffered(a.u.id, 'execution_request', { executionId }));
}

/**
 * Hasil akhir sesi (selesai atau siaga) dicatat ke urusan sekali, beserta bukti dari halaman konfirmasi
 * (nomor registrasi/status) bila ada. Dipakai GET status dan "Saya sudah mengirim".
 */
export function catatHasilSesi(a: Extract<Akses, { ok: true }>, s: SesiPendamping): void {
  // Simulasi demo di replika: tidak ada pengajuan, jadi hasilnya tidak dicatat sebagai hasil eksekusi urusan.
  if (s.simulasi === true) return;
  // Demo lihat saja di situs asli: AI hanya melihat, tidak ada yang dikirim. Penutupan sesinya (mis. juri beralih
  // ke simulasi) bukan "Anda membatalkan langkah", jadi juga tidak dicatat.
  if (s.lihatSaja === true) return;
  const hasil = hasilAkhir(s);
  const offered = eksekusiDitawarkan(a, s.executionId);
  if (!hasil || !offered.success) return;
  const bacaSaja = offered.data.bacaSaja === true;
  if (!catatHasilEksekusi(a.rt, a.u, s.executionId, hasil, 'Browser Pendamping', { bacaSaja })) return;
  const bukti = labelBukti(s);
  if (bukti) pesanAgen(a.rt, a.u.id, bukti);
  // Pengajuan terkirim: nomor permohonan disimpan di urusan (Urusanku, halaman urusan) setelah sesi tutup.
  const nomor = s.bukti?.nomor;
  if (hasil === 'berhasil' && !bacaSaja && nomor) a.rt.store.catatNomorPermohonan(a.u.id, nomor);
}
