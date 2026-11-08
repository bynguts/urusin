import { konteks } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions } from './$types';

export const actions: Actions = {
  /** Selalu "bila terdaftar, tautan dikirim" (tidak membocorkan apakah email terdaftar); jujur bila tertunda. */
  default: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const rt = await getRuntime();
    let tertunda;
    try {
      ({ tertunda } = await rt.akun.lupaSandi(email, konteks(event)));
    } catch (e) {
      return gagalForm(e, email);
    }
    return { terkirim: true as const, tertunda, email };
  },
};
