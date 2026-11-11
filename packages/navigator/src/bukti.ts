import { createHash } from 'node:crypto';
import { PendampingBuktiSchema, type PendampingBukti, type Pengamatan } from '@urusin/contracts';
import { redactForStorage } from '@urusin/harness';
import { kanonik } from './validasi.js';

/**
 * Bukti dan resi Navigator. Bukti diambil DETERMINISTIK dari halaman sukses (pola nomor registrasi), bukan
 * dari model; teks halaman tetap tidak tepercaya, jadi hasilnya divalidasi skema kontrak dan nomor yang
 * menyerupai NIK/nomor HP dibuang. Resi = ringkasan eksekusi tanpa nilai, di-hash untuk rantai audit.
 */

const POLA_NOMOR =
  /\b(?:nomor|no\.?)\s*(?:registrasi|pendaftaran|permohonan|pengajuan|antrian|antrean|tiket|resi|berkas)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9./_-]{2,40})/i;

/** Bukti dari pengamatan halaman sukses; undefined bila halaman bukan sukses atau tidak ada nomor yang sah. */
export function buktiDariPengamatan(p: Pengamatan): PendampingBukti | undefined {
  if (!p.sinyal.sukses) return undefined;
  const m = POLA_NOMOR.exec(p.teks);
  const nomor = m?.[1]?.replace(/[./_-]+$/, '');
  // Nomor yang diubah redaksi (NIK, HP, email) bukan nomor registrasi: dibuang.
  const aman = nomor && redactForStorage(nomor) === nomor && !/\d{16,}/.test(nomor) ? nomor : undefined;
  const bukti = PendampingBuktiSchema.safeParse({
    ...(aman ? { nomor: aman } : {}),
    status: 'Pengajuan diterima situs',
  });
  return bukti.success ? bukti.data : undefined;
}

export type Resi = {
  v: 1;
  executionId: string;
  host: string;
  selesaiPada: string;
  akhir: string;
  halaman: number;
  aksi: number;
  panggilanLlm: number;
  /** rencanaHash yang dijalankan, berurutan. */
  rencana: string[];
  bukti?: PendampingBukti | undefined;
  /** sha256 atas resi kanonik tanpa field ini. */
  hash: string;
};

export function buatResi(r: Omit<Resi, 'v' | 'hash'>): Resi {
  const isi = { v: 1 as const, ...r };
  return { ...isi, hash: createHash('sha256').update(kanonik(isi)).digest('hex') };
}

/** Kalimat bukti untuk warga (templat). */
export function ringkasBukti(bukti: PendampingBukti | undefined): string {
  if (bukti?.nomor)
    return `Situs resmi menampilkan nomor ${bukti.nomor}. Simpan nomor ini untuk melacak pengajuan Anda.`;
  return 'Situs resmi menampilkan halaman berhasil, tetapi tanpa nomor yang bisa dibaca. Simpan tangkapan layar halaman itu.';
}
