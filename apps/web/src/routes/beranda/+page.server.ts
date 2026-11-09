import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import { daftarKota } from '#lib/server/referensi.js';
import { getRuntime } from '#lib/server/runtime.js';
import { bacaTerakhir } from '#lib/server/sesi.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Ringkasan (frame uCOBS/IzXAR) untuk urusan terakhir di peramban ini; tanpa urusan, atau dengan `?baru`,
 * halaman menampilkan kotak cerita untuk memulai urusan.
 */
export const load: PageServerLoad = async ({ cookies, url, setHeaders }) => {
  if (url.searchParams.has('baru')) return { urusan: null, demo: false };
  const id = bacaTerakhir(cookies);
  if (!id) return { urusan: null, demo: false };
  const rt = await getRuntime();
  const u = rt.store.getUrusan(id);
  if (!u) return { urusan: null, demo: false };
  // Id urusan adalah token kapabilitas: halaman tidak boleh disimpan cache bersama.
  setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
  const kota = u.kodeKabKota ? daftarKota().find((k) => k.kodeKabKota === u.kodeKabKota) : undefined;
  return {
    demo: rt.mode === 'demo',
    urusan: {
      id: u.id,
      jenis: u.jenis,
      kodeKabKota: u.kodeKabKota,
      namaKota: kota?.nama ?? null,
      state: u.state,
      dibuatPada: u.createdAt,
      diubahPada: u.updatedAt,
    },
  };
};

export const actions: Actions = {
  /** Mulai urusan dari kotak cerita Beranda atau tombol di halaman peristiwa (jalan tanpa JavaScript). */
  mulai: (event) => mulaiUrusanDariForm(event),
};
