import { randomBytes } from 'node:crypto';
import { mailerFromEnv, type HttpFetch } from './mailer.js';
import type { AkunTtl } from './service.js';
import { deriveKek } from './vault.js';

type Env = Record<string, string | undefined>;

export type AkunEnvConfig = {
  ttl: Partial<AkunTtl>;
  google: { clientId: string; clientSecret: string } | undefined;
  /** KEK vault. Tanpa URUSIN_PII_KEY (hanya di luar produksi): acak per proses, vault tidak bertahan restart. */
  kek: Buffer;
  kekSementara: boolean;
};

function detik(env: Env, name: string): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 60) throw new Error(`${name} harus bilangan bulat detik ≥ 60`);
  return n;
}

/** Baca konfigurasi akun dari env. Melempar bila nilai tidak valid atau syarat produksi tidak terpenuhi. */
export function akunConfigFromEnv(env: Env): AkunEnvConfig {
  const ttl: Partial<AkunTtl> = {};
  const idle = detik(env, 'AUTH_SESSION_IDLE_TTL_SEC');
  const absolut = detik(env, 'AUTH_SESSION_ABSOLUTE_TTL_SEC');
  if (idle !== undefined) ttl.sesiIdleSec = idle;
  if (absolut !== undefined) ttl.sesiAbsolutSec = absolut;
  if (idle !== undefined && absolut !== undefined && idle > absolut)
    throw new Error('AUTH_SESSION_IDLE_TTL_SEC tidak boleh melebihi AUTH_SESSION_ABSOLUTE_TTL_SEC');

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new Error('GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET harus diisi berdua atau dikosongkan berdua');

  const piiKey = env.URUSIN_PII_KEY?.trim();
  if (!piiKey && env.NODE_ENV === 'production')
    throw new Error('URUSIN_PII_KEY wajib di produksi: kunci pembungkus vault akun diturunkan darinya');
  return {
    ttl,
    google: clientId && clientSecret ? { clientId, clientSecret } : undefined,
    kek: piiKey ? deriveKek(piiKey) : randomBytes(32),
    kekSementara: !piiKey,
  };
}

/**
 * Pemeriksaan saat boot (hooks.server.ts): server menolak start di produksi tanpa Resend (kecuali
 * AUTH_EMAIL_DEV=1) atau tanpa URUSIN_PII_KEY, dan menolak nilai TTL/Google yang tidak konsisten.
 */
export function assertAkunEnv(env: Env): void {
  akunConfigFromEnv(env);
  mailerFromEnv(env, (() => Promise.reject(new Error('tidak dipakai'))) as HttpFetch, () => undefined);
}
