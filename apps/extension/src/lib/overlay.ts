/**
 * Gate kedua otoritatif (rencana §3.5 butir 8): overlay di closed shadow root milik ekstensi.
 * Persetujuan hanya sah dari klik warga (`event.isTrusted`); klik sintetis dari skrip halaman diabaikan.
 */

import { maskValue, type ConsentSummary } from '@urusin/executor/types';

// Tipe ringkasan + penyamaran nilai kini milik eksekutor bersama (dipakai juga Browser Pendamping).
export { maskValue, type ConsentSummary };

const HOST_ID = 'urusin-consent-host';

export function showConsentOverlay(doc: Document, summary: ConsentSummary): Promise<boolean> {
  doc.getElementById(HOST_ID)?.remove();
  const host = doc.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, css?: string) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (css) node.style.cssText = css;
    return node;
  };

  const backdrop = el(
    'div',
    undefined,
    'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif;',
  );
  const card = el(
    'div',
    undefined,
    'background:#fff;color:#111;max-width:420px;width:90%;padding:20px;border-radius:12px;',
  );
  card.append(el('h2', 'Izinkan Urusin bertindak di situs ini?', 'margin:0 0 8px;font-size:16px;'));
  card.append(el('p', `Situs: ${summary.origin}${summary.instansi ? ` (${summary.instansi})` : ''}`));
  if (summary.fills.length > 0) {
    const ul = el('ul', undefined, 'margin:0 0 8px;padding-left:18px;');
    for (const f of summary.fills) ul.append(el('li', `${f.label}: ${f.masked}`));
    card.append(el('p', 'Nilai yang akan diisi:', 'margin:0;'), ul);
  }
  card.append(el('p', `Jumlah pengiriman data (write): ${summary.writes}`));
  card.append(el('p', 'Pengiriman akhir selalu Anda tekan sendiri.', 'font-style:italic;'));
  const row = el('div', undefined, 'display:flex;gap:8px;justify-content:flex-end;');
  const cancel = el('button', 'Batal', 'padding:8px 14px;');
  const allow = el(
    'button',
    'Izinkan',
    'padding:8px 14px;background:#0f766e;color:#fff;border:0;border-radius:6px;',
  );
  row.append(cancel, allow);
  card.append(row);
  backdrop.append(card);
  root.append(backdrop);
  (doc.body ?? doc.documentElement).append(host);
  cancel.focus(); // default aman: Enter langsung = Batal

  return new Promise((resolve) => {
    const done = (v: boolean) => {
      host.remove();
      resolve(v);
    };
    allow.addEventListener('click', (e) => e.isTrusted && done(true));
    cancel.addEventListener('click', (e) => e.isTrusted && done(false));
  });
}
