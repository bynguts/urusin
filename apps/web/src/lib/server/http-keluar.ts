import type { HttpFetch } from '@urusin/akun';
import { egressFetch } from '@urusin/egress';

/**
 * Satu-satunya titik HTTP keluar untuk akun: Google (token, JWKS) dan Resend, lewat egress runtime
 * (allowlist AUTH_HOSTS di @urusin/egress; alamat privat/loopback ditolak). Semua klien akun menerima
 * fetch yang disuntikkan, jadi tes memakai FakeGoogle/MemoryMailer tanpa jaringan.
 */
export const httpKeluar: HttpFetch = (url, init) => egressFetch(url, init);
