# 0010. Transfer berkas ke ekstensi lewat chunk base64 pada port dengan verifikasi SHA-256

- **Status:** Diterima. Belum diimplementasikan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D10 (§1.3, §10)

## Konteks dan masalah

Foto dokumen perlu sampai ke ekstensi untuk diunggah ke situs pemerintah, tetapi tidak boleh melewati server (prinsip bebas PII). Web app dan ekstensi berbeda origin sehingga tidak bisa berbagi IndexedDB.

## Keputusan

Berkas dikirim sebagai chunk base64 (maksimum 512 KB per chunk) lewat port ter-pairing, diverifikasi SHA-256, disimpan di IndexedDB ekstensi, dan diteruskan ke step-runner per chunk.

## Alternatif yang dipertimbangkan

- URL sekali pakai dari server: server menyentuh foto dokumen dan melanggar prinsip bebas PII.
- IndexedDB bersama: mustahil karena beda origin.

## Konsekuensi

- Berkas tidak pernah menyentuh server.
- Overhead ukuran sekitar 33% akibat base64.
