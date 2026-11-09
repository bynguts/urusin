import { z } from 'zod';
import { IsoWaktuSchema, JenisLangkahSchema, SumberSchema, TierSchema, UrusanStateSchema } from './common.js';

/**
 * Event SSE: satu union bertanda `type`. Setiap frame: `id: <seq>`, `event: <type>`, `data: <JSON event>`.
 * `seq` = nilai `Last-Event-ID` untuk resume; `chainHead` = kepala rantai audit setelah event ini
 * (klien menyimpannya agar `/jejak/[id]` dapat mendeteksi manipulasi server).
 */
const dasar = {
  seq: z.number().int().nonnegative(),
  at: IsoWaktuSchema,
  chainHead: z.string().min(1),
};

function event<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), ...dasar, ...shape });
}

/** Progres tanpa isi jawaban: satu-satunya yang di-stream saat menyusun jawaban persyaratan. */
export const ProgressEventSchema = event('progress', {
  label: z.string().min(1),
  toolName: z.string().optional(),
});

/** Hanya untuk obrolan ringan di luar persyaratan/prosedur. Jawaban persyaratan tidak pernah di-stream per token. */
export const AssistantTextEventSchema = event('assistant_text', { delta: z.string() });

export const KutipanTerverifikasiSchema = z.object({
  refId: z.string().min(1),
  kutipanPersis: z.string().min(1),
  url: z.url(),
  judul: z.string().min(1),
  instansi: z.string().min(1),
  /** null = belum pernah diverifikasi tangan. */
  verifiedAt: IsoWaktuSchema.nullable(),
  /** Tautan sumber dengan Text Fragment (`#:~:text=`) yang menyorot kutipan. */
  textFragmentUrl: z.string().min(1),
  /** true bila `verifiedAt` null atau lebih dari 30 hari: UI menampilkan lencana "perlu dicek ulang". */
  perluDicekUlang: z.boolean(),
});
export type KutipanTerverifikasi = z.infer<typeof KutipanTerverifikasiSchema>;

export const KlaimSchema = z.object({
  teks: z.string().min(1),
  kutipan: z.array(KutipanTerverifikasiSchema).min(1),
});
export type Klaim = z.infer<typeof KlaimSchema>;

export const GroundedAnswerEventSchema = event('grounded_answer', {
  klaim: z.array(KlaimSchema),
  /** Jumlah klaim yang dibuang karena kutipannya tidak terverifikasi. */
  klaimDibuang: z.number().int().nonnegative(),
  /** Kalimat tetap tentang batas wewenang ("Keputusan ada di petugas ..."). */
  kalimatTetap: z.string(),
});

export const KanalSchema = z.object({
  nama: z.string().min(1),
  url: z.url().optional(),
  kontak: z.string().optional(),
});
export type Kanal = z.infer<typeof KanalSchema>;

export const HandoffEventSchema = event('handoff', {
  /** Kalimat untuk warga: kenapa dialihkan ke kanal resmi. */
  alasan: z.string().min(1),
  sebab: z.enum(['tanpa_sumber', 'kutipan_tidak_terverifikasi', 'kuota']),
  kanal: z.array(KanalSchema),
});

export const LangkahKartuSchema = z.object({
  id: z.string().min(1),
  jenis: JenisLangkahSchema,
  judul: z.string().min(1),
  lokasi: z.string().optional(),
  bawa: z.array(z.string()),
  sumber: z.array(SumberSchema),
});
export type LangkahKartu = z.infer<typeof LangkahKartuSchema>;

export const PlanCardEventSchema = event('plan_card', {
  ringkasan: z.string(),
  langkah: z.array(LangkahKartuSchema).min(1),
});

export const ItemChecklistSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** ok = lengkap, perlu = masih perlu disiapkan, kurang = ada yang kurang/salah. */
  status: z.enum(['ok', 'perlu', 'kurang']),
  alasan: z.string().optional(),
});
export const ChecklistEventSchema = event('checklist', { item: z.array(ItemChecklistSchema) });

export const EligibilityEventSchema = event('eligibility', {
  mungkin: z.array(z.string()),
  perluKonfirmasi: z.array(z.string()),
});

/** Permintaan eksekusi untuk ekstensi; nilai placeholder di-resolve di sisi klien, bukan server. */
export const ExecutionRequestEventSchema = event('execution_request', {
  executionId: z.string().min(1),
  adapterId: z.string().min(1),
  flowId: z.string().min(1),
  /** Ringkasan tersamar untuk layar konfirmasi (tanpa data pribadi mentah). */
  ringkasan: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Nama tool + hash parameter yang disetujui lewat konfirmasi. */
  tool: z.string(),
  paramsHash: z.string(),
  /**
   * Origin resmi yang dibuka adapter, bila bukan portal dukcapil kota urusan (mis. Samsat, OSS). Tanpa ini
   * server memakai origin portal kota dari registry.
   */
  origin: z.url().optional(),
  /** Alur baca-saja (cek status/informasi): tidak ada yang dikirim, jadi hasilnya tidak mengubah state urusan. */
  bacaSaja: z.boolean().optional(),
});

/** Menunggu bagian warga. */
export const GateEventSchema = event('gate', {
  jenis: z.enum(['konfirmasi', 'login', 'captcha', 'profil', 'final']),
  pesan: z.string(),
  /** Hanya `konfirmasi`: tool + hash parameter yang akan disetujui warga lewat POST /konfirmasi. */
  tool: z.string().optional(),
  paramsHash: z.string().optional(),
});

export const StateEventSchema = event('state', {
  state: UrusanStateSchema,
  tier: TierSchema.nullable(),
  version: z.number().int().nonnegative(),
  dari: UrusanStateSchema.optional(),
});

export const DegradedEventSchema = event('degraded', {
  /** Kemampuan yang sedang mati, mis. `vision`, `mikrofon`, `rerank`. */
  kapabilitas: z.array(z.string()),
  mode: z.enum(['hemat', 'tanpa_ai']).nullable(),
});

export const GalatEventSchema = event('error', {
  kode: z.enum([
    'TIMEOUT',
    'CONFLICT',
    'LLM_REFUSAL',
    'LLM_LENGTH',
    'LLM_CONTENT_FILTER',
    'LLM_FAILED',
    'QUOTA',
    'ABORTED',
    'INTERNAL',
  ]),
  pesanWarga: z.string().min(1),
  bisaUlang: z.boolean(),
});

export const TimeoutEventSchema = event('timeout', {});

/** Dikirim berkala agar proxy tidak memutus koneksi. Tidak punya `id:` dan tidak masuk tabel events. */
export const HeartbeatEventSchema = event('heartbeat', {});

export const DoneEventSchema = event('done', {
  turnId: z.string().min(1),
  status: z.enum(['selesai', 'timeout', 'galat', 'dibatalkan']),
  /** true di mode degraded "JSON satu aksi": klien boleh mengirim "lanjut" agar agen meneruskan. */
  lanjutkan: z.boolean(),
  degraded: z.boolean(),
  /** Versi urusan setelah turn (klaim turn dan klasifikasi menaikkan versi tanpa event `state`); klien memakainya sebagai expectedVersion berikutnya. */
  version: z.number().int().optional(),
});

export const GateRuleSchema = z.enum([
  'TOOL_NOT_ALLOWED_IN_STATE',
  'UNKNOWN_TOOL',
  'SCHEMA_INVALID',
  'PLACEHOLDER_OR_PII_IN_PARAM',
  'FINAL_REQUIRES_CITIZEN',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_MISMATCH',
  'CONFIRMATION_EXPIRED',
  'ORIGIN_NOT_OFFICIAL',
  'QUOTA_EXCEEDED',
]);
export type GateRule = z.infer<typeof GateRuleSchema>;

/** Keputusan policy gate (audit/jejak). Bukan menunggu warga: lihat `gate`. */
export const PolicyGateEventSchema = event('policy_gate', {
  tool: z.string(),
  keputusan: z.enum(['allow', 'deny']),
  aturan: GateRuleSchema.optional(),
  pesan: z.string().optional(),
});

export const UrusinEventSchema = z.discriminatedUnion('type', [
  ProgressEventSchema,
  AssistantTextEventSchema,
  GroundedAnswerEventSchema,
  HandoffEventSchema,
  PlanCardEventSchema,
  ChecklistEventSchema,
  EligibilityEventSchema,
  ExecutionRequestEventSchema,
  GateEventSchema,
  StateEventSchema,
  DegradedEventSchema,
  GalatEventSchema,
  TimeoutEventSchema,
  HeartbeatEventSchema,
  DoneEventSchema,
  PolicyGateEventSchema,
]);

export type UrusinEvent = z.infer<typeof UrusinEventSchema>;
export type UrusinEventType = UrusinEvent['type'];
export type EventOf<T extends UrusinEventType> = Extract<UrusinEvent, { type: T }>;
/** Isi event tanpa amplop dan tanpa `type`. */
export type PayloadOf<T extends UrusinEventType> = Omit<EventOf<T>, 'seq' | 'at' | 'chainHead' | 'type'>;
/** Isi event tanpa field amplop: yang dihasilkan harness sebelum diberi seq/at/chainHead. */
export type EventPayload = {
  [T in UrusinEventType]: { type: T } & Omit<EventOf<T>, 'seq' | 'at' | 'chainHead' | 'type'>;
}[UrusinEventType];

export const EVENT_TYPES: readonly UrusinEventType[] = UrusinEventSchema.options.map(
  (o) => o.shape.type.value,
);
