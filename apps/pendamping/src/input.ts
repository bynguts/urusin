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

const BUTTONS_MASK = { none: 0, left: 1, right: 2, middle: 4 } as const;

export function isInputMessage(m: PendampingClientMessage): m is InputMessage {
  return m.type === 'pointer' || m.type === 'wheel' || m.type === 'key' || m.type === 'text';
}

export function toCdp(m: InputMessage, opts: { touch: boolean }): CdpCommand[] {
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
      if (m.jenis === 'touch' && opts.touch) {
        const type = { down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel' }[m.aksi];
        const touchPoints = m.aksi === 'up' || m.aksi === 'cancel' ? [] : [{ x: m.x, y: m.y }];
        return [{ method: 'Input.dispatchTouchEvent', params: { type, touchPoints, modifiers: m.mod ?? 0 } }];
      }
      if (m.aksi === 'cancel') return [];
      const type = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[m.aksi];
      const button = m.tombol === 'none' && m.aksi !== 'move' ? 'left' : m.tombol;
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
