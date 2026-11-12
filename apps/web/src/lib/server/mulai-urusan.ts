import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { detectPii } from '@urusin/core';
import { kodeDisebut, usulkanWilayah } from '@urusin/harness';
import { pastikanTamuUntukTurn, pemilikVault } from '#lib/server/akun.js';
import { PESAN_PII } from '#lib/server/http.js';
import { ktpIngatanUrusan } from '#lib/server/ingatan.js';
import { segarkanJaringanId } from '#lib/server/pendamping.js';
import { getRuntime, publicOrigin, startTurnInBackground, type Runtime } from '#lib/server/runtime.js';
import { batasi, catatTerakhir, ensureSession } from '#lib/server/sesi.js';

const PERISTIWA = ['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya'] as const;
type Peristiwa = (typeof PERISTIWA)[number];

export const PESAN_AWAL_COOKIE = 'urusin_pesan_awal';

export type GagalMulai = { pesanWarga: string; pesan: string; kode?: string };

/**
 * Wilayah dulu: kab/kota yang dipilih di halaman (bila ada) atau dari Data Diri akun dicatat sebagai USULAN saja,
 * sebelum turn pertama. Pilihan eksplisit menang atas Data Diri; bila sama, sumbernya tetap Data Diri. Warga tetap
 * mengonfirmasi (kartu "Ya, betul" atau di obrolan) sebelum rencana disusun: perangkat bisa dipakai bersama dan
 * Data Diri bisa usang. Pesan pertama yang menyebut kab/kota lain menang: usulan perangkat/Data Diri tidak
 * diterbitkan, agar kartu tidak bertentangan dengan wilayah yang ditanyakan agen dari pesan itu.
 * Tanpa keduanya, wilayah KTP dari Ingatan warga (urusan sebelumnya, ADR 0031) menjadi usulan dengan aturan yang
 * sama: tetap dikonfirmasi warga. Dipanggil sesudah pemilik urusan dicatat.
 */
export function usulkanWilayahAwal(
  rt: Runtime,
  event: Pick<RequestEvent, 'locals' | 'cookies' | 'request' | 'getClientAddress'>,
  urusanId: string,
  kodePilihan: string | undefined,
  pesan = '',
): void {
  const p = pemilikVault(rt, event, { buat: false });
  const dariDataDiri = p ? rt.akun.vault.getDataDiri(p.id)?.data.kodeKabKota : undefined;
  const publish = (e: Parameters<Runtime['publish']>[1]) => void rt.publish(urusanId, e);
  const dataDiri = typeof dariDataDiri === 'string' ? dariDataDiri : undefined;
  const disebut = kodeDisebut(pesan);
  const cocok = (kode: string) => disebut.length === 0 || disebut.includes(kode);
  const pilihan = kodePilihan && cocok(kodePilihan) ? kodePilihan : undefined;
  if (pilihan && pilihan !== dataDiri && usulkanWilayah(urusanId, pilihan, 'pilihan', publish)) return;
  if (dataDiri && cocok(dataDiri)) {
    usulkanWilayah(urusanId, dataDiri, 'data_diri', publish);
    return;
  }
  if (pilihan || dataDiri) return;
  const ingatan = ktpIngatanUrusan(rt.akun, urusanId);
  if (ingatan && cocok(ingatan)) usulkanWilayah(urusanId, ingatan, 'ingatan', publish);
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
  // Sama dengan readBody di POST /api/urusan: NIK/KK/HP/email tidak boleh menuju model. Pesan tidak digemakan.
  if (pesan && detectPii(pesan, /^\d{4}$/.test(kode) ? { kodeKabKota: kode } : {}).length > 0)
    return fail(422, { pesanWarga: PESAN_PII, pesan: '', kode: 'PII_IN_PAYLOAD' } satisfies GagalMulai);

  const rt = await getRuntime();
  event.locals.sid = ensureSession(event.cookies);
  const ditolak = batasi(rt, event, 'buat');
  if (ditolak) {
    // Pesan sudah memuat waktu tunggu nyata dari Retry-After ("Coba lagi dalam ±N menit").
    const isi = (await ditolak.json()) as { pesanWarga: string };
    return fail(429, { pesanWarga: isi.pesanWarga, pesan, kode: 'RATE_LIMITED' } satisfies GagalMulai);
  }

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
  // Sama dengan POST /api/urusan: tier portal id-only di turn pertama memakai cache yang tidak dingin.
  await segarkanJaringanId();
  usulkanWilayahAwal(rt, event, u.id, /^\d{4}$/.test(kode) ? kode : undefined, pesan);
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
