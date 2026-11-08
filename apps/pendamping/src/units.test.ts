import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { css, fill, gate, nav, upload, urlIncludes } from '@urusin/core';
import { describe, expect, it } from 'vitest';
import { chromiumArgs, proxyOption, rssMb, stepLabel } from './browser.js';
import { loadConfig } from './config.js';
import { toCdp } from './input.js';
import { runnerExpression, runnerScript, toInjectable } from './runner-script.js';
import { detectBotWall, suspicious } from './waf.js';

describe('config', () => {
  it('default aman: 127.0.0.1:4330, 2 sesi, TTL 15 menit, idle 3 menit, headed, dev/debug mati', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      host: '127.0.0.1',
      port: 4330,
      maxSessions: 2,
      ttlMs: 900_000,
      idleMs: 180_000,
      devPage: false,
      ticketTtlMs: 30_000,
      haloTimeoutMs: 5_000,
      msgPerDetik: 200,
      fps: 8,
      frameInflight: 2,
      wsBufferBytes: 131_072,
      sessionMemMb: 450,
      headless: false,
      debugToken: undefined,
      upstreamProxy: undefined,
    });
  });

  it('HOST wildcard ditolak; headless hanya dengan fixture di luar produksi', () => {
    for (const HOST of ['0.0.0.0', '::', '', '[::]']) expect(() => loadConfig({ HOST })).toThrow(/HOST/);
    expect(loadConfig({ HOST: '100.101.102.103' }).host).toBe('100.101.102.103');
    expect(() => loadConfig({ PENDAMPING_HEADLESS: '1' })).toThrow(/HEADLESS/);
    expect(
      loadConfig({ PENDAMPING_HEADLESS: '1', PENDAMPING_FIXTURE_ORIGINS: 'http://127.0.0.1:4320' }).headless,
    ).toBe(true);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        PENDAMPING_INTERNAL_TOKEN: 'x'.repeat(40),
        URUSIN_PUBLIC_ORIGIN: 'https://urusinai.web.id',
        PENDAMPING_FIXTURE_ORIGINS: 'https://fixtures.urusinai.web.id',
        PENDAMPING_HEADLESS: '1',
      }),
    ).toThrow(/HEADLESS/);
  });

  it('proxy hulu hanya http://host:port; token debug >= 32 karakter', () => {
    expect(loadConfig({ PENDAMPING_UPSTREAM_PROXY: 'http://u:p@10.0.0.5:3128' }).upstreamProxy?.host).toBe(
      '10.0.0.5:3128',
    );
    for (const v of ['https://x:1', 'http://x:1/path', 'socks5://x:1'])
      expect(() => loadConfig({ PENDAMPING_UPSTREAM_PROXY: v })).toThrow(/UPSTREAM/);
    expect(() => loadConfig({ PENDAMPING_DEBUG_TOKEN: 'pendek' })).toThrow(/DEBUG/);
    expect(loadConfig({ PENDAMPING_DEBUG_TOKEN: 'd'.repeat(32) }).debugToken).toBe('d'.repeat(32));
    expect(loadConfig({ PENDAMPING_FPS: '999', PENDAMPING_MSG_PER_DETIK: '1' })).toMatchObject({
      fps: 30,
      msgPerDetik: 10,
    });
  });

  it('produksi wajib token panjang + origin; override harus ke fixture terdaftar; halaman dev tetap mati', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/TOKEN/);
    expect(() => loadConfig({ NODE_ENV: 'production', PENDAMPING_INTERNAL_TOKEN: 'x'.repeat(40) })).toThrow(
      /ORIGINS/,
    );
    const c = loadConfig({
      NODE_ENV: 'production',
      PENDAMPING_INTERNAL_TOKEN: 'x'.repeat(40),
      URUSIN_PUBLIC_ORIGIN: 'https://urusinai.web.id',
      PENDAMPING_DEV_PAGE: '1',
      PENDAMPING_FIXTURE_ORIGINS: 'https://fixtures.urusinai.web.id',
      PENDAMPING_ORIGIN_OVERRIDES: 'https://telunjuksakti.wonogirikab.go.id=https://fixtures.urusinai.web.id',
    });
    expect(c.devPage).toBe(false);
    expect(c.allowedOrigins).toEqual(['https://urusinai.web.id']);
    expect(c.originOverrides.get('https://telunjuksakti.wonogirikab.go.id')).toBe(
      'https://fixtures.urusinai.web.id',
    );
    expect(() =>
      loadConfig({ PENDAMPING_ORIGIN_OVERRIDES: 'https://a.go.id=http://127.0.0.1:4320' }),
    ).toThrow(/FIXTURE/);
    expect(() => loadConfig({ PENDAMPING_ORIGIN_OVERRIDES: 'rusak' })).toThrow(/rusak/);
    expect(() => loadConfig({ PENDAMPING_ALLOWED_ORIGINS: 'https://a.id/path' })).toThrow(/origin/);
    expect(loadConfig({ PENDAMPING_DEV_PAGE: '1' }).devPage).toBe(true);
  });
});

describe('proxy peramban', () => {
  it('loopback tidak dikecualikan dari proxy (<-loopback>) dan env pemati Playwright dihapus', () => {
    expect(proxyOption(5555)).toEqual({ server: 'http://127.0.0.1:5555', bypass: '<-loopback>' });
    expect(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK).toBeUndefined();
    expect(chromiumArgs({ jsHeapMb: 1 })).toContain(
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    );
  });
});

describe('pemetaan input ke CDP', () => {
  it('sentuh -> touch event (ponsel), mouse di desktop; cancel mouse diabaikan', () => {
    const tap = { type: 'pointer', aksi: 'down', x: 5, y: 6, jenis: 'touch', tombol: 'left' } as const;
    expect(toCdp(tap, { touch: true })).toEqual([
      {
        method: 'Input.dispatchTouchEvent',
        params: { type: 'touchStart', touchPoints: [{ x: 5, y: 6 }], modifiers: 0 },
      },
    ]);
    expect(toCdp({ ...tap, aksi: 'up' }, { touch: true })[0]?.params).toMatchObject({
      type: 'touchEnd',
      touchPoints: [],
    });
    expect(toCdp({ ...tap, aksi: 'down' }, { touch: false })[0]).toMatchObject({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
    });
    expect(
      toCdp({ ...tap, jenis: 'mouse', aksi: 'move', tombol: 'none' }, { touch: false })[0]?.params,
    ).toMatchObject({
      type: 'mouseMoved',
      button: 'none',
      buttons: 0,
      clickCount: 0,
    });
    expect(
      toCdp({ ...tap, jenis: 'pen', aksi: 'up', tombol: 'none', klik: 2 }, { touch: false })[0]?.params,
    ).toMatchObject({
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      clickCount: 2,
      pointerType: 'pen',
    });
    expect(toCdp({ ...tap, jenis: 'mouse', aksi: 'cancel' }, { touch: false })).toEqual([]);
  });

  it('roda, teks (insertText), Enter dengan teks \\r, tombol khusus ber-kode virtual', () => {
    expect(toCdp({ type: 'wheel', x: 1, y: 2, dx: 0, dy: 100 }, { touch: false })[0]?.params).toMatchObject({
      type: 'mouseWheel',
      deltaY: 100,
    });
    expect(toCdp({ type: 'text', teks: 'DEV123' }, { touch: false })).toEqual([
      { method: 'Input.insertText', params: { text: 'DEV123' } },
    ]);
    expect(
      toCdp({ type: 'key', aksi: 'down', key: 'Enter', code: 'Enter' }, { touch: false })[0]?.params,
    ).toMatchObject({
      type: 'keyDown',
      text: '\r',
      windowsVirtualKeyCode: 13,
    });
    expect(
      toCdp({ type: 'key', aksi: 'down', key: 'Backspace', code: 'Backspace', mod: 2 }, { touch: false })[0]
        ?.params,
    ).toMatchObject({
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 8,
      modifiers: 2,
    });
    expect(
      toCdp({ type: 'key', aksi: 'up', key: 'a', code: 'KeyA' }, { touch: false })[0]?.params,
    ).not.toHaveProperty('windowsVirtualKeyCode');
  });
});

describe('deteksi WAF / bot wall', () => {
  it('menandai tantangan Cloudflare, Imperva, header cf-mitigated, dan 429', () => {
    expect(detectBotWall({ status: 403, headers: {}, body: '<title>Just a moment...</title>' })).toBe(
      'cloudflare-challenge',
    );
    expect(detectBotWall({ status: 200, headers: { 'cf-mitigated': 'challenge' } })).toBe(
      'cloudflare-mitigated',
    );
    expect(
      detectBotWall({ status: 403, headers: {}, body: 'Request unsuccessful. Incapsula incident ID: 1' }),
    ).toBe('imperva');
    expect(detectBotWall({ status: 429, headers: {} })).toBe('rate-limit');
    expect(detectBotWall({ status: 503, headers: {}, body: 'Sucuri WebSite Firewall' })).toBe('sucuri');
  });

  it('halaman login ber-CAPTCHA biasa dan 404 bukan bot wall', () => {
    expect(detectBotWall({ status: 200, headers: {}, body: 'Masukkan kode CAPTCHA' })).toBeNull();
    expect(detectBotWall({ status: 403, headers: {}, body: 'Anda belum login' })).toBeNull();
    expect(suspicious({ status: 404, headers: {} })).toBe(false);
    expect(suspicious({ status: 200, headers: { 'CF-Mitigated': 'x' } })).toBe(true);
  });
});

describe('skrip runner untuk isolated world', () => {
  it('modul runner-ops dari executor dibungkus menjadi ekspresi mandiri yang bisa dievaluasi', () => {
    const src = runnerScript();
    expect(src).not.toMatch(/^\s*(import|export)\s/m);
    const api = runInNewContext(src, {}) as { runOp: unknown };
    expect(typeof api.runOp).toBe('function');
    expect(runnerExpression({ kind: 'count', target: [] })).toContain('"kind":"count"');
  });

  it('menolak modul dengan impor runtime atau ekspor tak dikenal', () => {
    expect(() => toInjectable("import x from 'y';\nexport function runOp() {}")).toThrow(/impor/);
    expect(() => toInjectable('export default 1;')).toThrow(/ekspor/);
    const real = readFileSync(fileURLToPath(import.meta.resolve('@urusin/executor/runner-ops')), 'utf8');
    expect(toInjectable(real)).toContain('return { runOp }');
  });
});

describe('peramban: utilitas', () => {
  it('label langkah tanpa nilai isian', () => {
    expect(stepLabel(nav('/x'))).toBe('Membuka halaman');
    expect(stepLabel(fill([{ by: 'label', value: 'Nomor HP' }], '{{PEMOHON.HP}}'))).toBe('Mengisi Nomor HP');
    expect(stepLabel(fill(css('#hp'), '0812'))).toBe('Mengisi kolom');
    expect(stepLabel(upload(css('#f'), '{{FILE:a}}'))).toBe('Mengunggah berkas');
    expect(stepLabel(gate.human('x', { until: urlIncludes('/a') }))).toBe('Giliran Anda');
    expect(stepLabel({ op: 'select', target: [css('#s')], value: 'a', effect: 'input' })).toBe(
      'Memilih kolom',
    );
    expect(stepLabel({ op: 'click', target: [css('#s')], effect: 'read' })).toBe('Menekan tombol');
    expect(
      stepLabel({ op: 'click', target: [css('#s')], effect: 'write', verify: urlIncludes('/a') }),
    ).toMatch(/bukan pengiriman akhir/);
    expect(stepLabel({ op: 'extract', mode: 'text', target: [css('#s')], into: 'x', effect: 'read' })).toBe(
      'Membaca data',
    );
    expect(stepLabel({ op: 'verify', check: urlIncludes('/a'), effect: 'read' })).toBe('Memeriksa halaman');
    expect(stepLabel(undefined)).toBe('Selesai');
  });

  it('flag Chromium: tanpa stealth, DNS hanya lewat proxy, WebRTC non-proxy mati, heap dibatasi', () => {
    const args = chromiumArgs({ jsHeapMb: 256 });
    expect(args).toContain('--js-flags=--max-old-space-size=256');
    expect(args.some((a) => a.startsWith('--host-resolver-rules=MAP * ~NOTFOUND'))).toBe(true);
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(args.join(' ')).not.toMatch(/stealth|AutomationControlled|user-agent/i);
  });

  it('rssMb: undefined di luar Linux, angka di Linux', () => {
    const r = rssMb([process.pid]);
    if (process.platform === 'linux') expect(r).toBeGreaterThan(0);
    else expect(r).toBeUndefined();
  });
});
