import { nilaiEnv } from '@urusin/akun';
import { egressFetch, type EgressFetch } from '@urusin/egress';

/** Endpoint verifikasi token Turnstile (host ada di allowlist egress `TURNSTILE_HOSTS`). */
export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Token tiruan untuk e2e (sama dengan token kunci uji Cloudflare); hanya diterima mode `fixture`. */
export const TURNSTILE_TOKEN_FIXTURE = 'XXXX.DUMMY.TOKEN.XXXX';

export type ModeTurnstile = 'cloudflare' | 'fixture' | 'nonaktif';

export type Turnstile = {
  mode: ModeTurnstile;
  /** Site key publik untuk widget (kosong bila nonaktif). */
  siteKey: string;
  /** true bila token sah. Mode nonaktif selalu false (pemanggil memutuskan apakah boleh tanpa Turnstile). */
  verifikasi(token: string | undefined, ip: string): Promise<boolean>;
};

type Env = Record<string, string | undefined>;

/**
 * Turnstile dari env:
 * - `TURNSTILE_SECRET_KEY` terisi → siteverify Cloudflare lewat egress (gagal jaringan = token ditolak);
 * - `URUSIN_TURNSTILE_FIXTURE=1` (hanya di luar produksi) → hanya `TURNSTILE_TOKEN_FIXTURE` diterima (e2e);
 * - selain itu (kosong atau placeholder `ganti-dengan-…`) nonaktif. "Masuk sebagai juri" tetap jalan (batas per
 *   IP, batas aktif, kedaluwarsa); di produksi operator diberi alert (`peringatanTurnstile`).
 */
export function turnstileFromEnv(env: Env = process.env, fetch: EgressFetch = egressFetch): Turnstile {
  const secret = nilaiEnv(env.TURNSTILE_SECRET_KEY);
  const fixture = env.URUSIN_TURNSTILE_FIXTURE?.trim() === '1';
  if (fixture && env.NODE_ENV === 'production')
    throw new Error('URUSIN_TURNSTILE_FIXTURE hanya untuk e2e; tidak boleh di produksi');
  if (secret) {
    return {
      mode: 'cloudflare',
      siteKey: nilaiEnv(env.TURNSTILE_SITE_KEY) ?? '',
      async verifikasi(token, ip) {
        if (!token || token.length > 4096) return false;
        try {
          const res = await fetch(TURNSTILE_SITEVERIFY, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
          });
          if (!res.ok) return false;
          const body = (await res.json()) as { success?: unknown };
          return body.success === true;
        } catch {
          return false;
        }
      },
    };
  }
  if (fixture)
    return {
      mode: 'fixture',
      siteKey: 'fixture',
      verifikasi: async (token) => token === TURNSTILE_TOKEN_FIXTURE,
    };
  return { mode: 'nonaktif', siteKey: '', verifikasi: async () => false };
}

/**
 * Pesan alert operator bila Turnstile nonaktif di produksi: "Masuk sebagai juri" dan login setelah 3 kegagalan
 * berjalan tanpa tantangan bot (hanya batas per IP/global). null bila aman.
 */
export function peringatanTurnstile(t: Turnstile, env: Env = process.env): string | null {
  if (t.mode !== 'nonaktif' || env.NODE_ENV !== 'production' || env.CI === 'true') return null;
  return 'Turnstile nonaktif di produksi (TURNSTILE_SECRET_KEY kosong): juri dan login tanpa tantangan bot';
}
