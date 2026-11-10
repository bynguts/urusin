import { AKUN_COOKIE } from '#lib/server/akun.js';
import { sidDariRequest, type PemeriksaPemilikAkun } from '#lib/server/pendamping.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { UrusanRow } from '@urusin/harness';

function cookieDari(request: Request, nama: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === nama) return v.join('=') || undefined;
  }
  return undefined;
}

/**
 * m6: urusan harus milik peminta, cek yang sama dengan rute urusan lain (`adalahPemilikUrusan`, lihat
 * `urusanMilik`): akun yang sama, atau cookie sesi yang sama untuk urusan tamu. Vault diperiksa terpisah saat
 * mengisi (`pemilikVaultUrusan`). Dipasang di hooks.server lewat `pasangPemeriksaPemilikAkun`, dipakai setiap
 * endpoint pendamping (`akses`). Urusan tanpa catatan pemilik atau milik orang lain → bukan milik (404).
 */
export const pemeriksaPemilikVault: PemeriksaPemilikAkun = async (request, urusan) => {
  const rt = await getRuntime();
  const token = cookieDari(request, AKUN_COOKIE);
  const akun = token ? rt.akun.sesi(token)?.akun : undefined;
  return rt.akun.adalahPemilikUrusan(urusan.id, { akun, sid: sidDariRequest(request) ?? undefined });
};

/**
 * Mode Uji Browser Pendamping untuk urusan ini: true kecuali pemiliknya akun warga biasa (bukan salinan demo juri,
 * bukan tamu) yang sedang masuk. Mode Uji membuka replika di fixtures, tidak pernah portal resmi asli.
 */
export async function modeUjiPendamping(request: Request, urusan: UrusanRow): Promise<boolean> {
  const rt = await getRuntime();
  const token = cookieDari(request, AKUN_COOKIE);
  const akun = token ? rt.akun.sesi(token)?.akun : undefined;
  const pemilik = rt.akun.pemilikVaultUrusan(urusan.id, { akun, sid: sidDariRequest(request) ?? undefined });
  return !(akun && akun.jenis === 'akun' && pemilik === akun.id);
}
