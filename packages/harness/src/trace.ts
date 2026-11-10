import type {
  JejakItem,
  JejakResponse as JejakView,
  TransparansiResponse as TransparansiView,
  UrusinEventType,
} from '@urusin/contracts';
import type { Db } from './db.js';
import type { HarnessStore, SpanInput } from './store.js';

/**
 * Span ala OpenTelemetry GenAI (audit #18). Nama atribut mengikuti semconv: `gen_ai.operation.name`
 * (chat | execute_tool | retrieval | embeddings), `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
 * `gen_ai.usage.output_tokens`, plus kustom `urusin.structured_mode`, `urusin.cost_idr`.
 * Disimpan di SQLite TANPA isi prompt/respons dan tanpa PII; hanya angka, nama tool, dan keputusan gate.
 */
export const OTEL = {
  operationName: 'gen_ai.operation.name',
  requestModel: 'gen_ai.request.model',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
  toolName: 'gen_ai.tool.name',
  structuredMode: 'urusin.structured_mode',
  costIdr: 'urusin.cost_idr',
} as const;

export type SpanScope = {
  urusanId: string;
  turnId?: string | undefined;
  parentId?: string | undefined;
};

export type SpanEnd = Partial<
  Pick<
    SpanInput,
    | 'status'
    | 'errorCode'
    | 'model'
    | 'tokensIn'
    | 'tokensOut'
    | 'structuredMode'
    | 'costIdr'
    | 'degraded'
    | 'attrs'
  >
>;

export class Tracer {
  constructor(
    private readonly store: HarnessStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Mulai span; panggil `end()` tepat sekali. Latensi diukur dengan jam monotonik `now`. */
  start(scope: SpanScope, name: string, operation: string) {
    const t0 = this.now();
    const startedAt = new Date(t0);
    return {
      end: (fields: SpanEnd = {}): string =>
        this.store.recordSpan({
          ...scope,
          name,
          operation,
          startedAt,
          durationMs: this.now() - t0,
          status: fields.status ?? 'ok',
          ...fields,
        }),
    };
  }
}

// --- Query helper: /jejak/[id] ---

type SpanRow = {
  id: string;
  started_at: string;
  name: string;
  operation: string;
  duration_ms: number;
  status: 'ok' | 'error';
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  structured_mode: string | null;
  cost_idr: number | null;
};

function ringkasEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'policy_gate':
      return `${String(payload.keputusan)} ${String(payload.tool)}${payload.aturan ? ` (${String(payload.aturan)})` : ''}`;
    case 'state':
      return `${String(payload.dari ?? '?')} → ${String(payload.state)}`;
    case 'progress':
      return String(payload.label ?? '');
    case 'error':
      return `${String(payload.kode)}: ${String(payload.pesanWarga)}`;
    case 'handoff':
      return String(payload.alasan ?? 'handoff');
    case 'grounded_answer':
      return `${(payload.klaim as unknown[] | undefined)?.length ?? 0} klaim bersumber`;
    case 'execution_request':
      return `${String(payload.adapterId)}/${String(payload.flowId)}`;
    case 'gate':
      return `menunggu warga: ${String(payload.jenis)}`;
    case 'done':
      return String(payload.status);
    case 'wilayah': {
      const nama = (payload.ktp as { nama?: string } | undefined)?.nama ?? '?';
      return payload.status === 'usulan'
        ? `Wilayah KTP diusulkan (${payload.sumber === 'data_diri' ? 'Data Diri' : 'pilihan perangkat'}): ${nama}`
        : `Wilayah KTP dipastikan warga: ${nama}`;
    }
    case 'jejak_pendamping':
      return ringkasJejakPendamping((payload.catatan ?? {}) as Record<string, unknown>);
    default:
      return type;
  }
}

const pendek = (h: unknown) => String(h ?? '').slice(0, 8);

/** Ringkasan satu catatan Navigator generik (tanpa nilai, tanpa teks halaman; hash dipendekkan). */
function ringkasJejakPendamping(c: Record<string, unknown>): string {
  switch (c.jenis) {
    case 'amati':
      return `Navigator mengamati ${String(c.host)} (${String(c.elemen)} elemen)`;
    case 'rencana': {
      const aksi = Array.isArray(c.aksi) ? (c.aksi as { jenis?: string }[]) : [];
      return `Rencana ${pendek(c.rencanaHash)}: ${aksi.map((a) => a.jenis).join(', ') || '-'}`;
    }
    case 'validasi': {
      const aturan = Array.isArray(c.aturan) ? (c.aturan as string[]) : [];
      return c.putusan === 'terima'
        ? `Validator menerima rencana ${pendek(c.rencanaHash)}`
        : `Validator menolak rencana ${pendek(c.rencanaHash)} (${aturan.join(', ') || '-'})`;
    }
    case 'klik':
      return `Klik ${String(c.ref)} kelas ${String(c.kelas)}: ${c.putusan === 'izinkan' ? 'diizinkan' : 'ditolak'}`;
    case 'blokir':
      return `Gerbang tulis memblokir ${String(c.metode)} ke ${String(c.host)}`;
    case 'persetujuan':
      return `Warga menyetujui ${String(c.n)} isian untuk rencana ${pendek(c.rencanaHash)}`;
    case 'ambil_alih':
      return c.fase === 'mulai'
        ? `Kendali ke warga${c.alasan ? ` (${String(c.alasan)})` : ''}`
        : 'Kendali kembali ke AI';
    case 'host_kandidat':
      return `Host di luar registry wilayah: ${String(c.host)} (diserahkan ke warga)`;
    case 'bukti':
      return 'Bukti pengajuan tercatat';
    case 'jejak_terbuang':
      return `${String(c.n)} catatan worker terbuang (buffer jejak penuh); rantai audit sesi ini tidak lengkap`;
    default:
      return 'jejak_pendamping';
  }
}

/** Timeline urusan: event + span digabung dan diurutkan menurut waktu. Tidak memuat isi pesan. */
export function jejakView(store: HarnessStore, urusanId: string, clientHead?: string): JejakView {
  const u = store.getUrusanOrThrow(urusanId);
  const verify = store.verifyChain(urusanId, clientHead);
  const events = store.eventsAfter(urusanId, 0, 5000);
  const spans = store.db
    .prepare(
      `SELECT id, started_at, name, operation, duration_ms, status, model, tokens_in, tokens_out, structured_mode, cost_idr
       FROM spans WHERE urusan_id = ? ORDER BY started_at, rowid`,
    )
    .all(urusanId) as SpanRow[];
  const items: JejakItem[] = [
    ...events.map((e): JejakItem => ({
      jenis: 'event',
      seq: e.seq,
      at: e.at,
      type: e.type as UrusinEventType,
      ringkas: ringkasEvent(e.type, (e.payload ?? {}) as Record<string, unknown>),
    })),
    ...spans.map((s): JejakItem => ({
      jenis: 'span',
      id: s.id,
      at: s.started_at,
      nama: s.name,
      operasi: s.operation,
      durasiMs: s.duration_ms,
      status: s.status,
      ...(s.model ? { model: s.model } : {}),
      ...(s.tokens_in !== null ? { tokenMasuk: s.tokens_in } : {}),
      ...(s.tokens_out !== null ? { tokenKeluar: s.tokens_out } : {}),
      ...(s.cost_idr !== null ? { biayaIdr: s.cost_idr } : {}),
      ...(s.structured_mode ? { modeStruktur: s.structured_mode } : {}),
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    urusanId,
    state: u.state,
    version: u.version,
    chainHead: store.chainHead(urusanId),
    rantai: verify.ok
      ? { valid: true, jumlahEvent: verify.count }
      : { valid: false, jumlahEvent: verify.count, rusakDiSeq: verify.brokenAtSeq },
    biayaIdr: u.costIdr,
    tokenMasuk: u.tokensIn,
    tokenKeluar: u.tokensOut,
    timeline: items,
  };
}

/** Persentil nearest-rank dari data urut naik. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

/** Angka /transparansi: p50/p95 latensi panggilan LLM, biaya per hari, porsi permintaan degraded. */
export function transparansiView(db: Db, opts: { days?: number; now?: Date } = {}): TransparansiView {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 14;
  const from = new Date(now.getTime() - days * 86_400_000);
  const lat = (
    db
      .prepare(
        "SELECT duration_ms FROM spans WHERE operation = 'chat' AND started_at >= ? ORDER BY duration_ms",
      )
      .all(from.toISOString()) as { duration_ms: number }[]
  ).map((r) => r.duration_ms);
  const perHari = db
    .prepare('SELECT day, cost_idr, requests, degraded_requests FROM daily_usage WHERE day >= ? ORDER BY day')
    .all(from.toISOString().slice(0, 10)) as {
    day: string;
    cost_idr: number;
    requests: number;
    degraded_requests: number;
  }[];
  const total = perHari.reduce((a, r) => a + r.requests, 0);
  const degraded = perHari.reduce((a, r) => a + r.degraded_requests, 0);
  return {
    jendela: { dari: from.toISOString(), sampai: now.toISOString() },
    latensiMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), sampel: lat.length },
    biayaPerHariIdr: perHari.map((r) => ({ hari: r.day, biayaIdr: r.cost_idr, permintaan: r.requests })),
    persenDegraded: total === 0 ? 0 : degraded / total,
    totalPermintaan: total,
  };
}
