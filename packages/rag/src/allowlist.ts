/** Hanya origin resmi: https + host berakhiran .go.id, atau host eksplisit di bawah. */
export const EXTRA_ALLOWED_HOSTS: readonly string[] = [];

export function isAllowedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h.endsWith('.go.id') || EXTRA_ALLOWED_HOSTS.includes(h);
}
