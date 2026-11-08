import { fail, redirect } from '@sveltejs/kit';
import { amanNext } from '@urusin/akun';
import { LengkapiProfilRequestSchema } from '@urusin/contracts';
import { lengkapiProfil } from '#lib/server/akun.js';
import { teks } from '#lib/server/akun-form.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
  const next = amanNext(url.searchParams.get('next'));
  if (!locals.akun) redirect(303, `/masuk?next=${encodeURIComponent(`/lengkapi-profil?next=${next}`)}`);
  const rt = await getRuntime();
  const nama = rt.akun.vault.getDataDiri(locals.akun.id)?.data.namaLengkap;
  return { next, namaLengkap: typeof nama === 'string' ? nama : '' };
};

export const actions: Actions = {
  /** Simpan nama lengkap (dan HP opsional) ke Data Diri terenkripsi, lalu ke tujuan. */
  default: async ({ request, locals }) => {
    if (!locals.akun) redirect(303, '/masuk');
    const form = await request.formData();
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
    lengkapiProfil(rt, locals.akun.id, parsed.data);
    redirect(303, amanNext(teks(form, 'next')));
  },
};
