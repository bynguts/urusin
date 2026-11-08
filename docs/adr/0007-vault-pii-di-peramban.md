# 0007. Vault PII di peramban (IndexedDB, AES-GCM) dengan ekstensi sebagai gate kedua

- **Status:** Diterima. Belum diimplementasikan; hanya grammar placeholder dan guard di `packages/core`. Untuk warga yang masuk akun, sebagian digantikan oleh [ADR 0028](0028-akun-dan-login.md) (vault terenkripsi per akun di server); mode tamu tetap mengikuti ADR ini.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D7 (§1.3, §10)

## Konteks dan masalah

Data pribadi warga tidak boleh sampai ke server maupun model. Pengisian formulir tetap membutuhkan nilai asli.

## Keputusan

Nilai asli disimpan di **peramban** (IndexedDB, AES-GCM, kunci non-extractable). Model dan server hanya melihat placeholder (`{{PEMOHON.NIK}}`). Guard `noPlaceholder()` menolak `{{`, `}}`, NIK, HP, dan email pada parameter dari model, dan nilai baru diganti di sisi eksekutor. Ekstensi tetap menolak penulisan tanpa klik di overlay-nya sendiri.

## Alternatif yang dipertimbangkan

- Vault di server: server menyimpan PII, melanggar prinsip utama dan memperluas dampak pembobolan.

## Konsekuensi

- Server tidak menyimpan PII.
- Risiko sisa **sedang**: JS yang dikirim server bisa membaca vault bila server dibobol. Mitigasi: CSP nonce, tanpa skrip pihak ketiga di halaman vault (ADR 0013), dan gate kedua di ekstensi. Risiko ini diungkap, bukan disembunyikan.
