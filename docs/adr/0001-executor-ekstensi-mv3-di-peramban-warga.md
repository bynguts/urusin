# 0001. Executor aksi di situs pemerintah berupa ekstensi MV3 di peramban warga

- **Status:** Digantikan (2026-11-09). Ekstensi dihapus dari repositori; eksekutor kini Browser Pendamping ([ADR 0028](0028-browser-pendamping.md)) (Chromium di server per sesi warga). Isi di bawah dipertahankan sebagai catatan keputusan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D1 (§1.3, §10)

## Konteks dan masalah

Urusin harus mengisi formulir di situs pemerintah yang memakai login pribadi warga, sering memakai CAPTCHA atau Turnstile, dan memblokir IP datacenter. Server yang memegang sesi dan kredensial warga akan melanggar prinsip bahwa PII tidak meninggalkan peramban, dan model yang melihat seluruh DOM memperluas permukaan prompt injection.

## Keputusan

Aksi dijalankan oleh **ekstensi Chrome Manifest V3 di peramban warga sendiri**. Ekstensi memakai sesi login milik warga, menjalankan langkah deklaratif (ADR 0005), dan memegang gate kedua yang otoritatif: penulisan ke situs hanya setelah warga menyetujui di overlay milik ekstensi.

## Alternatif yang dipertimbangkan

- Playwright di server: server memegang sesi dan kredensial warga, IP datacenter diblokir, dan Turnstile hanya bisa dilewati dengan bypass (ditolak, lihat ADR 0025).
- Bookmarklet: terhalang CSP LAPOR v4 dan tidak tahan reload halaman.
- Computer-use atau LLM membaca DOM: model melihat seluruh PII dan permukaan injection maksimal.

## Konsekuensi

- Server bebas sesi pemerintah dan kredensial warga.
- Eksekusi semi-otomatis hanya di Chromium desktop dan butuh pairing (ADR 0002). Adapter harus dirawat per situs.
- Butuh ID ekstensi yang stabil; `key` manifest dipin di repo (`apps/extension/manifest-key.pub`).
