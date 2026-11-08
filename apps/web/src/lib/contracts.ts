/**
 * Kontrak event SSE + view-model untuk UI (hanya TIPE; tidak ada kode yang ikut ke bundel klien).
 * Sumber kebenaran: packages/harness/src/contracts.ts.
 *
 * Pemakaian di komponen: `import type { UrusinEvent, GroundedAnswerEvent } from '#lib/contracts.js';`
 *
 * Endpoint:
 *  - POST /api/urusan                  BuatUrusanRequest → 201 BuatUrusanResponse
 *  - POST /api/urusan/[id]/pesan       KirimPesanRequest → 202 KirimPesanResponse (409 bila turn berjalan / version basi)
 *  - GET  /api/urusan/[id]/stream      SSE: `id: <seq>`, `event: <type>`, `data: StreamEnvelope`
 *                                      (resume: header `Last-Event-ID` atau `?lastEventId=`; komentar `: hb` tiap 15 dtk)
 *  - GET  /api/urusan/[id]/jejak       JejakView (`?head=<chainHead klien>` untuk verifikasi terhadap head lokal)
 *  - GET  /api/transparansi            TransparansiView
 */
export type * from '@urusin/harness/contracts';
