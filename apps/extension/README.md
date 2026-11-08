# @urusin/extension

Ekstensi Chrome MV3 (WXT) yang menjalankan langkah adapter di peramban warga. Warga mengetik CAPTCHA/OTP dan menekan
pengiriman akhir sendiri: langkah `final` tidak pernah diklik otomatis.

## Perintah

```sh
pnpm --filter @urusin/extension build     # .output/chrome-mv3 (muat sebagai unpacked)
pnpm --filter @urusin/extension test      # vitest + happy-dom
pnpm --filter @urusin/extension e2e       # Playwright: Chromium + ekstensi + fixture + web app (butuh build semuanya)
pnpm e2e                                  # dari root: turbo membangun dependensi lalu menjalankan e2e
```

E2E memakai `channel: 'chromium'` (headless baru) dan menjalankan fixture di `:4320` serta web app hasil build di `:3000`.
Sekali per mesin: `npx playwright install chromium`. E2E tidak pernah menyentuh situs pemerintah asli.

## ID ekstensi dipin

`manifest-key.pub` berisi kunci publik (SPKI DER, base64) yang menjadi `manifest.key`. ID Chrome = 16 byte pertama
SHA-256 dari DER kunci publik, tiap nibble dipetakan ke huruf `a`..`p`. Jadi ID sama di setiap mesin, CI, dan zip rilis.

```sh
pnpm --filter @urusin/extension key:id    # cetak ID dari manifest-key.pub
```

ID tercatat sebagai `PUBLIC_EXTENSION_ID` di `.env.example`; tes menjaga keduanya konsisten.
Kunci privat TIDAK ada di repo (`*.pem` diabaikan git). Menghasilkan pasangan baru (hanya bila kunci hilang/bocor,
karena ID berubah):

```sh
node scripts/extension-key.mjs generate <jalur-aman>/extension-key.pem   # cetak kunci publik + ID baru
```

Kunci privat hanya dibutuhkan untuk menandatangani `.crx`/Web Store, tidak untuk memuat unpacked.

## Origin dan izin

- `externally_connectable.matches`: `URUSIN_PUBLIC_ORIGIN` (https) + `http://localhost:3000`, dibaca saat build.
- `host_permissions`: seluruh origin registry `@urusin/core` + `URUSIN_FIXTURES_ORIGINS` (default `localhost:4320`).
  Origin fixture hanya sah saat Mode Uji menyala (toggle di popup).
- `permissions`: `storage`, `scripting`. Tanpa `<all_urls>`, `tabs`, `cookies`, `webRequest`.

## Alur

1. Popup "Hubungkan" membuat nonce sekali pakai (TTL 5 menit) dan membuka `ORIGIN/pair#nonce=...` (fragment).
2. Halaman `/pair` web app membaca nonce, menghapusnya dari URL, mengirim `pair` lalu `ping` lewat `chrome.runtime.sendMessage`.
3. Pesan lain hanya diterima dari origin ter-pairing yang membawa nonce yang cocok.
4. `execute` menjalankan `ExecutionRequest` (`@urusin/core` Step DSL). Cursor ditulis ke `chrome.storage.session` sebelum
   setiap op; step-runner di-inject ulang pada setiap op (reload membuang runner lama). `pendingWrite` memaksa `verify` dulu saat resume,
   sehingga write tidak pernah diklik ulang otomatis.

## Belum ada (skeleton)

Op `select`, `upload`, `forEach`, `branch` ditolak dengan `UNSUPPORTED_OP`. Mode Presentasi, sinkron status latar,
dan gate kedua per-write terperinci belum dikerjakan.
