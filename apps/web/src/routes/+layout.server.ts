import { shortSha } from '#lib/server/build-info.js';
import type { LayoutServerLoad } from './$types';

/** `akun` = null untuk tamu; layar memakai ini untuk menampilkan Masuk/Akun tanpa request tambahan. */
export const load: LayoutServerLoad = ({ locals }) => ({
  version: shortSha(),
  akun: locals.akun ? { email: locals.akun.email, emailTerverifikasi: locals.akun.emailTerverifikasi } : null,
});
