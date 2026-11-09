import { getOfficialDomain, parsePlaceholder, validateSteps, type Step, type Target } from '@urusin/core';
import { resolveNavPath, type AllowResult } from './allowlist.js';
import type { RunnerOp, RunnerResult } from './runner-ops.js';
import {
  err,
  maskValue,
  type ConsentSummary,
  type ErrorReply,
  type ExecutionRequest,
  type KV,
  type UploadFile,
} from './types.js';

/**
 * Interpreter step DSL bersama: service worker ekstensi (Mode Privasi) dan Browser Pendamping di server
 * (rencana §3.5). Seluruh state ada di `KV` (chrome.storage.session / Map):
 * cursor ditulis SEBELUM setiap op, sehingga eksekusi bisa dilanjutkan setelah halaman reload
 * atau service worker dimatikan. Satu op dijalankan di halaman lewat step-runner yang di-inject ulang.
 */

/** `waiting_citizen`: nilai kolom tidak disediakan (bukan daftar write); warga mengetiknya sendiri lalu lanjut. */
export type Status =
  'running' | 'waiting_load' | 'waiting_gate' | 'waiting_citizen' | 'handoff' | 'done' | 'error';

export type Awaiting =
  { kind: 'nav'; url: string; sawLoading: boolean } | { kind: 'reload'; sawLoading: boolean };

export type Cursor = {
  executionId: string;
  origin: string;
  steps: Step[];
  tabId: number;
  stepIndex: number;
  status: Status;
  awaiting?: Awaiting | undefined;
  /** Dicatat sebelum op `write`; `baseline` = nilai verify yang dibaca sebelum klik. */
  pendingWrite?: { stepIndex: number; baseline: number | undefined } | undefined;
  completedWrites: number[];
  consented: boolean;
  results: Record<string, unknown>;
  seq: number;
  message?: string | undefined;
  error?: { code: string; message: string } | undefined;
};

export type TabInfo = { url: string; status: 'loading' | 'complete' | 'unknown' };

export interface Driver {
  openTab(): Promise<number>;
  tab(tabId: number): Promise<TabInfo | null>;
  navigate(tabId: number, url: string): Promise<void>;
  /** 'interrupted' = halaman berpindah/reload saat op berjalan. */
  run(tabId: number, op: RunnerOp): Promise<RunnerResult | 'interrupted'>;
}

export type Policy = (url: string) => Promise<AllowResult>;

/**
 * Kait opsional di batas eksekutor. Placeholder (`{{PEMOHON.HP}}`, `{{FILE:ktp}}`) di-resolve TEPAT sebelum
 * op dikirim ke halaman, sehingga cursor, event `onChange`, dan apa pun yang dilihat LLM tetap bertoken.
 */
export type InterpreterOptions = {
  /** Ganti semua placeholder vault dalam nilai; undefined = ada yang tidak dikenal. */
  resolveValue?: ((value: string) => Promise<string | undefined>) | undefined;
  /** Berkas untuk `{{FILE:<nama>}}`. Tanpa kait ini op `upload` tidak didukung. */
  resolveFile?: ((name: string) => Promise<UploadFile | undefined>) | undefined;
  /** Persetujuan sudah diberikan di luar halaman (layar konfirmasi web): lewati overlay consent. */
  preConsented?: boolean | undefined;
  /**
   * Nilai fill/select yang tidak ter-resolve: pesan untuk warga agar mengetiknya sendiri di kolom itu
   * (status `waiting_citizen`, lanjut lewat `citizenDone`). Tanpa kait ini, atau bila mengembalikan undefined,
   * langkah gagal aman PLACEHOLDER_UNRESOLVED.
   */
  citizenInput?: ((value: string) => string | undefined) | undefined;
  /**
   * Berkas `{{FILE:<nama>}}` belum tersedia: pesan untuk warga (status `waiting_citizen`). Setelah
   * `citizenDone` langkah unggah DIULANG (bukan dilewati); masih kosong = menunggu warga lagi. Tanpa kait ini,
   * gagal aman PLACEHOLDER_UNRESOLVED.
   */
  citizenFile?: ((name: string) => string | undefined) | undefined;
};

/** Semua target `highlight` milik gate.human: elemen khusus warga (mis. tombol Kirim/Selesai). */
export function humanOnlyTargets(steps: readonly Step[]): Target[] {
  return steps.flatMap((s): Target[] => {
    if (s.op === 'gate.human') return s.highlight ? [s.highlight] : [];
    if (s.op === 'forEach') return humanOnlyTargets(s.steps);
    if (s.op === 'branch') return [...humanOnlyTargets(s.then), ...humanOnlyTargets(s.else ?? [])];
    return [];
  });
}

const CURSOR_KEY = 'cursor';
const ACTIVE: Status[] = ['running', 'waiting_load', 'waiting_gate', 'waiting_citizen'];
const UNSUPPORTED = new Set<Step['op']>(['forEach', 'branch']);
const DEFAULT_WAIT_MS = 10_000;
const WRITE_VERIFY_MS = 3_000;

type Outcome = 'next' | 'stop';

export class Interpreter {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly kv: KV,
    private readonly driver: Driver,
    private readonly allow: Policy,
    private readonly onChange: (cursor: Cursor) => void = () => {},
    private readonly opts: InterpreterOptions = {},
  ) {}

  private unsupported(op: Step['op']): boolean {
    return UNSUPPORTED.has(op) || (op === 'upload' && !this.opts.resolveFile);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  getCursor(): Promise<Cursor | undefined> {
    return this.kv.get<Cursor>(CURSOR_KEY);
  }

  start(request: ExecutionRequest): Promise<Cursor | ErrorReply> {
    return this.enqueue(async () => {
      const existing = await this.getCursor();
      if (existing && ACTIVE.includes(existing.status)) return err('BUSY', 'masih ada eksekusi aktif');

      const valid = validateSteps(request.steps);
      if (!valid.ok)
        return err(
          valid.issues[0]?.code ?? 'STEP_SCHEMA_INVALID',
          valid.issues[0]?.message ?? 'langkah tidak valid',
        );
      const unsupported = valid.steps.find((s) => this.unsupported(s.op));
      if (unsupported) return err('UNSUPPORTED_OP', `op "${unsupported.op}" belum didukung`);

      let originUrl: string;
      try {
        originUrl = new URL(request.origin).href;
      } catch {
        return err('ORIGIN_INVALID', 'origin eksekusi tidak valid');
      }
      const allowed = await this.allow(originUrl);
      if (!allowed.ok) return err(allowed.code, allowed.message);

      const tabId = await this.driver.openTab();
      const cursor: Cursor = {
        executionId: request.executionId,
        origin: new URL(request.origin).origin,
        steps: valid.steps,
        tabId,
        stepIndex: 0,
        status: 'running',
        completedWrites: [],
        consented: this.opts.preConsented === true,
        results: {},
        seq: 0,
      };
      await this.save(cursor);
      await this.pump();
      return (await this.getCursor()) ?? cursor;
    });
  }

  /** Dipanggil dari `chrome.tabs.onUpdated` (didaftarkan top-level agar SW terbangun). */
  onTabUpdated(tabId: number, changeInfo: { status?: string | undefined }): Promise<void> {
    return this.enqueue(async () => {
      const c = await this.getCursor();
      if (!c || c.tabId !== tabId) return;

      if (c.status === 'waiting_load' && c.awaiting) {
        if (changeInfo.status === 'loading') {
          if (!c.awaiting.sawLoading)
            await this.save({ ...c, awaiting: { ...c.awaiting, sawLoading: true } });
          return;
        }
        if (changeInfo.status !== 'complete' || !c.awaiting.sawLoading) return;
        const tab = await this.driver.tab(tabId);
        // Event basi dari tab kosong yang baru dibuka (sebelum navigasi kita commit): abaikan.
        if (tab && (tab.url === '' || tab.url === 'about:blank')) return;
        const allowed = tab
          ? await this.allow(tab.url)
          : { ok: false as const, code: 'TAB_CLOSED', message: 'tab ditutup' };
        if (!allowed.ok) return void (await this.fail(c, allowed.code, allowed.message));
        const advance = c.awaiting.kind === 'nav' ? 1 : 0;
        await this.save({ ...c, status: 'running', awaiting: undefined, stepIndex: c.stepIndex + advance });
        await this.pump();
        return;
      }

      if (c.status === 'waiting_gate' && changeInfo.status === 'complete') await this.checkGate(c);
    });
  }

  /** Dipanggil saat SW bangun: bila mati di tengah op, lanjutkan dari cursor. */
  resume(): Promise<void> {
    return this.enqueue(async () => {
      const c = await this.getCursor();
      if (!c) return;
      if (c.status === 'running') return this.pump();
      if (c.status === 'waiting_load' && c.awaiting?.kind === 'nav' && !c.awaiting.sawLoading) {
        // SW mati sebelum navigasi sempat dimulai: ulangi (navigasi idempoten).
        const nav = c.awaiting;
        const tab = await this.driver.tab(c.tabId);
        if (tab && tab.status === 'complete' && tab.url !== nav.url)
          await this.driver.navigate(c.tabId, nav.url);
      }
    });
  }

  /** Cek ulang kondisi gate (misalnya dari popup, untuk SPA tanpa reload). */
  recheckGate(): Promise<void> {
    return this.enqueue(async () => {
      const c = await this.getCursor();
      if (c?.status === 'waiting_gate') await this.checkGate(c);
    });
  }

  /**
   * Warga menekan Lanjutkan pada `waiting_citizen`: kolom isian yang ia ketik sendiri dilewati; langkah unggah
   * diulang (berkas mungkin sudah ditambahkan).
   */
  citizenDone(): Promise<void> {
    return this.enqueue(async () => {
      const c = await this.getCursor();
      if (c?.status !== 'waiting_citizen') return;
      const lewati = c.steps[c.stepIndex]?.op === 'upload' ? 0 : 1;
      await this.save({ ...c, status: 'running', message: undefined, stepIndex: c.stepIndex + lewati });
      await this.pump();
    });
  }

  cancel(): Promise<void> {
    return this.enqueue(async () => {
      const c = await this.getCursor();
      if (c && ACTIVE.includes(c.status)) await this.fail(c, 'CANCELLED', 'dibatalkan');
    });
  }

  // ---- internal ----------------------------------------------------------

  private async save(next: Cursor): Promise<Cursor> {
    const saved = { ...next, seq: next.seq + 1 };
    await this.kv.set(CURSOR_KEY, saved);
    this.onChange(saved);
    return saved;
  }

  private async fail(c: Cursor, code: string, message: string): Promise<Outcome> {
    await this.save({ ...c, status: 'error', awaiting: undefined, error: { code, message } });
    return 'stop';
  }

  private async handoff(
    c: Cursor,
    message: string,
    error?: { code: string; message: string },
  ): Promise<Outcome> {
    await this.save({ ...c, status: 'handoff', awaiting: undefined, message, error });
    return 'stop';
  }

  private async advance(c: Cursor, patch: Partial<Cursor> = {}): Promise<Outcome> {
    await this.save({ ...c, ...patch, stepIndex: c.stepIndex + 1 });
    return 'next';
  }

  /** Halaman berpindah saat op berjalan: tunggu load berikutnya lalu ulangi langkah yang sama. */
  private async interrupted(c: Cursor): Promise<Outcome> {
    await this.save({ ...c, status: 'waiting_load', awaiting: { kind: 'reload', sawLoading: true } });
    return 'stop';
  }

  private async pump(): Promise<void> {
    for (;;) {
      const c = await this.getCursor();
      if (!c || c.status !== 'running') return;
      const step = c.steps[c.stepIndex];
      if (!step) {
        await this.save({ ...c, status: 'done' });
        return;
      }
      if ((await this.execute(c, step)) === 'stop') return;
    }
  }

  private async currentUrlAllowed(c: Cursor): Promise<AllowResult> {
    const tab = await this.driver.tab(c.tabId);
    if (!tab) return { ok: false, code: 'TAB_CLOSED', message: 'tab ditutup' };
    return this.allow(tab.url);
  }

  private consentSummary(c: Cursor): ConsentSummary {
    const host = new URL(c.origin).hostname;
    const fills = c.steps.flatMap((s) =>
      s.op === 'fill' ? [{ label: s.target[0]?.value ?? 'field', masked: maskValue(s.value) }] : [],
    );
    const writes = c.steps.filter((s) => 'effect' in s && s.effect === 'write').length;
    return { origin: c.origin, instansi: getOfficialDomain(host)?.instansi, fills, writes };
  }

  private async execute(c: Cursor, step: Step): Promise<Outcome> {
    if (step.op === 'forEach' || step.op === 'branch' || this.unsupported(step.op)) {
      return this.fail(c, 'UNSUPPORTED_OP', `op "${step.op}" belum didukung`);
    }

    // Selalu verify lebih dulu bila ada pendingWrite: tidak pernah mengklik ulang otomatis.
    if (c.pendingWrite && c.pendingWrite.stepIndex === c.stepIndex && step.op === 'click') {
      return this.resolvePendingWrite(c, step);
    }

    if (step.op === 'nav') {
      const url = resolveNavPath(c.origin, step.path);
      if (!url) return this.fail(c, 'INVALID_NAV_PATH', 'path nav harus path absolut satu origin');
      const allowed = await this.allow(url);
      if (!allowed.ok) return this.fail(c, allowed.code, allowed.message);
      await this.save({ ...c, status: 'waiting_load', awaiting: { kind: 'nav', url, sawLoading: false } });
      await this.driver.navigate(c.tabId, url);
      return 'stop';
    }

    // `final` TIDAK PERNAH dijalankan otomatis: berhenti dan serahkan ke warga.
    if (step.op === 'click' && step.effect === 'final') {
      return this.handoff(
        c,
        'Tekan tombol pengiriman akhir sendiri di halaman. Urusin tidak mengklik langkah final.',
      );
    }

    // Semua op berikut berjalan di halaman: domain tab wajib lolos allowlist SETIAP kali.
    const allowed = await this.currentUrlAllowed(c);
    if (!allowed.ok) return this.fail(c, allowed.code, allowed.message);

    // Gate kedua: persetujuan warga di overlay sebelum input/write pertama.
    const mutating =
      step.op === 'fill' || ('effect' in step && (step.effect === 'input' || step.effect === 'write'));
    if (mutating && !c.consented) {
      const r = await this.driver.run(c.tabId, { kind: 'consent', summary: this.consentSummary(c) });
      if (r === 'interrupted') return this.interrupted(c);
      if (!r.ok) return this.fail(c, r.code, r.message);
      if (r.value !== true) return this.fail(c, 'CONSENT_DENIED', 'warga tidak mengizinkan');
      await this.save({ ...c, consented: true });
      return 'next';
    }

    switch (step.op) {
      case 'waitFor':
        return this.runAndAdvance(c, {
          kind: 'wait',
          check: step.check,
          timeoutMs: step.timeoutMs ?? DEFAULT_WAIT_MS,
        });
      case 'verify': {
        const r = await this.driver.run(c.tabId, { kind: 'check', check: step.check });
        if (r === 'interrupted') return this.interrupted(c);
        if (!r.ok) return this.fail(c, r.code, r.message);
        return r.value === true ? this.advance(c) : this.fail(c, 'VERIFY_FAILED', 'verify tidak terpenuhi');
      }
      case 'fill':
      case 'select': {
        const value = await this.resolveValue(step.value);
        if (value === undefined) {
          const pesan = this.opts.citizenInput?.(step.value);
          if (pesan === undefined) return this.fail(c, 'PLACEHOLDER_UNRESOLVED', 'data isian belum tersedia');
          await this.save({ ...c, status: 'waiting_citizen', message: pesan });
          return 'stop';
        }
        return this.runAndAdvance(c, { kind: 'step', step: { ...step, value } });
      }
      case 'upload': {
        const ph = parsePlaceholder(step.file);
        const file = ph?.kind === 'file' ? await this.opts.resolveFile?.(ph.name) : undefined;
        if (!file) {
          const pesan = ph?.kind === 'file' ? this.opts.citizenFile?.(ph.name) : undefined;
          if (pesan === undefined) return this.fail(c, 'PLACEHOLDER_UNRESOLVED', 'berkas belum tersedia');
          await this.save({ ...c, status: 'waiting_citizen', message: pesan });
          return 'stop';
        }
        return this.runAndAdvance(c, { kind: 'upload', target: step.target, file });
      }
      case 'extract':
        return this.runAndAdvance(c, { kind: 'step', step }, step.into);
      case 'click':
        return step.effect === 'write' ? this.clickWrite(c, step) : this.clickRead(c, step);
      case 'gate.human': {
        const r = await this.driver.run(c.tabId, { kind: 'check', check: step.until });
        if (r === 'interrupted') return this.interrupted(c);
        if (r.ok && r.value === true) return this.advance(c);
        await this.save({ ...c, status: 'waiting_gate', message: step.message });
        return 'stop';
      }
      default:
        return this.fail(c, 'UNSUPPORTED_OP', 'op belum didukung');
    }
  }

  private async resolveValue(value: string): Promise<string | undefined> {
    if (!this.opts.resolveValue || !value.includes('{{')) return value;
    return this.opts.resolveValue(value);
  }

  /** Op klik selalu membawa daftar elemen khusus warga; runner menolak bila target mengenai salah satunya. */
  private clickOp(c: Cursor, step: Extract<Step, { op: 'click' }>): RunnerOp {
    return { kind: 'step', step, finalTargets: humanOnlyTargets(c.steps) };
  }

  private async runAndAdvance(c: Cursor, op: RunnerOp, into?: string): Promise<Outcome> {
    const r = await this.driver.run(c.tabId, op);
    if (r === 'interrupted') return this.interrupted(c);
    if (!r.ok) return this.fail(c, r.code, r.message);
    return this.advance(c, into ? { results: { ...c.results, [into]: r.value } } : {});
  }

  private async clickRead(c: Cursor, step: Extract<Step, { op: 'click' }>): Promise<Outcome> {
    if (step.expectReload) {
      // Cursor maju + menunggu reload SEBELUM klik; lanjut setelah load berikutnya.
      await this.save({
        ...c,
        stepIndex: c.stepIndex + 1,
        status: 'waiting_load',
        awaiting: { kind: 'reload', sawLoading: false },
      });
    }
    const r = await this.driver.run(c.tabId, this.clickOp(c, step));
    if (r !== 'interrupted' && !r.ok) {
      const base = step.expectReload ? { ...c, stepIndex: c.stepIndex + 1 } : c;
      return this.fail(base, r.code, r.message);
    }
    if (step.expectReload) return 'stop';
    return r === 'interrupted' ? this.interrupted(c) : this.advance(c);
  }

  private async clickWrite(c: Cursor, step: Extract<Step, { op: 'click' }>): Promise<Outcome> {
    if (!step.verify) return this.fail(c, 'WRITE_WITHOUT_VERIFY', 'write wajib punya verify');
    if (c.completedWrites.includes(c.stepIndex)) return this.advance(c); // sudah terverifikasi sebelumnya

    let baseline: number | undefined;
    if (step.verify.kind === 'countIncreased') {
      const n = await this.driver.run(c.tabId, { kind: 'count', target: step.verify.target });
      if (n === 'interrupted') return this.interrupted(c);
      if (!n.ok || typeof n.value !== 'number')
        return this.fail(c, n.ok ? 'VERIFY_UNREADABLE' : n.code, 'baseline verify tidak terbaca');
      baseline = n.value;
    }
    // Catat SEBELUM klik: bila SW/halaman mati sesudahnya, resume memverifikasi dulu, tidak mengklik ulang.
    const armed: Cursor = { ...c, pendingWrite: { stepIndex: c.stepIndex, baseline } };
    await this.save(
      step.expectReload
        ? { ...armed, status: 'waiting_load', awaiting: { kind: 'reload', sawLoading: false } }
        : armed,
    );
    const r = await this.driver.run(c.tabId, this.clickOp(c, step));
    if (r !== 'interrupted' && !r.ok) {
      // Klik gagal (elemen tidak ada): write tidak terjadi, batalkan penanda.
      return this.fail({ ...c, pendingWrite: undefined }, r.code, r.message);
    }
    if (step.expectReload) return 'stop';
    return r === 'interrupted' ? this.interrupted(armed) : 'next'; // iterasi berikut: resolvePendingWrite
  }

  private async resolvePendingWrite(c: Cursor, step: Extract<Step, { op: 'click' }>): Promise<Outcome> {
    const pending = c.pendingWrite;
    if (!pending || !step.verify) return this.fail(c, 'WRITE_WITHOUT_VERIFY', 'write wajib punya verify');
    const allowed = await this.currentUrlAllowed(c);
    if (!allowed.ok) return this.fail(c, allowed.code, allowed.message);

    const r = await this.driver.run(c.tabId, {
      kind: 'wait',
      check: step.verify,
      timeoutMs: WRITE_VERIFY_MS,
      baseline: pending.baseline,
    });
    if (r === 'interrupted') return this.interrupted(c);
    if (r.ok) {
      return this.advance(c, {
        pendingWrite: undefined,
        completedWrites: [...c.completedWrites, c.stepIndex],
      });
    }
    if (r.code === 'WAIT_TIMEOUT') {
      return this.handoff(
        c,
        'Langkah kirim tampaknya belum masuk. Periksa halaman lalu ulangi sendiri bila perlu; Urusin tidak mengklik ulang otomatis.',
        { code: 'WRITE_UNVERIFIED', message: 'verify tidak terpenuhi setelah klik' },
      );
    }
    return this.handoff(
      c,
      'Hasil langkah kirim tidak bisa dibaca (halaman berubah). Lanjutkan secara manual.',
      {
        code: 'VERIFY_UNREADABLE',
        message: r.message,
      },
    );
  }

  private async checkGate(c: Cursor): Promise<void> {
    const step = c.steps[c.stepIndex];
    if (step?.op !== 'gate.human') return;
    const allowed = await this.currentUrlAllowed(c);
    if (!allowed.ok) return; // warga sedang di situs lain: tetap menunggu, tidak meng-inject
    const r = await this.driver.run(c.tabId, { kind: 'check', check: step.until });
    if (r !== 'interrupted' && r.ok && r.value === true) {
      await this.save({ ...c, status: 'running', message: undefined, stepIndex: c.stepIndex + 1 });
      await this.pump();
    }
  }
}
