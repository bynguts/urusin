import { AkunError } from '@urusin/akun';
import type { PemilikSesiInternal } from '@urusin/contracts';
import { labelPlaceholder } from '#lib/pendamping/isi-data.js';
import { apiError } from '#lib/server/http.js';
import { panggilPemilik, skema, type PendampingConfig } from '#lib/server/pendamping.js';
import { ambilIsianUntukIsi } from '#lib/server/pendamping/isi.js';
import { catatPersetujuanNavigator } from '#lib/server/pendamping/navigator.js';
import type { Runtime } from '#lib/server/runtime.js';

/**
 * Controller isi Pendamping (A-M1), dipanggil POST /api/urusan/[id]/izinkan-isi SETELAH persetujuan tersimpan
 * (`izinkanIsiUrusan`). Urutannya:
 * 1. Tanya worker pemegang sesi (kanal internal bertanda HMAC, body hanya pemilik) apa yang masih dibutuhkan
 *    dan origin yang benar-benar diisi sesi (`/internal/sesi/butuh`).
 * 2. `ambilIsianUntukIsi(rt, {urusanId, liveOrigin})`: origin itu harus persis `targetOrigin` persetujuan
 *    (portal registry `kirim-asli` atau situs latihan); token dipakai sekali.
 * 3. Berkas lalu nilai dikirim HANYA ke worker pemegang sesi (`/internal/sesi/berkas`, lalu `/internal/sesi/isi`
 *    sebagai panggilan TERAKHIR: worker memulai AI di situ), disaring ke placeholder/berkas yang memang
 *    dibutuhkan sesi. Tidak pernah ke peramban, model, atau log. Putaran yang sama dipakai ulang untuk satu
 *    berkas saat langkah unggah menunggu (`berkas_kurang`).
 * Jawaban hanya label yang masih harus warga isi sendiri.
 */
export async function isiSesiDariVault(
  rt: Runtime,
  cfg: PendampingConfig | null,
  owner: PemilikSesiInternal,
): Promise<{ ok: true; kurang: string[] } | { ok: false; response: Response }> {
  const b = await panggilPemilik(cfg, '/internal/sesi/butuh', skema.butuh, owner);
  if (!b.ok) return b;
  let ambil: ReturnType<typeof ambilIsianUntukIsi>;
  try {
    ambil = ambilIsianUntukIsi(rt, {
      urusanId: owner.urusanId,
      liveOrigin: b.data.origin,
      rencanaHash: b.data.rencanaHash,
    });
  } catch (e) {
    if (!(e instanceof AkunError)) throw e;
    return {
      ok: false,
      response: apiError(
        403,
        'IZIN_TIDAK_VALID',
        'Persetujuan tidak cocok dengan situs yang sedang dibuka. Tutup lembar ini lalu coba lagi.',
      ),
    };
  }
  const butuh = new Set(b.data.placeholder);
  const isian = Object.fromEntries(Object.entries(ambil.isian).filter(([k]) => butuh.has(k)));
  const berkasTerkirim: string[] = [];
  for (const d of ambil.berkas) {
    // Daftar write memakai `berkas:<JENIS>` huruf besar; nama adapter (`{{FILE:foto}}`) bisa huruf kecil.
    const nama = b.data.berkas.find((n) => n.toUpperCase() === d.nama.toUpperCase());
    if (!nama) continue;
    const rb = await panggilPemilik(cfg, '/internal/sesi/berkas', skema.kurang, {
      ...owner,
      nama,
      namaBerkas: d.judul.slice(0, 200) || d.nama,
      mime: d.mime,
      dataBase64: d.bytes.toString('base64'),
    });
    if (!rb.ok) return rb;
    berkasTerkirim.push(nama);
  }
  const rencanaHash = b.data.rencanaHash;
  // Navigator generik: baris yang benar-benar disetujui dicatat SEBELUM worker melanjutkan AI (isi = panggilan
  // terakhir), supaya loop tahu baris mana yang ditolak warga dan tidak memintanya lagi.
  if (rencanaHash)
    catatPersetujuanNavigator(owner.urusanId, rencanaHash, {
      placeholder: Object.keys(isian),
      berkas: berkasTerkirim,
    });
  // Navigator generik: berkas yang disetujui di putaran INI ikut (worker tidak lagi menganggap berkas putaran
  // lalu sudah disetujui).
  const r = await panggilPemilik(cfg, '/internal/sesi/isi', skema.kurang, {
    ...owner,
    isian,
    ...(rencanaHash ? { rencanaHash, berkas: berkasTerkirim } : {}),
  });
  if (!r.ok) return r;
  const kurang = r.data;
  return {
    ok: true,
    kurang: [...new Set(kurang.placeholder.map(labelPlaceholder)), ...kurang.berkas],
  };
}
