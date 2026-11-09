# 0009. Interpreter ekstensi di service worker dengan cursor persisten dan step-runner yang disuntik ulang

- **Status:** Digantikan (2026-11-09). Ekstensi dihapus dari repositori; eksekutor kini Browser Pendamping (Chromium di server per sesi warga). Isi di bawah dipertahankan sebagai catatan keputusan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D9 (§1.3, §10)

## Konteks dan masalah

Situs target memuat ulang halaman (misalnya Telunjuk Sakti tiap `uploadSubmit`) dan service worker MV3 bisa dimatikan kapan saja, sehingga state eksekusi tidak boleh hidup di halaman.

## Keputusan

Interpreter berjalan di service worker, posisi eksekusi (cursor) disimpan di `chrome.storage.session`, dan step-runner tipis disuntik ulang pada setiap `tabs.onUpdated: complete`.

## Alternatif yang dipertimbangkan

- Interpreter di content script: mati pada setiap reload.
- Offscreen document: tetap butuh injeksi per halaman dan tidak menambah ketahanan.

## Konsekuensi

- Eksekusi tahan reload halaman dan service worker yang dimatikan.
- Protokol resume antara interpreter dan runner harus dirancang dan diuji (ada e2e Playwright di `apps/extension/e2e`).
