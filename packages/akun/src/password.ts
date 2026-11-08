import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords.js';

/**
 * Hash sandi argon2id memakai `crypto.argon2` bawaan Node (OpenSSL 3.2+): tanpa modul native, jadi sama
 * di linux/arm64, linux/amd64, dan Windows. Parameter = rekomendasi minimum OWASP Password Storage
 * Cheat Sheet: m = 19 MiB, t = 2, p = 1. Disimpan sebagai string PHC agar parameter bisa dinaikkan nanti
 * (`needsRehash`) tanpa memutus hash lama.
 */
export type Argon2Params = { memory: number; passes: number; parallelism: number; tagLength: number };
export const ARGON2_PARAMS: Readonly<Argon2Params> = Object.freeze({
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
});

const SALT_BYTES = 16;
export const SANDI_MIN = 8;
/** Batas atas menahan DoS lewat sandi raksasa (argon2 tetap memproses semua byte). */
export const SANDI_MAX = 128;

/** Paling banyak 2 hash argon2 serentak (19 MiB tiap hash): CPU dan RAM host bersama tetap aman. */
export const ARGON2_SERENTAK = 2;
let berjalan = 0;
const antre: (() => void)[] = [];

async function denganSemafor<T>(fn: () => Promise<T>): Promise<T> {
  if (berjalan >= ARGON2_SERENTAK) await new Promise<void>((r) => antre.push(r));
  berjalan++;
  try {
    return await fn();
  } finally {
    berjalan--;
    antre.shift()?.();
  }
}

function derive(password: string, salt: Buffer, p: Argon2Params): Promise<Buffer> {
  return denganSemafor(() => deriveLangsung(password, salt, p));
}

function deriveLangsung(password: string, salt: Buffer, p: Argon2Params): Promise<Buffer> {
  const params: Argon2Parameters = {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'),
    nonce: salt,
    parallelism: p.parallelism,
    tagLength: p.tagLength,
    memory: p.memory,
    passes: p.passes,
  };
  return new Promise((resolve, reject) =>
    argon2('argon2id', params, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const p = ARGON2_PARAMS;
  const tag = await derive(password, salt, p);
  return `$argon2id$v=19$m=${p.memory},t=${p.passes},p=${p.parallelism}$${b64(salt)}$${b64(tag)}`;
}

type Parsed = { params: Argon2Params; salt: Buffer; tag: Buffer };

const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function parse(phc: string): Parsed | null {
  const m = PHC_RE.exec(phc);
  if (!m) return null;
  const tag = Buffer.from(m[5]!, 'base64');
  const params = {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: tag.length,
  };
  // Batas wajar agar baris DB yang rusak/berbahaya tidak memicu alokasi memori besar.
  if (params.memory > 1_048_576 || params.passes > 20 || params.parallelism > 16 || tag.length < 16)
    return null;
  return { params, salt: Buffer.from(m[4]!, 'base64'), tag };
}

/** Bandingkan sandi dengan hash PHC. Hash rusak = false (tidak melempar). */
export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  const parsed = parse(phc);
  if (!parsed) return false;
  const tag = await derive(password, parsed.salt, parsed.params);
  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag);
}

/** true bila hash dibuat dengan parameter lama: hash ulang setelah login berhasil. */
export function needsRehash(phc: string): boolean {
  const parsed = parse(phc);
  if (!parsed) return true;
  const p = parsed.params;
  return (
    p.memory !== ARGON2_PARAMS.memory ||
    p.passes !== ARGON2_PARAMS.passes ||
    p.parallelism !== ARGON2_PARAMS.parallelism ||
    p.tagLength !== ARGON2_PARAMS.tagLength
  );
}

export type MasalahSandi = 'SANDI_TERLALU_PENDEK' | 'SANDI_TERLALU_PANJANG' | 'SANDI_TERLALU_UMUM';

/** Kebijakan sandi (NIST 800-63B): panjang minimum, batas atas, dan bukan sandi umum / bukan email sendiri. */
export function periksaSandi(password: string, email?: string): MasalahSandi | null {
  const len = [...password].length;
  if (len < SANDI_MIN) return 'SANDI_TERLALU_PENDEK';
  if (len > SANDI_MAX) return 'SANDI_TERLALU_PANJANG';
  const lower = password.normalize('NFKC').toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'SANDI_TERLALU_UMUM';
  if (/^(.)\1+$/.test(lower)) return 'SANDI_TERLALU_UMUM';
  if (email) {
    const e = email.toLowerCase();
    const local = e.split('@')[0] ?? '';
    if (lower === e || (local.length >= SANDI_MIN && lower === local)) return 'SANDI_TERLALU_UMUM';
  }
  return null;
}
