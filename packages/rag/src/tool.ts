import type { Db } from './db.js';
import { kanalFor, kontakFor } from './kanal.js';
import { mentionedService } from './out-of-scope.js';
import { changedSourceIds, PERINGATAN_BERUBAH, sourceIdOfChunk } from './ingest/state.js';
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

function toOutput(
  db: Db,
  r: RetrievalResult,
  input: { query: string; kodeKabKota?: string | undefined },
): CariPengetahuanOutput {
  const changed = changedSourceIds(db);
  const empty = r.hits.length === 0;
  const svc = empty ? mentionedService(input.query) : null;
  const kanal = svc ? kanalFor(svc.id) : undefined;
  const kontak = empty && input.kodeKabKota ? kontakFor(input.kodeKabKota) : undefined;
  return CariPengetahuanOutputSchema.parse({
    mode: r.mode,
    tanpaHasil: empty,
    ...(kanal ? { kanal } : {}),
    ...(kontak ? { kontak } : {}),
    ...(r.alasan ? { alasan: r.alasan } : {}),
    hasil: r.hits.map((h) => {
      const src = sourceIdOfChunk(h.id);
      return src && changed.has(src) ? { ...h, peringatan: PERINGATAN_BERUBAH } : h;
    }),
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
    return toOutput(db, retrieveSyncFull(db, input, opts.pipeline ?? DEFAULT_PIPELINE, opts), input);
  },
  /** Pipeline penuh: tambah tulis-ulang LLM (`rewrite`) dan rerank (`rerank`) bila disuntikkan; gagal-aman. */
  async executeAsync(db: Db, rawInput: unknown, opts: ToolOptions = {}): Promise<CariPengetahuanOutput> {
    const input = CariPengetahuanInputSchema.parse(rawInput);
    return toOutput(db, await retrieve(db, input, opts.pipeline ?? DEFAULT_PIPELINE, opts), input);
  },
} as const;
