import { describe, expect, it } from 'vitest';
import {
  createPenjagaUlang,
  headerTanda,
  periksaTanda,
  tandaInternal,
  TOLERANSI_MS,
  type HeaderTanda,
} from './tanda.js';

// Vektor uji yang sama dipakai apps/web (lib/server/pendamping.test.ts): kedua sisi harus cocok.
const R = 'r'.repeat(40);
const W = '1700000000000';
const N = '0123456789abcdef0123456789abcdef';
const VEKTOR = 'cc8335efcf547bb99e33a916b615c9152474c8613649f175e650158ffa14af4e';

type Ubah = Partial<{
  waktu: string;
  nonce: string;
  tanda: string;
  m: string;
  p: string;
  isi: string;
  now: number;
  r: string;
}>;

describe('tanda tangan HMAC kanal web -> worker', () => {
  it('vektor uji tetap; metode tidak peka huruf', () => {
    expect(tandaInternal(R, W, N, 'POST', '/internal/sesi/status', '{"a":1}')).toBe(VEKTOR);
    expect(tandaInternal(R, W, N, 'post', '/internal/sesi/status', Buffer.from('{"a":1}'))).toBe(VEKTOR);
  });

  it('menolak isi/jalur/metode/rahasia/nonce berubah, waktu di luar jendela, header rusak', () => {
    const t = Number(W);
    const ok = (o: Ubah) =>
      periksaTanda(
        o.r ?? R,
        { waktu: o.waktu ?? W, nonce: o.nonce ?? N, tanda: o.tanda ?? VEKTOR },
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
    expect(ok({ nonce: 'f'.repeat(32) })).toBe(false);
    expect(ok({ nonce: 'pendek' })).toBe(false);
    expect(ok({ tanda: 'zz' })).toBe(false);
    expect(ok({ waktu: '17' })).toBe(false);
    expect(periksaTanda(R, { waktu: undefined, nonce: undefined, tanda: undefined }, 'POST', '/x', '')).toBe(
      false,
    );
  });

  it('penjaga ulang: nonce yang sama ditolak dalam jendela, dilupakan setelahnya; batas entri', () => {
    const t = Date.now();
    const jaga = createPenjagaUlang(R, 3);
    const hdr = (now: number): HeaderTanda => {
      const h = headerTanda(R, 'POST', '/internal/sesi', '{}', now);
      return { waktu: h['x-urusin-waktu'], nonce: h['x-urusin-nonce'], tanda: h['x-urusin-tanda'] };
    };
    const a = hdr(t);
    expect(jaga(a, 'POST', '/internal/sesi', '{}', t)).toBe(true);
    expect(jaga(a, 'POST', '/internal/sesi', '{}', t + 1)).toBe(false);
    expect(jaga(hdr(t), 'POST', '/internal/sesi', '{}', t)).toBe(true);
    expect(jaga(hdr(t), 'POST', '/internal/sesi', '{}', t)).toBe(true);
    // Penuh (3): permintaan baru ditolak sampai entri lama kedaluwarsa.
    expect(jaga(hdr(t), 'POST', '/internal/sesi', '{}', t)).toBe(false);
    const nanti = t + 2 * TOLERANSI_MS + 1;
    expect(jaga(hdr(nanti), 'POST', '/internal/sesi', '{}', nanti)).toBe(true);
    expect(jaga({ ...a, tanda: 'f'.repeat(64) }, 'POST', '/internal/sesi', '{}', t)).toBe(false);
  });

  it('praIsi (sebelum isi dibaca): header layak + nonce belum dipakai; tidak mencatat nonce', () => {
    const t = Date.now();
    const jaga = createPenjagaUlang(R);
    const h = headerTanda(R, 'POST', '/internal/sesi/berkas', '{}', t);
    const a: HeaderTanda = {
      waktu: h['x-urusin-waktu'],
      nonce: h['x-urusin-nonce'],
      tanda: h['x-urusin-tanda'],
    };
    expect(jaga.praIsi({ waktu: undefined, nonce: undefined, tanda: undefined }, t)).toBe(false);
    expect(jaga.praIsi({ ...a, nonce: 'xyz' }, t)).toBe(false);
    expect(jaga.praIsi(a, t + TOLERANSI_MS + 1)).toBe(false);
    // Tanda palsu berformat benar lolos praIsi (MAC diperiksa setelah isi) tetapi tidak menghabiskan nonce.
    expect(jaga.praIsi({ ...a, tanda: 'f'.repeat(64) }, t)).toBe(true);
    expect(jaga.praIsi(a, t)).toBe(true);
    expect(jaga(a, 'POST', '/internal/sesi/berkas', '{}', t)).toBe(true);
    expect(jaga.praIsi(a, t)).toBe(false);
  });
});
