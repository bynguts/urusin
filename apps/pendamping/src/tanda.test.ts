import { describe, expect, it } from 'vitest';
import {
  createPenjagaUlang,
  headerTanda,
  isiCocok,
  periksaTanda,
  tandaDariHeader,
  tandaInternal,
  TOLERANSI_MS,
  type HeaderTanda,
} from './tanda.js';

// Vektor uji yang sama dipakai apps/web (lib/server/pendamping.test.ts): kedua sisi harus cocok.
const R = 'r'.repeat(40);
const W = '1700000000000';
const N = '0123456789abcdef0123456789abcdef';
const ISI = '{"a":1}';
const HASH = '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862';
const VEKTOR = 'b6089c5b1fef03ec01230fdeacd9cd7ed0d145cfd2f78016e435500f904dcde5';

const H: HeaderTanda = { waktu: W, nonce: N, tanda: VEKTOR, isi: HASH, panjang: '7' };
const hdr = (h: Record<string, string>, panjang: number): HeaderTanda => ({
  waktu: h['x-urusin-waktu'],
  nonce: h['x-urusin-nonce'],
  tanda: h['x-urusin-tanda'],
  isi: h['x-urusin-isi-sha256'],
  panjang: String(panjang),
});

describe('tanda tangan HMAC kanal web -> worker', () => {
  it('vektor uji tetap (waktu, nonce, metode, jalur, panjang, sha256 isi); metode tidak peka huruf', () => {
    expect(tandaInternal(R, W, N, 'POST', '/internal/sesi/status', ISI)).toBe(VEKTOR);
    expect(tandaInternal(R, W, N, 'post', '/internal/sesi/status', Buffer.from(ISI))).toBe(VEKTOR);
    expect(tandaDariHeader(R, W, N, 'POST', '/internal/sesi/status', 7, HASH)).toBe(VEKTOR);
    const h = headerTanda(R, 'POST', '/x', ISI, Number(W));
    expect(h['x-urusin-isi-sha256']).toBe(HASH);
  });

  it('header saja diperiksa (tanpa isi): menolak panjang/hash/jalur/metode/rahasia/nonce berubah, waktu, format', () => {
    const t = Number(W);
    const ok = (o: Partial<HeaderTanda> = {}, m = 'POST', p = '/internal/sesi/status', r = R, now = t) =>
      periksaTanda(r, { ...H, ...o }, m, p, now);
    expect(ok()).toBe(true);
    expect(ok({}, 'POST', '/internal/sesi/status', R, t + TOLERANSI_MS)).toBe(true);
    expect(ok({}, 'POST', '/internal/sesi/status', R, t + TOLERANSI_MS + 1)).toBe(false);
    expect(ok({}, 'POST', '/internal/sesi/status', R, t - TOLERANSI_MS - 1)).toBe(false);
    // Panjang dan hash isi yang dideklarasikan ikut ditandatangani: memalsukan Content-Length = 401.
    expect(ok({ panjang: '12000000' })).toBe(false);
    expect(ok({ isi: 'f'.repeat(64) })).toBe(false);
    expect(ok({}, 'POST', '/internal/sesi/akhiri')).toBe(false);
    expect(ok({}, 'GET')).toBe(false);
    expect(ok({}, 'POST', '/internal/sesi/status', 's'.repeat(40))).toBe(false);
    expect(ok({ nonce: 'f'.repeat(32) })).toBe(false);
    for (const rusak of [
      { nonce: 'pendek' },
      { tanda: 'zz' },
      { waktu: '17' },
      { isi: 'xyz' },
      { panjang: '-1' },
      { panjang: '01' },
      { panjang: '1234567890' },
      { panjang: undefined },
      { isi: undefined },
    ])
      expect(ok(rusak)).toBe(false);
  });

  it('isiCocok: panjang dan sha256 isi yang diterima harus sama dengan deklarasi', () => {
    expect(isiCocok(H, Buffer.from(ISI))).toBe(true);
    expect(isiCocok(H, Buffer.from('{"a":2}'))).toBe(false);
    expect(isiCocok({ ...H, panjang: '8' }, Buffer.from(ISI))).toBe(false);
    expect(isiCocok({ ...H, isi: undefined }, Buffer.from(ISI))).toBe(false);
  });

  it('penjaga ulang: nonce yang sama ditolak dalam jendela, dilupakan setelahnya; batas entri', () => {
    const t = Date.now();
    const jaga = createPenjagaUlang(R, 3);
    const baru = (now: number) => hdr(headerTanda(R, 'POST', '/internal/sesi', '{}', now), 2);
    const a = baru(t);
    expect(jaga(a, 'POST', '/internal/sesi', t)).toBe(true);
    expect(jaga(a, 'POST', '/internal/sesi', t + 1)).toBe(false);
    expect(jaga(baru(t), 'POST', '/internal/sesi', t)).toBe(true);
    expect(jaga(baru(t), 'POST', '/internal/sesi', t)).toBe(true);
    // Penuh (3): permintaan baru ditolak sampai entri lama kedaluwarsa.
    expect(jaga(baru(t), 'POST', '/internal/sesi', t)).toBe(false);
    const nanti = t + 2 * TOLERANSI_MS + 1;
    expect(jaga(baru(nanti), 'POST', '/internal/sesi', nanti)).toBe(true);
    // Tanda palsu tidak mencatat nonce (tidak bisa menghabiskan tabel).
    const palsu = { ...baru(nanti), tanda: 'f'.repeat(64) };
    expect(jaga(palsu, 'POST', '/internal/sesi', nanti)).toBe(false);
  });
});
