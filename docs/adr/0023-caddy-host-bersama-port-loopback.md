# 0023. Caddy milik host bersama dengan port loopback, bukan Caddy di dalam compose

- **Status:** Diterima. Terimplementasi di `deploy/Caddyfile.urusin` dan `deploy/compose.prod.yml`. Menggantikan topologi "service caddy di compose" pada rencana §3.10.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** implementasi

## Konteks dan masalah

VPS target sudah menjalankan Caddy sistem yang memegang port 80 dan 443 dan melayani situs lain, dengan beberapa port lain sudah terpakai (`deploy/README.md`). Menjalankan Caddy kedua di compose akan bentrok pada port yang sama.

## Keputusan

Compose tidak memuat Caddy. Container `web` hanya mengikat `127.0.0.1:4310` dan `fixtures` (opsional) `127.0.0.1:4320`. Snippet `deploy/Caddyfile.urusin` di-`import` ke Caddyfile host untuk `{$DOMAIN}` dan `verify.{$DOMAIN}`, dengan `flush_interval -1` agar SSE tidak tertahan, zstd dan gzip, HSTS, `nosniff`, dan `Referrer-Policy`. Caddy tidak mengirim CSP; CSP dimiliki aplikasi (ADR 0026).

## Alternatif yang dipertimbangkan

- Caddy sebagai service compose yang memegang 80 dan 443: bentrok dengan Caddy host dan situs lain di VPS.
- Port web dipublikasikan ke semua antarmuka: melewati TLS dan header proxy. Ditolak.

## Konsekuensi

- Satu proses TLS di host, situs lain tidak terganggu; reload Caddy tidak memutus mereka.
- Konfigurasi proxy berada di host (`/etc/caddy/Caddyfile`), sehingga langkahnya ada di runbook `deploy/README.md` dan bukan dalam compose.
- **Pembaruan (review v11 B1):** snippet tidak lagi memakai `{$DOMAIN}` (itu menuntut perubahan environment proses Caddy dan restart). Snippet dibangkitkan dari `deploy/hosts.json` dengan hostname literal (`scripts/gen-caddyfile.mjs`, dicek CI); host dipilih di VPS dengan menyalin snippet set primary atau fallback ke `/opt/urusin/Caddyfile.urusin`. **Pembaruan (review keamanan 1e77b2e..5d90702):** lokasi pindah ke `/etc/caddy/urusin/Caddyfile.urusin` (direktori milik root; `/opt/urusin` milik `ubuntu` sementara Caddy dan `caddy-install.sh` berjalan sebagai root), backup ke `/var/backups/urusin-caddy/`; `caddy-install.sh` memigrasi baris `import` lama.
- Aplikasi memercayai `x-forwarded-for` dengan `XFF_DEPTH=1`, sehingga port harus tetap loopback.
