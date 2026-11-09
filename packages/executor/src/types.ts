import type { Step } from '@urusin/core';

/** Penyimpanan kunci-nilai minimal (chrome.storage.session di ekstensi, Map di pendamping/tes). */
export type KV = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

/** Permintaan eksekusi: langkah adapter (bukan tulisan LLM) + origin dasar untuk `nav`. */
export type ExecutionRequest = {
  executionId: string;
  /** Origin dasar untuk langkah `nav` (path relatif). */
  origin: string;
  steps: Step[];
};

export type ErrorReply = { ok: false; code: string; message: string };

export const err = (code: string, message: string): ErrorReply => ({ ok: false, code, message });

/** Ringkasan persetujuan (gate kedua) untuk ditampilkan ke warga sebelum input/write pertama. */
export type ConsentSummary = {
  origin: string;
  instansi?: string | undefined;
  /** Nilai yang akan diisi, sudah disamarkan sebagian. */
  fills: { label: string; masked: string }[];
  writes: number;
};

export function maskValue(value: string): string {
  if (value.length <= 1) return '•';
  return value.slice(0, 1) + '•'.repeat(Math.min(value.length - 1, 6));
}

/** Berkas untuk op `upload`, sudah di-resolve dari `{{FILE:<nama>}}` di sisi eksekutor. */
export type UploadFile = { name: string; mime: string; base64: string };
