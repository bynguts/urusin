# 0013. Turnstile diisolasi di iframe pada host verifikasi terpisah

- **Status:** Diterima. Caddy sudah meneruskan `verify.{$DOMAIN}`; rute `/verify` dan Turnstile belum diimplementasikan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D13 (§1.3, §10)

## Konteks dan masalah

Turnstile memuat skrip pihak ketiga (`api.js`). Bila dimuat di origin aplikasi, skrip itu berjalan di origin yang juga memegang IndexedDB vault.

## Keputusan

Turnstile dimuat hanya di iframe sandbox pada `verify.{$DOMAIN}`, dan token dikirim ke halaman utama lewat `postMessage` dengan pemeriksaan origin. Origin utama (`DOMAIN`) tidak memuat skrip pihak ketiga dan CSP-nya tanpa domain pihak ketiga. Rute `/verify` dipilih dari header `Host` mentah, tidak dari `event.url`, karena `ORIGIN` di `adapter-node` menimpa host pada `event.url`.

## Alternatif yang dipertimbangkan

- Vault dipindah ke subdomain sendiri: perubahan lebih banyak dan pairing ekstensi berpindah origin.
- Turnstile langsung di halaman: skrip pihak ketiga dapat membaca vault.

## Konsekuensi

- Origin vault bebas skrip pihak ketiga.
- Satu host tambahan (`verify.`) di DNS dan Caddy; kedua host menuju upstream yang sama (`deploy/Caddyfile.urusin`).
