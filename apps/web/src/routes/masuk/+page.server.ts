import { redirect } from '@sveltejs/kit';
import { AkunError, amanNext } from '@urusin/akun';
import { akunPublik, konteks, pasangSesi } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

/** Kode galat yang boleh datang lewat `?galat=` (dari callback Google). Selain ini diabaikan. */
const GALAT_QUERY = ['GOOGLE_TIDAK_AKTIF', 'GOOGLE_GAGAL', 'GOOGLE_EMAIL_BELUM_TERVERIFIKASI'] as const;

export const load: PageServerLoad = async ({ url, locals }) => {
  const next = amanNext(url.searchParams.get('next'));
  if (locals.akun) redirect(303, next);
  const rt = await getRuntime();
  const kode = GALAT_QUERY.find((k) => k === url.searchParams.get('galat'));
  return {
    next,
    googleAktif: rt.akun.googleAktif,
    galat: kode ? { kode, pesanWarga: new AkunError(kode).pesanWarga } : null,
  };
};

export const actions: Actions = {
  /** Masuk email + sandi → cookie sesi baru, urusan tamu dipindahkan, lalu ke tujuan (atau Lengkapi profil). */
  default: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const next = amanNext(teks(form, 'next'));
    const rt = await getRuntime();
    let hasil;
    try {
      hasil = await rt.akun.masuk({ email, sandi: teks(form, 'sandi') }, konteks(event));
    } catch (e) {
      return gagalForm(e, email);
    }
    pasangSesi(rt, event.cookies, hasil.akun.id, hasil.token);
    if (!akunPublik(rt, hasil.akun).profilLengkap)
      redirect(303, `/lengkapi-profil?next=${encodeURIComponent(next)}`);
    redirect(303, next);
  },
};
