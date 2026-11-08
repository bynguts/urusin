import { randomBytes } from 'node:crypto';
import { deriveKek } from './keys.js';
import { mailerFromEnv, type HttpFetch } from './mailer.js';
import type { AkunTtl, Kuota } from './service.js';
import type { BatasVault } from './vault.js';

type Env = Record<string, string | undefined>;

export type AkunEnvConfig = {
  ttl: Partial<AkunTtl>;
  kuota: Partial<Kuota>;
  batasVault: Partial<BatasVault>;
  google: { clientId: string; clientSecret: string } | undefined;
  /** KEK vault. Tanpa URUSIN_PII_KEY (hanya di luar produksi): acak per proses, vault tidak bertahan restart. */
  kek: Buffer;
  /** KEK dari URUSIN_PII_KEY_PREV (selama rotasi): DEK lama dibuka lalu dibungkus ulang dengan `kek`. */
  kekLama: Buffer | undefined;
  kekSementara: boolean;
  /** IdP OIDC tiruan untuk e2e (`URUSIN_OIDC_FIXTURE=1`); ditolak di produksi. */
  oidcFixture: boolean;
};

function bulat(env: Env, name: string, min: number): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} harus bilangan bulat ≥ ${min}`);
  return n;
}

/** Baca konfigurasi akun dari env. Melempar bila nilai tidak valid atau syarat produksi tidak terpenuhi. */
export function akunConfigFromEnv(env: Env): AkunEnvConfig {
  const produksi = env.NODE_ENV === 'production';
  const ttl: Partial<AkunTtl> = {};
  const idle = bulat(env, 'AUTH_SESSION_IDLE_TTL_SEC', 60);
  const absolut = bulat(env, 'AUTH_SESSION_ABSOLUTE_TTL_SEC', 60);
  if (idle !== undefined) ttl.sesiIdleSec = idle;
  if (absolut !== undefined) ttl.sesiAbsolutSec = absolut;
  if (idle !== undefined && absolut !== undefined && idle > absolut)
    throw new Error('AUTH_SESSION_IDLE_TTL_SEC tidak boleh melebihi AUTH_SESSION_ABSOLUTE_TTL_SEC');

  const kuota: Partial<Kuota> = {};
  const tamu = bulat(env, 'URUSIN_TAMU_PER_IP_HARI', 1);
  const demoIp = bulat(env, 'URUSIN_DEMO_PER_IP_HARI', 1);
  const demoMaks = bulat(env, 'URUSIN_DEMO_AKTIF_MAKS', 1);
  if (tamu !== undefined) kuota.tamuPerIpHari = tamu;
  if (demoIp !== undefined) kuota.demoPerIpHari = demoIp;
  if (demoMaks !== undefined) kuota.demoAktifMaks = demoMaks;

  const batasVault: Partial<BatasVault> = {};
  const totalMb = bulat(env, 'URUSIN_VAULT_MAX_MB', 1);
  const disk = bulat(env, 'URUSIN_VAULT_DISK_THRESHOLD', 0);
  if (totalMb !== undefined) batasVault.totalMaks = totalMb * 1024 * 1024;
  if (disk !== undefined) {
    if (disk > 100) throw new Error('URUSIN_VAULT_DISK_THRESHOLD harus 0..100');
    batasVault.diskPersenMaks = disk;
  }

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new Error('GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET harus diisi berdua atau dikosongkan berdua');

  const oidcFixture = env.URUSIN_OIDC_FIXTURE?.trim() === '1';
  if (oidcFixture && produksi)
    throw new Error('URUSIN_OIDC_FIXTURE hanya untuk e2e; tidak boleh di produksi');

  const piiKey = env.URUSIN_PII_KEY?.trim();
  const prev = env.URUSIN_PII_KEY_PREV?.trim();
  if (!piiKey && produksi)
    throw new Error('URUSIN_PII_KEY wajib di produksi: kunci pembungkus vault diturunkan darinya');
  if (prev && !piiKey) throw new Error('URUSIN_PII_KEY_PREV butuh URUSIN_PII_KEY (kunci baru)');
  return {
    ttl,
    kuota,
    batasVault,
    google: clientId && clientSecret ? { clientId, clientSecret } : undefined,
    kek: piiKey ? deriveKek(piiKey) : randomBytes(32),
    kekLama: prev ? deriveKek(prev) : undefined,
    kekSementara: !piiKey,
    oidcFixture,
  };
}

/**
 * Pemeriksaan saat boot (hooks.server.ts): server menolak start bila mode email tidak memenuhi syarat
 * (produksi: resend + RESEND_API_KEY; log hanya dev/CI), tanpa URUSIN_PII_KEY di produksi, IdP tiruan di
 * produksi, atau nilai TTL/kuota/Google yang tidak konsisten.
 */
export function assertAkunEnv(env: Env): void {
  akunConfigFromEnv(env);
  mailerFromEnv(env, (() => Promise.reject(new Error('tidak dipakai'))) as HttpFetch, () => undefined);
}
