import { createHash } from 'node:crypto';
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
        /** Penanda pemilik daftar urusan di perangkat (hash id akun, bukan PII): perangkat bersama. */
        penanda: createHash('sha256').update(`urusin-lokal:${locals.akun.id}`).digest('hex').slice(0, 16),
      }
    : null,
});
