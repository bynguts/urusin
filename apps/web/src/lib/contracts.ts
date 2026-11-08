/**
 * Kontrak UI: hanya TIPE (tidak ada kode yang ikut ke bundel klien). Sumber kebenaran zod-first:
 * packages/contracts (`@urusin/contracts`). Skema runtime (zod) hanya diimpor dari kode server.
 *
 * Pemakaian di komponen: `import type { UrusinEvent } from '#lib/contracts.js';`
 */
export type * from '@urusin/contracts';
