export type IconName = 'kelahiran' | 'kematian' | 'perkawinan' | 'pindah' | 'lainnya';

export type Peristiwa = {
  slug: string;
  judul: string;
  ringkas: string;
  icon: IconName;
};

/** Empat Peristiwa Hidup utama + pintu masuk urusan lain (rencana §3.12). */
export const PERISTIWA: readonly Peristiwa[] = [
  {
    slug: 'kelahiran',
    judul: 'Kelahiran',
    ringkas: 'Akta kelahiran, KK baru, dan KIA untuk anak.',
    icon: 'kelahiran',
  },
  {
    slug: 'kematian',
    judul: 'Kematian',
    ringkas: 'Akta kematian dan pembaruan Kartu Keluarga.',
    icon: 'kematian',
  },
  {
    slug: 'perkawinan',
    judul: 'Perkawinan',
    ringkas: 'Pencatatan perkawinan, KK baru, dan status di KTP.',
    icon: 'perkawinan',
  },
  {
    slug: 'pindah',
    judul: 'Pindah',
    ringkas: 'Surat pindah, lalu KK dan KTP di alamat baru.',
    icon: 'pindah',
  },
];

export const URUSAN_LAIN: Peristiwa = {
  slug: 'lainnya',
  judul: 'Urusan lain',
  ringkas: 'Pengaduan, pajak kendaraan, cek DPT, cek bansos, dan lainnya.',
  icon: 'lainnya',
};

export function findPeristiwa(slug: string): Peristiwa | undefined {
  return [...PERISTIWA, URUSAN_LAIN].find((p) => p.slug === slug);
}
