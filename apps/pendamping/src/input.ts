import type { PendampingClientMessage } from '@urusin/contracts';

/**
 * Pemetaan pesan input warga (mode takeover) ke perintah CDP `Input.*`. Murni agar bisa diuji.
 * Isi ketikan tidak pernah dicatat di mana pun; fungsi ini hanya membentuk parameter perintah.
 */
export type CdpCommand = { method: string; params: Record<string, unknown> };

type InputMessage = Extract<PendampingClientMessage, { type: 'pointer' | 'wheel' | 'key' | 'text' }>;

/** Kode virtual Windows untuk tombol non-karakter (CDP membutuhkannya agar default action berjalan). */
const VK: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

const BUTTONS_MASK = { none: 0, left: 1 } as const;

export function isInputMessage(m: PendampingClientMessage): m is InputMessage {
  return m.type === 'pointer' || m.type === 'wheel' || m.type === 'key' || m.type === 'text';
}

type Pointer = Extract<InputMessage, { type: 'pointer' }>;
const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}): CdpCommand => ({
  method: 'Input.dispatchMouseEvent',
  params: { type, x, y, button: 'none', buttons: 0, clickCount: 0, modifiers: 0, ...extra },
});

/**
 * Sentuhan warga -> MOUSE di peramban pendamping (bukan touch event): ketukan menjadi klik mouse persis di
 * titik sentuh, sehingga juga sampai ke iframe lintas-origin (mis. kotak centang verifikasi situs).
 * Geser melewati `slop` piksel menjadi gulir (mouseWheel), bukan seret. Satu pemeta per sesi (berstatus).
 * Urutan klik = gerak nyata warga (mouseMoved di titik sentuh dan tiap sampel jari), lalu mousePressed +
 * mouseReleased `left`/clickCount 1 di titik sentuh. Tidak ada lintasan atau jeda sintetis (tanpa evasi).
 */
export function createTouchMapper(slop = 8): (m: Pointer) => CdpCommand[] {
  let start: { x: number; y: number } | null = null;
  let last = { x: 0, y: 0 };
  let scrolling = false;
  return (m) => {
    switch (m.aksi) {
      case 'down':
        start = { x: m.x, y: m.y };
        last = start;
        scrolling = false;
        return [mouse('mouseMoved', m.x, m.y)];
      case 'move': {
        if (!start) return [];
        if (!scrolling && Math.hypot(m.x - start.x, m.y - start.y) > slop) scrolling = true;
        // Di bawah slop: gerak jari warga yang sebenarnya diteruskan apa adanya (bukan lintasan buatan).
        if (!scrolling) return [mouse('mouseMoved', m.x, m.y)];
        const delta = { deltaX: last.x - m.x, deltaY: last.y - m.y };
        last = { x: m.x, y: m.y };
        return [mouse('mouseWheel', m.x, m.y, delta)];
      }
      case 'up': {
        const s = start;
        start = null;
        if (!s || scrolling) return [];
        const klik = { button: 'left', clickCount: 1, modifiers: m.mod ?? 0 };
        return [
          mouse('mouseMoved', s.x, s.y),
          mouse('mousePressed', s.x, s.y, { ...klik, buttons: 1 }),
          mouse('mouseReleased', s.x, s.y, klik),
        ];
      }
      case 'cancel':
        start = null;
        return [];
    }
  };
}

export function toCdp(
  m: InputMessage,
  touch: (m: Pointer) => CdpCommand[] = createTouchMapper(),
): CdpCommand[] {
  switch (m.type) {
    case 'text':
      return [{ method: 'Input.insertText', params: { text: m.teks } }];
    case 'wheel':
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: { type: 'mouseWheel', x: m.x, y: m.y, deltaX: m.dx, deltaY: m.dy },
        },
      ];
    case 'key': {
      const vk = VK[m.key];
      const params: Record<string, unknown> = {
        type: m.aksi === 'down' ? (m.key === 'Enter' ? 'keyDown' : 'rawKeyDown') : 'keyUp',
        key: m.key,
        code: m.code,
        modifiers: m.mod ?? 0,
        ...(vk === undefined ? {} : { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }),
      };
      if (m.aksi === 'down' && m.key === 'Enter') Object.assign(params, { text: '\r', unmodifiedText: '\r' });
      return [{ method: 'Input.dispatchKeyEvent', params }];
    }
    case 'pointer': {
      if (m.jenis === 'touch') return touch(m);
      if (m.aksi === 'cancel') return [];
      // Hanya tombol kiri yang diteruskan (temuan keamanan m5): tekan/lepas kanan/tengah dibuang, gerak
      // sambil menahannya menjadi gerak biasa. Menu konteks dan klik tengah peramban tidak dibutuhkan warga.
      const lain = m.tombol === 'right' || m.tombol === 'middle';
      if (lain && m.aksi !== 'move') return [];
      const type = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[m.aksi];
      const button = lain || (m.aksi === 'move' && m.tombol === 'none') ? 'none' : 'left';
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: {
            type,
            x: m.x,
            y: m.y,
            button,
            buttons: m.aksi === 'up' ? 0 : BUTTONS_MASK[button],
            clickCount: m.aksi === 'move' ? 0 : (m.klik ?? 1),
            modifiers: m.mod ?? 0,
            pointerType: m.jenis === 'pen' ? 'pen' : 'mouse',
          },
        },
      ];
    }
  }
}

/**
 * Ekspresi (dunia terisolasi) yang mengklasifikasi elemen fokus TANPA membaca nilainya: sandi, OTP, angka,
 * teks, atau tidak ada. Iframe lintas-origin yang fokus dianggap teks (isinya tidak bisa diperiksa).
 */
export const FOKUS_EXPR = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return 'tidak_ada';
  const tag = el.tagName;
  if (tag === 'IFRAME') return 'teks';
  if (tag === 'TEXTAREA' || el.isContentEditable) return 'teks';
  if (tag !== 'INPUT') return 'tidak_ada';
  const t = (el.getAttribute('type') || 'text').toLowerCase();
  if (t === 'password') return 'sandi';
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  const nama = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
  if (ac.includes('one-time-code') || /otp|kode.?verif|verification|token/.test(nama)) return 'otp';
  if (t === 'number' || t === 'tel' || (el.getAttribute('inputmode') || '') === 'numeric') return 'angka';
  if (['text', 'email', 'search', 'url'].includes(t)) return 'teks';
  return 'tidak_ada';
})()`;
