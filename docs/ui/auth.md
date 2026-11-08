# Akun dan login: panduan UI (untuk Rafi)

Server, kontrak, dan form action sudah jadi. Layar App 15–20 tinggal didesain ulang. Halaman `.svelte` yang ada sekarang hanya kerangka tanpa gaya yang ditandai `DEV-ONLY`: e2e memakainya, jadi silakan ganti seluruh markup, tetapi **pertahankan nama field, nama aksi, dan teks/role yang dipakai e2e** (lihat bagian terakhir) atau ubah `apps/web/e2e/akun.spec.ts` sekalian.

Keputusan dan model ancaman ada di [ADR 0028](../adr/0028-akun-dan-login.md). Kontrak bertipe ada di `packages/contracts/src/akun.ts` (`import { … } from '@urusin/contracts'`).

## Prinsip

- **Login tidak wajib.** Tombol "Coba tanpa daftar" (mode tamu) harus selalu ada di Masuk dan Daftar. Saat warga masuk dari peramban yang sama, urusan tamu otomatis ikut ke akun.
- **Jangan pernah menulis "email tidak terdaftar" atau "email sudah dipakai".** Server sengaja memberi jawaban yang sama: "Cek email Anda" / "Bila email terdaftar, tautan dikirim". Tampilkan apa adanya.
- **Pesan galat dari server boleh ditampilkan langsung** (`pesanWarga`) karena kalimatnya pendek, berbahasa Indonesia, dan tanpa istilah teknis. Pakai `kode` untuk logika (misalnya menampilkan tombol "Kirim ulang tautan").
- Semua formulir berfungsi **tanpa JavaScript** (form action biasa). `use:enhance` boleh ditambahkan.
- Status login tersedia di setiap halaman lewat `data.akun` dari `+layout.server.ts`: `null` untuk tamu, atau `{ email, emailTerverifikasi }`.

## Rute halaman (form action)

| Layar                        | Rute                          | Field formulir                                                                     | Hasil sukses                                                                                   | Galat (`form.kode`)                                                                                                                   |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| App 15 Masuk                 | `/masuk?next=/path`           | `email`, `sandi`, `next` (hidden, dari `data.next`)                                | redirect 303 ke `next`, atau ke `/lengkapi-profil?next=…` bila nama belum ada                  | `KREDENSIAL_SALAH` 401, `EMAIL_BELUM_TERVERIFIKASI` 403 (tampilkan tautan ke `/verifikasi-email`), `TERKUNCI` 429, `RATE_LIMITED` 429 |
| App 16 Daftar                | `/daftar`                     | `email`, `sandi`                                                                   | `form = { terkirim: true, email }`: tampilkan "Cek email Anda"                                 | `EMAIL_TIDAK_VALID`, `SANDI_TERLALU_PENDEK`, `SANDI_TERLALU_PANJANG`, `SANDI_TERLALU_UMUM` (422), `RATE_LIMITED`                      |
| App 17 Verifikasi email      | `/verifikasi-email?token=…`   | aksi `?/pastikan`: `token` (hidden). Aksi `?/kirimUlang`: `email`                  | `pastikan`: `form = { terverifikasi: true }`. `kirimUlang`: `form = { terkirim: true, email }` | `TOKEN_TIDAK_VALID` 400, `RATE_LIMITED`                                                                                               |
| App 18 Lupa kata sandi       | `/lupa-sandi`                 | `email`                                                                            | `form = { terkirim: true, email }`: "Bila terdaftar, tautan dikirim (berlaku 30 menit)"        | `EMAIL_TIDAK_VALID`, `RATE_LIMITED`                                                                                                   |
| App 19 Atur ulang kata sandi | `/atur-ulang-sandi?token=…`   | `token` (hidden), `sandi`                                                          | `form = { berhasil: true }`: semua perangkat sudah keluar, arahkan ke Masuk                    | `TOKEN_TIDAK_VALID`, `SANDI_*` (token TIDAK terbakar, warga bisa coba lagi), `RATE_LIMITED`                                           |
| App 20 Lengkapi profil       | `/lengkapi-profil?next=/path` | `namaLengkap` (wajib), `hp` (opsional; spasi/titik/strip dibuang), `next` (hidden) | redirect 303 ke `next`                                                                         | `BODY_INVALID` 422                                                                                                                    |

Data `load` per halaman:

- `/masuk`: `{ next, googleAktif, galat }`. `galat` terisi saat kembali dari Google yang gagal (`?galat=GOOGLE_GAGAL` dan sejenisnya); tampilkan seperti galat form. Bila sudah masuk, langsung diarahkan ke `next`.
- `/daftar`: `{ googleAktif }`. Bila sudah masuk, diarahkan ke `/`.
- `/verifikasi-email`, `/atur-ulang-sandi`: `{ token, tokenBerlaku }`. Membuka tautan **tidak** memakai token. Token dipakai saat tombol ditekan, karena pemindai email sering membuka tautan lebih dulu. Bila `tokenBerlaku` false, tampilkan "Tautan sudah tidak berlaku…" dan jalan untuk meminta tautan baru. Dengan JS, tombol "Pastikan email" boleh dikirim otomatis saat halaman tampil.
- `/lengkapi-profil`: `{ next, namaLengkap }` (nama dari Google sudah terisi bila ada). Tamu diarahkan ke Masuk.

**Masuk dengan Google:** gunakan `<form method="GET" action="/auth/google">` dengan `<input type="hidden" name="next">` (atau tautan biasa `/auth/google?next=…` dengan `data-sveltekit-reload`). Tampilkan tombolnya hanya bila `googleAktif`. Setelah Google, warga kembali ke `next` atau ke Lengkapi profil. Bila gagal, warga kembali ke `/masuk?galat=…`.

Aturan sandi untuk teks bantuan: minimal 8 karakter dan bukan sandi umum. Jangan tampilkan aturan rumit (huruf besar, simbol); server memang tidak memintanya.

## Endpoint JSON (untuk store, pengaturan akun, Data Diri, Dompet)

Semua respons memakai `cache-control: no-store`. Galat berbentuk `{ kode, pesanWarga }`, dan 429 membawa header `Retry-After` (detik). POST/PUT/DELETE wajib dari origin yang sama; `fetch` biasa dari halaman sudah memenuhinya.

| Method | Path                               | Body → Respons (skema di `@urusin/contracts`)                          | Catatan                                                                                |
| ------ | ---------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/akun`                        | → `SesiAkunResponse` (`masuk`, `metode.google`, `akun`, `perangkat[]`) | untuk layar Akun/Pengaturan                                                            |
| POST   | `/api/akun/daftar`                 | `DaftarRequest` → 202 `{terkirim:true}`                                |                                                                                        |
| POST   | `/api/akun/verifikasi`             | `{token}` → `{terverifikasi:true}`                                     |                                                                                        |
| POST   | `/api/akun/verifikasi/kirim-ulang` | `{email}` → 202 `{terkirim:true}`                                      |                                                                                        |
| POST   | `/api/akun/masuk`                  | `MasukRequest` → `MasukResponse` (`akun`, `next`, `urusanDipindahkan`) | memasang cookie sesi                                                                   |
| POST   | `/api/akun/keluar`                 | → `{keluar:true, sesiDihapus}`                                         | perangkat ini                                                                          |
| POST   | `/api/akun/keluar-semua`           | → `{keluar:true, sesiDihapus}`                                         | "Keluar dari semua perangkat"                                                          |
| POST   | `/api/akun/lupa-sandi`             | `{email}` → 202 `{terkirim:true}`                                      |                                                                                        |
| POST   | `/api/akun/atur-ulang-sandi`       | `{token, sandi}` → `{berhasil:true}`                                   |                                                                                        |
| POST   | `/api/akun/ubah-sandi`             | `{sandiLama?, sandiBaru}` → `{berhasil:true}`                          | `sandiLama` wajib bila `akun.punyaSandi`; galat `SANDI_LAMA_SALAH`                     |
| POST   | `/api/akun/hapus`                  | `{konfirmasi:"HAPUS", sandi?}` → `{terhapus:true}`                     | warga mengetik HAPUS; `sandi` wajib bila `punyaSandi`. Tidak bisa dibatalkan           |
| GET    | `/api/akun/data-diri`              | → `{dataDiri, diubahPada}`                                             | layar Data Diri; tersimpan terenkripsi                                                 |
| PUT    | `/api/akun/data-diri`              | `DataDiri` → `{dataDiri, diubahPada}`                                  | mengganti seluruh isi; field yang tidak dikirim terhapus                               |
| POST   | `/api/akun/profil`                 | `{namaLengkap, hp?}` → `{dataDiri, diubahPada}`                        | menggabungkan ke Data Diri                                                             |
| GET    | `/api/akun/dokumen`                | → `{dokumen: DokumenAkun[]}`                                           | layar Dompet                                                                           |
| POST   | `/api/akun/dokumen`                | multipart `berkas`, `jenis`, `judul` → 201 `DokumenAkun`               | JPG/PNG/WebP/PDF, maks 5 MB (`DOKUMEN_TERLALU_BESAR` 413, `DOKUMEN_JENIS_DITOLAK` 415) |
| GET    | `/api/akun/dokumen/[id]`           | → berkas (lampiran)                                                    |                                                                                        |
| DELETE | `/api/akun/dokumen/[id]`           | → `{terhapus:true}`                                                    |                                                                                        |
| GET    | `/api/akun/urusan`                 | → `DaftarUrusanResponse`                                               | layar Lacak saat masuk: sama di HP dan laptop                                          |

Endpoint selain daftar/masuk/lupa/atur-ulang/verifikasi menjawab `401 BELUM_MASUK` untuk tamu.

**Data Diri tamu ke akun:** Data Diri tamu tersimpan di peramban (ADR 0007). Setelah masuk, tawarkan "Simpan Data Diri ke akun agar bisa dipakai di HP dan laptop?". Bila warga setuju, kirim `PUT /api/akun/data-diri`.

## Keadaan yang perlu didesain

- **Masuk:** galat kredensial; email belum dipastikan (dengan tombol kirim ulang); terkunci sementara ("tunggu sebentar"); kembali dari Google yang gagal atau dibatalkan; Google tidak tersedia (tombol disembunyikan).
- **Daftar:** sandi ditolak (tiga alasan); "Cek email Anda" (sebut emailnya dan bahwa tautan berlaku 24 jam).
- **Verifikasi email:** tombol "Pastikan email saya"; berhasil; tautan kedaluwarsa atau sudah dipakai (dengan formulir kirim ulang).
- **Lupa / atur ulang:** terkirim; tautan kedaluwarsa (30 menit); sandi baru ditolak; berhasil ("semua perangkat sudah dikeluarkan").
- **Lengkapi profil:** satu pertanyaan utama (nama sesuai KTP), HP opsional.
- **Pengaturan akun** (layar Akun): email, status Google, daftar perangkat (`ringkasan`, `terakhirAktif`, penanda "perangkat ini"), Ubah sandi / Buat sandi (bila `punyaSandi` false), Keluar, Keluar dari semua perangkat, Hapus akun (konfirmasi ketik HAPUS).
- **Lencana privasi:** tamu → "Data di perangkat ini". Masuk → "Data di akun Anda (terenkripsi)".

## Dipakai e2e (jangan diubah tanpa memperbarui `apps/web/e2e/akun.spec.ts`)

- Label input: "Email", "Kata sandi" (Masuk), label yang memuat "Kata sandi" (Daftar), "Kata sandi baru", "Nama lengkap".
- Tombol: "Daftar", "Masuk", "Pastikan email saya", "Kirim tautan", "Simpan kata sandi", "Simpan". Tautan: "Coba tanpa daftar".
- Pesan sukses memakai `role="status"` dengan teks "Cek email Anda", "Email sudah dipastikan", "Tautan berlaku 30 menit", "Kata sandi baru tersimpan".
- Pesan galat memakai `role="alert"` dengan atribut `data-kode="<KODE>"`.

Rute baru perlu didaftarkan di `perf-routes.cjs` begitu layarnya final. Kerangka dev-only belum didaftarkan.
