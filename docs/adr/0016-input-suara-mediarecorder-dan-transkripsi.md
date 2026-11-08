# 0016. Input suara lewat MediaRecorder dan rute transkripsi milik sendiri

- **Status:** Diterima. Belum diimplementasikan (fitur SHOULD).
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D16 (§1.3, §10)

## Konteks dan masalah

Sebagian warga lebih nyaman berbicara daripada mengetik. Audio dapat memuat apa pun yang diucapkan, termasuk NIK.

## Keputusan

`MediaRecorder` merekam audio, dikirim ke `/api/transcribe` milik sendiri, lalu diteruskan ke `/v1/audio/transcriptions` di penyedia (atau endpoint STT terpisah lewat env) dengan `language: "id"`. Audio tidak disimpan, transkrip tidak dicatat, jalur error tidak menggemakan input, dan deret 16 digit pada transkrip diganti sebelum respons. Web Speech API hanya opt-in dan default mati karena audio diproses Google.

## Alternatif yang dipertimbangkan

- Web Speech API sebagai jalur utama: hanya Chrome dan audio diproses Google.
- Whisper self-hosted di VPS: nol pihak ketiga, dicatat sebagai pekerjaan opsional.

## Konsekuensi

- Ini salah satu dari dua pengecualian sadar atas invarian "bebas PII lintas batas peramban ke server" (yang lain: gambar yang sudah di-masking). Risiko sisa **sedang** dan diungkap.
