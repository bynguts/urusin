# Akun dan login: panduan UI (untuk Rafi)

Server, kontrak, dan form action sudah jadi. Layar App 15–20 tinggal didesain ulang. Halaman `.svelte` yang ada sekarang hanya kerangka tanpa gaya yang ditandai `DEV-ONLY`: e2e memakainya, jadi silakan ganti seluruh markup, tetapi **pertahankan nama field, nama aksi, dan teks/role yang dipakai e2e** (lihat bagian terakhir) atau ubah `apps/web/e2e/akun.spec.ts` sekalian.

Keputusan dan model ancaman ada di [ADR 0028](../adr/0028-akun-dan-login.md). Kontrak bertipe ada di `packages/contracts/src/akun.ts` (`import { … } from '@urusin/contracts'`).

## Prinsip

- **Login tidak wajib.** "Coba tanpa daftar" (mode tamu) dan **"Masuk sebagai juri"** harus selalu terlihat di Masuk. Saat warga masuk dari peramban yang sama, urusan dan Data Diri tamu otomatis pindah ke akun.
- **Jangan pernah menulis "email tidak terdaftar" atau "email sudah dipakai".** Server sengaja memberi jawaban sama: "Cek email Anda" / "Bila email terdaftar, tautan dikirim".
- **`pesanWarga` boleh ditampilkan langsung.** Pakai `kode` untuk logika (misalnya memunculkan Turnstile atau formulir konfirmasi sandi).
- **Email bisa tertunda.** Bila `form.tertunda` (atau `email.tertunda` di `GET /api/akun`) bernilai true, tampilkan pesan jujur: email sedang tertunda, akun tetap bisa dipakai di perangkat ini, coba kirim ulang nanti. Jangan berpura-pura email sudah terkirim. Selama Resend belum dikonfigurasi (`email.mode` `log` di produksi) `tertunda` **selalu** true: verifikasi email belum mungkin, jadi jangan memblokir apa pun di belakangnya.
- **Akun belum dipastikan = tamu.** `akun.sinkron` false berarti Data Diri dan dokumen hanya di perangkat ini sampai email dipastikan. Tampilkan lencana "Data di perangkat ini" dan ajakan memastikan email; `sinkron` true → "Data di akun Anda (terenkripsi)".
- Semua formulir berfungsi **tanpa JavaScript** (form action biasa). `use:enhance` boleh ditambahkan.
- Status login di setiap halaman lewat `data.akun` dari `+layout.server.ts`: `null` untuk tamu, atau `{ jenis: 'akun' | 'demo', email (null untuk demo), emailTerverifikasi }`.

## Rute halaman (form action)

| Layar                        | Rute                          | Aksi dan field                                                                                                                             | Hasil sukses                                                                                            | Galat (`form.kode`)                                                                                                                   |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| App 15 Masuk                 | `/masuk?next=/path`           | `?/masuk`: `email`, `sandi`, `next` (hidden), `cf-turnstile-response` atau `turnstile`. `?/juri`: `cf-turnstile-response` atau `turnstile` | redirect 303 ke `next` (atau `/lengkapi-profil?next=…`); juri → `/`                                     | `KREDENSIAL_SALAH` 401, `TURNSTILE_WAJIB` 403, `TERKUNCI` 429, `RATE_LIMITED`, `DEMO_BATAS_IP`, `DEMO_PENUH`, `TURNSTILE_TIDAK_AKTIF` |
| App 16 Daftar                | `/daftar`                     | `email`, `sandi`                                                                                                                           | `form = { terkirim: true, tertunda, email }`                                                            | `EMAIL_TIDAK_VALID`, `SANDI_TERLALU_PENDEK`, `SANDI_TERLALU_PANJANG`, `SANDI_TERLALU_UMUM` (422), `RATE_LIMITED`                      |
| App 17 Verifikasi email      | `/verifikasi-email?token=…`   | `?/pastikan`: `token` (hidden), **`sandi`** (sandi saat mendaftar). `?/kirimUlang`: `email`                                                | `pastikan`: `{ terverifikasi: true }` (warga masuk lagi). `kirimUlang`: `{ terkirim, tertunda, email }` | `TOKEN_TIDAK_VALID` 400, `KREDENSIAL_SALAH` 401, `TERKUNCI`, `RATE_LIMITED`                                                           |
| App 18 Lupa kata sandi       | `/lupa-sandi`                 | `email`                                                                                                                                    | `{ terkirim: true, tertunda, email }`                                                                   | `EMAIL_TIDAK_VALID`, `RATE_LIMITED`                                                                                                   |
| App 19 Atur ulang kata sandi | `/atur-ulang-sandi?token=…`   | `token` (hidden), `sandi`                                                                                                                  | `{ berhasil: true }`: semua perangkat keluar                                                            | `TOKEN_TIDAK_VALID`, `SANDI_*` (token tidak terbakar), `RATE_LIMITED`                                                                 |
| App 20 Lengkapi profil       | `/lengkapi-profil?next=/path` | `namaLengkap` (wajib), `hp` (opsional), `next` (hidden)                                                                                    | redirect 303 ke `next`                                                                                  | `BODY_INVALID` 422                                                                                                                    |

Data `load`:

- `/masuk`: `{ next, googleAktif, juri, turnstileSiteKey, tautkan, galat }`.
  - `juri` false → sembunyikan tombol juri (produksi tanpa Turnstile).
  - `turnstileSiteKey` → render widget Cloudflare Turnstile (skrip `challenges.cloudflare.com`); widget mengisi `cf-turnstile-response` sendiri. Tampilkan widget di tombol juri selalu, dan di formulir masuk setelah galat `TURNSTILE_WAJIB`.
  - `galat` dari `?galat=`: `GOOGLE_GAGAL`, `GOOGLE_TIDAK_AKTIF`, `GOOGLE_EMAIL_BELUM_TERVERIFIKASI`, `GOOGLE_PERLU_SANDI`, `GOOGLE_SUDAH_DIPAKAI`.
  - `tautkan` true (setelah `GOOGLE_PERLU_SANDI`): "Email ini sudah punya akun. Masuk dengan kata sandi untuk menautkan Google." Setelah masuk dengan sandi, Google tertaut otomatis.
- `/daftar`: `{ googleAktif }`. `/verifikasi-email`, `/atur-ulang-sandi`: `{ token, tokenBerlaku }`; membuka tautan tidak memakai token.
- `/lengkapi-profil`: `{ next, namaLengkap }`. Nama disimpan di Data Diri pemilik vault (akun terverifikasi, atau perangkat ini bila belum).

**Masuk dengan Google:** `<form method="GET" action="/auth/google">` + `<input type="hidden" name="next">` (atau tautan `/auth/google?next=…` dengan `data-sveltekit-reload`), hanya bila `googleAktif`. Bila warga sudah masuk, tombol yang sama di Pengaturan akun **menautkan** Google ke akun itu.

Aturan sandi untuk teks bantuan: minimal 8 karakter dan bukan sandi umum.

## Endpoint JSON

Galat berbentuk `{ kode, pesanWarga }`; 429 membawa `Retry-After`. POST/PUT/DELETE wajib dari origin yang sama (`fetch` biasa dari halaman sudah memenuhinya).

| Method | Path                               | Body → Respons (skema di `@urusin/contracts`)                                                                              | Catatan                                                                                                                                           |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/akun`                        | → `SesiAkunResponse` (`masuk`, `metode{email,google,juri}`, `email{mode,tertunda}`, `akun`, `perangkat[]`)                 | `akun.jenis`, `akun.sinkron`, `akun.terhubungGoogle`                                                                                              |
| POST   | `/api/akun/daftar`                 | `DaftarRequest` → 202 `{terkirim:true, tertunda}`                                                                          |                                                                                                                                                   |
| POST   | `/api/akun/verifikasi`             | `{token, sandi}` → `{terverifikasi:true}`                                                                                  | semua sesi akun dicabut; warga masuk lagi                                                                                                         |
| POST   | `/api/akun/verifikasi/kirim-ulang` | `{email}` → 202 `{terkirim:true, tertunda}`                                                                                |                                                                                                                                                   |
| POST   | `/api/akun/masuk`                  | `MasukRequest` (`turnstile?`) → `MasukResponse` (`akun`, `next`, `urusanDipindahkan`, `vaultDipindahkan`, `googleTertaut`) | memasang cookie sesi, memutar `urusin_sid`                                                                                                        |
| POST   | `/api/akun/juri`                   | `{turnstile?}` → `{akun, next}`                                                                                            | "Masuk sebagai juri": salinan demo sintetis 24 jam                                                                                                |
| POST   | `/api/akun/konfirmasi-sandi`       | `{sandi}` → `{berhasil:true}`                                                                                              | setelah `PERLU_MASUK_ULANG` (unduh di perangkat baru)                                                                                             |
| POST   | `/api/akun/keluar`                 | → `{keluar:true, sesiDihapus}`                                                                                             | perangkat ini                                                                                                                                     |
| POST   | `/api/akun/keluar-semua`           | → `{keluar:true, sesiDihapus}`                                                                                             |                                                                                                                                                   |
| POST   | `/api/akun/lupa-sandi`             | `{email}` → 202 `{terkirim:true, tertunda}`                                                                                |                                                                                                                                                   |
| POST   | `/api/akun/atur-ulang-sandi`       | `{token, sandi}` → `{berhasil:true}`                                                                                       |                                                                                                                                                   |
| POST   | `/api/akun/ubah-sandi`             | `{sandiLama?, sandiBaru}` → `{berhasil:true}`                                                                              | `sandiLama` wajib bila `punyaSandi`                                                                                                               |
| POST   | `/api/akun/hapus`                  | `{konfirmasi:"HAPUS", sandi?}` → `{terhapus:true}`                                                                         | tidak bisa dibatalkan                                                                                                                             |
| POST   | `/api/akun/profil`                 | `{namaLengkap, hp?}` → `{dataDiri, diubahPada}`                                                                            | menggabungkan ke Data Diri                                                                                                                        |
| GET    | `/api/akun/urusan`                 | → `DaftarUrusanResponse`                                                                                                   | urusan milik akun terverifikasi                                                                                                                   |
| GET    | `/api/vault`                       | → `VaultResponse` (`pemilik`, `sinkron`, `dataDiri{ada,diubahPada}`, `dokumen[]`, `batas`)                                 | tanpa nilai; layar Dompet                                                                                                                         |
| POST   | `/api/vault`                       | multipart `berkas`, `jenis`, `judul` → 201 `DokumenAkun`                                                                   | JPG/PNG/WebP/PDF ≤ 9 MB, 10 berkas (`DOKUMEN_TERLALU_BESAR` 413, `DOKUMEN_JENIS_DITOLAK` 415, `DOKUMEN_KUOTA_PENUH` 409, `PENYIMPANAN_PENUH` 507) |
| GET    | `/api/vault/data-diri`             | → `{dataDiri, diubahPada}`                                                                                                 | `no-store`; hanya `fetch` dari halaman sendiri                                                                                                    |
| PUT    | `/api/vault/data-diri`             | `DataDiri` → `{dataDiri, diubahPada}`                                                                                      | mengganti seluruh isi                                                                                                                             |
| GET    | `/api/vault/[id]`                  | → berkas (lampiran, `no-store`)                                                                                            | `PERLU_MASUK_ULANG` 401 di perangkat baru → minta sandi (`konfirmasi-sandi`) atau Google                                                          |
| DELETE | `/api/vault/[id]`                  | → `{terhapus:true}`                                                                                                        |                                                                                                                                                   |

`/api/vault*` berlaku untuk tamu juga: tamu baru benar-benar dibuat pada tulis pertama. `GET` vault menolak permintaan yang bukan dari halaman Urusin (`Sec-Fetch-Site` ≠ `same-origin`), jadi panggil dengan `fetch` dari halaman, bukan dengan tautan `<a>` lintas situs. Untuk unduh, `fetch` lalu `URL.createObjectURL` aman; navigasi langsung `<a href download>` dari halaman sendiri juga `same-origin`.

## Keadaan yang perlu didesain

- **Masuk:** galat kredensial; Turnstile muncul setelah 3 gagal; terkunci 15 menit; kembali dari Google gagal; Google perlu sandi (tautkan); tombol juri (dengan widget Turnstile) dan galat batasnya.
- **Daftar:** sandi ditolak; "Cek email Anda" + "buka tautannya dan masukkan kata sandi yang baru dibuat"; email tertunda.
- **Verifikasi email:** kolom sandi + "Pastikan email saya"; berhasil ("silakan masuk lagi"); tautan kedaluwarsa (formulir kirim ulang); sandi salah.
- **Lupa / atur ulang:** terkirim; tertunda; tautan kedaluwarsa; sandi ditolak; berhasil.
- **Unduh dokumen di perangkat baru:** dialog "Masukkan kata sandi untuk mengunduh di perangkat ini" (atau "Masuk ulang dengan Google" bila `punyaSandi` false).
- **Penyimpanan penuh:** pesan jujur 507, tanpa tombol coba ulang otomatis.
- **Pengaturan akun:** email, status Google (tautkan bila belum), perangkat, Ubah/Buat sandi, Keluar, Keluar dari semua perangkat, Hapus akun (ketik HAPUS). Sesi juri (`jenis: 'demo'`): label "Salinan demo, dihapus dalam 24 jam", tanpa ubah sandi/hapus akun.

## Dipakai e2e (jangan diubah tanpa memperbarui `apps/web/e2e/akun.spec.ts`)

- Label input: "Email", "Kata sandi" (Masuk), label yang memuat "Kata sandi" (Daftar, Verifikasi email), "Kata sandi baru", "Nama lengkap".
- Tombol: "Daftar", "Masuk", "Masuk dengan Google", "Masuk sebagai juri", "Pastikan email saya", "Kirim tautan", "Simpan kata sandi", "Simpan". Tautan: "Coba tanpa daftar".
- Formulir masuk `action="?/masuk"` dan formulir juri `data-juri`, masing-masing dengan `input[name="turnstile"]` (e2e mengisinya dengan token uji). Penanda tautan Google: elemen `[data-tautkan]`.
- Pesan sukses `role="status"`: "Cek email Anda", "Email sudah dipastikan", "Tautan berlaku 30 menit", "Kata sandi baru tersimpan".
- Pesan galat `role="alert"` dengan `data-kode="<KODE>"`.
- IdP tiruan `/dev/oidc/authorize` (hanya `URUSIN_OIDC_FIXTURE=1`) bukan layar produk; jangan didesain.

Rute baru perlu didaftarkan di `perf-routes.cjs` begitu layarnya final. Kerangka dev-only belum didaftarkan.
