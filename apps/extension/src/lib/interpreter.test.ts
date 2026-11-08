import type { Step } from '@urusin/core';
import {
  byLabel,
  byName,
  click,
  css,
  extract,
  fill,
  gate,
  nav,
  textIncludes,
  urlIncludes,
  verify,
  waitFor,
  countIncreased,
} from '@urusin/core';
import { describe, expect, it } from 'vitest';
import { checkUrl } from './allowlist';
import { Interpreter, type Cursor, type Driver, type TabInfo } from './interpreter';
import type { KV } from './pairing';
import type { RunnerOp, RunnerResult } from './runner-ops';

const FX = 'http://localhost:4320';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async (k, v) => void data.set(k, structuredClone(v)),
    remove: async (k) => void data.delete(k),
  };
}

type Handler = (op: RunnerOp, d: FakeDriver) => RunnerResult | 'interrupted';

class FakeDriver implements Driver {
  tabInfo: TabInfo | null = { url: 'about:blank', status: 'complete' };
  navigations: string[] = [];
  ops: RunnerOp[] = [];
  handler: Handler = () => ({ ok: true, value: true });
  async openTab() {
    return 1;
  }
  async tab() {
    return this.tabInfo;
  }
  async navigate(_tabId: number, url: string) {
    this.navigations.push(url);
  }
  async run(_tabId: number, op: RunnerOp) {
    this.ops.push(op);
    return this.handler(op, this);
  }
  clicks() {
    return this.ops.filter((o) => o.kind === 'step' && o.step.op === 'click').length;
  }
}

const policy =
  (testMode = true) =>
  async (url: string) =>
    checkUrl(url, { testMode, fixtureOrigins: [FX] });

function setup(testMode = true) {
  const kv = memoryKV();
  const driver = new FakeDriver();
  const make = () => new Interpreter(kv, driver, policy(testMode));
  return { kv, driver, interp: make(), make };
}

/** Simulasikan satu navigasi penuh di tab (loading lalu complete). */
async function loadPage(interp: Interpreter, driver: FakeDriver, url: string) {
  driver.tabInfo = { url, status: 'loading' };
  await interp.onTabUpdated(1, { status: 'loading' });
  driver.tabInfo = { url, status: 'complete' };
  await interp.onTabUpdated(1, { status: 'complete' });
}

const cursorOf = async (kv: KV) => (await kv.get<Cursor>('cursor'))!;
const req = (steps: unknown[], origin = FX) => ({
  executionId: 'ex1',
  origin,
  steps: steps as Step[],
});

describe('interpreter: alur baca status', () => {
  it('nav -> waitFor -> extract sampai selesai, hasil tersimpan', async () => {
    const { interp, driver, kv } = setup();
    driver.handler = (op) =>
      op.kind === 'step' && op.step.op === 'extract'
        ? { ok: true, value: { headers: ['No'], rows: [['1']] } }
        : { ok: true, value: true };
    const started = await interp.start(
      req([
        nav('/telunjuksakti/index.php/welcome/permohonan'),
        waitFor(textIncludes('Daftar Permohonan')),
        extract('table', css('#tblPermohonan'), 'permohonan'),
      ]),
    );
    expect('status' in started && started.status).toBe('waiting_load');
    expect(driver.navigations).toEqual([`${FX}/telunjuksakti/index.php/welcome/permohonan`]);

    await loadPage(interp, driver, driver.navigations[0]!);
    const c = await cursorOf(kv);
    expect(c.status).toBe('done');
    expect(c.results.permohonan).toEqual({ headers: ['No'], rows: [['1']] });
  });

  it('event complete basi (tanpa loading) diabaikan', async () => {
    const { interp, kv } = setup();
    await interp.start(req([nav('/a'), waitFor(textIncludes('x'))]));
    await interp.onTabUpdated(1, { status: 'complete' });
    expect((await cursorOf(kv)).status).toBe('waiting_load');
  });
});

describe('interpreter: allowlist domain', () => {
  it('menolak origin request non-resmi, juga di Mode Uji', async () => {
    const { interp } = setup(true);
    const r = await interp.start(req([nav('/')], 'https://telunjuksakti.wonogirikab.go.id.evil.example'));
    expect(r).toMatchObject({ ok: false, code: 'DOMAIN_NOT_ALLOWED' });
  });

  it('origin fixture ditolak di luar Mode Uji', async () => {
    const { interp } = setup(false);
    expect(await interp.start(req([nav('/')]))).toMatchObject({ ok: false, code: 'DOMAIN_NOT_ALLOWED' });
  });

  it('path nav yang keluar origin ditolak', async () => {
    const { interp, kv, driver } = setup();
    await interp.start(req([nav('//evil.example/x')]));
    expect((await cursorOf(kv)).error?.code).toBe('INVALID_NAV_PATH');
    expect(driver.navigations).toEqual([]);
  });

  it('tab berpindah ke domain tak sah di tengah alur: op tidak dijalankan', async () => {
    const { interp, driver, kv } = setup();
    await interp.start(req([nav('/a'), waitFor(textIncludes('x'))]));
    await loadPage(interp, driver, 'https://evil.example/');
    const c = await cursorOf(kv);
    expect(c.status).toBe('error');
    expect(c.error?.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(driver.ops).toEqual([]);
  });
});

describe('interpreter: final tidak pernah diklik', () => {
  it('validator menolak click final; kalaupun cursor memuatnya, interpreter berhenti tanpa mengklik', async () => {
    const { interp, driver, kv } = setup();
    expect(await interp.start(req([nav('/a'), click(byName('btn'), { effect: 'final' })]))).toMatchObject({
      ok: false,
      code: 'FINAL_OUTSIDE_GATE',
    });
    // Pertahanan berlapis: cursor yang dirusak/dipalsukan tetap tidak menghasilkan klik final.
    await kv.set('cursor', {
      executionId: 'x',
      origin: FX,
      tabId: 1,
      stepIndex: 0,
      status: 'running',
      completedWrites: [],
      consented: true,
      results: {},
      seq: 1,
      steps: [click(byName('btn'), { effect: 'final' })],
    });
    driver.tabInfo = { url: FX + '/a', status: 'complete' };
    await interp.resume();
    await interp.resume();
    expect((await cursorOf(kv)).status).toBe('handoff');
    expect(driver.ops).toEqual([]);
  });
});

describe('interpreter: gate.human', () => {
  it('menunggu sampai kondisi until terpenuhi lalu lanjut', async () => {
    const { interp, driver, kv } = setup();
    let loggedIn = false;
    driver.handler = (op) => ({ ok: true, value: op.kind === 'check' ? loggedIn : true });
    await interp.start(
      req([
        nav('/login'),
        gate.human('Login sendiri', { until: urlIncludes('/welcome') }),
        verify(textIncludes('ok')),
      ]),
    );
    await loadPage(interp, driver, `${FX}/login`);
    expect((await cursorOf(kv)).status).toBe('waiting_gate');
    expect((await cursorOf(kv)).message).toBe('Login sendiri');

    loggedIn = true;
    await loadPage(interp, driver, `${FX}/welcome`);
    expect((await cursorOf(kv)).status).toBe('done');
  });
});

describe('interpreter: gate kedua (persetujuan)', () => {
  it('fill meminta persetujuan sekali; ditolak = batal; disetujui = lanjut', async () => {
    const denied = setup();
    denied.driver.handler = (op) => ({ ok: true, value: op.kind === 'consent' ? false : true });
    await denied.interp.start(req([nav('/a'), fill(byLabel('HP'), '0800')]));
    await loadPage(denied.interp, denied.driver, `${FX}/a`);
    expect((await cursorOf(denied.kv)).error?.code).toBe('CONSENT_DENIED');
    expect(denied.driver.ops.some((o) => o.kind === 'step')).toBe(false);

    const ok = setup();
    await ok.interp.start(req([nav('/a'), fill(byLabel('HP'), '0800'), fill(byLabel('Nama'), 'Uji')]));
    await loadPage(ok.interp, ok.driver, `${FX}/a`);
    expect((await cursorOf(ok.kv)).status).toBe('done');
    expect(ok.driver.ops.filter((o) => o.kind === 'consent')).toHaveLength(1);
    const consent = ok.driver.ops.find((o) => o.kind === 'consent');
    // nilai disamarkan di overlay
    expect(JSON.stringify(consent)).not.toContain('0800');
  });
});

describe('interpreter: pendingWrite + resume', () => {
  const uploadSteps = () => [
    nav('/upload'),
    click(css('#btnSubmit'), {
      effect: 'write',
      expectReload: true,
      verify: countIncreased(css('li.uploaded-item')),
    }),
    waitFor(textIncludes('x')),
  ];

  it('write dengan reload: catat baseline sebelum klik, verify setelah reload (SW baru), klik hanya sekali', async () => {
    const { interp, driver, kv, make } = setup();
    let items = 2;
    driver.handler = (op) => {
      if (op.kind === 'count') return { ok: true, value: items };
      if (op.kind === 'consent') return { ok: true, value: true };
      if (op.kind === 'step' && op.step.op === 'click') return { ok: true };
      if (op.kind === 'wait')
        return items > (op.baseline ?? 0) ? { ok: true } : { ok: false, code: 'WAIT_TIMEOUT', message: 't' };
      return { ok: true, value: true };
    };
    await interp.start(req(uploadSteps()));
    await loadPage(interp, driver, `${FX}/upload`);

    let c = await cursorOf(kv);
    expect(c.status).toBe('waiting_load');
    expect(c.pendingWrite).toEqual({ stepIndex: 1, baseline: 2 });
    expect(driver.clicks()).toBe(1);

    // SW mati dan dibangunkan oleh event load: instance baru, state hanya dari storage.
    items = 3; // server menambah satu berkas, halaman reload
    const reborn = make();
    await loadPage(reborn, driver, `${FX}/upload`);
    c = await cursorOf(kv);
    expect(c.completedWrites).toEqual([1]);
    expect(c.pendingWrite).toBeUndefined();
    expect(c.status).toBe('done');
    expect(driver.clicks()).toBe(1);
  });

  it('verify tidak terpenuhi: handoff, tidak ada klik ulang, juga setelah resume', async () => {
    const { interp, driver, kv, make } = setup();
    driver.handler = (op) => {
      if (op.kind === 'count') return { ok: true, value: 2 };
      if (op.kind === 'wait') return { ok: false, code: 'WAIT_TIMEOUT', message: 't' };
      return { ok: true, value: true };
    };
    await interp.start(req(uploadSteps()));
    await loadPage(interp, driver, `${FX}/upload`);
    await loadPage(interp, driver, `${FX}/upload`);
    const c = await cursorOf(kv);
    expect(c.status).toBe('handoff');
    expect(c.error?.code).toBe('WRITE_UNVERIFIED');
    await make().resume();
    expect(driver.clicks()).toBe(1);
  });

  it('SW mati tepat setelah klik (status running + pendingWrite): resume memverifikasi dulu, tidak mengklik', async () => {
    const { interp, driver, kv, make } = setup();
    const steps = [
      nav('/upload'),
      click(css('#btnSubmit'), { effect: 'write', verify: countIncreased(css('li.uploaded-item')) }),
    ];
    driver.handler = (op) => {
      if (op.kind === 'count') return { ok: true, value: 0 };
      if (op.kind === 'consent') return { ok: true, value: true };
      return { ok: true, value: true };
    };
    await interp.start(req(steps));
    await loadPage(interp, driver, `${FX}/upload`);
    // Selesai normal. Sekarang rekayasa keadaan "mati di tengah": status running, pendingWrite ada.
    const done = await cursorOf(kv);
    const before = driver.clicks();
    await kv.set('cursor', {
      ...done,
      status: 'running',
      stepIndex: 1,
      completedWrites: [],
      pendingWrite: { stepIndex: 1, baseline: 0 },
    });
    driver.handler = (op) => (op.kind === 'wait' ? { ok: true } : { ok: true, value: true });
    await make().resume();
    expect(driver.clicks()).toBe(before); // tidak ada klik baru
    expect((await cursorOf(kv)).completedWrites).toEqual([1]);
  });

  it('write yang sudah ada di completedWrites dilewati saat dijalankan ulang', async () => {
    const { interp, driver, kv } = setup();
    const steps = [nav('/upload'), click(css('#btnSubmit'), { effect: 'write', verify: textIncludes('ok') })];
    await interp.start(req(steps));
    await loadPage(interp, driver, `${FX}/upload`);
    expect(driver.clicks()).toBe(1);
    const c = await cursorOf(kv);
    expect(c.completedWrites).toEqual([1]);
    await kv.set('cursor', { ...c, status: 'running', stepIndex: 1 });
    await interp.resume();
    expect(driver.clicks()).toBe(1);
    expect((await cursorOf(kv)).status).toBe('done');
  });
});

describe('interpreter: validasi dan keadaan', () => {
  it('menolak langkah invalid (final di luar gate) dan op yang belum didukung', async () => {
    const { interp } = setup();
    expect(
      await interp.start(req([{ op: 'click', target: [{ by: 'css', value: 'a' }], effect: 'final' }])),
    ).toMatchObject({
      ok: false,
      code: 'FINAL_OUTSIDE_GATE',
    });
    expect(
      await interp.start(
        req([{ op: 'select', target: [{ by: 'css', value: 'a' }], value: 'x', effect: 'input' }]),
      ),
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED_OP' });
  });

  it('BUSY bila ada eksekusi aktif; cancel membebaskan', async () => {
    const { interp } = setup();
    await interp.start(req([nav('/a')]));
    expect(await interp.start(req([nav('/b')]))).toMatchObject({ ok: false, code: 'BUSY' });
    await interp.cancel();
    expect(await interp.start(req([nav('/b')]))).toHaveProperty('status', 'waiting_load');
  });

  it('op runner yang terputus (halaman berpindah) diulang setelah load berikutnya', async () => {
    const { interp, driver, kv } = setup();
    let first = true;
    driver.handler = () => {
      if (first) {
        first = false;
        return 'interrupted';
      }
      return { ok: true, value: true };
    };
    await interp.start(req([nav('/a'), verify(textIncludes('x'))]));
    await loadPage(interp, driver, `${FX}/a`);
    expect((await cursorOf(kv)).status).toBe('waiting_load');
    await interp.onTabUpdated(1, { status: 'complete' });
    expect((await cursorOf(kv)).status).toBe('done');
  });
});
