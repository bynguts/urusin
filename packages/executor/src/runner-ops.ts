import type { Check, Selector, Step, Target } from '@urusin/core';
import type { ConsentSummary, UploadFile } from './types.js';

/**
 * Operasi step-runner yang berjalan DI DALAM halaman (world terisolasi ekstensi / isolated world CDP di
 * Browser Pendamping). Satu op per pemanggilan; hasil dilaporkan ke interpreter (rencana §3.5 butir 2).
 * WAJIB tanpa impor runtime (hanya `import type`): pendamping menyuntikkan berkas hasil build ini apa adanya.
 */

export type RunnerOp =
  | {
      kind: 'step';
      step: Step;
      /** Target `highlight` gate.human: elemen khusus warga yang TIDAK BOLEH diklik otomatis. */
      finalTargets?: Target[] | undefined;
    }
  | { kind: 'upload'; target: Target; file: UploadFile }
  | { kind: 'rect'; target: Target }
  | { kind: 'check'; check: Check; baseline?: number | undefined }
  | { kind: 'wait'; check: Check; timeoutMs: number; baseline?: number | undefined }
  | { kind: 'count'; target: Target }
  | { kind: 'consent'; summary: ConsentSummary };

export type RunnerResult = { ok: true; value?: unknown } | { ok: false; code: string; message: string };

/** Kait halaman yang bergantung pada eksekutor (overlay consent hanya ada di ekstensi). */
export type RunnerHooks = {
  consent?: ((doc: Document, summary: ConsentSummary) => Promise<boolean>) | undefined;
};

export const RunnerCode = {
  ADAPTER_DRIFT: 'ADAPTER_DRIFT',
  WAIT_TIMEOUT: 'WAIT_TIMEOUT',
  FINAL_NOT_AUTOMATABLE: 'FINAL_NOT_AUTOMATABLE',
  UNSUPPORTED_OP: 'UNSUPPORTED_OP',
} as const;

const fail = (code: string, message: string): RunnerResult => ({ ok: false, code, message });
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const ROLE_SELECTORS: Record<string, string> = {
  button: 'button, input[type="button"], input[type="submit"], [role="button"]',
  link: 'a[href], [role="link"]',
  textbox:
    'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="search"], input[type="url"], input[type="number"], input[type="password"], textarea, [role="textbox"]',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
  combobox: 'select, [role="combobox"]',
  table: 'table, [role="table"]',
};

function accessibleName(el: Element): string {
  return norm(
    el.getAttribute('aria-label') ||
      (el as HTMLInputElement).value ||
      el.textContent ||
      el.getAttribute('title') ||
      '',
  );
}

function matchByName(els: Element[], name: string | undefined): Element[] {
  if (!name) return els;
  const want = norm(name);
  return els.filter((el) => accessibleName(el).includes(want));
}

const attr = (v: string) => v.replace(/["\\]/g, '\\$&');

function controlOfLabel(doc: Document, label: Element): Element | null {
  const forId = label.getAttribute('for');
  if (forId) return doc.getElementById(forId);
  return label.querySelector('input, select, textarea');
}

function safeQuery(root: ParentNode, css: string): Element[] {
  try {
    return [...root.querySelectorAll(css)];
  } catch {
    return [];
  }
}

function matchesOf(doc: Document, sel: Selector): Element[] {
  switch (sel.by) {
    case 'css':
      return safeQuery(doc, sel.value);
    case 'name':
      return safeQuery(doc, `[name="${attr(sel.value)}"]`);
    case 'role':
      return matchByName(
        safeQuery(doc, ROLE_SELECTORS[sel.value] ?? `[role="${attr(sel.value)}"]`),
        sel.name,
      );
    case 'label': {
      const want = norm(sel.value);
      return [...doc.querySelectorAll('label')]
        .filter((l) => norm(l.textContent).includes(want))
        .map((l) => controlOfLabel(doc, l))
        .filter((el): el is Element => el !== null);
    }
    case 'text': {
      const want = norm(sel.value);
      const all = [...(doc.body?.querySelectorAll('*') ?? [])].filter((el) =>
        norm(el.textContent).includes(want),
      );
      // elemen terdalam: tidak punya anak elemen yang juga memuat teks
      return all.filter((el) => ![...el.children].some((c) => all.includes(c)));
    }
  }
}

/** Rantai selector berlapis: selector pertama yang menemukan elemen menang. */
export function resolveAll(doc: Document, target: Target): Element[] {
  for (const sel of target) {
    const found = matchesOf(doc, sel);
    if (found.length > 0) return found;
  }
  return [];
}

export function resolveTarget(doc: Document, target: Target): Element | null {
  return resolveAll(doc, target)[0] ?? null;
}

export function evalCheck(doc: Document, check: Check, baseline?: number): boolean {
  switch (check.kind) {
    case 'urlIncludes':
      return (doc.defaultView?.location.href ?? '').includes(check.value);
    case 'textIncludes':
      return norm(doc.body?.textContent).includes(norm(check.value));
    case 'elementExists':
      return resolveTarget(doc, check.target) !== null;
    case 'countIncreased':
      return resolveAll(doc, check.target).length > (baseline ?? 0);
  }
}

function waitForCheck(
  doc: Document,
  check: Check,
  timeoutMs: number,
  baseline?: number,
): Promise<RunnerResult> {
  const win = doc.defaultView;
  return new Promise((resolve) => {
    if (evalCheck(doc, check, baseline)) return resolve({ ok: true });
    const finish = (r: RunnerResult) => {
      observer?.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      resolve(r);
    };
    const test = () => {
      if (evalCheck(doc, check, baseline)) finish({ ok: true });
    };
    const observer = win?.MutationObserver ? new win.MutationObserver(test) : undefined;
    observer?.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
    const poll = setInterval(test, 250);
    const timer = setTimeout(
      () => finish(fail(RunnerCode.WAIT_TIMEOUT, `kondisi tidak terpenuhi dalam ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
}

/** Isi field dengan cara aman untuk input terkontrol React: setter native + event bubbling. */
export function setNativeValue(el: Element, value: string): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  let proto: object;
  if (el instanceof win.HTMLTextAreaElement) proto = win.HTMLTextAreaElement.prototype;
  else if (el instanceof win.HTMLSelectElement) proto = win.HTMLSelectElement.prototype;
  else if (el instanceof win.HTMLInputElement) proto = win.HTMLInputElement.prototype;
  else return false;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return false;
  (el as HTMLElement).focus();
  setter.call(el, value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  return true;
}

function extractTable(table: Element): { headers: string[]; rows: string[][] } {
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const headerRow =
    table.querySelector('thead tr') ?? [...table.querySelectorAll('tr')].find((r) => r.querySelector('th'));
  const headers = headerRow ? [...headerRow.querySelectorAll('th, td')].map(text) : [];
  const rows = [...table.querySelectorAll('tr')]
    .filter((r) => r !== headerRow)
    .map((r) => [...r.querySelectorAll('td, th')].map(text))
    .filter((cells) => cells.length > 0);
  return { headers, rows };
}

/** True bila `el` sama dengan, memuat, atau dimuat oleh salah satu elemen khusus warga. */
function touchesHumanOnly(doc: Document, el: Element, finalTargets: Target[] | undefined): boolean {
  return (finalTargets ?? []).some((t) =>
    resolveAll(doc, t).some((f) => f === el || f.contains(el) || el.contains(f)),
  );
}

function uploadFile(doc: Document, target: Target, file: UploadFile): RunnerResult {
  const win = doc.defaultView;
  const el = resolveTarget(doc, target);
  if (!win || !el) return fail(RunnerCode.ADAPTER_DRIFT, 'field berkas tidak ditemukan');
  if (!(el instanceof win.HTMLInputElement) || el.type !== 'file')
    return fail(RunnerCode.ADAPTER_DRIFT, 'elemen bukan field berkas');
  const bin = win.atob(file.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new win.DataTransfer();
  dt.items.add(new win.File([bytes], file.name, { type: file.mime }));
  el.files = dt.files;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  return { ok: true };
}

function rectOf(doc: Document, target: Target): RunnerResult {
  const el = resolveTarget(doc, target);
  if (!el) return fail(RunnerCode.ADAPTER_DRIFT, 'target sorotan tidak ditemukan');
  el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  return { ok: true, value: { x: r.x, y: r.y, lebar: r.width, tinggi: r.height } };
}

function runStep(doc: Document, step: Step, finalTargets?: Target[]): RunnerResult {
  switch (step.op) {
    case 'fill':
    case 'select': {
      const el = resolveTarget(doc, step.target);
      if (!el) return fail(RunnerCode.ADAPTER_DRIFT, `field ${step.op} tidak ditemukan`);
      const isSelect = el.tagName === 'SELECT';
      if ((step.op === 'select' && !isSelect) || !setNativeValue(el, step.value))
        return fail(RunnerCode.ADAPTER_DRIFT, 'elemen bukan field isian yang sesuai');
      if (isSelect && (el as HTMLSelectElement).value !== step.value)
        return fail(RunnerCode.ADAPTER_DRIFT, 'pilihan tidak ada di daftar');
      return { ok: true };
    }
    case 'click': {
      // Pertahanan berlapis: `final` TIDAK PERNAH diklik otomatis (juga ditolak di service worker).
      if (step.effect === 'final') {
        return fail(RunnerCode.FINAL_NOT_AUTOMATABLE, 'klik final hanya boleh oleh warga');
      }
      const el = resolveTarget(doc, step.target);
      if (!el) return fail(RunnerCode.ADAPTER_DRIFT, 'target klik tidak ditemukan');
      // Elemen yang ditandai gate.human (tombol Kirim/Selesai) hanya boleh diklik warga, apa pun effect-nya.
      if (touchesHumanOnly(doc, el, finalTargets)) {
        return fail(RunnerCode.FINAL_NOT_AUTOMATABLE, 'elemen ini khusus ditekan warga');
      }
      (el as HTMLElement).click();
      return { ok: true };
    }
    case 'extract': {
      const el = resolveTarget(doc, step.target);
      if (!el) return fail(RunnerCode.ADAPTER_DRIFT, 'target extract tidak ditemukan');
      if (step.mode === 'table') {
        const table = el.tagName === 'TABLE' ? el : el.querySelector('table');
        if (!table) return fail(RunnerCode.ADAPTER_DRIFT, 'target extract bukan tabel');
        return { ok: true, value: extractTable(table) };
      }
      return { ok: true, value: (el.textContent ?? '').replace(/\s+/g, ' ').trim() };
    }
    default:
      return fail(RunnerCode.UNSUPPORTED_OP, `op "${step.op}" tidak dijalankan oleh step-runner`);
  }
}

/** Titik masuk tunggal runner. `nav` dan `gate.human` ditangani interpreter, bukan di sini. */
export async function runOp(
  op: RunnerOp,
  doc: Document = document,
  hooks: RunnerHooks = {},
): Promise<RunnerResult> {
  try {
    switch (op.kind) {
      case 'step':
        return runStep(doc, op.step, op.finalTargets);
      case 'upload':
        return uploadFile(doc, op.target, op.file);
      case 'rect':
        return rectOf(doc, op.target);
      case 'check':
        return { ok: true, value: evalCheck(doc, op.check, op.baseline) };
      case 'wait':
        return await waitForCheck(doc, op.check, op.timeoutMs, op.baseline);
      case 'count':
        return { ok: true, value: resolveAll(doc, op.target).length };
      case 'consent':
        if (!hooks.consent) return fail(RunnerCode.UNSUPPORTED_OP, 'consent tidak tersedia di eksekutor ini');
        return { ok: true, value: await hooks.consent(doc, op.summary) };
    }
  } catch (e) {
    return fail('RUNNER_ERROR', e instanceof Error ? e.message : String(e));
  }
}
