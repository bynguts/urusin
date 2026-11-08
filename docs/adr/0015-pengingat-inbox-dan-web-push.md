# 0015. Pengingat lewat inbox in-app dan Web Push (VAPID) dengan worker terpisah

- **Status:** Diterima. Belum diimplementasikan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D15 (§1.3, §10)

## Konteks dan masalah

Urusan administrasi berjalan berhari-hari dan warga perlu diingatkan. Kanal yang dipilih harus bisa dijangkau warga umum tanpa mengumpulkan nomor HP atau email.

## Keputusan

In-app inbox selalu ada, ditambah Web Push VAPID (`web-push`). Pengirim adalah service `worker` terpisah (image yang sama dengan `web`) yang melakukan tick di atas SQLite dengan klaim atomik (`BEGIN IMMEDIATE` dan `lease_until`). Isi push hanya ID urusan pendek dan jenis langkah, tanpa nama, NIK, atau alamat.

## Alternatif yang dipertimbangkan

- Bot Telegram: dihapus atas keputusan tim karena warga dan lansia Indonesia umumnya tidak memakainya (lihat ADR 0020).
- WhatsApp Business API: berbayar, butuh verifikasi bisnis, dan nomor HP termasuk PII.
- Email: butuh SPF, DKIM, dan reputasi domain pengirim. Tetap opsional.
- pg-boss atau BullMQ: butuh Postgres atau Redis.
- Cron di proses web: berjalan per proses dan hilang saat restart.

## Konsekuensi

- Push service peramban (FCM, APNs, Mozilla) menjadi pemroses data tambahan yang harus diungkap.
- SQLite dipakai dua penulis (mode WAL, `busy_timeout`); worker hanya menulis tabel `reminders` dan `inbox`.
