import type { Check, Selector, Step, Target } from '@urusin/core';
import type { HasilAksi as HasilAksiKontrak, KodeHasilAksi } from '@urusin/contracts';
import type { ConsentSummary, UploadFile } from './types.js';
import { bangunPengamatan, elemenDariJalur, sidikElemen, terlarangElemen, type PetaRef } from './amatan.js';
import {
  aktifEl,
  bolehDiklikAi,
  halamanAkhir,
  klasifikasi,
  normalTeks,
  terlihatEl,
  type FiturKendali,
  type KelasKendali,
} from './klasifikasi.js';

/**
 * Operasi step-runner yang berjalan DI DALAM halaman (world terisolasi ekstensi / isolated world CDP di
 * Browser Pendamping). Satu op per pemanggilan; hasil dilaporkan ke interpreter (rencana §3.5 butir 2).
 * WAJIB tanpa impor runtime selain modul saudara klasifikasi.ts dan amatan.ts (keduanya juga tanpa impor):
 * pendamping menggabungkan ketiganya menjadi satu skrip dan membuang baris impor relatif itu.
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
  | { kind: 'consent'; summary: ConsentSummary }
  /** Navigator generik: pengamatan halaman (tanpa nilai field) + peta ref untuk memori worker. */
  | { kind: 'amati'; seq: number; diisi?: Record<string, string> | undefined }
  /** Navigator generik: jalankan aksi satu per satu; `peta` = peta ref dari `amati` terakhir. */
  | { kind: 'aksi'; aksi: AksiRunner[]; peta: PetaRef }
  /**
   * Navigator generik: href tautan pembuka `ref` (dibaca ulang dari DOM) untuk dibuka worker lewat navigasi GET,
   * tanpa klik dan tanpa handler JS halaman. Hanya tautan yang masih kena aturan tautan pembuka, bukan di halaman
   * akhir.
   */
  | { kind: 'tautan'; ref: string; peta: PetaRef };

/**
 * Aksi yang sudah divalidasi web dan di-resolve worker. `nilai` pada isi/pilih adalah nilai vault yang sudah
 * di-resolve worker HANYA untuk pasangan (sidik ref, placeholder) yang disetujui warga; `placeholder` dibawa
 * untuk jejak. Nilai mentah tidak pernah muncul di hasil maupun pesan galat.
 */
export type AksiRunner =
  | { jenis: 'isi'; ref: string; placeholder: string; nilai: string }
  | { jenis: 'pilih'; ref: string; opsi: number }
  | { jenis: 'pilih'; ref: string; placeholder: string; nilai: string }
  | { jenis: 'centang'; ref: string; nilai: boolean }
  | { jenis: 'unggah'; ref: string; berkas: UploadFile }
  | { jenis: 'klik'; ref: string };

/**
 * Hasil per aksi untuk jejak audit (tanpa nilai). `ok` = dikerjakan; `navigasi` = klik tautan GET yang
 * dikembalikan ke worker (worker memeriksa allowlist lalu Page.navigate(href)); `ditolak` = dilarang aturan;
 * `gagal` = elemen tidak cocok/basi; `dilewati` = tidak dijalankan karena aksi sebelumnya berhenti.
 */
export type HasilAksi = {
  i: number;
  jenis: AksiRunner['jenis'];
  ref: string;
  status: 'ok' | 'navigasi' | 'ditolak' | 'gagal' | 'dilewati';
  /** Id aturan: K1..K11 (klasifikator) atau A_* (runner). */
  aturan: string;
  kode?: string;
  kelas?: KelasKendali;
  fitur?: FiturAudit;
  href?: string;
  placeholder?: string;
};

/** Fitur klik untuk audit: hanya struktur dan boolean, tanpa teks situs. */
export type FiturAudit = Omit<
  FiturKendali,
  'teksTampak' | 'ariaLabel' | 'nilai' | 'title' | 'idKelas' | 'ikon' | 'href'
> & { hrefHost: string };

export type HasilAksiOp = { hasil: HasilAksi[] };

/**
 * Hasil runner (rinci, untuk jejak audit) -> `HasilAksiSchema` kontrak (ringkas, untuk Navigator di web).
 * `navigasi` = ok dari sisi halaman; worker yang memutuskan blokir gerbang/allowlist (GERBANG_MEMBLOKIR).
 */
export function keHasilKontrak(h: HasilAksi): HasilAksiKontrak {
  const kode: KodeHasilAksi =
    h.status === 'ok' || h.status === 'navigasi'
      ? 'ok'
      : h.status === 'dilewati'
        ? 'DILEWATI'
        : h.kode === RunnerCode.REF_BASI
          ? 'REF_BASI'
          : h.kode === RunnerCode.REF_TIDAK_DIKENAL
            ? 'REF_TIDAK_ADA'
            : h.kode === RunnerCode.KLIK_DITOLAK
              ? 'KELAS_DITOLAK'
              : h.kode === RunnerCode.TERLARANG
                ? 'TERLARANG'
                : h.kode === RunnerCode.HALAMAN_AKHIR
                  ? 'HALAMAN_AKHIR'
                  : 'GALAT';
  return h.kelas ? { indeks: h.i, kode, kelas: h.kelas } : { indeks: h.i, kode };
}

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
  REF_BASI: 'REF_BASI',
  REF_TIDAK_DIKENAL: 'REF_TIDAK_DIKENAL',
  KLIK_DITOLAK: 'KLIK_DITOLAK',
  HALAMAN_AKHIR: 'HALAMAN_AKHIR',
  TERLARANG: 'TERLARANG',
  ELEMEN_TIDAK_SESUAI: 'ELEMEN_TIDAK_SESUAI',
  ELEMEN_NONAKTIF: 'ELEMEN_NONAKTIF',
  OPSI_TIDAK_ADA: 'OPSI_TIDAK_ADA',
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
  return pasangBerkas(win, el, file);
}

function pasangBerkas(win: Window & typeof globalThis, el: Element, file: UploadFile): RunnerResult {
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
  const teks = labelTombol(el);
  return { ok: true, value: { x: r.x, y: r.y, lebar: r.width, tinggi: r.height, ...(teks ? { teks } : {}) } };
}

/**
 * Nama tombol/tautan yang terlihat warga (teks, `value` input tombol, atau aria-label), agar teks giliran
 * menyebut tombol yang benar-benar ada di halaman. Lebih dari 40 karakter = bukan nama tombol, dilewati.
 */
function labelTombol(el: Element): string | undefined {
  const rapikan = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
  const teks =
    rapikan(el.textContent) ||
    (el.tagName === 'INPUT' ? rapikan((el as HTMLInputElement).value) : '') ||
    rapikan(el.getAttribute('aria-label'));
  return teks && teks.length <= 40 ? teks : undefined;
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

// --- Navigator generik: op `aksi` ---

type Putusan = Omit<HasilAksi, 'i' | 'jenis' | 'ref'>;

const tolak = (status: 'ditolak' | 'gagal', aturan: string, kode: string): Putusan => ({
  status,
  aturan,
  kode,
});

function fiturAudit(f: FiturKendali): FiturAudit {
  const { teksTampak: _t, ariaLabel: _a, nilai: _n, title: _ti, idKelas: _i, ikon: _ik, href, ...sisa } = f;
  return { ...sisa, hrefHost: href.host };
}

/** Elemen dari peta ref, dengan verifikasi sidik di DOM saat ini. */
function elemenRef(doc: Document, peta: PetaRef, ref: string): Element | Putusan {
  const simpan = peta[ref];
  if (!simpan) return tolak('gagal', 'A_REF_TIDAK_DIKENAL', RunnerCode.REF_TIDAK_DIKENAL);
  const el = elemenDariJalur(doc, simpan.jalur);
  if (!el || sidikElemen(el) !== simpan.sidik) return tolak('gagal', 'A_REF_BASI', RunnerCode.REF_BASI);
  return el;
}

function bisaDiubah(el: Element): boolean {
  return terlihatEl(el) && aktifEl(el) && !(el as HTMLInputElement).readOnly;
}

const TIPE_ISI = /^(text|email|tel|search|url|number|date|datetime-local|month|week|time)$/;

function kerjakanIsi(el: Element, nilai: string): Putusan {
  const tipe = el.tagName === 'INPUT' ? (el as HTMLInputElement).type : '';
  if (!(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TIPE_ISI.test(tipe))))
    return tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
  if (!setNativeValue(el, nilai)) return tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
  return { status: 'ok', aturan: 'A_OK' };
}

function kerjakanPilih(el: Element, a: Extract<AksiRunner, { jenis: 'pilih' }>): Putusan {
  const win = el.ownerDocument.defaultView;
  if (!win) return tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
  if (el instanceof win.HTMLSelectElement) {
    const opsi = [...el.options];
    const ke =
      'opsi' in a
        ? a.opsi
        : opsi.findIndex((o) => o.value === a.nilai || normalTeks(o.text) === normalTeks(a.nilai));
    const o = opsi[ke];
    if (!o || o.disabled) return tolak('gagal', 'A_OPSI_TIDAK_ADA', RunnerCode.OPSI_TIDAK_ADA);
    setNativeValue(el, o.value);
    if (el.selectedIndex !== ke) {
      el.selectedIndex = ke;
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
    return { status: 'ok', aturan: 'A_OK' };
  }
  if (el instanceof win.HTMLInputElement && el.type === 'radio') {
    const grup = [...(el.form ?? el.ownerDocument).querySelectorAll('input[type="radio"]')].filter(
      (r): r is HTMLInputElement =>
        r instanceof win.HTMLInputElement && r.name === el.name && r.form === el.form && terlihatEl(r),
    );
    const anggota = el.name ? grup : [el];
    const r =
      'opsi' in a
        ? anggota[a.opsi]
        : anggota.find(
            (x) => x.value === a.nilai || normalTeks(x.labels?.[0]?.textContent) === normalTeks(a.nilai),
          );
    if (!r || !aktifEl(r)) return tolak('gagal', 'A_OPSI_TIDAK_ADA', RunnerCode.OPSI_TIDAK_ADA);
    if (!r.checked) r.click();
    return r.checked
      ? { status: 'ok', aturan: 'A_OK' }
      : tolak('gagal', 'A_TIDAK_BERUBAH', RunnerCode.ELEMEN_NONAKTIF);
  }
  return tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
}

function kerjakanCentang(el: Element, nilai: boolean): Putusan {
  const win = el.ownerDocument.defaultView;
  if (!win || !(el instanceof win.HTMLInputElement) || el.type !== 'checkbox')
    return tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
  if (el.checked !== nilai) el.click();
  return el.checked === nilai
    ? { status: 'ok', aturan: 'A_OK' }
    : tolak('gagal', 'A_TIDAK_BERUBAH', RunnerCode.ELEMEN_NONAKTIF);
}

/**
 * Klik AI: klasifikasi DIJALANKAN ULANG di tugas JS yang sama tepat sebelum klik (tanpa await di antaranya),
 * sehingga halaman tidak sempat mengganti tombol di antara pemeriksaan dan klik.
 */
function kerjakanKlik(doc: Document, el: Element): Putusan {
  if (halamanAkhir(doc)) return tolak('ditolak', 'A_HALAMAN_AKHIR', RunnerCode.HALAMAN_AKHIR);
  const k = klasifikasi(el, false);
  const dasar = { kelas: k.kelas, fitur: fiturAudit(k.fitur) };
  if (!bolehDiklikAi(k.kelas)) return { ...dasar, ...tolak('ditolak', k.aturan, RunnerCode.KLIK_DITOLAK) };
  if (k.kelas === 'navigasi') {
    // Bukan el.click(): worker memeriksa allowlist lalu Page.navigate(href) (tanpa popup/target=_blank).
    return { ...dasar, status: 'navigasi', aturan: k.aturan, href: (el as HTMLAnchorElement).href };
  }
  (el as HTMLElement).click();
  return { ...dasar, status: 'ok', aturan: k.aturan };
}

function satuAksi(doc: Document, a: AksiRunner, peta: PetaRef): Putusan {
  const el = elemenRef(doc, peta, a.ref);
  if (!(el instanceof Element)) return el;
  if (a.jenis === 'klik') return kerjakanKlik(doc, el);
  // Aksi tulis: field harus terlihat, aktif, tidak readonly, dan tidak terlarang (sandi/OTP/CAPTCHA/pernyataan).
  if (!bisaDiubah(el)) return tolak('gagal', 'A_NONAKTIF', RunnerCode.ELEMEN_NONAKTIF);
  // Penanda terlarang dihitung ulang dari DOM saat ini, bukan dari pengamatan yang bisa basi.
  if (terlarangElemen(el)) return tolak('ditolak', 'A_TERLARANG', RunnerCode.TERLARANG);
  switch (a.jenis) {
    case 'isi':
      return kerjakanIsi(el, a.nilai);
    case 'pilih':
      return kerjakanPilih(el, a);
    case 'centang':
      return kerjakanCentang(el, a.nilai);
    case 'unggah': {
      const win = doc.defaultView;
      if (!win) return tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
      const r = pasangBerkas(win, el, a.berkas);
      return r.ok
        ? { status: 'ok', aturan: 'A_OK' }
        : tolak('gagal', 'A_JENIS_ELEMEN', RunnerCode.ELEMEN_TIDAK_SESUAI);
    }
  }
}

/** Aturan klasifikasi tautan pembuka (amatan `tautanPembuka`). */
const ATURAN_PEMBUKA = new Set(['K7_NEG_NAMA_TAUTAN', 'K7_NEG_IKON_TAUTAN']);

/** Href tautan pembuka yang masih sama di DOM (sidik), diklasifikasi ulang di tugas JS yang sama. */
export function hrefTautanPembuka(doc: Document, ref: string, peta: PetaRef): RunnerResult {
  const el = elemenRef(doc, peta, ref);
  if (!(el instanceof Element)) return fail(el.kode ?? RunnerCode.REF_BASI, 'ref tidak cocok');
  if (halamanAkhir(doc)) return fail(RunnerCode.HALAMAN_AKHIR, 'halaman akhir');
  const win = doc.defaultView;
  if (!win || !(el instanceof win.HTMLAnchorElement) || !el.href || !terlihatEl(el))
    return fail(RunnerCode.ELEMEN_TIDAK_SESUAI, 'bukan tautan');
  if (!ATURAN_PEMBUKA.has(klasifikasi(el, false).aturan))
    return fail(RunnerCode.KLIK_DITOLAK, 'bukan tautan pembuka');
  return { ok: true, value: { href: el.href } };
}

/**
 * Jalankan aksi berurutan. Berhenti pada aksi pertama yang tidak `ok` (sisanya `dilewati`), setelah
 * `navigasi`, dan setelah klik `lanjut` (halaman kemungkinan berganti; amati ulang dulu).
 */
export function jalankanAksi(doc: Document, aksi: AksiRunner[], peta: PetaRef): HasilAksiOp {
  const hasil: HasilAksi[] = [];
  let berhenti = false;
  aksi.forEach((a, i) => {
    const dasar = { i, jenis: a.jenis, ref: a.ref };
    if (berhenti) {
      hasil.push({ ...dasar, status: 'dilewati', aturan: 'A_DILEWATI' });
      return;
    }
    let p: Putusan;
    try {
      p = satuAksi(doc, a, peta);
    } catch {
      // Pesan galat asli sengaja dibuang: bisa memuat nilai.
      p = tolak('gagal', 'A_GALAT', 'RUNNER_ERROR');
    }
    const h: HasilAksi = { ...dasar, ...p };
    if ('placeholder' in a) h.placeholder = a.placeholder;
    hasil.push(h);
    if (p.status !== 'ok' || p.kelas === 'lanjut') berhenti = true;
  });
  return { hasil };
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
      case 'amati':
        return { ok: true, value: bangunPengamatan(doc, { seq: op.seq, diisi: op.diisi }) };
      case 'tautan':
        return hrefTautanPembuka(doc, op.ref, op.peta);
      case 'aksi':
        return { ok: true, value: jalankanAksi(doc, op.aksi, op.peta) };
    }
  } catch (e) {
    return fail('RUNNER_ERROR', e instanceof Error ? e.message : String(e));
  }
}
