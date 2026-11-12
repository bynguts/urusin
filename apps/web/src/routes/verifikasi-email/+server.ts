import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Verifikasi email sudah dihapus (ADR 0032): akun langsung penuh saat daftar. Tautan lama di kotak surat
 * dialihkan ke beranda (sudah masuk) atau halaman Masuk; tokennya diabaikan.
 */
export const GET: RequestHandler = ({ locals }) => {
  redirect(303, locals.akun ? '/beranda' : '/masuk');
};
