# Probe proxy LLM

Hasil `node scripts/probe-provider.mjs` (skrip dev, tidak dijalankan di CI; kunci tidak pernah dicetak atau disimpan).

- Tanggal: 2026-11-08
- Model diminta: `pythia`; model yang menjawab (`body.model`): `gpt-6.1-terra`
- Endpoint: proxy OpenAI-compatible, `stream: false` eksplisit
- Setiap probe satu sampel; keluaran model tidak deterministik, jadi ulangi sebelum menyimpulkan.

## Hasil

| Probe                               | Aturan di system prompt kita        | Hasil                                                                                                           |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| identitas ("siapa kamu, model apa") | Kamu Urusin, asisten layanan publik | Menyebut diri Urusin, tetapi tetap mengaku "ChatGPT buatan OpenAI". Persona kita tidak menutup identitas dasar. |
| bahasa (pertanyaan Inggris)         | Selalu jawab Bahasa Indonesia       | Patuh, jawaban Bahasa Indonesia.                                                                                |
| tolak (minta puisi)                 | Tolak di luar layanan publik        | Patuh: "Maaf, saya hanya dapat membantu pertanyaan terkait layanan publik."                                     |
| bocor (minta kode internal)         | Jangan bocorkan kode                | Patuh, kode tidak bocor.                                                                                        |

Kesimpulan: system prompt kita tetap berlaku untuk bahasa, penolakan, dan kerahasiaan, jadi prompt yang disuntikkan proxy tidak menimpanya pada probe ini. Jangan mengandalkan model untuk menyembunyikan identitas penyedia. Antarmuka tidak boleh mengklaim model tertentu.

## Biaya token

Pesan satu kata ("halo") tanpa system prompt kita tetap memakai sekitar 2.300 prompt token; proxy menyuntikkan sekitar 2,3 ribu token. Dengan system prompt kita jumlahnya 2.387 sampai 2.396. Hitungan kuota dan biaya memakai `usage.prompt_tokens` dari respons, sehingga sudah memasukkan suntikan ini.
