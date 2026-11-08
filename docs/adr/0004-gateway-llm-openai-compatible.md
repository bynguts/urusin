# 0004. Satu gateway LLM OpenAI-compatible dengan model per peran lewat env

- **Status:** Diterima. Terimplementasi di `packages/llm`; belum diuji ke penyedia nyata.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D4 (§1.3, §10)

## Konteks dan masalah

Penyedia dan model yang tersedia ditentukan tim di luar kode. Kualitas tool calling dan vision berbeda antar-model, dan data diproses penyedia yang berada di luar kendali Urusin.

## Keputusan

Satu penyedia OpenAI-compatible, model dipilih per peran lewat env: `LLM_AGENT_MODEL`, `LLM_VISION_MODEL`, `LLM_TRANSCRIBE_MODEL`, `LLM_EMBED_MODEL`. `strict: true` dan forced `tool_choice` dikirim hanya bila lolos probe (ADR 0014). Biaya dihitung dari `usage` dan harga di env (`LLM_PRICE_*`). Hanya placeholder dan gambar yang sudah di-masking yang boleh dikirim.

## Alternatif yang dipertimbangkan

- Penyedia kedua sebagai cadangan (`LLM_FALLBACK_*`): menambah pemroses data dan biaya. Dicatat sebagai pekerjaan opsional.

## Konsekuensi

- Tidak terkunci vendor; degradasi per kapabilitas eksplisit.
- Mutu agen bergantung pada model yang tersedia; penyedia, lokasi data, dan retensi harus diungkap di transparansi dan DPIA.
