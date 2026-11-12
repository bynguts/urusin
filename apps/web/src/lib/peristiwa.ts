import roseMelambai from '#lib/assets/img/rose-melambai.webp';
import greenMembaca from '#lib/assets/img/green-membaca.webp';
import purpleMelambai from '#lib/assets/img/purple-melambai.webp';
import blueMelambai from '#lib/assets/img/blue-melambai.webp';
import avatarRose from '#lib/assets/img/avatar-rose.webp';
import avatarGreen from '#lib/assets/img/avatar-green.webp';
import avatarPurple from '#lib/assets/img/avatar-purple.webp';
import avatarBlue from '#lib/assets/img/avatar-blue.webp';
import avatarAmber from '#lib/assets/img/avatar-amber.webp';

export type IconName = 'kelahiran' | 'kematian' | 'perkawinan' | 'pindah' | 'lainnya';

/** Warna pendamping (DESIGN.md: satu warna per pendamping, jangan dicampur). */
export type Warna = 'mawar' | 'daun' | 'ungu' | 'biru' | 'kuning';

export type Peristiwa = {
  slug: 'kelahiran' | 'kematian' | 'perkawinan' | 'pindah' | 'lainnya';
  judul: string;
  /** Label lencana di header urusan, mis. "Kelahiran". */
  lencana: string;
  ringkas: string;
  icon: IconName;
  warna: Warna;
  /** Karakter pendamping (pose melambai/membaca) untuk kartu Beranda. */
  gambar: string;
  avatar: string;
};

/** Empat Peristiwa Hidup utama (App 01 Beranda) + pintu masuk urusan lain. */
export const PERISTIWA: readonly Peristiwa[] = [
  {
    slug: 'kelahiran',
    judul: 'Kelahiran',
    lencana: 'Kelahiran',
    ringkas: 'Akta dan KK baru untuk anak',
    icon: 'kelahiran',
    warna: 'mawar',
    gambar: roseMelambai,
    avatar: avatarRose,
  },
  {
    slug: 'kematian',
    judul: 'Kematian',
    lencana: 'Kehilangan keluarga',
    ringkas: 'Akta kematian dan ubah KK',
    icon: 'kematian',
    warna: 'daun',
    gambar: greenMembaca,
    avatar: avatarGreen,
  },
  {
    slug: 'perkawinan',
    judul: 'Perkawinan',
    lencana: 'Menikah',
    ringkas: 'Pencatatan nikah dan KK baru',
    icon: 'perkawinan',
    warna: 'ungu',
    gambar: purpleMelambai,
    avatar: avatarPurple,
  },
  {
    slug: 'pindah',
    judul: 'Pindah domisili',
    lencana: 'Pindah rumah',
    ringkas: 'Surat pindah dan alamat baru',
    icon: 'pindah',
    warna: 'biru',
    gambar: blueMelambai,
    avatar: avatarBlue,
  },
];

export const URUSAN_LAIN: Peristiwa = {
  slug: 'lainnya',
  judul: 'Urusan lain',
  lencana: 'KTP & dokumen',
  ringkas: 'KTP, KK, pengaduan, pajak kendaraan, dan lainnya',
  icon: 'lainnya',
  warna: 'kuning',
  gambar: blueMelambai,
  avatar: avatarAmber,
};

export function findPeristiwa(slug: string): Peristiwa | undefined {
  return [...PERISTIWA, URUSAN_LAIN].find((p) => p.slug === slug);
}

const JUDUL_JENIS: Record<string, string> = {
  kelahiran: 'Akta kelahiran',
  kematian: 'Akta kematian',
  perkawinan: 'Pencatatan perkawinan',
  pindah: 'Pindah domisili',
  ktp: 'KTP elektronik',
  kk: 'Kartu Keluarga',
  kia: 'Kartu Identitas Anak',
  akta: 'Akta',
  skck: 'SKCK',
  pajak_kendaraan: 'Pajak kendaraan',
  cek_dpt: 'Cek daftar pemilih',
  bansos: 'Bantuan sosial',
  pengaduan: 'Pengaduan',
};

/** Judul urusan dari jenis hasil klasifikasi harness; null bila belum diketahui. */
export function judulUrusan(jenis: string | null | undefined): string | null {
  return (jenis && JUDUL_JENIS[jenis]) || null;
}

/**
 * Peristiwa untuk lencana/avatar dari jenis urusan. Empat Peristiwa Hidup memakai lencananya sendiri; jenis lain
 * (ktp, kk, skck, ...) memakai tampilan "Urusan lain" dengan label jenisnya. "KTP & dokumen" hanya bila jenisnya
 * belum diketahui.
 */
export function peristiwaDariJenis(jenis: string | null | undefined): Peristiwa {
  if (!jenis) return URUSAN_LAIN;
  const p = findPeristiwa(jenis);
  if (p) return p;
  const label = judulUrusan(jenis) ?? labelSlug(jenis);
  return label ? { ...URUSAN_LAIN, lencana: label } : URUSAN_LAIN;
}

/** `pajak_kendaraan` → "Pajak kendaraan" untuk jenis yang belum punya judul; teks polos pendek. */
function labelSlug(jenis: string): string | null {
  const t = jenis
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 30);
  return t ? t[0]!.toUpperCase() + t.slice(1) : null;
}

/** Kelas latar + tinta lencana per warna pendamping. */
export const KELAS_WARNA: Record<Warna, string> = {
  mawar: 'bg-mawar text-mawar-ink',
  daun: 'bg-daun text-daun-ink',
  ungu: 'bg-ungu text-ungu-ink',
  biru: 'bg-biru text-biru-ink',
  kuning: 'bg-kuning text-kuning-ink',
};
