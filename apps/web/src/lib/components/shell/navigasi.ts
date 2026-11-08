import type { NamaIkon } from '../ikon.js';

export type ItemNav = {
  href: '/beranda' | '/urusanku' | '/dokumen' | '/bantuan' | '/pengaturan';
  label: string;
  ikon: NamaIkon;
};

/** Menu utama App/Sidebar; sama di nav bawah HP supaya "Bantuan" selalu di tempat yang sama (WCAG 3.2.6). */
export const NAV: readonly ItemNav[] = [
  { href: '/beranda', label: 'Beranda', ikon: 'beranda' },
  { href: '/urusanku', label: 'Urusanku', ikon: 'urusanku' },
  { href: '/dokumen', label: 'Dokumen', ikon: 'dokumen' },
  { href: '/bantuan', label: 'Bantuan', ikon: 'bantuan' },
  { href: '/pengaturan', label: 'Pengaturan', ikon: 'pengaturan' },
];

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

/** Menu aktif: persis untuk Beranda; awalan untuk lainnya, termasuk halaman turunannya. */
export function menuAktif(href: ItemNav['href'], pathname: string): boolean {
  if (href === '/beranda') return pathname === '/beranda' || pathname.startsWith('/peristiwa/');
  if (href === '/urusanku')
    return pathname === href || pathname.startsWith('/urusan/') || pathname.startsWith('/jejak/');
  if (href === '/dokumen') return pathname === href || pathname === '/data-diri';
  return pathname === href || pathname.startsWith(`${href}/`);
}
