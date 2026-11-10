# 0030. Browser Pendamping generik untuk portal tanpa adapter

- **Status:** Diterima. **Dicatat:** 2026-11-10. **Sumber:** keputusan tim.

## Konteks

Adapter tulisan tangan hanya ada untuk Telunjuk Sakti dan beberapa alur baca. Warga dari wilayah lain hanya mendapat mode dipandu, padahal banyak Disdukcapil punya formulir web.

## Keputusan

- Navigator generik berjalan di web app: amati, rencana per halaman dalam JSON ketat, lalu validasi. Tangannya adalah worker Pendamping. Adapter tetap menjadi jalur cepat.
- Model hanya melihat pengamatan yang sudah diredaksi dan hanya boleh menjawab dengan `ref`, placeholder vault, atau indeks opsi. Tidak ada URL, teks bebas, tombol keyboard, atau JS.
- Tombol yang mungkin mengirim, membayar, menghapus, atau mendaftar selalu dikerjakan warga. Ini ditegakkan oleh klasifikator deterministik yang dijalankan ulang di halaman saat klik (default tolak; submitter asli selalu `kirim`), gerbang tulis jaringan di worker (permintaan non-GET dan navigasi tak terduga dari aksi AI dibatalkan sebelum terkirim), dan kunci halaman akhir.
- Navigasi hanya ke host persis wilayah itu di registry; edge tetap menegakkan union registry.
- Nilai vault hanya mengalir untuk pasangan (kolom, placeholder) yang disetujui warga per halaman.
- Mode Uji hanya membuka replika.
- Semua langkah dicatat di rantai audit tanpa nilai.
- ADR 0025 tetap berlaku: tanpa penyelesai CAPTCHA dan tanpa penyamaran.

## Alternatif

- Otomasi bebas dengan JS buatan model: ditolak.
- pi-agent-core: ditolak untuk tenggat ini. Ia hanya menambah lapis hook di proses web, padahal gerbang yang menentukan harus ada di worker; dependensinya berat (88 paket, 88 MB) dan rilisnya cepat berubah.
- Hanya mode dipandu: tidak cukup.

## Konsekuensi

- Wizard yang menyimpan data per halaman lewat POST butuh satu ketukan warga per halaman.
- Situs yang hanya lewat aplikasi atau WhatsApp tetap dipandu.
- Host baru harus melalui recon dulu.
- Risiko diterima: biaya LLM Navigator masuk meter kuota yang sama dengan agen (token/biaya per urusan + biaya
  harian global; habis = serah templat `kuota`), tetapi belum ada batas per akun atau per juri. Akun yang membuat
  banyak urusan dibatasi oleh batas biaya harian global dan rate limit HTTP per IP/sesi saja. Tinjau ulang bila
  pemakaian nyata menunjukkan satu akun menghabiskan anggaran harian.

## Rujukan berkas utama

- packages/executor/src/runner-ops.ts (228-268), interpreter.ts (84-91, 326)
- apps/pendamping/src/browser.ts (252-313 route; 383-480 wire/driver), sessions.ts (61-84, 232-246)
- apps/web/src/lib/server/vault/resolver.ts (27-36), apps/web/src/lib/server/pendamping/izinkan.ts
- packages/core/src/registry.ts (24-187), packages/harness/src/rencana.ts (44), guarded-llm.ts (29)
- packages/contracts/src/pendamping.ts (184-200, 283-372)
- recon/dukcapil-kota-verify.md dan recon/portal-dukcapil-nasional.md (repo riset logicodix, di luar repo ini)
