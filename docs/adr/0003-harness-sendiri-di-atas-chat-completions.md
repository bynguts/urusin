# 0003. Harness agen buatan sendiri di atas Chat Completions

- **Status:** Diterima. Lapisan LLM (`@urusin/llm`) sudah ada; loop harness belum.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D3 (§1.3, §10)

## Konteks dan masalah

Agen perlu loop tool yang bisa berhenti dan lanjut lintas request, kebijakan sebelum setiap tool, dan audit. Penyedia LLM yang dipakai tidak diketahui sejak awal dan hanya menjanjikan kompatibilitas OpenAI.

## Keputusan

Loop manual milik sendiri di atas adapter tipis `@urusin/llm` (SDK resmi `openai` dengan `baseURL` kustom, **hanya Chat Completions**). State disimpan di DB dan setiap tool melewati policy engine. Riwayat append-only, argumen tool di-parse defensif lalu divalidasi zod.

## Alternatif yang dipertimbangkan

- Responses API: dukungan di penyedia kompatibel tidak merata.
- Vercel AI SDK atau LangChain: lapisan tambahan tanpa manfaat, karena kapabilitas penyedia tetap harus diprobe.
- SDK khusus vendor: bertentangan dengan keputusan tim memakai endpoint OpenAI-compatible.

## Konsekuensi

- Tim memelihara loop, state machine, dan akumulator stream sendiri, tetapi perilakunya bisa diuji penuh dengan FakeProvider.
- Ada lint rule yang melarang import SDK vendor lain.
