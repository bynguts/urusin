# 0014. Capability probe untuk penyedia LLM dengan tangga degradasi per kapabilitas

- **Status:** Diterima. Terimplementasi di `packages/llm` (probe, tangga structured output, FakeProvider).
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D14 (§1.3, §10)

## Konteks dan masalah

Penyedia OpenAI-compatible berbeda dalam dukungan `tools`, forced `tool_choice`, `json_schema`, streaming tool call, vision, transkripsi, dan embeddings. Mengasumsikan fitur OpenAI penuh akan gagal diam-diam di penyedia lain.

## Keputusan

Probe berjalan saat boot, saat config berubah, dan lewat perintah manual. Hasilnya di-cache per `baseURL+model` (TTL 24 jam menurut rencana §3.11), bisa di-override env, dan dipin saat freeze lewat `LLM_CAPS_PIN`. Tiap kekurangan punya perilaku turun yang eksplisit, misalnya `structured`: `json_schema` strict, lalu forced tool, lalu `json_object` dengan zod dan retry, lalu ekstraksi prompt yang ditandai degraded. Tanpa `embeddings`, retrieval jatuh ke BM25 saja. Probe yang gagal tidak menggagalkan boot.

## Alternatif yang dipertimbangkan

- Mengasumsikan fitur OpenAI penuh: sederhana tetapi gagal diam-diam di penyedia lain. Ditolak.
- Konfigurasi manual saja: rawan salah konfigurasi saat demo. Env tetap tersedia sebagai override.

## Konsekuensi

- Penyedia yang belum diketahui tidak memblokir build, dan perilaku bisa diprediksi dan diuji dengan matriks "tanpa X".
- Ada kode probe dan matriks tes tambahan untuk dirawat. Probe terhadap penyedia nyata belum dijalankan (README, "Batasan yang diketahui").
