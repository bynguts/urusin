import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { detectPii } from '@urusin/core';
import { pastikanTamuUntukTurn } from '#lib/server/akun.js';
import { PESAN_PII } from '#lib/server/http.js';
import { getRuntime, publicOrigin, startTurnInBackground } from '#lib/server/runtime.js';
import { batasi, catatTerakhir, ensureSession } from '#lib/server/sesi.js';

const PERISTIWA = ['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya'] as const;
type Peristiwa = (typeof PERISTIWA)[number];

export const PESAN_AWAL_COOKIE = 'urusin_pesan_awal';

export type GagalMulai = { pesanWarga: string; pesan: string };

/**
 * Form action "mulai urusan" (Beranda dan Rencana peristiwa): sama dengan POST /api/urusan, tetapi lewat
 * formulir biasa agar tetap jalan tanpa JavaScript. Berhasil → 303 ke /urusan/[id].
 */
export async function mulaiUrusanDariForm(event: RequestEvent) {
  const form = await event.request.formData();
  const ambil = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };
  const pesan = ambil('pesan').slice(0, 2000);
  const kode = ambil('kodeKabKota');
  const peristiwaRaw = ambil('peristiwa');
  const peristiwa = PERISTIWA.find((p) => p === peristiwaRaw) as Peristiwa | undefined;
  if (!pesan && !peristiwa)
    return fail(422, { pesanWarga: 'Tulis dulu apa yang ingin Anda urus.', pesan } satisfies GagalMulai);
  // Sama dengan readBody di POST /api/urusan: NIK/KK/HP/email tidak boleh menuju model. Pesan tidak digemakan.
  if (pesan && detectPii(pesan, /^\d{4}$/.test(kode) ? { kodeKabKota: kode } : {}).length > 0)
    return fail(422, { pesanWarga: PESAN_PII, pesan: '' } satisfies GagalMulai);

  const rt = await getRuntime();
  event.locals.sid = ensureSession(event.cookies);
  const ditolak = batasi(rt, event, 'buat');
  if (ditolak)
    return fail(429, {
      pesanWarga: 'Terlalu banyak urusan baru dalam waktu singkat. Tunggu sebentar lalu coba lagi.',
      pesan,
    } satisfies GagalMulai);

  if (pesan) {
    const tamu = pastikanTamuUntukTurn(rt, event);
    if (tamu) {
      const isi = (await tamu.json().catch(() => ({}))) as { pesanWarga?: string };
      return fail(tamu.status, {
        pesanWarga: isi.pesanWarga ?? 'Urusan belum bisa dimulai. Coba lagi sebentar lagi.',
        pesan,
      } satisfies GagalMulai);
    }
  }

  const jenis = peristiwa && peristiwa !== 'lainnya' ? peristiwa : undefined;
  const u = rt.store.createUrusan({
    ...(/^\d{4}$/.test(kode) ? { kodeKabKota: kode } : {}),
    ...(jenis ? { jenis } : {}),
  });
  // Pemilik: sama dengan POST /api/urusan. Tanpa ini endpoint Browser Pendamping (cek pemilik) menjawab 404.
  rt.akun.catatPemilikUrusan(u.id, { akun: event.locals.akun, sid: event.locals.sid });
  if (pesan) startTurnInBackground(rt, { urusanId: u.id, userText: pesan });
  catatTerakhir(event.cookies, u.id, publicOrigin());
  // Formulir terkirim sebelum JavaScript siap: pesan pertama tidak sempat dicatat di perangkat. Titipkan
  // sekali lewat cookie sempit (hanya path urusan ini, 2 menit); halaman urusan membacanya lalu menghapusnya.
  if (pesan && event.request.headers.get('x-sveltekit-action') !== 'true' && pesan.length <= 1000)
    event.cookies.set(PESAN_AWAL_COOKIE, pesan, {
      path: `/urusan/${u.id}`,
      httpOnly: true,
      sameSite: 'lax',
      secure: publicOrigin().startsWith('https://'),
      maxAge: 120,
    });
  redirect(303, `/urusan/${u.id}`);
}
