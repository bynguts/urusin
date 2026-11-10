import { DEFAULT_KUOTA } from '@urusin/akun';
import { describe, expect, it } from 'vitest';
import {
  peringatanKuotaJuri,
  peringatanTurnstile,
  TURNSTILE_SITEVERIFY,
  TURNSTILE_TOKEN_FIXTURE,
  turnstileFromEnv,
} from './turnstile';

describe('turnstileFromEnv', () => {
  it('placeholder .env.example = nonaktif', () => {
    const env = {
      TURNSTILE_SITE_KEY: 'ganti-dengan-site-key',
      TURNSTILE_SECRET_KEY: 'ganti-dengan-secret-key',
    };
    expect(turnstileFromEnv(env).mode).toBe('nonaktif');
  });

  it('nonaktif tanpa konfigurasi: tidak pernah lolos', async () => {
    const t = turnstileFromEnv({});
    const lolos = await t.verifikasi(TURNSTILE_TOKEN_FIXTURE, '1.2.3.4');
    expect([t.mode, t.siteKey, lolos]).toEqual(['nonaktif', '', false]);
  });

  it('fixture hanya menerima token uji dan ditolak di produksi', async () => {
    const t = turnstileFromEnv({ URUSIN_TURNSTILE_FIXTURE: '1' });
    expect(t.mode).toBe('fixture');
    expect(await t.verifikasi(TURNSTILE_TOKEN_FIXTURE, 'ip')).toBe(true);
    expect(await t.verifikasi('lain', 'ip')).toBe(false);
    expect(() => turnstileFromEnv({ URUSIN_TURNSTILE_FIXTURE: '1', NODE_ENV: 'production' })).toThrow(
      /produksi/,
    );
  });

  it('cloudflare: siteverify lewat fetch egress; gagal jaringan/respons = ditolak', async () => {
    const panggilan: { url: string; body: string }[] = [];
    let jawab: () => Promise<Response> = async () => Response.json({ success: true });
    const fetchUji = async (url: string, init: RequestInit) => {
      panggilan.push({ url, body: String(init.body) });
      return jawab();
    };
    const t = turnstileFromEnv(
      { TURNSTILE_SECRET_KEY: 'rahasia', TURNSTILE_SITE_KEY: 'situs' },
      fetchUji as never,
    );
    expect([t.mode, t.siteKey]).toEqual(['cloudflare', 'situs']);
    expect(await t.verifikasi('tok', '1.2.3.4')).toBe(true);
    expect(panggilan[0]!.url).toBe(TURNSTILE_SITEVERIFY);
    expect(Object.fromEntries(new URLSearchParams(panggilan[0]!.body))).toEqual({
      secret: 'rahasia',
      response: 'tok',
      remoteip: '1.2.3.4',
    });
    expect(await t.verifikasi(undefined, 'ip')).toBe(false);
    expect(await t.verifikasi('x'.repeat(5000), 'ip')).toBe(false);
    jawab = async () => Response.json({ success: false });
    expect(await t.verifikasi('tok', 'ip')).toBe(false);
    jawab = async () => new Response('x', { status: 500 });
    expect(await t.verifikasi('tok', 'ip')).toBe(false);
    jawab = async () => {
      throw new Error('jaringan');
    };
    expect(await t.verifikasi('tok', 'ip')).toBe(false);
    expect(panggilan).toHaveLength(4);
  });

  it('produksi: kunci rahasia tanpa site key ditolak saat start (widget juri tidak bisa dirender)', () => {
    expect(() => turnstileFromEnv({ TURNSTILE_SECRET_KEY: 'rahasia', NODE_ENV: 'production' })).toThrow(
      /TURNSTILE_SITE_KEY/,
    );
    const t = turnstileFromEnv({
      TURNSTILE_SECRET_KEY: 'rahasia',
      TURNSTILE_SITE_KEY: 'situs',
      NODE_ENV: 'production',
    });
    expect([t.mode, t.siteKey]).toEqual(['cloudflare', 'situs']);
  });
});

describe('peringatanTurnstile (review delta 53fff2d)', () => {
  it('alert operator hanya bila nonaktif di produksi (bukan CI); mode aktif atau dev diam', () => {
    const nonaktif = turnstileFromEnv({});
    expect(peringatanTurnstile(nonaktif, { NODE_ENV: 'production' })).toMatch(
      /Turnstile nonaktif di produksi/,
    );
    expect(peringatanTurnstile(nonaktif, { NODE_ENV: 'production', CI: 'true' })).toBeNull();
    expect(peringatanTurnstile(nonaktif, {})).toBeNull();
    const aktif = turnstileFromEnv({ TURNSTILE_SECRET_KEY: 'kunci-uji-rahasia' });
    expect(peringatanTurnstile(aktif, { NODE_ENV: 'production' })).toBeNull();
  });
});

describe('peringatanKuotaJuri: produksi tanpa Turnstile, 4 IP bisa menghabiskan batas global juri', () => {
  it('alert bila per IP × 4 ≥ global; bawaan aman; Turnstile aktif, dev, dan CI diam', () => {
    const prod = { NODE_ENV: 'production' };
    const nonaktif = turnstileFromEnv({});
    expect(peringatanKuotaJuri(nonaktif, { demoPerIpHari: 50, demoAktifMaks: 200 }, prod)).toMatch(
      /URUSIN_DEMO_PER_IP_HARI=50 × 4 IP ≥ URUSIN_DEMO_AKTIF_MAKS=200/,
    );
    expect(peringatanKuotaJuri(nonaktif, DEFAULT_KUOTA, prod)).toBeNull();
    expect(peringatanKuotaJuri(nonaktif, { demoPerIpHari: 50, demoAktifMaks: 200 }, {})).toBeNull();
    expect(
      peringatanKuotaJuri(nonaktif, { demoPerIpHari: 50, demoAktifMaks: 200 }, { ...prod, CI: 'true' }),
    ).toBeNull();
    const aktif = turnstileFromEnv({ TURNSTILE_SECRET_KEY: 'kunci-uji-rahasia' });
    expect(peringatanKuotaJuri(aktif, { demoPerIpHari: 50, demoAktifMaks: 200 }, prod)).toBeNull();
  });
});
