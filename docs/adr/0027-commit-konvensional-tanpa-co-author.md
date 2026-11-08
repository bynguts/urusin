# 0027. Commit konvensional, tanpa atribusi AI otomatis, dan riwayat tidak ditulis ulang

- **Status:** Diterima. Ditegakkan hook `commit-msg` dan CI (`audit-history`).
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** proses

## Konteks dan masalah

Hasil lomba dinilai dari riwayat repositori. Riwayat harus jujur: siapa yang menulis apa, dan tidak ada perubahan yang disamarkan. Alat bantu AI dipakai saat pengembangan.

## Keputusan

Pesan commit mengikuti Conventional Commits (commitlint) dan subjek tidak boleh bermakna kosong ("update", "wip"). Trailer `Co-Authored-By` dan atribusi AI otomatis ditolak oleh hook dan CI. Penggunaan AI diungkap di README, bukan lewat trailer. Riwayat tidak ditulis ulang (tanpa force push, rebase, squash, atau amend pada riwayat bersama).

## Alternatif yang dipertimbangkan

- Membiarkan atribusi otomatis alat AI: mengaburkan kepemilikan commit dan melanggar keputusan tim.

## Konsekuensi

- Riwayat bisa diaudit (`pnpm audit:history`).
- Pengungkapan penggunaan AI wajib dipelihara di README.
