import {
  aktifEl,
  centangDataAman,
  checkboxPernyataan,
  halamanAkhir,
  klasifikasi,
  normalTeks,
  teksTampakDari,
  terlihatEl,
} from './klasifikasi.js';
import type {
  ElemenAmatan,
  Pengamatan,
  PeranElemen as PeranElemenKontrak,
  SinyalHalaman,
  Terlarang,
} from '@urusin/contracts';

/**
 * Pembangun pengamatan (Pengamatan) untuk Navigator generik (desain generik §1, invarian 4).
 * Disuntikkan ke halaman bersama klasifikasi.ts dan runner-ops.ts (satu cakupan, impor relatif dibuang saat
 * dibungkus): fungsi murni atas DOM, tanpa impor lain, nama tingkat atas tidak boleh bentrok.
 *
 * Aturan keras: `.value` field TIDAK PERNAH diserialisasi. Nilai hanya dibaca di memori untuk menentukan
 * `isian` (kosong/terisi_situs/terisi_warga/placeholder) dan untuk menyamarkan gema nilai di teks situs.
 */

// --- Tipe kontrak dari @urusin/contracts (WP-D); hanya `import type`, tidak ada impor runtime di halaman ---
export type PeranElemen = PeranElemenKontrak;
export type TerlarangElemen = Terlarang;
/** `kosong` | `terisi_situs` | `terisi_warga` | placeholder vault (`{{PEMOHON.NIK}}`). Bukan nilai mentah. */
export type IsianElemen = NonNullable<ElemenAmatan['isian']>;
export type SinyalAmatan = SinyalHalaman;
export type { ElemenAmatan, Pengamatan };

/** Entri peta ref: disimpan di memori worker, TIDAK PERNAH ditulis ke DOM. */
export type RefTersimpan = { jalur: string; sidik: string };
export type PetaRef = Record<string, RefTersimpan>;

export type OpsiAmati = {
  seq: number;
  /** sidik elemen -> placeholder yang sudah diisi worker (pasangan yang disetujui warga). */
  diisi?: Record<string, string> | undefined;
};

export type HasilAmati = { pengamatan: Pengamatan; peta: PetaRef };

export const BATAS_AMATAN = {
  elemen: 150,
  nama: 120,
  petunjuk: 120,
  galat: 120,
  opsi: 40,
  panjangOpsi: 80,
  teks: 2500,
  judul: 120,
  jalur: 200,
  /** Nilai lebih pendek dari ini tidak disamarkan dari teks (terlalu umum). */
  nilaiSamar: 3,
} as const;

const SEL_KANDIDAT = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="textbox"]',
].join(', ');

const RE_OTP =
  /\botp\b|one.?time|kode (verifikasi|otp|sms|wa|whatsapp|aktivasi)|verification code|\btoken\b|\bpin\b/;
const RE_CAPTCHA =
  /captcha|kode (keamanan|gambar|unik|pengaman)|security code|ketik(kan)? (kode|karakter|teks|huruf|angka)|kode (di|pada) gambar/;
const SEL_CAPTCHA =
  'img[src*="captcha" i], img[alt*="captcha" i], img[id*="captcha" i], img[class*="captcha" i], .g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]';
const SEL_TANTANGAN =
  '#challenge-form, #cf-challenge-running, .cf-browser-verification, #challenge-running, .cf-turnstile, iframe[src*="challenges.cloudflare.com"], script[src*="/cdn-cgi/challenge-platform/"]';
const RE_JUDUL_TANTANGAN = /^(just a moment|sebentar|attention required|checking your browser|one more step)/;
const SEL_GALAT =
  '.invalid-feedback, .error, .errors, .text-danger, .field-error, .form-error, .error-message, .help-block, [role="alert"], .alert-danger, .has-error, .is-invalid';
const RE_SUKSES = [
  /(nomor|no\.?) ?(registrasi|pendaftaran|permohonan|antrian|antrean|tiket|pengajuan|resi|tanda terima|bukti)\s*[:#]?\s*[a-z0-9][a-z0-9/-]{3,}/,
  /(berhasil|sukses) (dikirim|diajukan|disimpan|terkirim|didaftarkan|terdaftar|mendaftar)/,
  /(permohonan|pengajuan|pendaftaran) (anda )?(telah |sudah )?(berhasil|diterima|terkirim)/,
  /bukti (pendaftaran|pengajuan|permohonan)/,
];

/** Hash struktural cyrb53 (heksadesimal, 14 digit). Bukan kriptografis: hanya sidik perubahan struktur. */
export function hashTeks(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Jalur CSS `nth-of-type` dari <html> ke elemen. Hanya struktur, tanpa id/kelas/atribut. */
export function jalurCss(el: Element): string {
  const bagian: string[] = [];
  for (let e: Element | null = el; e && e.parentElement; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    let ke = 1;
    for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) ke++;
    bagian.unshift(`${tag}:nth-of-type(${ke})`);
  }
  bagian.unshift('html');
  return bagian.join(' > ');
}

export function elemenDariJalur(doc: Document, jalur: string): Element | null {
  try {
    return doc.querySelector(jalur);
  } catch {
    return null;
  }
}

function potong(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function tipeInput(el: Element): string {
  return el.tagName === 'INPUT' ? (el as HTMLInputElement).type : '';
}

/** Peran observasi elemen, atau null bila tidak diamati (hidden, range, dsb.). */
export function peranDari(el: Element): PeranElemen | null {
  const role = el.getAttribute('role');
  if (role === 'tab') return 'tab';
  switch (el.tagName) {
    case 'INPUT':
      switch (tipeInput(el)) {
        case 'text':
        case 'email':
        case 'tel':
        case 'search':
        case 'url':
        case 'password':
          return 'teks';
        case 'number':
          return 'angka';
        case 'date':
        case 'datetime-local':
        case 'month':
        case 'week':
        case 'time':
          return 'tanggal';
        case 'checkbox':
          return 'centang';
        case 'radio':
          return 'radio';
        case 'file':
          return 'berkas';
        case 'submit':
        case 'button':
        case 'reset':
        case 'image':
          return 'tombol';
        default:
          return null;
      }
    case 'TEXTAREA':
      return 'area';
    case 'SELECT':
      return 'pilihan';
    case 'BUTTON':
    case 'SUMMARY':
      return 'tombol';
    case 'A':
      return role === 'button' ? 'tombol' : 'tautan';
  }
  switch (role) {
    case 'button':
      return 'tombol';
    case 'link':
      return 'tautan';
    case 'checkbox':
      return 'centang';
    case 'radio':
      return 'radio';
    case 'combobox':
      return 'pilihan';
    case 'textbox':
      return 'area';
  }
  return null;
}

function teksId(doc: Document, ids: string): string {
  return ids
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => {
      const t = doc.getElementById(id);
      return t ? teksTampakDari(t) : '';
    })
    .join(' ');
}

function labelUntuk(el: Element): string {
  const doc = el.ownerDocument;
  const bagian: string[] = [];
  const id = el.id;
  if (id) for (const l of doc.querySelectorAll('label')) if (l.htmlFor === id) bagian.push(teksTampakDari(l));
  const pembungkus = el.closest('label');
  if (pembungkus) bagian.push(teksTampakDari(pembungkus));
  return bagian.join(' ');
}

/** Teks di dekat field tanpa label: sel tabel sebelumnya, atau saudara sebelumnya yang pendek. */
function teksTetangga(el: Element): string {
  const sel = el.closest('td, th');
  if (sel) {
    const kiri = sel.previousElementSibling;
    if (kiri) return teksTampakDari(kiri);
  }
  for (let e: Element | null = el; e && e !== el.ownerDocument.body; e = e.parentElement) {
    const s = e.previousElementSibling;
    if (s) {
      if (s.matches('input, select, textarea, button')) return '';
      const t = normalTeks(teksTampakDari(s));
      return t.length <= 80 ? t : '';
    }
  }
  return '';
}

function bersihNama(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*\*\s*$/, '')
    .trim();
}

/** Nama aksesibel (perkiraan): aria-labelledby, aria-label, label, teks tombol, title, placeholder, tetangga. */
export function namaAksesibel(el: Element): { nama: string; dariPlaceholder: boolean } {
  const doc = el.ownerDocument;
  const coba = (s: string | null | undefined) => bersihNama(s ?? '');
  const lby = el.getAttribute('aria-labelledby');
  let n = lby ? coba(teksId(doc, lby)) : '';
  if (!n) n = coba(el.getAttribute('aria-label'));
  const peran = peranDari(el);
  const kendaliIsi = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  if (!n && kendaliIsi && !/^(submit|button|reset|image)$/.test(tipeInput(el))) n = coba(labelUntuk(el));
  if (!n && (peran === 'tombol' || peran === 'tautan' || peran === 'tab')) {
    const t = tipeInput(el);
    if (t === 'image') n = coba(el.getAttribute('alt'));
    // Label tombol input adalah atribut value-nya (teks situs), bukan isian warga.
    else if (t === 'submit' || t === 'button' || t === 'reset') n = coba(el.getAttribute('value') ?? '');
    else n = coba(teksTampakDari(el));
  }
  if (!n) n = coba(el.getAttribute('title'));
  if (!n && kendaliIsi) {
    const ph = coba(el.getAttribute('placeholder'));
    if (ph) return { nama: ph, dariPlaceholder: true };
    n = coba(teksTetangga(el));
  }
  return { nama: n, dariPlaceholder: false };
}

function wajibDari(el: Element): boolean {
  if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') return true;
  return /\*\s*$/.test(labelUntuk(el).trim());
}

function petunjukDari(el: Element, dariPlaceholder: boolean): string {
  const doc = el.ownerDocument;
  const bagian: string[] = [];
  if (!dariPlaceholder) bagian.push(el.getAttribute('placeholder') ?? '');
  const desc = el.getAttribute('aria-describedby');
  if (desc) bagian.push(teksId(doc, desc));
  return bersihNama(bagian.filter(Boolean).join(' · '));
}

function galatDari(el: Element): string {
  const doc = el.ownerDocument;
  const errId = el.getAttribute('aria-errormessage');
  if (errId) {
    const t = doc.getElementById(errId);
    if (t && terlihatEl(t)) return bersihNama(teksTampakDari(t));
  }
  // Pesan galat situs di dekat field (Bootstrap .invalid-feedback, .text-danger, dsb.), maks. 2 tingkat ke atas.
  let wadah: Element | null = el.parentElement;
  for (let i = 0; i < 2 && wadah; i++, wadah = wadah.parentElement) {
    if (wadah.querySelectorAll('input, select, textarea').length > 1) break;
    for (const g of wadah.querySelectorAll(SEL_GALAT)) {
      if (g.contains(el) || !terlihatEl(g)) continue;
      const t = bersihNama(teksTampakDari(g));
      if (t) return t;
    }
  }
  return '';
}

function formDari(el: Element): string | undefined {
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (!form) return undefined;
  const i = [...el.ownerDocument.querySelectorAll('form')].indexOf(form);
  return i >= 0 && i <= 99 ? `f${i}` : undefined;
}

function terlarangDari(el: Element, nama: string, petunjuk: string): TerlarangElemen | undefined {
  const t = tipeInput(el);
  if (t === 'password') return 'sandi';
  const peran = peranDari(el);
  // Centang default tolak: hanya opsi data yang dikenal (bukan pernyataan/persetujuan) yang boleh disentuh AI.
  if (peran === 'centang')
    return checkboxPernyataan(el, nama) || !centangDataAman(nama) ? 'pernyataan' : undefined;
  if (peran !== 'teks' && peran !== 'angka' && peran !== 'area' && peran !== 'pilihan') return undefined;
  const cari = normalTeks(
    [nama, petunjuk, el.id, el.getAttribute('name') ?? '', el.getAttribute('class') ?? ''].join(' '),
  );
  if (el.getAttribute('autocomplete') === 'one-time-code' || RE_OTP.test(cari)) return 'otp';
  if (RE_CAPTCHA.test(cari)) return 'captcha';
  // Field di sebelah gambar CAPTCHA (wadah dekat yang hanya berisi satu field).
  let wadah: Element | null = el.parentElement;
  for (let i = 0; i < 3 && wadah; i++, wadah = wadah.parentElement) {
    if (wadah.querySelectorAll('input:not([type="hidden"]), select, textarea').length > 1) break;
    if (wadah.querySelector(SEL_CAPTCHA)) return 'captcha';
  }
  return undefined;
}

/** Penanda terlarang elemen dari DOM saat ini (dipakai ulang op `aksi` tepat sebelum menulis). */
export function terlarangElemen(el: Element): TerlarangElemen | undefined {
  const { nama, dariPlaceholder } = namaAksesibel(el);
  return terlarangDari(el, nama, petunjukDari(el, dariPlaceholder));
}

type KontrolNilai = HTMLInputElement | HTMLTextAreaElement;

/** Status isian tanpa pernah mengeluarkan nilai. */
function isianDari(el: Element, sidik: string, diisi: Record<string, string>): IsianElemen | undefined {
  const peran = peranDari(el);
  const placeholder = diisi[sidik];
  if (peran === 'teks' || peran === 'angka' || peran === 'tanggal' || peran === 'area') {
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')
      return normalTeks(el.textContent) ? 'terisi_warga' : 'kosong';
    const k = el as KontrolNilai;
    if (k.value === '') return 'kosong';
    if (placeholder && tipeInput(el) !== 'password') return placeholder;
    return k.value === k.defaultValue ? 'terisi_situs' : 'terisi_warga';
  }
  if (peran === 'pilihan' && el.tagName === 'SELECT') {
    const s = el as HTMLSelectElement;
    if (s.value === '') return 'kosong';
    if (placeholder) return placeholder;
    const opsi = [...s.options];
    // Tanpa `selected` bawaan, peramban memilih opsi pertama: itu pilihan situs, bukan warga.
    const bawaan = opsi.some((o) => o.defaultSelected)
      ? opsi.every((o) => o.selected === o.defaultSelected)
      : s.selectedIndex === 0;
    return bawaan ? 'terisi_situs' : 'terisi_warga';
  }
  if (peran === 'centang' && el.tagName !== 'INPUT') {
    return el.getAttribute('aria-checked') === 'true' ? 'terisi_warga' : 'kosong';
  }
  if (peran === 'centang' && el.tagName === 'INPUT') {
    const c = el as HTMLInputElement;
    if (!c.checked) return 'kosong';
    return c.defaultChecked ? 'terisi_situs' : 'terisi_warga';
  }
  if (peran === 'berkas' && el.tagName === 'INPUT') {
    return ((el as HTMLInputElement).files?.length ?? 0) > 0 ? 'terisi_warga' : 'kosong';
  }
  return undefined;
}

function grupRadio(el: HTMLInputElement): HTMLInputElement[] {
  if (!el.name) return [el];
  const akar = el.form ?? el.ownerDocument;
  return [...akar.querySelectorAll('input[type="radio"]')].filter(
    (r): r is HTMLInputElement =>
      (r as HTMLInputElement).name === el.name && (r as HTMLInputElement).form === el.form,
  );
}

function namaGrupRadio(grup: HTMLInputElement[]): string {
  const pertama = grup[0];
  if (!pertama) return '';
  const set = pertama.closest('fieldset, [role="radiogroup"]');
  if (set) {
    const legend = set.querySelector('legend');
    const n = bersihNama(set.getAttribute('aria-label') ?? (legend ? teksTampakDari(legend) : ''));
    if (n) return n;
  }
  const wadah = pertama.parentElement?.closest('div, td, li, p') ?? null;
  return bersihNama(wadah ? teksTetangga(wadah) : '') || bersihNama(teksTetangga(pertama));
}

/** Sidik elemen = hash(peran + nama + atribut name + form). Dipakai untuk REF_BASI dan ikat ulang. */
export function sidikDari(peran: string, nama: string, name: string, form: string | undefined): string {
  return hashTeks([peran, normalTeks(nama), name, form ?? ''].join('|'));
}

/** Sidik elemen dari DOM saat ini (dihitung ulang saat aksi untuk deteksi REF_BASI). */
export function sidikElemen(el: Element): string {
  const peran = peranDari(el) ?? '';
  const nama =
    peran === 'radio' && el.tagName === 'INPUT'
      ? namaGrupRadio(grupRadio(el as HTMLInputElement))
      : namaAksesibel(el).nama;
  return sidikDari(peran, nama, el.getAttribute('name') ?? '', formDari(el));
}

/** Nilai field teks saat ini (memori saja) untuk menyamarkan gema nilai di teks situs. */
function nilaiUntukDisamarkan(doc: Document): string[] {
  const hasil = new Set<string>();
  for (const el of doc.querySelectorAll('input, textarea')) {
    const t = tipeInput(el);
    if (
      el.tagName === 'INPUT' &&
      /^(checkbox|radio|submit|button|reset|image|file|hidden|range|color)$/.test(t)
    )
      continue;
    // Nilai saat ini DAN nilai bawaan situs (prefill profil bisa berupa data warga).
    for (const mentah of [(el as KontrolNilai).value, (el as KontrolNilai).defaultValue]) {
      const v = mentah.trim();
      if (v.length >= BATAS_AMATAN.nilaiSamar) hasil.add(v);
    }
  }
  // Yang terpanjang lebih dulu supaya nilai yang memuat nilai lain tersamarkan utuh.
  return [...hasil].sort((a, b) => b.length - a.length);
}

/** Ganti setiap gema nilai field (tanpa peduli huruf besar/kecil) dengan •••. */
function samarkan(s: string, nilai: string[]): string {
  let t = s;
  for (const v of nilai) {
    const kecil = v.toLowerCase();
    let i = t.toLowerCase().indexOf(kecil);
    while (i >= 0) {
      t = t.slice(0, i) + '•••' + t.slice(i + v.length);
      i = t.toLowerCase().indexOf(kecil, i + 3);
    }
  }
  return t;
}

function teksPenting(doc: Document): string[] {
  const hasil: string[] = [];
  const sudah = new Set<string>();
  for (const el of doc.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, [role="heading"], [role="alert"], [role="status"], .alert, .alert-danger, .alert-warning, .alert-success, .invalid-feedback',
  )) {
    if (!terlihatEl(el)) continue;
    const t = teksTampakDari(el).replace(/\s+/g, ' ').trim();
    if (t && !sudah.has(t)) {
      sudah.add(t);
      hasil.push(t);
    }
  }
  return hasil;
}

type Calon = { el: Element; peran: PeranElemen; urut: number; grup?: HTMLInputElement[] };

function kumpulkanCalon(doc: Document): Calon[] {
  const calon: Calon[] = [];
  const radioSudah = new Set<Element>();
  let urut = 0;
  for (const el of doc.querySelectorAll(SEL_KANDIDAT)) {
    urut++;
    const peran = peranDari(el);
    if (!peran || radioSudah.has(el)) continue;
    if (peran === 'radio' && el.tagName === 'INPUT') {
      const grup = grupRadio(el as HTMLInputElement).filter((r) => terlihatEl(r));
      for (const r of grup) radioSudah.add(r);
      if (!terlihatEl(el) || grup.length === 0) continue;
      calon.push({ el, peran, urut, grup });
      continue;
    }
    if (!terlihatEl(el)) continue;
    calon.push({ el, peran, urut });
  }
  // Batas 150: kendali formulir dan tombol didahulukan, sisa kuota untuk tautan (menu situs bisa ratusan).
  if (calon.length <= BATAS_AMATAN.elemen) return calon;
  const bukanTautan = calon.filter((c) => c.peran !== 'tautan').slice(0, BATAS_AMATAN.elemen);
  const tautan = calon.filter((c) => c.peran === 'tautan').slice(0, BATAS_AMATAN.elemen - bukanTautan.length);
  return [...bukanTautan, ...tautan].sort((a, b) => a.urut - b.urut);
}

function deteksiTantangan(doc: Document): boolean {
  if (doc.querySelector(SEL_TANTANGAN)) return true;
  return RE_JUDUL_TANTANGAN.test(normalTeks(doc.title));
}

/** Bangun Pengamatan + peta ref untuk halaman saat ini. Tidak mengubah DOM. */
export function bangunPengamatan(doc: Document, opsi: OpsiAmati): HasilAmati {
  const diisi = opsi.diisi ?? {};
  const samar = nilaiUntukDisamarkan(doc);
  const bersih = (s: string, n: number) => potong(samarkan(s, samar), n);
  const akhir = halamanAkhir(doc);
  const elemen: ElemenAmatan[] = [];
  const peta: PetaRef = {};
  let adaOtp = false;
  let adaCaptcha = false;
  let adaGalat = false;

  kumpulkanCalon(doc).forEach((c, i) => {
    const { el, peran } = c;
    const ref = `e${i + 1}`;
    const name = el.getAttribute('name') ?? '';
    const form = formDari(el);
    let nama: string;
    let petunjuk = '';
    if (c.grup) {
      nama = namaGrupRadio(c.grup);
    } else {
      const na = namaAksesibel(el);
      nama = na.nama;
      petunjuk = petunjukDari(el, na.dariPlaceholder);
    }
    const sidik = sidikDari(peran, nama, name, form);
    peta[ref] = { jalur: jalurCss(el), sidik };

    const e: ElemenAmatan = { ref, peran, nama: bersih(nama, BATAS_AMATAN.nama) };
    if (petunjuk) e.petunjuk = bersih(petunjuk, BATAS_AMATAN.petunjuk);
    if (form) e.form = form;
    if (peran === 'tombol' || peran === 'tautan' || peran === 'tab') {
      const k = klasifikasi(el, akhir);
      e.kelas = k.kelas;
      if (peran === 'tautan' && k.aturan === 'K7_NEG_NAMA_TAUTAN') e.sebabKelas = 'nama_tautan';
    } else {
      if (c.grup ? c.grup.some((r) => wajibDari(r)) : wajibDari(el)) e.wajib = true;
      const terlarang = terlarangDari(el, nama, petunjuk);
      if (terlarang) {
        e.terlarang = terlarang;
        if (terlarang === 'otp') adaOtp = true;
        if (terlarang === 'captcha') adaCaptcha = true;
      }
      if (c.grup) {
        const tercentang = c.grup.find((r) => r.checked);
        e.isian = !tercentang ? 'kosong' : tercentang.defaultChecked ? 'terisi_situs' : 'terisi_warga';
        e.opsi = c.grup
          .slice(0, BATAS_AMATAN.opsi)
          .map((r) => bersih(namaAksesibel(r).nama, BATAS_AMATAN.panjangOpsi));
      } else {
        const isian = isianDari(el, sidik, diisi);
        if (isian) e.isian = isian;
        if (el.tagName === 'SELECT') {
          e.opsi = [...(el as HTMLSelectElement).options]
            .slice(0, BATAS_AMATAN.opsi)
            .map((o) => bersih(normalTeks(teksTampakDari(o) || o.label), BATAS_AMATAN.panjangOpsi));
        }
      }
      const galat = galatDari(el);
      if (galat || el.getAttribute('aria-invalid') === 'true') adaGalat = true;
      if (galat) e.galat = bersih(galat, BATAS_AMATAN.galat);
      if (!aktifEl(el) && !e.galat)
        e.petunjuk = potong([e.petunjuk, 'nonaktif'].filter(Boolean).join(' · '), 120);
    }
    elemen.push(e);
  });

  const win = doc.defaultView;
  const teksDaftar = teksPenting(doc);
  const teks = bersih(teksDaftar.join('\n'), BATAS_AMATAN.teks);
  const teksNormal = normalTeks(teksDaftar.join(' ') + ' ' + (doc.body ? teksTampakDari(doc.body) : ''));
  const login = [...doc.querySelectorAll('input[type="password"]')].some((p) => terlihatEl(p));
  const sinyal: SinyalAmatan = {
    login,
    otp: adaOtp,
    captcha: adaCaptcha || [...doc.querySelectorAll(SEL_CAPTCHA)].some((c) => terlihatEl(c)),
    tantangan: deteksiTantangan(doc),
    halamanAkhir: akhir,
    sukses: RE_SUKSES.some((re) => re.test(teksNormal)),
    galatForm:
      adaGalat ||
      [...doc.querySelectorAll('[aria-invalid="true"], .alert-danger, .is-invalid, .has-error')].some((g) =>
        terlihatEl(g),
      ),
  };
  const host = win?.location.host ?? '';
  const pathname = win?.location.pathname ?? '';
  // Kontrak: jalur selalu path absolut tanpa query/fragmen (about:blank dan sejenisnya -> '/').
  const jalur = potong(pathname.startsWith('/') ? pathname : '/', BATAS_AMATAN.jalur);
  const sidik = hashTeks(
    [
      host,
      jalur,
      elemen.map((e) => [e.peran, normalTeks(e.nama), e.form, e.kelas, e.isian, e.galat].join('|')).join(';'),
      Object.values(sinyal).map(Number).join(''),
      hashTeks(teks),
    ].join('#'),
  );
  return {
    pengamatan: {
      v: 1,
      seq: opsi.seq,
      host,
      jalur,
      judul: bersih(doc.title.replace(/\s+/g, ' ').trim(), BATAS_AMATAN.judul),
      sinyal,
      elemen,
      teks,
      sidik,
    },
    peta,
  };
}

/**
 * Ikat ulang ref lama ke ref di pengamatan baru berdasarkan sidik (tanpa LLM) setelah REF_BASI.
 * Null bila sidik tidak ditemukan atau ambigu (lebih dari satu elemen dengan sidik yang sama).
 */
export function ikatUlang(petaLama: PetaRef, petaBaru: PetaRef, ref: string): string | null {
  const lama = petaLama[ref];
  if (!lama) return null;
  const cocok = Object.entries(petaBaru).filter(([, v]) => v.sidik === lama.sidik);
  if (cocok.length !== 1) return null;
  return cocok[0]?.[0] ?? null;
}
