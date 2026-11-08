# 0026. CSP tunggal dari SvelteKit dalam mode auto, tanpa strict-dynamic

- **Status:** Diterima. Terimplementasi di `apps/web/vite.config.ts`. Mengoreksi rencana §3.2 yang menyebut `strict-dynamic`.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** implementasi

## Konteks dan masalah

Tepat satu sumber kebenaran CSP diperlukan agar kebijakan tidak saling menimpa antara proxy dan aplikasi. Rencana awal menulis `script-src` dengan nonce dan `strict-dynamic`, tetapi konfigurasi yang ada tidak memakainya.

## Keputusan

`kit.csp` dengan `mode: auto` (nonce untuk halaman dinamis, hash untuk halaman prerender). Direktif: `default-src self`, `script-src self`, `style-src self unsafe-inline` (transisi Svelte menyisipkan `<style>`), `img-src self data: blob:`, `connect-src self`, `worker-src self`, `manifest-src self`, `object-src none`, `base-uri self`, `form-action self`, `frame-ancestors none`. Caddy tidak menambah CSP. Rute `/verify` yang direncanakan akan mengirim CSP-nya sendiri.

## Alternatif yang dipertimbangkan

- CSP di Caddy: tidak bisa memakai nonce per request dan berisiko menggandakan header.
- `strict-dynamic` dengan nonce: tanpa `worker-src` eksplisit, `self` diabaikan sehingga registrasi service worker ditolak. Tidak dipakai saat ini.

## Konsekuensi

- Tidak ada skrip pihak ketiga di origin utama.
- `unsafe-inline` pada `style-src` adalah kompromi yang disengaja dan diterima.
- Halaman prerender membawa CSP lewat `<meta>`, sehingga uji "tepat satu header CSP" hanya berlaku untuk rute dinamis.
