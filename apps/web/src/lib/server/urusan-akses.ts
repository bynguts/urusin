import type { Akun } from '@urusin/akun';
import type { UrusanRow } from '@urusin/harness';
import type { Runtime } from '#lib/server/runtime.js';

/** Siapa yang meminta: akun yang masuk (dari hooks) dan/atau cookie `__Host-urusin_sid`. */
export type PemintaUrusan = { akun?: Akun | undefined; sid?: string | undefined };

/**
 * Satu-satunya pintu baca/tulis urusan per id: urusan dikembalikan HANYA bila peminta pemiliknya (akun/demo
 * yang sama, atau cookie sesi yang sama untuk urusan tamu). Bukan pemilik, urusan tidak ada, atau urusan lama
 * tanpa catatan pemilik → undefined; pemanggil menjawab 404 yang sama agar keberadaan urusan tidak bocor.
 * API memakai `locals.sid` (diisi hooks untuk /api/); loader halaman membaca cookie `SID_COOKIE` sendiri.
 */
export function urusanMilik(rt: Runtime, id: string, peminta: PemintaUrusan): UrusanRow | undefined {
  const u = rt.store.getUrusan(id);
  if (!u || !rt.akun.adalahPemilikUrusan(u.id, peminta)) return undefined;
  return u;
}
