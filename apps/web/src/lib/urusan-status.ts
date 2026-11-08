import type { UrusanState } from '#lib/contracts.js';

export type NadaStatus = 'anda' | 'ai' | 'instansi' | 'selesai' | 'netral';

export type InfoStatus = {
  /** Kalimat pendek untuk warga: siapa yang ditunggu / apa yang terjadi. */
  label: string;
  nada: NadaStatus;
  /** Langkah 0–5 dari rencana lima langkah (0 = rencana belum disetujui). */
  langkah: number;
  /** Teks tombol utama di kartu urusan. */
  aksi: string;
  /** Kelompok filter Urusanku. */
  kelompok: 'anda' | 'instansi' | 'selesai' | 'lainnya';
};

/** Lima langkah rencana di panel kanan (App 03–09). */
export const LANGKAH_RENCANA = [
  { judul: 'Siapkan dokumen', pelaku: 'Anda' },
  { judul: 'Masuk akun di situs resmi', pelaku: 'Anda' },
  { judul: 'AI mengisi formulir', pelaku: 'AI' },
  { judul: 'Periksa lalu tekan Kirim', pelaku: 'Anda' },
  { judul: 'Verifikasi dan ambil dokumen', pelaku: 'Instansi' },
] as const;

const PETA: Record<UrusanState, InfoStatus> = {
  BARU: { label: 'AI menyusun rencana', nada: 'ai', langkah: 0, aksi: 'Buka', kelompok: 'lainnya' },
  MEMAHAMI: { label: 'AI menyusun rencana', nada: 'ai', langkah: 0, aksi: 'Buka', kelompok: 'lainnya' },
  RENCANA_DIUSULKAN: {
    label: 'Menunggu Anda',
    nada: 'anda',
    langkah: 0,
    aksi: 'Tinjau rencana',
    kelompok: 'anda',
  },
  RENCANA_DISETUJUI: {
    label: 'Menunggu Anda',
    nada: 'anda',
    langkah: 1,
    aksi: 'Siapkan dokumen',
    kelompok: 'anda',
  },
  MENYIAPKAN_BERKAS: {
    label: 'Menunggu Anda',
    nada: 'anda',
    langkah: 1,
    aksi: 'Siapkan dokumen',
    kelompok: 'anda',
  },
  BERKAS_SIAP: { label: 'Menunggu Anda', nada: 'anda', langkah: 2, aksi: 'Lanjutkan', kelompok: 'anda' },
  MENUNGGU_LOGIN_WARGA: {
    label: 'Menunggu Anda',
    nada: 'anda',
    langkah: 2,
    aksi: 'Masuk akun',
    kelompok: 'anda',
  },
  MENUNGGU_PROFIL_WARGA: {
    label: 'Menunggu Anda',
    nada: 'anda',
    langkah: 2,
    aksi: 'Lengkapi data',
    kelompok: 'anda',
  },
  MENUNGGU_KONFIRMASI: {
    label: 'Menunggu persetujuan Anda',
    nada: 'anda',
    langkah: 2,
    aksi: 'Periksa dan setujui',
    kelompok: 'anda',
  },
  MENGISI: { label: 'AI sedang mengisi', nada: 'ai', langkah: 3, aksi: 'Tonton', kelompok: 'lainnya' },
  MENGUNGGAH: { label: 'AI sedang mengisi', nada: 'ai', langkah: 3, aksi: 'Tonton', kelompok: 'lainnya' },
  MENUNGGU_SUBMIT_WARGA: {
    label: 'Giliran Anda: tekan Kirim',
    nada: 'anda',
    langkah: 4,
    aksi: 'Periksa dan kirim',
    kelompok: 'anda',
  },
  TERKIRIM: {
    label: 'Menunggu instansi',
    nada: 'instansi',
    langkah: 5,
    aksi: 'Lacak status',
    kelompok: 'instansi',
  },
  DIPANTAU: {
    label: 'Menunggu instansi',
    nada: 'instansi',
    langkah: 5,
    aksi: 'Lacak status',
    kelompok: 'instansi',
  },
  SELESAI: { label: 'Selesai', nada: 'selesai', langkah: 6, aksi: 'Lihat', kelompok: 'selesai' },
  DITOLAK: {
    label: 'Ditolak instansi',
    nada: 'anda',
    langkah: 5,
    aksi: 'Lihat alasan',
    kelompok: 'anda',
  },
  DIBATALKAN: { label: 'Dibatalkan', nada: 'netral', langkah: 0, aksi: 'Lihat', kelompok: 'selesai' },
  DIPANDU: {
    label: 'Ikuti panduan langkah demi langkah',
    nada: 'anda',
    langkah: 2,
    aksi: 'Buka panduan',
    kelompok: 'anda',
  },
  GAGAL_AMAN: {
    label: 'Berhenti dengan aman',
    nada: 'netral',
    langkah: 0,
    aksi: 'Lihat',
    kelompok: 'lainnya',
  },
};

export function infoStatus(state: UrusanState | null | undefined): InfoStatus {
  return state ? PETA[state] : PETA.BARU;
}

/** Empat fase perjalanan urusan di Ringkasan (frame uCOBS: "Langkah 2 dari 4 · Siapkan dokumen"). */
export const FASE = [
  { judul: 'Kenali kebutuhan', ket: 'Ceritakan kebutuhan Anda, lalu kita tentukan layanan yang sesuai.' },
  {
    judul: 'Siapkan dokumen',
    ket: 'Sesudah foto jelas, kita cocokkan kebutuhan dokumen dengan rujukan layanan.',
  },
  { judul: 'Lanjut ke situs resmi', ket: 'Tinjau langkah di situs resmi sebelum memberi izin.' },
  { judul: 'Pantau hasil', ket: 'Kita pantau tanggapan instansi sampai urusan selesai.' },
] as const;

/** Nomor fase 1–4 dari state urusan. */
export function faseUrusan(state: UrusanState | null | undefined): 1 | 2 | 3 | 4 {
  switch (state) {
    case 'RENCANA_DISETUJUI':
    case 'MENYIAPKAN_BERKAS':
      return 2;
    case 'BERKAS_SIAP':
    case 'MENUNGGU_LOGIN_WARGA':
    case 'MENUNGGU_PROFIL_WARGA':
    case 'MENGISI':
    case 'MENUNGGU_KONFIRMASI':
    case 'MENGUNGGAH':
    case 'MENUNGGU_SUBMIT_WARGA':
    case 'DIPANDU':
      return 3;
    case 'TERKIRIM':
    case 'DIPANTAU':
    case 'SELESAI':
    case 'DITOLAK':
      return 4;
    default:
      return 1;
  }
}

/** Waktu singkat Indonesia: "5 Nov, 19.20". */
export function waktuSingkat(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tgl = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(d);
  const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${tgl}, ${jam}`;
}

/** Tanggal: "3 Nov 2026". */
export function tanggal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** Nama domain tanpa "www." untuk chip sumber. */
export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Nama state untuk warga (layar Jejak). */
export const LABEL_STATE: Record<UrusanState, string> = {
  BARU: 'Baru',
  MEMAHAMI: 'Memahami kebutuhan',
  RENCANA_DIUSULKAN: 'Rencana diusulkan',
  RENCANA_DISETUJUI: 'Rencana disetujui',
  MENYIAPKAN_BERKAS: 'Menyiapkan berkas',
  BERKAS_SIAP: 'Berkas siap',
  MENUNGGU_LOGIN_WARGA: 'Menunggu Anda masuk akun',
  MENUNGGU_PROFIL_WARGA: 'Menunggu data diri',
  MENGISI: 'AI mengisi formulir',
  MENUNGGU_KONFIRMASI: 'Menunggu persetujuan Anda',
  MENGUNGGAH: 'AI mengunggah berkas',
  MENUNGGU_SUBMIT_WARGA: 'Menunggu Anda menekan Kirim',
  TERKIRIM: 'Terkirim',
  DIPANTAU: 'Dipantau',
  SELESAI: 'Selesai',
  DITOLAK: 'Ditolak',
  DIBATALKAN: 'Dibatalkan',
  DIPANDU: 'Mode dipandu',
  GAGAL_AMAN: 'Berhenti dengan aman',
};
