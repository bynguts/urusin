import { konteks } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Tautan email membuka halaman ini dengan `?token=`. Membuka halaman TIDAK memakai token (pemindai tautan di
 * kotak surat sering membuka URL lebih dulu); token dipakai saat warga menekan tombol (POST) bersama kata sandi
 * yang dibuat saat mendaftar (anti pra-pembajakan: tautan saja tidak cukup). Tanpa token: formulir kirim ulang.
 * Referrer-Policy same-origin: token di URL tidak bocor ke situs lain (no-referrer membuat peramban mengirim
 * `Origin: null` pada POST, yang ditolak cek CSRF).
 */
export const load: PageServerLoad = async ({ url, setHeaders }) => {
  setHeaders({ 'referrer-policy': 'same-origin', 'cache-control': 'no-store' });
  const token = url.searchParams.get('token') ?? '';
  const rt = await getRuntime();
  return { token, tokenBerlaku: token !== '' && rt.akun.tokenBerlaku(token, 'verify') };
};

export const actions: Actions = {
  /** SvelteKit melarang `default` bersama aksi bernama: tombol memakai `?/pastikan`. */
  pastikan: async (event) => {
    const form = await event.request.formData();
    const rt = await getRuntime();
    try {
      await rt.akun.verifikasiEmail(teks(form, 'token'), teks(form, 'sandi'), konteks(event));
    } catch (e) {
      return gagalForm(e);
    }
    return { terverifikasi: true as const };
  },
  kirimUlang: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const rt = await getRuntime();
    let tertunda;
    try {
      ({ tertunda } = await rt.akun.kirimUlangVerifikasi(email, konteks(event)));
    } catch (e) {
      return gagalForm(e, email);
    }
    return { terkirim: true as const, tertunda, email };
  },
};
