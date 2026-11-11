/**
 * Klasifikator klik final (desain generik §3). Deterministik, default tolak, aturan pertama yang cocok menang.
 * Disuntikkan ke halaman bersama runner-ops (isolated world CDP): WAJIB tanpa impor runtime, fungsi murni
 * atas DOM, dan nama tingkat atas tidak boleh bentrok dengan amatan.ts / runner-ops.ts (satu cakupan).
 *
 * AI hanya boleh mengklik kelas `navigasi`, `ui_lokal`, atau `lanjut`. Homoglif, karakter tak terlihat, dan
 * ikon tanpa nama tidak pernah menghasilkan kecocokan positif.
 */
import type { KelasKendali } from '@urusin/contracts';

export type { KelasKendali };

/** Id aturan untuk jejak audit: K1..K11 sesuai urutan §3. */
export type AturanKlasifikasi =
  | 'K1_TERSEMBUNYI'
  | 'K2_TANTANGAN'
  | 'K3_MASUK'
  | 'K4_SUBMITTER'
  | 'K5_ATRIBUT'
  | 'K6_AKHIR_DIALOG'
  | 'K7_NEG'
  /** Tautan GET yang kena NEG hanya lewat nama (jalur/id/ikon bersih): tetap `kirim`, amatan `tautanPembuka`. */
  | 'K7_NEG_NAMA_TAUTAN'
  /** Tautan GET yang kena NEG hanya lewat ikon di dalamnya (mis. feather credit-card): tetap `kirim`, pembuka. */
  | 'K7_NEG_IKON_TAUTAN'
  | 'K7B_TEKS_CURIGA'
  | 'K8_NAVIGASI'
  | 'K9_UI_LOKAL'
  | 'K10_LANJUT'
  | 'K11_DEFAULT';

export type FiturKendali = {
  tag: string;
  type: string;
  role: string;
  teksTampak: string;
  ariaLabel: string;
  /** Hanya label tombol `input[type=button|submit|reset|image]`; nilai field isian TIDAK PERNAH dibaca. */
  nilai: string;
  title: string;
  /** Token id/class/name elemen itu sendiri (huruf kecil, tanpa pemisah). */
  idKelas: string[];
  /** Token ikon di dalam elemen (`<i class="fa ...">`, svg/use, material-icons). */
  ikon: string[];
  href: { ada: boolean; host: string; jalur: string; js: boolean; download: boolean; hanyaFragmen: boolean };
  submitterAsli: boolean;
  formAdaSandi: boolean;
  atributBerbahaya: boolean;
  dalamDialogKonfirmasi: boolean;
  dalamFrameTantangan: boolean;
  halamanAkhir: boolean;
  terlihat: boolean;
  aktif: boolean;
  /** role=tab, aria-controls, aria-expanded, data-(bs-)toggle, atau <summary>. */
  kendaliLokal: boolean;
  /** Nama memuat homoglif/aksara non-Latin atau karakter tak terlihat. */
  teksCuriga: boolean;
};

export type HasilKlasifikasi = { kelas: KelasKendali; aturan: AturanKlasifikasi; fitur: FiturKendali };

/** Salinan runtime KELAS_BOLEH_KLIK_AI kontrak (skrip halaman tidak boleh impor runtime; tes memastikan sama). */
export const KELAS_BOLEH_KLIK_AI: readonly KelasKendali[] = ['navigasi', 'ui_lokal', 'lanjut'];

export function bolehDiklikAi(kelas: KelasKendali): boolean {
  return kelas === 'navigasi' || kelas === 'ui_lokal' || kelas === 'lanjut';
}

/**
 * Karakter tak terlihat/format: zero-width, soft hyphen, kontrol arah teks, BOM, dsb. Tanda gabung tak terlihat
 * (CGJ, vokal inheren Khmer) tidak di sini: normalTeks tidak membuangnya, jadi tetap gagal RE_KARAKTER_BERSIH.
 */
const RE_TAK_TERLIHAT =
  /[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
/**
 * Setelah NFKD + buang tanda diakritik, nama yang "bersih" hanya memuat huruf Latin dasar, angka, spasi, dan
 * tanda baca umum. Selain itu (Kiril, Yunani, simbol aneh) dianggap curiga.
 */
const RE_KARAKTER_BERSIH =
  /^[a-z0-9\s.,:;!?'"()[\]/&+*#%@_\-\u2013\u2014\u203a\u00bb>\u2192\u27f6\u2794\u279c\u279d\u25b6\u25ba\u276f<\u2039\u00ab\u2190\u2026\u00b7|]*$/;

/**
 * NFKD + huruf kecil + buang diakritik Latin dasar + rapikan spasi. Karakter tak terlihat (termasuk BOM, yang
 * bagi `\s` adalah spasi) dan tanda gabung lain DIPERTAHANKAN supaya terdeteksi sebagai teks curiga.
 */
export function normalTeks(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u034e\u0350-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g, ' ')
    .replace(/^ | $/g, '');
}

/** Versi untuk pencocokan NEG: karakter tak terlihat dibuang supaya "kir<ZWSP>im" tetap tertangkap. */
function lipatNeg(s: string): string {
  return s.replace(RE_TAK_TERLIHAT, '');
}

function teksCurigaDari(...teks: string[]): boolean {
  return teks.some((t) => {
    RE_TAK_TERLIHAT.lastIndex = 0;
    return RE_TAK_TERLIHAT.test(t) || !RE_KARAKTER_BERSIH.test(t);
  });
}

function tokenKata(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Akar kata NEG tombol (§3 aturan 7); cocok bila muncul di dalam token (mengirim, pendaftaran, btnSubmit). */
const NEG_AKAR = [
  'kirim',
  'ajukan',
  'ajuan',
  'submit',
  'simpan',
  'selesai',
  'proses',
  'konfirmasi',
  'setuju',
  'bayar',
  'hapus',
  'batal',
  'keluar',
  'unggah',
  'cetak',
  'unduh',
  'verifikasi',
  'daftar',
  'logout',
  'signout',
  'delete',
  'remove',
  'cancel',
  'confirm',
  'upload',
  'download',
  'print',
  'register',
  'finish',
  'payment',
  // Review N6: kata kerja tulis/pengesahan di luar daftar awal ("Tanda Tangani", "Finalisasi", "Serahkan").
  'tandatangan',
  'final',
  'serahkan',
  'setor',
  'kunci',
  'sahkan',
  'terbitkan',
  'lapor',
];
/** Kata NEG pendek: hanya cocok sebagai token utuh (supaya "ya" tidak mengenai "layanan"). */
const NEG_TOKEN = [
  'ya',
  'ok',
  'oke',
  'okay',
  'yes',
  'send',
  'save',
  'pay',
  'done',
  'apply',
  'agree',
  'accept',
  'tte',
];
/**
 * Tautan memakai NEG yang sama dengan tombol ("Ajukan Permohonan", "Proses Permohonan" = kirim). Pengecualian
 * HANYA untuk frasa menu yang persis sama (setelah panah tepi dibuang); jalur/kueri tautan itu tetap diperiksa.
 */
const MENU_AMAN: ReadonlySet<string> = new Set([
  'daftar layanan',
  'status pengajuan',
  'cek status pengajuan',
  'riwayat pengajuan',
  'alur proses',
  'alur pengajuan',
  'syarat pengajuan',
  'persyaratan pengajuan',
]);
/** Kata biasa yang kebetulan memuat akar NEG ("keluarga" memuat "keluar"). */
const BUKAN_NEG = /^(ke)?keluarga/;
/** Token jalur/kueri tautan yang menandakan aksi tulis (§3 aturan 7). */
const NEG_JALUR = [
  'selesai',
  'hapus',
  'store',
  'logout',
  'signout',
  'keluar',
  'delete',
  'destroy',
  'remove',
  'submit',
  'kirim',
  'simpan',
  'save',
  'bayar',
  'pay',
  'batal',
  'cancel',
  'konfirmasi',
  'confirm',
  'approve',
  'setuju',
  'verifikasi',
  'verify',
  'unduh',
  'download',
  'cetak',
  'print',
  'ajukan',
  'ajuan',
  'proses',
  'final',
  'finish',
  'send',
  'apply',
  'terima',
  'tolak',
  'tandatangan',
  'tte',
  'serah',
  'setor',
  'kunci',
  'sahkan',
  'terbit',
  'lapor',
];
/** Frasa NEG dua kata ("tanda tangan", "tanda-tangan") untuk nama dan jalur. */
const RE_FRASA_NEG = /tanda[^a-z0-9]{0,3}tangan/;
/** Token ikon yang berarti kirim/simpan/hapus/keluar (fa-paper-plane, bi-send, material "send", ...). */
const NEG_IKON = [
  'paper',
  'plane',
  'send',
  'save',
  'floppy',
  'trash',
  'delete',
  'remove',
  'signout',
  'logout',
  'power',
  'print',
  'download',
  'upload',
  'credit',
];
const NAMA_LANJUT = ['lanjut', 'lanjutkan', 'selanjutnya', 'berikutnya', 'next', 'continue'];
const NAMA_MASUK = ['masuk', 'login', 'log in', 'sign in', 'signin', 'masuk akun'];
const RE_PANAH_TEPI =
  /^[\s\u203a\u00bb>\u2192\u27f6\u2794\u279c\u279d\u25b6\u25ba\u276f<\u2039\u00ab\u2190\u2026\u00b7|.:]+|[\s\u203a\u00bb>\u2192\u27f6\u2794\u279c\u279d\u25b6\u25ba\u276f<\u2039\u00ab\u2190\u2026\u00b7|.:]+$/g;
const RE_KODE_BERBAHAYA =
  /submit\(|requestsubmit|fetch|ajax|\$\.post|\.post\(|axios|xmlhttprequest|confirm\(/;
const RE_KONFIRMASI_DIALOG =
  /yakin|apakah anda|apakah data|konfirmasi|are you sure|confirm|menyatakan|tidak dapat diubah|tidak bisa dibatalkan/;
const RE_HOST_TANTANGAN =
  /(^|\.)(challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net)$|^www\.google\.com$/;
const SEL_WADAH_TANTANGAN =
  '.cf-turnstile, .g-recaptcha, .h-captcha, [data-sitekey], #challenge-form, #cf-challenge-running';
const SEL_DIALOG =
  'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .swal2-popup, .sweet-alert, .bootbox, .popup';

/** Pola halaman deklarasi/tinjauan akhir (kunci halaman akhir). */
const RE_HALAMAN_AKHIR = [
  /dengan ini (saya|kami) menyatakan/,
  /saya menyatakan (bahwa|dengan)/,
  /data yang (saya|kami) (isi|isikan|masukkan|sampaikan|berikan) (adalah )?(benar|sesuai)/,
  /i hereby (declare|certify)/,
  /periksa kembali (data|isian|permohonan)/,
  /(ringkasan|pratinjau|tinjauan|review) (data|permohonan|pengajuan|pendaftaran|application)/,
  /konfirmasi (data|pengajuan|permohonan|pendaftaran)/,
];
const RE_PERNYATAAN =
  /menyatakan|pernyataan|menyetujui|setuju|bertanggung ?jawab|benar dan dapat|syarat dan ketentuan|i agree|i declare|i certify|\b(benar|akurat|paham|memahami|dipahami|mengerti|bersedia|menjamin|konsekuensi|sanksi)\b|sesuai dengan (data|dokumen|aslinya|yang sebenarnya|keadaan)/;
/**
 * Allowlist checkbox DATA yang boleh dicentang AI (desain §3, F5): pilihan isian seperti "Alamat domisili sama
 * dengan KTP", "Punya NPWP", jenis layanan/dokumen. Selain itu (persetujuan, langganan kabar, "saya bukan robot")
 * default tolak. Pernyataan selalu kalah walau memuat kata data.
 */
/**
 * Deklarasi orang pertama/kesesuaian ("Data yang saya isi sesuai KTP", "Saya sudah membaca persyaratan") dan
 * label berkata kerja tulis ("Kirim permohonan KK baru") bukan opsi data walau memuat kata data (review N7).
 * Sengaja TIDAK masuk RE_PERNYATAAN: itu mengunci halaman akhir.
 */
const RE_CENTANG_DEKLARASI = /\b(saya|kami|sesuai|membaca|telah|sudah)\b/;
const RE_CENTANG_DATA =
  /\b(sama dengan|alamat|domisili|punya|memiliki|mempunyai|npwp|bpjs|kk|ktp|kia|akta|ijazah|paspor|sim|layanan|jenis|kategori|keperluan|disabilitas|difabel|penyandang|anak|istri|suami|ayah|ibu|wali|kepala keluarga|anggota keluarga|pindah|baru|hilang|rusak|perubahan|perbaikan|laki|perempuan|wni|wna)\b/;

function atribut(el: Element, nama: string): string {
  return el.getAttribute(nama) ?? '';
}

/**
 * Teks yang tampak di elemen: abaikan isi field, skrip, gaya, dan turunan tersembunyi. `lewati` (opsional)
 * membuang subpohon turunan tertentu (mis. FAQ/navigasi saat mencari frasa halaman akhir).
 */
export function teksTampakDari(el: Element, lewati?: (e: Element) => boolean): string {
  let hasil = '';
  const jalan = (n: Node): void => {
    if (n.nodeType === 3) {
      hasil += n.nodeValue ?? '';
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT') return;
    // Isi textarea = nilai bawaan field: tidak pernah dibaca. Kendali lain dilewati bila berada di dalam el.
    if (tag === 'TEXTAREA') return;
    if (e !== el && (tag === 'SELECT' || tag === 'INPUT' || tag === 'OPTION')) return;
    if (e !== el && (e.hasAttribute('hidden') || atribut(e, 'aria-hidden') === 'true')) return;
    if (e !== el && lewati?.(e)) return;
    if (tag === 'IMG') hasil += ' ' + atribut(e, 'alt') + ' ';
    for (const c of e.childNodes) jalan(c);
    if (tag === 'BR' || tag === 'P' || tag === 'DIV' || tag === 'LI') hasil += ' ';
  };
  jalan(el);
  return hasil;
}

function adaTataLetak(doc: Document): boolean {
  const r = doc.documentElement.getBoundingClientRect?.();
  return !!r && r.width > 0;
}

/** Terlihat: tidak `hidden`/aria-hidden/inert, tidak display:none / visibility:hidden / opacity:0, ukuran > 0. */
export function terlihatEl(el: Element): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') return false;
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  if (win) {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = win.getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
      if (s.opacity !== '' && Number(s.opacity) === 0) return false;
    }
  }
  if (adaTataLetak(doc)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0 || r.bottom <= 0) return false;
  }
  return true;
}

export function aktifEl(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return false;
  if (el.hasAttribute('disabled')) return false;
  if (atribut(el, 'aria-disabled') === 'true') return false;
  if (el.closest('fieldset[disabled], [inert]')) return false;
  return true;
}

function formPemilik(el: Element): HTMLFormElement | null {
  return (el as HTMLInputElement).form ?? el.closest('form');
}

function submitterAsliDari(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'BUTTON') {
    // Atribut type kosong/tak dikenal = submit (default HTML), tetapi hanya mengirim bila punya form pemilik
    // (form leluhur atau atribut form=). Di luar form (menu seluler) tidak mengirim apa pun. type=submit eksplisit
    // tetap submitter di mana pun.
    const t = (el.getAttribute('type') ?? '').trim().toLowerCase();
    if (t === 'button' || t === 'reset') return false;
    return t === 'submit' || formPemilik(el) !== null;
  }
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return t === 'submit' || t === 'image';
  }
  return false;
}

function atributBerbahayaDari(el: Element): boolean {
  const metode = atribut(el, 'data-method').trim().toLowerCase();
  if (metode && metode !== 'get') return true;
  if (el.hasAttribute('formaction') || el.hasAttribute('data-confirm') || el.hasAttribute('data-remote'))
    return true;
  for (const a of el.attributes) {
    const n = a.name.toLowerCase();
    if (/^hx-(post|put|patch|delete)$/.test(n)) return true;
    if (/^(wire:|x-on:submit|@submit|v-on:submit)/.test(n)) return true;
    if (n.startsWith('on') && RE_KODE_BERBAHAYA.test(normalTeks(a.value))) return true;
  }
  const href = atribut(el, 'href');
  return RE_KODE_BERBAHAYA.test(normalTeks(href));
}

function dalamDialogKonfirmasiDari(el: Element): boolean {
  const d = el.closest(SEL_DIALOG);
  if (!d) return false;
  if (atribut(d, 'role') === 'alertdialog') return true;
  return RE_KONFIRMASI_DIALOG.test(normalTeks(teksTampakDari(d)));
}

function hostDari(src: string, dasar: string): string {
  try {
    return new URL(src, dasar).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function dalamFrameTantanganDari(el: Element): boolean {
  const doc = el.ownerDocument;
  const dasar = doc.baseURI || 'about:blank';
  if (RE_HOST_TANTANGAN.test(doc.defaultView?.location.hostname ?? '')) return true;
  if (el.tagName === 'IFRAME' && RE_HOST_TANTANGAN.test(hostDari(atribut(el, 'src'), dasar))) return true;
  if (el.closest(SEL_WADAH_TANTANGAN)) return true;
  return [...el.querySelectorAll('iframe')].some((f) =>
    RE_HOST_TANTANGAN.test(hostDari(atribut(f, 'src'), dasar)),
  );
}

/** Checkbox deklarasi ("Dengan ini saya menyatakan...", "Saya setuju ..."). */
export function checkboxPernyataan(el: Element, label: string): boolean {
  if (el.tagName !== 'INPUT' || (el as HTMLInputElement).type !== 'checkbox') {
    if (atribut(el, 'role') !== 'checkbox') return false;
  }
  return RE_PERNYATAAN.test(normalTeks(label));
}

/**
 * Checkbox yang boleh dicentang AI: label cocok allowlist opsi data dan BUKAN pernyataan. Default tolak (label
 * kosong, persetujuan, langganan, verifikasi manusia).
 */
export function centangDataAman(label: string): boolean {
  const t = normalTeks(lipatNeg(label));
  return (
    !RE_PERNYATAAN.test(t) &&
    !RE_CENTANG_DEKLARASI.test(t) &&
    !cocokNeg(t, NEG_AKAR) &&
    RE_CENTANG_DATA.test(t)
  );
}

/** Label sederhana untuk field (label[for], label pembungkus, aria-label). Dipakai deteksi pernyataan. */
function labelSederhana(el: Element): string {
  const doc = el.ownerDocument;
  const bagian: string[] = [atribut(el, 'aria-label')];
  const id = el.id;
  if (id) for (const l of doc.querySelectorAll('label')) if (l.htmlFor === id) bagian.push(teksTampakDari(l));
  const pembungkus = el.closest('label');
  if (pembungkus) bagian.push(teksTampakDari(pembungkus));
  if (bagian.join('').trim() === '' && el.parentElement) bagian.push(teksTampakDari(el.parentElement));
  return bagian.join(' ');
}

/** Teks halaman yang tampak untuk heuristik (tanpa isi field). */
/**
 * Wilayah yang bukan isi formulir: navigasi, kaki, FAQ/akordeon (termasuk jawaban yang terlipat), menu. Frasa
 * halaman akhir di sini ("konfirmasi pendaftaran" di FAQ beranda) tidak mengunci halaman.
 */
const SEL_BUKAN_ISI_FORM =
  'nav, footer, .navbar, .dropdown-menu, .breadcrumb, .accordion, .faq, [class*="faq" i], [id*="faq" i], details, .collapse:not(.show), marquee';

function teksHalaman(doc: Document): string {
  return doc.body ? normalTeks(lipatNeg(teksTampakDari(doc.body, (e) => e.matches(SEL_BUKAN_ISI_FORM)))) : '';
}

/** Halaman punya formulir yang bisa dikirim: kolom isian atau tombol yang terlihat di luar navigasi/FAQ. */
function adaFormulirTerlihat(doc: Document): boolean {
  for (const el of doc.querySelectorAll(
    'input:not([type="hidden"]), textarea, select, button, [role="button"], [role="checkbox"], [contenteditable="true"]',
  ))
    if (!el.closest(SEL_BUKAN_ISI_FORM) && terlihatEl(el)) return true;
  return false;
}

/**
 * Halaman deklarasi/tinjauan akhir: frasa pernyataan/ringkasan di luar navigasi/FAQ pada halaman yang punya
 * kolom isian atau tombol, atau checkbox pernyataan yang terlihat. Dihitung ulang setiap klik (kunci halaman
 * akhir). Kolom wajib yang masih kosong TIDAK membatalkannya (review G4): AI tetap boleh mengisi kolom di
 * halaman akhir, tetapi klik, centang, dan redirect halaman tetap terkunci.
 */
export function halamanAkhir(doc: Document): boolean {
  if (adaFormulirTerlihat(doc) && RE_HALAMAN_AKHIR.some((re) => re.test(teksHalaman(doc)))) return true;
  for (const el of doc.querySelectorAll('input[type="checkbox"], [role="checkbox"]')) {
    if (terlihatEl(el) && checkboxPernyataan(el, labelSederhana(el))) return true;
  }
  return false;
}

function tokenDari(sumber: string[]): string[] {
  return sumber.flatMap((s) => tokenKata(normalTeks(s).replace(/([a-z])([A-Z])/g, '$1 $2')));
}

function tokenIdKelas(el: Element): string[] {
  return tokenDari([el.id, atribut(el, 'class'), atribut(el, 'name')]);
}

/** Ikon di dalam tombol/tautan: <i class="fa fa-paper-plane">, <span class="material-icons">send</span>, svg. */
function tokenIkon(el: Element): string[] {
  const sumber: string[] = [];
  for (const ikon of el.querySelectorAll(
    'i, svg, use, span[class*="icon"], span[class*="fa-"], span[class*="bi-"]',
  )) {
    sumber.push(
      atribut(ikon, 'class'),
      atribut(ikon, 'href'),
      atribut(ikon, 'xlink:href'),
      atribut(ikon, 'data-icon'),
    );
    if (/material|icon/.test(atribut(ikon, 'class'))) sumber.push(ikon.textContent ?? '');
  }
  return tokenDari(sumber);
}

/** Bangun fitur §3 dari elemen. `akhir` boleh diisi bila sudah dihitung untuk halaman yang sama. */
export function fiturKendali(el: Element, akhir?: boolean): FiturKendali {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
  const tipeTombolInput =
    tag === 'input' && /^(button|submit|reset|image)$/.test((el as HTMLInputElement).type);
  const nilai = tipeTombolInput
    ? normalTeks((el as HTMLInputElement).type === 'image' ? atribut(el, 'alt') : atribut(el, 'value'))
    : '';
  const rawHref = tag === 'a' || tag === 'area' ? el.getAttribute('href') : null;
  const href = {
    ada: rawHref !== null,
    host: '',
    jalur: '',
    js: false,
    download: false,
    hanyaFragmen: false,
  };
  if (rawHref !== null) {
    const h = rawHref.trim();
    href.js = /^\s*javascript:/i.test([...lipatNeg(h)].filter((c) => c.charCodeAt(0) > 0x20).join(''));
    href.download = el.hasAttribute('download');
    href.hanyaFragmen = h === '' || h.startsWith('#');
    try {
      // baseURI (menghormati <base href>) = URL yang benar-benar dibuka saat diklik.
      const u = new URL(h, doc.baseURI || 'about:blank');
      href.host = /^https?:$/.test(u.protocol) ? u.host.toLowerCase() : '';
      href.jalur = normalTeks(decodeURIComponent(u.pathname + u.search));
    } catch {
      href.host = '';
    }
  }
  const form = formPemilik(el);
  const teksTampak = normalTeks(teksTampakDari(el));
  return {
    tag,
    type,
    role: normalTeks(el.getAttribute('role')),
    teksTampak,
    ariaLabel: normalTeks(el.getAttribute('aria-label')),
    nilai,
    title: normalTeks(el.getAttribute('title')),
    idKelas: tokenIdKelas(el),
    ikon: tokenIkon(el),
    href,
    submitterAsli: submitterAsliDari(el),
    formAdaSandi: !!form?.querySelector('input[type="password"]'),
    atributBerbahaya: atributBerbahayaDari(el),
    dalamDialogKonfirmasi: dalamDialogKonfirmasiDari(el),
    dalamFrameTantangan: dalamFrameTantanganDari(el),
    halamanAkhir: akhir ?? halamanAkhir(doc),
    terlihat: terlihatEl(el),
    aktif: aktifEl(el),
    kendaliLokal:
      el.getAttribute('role') === 'tab' ||
      tag === 'summary' ||
      el.hasAttribute('aria-controls') ||
      el.hasAttribute('aria-expanded') ||
      el.hasAttribute('data-toggle') ||
      el.hasAttribute('data-bs-toggle'),
    teksCuriga: teksCurigaDari(
      ...[
        teksTampak,
        normalTeks(el.getAttribute('aria-label')),
        nilai,
        normalTeks(el.getAttribute('title')),
      ].filter(Boolean),
    ),
  };
}

function tokenNeg(t: string, akar: readonly string[]): boolean {
  if (BUKAN_NEG.test(t)) return false;
  return NEG_TOKEN.includes(t) || akar.some((a) => t.includes(a));
}

function cocokNeg(teks: string, akar: readonly string[]): boolean {
  const t = lipatNeg(teks);
  return RE_FRASA_NEG.test(t) || tokenKata(t).some((k) => tokenNeg(k, akar));
}

function bersihkanPanah(s: string): string {
  return s.replace(RE_PANAH_TEPI, '').trim();
}

/** Tautan GET biasa: `a[href]`/`area[href]` http(s), bukan javascript:, fragmen saja, atau unduhan. */
function tautanGetBiasa(f: FiturKendali): boolean {
  return (
    (f.tag === 'a' || f.tag === 'area') &&
    f.href.ada &&
    f.href.host !== '' &&
    !f.href.js &&
    !f.href.hanyaFragmen &&
    !f.href.download &&
    !f.atributBerbahaya &&
    !f.teksCuriga
  );
}

/** Jalur+kueri (sudah dinormalkan) memuat token tulis NEG_JALUR (ajukan, kirim, simpan, hapus, ...). */
function jalurNeg(jalur: string): boolean {
  return (
    RE_FRASA_NEG.test(jalur) ||
    tokenKata(jalur).some((t) => !BUKAN_NEG.test(t) && NEG_JALUR.some((k) => t.includes(k)))
  );
}

/**
 * URL navigasi yang jalur/kuerinya berbunyi tulis (aturan jalur yang sama dengan tautan K7). Dipakai gerbang
 * tulis worker untuk navigasi dokumen yang tidak dipicu aksi AI (redirect JS halaman saat ai_diam).
 */
export function jalurTulis(url: string): boolean {
  try {
    const u = new URL(url);
    return jalurNeg(normalTeks(decodeURIComponent(u.pathname + u.search)));
  } catch {
    return true;
  }
}

/** Token id/kelas/ikon tombol menu ponsel (hamburger). */
const TOKEN_MENU: readonly string[] = ['bars', 'hamburger', 'burger', 'toggler', 'menu', 'navicon'];
/** Nama tombol pembuka pemilih tanggal. */
const RE_PEMBUKA_TANGGAL = /^((buka|tampilkan|pilih|lihat) )?(kalender|calendar|tanggal|date ?picker)$/;

/** Aturan §3 atas fitur. Murni: fitur yang sama selalu menghasilkan kelas yang sama. */
export function putuskanKelas(f: FiturKendali): { kelas: KelasKendali; aturan: AturanKlasifikasi } {
  const nama = [f.teksTampak, f.ariaLabel, f.nilai, f.title].filter(Boolean);
  const tautan = f.tag === 'a' || f.tag === 'area';

  if (!f.terlihat || !f.aktif) return { kelas: 'tidak_pasti', aturan: 'K1_TERSEMBUNYI' };
  if (f.dalamFrameTantangan) return { kelas: 'tantangan', aturan: 'K2_TANTANGAN' };
  const namaMasuk = nama.some((n) => NAMA_MASUK.includes(bersihkanPanah(lipatNeg(n))));
  if ((f.formAdaSandi && (f.submitterAsli || namaMasuk)) || (namaMasuk && !tautan))
    return { kelas: 'masuk', aturan: 'K3_MASUK' };
  if (f.submitterAsli) return { kelas: 'kirim', aturan: 'K4_SUBMITTER' };
  if (f.atributBerbahaya) return { kelas: 'kirim', aturan: 'K5_ATRIBUT' };
  if (f.dalamDialogKonfirmasi) return { kelas: 'kirim', aturan: 'K6_AKHIR_DIALOG' };

  // Frasa menu persis (Daftar Layanan, Status Pengajuan) melewati cek NAMA saja; id/kelas/ikon/jalur tetap.
  const menuAman = tautan && nama.length > 0 && nama.every((n) => MENU_AMAN.has(bersihkanPanah(lipatNeg(n))));
  const negToken = (t: string[]) =>
    cocokNeg(t.join(' '), NEG_AKAR) || t.some((x) => NEG_IKON.some((k) => x.includes(k)));
  const negNama = !menuAman && nama.some((n) => cocokNeg(n, NEG_AKAR));
  const negIkon = negToken(f.ikon);
  const negLain = negToken(f.idKelas) || (tautan && jalurNeg(f.href.jalur)) || f.href.download;
  const tombolBiasa =
    (f.tag === 'button' && !f.submitterAsli && f.type !== 'reset') ||
    (f.tag === 'input' && f.type === 'button') ||
    f.role === 'button';

  // Pembuka pemilih tanggal ("Buka kalender", probe 3324/3404) bukan tombol kirim walau di halaman akhir. Label
  // ini tidak membuka klik: di halaman akhir klik AI tetap ditolak kunci halaman (runner A_HALAMAN_AKHIR,
  // validator HALAMAN_AKHIR_TERKUNCI); tanggal diketik AI ke kolomnya.
  if (
    tombolBiasa &&
    nama.length > 0 &&
    nama.every((n) => RE_PEMBUKA_TANGGAL.test(bersihkanPanah(n))) &&
    !negLain &&
    !negIkon
  )
    return { kelas: 'ui_lokal', aturan: 'K9_UI_LOKAL' };
  if (f.halamanAkhir) return { kelas: 'kirim', aturan: 'K6_AKHIR_DIALOG' };
  if (negLain) return { kelas: 'kirim', aturan: 'K7_NEG' };
  // Ikon saja (probe SIDAK: feather credit-card = ikon KTP/KK) pada tautan GET bersih: pembuka, diketuk warga.
  if (negIkon && !negNama)
    return tautanGetBiasa(f)
      ? { kelas: 'kirim', aturan: 'K7_NEG_IKON_TAUTAN' }
      : { kelas: 'kirim', aturan: 'K7_NEG' };
  if (negNama)
    // Tautan GET biasa yang hanya namanya berbunyi tulis (Ajukan/Daftar/Proses): tetap kirim, tetapi otak boleh
    // menyerahkannya ke warga sebagai "ketuk tautan" (bukan tombol final).
    return tautanGetBiasa(f)
      ? { kelas: 'kirim', aturan: 'K7_NEG_NAMA_TAUTAN' }
      : { kelas: 'kirim', aturan: 'K7_NEG' };

  // Tombol menu ikon saja (hamburger fa-bars / navbar-toggler, probe 3279 dan 6371): membuka menu ponsel, AI boleh.
  // Bukan submitter (K4 di atas) dan klik AI tetap hanya GET di gerbang tulis worker.
  if (
    !f.teksCuriga &&
    nama.length === 0 &&
    tombolBiasa &&
    [...f.ikon, ...f.idKelas].some((t) => TOKEN_MENU.includes(t))
  )
    return { kelas: 'ui_lokal', aturan: 'K9_UI_LOKAL' };
  // Homoglif / karakter tak terlihat / tanpa nama: tidak pernah cocok positif.
  if (f.teksCuriga || nama.length === 0) return { kelas: 'tidak_pasti', aturan: 'K7B_TEKS_CURIGA' };

  if (tautan && f.href.ada && f.href.host && !f.href.js && !f.href.hanyaFragmen)
    return { kelas: 'navigasi', aturan: 'K8_NAVIGASI' };
  if (f.kendaliLokal) return { kelas: 'ui_lokal', aturan: 'K9_UI_LOKAL' };
  const namaUtama = bersihkanPanah(f.teksTampak || f.nilai);
  if (
    tombolBiasa &&
    NAMA_LANJUT.includes(namaUtama) &&
    nama.every((n) => NAMA_LANJUT.includes(bersihkanPanah(n)))
  )
    return { kelas: 'lanjut', aturan: 'K10_LANJUT' };

  return { kelas: 'tidak_pasti', aturan: 'K11_DEFAULT' };
}

/** Aktivator yang ikut terpicu bila turunannya diklik (klik menggelembung / aktivasi label). */
const SEL_AKTIVATOR =
  'button, a[href], area[href], summary, label, input[type="submit"], input[type="image"], input[type="button"], [role="button"], [role="link"]';

/**
 * Elemen lain yang ikut teraktivasi oleh `el.click()`: leluhur aktivator (span di dalam button submit, tautan)
 * dan kontrol label (`<label for>` menunjuk tombol submit, label pembungkus).
 */
function aktivatorTerkait(el: Element): Element[] {
  const hasil: Element[] = [];
  for (let x = el.parentElement?.closest(SEL_AKTIVATOR); x; x = x.parentElement?.closest(SEL_AKTIVATOR))
    hasil.push(x);
  const label = el.tagName === 'LABEL' ? el : el.closest('label');
  const kontrol = (label as HTMLLabelElement | null)?.control;
  if (kontrol && kontrol !== el && !hasil.includes(kontrol)) hasil.push(kontrol);
  return hasil;
}

/**
 * Klasifikasi lengkap satu elemen. Panggil ulang tepat sebelum klik (tugas JS yang sama). Elemen yang boleh
 * diklik tetap ditolak bila aktivator leluhur atau kontrol labelnya tidak boleh (kelas paling ketat menang).
 */
export function klasifikasi(el: Element, akhir?: boolean): HasilKlasifikasi {
  const fitur = fiturKendali(el, akhir);
  const utama = { ...putuskanKelas(fitur), fitur };
  if (!bolehDiklikAi(utama.kelas)) return utama;
  for (const x of aktivatorTerkait(el)) {
    const k = putuskanKelas(fiturKendali(x, fitur.halamanAkhir));
    // Probe 1901: <button type=button><a href=/jenis-layanan>. Tombol pembungkus tanpa sinyal apa pun (K11:
    // bukan submitter, tanpa atribut berbahaya, nama netral) tidak mengunci tautan navigasi di dalamnya.
    if (utama.aturan === 'K8_NAVIGASI' && k.aturan === 'K11_DEFAULT') continue;
    if (!bolehDiklikAi(k.kelas)) return { ...k, fitur };
  }
  return utama;
}
