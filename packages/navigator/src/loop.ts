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
import { mintaRencana, type KonfigLlm } from './prompt.js';
import { hashRencana, normalLabel, validasiRencana, type IdAturan, type OpsiValidasi } from './validasi.js';

/**
 * Loop Navigator generik (ADR 0030): amati → rencana (LLM) → validasi → aksi (persetujuan warga per halaman
 * lewat `butuh_data{kolom}`) → tunggu. Semua keputusan berbahaya deterministik di kode: login/OTP/CAPTCHA,
 * halaman akhir, host di luar wilayah, anggaran, dan putaran langsung diserahkan ke warga tanpa LLM. Pesan
 * untuk warga selalu dari templat. Tangan (worker) mengulang klasifikasi klik dan gerbang tulis di halaman.
 */

/**
 * Klien endpoint worker (`/internal/sesi/{amati,aksi,tunggu,jejak}`), sesuai kontrak; galat dilempar (kecuali
 * `kuras`, yang tidak pernah menghentikan loop).
 */
export interface TanganPendamping {
  amati(): Promise<AmatiSesiResponse>;
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
  kuras?(): Promise<{ catatan: CatatanPendamping[]; terbuang: number }>;
}

/** Baris lembar yang disetujui warga untuk satu `rencanaHash` (dicatat web saat izinkan-isi). */
export type PersetujuanHalaman = { placeholder: ReadonlySet<string>; berkas: ReadonlySet<string> };

export type OpsiLoop = {
  executionId: string;
  tangan: TanganPendamping;
  llm: KonfigLlm;
  /** Judul urusan dari registry (bukan teks warga). */
  tujuan: string;
  /** Host persis yang boleh dikerjakan AI: host wilayah urusan (atau host replika di Mode Uji). */
  hostsBoleh: ReadonlySet<string>;
  /** Mode Uji: setiap pengamatan WAJIB di host replika; selain itu loop langsung berhenti. */
  modeUji?: { hostsFixture: ReadonlySet<string> } | undefined;
  validasi?: OpsiValidasi;
  kodeKabKota?: string | null | undefined;
  jejak: (c: CatatanPendamping) => void;
  /**
   * Baris yang benar-benar disetujui warga untuk `rencanaHash` (placeholder isian + nama berkas). Baris yang
   * ditolak diisi warga sendiri: tidak dikirim ulang (worker akan meminta persetujuan lagi), dan setelah baris
   * yang disetujui terisi kendali diserahkan (`isi_sendiri`) sebelum AI menekan Lanjut.
   */
  persetujuan?: (rencanaHash: string) => PersetujuanHalaman | undefined;
  anggaran?: Anggaran;
  jam?: () => number;
  /** Batas total menunggu warga (login, persetujuan, ambil alih) sebelum Navigator berhenti. */
  tungguTotalMs?: number;
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
      return a;
    default:
      return 'tidak_yakin';
  }
}

function alasanDariKontrak(a: Extract<Aksi, { jenis: 'serahkan' }>['alasan']): AlasanAmbilAlih {
  return a;
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
  | { kode: 'ok' }
  | { kode: 'ulang' }
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
      for (const c of j.catatan) o.jejak(c);
    } catch {
      // Jejak tetap di buffer worker dan ikut terkuras pada panggilan berikutnya.
    }
  }
  const tangan = {
    amati: async () => {
      const r = await o.tangan.amati();
      await kuras();
      return r;
    },
    aksi: async (r: Parameters<TanganPendamping['aksi']>[0]) => {
      const h = await o.tangan.aksi(r);
      await kuras();
      return h;
    },
    tunggu: async (maksMs: number) => {
      const t = await o.tangan.tunggu(maksMs);
      await kuras();
      return t;
    },
  };

  /** Long-poll selama warga memegang kendali / persetujuan tertunda. AI time dijeda. */
  async function tungguKendali(): Promise<'ai' | 'berakhir' | 'habis'> {
    ang.jedaAi();
    try {
      for (;;) {
        if (batal()) return 'berakhir';
        if (ditunggu >= tungguTotal) return 'habis';
        const mulai = jam();
        const maks = Math.min(TUNGGU_MAKS_MS, tungguTotal - ditunggu);
        const t = await tangan.tunggu(maks);
        // Paling sedikit 1 detik per putaran: worker yang menjawab seketika tanpa perubahan tidak membuat loop panas.
        ditunggu += Math.max(jam() - mulai, t.habisWaktu ? maks : 0, 1_000);
        if (t.mode === 'done' || STATUS_AKHIR.includes(t.status)) return 'berakhir';
        if (t.mode === 'ai' && t.status !== 'menunggu_data') return 'ai';
      }
    } finally {
      ang.mulaiAi();
    }
  }

  /** Serahkan kendali ke warga (templat) lalu tunggu kendali kembali. */
  async function serahkanTunggu(
    alasan: AlasanAmbilAlih,
    seq: number,
    ref?: string,
  ): Promise<'ai' | 'berakhir' | 'habis'> {
    const aksi: Aksi[] = [
      { jenis: 'serahkan', alasan: alasanKontrak(alasan), ...(ref !== undefined ? { ref } : {}) },
    ];
    // Jejak ambil alih (mulai/selesai) dicatat worker saat serahkan benar-benar dijalankan / kendali kembali.
    const r = await tangan.aksi({ rencanaHash: hashRencana({ aksi }), aksi, seq, kolom: [], berkas: [] });
    if (r.mode === 'done') return 'berakhir';
    return await tungguKendali();
  }

  /** Serahkan akhir: Navigator berhenti, warga melanjutkan sendiri (pesan templat). */
  async function serahkanAkhir(alasan: AlasanAmbilAlih, seq: number): Promise<HasilNavigator> {
    const aksi: Aksi[] = [{ jenis: 'serahkan', alasan: alasanKontrak(alasan) }];
    ang.jedaAi();
    await tangan.aksi({ rencanaHash: hashRencana({ aksi }), aksi, seq, kolom: [], berkas: [] });
    return { akhir: 'ambil_alih', alasan, pesan: PESAN_AMBIL_ALIH[alasan], resi: resi(alasan) };
  }

  const setelahTunggu = (t: 'ai' | 'berakhir' | 'habis'): HasilNavigator | null =>
    t === 'ai' ? null : berhenti(t === 'habis' ? 'tunggu_habis' : batal() ? 'dibatalkan' : 'sesi_berakhir');

  /** Sesudah serahkan: sesi berakhir di tangan warga = ambil alih (bukan galat). */
  const setelahSerahkan = (alasan: AlasanAmbilAlih, t: 'ai' | 'berakhir' | 'habis'): HasilNavigator | null =>
    t === 'berakhir' && !batal()
      ? { akhir: 'ambil_alih', alasan, pesan: PESAN_AMBIL_ALIH[alasan], resi: resi(alasan) }
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
  ): Promise<HasilJalan | HasilNavigator> {
    let obs = p;
    let sisa = badan;
    let sudahDiminta = false;
    let ikat = 0;
    /** Baris ditolak warga: setelah baris yang disetujui terisi, kendali diserahkan (isi sendiri). */
    let serahIsi: { ref?: string | undefined } | null = null;
    const selesai = (): HasilJalan =>
      serahIsi
        ? { kode: 'serahkan', alasan: 'isi_sendiri', ref: serahIsi.ref, seq: obs.seq }
        : { kode: 'ok' };
    for (;;) {
      if (sisa.length === 0) return selesai();
      const r = await tangan.aksi({
        rencanaHash,
        aksi: sisa,
        seq: obs.seq,
        kolom: kolomUntuk(kolom, sisa),
        berkas,
      });
      ang.catatAksi(r.hasil.filter((h) => h.kode === 'ok').length);
      if (r.mode === 'done') return { kode: 'berakhir' };
      // Satu entri per aksi (kontrak worker); entri hilang dianggap tidak dijalankan.
      const kode = (j: number) => r.hasil.find((h) => h.indeks === j)?.kode ?? 'DILEWATI';

      // Persetujuan: worker tidak menjalankan apa pun sebelum seluruh baris isian rencana ini disetujui.
      const belum = sisa.filter((_, j) => kode(j) === 'BELUM_DISETUJUI');
      if (belum.length > 0) {
        // Sudah satu putaran persetujuan dan masih tertahan: jangan meminta lagi tanpa henti.
        if (sudahDiminta)
          return { kode: 'serahkan', alasan: 'isi_sendiri', ref: refAksi(belum[0]), seq: obs.seq };
        sudahDiminta = true;
        const h = setelahTunggu(await tungguKendali());
        if (h) return h;
        const izin = o.persetujuan?.(rencanaHash);
        if (izin) {
          const ditolak = sisa.filter((a) => !aksiDisetujui(a, izin));
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
          // Validasi ulang terhadap pengamatan baru (tanpa LLM); hash persetujuan tetap milik rencana asal.
          const v = validasiRencana({ aksi: terikat }, baru, o.validasi);
          o.jejak({
            jenis: 'validasi',
            rencanaHash,
            putusan: v.ok ? 'terima' : 'tolak',
            aturan: v.ok ? [] : v.aturan,
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
          // Worker sudah membatalkan permintaan dan menyerahkan kendali (`periksa`) ke warga.
          return { kode: 'tunggu' };
        default:
          return { kode: 'ulang' };
      }
    }
  }

  let umpanBalik: { sidik: string; aturan: IdAturan[] } | null = null;
  try {
    ang.mulaiAi();
    for (;;) {
      if (batal()) return berhenti('dibatalkan');
      const p = await amati();
      if ('akhir' in p) return p;
      o.jejak({ jenis: 'amati', host: p.host, sidik: p.sidik, elemen: p.elemen.length });
      const cek = periksaHost(p);
      // Mode Uji: host non-replika = berhenti seketika, tanpa aksi apa pun.
      if (cek === 'mode_uji') return berhenti('mode_uji_host');
      if (cek === 'luar') {
        o.jejak({ jenis: 'host_kandidat', host: p.host });
        return await serahkanAkhir('host_luar', p.seq);
      }
      if (p.sinyal.sukses) {
        buktiAkhir = buktiDariPengamatan(p);
        if (buktiAkhir) o.jejak({ jenis: 'bukti', bukti: buktiAkhir });
        ang.jedaAi();
        return {
          akhir: 'selesai',
          bukti: buktiAkhir,
          pesan: ringkasBukti(buktiAkhir),
          resi: resi('selesai'),
        };
      }
      ang.catatHalaman(p.sidik);
      const habis = ang.habis();
      if (habis) return await serahkanAkhir(habis, p.seq);

      // Giliran warga yang pasti (tanpa LLM).
      const giliran: AlasanAmbilAlih | null =
        p.sinyal.captcha || p.sinyal.tantangan
          ? 'captcha'
          : p.sinyal.otp
            ? 'otp'
            : p.sinyal.login
              ? 'masuk_akun'
              : null;
      if (giliran) {
        const h = setelahSerahkan(giliran, await serahkanTunggu(giliran, p.seq));
        if (h) return h;
        continue;
      }

      const minta = await mintaRencana(
        o.llm,
        {
          pengamatan: p,
          tujuan: o.tujuan,
          ...(o.validasi?.katalog ? { katalog: [...o.validasi.katalog] } : {}),
          ...(o.validasi?.berkas ? { berkas: [...o.validasi.berkas] } : {}),
          kodeKabKota: o.kodeKabKota,
          ...(umpanBalik?.sidik === p.sidik ? { umpanBalik: umpanBalik.aturan } : {}),
        },
        o.signal,
      );
      ang.catatLlm(minta.panggilan);
      const v = minta.ok
        ? validasiRencana(minta.rencana, p, o.validasi)
        : { ok: false as const, aturan: ['SKEMA_TIDAK_SAH' as const], rencanaHash: hashRencana(null) };
      if (minta.ok && v.ok)
        o.jejak({
          jenis: 'rencana',
          model: o.llm.model.slice(0, 100) || '-',
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
        continue;
      }
      umpanBalik = null;
      dijalankan.push(v.rencanaHash);

      const aksi = v.rencana.aksi;
      const akhir = aksi.at(-1)!;
      const terminal = AKSI_TERMINAL.includes(akhir.jenis) ? akhir : undefined;
      const badan = terminal ? aksi.slice(0, -1) : aksi;
      if (badan.length > 0) {
        const r = await jalankanAksi(p, v.rencanaHash, v.kolom, v.berkas, badan);
        if ('akhir' in r) return r;
        if (r.kode === 'berakhir') return berhenti('sesi_berakhir');
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
      }
      ang.berhasil();
      if (terminal?.jenis === 'tidak_bisa') {
        await tangan.aksi({
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
        const h = setelahSerahkan(alasan, await serahkanTunggu(alasan, p.seq, terminal.ref));
        if (h) return h;
      }
    }
  } catch {
    if (batal()) return berhenti('dibatalkan');
    return berhenti('galat_worker');
  }
}
