import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AntreanPendampingResponse,
  BerkasSesiInternal,
  ButuhSesiInternal,
  MulaiSesiInternal,
  PendampingBukti,
  PendampingClientMessage,
  PendampingEvent,
  PendampingHasil,
  PendampingKodeGalat,
  PendampingMode,
  PendampingServerMessage,
  PendampingStatus,
  PendampingViewport,
  SesiPendamping,
} from '@urusin/contracts';
import { ADAPTERS, buildProgram, requiredData, type Params, type Program } from '@urusin/adapters';
import type { Step } from '@urusin/core';
import { checkUrl, type UploadFile } from '@urusin/executor';
import type { Config } from './config.js';
import { isInputMessage } from './input.js';
import { dariDataDiri } from './isian.js';
import type { FrameMasuk } from './stream.js';

/**
 * Manajer sesi Browser Pendamping: kepemilikan (urusan + hash cookie sesi), antrean FIFO dengan batas sesi
 * aktif, tiket WS sekali pakai, TTL dan idle, serta data vault/berkas yang HANYA hidup di memori sesi.
 * Bagian peramban ada di balik `RunFactory` agar logika ini bisa diuji tanpa Chromium.
 */

export type Hooks = {
  mode(mode: Exclude<PendampingMode, 'done'>, pesan?: string): void;
  /** Jenis kolom yang fokus setelah input warga (tanpa nilai), untuk input tersembunyi di ponsel. */
  fokus(jenis: JenisFokus): void;
  event(e: PendampingEvent): void;
  /** Ada kemajuan AI (menunda idle). */
  activity(): void;
  /** Sesi berakhir dari sisi peramban (drift, bot wall, memori, galat). */
  ended(status: PendampingStatus, hasil: PendampingHasil, pesan: string): void;
  /**
   * Alur (execution) selesai berhasil: sesi `siaga`, peramban tetap hidup (warga membaca hasil, langkah
   * berikutnya di urusan yang sama tanpa login ulang) sampai TTL/idle/diakhiri.
   */
  langkahSelesai(pesan: string, bukti?: PendampingBukti): void;
  /**
   * Langkah unggah menunggu berkas yang belum ada di akun (giliran `berkas_kurang`); undefined = tidak lagi.
   * Selama itu web boleh mengirim berkas itu saja lewat jalur isi server (persetujuan baru).
   */
  berkasKurang(nama: string | undefined): void;
};

export type Frame = FrameMasuk;
export type JenisFokus = Extract<PendampingServerMessage, { type: 'fokus' }>['jenis'];

export type ActiveRun = {
  /** Mulai AI (dipanggil setelah semua data vault/berkas tersedia). */
  mulaiAi(): Promise<void>;
  input(m: Extract<PendampingClientMessage, { type: 'pointer' | 'wheel' | 'key' | 'text' }>): Promise<void>;
  ambilAlih(): void;
  kembalikan(): void;
  /** Ganti program untuk execution berikutnya di peramban yang sama (sesi siaga). */
  gantiProgram(program: Program, executionId: string): Promise<void>;
  setViewer(send: ((f: Frame) => void) | null): Promise<void>;
  destroy(): Promise<void>;
};

export type RunInit = {
  sesiId: string;
  program: Program;
  /** Mode debug (kemudi manual): buka URL ini lalu langsung takeover; tidak ada langkah AI. */
  manualUrl?: string | undefined;
  executionId: string;
  viewport: PendampingViewport;
  hooks: Hooks;
  data: { value(token: string): string | undefined; file(name: string): UploadFile | undefined };
};

export type RunFactory = (init: RunInit) => Promise<ActiveRun>;

type Viewer = {
  send(m: PendampingServerMessage): void;
  /** Frame layar (biner, dengan backpressure di sisi koneksi). */
  frame(f: Frame): void;
  ack(seq: number): void;
  close(code: number, reason: string): void;
};

type Sesi = {
  id: string;
  urusanId: string;
  sidHash: string;
  executionId: string;
  program: Program;
  manualUrl?: string | undefined;
  /** Sesi dari halaman /debug (kemudi manual atau alur adapter yang dipantau penguji). */
  debug?: boolean | undefined;
  viewport: PendampingViewport;
  dibuatPada: number;
  kedaluwarsaPada: number;
  status: PendampingStatus;
  mode: PendampingMode | null;
  pesan?: string | undefined;
  hasil?: PendampingHasil | undefined;
  bukti?: PendampingBukti | undefined;
  lastActivity: number;
  vault: Map<string, string>;
  files: Map<string, UploadFile>;
  butuh: { placeholder: string[]; berkas: string[] };
  run?: ActiveRun | undefined;
  viewer?: Viewer | undefined;
  aiDimulai: boolean;
  galatInputTerkirim: boolean;
  /** Berkas yang ditunggu langkah unggah (giliran `berkas_kurang`), bila ada. */
  berkasDitunggu?: string | undefined;
};

export class PendampingError extends Error {
  constructor(
    readonly kode: PendampingKodeGalat,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TERMINAL: ReadonlySet<PendampingStatus> = new Set([
  'selesai',
  'gagal',
  'dipandu',
  'kedaluwarsa',
  'dibatalkan',
]);
const DEFAULT_VIEWPORT: PendampingViewport = { lebar: 390, tinggi: 844, dpr: 2, seluler: true };
const MAX_FILE_BYTES = 9 * 1024 * 1024;
const MAX_FILES = 10;
const TOMBSTONE_MS = 10 * 60_000;

const PESAN = {
  kedaluwarsa: 'Sesi peramban ditutup karena terlalu lama tidak ada aktivitas. Mulai lagi bila perlu.',
  dibatalkan: 'Sesi peramban diakhiri. Tidak ada yang disimpan.',
  inputMode: 'Tunggu giliran Anda. Tekan "Ambil alih" bila ingin mengendalikan sendiri.',
} as const;

export const sidHashOf = (sid: string) => createHash('sha256').update(sid).digest('hex');

/**
 * Data yang menahan AI di `menunggu_data`: placeholder Data Diri (daftar write "Izinkan isi") dan berkas.
 * Placeholder lain (kitir, NIB, nomor polisi) tidak pernah menahan: warga mengetiknya di kolomnya (isian.ts).
 */
function butuhDari(steps: readonly Step[]): { placeholder: string[]; berkas: string[] } {
  const r = requiredData(steps);
  return { placeholder: r.placeholder.filter(dariDataDiri), berkas: r.berkas };
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class SessionManager {
  private readonly sessions = new Map<string, Sesi>();
  private readonly queue: string[] = [];
  private readonly active = new Set<string>();
  private readonly tickets = new Map<string, { sesiId: string; exp: number }>();
  private readonly tombstones = new Map<string, { sesi: SesiPendamping; exp: number }>();
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly config: Config,
    private readonly factory: RunFactory,
    private readonly now: () => number = Date.now,
  ) {}

  startSweeper(intervalMs = 1000): void {
    this.sweeper ??= setInterval(() => void this.sweep(), intervalMs);
    this.sweeper.unref?.();
  }

  async shutdown(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all(
      [...this.sessions.values()].map((s) => this.end(s, 'dibatalkan', 'dibatalkan', PESAN.dibatalkan)),
    );
  }

  // ---- API internal (dipanggil web broker) ---------------------------------

  async create(input: MulaiSesiInternal): Promise<SesiPendamping> {
    const program = this.programDari(input);
    const existing = this.byUrusan(input.urusanId);
    if (existing) {
      this.assertOwner(existing, input.sidHash);
      if (existing.executionId === input.executionId) return this.view(existing);
      if (existing.status !== 'siaga' || !existing.run)
        throw new PendampingError('SESI_SUDAH_ADA', 409, 'urusan ini sudah punya sesi pendamping aktif');
      // Sesi siaga di situs yang sama: peramban (dan login warga) dipakai lagi untuk execution baru.
      if (existing.program.origin === program.origin)
        return this.lanjutkan(existing, input.executionId, program);
      await this.end(
        existing,
        'selesai',
        'berhasil',
        'Langkah sebelumnya selesai. Situs lain dibuka di sesi baru.',
      );
    }
    return this.enqueue({
      urusanId: input.urusanId,
      sidHash: input.sidHash,
      executionId: input.executionId,
      program,
      viewport: input.viewport ?? DEFAULT_VIEWPORT,
    });
  }

  /** Program tervalidasi dari adapter; origin resmi bisa dipetakan ke fixture (dev/uji) beserta awalan jalur. */
  private programDari(input: MulaiSesiInternal): Program {
    const built = buildProgram(input.adapterId, input.flowId, input.params);
    if (!built.ok) throw new PendampingError('ADAPTER_TIDAK_ADA', 422, built.message);
    if (built.program.origin !== new URL(input.origin).origin)
      throw new PendampingError('ADAPTER_TIDAK_ADA', 422, 'origin registry tidak cocok dengan adapter');
    const ov = this.config.originOverrides.get(built.program.origin);
    // Mode Uji (juri/tamu): HANYA replika fixture; tanpa pemetaan untuk situs ini sesi ditolak (gagal tertutup).
    if (input.modeUji === true) {
      if (!ov)
        throw new PendampingError('ADAPTER_TIDAK_ADA', 422, 'Mode uji: situs ini belum punya replika uji.');
      return withOverride(built.program, ov);
    }
    // Produksi di luar Mode Uji: portal resmi apa adanya. Dev/CI: pemetaan fixture bila dikonfigurasi.
    return ov && !this.config.production ? withOverride(built.program, ov) : built.program;
  }

  private async lanjutkan(s: Sesi, executionId: string, program: Program): Promise<SesiPendamping> {
    s.executionId = executionId;
    s.program = program;
    s.butuh = butuhDari(program.steps);
    s.hasil = undefined;
    s.bukti = undefined;
    s.pesan = undefined;
    s.aiDimulai = false;
    s.status = 'menunggu_data';
    s.lastActivity = this.now();
    await s.run?.gantiProgram(program, executionId);
    this.broadcastStatus(s);
    await this.maybeStartAi(s);
    return this.view(s);
  }

  /**
   * Sesi debug (PENDAMPING_DEBUG_TOKEN): penguji manusia mengemudikan peramban lewat stream, tanpa AI.
   * URL tetap harus lolos allowlist egress (domain resmi registry, atau fixture saat uji).
   */
  async createManual(input: {
    url: string;
    sidHash: string;
    viewport?: PendampingViewport | undefined;
  }): Promise<SesiPendamping> {
    const fixtureOrigins = this.config.fixtureOrigins;
    if (!checkUrl(input.url, { testMode: fixtureOrigins.length > 0, fixtureOrigins }).ok)
      throw new PendampingError('ADAPTER_TIDAK_ADA', 422, 'URL di luar allowlist domain resmi');
    const url = new URL(input.url);
    // Host sesi: milik adapter bila URL di origin adapter; selain itu hanya host itu + widget Turnstile
    // (tujuan utama mode ini: uji klik manusia pada verifikasi situs).
    const adapter = Object.values(ADAPTERS).find((a) => a.origin === url.origin);
    return this.enqueue({
      urusanId: `debug-${randomUUID()}`,
      sidHash: input.sidHash,
      executionId: 'debug-manual',
      program: { origin: url.origin, hosts: adapter?.hosts ?? ['challenges.cloudflare.com'], steps: [] },
      manualUrl: url.href,
      debug: true,
      viewport: input.viewport ?? DEFAULT_VIEWPORT,
    });
  }

  /**
   * Sesi debug yang menjalankan alur adapter (AI mengisi) agar penguji bisa mencoba alur baca-saja terhadap
   * situs nyata lewat stream: nilai vault diketik penguji di halaman /debug, tantangan/captcha oleh penguji.
   */
  async createDebugAlur(input: {
    adapterId: string;
    flowId: string;
    params: Params;
    sidHash: string;
    viewport?: PendampingViewport | undefined;
  }): Promise<SesiPendamping> {
    const origin = Object.hasOwn(ADAPTERS, input.adapterId) ? ADAPTERS[input.adapterId]?.origin : undefined;
    if (!origin) throw new PendampingError('ADAPTER_TIDAK_ADA', 422, 'adapter tidak dikenal');
    const id = randomUUID();
    const program = this.programDari({
      urusanId: `debug-${id}`,
      sidHash: input.sidHash,
      executionId: `debug-${id}`,
      adapterId: input.adapterId,
      flowId: input.flowId,
      origin,
      params: input.params,
    });
    return this.enqueue({
      urusanId: `debug-${id}`,
      sidHash: input.sidHash,
      executionId: `debug-${id}`,
      program,
      debug: true,
      viewport: input.viewport ?? DEFAULT_VIEWPORT,
    });
  }

  /** Pemilik sesi debug (untuk tiket dari halaman /debug); undefined bila bukan sesi debug. */
  debugOwner(sesiId: string): { urusanId: string; sidHash: string } | undefined {
    const s = this.sessions.get(sesiId);
    return s?.debug ? { urusanId: s.urusanId, sidHash: s.sidHash } : undefined;
  }

  private async enqueue(
    base: Pick<Sesi, 'urusanId' | 'sidHash' | 'executionId' | 'program' | 'manualUrl' | 'viewport'> &
      Partial<Pick<Sesi, 'debug'>>,
  ): Promise<SesiPendamping> {
    if (this.active.size >= this.config.maxSessions && this.queue.length >= this.config.maxQueue)
      throw new PendampingError('ANTREAN_PENUH', 429, 'antrean pendamping penuh');
    // Headless hanya untuk CI terhadap fixture: situs nyata selalu lewat Chromium headed (Xvfb).
    if (this.config.headless && !this.config.fixtureOrigins.includes(base.program.origin))
      throw new PendampingError('LAYANAN_TIDAK_TERSEDIA', 503, 'mode headless hanya untuk fixture');
    const t = this.now();
    const s: Sesi = {
      ...base,
      id: randomUUID(),
      dibuatPada: t,
      kedaluwarsaPada: t + this.config.ttlMs,
      status: 'antre',
      mode: null,
      lastActivity: t,
      vault: new Map(),
      files: new Map(),
      butuh: butuhDari(base.program.steps),
      aiDimulai: false,
      galatInputTerkirim: false,
    };
    this.sessions.set(s.id, s);
    this.queue.push(s.id);
    await this.pump();
    return this.view(s);
  }

  status(owner: { urusanId: string; sidHash: string }): SesiPendamping {
    const s = this.byUrusan(owner.urusanId);
    if (s) {
      this.assertOwner(s, owner.sidHash);
      return this.view(s);
    }
    const tomb = this.tombstones.get(`${owner.urusanId}:${owner.sidHash}`);
    if (tomb) return tomb.sesi;
    throw new PendampingError('SESI_TIDAK_ADA', 404, 'tidak ada sesi pendamping');
  }

  mintTicket(owner: { urusanId: string; sidHash: string }): { sesiId: string; tiket: string; exp: number } {
    const s = this.requireOwned(owner);
    const tiket = randomBytes(32).toString('base64url');
    const exp = this.now() + this.config.ticketTtlMs;
    this.tickets.set(tiket, { sesiId: s.id, exp });
    return { sesiId: s.id, tiket, exp };
  }

  /** Warga (atau tool MCP) meminta kendali: AI berhenti setelah langkah berjalan. */
  serahkan(owner: { urusanId: string; sidHash: string }): SesiPendamping {
    const s = this.requireOwned(owner);
    this.handleControl(s, 'ambil_alih');
    return this.view(s);
  }

  async akhiri(owner: { urusanId: string; sidHash: string }): Promise<SesiPendamping> {
    const s = this.requireOwned(owner);
    await this.end(s, 'dibatalkan', 'dibatalkan', PESAN.dibatalkan);
    return this.status(owner);
  }

  /**
   * Jalur isi server (A-M1): data yang masih dibutuhkan sesi sebelum AI mulai, plus origin yang benar-benar
   * dibuka peramban (tujuan nilai). Web memakai daftar ini sebagai daftar write persetujuan "Izinkan isi".
   */
  butuhData(owner: { urusanId: string; sidHash: string }): ButuhSesiInternal {
    const s = this.requireMenungguData(owner);
    return { ...this.kurang(s), origin: s.program.origin };
  }

  /**
   * Nilai Data Diri yang diselesaikan server (resolver vault + token persetujuan sekali pakai) lewat kanal
   * internal. Hanya placeholder yang memang dibutuhkan sesi ini yang disimpan (di memori sesi saja).
   */
  async isiData(
    owner: { urusanId: string; sidHash: string },
    isian: Record<string, string>,
  ): Promise<{ placeholder: string[]; berkas: string[] }> {
    const s = this.requireMenungguData(owner);
    for (const [k, v] of Object.entries(isian)) if (s.butuh.placeholder.includes(k)) s.vault.set(k, v);
    const kurang = this.kurang(s);
    // Panggilan TERAKHIR putaran "Izinkan isi" (web mengirim berkas dulu, lalu isian). Persetujuan sekali pakai
    // sudah dipakai: Data Diri kosong diketik warga di kolomnya (isi_sendiri), berkas yang belum ada diminta
    // saat AI sampai di langkah unggah (berkas_kurang). Keduanya tidak lagi menahan AI.
    s.butuh = {
      placeholder: s.butuh.placeholder.filter((p) => s.vault.has(p)),
      berkas: s.butuh.berkas.filter((b) => s.files.has(b)),
    };
    await this.maybeStartAi(s);
    return kurang;
  }

  /** Satu berkas dari Dokumen akun (server) untuk `{{FILE:<nama>}}`; hanya nama yang dibutuhkan sesi. */
  async isiBerkas(
    owner: { urusanId: string; sidHash: string },
    b: Pick<BerkasSesiInternal, 'nama' | 'namaBerkas' | 'mime' | 'dataBase64'>,
  ): Promise<{ placeholder: string[]; berkas: string[] }> {
    const s = this.requireMenungguData(owner);
    const boleh = s.berkasDitunggu !== undefined ? [s.berkasDitunggu] : s.butuh.berkas;
    if (!boleh.includes(b.nama) || (s.files.size >= MAX_FILES && !s.files.has(b.nama)))
      throw new PendampingError('PESAN_TIDAK_SAH', 422, 'berkas ini tidak dibutuhkan sesi');
    if (Buffer.byteLength(b.dataBase64, 'base64') > MAX_FILE_BYTES)
      throw new PendampingError('BERKAS_TERLALU_BESAR', 413, 'Berkas melebihi 9 MB.');
    s.files.set(b.nama, { name: b.namaBerkas, mime: b.mime, base64: b.dataBase64 });
    // AI mulai di `isiData` (panggilan terakhir putaran), bukan di sini.
    return this.kurang(s);
  }

  antrean(): AntreanPendampingResponse {
    return { aktif: this.active.size, maks: this.config.maxSessions, menunggu: this.queue.length };
  }

  // ---- WebSocket -----------------------------------------------------------

  /**
   * Tukar tiket sekali pakai; tiket terikat ke satu sesi, dan hash cookie `urusin_sid` dari upgrade WS harus
   * sama dengan pemilik sesi. Sambung ulang selalu memakai tiket baru.
   */
  consumeTicket(tiket: string, sesiId: string, sidHash: string): boolean {
    const t = this.tickets.get(tiket);
    this.tickets.delete(tiket);
    if (!t || t.exp < this.now() || t.sesiId !== sesiId) return false;
    const s = this.sessions.get(sesiId);
    return s !== undefined && !TERMINAL.has(s.status) && sameHash(s.sidHash, sidHash);
  }

  /**
   * Pemeriksaan sebelum upgrade WebSocket (sebelum memori apa pun dialokasikan untuk soket): sesi ada, belum
   * selesai, dan hash cookie `urusin_sid` sama dengan pemilik sesi.
   */
  pemilikCocok(sesiId: string, sidHash: string): boolean {
    const s = this.sessions.get(sesiId);
    return s !== undefined && !TERMINAL.has(s.status) && sameHash(s.sidHash, sidHash);
  }

  async attach(sesiId: string, viewer: Viewer): Promise<void> {
    const s = this.sessions.get(sesiId);
    if (!s) return viewer.close(4404, 'sesi tidak ada');
    s.viewer?.close(4409, 'digantikan');
    s.viewer = viewer;
    s.lastActivity = this.now();
    viewer.send({ type: 'status', sesi: this.view(s) });
    if (s.mode) viewer.send({ type: 'mode', mode: s.mode, ...(s.pesan ? { pesan: s.pesan } : {}) });
    if (s.status === 'menunggu_data')
      viewer.send({ type: 'butuh_data', ...this.kurang(s), origin: s.program.origin });
    await s.run?.setViewer((f) => s.viewer === viewer && viewer.frame(f));
  }

  async detach(sesiId: string, viewer: Viewer): Promise<void> {
    const s = this.sessions.get(sesiId);
    if (!s || s.viewer !== viewer) return;
    s.viewer = undefined;
    await s.run?.setViewer(null);
  }

  async handleClient(sesiId: string, m: PendampingClientMessage): Promise<void> {
    const s = this.sessions.get(sesiId);
    if (!s || TERMINAL.has(s.status)) return;
    if (m.type === 'ping') return s.viewer?.send({ type: 'pong', t: m.t });
    // ack frame otomatis: bukan aktivitas warga (tidak menunda idle).
    if (m.type === 'ack') return s.viewer?.ack(m.seq);
    if (isInputMessage(m)) {
      // Ketukan di luar giliran warga tidak dihitung aktivitas: tidak bisa menahan sesi tetap hidup.
      if (s.mode !== 'takeover' || !s.run) {
        // Satu kali per periode AI, agar warga tahu kenapa ketukannya tidak berefek.
        if (!s.galatInputTerkirim)
          s.viewer?.send({ type: 'galat', kode: 'INPUT_DITOLAK_MODE_AI', pesanWarga: PESAN.inputMode });
        s.galatInputTerkirim = true;
        return;
      }
      s.lastActivity = this.now();
      return s.run.input(m);
    }
    s.lastActivity = this.now();
    switch (m.type) {
      case 'ambil_alih':
      case 'kembalikan':
        return this.handleControl(s, m.type);
      case 'akhiri':
        return this.end(s, 'dibatalkan', 'dibatalkan', PESAN.dibatalkan);
      case 'halo':
        return;
    }
  }

  // ---- internal -------------------------------------------------------------

  private handleControl(s: Sesi, aksi: 'ambil_alih' | 'kembalikan'): void {
    // Sesi debug tidak punya AI: kendali selalu di tangan penguji.
    if (!s.run || TERMINAL.has(s.status) || s.manualUrl || s.status === 'siaga') return;
    if (aksi === 'ambil_alih') {
      s.run.ambilAlih();
      this.setMode(s, 'takeover', 'Anda memegang kendali. AI berhenti sampai Anda mengembalikannya.');
      this.emit(s, { jenis: 'giliran_anda', alasan: 'diminta_warga', pesan: 'Anda memegang kendali.' });
    } else {
      s.run.kembalikan();
    }
  }

  private byUrusan(urusanId: string): Sesi | undefined {
    for (const s of this.sessions.values()) if (s.urusanId === urusanId) return s;
    return undefined;
  }

  private assertOwner(s: Sesi, sidHash: string): void {
    if (!sameHash(s.sidHash, sidHash))
      throw new PendampingError('SESI_BUKAN_MILIK', 403, 'sesi milik perangkat lain');
  }

  private requireOwned(owner: { urusanId: string; sidHash: string }): Sesi {
    const s = this.byUrusan(owner.urusanId);
    if (!s) throw new PendampingError('SESI_TIDAK_ADA', 404, 'tidak ada sesi pendamping');
    this.assertOwner(s, owner.sidHash);
    return s;
  }

  /**
   * Sesi milik pemilik ini yang AI-nya belum mulai (antre/menunggu data), atau yang langkah unggahnya menunggu
   * berkas (`berkas_kurang`); selain itu 409.
   */
  private requireMenungguData(owner: { urusanId: string; sidHash: string }): Sesi {
    const s = this.requireOwned(owner);
    if (s.berkasDitunggu !== undefined && !TERMINAL.has(s.status) && s.status !== 'siaga') return s;
    if (s.aiDimulai || s.manualUrl || TERMINAL.has(s.status) || s.status === 'siaga')
      throw new PendampingError('PESAN_TIDAK_SAH', 409, 'sesi tidak sedang menunggu data');
    return s;
  }

  private kurang(s: Sesi) {
    if (s.berkasDitunggu !== undefined)
      return { placeholder: [], berkas: [s.berkasDitunggu].filter((b) => !s.files.has(b)) };
    return {
      placeholder: s.butuh.placeholder.filter((p) => !s.vault.has(p)),
      berkas: s.butuh.berkas.filter((b) => !s.files.has(b)),
    };
  }

  private view(s: Sesi): SesiPendamping {
    const pos = this.queue.indexOf(s.id);
    return {
      sesiId: s.id,
      urusanId: s.urusanId,
      executionId: s.executionId,
      status: s.status,
      mode: s.mode,
      antrean: pos >= 0 ? { posisi: pos + 1, panjang: this.queue.length } : null,
      dibuatPada: new Date(s.dibuatPada).toISOString(),
      kedaluwarsaPada: new Date(s.kedaluwarsaPada).toISOString(),
      ...(s.pesan ? { pesan: s.pesan } : {}),
      ...(s.hasil ? { hasil: s.hasil } : {}),
      ...(s.bukti ? { bukti: s.bukti } : {}),
      situs: s.program.origin,
      replika: this.config.fixtureOrigins.includes(s.program.origin),
    };
  }

  private broadcastStatus(s: Sesi): void {
    s.viewer?.send({ type: 'status', sesi: this.view(s) });
  }

  private setMode(s: Sesi, mode: Exclude<PendampingMode, 'done'>, pesan?: string): void {
    if (TERMINAL.has(s.status)) return;
    if (s.mode === mode && s.pesan === pesan) return;
    s.mode = mode;
    s.pesan = pesan;
    if (mode === 'ai') s.galatInputTerkirim = false;
    s.viewer?.send({ type: 'mode', mode, ...(pesan ? { pesan } : {}) });
  }

  private emit(s: Sesi, e: PendampingEvent): void {
    s.viewer?.send({ type: 'event', event: e });
  }

  private async pump(): Promise<void> {
    while (this.active.size < this.config.maxSessions && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const s = this.sessions.get(id);
      if (!s) continue;
      this.active.add(id);
      void this.activate(s);
    }
    for (const id of this.queue) {
      const s = this.sessions.get(id);
      if (s) this.broadcastStatus(s);
    }
  }

  private async activate(s: Sesi): Promise<void> {
    s.status = 'memulai';
    s.lastActivity = this.now();
    this.broadcastStatus(s);
    const hooks: Hooks = {
      mode: (mode, pesan) => this.setMode(s, mode, pesan),
      fokus: (jenis) => s.viewer?.send({ type: 'fokus', jenis }),
      event: (e) => this.emit(s, e),
      activity: () => void (s.lastActivity = this.now()),
      ended: (status, hasil, pesan) => void this.end(s, status, hasil, pesan),
      langkahSelesai: (pesan, bukti) => this.siaga(s, pesan, bukti),
      berkasKurang: (nama) => void (s.berkasDitunggu = nama),
    };
    try {
      const run = await this.factory({
        sesiId: s.id,
        program: s.program,
        manualUrl: s.manualUrl,
        executionId: s.executionId,
        viewport: s.viewport,
        hooks,
        data: { value: (t) => s.vault.get(t), file: (n) => s.files.get(n) },
      });
      if (TERMINAL.has(s.status)) return void (await run.destroy()); // diakhiri saat memulai
      s.run = run;
      if (s.viewer) await run.setViewer((f) => s.viewer?.frame(f));
      s.status = 'menunggu_data';
      this.broadcastStatus(s);
      await this.maybeStartAi(s);
    } catch {
      await this.end(s, 'gagal', 'gagal', 'Peramban pendamping gagal dimulai. Coba lagi sebentar lagi.');
    }
  }

  private async maybeStartAi(s: Sesi): Promise<void> {
    if (!s.run || s.aiDimulai || s.status !== 'menunggu_data') return;
    const k = this.kurang(s);
    if (k.placeholder.length > 0 || k.berkas.length > 0) {
      s.viewer?.send({ type: 'butuh_data', ...k, origin: s.program.origin });
      return;
    }
    s.aiDimulai = true;
    s.status = 'berjalan';
    this.setMode(s, 'ai', 'AI sedang mengisi formulir.');
    this.broadcastStatus(s);
    await s.run.mulaiAi();
  }

  private siaga(s: Sesi, pesan: string, bukti?: PendampingBukti): void {
    if (TERMINAL.has(s.status)) return;
    s.status = 'siaga';
    s.hasil = 'berhasil';
    s.bukti = bukti;
    s.lastActivity = this.now();
    s.viewer?.send({
      type: 'event',
      event: { jenis: 'selesai', hasil: 'berhasil', pesan, ...(bukti ? { bukti } : {}) },
    });
    this.setMode(s, 'takeover', pesan);
    this.broadcastStatus(s);
  }

  async end(s: Sesi, status: PendampingStatus, hasil: PendampingHasil, pesan: string): Promise<void> {
    if (TERMINAL.has(s.status)) return;
    // Sesi siaga yang ditutup (warga, idle, TTL): execution terakhirnya tetap berhasil.
    if (s.status === 'siaga') {
      status = 'selesai';
      hasil = s.hasil ?? 'berhasil';
    }
    s.status = status;
    s.hasil = hasil;
    s.pesan = pesan;
    s.mode = 'done';
    const viewer = s.viewer;
    viewer?.send({ type: 'event', event: { jenis: 'selesai', hasil, pesan } });
    viewer?.send({ type: 'mode', mode: 'done', pesan });
    viewer?.send({ type: 'status', sesi: this.view(s) });
    viewer?.close(4000, 'selesai');
    s.viewer = undefined;
    // Hapus semua data warga dari memori sebelum peramban ditutup.
    s.vault.clear();
    s.files.clear();
    for (const [k, t] of this.tickets) if (t.sesiId === s.id) this.tickets.delete(k);
    const qi = this.queue.indexOf(s.id);
    if (qi >= 0) this.queue.splice(qi, 1);
    this.tombstones.set(`${s.urusanId}:${s.sidHash}`, { sesi: this.view(s), exp: this.now() + TOMBSTONE_MS });
    this.sessions.delete(s.id);
    const run = s.run;
    s.run = undefined;
    try {
      await run?.destroy();
    } finally {
      this.active.delete(s.id);
      await this.pump();
    }
  }

  /** TTL keras, idle (tanpa interaksi warga/kemajuan AI), tiket dan nisan kedaluwarsa. */
  async sweep(): Promise<void> {
    const t = this.now();
    for (const [k, v] of this.tickets) if (v.exp < t) this.tickets.delete(k);
    for (const [k, v] of this.tombstones) if (v.exp < t) this.tombstones.delete(k);
    for (const s of [...this.sessions.values()]) {
      const idle = this.active.has(s.id) && t - s.lastActivity > this.config.idleMs;
      if (t >= s.kedaluwarsaPada || idle) await this.end(s, 'kedaluwarsa', 'dibatalkan', PESAN.kedaluwarsa);
    }
  }
}

/**
 * Pemetaan origin resmi ke fixture (dev/uji/Mode Uji). `to` boleh berawalan jalur (mis.
 * `http://127.0.0.1:4320/smg`): semua langkah nav dan halaman login probe diberi awalan itu.
 */
function withOverride(program: Program, to: string): Program {
  const u = new URL(to);
  const awalan = u.pathname.replace(/\/+$/, '');
  if (!awalan) return { ...program, origin: u.origin };
  const ubah = (steps: Step[]): Step[] =>
    steps.map((st) => {
      if (st.op === 'nav') return { ...st, path: `${awalan}${st.path}` };
      if (st.op === 'forEach') return { ...st, steps: ubah(st.steps) };
      if (st.op === 'branch')
        return { ...st, then: ubah(st.then), ...(st.else ? { else: ubah(st.else) } : {}) };
      return st;
    });
  return {
    ...program,
    origin: u.origin,
    steps: ubah(program.steps),
    ...(program.masuk ? { masuk: { ...program.masuk, halaman: `${awalan}${program.masuk.halaman}` } } : {}),
  };
}
