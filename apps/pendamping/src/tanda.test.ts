import { describe, expect, it } from 'vitest';
import { periksaTanda, tandaInternal, TOLERANSI_MS } from './tanda.js';

// Vektor uji yang sama dipakai apps/web (lib/server/pendamping.test.ts): kedua sisi harus cocok.
const R = 'r'.repeat(40);
const W = '1700000000000';
const VEKTOR = '6bd9c7bef9d2879b430256daf6c406aa8bc10ad6f13f130bbc9ad37ecb8f89d3';

type Ubah = Partial<{
  waktu: string;
  tanda: string;
  m: string;
  p: string;
  isi: string;
  now: number;
  r: string;
}>;

describe('tanda tangan HMAC kanal web -> worker', () => {
  it('vektor uji tetap; metode tidak peka huruf', () => {
    expect(tandaInternal(R, W, 'POST', '/internal/sesi/status', '{"a":1}')).toBe(VEKTOR);
    expect(tandaInternal(R, W, 'post', '/internal/sesi/status', Buffer.from('{"a":1}'))).toBe(VEKTOR);
  });

  it('menolak isi/jalur/metode/rahasia berubah, waktu di luar jendela, header rusak', () => {
    const t = Number(W);
    const ok = (o: Ubah) =>
      periksaTanda(
        o.r ?? R,
        { waktu: o.waktu ?? W, tanda: o.tanda ?? VEKTOR },
        o.m ?? 'POST',
        o.p ?? '/internal/sesi/status',
        o.isi ?? '{"a":1}',
        o.now ?? t,
      );
    expect(ok({})).toBe(true);
    expect(ok({ now: t + TOLERANSI_MS })).toBe(true);
    expect(ok({ now: t + TOLERANSI_MS + 1 })).toBe(false);
    expect(ok({ now: t - TOLERANSI_MS - 1 })).toBe(false);
    expect(ok({ isi: '{"a":2}' })).toBe(false);
    expect(ok({ p: '/internal/sesi/akhiri' })).toBe(false);
    expect(ok({ m: 'GET' })).toBe(false);
    expect(ok({ r: 's'.repeat(40) })).toBe(false);
    expect(ok({ tanda: 'zz' })).toBe(false);
    expect(ok({ waktu: '17' })).toBe(false);
    expect(periksaTanda(R, { waktu: undefined, tanda: undefined }, 'POST', '/x', '')).toBe(false);
  });
});
