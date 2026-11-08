import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { getRuntime, publicOrigin, startTurnInBackground } from '#lib/server/runtime.js';
import { batasi, ensureSession } from '#lib/server/sesi.js';

const PERISTIWA = ['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya'] as const;
type Peristiwa = (typeof PERISTIWA)[number];

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

  const rt = await getRuntime();
  event.locals.sid = ensureSession(event.cookies, publicOrigin());
  const ditolak = batasi(rt, event, 'buat');
  if (ditolak)
    return fail(429, {
      pesanWarga: 'Terlalu banyak urusan baru dalam waktu singkat. Tunggu sebentar lalu coba lagi.',
      pesan,
    } satisfies GagalMulai);

  const jenis = peristiwa && peristiwa !== 'lainnya' ? peristiwa : undefined;
  const u = rt.store.createUrusan({
    ...(/^\d{4}$/.test(kode) ? { kodeKabKota: kode } : {}),
    ...(jenis ? { jenis } : {}),
  });
  if (pesan) startTurnInBackground(rt, { urusanId: u.id, userText: pesan });
  redirect(303, `/urusan/${u.id}`);
}
