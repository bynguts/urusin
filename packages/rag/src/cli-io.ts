import type { Deps } from './ingest/fetcher.js';
import type { FetchFn } from './providers/http.js';

/** Dependensi CLI yang disuntikkan supaya run-function bisa diuji tanpa jaringan. */
export type CliIo = {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  error: (line: string) => void;
  /** Fetch penyedia embedding/rerank. */
  fetch?: FetchFn | undefined;
  /** Dependensi pengambilan halaman sumber (PoliteFetcher). */
  deps?: Deps | undefined;
};
