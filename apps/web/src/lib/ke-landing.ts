/**
 * Logo di aplikasi membuka landing. Halaman urusan memakai Referrer-Policy no-referrer, jadi server tidak bisa
 * mengandalkan Referer untuk tahu klik itu sengaja. Penanda singkat (30 detik, tanpa data pribadi) ini
 * memberi tahu load `/` agar tidak mengalihkan akun ke Beranda; server menghapusnya begitu dibaca.
 */
export const LANDING_COOKIE = 'urusin_ke_landing';

export function tandaiKeLanding(): void {
  const aman = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LANDING_COOKIE}=1; Max-Age=30; Path=/; SameSite=Lax${aman}`;
}
