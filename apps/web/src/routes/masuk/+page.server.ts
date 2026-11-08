import { redirect } from '@sveltejs/kit';
import { AkunError, amanNext } from '@urusin/akun';
import {
  akunPublik,
  juriTersedia,
  konteks,
  masukJuri,
  pasangSesi,
  TAUTKAN_COOKIE,
  turnstileLolos,
} from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';
import type { Actions, PageServerLoad } from './$types';

/** Kode galat yang boleh datang lewat `?galat=` (dari callback Google). Selain ini diabaikan. */
const GALAT_QUERY = [
  'GOOGLE_TIDAK_AKTIF',
  'GOOGLE_GAGAL',
  'GOOGLE_EMAIL_BELUM_TERVERIFIKASI',
  'GOOGLE_PERLU_SANDI',
  'GOOGLE_SUDAH_DIPAKAI',
] as const;

/** Token Turnstile dari widget Cloudflare (`cf-turnstile-response`) atau field `turnstile`. */
const tokenTurnstile = (form: FormData) => teks(form, 'cf-turnstile-response') || teks(form, 'turnstile');

export const load: PageServerLoad = async ({ url, locals, cookies }) => {
  const next = amanNext(url.searchParams.get('next'));
  if (locals.akun) redirect(303, next);
  const rt = await getRuntime();
  const kode = GALAT_QUERY.find((k) => k === url.searchParams.get('galat'));
  return {
    next,
    googleAktif: rt.akun.googleAktif,
    juri: juriTersedia(rt),
    turnstileSiteKey: rt.turnstile.siteKey,
    /** Ada identitas Google yang menunggu bukti sandi: masuk dengan sandi akan menautkannya. */
    tautkan: cookies.get(TAUTKAN_COOKIE) !== undefined,
    galat: kode ? { kode, pesanWarga: new AkunError(kode).pesanWarga } : null,
  };
};

export const actions: Actions = {
  /**
   * Masuk email + sandi (Turnstile setelah 3 kegagalan) → cookie sesi baru, sid diputar, data tamu pindah ke
   * akun terverifikasi, Google yang menunggu bukti sandi ditautkan, lalu ke tujuan (atau Lengkapi profil).
   */
  masuk: async (event) => {
    const form = await event.request.formData();
    const email = teks(form, 'email');
    const next = amanNext(teks(form, 'next'));
    const rt = await getRuntime();
    let hasil;
    try {
      const ctx = konteks(event);
      const turnstileOk = await turnstileLolos(rt, tokenTurnstile(form), ctx.ip);
      hasil = await rt.akun.masuk({ email, sandi: teks(form, 'sandi') }, { ...ctx, turnstileOk });
    } catch (e) {
      return gagalForm(e, email);
    }
    pasangSesi(rt, event.cookies, hasil.akun, hasil.token, { buktiSandi: true });
    if (!akunPublik(rt, hasil.akun, event.cookies.get(SID_COOKIE)).profilLengkap)
      redirect(303, `/lengkapi-profil?next=${encodeURIComponent(next)}`);
    redirect(303, next);
  },
  /** "Masuk sebagai juri": salinan demo terisolasi berisi data sintetis (Turnstile + batas per IP/global). */
  juri: async (event) => {
    const form = await event.request.formData();
    const rt = await getRuntime();
    try {
      await masukJuri(rt, event, tokenTurnstile(form));
    } catch (e) {
      return gagalForm(e);
    }
    redirect(303, '/');
  },
};
