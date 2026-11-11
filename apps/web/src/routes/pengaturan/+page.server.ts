import { redirect } from '@sveltejs/kit';
import { AkunError } from '@urusin/akun';
import { hapusAkunCookie, pemilikVault } from '#lib/server/akun.js';
import { gagalForm, teks } from '#lib/server/akun-form.js';
import { daftarIngatan, hapusButirIngatan, hapusSemuaIngatan } from '#lib/server/ingatan.js';
import { daftarKota } from '#lib/server/referensi.js';
import { getRuntime } from '#lib/server/runtime.js';
import { hapusTerakhir, rotasiSid } from '#lib/server/sesi.js';
import type { Actions, PageServerLoad } from './$types';

/** Tujuan masuk ulang (Google atau sandi) sebelum menghapus akun tanpa sandi, lalu kembali ke zona bahaya. */
const MASUK_ULANG = `/masuk?ulang=1&lanjut=${encodeURIComponent('/pengaturan#zona-bahaya')}`;

/** Kembali ke bagian ingatan setelah menghapus (POST-redirect-GET: muat ulang tidak mengirim ulang). */
const KE_INGATAN = '/pengaturan#ingatan';

export const load: PageServerLoad = async (event) => ({
  kota: daftarKota().map((k) => ({ kodeKabKota: k.kodeKabKota, nama: k.nama })),
  /**
   * Yang Urusin ingat (ADR 0031): butir ingatan pemilik vault perangkat/akun ini (label tanpa PII). Kosong bila
   * belum ada vault (belum pernah memulai urusan).
   */
  ingatan: await (async () => {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    return p ? daftarIngatan(rt.akun, p.id) : [];
  })(),
  /**
   * Zona bahaya (akun saja, bukan sesi juri): hapus akun meminta sandi (akun bersandi) atau masuk ulang
   * (Google saja).
   */
  zonaBahaya: event.locals.akun?.jenis === 'akun' ? { punyaSandi: event.locals.akun.punyaSandi } : null,
});

export const actions: Actions = {
  /** Hapus satu butir ingatan (tombol "Hapus" per butir). Jalan tanpa JS. */
  hapusIngatan: async (event) => {
    const id = teks(await event.request.formData(), 'id');
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    if (p && /^ing_[0-9a-f]{16}$/.test(id)) hapusButirIngatan(rt.akun, p.id, id);
    redirect(303, KE_INGATAN);
  },
  /** "Hapus semua ingatan" (hak hapus UU PDP 27/2022). */
  hapusSemuaIngatan: async (event) => {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    if (p) hapusSemuaIngatan(rt.akun, p.id);
    redirect(303, KE_INGATAN);
  },
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
