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
 * Peran warga terhadap Browser Pendamping: `akun` = portal resmi asli; `juri` = salinan demo: portal resmi asli
 * dalam mode "lihat saja" (AI hanya menavigasi, tanpa isian), atau simulasi Mode Uji di replika bila diminta
 * (`simulasi`); `tamu` = Mode Uji hanya bila portalnya punya replika, selain itu diajak masuk/daftar dulu
 * (tawaran tanpa replika itu palsu: sesi pasti beralih ke panduan).
 */
/** Pesan untuk tamu yang mencoba membuka portal tanpa situs latihan. */
export const PESAN_PERLU_MASUK =
  'Untuk membuka situs resmi ini bersama AI, masuk atau daftar dulu (gratis, tanpa verifikasi email). Urusan dan rencana Anda ikut pindah ke akun.';

/** Akun/demo yang masuk menurut cookie sesi permintaan ini (undefined = tamu). */
export async function akunDari(request: Request) {
  const rt = await getRuntime();
  const token = cookieDari(request, AKUN_COOKIE);
  return token ? rt.akun.sesi(token)?.akun : undefined;
}

export type PeranPendamping = 'akun' | 'juri' | 'tamu';

export function peranPendamping(akun: { jenis: string } | undefined): PeranPendamping {
  return akun?.jenis === 'akun' ? 'akun' : akun?.jenis === 'demo' ? 'juri' : 'tamu';
}

/**
 * Mode Browser Pendamping untuk urusan ini.
 * - Akun warga biasa pemilik urusan: portal resmi asli (`simulasi` diabaikan).
 * - Akun demo (juri) pemilik urusan: portal resmi asli dalam mode `lihatSaja` (AI hanya menavigasi; data demo
 *   tidak pernah diketik ke sistem pemerintah). `simulasi: true` = Mode Uji di replika dengan data contoh.
 * - Selain itu (tamu, atau urusan milik orang lain): Mode Uji. Mode Uji membuka replika di fixtures, tidak pernah
 *   portal resmi asli.
 */
export async function modePendamping(
  request: Request,
  urusan: UrusanRow,
  opsi: { simulasi?: boolean | undefined } = {},
): Promise<{ modeUji: boolean; lihatSaja: boolean }> {
  const rt = await getRuntime();
  const akun = await akunDari(request);
  const pemilik = rt.akun.pemilikVaultUrusan(urusan.id, { akun, sid: sidDariRequest(request) ?? undefined });
  if (!akun || pemilik !== akun.id) return { modeUji: true, lihatSaja: false };
  if (akun.jenis === 'akun') return { modeUji: false, lihatSaja: false };
  if (akun.jenis === 'demo')
    return opsi.simulasi === true ? { modeUji: true, lihatSaja: false } : { modeUji: false, lihatSaja: true };
  return { modeUji: true, lihatSaja: false };
}

/** Mode Uji (replika) untuk urusan ini; lihat `modePendamping`. */
export async function modeUjiPendamping(
  request: Request,
  urusan: UrusanRow,
  opsi: { simulasi?: boolean | undefined } = {},
): Promise<boolean> {
  return (await modePendamping(request, urusan, opsi)).modeUji;
}
