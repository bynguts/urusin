import type { NamaIkon } from '../ikon.js';

export type ItemNav = {
  href: '/beranda' | '/urusanku' | '/dokumen' | '/bantuan' | '/pengaturan';
  label: string;
  ikon: NamaIkon;
};

/** Menu samping (App 01–14, Rafi): lima menu. Riwayat bantuan (/jejak) dibuka dari halaman urusan. */
export const NAV: readonly ItemNav[] = [
  { href: '/beranda', label: 'Beranda', ikon: 'beranda' },
  { href: '/urusanku', label: 'Urusanku', ikon: 'urusanku' },
  { href: '/dokumen', label: 'Dokumen', ikon: 'dokumen' },
  { href: '/bantuan', label: 'Bantuan', ikon: 'bantuan' },
  { href: '/pengaturan', label: 'Pengaturan', ikon: 'pengaturan' },
];

/** Navigasi bawah HP: empat menu, Bantuan selalu di ujung kanan (WCAG 3.2.6). */
export const NAV_HP: readonly ItemNav[] = NAV.slice(0, 4);

/** Halaman tanpa kerangka aplikasi (App 15–20: panel brand + formulir). Landing `/` juga polos. */
export const RUTE_AUTH = [
  '/masuk',
  '/daftar',
  '/verifikasi-email',
  '/lupa-sandi',
  '/atur-ulang-sandi',
  '/lengkapi-profil',
] as const;

export function rutAuth(pathname: string): boolean {
  return RUTE_AUTH.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Menu aktif: Beranda juga untuk halaman peristiwa; Dokumen juga untuk Data diri. Halaman satu urusan
 * (/urusan, /jejak) tidak menyalakan menu: urusannya yang disorot di daftar "Urusan aktif" (App 02–09).
 */
export function menuAktif(href: ItemNav['href'], pathname: string): boolean {
  if (href === '/beranda') return pathname === '/beranda' || pathname.startsWith('/peristiwa/');
  if (href === '/dokumen') return pathname === href || pathname === '/data-diri';
  return pathname === href || pathname.startsWith(`${href}/`);
}
