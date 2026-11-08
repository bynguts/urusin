/** Konfigurasi fixture dari env. Profil `public` aman di-deploy; `local` hanya laptop/CI. */

export const PROFILES = ['public', 'local'] as const;
export type Profile = (typeof PROFILES)[number];

export type Config = {
  profile: Profile;
  port: number;
  /** Origin publik persis untuk cek `Origin` POST. Kosong = dev: Origin harus sama dengan header Host. */
  publicOrigin: string | undefined;
};

export const DEFAULT_PORT = 4320;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const profile = env.FIXTURES_PROFILE ?? 'public';
  if (!(PROFILES as readonly string[]).includes(profile)) {
    throw new Error(`FIXTURES_PROFILE tidak valid: "${profile}" (pilihan: ${PROFILES.join(', ')})`);
  }
  const rawPort = env.FIXTURES_PORT ?? env.PORT ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`port tidak valid: "${rawPort}"`);
  return { profile: profile as Profile, port, publicOrigin: env.FIXTURES_PUBLIC_ORIGIN || undefined };
}
