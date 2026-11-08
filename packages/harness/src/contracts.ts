/**
 * Kontrak event SSE dan view-model untuk UI (rencana §3.2). HANYA tipe: aman diimpor klien
 * (`import type`), tidak membawa kode server ke bundel JS.
 *
 * Setiap frame SSE: `id: <seq>`, `event: <type>`, `data: <StreamEnvelope JSON>`.
 * `chainHead` = hash kepala rantai audit setelah event ini; klien menyimpannya (IndexedDB) agar
 * `/jejak/[id]` dapat mendeteksi manipulasi server.
 */

export const URUSAN_STATES = [
  'BARU',
  'MEMAHAMI',
  'RENCANA_DIUSULKAN',
  'RENCANA_DISETUJUI',
  'MENYIAPKAN_BERKAS',
  'BERKAS_SIAP',
  'MENUNGGU_LOGIN_WARGA',
  'MENUNGGU_PROFIL_WARGA',
  'MENGISI',
  'MENUNGGU_KONFIRMASI',
  'MENGUNGGAH',
  'MENUNGGU_SUBMIT_WARGA',
  'TERKIRIM',
  'DIPANTAU',
  'SELESAI',
  'DITOLAK',
  'DIBATALKAN',
  'DIPANDU',
  'GAGAL_AMAN',
] as const;
export type UrusanState = (typeof URUSAN_STATES)[number];

export type SourceRefView = { url: string; judul: string; instansi: string };

/** Progres tanpa isi jawaban: satu-satunya yang di-stream saat menyusun jawaban persyaratan/prosedur. */
export type ProgressEvent = {
  type: 'progress';
  data: {
    fase: 'memahami' | 'mencari_sumber' | 'memanggil_tool' | 'menyusun_jawaban' | 'memverifikasi_kutipan';
    pesan: string;
    tool?: string;
  };
};

export type PlanEvent = {
  type: 'plan';
  data: {
    ringkasan: string;
    langkah: { id: string; judul: string; jenis: 'online-adapter' | 'online-manual' | 'offline' }[];
  };
};

export type AssistantTextEvent = { type: 'assistant_text'; data: { teks: string } };

export type VerifiedCitationView = {
  refId: string;
  kutipanPersis: string;
  sumber: SourceRefView;
  /** Tautan sumber dengan Text Fragment (`#:~:text=`) yang menyorot kutipan. */
  tautanKutipan: string;
  verifiedAt: string | null;
  /** true bila `verifiedAt` > 30 hari atau null: UI menampilkan lencana "perlu dicek ulang". */
  perluDicekUlang: boolean;
};

export type GroundedAnswerEvent = {
  type: 'grounded_answer';
  data: {
    klaim: { teks: string; kutipan: VerifiedCitationView[] }[];
    /** Jumlah klaim yang dibuang karena kutipan tidak terverifikasi. */
    klaimDibuang: number;
    kalimatTetap: string;
  };
};

export type HandoffEvent = {
  type: 'handoff';
  data: {
    pesan: string;
    kanal: SourceRefView[];
    alasan: 'tanpa_sumber' | 'kutipan_tidak_terverifikasi' | 'kuota';
  };
};

/** Permintaan eksekusi untuk ekstensi; nilai placeholder di-resolve di sisi klien, bukan server. */
export type ExecutionRequest = {
  executionId: string;
  adapterId: string;
  flowId: string;
  params: Record<string, string | number | boolean>;
  /** Nama tool + hash parameter yang disetujui lewat konfirmasi. */
  tool: string;
  paramsHash: string;
};

export type ExecutionRequestEvent = { type: 'execution_request'; data: ExecutionRequest };

export type GateDecision = 'allow' | 'deny';
export type GateRule =
  | 'TOOL_NOT_ALLOWED_IN_STATE'
  | 'UNKNOWN_TOOL'
  | 'SCHEMA_INVALID'
  | 'PLACEHOLDER_OR_PII_IN_PARAM'
  | 'FINAL_REQUIRES_CITIZEN'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_MISMATCH'
  | 'CONFIRMATION_EXPIRED'
  | 'ORIGIN_NOT_OFFICIAL'
  | 'QUOTA_EXCEEDED';

export type GateEvent = {
  type: 'gate';
  data: { tool: string; keputusan: GateDecision; aturan?: GateRule; pesan?: string };
};

export type StateEvent = { type: 'state'; data: { dari: UrusanState; ke: UrusanState; version: number } };

export type ErrorCode =
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'LLM_REFUSAL'
  | 'LLM_LENGTH'
  | 'LLM_CONTENT_FILTER'
  | 'LLM_FAILED'
  | 'QUOTA'
  | 'ABORTED'
  | 'INTERNAL';

export type ErrorEvent = {
  type: 'error';
  data: { kode: ErrorCode; pesan: string; dapatDiulang: boolean };
};

export type DoneEvent = {
  type: 'done';
  data: {
    turnId: string;
    status: 'selesai' | 'timeout' | 'galat' | 'dibatalkan';
    /** true di mode degraded "JSON satu aksi": klien boleh mengirim "lanjut" agar agen meneruskan. */
    lanjutkan: boolean;
    degraded: boolean;
  };
};

export type UrusinEvent =
  | ProgressEvent
  | PlanEvent
  | AssistantTextEvent
  | GroundedAnswerEvent
  | HandoffEvent
  | ExecutionRequestEvent
  | GateEvent
  | StateEvent
  | ErrorEvent
  | DoneEvent;

export type UrusinEventType = UrusinEvent['type'];

export const EVENT_TYPES: readonly UrusinEventType[] = [
  'progress',
  'plan',
  'assistant_text',
  'grounded_answer',
  'handoff',
  'execution_request',
  'gate',
  'state',
  'error',
  'done',
];

/** Bungkus yang dikirim di `data:` setiap frame SSE. */
export type StreamEnvelope<E extends UrusinEvent = UrusinEvent> = {
  seq: number;
  at: string;
  chainHead: string;
  type: E['type'];
  data: E['data'];
};

// --- Request/response REST ---

export type BuatUrusanRequest = { kodeKabKota?: string; pesan?: string };
export type BuatUrusanResponse = { id: string; state: UrusanState; version: number; chainHead: string };

export type KirimPesanRequest = { teks: string };
export type KirimPesanResponse = { turnId: string; diterima: true };

export type ApiError = { kode: string; pesan: string };

// --- /jejak/[id] dan /transparansi ---

export type JejakItem =
  | { jenis: 'event'; seq: number; at: string; type: UrusinEventType; ringkas: string }
  | {
      jenis: 'span';
      id: string;
      at: string;
      nama: string;
      operasi: string;
      durasiMs: number;
      model?: string;
      tokenMasuk?: number;
      tokenKeluar?: number;
      biayaIdr?: number;
      modeStruktur?: string;
      status: 'ok' | 'error';
    };

export type JejakView = {
  urusanId: string;
  state: UrusanState;
  version: number;
  chainHead: string;
  rantai: { valid: boolean; jumlahEvent: number; rusakDiSeq?: number };
  biayaIdr: number;
  tokenMasuk: number;
  tokenKeluar: number;
  timeline: JejakItem[];
};

export type TransparansiView = {
  jendela: { dari: string; sampai: string };
  latensiMs: { p50: number; p95: number; sampel: number };
  biayaPerHariIdr: { hari: string; biayaIdr: number; permintaan: number }[];
  persenDegraded: number;
  totalPermintaan: number;
};
