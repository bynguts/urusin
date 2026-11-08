# 0028. Akun warga: email + sandi dan Google, sesi server, vault terenkripsi per akun

- **Status:** Diterima. Diimplementasikan di `packages/akun`, migrasi `packages/harness/migrations/0003_akun.sql`, dan rute `apps/web/src/routes/{api/akun,auth/google,masuk,daftar,verifikasi-email,lupa-sandi,atur-ulang-sandi,lengkapi-profil}`. Untuk akun yang masuk, ADR ini menggantikan sebagian [ADR 0007](0007-vault-pii-di-peramban.md). Mode tamu tetap mengikuti ADR 0007.
- **Dicatat:** 2026-11-09
- **Sumber keputusan:** keputusan pengguna (login Google + email/sandi, email lewat Resend, Data Diri dan dokumen ikut akun lintas perangkat)

## Konteks dan masalah

Warga memakai HP dan laptop bergantian. HP biasanya dipakai untuk memotret dokumen, laptop untuk mengisi formulir lewat ekstensi. Vault di peramban (ADR 0007) terikat ke satu perangkat, sehingga Data Diri harus diketik ulang dan dokumen difoto ulang di perangkat lain. Pengguna memutuskan bahwa Data Diri dan dokumen mengikuti akun di semua perangkat. Keputusan itu menuntut hal-hal berikut:

- akun dan login (email + sandi serta Google);
- penyimpanan PII di server, karena tidak ada cara lain untuk sinkron lintas perangkat tanpa server memegang ciphertext;
- tetap ada jalan tanpa akun bagi juri dan warga yang tidak mau mendaftar (guidebook: tanpa akses khusus).

## Keputusan

1. **Akun opsional.** Mode tamu (cookie `urusin_sid`, "Coba tanpa daftar") tetap utuh. Urusan yang dibuat tamu dicatat pemiliknya (`urusan_owner.guest_sid`) dan dipindahkan ke akun saat warga masuk dari peramban yang sama. Data Diri tamu tetap di peramban (ADR 0007). Klien mengunggahnya ke `/api/akun/data-diri` setelah masuk bila warga menyetujui.
2. **Sandi.** argon2id lewat `crypto.argon2` bawaan Node 26 (OpenSSL 3.5). Tidak ada modul native, jadi hasilnya sama di linux/arm64, linux/amd64, dan Windows, dan tidak perlu skrip install, sesuai `--ignore-scripts` di Dockerfile. Parameter memakai minimum OWASP: m = 19 MiB, t = 2, p = 1. Hash disimpan sebagai string PHC dan di-hash ulang otomatis bila parameter naik. Kebijakan sandi: minimal 8 karakter, maksimal 128, bukan anggota daftar sandi umum, dan bukan email sendiri.
3. **Sesi server.** Token acak 256-bit disimpan di cookie `__Host-urusin_akun` (HttpOnly, Secure, SameSite=Lax, Path=/). Server hanya menyimpan SHA-256 token itu. Sesi berakhir setelah 7 hari tidak dipakai atau 30 hari sejak login, dan keduanya bisa diatur lewat env. Setiap login menerbitkan token baru dan menghapus sesi lama yang dibawa cookie. Tersedia "keluar" dan "keluar dari semua perangkat". Ubah sandi menghapus semua sesi lain dan merotasi sesi yang sedang dipakai. Atur ulang sandi menghapus semua sesi.
4. **Token email.** Token verifikasi berlaku 24 jam dan token atur ulang 30 menit. Server menyimpan hash-nya saja. Token dipakai sekali secara atomik (`UPDATE … RETURNING`), dan menerbitkan token baru membatalkan token lama dengan tujuan yang sama. Membuka tautan (GET) tidak memakai token, sebab pemindai tautan di kotak surat sering membukanya lebih dulu. Token baru dipakai saat warga menekan tombol (POST).
5. **Anti-enumerasi.** Respons yang tidak boleh membocorkan apakah email terdaftar:
   - daftar, lupa sandi, dan kirim ulang selalu menjawab 202 dengan body yang sama;
   - masuk dengan email tak dikenal, akun Google-saja, atau sandi salah selalu menjawab 401 yang sama, dengan argon2 dummy agar waktunya setara;
   - email dikirim tanpa ditunggu, sehingga latensi penyedia email tidak membedakan cabang;
   - daftar dengan email yang sudah terverifikasi mengirim email "akun sudah ada" ke pemiliknya.
6. **Batas laju dan penguncian.** Batas laju dihitung per IP dan per email (hash). Login terkunci setelah 5 kegagalan beruntun: mula-mula 30 detik, lalu berlipat dua tiap kegagalan sampai maksimal 1 jam. Penguncian juga berlaku untuk email yang tidak terdaftar, dan dibuka oleh login berhasil atau atur ulang sandi.
7. **Google.** Alurnya Authorization Code + PKCE (S256) + state + nonce dengan scope `openid email profile`. State disimpan di cookie `__Host-urusin_oauth` dan dibandingkan dengan query, lalu baris server-nya dipakai sekali. Verifier dan nonce hanya ada di server. ID token diverifikasi dengan `jose`: tanda tangan RS256 lewat JWKS Google (cache 1 jam, diambil ulang saat kid baru muncul), lalu iss, aud, exp, iat, dan nonce. Callback-nya persis `/auth/google/callback`. Identitas baru ditautkan ke akun ber-email sama hanya bila Google menyatakan `email_verified`. Bila akun lama itu belum terverifikasi, sandi lamanya dibuang dan semua sesinya dihapus (anti pra-pembajakan). `arctic` tidak dipilih karena tidak memverifikasi ID token. `openid-client` tidak dipilih karena memerlukan discovery dan fetch global. `jose` (penulis yang sama dengan `openid-client`) cukup untuk verifikasi, dan kode pertukaran token cukup 20 baris.
8. **Vault per akun dengan envelope encryption.**
   - Setiap akun punya DEK acak 256-bit (AES-256-GCM). DEK disimpan terbungkus oleh KEK = HKDF-SHA256(`URUSIN_PII_KEY`, salt `urusin/vault/kek`, info `v1`). Pemisahan domain ini menjaga KEK berbeda dari kunci HMAC placeholder.
   - Data Diri (JSON), judul dokumen, dan isi berkas dienkripsi dengan DEK. AAD mengikat ciphertext ke akun dan objeknya.
   - Berkas disimpan di `URUSIN_VAULT_DIR/<akun>/<dokumen>.bin` (default `/data/vault`).
   - Hapus akun berarti crypto-shred: DEK terbungkus ditimpa nol lalu dihapus, baris dan berkas dihapus, `secure_delete` aktif, dan WAL di-checkpoint (TRUNCATE).
   - Placeholder `{{PEMOHON.NIK}}` dan aturan bahwa model tidak pernah melihat PII mentah tidak berubah, karena vault tidak pernah dirangkai ke prompt.
9. **Email.** Antarmuka `Mailer` punya tiga implementasi:
   - Resend lewat HTTPS API `api.resend.com`, tanpa SDK karena SDK memakai fetch global;
   - mailer dev yang mencatat tautan ke log;
   - mailer memori untuk tes.

   Produksi (`NODE_ENV=production`) menolak start tanpa `RESEND_API_KEY` + `EMAIL_FROM` kecuali `AUTH_EMAIL_DEV=1`, dan juga menolak start tanpa `URUSIN_PII_KEY`.

10. **Egress.** Semua HTTP keluar akun (Google token/JWKS dan Resend) melewati satu fungsi yang disuntikkan, `apps/web/src/lib/server/http-keluar.ts`. Begitu `@urusin/egress` masuk main, isi fungsi itu diganti `egressFetch` dan host `oauth2.googleapis.com`, `www.googleapis.com`, `accounts.google.com`, `api.resend.com` ditambahkan ke allowlist egress.
11. **CSRF.** Semua POST akun, baik API maupun form action, tetap melalui pemeriksaan Origin persis di `hooks.server.ts` tanpa pengecualian baru. Callback Google berupa GET.

## Alternatif yang dipertimbangkan

- **Tetap vault di peramban saja (ADR 0007).** Ditolak karena keputusan pengguna: Data Diri dan dokumen harus ikut lintas perangkat.
- **Enkripsi end-to-end dengan kunci dari sandi warga** (server tidak bisa membuka). Ditolak untuk sekarang. Login Google tidak memberi rahasia untuk menurunkan kunci, lupa sandi berarti data hilang, dan pengisian formulir dari laptop tetap butuh kunci di perangkat. Ini kandidat penguatan berikutnya (kunci dibungkus passkey/PRF).
- **JWT tanpa sesi server.** Ditolak karena tidak bisa dicabut ("keluar dari semua perangkat", reset sandi) tanpa daftar hitam, padahal daftar hitam sama saja dengan sesi server.
- **Modul native argon2 (`argon2`, `@node-rs/argon2`).** Tidak perlu karena Node 26 sudah punya `crypto.argon2`.

## Model ancaman

| Ancaman                                      | Mitigasi                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pencurian DB (salinan `urusin.db`)           | Token sesi dan token email hanya hash. Sandi argon2id. Data Diri, judul, dan berkas terenkripsi; DEK terbungkus KEK yang tidak ada di DB. **Email polos tetap terbaca**         |
| Pencurian DB + `URUSIN_PII_KEY` (host bobol) | Vault terbuka. Risiko sisa **tinggi**: server memegang kunci. Mitigasi: kunci hanya di env container, hak akses `/data` milik user `node`, rotasi KEK (`kek_version`)           |
| Credential stuffing / brute force            | Batas laju per IP dan per email, penguncian berlipat (maks 1 jam), daftar sandi umum, argon2id                                                                                  |
| Enumerasi akun                               | Respons dan waktu seragam (poin 5). Diuji di `akun.test.ts` dan `service.test.ts`                                                                                               |
| Fiksasi sesi                                 | Token hanya diterbitkan server, rotasi saat login, prefiks `__Host-` (subdomain tidak bisa menanam cookie)                                                                      |
| CSRF / CSRF login                            | Origin persis untuk semua POST, SameSite=Lax, state OAuth dari cookie dibandingkan dengan query                                                                                 |
| Open redirect (`next=`)                      | `amanNext()` hanya menerima path relatif tanpa `//`, backslash, skema, atau karakter kontrol. Redirect eksternal SvelteKit hanya ke origin otorisasi Google                     |
| Token di tautan bocor                        | Sekali pakai, umur pendek, `Referrer-Policy: same-origin` dan `no-store` di halaman token, tanpa skrip pihak ketiga (CSP)                                                       |
| Pra-pembajakan akun (daftar duluan)          | Daftar ulang email belum terverifikasi mengganti sandi dan membatalkan tautan lama. Login perlu email terverifikasi. Tautan Google membuang sandi akun yang belum terverifikasi |
| Penguncian sebagai DoS terhadap korban       | Diterima: maksimal 1 jam per gelombang, dan atur ulang sandi membuka kunci. Dicatat sebagai risiko sisa **rendah**                                                              |
| ID token palsu / replay                      | Tanda tangan JWKS, iss, aud, exp, nonce sekali pakai (baris state dihapus saat dipakai), PKCE                                                                                   |
| Penyedia email membaca tautan                | Tautan hanya memberi verifikasi atau atur ulang sandi (umur pendek), tidak membuka vault tanpa login                                                                            |

## DPIA: perubahan (delta)

- **Data baru di server:**
  - email akun (polos, untuk login dan pengiriman email);
  - hash sandi;
  - metadata sesi (waktu, ringkasan peramban seperti "Chrome di Android"; UA mentah dan IP tidak disimpan);
  - `sub` Google;
  - Data Diri dan dokumen milik akun (terenkripsi; termasuk NIK, KK, alamat, HP, foto KTP/KK).
- **Pemroses baru:** Resend (alamat email penerima dan isi email berisi tautan), Google (identitas OIDC, hanya bila warga memilih Google).
- **Dasar dan tujuan:** persetujuan warga saat mendaftar. Tujuannya sinkron lintas perangkat dan mengisi formulir.
- **Retensi:**
  - akun belum terverifikasi dihapus setelah 7 hari;
  - sesi, token, dan state kedaluwarsa dibersihkan tiap jam;
  - Data Diri dan dokumen disimpan sampai warga menghapusnya atau menghapus akun (crypto-shred);
  - cadangan DB berisi ciphertext yang tidak bisa dibuka setelah DEK dihapus.
- **Hak subjek (UU PDP):** akses (`GET /api/akun/data-diri`, unduh dokumen), perbaikan (`PUT`), dan penghapusan (`POST /api/akun/hapus`).
- **Yang TIDAK berubah:** model dan log tidak pernah menerima PII mentah, mode tamu tidak menyimpan PII di server, dan tabel harness tetap tanpa PII.

## Teks yang harus diubah (README dan halaman privasi)

Klaim lama "server tidak menyimpan PII" tidak lagi benar untuk akun. Teks yang wajib diganti sebelum demo:

1. README §5 Arsitektur, poin "nilai asli diisi dari vault di sisi eksekutor": tambahkan "vault ada di peramban (tamu) atau di server terenkripsi per akun (bila warga masuk)".
2. README "Keamanan & Privasi": tambahkan login (argon2id, sesi `__Host-`, Google OIDC), vault server terenkripsi (AES-256-GCM, DEK per akun, crypto-shred), dan bahwa threat model + DPIA ada di ADR 0028.
3. README §3 Fitur: tambahkan akun opsional serta Data Diri dan dokumen yang ikut lintas perangkat.
4. Halaman `/privasi` (milik Rafi) dan `docs/arsitektur.md` (alur data PII):
   - ganti "Data pribadi Anda hanya tersimpan di perangkat Anda" dengan dua mode: **tanpa akun**, data hanya di perangkat; **dengan akun**, data disimpan terenkripsi di server Urusin agar bisa dipakai di HP dan laptop, dan dihapus permanen saat akun dihapus;
   - sebut pemroses Resend (email) dan Google (bila memilih masuk dengan Google);
   - sebut bahwa model AI tetap tidak pernah melihat NIK, KK, HP, atau email;
   - sebut retensi: akun belum dipastikan dihapus setelah 7 hari.
5. Lencana beranda "Data di perangkat ini" (README UI §4 layar ★1): tampilkan "Data di akun Anda (terenkripsi)" saat warga masuk.
6. `SECURITY.md`: tambahkan cakupan akun (sesi, token email, vault server) ke ruang lingkup laporan.

## Konsekuensi

- Server kini memegang ciphertext PII sekaligus kuncinya. Ini harga sinkron lintas perangkat dan diungkap di sini, bukan disembunyikan.
- `URUSIN_PII_KEY` menjadi rahasia paling kritis. Kehilangannya berarti semua vault akun tidak bisa dibuka, dan kebocorannya bersama DB membuka vault. Rotasi lewat `kek_version`, yaitu bungkus ulang DEK tanpa mengenkripsi ulang data, belum punya skrip.
- Deploy produksi wajib menyetel `RESEND_API_KEY`, `EMAIL_FROM` (atau `AUTH_EMAIL_DEV=1`), dan `URUSIN_PII_KEY`. Untuk Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan redirect URI `https://<domain>/auth/google/callback`.
- Batas laju dan penguncian disimpan di memori proses dan di DB. Deploy blue/green berbagi DB, jadi penguncian ikut, tetapi batas laju per instance tidak.
