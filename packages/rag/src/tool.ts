import type { Db } from './db.js';
import {
  DEFAULT_PIPELINE,
  retrieve,
  retrieveSyncFull,
  type RetrievalDeps,
  type RetrievalPipeline,
  type RetrievalResult,
} from './pipeline.js';
import {
  CariPengetahuanInputSchema,
  CariPengetahuanOutputSchema,
  type CariPengetahuanOutput,
} from './schema.js';

export type ToolOptions = RetrievalDeps & {
  /** Default: stem + perluasan + vektor bila ada + rerank bila tersedia (lihat DEFAULT_PIPELINE). */
  pipeline?: RetrievalPipeline | undefined;
};

function toOutput(r: RetrievalResult): CariPengetahuanOutput {
  return CariPengetahuanOutputSchema.parse({
    mode: r.mode,
    tanpaHasil: r.hits.length === 0,
    hasil: r.hits,
    debug: r.debug,
  });
}

/** Definisi tool `cari_pengetahuan` (zod in/out); hasil adalah satu-satunya sumber kutipan yang sah. */
export const cariPengetahuanTool = {
  name: 'cari_pengetahuan',
  description:
    'Cari pengetahuan layanan publik dari korpus resmi. Mengembalikan potongan teks beserta kutipan sumber dan tanggal verifikasi. Bila tanpaHasil bernilai true, arahkan warga ke kanal resmi.',
  inputSchema: CariPengetahuanInputSchema,
  outputSchema: CariPengetahuanOutputSchema,
  /** Sinkron, tanpa LLM: BM25 (asli + stem) + perluasan glosarium + leg vektor bila `vectorIds` ada. */
  execute(db: Db, rawInput: unknown, opts: ToolOptions = {}): CariPengetahuanOutput {
    const input = CariPengetahuanInputSchema.parse(rawInput);
    return toOutput(retrieveSyncFull(db, input, opts.pipeline ?? DEFAULT_PIPELINE, opts));
  },
  /** Pipeline penuh: tambah tulis-ulang LLM (`rewrite`) dan rerank (`rerank`) bila disuntikkan; gagal-aman. */
  async executeAsync(db: Db, rawInput: unknown, opts: ToolOptions = {}): Promise<CariPengetahuanOutput> {
    const input = CariPengetahuanInputSchema.parse(rawInput);
    return toOutput(await retrieve(db, input, opts.pipeline ?? DEFAULT_PIPELINE, opts));
  },
} as const;
