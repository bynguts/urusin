import { redirect } from '@sveltejs/kit';
import { konteks } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.akun) redirect(303, '/');
  const rt = await getRuntime();
  return { googleAktif: rt.akun.googleAktif };
};

export const actions: Actions = {
  /** Daftar → selalu "cek email Anda" (tidak membocorkan apakah email sudah terdaftar); jujur bila tertunda. */
  default: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const rt = await getRuntime();
    let tertunda;
    try {
      ({ tertunda } = await rt.akun.daftar({ email, sandi: teks(form, 'sandi') }, konteks(event)));
    } catch (e) {
      return gagalForm(e, email);
    }
    return { terkirim: true as const, tertunda, email };
  },
};
