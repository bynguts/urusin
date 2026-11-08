# 0018. Retrieval pengetahuan hibrida di satu SQLite: BM25 (FTS5) dan vektor, fusi RRF

- **Status:** Diterima, sebagian digantikan: bagian "sqlite-vec" diganti ADR 0021. Terimplementasi di `packages/rag`.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D18 (§1.3, §10)

## Konteks dan masalah

Agen harus menjawab persyaratan dan prosedur hanya dari sumber resmi dengan kutipan. Korpus kecil (rencana: ribuan chunk) dan harus berjalan identik di VPS dan laptop.

## Keputusan

Satu berkas SQLite: FTS5 BM25 untuk leksikal dan vektor untuk semantik (aktif bila probe `embeddings` lolos), digabung dengan Reciprocal Rank Fusion, difilter wilayah dan instansi. Hasil retrieval menjadi satu-satunya sumber kutipan untuk grounding guard. Tanpa embeddings, mode otomatis BM25 saja. Rencana awal menyebut ekstensi `sqlite-vec` untuk vektor; implementasi memakai cosine di JS (ADR 0021).

## Alternatif yang dipertimbangkan

- Vector DB terpisah (Qdrant, pgvector): menambah service dan backup untuk korpus yang hanya ribuan chunk.
- BM25 saja: recall turun untuk parafrase bahasa awam. Tetap menjadi fallback otomatis.
- File search atau vector store milik penyedia: tidak portabel di penyedia OpenAI-compatible dan korpus serta kutipan di luar kendali.

## Konsekuensi

- Nol service tambahan; satu berkas DB ikut backup.
- Korpus harus dirawat saat sumber berubah; setiap sumber membawa `verifiedAt` dan `sourceRef`.
