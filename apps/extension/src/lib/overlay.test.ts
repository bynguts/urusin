import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskValue, showConsentOverlay } from './overlay';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Root closed tidak bisa dijangkau dari luar; tangkap lewat spy attachShadow. */
function captureShadow() {
  let root: ShadowRoot | undefined;
  const orig = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    root = orig.call(this, init);
    return root;
  });
  return () => root!;
}

const summary = {
  origin: 'http://localhost:4320',
  fills: [{ label: 'HP', masked: maskValue('08000000001') }],
  writes: 1,
};

const trusted = () => {
  const ev = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(ev, 'isTrusted', { value: true });
  return ev;
};
const buttons = (root: ShadowRoot) => [...root.querySelectorAll('button')];

describe('maskValue', () => {
  it('menyamarkan sebagian', () => {
    expect(maskValue('08000000001')).toBe('0••••••');
    expect(maskValue('a')).toBe('•');
  });
});

describe('overlay gate kedua', () => {
  it('shadow root closed: halaman tidak bisa menjangkau isinya', () => {
    const getRoot = captureShadow();
    void showConsentOverlay(document, summary);
    const host = document.getElementById('urusin-consent-host')!;
    expect(host.shadowRoot).toBeNull();
    expect(getRoot().mode).toBe('closed');
    expect(getRoot().textContent).toContain('http://localhost:4320');
    expect(getRoot().textContent).not.toContain('08000000001'); // disamarkan
  });

  it('klik sintetis (isTrusted=false) diabaikan; klik tepercaya pada Izinkan = true', async () => {
    const getRoot = captureShadow();
    const result = showConsentOverlay(document, summary);
    const [, allow] = buttons(getRoot());
    expect(allow!.textContent).toBe('Izinkan');

    allow!.click(); // skrip halaman / sintetis
    allow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('urusin-consent-host')).not.toBeNull();

    allow!.dispatchEvent(trusted());
    expect(await result).toBe(true);
    expect(document.getElementById('urusin-consent-host')).toBeNull();
  });

  it('Batal tepercaya = false', async () => {
    const getRoot = captureShadow();
    const result = showConsentOverlay(document, summary);
    buttons(getRoot())[0]!.dispatchEvent(trusted());
    expect(await result).toBe(false);
  });
});
