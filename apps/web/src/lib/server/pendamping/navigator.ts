import {
  AksiSesiResponseSchema,
  AmatiSesiResponseSchema,
  JejakSesiResponseSchema,
  SelesaiSesiResponseSchema,
  TungguSesiResponseSchema,
  type CatatanPendamping,
  type PemilikSesiInternal,
} from '@urusin/contracts';
import type { EgressFetch } from '@urusin/egress';
import { hostsPortalWilayah, type UrusanRow } from '@urusin/harness';
import type { ChatProvider, Usage } from '@urusin/llm';
import {
  hashRencana,
  jalankanNavigator,
  type HasilNavigator,
  type KonfigLlm,
  type PersetujuanHalaman,
  type TanganPendamping,
} from '@urusin/navigator';
import { findBundel } from '@urusin/registry';
import type { ZodType } from 'zod';
import { originFixtures } from '#lib/server/hosts.js';
import { panggilPemilik, type BodyPemilik, type PendampingConfig } from '#lib/server/pendamping.js';
import { catatHasilEksekusi } from '#lib/server/eksekusi.js';
import type { Runtime } from '#lib/server/runtime.js';

/**
 * Broker Navigator generik (ADR 0030) di web app: menjalankan loop @urusin/navigator terhadap worker pemegang
 * sesi lewat kanal internal bertanda HMAC (`/internal/sesi/{amati,aksi,tunggu,jejak}`). Otak ada di sini karena
 * container pendamping tidak punya rute ke LLM, dan redaksi PII serta rantai audit sudah di web.
 *
 * - Host yang boleh dikerjakan AI = `hostsPortalWilayah(kode)` wilayah KTP urusan: host yang sama dengan host
 *   sesi worker (`params.hosts` dari `rutePendamping`, tanpa host info dan tanpa host tantangan pihak ketiga).
 * - Mode Uji: host yang boleh HANYA replika (`originFixtures()`), dan loop memeriksa `pengamatan.host` di
 *   setiap langkah; host lain = berhenti seketika tanpa aksi.
 * - Setiap langkah dicatat sebagai event `jejak_pendamping` (tanpa nilai, tanpa teks halaman): catatan loop
 *   ditambah catatan worker (persetujuan, ambil alih, kelas klik, blokir gerbang tulis) yang dikuras sesudah
 *   setiap amati/aksi/tunggu.
 * - Baris lembar yang disetujui warga dicatat per `rencanaHash` saat izinkan-isi, agar baris yang ditolak
 *   tidak diminta ulang (warga mengisinya sendiri).
 * - Pesan untuk warga = templat dari @urusin/navigator, tidak pernah keluaran model.
 * - Biaya LLM Navigator masuk kuota runtime yang SAMA dengan agen (token/biaya per urusan + biaya harian);
 *   kuota habis = serahkan ke warga dengan pesan templat, tanpa memanggil model.
 * - Setiap jalur keluar selain ambil alih: kendali dikembalikan ke warga (best-effort `serahkan`), dan resi
 *   eksekusi dicatat ke jejak. Halaman sukses (oleh AI atau oleh warga yang menekan Kirim sendiri) = hasil
 *   `berhasil` dicatat ke urusan (TERKIRIM), tidak menunggu warga menutup sesi.
 */

/**
 * Galat kanal internal: status HTTP + kode dari worker (404 = sesi tidak ada). `sementara` (dibaca loop
 * Navigator): 409 LAYANAN_TIDAK_TERSEDIA = peramban sesi belum siap; 503 = halaman sedang berpindah atau
 * worker sesaat tidak terjangkau (termasuk batas waktu panggilan). `berakhir`: 404 SESI_TIDAK_ADA = sesi sudah
 * diakhiri (loop berhenti `sesi_berakhir`, bukan "tidak bisa dihubungi").
 */
export class GalatTangan extends Error {
  readonly sementara: 'belum_siap' | 'sesaat' | undefined;
  readonly berakhir: boolean;
  constructor(
    readonly status: number,
    readonly kode?: string,
  ) {
    super(`worker pendamping menjawab ${status}`);
    this.name = 'GalatTangan';
    this.sementara =
      status === 503
        ? 'sesaat'
        : status === 409 && kode === 'LAYANAN_TIDAK_TERSEDIA'
          ? 'belum_siap'
          : undefined;
    this.berakhir = status === 404 && kode === 'SESI_TIDAK_ADA';
  }
}

/** Batas satu panggilan `aksi`: satu klik bisa memuat halaman lambat + kembali dari host luar (~20 s+). */
export const BATAS_AKSI_MS = 60_000;

const kodeGalat = async (r: Response): Promise<string | undefined> => {
  const b: unknown = await r
    .clone()
    .json()
    .catch(() => null);
  return b !== null && typeof b === 'object' && 'kode' in b && typeof b.kode === 'string'
    ? b.kode
    : undefined;
};

/** Klien worker sesuai kontrak; hanya badan pemilik + data aksi yang dikirim. */
export function tanganWorker(
  cfg: PendampingConfig | null,
  owner: PemilikSesiInternal,
  fetcher?: EgressFetch,
  executionId?: string,
): TanganPendamping {
  const minta = async <T>(path: string, schema: ZodType<T>, body: BodyPemilik, batasMs?: number) => {
    const r = await panggilPemilik(cfg, path, schema, body, fetcher, batasMs);
    if (!r.ok) throw new GalatTangan(r.response.status, await kodeGalat(r.response));
    return r.data;
  };
  const pemilik = { urusanId: owner.urusanId, sidHash: owner.sidHash };
  return {
    // `pantau`: baca-saja saat warga memegang kendali (tanpa jejak amati, peta ref worker tidak diganti).
    amati: (opsi) =>
      minta(
        '/internal/sesi/amati',
        AmatiSesiResponseSchema,
        opsi?.pantau ? { ...pemilik, pantau: true } : pemilik,
      ),
    aksi: (r) =>
      minta(
        '/internal/sesi/aksi',
        AksiSesiResponseSchema,
        {
          ...pemilik,
          rencanaHash: r.rencanaHash,
          aksi: r.aksi,
          seq: r.seq,
          // Label portal + tanda tidak lazim untuk lembar persetujuan (hanya baris aksi yang dikirim).
          ...(r.kolom.length > 0 ? { kolom: r.kolom } : {}),
        },
        BATAS_AKSI_MS,
      ),
    // Long-poll: batas HTTP sedikit di atas maksMs worker.
    tunggu: (maksMs) =>
      minta('/internal/sesi/tunggu', TungguSesiResponseSchema, { ...pemilik, maksMs }, maksMs + 5_000),
    kuras: () => minta('/internal/sesi/jejak', JejakSesiResponseSchema, pemilik),
    // Terikat eksekusi: worker menolak (409) bila sesi sudah memegang eksekusi lain.
    selesai: (bukti) =>
      minta('/internal/sesi/selesai', SelesaiSesiResponseSchema, {
        ...pemilik,
        ...(executionId ? { executionId } : {}),
        ...(bukti ? { bukti } : {}),
      }),
  };
}

/** Mode Uji (juri/demo/tamu) di portal generik yang belum punya replika: panduan langkah, bukan galat mentah. */
export const PESAN_MODE_UJI_TANPA_REPLIKA =
  'Mode Uji hanya membuka situs latihan, dan portal wilayah ini belum punya situs latihan. Kami beralih ke ' +
  'panduan langkah: tidak ada data yang dikirim ke situs mana pun.';

/** Host replika Mode Uji (dari origin fixtures). */
export function hostsFixture(env?: Record<string, string | undefined>): Set<string> {
  return new Set([...originFixtures(env)].map((o) => new URL(o).host));
}

type Berjalan = {
  executionId: string;
  ac: AbortController;
  /** Persetujuan terakhir warga: rencanaHash → baris yang disetujui. Hanya di memori (sesi pendek). */
  persetujuan: Map<string, PersetujuanHalaman>;
};
/** Navigator yang sedang berjalan per urusan (proses tunggal; satu loop per urusan). */
const berjalan = new Map<string, Berjalan>();
/**
 * Eksekusi yang loop-nya pernah dijalankan proses ini. Loop yang hilang hanya dipasang ulang untuk eksekusi
 * yang BELUM pernah dijalankan di proses ini (web restart); selain itu kendali dikembalikan ke warga, supaya
 * anggaran per eksekusi tidak bisa direset dengan menekan Kembalikan.
 */
const pernahJalan = new Set<string>();

export type MasukanNavigator = {
  urusan: Pick<UrusanRow, 'id' | 'jenis' | 'kodeKabKota'>;
  executionId: string;
  owner: PemilikSesiInternal;
  modeUji: boolean;
};

export type DepsNavigator = {
  cfg: PendampingConfig | null;
  fetcher?: EgressFetch;
  /** Bawaan: provider/model/caps agen runtime (sudah dibungkus redaksi PII). */
  llm?: KonfigLlm;
  tangan?: TanganPendamping;
  signal?: AbortSignal;
};

/** Provider yang mencatat setiap `usage` (termasuk jawaban yang gagal skema) ke meter kuota runtime. */
function providerTerukur(inner: ChatProvider, catat: (u: Usage) => void): ChatProvider {
  return {
    get baseURL() {
      return inner.baseURL;
    },
    create: async (params, opts) => {
      const r = await inner.create(params, opts);
      if (r.usage) catat(r.usage);
      return r;
    },
    stream: (params, opts) => inner.stream(params, opts),
    transcribe: (input) => inner.transcribe(input),
    embed: (input) => inner.embed(input),
  };
}

/**
 * Kembalikan kendali ke warga (best-effort): layar tidak boleh tetap "AI sedang mengisi" sesudah loop berhenti.
 * Jejak worker dari serahkan ini ikut dikuras bila sesinya masih milik eksekusi ini.
 */
async function serahkanKeWarga(
  t: TanganPendamping,
  executionId: string,
  jejak: (c: CatatanPendamping) => void,
): Promise<void> {
  try {
    // Amati biasa (bukan pantau): seq serahkan harus seq pengamatan terakhir worker.
    const a = await t.amati();
    if (a.mode !== 'ai') return;
    if (a.executionId !== undefined && a.executionId !== executionId) return;
    const seq = a.pengamatan.seq;
    const aksi = [{ jenis: 'serahkan' as const, alasan: 'tidak_yakin' as const }];
    await t.aksi({ rencanaHash: hashRencana({ aksi, seq }), aksi, seq, kolom: [], berkas: [] });
    const j = await t.kuras?.();
    if (j && (j.executionId === undefined || j.executionId === executionId))
      for (const c of j.catatan) jejak(c);
  } catch {
    // Sesi sudah berakhir / worker tidak terjangkau: tidak ada yang perlu dikembalikan.
  }
}

/** Jalankan satu eksekusi Navigator sampai selesai/serah/berhenti; jejak dan pesan templat diterbitkan ke urusan. */
export async function jalankanNavigatorUrusan(
  rt: Runtime,
  m: MasukanNavigator,
  deps: DepsNavigator,
): Promise<HasilNavigator> {
  const jejak = (catatan: CatatanPendamping) =>
    void rt.publish(m.urusan.id, { type: 'jejak_pendamping', executionId: m.executionId, catatan });
  const b = berjalan.get(m.urusan.id);
  const fixture = hostsFixture();
  const llm = deps.llm ?? { provider: rt.deps.provider, model: rt.deps.model, caps: rt.deps.caps };
  const id = m.urusan.id;
  const catatPemakaian = (u: Usage) =>
    rt.store.addUsage(id, {
      tokensIn: u.prompt_tokens,
      tokensOut: u.completion_tokens,
      costIdr: rt.quota.costIdr(u),
      degraded: false,
    });
  const tangan = deps.tangan ?? tanganWorker(deps.cfg, m.owner, deps.fetcher, m.executionId);
  pernahJalan.add(m.executionId);
  let hasil: HasilNavigator | undefined;
  try {
    hasil = await jalankanNavigator({
      executionId: m.executionId,
      tangan,
      llm: { ...llm, provider: providerTerukur(llm.provider, catatPemakaian) },
      tujuan: (m.urusan.jenis ? findBundel(m.urusan.jenis)?.judul : undefined) ?? 'Layanan kependudukan',
      hostsBoleh: m.modeUji ? fixture : new Set(hostsPortalWilayah(m.urusan.kodeKabKota)),
      modeUji: m.modeUji ? { hostsFixture: fixture } : undefined,
      kodeKabKota: m.urusan.kodeKabKota,
      jejak,
      persetujuan: (h) => (b?.executionId === m.executionId ? b.persetujuan.get(h) : undefined),
      // Navigator bukan giliran percakapan yang sedang diklaim: turnCount dipakai apa adanya.
      kuotaHabis: () =>
        rt.quota.check(rt.store.getUrusanOrThrow(id), { countThisTurn: false }).mode === 'habis',
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } finally {
    // Setiap jalur keluar selain ambil alih/dipandu (yang sudah menyerahkan atau mengakhiri di worker),
    // termasuk galat tak terduga: kendali kembali ke warga. Sesi yang sudah berakhir dilewati.
    const lewati =
      hasil?.akhir === 'selesai' ||
      hasil?.akhir === 'ambil_alih' ||
      hasil?.akhir === 'dipandu' ||
      (hasil?.akhir === 'berhenti' && (hasil.alasan === 'dibatalkan' || hasil.alasan === 'sesi_berakhir'));
    if (!lewati) await serahkanKeWarga(tangan, m.executionId, jejak);
  }
  const r = hasil.resi;
  jejak({
    jenis: 'resi',
    akhir: r.akhir.slice(0, 40),
    hash: r.hash,
    halaman: r.halaman,
    aksi: r.aksi,
    panggilanLlm: r.panggilanLlm,
  });
  rt.publish(m.urusan.id, { type: 'progress', label: hasil.pesan });
  // Halaman sukses = berhasil (TERKIRIM), dicatat sekali per eksekusi; laporan "dibatalkan" yang datang
  // kemudian saat warga menutup sesi tidak menimpanya.
  if (hasil.akhir === 'selesai')
    catatHasilEksekusi(rt, rt.store.getUrusanOrThrow(id), m.executionId, 'berhasil', 'Browser Pendamping');
  return hasil;
}

/**
 * Mulai Navigator di latar untuk eksekusi `generik` yang baru dibuka sesinya. false bila urusan ini sudah punya
 * loop berjalan. Galat apa pun tidak pernah menjatuhkan request; warga tetap memegang layar.
 */
export function mulaiNavigator(rt: Runtime, m: MasukanNavigator, deps: DepsNavigator): boolean {
  const lama = berjalan.get(m.urusan.id);
  if (lama?.executionId === m.executionId) return false;
  // Loop lama milik eksekusi lain (sesi lama diakhiri dari layar lalu sesi baru dibuat): hentikan dan ganti.
  lama?.ac.abort();
  const ac = new AbortController();
  berjalan.set(m.urusan.id, { executionId: m.executionId, ac, persetujuan: new Map() });
  void jalankanNavigatorUrusan(rt, m, { ...deps, signal: ac.signal })
    .catch(() => {
      rt.publish(m.urusan.id, {
        type: 'progress',
        label: 'Bantuan AI berhenti karena gangguan. Anda tetap bisa melanjutkan sendiri dari layar.',
      });
    })
    .finally(() => {
      if (berjalan.get(m.urusan.id)?.ac === ac) berjalan.delete(m.urusan.id);
    });
  return true;
}

/** Hentikan loop Navigator urusan ini (sesi diakhiri warga). Entri dihapus loop itu sendiri saat selesai. */
export function hentikanNavigator(urusanId: string): void {
  berjalan.get(urusanId)?.ac.abort();
}

/**
 * Loop hilang (web restart, atau loop sudah berhenti) sementara sesi generik masih bermode `ai`: pasang ulang
 * untuk eksekusi yang belum pernah dijalankan proses ini, selain itu kembalikan kendali ke warga.
 * true bila loop dipasang ulang.
 */
export async function pulihkanNavigator(
  rt: Runtime,
  m: MasukanNavigator,
  deps: DepsNavigator,
): Promise<boolean> {
  if (berjalan.get(m.urusan.id)?.executionId === m.executionId) return false;
  if (!pernahJalan.has(m.executionId)) return mulaiNavigator(rt, m, deps);
  const jejak = (catatan: CatatanPendamping) =>
    void rt.publish(m.urusan.id, { type: 'jejak_pendamping', executionId: m.executionId, catatan });
  await serahkanKeWarga(
    deps.tangan ?? tanganWorker(deps.cfg, m.owner, deps.fetcher, m.executionId),
    m.executionId,
    jejak,
  );
  return false;
}

/**
 * Catat baris lembar yang benar-benar disetujui warga untuk `rencanaHash` (placeholder yang nilainya dikirim
 * ke worker + nama berkas). Jejak audit persetujuan sendiri dicatat worker.
 */
export function catatPersetujuanNavigator(
  urusanId: string,
  rencanaHash: string,
  disetujui: { placeholder: readonly string[]; berkas: readonly string[] },
): void {
  const b = berjalan.get(urusanId);
  if (!b) return;
  // Satu halaman disetujui pada satu waktu; yang lama tidak berguna lagi.
  b.persetujuan.clear();
  b.persetujuan.set(rencanaHash, {
    placeholder: new Set(disetujui.placeholder),
    berkas: new Set(disetujui.berkas),
  });
}
