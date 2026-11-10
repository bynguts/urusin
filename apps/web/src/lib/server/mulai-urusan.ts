import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { usulkanWilayah } from '@urusin/harness';
import { pastikanTamuUntukTurn, pemilikVault } from '#lib/server/akun.js';
import { getRuntime, publicOrigin, startTurnInBackground, type Runtime } from '#lib/server/runtime.js';
import { batasi, catatTerakhir, ensureSession } from '#lib/server/sesi.js';

const PERISTIWA = ['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya'] as const;
type Peristiwa = (typeof PERISTIWA)[number];

export const PESAN_AWAL_COOKIE = 'urusin_pesan_awal';

export type GagalMulai = { pesanWarga: string; pesan: string };

/**
 * Wilayah dulu: kab/kota dari Data Diri akun (bila ada) atau pilihan di perangkat dicatat sebagai USULAN saja,
 * sebelum turn pertama. Warga tetap mengonfirmasi (kartu "Ya, betul" atau di obrolan) sebelum rencana disusun:
 * perangkat bisa dipakai bersama dan Data Diri bisa usang.
 */
export function usulkanWilayahAwal(
  rt: Runtime,
  event: Pick<RequestEvent, 'locals' | 'cookies' | 'request' | 'getClientAddress'>,
  urusanId: string,
  kodePilihan: string | undefined,
): void {
  const p = pemilikVault(rt, event, { buat: false });
  const dariDataDiri = p ? rt.akun.vault.getDataDiri(p.id)?.data.kodeKabKota : undefined;
  const publish = (e: Parameters<Runtime['publish']>[1]) => void rt.publish(urusanId, e);
  if (typeof dariDataDiri === 'string' && usulkanWilayah(urusanId, dariDataDiri, 'data_diri', publish))
    return;
  if (kodePilihan) usulkanWilayah(urusanId, kodePilihan, 'pilihan', publish);
}

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
  // Wilayah urusan belum ditetapkan saat dibuat: pilihan perangkat hanya usulan (lihat usulkanWilayahAwal).
  const u = rt.store.createUrusan(jenis ? { jenis } : {});
  // Pemilik: sama dengan POST /api/urusan. Tanpa ini endpoint Browser Pendamping (cek pemilik) menjawab 404.
  rt.akun.catatPemilikUrusan(u.id, { akun: event.locals.akun, sid: event.locals.sid });
  usulkanWilayahAwal(rt, event, u.id, /^\d{4}$/.test(kode) ? kode : undefined);
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
