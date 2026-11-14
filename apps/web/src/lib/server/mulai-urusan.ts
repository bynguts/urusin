import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { detectPii } from '@urusin/core';
import { kodeDisebut, refWilayah, tetapkanWilayah, usulkanWilayah } from '@urusin/harness';
import { pastikanTamuUntukTurn, pemilikVault } from '#lib/server/akun.js';
import { PESAN_PII } from '#lib/server/http.js';
import { ktpIngatanUrusan } from '#lib/server/ingatan.js';
import { segarkanJaringanId } from '#lib/server/pendamping.js';
import { getRuntime, publicOrigin, startTurnInBackground, type Runtime } from '#lib/server/runtime.js';
import { batasi, catatTerakhir, ensureSession } from '#lib/server/sesi.js';

const PERISTIWA = ['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya'] as const;
type Peristiwa = (typeof PERISTIWA)[number];

export const PESAN_AWAL_COOKIE = 'urusin_pesan_awal';

/**
 * Wilayah layanan yang dipilih di perangkat (Pengaturan atau halaman peristiwa), ditulis `LokalStore` di peramban.
 * Hanya kode kab/kota 4 digit (bukan PII). Server memakainya sebagai usulan bila formulir tidak membawa kode, mis.
 * landing tanpa JavaScript (`csr = false`) yang tidak bisa membaca localStorage.
 */
export const WILAYAH_COOKIE = 'urusin_wilayah';

/** Kode kab/kota dari cookie wilayah perangkat; undefined bila tidak ada atau formatnya salah. */
export function kodeWilayahTersimpan(
  cookies: Pick<RequestEvent['cookies'], 'get'> | undefined,
): string | undefined {
  const v = cookies?.get(WILAYAH_COOKIE);
  return v && /^\d{4}$/.test(v) ? v : undefined;
}

export type GagalMulai = { pesanWarga: string; pesan: string; kode?: string };

/**
 * Wilayah dulu, tanpa bertanya ulang: wilayah KTP dari sumber tepercaya (Data Diri akun, lalu Ingatan warga dari
 * urusan sebelumnya yang sudah pernah dipastikan, ADR 0031) langsung DITETAPKAN sebelum turn pertama; obrolan cukup
 * menampilkan catatan kecil "Wilayah layanan: X · Ubah", rencana tidak menunggu. Pesan pertama yang menyebut
 * kab/kota lain menang: sumber itu tidak dipakai, agen yang menanggapi wilayah dari pesan itu.
 * Pilihan wilayah perangkat (formulir, atau cookie `WILAYAH_COOKIE` untuk titik mulai tanpa JavaScript) hanya
 * tebakan (perangkat bisa dipakai bersama): bila berbeda dari sumber tepercaya, atau tanpa sumber tepercaya, dicatat
 * sebagai USULAN yang tidak menjadi kartu sendiri; agen yang memutuskan apakah wilayah perlu ditanyakan (lihat
 * `kartuWilayahSaatPerlu` di web), dan Browser Pendamping tetap tertutup sampai wilayah dipastikan. Dipanggil
 * sesudah pemilik urusan dicatat.
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
  const ingatan = ktpIngatanUrusan(rt.akun, urusanId);
  const yakin =
    dataDiri && cocok(dataDiri)
      ? { kode: dataDiri, sumber: 'data_diri' as const }
      : ingatan && cocok(ingatan)
        ? { kode: ingatan, sumber: 'ingatan' as const }
        : undefined;
  // Formulir tanpa kode (landing, kartu peristiwa tanpa JS): pilihan wilayah perangkat dari cookie. Kode yang tidak
  // ada di registry ditolak `usulkanWilayah`.
  const perangkatRaw = kodePilihan ?? kodeWilayahTersimpan(event.cookies);
  const perangkat = perangkatRaw && cocok(perangkatRaw) ? perangkatRaw : undefined;
  // Sumber tepercaya menang atas pilihan perangkat (pilihan perangkat bisa sisa urusan lain). Mengurus untuk
  // keluarga di kab/kota lain cukup disebut di obrolan; agen yang menetapkan ulang. Tanpa sumber tepercaya,
  // pilihan perangkat hanya usulan dan agen yang memutuskan apakah perlu ditanyakan.
  if (perangkat && !yakin) {
    usulkanWilayah(urusanId, perangkat, 'pilihan', publish);
    return;
  }
  // Kode yang tidak ada di registry (Data Diri lama) tidak ditetapkan.
  if (yakin && refWilayah(yakin.kode))
    tetapkanWilayah(
      rt.store,
      rt.store.getUrusanOrThrow(urusanId),
      { ktp: yakin.kode },
      publish,
      yakin.sumber,
    );
}

/**
 * Form action "mulai urusan" (Beranda dan Rencana peristiwa): sama dengan POST /api/urusan, tetapi lewat
 * formulir biasa agar tetap jalan tanpa JavaScript. Berhasil → 303 ke /urusan/[id]; tanpa sesi → 303 ke /daftar.
 */
export async function mulaiUrusanDariForm(event: RequestEvent) {
  const form = await event.request.formData();
  const ambil = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };
  const pesan = ambil('pesan').slice(0, 2000);
  const kode = ambil('kodeKabKota');
  // Beranda dengan lampiran: halaman urusan sendiri yang mengirim pesan pertama bersama lampirannya (brankas +
  // gambar untuk AI), jadi turn tidak dimulai di sini.
  const kirimDariHalaman = ambil('lampiran') === '1';
  const peristiwaRaw = ambil('peristiwa');
  const peristiwa = PERISTIWA.find((p) => p === peristiwaRaw) as Peristiwa | undefined;
  // Wajib akun: tanpa sesi → daftar dulu, lalu kembali ke rencana peristiwa (wilayah terpilih ikut) atau Beranda.
  if (!event.locals.akun) {
    const tujuan =
      peristiwa && peristiwa !== 'lainnya'
        ? `/peristiwa/${peristiwa}${/^\d{4}$/.test(kode) ? `?kodeKabKota=${kode}` : ''}`
        : '/beranda';
    redirect(303, `/daftar?next=${encodeURIComponent(tujuan)}`);
  }
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
  if (pesan && !kirimDariHalaman) startTurnInBackground(rt, { urusanId: u.id, userText: pesan });
  catatTerakhir(event.cookies, u.id, publicOrigin());
  // Formulir terkirim sebelum JavaScript siap: pesan pertama tidak sempat dicatat di perangkat. Titipkan
  // sekali lewat cookie sempit (hanya path urusan ini, 2 menit); halaman urusan membacanya lalu menghapusnya.
  if (
    pesan &&
    !kirimDariHalaman &&
    event.request.headers.get('x-sveltekit-action') !== 'true' &&
    pesan.length <= 1000
  )
    event.cookies.set(PESAN_AWAL_COOKIE, pesan, {
      path: `/urusan/${u.id}`,
      httpOnly: true,
      sameSite: 'lax',
      secure: publicOrigin().startsWith('https://'),
      maxAge: 120,
    });
  redirect(303, `/urusan/${u.id}`);
}
