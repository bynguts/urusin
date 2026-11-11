import {
  KELAS_BOLEH_KLIK_AI,
  KelasKendaliSchema,
  PengamatanSchema,
  type Aksi,
  type CatatanPendamping,
  type HasilAksi,
  type KelasKendali,
  type KodeHasilAksi,
  type KolomButuh,
  type PendampingEvent,
  type PendampingSorot,
  type Pengamatan,
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
export function tanganRunner(deps: {
  evaluate(op: unknown): Promise<{ ok: true; value?: unknown } | { ok: false; code: string } | 'interrupted'>;
  navigasi(url: string): Promise<void>;
  tenang(): Promise<void>;
  urlKini(): string;
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
  serahkan(alasan: AlasanGiliran, pesan: string, sorot?: PendampingSorot, tautan?: TautanGiliran): void;
  /** Situs tidak bisa dikerjakan otomatis: sesi beralih ke mode dipandu. */
  tidakBisa(pesan: string): void;
  now?: () => number;
};

// --- Pesan bertemplat (tidak pernah teks LLM) -------------------------------------------------------

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
  berhenti: 'AI berhenti di sini. Lanjutkan sendiri dari layar ini.',
  tautan_berubah:
    'Alamat tautan ini berubah setelah ditampilkan, jadi tidak dibuka. Periksa halaman, lalu lanjutkan sendiri.',
} as const;

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
  /** Selama satu aksi/navigasi AI: blokir gerbang dan host di luar allowlist yang terjadi karenanya. */
  private aksiBerjalan: { blokir: CatatanBlokir[]; hostLain: boolean } | undefined;
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
  }

  /** Gerbang tulis meloloskan tulis non-GET warga. */
  tulisWarga(): void {
    this.tulisWargaSejakAi = true;
  }

  adaTulisWargaSejakAksiAi(): boolean {
    return this.tulisWargaSejakAi;
  }

  get kotor(): boolean {
    return this.kotorDok;
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
      if (j.jenis === 'ai_klik' || tulisLain) this.aksiBerjalan.blokir.push(c);
      return;
    }
    // Di luar aksi: tulis yang diblokir tepat setelah isi (onchange form.submit(), sendBeacon) = warga.
    if (j.jenis === 'ai_isi' && tulisLain && this.now() <= j.sampai + JENDELA_ISI_MS) {
      this.d.serahkan('periksa', PESAN_GENERIK.periksa);
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

  private serahkanKotor(): Promise<void> {
    return this.serial(async () => {
      const url = this.d.tangan.urlKini();
      if (this.d.urlBoleh(url) && this.muatUlangTerakhir !== url) {
        this.muatUlangTerakhir = url;
        this.tulisWargaSejakAi = false;
        this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: url });
        try {
          await this.d.tangan.navigasi(url);
          await this.d.tangan.tenang();
        } finally {
          this.d.gerbang.setAi({ jenis: 'ai_diam' });
        }
      }
      this.sorotJalur = undefined;
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
  private async keluarAllowlist(urlSebelum: string | undefined): Promise<void> {
    const kini = this.d.tangan.urlKini();
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

  private async amatiSekarang(pantau: boolean): Promise<Pengamatan | null> {
    const seq = ++this.seq;
    let r = await this.d.tangan.amati(seq, Object.fromEntries(this.diisi));
    // SPA yang baru merender setelah load (probe 3208): 0 elemen = tunggu DOM tenang lalu amati sekali lagi.
    if (r && (r.pengamatan as { elemen?: unknown[] }).elemen?.length === 0) {
      await this.d.tangan.tenang();
      r = await this.d.tangan.amati(seq, Object.fromEntries(this.diisi));
    }
    if (!r) return null;
    const vault = [...this.d.izin.vault()];
    const parsed = PengamatanSchema.safeParse(r.pengamatan);
    if (!parsed.success) return null;
    const p = redaksiPengamatan({ ...parsed.data, seq }, vault);
    const cek = PengamatanSchema.safeParse(p);
    if (!cek.success) return null;
    if (pantau) return cek.data;
    this.peta = r.peta;
    this.seqTerakhir = seq;
    this.kunciAkhir = cek.data.sinyal.halamanAkhir;
    this.akhirDok = cek.data.sinyal.halamanAkhir;
    this.namaRef = new Map(cek.data.elemen.map((e) => [e.ref, e.nama]));
    this.refPembuka = new Set(cek.data.elemen.filter((e) => e.tautanPembuka).map((e) => e.ref));
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
      this.pembukaAktif = tautan ? a.ref : undefined;
      this.pembukaUrl = tujuan?.href;
      this.berhentiAkhir = a.alasan === 'berhenti';
      this.d.jejak({ jenis: 'ambil_alih', fase: 'mulai', alasan: a.alasan });
      this.d.serahkan(ALASAN_GILIRAN[a.alasan], PESAN_GENERIK[a.alasan], sorot, tautan);
      return { kode: 'ok', halamanBerganti: true };
    }
    if (a.jenis === 'tidak_bisa') {
      this.d.tidakBisa(PESAN_TIDAK_BISA[a.sebab]);
      return { kode: 'ok', halamanBerganti: true };
    }
    const ref = this.peta[a.ref];
    if (!ref) return { kode: 'REF_TIDAK_ADA' };

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
    const urlSebelum = this.d.tangan.urlKini();
    try {
      const r = await this.d.tangan.aksi(op, this.peta);
      if (op.jenis === 'klik' && r) this.catatKlik(op.ref, r);
      if (!r) return { kode: 'GALAT' };
      const kelas = r.kelas && KelasKendaliSchema.safeParse(r.kelas).success ? r.kelas : undefined;
      if (r.status === 'navigasi') return await this.navigasi(r.href, ref, kelas, urlSebelum);
      const kode = kodeDari(r);
      if (kode === 'ok' && op.jenis === 'klik') {
        await this.d.tangan.tenang();
        await this.keluarAllowlist(urlSebelum);
      }
      if (await this.eskalasiBila(ref)) return { kode: 'GERBANG_MEMBLOKIR', ...(kelas ? { kelas } : {}) };
      return {
        kode,
        ...(kelas ? { kelas } : {}),
        ...(op.jenis === 'klik' && kelas !== 'ui_lokal' ? { halamanBerganti: true } : {}),
      };
    } finally {
      this.aksiBerjalan = undefined;
    }
  }

  private async eskalasiBila(ref: RefTersimpan | undefined): Promise<boolean> {
    const a = this.aksiBerjalan;
    if (!a || (a.blokir.length === 0 && !a.hostLain)) return false;
    const sorot = ref ? await this.d.tangan.sorot(ref.jalur).catch(() => undefined) : undefined;
    this.sorotJalur = ref?.jalur;
    this.d.serahkan('periksa', a.hostLain ? PESAN_GENERIK.hostLain : PESAN_GENERIK.periksa, sorot);
    return true;
  }

  private async klik(refId: string, ref: RefTersimpan) {
    // Kunci halaman akhir: tidak ada klik AI sama sekali, tanpa menyentuh halaman.
    if (this.kunciAkhir) return { kode: 'HALAMAN_AKHIR' as const };
    this.d.gerbang.setAi({ jenis: 'ai_klik' });
    try {
      return await this.jalankan({ jenis: 'klik', ref: refId }, ref);
    } finally {
      this.d.gerbang.setAi({ jenis: 'ai_diam' });
    }
  }

  private async navigasi(
    href: string | undefined,
    ref: RefTersimpan,
    kelas: KelasKendali | undefined,
    urlSebelum: string,
  ) {
    const k = kelas ? { kelas } : {};
    const u = href ? URL.parse(href) : null;
    if (!u || !this.d.urlBoleh(u.href)) {
      if (u?.host) this.d.jejak({ jenis: 'host_kandidat', host: u.host.slice(0, 253) });
      const sorot = await this.d.tangan.sorot(ref.jalur).catch(() => undefined);
      this.d.serahkan('periksa', PESAN_GENERIK.hostLain, sorot);
      return { kode: 'GERBANG_MEMBLOKIR' as const, ...k };
    }
    u.hash = '';
    this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: u.href });
    await this.d.tangan.navigasi(u.href);
    await this.d.tangan.tenang();
    await this.keluarAllowlist(urlSebelum);
    if (await this.eskalasiBila(ref)) return { kode: 'GERBANG_MEMBLOKIR' as const, ...k };
    return { kode: 'ok' as const, ...k, halamanBerganti: true };
  }

  /** Href tautan pembuka yang lolos allowlist, dalam bentuk yang ditampilkan ke warga (jalur diredaksi). */
  private async tautanUrl(ref: string): Promise<URL | undefined> {
    const href = await this.d.tangan.tautan(ref, this.peta);
    const u = href ? URL.parse(href) : null;
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
      this.aksiBerjalan = { blokir: [], hostLain: false };
      this.hostDitolakTerakhir = undefined;
      const urlSebelum = this.d.tangan.urlKini();
      try {
        this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: u.href });
        await this.d.tangan.navigasi(u.href);
        await this.d.tangan.tenang();
        await this.keluarAllowlist(urlSebelum);
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
      this.aksiBerjalan = { blokir: [], hostLain: false };
      this.hostDitolakTerakhir = undefined;
      this.tulisWargaSejakAi = false;
      try {
        this.d.gerbang.setAi({ jenis: 'ai_klik', navKe: url });
        await this.d.tangan.navigasi(url);
        await this.d.tangan.tenang();
        await this.keluarAllowlist(undefined);
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
      (r.status === 'ok' || r.status === 'navigasi') && KELAS_BOLEH_KLIK_AI.includes(kelas.data);
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
