import type { HttpFetch } from '@urusin/akun';

/**
 * Satu-satunya titik HTTP keluar untuk akun: Google (token, JWKS) dan Resend.
 * Host yang dihubungi: oauth2.googleapis.com, www.googleapis.com, accounts.google.com, api.resend.com.
 *
 * Peralihan ke @urusin/egress (branch chore/ops-host-network, belum di main): ganti badan fungsi ini
 * dengan `egressFetch(url, init)` dan tambahkan keempat host di atas ke allowlist egress. Tidak ada
 * pemanggil lain yang perlu diubah karena semua klien akun menerima fetch yang disuntikkan.
 */
export const httpKeluar: HttpFetch = (url, init) => fetch(url, init);
