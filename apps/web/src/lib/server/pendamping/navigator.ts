import {
  AksiSesiResponseSchema,
  AmatiSesiResponseSchema,
  JejakSesiResponseSchema,
  TungguSesiResponseSchema,
  type CatatanPendamping,
  type PemilikSesiInternal,
} from '@urusin/contracts';
import type { EgressFetch } from '@urusin/egress';
import { hostsAiWilayah, type UrusanRow } from '@urusin/harness';
import type { ChatProvider, Usage } from '@urusin/llm';
import {
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
import type { Runtime } from '#lib/server/runtime.js';

/**
 * Broker Navigator generik (ADR 0030) di web app: menjalankan loop @urusin/navigator terhadap worker pemegang
 * sesi lewat kanal internal bertanda HMAC (`/internal/sesi/{amati,aksi,tunggu,jejak}`). Otak ada di sini karena
 * container pendamping tidak punya rute ke LLM, dan redaksi PII serta rantai audit sudah di web.
 *
 * - Host yang boleh dikerjakan AI = `hostsAiWilayah(kode)` (registry wilayah, tanpa host pihak ketiga) wilayah KTP urusan.
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
 */

/** Galat kanal internal: status HTTP dari worker (404 = sesi tidak ada). */
export class GalatTangan extends Error {
  constructor(readonly status: number) {
    super(`worker pendamping menjawab ${status}`);
    this.name = 'GalatTangan';
  }
}

/** Klien worker sesuai kontrak; hanya badan pemilik + data aksi yang dikirim. */
export function tanganWorker(
  cfg: PendampingConfig | null,
  owner: PemilikSesiInternal,
  fetcher?: EgressFetch,
): TanganPendamping {
  const minta = async <T>(path: string, schema: ZodType<T>, body: BodyPemilik, batasMs?: number) => {
    const r = await panggilPemilik(cfg, path, schema, body, fetcher, batasMs);
    if (!r.ok) throw new GalatTangan(r.response.status);
    return r.data;
  };
  const pemilik = { urusanId: owner.urusanId, sidHash: owner.sidHash };
  return {
    amati: () => minta('/internal/sesi/amati', AmatiSesiResponseSchema, pemilik),
    aksi: (r) =>
      minta('/internal/sesi/aksi', AksiSesiResponseSchema, {
        ...pemilik,
        rencanaHash: r.rencanaHash,
        aksi: r.aksi,
        seq: r.seq,
        // Label portal + tanda tidak lazim untuk lembar persetujuan (hanya baris aksi yang dikirim).
        ...(r.kolom.length > 0 ? { kolom: r.kolom } : {}),
      }),
    // Long-poll: batas HTTP sedikit di atas maksMs worker.
    tunggu: (maksMs) =>
      minta('/internal/sesi/tunggu', TungguSesiResponseSchema, { ...pemilik, maksMs }, maksMs + 5_000),
    kuras: () => minta('/internal/sesi/jejak', JejakSesiResponseSchema, pemilik),
  };
}

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
  const hasil = await jalankanNavigator({
    executionId: m.executionId,
    tangan: deps.tangan ?? tanganWorker(deps.cfg, m.owner, deps.fetcher),
    llm: { ...llm, provider: providerTerukur(llm.provider, catatPemakaian) },
    tujuan: (m.urusan.jenis ? findBundel(m.urusan.jenis)?.judul : undefined) ?? 'Layanan kependudukan',
    hostsBoleh: m.modeUji ? fixture : new Set(hostsAiWilayah(m.urusan.kodeKabKota)),
    modeUji: m.modeUji ? { hostsFixture: fixture } : undefined,
    kodeKabKota: m.urusan.kodeKabKota,
    jejak,
    persetujuan: (h) => (b?.executionId === m.executionId ? b.persetujuan.get(h) : undefined),
    // Navigator bukan giliran percakapan yang sedang diklaim: turnCount dipakai apa adanya.
    kuotaHabis: () =>
      rt.quota.check(rt.store.getUrusanOrThrow(id), { countThisTurn: false }).mode === 'habis',
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  rt.publish(m.urusan.id, { type: 'progress', label: hasil.pesan });
  return hasil;
}

/**
 * Mulai Navigator di latar untuk eksekusi `generik` yang baru dibuka sesinya. false bila urusan ini sudah punya
 * loop berjalan. Galat apa pun tidak pernah menjatuhkan request; warga tetap memegang layar.
 */
export function mulaiNavigator(rt: Runtime, m: MasukanNavigator, deps: DepsNavigator): boolean {
  if (berjalan.has(m.urusan.id)) return false;
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

/** Hentikan loop Navigator urusan ini (sesi diakhiri warga). */
export function hentikanNavigator(urusanId: string): void {
  berjalan.get(urusanId)?.ac.abort();
  berjalan.delete(urusanId);
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
