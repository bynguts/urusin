import { redirect } from '@sveltejs/kit';
import { AkunError } from '@urusin/akun';
import { hapusAkunCookie } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { daftarKota } from '#lib/server/referensi.js';
import { getRuntime } from '#lib/server/runtime.js';
import { hapusTerakhir, rotasiSid } from '#lib/server/sesi.js';
import type { Actions, PageServerLoad } from './$types';

/** Tujuan masuk ulang (Google atau sandi) sebelum menghapus akun tanpa sandi, lalu kembali ke zona bahaya. */
const MASUK_ULANG = `/masuk?ulang=1&lanjut=${encodeURIComponent('/pengaturan#zona-bahaya')}`;

export const load: PageServerLoad = ({ locals }) => ({
  kota: daftarKota().map((k) => ({ kodeKabKota: k.kodeKabKota, nama: k.nama })),
  /**
   * Zona bahaya (akun saja, bukan sesi juri): hapus akun meminta sandi (akun bersandi) atau masuk ulang
   * (Google saja).
   */
  zonaBahaya: locals.akun?.jenis === 'akun' ? { punyaSandi: locals.akun.punyaSandi } : null,
});

export const actions: Actions = {
  /** "Keluar dari semua perangkat": hapus semua sesi akun (termasuk perangkat ini), putar sid, ke /masuk. */
  keluarSemua: async ({ locals, cookies }) => {
    if (locals.akun?.jenis !== 'akun') redirect(303, '/masuk');
    const rt = await getRuntime();
    rt.akun.keluarSemua(locals.akun.id);
    hapusAkunCookie(cookies);
    rotasiSid(cookies);
    hapusTerakhir(cookies);
    redirect(303, '/masuk');
  },
  /**
   * "Hapus akun": ketik HAPUS + sandi (akun bersandi), atau bukti masuk <= 15 menit (akun Google saja; bila
   * lewat, ke masuk ulang lalu kembali ke sini). Berhasil → cookie dihapus, sid diputar, ke beranda publik.
   */
  hapusAkun: async ({ request, locals, cookies }) => {
    if (locals.akun?.jenis !== 'akun') redirect(303, '/masuk');
    const form = await request.formData();
    const rt = await getRuntime();
    try {
      await rt.akun.hapusAkun(
        locals.akun.id,
        { konfirmasi: teks(form, 'konfirmasi').trim(), sandi: teks(form, 'sandi') || undefined },
        { authAt: locals.akunSesi?.authAt },
      );
    } catch (e) {
      if (e instanceof AkunError && e.kode === 'PERLU_MASUK_ULANG') redirect(303, MASUK_ULANG);
      return gagalForm(e);
    }
    hapusAkunCookie(cookies);
    rotasiSid(cookies);
    hapusTerakhir(cookies);
    redirect(303, '/');
  },
};
