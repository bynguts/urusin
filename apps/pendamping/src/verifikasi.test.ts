import { describe, expect, it } from 'vitest';
import {
  BATAS_TANTANGAN_MS,
  createPantauTantangan,
  isChallengeFrameUrl,
  isInterstitialTitle,
  JENDELA_ULANG_MS,
} from './verifikasi.js';
import { detectBotWall, wallBisaDiverifikasi } from './waf.js';

describe('verifikasi situs: deteksi', () => {
  it('frame tantangan: host Turnstile atau jalur challenge-platform; selain itu bukan', () => {
    expect(
      isChallengeFrameUrl('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/x'),
    ).toBe(true);
    expect(isChallengeFrameUrl('https://oss.go.id/cdn-cgi/challenge-platform/h/g/orchestrate/x')).toBe(true);
    expect(isChallengeFrameUrl('https://challenges.cloudflare.com.evil.example/')).toBe(false);
    expect(isChallengeFrameUrl('https://oss.go.id/cari/cdn-cgi/challenge-platform/')).toBe(false);
    expect(isChallengeFrameUrl('about:blank')).toBe(false);
    expect(isChallengeFrameUrl('bukan url')).toBe(false);
  });

  it('judul interstitial dikenali; judul halaman biasa tidak', () => {
    expect(isInterstitialTitle('Just a moment...')).toBe(true);
    expect(isInterstitialTitle('Just a moment... (fixture)')).toBe(true);
    expect(isInterstitialTitle('  Checking your browser before accessing')).toBe(true);
    expect(isInterstitialTitle('Tunggu sebentar...')).toBe(true);
    // Interstitial Cloudflare berkotak centang Turnstile (diamati dari agent-vm, 2026-11-10).
    expect(isInterstitialTitle('Performing security verification')).toBe(true);
    expect(isInterstitialTitle('Performing security verification (fixture)')).toBe(true);
    expect(isInterstitialTitle('Verify you are human')).toBe(true);
    expect(isInterstitialTitle('Cek Pajak Kendaraan')).toBe(false);
    expect(isInterstitialTitle('Panduan: just a moment')).toBe(false);
  });

  it('tantangan (bisa diselesaikan warga) dibedakan dari blokir keras', () => {
    expect(detectBotWall({ status: 403, headers: { 'cf-mitigated': 'block' } })).toBe('cloudflare-block');
    expect(wallBisaDiverifikasi('cloudflare-challenge')).toBe(true);
    expect(wallBisaDiverifikasi('ddos-guard')).toBe(true);
    for (const n of ['cloudflare-block', 'imperva', 'akamai', 'f5-asm', 'rate-limit', 'generic-bot'])
      expect(wallBisaDiverifikasi(n)).toBe(false);
  });
});

describe('verifikasi situs: mesin status', () => {
  const A = 'https://oss.go.id/cari?__cf_chl_tk=1';
  const B = 'https://oss.go.id/formulir';
  const T0 = 1_000_000;

  it('muncul -> masih -> lolos; tanpa tantangan tidak ada apa-apa', () => {
    const p = createPantauTantangan();
    expect(p.amati(false, 0, A, T0)).toBe('tidak_ada');
    expect(p.amati(true, 1, A, T0)).toBe('mulai');
    expect(p.aktif).toBe(true);
    expect(p.amati(true, 1, A, T0 + 500)).toBe('masih');
    expect(p.amati(false, 2, A, T0 + 900)).toBe('lolos');
    expect(p.aktif).toBe(false);
    expect(p.gagal).toBe(0);
  });

  it('tantangan dimuat ulang dua kali (gagal/berulang) -> gagal, lalu tetap gagal', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1, A, T0)).toBe('mulai');
    expect(p.amati(true, 2, A, T0 + 1_000)).toBe('ulang');
    expect(p.gagal).toBe(1);
    expect(p.amati(true, 2, A, T0 + 2_000)).toBe('masih');
    expect(p.amati(true, 3, A, T0 + 3_000)).toBe('gagal');
    expect(p.amati(false, 4, A, T0 + 4_000)).toBe('gagal');
  });

  it('mulai -> lolos -> muncul lagi CEPAT di halaman yang sama (loop) = kegagalan', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1, A, T0)).toBe('mulai');
    expect(p.amati(false, 2, A, T0 + 3_000)).toBe('lolos');
    // Query beda (token tantangan) tetap halaman yang sama.
    expect(p.amati(true, 3, 'https://oss.go.id/cari', T0 + 5_000)).toBe('ulang');
    expect(p.gagal).toBe(1);
    expect(p.amati(false, 4, A, T0 + 6_000)).toBe('lolos');
    expect(p.amati(true, 5, A, T0 + 6_000 + JENDELA_ULANG_MS)).toBe('gagal');
  });

  it('mulai -> lolos -> muncul di halaman LAIN setelah jendela lewat = tantangan baru, bukan kegagalan', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1, A, T0)).toBe('mulai');
    expect(p.amati(false, 2, A, T0 + 3_000)).toBe('lolos');
    expect(p.amati(true, 7, B, T0 + 3_000 + JENDELA_ULANG_MS + 1)).toBe('mulai');
    expect(p.gagal).toBe(0);
    expect(p.aktif).toBe(true);
    // Tantangan baru itu punya jatah kegagalannya sendiri (dua kali tolak berturut-turut baru dipandu).
    expect(p.amati(true, 8, B, T0 + 20_000)).toBe('ulang');
    expect(p.amati(true, 9, B, T0 + 21_000)).toBe('gagal');
  });

  it('halaman lain dalam jendela, atau halaman sama setelah jendela lewat: juga tantangan baru', () => {
    const p = createPantauTantangan(2);
    p.amati(true, 1, A, T0);
    p.amati(false, 2, A, T0 + 1_000);
    expect(p.amati(true, 3, B, T0 + 2_000)).toBe('mulai');
    p.amati(false, 4, B, T0 + 3_000);
    expect(p.amati(true, 5, B, T0 + 3_000 + JENDELA_ULANG_MS + 1)).toBe('mulai');
    expect(p.gagal).toBe(0);
  });
});

describe('verifikasi situs: muat ulang tantangan tanpa sentuhan warga (QA prod 2026-11-12 Wonogiri)', () => {
  const W = 'https://telunjuksakti.wonogirikab.go.id/';
  const T0 = 2_000_000;

  it('situs memuat ulang tantangannya sendiri: kesempatan warga tidak berkurang, kotak disorot ulang', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1, W, T0)).toBe('mulai');
    // Cloudflare mengulang tantangan terkelola dua kali tanpa ketukan warga: dulu = dipandu (gagal) dalam 50 dtk.
    expect(p.amati(true, 2, W, T0 + 20_000, false)).toBe('mulai');
    expect(p.amati(true, 3, W, T0 + 45_000, false)).toBe('mulai');
    expect(p.gagal).toBe(0);
    // Warga mengetuk kotaknya lalu situs menolak (dimuat ulang): baru dihitung gagal.
    expect(p.amati(true, 4, W, T0 + 60_000, true)).toBe('ulang');
    expect(p.amati(true, 5, W, T0 + 80_000, true)).toBe('gagal');
  });

  it('tantangan yang terus diulang situs tanpa lolos: dipandu sesudah BATAS_TANTANGAN_MS, bukan menunggu selamanya', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1, W, T0)).toBe('mulai');
    expect(p.amati(true, 2, W, T0 + 60_000, false)).toBe('mulai');
    expect(p.amati(true, 2, W, T0 + BATAS_TANTANGAN_MS - 1)).toBe('masih');
    expect(p.amati(true, 2, W, T0 + BATAS_TANTANGAN_MS)).toBe('gagal');
  });

  it('lolos lalu tantangan baru: episode dan batas waktunya mulai dari nol', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1, W, T0)).toBe('mulai');
    expect(p.amati(false, 2, W, T0 + BATAS_TANTANGAN_MS - 5_000)).toBe('lolos');
    expect(p.amati(true, 3, `${W}lain`, T0 + BATAS_TANTANGAN_MS + 60_000)).toBe('mulai');
    expect(p.amati(true, 3, `${W}lain`, T0 + BATAS_TANTANGAN_MS + 61_000)).toBe('masih');
  });
});
