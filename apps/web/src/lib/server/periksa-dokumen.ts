import { PeriksaDokumenSchema, type PeriksaDokumen } from '@urusin/contracts';
import { DATA_URL_GAMBAR, PANJANG_DATA_URL_MAKS, PERIKSA_BELUM, periksaFoto } from '@urusin/harness';
import type { Runtime } from './runtime.js';

/** Foto yang diperiksa kejelasannya; PDF tidak (tanpa field `periksa`). */
const MIME_FOTO: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Paling lama respons unggahan menunggu hasil periksa; sesudahnya hasil tetap disimpan di latar. */
export const PERIKSA_TUNGGU_MS = 15_000;
/** Batas total satu pemeriksaan di latar (setelah itu dianggap gagal → `belum`). */
const PERIKSA_MAKS_MS = 60_000;

/**
 * Data URL yang dikirim ke model vision: salinan kecil dari klien (`pratinjau`, sisi terpanjang 1280 px) bila sah,
 * selain itu berkas aslinya bila cukup kecil (≤ 2 MB data URL, sama dengan gambar chat). null = terlalu besar.
 */
export function dataUrlPeriksa(mime: string, bytes: Buffer, pratinjau: unknown): string | null {
  if (
    typeof pratinjau === 'string' &&
    pratinjau.length <= PANJANG_DATA_URL_MAKS &&
    DATA_URL_GAMBAR.test(pratinjau)
  )
    return pratinjau;
  if (!MIME_FOTO.has(mime) || bytes.length > (PANJANG_DATA_URL_MAKS * 3) / 4) return null;
  const url = `data:${mime};base64,${bytes.toString('base64')}`;
  return url.length <= PANJANG_DATA_URL_MAKS ? url : null;
}

/**
 * Periksa kejelasan foto yang baru disimpan di brankas dan simpan hasilnya (terenkripsi) di metadata dokumen.
 * `tunggu`: respons menunggu paling lama `tungguMs` (halaman Dokumen menampilkan lencananya langsung); tanpa itu
 * (lampiran chat, yang dibaca lagi oleh agen di giliran yang sama) pemeriksaan berjalan di latar. Fail-open: vision
 * mati, kuota harian habis, gambar terlalu besar, atau galat → `belum` (tanpa klaim). undefined = bukan foto, atau
 * hasil belum ada saat batas tunggu habis.
 */
export async function periksaUnggahan(
  rt: Pick<Runtime, 'deps' | 'store' | 'akun'>,
  pemilik: string,
  docId: string,
  berkas: { mime: string; bytes: Buffer; pratinjau?: unknown },
  opts: { tunggu: boolean; tungguMs?: number },
): Promise<PeriksaDokumen | undefined> {
  if (!MIME_FOTO.has(berkas.mime)) return undefined;
  const simpan = (p: PeriksaDokumen): PeriksaDokumen => {
    try {
      rt.akun.vault.setPeriksa(pemilik, docId, p);
    } catch (e) {
      console.warn(`periksa dokumen: gagal menyimpan hasil (${(e as Error).name})`);
    }
    return p;
  };
  const url = dataUrlPeriksa(berkas.mime, berkas.bytes, berkas.pratinjau);
  const model = rt.deps.visionModel;
  const batas = rt.deps.quota.config.dailyIdrCap;
  if (!url || !model || (batas > 0 && rt.store.dailyCostIdr() >= batas)) return simpan(PERIKSA_BELUM);

  const kerja = periksaFoto({
    provider: rt.deps.provider,
    model,
    gambar: url,
    signal: AbortSignal.timeout(PERIKSA_MAKS_MS),
  })
    .then(({ usage, ...hasil }) => {
      // Biaya ikut batas harian (tanpa urusan: baris urusan tidak ada, hanya daily_usage yang bertambah).
      for (const u of usage)
        rt.store.addUsage('periksa-dokumen', {
          tokensIn: u.prompt_tokens,
          tokensOut: u.completion_tokens,
          costIdr: rt.deps.quota.costIdr(u),
          degraded: false,
        });
      const sah = PeriksaDokumenSchema.safeParse(hasil);
      return simpan(sah.success ? sah.data : PERIKSA_BELUM);
    })
    .catch(() => simpan(PERIKSA_BELUM));
  if (!opts.tunggu) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const habis = new Promise<undefined>((r) => {
    timer = setTimeout(() => r(undefined), opts.tungguMs ?? PERIKSA_TUNGGU_MS);
  });
  try {
    return await Promise.race([kerja, habis]);
  } finally {
    clearTimeout(timer);
  }
}
