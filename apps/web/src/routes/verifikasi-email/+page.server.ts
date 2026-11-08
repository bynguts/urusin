import { konteks } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Tautan email membuka halaman ini dengan `?token=`. Membuka halaman TIDAK memakai token (pemindai tautan di
 * kotak surat sering membuka URL lebih dulu); token dipakai saat warga menekan tombol (POST). Tanpa token:
 * formulir kirim ulang tautan.
 */
export const load: PageServerLoad = async ({ url, setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
  const token = url.searchParams.get('token') ?? '';
  const rt = await getRuntime();
  return { token, tokenBerlaku: token !== '' && rt.akun.tokenBerlaku(token, 'verify') };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const rt = await getRuntime();
    try {
      rt.akun.verifikasiEmail(teks(form, 'token'), konteks(event));
    } catch (e) {
      return gagalForm(e);
    }
    return { terverifikasi: true as const };
  },
  kirimUlang: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const rt = await getRuntime();
    try {
      await rt.akun.kirimUlangVerifikasi(email, konteks(event));
    } catch (e) {
      return gagalForm(e, email);
    }
    return { terkirim: true as const, email };
  },
};
