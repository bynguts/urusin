import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalGateIndex, hostsSesi, type Program } from '@urusin/adapters';
import {
  PendampingBuktiSchema,
  type PendampingBukti,
  type PendampingSorot,
  type PendampingViewport,
} from '@urusin/contracts';
import { type Step, type Target } from '@urusin/core';
import {
  checkUrl,
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
import {
  asetUmumBoleh,
  createGerbangTulis,
  hostAset,
  jalurPihakKetigaBoleh,
  JENDELA_WARGA_MS,
  type GerbangTulis,
  type PermintaanGerbang,
} from './gerbang-tulis.js';
import { GenerikRun, naikHttps, PESAN_GENERIK, tanganRunner } from './generik.js';
import { createTouchMapper, FOKUS_EXPR, toCdp } from './input.js';
import { daftarEdge, type ProxyEdge } from './isolasi.js';
import { pesanBerkasKurang, pesanIsiSendiri } from './isian.js';
import { runnerExpression } from './runner-script.js';
import type { ActiveRun, Frame, JenisFokus, RunFactory, RunInit } from './sessions.js';
import { createPantauTantangan, isChallengeFrameUrl, isInterstitialTitle } from './verifikasi.js';
import { detectBotWall, suspicious, wallBisaDiverifikasi } from './waf.js';

/**
 * Satu sesi = satu proses Chromium (headed di Xvfb, profil sementara non-persisten) di belakang proxy egress
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
const MUTATING: ReadonlySet<RunnerOp['kind']> = new Set(['step', 'upload', 'consent', 'aksi']);

/** Kode galat jaringan Chromium (`net::ERR_*`) -> alasan dalam kata sederhana. */
function alasanJaringan(net: string): string {
  if (/TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED/.test(net))
    return 'jalur keluar Browser Pendamping tidak bisa tersambung ke situs itu';
  if (/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/.test(net)) return 'alamat situs tidak ditemukan';
  if (/TIMED_OUT/.test(net)) return 'situs tidak menjawab tepat waktu';
  if (/CERT_|SSL_/.test(net)) return 'sertifikat keamanan situs tidak sah';
  if (/CONNECTION_(REFUSED|RESET|CLOSED)|EMPTY_RESPONSE/.test(net))
    return 'situs menolak atau memutus koneksi';
  return 'koneksi ke situs gagal';
}

/**
 * Pesan akhir untuk warga saat alur otomatis berhenti: alasan nyata dalam kata sederhana (bukan sekadar
 * "berhenti dengan aman"). `net` = galat navigasi halaman utama terakhir (bila ada). Tanpa path, nilai, atau PII.
 */
export function pesanGagal(code: string, host: string, net?: string): string {
  const lanjut = ' Lanjutkan lewat panduan.';
  if (net) return `Halaman ${host} tidak bisa dibuka: ${alasanJaringan(net)} (${net}).${lanjut}`;
  switch (code) {
    case 'DOMAIN_NOT_ALLOWED':
      return `Halaman berpindah ke alamat di luar ${host}, jadi Urusin berhenti demi keamanan.${lanjut}`;
    case 'TAB_CLOSED':
      return `Halaman ${host} tertutup sebelum langkah selesai.${lanjut}`;
    case 'PLACEHOLDER_UNRESOLVED':
      return `Data yang dibutuhkan formulir belum ada di Data Diri atau Dokumen Anda.${lanjut}`;
    case 'CONSENT_DENIED':
      return `Izin mengisi belum diberikan, jadi Urusin tidak mengisi apa pun.${lanjut}`;
    case 'VERIFY_FAILED':
    case 'VERIFY_UNREADABLE':
    case 'WRITE_UNVERIFIED':
    case 'WRITE_WITHOUT_VERIFY':
      return `Urusin tidak bisa memastikan isian tersimpan di ${host}, jadi berhenti agar tidak mengirim dua kali.${lanjut}`;
    default:
      return `Langkah otomatis di ${host} tidak bisa dijalankan (kode ${code}).${lanjut}`;
  }
}

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
      // smaps_rollup tidak terbaca: proses sandbox setuid (renderer, zygote) tidak dumpable -> EACCES
    }
    try {
      // Memori privat dari status (selalu terbaca): RssAnon + RssShmem. VmRSS ikut menghitung pustaka bersama
      // (RssFile) penuh di SETIAP proses; dengan sandbox setuid itu menggelembungkan halaman kosong dari
      // ~300 MB ke ~520 MB dan pengawas memori membunuh setiap sesi (run 7). VmRSS hanya bila kernel lama.
      const st = readFileSync(`${proc}/${pid}/status`, 'utf8');
      const kolom = (k: string) => new RegExp(`^${k}:\\s+(\\d+)\\s+kB`, 'm').exec(st)?.[1];
      const anon = kolom('RssAnon');
      kb += anon !== undefined ? Number(anon) + Number(kolom('RssShmem') ?? 0) : Number(kolom('VmRSS') ?? 0);
    } catch {
      // proses sudah keluar
    }
  }
  return Math.round(kb / 1024);
}

/**
 * `proxyHost` = IP literal proxy yang dipakai Chromium (127.0.0.1 untuk proxy di dalam proses, IP kontainer
 * edge di produksi). Aturan resolver memetakan SEMUA nama ke NOTFOUND, jadi alamat proxy wajib dikecualikan;
 * tanpa itu Chromium tidak pernah tersambung ke edge (net::ERR_PROXY_CONNECTION_FAILED di langkah pertama).
 */
export function chromiumArgs(config: Pick<Config, 'jsHeapMb'>, proxyHost = '127.0.0.1'): string[] {
  if (isIP(proxyHost) === 0) throw new Error(`alamat proxy Chromium harus IP literal: ${proxyHost}`);
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
    `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${proxyHost}`,
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

/** Proxy edge (produksi): IP edge + kredensial acak per sesi; loopback tetap lewat proxy (dan ditolak). */
export function proxyEdgeOption(pe: Pick<ProxyEdge, 'server' | 'username' | 'password'>) {
  return { server: pe.server, username: pe.username, password: pe.password, bypass: '<-loopback>' };
}
delete process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK;

async function sessionMemMb(userDataDir: string, cdp: CDPSession): Promise<number> {
  const pss = pssMb(pidsOfProfile(userDataDir));
  if (pss !== undefined && pss > 0) return pss;
  const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  return Math.round(heap.usedSize / 1024 / 1024);
}

const PESAN_MASUK =
  'Masuk ke akun Anda di situs ini. Isi sendiri kolom yang diminta halamannya (CAPTCHA, sandi, atau OTP). ' +
  'AI melanjutkan setelah Anda masuk.';

/** Pengajuan terkirim: sesi ditutup, peramban beserta login dan cookie dihapus. */
export const PESAN_TERKIRIM = 'Pengajuan terkirim. Browser ditutup; login dan cookie ikut dihapus.';

/** Pengawas memori menghentikan sesi (situs terlalu berat untuk peramban server): warga diarahkan ke panduan. */
export const PESAN_MEMORI =
  'Halaman situs ini terlalu berat untuk peramban pendamping Urusin, jadi sesi dihentikan. Kami beralih ke panduan langkah: buka situs resmi di perangkat Anda sendiri.';

/** Generik: giliran masuk akun/CAPTCHA/OTP terdeteksi selesai (halaman berganti, formulir masuk hilang). */
export const PESAN_GILIRAN_SELESAI = 'Giliran Anda selesai. AI melanjutkan.';

const PESAN_VERIFIKASI =
  "Situs meminta verifikasi keamanan. Ketuk kotak 'Verify you are human', lalu tunggu sebentar. AI menunggu dan tidak akan mengekliknya.";

/** Widget Turnstile sudah menghasilkan token? (hanya ada/tidaknya; nilai token tidak pernah dibaca keluar). */
const TOKEN_TURNSTILE_ADA = `Array.from(document.querySelectorAll('input[name="cf-turnstile-response"]')).some((e) => e.value.length > 0)`;

export function createBrowserFactory(config: Config): RunFactory {
  return (init) => startBrowserRun(config, init);
}

export type Isolated = {
  context: BrowserContext;
  /** Proxy egress di dalam proses (dev/e2e); undefined bila lewat pendamping-edge (produksi). */
  proxy: EgressProxy | undefined;
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
 * Kontrol yang ketukannya membuka jendela tulis warga di halaman kotor (N4): hanya tombol kirim dan tautan.
 * Kontrol isian (radio, centang, pilihan, label, summary) dan kolom ketik tidak: menyentuhnya bukan maksud
 * mengirim, jadi retry tertunda dari klik AI tidak boleh ikut lolos (re-review N4, PoC A).
 */
const SEL_KONTROL_KETUK =
  'button:not([type="reset"]), a[href], area[href], input[type="submit"], input[type="image"], input[type="button"], [role="button"], [role="link"]';
/**
 * Dokumen kotor oleh aksi AI yang tidak bisa dimuat ulang (re-review A2): hanya tombol submit asli. Bukan
 * `type=button` dan bukan tautan (termasuk tautan fragmen), karena handler-nya tidak mengirim formulir sendiri.
 */
const SEL_KIRIM_ASLI =
  'button[type="submit"], form button:not([type]), button[form]:not([type]), input[type="submit"], input[type="image"]';
const SEL_KOLOM_KETIK =
  'textarea, [contenteditable=""], [contenteditable="true"], input:not([type="submit"], [type="image"], [type="button"], [type="checkbox"], [type="radio"], [type="reset"], [type="file"])';

/** Kendali yang dihitung `tenang()` untuk menilai DOM sudah stabil. */
const SEL_KENDALI_TENANG = 'input, textarea, select, button, a[href], [role="button"], [role="link"]';

/**
 * Konten belum tampil (probe gel4 6171: `#page-content` opacity 0 dan layar muat, baru opacity 1 800 ms setelah
 * load lewat setTimeout + transisi 700 ms; isinya hanya tautan): salah satu dari
 * - transisi/animasi CSS berhingga sedang jalan (animasi tak berhingga/spinner diabaikan);
 * - html/body masih opacity < 0,1 / visibility hidden (opacity tidak diwariskan ke gaya anak) padahal ada kendali;
 * - elemen di viewport (kedalaman <= 4 dari body, atau kontainer utama `main`/`#page-content`/`#content`/`#app`/
 *   ...) masih opacity < 0,1 / visibility hidden dan memuat kolom isian (>= 2000 px persegi) atau tautan/tombol
 *   (>= 20% viewport: blok konten, bukan menu tarik-turun kecil yang memang tersembunyi);
 * - layar muat (id/kelas loader/preloader/loading/spinner) fixed/absolute yang masih menutupi >= 50% viewport.
 * Jeda setTimeout sebelum transisi mulai tertangkap karena kontennya masih transparan. Elemen tanpa kotak
 * (display:none, mis. modal tertutup) diabaikan. Pemanggil membatasi tunggu 3 detik. Dievaluasi di dunia
 * terisolasi (hanya membaca DOM/gaya).
 */
export const KONTEN_BELUM_TAMPIL_EXPR = `(() => {
  const anim = document.getAnimations().some((a) => {
    if (a.playState !== 'running') return false;
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : undefined;
    return !!t && Number.isFinite(t.endTime);
  });
  if (anim) return true;
  const vw = innerWidth, vh = innerHeight, luas = vw * vh;
  if (!document.body || luas <= 0) return false;
  const ISIAN = 'input:not([type="hidden"]), select, textarea';
  const KENDALI = ISIAN + ', a[href], button, [role="button"], [role="link"]';
  const pudar = (g) => Number(g.opacity) < 0.1 || g.visibility === 'hidden';
  if ([document.documentElement, document.body].some((el) => pudar(getComputedStyle(el))) && document.body.querySelector(KENDALI))
    return true;
  const RE_MUAT = /(^|[^a-z])(pre-?loader|loader|loading|spinner)([^a-z]|$)/i;
  const calon = document.body.querySelectorAll(
    ':scope > *, :scope > * > *, :scope > * > * > *, :scope > * > * > * > *, main, [role="main"], #page-content, #content, #main, #app, #root',
  );
  for (const el of calon) {
    const r = el.getBoundingClientRect();
    const lebar = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const tinggi = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const tampak = lebar * tinggi;
    if (tampak < 2000) continue;
    const g = getComputedStyle(el);
    if (pudar(g)) {
      if (el.querySelector(ISIAN)) return true;
      if (tampak >= luas * 0.2 && el.querySelector(KENDALI)) return true;
      continue;
    }
    if (
      tampak >= luas * 0.5 &&
      (g.position === 'fixed' || g.position === 'absolute') &&
      RE_MUAT.test((el.id || '') + ' ' + (el.getAttribute('class') || ''))
    )
      return true;
  }
  return false;
})()`;

/** URL lolos allowlist host:port sesi (lapis `context.route`; sama dengan proxy egress). */
export function urlDiAllowlist(allowedHosts: ReadonlySet<string>, url: string): boolean {
  const u = URL.parse(url);
  const port = Number(u?.port || (u?.protocol === 'https:' ? 443 : 80));
  return (u?.protocol === 'https:' || u?.protocol === 'http:') && allowedHosts.has(`${u.hostname}:${port}`);
}

/**
 * Saringan rute peramban (lapis kedua setelah proxy): host:port di allowlist, www.google.com hanya /recaptcha/,
 * dan host aset umum (CDN/fon) hanya subresource script/stylesheet/font/image, tidak pernah navigasi dokumen
 * (host aset pemda .go.id: juga XHR/fetch GET).
 */
export function izinRute(
  allowedHosts: ReadonlySet<string>,
  req: { url(): string; method(): string; resourceType(): string; isNavigationRequest(): boolean },
): boolean {
  const url = req.url();
  return (
    urlDiAllowlist(allowedHosts, url) &&
    jalurPihakKetigaBoleh(url) &&
    asetUmumBoleh({
      url,
      metode: req.method(),
      resourceType: req.resourceType(),
      dokumen: req.isNavigationRequest(),
    })
  );
}

/**
 * Bentuk permintaan untuk gerbang tulis: metode, navigasi dokumen di bingkai mana pun (`dokumen`) dan di bingkai
 * utama (`utama`), XHR/fetch, dan URL awal rantai redirect. Navigasi tanpa bingkai yang bisa ditelusuri
 * dianggap navigasi bingkai utama (gagal tertutup).
 */
export function permintaanGerbang(r: {
  method(): string;
  url(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
  frame(): { page(): { mainFrame(): unknown } };
  redirectedFrom(): { url(): string; redirectedFrom(): unknown } | null;
}): PermintaanGerbang {
  const dokumen = r.isNavigationRequest();
  let utama = dokumen;
  if (dokumen) {
    try {
      const f = r.frame();
      utama = f === f.page().mainFrame();
    } catch {
      utama = true;
    }
  }
  const tipe = r.resourceType();
  let asal: string | undefined;
  for (let x = r.redirectedFrom(); x; x = x.redirectedFrom() as typeof x) asal = x.url();
  return {
    metode: r.method(),
    dokumen,
    utama,
    xhr: !dokumen && (tipe === 'xhr' || tipe === 'fetch'),
    url: r.url(),
    ...(asal !== undefined ? { asal } : {}),
  };
}

/**
 * Chromium + profil sementara (persistent context di direktori acak, dihapus saat tutup) di belakang proxy
 * egress sendiri, dengan lapis kedua `context.route`. Dipakai setiap sesi dan oleh e2e SSRF/residu.
 */
export async function launchIsolated(
  config: Config,
  viewport: PendampingViewport,
  /** Host https sesi ini (host origin + host yang dideklarasikan adapter), bukan seluruh registry. */
  hosts: readonly string[],
  /** `dokumen` = navigasi bingkai utama (hanya dari lapis rute; proxy tidak tahu). */
  onBlocked: (host: string, dokumen?: boolean) => void = () => {},
  /**
   * Gerbang tulis Navigator generik (lapis SETELAH allowlist; tidak pernah melonggarkannya). undefined = sesi
   * adapter (tanpa gerbang).
   */
  gerbang?: GerbangTulis,
  /**
   * Navigasi dokumen bingkai utama GET ke `http://` host sesi yang hanya terdaftar untuk https (probe gel4 9171):
   * permintaan http dibatalkan (tidak pernah terkirim) dan bentuk https-nya diserahkan ke sini untuk dibuka.
   */
  onNaikHttps: (url: string) => void = () => {},
): Promise<Isolated> {
  const rules = egressRules(hosts, config.fixtureOrigins);
  const allowedHosts = new Set(rules.map((r) => `${r.host}:${r.port}`));
  // Produksi: satu-satunya jalan keluar = pendamping-edge (kontainer ini tidak punya rute lain). Dev/e2e:
  // proxy egress di dalam proses dengan kebijakan yang sama.
  const edge = config.edge
    ? await daftarEdge(
        config.edge,
        rules.filter((r) => r.port === 443).map((r) => r.host),
        config.ttlMs + 5 * 60_000,
      )
    : undefined;
  const proxy = edge ? undefined : await startEgressProxy(rules, { upstream: config.upstreamProxy });
  proxy?.onBlocked(onBlocked);
  const tutupProxy = async () => {
    await proxy?.close();
    await edge?.hapus();
  };
  const userDataDir = await mkdtemp(join(tmpdir(), 'urusin-pendamping-'));
  const hapus = () => rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  let context: BrowserContext | undefined;
  try {
    await mkdir(join(userDataDir, 'Default'));
    await writeFile(join(userDataDir, 'Default', 'Preferences'), JSON.stringify(PROFIL_PREFS));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      ...(config.chromiumPath ? { executablePath: config.chromiumPath } : {}),
      proxy: edge ? proxyEdgeOption(edge) : proxyOption(proxy!.port),
      // Sandbox Chromium (userns + seccomp-bpf) aktif; hanya CI terhadap fixture yang boleh mematikannya.
      chromiumSandbox: config.sandbox,
      args: chromiumArgs(config, edge ? new URL(edge.server).hostname : '127.0.0.1'),
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
    // Gerbang tulis (generik) di rute yang SAMA, setelah allowlist: permintaan yang dibatalkan tidak pernah terkirim.
    // Host yang terbukti di belakang Cloudflare (header cf-ray): hanya di sana /cdn-cgi/challenge-platform/
    // dianggap tantangan oleh gerbang tulis (review L3; proteksi di registry belum lengkap).
    const hostCf = new Set<string>();
    context.on('response', (resp) => {
      if (hostCf.size >= 64 || !resp.headers()['cf-ray']) return;
      const h = URL.parse(resp.url())?.host;
      if (h) hostCf.add(h);
    });
    await context.route('**/*', (route) => {
      const req = route.request();
      const ok = izinRute(allowedHosts, req);
      if (!ok && req.method() === 'GET' && permintaanGerbang(req).utama) {
        const https = naikHttps(req.url(), (u) =>
          izinRute(allowedHosts, {
            url: () => u,
            method: () => 'GET',
            resourceType: () => 'document',
            isNavigationRequest: () => true,
          }),
        );
        if (https) {
          onNaikHttps(https);
          return route.abort('aborted');
        }
      }
      if (!ok) {
        const host = URL.parse(req.url())?.hostname;
        const dokumen = gerbang ? permintaanGerbang(req).utama : false;
        if (host) onBlocked(host, dokumen);
        // Generik: navigasi dokumen ke host lain (mis. redirect 302) tidak meng-commit halaman galat; warga
        // tetap di halaman sebelumnya dan diberi giliran.
        return route.abort(dokumen ? 'aborted' : 'blockedbyclient');
      }
      // `aborted` (net::ERR_ABORTED): navigasi dokumen yang dibatalkan tidak meng-commit halaman galat, jadi
      // warga tetap melihat formulir yang sama (dengan isiannya) untuk ditekan sendiri.
      if (
        gerbang &&
        gerbang.periksa({
          ...permintaanGerbang(req),
          hostCloudflare: hostCf.has(URL.parse(req.url())?.host ?? ''),
        }) === 'blokir'
      )
        return route.abort('aborted');
      return route.continue();
    });
    // Gerbang tulis tidak melihat frame WebSocket (proxy hanya memeriksa host): sesi generik menolak setiap
    // koneksi WebSocket sebelum tersambung ke server (gagal tertutup), dicatat sebagai blokir `WSOCKET`.
    if (gerbang)
      await context.routeWebSocket(
        () => true,
        (ws) => {
          gerbang.tolak({ metode: 'WSOCKET', dokumen: false, utama: false, xhr: false, url: ws.url() });
          return ws.close({ code: 1008, reason: 'websocket tidak diizinkan di sesi pendamping' });
        },
      );
    const ctx = context;
    return {
      context: ctx,
      proxy,
      userDataDir,
      async close() {
        await ctx.close().catch(() => {});
        await tutupProxy();
        // Profil (cookie, storage, cache, Login Data) dihapus seluruhnya: tidak ada yang tersisa.
        await hapus();
      },
    };
  } catch (e) {
    await context?.close().catch(() => {});
    await tutupProxy();
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

/**
 * Sambungan gerbang tulis -> wire: gerbang dibuat SEBELUM peramban (rute terpasang sejak permintaan pertama),
 * wire mengisi pemegang kendali dan penerima blokir. Sebelum diisi: jendela AI diam (gagal tertutup).
 */
type KendaliGerbang = {
  /** Warga memegang kendali DAN baru saja memberi input nyata (jendela `warga`). */
  wargaPegang: () => boolean;
  /** Warga memegang kendali (dengan atau tanpa input). */
  wargaTunggu: () => boolean;
  blokir: Parameters<typeof createGerbangTulis>[0]['onBlokir'];
  hostDiblokir: (host: string, dokumen: boolean | undefined) => void;
  /** Tulis non-GET warga lolos (jendela `warga`). */
  tulisWarga: () => void;
  /** Dokumen kotor atau halaman akhir: redirect halaman sendiri tidak pernah lolos. */
  ketat: () => boolean;
  /** Tautan http:// host sesi yang diketuk warga: buka bentuk https-nya (probe gel4 9171). */
  naikHttps: (url: string) => void;
};

export async function startBrowserRun(config: Config, init: RunInit): Promise<ActiveRun> {
  const reported = new Set<string>();
  const kendali: KendaliGerbang = {
    wargaPegang: () => false,
    wargaTunggu: () => false,
    blokir: () => {},
    hostDiblokir: () => {},
    tulisWarga: () => {},
    ketat: () => false,
    naikHttps: () => {},
  };
  const gerbang = init.generik
    ? createGerbangTulis({
        wargaPegang: () => kendali.wargaPegang(),
        wargaTunggu: () => kendali.wargaTunggu(),
        onBlokir: (c, j) => kendali.blokir(c, j),
        onTulisWarga: () => kendali.tulisWarga(),
        ketat: () => kendali.ketat(),
      })
    : undefined;
  const hosts = hostsSesi(init.program);
  const iso = await launchIsolated(
    config,
    init.viewport,
    hosts,
    (host, dokumen) => {
      if (gerbang && !kendali.wargaTunggu()) kendali.hostDiblokir(host, dokumen);
      if (reported.size < 20 && !reported.has(host)) {
        reported.add(host);
        init.hooks.event({ jenis: 'diblokir', host });
      }
    },
    gerbang,
    (url) => kendali.naikHttps(url),
  );
  try {
    return await wire(config, init, iso, gerbang ? { gerbang, kendali, hosts } : undefined);
  } catch (e) {
    await iso.close();
    throw e;
  }
}

/**
 * Sambungkan Chromium yang sudah diluncurkan ke sesi (dipakai `startBrowserRun`; e2e memakainya langsung agar
 * bisa mengamati halaman). `gen`: gerbang tulis + kendali sesi Navigator generik.
 */
export async function wire(
  config: Config,
  init: RunInit,
  iso: Isolated,
  gen?: { gerbang: GerbangTulis; kendali: KendaliGerbang; hosts: readonly string[] },
): Promise<ActiveRun> {
  const { context } = iso;
  const { hooks } = init;
  // Berubah per execution (sesi siaga dipakai lagi untuk langkah berikutnya di urusan yang sama).
  let program: Program = init.program;
  let steps = program.steps;
  let finalIdx = finalGateIndex(steps);
  let executionId = init.executionId;

  const page: Page = context.pages()[0] ?? (await context.newPage());
  // Pop-up / tab baru tidak terlihat di layar warga: tutup (sesi generik: lihat penanganan pop-up warga di bawah).
  context.on('page', (p) => {
    if (p !== page && !gen) void p.close();
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
  // Verifikasi situs (B-b): nomor dokumen utama, sinyal tantangan dari respons terakhir, mesin status.
  let navKe = 0;
  let tantanganRespons = false;
  let tantanganPoll: ReturnType<typeof setInterval> | undefined;
  let sorotTantanganTerkirim = false;
  /** Nomor dokumen tempat tantangan terakhir mulai/diulang. */
  let tantanganNav = -1;
  /** Nomor dokumen serah generik `login` (CAPTCHA/kode) terakhir yang masih dipegang warga. */
  let serahLoginNav: number | undefined;
  /** Generik: mulai/hentikan pemantauan selesainya giliran masuk akun/CAPTCHA/OTP (diisi saat generik dibuat). */
  let mulaiPantauSerah: (pantauSerah: boolean) => Promise<void> = async () => {};
  let pesanTantangan = '';
  const pantau = createPantauTantangan(2);
  // Probe masuk akun (adapter): warga keluar/terlempar ke login -> takeover masuk_akun sampai masuk lagi.
  let masukAktif = false;
  let masukPoll: ReturnType<typeof setInterval> | undefined;
  let navTerakhir: string | undefined;
  /** Galat jaringan navigasi halaman utama terakhir (`net::ERR_*`), dikosongkan setiap navigasi baru. */
  let navGagal: string | undefined;
  let kembaliKe: string | undefined;
  /** AI diam selama warga memegang kendali, tantangan situs aktif, atau warga perlu masuk akun. */
  const ditahan = () => manual || pantau.aktif || masukAktif;
  /**
   * Input warga nyata terakhir (CDP Input dari ponsel). Ketukan saat verifikasi situs aktif tidak dihitung: itu
   * menyelesaikan tantangan, bukan menyetujui tulis di halaman portal.
   */
  let inputWargaTerakhir = Number.NEGATIVE_INFINITY;

  /** Keputusan ketukan saat halaman kotor (ditetapkan saat pointer down, dipakai pointer up yang sama). */
  let ketukKotorSah = false;
  /**
   * Ketukan warga terakhir yang dinilai "kirim final" (kotak sorot serah `final`, atau tombol submit asli di
   * halaman akhir). Tulis warga di jendela ketukan ini saja yang membuat sukses diterima otomatis (re-review LOW).
   */
  let ketukFinalTerakhir = Number.NEGATIVE_INFINITY;

  /**
   * Ketukan warga mengenai kotak sorot serah terakhir, atau kontrol nyata (DOM.getNodeForLocation lalu `closest`
   * di dunia terisolasi, prototipe halaman tidak dipakai). Gagal = tidak.
   */
  async function ketukanKeKontrol(x: number, y: number, keras: boolean): Promise<boolean> {
    return (
      (await ketukanDiSorot(x, y)) || ketukanPadaKontrol(x, y, keras ? SEL_KIRIM_ASLI : SEL_KONTROL_KETUK)
    );
  }

  async function ketukanDiSorot(x: number, y: number): Promise<boolean> {
    const kotak = await generik?.kotakSorot();
    return (
      !!kotak && x >= kotak.x && x <= kotak.x + kotak.lebar && y >= kotak.y && y <= kotak.y + kotak.tinggi
    );
  }

  async function ketukanPadaKontrol(x: number, y: number, sel: string): Promise<boolean> {
    try {
      const { backendNodeId } = (await cdp.send('DOM.getNodeForLocation', {
        x: Math.round(x),
        y: Math.round(y),
        includeUserAgentShadowDOM: false,
      })) as { backendNodeId: number };
      const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
        frameId: await mainFrameId(),
        worldName: 'urusin-ketuk',
      })) as { executionContextId: number };
      const { object } = (await cdp.send('DOM.resolveNode', { backendNodeId, executionContextId })) as {
        object: { objectId?: string };
      };
      if (!object.objectId) return false;
      const r = (await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function () { const e = this.nodeType === 1 ? this : this.parentElement; return !!(e && !e.matches(${JSON.stringify(SEL_KOLOM_KETIK)}) && !e.closest('[contenteditable=""], [contenteditable="true"]') && e.closest(${JSON.stringify(sel)})); }`,
        returnByValue: true,
      })) as { result: { value?: unknown } };
      return r.result.value === true;
    } catch {
      return false;
    }
  }

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

  const waitResume = async () => {
    while (ditahan() && !destroyed) await new Promise<void>((r) => resumeWaiters.push(r));
  };

  const driver: Driver = {
    openTab: async () => 1,
    tab: async () => (destroyed ? null : { url: page.url(), status: loading ? 'loading' : 'complete' }),
    async navigate(_tab, url) {
      await waitResume();
      navTerakhir = url;
      navGagal = undefined;
      loading = true;
      const r = (await cdp.send('Page.navigate', { url }).catch(() => undefined)) as
        { errorText?: string } | undefined;
      if (r?.errorText) navGagal = r.errorText;
    },
    async run(_tab, op) {
      // Saat warga memegang kendali, op yang mengubah halaman menunggu; pemeriksaan (check) tetap jalan.
      // Selama tantangan situs aktif SEMUA op menunggu: AI tidak menyentuh halaman tantangan sama sekali.
      // Sebelum op yang mengubah halaman, pastikan widget tantangan yang baru muncul sudah diperiksa.
      if (MUTATING.has(op.kind)) await periksaTantangan();
      if (MUTATING.has(op.kind) || pantau.aktif || masukAktif) {
        await waitResume();
        // Interpreter memeriksa domain tab SEBELUM op ini menunggu; selama ditahan warga (atau situs) bisa
        // memindahkan halaman. Periksa ULANG setelah dilepas: AI tidak pernah menyentuh halaman di luar allowlist.
        const izin = destroyed ? undefined : await policy(page.url());
        if (izin && !izin.ok) return { ok: false, code: izin.code, message: izin.message };
      }
      if (destroyed) return { ok: false, code: 'CANCELLED', message: 'sesi berakhir' };
      return evaluate(op);
    },
  };

  const fixtureOrigins = config.fixtureOrigins;
  const policy = async (url: string) =>
    checkUrl(url, { testMode: fixtureOrigins.length > 0, fixtureOrigins });

  /** Kotak sorotan + nama tombol yang terlihat di halaman (teks giliran kirim menyebut tombol yang benar). */
  const sorot = async (
    target: Extract<Step, { op: 'gate.human' }>['highlight'],
  ): Promise<{ box: PendampingSorot; teks?: string | undefined } | undefined> => {
    if (!target) return undefined;
    const r = await evaluate({ kind: 'rect', target });
    if (r === 'interrupted' || !r.ok) return undefined;
    const { teks, ...box } = r.value as PendampingSorot & { teks?: string };
    return { box, teks };
  };

  /** Langkah sesudah gerbang kirim (warga sudah menekan tombol kirim) pada alur pengajuan. */
  const lewatKirim = (i: number) => !program.bacaSaja && finalIdx >= 0 && i > finalIdx;

  const stopGatePoll = () => {
    clearInterval(gatePoll);
    gatePoll = undefined;
  };

  const onChange = (c: Cursor) => {
    hooks.activity();
    const prev = status;
    status = c.status;
    if (c.status !== 'waiting_gate') stopGatePoll();
    if (prev === 'waiting_citizen' && c.status !== 'waiting_citizen') hooks.berkasKurang(undefined);
    switch (c.status) {
      case 'running':
      case 'waiting_load':
        // Setelah warga menekan tombol kirim, AI tidak mengisi apa pun lagi: jangan kembali ke "AI mengisi".
        if (lewatKirim(c.stepIndex)) return;
        if (!ditahan()) hooks.mode('ai', 'AI sedang mengisi formulir.');
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
          const s = step?.op === 'gate.human' ? await sorot(step.highlight) : undefined;
          // Alur baca-saja tidak punya pengiriman akhir: gerbangnya CAPTCHA/login.
          const kirim = final && !program.bacaSaja;
          hooks.event({
            jenis: 'giliran_anda',
            alasan: kirim ? 'final' : 'login',
            pesan,
            ...(s ? { sorot: s.box } : {}),
            ...(kirim && s?.teks ? { tombol: s.teks } : {}),
          });
        })();
        gatePoll ??= setInterval(() => void (pantau.aktif || interp.recheckGate()), 1000);
        return;
      }
      case 'waiting_citizen': {
        // Nilai kolom ini tidak ada di daftar write: warga mengetiknya di situs (tidak dicatat, tidak ke AI).
        // Langkah unggah tanpa berkas: warga menambah Dokumen, lalu Lanjutkan = persetujuan baru + ulang.
        if (prev === 'waiting_citizen') return;
        const step = steps[c.stepIndex];
        const pesan = c.message ?? 'Isi kolom yang disorot, lalu tekan Lanjutkan.';
        const nama =
          step?.op === 'upload' ? /^\{\{FILE:([A-Za-z][A-Za-z0-9_]*)\}\}$/.exec(step.file)?.[1] : undefined;
        if (nama) hooks.berkasKurang(nama);
        hooks.mode('takeover', pesan);
        void (async () => {
          const s = step && 'target' in step ? await sorot(step.target) : undefined;
          hooks.event({
            jenis: 'giliran_anda',
            alasan: nama ? 'berkas_kurang' : 'isi_sendiri',
            pesan,
            ...(s ? { sorot: s.box } : {}),
            ...(nama ? { berkas: { nama, origin: program.origin } } : {}),
          });
        })();
        return;
      }
      case 'handoff':
        hooks.mode('takeover', c.message ?? 'Lanjutkan sendiri.');
        hooks.event({ jenis: 'giliran_anda', alasan: 'periksa', pesan: c.message ?? 'Lanjutkan sendiri.' });
        return;
      case 'done':
        // Baca-saja: warga memegang layar (membaca hasil); AI baru bergerak lagi bila ada execution berikutnya.
        // Pengajuan terkirim: bukti dibaca, lalu sesi langsung ditutup (layar sukses + nomor, tanpa jeda).
        manual = true;
        void bacaBukti().then((bukti) =>
          program.bacaSaja
            ? hooks.langkahSelesai('Hasil ada di layar. Baca dulu; tutup sesi bila sudah selesai.', bukti)
            : hooks.langkahSelesai(PESAN_TERKIRIM, bukti, true),
        );
        return;
      case 'error': {
        const code = c.error?.code ?? 'INTERNAL';
        if (code === 'CANCELLED') return;
        const host = new URL(program.origin).host;
        // Halaman galat Chromium (chrome-error://) = navigasi gagal, walau galat jaringannya tak tertangkap.
        const net = navGagal ?? (page.url().startsWith('chrome-error:') ? 'net::ERR_FAILED' : undefined);
        // Satu baris untuk operator: kode, langkah, host, galat jaringan, skema+host halaman yang ter-commit.
        // Tanpa path, query, nilai, atau PII.
        const kini = URL.parse(page.url());
        console.log(
          `pendamping: alur berhenti kode=${code} langkah=${c.stepIndex}/${steps.length} ` +
            `op=${steps[c.stepIndex]?.op ?? '-'} host=${host}${net ? ` net=${net}` : ''} ` +
            `halaman=${kini ? `${kini.protocol}//${kini.host}` : '-'}`,
        );
        if (code === 'ADAPTER_DRIFT')
          return hooks.ended('dipandu', 'drift', 'Tampilan situs berubah. Kami beralih ke panduan langkah.');
        if (code === 'FINAL_NOT_AUTOMATABLE')
          return hooks.ended(
            'gagal',
            'gagal',
            'Urusin menolak menekan tombol kirim. Hanya Anda yang boleh menekannya.',
          );
        return hooks.ended('gagal', 'gagal', pesanGagal(code, host, net), { kode: code, net });
      }
    }
  };

  const buatInterp = () =>
    new Interpreter(memoryKV(), driver, policy, onChange, {
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
      citizenInput: pesanIsiSendiri,
      citizenFile: pesanBerkasKurang,
    });
  let interp = buatInterp();

  /**
   * Bukti (nomor registrasi/status) dari elemen yang DIDEKLARASIKAN adapter, dibaca setelah alur selesai.
   * Best-effort: elemen tidak ada atau nilai tidak lolos skema ketat = dilewati, alur tetap berhasil.
   */
  const bacaBukti = async (): Promise<PendampingBukti | undefined> => {
    const sel = program.bukti;
    if (!sel) return undefined;
    const baca = async (target: Target | undefined) => {
      if (!target) return undefined;
      const r = await evaluate({
        kind: 'step',
        step: { op: 'extract', mode: 'text', target, into: 'bukti', effect: 'read' },
      });
      return r !== 'interrupted' && r.ok && typeof r.value === 'string' ? r.value.trim() : undefined;
    };
    const nomor = PendampingBuktiSchema.shape.nomor.safeParse(await baca(sel.nomor));
    const st = PendampingBuktiSchema.shape.status.safeParse(await baca(sel.status));
    const bukti: PendampingBukti = {
      ...(nomor.success && nomor.data ? { nomor: nomor.data } : {}),
      ...(st.success && st.data ? { status: st.data } : {}),
    };
    return Object.keys(bukti).length > 0 ? bukti : undefined;
  };

  // Peristiwa muat halaman utama -> interpreter (pengganti chrome.tabs.onUpdated di ekstensi).
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loading = true;
  });
  page.on('requestfailed', (r) => {
    if (!r.isNavigationRequest() || r.frame() !== page.mainFrame()) return;
    navGagal = r.failure()?.errorText ?? 'net::ERR_FAILED';
    // Navigasi yang dibatalkan (gerbang tulis) tidak memuat halaman apa pun: tidak ada `load` yang menyusul.
    if (navGagal === 'net::ERR_ABORTED') loading = false;
  });
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) return;
    loading = true;
    void interp.onTabUpdated(1, { status: 'loading' });
  });
  page.on('load', () => {
    loading = false;
    // Periksa tantangan dan status masuk dulu agar interpreter tidak melangkah di halaman tantangan/login.
    void periksaTantangan()
      .then(() => periksaMasuk())
      .finally(() => void interp.onTabUpdated(1, { status: 'complete' }));
  });
  page.on('response', async (resp) => {
    const req = resp.request();
    if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
    navKe++;
    const info = { status: resp.status(), headers: resp.headers() };
    tantanganRespons = /challenge/i.test(info.headers['cf-mitigated'] ?? '');
    if (tantanganRespons) void tanganiTantangan(true);
    if (!suspicious(info)) return;
    const nav = navKe;
    const body = await resp.text().catch(() => '');
    const wall = detectBotWall({ ...info, body: body.slice(0, 20_000) });
    if (!wall || nav !== navKe) return;
    if (wallBisaDiverifikasi(wall)) {
      tantanganRespons = true;
      return void tanganiTantangan(true);
    }
    hooks.ended(
      'dipandu',
      'drift',
      'Situs instansi memblokir peramban server Urusin (perlindungan bot, tanpa verifikasi yang bisa Anda selesaikan). Kami beralih ke panduan: buka situs resmi di perangkat Anda sendiri.',
    );
  });
  // Widget Turnstile yang tertanam di halaman (bukan interstitial) juga diperiksa saat frame-nya muncul.
  page.on('frameattached', () => void periksaTantangan());
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame() && isChallengeFrameUrl(f.url())) void periksaTantangan();
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
      if (mb > config.sessionMemMb) {
        console.log(
          `pendamping: sesi dihentikan kode=MEMORI_SESI mb=${mb} batas=${config.sessionMemMb} ` +
            `host=${new URL(program.origin).host}`,
        );
        // Bukan kesalahan warga: situsnya terlalu berat untuk peramban server. Arahkan ke panduan (dipandu),
        // angka MB hanya di log operator.
        hooks.ended('dipandu', 'drift', PESAN_MEMORI, { kode: 'MEMORI_SESI' });
      }
    } catch {
      // peramban sedang ditutup
    }
  }, config.memCheckMs);
  memTimer.unref?.();

  const touch = createTouchMapper();
  let fokusTerakhir: JenisFokus | undefined;
  /** Evaluasi ekspresi baca-saja di dunia terisolasi dokumen utama (tidak terlihat skrip halaman). */
  const nilaiTerisolasi = async (expression: string): Promise<unknown> => {
    const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
      frameId: await mainFrameId(),
      worldName: 'urusin-baca',
      grantUniveralAccess: false,
    })) as { executionContextId: number };
    const r = (await cdp.send('Runtime.evaluate', {
      expression,
      contextId: executionContextId,
      returnByValue: true,
    })) as { result: { value?: unknown } };
    return r.result.value;
  };
  const periksaFokus = async () => {
    if (destroyed) return;
    try {
      const jenis = (await nilaiTerisolasi(FOKUS_EXPR)) as JenisFokus;
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

  /** Kotak iframe tantangan (juga di shadow root tertutup, lewat CDP), relatif viewport, untuk disorot. */
  const sorotTantangan = async (): Promise<PendampingSorot | undefined> => {
    const f = page.frames().find((x) => x !== page.mainFrame() && isChallengeFrameUrl(x.url()));
    const el = await f?.frameElement().catch(() => null);
    const b = await el?.boundingBox().catch(() => null);
    await el?.dispose().catch(() => {});
    return b && b.width > 0 && b.height > 0
      ? { x: b.x, y: b.y, lebar: b.width, tinggi: b.height }
      : undefined;
  };

  /**
   * Ada tantangan di dokumen ini? Header cf-mitigated/penanda bot wall respons terakhir, judul interstitial,
   * atau widget Turnstile yang belum menghasilkan token (nilai token tidak dibaca, hanya ada/tidaknya).
   */
  const adaTantangan = async (): Promise<boolean> => {
    if (tantanganRespons) return true;
    if (isInterstitialTitle(await page.title().catch(() => ''))) return true;
    if (!page.frames().some((x) => x !== page.mainFrame() && isChallengeFrameUrl(x.url()))) return false;
    const selesai = await nilaiTerisolasi(TOKEN_TURNSTILE_ADA).catch(() => false);
    return selesai !== true;
  };

  let memeriksa: Promise<void> | undefined;
  function periksaTantangan(): Promise<void> {
    if (destroyed) return Promise.resolve();
    memeriksa ??= (async () => {
      try {
        await tanganiTantangan(await adaTantangan());
      } finally {
        memeriksa = undefined;
      }
    })();
    return memeriksa;
  }

  /**
   * Probe masuk akun adapter, saat mulai dan setiap halaman selesai dimuat. Halaman login yang dibuka alur
   * sendiri (langkah login adapter) bukan "keluar akun". Setelah warga masuk, peramban kembali ke halaman
   * yang tadi dituju alur, lalu AI melanjutkan.
   */
  async function periksaMasuk(): Promise<void> {
    const probe = program.masuk;
    if (!probe || destroyed || pantau.aktif || (manual && !masukAktif)) return;
    if (!masukAktif && status !== 'running' && status !== 'waiting_load') return;
    const r = await evaluate({ kind: 'check', check: probe.keluar });
    if (r === 'interrupted' || !r.ok) return;
    const keluar = r.value === true;
    if (masukAktif) {
      if (keluar) return;
      const tujuan = kembaliKe;
      kembaliKe = undefined;
      if (tujuan && page.url() !== tujuan) {
        loading = true;
        await cdp.send('Page.navigate', { url: tujuan }).catch(() => undefined);
        return; // dilepas pada pemeriksaan berikutnya, setelah halaman tujuan dimuat
      }
      masukAktif = false;
      clearInterval(masukPoll);
      masukPoll = undefined;
      hooks.activity();
      hooks.mode('ai', 'Anda sudah masuk. AI melanjutkan.');
      resume();
      return;
    }
    if (!keluar || navTerakhir?.includes(probe.halaman)) return;
    masukAktif = true;
    kembaliKe = navTerakhir;
    hooks.mode('takeover', PESAN_MASUK);
    hooks.event({ jenis: 'giliran_anda', alasan: 'masuk_akun', pesan: PESAN_MASUK });
    if (!page.url().includes(probe.halaman)) {
      loading = true;
      await cdp.send('Page.navigate', { url: `${program.origin}${probe.halaman}` }).catch(() => undefined);
    }
    masukPoll ??= setInterval(() => void (loading || periksaMasuk()), 1000);
  }

  /** Diserialkan: pemeriksaan dari respons, load, frame, dan poll tidak saling mendahului. */
  let antreTantangan = Promise.resolve();
  function tanganiTantangan(ada: boolean): Promise<void> {
    antreTantangan = antreTantangan.then(() => langkahTantangan(ada)).catch(() => {});
    return antreTantangan;
  }
  async function langkahTantangan(ada: boolean): Promise<void> {
    if (destroyed) return;
    const hasil = pantau.amati(ada, navKe, page.url());
    if (hasil === 'tidak_ada') return;
    if (hasil === 'gagal') {
      clearInterval(tantanganPoll);
      tantanganPoll = undefined;
      return hooks.ended(
        'dipandu',
        'drift',
        'Situs instansi tetap menolak verifikasi dari peramban server Urusin. Kami beralih ke panduan: buka situs resmi di perangkat Anda sendiri.',
      );
    }
    if (hasil === 'lolos') {
      clearInterval(tantanganPoll);
      tantanganPoll = undefined;
      hooks.activity();
      // Generik: Navigator sempat menyerahkan CAPTCHA (sinyal tantangan di pengamatan) di dokumen tantangan yang
      // sama, sebelum/bersamaan pemeriksaan tantangan. Tantangan itu kini hilang (judul/URL berganti), jadi
      // serahnya selesai dan AI lanjut mengamati halaman berikutnya. Serah lain (final, isi sendiri) tidak.
      if (manual && generik && !generik.berhenti && serahLoginNav === tantanganNav) {
        manual = false;
        serahLoginNav = undefined;
        init.generik?.jejak({ jenis: 'ambil_alih', fase: 'selesai' });
      }
      if (manual || status === 'waiting_gate' || status === 'waiting_citizen' || status === 'handoff')
        hooks.mode('takeover', 'Verifikasi selesai. Lanjutkan sendiri.');
      else hooks.mode('ai', 'Verifikasi selesai. AI melanjutkan pengisian.');
      resume();
      return;
    }
    // mulai / ulang / masih: warga memegang kendali; AI tidak pernah mengeklik kotak verifikasi.
    if (hasil === 'mulai' || hasil === 'ulang') {
      tantanganNav = navKe;
      sorotTantanganTerkirim = false;
      pesanTantangan =
        hasil === 'ulang' ? 'Verifikasi belum diterima situs. Coba sekali lagi.' : PESAN_VERIFIKASI;
      hooks.mode('takeover', pesanTantangan);
      tantanganPoll ??= setInterval(() => void periksaTantangan(), 1000);
    }
    if (sorotTantanganTerkirim && hasil === 'masih') return;
    const sorot = await sorotTantangan();
    if (hasil === 'masih' && !sorot) return;
    sorotTantanganTerkirim = sorot !== undefined;
    hooks.event({
      jenis: 'giliran_anda',
      alasan: 'verifikasi_situs',
      pesan: pesanTantangan,
      ...(sorot ? { sorot } : {}),
    });
  }

  /** Navigator generik: tangan (runner op amati/aksi) + gerbang tulis + persetujuan dari sesi. */
  let generik: GenerikRun | undefined;
  let generikDimulai = false;
  if (gen && init.generik) {
    const izinHost = new Set(egressRules(gen.hosts, config.fixtureOrigins).map((r) => `${r.host}:${r.port}`));
    const urlBoleh = (url: string) =>
      urlDiAllowlist(izinHost, url) &&
      !hostAset(url) &&
      checkUrl(url, { testMode: fixtureOrigins.length > 0, fixtureOrigins }).ok;
    // Review kode N4: tautan target=_blank yang diketuk warga membuka pop-up yang tidak terlihat di layar. Pop-up
    // selalu ditutup; navigasi GET-nya (hanya dari ketukan warga, lolos allowlist) dibuka di halaman utama.
    // Metode navigasi terakhir per URL (pop-up baru tersedia setelah navigasinya dimulai; bingkainya belum
    // terhubung ke halaman saat permintaan terlihat). Pop-up hasil form POST tidak pernah diulang sebagai GET.
    const metodeNav = new Map<string, string>();
    context.on('request', (r) => {
      if (!r.isNavigationRequest()) return;
      metodeNav.delete(r.url());
      metodeNav.set(r.url(), r.method());
      if (metodeNav.size > 32) metodeNav.delete(metodeNav.keys().next().value!);
    });
    context.on('page', (p) => {
      if (p === page) return;
      const dariWarga = manual && Date.now() - inputWargaTerakhir <= JENDELA_WARGA_MS;
      void (async () => {
        if (dariWarga) await p.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {});
        const url = p.url();
        await p.close().catch(() => {});
        if (!dariWarga || metodeNav.get(url) !== 'GET' || destroyed || !manual || !urlBoleh(url)) return;
        await cdp.send('Page.navigate', { url }).catch(() => undefined);
      })();
    });
    const { izin, jejak } = init.generik;
    const tenang = async () => {
      // Jeda singkat agar handler klik sempat memicu permintaan; bila navigasi dimulai, tunggu muat (<= 10 detik).
      await new Promise((r) => setTimeout(r, 400));
      const batas = Date.now() + 10_000;
      while (loading && !destroyed && Date.now() < batas) await new Promise((r) => setTimeout(r, 100));
      // SPA (probe 3208): kendali baru muncul setelah load. Tunggu jumlahnya > 0 dan sama pada dua bacaan
      // berturut-turut (<= 5 detik). Hitungan lewat locator (dunia utilitas Playwright), tanpa skrip halaman.
      const batasDom = Date.now() + 5_000;
      let sebelum = -1;
      while (!destroyed && Date.now() < batasDom) {
        const n = await page
          .locator(SEL_KENDALI_TENANG)
          .count()
          .catch(() => -1);
        if (n > 0 && n === sebelum) break;
        sebelum = n;
        await new Promise((r) => setTimeout(r, 250));
      }
      // Konten fade-in (probe gel4 6171): tunggu transisi/animasi berhingga selesai dan konten besar yang memuat
      // kendali tidak lagi transparan, paling lama 3 detik.
      const batasPudar = Date.now() + 3_000;
      while (!destroyed && Date.now() < batasPudar) {
        const belum = await nilaiTerisolasi(KONTEN_BELUM_TAMPIL_EXPR).catch(() => false);
        if (belum !== true) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    generik = new GenerikRun({
      tangan: tanganRunner({
        // Aksi generik = op yang mengubah halaman: periksa tantangan dulu; selama tantangan/takeover AI tidak
        // menyentuh halaman sama sekali (aksi gagal, Navigator menunggu lewat `tunggu`).
        evaluate: async (op) => {
          const o = op as RunnerOp;
          if (MUTATING.has(o.kind)) {
            await periksaTantangan();
            if (ditahan() || destroyed) return { ok: false, code: 'DITAHAN', message: 'giliran warga' };
          }
          // Interstitial tantangan (Turnstile "Verify you are human", probe gel4 1372/3275): diperiksa SEBELUM
          // pengamatan, jadi mode yang dibaca Navigator sesudahnya sudah giliran warga (verifikasi_situs, sorot
          // widget). Navigator menunggu, lalu lanjut sendiri setelah tantangan hilang (`lolos`).
          else if (o.kind === 'amati') await periksaTantangan();
          return evaluate(o);
        },
        async navigasi(url) {
          navTerakhir = url;
          navGagal = undefined;
          loading = true;
          const r = (await cdp.send('Page.navigate', { url }).catch(() => undefined)) as
            { errorText?: string } | undefined;
          if (r?.errorText) {
            navGagal = r.errorText;
            loading = false;
          }
        },
        tenang,
        urlKini: () => page.url(),
      }),
      gerbang: gen.gerbang,
      izin,
      urlBoleh,
      jejak,
      serahkan(alasan, pesan, box, tautan) {
        manual = true;
        // Serah CAPTCHA/kode (`login`) di dokumen ini: bila dokumen yang sama ternyata halaman tantangan, serah ini
        // ikut selesai saat tantangannya lolos (lihat langkahTantangan).
        serahLoginNav = alasan === 'login' ? navKe : undefined;
        // Giliran masuk akun / CAPTCHA / OTP: worker memantau sendiri kapan giliran itu selesai (AI lanjut tanpa
        // menunggu tombol warga). Serah lain (final, isi sendiri, tautan, berhenti) tetap menunggu warga.
        void mulaiPantauSerah(alasan === 'login' || alasan === 'masuk_akun');
        hooks.mode('takeover', pesan);
        hooks.event({
          jenis: 'giliran_anda',
          alasan,
          pesan,
          ...(box ? { sorot: box } : {}),
          ...(tautan ? { tautan } : {}),
        });
      },
      // Situs tidak bisa dikerjakan AI (mis. hanya lewat WhatsApp): dipandu, bukan gagal (sama dengan drift adapter).
      tidakBisa: (pesan) => hooks.ended('dipandu', 'drift', pesan),
    });
    const run = generik;

    /**
     * Giliran masuk akun / CAPTCHA / OTP selesai tanpa tombol warga: dokumen utama berganti (nomor dokumen, jalur,
     * atau judul) DAN pengamatan baca-saja tidak lagi menunjukkan formulir masuk, CAPTCHA, OTP, atau tantangan.
     * Halaman sukses dibiarkan ke Navigator (pantau sukses). Gagal masuk yang tetap di formulir = tetap giliran
     * warga; tombol "Sudah, lanjutkan" di web tetap jadi cadangan (`kembalikan`).
     */
    const halamanKini = () => {
      const u = URL.parse(page.url());
      return u ? `${u.origin}${u.pathname}` : page.url();
    };
    let serahGiliran: { nav: number; halaman: string; judul: string } | undefined;
    let serahPoll: ReturnType<typeof setInterval> | undefined;
    let memeriksaSerah = false;
    const hentiPantauSerah = () => {
      serahGiliran = undefined;
      clearInterval(serahPoll);
      serahPoll = undefined;
    };
    mulaiPantauSerah = async (pantauSerah: boolean) => {
      hentiPantauSerah();
      if (!pantauSerah) return;
      const awal = { nav: navKe, halaman: halamanKini(), judul: await page.title().catch(() => '') };
      if (!manual || destroyed) return;
      serahGiliran = awal;
      serahPoll = setInterval(() => void periksaSerahSelesai(), 1000);
      serahPoll.unref?.();
    };
    const periksaSerahSelesai = async () => {
      const s = serahGiliran;
      if (!s || destroyed || !manual || run.berhenti) return hentiPantauSerah();
      if (memeriksaSerah || pantau.aktif || masukAktif || loading) return;
      memeriksaSerah = true;
      try {
        const berganti =
          navKe !== s.nav ||
          halamanKini() !== s.halaman ||
          (await page.title().catch(() => s.judul)) !== s.judul;
        if (!berganti) return;
        const p = await run.amati(true).catch(() => null);
        if (!p || serahGiliran !== s || !manual || destroyed || pantau.aktif) return;
        const { login, captcha, otp, tantangan, sukses } = p.sinyal;
        if (login || captcha || otp || tantangan || sukses) return;
        hentiPantauSerah();
        manual = false;
        serahLoginNav = undefined;
        jejak({ jenis: 'ambil_alih', fase: 'selesai' });
        hooks.activity();
        hooks.mode('ai', PESAN_GILIRAN_SELESAI);
        resume();
      } finally {
        memeriksaSerah = false;
      }
    };
    // Dokumen bingkai utama baru (cross-document, ter-commit) = timer dokumen lama mati: bendera kotor direset.
    cdp.on('Page.frameNavigated', (e: { frame: { parentId?: string } }) => {
      if (!e.frame.parentId) run.dokumenBaru();
    });
    await cdp.send('Page.enable').catch(() => {});
    gen.kendali.wargaTunggu = ditahan;
    gen.kendali.wargaPegang = () => ditahan() && Date.now() - inputWargaTerakhir <= JENDELA_WARGA_MS;
    gen.kendali.blokir = (c, j) => run.blokir(c, j);
    gen.kendali.hostDiblokir = (host, dokumen) => run.hostDiblokir(host, dokumen);
    gen.kendali.ketat = () => run.ketat;
    // Hanya dari ketukan warga yang baru saja terjadi (navigasi AI sudah dinaikkan di GenerikRun.navigasi).
    gen.kendali.naikHttps = (url) => {
      if (destroyed || !gen.kendali.wargaPegang() || !urlBoleh(url)) return;
      setTimeout(() => void cdp.send('Page.navigate', { url }).catch(() => undefined), 0);
    };
    // Review kode N1: warga mengirim sendiri (mis. setelah AI menyerah, loop di web sudah berhenti). Halaman sukses
    // sesudah kirim final warga (kotak sorot `final` / submit asli di halaman akhir) = sesi siaga berhasil tanpa
    // menunggu /selesai; tulis warga lain tetap butuh /selesai. Diperiksa saat dokumen utama dimuat dan
    // sebentar sesudah tulis warga (SPA: hasil lewat XHR tanpa muat ulang).
    let memeriksaSukses = false;
    const periksaSuksesWarga = async () => {
      if (!manual || destroyed || memeriksaSukses || !run.adaKirimFinalWargaSejakAksiAi()) return;
      memeriksaSukses = true;
      try {
        const p = await run.amati(true).catch(() => null);
        if (p?.sinyal.sukses && run.adaKirimFinalWargaSejakAksiAi()) hooks.suksesWarga?.(p);
      } finally {
        memeriksaSukses = false;
      }
    };
    page.on('load', () => void periksaSuksesWarga());
    gen.kendali.tulisWarga = () => {
      run.tulisWarga(Date.now() - ketukFinalTerakhir <= JENDELA_WARGA_MS);
      for (const ms of [1_500, 5_000]) setTimeout(() => void periksaSuksesWarga(), ms).unref?.();
    };
  }

  const g = generik;
  const api: ActiveRun = {
    ...(g
      ? {
          generik: {
            amati: (pantau) => g.amati(pantau),
            aksi: (req) => g.aksi(req),
            adaTulisWargaSejakAksiAi: () => g.adaTulisWargaSejakAksiAi(),
          },
        }
      : {}),
    async mulaiAi() {
      if (g) {
        // Generik: AI hanya membuka halaman awal; selanjutnya otak di web memanggil amati/aksi.
        if (generikDimulai) return;
        generikDimulai = true;
        const awal = steps[0];
        await g.mulai(`${program.origin}${awal?.op === 'nav' ? awal.path : '/'}`);
        return;
      }
      if (init.manualUrl) {
        // Mode debug: tidak ada AI; penguji manusia memegang kendali sejak awal.
        manual = true;
        hooks.mode('takeover', 'Mode debug: kemudi manual oleh penguji.');
        hooks.event({ jenis: 'giliran_anda', alasan: 'diminta_warga', pesan: 'Mode debug: kemudi manual.' });
        await page.goto(init.manualUrl, { waitUntil: 'commit' }).catch(() => undefined);
        return;
      }
      const started = await interp.start({ executionId, origin: program.origin, steps });
      if ('ok' in started) hooks.ended('gagal', 'gagal', 'Langkah otomatis tidak bisa dimulai.');
    },
    async input(m) {
      // Jendela tulis warga dibuka SEBELUM input diteruskan (handler klik halaman berjalan saat dispatch).
      const nyata =
        m.type === 'text' ||
        ((m.type === 'pointer' || m.type === 'key') && (m.aksi === 'down' || m.aksi === 'up'));
      let buka = nyata && !pantau.aktif;
      // N4: halaman kotor (tulis tertunda dari klik AI masih berdenyut) = jendela tulis hanya untuk ketukan yang
      // mengenai kotak sorot, tombol kirim, atau tautan. Ketikan, kontrol isian, dan area kosong tidak. Kotor oleh
      // aksi AI yang tidak bisa dimuat ulang (A2): hanya kotak sorot atau tombol submit asli.
      if (buka && g?.kotor) {
        if (m.type !== 'pointer') buka = false;
        else if (m.aksi === 'down') buka = ketukKotorSah = await ketukanKeKontrol(m.x, m.y, g.kotorKeras);
        else buka = ketukKotorSah;
      }
      if (buka) inputWargaTerakhir = Date.now();
      // Re-review LOW: kirim final warga = ketukan pada kotak sorot serah `final`, atau tombol submit asli di
      // halaman akhir. Tulis warga lain (mis. "cek status") tidak membuat sukses diterima otomatis.
      if (buka && g && m.type === 'pointer' && m.aksi === 'down') {
        const final =
          (g.sorotFinal && (await ketukanDiSorot(m.x, m.y))) ||
          (g.akhir && (await ketukanPadaKontrol(m.x, m.y, SEL_KIRIM_ASLI)));
        if (final) ketukFinalTerakhir = Date.now();
      }
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
    async gantiProgram(p, id) {
      await interp.cancel().catch(() => {});
      g?.eksekusiBaru();
      program = p;
      steps = p.steps;
      finalIdx = finalGateIndex(steps);
      executionId = id;
      lastLangkah = -1;
      status = undefined;
      stopGatePoll();
      clearInterval(masukPoll);
      masukPoll = undefined;
      masukAktif = false;
      kembaliKe = undefined;
      manual = false;
      interp = buatInterp();
    },
    async bukaTautan(ref) {
      if (!g || !manual || g.berhenti) return false;
      return g.bukaTautan(ref, () => api.kembalikan());
    },
    kembalikan() {
      // Serah akhir `berhenti`: loop Navigator sudah berhenti, jadi tidak ada AI yang melanjutkan.
      if (g?.berhenti) return hooks.mode('takeover', PESAN_GENERIK.berhenti);
      manual = false;
      resume();
      if (pantau.aktif) return hooks.mode('takeover', PESAN_VERIFIKASI);
      if (masukAktif) return hooks.mode('takeover', PESAN_MASUK);
      // Gerbang warga belum terpenuhi: tetap giliran warga; selain itu AI lanjut.
      if (status === 'waiting_gate') void interp.recheckGate();
      else if (status === 'waiting_citizen') void interp.citizenDone();
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
      clearInterval(tantanganPoll);
      clearInterval(masukPoll);
      resume();
      viewerSend = null;
      await interp.cancel().catch(() => {});
      await iso.close();
    },
  };
  return api;
}
