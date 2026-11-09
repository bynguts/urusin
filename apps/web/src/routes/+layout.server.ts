import { shortSha } from '#lib/server/build-info.js';
import type { LayoutServerLoad } from './$types';

/** `akun` = null untuk tamu; layar memakai ini untuk menampilkan Masuk/Akun tanpa request tambahan. */
export const load: LayoutServerLoad = ({ locals }) => ({
  version: shortSha(),
  akun: locals.akun
    ? {
        jenis: locals.akun.jenis === 'demo' ? ('demo' as const) : ('akun' as const),
        email: locals.akun.email,
        emailTerverifikasi: locals.akun.emailVerifiedAt !== null,
      }
    : null,
});
