import type { NamaIkon } from '../ikon.js';

export type ItemNav = {
  href: '/beranda' | '/urusanku' | '/dokumen' | '/jejak' | '/bantuan' | '/pengaturan';
  label: string;
  ikon: NamaIkon;
};

/**
 * Menu samping (frame uCOBS). `/jejak` = Riwayat bantuan: Sidebar mengarahkannya ke jejak urusan terakhir
 * di perangkat ini, atau ke Urusanku bila belum ada.
 */
export const NAV: readonly ItemNav[] = [
  { href: '/beranda', label: 'Ringkasan', ikon: 'beranda' },
  { href: '/urusanku', label: 'Urusan saya', ikon: 'rencana' },
  { href: '/dokumen', label: 'Dokumen saya', ikon: 'berkas-banyak' },
  { href: '/jejak', label: 'Riwayat bantuan', ikon: 'riwayat' },
  { href: '/pengaturan', label: 'Privasi & data', ikon: 'perisai' },
];

/** Navigasi bawah HP (frame IzXAR): empat menu, Bantuan selalu di ujung kanan (WCAG 3.2.6). */
export const NAV_HP: readonly (ItemNav & { href: Exclude<ItemNav['href'], '/jejak' | '/pengaturan'> })[] = [
  { href: '/beranda', label: 'Ringkasan', ikon: 'beranda' },
  { href: '/urusanku', label: 'Urusan', ikon: 'rencana' },
  { href: '/dokumen', label: 'Dokumen', ikon: 'berkas-banyak' },
  { href: '/bantuan', label: 'Bantuan', ikon: 'obrolan' },
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
  if (href === '/urusanku') return pathname === href || pathname.startsWith('/urusan/');
  if (href === '/jejak') return pathname.startsWith('/jejak/');
  if (href === '/dokumen') return pathname === href || pathname === '/data-diri';
  return pathname === href || pathname.startsWith(`${href}/`);
}
