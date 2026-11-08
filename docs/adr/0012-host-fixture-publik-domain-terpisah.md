# 0012. Fixture publik jinak di host terpisah, fixture berbahaya hanya lokal

- **Status:** Diterima. Aplikasi `apps/fixtures` (Hono, profil `public` dan `local`) sudah ada.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D12 (§1.3, §10)

## Konteks dan masalah

Juri perlu mencoba alur pengisian tanpa akun pemerintah, tetapi klon form login di domain utama berisiko memicu interstitial Safe Browsing yang fatal dan membuka celah CSRF same-site.

## Keputusan

Fixture publik (`FIXTURES_PROFILE=public`) hanya meniru struktur DOM yang jinak: tanpa logo atau nama situs pemerintah, dengan banner "situs tiruan", `noindex`, dan tanpa `input[type=password]`. Rute phishing, injection, dan drift hanya ada di profil `local` untuk laptop dan CI. Host yang disarankan adalah domain terdaftar terpisah, cadangannya `fixtures.DOMAIN`.

## Alternatif yang dipertimbangkan

- `fixtures.DOMAIN` dengan cookie `__Host-` dan cek `Origin` persis: tanpa biaya, tetapi same-site dengan domain utama. Cadangan.
- Fixture phishing di host publik: bisa memicu penandaan Safe Browsing. Ditolak.

## Konsekuensi

- Reputasi domain utama terisolasi.
- Biaya domain kedua, dan keputusan pembeliannya tercatat sebagai pertanyaan terbuka di rencana.
