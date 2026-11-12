import { fail, redirect } from '@sveltejs/kit';
import { amanNext } from '@urusin/akun';
import { LengkapiProfilRequestSchema } from '@urusin/contracts';
import { lengkapiProfil, pemilikVault } from '#lib/server/akun.js';
import { teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const next = amanNext(event.url.searchParams.get('next'));
  if (!event.locals.akun) redirect(303, `/masuk?next=${encodeURIComponent(`/lengkapi-profil?next=${next}`)}`);
  const rt = await getRuntime();
  const p = pemilikVault(rt, event, { buat: false });
  const nama = p ? rt.akun.vault.getDataDiri(p.id)?.data.namaLengkap : undefined;
  return { next, namaLengkap: typeof nama === 'string' ? nama : '' };
};

export const actions: Actions = {
  /**
   * Simpan nama lengkap (dan HP opsional) ke Data Diri terenkripsi pemilik vault (akun/demo: ikut akun; tamu:
   * vault perangkat ini), lalu ke tujuan.
   */
  default: async (event) => {
    if (!event.locals.akun) redirect(303, '/masuk');
    const form = await event.request.formData();
    const hp = teks(form, 'hp').replace(/[\s.-]/g, '');
    const parsed = LengkapiProfilRequestSchema.safeParse({
      namaLengkap: teks(form, 'namaLengkap'),
      ...(hp ? { hp } : {}),
    });
    if (!parsed.success)
      return fail(422, {
        kode: 'BODY_INVALID',
        pesanWarga: 'Tulis nama lengkap Anda. Nomor HP boleh dikosongkan.',
      });
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: true })!;
    lengkapiProfil(rt, p.id, parsed.data);
    redirect(303, amanNext(teks(form, 'next')));
  },
};
