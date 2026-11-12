import { redirect } from '@sveltejs/kit';
import { amanNext } from '@urusin/akun';
import { konteks, pasangSesi } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

/** `?next=/path`: tujuan setelah daftar (default beranda), hanya path di situs ini. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const next = amanNext(url.searchParams.get('next'), '/beranda');
  if (locals.akun) redirect(303, next);
  const rt = await getRuntime();
  return { googleAktif: rt.akun.googleAktif, next };
};

export const actions: Actions = {
  /**
   * Daftar → akun penuh dan langsung masuk ke beranda, atau ke `next` (ADR 0032, tanpa email verifikasi).
   * Urusan dan data tamu ikut pindah ke akun. Email sudah terdaftar → galat `EMAIL_SUDAH_TERDAFTAR`.
   */
  default: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const rt = await getRuntime();
    let hasil;
    try {
      hasil = await rt.akun.daftar({ email, sandi: teks(form, 'sandi') }, konteks(event));
    } catch (e) {
      return gagalForm(e, email);
    }
    pasangSesi(rt, event.cookies, hasil.akun, hasil.token);
    redirect(303, amanNext(teks(form, 'next'), '/beranda'));
  },
};
