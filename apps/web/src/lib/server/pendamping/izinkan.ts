import type { IzinkanIsiResponse, PemilikSesiInternal } from '@urusin/contracts';
import { daftarWrite, labelPlaceholder, petakanIsian } from '#lib/pendamping/isi-data.js';
import { apiError } from '#lib/server/http.js';
import { panggilPemilik, skema, type PendampingConfig } from '#lib/server/pendamping.js';

/**
 * "Izinkan isi" lewat server (A-M1). Peramban hanya mengirim hash daftar write yang ditampilkan ke warga; nilai
 * Data Diri dan Dokumen diselesaikan di server oleh jalur isi vault (feat/auth-akun: `izinkanIsiUrusan` lalu
 * `nilaiIsiUrusan`, token sekali pakai terikat pemilik, hash daftar write, dan origin tujuan), lalu dikirim ke
 * sesi lewat kanal internal bertanda tangan, hanya ke worker pemegang sesi. Nilai tidak pernah kembali ke
 * peramban, ke model, atau ke log; jawaban hanya berisi label yang harus warga isi sendiri.
 */

/** Peminta = pemilik urusan dari request (cookie sesi; akun ditambahkan saat jalur vault terpasang). */
export type Peminta = { sid: string };

/** Antarmuka jalur isi vault; dipasang saat feat/auth-akun digabung (jalur isi `pendamping/isi.ts`). */
export type JalurIsiPendamping = {
  /** `izinkanIsiUrusan`: cek pemilik + hash daftar write -> token persetujuan (tetap di server). */
  izinkan(p: {
    urusanId: string;
    peminta: Peminta;
    writeListHash: string;
    writeList: readonly string[];
    targetOrigin: string;
  }): string;
  /** `nilaiIsiUrusan`: pakai token (sekali) -> nilai hanya untuk field di daftar write. */
  nilai(p: {
    urusanId: string;
    peminta: Peminta;
    token: string;
    writeList: readonly string[];
    targetOrigin: string;
  }): Record<string, string>;
  /** Dokumen akun untuk nama berkas adapter; hanya dipanggil SETELAH token persetujuan berhasil dipakai. */
  berkas?(p: {
    urusanId: string;
    peminta: Peminta;
    nama: readonly string[];
  }): { nama: string; namaBerkas: string; mime: string; bytes: Uint8Array }[];
};

let jalur: JalurIsiPendamping | undefined;

export function pasangJalurIsi(j: JalurIsiPendamping | undefined): void {
  jalur = j;
}

const TIDAK_TERSEDIA = () =>
  apiError(
    503,
    'ISI_OTOMATIS_TIDAK_TERSEDIA',
    'Isi otomatis dari Data Diri belum tersedia. Isi sendiri di layar.',
  );
const IZIN_TIDAK_VALID = () =>
  apiError(
    403,
    'IZIN_TIDAK_VALID',
    'Persetujuan tidak cocok dengan data yang diminta. Tutup lembar ini lalu coba lagi.',
  );

/** Galat yang memang dilempar jalur vault (kode `AkunError`), bukan bug. */
const galatIzin = (e: unknown): boolean =>
  e instanceof Error && typeof (e as { kode?: unknown }).kode === 'string';

export async function izinkanIsiSesi(
  cfg: PendampingConfig | null,
  p: { owner: PemilikSesiInternal; peminta: Peminta; writeListHash: string },
): Promise<{ ok: true; data: IzinkanIsiResponse } | { ok: false; response: Response }> {
  const j = jalur;
  if (!j) return { ok: false, response: TIDAK_TERSEDIA() };
  const b = await panggilPemilik(cfg, '/internal/sesi/butuh', skema.butuh, p.owner);
  if (!b.ok) return b;
  const { placeholder, berkas, origin } = b.data;
  const writeList = daftarWrite(placeholder, berkas);
  // Tidak ada yang bisa diambil dari Data Diri/Dokumen (mis. nomor polisi): tanpa token, warga isi sendiri.
  if (writeList.length === 0)
    return {
      ok: true,
      data: { kurang: { placeholder: [...new Set(placeholder.map(labelPlaceholder))], berkas } },
    };
  const dasar = { urusanId: p.owner.urusanId, peminta: p.peminta, writeList, targetOrigin: origin };
  let nilai: Record<string, string>;
  let dokumen: ReturnType<NonNullable<JalurIsiPendamping['berkas']>> = [];
  try {
    const token = j.izinkan({ ...dasar, writeListHash: p.writeListHash });
    nilai = j.nilai({ ...dasar, token });
    if (berkas.length > 0 && j.berkas)
      dokumen = j.berkas({ urusanId: p.owner.urusanId, peminta: p.peminta, nama: berkas });
  } catch (e) {
    if (galatIzin(e)) return { ok: false, response: IZIN_TIDAK_VALID() };
    throw e;
  }
  const { isian } = petakanIsian(placeholder, nilai);
  const r = await panggilPemilik(cfg, '/internal/sesi/isi', skema.kurang, { ...p.owner, isian });
  if (!r.ok) return r;
  let kurang = r.data;
  for (const d of dokumen) {
    if (!berkas.includes(d.nama)) continue;
    const rb = await panggilPemilik(cfg, '/internal/sesi/berkas', skema.kurang, {
      ...p.owner,
      nama: d.nama,
      namaBerkas: d.namaBerkas,
      mime: d.mime,
      dataBase64: Buffer.from(d.bytes).toString('base64'),
    });
    if (!rb.ok) return rb;
    kurang = rb.data;
  }
  return {
    ok: true,
    data: {
      kurang: {
        placeholder: [...new Set(kurang.placeholder.map(labelPlaceholder))],
        berkas: kurang.berkas,
      },
    },
  };
}
