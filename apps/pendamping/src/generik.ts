import {
  KELAS_BOLEH_KLIK_AI,
  KELAS_BOLEH_KLIK_LIHAT_SAJA,
  PESAN_LIHAT_SAJA,
  KelasKendaliSchema,
  PengamatanSchema,
  kendaliAkun,
  type Aksi,
  type ElemenAmatan,
  type CatatanPendamping,
  type HasilAksi,
  type KelasKendali,
  type KodeHasilAksi,
  type KolomButuh,
  type PendampingEvent,
  type PendampingSorot,
  type Pengamatan,
  type SinyalHalaman,
} from '@urusin/contracts';
import type {
  AksiRunner,
  HasilAksi as HasilAksiRunner,
  PetaRef,
  RefTersimpan,
  UploadFile,
} from '@urusin/executor';
import {
  AMAN,
  JENDELA_ISI_MS,
  type CatatanBlokir,
  type GerbangTulis,
  type Jendela,
} from './gerbang-tulis.js';
import { galatSitus, halamanGalatChrome, pesanAlihLuar, pesanSitusBermasalah } from './galat-nav.js';

/**
 * GenerikRun: "tangan" Navigator generik di worker (ADR 0030). Otak (LLM + validator) ada di web; worker
 * hanya menjalankan aksi terbatas yang sudah divalidasi, dengan pertahanan sendiri:
 * - peta ref -> {jalur, sidik} HANYA di memori worker (tidak pernah di DOM, tidak pernah ke web);
 * - sidik berubah saat aksi = `REF_BASI` (dihitung ulang di halaman oleh runner);
 * - kunci halaman akhir: pengamatan terakhir `halamanAkhir` = AI tidak boleh mengeklik apa pun;
 * - klik `navigasi` = `Page.navigate(href)` setelah cek allowlist (tanpa popup);
 * - nilai vault hanya untuk pasangan (sidik ref, placeholder) yang disetujui warga untuk `rencanaHash` itu;
 * - gerbang tulis jaringan per aksi (ai_isi/ai_klik), blokir saat klik = eskalasi ke warga (`periksa`);
 * - redaksi: setiap nilai vault yang dipegang worker diganti tokennya di semua teks pengamatan.
 */

// --- Port ke runner op `amati`/`aksi` (packages/executor, WP-A). SATU-SATUNYA titik integrasi. ---------------

/** Tipe op runner dari @urusin/executor (WP-A): peta ref, aksi ter-resolve, hasil rinci. */
export type { AksiRunner, PetaRef, RefTersimpan };

/** Hasil satu aksi dari runner (tanpa nilai): bagian HasilAksi executor yang dipakai worker. */
export type HasilRunner = Pick<HasilAksiRunner, 'status' | 'aturan' | 'kode' | 'kelas' | 'href'> & {
  fitur?: Record<string, unknown> | undefined;
};

export type TanganHalaman = {
  /** null = halaman sedang berpindah (konteks hancur). */
  amati(seq: number, diisi: Record<string, string>): Promise<{ pengamatan: unknown; peta: PetaRef } | null>;
  aksi(a: AksiRunner, peta: PetaRef): Promise<HasilRunner | null>;
  /** `Page.navigate(url)` bingkai utama. */
  navigasi(url: string): Promise<void>;
  /** Kotak elemen (piksel CSS viewport) untuk disorot ke warga. */
  sorot(jalur: string): Promise<PendampingSorot | undefined>;
  /** Href tautan pembuka `ref` yang dibaca ulang dari DOM (op runner `tautan`); undefined = bukan/tidak lagi. */
  tautan(ref: string, peta: PetaRef): Promise<string | undefined>;
  /** Tunggu halaman tenang setelah klik/navigasi (muat selesai atau jeda singkat). */
  tenang(): Promise<void>;
  /** URL dokumen utama yang ter-commit saat ini (mis. `chrome-error://...` bila navigasi gagal). */
  urlKini(): string;
  /** Galat jaringan navigasi bingkai utama terakhir (`net::ERR_*`), bila ada. */
  galatNav?(): string | undefined;
  /**
   * Probe gel4 3279: tombol masuk situs hanya tampil di layar lebar (`d-none d-lg-block`). Lebarkan viewport bila
   * itu memunculkannya; true = lebar berubah (amati ulang).
   */
  lebarkan?(): Promise<boolean>;
  /**
   * Buka menu (hamburger/offcanvas/collapse) yang menyembunyikan kendali masuk di layar ponsel (QA prod Depok):
   * klik pembuka panel lokal yang TARGET-nya memuat kendali masuk tersembunyi. true = menu terbuka.
   */
  bukaMenuMasuk?(): Promise<boolean>;
  /** Konten fade-in (blok besar berisi tautan/kolom) masih transparan (probe gel5 6171). */
  belumTampil?(): Promise<boolean>;
};

/** Tujuan tautan pembuka untuk giliran `ketuk_tautan` (event `giliran_anda.tautan`; `ref` kembali lewat `buka_tautan`). */
export type TautanGiliran = { ref: string; nama: string; host: string; jalur: string };

function decodeURIComponentAman(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Evaluator op runner di isolated world (browser.ts) -> TanganHalaman. */
/**
 * Probe gel4 9171: tautan `http://` (port bawaan) ke host sesi yang terdaftar hanya untuk https dinaikkan ke
 * `https://` bila bentuk https-nya lolos `boleh`. http polos tidak pernah dibuka; URL yang memang boleh lewat http
 * (fixture uji) tidak diubah. undefined = tidak ada kenaikan yang sah.
 */
export function naikHttps(url: string, boleh: (url: string) => boolean): string | undefined {
  const u = URL.parse(url);
  if (!u || u.protocol !== 'http:' || (u.port !== '' && u.port !== '80') || boleh(u.href)) return undefined;
  u.protocol = 'https:';
  return boleh(u.href) ? u.href : undefined;
}

export function tanganRunner(deps: {
  evaluate(op: unknown): Promise<{ ok: true; value?: unknown } | { ok: false; code: string } | 'interrupted'>;
  navigasi(url: string): Promise<void>;
  tenang(): Promise<void>;
  urlKini(): string;
  galatNav?(): string | undefined;
  lebarkan?(): Promise<boolean>;
  belumTampil?(): Promise<boolean>;
  bukaMenuMasuk?(): Promise<boolean>;
}): TanganHalaman {
  return {
    async amati(seq, diisi) {
      const r = await deps.evaluate({ kind: 'amati', seq, diisi });
      if (r === 'interrupted' || !r.ok) return null;
      const v = r.value as { pengamatan?: unknown; peta?: PetaRef } | undefined;
      return v?.pengamatan && v.peta ? { pengamatan: v.pengamatan, peta: v.peta } : null;
    },
    async aksi(a, peta) {
      const r = await deps.evaluate({ kind: 'aksi', aksi: [a], peta });
      if (r === 'interrupted' || !r.ok) return null;
      const h = (r.value as { hasil?: HasilRunner[] } | undefined)?.hasil?.[0];
      return h ?? null;
    },
    navigasi: deps.navigasi,
    async sorot(jalur) {
      const r = await deps.evaluate({ kind: 'rect', target: [{ by: 'css', value: jalur }] });
      return r !== 'interrupted' && r.ok ? (r.value as PendampingSorot) : undefined;
    },
    async tautan(ref, peta) {
      const r = await deps.evaluate({ kind: 'tautan', ref, peta });
      const href =
        r !== 'interrupted' && r.ok ? (r.value as { href?: unknown } | undefined)?.href : undefined;
      return typeof href === 'string' ? href : undefined;
    },
    tenang: deps.tenang,
    urlKini: deps.urlKini,
    ...(deps.galatNav ? { galatNav: deps.galatNav } : {}),
    ...(deps.lebarkan ? { lebarkan: deps.lebarkan } : {}),
    ...(deps.belumTampil ? { belumTampil: deps.belumTampil } : {}),
    ...(deps.bukaMenuMasuk ? { bukaMenuMasuk: deps.bukaMenuMasuk } : {}),
  };
}

// --- Persetujuan (dipegang sessions.ts) ---------------------------------------------------------------

/** Baris lembar "Izinkan AI mengisi?" + sidik ref (sidik hanya di worker). */
export type KolomIzin = KolomButuh & { sidik: string };

export type IzinGenerik = {
  /** Pasangan (sidik ref, placeholder) disetujui warga untuk rencana ini. */
  disetujui(rencanaHash: string, sidik: string, placeholder: string): boolean;
  berkasDisetujui(rencanaHash: string, nama: string): boolean;
  /** Minta persetujuan: sesi -> menunggu_data, perangkat menerima butuh_data{kolom, rencanaHash}. */
  /** `origin` = origin halaman tempat nilai akan diisi (tujuan persetujuan), bila lolos allowlist sesi. */
  minta(p: { rencanaHash: string; kolom: KolomIzin[]; berkas: string[]; origin?: string | undefined }): void;
  nilai(placeholder: string): string | undefined;
  berkas(nama: string): UploadFile | undefined;
  /** Semua nilai vault yang dipegang sesi (untuk redaksi). */
  vault(): Iterable<[string, string]>;
};

/** Alasan `giliran_anda` untuk serah terima ke warga. */
export type AlasanGiliran = Extract<PendampingEvent, { jenis: 'giliran_anda' }>['alasan'];

export type GenerikDeps = {
  tangan: TanganHalaman;
  gerbang: GerbangTulis;
  izin: IzinGenerik;
  /** Allowlist egress sesi (host persis + skema); false = host di luar registry. */
  urlBoleh(url: string): boolean;
  jejak(c: CatatanPendamping): void;
  /** Warga memegang kendali (takeover) dengan pesan bertemplat + sorotan (+ tujuan tautan untuk `ketuk_tautan`). */
  serahkan(
    alasan: AlasanGiliran,
    pesan: string,
    sorot?: PendampingSorot,
    tautan?: TautanGiliran,
    /** Nama kendali sasaran giliran (sudah dibersihkan `namaKendali`), untuk instruksi ringkas di UI. */
    kendali?: string,
  ): void;
  /** Situs tidak bisa dikerjakan otomatis: sesi beralih ke mode dipandu. */
  tidakBisa(pesan: string): void;
  /** Fase AI yang jujur untuk layar warga (membuka situs/halaman, membaca halaman, mengisi formulir). */
  fase?(f: FaseAi): void;
  /**
   * Demo "lihat saja" di situs resmi asli: worker menolak setiap isi/pilih/centang/unggah (`TERLARANG`) dan klik
   * selain kelas `navigasi`/`ui_lokal` atau tautan pembuka GET (`KELAS_DITOLAK`), SEBELUM lembar izin atau
   * halaman disentuh. Lapis kedua setelah validator web; gerbang tulis jaringan lapis ketiga.
   */
  lihatSaja?: boolean;
  now?: () => number;
};

export type FaseAi = 'membuka' | 'membaca' | 'mengisi';

// --- Pesan bertemplat (tidak pernah teks LLM) -------------------------------------------------------

/** Label halaman yang dikutip di pesan: satu baris, tanpa tanda kutip, maks. 40 karakter. */
function kutip(nama: string): string {
  return nama
    .replace(/["'`\u201c\u201d\u2018\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Label aman dikutip di petunjuk umum: huruf/angka/spasi/&/-//, maks. 5 kata, tanpa angka panjang/URL. */
export function labelAman(nama: string): string | undefined {
  const k = kutip(nama);
  if (!k || k.split(' ').length > 5 || !/^[\p{L}\p{N} &/-]+$/u.test(k) || /\d{4,}/.test(k)) return undefined;
  return k;
}

const KATA_UMUM_HOST = new Set([
  'www',
  'web',
  'app',
  'portal',
  'layanan',
  'online',
  'disdukcapil',
  'dukcapil',
  // Host replika uji (fixtures.urusinai.web.id): bukan nama portal, jangan sampai "akun FIXTURES Anda".
  'fixtures',
]);

/**
 * Nama portal untuk pesan ("akun SIBISA Anda"): label host pertama (sibisa.medan.go.id = SIBISA) bila pendek dan
 * bukan kata umum; ejaan dari judul halaman bila judul memuatnya. undefined = "akun Anda di situs ini".
 */
export function namaPortal(host: string, judul = ''): string | undefined {
  const label = host.split('.')[0]?.toLowerCase() ?? '';
  if (!/^[a-z]{3,14}$/.test(label) || KATA_UMUM_HOST.has(label)) return undefined;
  const m = new RegExp(`(^|[^\\p{L}])(${label})([^\\p{L}]|$)`, 'iu').exec(judul.replace(/[-_]/g, ''));
  return m?.[2] && m[2] !== m[2].toLowerCase() ? m[2] : label.toUpperCase();
}

/**
 * Giliran masuk akun yang menyebut tombolnya (QA prod Medan/Padang): Masuk didahulukan, Daftar sebagai pilihan
 * bagi yang belum punya akun. Label hanya dari `kendaliAkun` (seluruh katanya kata akun), dikutip pendek.
 */
export function pesanMasukAkun(o: {
  portal?: string | undefined;
  masuk?: string | undefined;
  daftar?: string | undefined;
  formulir?: boolean;
  captcha?: boolean;
  verifikasi?: boolean;
}): string {
  const akun = o.portal ? `akun ${o.portal} Anda` : 'akun Anda di situs ini';
  const keamanan = o.captcha
    ? ', termasuk kode keamanan (CAPTCHA)'
    : o.verifikasi
      ? ', termasuk verifikasi keamanan situs'
      : '';
  const awal =
    o.formulir || !o.masuk
      ? `Masuk dengan ${akun}${keamanan}.`
      : `Ketuk "${kutip(o.masuk)}" kalau sudah punya akun, lalu masuk dengan ${akun}.`;
  const daftar = o.daftar ? ` Belum punya akun? Ketuk "${kutip(o.daftar)}".` : '';
  return `${awal}${daftar} AI melanjutkan setelah Anda masuk.`;
}

/** Petunjuk saat AI tidak maju: menyebut kendali yang disorot bila labelnya aman dikutip. */
export function pesanPetunjuk(nama: string | undefined): string {
  const l = nama ? labelAman(nama) : undefined;
  return l
    ? `AI belum menemukan langkah berikutnya di halaman ini. Coba ketuk "${l}" yang disorot, atau lanjutkan sendiri. Tekan Lanjutkan agar AI mencoba lagi.`
    : PESAN_GENERIK.tidak_yakin;
}

export const PESAN_GENERIK = {
  periksa:
    'Tombol ini mengirim data ke situs, jadi AI berhenti. Periksa halaman, lalu tekan sendiri tombol yang disorot bila sudah benar.',
  hostLain:
    'Tautan ini menuju situs di luar daftar situs resmi wilayah Anda, jadi AI berhenti. Lanjutkan sendiri bila Anda yakin.',
  masuk_akun: 'Masuk ke akun Anda di situs ini. AI melanjutkan setelah Anda masuk.',
  otp: 'Situs meminta kode OTP. Ketik sendiri kodenya; AI tidak pernah membacanya.',
  captcha: 'Situs meminta kode keamanan (CAPTCHA). Selesaikan sendiri; AI menunggu.',
  isi_sendiri: 'Isi sendiri kolom yang disorot, lalu tekan Lanjutkan.',
  ketuk_tautan:
    'AI tidak membuka tautan ini sendiri. Periksa nama dan alamat tujuannya, lalu tekan tombol Buka bila sesuai.',
  final: 'Periksa semua isian. Hanya Anda yang boleh menekan tombol kirim.',
  tidak_yakin:
    'AI tidak yakin langkah berikutnya. Lanjutkan sendiri, atau tekan Lanjutkan untuk mencoba lagi.',
  kotor:
    'Halaman ini mencoba mengirim data sendiri, jadi AI berhenti dan halaman dimuat ulang. Periksa halaman, lalu lanjutkan sendiri.',
  kotor_klik:
    'Tombol ini mencoba mengirim data ke situs, jadi AI berhenti dan halaman dimuat ulang agar tidak ada kiriman tertunda. Tekan Lanjutkan agar AI mengisi ulang, atau isi lalu tekan sendiri tombol yang disorot.',
  berhenti: 'AI berhenti di sini. Lanjutkan sendiri dari layar ini.',
  kirim_halaman:
    'Halaman ini mencoba mengirim data ke situs, jadi AI berhenti. Periksa halaman, lalu lanjutkan sendiri.',
  kirim_isi:
    'Halaman ini mencoba mengirim data sendiri setelah AI mengisi kolom, jadi AI berhenti. Periksa isian, lalu lanjutkan sendiri.',
  tautan_berubah:
    'Alamat tautan ini berubah setelah ditampilkan, jadi tidak dibuka. Periksa halaman, lalu lanjutkan sendiri.',
} as const;

/**
 * Nama kendali dari halaman untuk pesan giliran. Teks situs (tidak tepercaya): hanya teks polos, tanda kutip dan
 * karakter kendali dibuang, dipotong. undefined = tidak ada nama yang layak disebut.
 */
export function namaKendali(nama: string | undefined): string | undefined {
  const t = (nama ?? '')
    .replace(/[\p{Cc}\p{Cf}"'`\u201C\u201D\u2018\u2019\u00AB\u00BB]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return undefined;
  return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t;
}

/** Keadaan halaman saat AI berhenti: kendali yang memicu (nama/kelas), sorotan, dan sinyal halaman. */
export type KonteksGiliran = {
  nama?: string | undefined;
  kelas?: KelasKendali | undefined;
  /** Kotak sorot benar-benar ada (elemen masih terlihat). Tanpa ini pesan tidak boleh menyebut "disorot". */
  disorot: boolean;
  /** Nama kendali masuk akun di halaman (kelas `masuk`), bila ada. */
  masuk?: string | undefined;
  sinyal?: Pick<SinyalHalaman, 'login' | 'captcha' | 'tantangan'> | undefined;
};

/**
 * Pesan giliran saat gerbang tulis memblokir kiriman dari aksi AI (bertemplat, tidak pernah teks LLM). Kalimatnya
 * mengikuti alasan sebenarnya: halaman masuk akun, pemeriksaan keamanan, jendela/pengumuman yang harus ditutup,
 * atau kendali yang mengirim data. Kendali target disebut namanya; "disorot" hanya bila sorotannya ada.
 * `dimuatUlang` = dokumen kotor sudah dimuat ulang sebelum diserahkan.
 */
export function pesanEskalasi(k: KonteksGiliran, dimuatUlang = false): string {
  const q = (n: string) => `"${n}"`;
  const nama = namaKendali(k.nama);
  const masuk = namaKendali(k.masuk);
  const yangDisorot = k.disorot ? ' yang disorot' : '';
  if (k.sinyal?.captcha || k.sinyal?.tantangan) return PESAN_GENERIK.captcha;
  if (k.sinyal?.login)
    return `Situs ini meminta Anda masuk akun, jadi AI berhenti. Masuk sendiri${
      masuk ? ` lewat ${q(masuk)}` : ''
    }; AI tidak membaca sandi Anda. Setelah masuk, tekan Lanjutkan.`;
  const sesudah = masuk && masuk !== nama ? ` Untuk masuk akun, tekan ${q(masuk)}.` : '';
  if (dimuatUlang) {
    if (nama)
      return `Tombol ${q(nama)} mencoba mengirim data ke situs, jadi AI berhenti dan halaman dimuat ulang agar tidak ada kiriman tertunda. Tekan Lanjutkan agar AI mengisi ulang, atau isi lalu tekan sendiri ${q(nama)}${yangDisorot}.${sesudah}`;
    return (k.disorot ? PESAN_GENERIK.kotor_klik : PESAN_GENERIK.kotor) + sesudah;
  }
  if (nama && k.kelas === 'ui_lokal')
    return `Jendela atau pengumuman di halaman ini mengirim data saat ditutup lewat ${q(nama)}, jadi AI tidak melanjutkan. Tutup sendiri lewat ${q(nama)}${yangDisorot}, lalu tekan Lanjutkan.${sesudah}`;
  if (nama)
    return `${q(nama)}${yangDisorot} mengirim data ke situs, jadi AI berhenti. Periksa halaman, lalu tekan sendiri ${q(nama)} bila sudah benar.${sesudah}`;
  if (k.disorot) return PESAN_GENERIK.periksa + sesudah;
  return PESAN_GENERIK.kirim_halaman + sesudah;
}

/** Kendali yang disebut di instruksi ringkas giliran eskalasi: tombol masuk di halaman login, selain itu pemicunya. */
export function kendaliEskalasi(k: KonteksGiliran): string | undefined {
  if (k.sinyal?.captcha || k.sinyal?.tantangan) return undefined;
  return namaKendali(k.sinyal?.login ? k.masuk : k.nama);
}

/** Pesan serah dari Navigator (aksi `serahkan`): menyebut kendali target bila ada (mis. tombol Masuk). */
export function pesanSerah(
  alasan: Extract<Aksi, { jenis: 'serahkan' }>['alasan'],
  nama: string | undefined,
  disorot: boolean,
): string {
  const n = namaKendali(nama);
  if (!n) return PESAN_GENERIK[alasan];
  const yangDisorot = disorot ? ' yang disorot' : '';
  switch (alasan) {
    case 'masuk_akun':
      return `Masuk ke akun Anda: tekan "${n}"${yangDisorot}, lalu masuk sendiri. AI melanjutkan setelah Anda masuk.`;
    case 'isi_sendiri':
      return `Isi sendiri kolom "${n}"${yangDisorot}, lalu tekan Lanjutkan.`;
    case 'final':
      return `Periksa semua isian. Hanya Anda yang boleh menekan "${n}"${yangDisorot}.`;
    default:
      return PESAN_GENERIK[alasan];
  }
}

const PESAN_TIDAK_BISA: Record<Extract<Aksi, { jenis: 'tidak_bisa' }>['sebab'], string> = {
  layanan_tidak_ada:
    'Layanan ini tidak tersedia di situs resmi wilayah Anda. Kami beralih ke panduan langkah.',
  hanya_aplikasi: 'Layanan ini hanya lewat aplikasi resmi. Kami beralih ke panduan langkah.',
  hanya_whatsapp: 'Layanan ini hanya lewat WhatsApp resmi instansi. Kami beralih ke panduan langkah.',
  situs_rusak: 'Situs resmi sedang bermasalah. Kami beralih ke panduan langkah.',
  butuh_kamera: 'Langkah ini butuh kamera di perangkat Anda. Kami beralih ke panduan langkah.',
  lainnya: 'Langkah ini tidak bisa dikerjakan otomatis. Kami beralih ke panduan langkah.',
};

const ALASAN_GILIRAN: Record<Extract<Aksi, { jenis: 'serahkan' }>['alasan'], AlasanGiliran> = {
  masuk_akun: 'masuk_akun',
  otp: 'login',
  captcha: 'login',
  isi_sendiri: 'isi_sendiri',
  final: 'final',
  tidak_yakin: 'periksa',
  ketuk_tautan: 'ketuk_tautan',
  berhenti: 'berhenti',
};

// --- Redaksi ------------------------------------------------------------------------------------------

/** Nilai lebih pendek dari ini tidak disamarkan (terlalu umum: "L", "01"). */
export const NILAI_SAMAR_MIN = 3;

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pola satu nilai vault: huruf besar/kecil diabaikan, spasi dinormalkan; nilai angka >= 6 digit juga cocok
 * bila situs menyisipkan pemisah (spasi, titik, strip) di antara digit (mis. NIK "3201 0101 ...").
 */
function polaNilai(v: string): RegExp | undefined {
  const t = v.trim();
  if (t.length < NILAI_SAMAR_MIN) return undefined;
  // Pemisah apa pun yang bukan huruf/angka, sampai 4 karakter (" ** ", "_", "|", NBSP), review L2.
  if (/^\d{6,}$/.test(t)) return new RegExp(t.split('').map(escRe).join('[^\\p{L}\\p{Nd}]{0,4}'), 'gu');
  return new RegExp(t.split(/\s+/).map(escRe).join('[^\\p{L}\\p{Nd}]{1,4}'), 'giu');
}

/** Ganti setiap nilai vault di `s` dengan token placeholder-nya (nilai terpanjang dulu). */
export function redaksi(s: string, vault: Iterable<[string, string]>): string {
  const daftar = [...vault]
    .map(([ph, v]) => ({ ph, re: polaNilai(v), n: v.length }))
    .filter((x): x is { ph: string; re: RegExp; n: number } => x.re !== undefined)
    .sort((a, b) => b.n - a.n);
  let out = s;
  for (const { ph, re } of daftar) out = out.replace(re, ph);
  return out;
}

const potong = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Redaksi semua teks halaman di pengamatan, lalu potong ke batas kontrak SETELAH redaksi. */
function redaksiPengamatan(p: Pengamatan, vault: [string, string][]): Pengamatan {
  if (vault.length === 0) return p;
  const r = (s: string, n: number) => potong(redaksi(s, vault), n);
  const jalur = potong(redaksi(p.jalur, vault), 200);
  return {
    ...p,
    jalur: /^\/[^?#]*$/.test(jalur) ? jalur : '/',
    judul: r(p.judul, 120),
    teks: r(p.teks, 2500),
    elemen: p.elemen.map((e) => ({
      ...e,
      nama: r(e.nama, 120),
      ...(e.petunjuk !== undefined ? { petunjuk: r(e.petunjuk, 120) } : {}),
      ...(e.galat !== undefined ? { galat: r(e.galat, 120) } : {}),
      ...(e.opsi !== undefined ? { opsi: e.opsi.map((o) => r(o, 80)) } : {}),
    })),
  };
}

// --- Persetujuan: baris kolom -----------------------------------------------------------------------

/** Placeholder sensitif dan pola label kolom yang lazim untuknya. */
const LAZIM: [RegExp, RegExp][] = [
  [/\.(NIK|NO_?KTP)\}\}$/, /\bnik\b|nomor induk|kependudukan|\bktp\b/i],
  [/\.(NO_?KK|KK)\}\}$/, /\bkk\b|kartu keluarga/i],
  [/\.(NPWP)\}\}$/, /npwp|wajib pajak/i],
];

export function tidakLazim(placeholder: string, label: string): boolean {
  return LAZIM.some(([ph, lbl]) => ph.test(placeholder) && !lbl.test(label));
}

// --- Fitur klik untuk audit (hanya boolean struktural; tanpa teks situs) -------------------------------

function tokenFitur(f: Record<string, unknown> | undefined): string[] {
  if (!f) return [];
  return Object.entries(f)
    .filter(([k, v]) => v === true && /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(k))
    .map(([k]) => k)
    .slice(0, 20);
}

/** Nomor aturan jejak klik untuk tautan pembuka yang dibuka lewat navigasi GET (bukan klasifikator K1..K11). */
const ATURAN_PEMBUKA_GET = 12;

function nomorAturan(aturan: string): number {
  const n = Number(/^K(\d{1,2})/.exec(aturan)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 11;
}

// --- GenerikRun ----------------------------------------------------------------------------------------

export type AksiPermintaan = {
  rencanaHash: string;
  aksi: Aksi[];
  seq?: number | undefined;
  /** Baris lembar dari validator web (sudah diperiksa sessions.ts: placeholder ada di rencana). */
  kolom?: KolomButuh[] | undefined;
};

/** Placeholder vault yang dipakai aksi isi/pilih sebuah rencana (sumber nilai yang butuh persetujuan). */
export function placeholderRencana(aksi: readonly Aksi[]): Set<string> {
  const out = new Set<string>();
  for (const a of aksi)
    if (a.jenis === 'isi' || (a.jenis === 'pilih' && typeof a.nilai === 'string')) out.add(a.nilai as string);
  return out;
}

export class GenerikRun {
  private seq = 0;
  private peta: PetaRef = {};
  private seqTerakhir: number | undefined;
  private kunciAkhir = false;
  /** sidik -> placeholder yang sudah diisi worker (pengamatan menampilkan placeholder, bukan nilai). */
  private readonly diisi = new Map<string, string>();
  /** Nama kolom (sudah diredaksi) per ref dari pengamatan terakhir: label lembar persetujuan. */
  private namaRef = new Map<string, string>();
  /** Pengamatan terakhir (non-pantau): kendali akun untuk pesan giliran masuk. */
  private amatanTerakhir: Pengamatan | undefined;
  /** Kelas kendali per ref dan sinyal halaman dari pengamatan terakhir: dasar kalimat giliran yang tepat. */
  private kelasRef = new Map<string, KelasKendali>();
  private sinyalKini: SinyalHalaman | undefined;
  /** Nama kendali masuk akun (kelas `masuk`) pertama di pengamatan terakhir. */
  private namaMasuk: string | undefined;
  /**
   * Selama satu aksi/navigasi AI: blokir gerbang dan host di luar allowlist yang terjadi karenanya.
   * `muat`: aksi berjalan berupa navigasi GET tanpa klik (mulai, tautan pembuka, tautan navigasi). XHR/fetch tulis
   * yang diblokir selama dokumen tujuan dimuat berasal dari skrip halaman itu sendiri (QA prod gel6 Klampid: POST
   * saat SPA dimulai), bukan dari tombol yang ditekan AI: tetap diblokir dan dicatat, tetapi bukan eskalasi.
   * `situsGalat`: navigasi berakhir di halaman galat Chromium (TLS/DNS/koneksi) -> dipandu, bukan giliran warga.
   */
  private aksiBerjalan:
    | {
        blokir: CatatanBlokir[];
        hostLain: boolean;
        muat?: true;
        situsGalat?: { host: string; net: string; alih: boolean };
      }
    | undefined;
  private antre: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  /**
   * Dokumen "kotor" (review N2): ada tulis non-GET yang diblokir di dokumen ini (timer/retry dari klik AI). Tidak
   * pernah dapat jendela XHR `ai_isi` lagi, dan ketukan warga hanya membuka jendela tulis bila mengenai kontrol
   * (N4). Direset hanya oleh navigasi bingkai utama yang ter-commit (`dokumenBaru`).
   */
  private kotorDok = false;
  private kotorDiserahkan = false;
  /** AI sudah menjalankan aksi di dokumen ini (heartbeat halaman yang belum disentuh AI bukan tulis tertunda AI). */
  private aiBertindakDok = false;
  /** URL terakhir yang dimuat ulang karena kotor (mencegah putaran muat ulang di halaman yang sama). */
  private muatUlangTerakhir: string | undefined;
  /** Jalur CSS elemen yang disorot pada serah terakhir (kotak sorot untuk ketukan warga saat kotor). */
  private sorotJalur: string | undefined;
  /**
   * Ada tulis non-GET oleh warga (lolos di jendela `warga`) sejak aksi AI terakhir di halaman (review N3): syarat
   * halaman sukses diterima sebagai "terkirim".
   */
  private tulisWargaSejakAi = false;
  /**
   * Tulis warga itu menyusul ketukan pada kotak sorot serah `final` atau tombol submit asli di halaman akhir
   * (re-review LOW): hanya ini yang membuat sukses diterima otomatis tanpa /selesai. Tulis warga lain (mis. "cek
   * status") tetap butuh /selesai dari Navigator.
   */
  private kirimFinalWarga = false;
  /** Serah terakhir di dokumen ini beralasan `final` (kotak sorot = tombol kirim akhir). */
  private serahFinal = false;
  /** Ref tautan pembuka di pengamatan terakhir (review N1: serah `ketuk_tautan` hanya ke ref ini). */
  private refPembuka = new Set<string>();
  /** Giliran `ketuk_tautan` yang aktif: ref tautan yang boleh dibuka lewat `buka_tautan` (review N5). */
  private pembukaAktif: string | undefined;
  /** URL absolut (host + jalur + kueri) tujuan yang DITAMPILKAN ke warga untuk giliran `ketuk_tautan` aktif. */
  private pembukaUrl: string | undefined;
  /** Serah akhir `berhenti`: loop Navigator sudah berhenti; Lanjutkan tidak mengembalikan kendali ke AI. */
  private berhentiAkhir = false;
  /** Pengamatan terakhir dokumen INI halaman akhir (direset saat dokumen baru ter-commit; untuk mode ketat). */
  private akhirDok = false;

  constructor(private readonly d: GenerikDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Dokumen bingkai utama baru ter-commit: timer/retry dokumen lama mati, bendera kotor direset. */
  dokumenBaru(): void {
    this.akhirDok = false;
    this.pembukaAktif = undefined;
    this.pembukaUrl = undefined;
    this.kotorDok = false;
    this.kotorDiserahkan = false;
    this.aiBertindakDok = false;
    this.serahFinal = false;
  }

  /**
   * Gerbang tulis meloloskan tulis non-GET warga. `final` = menyusul ketukan warga pada kotak sorot serah `final`
   * atau tombol submit asli di halaman akhir (dinilai peramban).
   */
  tulisWarga(final = false): void {
    this.tulisWargaSejakAi = true;
    if (final) this.kirimFinalWarga = true;
  }

  adaTulisWargaSejakAksiAi(): boolean {
    return this.tulisWargaSejakAi;
  }

  /** Ada kiriman final warga sejak aksi AI terakhir: syarat sukses diterima otomatis (tanpa /selesai). */
  adaKirimFinalWargaSejakAksiAi(): boolean {
    return this.kirimFinalWarga;
  }

  /** Kotak sorot aktif adalah tombol kirim akhir dari serah `final`. */
  get sorotFinal(): boolean {
    return this.serahFinal && this.sorotJalur !== undefined;
  }

  /** Pengamatan terakhir dokumen ini = halaman akhir. */
  get akhir(): boolean {
    return this.akhirDok;
  }

  get kotor(): boolean {
    return this.kotorDok;
  }

  /**
   * Dokumen kotor oleh tulis yang dipicu aksi AI dan belum dimuat ulang (muat ulang sekali per URL sudah dipakai):
   * timer/retry AI mungkin masih hidup, jadi jendela tulis warga hanya untuk kotak sorot atau tombol submit asli.
   */
  get kotorKeras(): boolean {
    return this.kotorDok && this.aiBertindakDok;
  }

  /** Serah akhir `berhenti` aktif (warga melanjutkan sendiri; `kembalikan` tetap giliran warga). */
  get berhenti(): boolean {
    return this.berhentiAkhir;
  }

  /** Eksekusi baru di sesi yang sama (loop Navigator baru): serah akhir sebelumnya tidak berlaku lagi. */
  eksekusiBaru(): void {
    this.berhentiAkhir = false;
  }

  /**
   * Redirect JS/meta halaman sendiri (GET bingkai utama di luar navKe) tidak pernah lolos di dokumen kotor (N2)
   * atau halaman akhir: gerbang memakai ini sebagai mode ketat.
   */
  get ketat(): boolean {
    return this.kotorDok || this.akhirDok;
  }

  /** Kotak sorot terkini (posisi sekarang, mengikuti gulir) dari serah terakhir; undefined bila tidak ada. */
  async kotakSorot(): Promise<PendampingSorot | undefined> {
    return this.sorotJalur ? this.d.tangan.sorot(this.sorotJalur).catch(() => undefined) : undefined;
  }

  /** Dipanggil gerbang tulis setiap kali permintaan dibatalkan (sinkron, dari handler route). */
  blokir(c: CatatanBlokir, j: Exclude<Jendela, { jenis: 'warga' }>): void {
    this.d.jejak({
      jenis: 'blokir',
      metode: c.metode,
      host: c.host,
      jalurSha256: c.jalurSha256,
      jendela: c.jendela,
    });
    // WebSocket ditolak di semua sesi generik (bukan tanda tulis tertunda); selain itu non-GET = kotor.
    if (!AMAN.has(c.metode) && c.metode !== 'WSOCKET') this.kotorDok = true;
    // Isi: navigasi (bingkai mana pun, mis. form POST ke iframe) dan tulis non-XHR (beacon) = eskalasi; XHR yang
    // lewat batas jendela cukup dicatat. Klik: setiap blokir = eskalasi.
    const tulisLain = c.dokumen || !c.xhr;
    if (this.aksiBerjalan) {
      const klikAi = j.jenis === 'ai_klik' && !this.aksiBerjalan.muat;
      if (klikAi || tulisLain) this.aksiBerjalan.blokir.push(c);
      return;
    }
    // Di luar aksi: tulis yang diblokir tepat setelah isi (onchange form.submit(), sendBeacon) = warga.
    if (j.jenis === 'ai_isi' && tulisLain && this.now() <= j.sampai + JENDELA_ISI_MS) {
      this.d.serahkan('periksa', PESAN_GENERIK.kirim_isi);
      return;
    }
    // N2: tulis tertunda (timer/retry dari aksi AI) saat AI diam = halaman kotor -> muat ulang (GET, mematikan
    // timer) lalu serahkan ke warga. Sekali per dokumen.
    if (
      j.jenis === 'ai_diam' &&
      !j.tungguWarga &&
      this.kotorDok &&
      this.aiBertindakDok &&
      !this.kotorDiserahkan
    ) {
      this.kotorDiserahkan = true;
      void this.serahkanKotor();
    }
  }

  /**
   * Muat ulang dokumen kotor lewat GET (mematikan semua timer/retry halaman), sekali per URL per sesi. Dipanggil
   * di dalam `serial`. false = tidak dimuat ulang (URL di luar allowlist atau URL ini sudah pernah dimuat ulang).
   */
  private async muatUlangKotor(): Promise<boolean> {
    // Tanpa fragmen: ketukan tautan `#bantuan` tidak membuat URL "baru" untuk batas sekali per URL.
    const u = URL.parse(this.d.tangan.urlKini());
    if (u) u.hash = '';
    const url = u?.href ?? '';
    if (!url || !this.d.urlBoleh(url) || this.muatUlangTerakhir === url) return false;
    this.muatUlangTerakhir = url;
    this.tulisWargaSejakAi = false;
    this.kirimFinalWarga = false;
    this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: url });
    try {
      await this.d.tangan.navigasi(url);
      await this.d.tangan.tenang();
    } finally {
      this.d.gerbang.setAi({ jenis: 'ai_diam' });
    }
    return true;
  }

  private serahkanKotor(): Promise<void> {
    return this.serial(async () => {
      await this.muatUlangKotor();
      this.sorotJalur = undefined;
      this.serahFinal = false;
      this.d.jejak({ jenis: 'ambil_alih', fase: 'mulai', alasan: 'tidak_yakin' });
      this.d.serahkan('periksa', PESAN_GENERIK.kotor);
    });
  }

  /** Host terakhir yang ditolak proxy egress (proxy tidak tahu dokumen/subresource): calon host kandidat. */
  private hostDitolakTerakhir: string | undefined;

  /**
   * Allowlist egress menolak permintaan ke host di luar sesi. `dokumen` true = navigasi bingkai utama dari lapis
   * rute: selama aksi AI = host kandidat + serah ke warga; di luar aksi cukup dicatat. `undefined` = dari proxy
   * (mis. hop redirect 302, yang tidak melewati rute): hanya diingat; eskalasi diputuskan dari URL dokumen
   * setelah navigasi (`keluarAllowlist`).
   */
  hostDiblokir(host: string, dokumen: boolean | undefined): void {
    if (dokumen === undefined) {
      this.hostDitolakTerakhir = host.slice(0, 253);
      return;
    }
    if (!dokumen) return;
    this.d.jejak({ jenis: 'host_kandidat', host: host.slice(0, 253) });
    if (this.aksiBerjalan) this.aksiBerjalan.hostLain = true;
  }

  /**
   * Setelah klik/navigasi AI: dokumen utama berakhir di luar allowlist (redirect ke host lain = halaman galat
   * atau halaman tolak proxy)? Catat host kandidat, kembalikan peramban ke halaman sebelumnya (GET ke URL yang
   * sudah lolos allowlist), dan tandai aksi untuk diserahkan ke warga.
   */
  private async keluarAllowlist(urlSebelum: string | undefined, tujuan?: string): Promise<void> {
    const kini = this.d.tangan.urlKini();
    // Halaman galat Chromium (sertifikat, DNS, koneksi): situs resmi itu sendiri bermasalah, BUKAN host di luar
    // allowlist. Tanpa halaman sebelumnya yang sah, galat apa pun tidak pernah diserahkan ke warga.
    if (this.aksiBerjalan && halamanGalatChrome(kini)) {
      const net = this.d.tangan.galatNav?.();
      const sah = urlSebelum !== undefined && this.d.urlBoleh(urlSebelum);
      if (galatSitus(net) || !sah) {
        const host = URL.parse(tujuan ?? urlSebelum ?? '')?.host || 'resmi';
        // Proxy menolak hop redirect ke host lain: tetap dipandu (halaman galat tidak diserahkan), host dicatat.
        const lain = galatSitus(net) ? undefined : this.hostDitolakTerakhir;
        if (lain) this.d.jejak({ jenis: 'host_kandidat', host: lain });
        this.aksiBerjalan.situsGalat = { host, net: net ?? 'net::ERR_FAILED', alih: lain !== undefined };
        return;
      }
    }
    if (!this.aksiBerjalan || this.d.urlBoleh(kini)) return;
    const u = URL.parse(kini);
    const host = u && /^https?:$/.test(u.protocol) ? u.host : this.hostDitolakTerakhir;
    if (host) this.d.jejak({ jenis: 'host_kandidat', host: host.slice(0, 253) });
    this.aksiBerjalan.hostLain = true;
    if (urlSebelum && this.d.urlBoleh(urlSebelum)) {
      this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: urlSebelum });
      await this.d.tangan.navigasi(urlSebelum);
      await this.d.tangan.tenang();
    }
  }

  /** Serialkan amati/aksi: satu operasi halaman pada satu waktu. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.antre.then(f, f);
    this.antre = p.catch(() => {});
    return p;
  }

  /** `pantau` = baca-saja: tanpa jejak, peta ref/kunci halaman akhir tetap milik pengamatan terakhir. */
  amati(pantau = false): Promise<Pengamatan | null> {
    return this.serial(() => this.amatiSekarang(pantau));
  }

  private async amatiSekarang(pantau: boolean, menuDibuka = false): Promise<Pengamatan | null> {
    if (!pantau) this.d.fase?.('membaca');
    const seq = ++this.seq;
    let r = await this.d.tangan.amati(seq, Object.fromEntries(this.diisi));
    // SPA yang baru merender setelah load (probe 3208): 0 elemen = tunggu DOM tenang lalu amati sekali lagi.
    if (r && (r.pengamatan as { elemen?: unknown[] }).elemen?.length === 0) {
      await this.d.tangan.tenang();
      r = await this.d.tangan.amati(seq, Object.fromEntries(this.diisi));
    }
    // Masih banyak konten transparan sesudah batas tunggu fade-in (probe gel5 6171): tunggu sekali lagi lalu amati
    // ulang. Pantau baca-saja tidak menunggu.
    if (r && !pantau && (await this.d.tangan.belumTampil?.())) {
      await this.d.tangan.tenang();
      r = (await this.d.tangan.amati(seq, Object.fromEntries(this.diisi))) ?? r;
    }
    if (!r) return null;
    const vault = [...this.d.izin.vault()];
    const parsed = PengamatanSchema.safeParse(r.pengamatan);
    if (!parsed.success) return null;
    const p = redaksiPengamatan({ ...parsed.data, seq }, vault);
    const cek = PengamatanSchema.safeParse(p);
    if (!cek.success) return null;
    if (pantau) return cek.data;
    // Tanpa kendali masuk yang terlihat: mungkin tombol masuknya disembunyikan di layar ponsel (probe gel4 3279;
    // gel5 3402: beranda berisi banyak tautan, bukan halaman polos). Tangan memeriksa sendiri kendali masuk yang
    // tersembunyi dan melebarkan viewport hanya bila itu benar-benar memunculkannya.
    const tanpaMasuk =
      !cek.data.sinyal.login &&
      !cek.data.elemen.some((e) => e.kelas === 'masuk') &&
      kendaliAkun(cek.data.elemen).masuk === undefined;
    if (tanpaMasuk && (await this.d.tangan.lebarkan?.())) return this.amatiSekarang(false, menuDibuka);
    // Kendali masuk di menu hamburger yang tertutup (QA prod Depok): menu dibuka sekali (klik panel lokal, tanpa
    // permintaan tulis), lalu halaman diamati ulang dengan kendali masuk terlihat.
    if (tanpaMasuk && !menuDibuka && (await this.d.tangan.bukaMenuMasuk?.()))
      return this.amatiSekarang(false, true);
    this.peta = r.peta;
    this.seqTerakhir = seq;
    this.kunciAkhir = cek.data.sinyal.halamanAkhir;
    this.akhirDok = cek.data.sinyal.halamanAkhir;
    this.namaRef = new Map(cek.data.elemen.map((e) => [e.ref, e.nama]));
    this.kelasRef = new Map(
      cek.data.elemen.flatMap((e): [string, KelasKendali][] => (e.kelas ? [[e.ref, e.kelas]] : [])),
    );
    this.sinyalKini = cek.data.sinyal;
    this.namaMasuk = cek.data.elemen.find((e) => e.kelas === 'masuk')?.nama;
    this.refPembuka = new Set(cek.data.elemen.filter((e) => e.tautanPembuka).map((e) => e.ref));
    this.amatanTerakhir = cek.data;
    this.pembukaAktif = undefined;
    this.d.jejak({
      jenis: 'amati',
      host: cek.data.host,
      sidik: cek.data.sidik,
      elemen: cek.data.elemen.length,
    });
    return cek.data;
  }

  aksi(req: AksiPermintaan): Promise<HasilAksi[]> {
    return this.serial(() => this.aksiSekarang(req));
  }

  private async aksiSekarang(req: AksiPermintaan): Promise<HasilAksi[]> {
    const { aksi, rencanaHash } = req;
    // Ref dari pengamatan lain (atau belum ada pengamatan) tidak pernah dijalankan.
    if (this.seqTerakhir === undefined || (req.seq !== undefined && req.seq !== this.seqTerakhir)) {
      const pertama = aksi.findIndex((a) => 'ref' in a && a.ref !== undefined);
      if (pertama >= 0)
        return aksi.map((_, indeks) => ({
          indeks,
          kode:
            indeks === pertama ? (this.seqTerakhir === undefined ? 'REF_TIDAK_ADA' : 'REF_BASI') : 'DILEWATI',
        }));
    }

    // Lihat saja (demo, situs asli): tolak tulisan dan klik yang bukan navigasi murni sebelum apa pun dijalankan
    // (termasuk lembar izin). Aksi pertama yang ditolak menghentikan rencana; sisanya DILEWATI.
    if (this.d.lihatSaja) {
      const tolak = aksi.findIndex((a) => this.ditolakLihatSaja(a) !== undefined);
      if (tolak >= 0)
        return aksi.map((a, indeks) => ({
          indeks,
          kode: indeks === tolak ? this.ditolakLihatSaja(a)! : 'DILEWATI',
        }));
    }

    // Pra-periksa persetujuan: pasangan (sidik, placeholder) dan berkas untuk rencana INI.
    const perluIzin = new Set<number>();
    const kolom: KolomIzin[] = [];
    const berkas: string[] = [];
    aksi.forEach((a, i) => {
      if (a.jenis === 'isi' || (a.jenis === 'pilih' && typeof a.nilai === 'string')) {
        const ph = a.nilai as string;
        const sidik = this.peta[a.ref]?.sidik;
        if (sidik === undefined) return;
        if (this.d.izin.disetujui(rencanaHash, sidik, ph) && this.d.izin.nilai(ph) !== undefined) return;
        perluIzin.add(i);
        // Baris dari validator web bila ada (label + tidakLazim); selain itu dari label pengamatan.
        // tidakLazim = OR keduanya: penanda keamanan tidak pernah hilang karena sumber lain.
        const namaAmatan = (this.namaRef.get(a.ref) ?? '').slice(0, 120);
        const web =
          req.kolom?.find((k) => k.placeholder === ph && k.labelPortal === namaAmatan) ??
          req.kolom?.find((k) => k.placeholder === ph);
        const labelPortal = web?.labelPortal ?? namaAmatan;
        const lazimTidak = web?.tidakLazim === true || tidakLazim(ph, labelPortal);
        kolom.push({ placeholder: ph, labelPortal, ...(lazimTidak ? { tidakLazim: true } : {}), sidik });
      } else if (a.jenis === 'unggah') {
        if (this.d.izin.berkasDisetujui(rencanaHash, a.berkas) && this.d.izin.berkas(a.berkas)) return;
        perluIzin.add(i);
        if (!berkas.includes(a.berkas)) berkas.push(a.berkas);
      }
    });
    if (perluIzin.size > 0) {
      // Tidak ada aksi yang dijalankan sebelum seluruh rencana disetujui.
      const halaman = URL.parse(this.d.tangan.urlKini());
      const origin = halaman && this.d.urlBoleh(halaman.href) ? halaman.origin : undefined;
      this.d.izin.minta({ rencanaHash, kolom, berkas, origin });
      return aksi.map((_, indeks) => ({
        indeks,
        kode: perluIzin.has(indeks) ? 'BELUM_DISETUJUI' : 'DILEWATI',
      }));
    }

    if (
      aksi.some(
        (a) => a.jenis === 'isi' || a.jenis === 'pilih' || a.jenis === 'centang' || a.jenis === 'unggah',
      )
    )
      this.d.fase?.('mengisi');
    else if (aksi.some((a) => a.jenis === 'klik')) this.d.fase?.('membuka');
    const hasil: HasilAksi[] = [];
    let berhenti = false;
    for (const [indeks, a] of aksi.entries()) {
      if (berhenti) {
        hasil.push({ indeks, kode: 'DILEWATI' });
        continue;
      }
      const h = await this.satu(a, rencanaHash);
      hasil.push({ indeks, kode: h.kode, ...(h.kelas ? { kelas: h.kelas } : {}) });
      if (h.kode !== 'ok' || h.halamanBerganti) berhenti = true;
    }
    // Jendela ai_isi dibiarkan habis sendiri (autosave XHR <= 3 detik); klik sudah kembali ke ai_diam.
    return hasil;
  }

  /** Kode penolakan mode lihat saja untuk satu aksi, atau undefined bila boleh. */
  private ditolakLihatSaja(a: Aksi): KodeHasilAksi | undefined {
    if (a.jenis === 'isi' || a.jenis === 'pilih' || a.jenis === 'centang' || a.jenis === 'unggah')
      return 'TERLARANG';
    if (a.jenis !== 'klik') return undefined;
    if (this.kunciAkhir) return 'HALAMAN_AKHIR';
    // Tautan pembuka dibuka lewat navigasi GET ke href (bukan klik); kelas lain harus navigasi murni.
    if (this.refPembuka.has(a.ref)) return undefined;
    const kelas = this.kelasRef.get(a.ref);
    return kelas !== undefined && KELAS_BOLEH_KLIK_LIHAT_SAJA.includes(kelas) ? undefined : 'KELAS_DITOLAK';
  }

  private async satu(
    a: Aksi,
    rencanaHash: string,
  ): Promise<{ kode: KodeHasilAksi; kelas?: KelasKendali; halamanBerganti?: boolean }> {
    if (a.jenis === 'serahkan') {
      const ref = a.ref ? this.peta[a.ref] : undefined;
      let tautan: TautanGiliran | undefined;
      let tujuan: URL | undefined;
      if (a.alasan === 'ketuk_tautan') {
        // Review N1: hanya tautan pembuka dari pengamatan terakhir, tidak pernah di halaman akhir (tombol kirim
        // tidak bisa disorot sebagai "tautan"). Tujuan dibaca ulang dari DOM untuk ditampilkan ke warga (N5).
        if (this.kunciAkhir || !a.ref || !ref || !this.refPembuka.has(a.ref))
          return { kode: 'KELAS_DITOLAK' };
        tujuan = await this.tautanUrl(a.ref);
        if (!tujuan) return { kode: 'KELAS_DITOLAK' };
        tautan = this.tautanGiliran(a.ref, tujuan);
      }
      const sorot = ref ? await this.d.tangan.sorot(ref.jalur) : undefined;
      this.sorotJalur = ref?.jalur;
      this.serahFinal = a.alasan === 'final';
      this.pembukaAktif = tautan ? a.ref : undefined;
      this.pembukaUrl = tujuan?.href;
      this.berhentiAkhir = a.alasan === 'berhenti';
      this.d.jejak({ jenis: 'ambil_alih', fase: 'mulai', alasan: a.alasan });
      const namaRef = a.ref ? this.namaRef.get(a.ref) : undefined;
      const pesan =
        a.alasan === 'ketuk_tautan'
          ? PESAN_GENERIK.ketuk_tautan
          : a.alasan === 'berhenti' && this.d.lihatSaja
            ? PESAN_LIHAT_SAJA
            : (this.pesanGiliran(a.alasan, a.ref) ?? pesanSerah(a.alasan, namaRef, sorot !== undefined));
      this.d.serahkan(ALASAN_GILIRAN[a.alasan], pesan, sorot, tautan, namaKendali(namaRef));
      return { kode: 'ok', halamanBerganti: true };
    }
    if (a.jenis === 'tidak_bisa') {
      this.d.tidakBisa(PESAN_TIDAK_BISA[a.sebab]);
      return { kode: 'ok', halamanBerganti: true };
    }
    const ref = this.peta[a.ref];
    if (!ref) return { kode: 'REF_TIDAK_ADA' };

    // Tautan pembuka (GET, `kirim` hanya karena namanya): dibuka lewat navigasi GET ke href-nya, bukan klik.
    if (a.jenis === 'klik' && this.refPembuka.has(a.ref)) return this.bukaPembuka(a.ref, ref);
    if (a.jenis === 'klik') return this.klik(a.ref, ref);

    let op: AksiRunner;
    switch (a.jenis) {
      case 'isi':
      case 'pilih': {
        if (typeof a.nilai !== 'string') {
          op = { jenis: 'pilih', ref: a.ref, opsi: a.nilai.opsi };
          break;
        }
        const nilai = this.d.izin.nilai(a.nilai);
        if (!this.d.izin.disetujui(rencanaHash, ref.sidik, a.nilai) || nilai === undefined)
          return { kode: 'BELUM_DISETUJUI' };
        op = { jenis: a.jenis, ref: a.ref, placeholder: a.nilai, nilai };
        break;
      }
      case 'centang':
        // Kunci halaman akhir juga untuk centang (review N7); runner memeriksa ulang dari DOM.
        if (this.kunciAkhir) return { kode: 'HALAMAN_AKHIR' };
        op = { jenis: 'centang', ref: a.ref, nilai: a.nilai };
        break;
      case 'unggah': {
        const f = this.d.izin.berkas(a.berkas);
        if (!this.d.izin.berkasDisetujui(rencanaHash, a.berkas) || !f) return { kode: 'BELUM_DISETUJUI' };
        op = { jenis: 'unggah', ref: a.ref, berkas: f };
        break;
      }
    }
    // Halaman kotor: tanpa jendela XHR (tulis tertunda dari klik AI tidak boleh menumpang jendela isi).
    this.d.gerbang.setAi(
      this.kotorDok ? { jenis: 'ai_diam' } : { jenis: 'ai_isi', sampai: this.now() + JENDELA_ISI_MS },
    );
    const h = await this.jalankan(op, ref);
    if (h.kode === 'ok' && 'placeholder' in op) this.diisi.set(ref.sidik, op.placeholder);
    return h;
  }

  /** Jalankan satu op di halaman; blokir gerbang selama aksi = eskalasi ke warga dengan kontrol disorot. */
  private async jalankan(
    op: AksiRunner,
    ref: RefTersimpan,
  ): Promise<{ kode: KodeHasilAksi; kelas?: KelasKendali; halamanBerganti?: boolean }> {
    this.aksiBerjalan = { blokir: [], hostLain: false };
    this.hostDitolakTerakhir = undefined;
    this.aiBertindakDok = true;
    this.tulisWargaSejakAi = false;
    this.kirimFinalWarga = false;
    const urlSebelum = this.d.tangan.urlKini();
    try {
      const r = await this.d.tangan.aksi(op, this.peta);
      if (op.jenis === 'klik' && r) this.catatKlik(op.ref, r);
      if (!r) return { kode: 'GALAT' };
      const kelas = r.kelas && KelasKendaliSchema.safeParse(r.kelas).success ? r.kelas : undefined;
      if (r.status === 'navigasi') return await this.navigasi(r.href, ref, kelas, urlSebelum, op.ref);
      const kode = kodeDari(r);
      if (kode === 'ok' && op.jenis === 'klik') {
        await this.d.tangan.tenang();
        await this.keluarAllowlist(urlSebelum);
      }
      if (await this.eskalasiBila(ref, op.ref))
        return { kode: 'GERBANG_MEMBLOKIR', ...(kelas ? { kelas } : {}) };
      return {
        kode,
        ...(kelas ? { kelas } : {}),
        ...(op.jenis === 'klik' && kelas !== 'ui_lokal' ? { halamanBerganti: true } : {}),
      };
    } finally {
      this.aksiBerjalan = undefined;
    }
  }

  private async eskalasiBila(ref: RefTersimpan | undefined, refId?: string): Promise<boolean> {
    const a = this.aksiBerjalan;
    if (a?.situsGalat) {
      const { host, net, alih } = a.situsGalat;
      this.d.tidakBisa(alih ? pesanAlihLuar(host) : pesanSitusBermasalah(host, net));
      return true;
    }
    if (!a || (a.blokir.length === 0 && !a.hostLain)) return false;
    // Re-review A2: tulis AI yang diblokir bisa meninggalkan timer/retry (setInterval) yang terus mencoba. Dokumen
    // dimuat ulang SEBELUM warga memegang kendali agar timer itu mati; bila tidak bisa (sekali per URL), jendela
    // tulis warga hanya untuk kotak sorot atau tombol submit asli (`kotorKeras`).
    let dimuatUlang = false;
    if (this.kotorDok && this.aiBertindakDok) {
      dimuatUlang = await this.muatUlangKotor();
      if (!dimuatUlang) this.kotorDiserahkan = true;
    }
    const sorot = ref ? await this.d.tangan.sorot(ref.jalur).catch(() => undefined) : undefined;
    this.sorotJalur = ref?.jalur;
    this.serahFinal = false;
    const k = this.konteks(refId, sorot);
    const pesan = a.hostLain ? PESAN_GENERIK.hostLain : pesanEskalasi(k, dimuatUlang);
    this.d.serahkan('periksa', pesan, sorot, undefined, kendaliEskalasi(k));
    return true;
  }

  /**
   * Pesan giliran masuk akun (nama portal, Masuk didahulukan dari Daftar) dan petunjuk saat AI tidak maju.
   * undefined = pakai `pesanSerah` (mis. serah masuk akun yang menyorot kendali bukan kendali akun).
   */
  private pesanGiliran(
    alasan: Extract<Aksi, { jenis: 'serahkan' }>['alasan'],
    ref: string | undefined,
  ): string | undefined {
    const p = this.amatanTerakhir;
    if (alasan === 'tidak_yakin' && ref) return pesanPetunjuk(this.namaRef.get(ref));
    if (alasan !== 'masuk_akun' || !p) return undefined;
    const akun = kendaliAkun(p.elemen);
    const formulir = p.sinyal.login;
    const masuk: ElemenAmatan | undefined = ref ? p.elemen.find((e) => e.ref === ref) : undefined;
    const masukAkun = masuk && kendaliAkun([masuk]).masuk ? masuk : undefined;
    if (masuk && !masukAkun && !formulir) return undefined;
    return pesanMasukAkun({
      portal: namaPortal(p.host, p.judul),
      masuk: formulir ? undefined : masukAkun?.nama,
      daftar: akun.daftar?.nama,
      formulir,
      captcha: p.sinyal.captcha,
      verifikasi: p.sinyal.tantangan,
    });
  }

  /**
   * Tautan pembuka GET di host allowlist (QA prod gel6: "Login / Register", "Perpindahan Keluar"): href dibaca ulang
   * dari DOM lalu dibuka lewat navigasi GET bingkai utama (jendela `ai_klik` dengan navKe), tanpa klik dan tanpa
   * handler JS halaman. Halaman akhir tetap terkunci; gerbang tulis tetap menjaga.
   */
  private async bukaPembuka(refId: string, ref: RefTersimpan) {
    if (this.kunciAkhir) return { kode: 'HALAMAN_AKHIR' as const };
    const u = await this.tautanUrl(refId);
    if (!u) return { kode: 'KELAS_DITOLAK' as const };
    this.d.jejak({
      jenis: 'klik',
      ref: refId,
      kelas: 'kirim',
      aturan: ATURAN_PEMBUKA_GET,
      fitur: ['tautanPembuka', 'navigasiGet'],
      putusan: 'izinkan',
    });
    this.aksiBerjalan = { blokir: [], hostLain: false };
    this.hostDitolakTerakhir = undefined;
    this.aiBertindakDok = true;
    this.tulisWargaSejakAi = false;
    this.kirimFinalWarga = false;
    try {
      return await this.navigasi(u.href, ref, undefined, this.d.tangan.urlKini(), refId);
    } finally {
      this.aksiBerjalan = undefined;
      this.d.gerbang.setAi({ jenis: 'ai_diam' });
    }
  }

  /** Konteks kalimat giliran dari pengamatan terakhir: nama/kelas kendali pemicu, sorotan, sinyal halaman. */
  private konteks(refId: string | undefined, sorot: PendampingSorot | undefined): KonteksGiliran {
    return {
      nama: refId ? this.namaRef.get(refId) : undefined,
      kelas: refId ? this.kelasRef.get(refId) : undefined,
      disorot: sorot !== undefined,
      masuk: this.namaMasuk,
      sinyal: this.sinyalKini,
    };
  }

  private async klik(refId: string, ref: RefTersimpan) {
    // Kunci halaman akhir: tidak ada klik AI sama sekali, tanpa menyentuh halaman.
    if (this.kunciAkhir) return { kode: 'HALAMAN_AKHIR' as const };
    this.d.gerbang.setAi({ jenis: 'ai_klik' });
    try {
      return await this.jalankan(
        { jenis: 'klik', ref: refId, ...(this.d.lihatSaja ? { lihatSaja: true as const } : {}) },
        ref,
      );
    } finally {
      this.d.gerbang.setAi({ jenis: 'ai_diam' });
    }
  }

  private async navigasi(
    href: string | undefined,
    ref: RefTersimpan,
    kelas: KelasKendali | undefined,
    urlSebelum: string,
    refId?: string,
  ) {
    const k = kelas ? { kelas } : {};
    const u = href ? URL.parse(naikHttps(href, this.d.urlBoleh) ?? href) : null;
    if (!u || !this.d.urlBoleh(u.href)) {
      if (u?.host) this.d.jejak({ jenis: 'host_kandidat', host: u.host.slice(0, 253) });
      const sorot = await this.d.tangan.sorot(ref.jalur).catch(() => undefined);
      this.d.serahkan('periksa', PESAN_GENERIK.hostLain, sorot);
      return { kode: 'GERBANG_MEMBLOKIR' as const, ...k };
    }
    u.hash = '';
    if (this.aksiBerjalan) this.aksiBerjalan.muat = true;
    this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: u.href });
    await this.d.tangan.navigasi(u.href);
    await this.d.tangan.tenang();
    await this.keluarAllowlist(urlSebelum, u.href);
    if (await this.eskalasiBila(ref, refId)) return { kode: 'GERBANG_MEMBLOKIR' as const, ...k };
    return { kode: 'ok' as const, ...k, halamanBerganti: true };
  }

  /** Href tautan pembuka yang lolos allowlist, dalam bentuk yang ditampilkan ke warga (jalur diredaksi). */
  private async tautanUrl(ref: string): Promise<URL | undefined> {
    const href = await this.d.tangan.tautan(ref, this.peta);
    const u = href ? URL.parse(naikHttps(href, this.d.urlBoleh) ?? href) : null;
    if (!u || !this.d.urlBoleh(u.href)) return undefined;
    u.hash = '';
    return u;
  }

  private tautanGiliran(ref: string, u: URL): TautanGiliran {
    const jalur = redaksi(decodeURIComponentAman(u.pathname), this.d.izin.vault()).slice(0, 200) || '/';
    return { ref, nama: (this.namaRef.get(ref) ?? '').slice(0, 80), host: u.host, jalur };
  }

  /**
   * Warga menekan "Buka tautan" (pesan `buka_tautan`, review N5) pada giliran `ketuk_tautan` yang aktif: href dibaca
   * ulang dari DOM, `lanjut()` mengembalikan kendali ke AI, lalu navigasi GET bingkai utama ke href itu (jendela
   * `ai_klik` dengan navKe), tanpa klik dan tanpa handler JS halaman. false = tidak ada giliran itu / tautan berubah.
   * Re-review TOCTOU (PoC E3): href yang dibaca ulang harus SAMA PERSIS (host + jalur + kueri) dengan tujuan yang
   * ditampilkan ke warga; bila halaman menukarnya, tidak dibuka dan giliran tetap di warga dengan pesan netral.
   */
  bukaTautan(refWarga: string, lanjut: () => void): Promise<boolean> {
    return this.serial(async () => {
      const ref = this.pembukaAktif;
      // Hanya ref tautan pembuka yang sedang disorot; ref lain tidak menghabiskan giliran.
      if (!ref || ref !== refWarga) return false;
      const ditampilkan = this.pembukaUrl;
      this.pembukaAktif = undefined;
      this.pembukaUrl = undefined;
      if (this.kunciAkhir) return false;
      const u = await this.tautanUrl(ref);
      if (!u || u.href !== ditampilkan) {
        this.d.serahkan('periksa', PESAN_GENERIK.tautan_berubah);
        return false;
      }
      lanjut();
      this.aiBertindakDok = true;
      this.tulisWargaSejakAi = false;
      this.kirimFinalWarga = false;
      this.aksiBerjalan = { blokir: [], hostLain: false, muat: true };
      this.hostDitolakTerakhir = undefined;
      const urlSebelum = this.d.tangan.urlKini();
      try {
        this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: u.href });
        await this.d.tangan.navigasi(u.href);
        await this.d.tangan.tenang();
        await this.keluarAllowlist(urlSebelum, u.href);
        this.d.gerbang.setAi({ jenis: 'ai_diam' });
        await this.eskalasiBila(ref ? this.peta[ref] : undefined);
      } finally {
        this.aksiBerjalan = undefined;
        this.d.gerbang.setAi({ jenis: 'ai_diam' });
      }
      return true;
    });
  }

  /** Halaman awal sesi (origin program): navigasi AI ke URL persis itu saja. */
  async mulai(url: string): Promise<void> {
    await this.serial(async () => {
      this.aksiBerjalan = { blokir: [], hostLain: false, muat: true };
      this.hostDitolakTerakhir = undefined;
      this.tulisWargaSejakAi = false;
      this.kirimFinalWarga = false;
      try {
        this.d.fase?.('membuka');
        this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: url });
        await this.d.tangan.navigasi(url);
        await this.d.tangan.tenang();
        await this.keluarAllowlist(undefined, url);
        this.d.gerbang.setAi({ jenis: 'ai_diam' });
        await this.eskalasiBila(undefined);
      } finally {
        this.aksiBerjalan = undefined;
      }
    });
  }

  private catatKlik(ref: string, r: HasilRunner): void {
    const kelas = KelasKendaliSchema.safeParse(r.kelas);
    if (!kelas.success) return;
    const izinkan =
      (r.status === 'ok' || r.status === 'navigasi') &&
      (this.d.lihatSaja ? KELAS_BOLEH_KLIK_LIHAT_SAJA : KELAS_BOLEH_KLIK_AI).includes(kelas.data);
    this.d.jejak({
      jenis: 'klik',
      ref,
      kelas: kelas.data,
      aturan: nomorAturan(r.aturan),
      fitur: tokenFitur(r.fitur),
      putusan: izinkan ? 'izinkan' : 'tolak',
    });
  }
}

function kodeDari(r: HasilRunner): KodeHasilAksi {
  switch (r.status) {
    case 'ok':
      return 'ok';
    case 'dilewati':
      return 'DILEWATI';
    case 'ditolak':
      if (r.kode === 'HALAMAN_AKHIR') return 'HALAMAN_AKHIR';
      if (r.kode === 'TERLARANG') return 'TERLARANG';
      return 'KELAS_DITOLAK';
    case 'gagal':
      if (r.kode === 'REF_BASI') return 'REF_BASI';
      if (r.kode === 'REF_TIDAK_DIKENAL') return 'REF_TIDAK_ADA';
      return 'GALAT';
    default:
      return 'GALAT';
  }
}
