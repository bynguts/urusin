import { readFileSync } from 'node:fs';
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
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import type { Config } from './config.js';
import { egressRules, startEgressProxy, type EgressProxy } from './egress.js';
import { toCdp } from './input.js';
import { runnerExpression } from './runner-script.js';
import type { ActiveRun, Frame, RunFactory, RunInit } from './sessions.js';
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

/** Jumlah RSS (MB) proses-proses Chromium; Linux saja (/proc), selain itu undefined. */
export function rssMb(pids: number[]): number | undefined {
  if (process.platform !== 'linux') return undefined;
  let kb = 0;
  for (const pid of pids) {
    try {
      const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
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
    '--renderer-process-limit=2',
    `--js-flags=--max-old-space-size=${config.jsHeapMb}`,
    // WebRTC hanya lewat proxy: UDP langsung (bisa melewati allowlist) dimatikan.
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    // Chromium tidak me-resolve DNS sendiri: semua nama host hanya di-resolve proxy egress.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
  ];
}

export function createBrowserFactory(config: Config): RunFactory {
  return (init) => startBrowserRun(config, init);
}

export type Isolated = {
  browser: Browser;
  context: BrowserContext;
  proxy: EgressProxy;
  close(): Promise<void>;
};

/**
 * Chromium + konteks non-persisten di belakang proxy egress sendiri, dengan lapis kedua `context.route`.
 * Dipakai setiap sesi (dan oleh e2e SSRF agar yang diuji persis konfigurasi produksi).
 */
export async function launchIsolated(
  config: Config,
  viewport: PendampingViewport,
  onBlocked: (host: string) => void = () => {},
): Promise<Isolated> {
  const rules = egressRules(egressAllowedHosts(), config.fixtureOrigins);
  const allowedHosts = new Set(rules.map((r) => `${r.host}:${r.port}`));
  const proxy = await startEgressProxy(rules);
  proxy.onBlocked(onBlocked);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: config.headless,
      ...(config.chromiumPath ? { executablePath: config.chromiumPath } : {}),
      proxy: { server: `http://127.0.0.1:${proxy.port}` },
      args: chromiumArgs(config),
      env: { TZ: 'Asia/Jakarta' },
    });
    const context = await browser.newContext({
      viewport: { width: viewport.lebar, height: viewport.tinggi },
      deviceScaleFactor: 1,
      isMobile: viewport.seluler,
      hasTouch: viewport.seluler,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
      acceptDownloads: false,
      serviceWorkers: 'block',
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
    const b = browser;
    return {
      browser: b,
      context,
      proxy,
      async close() {
        // Konteks non-persisten + profil sementara dihapus Playwright saat browser ditutup.
        await context.close().catch(() => {});
        await b.close().catch(() => {});
        await proxy.close();
      },
    };
  } catch (e) {
    await browser?.close().catch(() => {});
    await proxy.close();
    throw e;
  }
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
  const { browser, context } = iso;
  const { hooks, program } = init;
  const steps = program.steps;
  const finalIdx = finalGateIndex(steps);

  const page: Page = await context.newPage();
  // Pop-up / tab baru tidak terlihat di layar warga: tutup.
  context.on('page', (p) => {
    if (p !== page) void p.close();
  });
  const cdp: CDPSession = await context.newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();

  let loading = false;
  let destroyed = false;
  let manual = false;
  let resumeWaiters: (() => void)[] = [];
  let gatePoll: ReturnType<typeof setInterval> | undefined;
  let lastLangkah = -1;
  let viewerSend: ((f: Frame) => void) | null = null;
  let screencasting = false;
  let frameSeq = 0;
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

  cdp.on('Page.screencastFrame', (f) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const m = f.metadata;
    viewerSend?.({
      type: 'frame',
      seq: frameSeq++,
      data: f.data,
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

  // Pengawas memori per sesi: RSS pohon proses Chromium (Linux).
  const memTimer = setInterval(async () => {
    try {
      const info = (await browserCdp.send('SystemInfo.getProcessInfo')) as { processInfo: { id: number }[] };
      const mb = rssMb(info.processInfo.map((p) => p.id));
      if (mb !== undefined && mb > config.sessionMemMb)
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

  const resume = () => {
    const w = resumeWaiters;
    resumeWaiters = [];
    for (const r of w) r();
  };

  return {
    async mulaiAi() {
      const started = await interp.start({ executionId: init.executionId, origin: program.origin, steps });
      if ('ok' in started) hooks.ended('gagal', 'gagal', 'Langkah otomatis tidak bisa dimulai.');
    },
    async input(m) {
      for (const cmd of toCdp(m, { touch: init.viewport.seluler })) {
        await cdp.send(cmd.method as 'Input.insertText', cmd.params as never).catch(() => undefined);
      }
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
            maxWidth: init.viewport.lebar * 2,
            maxHeight: init.viewport.tinggi * 2,
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
