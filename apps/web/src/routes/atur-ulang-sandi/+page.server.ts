import { hapusAkunCookie, konteks } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

/** Tautan email `?token=`. Membuka halaman tidak memakai token; token terpakai saat sandi baru dikirim. */
export const load: PageServerLoad = async ({ url, setHeaders }) => {
  setHeaders({ 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
  const token = url.searchParams.get('token') ?? '';
  const rt = await getRuntime();
  return { token, tokenBerlaku: token !== '' && rt.akun.tokenBerlaku(token, 'reset') };
};

export const actions: Actions = {
  /** Sandi baru → semua perangkat dikeluarkan (termasuk yang ini); warga masuk lagi. */
  default: async (event) => {
    const form = await event.request.formData();
    const rt = await getRuntime();
    try {
      await rt.akun.aturUlangSandi(teks(form, 'token'), teks(form, 'sandi'), konteks(event));
    } catch (e) {
      return gagalForm(e);
    }
    hapusAkunCookie(event.cookies);
    return { berhasil: true as const };
  },
};
