import {
  AKSI_TERMINAL,
  TUNGGU_MAKS_MS,
  type Aksi,
  type AksiSesiResponse,
  type AmatiSesiResponse,
  type CatatanPendamping,
  type KolomButuh,
  type PendampingBukti,
  type PendampingStatus,
  type Pengamatan,
  type TungguSesiResponse,
} from '@urusin/contracts';
import { Anggaran, PESAN_AMBIL_ALIH, type AlasanAmbilAlih } from './anggaran.js';
import { buatResi, buktiDariPengamatan, ringkasBukti, type Resi } from './bukti.js';
import {
  BATAS_KOREKSI,
  isianDari,
  periksaIsian,
  type HasilPeriksa,
  type IsianAi,
  type JejakIsi,
} from './periksa-isian.js';
import { mintaRencana, type KonfigLlm, type MasukanPrompt } from './prompt.js';
import type { PeringkatTautan } from './peringkat-tautan.js';
import { Riwayat, dataAksi, labelRef } from './riwayat.js';
import {
  hashRencana,
  normalLabel,
  pembukaPengajuan,
  petunjukWarga,
  pintuAkun,
  validasiRencana,
  type IdAturan,
  type OpsiValidasi,
} from './validasi.js';

/**
 * Loop Navigator generik (ADR 0030): amati → rencana (LLM) → validasi → aksi (persetujuan warga per halaman
 * lewat `butuh_data{kolom}`) → tunggu. Semua keputusan berbahaya deterministik di kode: login/OTP/CAPTCHA,
 * halaman akhir, host di luar wilayah, anggaran, dan putaran langsung diserahkan ke warga tanpa LLM. Pesan
 * untuk warga selalu dari templat. Tangan (worker) mengulang klasifikasi klik dan gerbang tulis di halaman.
 */

/**
 * Klien endpoint worker (`/internal/sesi/{amati,aksi,tunggu,jejak}`), sesuai kontrak; galat dilempar (kecuali
 * `kuras`, yang tidak pernah menghentikan loop). Galat dengan properti `sementara` (lihat `galatSementara`)
 * boleh dicoba ulang: `belum_siap` = peramban sesi masih dimulai (409), `sesaat` = halaman sedang berpindah atau
 * worker sesaat tidak terjangkau (503). Galat dengan `berakhir: true` (404 sesi tidak ada) = sesi sudah diakhiri
 * (mis. warga menutupnya), bukan galat worker. Galat lain menghentikan loop.
 */
export interface TanganPendamping {
  /** `pantau`: amati baca-saja saat warga memegang kendali (deteksi halaman sukses). */
  amati(opsi?: { pantau?: boolean }): Promise<AmatiSesiResponse>;
  aksi(r: {
    rencanaHash: string;
    aksi: Aksi[];
    seq: number;
    /** Baris lembar persetujuan halaman ini (validator web), untuk `butuh_data{kolom}`. */
    kolom: KolomButuh[];
    berkas: string[];
  }): Promise<AksiSesiResponse>;
  tunggu(maksMs: number): Promise<TungguSesiResponse>;
  /**
   * Kuras catatan audit yang dikumpulkan worker (persetujuan, ambil alih, kelas klik, blokir gerbang tulis,
   * host kandidat). Dipanggil sesudah setiap amati/aksi/tunggu agar urutan jejak mengikuti kejadian.
   */
  kuras?(): Promise<{ catatan: CatatanPendamping[]; terbuang: number; executionId?: string }>;
  /**
   * Laporkan halaman sukses (`/internal/sesi/selesai`): worker memeriksa ulang halaman SAAT INI, mencatat bukti
   * ke jejaknya sendiri, dan sesi menjadi siaga (hasil berhasil). Galat = halaman tidak lagi sukses.
   */
  selesai?(bukti?: PendampingBukti): Promise<unknown>;
}

export type GalatSementara = 'belum_siap' | 'sesaat';

/** Jenis galat tangan yang boleh dicoba ulang, atau null. */
export function galatSementara(e: unknown): GalatSementara | null {
  const s = e !== null && typeof e === 'object' && 'sementara' in e ? e.sementara : null;
  return s === 'belum_siap' || s === 'sesaat' ? s : null;
}

/** Sesi worker sudah tidak ada (diakhiri sebelum loop dibatalkan): loop berhenti `sesi_berakhir`. */
const galatBerakhir = (e: unknown): boolean =>
  e !== null && typeof e === 'object' && 'berakhir' in e && e.berakhir === true;

/** Sesi worker sudah milik eksekusi lain (sesi baru dibuat sementara loop ini masih berjalan). */
class SesiLain extends Error {}

/** Baris lembar yang disetujui warga untuk satu `rencanaHash` (dicatat web saat izinkan-isi). */
export type PersetujuanHalaman = { placeholder: ReadonlySet<string>; berkas: ReadonlySet<string> };

export type OpsiLoop = {
  executionId: string;
  tangan: TanganPendamping;
  llm: KonfigLlm;
  /** Judul urusan dari registry (bukan teks warga). */
  tujuan: string;
  /** (bendera) Peringkat tautan lewat embedding sebagai sinyal prompt; lihat peringkat-tautan.ts. */
  peringkatTautan?: PeringkatTautan | undefined;
  /** Host persis yang boleh dikerjakan AI: host wilayah urusan (atau host replika di Mode Uji). */
  hostsBoleh: ReadonlySet<string>;
  /** Mode Uji: setiap pengamatan WAJIB di host replika; selain itu loop langsung berhenti. */
  modeUji?: { hostsFixture: ReadonlySet<string> } | undefined;
  validasi?: OpsiValidasi;
  kodeKabKota?: string | null | undefined;
  /** Petunjuk peta portal TEPERCAYA (registry, ADR 0034) untuk setiap prompt halaman. */
  petunjukPortal?: string | undefined;
  jejak: (c: CatatanPendamping) => void;
  /**
   * Baris yang benar-benar disetujui warga untuk `rencanaHash` (placeholder isian + nama berkas). Baris yang
   * ditolak diisi warga sendiri: tidak dikirim ulang (worker akan meminta persetujuan lagi), dan setelah baris
   * yang disetujui terisi kendali diserahkan (`isi_sendiri`) sebelum AI menekan Lanjut.
   */
  persetujuan?: (rencanaHash: string) => PersetujuanHalaman | undefined;
  /**
   * Kuota AI runtime yang sama dengan agen (per urusan, harian). true = habis: sebelum setiap panggilan LLM,
   * kendali diserahkan ke warga dengan pesan templat `kuota`, tanpa memanggil model.
   */
  kuotaHabis?: () => boolean;
  anggaran?: Anggaran;
  jam?: () => number;
  /** Batas total menunggu warga (login, persetujuan, ambil alih) sebelum Navigator berhenti. */
  tungguTotalMs?: number;
  /** Selang amati baca-saja saat warga memegang kendali (deteksi halaman sukses). Bawaan 5 detik. */
  pantauMs?: number;
  /** Jeda sebelum mencoba ulang galat sementara (bisa diganti di uji). */
  tidur?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

export type HasilNavigator =
  | { akhir: 'selesai'; bukti?: PendampingBukti | undefined; pesan: string; resi: Resi }
  | { akhir: 'ambil_alih'; alasan: AlasanAmbilAlih; pesan: string; resi: Resi }
  | { akhir: 'dipandu'; pesan: string; resi: Resi }
  | {
      akhir: 'berhenti';
      alasan: 'mode_uji_host' | 'sesi_berakhir' | 'dibatalkan' | 'galat_worker' | 'tunggu_habis';
      pesan: string;
      resi: Resi;
    };

export const PESAN_BERHENTI: Readonly<
  Record<Extract<HasilNavigator, { akhir: 'berhenti' }>['alasan'], string>
> = {
  mode_uji_host:
    'Mode Uji hanya membuka situs replika. Halaman ini bukan replika, jadi AI berhenti dan tidak mengisi apa pun.',
  sesi_berakhir: 'Sesi Browser Pendamping sudah berakhir.',
  dibatalkan: 'Bantuan AI dihentikan.',
  galat_worker: 'Browser Pendamping tidak bisa dihubungi. Silakan lanjutkan sendiri dari layar ini.',
  tunggu_habis: 'AI berhenti menunggu. Anda tetap bisa melanjutkan sendiri dari layar ini.',
};

export const PESAN_DIPANDU =
  'Layanan ini tidak bisa diisi otomatis di situs tersebut. Kami beralih ke panduan langkah: Anda membuka situsnya sendiri, kami pandu.';

const STATUS_AKHIR: readonly PendampingStatus[] = [
  'selesai',
  'gagal',
  'dipandu',
  'kedaluwarsa',
  'dibatalkan',
  'siaga',
];

/** Alasan `serahkan` di kontrak untuk alasan ambil alih Navigator. */
function alasanKontrak(a: AlasanAmbilAlih): Extract<Aksi, { jenis: 'serahkan' }>['alasan'] {
  switch (a) {
    case 'masuk_akun':
    case 'otp':
    case 'captcha':
    case 'final':
    case 'isi_sendiri':
    case 'ketuk_tautan':
      return a;
    default:
      return 'tidak_yakin';
  }
}

function alasanDariKontrak(a: Extract<Aksi, { jenis: 'serahkan' }>['alasan']): AlasanAmbilAlih {
  // `berhenti` hanya dikirim loop sendiri (serah akhir); validator tidak mengizinkannya dari model.
  return a === 'berhenti' ? 'tidak_yakin' : a;
}

/** Identitas elemen untuk ikat ulang tanpa LLM (sidik: peran + label + petunjuk + form). */
const sidikElemen = (e: Pengamatan['elemen'][number]) =>
  `${e.peran}\n${normalLabel(e.nama)}\n${normalLabel(e.petunjuk ?? '')}\n${e.form ?? ''}`;

/**
 * Ikat ulang ref aksi dari pengamatan lama ke pengamatan baru berdasarkan sidik elemen. null bila ada ref
 * yang hilang atau sidiknya tidak unik (tidak menebak).
 */
export function ikatUlang(aksi: readonly Aksi[], lama: Pengamatan, baru: Pengamatan): Aksi[] | null {
  const hitung = new Map<string, string[]>();
  for (const e of baru.elemen) {
    const k = sidikElemen(e);
    hitung.set(k, [...(hitung.get(k) ?? []), e.ref]);
  }
  const keluar: Aksi[] = [];
  for (const a of aksi) {
    if (!('ref' in a) || a.ref === undefined) {
      keluar.push(a);
      continue;
    }
    const e = lama.elemen.find((x) => x.ref === a.ref);
    const cocok = e ? hitung.get(sidikElemen(e)) : undefined;
    if (!cocok || cocok.length !== 1) return null;
    keluar.push({ ...a, ref: cocok[0]! });
  }
  return keluar;
}

const ringkasAksi = (aksi: readonly Aksi[]) =>
  aksi.slice(0, 25).map((a) => ({
    jenis: a.jenis,
    ...('ref' in a && a.ref !== undefined ? { ref: a.ref } : {}),
  }));

type HasilJalan =
  /**
   * `obs`: pengamatan terakhir yang dipakai (beda dari asal bila ref diikat ulang di tengah jalan). `isi`: isian
   * yang dijalankan worker (untuk periksa-sesudah-aksi di pengamatan berikutnya).
   */
  | { kode: 'ok'; obs: Pengamatan; isi: JejakIsi & { gilir: number } }
  | { kode: 'ulang' }
  /** Amati ulang tanpa menghitung gagal (warga sempat memegang kendali; kolom mungkin sudah ia isi). */
  | { kode: 'amati_ulang' }
  | { kode: 'berakhir' }
  | { kode: 'tunggu' }
  | { kode: 'serahkan'; alasan: AlasanAmbilAlih; ref?: string | undefined; seq?: number };

const refAksi = (a: Aksi | undefined): string | undefined =>
  a && 'ref' in a && a.ref !== undefined ? a.ref : undefined;

/**
 * Baris lembar untuk aksi yang BENAR-BENAR dikirim: worker menolak (422) baris yang placeholder-nya tidak dipakai
 * aksi isi/pilih rencana itu, mis. setelah baris yang ditolak warga dibuang atau rencana dipotong.
 */
function kolomUntuk(kolom: readonly KolomButuh[], aksi: readonly Aksi[]): KolomButuh[] {
  const ph = new Set<string>();
  for (const a of aksi)
    if (a.jenis === 'isi' || (a.jenis === 'pilih' && typeof a.nilai === 'string')) ph.add(a.nilai as string);
  return kolom.filter((k) => ph.has(k.placeholder));
}

const TANPA_IZIN: PersetujuanHalaman = { placeholder: new Set(), berkas: new Set() };

/** Placeholder vault aksi isi/pilih. */
/** Kunci baris lembar izin sebuah aksi: placeholder vault, atau `berkas:<NAMA>` untuk unggahan. */
const barisLembar = (a: Aksi): string | undefined =>
  (a.jenis === 'isi' || a.jenis === 'pilih') && typeof a.nilai === 'string'
    ? a.nilai
    : a.jenis === 'unggah'
      ? `berkas:${a.berkas.toUpperCase()}`
      : undefined;

/**
 * Identitas halaman fisik untuk batas halaman dan baris yang ditolak warga: host + jalur + judul + kerangka
 * elemen (peran + label), tanpa isian dan galat.
 */
export function halamanStruktur(p: Pengamatan): string {
  return hashRencana({
    host: p.host,
    jalur: p.jalur,
    judul: normalLabel(p.judul),
    elemen: p.elemen.map((e) => `${e.peran}:${normalLabel(e.nama)}`),
  });
}

/**
 * Batas tanpa kemajuan (QA prod Depok: 93 dtk diam di beranda): waktu AI atau putaran rencana LLM di halaman
 * yang sama (host + jalur + judul + kerangka kolom isian) tanpa satu isian pun = giliran warga dengan petunjuk
 * terbaik (`petunjukWarga`), bukan diam lama. Klik yang hanya membuka panel/menggeser carousel bukan kemajuan.
 */
export const TANPA_KEMAJUAN = { ms: 15_000, putaran: 3 } as const;

/** Kunci kemajuan halaman: berubah bila halaman berpindah atau formulir (kerangka kolom) berganti. */
export function kunciKemajuan(p: Pengamatan): string {
  return hashRencana({
    host: p.host,
    jalur: p.jalur,
    judul: normalLabel(p.judul),
    kolom: p.elemen
      .filter((e) => !['tombol', 'tautan', 'tab'].includes(e.peran))
      .map((e) => `${e.peran}:${normalLabel(e.nama)}`),
  });
}

/** Aksi isian/unggah yang disetujui warga (aksi lain tidak butuh persetujuan). */
function aksiDisetujui(a: Aksi, izin: PersetujuanHalaman): boolean {
  if ((a.jenis === 'isi' || a.jenis === 'pilih') && typeof a.nilai === 'string')
    return izin.placeholder.has(a.nilai);
  if (a.jenis === 'unggah') {
    const nama = a.berkas.toUpperCase();
    return [...izin.berkas].some((b) => b.toUpperCase() === nama);
  }
  return true;
}

export async function jalankanNavigator(o: OpsiLoop): Promise<HasilNavigator> {
  const jam = o.jam ?? Date.now;
  const ang = o.anggaran ?? new Anggaran(undefined, jam);
  const tungguTotal = o.tungguTotalMs ?? 30 * 60_000;
  let ditunggu = 0;
  const dijalankan: string[] = [];
  let hostTerakhir = '';
  let buktiAkhir: PendampingBukti | undefined;
  const tidur = o.tidur ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pantauMs = o.pantauMs ?? 5_000;
  let sesiLain = false;
  /** Halaman sukses yang terlihat saat warga memegang kendali (warga sendiri yang menekan Kirim). */
  let suksesWarga: Pengamatan | null = null;
  /** Sidik pengamatan terakhir yang diperiksa (`periksaHost`). */
  let sidikTerakhir = '';
  /**
   * Halaman tempat kendali diserahkan untuk Kirim akhir (`final`, atau `periksa` sesudah gerbang tulis menahan
   * pengiriman). null = belum pernah: `sinyal.sukses` belum diakui sama sekali (teks petunjuk seperti "nomor
   * resi anda" di beranda bukan bukti pengajuan).
   */
  let serahFinal: { sidik: string } | null = null;
  /**
   * `sukses` hanya diakui sesudah serah `final` DAN halamannya berubah sejak serah itu (warga sendiri yang
   * mengetuk Kirim). Selain itu sinyalnya diabaikan dan halaman dikerjakan seperti biasa.
   */
  const suksesSah = (p: Pengamatan) => p.sinyal.sukses && serahFinal !== null && p.sidik !== serahFinal.sidik;
  /** Warga sempat memegang kendali di penantian terakhir. */
  let wargaPegang = false;
  /** Placeholder yang ditolak warga per halaman fisik: diisi warga sendiri, tidak diminta izin lagi. */
  const ditolakHalaman = new Map<string, Set<string>>();
  /** Halaman fisik tempat giliran CAPTCHA/OTP sudah dikerjakan warga lalu kendali kembali ke AI. */
  const giliranSelesai = new Set<string>();
  /** Memori antarhalaman untuk prompt (tanpa nilai; teks halaman dibungkus saat prompt dirakit). */
  const riwayat = new Riwayat();
  /** Isian AI langkah terakhir yang belum diperiksa terhadap pengamatan berikutnya. */
  let isiLalu: (JejakIsi & { gilir: number }) | null = null;
  /**
   * Bertambah setiap kali loop menunggu kendali (warga bisa memegang layar). Isian AI hanya dianggap milik AI
   * (periksa-sesudah-aksi, `koreksiAi`) bila tidak ada penantian sejak isian itu dijalankan sampai pengamatan
   * perencanaan berikutnya: warga yang sempat memegang kendali mungkin sudah mengubah kolomnya.
   */
  let gilirWarga = 0;
  /** Koreksi yang sudah diminta per kolom (halaman fisik + kunci kolom). */
  const koreksiN = new Map<string, number>();

  const resi = (akhir: string) =>
    buatResi({
      executionId: o.executionId,
      host: hostTerakhir || '-',
      selesaiPada: new Date(jam()).toISOString(),
      akhir,
      halaman: ang.ringkas().halaman,
      aksi: ang.ringkas().aksi,
      panggilanLlm: ang.ringkas().panggilanLlm,
      rencana: [...dijalankan],
      ...(buktiAkhir ? { bukti: buktiAkhir } : {}),
    });
  const berhenti = (alasan: Extract<HasilNavigator, { akhir: 'berhenti' }>['alasan']): HasilNavigator => {
    ang.jedaAi();
    return { akhir: 'berhenti', alasan, pesan: PESAN_BERHENTI[alasan], resi: resi(alasan) };
  };
  const batal = () => o.signal?.aborted === true;

  /** Jejak worker diteruskan apa adanya (sudah tanpa nilai); kegagalan kuras tidak menghentikan loop. */
  async function kuras(): Promise<void> {
    if (!o.tangan.kuras) return;
    try {
      const j = await o.tangan.kuras();
      if (j.executionId !== undefined && j.executionId !== o.executionId) {
        // Sesi sudah milik eksekusi lain: catatannya bukan milik loop ini; celahnya dicatat sebagai angka.
        sesiLain = true;
        const n = j.catatan.length + j.terbuang;
        if (n > 0) o.jejak({ jenis: 'jejak_terbuang', n: Math.min(n, 1_000_000) });
        return;
      }
      for (const c of j.catatan) o.jejak(c);
      // Buffer worker sempat penuh: catat jumlahnya agar celah di rantai audit terlihat.
      if (j.terbuang > 0) o.jejak({ jenis: 'jejak_terbuang', n: Math.min(j.terbuang, 1_000_000) });
    } catch {
      // Jejak tetap di buffer worker dan ikut terkuras pada panggilan berikutnya.
    }
  }
  /**
   * Coba ulang galat sementara: 409 belum siap selama masih dalam batas menunggu total, 503 sesaat paling
   * banyak 3 kali; jeda 1 detik dihitung ke waktu menunggu.
   */
  async function cobaUlang<T>(f: () => Promise<T>): Promise<T> {
    let sesaat = 0;
    for (;;) {
      try {
        return await f();
      } catch (e) {
        const j = galatSementara(e);
        if (!j || batal() || (j === 'sesaat' && ++sesaat > 3) || ditunggu >= tungguTotal) throw e;
        await tidur(1_000);
        ditunggu += 1_000;
      }
    }
  }
  const sesudah = async <T>(r: T): Promise<T> => {
    await kuras();
    if (sesiLain) throw new SesiLain();
    return r;
  };
  type PermintaanAksi = Parameters<TanganPendamping['aksi']>[0];
  const tangan = {
    amati: async (opsi?: { pantau?: boolean }) => {
      const a = await sesudah(await cobaUlang(() => (opsi ? o.tangan.amati(opsi) : o.tangan.amati())));
      // Sesi sudah memegang eksekusi lain (sesi baru dibuat): pengamatan ini bukan milik loop ini.
      if (a.executionId !== undefined && a.executionId !== o.executionId) throw new SesiLain();
      return a;
    },
    /** Aksi rencana (isi/klik): TIDAK diulang otomatis; galat sementara = amati ulang (lihat jalankanAksi). */
    aksi: async (r: PermintaanAksi) => sesudah(await o.tangan.aksi(r)),
    /** Aksi tanpa nilai dan tanpa klik (serahkan/tidak_bisa): aman diulang. */
    aksiAman: async (r: PermintaanAksi) => sesudah(await cobaUlang(() => o.tangan.aksi(r))),
    tunggu: async (maksMs: number) => sesudah(await cobaUlang(() => o.tangan.tunggu(maksMs))),
  };

  /** Host sah untuk dikerjakan/diakui: host wilayah, dan di Mode Uji hanya replika. */
  const hostSah = (host: string) =>
    (!o.modeUji || o.modeUji.hostsFixture.has(host)) && o.hostsBoleh.has(host);

  /**
   * Halaman sukses dikonfirmasi worker (`selesai`): worker memeriksa ulang halaman saat ini dan mencatat bukti
   * (satu sumber). Tanpa `selesai` (tangan uji), pengamatan dipercaya. Galat sementara diulang; galat lain =
   * halaman tidak lagi sukses (false).
   */
  async function konfirmasiSukses(p: Pengamatan): Promise<boolean> {
    const selesai = o.tangan.selesai?.bind(o.tangan);
    if (!selesai) return true;
    const bukti = buktiDariPengamatan(p);
    try {
      await sesudah(await cobaUlang(() => selesai(bukti)));
      return true;
    } catch (e) {
      if (e instanceof SesiLain) throw e;
      return false;
    }
  }

  /** Amati baca-saja saat warga memegang kendali: halaman sukses di host sah (dikonfirmasi worker), atau null. */
  async function pantau(): Promise<Pengamatan | null> {
    try {
      const a = await tangan.amati({ pantau: true });
      const p = a.pengamatan;
      return suksesSah(p) && hostSah(p.host) && (await konfirmasiSukses(p)) ? p : null;
    } catch (e) {
      if (e instanceof SesiLain) throw e;
      return null;
    }
  }

  type HasilTunggu = 'ai' | 'berakhir' | 'habis' | 'sukses';

  /**
   * Long-poll selama warga memegang kendali / persetujuan tertunda. AI time dijeda. Saat warga memegang
   * kendali, long-poll dipendekkan dan halaman diamati baca-saja: warga yang menekan Kirim sendiri lalu
   * melihat halaman sukses = `sukses` (dicatat berhasil, bukan dibatalkan).
   */
  async function tungguKendali(wargaMulai = false): Promise<HasilTunggu> {
    gilirWarga++;
    ang.jedaAi();
    wargaPegang = wargaMulai;
    try {
      for (;;) {
        if (batal()) return 'berakhir';
        if (ditunggu >= tungguTotal) return 'habis';
        const mulai = jam();
        const maks = Math.min(wargaPegang ? pantauMs : TUNGGU_MAKS_MS, tungguTotal - ditunggu);
        const t = await tangan.tunggu(maks);
        // Paling sedikit 1 detik per putaran: worker yang menjawab seketika tanpa perubahan tidak membuat loop panas.
        ditunggu += Math.max(jam() - mulai, t.habisWaktu ? maks : 0, 1_000);
        if (t.mode === 'done' || STATUS_AKHIR.includes(t.status)) return 'berakhir';
        if (t.mode === 'ai' && t.status !== 'menunggu_data') return 'ai';
        if (t.mode === 'takeover') {
          wargaPegang = true;
          const sukses = await pantau();
          if (sukses) {
            suksesWarga = sukses;
            return 'sukses';
          }
        }
      }
    } finally {
      ang.mulaiAi();
    }
  }

  /** Halaman sukses: bukti deterministik (tanpa LLM), hasil `selesai`. */
  function selesaiDari(p: Pengamatan): HasilNavigator {
    hostTerakhir = p.host;
    buktiAkhir = buktiDariPengamatan(p);
    // Dengan `selesai`, bukti dicatat worker (sesudah memeriksa halamannya); tanpa itu dicatat di sini.
    if (buktiAkhir && !o.tangan.selesai) o.jejak({ jenis: 'bukti', bukti: buktiAkhir });
    ang.jedaAi();
    return { akhir: 'selesai', bukti: buktiAkhir, pesan: ringkasBukti(buktiAkhir), resi: resi('selesai') };
  }

  /**
   * Serahkan kendali ke warga (templat) lalu tunggu kendali kembali. Hasil serahkan diperiksa: ref/seq basi
   * (halaman dirender ulang) = amati ulang dan ikat ulang ref ke pengamatan baru, sekali. Bila tetap tidak
   * dijalankan worker, kendali masih di AI ('ai': halaman direncanakan ulang), bukan diam menunggu warga.
   */
  async function serahkanTunggu(
    alasan: AlasanAmbilAlih,
    seq: number,
    ref?: string,
    obs?: Pengamatan,
  ): Promise<HasilTunggu> {
    for (let coba = 0; ; coba++) {
      const aksi: Aksi[] = [
        { jenis: 'serahkan', alasan: alasanKontrak(alasan), ...(ref !== undefined ? { ref } : {}) },
      ];
      // Jejak ambil alih (mulai/selesai) dicatat worker saat serahkan benar-benar dijalankan / kendali kembali.
      const r = await tangan.aksiAman({
        rencanaHash: hashRencana({ aksi, host: hostTerakhir, seq }),
        aksi,
        seq,
        kolom: [],
        berkas: [],
      });
      if (r.mode === 'done') return 'berakhir';
      const kode = r.hasil.find((h) => h.indeks === 0)?.kode ?? 'DILEWATI';
      if (kode === 'ok' || r.mode === 'takeover') {
        // Serah final yang benar-benar dijalankan: halaman sukses sesudahnya baru boleh diakui.
        if (alasan === 'final') serahFinal = { sidik: sidikTerakhir };
        const t = await tungguKendali(true);
        if (t === 'ai') riwayat.catat({ jenis: 'serah', alasan, kembali: true });
        return t;
      }
      if (coba > 0 || (kode !== 'REF_BASI' && kode !== 'REF_TIDAK_ADA')) {
        riwayat.catat({ jenis: 'serah', alasan, kembali: false });
        return 'ai';
      }
      const a = await tangan.amati();
      if (a.mode === 'done') return 'berakhir';
      if (a.mode !== 'ai' || periksaHost(a.pengamatan) !== 'ok') return 'ai';
      if (ref !== undefined) {
        const terikat = obs ? ikatUlang(aksi, obs, a.pengamatan) : null;
        const baru = terikat ? refAksi(terikat[0]) : undefined;
        // Tautan pembuka wajib menunjuk elemennya; serah lain tetap sah tanpa sorotan.
        if (baru === undefined && alasan === 'ketuk_tautan') return 'ai';
        ref = baru;
      }
      obs = a.pengamatan;
      seq = obs.seq;
    }
  }

  /**
   * Serahkan akhir: Navigator berhenti, warga melanjutkan sendiri (pesan templat). Di worker selalu `berhenti`
   * (tanpa janji "coba lagi"); alasan sebenarnya hanya di hasil/resi loop.
   */
  async function serahkanAkhir(alasan: AlasanAmbilAlih, seq: number): Promise<HasilNavigator> {
    const aksi: Aksi[] = [{ jenis: 'serahkan', alasan: 'berhenti' }];
    ang.jedaAi();
    await tangan.aksiAman({
      rencanaHash: hashRencana({ aksi, host: hostTerakhir, seq }),
      aksi,
      seq,
      kolom: [],
      berkas: [],
    });
    return { akhir: 'ambil_alih', alasan, pesan: PESAN_AMBIL_ALIH[alasan], resi: resi(alasan) };
  }

  const setelahTunggu = (t: HasilTunggu): HasilNavigator | null =>
    t === 'ai'
      ? null
      : t === 'sukses' && suksesWarga
        ? selesaiDari(suksesWarga)
        : berhenti(t === 'habis' ? 'tunggu_habis' : batal() ? 'dibatalkan' : 'sesi_berakhir');

  /**
   * Sesudah serahkan: sesi berakhir di tangan warga = ambil alih (bukan galat). Pesannya "sesi sudah
   * berakhir", bukan giliran warga yang sudah basi.
   */
  const setelahSerahkan = (alasan: AlasanAmbilAlih, t: HasilTunggu): HasilNavigator | null =>
    t === 'berakhir' && !batal()
      ? { akhir: 'ambil_alih', alasan, pesan: PESAN_BERHENTI.sesi_berakhir, resi: resi(alasan) }
      : setelahTunggu(t);

  /** Pengamatan dengan kendali di tangan AI; null = sesi berakhir. Setiap pengamatan diperiksa host-nya. */
  async function amati(): Promise<Pengamatan | HasilNavigator> {
    for (let i = 0; i < 5; i++) {
      const a = await tangan.amati();
      if (a.mode === 'done') return berhenti('sesi_berakhir');
      if (a.mode === 'ai') return a.pengamatan;
      const t = await tungguKendali();
      const h = setelahTunggu(t);
      if (h) return h;
    }
    return berhenti('tunggu_habis');
  }

  /** Mode Uji: host harus replika. Wilayah: host harus milik wilayah urusan. */
  function periksaHost(p: Pengamatan): 'ok' | 'mode_uji' | 'luar' {
    hostTerakhir = p.host;
    sidikTerakhir = p.sidik;
    if (o.modeUji && !o.modeUji.hostsFixture.has(p.host)) return 'mode_uji';
    if (!o.hostsBoleh.has(p.host)) return 'luar';
    return 'ok';
  }

  async function jalankanAksi(
    p: Pengamatan,
    rencanaHash: string,
    kolom: KolomButuh[],
    berkas: string[],
    badan: Aksi[],
    serahAwal: { ref?: string | undefined } | null = null,
  ): Promise<HasilJalan | HasilNavigator> {
    let obs = p;
    let sisa = badan;
    let sudahDiminta = false;
    let ikat = 0;
    /** Baris ditolak warga: setelah baris yang disetujui terisi, kendali diserahkan (isi sendiri). */
    let serahIsi: { ref?: string | undefined } | null = serahAwal;
    const halaman = halamanStruktur(p);
    const catatTolak = (aksi: readonly Aksi[]) => {
      const s = ditolakHalaman.get(halaman) ?? new Set<string>();
      const baru: string[] = [];
      for (const a of aksi) {
        const k = barisLembar(a);
        if (k) {
          s.add(k);
          baru.push(k);
        }
      }
      ditolakHalaman.set(halaman, s);
      if (baru.length > 0) riwayat.catat({ jenis: 'izin', ditolak: [...new Set(baru)] });
    };
    /** Isian yang dijalankan worker (kode ok) di permintaan-permintaan aksi ini, dan klik yang dijalankan. */
    const terisi: IsianAi[] = [];
    let klik = false;
    /** `gilirWarga` saat isian pertama langkah ini dijalankan worker. */
    let gilirIsi: number | null = null;
    const selesai = (): HasilJalan =>
      serahIsi
        ? { kode: 'serahkan', alasan: 'isi_sendiri', ref: serahIsi.ref, seq: obs.seq }
        : {
            kode: 'ok',
            obs,
            isi: { halaman: halamanStruktur(obs), isian: terisi, klik, gilir: gilirIsi ?? gilirWarga },
          };
    for (;;) {
      if (sisa.length === 0) return selesai();
      let r: AksiSesiResponse;
      try {
        r = await tangan.aksi({
          rencanaHash,
          aksi: sisa,
          seq: obs.seq,
          kolom: kolomUntuk(kolom, sisa),
          berkas,
        });
      } catch (e) {
        // Klik/isi tidak dikirim ulang buta (worker mungkin masih menjalankannya): jeda lalu amati ulang.
        if (!galatSementara(e) || batal()) throw e;
        await tidur(1_000);
        ditunggu += 1_000;
        return { kode: 'ulang' };
      }
      ang.catatAksi(r.hasil.filter((h) => h.kode === 'ok').length);
      if (r.mode === 'done') return { kode: 'berakhir' };
      // Satu entri per aksi (kontrak worker); entri hilang dianggap tidak dijalankan.
      const kode = (j: number) => r.hasil.find((h) => h.indeks === j)?.kode ?? 'DILEWATI';
      // Riwayat: aksi yang dijalankan atau ditolak worker (tanpa nilai); putaran persetujuan tidak dicatat di sini.
      const tercatat = sisa.flatMap((a, j) => {
        const k = kode(j);
        if (k === 'DILEWATI' || k === 'BELUM_DISETUJUI') return [];
        if (k === 'ok') {
          const isian = isianDari(obs, a);
          if (isian) {
            terisi.push(isian);
            gilirIsi ??= gilirWarga;
          }
          if (a.jenis === 'klik') klik = true;
        }
        const label = labelRef(obs, a);
        const data = dataAksi(a);
        return [
          { jenis: a.jenis, kode: k, ...(label !== undefined ? { label } : {}), ...(data ? { data } : {}) },
        ];
      });
      if (tercatat.length > 0) riwayat.catat({ jenis: 'aksi', aksi: tercatat });

      // Persetujuan: worker tidak menjalankan apa pun sebelum seluruh baris isian rencana ini disetujui.
      const belum = sisa.filter((_, j) => kode(j) === 'BELUM_DISETUJUI');
      if (belum.length > 0) {
        // Sudah satu putaran persetujuan dan masih tertahan: jangan meminta lagi tanpa henti.
        if (sudahDiminta)
          return { kode: 'serahkan', alasan: 'isi_sendiri', ref: refAksi(belum[0]), seq: obs.seq };
        sudahDiminta = true;
        const h = setelahTunggu(await tungguKendali());
        if (h) return h;
        // Tanpa catatan persetujuan web setelah lembar ditutup (warga mengambil alih / mengembalikan kendali saat
        // lembar terbuka) = tolak semua: worker sudah mengikat rencana ini tanpa baris, jadi mengirim ulang baris
        // vault dengan hash yang sama hanya membuka lembar lagi. Baris itu diisi warga sendiri.
        const catatan = o.persetujuan?.(rencanaHash);
        if (o.persetujuan && !catatan && wargaPegang) {
          // Warga sempat memegang kendali dan mungkin sudah mengisi kolomnya: amati ulang dulu. Baris ini tidak
          // diminta izin lagi di halaman ini (diisi warga sendiri).
          catatTolak(sisa);
          return { kode: 'amati_ulang' };
        }
        const izin = o.persetujuan ? (catatan ?? TANPA_IZIN) : undefined;
        if (izin) {
          const ditolak = sisa.filter((a) => !aksiDisetujui(a, izin));
          catatTolak(ditolak);
          if (ditolak.length > 0) {
            serahIsi = { ref: refAksi(ditolak[0]) };
            const tetap = sisa.filter((a) => aksiDisetujui(a, izin));
            // Jangan menekan Lanjut/tautan sebelum warga mengisi baris yang ia tolak.
            const klik = tetap.findIndex((a) => a.jenis === 'klik');
            sisa = klik >= 0 ? tetap.slice(0, klik) : tetap;
          }
        }
        continue;
      }

      const g = r.hasil.find((h) => h.kode !== 'ok' && h.kode !== 'DILEWATI');
      if (!g) {
        if (r.mode === 'takeover') return { kode: 'tunggu' };
        // Semua ok, atau worker berhenti sesudah klik yang mengganti halaman (sisanya DILEWATI): amati ulang.
        return selesai();
      }
      const i = Math.min(g.indeks, sisa.length - 1);
      switch (g.kode) {
        case 'REF_BASI': {
          if (ikat >= 2) return { kode: 'ulang' };
          ikat++;
          const baru = await amati();
          if ('akhir' in baru) return baru;
          const cek = periksaHost(baru);
          if (cek === 'mode_uji') return berhenti('mode_uji_host');
          if (cek === 'luar') return { kode: 'serahkan', alasan: 'host_luar' };
          // Yang sudah ok tidak diulang; sisanya (REF_BASI + DILEWATI) diikat ulang ke pengamatan baru.
          const terikat = ikatUlang(
            sisa.filter((_, j) => kode(j) !== 'ok'),
            obs,
            baru,
          );
          if (!terikat) return { kode: 'ulang' };
          // Validasi ulang terhadap pengamatan baru (tanpa LLM). Aksi yang dikirim kini = rencana hasil ikat
          // ulang (dicatat dengan hash-nya sendiri), persetujuan tetap milik rencana asal (`asal`).
          const v = validasiRencana({ aksi: terikat }, baru, o.validasi);
          o.jejak({
            jenis: 'validasi',
            rencanaHash: v.rencanaHash,
            putusan: v.ok ? 'terima' : 'tolak',
            aturan: v.ok ? [] : v.aturan,
            asal: rencanaHash,
          });
          if (!v.ok) return { kode: 'ulang' };
          obs = baru;
          sisa = terikat;
          continue;
        }
        case 'KELAS_DITOLAK':
        case 'HALAMAN_AKHIR':
        case 'TERLARANG':
          return { kode: 'serahkan', alasan: 'final', ref: refAksi(sisa[i]), seq: obs.seq };
        case 'GERBANG_MEMBLOKIR':
          // Worker sudah membatalkan permintaan dan menyerahkan kendali (`periksa`) ke warga: warga sendiri yang
          // memeriksa lalu mengirim, jadi setara serah `final`.
          serahFinal = { sidik: obs.sidik };
          return { kode: 'tunggu' };
        default:
          return { kode: 'ulang' };
      }
    }
  }

  let umpanBalik: { sidik: string; aturan: IdAturan[] } | null = null;
  /** Temuan periksa yang masih berlaku untuk rencana ulang di halaman yang sama (rencana koreksi ditolak). */
  let periksaUlang: { sidik: string; periksa: HasilPeriksa; gilir: number } | null = null;
  /** Halaman (sidik) yang CTA pengajuannya sudah dibuka tanpa LLM: kunjungan berikutnya ditanya ke model. */
  const ctaDipakai = new Set<string>();
  /** Halaman fisik yang pintu akunnya sudah dikerjakan tanpa LLM: kunjungan berikutnya ditanya ke model. */
  const pintuDipakai = new Set<string>();
  /** Halaman tanpa kemajuan sejak waktu AI `ms`, dengan `putaran` rencana LLM. */
  let kemajuan = { kunci: '', ms: 0, putaran: 0 };
  try {
    ang.mulaiAi();
    for (;;) {
      if (batal()) return berhenti('dibatalkan');
      const p = await amati();
      if ('akhir' in p) return p;
      // Jejak `amati` dicatat worker (satu sumber).
      const cek = periksaHost(p);
      // Mode Uji: host non-replika = berhenti seketika, tanpa aksi apa pun.
      if (cek === 'mode_uji') return berhenti('mode_uji_host');
      if (cek === 'luar') {
        o.jejak({ jenis: 'host_kandidat', host: p.host });
        return await serahkanAkhir('host_luar', p.seq);
      }
      if (suksesSah(p)) {
        if (await konfirmasiSukses(p)) return selesaiDari(p);
        // Worker tidak mengakui halaman ini sebagai sukses: tidak diklaim berhasil, warga memeriksa sendiri.
        return await serahkanAkhir('tidak_yakin', p.seq);
      }
      ang.catatHalaman(p.sidik, halamanStruktur(p));
      const habis = ang.habis();
      if (habis) return await serahkanAkhir(habis, p.seq);
      riwayat.catat({ jenis: 'halaman', jalur: p.jalur, judul: p.judul });
      // Isian langkah lalu hanya dibandingkan dengan pengamatan perencanaan TEPAT sesudahnya.
      // Warga sempat memegang kendali sejak isian dijalankan (penantian di `amati`, persetujuan, ambil alih): kolomnya
      // mungkin sudah ia ubah, jadi tidak diperiksa dan tidak dikecualikan dari KOLOM_DIISI_WARGA.
      const lalu = isiLalu?.gilir === gilirWarga ? isiLalu : null;
      isiLalu = null;

      // Giliran warga yang pasti (tanpa LLM).
      // Formulir masuk ber-CAPTCHA/verifikasi situs = giliran masuk akun (pesannya menyebut kode/verifikasi
      // keamanan), bukan "CAPTCHA" saja (QA prod gel6 Medan: formulir masuk dengan widget verifikasi).
      const giliran: AlasanAmbilAlih | null = p.sinyal.login
        ? 'masuk_akun'
        : p.sinyal.tantangan
          ? 'captcha'
          : p.sinyal.captcha
            ? 'captcha'
            : p.sinyal.otp
              ? 'otp'
              : null;
      // CAPTCHA/OTP di halaman yang BUKAN formulir masuk (mis. kode keamanan di formulir permohonan) yang sudah
      // dikerjakan warga lalu kendali kembali ke AI: kolomnya tetap ada (terlarang untuk AI), jadi halaman ini
      // dikerjakan AI seperti biasa, tidak diserahkan lagi tanpa akhir. Formulir masuk selalu giliran warga.
      const kunciGiliran = halamanStruktur(p);
      const sudahDikerjakan =
        (giliran === 'captcha' || giliran === 'otp') && !p.sinyal.login && giliranSelesai.has(kunciGiliran);
      if (giliran && !sudahDikerjakan) {
        const h = setelahSerahkan(giliran, await serahkanTunggu(giliran, p.seq, undefined, p));
        if (h) return h;
        if (giliran === 'captcha' || giliran === 'otp') giliranSelesai.add(kunciGiliran);
        continue;
      }

      // Beranda pintu akun: AI membuka halaman masuk sendiri (giliran warga di formulirnya), atau langsung giliran
      // masuk akun bila kendali masuknya hanya bisa ditekan warga. Sekali per halaman fisik, tanpa LLM.
      const pintu = pintuDipakai.has(kunciGiliran) ? undefined : pintuAkun(p);
      if (pintu) pintuDipakai.add(kunciGiliran);
      if (pintu?.jenis === 'serahkan') {
        const h = setelahSerahkan('masuk_akun', await serahkanTunggu('masuk_akun', p.seq, pintu.ref, p));
        if (h) return h;
        kemajuan = { kunci: '', ms: 0, putaran: 0 };
        continue;
      }

      // Tanpa kemajuan terlalu lama / terlalu banyak putaran: giliran warga dengan petunjuk, bukan diam.
      const kunciMaju = kunciKemajuan(p);
      if (kunciMaju !== kemajuan.kunci) kemajuan = { kunci: kunciMaju, ms: ang.waktuAiMs(), putaran: 0 };
      else if (
        kemajuan.putaran >= TANPA_KEMAJUAN.putaran ||
        ang.waktuAiMs() - kemajuan.ms >= TANPA_KEMAJUAN.ms
      ) {
        kemajuan = { kunci: '', ms: 0, putaran: 0 };
        const h = setelahSerahkan(
          'tidak_yakin',
          await serahkanTunggu('tidak_yakin', p.seq, petunjukWarga(p), p),
        );
        if (h) return h;
        continue;
      }

      // Periksa-sesudah-aksi: isian AI yang ditolak situs dikoreksi model (paling banyak BATAS_KOREKSI kali per
      // kolom); kolom yang sudah habis jatah koreksinya diserahkan ke warga (deterministik, tanpa LLM).
      const tunda = periksaUlang as { sidik: string; periksa: HasilPeriksa; gilir: number } | null;
      let periksa: HasilPeriksa | undefined =
        tunda?.sidik === p.sidik && tunda.gilir === gilirWarga ? tunda.periksa : undefined;
      periksaUlang = null;
      if (lalu) {
        const temuan = periksaIsian(lalu, p);
        const habisKoreksi = temuan.find(
          (t) => (koreksiN.get(`${lalu.halaman}\n${t.isian.kunci}`) ?? 0) >= BATAS_KOREKSI,
        );
        for (const t of temuan)
          riwayat.catat({ jenis: 'koreksi', label: t.isian.label, data: t.isian.data, masalah: t.masalah });
        if (habisKoreksi) {
          const h = setelahSerahkan(
            'isi_sendiri',
            await serahkanTunggu('isi_sendiri', p.seq, habisKoreksi.ref, p),
          );
          if (h) return h;
          continue;
        }
        const ulang = lalu.klik && p.sinyal.galatForm && halamanStruktur(p) === lalu.halaman;
        if (ulang || temuan.length > 0)
          periksa = {
            ulang,
            koreksi: temuan.map((t) => {
              const k = `${lalu.halaman}\n${t.isian.kunci}`;
              const ke = (koreksiN.get(k) ?? 0) + 1;
              koreksiN.set(k, ke);
              return { ...t, ke };
            }),
          };
      }

      if (o.kuotaHabis?.()) return await serahkanAkhir('kuota', p.seq);
      const masukan: MasukanPrompt = {
        pengamatan: p,
        tujuan: o.tujuan,
        ...(o.validasi?.katalog ? { katalog: [...o.validasi.katalog] } : {}),
        ...(o.validasi?.berkas ? { berkas: [...o.validasi.berkas] } : {}),
        kodeKabKota: o.kodeKabKota,
        ...(o.petunjukPortal ? { petunjukPortal: o.petunjukPortal } : {}),
        ...(umpanBalik?.sidik === p.sidik ? { umpanBalik: umpanBalik.aturan } : {}),
        petunjukTautan: await o.peringkatTautan?.(p, o.tujuan, o.signal).catch(() => null),
        // Halaman saat ini sudah ada di baris HALAMAN: entri riwayat terakhirnya (bila itu) tidak diulang.
        riwayat: riwayat.daftar.filter((l, i, d) => i < d.length - 1 || l.jenis !== 'halaman'),
        ...(periksa ? { periksa } : {}),
      };
      let minta: Awaited<ReturnType<typeof mintaRencana>>;
      // Halaman pintu dengan satu CTA pengajuan ("Mulai Pendaftaran"): CTA didahulukan di atas tautan informasi
      // ("Persyaratan") tanpa LLM, sekali per halaman; worker membukanya lewat navigasi GET. Pintu akun `buka`
      // (kendali masuk yang boleh dibuka AI) didahulukan di atas CTA.
      const ctaPengajuan = ctaDipakai.has(p.sidik) || pintu ? undefined : pembukaPengajuan(p);
      if (ctaPengajuan !== undefined) ctaDipakai.add(p.sidik);
      const cta: string | undefined = pintu?.jenis === 'buka' ? pintu.ref : ctaPengajuan;
      if (cta === undefined) kemajuan.putaran++;
      try {
        minta =
          cta !== undefined
            ? {
                ok: true,
                rencana: { aksi: [{ jenis: 'klik', ref: cta }] },
                panggilan: 0,
                tokenMasuk: 0,
                tokenKeluar: 0,
              }
            : await mintaRencana(o.llm, masukan, o.signal);
      } catch (e) {
        if (batal()) throw e;
        // Galat penyedia LLM (429, timeout): coba sekali lagi, lalu serahkan dengan alasan yang jujur.
        try {
          minta = await mintaRencana(o.llm, masukan, o.signal);
        } catch (e2) {
          if (batal()) throw e2;
          return await serahkanAkhir('layanan_ai', p.seq);
        }
      }
      ang.catatLlm(minta.panggilan);
      const v = minta.ok
        ? validasiRencana(
            minta.rencana,
            p,
            periksa?.koreksi.length
              ? { ...o.validasi, koreksiAi: new Set(periksa.koreksi.map((k) => k.ref)) }
              : o.validasi,
          )
        : { ok: false as const, aturan: ['SKEMA_TIDAK_SAH' as const], rencanaHash: hashRencana(null) };
      if (minta.ok && v.ok)
        o.jejak({
          jenis: 'rencana',
          model:
            (pintu ? 'aturan:pintu_akun' : cta !== undefined ? 'aturan:cta_pengajuan' : o.llm.model).slice(
              0,
              100,
            ) || '-',
          tokenMasuk: minta.tokenMasuk,
          tokenKeluar: minta.tokenKeluar,
          rencanaHash: v.rencanaHash,
          aksi: ringkasAksi(v.rencana.aksi),
        });
      o.jejak({
        jenis: 'validasi',
        rencanaHash: v.rencanaHash,
        putusan: v.ok ? 'terima' : 'tolak',
        aturan: v.ok ? [] : v.aturan.slice(0, 25),
      });
      if (!v.ok) {
        ang.gagal();
        umpanBalik = { sidik: p.sidik, aturan: v.aturan };
        riwayat.catat({ jenis: 'tolak', aturan: v.aturan });
        // Temuan periksa tetap berlaku untuk rencana ulang di halaman yang sama (tanpa menambah hitungan koreksi).
        if (periksa) periksaUlang = { sidik: p.sidik, periksa, gilir: gilirWarga };
        continue;
      }
      umpanBalik = null;
      dijalankan.push(v.rencanaHash);

      const aksi = v.rencana.aksi;
      const akhir = aksi.at(-1)!;
      const terminal = AKSI_TERMINAL.includes(akhir.jenis) ? akhir : undefined;
      let badan = terminal ? aksi.slice(0, -1) : aksi;
      // Baris yang sudah ditolak warga di halaman ini tidak diminta izin lagi: dibuang, Lanjut tidak ditekan,
      // dan sesudah sisanya kendali ke warga untuk mengisinya sendiri.
      const tolakDulu = ditolakHalaman.get(halamanStruktur(p));
      let serahAwal: { ref?: string | undefined } | null = null;
      if (tolakDulu) {
        const dibuang = badan.filter((a) => tolakDulu.has(barisLembar(a) ?? ''));
        if (dibuang.length > 0) {
          serahAwal = { ref: refAksi(dibuang[0]) };
          const tetap = badan.filter((a) => !dibuang.includes(a));
          const klik = tetap.findIndex((a) => a.jenis === 'klik');
          badan = klik >= 0 ? tetap.slice(0, klik) : tetap;
        }
      }
      let obsAkhir = p;
      if (badan.length > 0 || serahAwal) {
        const r = await jalankanAksi(p, v.rencanaHash, v.kolom, v.berkas, badan, serahAwal);
        if ('akhir' in r) return r;
        if (r.kode === 'berakhir') return berhenti('sesi_berakhir');
        if (r.kode === 'amati_ulang') continue;
        if (r.kode === 'ulang') {
          ang.gagal();
          continue;
        }
        if (r.kode === 'tunggu') {
          const h = setelahTunggu(await tungguKendali());
          if (h) return h;
          continue;
        }
        if (r.kode === 'serahkan') {
          if (r.alasan === 'host_luar') return await serahkanAkhir('host_luar', p.seq);
          const h = setelahSerahkan(r.alasan, await serahkanTunggu(r.alasan, r.seq ?? p.seq, r.ref));
          if (h) return h;
          continue;
        }
        obsAkhir = r.obs;
        isiLalu = r.isi;
        // Isian yang benar-benar dijalankan = kemajuan (formulir panjang di satu halaman tidak dihitung diam).
        if (
          badan.some(
            (a) => a.jenis === 'isi' || a.jenis === 'pilih' || a.jenis === 'centang' || a.jenis === 'unggah',
          )
        )
          kemajuan = { kunci: '', ms: 0, putaran: 0 };
      }
      ang.berhasil();
      if (terminal?.jenis === 'tidak_bisa') {
        await tangan.aksiAman({
          rencanaHash: v.rencanaHash,
          aksi: [terminal],
          seq: p.seq,
          kolom: [],
          berkas: [],
        });
        ang.jedaAi();
        return { akhir: 'dipandu', pesan: PESAN_DIPANDU, resi: resi('dipandu') };
      }
      if (terminal?.jenis === 'serahkan') {
        const alasan = alasanDariKontrak(terminal.alasan);
        // Badan sempat diikat ulang ke pengamatan baru: ref serah ikut diikat ulang (seq-nya juga yang baru).
        let ref = terminal.ref;
        if (ref !== undefined && obsAkhir !== p) {
          const t = ikatUlang([terminal], p, obsAkhir);
          ref = t ? refAksi(t[0]) : undefined;
          if (ref === undefined && alasan === 'ketuk_tautan') {
            ang.gagal();
            continue;
          }
        }
        const h = setelahSerahkan(alasan, await serahkanTunggu(alasan, obsAkhir.seq, ref, obsAkhir));
        if (h) return h;
      }
    }
  } catch (e) {
    if (batal()) return berhenti('dibatalkan');
    // Sesi sudah dipakai eksekusi lain: loop ini selesai tanpa menyentuhnya lagi.
    if (e instanceof SesiLain || galatBerakhir(e)) return berhenti('sesi_berakhir');
    return berhenti('galat_worker');
  }
}
