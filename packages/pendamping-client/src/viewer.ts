import type {
  PendampingClientMessage,
  PendampingEvent,
  PendampingFrameMeta,
  PendampingKodeGalat,
  PendampingMode,
  PendampingServerMessage,
  SesiPendamping,
} from '@urusin/contracts';

/**
 * Penampil Browser Pendamping tanpa framework (UI final milik Rafi; modul ini hanya mekanik):
 * - frame JPEG dari WebSocket digambar ke canvas (contain-fit, tajam di layar ber-DPR tinggi);
 * - pointer (mouse/sentuh/pena), roda, keyboard, dan teks IME/keyboard virtual dipetakan ke koordinat
 *   viewport peramban server; input HANYA dikirim saat mode `takeover`;
 * - sambung ulang dengan backoff, mengambil tiket sekali pakai baru setiap kali.
 * Tidak menyimpan frame atau ketikan; tidak mencatat apa pun ke console.
 */

export type Rect = { left: number; top: number; width: number; height: number };

/** Petakan titik layar (clientX/Y) ke piksel CSS viewport peramban server; null bila di luar gambar. */
export function petakanKoordinat(
  clientX: number,
  clientY: number,
  rect: Rect,
  meta: Pick<PendampingFrameMeta, 'lebar' | 'tinggi'>,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const fit = tataLetak(rect, meta);
  const x = (clientX - rect.left - fit.offX) / fit.skala;
  const y = (clientY - rect.top - fit.offY) / fit.skala;
  if (x < 0 || y < 0 || x > meta.lebar || y > meta.tinggi) return null;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

/** Skala contain-fit + offset letterbox (piksel CSS) untuk gambar `meta` di dalam `rect`. */
export function tataLetak(
  rect: Pick<Rect, 'width' | 'height'>,
  meta: Pick<PendampingFrameMeta, 'lebar' | 'tinggi'>,
) {
  const skala = Math.min(rect.width / meta.lebar, rect.height / meta.tinggi);
  return {
    skala,
    offX: (rect.width - meta.lebar * skala) / 2,
    offY: (rect.height - meta.tinggi * skala) / 2,
  };
}

/** Bitmask modifier CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function modifier(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const TOMBOL = ['left', 'middle', 'right'] as const;

type Gambar = { width: number; height: number; close?: () => void };
type WsLike = {
  readyState: number;
  binaryType?: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type ViewerStatus = 'menyambung' | 'tersambung' | 'putus' | 'selesai';

export type JenisFokus = Extract<PendampingServerMessage, { type: 'fokus' }>['jenis'];

export type ViewerEvents = {
  mode: { mode: PendampingMode; pesan?: string | undefined };
  /** Jenis kolom yang fokus di peramban pendamping (tanpa nilai); input tersembunyi sudah disesuaikan. */
  fokus: JenisFokus;
  event: PendampingEvent;
  status: SesiPendamping;
  butuh_data: { placeholder: string[]; berkas: string[] };
  galat: { kode: PendampingKodeGalat; pesanWarga: string };
  koneksi: ViewerStatus;
  frame: PendampingFrameMeta;
};

export type ViewerOptions = {
  /** Ambil tiket WS sekali pakai baru (POST /api/urusan/[id]/pendamping/tiket). Dipanggil tiap sambung. */
  tiket: () => Promise<string>;
  /** Elemen teks tersembunyi untuk keyboard virtual/IME di ponsel (fokuskan saat warga mengetuk canvas). */
  inputTeks?: HTMLInputElement | HTMLTextAreaElement | undefined;
  /** Injeksi untuk tes. */
  WebSocketImpl?: new (url: string) => WsLike;
  dekode?: (jpeg: Uint8Array) => Promise<Gambar>;
  dpr?: () => number;
  maxSambungUlang?: number;
  backoffMs?: number;
  /** Jeda minimum antar pesan pointer `move` (ms). */
  jedaGerakMs?: number;
  /** Jeda antar potongan berkas (ms), menjaga laju di bawah batas pesan per detik pendamping. */
  jedaPotongMs?: number;
};

export type PendampingViewer = {
  readonly mode: PendampingMode | null;
  readonly koneksi: ViewerStatus;
  on<K extends keyof ViewerEvents>(type: K, cb: (v: ViewerEvents[K]) => void): () => void;
  ambilAlih(): void;
  kembalikan(): void;
  akhiri(): void;
  kirimVault(isian: Record<string, string>): void;
  kirimBerkas(nama: string, berkas: Blob, namaBerkas?: string): Promise<void>;
  tutup(): void;
};

const KODE_TANPA_ULANG = new Set([4000, 4401, 4404, 4409]);
const KEY_KHUSUS = new Set([
  'Enter',
  'Backspace',
  'Tab',
  'Escape',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

async function dekodeBawaan(jpeg: Uint8Array): Promise<Gambar> {
  return createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
}

function dariBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const META_KUNCI = ['lebar', 'tinggi', 'skala', 'offsetAtas', 'scrollX', 'scrollY'] as const;

/**
 * Dekode frame biner (format di @urusin/contracts `encodePendampingFrame`): [u8 versi=1][u32 seq][u16 n]
 * [meta JSON n byte][JPEG]. Tanpa dependensi (klien dimuat apa adanya di peramban); null bila rusak.
 */
export function dekodeFrameBiner(
  buf: ArrayBuffer | Uint8Array,
): { seq: number; meta: PendampingFrameMeta; jpeg: Uint8Array } | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 8 || bytes[0] !== 1) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint16(5);
  if (7 + n >= bytes.length) return null;
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(new TextDecoder().decode(bytes.subarray(7, 7 + n))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!meta || META_KUNCI.some((k) => typeof meta[k] !== 'number' || !Number.isFinite(meta[k]))) return null;
  if ((meta.lebar as number) <= 0 || (meta.tinggi as number) <= 0) return null;
  return { seq: v.getUint32(1), meta: meta as PendampingFrameMeta, jpeg: bytes.subarray(7 + n) };
}

/** Atribut input tersembunyi: tanpa autofill/autokoreksi/kamus; sandi = type password; OTP = one-time-code. */
export function aturInputTeks(el: HTMLInputElement | HTMLTextAreaElement, jenis: JenisFokus = 'teks'): void {
  el.setAttribute('autocomplete', jenis === 'otp' ? 'one-time-code' : 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('autocapitalize', 'off');
  el.setAttribute('spellcheck', 'false');
  el.setAttribute('inputmode', jenis === 'otp' || jenis === 'angka' ? 'numeric' : 'text');
  if ('type' in el && el.tagName === 'INPUT')
    (el as HTMLInputElement).type = jenis === 'sandi' ? 'password' : 'text';
  el.value = '';
}

/** Ukuran potongan berkas biner; sama dengan BERKAS_POTONG_BYTE di @urusin/contracts (diuji). */
export const BERKAS_POTONG_BYTE = 36 * 1024;
const jeda = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function base64Dari(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function createPendampingViewer(
  canvas: HTMLCanvasElement,
  wsUrl: string,
  opts: ViewerOptions,
): PendampingViewer {
  const WS = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as new (url: string) => WsLike);
  const dekode = opts.dekode ?? dekodeBawaan;
  const dpr = opts.dpr ?? (() => globalThis.devicePixelRatio || 1);
  const maxUlang = opts.maxSambungUlang ?? 6;
  const backoff = opts.backoffMs ?? 500;
  const jedaGerak = opts.jedaGerakMs ?? 16;
  const jedaPotongMs = opts.jedaPotongMs ?? 8;

  const listeners = new Map<keyof ViewerEvents, Set<(v: never) => void>>();
  const emit = <K extends keyof ViewerEvents>(type: K, v: ViewerEvents[K]) => {
    for (const cb of listeners.get(type) ?? []) (cb as (x: ViewerEvents[K]) => void)(v);
  };

  let ws: WsLike | null = null;
  let mode: PendampingMode | null = null;
  let koneksi: ViewerStatus = 'menyambung';
  let meta: PendampingFrameMeta | null = null;
  let percobaan = 0;
  let ditutup = false;
  let timerUlang: ReturnType<typeof setTimeout> | undefined;
  let timerPing: ReturnType<typeof setInterval> | undefined;
  let gerakTerakhir = 0;
  let menggambar = false;
  let frameTertunda: { jpeg: Uint8Array; meta: PendampingFrameMeta; seq: number | undefined } | null = null;

  const setKoneksi = (s: ViewerStatus) => {
    koneksi = s;
    emit('koneksi', s);
  };

  const kirim = (m: PendampingClientMessage) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  };
  const kirimInput = (m: PendampingClientMessage) => {
    if (mode === 'takeover') kirim(m);
  };

  /** Ack = frame sudah ditangani (digambar atau dibuang); pendamping menahan frame bila >2 belum di-ack. */
  const ack = (seq: number | undefined) => seq !== undefined && kirim({ type: 'ack', seq });

  async function gambar(jpeg: Uint8Array, m: PendampingFrameMeta, seq?: number) {
    if (menggambar) {
      ack(frameTertunda?.seq); // buang frame antara: hanya yang terbaru digambar
      frameTertunda = { jpeg, meta: m, seq };
      return;
    }
    menggambar = true;
    try {
      const img = await dekode(jpeg);
      const ctx = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      const r = dpr();
      const w = Math.round(rect.width * r);
      const h = Math.round(rect.height * r);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      if (ctx) {
        const fit = tataLetak(rect, m);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(
          img as CanvasImageSource,
          fit.offX * r,
          fit.offY * r,
          m.lebar * fit.skala * r,
          m.tinggi * fit.skala * r,
        );
      }
      img.close?.();
      meta = m;
      emit('frame', m);
    } catch {
      // frame rusak dilewati; frame berikutnya menggantikannya
    } finally {
      menggambar = false;
      ack(seq);
      const next = frameTertunda;
      frameTertunda = null;
      if (next) void gambar(next.jpeg, next.meta, next.seq);
    }
  }

  function terima(raw: unknown) {
    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      const f = dekodeFrameBiner(
        raw instanceof ArrayBuffer ? raw : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      );
      if (f) void gambar(f.jpeg, f.meta, f.seq);
      return;
    }
    if (typeof raw !== 'string') return;
    let msg: PendampingServerMessage;
    try {
      msg = JSON.parse(raw) as PendampingServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'frame':
        void gambar(dariBase64(msg.data), msg.meta, msg.seq);
        break;
      case 'fokus':
        if (inputTeks) aturInputTeks(inputTeks, msg.jenis);
        emit('fokus', msg.jenis);
        break;
      case 'mode':
        mode = msg.mode;
        emit('mode', { mode: msg.mode, pesan: msg.pesan });
        break;
      case 'event':
        emit('event', msg.event);
        break;
      case 'status':
        emit('status', msg.sesi);
        break;
      case 'butuh_data':
        emit('butuh_data', { placeholder: msg.placeholder, berkas: msg.berkas });
        break;
      case 'galat':
        emit('galat', { kode: msg.kode, pesanWarga: msg.pesanWarga });
        break;
      default:
        break;
    }
  }

  async function sambung() {
    if (ditutup) return;
    setKoneksi('menyambung');
    let t: string;
    try {
      t = await opts.tiket();
    } catch {
      return jadwalUlang();
    }
    if (ditutup) return;
    const sock = new WS(wsUrl);
    sock.binaryType = 'arraybuffer';
    ws = sock;
    sock.onopen = () => {
      percobaan = 0;
      sock.send(JSON.stringify({ type: 'halo', tiket: t } satisfies PendampingClientMessage));
      setKoneksi('tersambung');
      clearInterval(timerPing);
      timerPing = setInterval(() => kirim({ type: 'ping', t: Date.now() }), 20_000);
    };
    sock.onmessage = (ev) => terima(ev.data);
    sock.onerror = () => {};
    sock.onclose = (ev) => {
      clearInterval(timerPing);
      if (ws !== sock) return;
      ws = null;
      if (ditutup || KODE_TANPA_ULANG.has(ev.code) || mode === 'done') {
        setKoneksi('selesai');
        return;
      }
      jadwalUlang();
    };
  }

  function jadwalUlang() {
    if (ditutup) return;
    if (percobaan >= maxUlang) {
      setKoneksi('selesai');
      return;
    }
    setKoneksi('putus');
    const jeda = Math.min(backoff * 2 ** percobaan, 8_000);
    percobaan++;
    timerUlang = setTimeout(() => void sambung(), jeda);
  }

  // ---- input -------------------------------------------------------------
  const titik = (e: { clientX: number; clientY: number }) =>
    meta ? petakanKoordinat(e.clientX, e.clientY, canvas.getBoundingClientRect(), meta) : null;

  const onPointer = (aksi: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent) => {
    if (mode !== 'takeover') return;
    const p = titik(e);
    if (!p) return;
    if (aksi === 'move') {
      const now = Date.now();
      if (now - gerakTerakhir < jedaGerak) return;
      gerakTerakhir = now;
    }
    if (aksi === 'down') {
      canvas.setPointerCapture?.(e.pointerId);
      canvas.focus?.();
      opts.inputTeks?.focus({ preventScroll: true });
    }
    e.preventDefault?.();
    const jenis = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
    const tombol = aksi === 'move' ? (e.buttons & 1 ? 'left' : 'none') : (TOMBOL[e.button] ?? 'left');
    kirimInput({
      type: 'pointer',
      aksi,
      x: p.x,
      y: p.y,
      jenis,
      tombol,
      ...(aksi === 'down' || aksi === 'up' ? { klik: 1 } : {}),
      mod: modifier(e),
    });
  };

  const onWheel = (e: WheelEvent) => {
    if (mode !== 'takeover') return;
    const p = titik(e);
    if (!p) return;
    e.preventDefault?.();
    kirimInput({ type: 'wheel', x: p.x, y: p.y, dx: e.deltaX, dy: e.deltaY });
  };

  const onKey = (aksi: 'down' | 'up') => (e: KeyboardEvent) => {
    if (mode !== 'takeover' || e.isComposing) return;
    const mod = modifier(e);
    // Karakter biasa dikirim sebagai teks (insertText); tombol khusus/kombinasi sebagai key event.
    if (e.key.length === 1 && !(mod & 6)) {
      if (aksi === 'down' && e.target !== opts.inputTeks) kirimInput({ type: 'text', teks: e.key });
      if (e.target !== opts.inputTeks) e.preventDefault?.();
      return;
    }
    if (!KEY_KHUSUS.has(e.key) && !(mod & 6)) return;
    e.preventDefault?.();
    kirimInput({ type: 'key', aksi, key: e.key, code: e.code, mod });
  };

  const inputTeks = opts.inputTeks;
  const onBeforeInput = (e: InputEvent) => {
    if (mode !== 'takeover') return;
    if (e.inputType === 'deleteContentBackward') {
      kirimInput({ type: 'key', aksi: 'down', key: 'Backspace', code: 'Backspace' });
      kirimInput({ type: 'key', aksi: 'up', key: 'Backspace', code: 'Backspace' });
      e.preventDefault?.();
    } else if (e.inputType === 'insertText' && e.data) {
      kirimInput({ type: 'text', teks: e.data.slice(0, 500) });
      e.preventDefault?.();
    } else if (e.inputType === 'insertLineBreak') {
      kirimInput({ type: 'key', aksi: 'down', key: 'Enter', code: 'Enter' });
      kirimInput({ type: 'key', aksi: 'up', key: 'Enter', code: 'Enter' });
      e.preventDefault?.();
    }
  };
  const onCompositionEnd = (e: CompositionEvent) => {
    if (e.data) kirimInput({ type: 'text', teks: e.data.slice(0, 500) });
    if (inputTeks) inputTeks.value = '';
  };

  const pasang: [EventTarget, string, EventListener][] = [
    [canvas, 'pointerdown', onPointer('down') as EventListener],
    [canvas, 'pointermove', onPointer('move') as EventListener],
    [canvas, 'pointerup', onPointer('up') as EventListener],
    [canvas, 'pointercancel', onPointer('cancel') as EventListener],
    [canvas, 'wheel', onWheel as EventListener],
    [canvas, 'keydown', onKey('down') as EventListener],
    [canvas, 'keyup', onKey('up') as EventListener],
    [canvas, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener],
  ];
  if (inputTeks) {
    aturInputTeks(inputTeks);
    pasang.push(
      [inputTeks, 'beforeinput', onBeforeInput as EventListener],
      [inputTeks, 'compositionend', onCompositionEnd as EventListener],
      [inputTeks, 'keydown', onKey('down') as EventListener],
      [inputTeks, 'keyup', onKey('up') as EventListener],
    );
  }
  for (const [t, type, fn] of pasang) t.addEventListener(type, fn, { passive: false });
  if (canvas.style) canvas.style.touchAction = 'none'; // gestur sentuh diteruskan, bukan menggulir halaman kita

  void sambung();

  return {
    get mode() {
      return mode;
    },
    get koneksi() {
      return koneksi;
    },
    on(type, cb) {
      const set = listeners.get(type) ?? new Set();
      set.add(cb as (v: never) => void);
      listeners.set(type, set);
      return () => set.delete(cb as (v: never) => void);
    },
    ambilAlih: () => kirim({ type: 'ambil_alih' }),
    kembalikan: () => kirim({ type: 'kembalikan' }),
    akhiri: () => kirim({ type: 'akhiri' }),
    kirimVault: (isian) => kirim({ type: 'vault', isian }),
    async kirimBerkas(nama, berkas, namaBerkas) {
      // Potongan berurutan (batas pesan WS 64 KB), diberi jeda kecil agar tidak menabrak batas laju pesan.
      const buf = await berkas.arrayBuffer();
      if (buf.byteLength === 0) throw new Error('berkas kosong');
      const total = Math.max(1, Math.ceil(buf.byteLength / BERKAS_POTONG_BYTE));
      const dasar = {
        type: 'berkas_potong' as const,
        nama,
        namaBerkas: namaBerkas ?? (berkas as Blob & { name?: string }).name ?? nama,
        mime: berkas.type || 'application/octet-stream',
        ukuran: buf.byteLength,
        total,
      };
      for (let indeks = 0; indeks < total; indeks++) {
        const potong = buf.slice(indeks * BERKAS_POTONG_BYTE, (indeks + 1) * BERKAS_POTONG_BYTE);
        kirim({ ...dasar, indeks, dataBase64: base64Dari(potong) });
        if (indeks + 1 < total) await jeda(jedaPotongMs);
      }
    },
    tutup() {
      ditutup = true;
      clearTimeout(timerUlang);
      clearInterval(timerPing);
      for (const [t, type, fn] of pasang) t.removeEventListener(type, fn);
      ws?.close(1000, 'ditutup');
      ws = null;
      setKoneksi('selesai');
    },
  };
}
