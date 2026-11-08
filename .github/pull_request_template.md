## Ringkasan

<!-- Apa yang berubah dan kenapa. Tautkan issue atau item rubrik. -->

## Checklist

- [ ] **Tes:** tes baru atau yang diperbarui menutup perubahan ini; `pnpm turbo run lint typecheck test build` dan `pnpm format:check` hijau. Ambang coverage tidak diturunkan.
- [ ] **Anggaran:** JS awal beranda tetap <= 70 KB gzip (`pnpm budget`), dan tidak ada dependensi runtime berat di jalur awal.
- [ ] **PII:** tidak ada data pribadi nyata atau rahasia di kode, fixture, tes, tangkapan layar, atau log. Parameter dari model tetap lewat `noPlaceholder()`.
- [ ] **Dokumentasi:** README, `docs/`, atau ADR baru diperbarui bila perilaku atau keputusan arsitektur berubah. Klaim di dokumen sesuai kode.
- [ ] **Rubrik:** menyebut kriteria penilaian atau item rencana yang dipenuhi (atau "tidak berlaku").
- [ ] Pesan commit konvensional, tanpa `Co-Authored-By`, tanpa menulis ulang riwayat.

## Rubrik / item rencana

<!-- mis. "Keamanan & Privasi", "Efisiensi", M14 -->

## Cara menguji

<!-- Perintah atau langkah manual agar peninjau bisa memverifikasi. -->
