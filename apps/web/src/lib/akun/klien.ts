import type { DataDiriRingkas } from '#lib/pendamping/isi-data.js';

/**
 * Klien brankas (Data Diri + Dokumen) di `/api/vault` (docs/ui/auth.md). Tamu juga punya brankas di
 * perangkat ini; akun sinkron antar perangkat. Tipe salinan struktural `@urusin/contracts`.
 */
export type JenisDokumen = 'ktp' | 'kk' | 'akta' | 'surat' | 'foto' | 'lainnya';
export type DokumenAkun = {
  id: string;
  jenis: JenisDokumen;
  judul: string;
  mime: string;
  ukuran: number;
  disimpanPada: string;
  bacaSaja?: boolean;
};
export type DataDiri = DataDiriRingkas & { kodeKabKota?: string; statusPerkawinan?: string };

export const MIME_DOKUMEN = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const UKURAN_DOKUMEN_MAKS = 9 * 1024 * 1024;

export const LABEL_JENIS: Record<JenisDokumen, string> = {
  ktp: 'KTP',
  kk: 'Kartu Keluarga',
  akta: 'Akta',
  surat: 'Surat keterangan',
  foto: 'Pas foto',
  lainnya: 'Lainnya',
};

/**
 * Hasil panggilan brankas: `perlu-masuk` (401), `masuk-ulang` (401 PERLU_MASUK_ULANG: perangkat baru, login
 * > 15 menit), `belum-tersedia` (404 sebelum merge), atau galat warga.
 */
export type AlasanBrankas = 'perlu-masuk' | 'masuk-ulang' | 'belum-tersedia' | 'galat';
export type Hasil<T> = { ok: true; data: T } | { ok: false; alasan: AlasanBrankas; pesan: string };

async function panggil<T>(input: string, init?: RequestInit): Promise<Hasil<T>> {
  let r: Response;
  try {
    r = await fetch(input, { ...init, headers: { accept: 'application/json', ...init?.headers } });
  } catch {
    return { ok: false, alasan: 'galat', pesan: 'Koneksi terputus. Periksa internet, lalu coba lagi.' };
  }
  if (r.status === 401) {
    const j = (await r.json().catch(() => null)) as { kode?: string } | null;
    if (j?.kode === 'PERLU_MASUK_ULANG')
      return {
        ok: false,
        alasan: 'masuk-ulang',
        pesan: 'Masuk sekali lagi untuk membuka brankas di perangkat ini.',
      };
    return { ok: false, alasan: 'perlu-masuk', pesan: 'Masuk dulu untuk membuka brankas Anda.' };
  }
  if (r.status === 404)
    return { ok: false, alasan: 'belum-tersedia', pesan: 'Brankas belum tersedia di server ini.' };
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { pesanWarga?: string } | null;
    return {
      ok: false,
      alasan: 'galat',
      pesan: j?.pesanWarga ?? 'Permintaan gagal. Coba lagi sebentar lagi.',
    };
  }
  return { ok: true, data: (await r.json()) as T };
}

/**
 * Unduh berkas dokumen. Perangkat baru tanpa bukti kredensial ≤ 15 menit → 401 PERLU_MASUK_ULANG:
 * `lanjut` = `/dokumen?unduh=<id>`; UI membuka `/masuk?ulang=1&lanjut=<lanjut>` lalu unduhan dilanjutkan.
 */
export async function unduhDokumen(
  id: string,
): Promise<{ ok: true; blob: Blob } | { ok: false; lanjut?: string; pesan: string }> {
  let r: Response;
  try {
    r = await fetch(`/api/vault/${encodeURIComponent(id)}`);
  } catch {
    return { ok: false, pesan: 'Koneksi terputus. Periksa internet, lalu coba lagi.' };
  }
  if (r.ok) return { ok: true, blob: await r.blob() };
  const j = (await r.json().catch(() => null)) as { kode?: string; pesanWarga?: string } | null;
  if (r.status === 401 && j?.kode === 'PERLU_MASUK_ULANG')
    return { ok: false, lanjut: `/dokumen?unduh=${encodeURIComponent(id)}`, pesan: '' };
  return { ok: false, pesan: j?.pesanWarga ?? 'Dokumen tidak bisa dibuka. Coba lagi sebentar lagi.' };
}

export const ambilDataDiri = () =>
  panggil<{ dataDiri: DataDiri; diubahPada: string | null }>('/api/vault/data-diri');

export const simpanDataDiri = (data: DataDiri) =>
  panggil<{ dataDiri: DataDiri; diubahPada: string }>('/api/vault/data-diri', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

export const daftarDokumen = () => panggil<{ dokumen: DokumenAkun[] }>('/api/vault');

export function unggahDokumen(berkas: File, jenis: JenisDokumen, judul: string) {
  const f = new FormData();
  f.set('berkas', berkas);
  f.set('jenis', jenis);
  f.set('judul', judul);
  return panggil<DokumenAkun>('/api/vault', { method: 'POST', body: f });
}

export const hapusDokumen = (id: string) =>
  panggil<{ terhapus: true }>(`/api/vault/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Periksa berkas sebelum diunggah (pesan sama dengan server). null = boleh. */
export function periksaBerkas(f: File): string | null {
  if (f.size > UKURAN_DOKUMEN_MAKS) return 'Berkas terlalu besar. Maksimal 9 MB.';
  if (!(MIME_DOKUMEN as readonly string[]).includes(f.type)) return 'Gunakan foto (JPG, PNG, WebP) atau PDF.';
  return null;
}

/** "1,2 MB" / "350 KB". */
export function ukuranBerkas(b: number): string {
  if (b >= 1024 * 1024)
    return `${(b / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** NIK/KK disamarkan: 4 digit awal + 4 digit akhir. */
export function samarkan(n: string | undefined): string {
  if (!n) return '';
  return n.length < 8 ? '••••' : `${n.slice(0, 4)} •••• •••• ${n.slice(-4)}`;
}
