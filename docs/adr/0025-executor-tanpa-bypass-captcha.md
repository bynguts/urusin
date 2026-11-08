# 0025. Eksekusi di peramban warga tanpa bypass CAPTCHA atau teknik anti-deteksi

- **Status:** Diterima. Menjadi batas desain; terlihat di DSL dan registry.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** prinsip

## Konteks dan masalah

Beberapa situs pemerintah memakai CAPTCHA atau captcha matematika. Melewatinya secara otomatis melanggar ketentuan situs dan niat pemilik layanan, dan membuat Urusin tampak seperti bot.

## Keputusan

Captcha selalu dijawab warga sendiri lewat `gate.human`. Lint DSL menolak operasi pengisi kolom captcha. Urusin tidak memakai layanan penyelesai CAPTCHA, tidak menyamarkan sidik jari peramban, dan tidak memutar IP atau agen pengguna. Pengiriman akhir selalu oleh warga. Urusin berjalan di peramban dan sesi warga sendiri, sehingga lalu lintasnya sama dengan warga yang mengetik sendiri, tanpa penyamaran.

## Alternatif yang dipertimbangkan

- Bypass CAPTCHA atau Turnstile di server: ditolak karena melanggar ketentuan situs dan etika.
- Menyembunyikan otomasi dari situs: ditolak, karena tidak ada kebutuhan yang sah untuk itu.

## Konsekuensi

- Beberapa alur tidak bisa otomatis penuh dan jatuh ke mode dipandu. Itu sengaja.
- Kebijakan ini dinyatakan di `SECURITY.md` supaya pelapor tahu bahwa ini bukan celah.
