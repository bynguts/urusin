import { versiPublik } from '#lib/server/build-info.js';
import type { LayoutServerLoad } from './$types';

/** `akun` = null untuk tamu; layar memakai ini untuk menampilkan Masuk/Akun tanpa request tambahan. */
export const load: LayoutServerLoad = ({ locals }) => ({
  /** Stempel versi (M11) untuk baris kecil di Pengaturan: `v<sha7>` + tautan commit. */
  versi: versiPublik(),
  akun: locals.akun
    ? {
        jenis: locals.akun.jenis === 'demo' ? ('demo' as const) : ('akun' as const),
        email: locals.akun.email,
      }
    : null,
});
