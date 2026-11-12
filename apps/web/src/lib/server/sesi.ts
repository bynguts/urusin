import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { kunciIp } from '@urusin/akun';
import { apiError } from '#lib/server/http.js';
import type { Runtime } from '#lib/server/runtime.js';

/**
 * Sesi anonim: cookie acak (HttpOnly, SameSite=Lax) sebagai identitas kuota dan penanda pemilik urusan tamu
 * (`urusanMilik`). Hilang cookie = urusan tamu tidak bisa dibuka lagi; masuk akun memindahkannya ke akun.
 */
export const SID_COOKIE = '__Host-urusin_sid';
/** Nama lama (sebelum __Host-): dibaca sekali oleh `migrasiSid`, lalu dihapus. */
const SID_COOKIE_LAMA = 'urusin_sid';
const SID_RE = /^[0-9a-f]{32}$/;
const SID_TTL_SEC = 60 * 60 * 24 * 30;
/** __Host-: Secure, Path=/, tanpa Domain (localhost http tetap diterima peramban sebagai konteks aman). */
const SID_OPSI = { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: SID_TTL_SEC } as const;

/**
 * Batas adopsi cookie lama: 30 hari (= umur maksimal `urusin_sid`) sejak rilis __Host-. Setelahnya cookie lama
 * hanya dihapus, tidak pernah lagi diadopsi (nama tanpa __Host- bisa ditanam subdomain/http).
 */
export const MIGRASI_SID_SAMPAI = Date.parse('2026-12-10T00:00:00Z');

/**
 * Pindahkan cookie `urusin_sid` lama ke `__Host-urusin_sid` sekali (nilai sama) selama masa migrasi, lalu hapus
 * yang lama.
 */
export function migrasiSid(cookies: Pick<Cookies, 'get' | 'set' | 'delete'>, now: number = Date.now()): void {
  const lama = cookies.get(SID_COOKIE_LAMA);
  if (lama === undefined) return;
  if (now < MIGRASI_SID_SAMPAI && !cookies.get(SID_COOKIE) && SID_RE.test(lama))
    cookies.set(SID_COOKIE, lama, SID_OPSI);
  cookies.delete(SID_COOKIE_LAMA, { path: '/' });
}

/**
 * Penanda "urusin_sid baru saja diperpanjang" (1 hari). Hilang = sudah lebih dari sehari: cookie sid ditulis ulang
 * dengan umur penuh, jadi tamu yang aktif tidak kehilangan urusannya saat 30 hari sejak kunjungan pertama lewat.
 */
const SID_SEGAR_COOKIE = '__Host-urusin_sid_segar';
const SEGAR_OPSI = { ...SID_OPSI, maxAge: 60 * 60 * 24 } as const;

export function ensureSession(cookies: Pick<Cookies, 'get' | 'set'>): string {
  const ada = cookies.get(SID_COOKIE);
  if (ada && SID_RE.test(ada)) {
    if (!cookies.get(SID_SEGAR_COOKIE)) {
      cookies.set(SID_COOKIE, ada, SID_OPSI);
      cookies.set(SID_SEGAR_COOKIE, '1', SEGAR_OPSI);
    }
    return ada;
  }
  const sid = randomBytes(16).toString('hex');
  cookies.set(SID_COOKIE, sid, SID_OPSI);
  cookies.set(SID_SEGAR_COOKIE, '1', SEGAR_OPSI);
  return sid;
}

/**
 * Urusan terakhir yang dibuka di peramban ini, supaya Ringkasan (/beranda) bisa dirender di server tanpa
 * menunggu localStorage. Isinya id kapabilitas, jadi HttpOnly seperti cookie sesi.
 */
export const TERAKHIR_COOKIE = 'urusin_terakhir';
const ID_URUSAN_RE = /^u_[0-9a-f]{32}$/;

export function catatTerakhir(cookies: Cookies, id: string, publicOrigin: string): void {
  if (!ID_URUSAN_RE.test(id)) return;
  cookies.set(TERAKHIR_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: publicOrigin.startsWith('https://'),
    maxAge: SID_TTL_SEC,
  });
}

/** Keluar/hapus akun: perangkat bersama tidak boleh lagi menunjuk urusan pemakai sebelumnya. */
export function hapusTerakhir(cookies: Pick<Cookies, 'delete'>): void {
  cookies.delete(TERAKHIR_COOKIE, { path: '/' });
}

export function bacaTerakhir(cookies: Cookies): string | null {
  const id = cookies.get(TERAKHIR_COOKIE);
  return id && ID_URUSAN_RE.test(id) ? id : null;
}

type Aksi = 'buat' | 'turn';

/** Waktu tunggu Retry-After untuk warga: "±45 detik" di bawah 90 detik, selain itu "±N menit" (dibulatkan ke atas). */
export function lamaTunggu(detik: number): string {
  const s = Math.max(1, Math.ceil(detik));
  return s < 90 ? `±${s} detik` : `±${Math.ceil(s / 60)} menit`;
}

const PESAN_LAJU: Record<Aksi, string> = {
  buat: 'Terlalu banyak urusan baru dalam waktu singkat.',
  turn: 'Terlalu banyak pesan dalam waktu singkat.',
};

/** Pesan 429 yang menyebut waktu tunggu nyata (sama dengan header Retry-After). */
export const pesanLaju = (aksi: Aksi, retryAfterSec: number): string =>
  `${PESAN_LAJU[aksi]} Coba lagi dalam ${lamaTunggu(retryAfterSec)}.`;

/**
 * Kuota laju. Warga yang masuk (akun atau demo) dihitung per akun bila pembatas `akun` ada, tanpa batas per IP:
 * banyak warga sah berbagi satu IP (CGNAT, warnet, kantor kelurahan). Tamu dihitung per sesi dan per IP (rem
 * banjir). 429 + Retry-After + pesan berwaktu tunggu bila lewat; undefined bila boleh lanjut.
 */
export function batasi(
  rt: Runtime,
  event: {
    locals: { sid?: string | undefined; akun?: { id: string } | undefined };
    getClientAddress: () => string;
  },
  aksi: Aksi,
): Response | undefined {
  const lim = rt.limits[aksi];
  const akunId = event.locals.akun?.id;
  let hasil;
  if (akunId && lim.akun) hasil = [lim.akun.consume(`akun:${akunId}`)];
  else {
    let ip = 'tak-dikenal';
    try {
      ip = event.getClientAddress();
    } catch {
      // tanpa alamat klien: semuanya berbagi satu kunci (lebih ketat, bukan lebih longgar)
    }
    const sid = event.locals.sid ?? 'tanpa-sesi';
    hasil = [lim.ip.consume(`ip:${kunciIp(ip)}`), lim.sesi.consume(`sid:${sid}`)];
  }
  const kena = hasil.find((h) => !h.ok);
  if (!kena) return undefined;
  const res = apiError(429, 'RATE_LIMITED', pesanLaju(aksi, kena.retryAfterSec));
  res.headers.set('retry-after', String(kena.retryAfterSec));
  return res;
}

/**
 * Putar cookie urusin_sid (anti fiksasi saat naik hak tamu → akun, §3.26.6). Pemanggil wajib mengikat ulang
 * semua yang terikat hash sid lama dalam satu transaksi (`AkunService.rotasiPemilik`).
 */
export function rotasiSid(cookies: Cookies): string {
  const sid = randomBytes(16).toString('hex');
  cookies.set(SID_COOKIE, sid, SID_OPSI);
  return sid;
}
