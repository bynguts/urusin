/**
 * Jembatan web app <-> ekstensi Urusin (rencana §3.5 butir 5). Pairing: popup ekstensi membuka
 * `/pair#nonce=<hex>`; nonce ada di fragment (tidak terkirim ke server/log/Referer), dibaca lalu langsung
 * dihapus dari URL, dikirim ke ekstensi lewat `chrome.runtime.sendMessage` (externally_connectable).
 */

export const NONCE_STORAGE_KEY = 'urusin.pair.nonce';
const NONCE_RE = /^[0-9a-f]{64}$/;

export function parseNonceFromHash(hash: string): string | null {
  const nonce = new URLSearchParams(hash.replace(/^#/, '')).get('nonce');
  return nonce !== null && NONCE_RE.test(nonce) ? nonce : null;
}

export type ExtensionRuntime = {
  sendMessage(extensionId: string, message: unknown): Promise<unknown>;
};

/** `chrome.runtime` hanya ada di halaman yang cocok dengan `externally_connectable` ekstensi terpasang. */
export function getExtensionRuntime(scope: object = globalThis): ExtensionRuntime | null {
  const runtime = (scope as { chrome?: { runtime?: Partial<ExtensionRuntime> } }).chrome?.runtime;
  return typeof runtime?.sendMessage === 'function' ? (runtime as ExtensionRuntime) : null;
}

export type PairResult = { ok: true; origin: string } | { ok: false; code: string };

type Reply = { ok?: boolean; code?: unknown; origin?: unknown; type?: unknown };

async function call(runtime: ExtensionRuntime, extensionId: string, message: object): Promise<Reply> {
  try {
    return ((await runtime.sendMessage(extensionId, message)) ?? {}) as Reply;
  } catch {
    return { ok: false, code: 'EXTENSION_UNREACHABLE' };
  }
}

/** Pair dengan nonce lalu ping sebagai bukti round-trip (origin dicek ekstensi). */
export async function pairAndPing(
  runtime: ExtensionRuntime | null,
  extensionId: string,
  nonce: string,
): Promise<PairResult> {
  if (!runtime) return { ok: false, code: 'EXTENSION_NOT_FOUND' };
  const paired = await call(runtime, extensionId, { type: 'pair', nonce });
  if (!paired.ok) return { ok: false, code: String(paired.code ?? 'PAIR_FAILED') };
  const pong = await call(runtime, extensionId, { type: 'ping', nonce });
  if (!pong.ok || pong.type !== 'pong') return { ok: false, code: String(pong.code ?? 'PING_FAILED') };
  return { ok: true, origin: String(pong.origin) };
}
