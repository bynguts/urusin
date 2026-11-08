import hosts from '../../../../../deploy/hosts.json';

type HostSet = { app: string; verify: string; fixtures: string };

const SETS: Record<string, HostSet> = hosts;

const hostOfOrigin = (value: string): string | null => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.pathname === '/' && !u.port && !u.username ? u.hostname : null;
  } catch {
    return null;
  }
};

/**
 * Fail-fast saat startup: DOMAIN / VERIFY_HOST / FIXTURES_HOST (bila diset), serta host pada ORIGIN dan
 * FIXTURES_PUBLIC_ORIGIN berskema https, harus persis milik SATU set di deploy/hosts.json (primary atau fallback).
 * Origin http (dev lokal) tidak diperiksa. Melempar Error berisi daftar pelanggaran.
 */
export function assertHostEnv(env: Record<string, string | undefined>): void {
  const found: { name: string; role: keyof HostSet; host: string }[] = [];
  const add = (name: string, role: keyof HostSet, host: string | undefined) => {
    if (host) found.push({ name, role, host });
  };
  const domain = env.DOMAIN?.trim();
  add('DOMAIN', 'app', domain);
  add('VERIFY_HOST', 'verify', env.VERIFY_HOST?.trim());
  add('FIXTURES_HOST', 'fixtures', env.FIXTURES_HOST?.trim());
  for (const [name, role] of [
    ['ORIGIN', 'app'],
    ['FIXTURES_PUBLIC_ORIGIN', 'fixtures'],
  ] as const) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const host = hostOfOrigin(raw);
    if (host) add(name, role, host);
    else if (raw.startsWith('https://')) found.push({ name, role, host: raw });
  }

  const problems: string[] = [];
  const names = Object.keys(SETS);
  const matched = new Set<string>();
  for (const f of found) {
    const owners = names.filter((n) => SETS[n]![f.role] === f.host);
    if (owners.length === 0) problems.push(`${f.name}=${f.host} bukan host ${f.role} di deploy/hosts.json`);
    else for (const o of owners) matched.add(o);
  }
  if (problems.length === 0 && found.length > 0) {
    const consistent = names.filter((n) => found.every((f) => SETS[n]![f.role] === f.host));
    if (consistent.length === 0)
      problems.push(`host tidak berasal dari satu set yang sama (${names.join(' / ')})`);
  }
  if (problems.length > 0) throw new Error(`Konfigurasi host tidak valid: ${problems.join('; ')}`);
}
