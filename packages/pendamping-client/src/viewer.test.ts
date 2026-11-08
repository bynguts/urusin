import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePendampingFrame } from '@urusin/contracts';
import {
  createPendampingViewer,
  dekodeFrameBiner,
  modifier,
  petakanKoordinat,
  tataLetak,
  type ViewerOptions,
} from './viewer.js';

const META = { lebar: 400, tinggi: 800, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 0 };

describe('pemetaan koordinat', () => {
  it('contain-fit: letterbox horizontal dan vertikal, titik di luar = null', () => {
    // canvas 800x800 menampilkan halaman 400x800 -> skala 1, offset x 200
    const rect = { left: 10, top: 20, width: 800, height: 800 };
    expect(tataLetak(rect, META)).toEqual({ skala: 1, offX: 200, offY: 0 });
    expect(petakanKoordinat(10 + 200 + 50, 20 + 100, rect, META)).toEqual({ x: 50, y: 100 });
    expect(petakanKoordinat(15, 30, rect, META)).toBeNull();
    // canvas 200x200 (skala 0.25, offset x 50)
    const kecil = { left: 0, top: 0, width: 200, height: 200 };
    expect(petakanKoordinat(50 + 25, 100, kecil, META)).toEqual({ x: 100, y: 400 });
    expect(petakanKoordinat(1, 1, { left: 0, top: 0, width: 0, height: 0 }, META)).toBeNull();
  });

  it('modifier bitmask CDP', () => {
    expect(modifier({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
    expect(modifier({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: true })).toBe(8);
  });
});

// ---- fakes ----------------------------------------------------------------
class FakeWs {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed: number | undefined;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWs.all.push(this);
  }
  acks: number[] = [];
  send(d: string) {
    const m = JSON.parse(d) as Record<string, unknown>;
    // ack frame dicatat terpisah agar urutan pesan lain tetap mudah diperiksa
    if (m.type === 'ack') this.acks.push(m.seq as number);
    else this.sent.push(m);
  }
  close(code?: number) {
    this.closed = code;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  pushBiner(b: Uint8Array | ArrayBuffer) {
    this.onmessage?.({ data: b });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

class FakeTarget {
  listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  removeEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners.set(
      t,
      (this.listeners.get(t) ?? []).filter((f) => f !== fn),
    );
  }
  fire(t: string, e: object) {
    for (const fn of this.listeners.get(t) ?? []) fn({ preventDefault() {}, ...e });
  }
}

class FakeCanvas extends FakeTarget {
  width = 0;
  height = 0;
  style = { touchAction: '' };
  drawn: number[][] = [];
  captured: number[] = [];
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 400 };
  }
  getContext() {
    return {
      clearRect() {},
      drawImage: (_img: unknown, ...a: number[]) => this.drawn.push(a),
    };
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  focus() {}
}

class FakeInput extends FakeTarget {
  value = 'sisa';
  focused = 0;
  tagName = 'INPUT';
  type = 'text';
  attrs: Record<string, string> = {};
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  focus() {
    this.focused++;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const pointer = (x: number, y: number, extra: object = {}) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  pointerType: 'touch',
  button: 0,
  buttons: 1,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
});
const key = (k: string, extra: object = {}) => ({
  key: k,
  code: k,
  isComposing: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
});

function setup(extra: Partial<ViewerOptions> = {}) {
  FakeWs.all = [];
  const canvas = new FakeCanvas();
  const input = new FakeInput();
  let n = 0;
  const viewer = createPendampingViewer(canvas as unknown as HTMLCanvasElement, 'ws://x/ws/s1', {
    tiket: async () => `tiket-${++n}`.padEnd(20, 'x'),
    inputTeks: input as unknown as HTMLInputElement,
    WebSocketImpl: FakeWs as never,
    dekode: async () => ({ width: 400, height: 800, close() {} }),
    dpr: () => 2,
    backoffMs: 10,
    jedaGerakMs: 0,
    ...extra,
  });
  return { canvas, input, viewer };
}

describe('createPendampingViewer', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('halo bertiket sebagai pesan pertama; frame digambar dengan DPR; event diteruskan', async () => {
    const { canvas, viewer } = setup();
    const seen: string[] = [];
    viewer.on('koneksi', (k) => seen.push(k));
    viewer.on('event', (e) => seen.push(`event:${e.jenis}`));
    viewer.on('status', (s) => seen.push(`status:${s.status}`));
    viewer.on('butuh_data', (d) => seen.push(`data:${d.berkas.join()}`));
    viewer.on('galat', (g) => seen.push(`galat:${g.kode}`));
    const frames: number[] = [];
    viewer.on('frame', (m) => frames.push(m.lebar));
    await tick();
    const ws = FakeWs.all[0]!;
    ws.open();
    expect(ws.sent[0]).toMatchObject({ type: 'halo', tiket: expect.stringMatching(/^tiket-1/) });
    ws.push({ type: 'frame', seq: 1, data: 'AAAA', meta: META });
    await tick();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(800);
    expect(canvas.drawn[0]).toEqual([0, 0, 400, 800]);
    expect(frames).toEqual([400]);
    ws.push({ type: 'event', event: { jenis: 'langkah', indeks: 0, total: 3, label: 'x' } });
    ws.push({ type: 'status', sesi: { status: 'antre' } });
    ws.push({ type: 'butuh_data', placeholder: [], berkas: ['ktp'] });
    ws.push({ type: 'galat', kode: 'INTERNAL', pesanWarga: 'x' });
    ws.push({ type: 'pong', t: 1 });
    ws.onmessage?.({ data: 'bukan json' });
    ws.onmessage?.({ data: new Uint8Array(1) });
    // 'menyambung' terpancar sinkron sebelum listener terpasang.
    expect(seen).toEqual(['tersambung', 'event:langkah', 'status:antre', 'data:ktp', 'galat:INTERNAL']);
    viewer.ambilAlih();
    viewer.kembalikan();
    viewer.akhiri();
    viewer.kirimVault({ '{{PEMOHON.HP}}': '1' });
    await viewer.kirimBerkas('ktp', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'ktp.png');
    expect(ws.sent.slice(1).map((m) => m.type)).toEqual([
      'ambil_alih',
      'kembalikan',
      'akhiri',
      'vault',
      'berkas',
    ]);
    expect(ws.sent.at(-1)).toMatchObject({
      nama: 'ktp',
      namaBerkas: 'ktp.png',
      mime: 'image/png',
      dataBase64: 'AQID',
    });
  });

  it('input hanya dikirim saat takeover; koordinat dipetakan; teks/IME/tombol khusus', async () => {
    const { canvas, input, viewer } = setup();
    await tick();
    const ws = FakeWs.all[0]!;
    ws.open();
    ws.push({ type: 'frame', seq: 1, data: 'AAAA', meta: META });
    await tick();
    canvas.fire('pointerdown', pointer(100, 200));
    expect(ws.sent).toHaveLength(1); // mode AI: input dibuang
    ws.push({ type: 'mode', mode: 'takeover', pesan: 'Giliran Anda' });
    expect(viewer.mode).toBe('takeover');
    canvas.fire('pointerdown', pointer(100, 200));
    canvas.fire('pointermove', pointer(110, 210, { buttons: 0, pointerType: 'mouse' }));
    canvas.fire('pointerup', pointer(100, 200));
    canvas.fire('pointerdown', pointer(-5, -5)); // di luar gambar
    canvas.fire('wheel', { clientX: 100, clientY: 200, deltaX: 0, deltaY: 50 });
    canvas.fire('keydown', key('a'));
    canvas.fire('keydown', key('Enter'));
    canvas.fire('keyup', key('Enter'));
    canvas.fire('keydown', key('Shift'));
    canvas.fire('keydown', key('a', { ctrlKey: true }));
    canvas.fire('keydown', key('x', { isComposing: true }));
    input.fire('beforeinput', { inputType: 'insertText', data: 'DEV123' });
    input.fire('beforeinput', { inputType: 'deleteContentBackward' });
    input.fire('beforeinput', { inputType: 'insertLineBreak' });
    input.fire('beforeinput', { inputType: 'formatBold' });
    input.fire('keydown', { ...key('b'), target: input });
    input.fire('compositionend', { data: 'ñ' });
    const sent = ws.sent.slice(1);
    expect(sent[0]).toEqual({
      type: 'pointer',
      aksi: 'down',
      x: 200,
      y: 400,
      jenis: 'touch',
      tombol: 'left',
      klik: 1,
      mod: 0,
    });
    expect(sent[1]).toMatchObject({ aksi: 'move', jenis: 'mouse', tombol: 'none' });
    expect(sent[2]).toMatchObject({ aksi: 'up', klik: 1 });
    expect(sent[3]).toEqual({ type: 'wheel', x: 200, y: 400, dx: 0, dy: 50 });
    expect(sent.slice(4).map((m) => `${m.type}:${(m.teks ?? m.key) as string}`)).toEqual([
      'text:a',
      'key:Enter',
      'key:Enter',
      'key:a',
      'text:DEV123',
      'key:Backspace',
      'key:Backspace',
      'key:Enter',
      'key:Enter',
      'text:ñ',
    ]);
    expect(canvas.captured).toEqual([1]);
    expect(input.focused).toBe(1);
    expect(input.value).toBe('');
    expect(canvas.style.touchAction).toBe('none');
  });

  it('sambung ulang dengan tiket baru; berhenti pada kode akhir; tutup melepas listener', async () => {
    const { viewer, canvas } = setup();
    await tick();
    FakeWs.all[0]!.open();
    FakeWs.all[0]!.drop(1006);
    expect(viewer.koneksi).toBe('putus');
    await new Promise((r) => setTimeout(r, 30));
    const second = FakeWs.all[1]!;
    second.open();
    expect(second.sent[0]).toMatchObject({ tiket: expect.stringMatching(/^tiket-2/) });
    second.drop(4000);
    expect(viewer.koneksi).toBe('selesai');
    expect(FakeWs.all).toHaveLength(2);
    viewer.tutup();
    expect([...canvas.listeners.values()].every((l) => l.length === 0)).toBe(true);
  });

  it('gagal ambil tiket berulang -> selesai setelah batas; frame rusak dilewati', async () => {
    const { viewer } = setup({
      tiket: async () => {
        throw new Error('401');
      },
      maxSambungUlang: 2,
      backoffMs: 1,
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(viewer.koneksi).toBe('selesai');

    const b = setup({ dekode: async () => Promise.reject(new Error('rusak')) });
    await tick();
    const ws = FakeWs.all[0]!;
    ws.open();
    ws.push({ type: 'frame', seq: 1, data: 'eA==', meta: META });
    ws.push({ type: 'frame', seq: 2, data: 'eQ==', meta: META });
    await tick();
    await tick();
    b.viewer.tutup();
    expect(ws.closed).toBe(1000);
  });

  it('mode done menghentikan sambung ulang', async () => {
    const { viewer } = setup();
    await tick();
    const ws = FakeWs.all[0]!;
    ws.open();
    ws.push({ type: 'mode', mode: 'done' });
    ws.drop(1006);
    expect(viewer.koneksi).toBe('selesai');
  });

  it('kasus tepi: tanpa frame tidak ada input; pena tombol kanan; berkas tanpa nama/tipe; frame bertumpuk', async () => {
    const { canvas, viewer } = setup();
    await tick();
    const ws = FakeWs.all[0]!;
    ws.open();
    ws.push({ type: 'mode', mode: 'takeover' });
    canvas.fire('pointerdown', pointer(10, 10)); // belum ada frame: tidak tahu skala
    canvas.fire('wheel', { clientX: 1, clientY: 1, deltaX: 0, deltaY: 1 });
    expect(ws.sent).toHaveLength(1);
    ws.push({ type: 'frame', seq: 1, data: 'YQ==', meta: META });
    ws.push({ type: 'frame', seq: 2, data: 'Yg==', meta: META });
    ws.push({ type: 'frame', seq: 3, data: 'Yw==', meta: META });
    await tick();
    await tick();
    await tick();
    expect(canvas.drawn.length).toBeGreaterThanOrEqual(2);
    canvas.fire('pointerdown', pointer(100, 200, { pointerType: 'pen', button: 2 }));
    canvas.fire('pointercancel', pointer(100, 200, { pointerType: 'pen', button: 7 }));
    canvas.fire('wheel', { clientX: -50, clientY: -50, deltaX: 0, deltaY: 1 });
    canvas.fire('keyup', key('a'));
    canvas.fire('keydown', key('F5'));
    canvas.fire('contextmenu', {});
    await viewer.kirimBerkas('kk', new Blob([new Uint8Array([0])]));
    const sent = ws.sent.slice(1);
    expect(sent[0]).toMatchObject({ jenis: 'pen', tombol: 'right' });
    expect(sent[1]).toMatchObject({ aksi: 'cancel', tombol: 'left' });
    expect(sent.at(-1)).toMatchObject({ type: 'berkas', namaBerkas: 'kk', mime: 'application/octet-stream' });
    expect(sent).toHaveLength(3);
    viewer.tutup();
    viewer.tutup();
  });

  it('tanpa inputTeks dan kanvas tanpa konteks 2D tetap berjalan', async () => {
    FakeWs.all = [];
    const canvas = new FakeCanvas();
    canvas.getContext = () => null as never;
    const viewer = createPendampingViewer(canvas as unknown as HTMLCanvasElement, 'ws://x', {
      tiket: async () => 't'.repeat(20),
      WebSocketImpl: FakeWs as never,
      dekode: async () => ({ width: 1, height: 1 }),
    });
    await tick();
    FakeWs.all[0]!.open();
    FakeWs.all[0]!.push({ type: 'frame', seq: 1, data: 'YQ==', meta: META });
    await tick();
    expect(canvas.width).toBeGreaterThan(0);
    viewer.tutup();
  });

  it('frame biner: digambar lalu di-ack; frame antara dibuang tetap di-ack; frame biner rusak diabaikan', async () => {
    let lepas: () => void = () => {};
    const tahan = new Promise<void>((r) => (lepas = r));
    const { ws, viewer } = await (async () => {
      const b = setup({
        dekode: async () => {
          await tahan;
          return { width: 1, height: 1 };
        },
      });
      await tick();
      const w = FakeWs.all[0]!;
      w.open();
      return { ws: w, viewer: b.viewer };
    })();
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const frames: number[] = [];
    viewer.on('frame', (m) => frames.push(m.scrollY));
    ws.pushBiner(encodePendampingFrame(1, { ...META, scrollY: 1 }, jpeg));
    ws.pushBiner(encodePendampingFrame(2, { ...META, scrollY: 2 }, jpeg).buffer as ArrayBuffer);
    ws.pushBiner(encodePendampingFrame(3, { ...META, scrollY: 3 }, jpeg));
    ws.pushBiner(Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9]));
    ws.onmessage?.({ data: 42 });
    await tick();
    const acks = () => ws.acks;
    expect(acks()).toEqual([2]); // frame 2 digantikan frame 3 sebelum sempat digambar
    lepas();
    await tick();
    await tick();
    expect(acks()).toEqual([2, 1, 3]);
    expect(frames).toEqual([1, 3]);
  });

  it('dekodeFrameBiner kompatibel dengan encoder kontrak; versi/meta rusak = null', () => {
    const jpeg = Uint8Array.from([1, 2, 3]);
    const buf = encodePendampingFrame(77, META, jpeg);
    expect(dekodeFrameBiner(buf)).toMatchObject({ seq: 77, meta: META });
    expect([...dekodeFrameBiner(buf)!.jpeg]).toEqual([1, 2, 3]);
    expect(dekodeFrameBiner(Uint8Array.from([2, ...buf.subarray(1)]))).toBeNull();
    expect(dekodeFrameBiner(new Uint8Array(3))).toBeNull();
    expect(dekodeFrameBiner(encodePendampingFrame(1, { ...META, lebar: 0 }, jpeg))).toBeNull();
    expect(dekodeFrameBiner(encodePendampingFrame(1, { ...META, skala: Number.NaN }, jpeg))).toBeNull();
    const rusak = Uint8Array.from(buf);
    rusak[7] = 0x40;
    expect(dekodeFrameBiner(rusak)).toBeNull();
    expect(dekodeFrameBiner(buf.subarray(0, 7 + new DataView(buf.buffer).getUint16(5)))).toBeNull();
  });

  it('input tersembunyi: tanpa autofill; fokus sandi -> type password; OTP -> one-time-code numerik', async () => {
    const { ws, input, viewer } = await (async () => {
      const b = setup();
      await tick();
      const w = FakeWs.all[0]!;
      w.open();
      return { ws: w, input: b.input, viewer: b.viewer };
    })();
    expect(input.attrs).toMatchObject({
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    const fokus: string[] = [];
    viewer.on('fokus', (j) => fokus.push(j));
    input.value = 'sisa';
    ws.push({ type: 'fokus', jenis: 'sandi' });
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    ws.push({ type: 'fokus', jenis: 'otp' });
    expect(input.type).toBe('text');
    expect(input.attrs).toMatchObject({ autocomplete: 'one-time-code', inputmode: 'numeric' });
    ws.push({ type: 'fokus', jenis: 'teks' });
    expect(input.attrs).toMatchObject({ autocomplete: 'off', inputmode: 'text' });
    expect(fokus).toEqual(['sandi', 'otp', 'teks']);
  });
});
