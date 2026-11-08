import type { Db } from './db.js';
import { searchHybrid } from './search.js';
import {
  CariPengetahuanInputSchema,
  CariPengetahuanOutputSchema,
  type CariPengetahuanOutput,
} from './schema.js';

export type ToolOptions = {
  /** Leg vektor opsional: id chunk berurutan untuk kueri ini. Tanpa ini = mode bm25. */
  vectorIds?: readonly string[];
};

/** Definisi tool `cari_pengetahuan` (zod in/out); hasil adalah satu-satunya sumber kutipan yang sah. */
export const cariPengetahuanTool = {
  name: 'cari_pengetahuan',
  description:
    'Cari pengetahuan layanan publik dari korpus resmi. Mengembalikan potongan teks beserta kutipan sumber dan tanggal verifikasi. Bila tanpaHasil bernilai true, arahkan warga ke kanal resmi.',
  inputSchema: CariPengetahuanInputSchema,
  outputSchema: CariPengetahuanOutputSchema,
  execute(db: Db, rawInput: unknown, opts: ToolOptions = {}): CariPengetahuanOutput {
    const input = CariPengetahuanInputSchema.parse(rawInput);
    const hasil = searchHybrid(db, input, opts.vectorIds);
    return CariPengetahuanOutputSchema.parse({
      mode: opts.vectorIds?.length ? 'hybrid' : 'bm25',
      tanpaHasil: hasil.length === 0,
      hasil,
    });
  },
} as const;
