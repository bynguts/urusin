# 0020. Platform web-only (PWA), tanpa bot Telegram

- **Status:** Diterima. Aplikasi web ada; PWA belum diimplementasikan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** keputusan tim

## Konteks dan masalah

Rencana awal menyertakan bot Telegram sebagai kanal pengingat. Tim menilai warga dan lansia Indonesia umumnya tidak memakai Telegram, dan kanal tambahan berarti pemroses data, permukaan serangan, dan state tambahan.

## Keputusan

Urusin hanya berupa **web app responsif mobile-first yang dapat dipasang sebagai PWA** (`@vite-pwa/sveltekit`, strategi `injectManifest`). Tidak ada bot Telegram. Pengingat lewat inbox in-app dan Web Push (ADR 0015). Eksekusi semi-otomatis tetap di Chromium desktop lewat ekstensi.

## Alternatif yang dipertimbangkan

- Bot Telegram: dihapus atas keputusan tim.
- Aplikasi native: biaya dan distribusi tidak masuk akal untuk skala tim dan jadwal ini.

## Konsekuensi

- Satu basis kode dan satu kanal untuk diuji dan diaudit.
- Warga iOS perlu panduan Add to Home Screen untuk Web Push.
- Service worker PWA tidak boleh meng-cache `/api/*`, SSE, atau halaman ber-PII.
