# 0028. Akun warga: email + sandi dan Google, sesi server, vault terenkripsi per pemilik

- **Status:** Diterima (revisi v14: arsitek v13 + critic). Diimplementasikan di `packages/akun`, migrasi `packages/harness/migrations/0003_akun.sql`, rute `apps/web/src/routes/{api/akun,api/vault,auth/google,masuk,daftar,verifikasi-email,lupa-sandi,atur-ulang-sandi,lengkapi-profil,dev/oidc}`, dan penyelesai PII `apps/web/src/lib/server/vault/resolver.ts`. Untuk akun yang masuk, ADR ini menggantikan sebagian [ADR 0007](0007-vault-pii-di-peramban.md).
- **Dicatat:** 2026-11-09
- **Sumber keputusan:** keputusan pengguna (login Google + email/sandi, email lewat Resend, Data Diri dan dokumen ikut akun lintas perangkat); rencana §3.26–§3.26.6; review arsitek v13 dan critic.

## Konteks dan masalah

Warga memakai HP dan laptop bergantian. HP biasanya dipakai memotret dokumen, laptop untuk mengisi formulir. Vault di peramban (ADR 0007) terikat ke satu perangkat. Pengguna memutuskan Data Diri dan dokumen mengikuti akun di semua perangkat. Keputusan itu menuntut:

- akun dan login (email + sandi serta Google);
- penyimpanan PII di server, karena sinkron lintas perangkat tanpa server memegang ciphertext tidak mungkin;
- jalan tanpa akun bagi juri dan warga yang tidak mau mendaftar (guidebook: tanpa akses khusus).

## Keputusan

1. **Tiga jenis pemilik vault** (`users.jenis`):
   - `akun`: email + sandi dan/atau Google;
   - `tamu`: terikat hash cookie `urusin_sid`, dibuat **malas** (tulis vault pertama atau `/turn` pertama; menjelajah tidak membuat baris), maksimal 20 per IP per hari (`TAMU_PENUH` 429; IPv6 dihitung per /64), umur mutlak 72 jam sejak dibuat (aktivitas tidak memperpanjang);
   - `demo`: salinan terisolasi dari "Masuk sebagai juri", berisi Data Diri sintetis, berumur 24 jam.

   Akun yang emailnya **belum terverifikasi** boleh masuk tetapi diperlakukan seperti tamu: vault tetap di perangkat (pemilik vault = tamu dari `urusin_sid`), urusan tidak dipindahkan. Hanya akun terverifikasi dan demo yang `sinkron`.

2. **Sandi.** argon2id lewat `crypto.argon2` Node 26 (m = 19 MiB, t = 2, p = 1; PHC; hash ulang otomatis), dibatasi semafor 2 hash serentak. Kebijakan (rencana §3.26, diputuskan lead): minimal 10 karakter, maksimal 128, bukan salah satu dari 10k sandi paling umum (SecLists, MIT) atau pola Indonesia, termasuk kata dasarnya ditambah angka/simbol di belakang (`sunshine2026!`), bukan pengulangan satu karakter, bukan email sendiri.
3. **Sesi server.** Token acak 256-bit di cookie `__Host-urusin_akun` (HttpOnly, Secure, SameSite=Lax, Path=/); server hanya menyimpan SHA-256-nya. Idle 7 hari, absolut 30 hari. Setiap login menerbitkan token baru, menghapus sesi lama yang dibawa cookie, dan **memutar `urusin_sid`**. Ada keluar dan keluar dari semua perangkat. Ubah sandi merotasi sesi ini dan menghapus sesi lain; atur ulang sandi menghapus semua sesi. `auth_at` mencatat bukti kredensial terakhir (login, konfirmasi sandi, Google).
4. **Rotasi tamu → akun atomik (§3.26.6).** Saat login, `rotasiPemilik` berjalan dalam satu transaksi: `urusan_owner` berpindah dari hash sid lama ke akun (atau ke hash sid baru untuk akun belum terverifikasi/demo), vault tamu dienkripsi ulang ke DEK akun (Data Diri digabung, nilai akun menang; berkas ditulis ulang), DEK tamu dihancurkan, dan setiap `PengikatPemilik` terdaftar (pengendali Pendamping: hash pemilik sesi) diikat ulang. Satu kegagalan membatalkan semuanya.
5. **Token email.** Verifikasi 24 jam, atur ulang 30 menit, hanya hash disimpan, dipakai sekali secara atomik, token baru membatalkan yang lama. Membuka tautan (GET) tidak memakai token; tombol (POST) yang memakai. **Verifikasi butuh sandi yang dibuat saat mendaftar**: token menyimpan hash sandi pendaftaran itu, jadi tautan yang bocor saja tidak cukup.
6. **Anti pra-pembajakan (§3.26.3).**
   - Akun sandi yang belum terverifikasi tidak pernah memblokir siapa pun: daftar ulang mengirim verifikasi baru dengan sandi baru; sandi lama batal saat verifikasi.
   - Google dengan `email_verified` pada akun sandi **belum terverifikasi** menghapus sandi dan semua sesinya; akun diberikan ke identitas Google.
   - Akun **terverifikasi** dengan email sama **tidak** ditautkan otomatis (meski `email_verified`): callback menyimpan tiket (`oauth_link_pending`, cookie `__Host-urusin_tautkan`, 10 menit) dan meminta masuk dengan sandi; tiket hanya berlaku untuk akun yang sama. Warga yang sudah masuk boleh menautkan Google langsung (bukti = sesi).
   - **Menautkan hanya untuk akun terverifikasi** dengan bukti kredensial <= 15 menit (selain itu masuk ulang dulu); akun belum terverifikasi tidak pernah menautkan. Setiap tautan baru mengirim email "Google ditautkan" dan bisa dilepas di Pengaturan (`POST /api/akun/google/lepas`; akun tanpa sandi ditolak `GOOGLE_SATU_SATUNYA`).
   - **Pindah kepemilikan mencabut semua identitas Google**: verifikasi email akun yang belum terverifikasi, atur ulang sandi, dan pengambilalihan oleh Google. "Keluar dari semua perangkat" mencabut identitas yang ditautkan kemudian (`asal = 'tautan'`), bukan identitas asal akun Google.
   - Akun belum terverifikasi dihapus setelah 24 jam, termasuk yang punya identitas Google.
7. **Anti-enumerasi.** Daftar, lupa sandi, kirim ulang: 202 dengan body sama. Masuk gagal: 401 sama dengan argon2 dummy. Daftar dengan email terverifikasi mengirim "akun sudah ada" ke pemiliknya.
8. **Batas laju dan penguncian.** Per IP dan per email (hash). Turnstile wajib setelah 3 kegagalan; mulai kegagalan ke-5 kunci 30 detik, berlipat tiap kegagalan berikutnya, paling lama 1 jam; hitungan mulai dari nol 15 menit setelah kegagalan/kunci terakhir. Setiap percobaan dicatat secara atomik SEBELUM verifikasi sandi, jadi percobaan paralel tidak bisa melewati ambang. Berlaku juga untuk email tak terdaftar (pesan identik).
9. **Google.** Authorization Code + PKCE S256 + state + nonce, scope `openid email profile`. State di cookie `__Host-urusin_oauth`, dibandingkan dengan query, baris server dipakai sekali. ID token diverifikasi `jose` (JWKS, iss, aud, exp, iat, nonce). Callback persis `/auth/google/callback`; redirect URI dibangun dari `DOMAIN` runtime (`https://${DOMAIN}/auth/google/callback`) sehingga setiap set host di `deploy/hosts.json` memakai callback-nya sendiri. e2e memakai IdP OIDC tiruan (`URUSIN_OIDC_FIXTURE=1`, ditolak di produksi) dengan klien OIDC yang sama.
10. **Vault dengan envelope encryption.**
    - DEK acak 256-bit per pemilik (AES-256-GCM), dibungkus KEK. Data Diri, judul, dan isi berkas dienkripsi dengan DEK; AAD berversi (`v1|…`) mengikat ciphertext ke pemilik dan objeknya.
    - Label HKDF terpisah dari `URUSIN_PII_KEY`: `urusin/kek/v1` untuk KEK dan `urusin/placeholder-hmac/v1` untuk kunci HMAC placeholder.
    - Rotasi KEK: `URUSIN_PII_KEY_PREV` membuka DEK lama secara malas (dibungkus ulang saat dipakai) dan `pnpm kek:rotate` membungkus ulang semuanya sekaligus. Prosedur dan escrow kunci di `deploy/README.md`.
    - Hapus akun = crypto-shred: DEK terbungkus ditimpa nol lalu dihapus, baris dan berkas dihapus, `secure_delete` aktif, WAL di-checkpoint.
11. **Batas penyimpanan (§3.26.4).** Per pemilik 10 berkas × 9 MB (JPG/PNG/WebP/PDF); per tamu 3 berkas dan 20 MB, dan semua tamu bersama paling banyak 25% dari batas global (tamu tidak bisa memenuhi host); total vault global (`URUSIN_VAULT_MAX_MB`, default 2048) dan ambang isi volume host (`URUSIN_VAULT_DISK_THRESHOLD`, default 85%). Melewati batas global → 507 "Penyimpanan sedang penuh" + log `[ALERT]`. `BODY_SIZE_LIMIT` 10M. Penyapu tiap jam menghapus tamu, demo, dan akun belum terverifikasi yang lewat 24 jam.
12. **Akses nilai vault (§3.26.1).**
    - `GET /api/vault*` hanya untuk pemilik, dengan `Sec-Fetch-Site: same-origin`, Origin persis (bila ada), dan `Cache-Control: no-store`; dokumen pemilik lain = 404.
    - Mengunduh dokumen di **perangkat baru** (sesi yang belum pernah mengunduh) butuh bukti kredensial ≤ 15 menit (`PERLU_MASUK_ULANG` 401 → `POST /api/akun/konfirmasi-sandi` atau masuk ulang dengan Google).
    - **Penyelesai PII tunggal** `lib/server/vault/resolver.ts`: `izinkanIsi` menerbitkan token persetujuan sekali pakai (5 menit) yang terikat pemilik, hash daftar write (`pendamping.izinkan`), dan origin tujuan; `resolusiNilai` hanya mengembalikan field di daftar itu. Satu-satunya pemanggil sah adalah `lib/server/pendamping/**` (ditegakkan tes impor dan aturan lint): peramban hanya mengirim `{writeList, targetOrigin}` ke `POST /api/urusan/[id]/izinkan-isi` (pemilik urusan saja; respons tanpa nilai); `pendamping/isi.ts` `izinkanIsiUrusan` menyimpan token persetujuan di server, dan controller Pendamping memanggil `ambilIsianUntukIsi(urusanId, liveOrigin)` yang mensyaratkan origin halaman hidup sama persis dengan `targetOrigin`, lalu mengetik nilai dan berkas (`berkas:<JENIS>`) lewat kanal internal. Peramban tidak pernah membaca nilai vault untuk Pendamping (ditegakkan tes). Salinan demo hanya boleh menuju situs latihan (`NILAI_SINTETIS_DITOLAK`). Nilai tidak pernah dicatat.
13. **"Masuk sebagai juri" (critic).** Tidak ada sandi demo yang dipublikasikan atau bisa dikunci. Tombol membuat salinan `demo` terisolasi dengan data sintetis; Turnstile wajib bila kuncinya ada; tanpa kunci (juga di produksi) tombol tetap jalan agar juri selalu bisa masuk, dengan pengaman yang selalu berlaku: maksimal 3 per IP per hari, dan batas global salinan aktif (`URUSIN_DEMO_AKTIF_MAKS`, default 200).
14. **Email.** `Mailer` punya implementasi Resend (`api.resend.com`, tanpa SDK), mode `log` (tautan ke log/outbox), dan memori (tes). `URUSIN_EMAIL_MODE=resend|log`; kosong = `resend` bila `RESEND_API_KEY` asli terisi, selain itu `log`. `log` sah di produksi: email **ditahan** (tidak terkirim, tautan tidak dicatat karena tautan atur ulang di log = pengambilalihan akun oleh pembaca log), semua respons `tertunda`, satu `[ALERT]` saat boot. Di dev/CI `log` mencatat tautan (+ outbox e2e). Nilai placeholder `ganti-dengan-…` dianggap kosong, jadi app boot dan berjalan penuh tanpa kredensial auth (Google tersembunyi, email ditahan, vault satu perangkat sampai verifikasi). Pengirim `URUSIN_EMAIL_FROM` (default `no-reply@urusinai.web.id`). Bila kirim gagal (kuota Resend habis, DNS belum siap): respons jujur `tertunda: true` ("Pengiriman email sedang tertunda…"), `[ALERT]` di log, tanpa fallback berbayar. Verifikasi tidak memblokir: akun tetap bisa dipakai di perangkat itu seperti tamu sampai email dipastikan.
15. **Egress.** Semua HTTP keluar akun lewat `@urusin/egress` (`egressFetch`); allowlist runtime memuat `AUTH_HOSTS` (Google, Resend) dan `TURNSTILE_HOSTS` (`challenges.cloudflare.com`). Lint melarang fetch mentah di server.
16. **CSRF.** Semua POST/PUT/DELETE (API dan form action) melalui pemeriksaan Origin persis di `hooks.server.ts`. Callback Google berupa GET dan dilindungi state.

## Alternatif yang dipertimbangkan

- **Tetap vault di peramban saja (ADR 0007).** Ditolak karena keputusan pengguna.
- **Enkripsi end-to-end dengan kunci dari sandi warga.** Ditolak untuk sekarang: login Google tidak memberi rahasia untuk kunci, lupa sandi berarti data hilang, dan Pendamping di server tetap butuh nilai. Kandidat penguatan (passkey/PRF).
- **JWT tanpa sesi server.** Ditolak: tidak bisa dicabut tanpa daftar hitam.
- **Akun demo dengan sandi di README.** Ditolak (critic): sandi publik bisa dikunci atau diubah orang lain dan datanya bercampur antarjuri.
- **Penautan otomatis Google ke email yang sama.** Ditolak: `email_verified` dari IdP tidak membuktikan penguasaan akun Urusin yang sudah ada.

## Model ancaman

| Ancaman                                       | Mitigasi                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pencurian DB (salinan `urusin.db`)            | Token sesi/email hanya hash, sandi argon2id, vault terenkripsi dan DEK terbungkus KEK yang tidak ada di DB. **Email polos tetap terbaca**                     |
| Pencurian DB + `URUSIN_PII_KEY` (host bobol)  | Vault terbuka. Risiko sisa **tinggi**: server memegang kunci. Mitigasi: kunci hanya di env, escrow terpisah, rotasi `kek:rotate`, label HKDF terpisah         |
| Credential stuffing / brute force             | Batas laju per IP dan email, Turnstile setelah 3 gagal, kunci 30 detik berlipat sampai 1 jam mulai kegagalan ke-5, daftar sandi umum, argon2id dengan semafor |
| Enumerasi akun                                | Respons dan waktu seragam (poin 7); e2e #45                                                                                                                   |
| Fiksasi sesi / sid                            | Token hanya dari server, rotasi token dan `urusin_sid` saat login, prefiks `__Host-`                                                                          |
| CSRF / CSRF login                             | Origin persis untuk semua penulisan, SameSite=Lax, state OAuth cookie vs query                                                                                |
| Pencurian nilai vault lintas situs            | `Sec-Fetch-Site: same-origin` + Origin persis + `no-store` untuk GET vault; dokumen pemilik lain 404                                                          |
| Sesi curian mengunduh dokumen                 | Perangkat baru butuh bukti kredensial ≤ 15 menit                                                                                                              |
| Kode server membaca PII di luar alur isi      | Penyelesai tunggal + token persetujuan terikat hash daftar write dan origin + tes impor                                                                       |
| Data sintetis terkirim ke situs pemerintah    | Pemilik demo hanya boleh menuju origin situs latihan (`NILAI_SINTETIS_DITOLAK`)                                                                               |
| Open redirect (`next=`)                       | `amanNext()`; redirect eksternal hanya ke origin otorisasi Google                                                                                             |
| Token di tautan bocor                         | Sekali pakai, umur pendek, `Referrer-Policy: same-origin` + `no-store`; verifikasi juga butuh sandi pendaftaran                                               |
| Pra-pembajakan akun                           | Poin 6; e2e #48b                                                                                                                                              |
| Penautan Google ke akun korban                | Tidak ada penautan otomatis ke akun terverifikasi; tiket + bukti sandi, terikat akun yang sama; e2e #48                                                       |
| ID token palsu / replay / intersepsi kode     | JWKS, iss, aud, exp, nonce sekali pakai, PKCE S256, state sekali pakai; e2e #48 (state/nonce salah, replay, PKCE tidak cocok)                                 |
| Penguncian sebagai DoS terhadap korban        | Diterima: kunci paling lama 1 jam; atur ulang sandi tetap tersedia. Risiko sisa **rendah**                                                                    |
| Pengisian disk / penyalahgunaan juri dan tamu | Tamu malas + 20/IP/hari, juri 3/IP/hari + batas global + Turnstile, 10 × 9 MB per pemilik, batas total dan ambang disk (507 jujur), penyapu 24 jam            |
| Penyedia email membaca tautan                 | Tautan tidak membuka vault; verifikasi butuh sandi                                                                                                            |

## DPIA: perubahan (delta)

- **Data baru di server:** email akun (polos), hash sandi, metadata sesi (waktu, ringkasan peramban; UA mentah dan IP tidak disimpan), hash IP asal untuk kuota tamu/demo, `sub` Google, Data Diri dan dokumen (terenkripsi; termasuk NIK, KK, alamat, HP, foto KTP/KK).
- **Pemroses dan transfer lintas negara:**
  - **Resend (Amerika Serikat):** alamat email penerima dan isi email berisi tautan verifikasi/atur ulang. Ini transfer data pribadi ke luar Indonesia (UU PDP Pasal 56): hanya email dan tautan, tanpa Data Diri atau dokumen; dasar = persetujuan warga saat mendaftar, disebut di halaman privasi. Warga yang tidak mau email-nya melintas batas bisa memakai Google atau mode tamu.
  - **Oracle Cloud (Singapura):** host VPS menyimpan DB dan berkas vault terenkripsi. Kunci (`URUSIN_PII_KEY`) hanya di env host dan escrow pemilik proyek.
  - **Google (bila warga memilih Google):** identitas OIDC.
- **Dasar dan tujuan:** persetujuan warga saat mendaftar; tujuan sinkron lintas perangkat dan mengisi formulir.
- **Retensi:** tamu, demo, dan akun belum terverifikasi dihapus 24 jam setelah aktivitas terakhir (penyapu tiap jam); sesi, token, state, dan tiket kedaluwarsa dibersihkan tiap jam; Data Diri dan dokumen sampai warga menghapusnya atau menghapus akun (crypto-shred); cadangan DB berisi ciphertext yang tidak bisa dibuka setelah DEK dihapus.
- **Hak subjek (UU PDP):** akses (`GET /api/vault/data-diri`, `GET /api/vault/:id`), perbaikan (`PUT /api/vault/data-diri`), penghapusan (`DELETE /api/vault/:id`, `POST /api/akun/hapus`).
- **Yang TIDAK berubah:** model dan log tidak pernah menerima PII mentah; tabel harness tetap tanpa PII.

## Teks yang harus diubah (README dan halaman privasi)

1. README §5 Arsitektur: vault ada di perangkat (tamu) atau di server terenkripsi per akun.
2. README "Keamanan & Privasi": login (argon2id, sesi `__Host-`, Google OIDC), vault server terenkripsi (AES-256-GCM, DEK per pemilik, crypto-shred), rujukan ke ADR ini.
3. README §3 Fitur: akun opsional; Data Diri dan dokumen ikut lintas perangkat.
4. Halaman `/privasi` (milik Rafi) dan `docs/arsitektur.md`: dua mode (tanpa akun / dengan akun), pemroses Resend (AS) dan Google, penyimpanan Oracle Singapura, retensi 24 jam untuk akun belum dipastikan, model AI tidak pernah melihat NIK/KK/HP/email.
5. Lencana beranda: "Data di akun Anda (terenkripsi)" saat akun `sinkron`; selain itu "Data di perangkat ini".
6. `SECURITY.md`: cakupan akun (sesi, token email, vault server).

## Konsekuensi

- Server memegang ciphertext PII sekaligus kuncinya. Ini harga sinkron lintas perangkat dan diungkap di sini.
- `URUSIN_PII_KEY` menjadi rahasia paling kritis: kehilangan = semua vault hilang (escrow wajib), bocor bersama DB = vault terbuka (rotasi `kek:rotate`). Kunci HMAC placeholder kini diturunkan lewat HKDF, sehingga nilai HMAC placeholder berbeda dari versi sebelum ADR ini; pemetaan placeholder yang dibuat sebelumnya tidak cocok lagi (belum ada data produksi).
- Deploy produksi wajib: `URUSIN_PII_KEY`. Opsional tetapi perlu untuk fitur penuh: `RESEND_API_KEY` (tanpa ini email ditahan), Turnstile (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) untuk tombol juri, dan untuk Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, plus redirect URI untuk **setiap** set host di `deploy/hosts.json`.
- Batas laju disimpan di memori proses; penguncian dan kuota tamu/demo di DB (ikut lintas blue/green).
- Pendamping belum ada di kode: penyelesai PII dan kait `PengikatPemilik` sudah siap dipakai pengendalinya.
