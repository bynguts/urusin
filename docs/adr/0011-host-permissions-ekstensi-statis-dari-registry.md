# 0011. Host permissions ekstensi statis, dihasilkan dari registry domain resmi

- **Status:** Digantikan (2026-11-09). Ekstensi dihapus dari repositori; eksekutor kini Browser Pendamping (Chromium di server per sesi warga). Isi di bawah dipertahankan sebagai catatan keputusan.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D11 (§1.3, §10)

## Konteks dan masalah

Ekstensi hanya boleh menyentuh situs resmi, dan daftar izin harus terlihat oleh warga saat memasang.

## Keputusan

`host_permissions` statis, diturunkan dari `OFFICIAL_DOMAINS` saat build (ditambah origin fixture), tanpa `<all_urls>`. Permission lain hanya `storage` dan `scripting`. Pencocokan origin persis: https saja, tanpa userinfo, tanpa port non-standar, tanpa punycode yang tidak terdaftar, tanpa subdomain atau sufiks jebakan.

## Alternatif yang dipertimbangkan

- `optional_host_permissions` dengan `chrome.permissions.request`: butuh user gesture di halaman ekstensi dan tidak bisa dipicu dari pesan web app.

## Konsekuensi

- Daftar pendek dan tampil saat instal.
- Menambah domain berarti merilis ulang ekstensi. Salinan registry di ekstensi adalah yang otoritatif; server tidak bisa mengarahkan penulisan ke domain lain.
