import { AKUN_COOKIE } from '#lib/server/akun.js';
import { sidDariRequest, type PemeriksaPemilikAkun } from '#lib/server/pendamping.js';
import { getRuntime } from '#lib/server/runtime.js';

function cookieDari(request: Request, nama: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === nama) return v.join('=') || undefined;
  }
  return undefined;
}

/**
 * m6: urusan harus milik peminta menurut modul akun (`pemilikVaultUrusan`): akun sinkron yang sama, atau cookie
 * sesi yang sama untuk urusan tamu. Dipasang di hooks.server lewat `pasangPemeriksaPemilikAkun`, dipakai setiap
 * endpoint pendamping (`akses`). Urusan tanpa catatan pemilik atau milik orang lain → bukan milik (404).
 */
export const pemeriksaPemilikVault: PemeriksaPemilikAkun = async (request, urusan) => {
  const rt = await getRuntime();
  const token = cookieDari(request, AKUN_COOKIE);
  const akun = token ? rt.akun.sesi(token)?.akun : undefined;
  return (
    rt.akun.pemilikVaultUrusan(urusan.id, { akun, sid: sidDariRequest(request) ?? undefined }) !== undefined
  );
};
