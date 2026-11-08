# 0006. Hosting di VPS milik tim dengan Docker Compose, tanpa PaaS

- **Status:** Diterima. Topologi proxy diperbarui oleh ADR 0023 dan jalur image oleh ADR 0024; `deploy/compose.prod.yml` memuat `web` dan `fixtures` opsional.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D6 (§1.3, §10)

## Konteks dan masalah

Keputusan tim: kontrol penuh atas runtime dan data, proses Node yang berjalan lama untuk SSE dan harness, dan provenance commit ke deploy yang bisa dibuktikan. Juri harus bisa mencoba alur inti tanpa akses khusus.

## Keputusan

VPS dan domain milik tim dengan Docker Compose. Service `web` (SvelteKit `adapter-node`, harness in-process), `fixtures` opsional, volume SQLite. Image dibangun di CI dan ditarik berdasarkan digest. Compose yang sama berjalan di laptop (`deploy/compose.local.yml`).

## Alternatif yang dipertimbangkan

- Vercel + Turso: ditolak tim; fixture publik butuh hosting terpisah dan ada batas durasi fungsi.
- PaaS (Railway/Fly): ditolak tim; kontrol domain dan lokasi data kurang.

## Konsekuensi

- Tim menanggung ops VPS (patch OS, backup, firewall, uptime) sampai hasil lomba diumumkan.
- Tidak ada batas durasi fungsi, dan lokasi data bisa dipilih.
