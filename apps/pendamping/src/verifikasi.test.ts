import { describe, expect, it } from 'vitest';
import { createPantauTantangan, isChallengeFrameUrl, isInterstitialTitle } from './verifikasi.js';
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
  it('muncul -> masih -> lolos; tanpa tantangan tidak ada apa-apa', () => {
    const p = createPantauTantangan();
    expect(p.amati(false, 0)).toBe('tidak_ada');
    expect(p.amati(true, 1)).toBe('mulai');
    expect(p.aktif).toBe(true);
    expect(p.amati(true, 1)).toBe('masih');
    expect(p.amati(false, 2)).toBe('lolos');
    expect(p.aktif).toBe(false);
    expect(p.gagal).toBe(0);
  });

  it('tantangan dimuat ulang dua kali (gagal/berulang) -> gagal, lalu tetap gagal', () => {
    const p = createPantauTantangan(2);
    expect(p.amati(true, 1)).toBe('mulai');
    expect(p.amati(true, 2)).toBe('ulang');
    expect(p.gagal).toBe(1);
    expect(p.amati(true, 2)).toBe('masih');
    expect(p.amati(true, 3)).toBe('gagal');
    expect(p.amati(false, 4)).toBe('gagal');
  });

  it('tantangan muncul lagi setelah lolos (loop) dihitung kegagalan', () => {
    const p = createPantauTantangan(2);
    p.amati(true, 1);
    expect(p.amati(false, 2)).toBe('lolos');
    expect(p.amati(true, 3)).toBe('ulang');
    expect(p.amati(false, 4)).toBe('lolos');
    expect(p.amati(true, 5)).toBe('gagal');
  });
});
