import {
  byLabel,
  click,
  countIncreased,
  css,
  extract,
  fill,
  gate,
  nav,
  textIncludes,
  urlIncludes,
  verify,
  type Step,
} from '@urusin/core';
import { describe, expect, it } from 'vitest';
import { checkUrl } from './allowlist.js';
import { Interpreter, type Cursor, type Driver, type TabInfo } from './interpreter.js';
import type { RunnerOp, RunnerResult } from './runner-ops.js';
import { maskValue, type KV } from './types.js';

/** Kasus tepi interpreter yang dipakai pendamping (tab tertutup, interupsi, resume, kegagalan runner). */

const FX = 'http://localhost:4320';

function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async (k, v) => void data.set(k, structuredClone(v)),
    remove: async (k) => void data.delete(k),
  };
}

class Fake implements Driver {
  info: TabInfo | null = { url: 'about:blank', status: 'complete' };
  ops: RunnerOp[] = [];
  navs: string[] = [];
  handler: (op: RunnerOp) => RunnerResult | 'interrupted' = () => ({ ok: true, value: true });
  async openTab() {
    return 7;
  }
  async tab() {
    return this.info;
  }
  async navigate(_t: number, url: string) {
    this.navs.push(url);
  }
  async run(_t: number, op: RunnerOp) {
    this.ops.push(op);
    return this.handler(op);
  }
}

function setup() {
  const kv = memoryKV();
  const d = new Fake();
  const interp = new Interpreter(
    kv,
    d,
    async (u) => checkUrl(u, { testMode: true, fixtureOrigins: [FX] }),
    () => {},
    {
      preConsented: true,
    },
  );
  const cursor = async () => (await kv.get<Cursor>('cursor'))!;
  const load = async (url: string) => {
    d.info = { url, status: 'loading' };
    await interp.onTabUpdated(7, { status: 'loading' });
    d.info = { url, status: 'complete' };
    await interp.onTabUpdated(7, { status: 'complete' });
  };
  return { kv, d, interp, cursor, load };
}

const req = (steps: Step[], origin = FX) => ({ executionId: 'x1', origin, steps });

describe('interpreter: kasus tepi', () => {
  it('origin tidak valid / tidak diizinkan; cancel & recheck tanpa cursor tidak melempar', async () => {
    const { interp } = setup();
    await interp.cancel();
    await interp.recheckGate();
    await interp.resume();
    expect(await interp.start(req([nav('/a')], 'bukan url'))).toMatchObject({ code: 'ORIGIN_INVALID' });
    expect(await interp.start(req([nav('/a')], 'https://contoh.com'))).toMatchObject({
      code: 'DOMAIN_NOT_ALLOWED',
    });
  });

  it('event tab lain diabaikan; event about:blank basi diabaikan; tab tertutup = gagal', async () => {
    const { interp, d, cursor } = setup();
    await interp.start(req([nav('/a'), verify(textIncludes('x'))]));
    await interp.onTabUpdated(99, { status: 'complete' });
    await interp.onTabUpdated(7, { status: 'loading' });
    await interp.onTabUpdated(7, { status: 'loading' });
    d.info = { url: 'about:blank', status: 'complete' };
    await interp.onTabUpdated(7, { status: 'complete' });
    expect((await cursor()).status).toBe('waiting_load');
    d.info = null;
    await interp.onTabUpdated(7, { status: 'complete' });
    expect((await cursor()).error?.code).toBe('TAB_CLOSED');
  });

  it('resume: SW mati sebelum navigasi dimulai -> navigasi diulang; status running -> lanjut pump', async () => {
    const { interp, d, cursor, load } = setup();
    await interp.start(req([nav('/a'), verify(textIncludes('x'))]));
    expect(d.navs).toHaveLength(1);
    await interp.resume();
    expect(d.navs).toHaveLength(2);
    await load(`${FX}/a`);
    expect((await cursor()).status).toBe('done');
    await interp.resume(); // cursor selesai: tidak berbuat apa pun
  });

  it('halaman berpindah ke domain lain sebelum op: gagal DOMAIN_NOT_ALLOWED', async () => {
    const { interp, d, cursor } = setup();
    await interp.start(req([nav('/a'), verify(textIncludes('x'))]));
    d.info = { url: `${FX}/a`, status: 'loading' };
    await interp.onTabUpdated(7, { status: 'loading' });
    d.info = { url: 'https://evil.example/', status: 'complete' };
    await interp.onTabUpdated(7, { status: 'complete' });
    expect((await cursor()).error?.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('runner gagal / verify salah / extract menyimpan hasil', async () => {
    const a = setup();
    a.d.handler = (op) => (op.kind === 'check' ? { ok: true, value: false } : { ok: true, value: 1 });
    await a.interp.start(req([nav('/a'), verify(textIncludes('x'))]));
    await a.load(`${FX}/a`);
    expect((await a.cursor()).error?.code).toBe('VERIFY_FAILED');

    const b = setup();
    b.d.handler = (op) =>
      op.kind === 'check' ? { ok: false, code: 'RUNNER_ERROR', message: 'x' } : { ok: true, value: 1 };
    await b.interp.start(req([nav('/a'), verify(textIncludes('x'))]));
    await b.load(`${FX}/a`);
    expect((await b.cursor()).error?.code).toBe('RUNNER_ERROR');

    const c = setup();
    c.d.handler = () => ({ ok: true, value: { headers: [], rows: [] } });
    await c.interp.start(req([nav('/a'), extract('table', css('table'), 'daftar')]));
    await c.load(`${FX}/a`);
    expect((await c.cursor()).results).toHaveProperty('daftar');
  });

  it('interupsi di verify, gate, dan klik read biasa', async () => {
    for (const steps of [
      [nav('/a'), verify(textIncludes('x'))],
      [nav('/a'), gate.human('g', { until: urlIncludes('/b') })],
      [nav('/a'), click(css('#b'), { effect: 'read' })],
    ]) {
      const s = setup();
      let first = true;
      s.d.handler = () => {
        if (first) {
          first = false;
          return 'interrupted';
        }
        return { ok: true, value: true };
      };
      await s.interp.start(req(steps));
      await s.load(`${FX}/a`);
      expect((await s.cursor()).status).toBe('waiting_load');
    }
  });

  it('klik read gagal dengan expectReload: cursor maju lalu gagal', async () => {
    const s = setup();
    s.d.handler = (op) =>
      op.kind === 'step' ? { ok: false, code: 'ADAPTER_DRIFT', message: 'x' } : { ok: true, value: true };
    await s.interp.start(req([nav('/a'), click(css('#b'), { effect: 'read', expectReload: true })]));
    await s.load(`${FX}/a`);
    const c = await s.cursor();
    expect(c.error?.code).toBe('ADAPTER_DRIFT');
    expect(c.stepIndex).toBe(2);
  });

  it('write: baseline tak terbaca, klik gagal, interupsi saat baseline/klik/verify', async () => {
    const write = click(css('#u'), { effect: 'write', verify: countIncreased(css('.i')) });
    const a = setup();
    a.d.handler = (op) => (op.kind === 'count' ? { ok: true, value: 'x' } : { ok: true, value: true });
    await a.interp.start(req([nav('/a'), write]));
    await a.load(`${FX}/a`);
    expect((await a.cursor()).error?.code).toBe('VERIFY_UNREADABLE');

    const b = setup();
    b.d.handler = (op) =>
      op.kind === 'step' ? { ok: false, code: 'ADAPTER_DRIFT', message: 'x' } : { ok: true, value: 0 };
    await b.interp.start(req([nav('/a'), write]));
    await b.load(`${FX}/a`);
    expect((await b.cursor()).pendingWrite).toBeUndefined();

    for (const kind of ['count', 'step', 'wait'] as const) {
      const s = setup();
      s.d.handler = (op) => (op.kind === kind ? 'interrupted' : { ok: true, value: 0 });
      await s.interp.start(req([nav('/a'), write]));
      await s.load(`${FX}/a`);
      expect((await s.cursor()).status).toBe('waiting_load');
    }
  });

  it('write tanpa expectReload: verify tidak terbaca -> handoff VERIFY_UNREADABLE', async () => {
    const s = setup();
    s.d.handler = (op) =>
      op.kind === 'wait' ? { ok: false, code: 'RUNNER_ERROR', message: 'x' } : { ok: true, value: 0 };
    await s.interp.start(req([nav('/a'), click(css('#u'), { effect: 'write', verify: textIncludes('ok') })]));
    await s.load(`${FX}/a`);
    const c = await s.cursor();
    expect(c.status).toBe('handoff');
    expect(c.error?.code).toBe('VERIFY_UNREADABLE');
  });

  it('checkGate: warga di domain lain tetap menunggu; recheck saat gate terpenuhi melanjutkan', async () => {
    const s = setup();
    let done = false;
    s.d.handler = (op) => ({ ok: true, value: op.kind === 'check' ? done : true });
    await s.interp.start(req([nav('/a'), gate.human('g', { until: urlIncludes('/b') })]));
    await s.load(`${FX}/a`);
    expect((await s.cursor()).status).toBe('waiting_gate');
    s.d.info = { url: 'https://lain.example/', status: 'complete' };
    done = true;
    await s.interp.recheckGate();
    expect((await s.cursor()).status).toBe('waiting_gate');
    s.d.info = { url: `${FX}/b`, status: 'complete' };
    await s.interp.recheckGate();
    expect((await s.cursor()).status).toBe('done');
  });

  it('consent ditampilkan bila belum disetujui (label fallback) dan maskValue', async () => {
    const kv = memoryKV();
    const d = new Fake();
    const interp = new Interpreter(kv, d, async () => ({ ok: true }));
    await interp.start(req([nav('/a'), fill(byLabel('Nama'), 'Budi')]));
    d.info = { url: `${FX}/a`, status: 'loading' };
    await interp.onTabUpdated(7, { status: 'loading' });
    d.info = { url: `${FX}/a`, status: 'complete' };
    await interp.onTabUpdated(7, { status: 'complete' });
    const consent = d.ops.find((o) => o.kind === 'consent');
    expect(consent).toMatchObject({ summary: { fills: [{ label: 'Nama', masked: 'B•••' }] } });
    expect(maskValue('')).toBe('•');
  });
});
