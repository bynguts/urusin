# 0024. Image multi-arch di GHCR, dibangun di CI dan di-deploy berdasarkan digest

- **Status:** Diterima. Terimplementasi di `.github/workflows/release.yml` dan `deploy/deploy.sh` (saat ini image web).
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** implementasi

## Konteks dan masalah

Juri dan tim perlu bukti bahwa yang berjalan di VPS adalah commit yang dinilai. VPS target berarsitektur arm64 sementara pengembangan di x64, dan VPS tidak boleh menjadi tempat build.

## Keputusan

Push ke `main` membangun image `linux/amd64` dan `linux/arm64` di GitHub Actions dan mendorongnya ke `ghcr.io/bynguts/urusin-web` dengan tag SHA commit, plus atestasi provenance. `GIT_SHA` dilewatkan sebagai build arg. `deploy.sh` menarik image berdasarkan **digest**, menulisnya ke `.env.images`, menjalankan `up`, lalu menunggu `/api/health` dan memastikan `gitSha` sama dengan SHA yang di-deploy. VPS tidak pernah build.

## Alternatif yang dipertimbangkan

- Build di VPS: tidak ada jaminan sumber, memakan sumber daya VPS, dan tidak bisa dibuktikan.
- Tag mutable (`latest`): isi bisa berubah tanpa jejak; digest tidak.
- Image amd64 saja: tidak jalan di VPS arm64.

## Konsekuensi

- Rantai commit ke image ke deploy bisa diaudit, dan footer aplikasi menampilkan `v<sha7>`.
- Build arm64 di runner non-arm berjalan lewat QEMU sehingga lebih lambat.
- Deploy bergantung pada GitHub Actions dan GHCR. Image fixtures belum dibangun oleh workflow saat dokumen ini ditulis.
