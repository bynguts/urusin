import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PendampingSorot, PendampingViewport } from '@urusin/contracts';
import { egressAllowedHosts, type Step } from '@urusin/core';
import {
  checkUrl,
  finalGateIndex,
  Interpreter,
  type Cursor,
  type Driver,
  type KV,
  type RunnerOp,
  type RunnerResult,
} from '@urusin/executor';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import type { Config } from './config.js';
import { egressRules, startEgressProxy, type EgressProxy } from './egress.js';
import { createTouchMapper, FOKUS_EXPR, toCdp } from './input.js';
import { runnerExpression } from './runner-script.js';
import type { ActiveRun, Frame, JenisFokus, RunFactory, RunInit } from './sessions.js';
import { detectBotWall, suspicious } from './waf.js';

/**
 * Satu sesi = satu proses Chromium (headless, profil sementara non-persisten) di belakang proxy egress
 * sendiri. Tidak ada stealth/anti-deteksi: agen pengguna bawaan Chromium, flag otomasi bawaan Playwright.
 * Frame screencast hanya diteruskan ke perangkat warga, tidak pernah disimpan atau dicatat.
 */

const memoryKV = (): KV => {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  };
};

const INTERRUPTED_RE =
  /Execution context was destroyed|Cannot find context|Inspected target navigated|Target closed|Frame .* detached|No frame/i;
const MUTATING: ReadonlySet<RunnerOp['kind']> = new Set(['step', 'upload', 'consent']);

export function stepLabel(step: Step | undefined): string {
  if (!step) return 'Selesai';
  const t = 'target' in step ? step.target[0] : undefined;
  const nama = t && t.by !== 'css' ? t.value : 'kolom';
  switch (step.op) {
    case 'nav':
      return 'Membuka halaman';
    case 'fill':
      return `Mengisi ${nama}`;
    case 'select':
      return `Memilih ${nama}`;
    case 'upload':
      return 'Mengunggah berkas';
    case 'click':
      return step.effect === 'write' ? 'Mengirim langkah (bukan pengiriman akhir)' : 'Menekan tombol';
    case 'extract':
      return 'Membaca data';
    case 'gate.human':
      return 'Giliran Anda';
    default:
      return 'Memeriksa halaman';
  }
}

/**
 * Memori (MB) proses-proses Chromium sebuah sesi sebagai jumlah PSS (/proc/<pid>/smaps_rollup): halaman
 * bersama (biner Chromium, pustaka, memori bersama antarproses) dibagi rata, jadi tidak terhitung berkali-kali
 * seperti jumlah VmRSS (yang membesar ~2x dan membuat pengawas membunuh sesi sehat). Kernel tanpa
 * smaps_rollup jatuh ke VmRSS. Linux saja; selain itu undefined.
 */
export function pssMb(pids: number[], proc = '/proc', platform = process.platform): number | undefined {
  if (platform !== 'linux') return undefined;
  let kb = 0;
  for (const pid of pids) {
    try {
      const m = /^Pss:\s+(\d+)\s+kB/m.exec(readFileSync(`${proc}/${pid}/smaps_rollup`, 'utf8'));
      if (m) {
        kb += Number(m[1]);
        continue;
      }
    } catch {
      // smaps_rollup tidak ada/terbaca: pakai VmRSS
    }
    try {
      const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`${proc}/${pid}/status`, 'utf8'));
      kb += Number(m?.[1] ?? 0);
    } catch {
      // proses sudah keluar
    }
  }
  return Math.round(kb / 1024);
}

export function chromiumArgs(config: Pick<Config, 'jsHeapMb'>): string[] {
  return [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-quic',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
    // Tanpa laporan crash (bisa memuat isi memori/halaman) dan tanpa prompt izin yang tak terlihat warga.
    '--disable-breakpad',
    '--deny-permission-prompts',
    '--password-store=basic',
    '--renderer-process-limit=2',
    `--js-flags=--max-old-space-size=${config.jsHeapMb}`,
    // WebRTC hanya lewat proxy: UDP langsung (bisa melewati allowlist) dimatikan.
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    // Chromium tidak me-resolve DNS sendiri: semua nama host hanya di-resolve proxy egress.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
  ];
}

/**
 * Semua lalu lintas (termasuk loopback) lewat proxy egress. Chromium secara bawaan MELEWATI proxy untuk
 * localhost/127.0.0.1; `<-loopback>` mencabut pengecualian itu sehingga loopback ikut ke proxy dan ditolak.
 * Playwright juga menambahkannya kecuali env PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK diset:
 * env itu dihapus saat modul dimuat agar perilaku ini tidak bisa dimatikan dari luar.
 */
export function proxyOption(port: number): { server: string; bypass: string } {
  return { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' };
}
delete process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK;

async function sessionMemMb(userDataDir: string, cdp: CDPSession): Promise<number> {
  const pss = pssMb(pidsOfProfile(userDataDir));
  if (pss !== undefined && pss > 0) return pss;
  const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  return Math.round(heap.usedSize / 1024 / 1024);
}

export function createBrowserFactory(config: Config): RunFactory {
  return (init) => startBrowserRun(config, init);
}

export type Isolated = {
  context: BrowserContext;
  proxy: EgressProxy;
  /** Profil sementara sesi (tmpfs di kontainer); dihapus total oleh `close()`. */
  userDataDir: string;
  close(): Promise<void>;
};

/**
 * Preferensi profil: pengelola sandi, autofill, dan izin perangkat dimatikan sejak awal agar tidak ada
 * residu kredensial (Login Data/Web Data kosong) walau profil hanya hidup selama sesi.
 */
export const PROFIL_PREFS = Object.freeze({
  credentials_enable_service: false,
  credentials_enable_autosignin: false,
  profile: {
    password_manager_enabled: false,
    password_manager_leak_detection: false,
    // 2 = blokir: peramban server tidak punya kamera/mikrofon/lokasi; langkah foto dilakukan di perangkat warga.
    default_content_setting_values: {
      media_stream_camera: 2,
      media_stream_mic: 2,
      geolocation: 2,
      notifications: 2,
    },
  },
  autofill: { enabled: false, profile_enabled: false, credit_card_enabled: false },
  search: { suggest_enabled: false },
  translate: { enabled: false },
});

/**
 * Chromium + profil sementara (persistent context di direktori acak, dihapus saat tutup) di belakang proxy
 * egress sendiri, dengan lapis kedua `context.route`. Dipakai setiap sesi dan oleh e2e SSRF/residu.
 */
export async function launchIsolated(
  config: Config,
  viewport: PendampingViewport,
  onBlocked: (host: string) => void = () => {},
): Promise<Isolated> {
  const rules = egressRules(egressAllowedHosts(), config.fixtureOrigins);
  const allowedHosts = new Set(rules.map((r) => `${r.host}:${r.port}`));
  const proxy = await startEgressProxy(rules, { upstream: config.upstreamProxy });
  proxy.onBlocked(onBlocked);
  const userDataDir = await mkdtemp(join(tmpdir(), 'urusin-pendamping-'));
  const hapus = () => rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  let context: BrowserContext | undefined;
  try {
    await mkdir(join(userDataDir, 'Default'));
    await writeFile(join(userDataDir, 'Default', 'Preferences'), JSON.stringify(PROFIL_PREFS));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      ...(config.chromiumPath ? { executablePath: config.chromiumPath } : {}),
      proxy: proxyOption(proxy.port),
      args: chromiumArgs(config),
      env: {
        ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
        ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
        TZ: 'Asia/Jakarta',
      },
      viewport: { width: viewport.lebar, height: viewport.tinggi },
      deviceScaleFactor: 1,
      isMobile: viewport.seluler,
      hasTouch: viewport.seluler,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
      // Agen pengguna = bawaan Chromium apa adanya (tidak ditimpa); lihat tanpa-evasi.test.ts.
    });
    // Lapis kedua (selain proxy): permintaan ke host:port di luar allowlist dibatalkan di peramban.
    await context.route('**/*', (route) => {
      const u = URL.parse(route.request().url());
      const port = Number(u?.port || (u?.protocol === 'https:' ? 443 : 80));
      const ok =
        (u?.protocol === 'https:' || u?.protocol === 'http:') && allowedHosts.has(`${u.hostname}:${port}`);
      return ok ? route.continue() : route.abort('blockedbyclient');
    });
    const ctx = context;
    return {
      context: ctx,
      proxy,
      userDataDir,
      async close() {
        await ctx.close().catch(() => {});
        await proxy.close();
        // Profil (cookie, storage, cache, Login Data) dihapus seluruhnya: tidak ada yang tersisa.
        await hapus();
      },
    };
  } catch (e) {
    await context?.close().catch(() => {});
    await proxy.close();
    await hapus();
    throw e;
  }
}

/**
 * PID pohon proses Chromium milik profil ini (Linux, /proc): proses utama dikenali dari
 * `--user-data-dir=<dir>`, lalu semua turunannya (renderer, GPU, utilitas) lewat ppid.
 */
export function pidsOfProfile(userDataDir: string, proc = '/proc'): number[] {
  if (process.platform !== 'linux' && proc === '/proc') return [];
  const parent = new Map<number, number>();
  const roots: number[] = [];
  for (const name of readdirSync(proc)) {
    const pid = Number(name);
    if (!Number.isInteger(pid)) continue;
    try {
      const stat = readFileSync(join(proc, name, 'stat'), 'utf8');
      parent.set(pid, Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
      const cmd = readFileSync(join(proc, name, 'cmdline'), 'utf8').split('\0');
      if (cmd.includes(`--user-data-dir=${userDataDir}`)) roots.push(pid);
    } catch {
      // proses sudah keluar
    }
  }
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of parent)
      if (!out.has(pid) && out.has(ppid)) {
        out.add(pid);
        grew = true;
      }
  }
  return [...out];
}

export async function startBrowserRun(config: Config, init: RunInit): Promise<ActiveRun> {
  const reported = new Set<string>();
  const iso = await launchIsolated(config, init.viewport, (host) => {
    if (reported.size < 20 && !reported.has(host)) {
      reported.add(host);
      init.hooks.event({ jenis: 'diblokir', host });
    }
  });
  try {
    return await wire(config, init, iso);
  } catch (e) {
    await iso.close();
    throw e;
  }
}

async function wire(config: Config, init: RunInit, iso: Isolated): Promise<ActiveRun> {
  const { context } = iso;
  const { hooks, program } = init;
  const steps = program.steps;
  const finalIdx = finalGateIndex(steps);

  const page: Page = context.pages()[0] ?? (await context.newPage());
  // Pop-up / tab baru tidak terlihat di layar warga: tutup.
  context.on('page', (p) => {
    if (p !== page) void p.close();
  });
  const cdp: CDPSession = await context.newCDPSession(page);

  let loading = false;
  let destroyed = false;
  let manual = false;
  let resumeWaiters: (() => void)[] = [];
  let gatePoll: ReturnType<typeof setInterval> | undefined;
  let lastLangkah = -1;
  let viewerSend: ((f: Frame) => void) | null = null;
  let screencasting = false;
  let status: Cursor['status'] | undefined;

  const mainFrameId = async () =>
    ((await cdp.send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } }).frameTree.frame.id;

  async function evaluate(op: RunnerOp): Promise<RunnerResult | 'interrupted'> {
    try {
      const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
        frameId: await mainFrameId(),
        worldName: 'urusin-pendamping',
        grantUniveralAccess: false,
      })) as { executionContextId: number };
      const r = (await cdp.send('Runtime.evaluate', {
        expression: runnerExpression(op),
        contextId: executionContextId,
        awaitPromise: true,
        returnByValue: true,
      })) as { result: { value?: unknown }; exceptionDetails?: { text?: string } };
      if (r.exceptionDetails) return { ok: false, code: 'INJECT_FAILED', message: 'runner melempar galat' };
      const v = r.result.value as RunnerResult | undefined;
      if (v && typeof v === 'object' && 'ok' in v) return v;
      return loading ? 'interrupted' : { ok: false, code: 'INJECT_FAILED', message: 'runner tanpa hasil' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (loading || INTERRUPTED_RE.test(msg)) return 'interrupted';
      return { ok: false, code: 'INJECT_FAILED', message: 'runner gagal dijalankan' };
    }
  }

  const waitResume = () =>
    manual && !destroyed ? new Promise<void>((r) => resumeWaiters.push(r)) : Promise.resolve();

  const driver: Driver = {
    openTab: async () => 1,
    tab: async () => (destroyed ? null : { url: page.url(), status: loading ? 'loading' : 'complete' }),
    async navigate(_tab, url) {
      await waitResume();
      loading = true;
      await cdp.send('Page.navigate', { url }).catch(() => undefined);
    },
    async run(_tab, op) {
      // Saat warga memegang kendali, op yang mengubah halaman menunggu; pemeriksaan (check) tetap jalan.
      if (MUTATING.has(op.kind)) await waitResume();
      if (destroyed) return { ok: false, code: 'CANCELLED', message: 'sesi berakhir' };
      return evaluate(op);
    },
  };

  const fixtureOrigins = config.fixtureOrigins;
  const policy = async (url: string) =>
    checkUrl(url, { testMode: fixtureOrigins.length > 0, fixtureOrigins });

  const sorot = async (target: Extract<Step, { op: 'gate.human' }>['highlight']) => {
    if (!target) return undefined;
    const r = await evaluate({ kind: 'rect', target });
    return r !== 'interrupted' && r.ok ? (r.value as PendampingSorot) : undefined;
  };

  const stopGatePoll = () => {
    clearInterval(gatePoll);
    gatePoll = undefined;
  };

  const onChange = (c: Cursor) => {
    hooks.activity();
    const prev = status;
    status = c.status;
    if (c.status !== 'waiting_gate') stopGatePoll();
    switch (c.status) {
      case 'running':
      case 'waiting_load':
        if (!manual) hooks.mode('ai', 'AI sedang mengisi formulir.');
        if (c.stepIndex !== lastLangkah && c.stepIndex < steps.length) {
          lastLangkah = c.stepIndex;
          hooks.event({
            jenis: 'langkah',
            indeks: c.stepIndex,
            total: steps.length,
            label: stepLabel(steps[c.stepIndex]),
          });
        }
        return;
      case 'waiting_gate': {
        if (prev === 'waiting_gate') return;
        const step = steps[c.stepIndex];
        const final = c.stepIndex === finalIdx;
        const pesan = c.message ?? 'Giliran Anda.';
        hooks.mode('takeover', pesan);
        void (async () => {
          const box = step?.op === 'gate.human' ? await sorot(step.highlight) : undefined;
          hooks.event({
            jenis: 'giliran_anda',
            alasan: final ? 'final' : 'login',
            pesan,
            ...(box ? { sorot: box } : {}),
          });
        })();
        gatePoll ??= setInterval(() => void interp.recheckGate(), 1000);
        return;
      }
      case 'handoff':
        hooks.mode('takeover', c.message ?? 'Lanjutkan sendiri.');
        hooks.event({ jenis: 'giliran_anda', alasan: 'periksa', pesan: c.message ?? 'Lanjutkan sendiri.' });
        return;
      case 'done':
        hooks.ended(
          'selesai',
          'berhasil',
          'Anda sudah menekan Kirim. Sesi peramban ditutup; tidak ada yang disimpan.',
        );
        return;
      case 'error': {
        const code = c.error?.code ?? 'INTERNAL';
        if (code === 'CANCELLED') return;
        if (code === 'ADAPTER_DRIFT')
          return hooks.ended('dipandu', 'drift', 'Tampilan situs berubah. Kami beralih ke panduan langkah.');
        if (code === 'FINAL_NOT_AUTOMATABLE')
          return hooks.ended(
            'gagal',
            'gagal',
            'Urusin menolak menekan tombol kirim. Hanya Anda yang boleh menekannya.',
          );
        return hooks.ended(
          'gagal',
          'gagal',
          'Langkah otomatis berhenti dengan aman. Lanjutkan lewat panduan.',
        );
      }
    }
  };

  const interp = new Interpreter(memoryKV(), driver, policy, onChange, {
    preConsented: true,
    resolveValue: async (v) => {
      let missing = false;
      const out = v.replace(/\{\{[^{}]+\}\}/g, (tok) => {
        const val = init.data.value(tok);
        if (val === undefined) missing = true;
        return val ?? '';
      });
      return missing ? undefined : out;
    },
    resolveFile: async (name) => init.data.file(name),
  });

  // Peristiwa muat halaman utama -> interpreter (pengganti chrome.tabs.onUpdated di ekstensi).
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loading = true;
  });
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) return;
    loading = true;
    void interp.onTabUpdated(1, { status: 'loading' });
  });
  page.on('load', () => {
    loading = false;
    void interp.onTabUpdated(1, { status: 'complete' });
  });
  page.on('response', async (resp) => {
    const req = resp.request();
    if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
    const info = { status: resp.status(), headers: resp.headers() };
    if (!suspicious(info)) return;
    const body = await resp.text().catch(() => '');
    const wall = detectBotWall({ ...info, body: body.slice(0, 20_000) });
    if (wall)
      hooks.ended(
        'dipandu',
        'drift',
        'Situs instansi menolak peramban server Urusin (perlindungan bot). Kami beralih ke panduan: buka situs resmi di perangkat Anda sendiri.',
      );
  });

  // Ack CDP ditunda sebesar jeda fps: Chromium tidak meng-encode frame lebih cepat dari yang dikirim (CPU host
  // bersama, temuan M-1). Backpressure ke ponsel ada di gerbang frame per koneksi (stream.ts).
  const jedaFrame = 1000 / config.fps;
  cdp.on('Page.screencastFrame', (f) => {
    setTimeout(
      () => void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}),
      jedaFrame,
    ).unref?.();
    const m = f.metadata;
    viewerSend?.({
      jpeg: Buffer.from(f.data, 'base64'),
      meta: {
        lebar: m.deviceWidth ?? init.viewport.lebar,
        tinggi: m.deviceHeight ?? init.viewport.tinggi,
        skala: m.pageScaleFactor ?? 1,
        offsetAtas: m.offsetTop ?? 0,
        scrollX: m.scrollOffsetX ?? 0,
        scrollY: m.scrollOffsetY ?? 0,
      },
    });
  });

  // Pengawas memori per sesi: PSS pohon proses Chromium (Linux); di luar Linux, heap JS halaman (perkiraan).
  const memTimer = setInterval(async () => {
    try {
      const mb = await sessionMemMb(iso.userDataDir, cdp);
      if (mb > config.sessionMemMb)
        hooks.ended(
          'gagal',
          'gagal',
          'Halaman terlalu berat untuk peramban pendamping. Lanjutkan lewat panduan.',
        );
    } catch {
      // peramban sedang ditutup
    }
  }, config.memCheckMs);
  memTimer.unref?.();

  const touch = createTouchMapper();
  let fokusTerakhir: JenisFokus | undefined;
  const periksaFokus = async () => {
    if (destroyed) return;
    try {
      const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
        frameId: await mainFrameId(),
        worldName: 'urusin-fokus',
        grantUniveralAccess: false,
      })) as { executionContextId: number };
      const r = (await cdp.send('Runtime.evaluate', {
        expression: FOKUS_EXPR,
        contextId: executionContextId,
        returnByValue: true,
      })) as { result: { value?: unknown } };
      const jenis = r.result.value as JenisFokus;
      if (typeof jenis === 'string' && jenis !== fokusTerakhir) {
        fokusTerakhir = jenis;
        hooks.fokus(jenis);
      }
    } catch {
      // halaman sedang berpindah
    }
  };
  const resume = () => {
    const w = resumeWaiters;
    resumeWaiters = [];
    for (const r of w) r();
  };

  return {
    async mulaiAi() {
      if (init.manualUrl) {
        // Mode debug: tidak ada AI; penguji manusia memegang kendali sejak awal.
        manual = true;
        hooks.mode('takeover', 'Mode debug: kemudi manual oleh penguji.');
        hooks.event({ jenis: 'giliran_anda', alasan: 'diminta_warga', pesan: 'Mode debug: kemudi manual.' });
        await page.goto(init.manualUrl, { waitUntil: 'commit' }).catch(() => undefined);
        return;
      }
      const started = await interp.start({ executionId: init.executionId, origin: program.origin, steps });
      if ('ok' in started) hooks.ended('gagal', 'gagal', 'Langkah otomatis tidak bisa dimulai.');
    },
    async input(m) {
      for (const cmd of toCdp(m, touch)) {
        await cdp.send(cmd.method as 'Input.insertText', cmd.params as never).catch(() => undefined);
      }
      // Setelah ketukan/Tab/Enter fokus bisa pindah: beri tahu jenis kolom (sandi/OTP) ke ponsel.
      if ((m.type === 'pointer' && m.aksi === 'up') || (m.type === 'key' && m.aksi === 'up'))
        setTimeout(() => void periksaFokus(), 60).unref?.();
    },
    ambilAlih() {
      manual = true;
    },
    kembalikan() {
      manual = false;
      resume();
      // Gerbang warga belum terpenuhi: tetap giliran warga; selain itu AI lanjut.
      if (status === 'waiting_gate') void interp.recheckGate();
      else if (status !== 'handoff') hooks.mode('ai', 'AI melanjutkan pengisian.');
    },
    async setViewer(send) {
      viewerSend = send;
      if (send && !screencasting) {
        screencasting = true;
        await cdp
          .send('Page.startScreencast', {
            format: 'jpeg',
            quality: 60,
            // Resolusi = lebar CSS penampil x DPR perangkat (tidak lebih tajam dari layar ponsel).
            maxWidth: Math.round(init.viewport.lebar * init.viewport.dpr),
            maxHeight: Math.round(init.viewport.tinggi * init.viewport.dpr),
            everyNthFrame: 1,
          })
          .catch(() => (screencasting = false));
      } else if (!send && screencasting) {
        screencasting = false;
        await cdp.send('Page.stopScreencast').catch(() => {});
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      stopGatePoll();
      clearInterval(memTimer);
      resume();
      viewerSend = null;
      await interp.cancel().catch(() => {});
      await iso.close();
    },
  };
}
