import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { css, fill, gate, nav, upload, urlIncludes } from '@urusin/core';
import { describe, expect, it } from 'vitest';
import { chromiumArgs, pidsOfProfile, PROFIL_PREFS, proxyOption, pssMb, stepLabel } from './browser.js';
import { loadConfig } from './config.js';
import { createTouchMapper, toCdp } from './input.js';
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

describe('profil sementara', () => {
  it('pengelola sandi, autofill, kamera/mikrofon mati; breakpad mati', () => {
    expect(PROFIL_PREFS).toMatchObject({
      credentials_enable_service: false,
      profile: {
        password_manager_enabled: false,
        default_content_setting_values: { media_stream_camera: 2 },
      },
      autofill: { enabled: false, profile_enabled: false, credit_card_enabled: false },
    });
    expect(chromiumArgs({ jsHeapMb: 1 })).toEqual(
      expect.arrayContaining(['--disable-breakpad', '--deny-permission-prompts']),
    );
  });

  it('pidsOfProfile: proses utama dari --user-data-dir lalu semua turunannya', () => {
    const proc = mkdtempSync(join(tmpdir(), 'proc-'));
    const mk = (pid: number, ppid: number, cmd: string[]) => {
      mkdirSync(join(proc, String(pid)));
      writeFileSync(join(proc, String(pid), 'stat'), `${pid} (chrome (x)) S ${ppid} 1 1`);
      writeFileSync(join(proc, String(pid), 'cmdline'), cmd.join('\0'));
    };
    try {
      mk(10, 1, ['chrome', '--user-data-dir=/tmp/p1']);
      mk(11, 10, ['chrome', '--type=zygote']);
      mk(12, 11, ['chrome', '--type=renderer']);
      mk(20, 1, ['chrome', '--user-data-dir=/tmp/p2']);
      mk(21, 20, ['chrome', '--type=renderer']);
      mkdirSync(join(proc, 'self'));
      mkdirSync(join(proc, '99')); // proses keluar di tengah pemindaian
      expect(pidsOfProfile('/tmp/p1', proc).sort()).toEqual([10, 11, 12]);
      expect(pidsOfProfile('/tmp/tidak-ada', proc)).toEqual([]);
    } finally {
      rmSync(proc, { recursive: true, force: true });
    }
  });
});

describe('pemetaan input ke CDP', () => {
  it('sentuh -> klik MOUSE di titik sentuh (sampai ke iframe lintas-origin); geser -> gulir', () => {
    const tap = { type: 'pointer', aksi: 'down', x: 5, y: 6, jenis: 'touch', tombol: 'left' } as const;
    const t = createTouchMapper();
    expect(toCdp(tap, t)).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseMoved', x: 5, y: 6, button: 'none', buttons: 0, clickCount: 0, modifiers: 0 },
      },
    ]);
    expect(toCdp({ ...tap, aksi: 'move', x: 7, y: 7 }, t)).toEqual([]); // di bawah slop: tetap ketukan
    const up = toCdp({ ...tap, aksi: 'up', x: 7, y: 7 }, t).map((c) => c.params);
    expect(up.map((p) => p.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(up[1]).toMatchObject({ x: 5, y: 6, button: 'left', buttons: 1, clickCount: 1 });
    expect(up[2]).toMatchObject({ x: 5, y: 6, button: 'left', clickCount: 1 });
    expect(JSON.stringify(up)).not.toContain('Touch');
    // Geser: gulir sebesar perpindahan jari (arah halaman berlawanan), tanpa klik saat diangkat.
    toCdp({ ...tap, y: 300 }, t);
    expect(toCdp({ ...tap, aksi: 'move', y: 250 }, t)[0]?.params).toMatchObject({
      type: 'mouseWheel',
      deltaY: 50,
    });
    expect(toCdp({ ...tap, aksi: 'move', y: 240 }, t)[0]?.params).toMatchObject({ deltaY: 10 });
    expect(toCdp({ ...tap, aksi: 'up', y: 240 }, t)).toEqual([]);
    expect(toCdp({ ...tap, aksi: 'move' }, t)).toEqual([]); // tanpa down
    expect(toCdp({ ...tap, aksi: 'up' }, t)).toEqual([]);
    toCdp(tap, t);
    expect(toCdp({ ...tap, aksi: 'cancel' }, t)).toEqual([]);
    expect(toCdp({ ...tap, aksi: 'up' }, t)).toEqual([]);
  });

  it('mouse dan pena tetap mouse; cancel mouse diabaikan', () => {
    const tap = { type: 'pointer', aksi: 'down', x: 5, y: 6, jenis: 'mouse', tombol: 'left' } as const;
    expect(toCdp(tap)[0]).toMatchObject({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
    });
    expect(toCdp({ ...tap, aksi: 'move', tombol: 'none' })[0]?.params).toMatchObject({
      type: 'mouseMoved',
      button: 'none',
      buttons: 0,
      clickCount: 0,
    });
    expect(toCdp({ ...tap, jenis: 'pen', aksi: 'up', tombol: 'none', klik: 2 })[0]?.params).toMatchObject({
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      clickCount: 2,
      pointerType: 'pen',
    });
    expect(toCdp({ ...tap, aksi: 'cancel' })).toEqual([]);
  });

  it('roda, teks (insertText), Enter dengan teks \\r, tombol khusus ber-kode virtual', () => {
    expect(toCdp({ type: 'wheel', x: 1, y: 2, dx: 0, dy: 100 })[0]?.params).toMatchObject({
      type: 'mouseWheel',
      deltaY: 100,
    });
    expect(toCdp({ type: 'text', teks: 'DEV123' })).toEqual([
      { method: 'Input.insertText', params: { text: 'DEV123' } },
    ]);
    expect(toCdp({ type: 'key', aksi: 'down', key: 'Enter', code: 'Enter' })[0]?.params).toMatchObject({
      type: 'keyDown',
      text: '\r',
      windowsVirtualKeyCode: 13,
    });
    expect(
      toCdp({ type: 'key', aksi: 'down', key: 'Backspace', code: 'Backspace', mod: 2 })[0]?.params,
    ).toMatchObject({
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 8,
      modifiers: 2,
    });
    expect(toCdp({ type: 'key', aksi: 'up', key: 'a', code: 'KeyA' })[0]?.params).not.toHaveProperty(
      'windowsVirtualKeyCode',
    );
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

  it('pssMb: jumlah PSS (bukan RSS ganda), jatuh ke VmRSS, proses hilang = 0, non-Linux = undefined', () => {
    const proc = mkdtempSync(join(tmpdir(), 'proc-'));
    try {
      mkdirSync(join(proc, '10'));
      writeFileSync(join(proc, '10', 'smaps_rollup'), 'Rss:  409600 kB\nPss:  102400 kB\n');
      writeFileSync(join(proc, '10', 'status'), 'VmRSS:  409600 kB\n');
      mkdirSync(join(proc, '11'));
      writeFileSync(join(proc, '11', 'status'), 'VmRSS:  51200 kB\n');
      expect(pssMb([10], proc, 'linux')).toBe(100);
      expect(pssMb([10, 11, 12], proc, 'linux')).toBe(150);
      expect(pssMb([10], proc, 'win32')).toBeUndefined();
    } finally {
      rmSync(proc, { recursive: true, force: true });
    }
  });
});
