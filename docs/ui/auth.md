# Akun dan login: panduan UI (untuk Rafi)

Server, kontrak, dan form action sudah jadi. Layar App 15–20 tinggal didesain ulang. Halaman `.svelte` yang ada sekarang hanya kerangka tanpa gaya yang ditandai `DEV-ONLY`: e2e memakainya, jadi silakan ganti seluruh markup, tetapi **pertahankan nama field, nama aksi, dan teks/role yang dipakai e2e** (lihat bagian terakhir) atau ubah `apps/web/e2e/akun.spec.ts` sekalian.

Keputusan dan model ancaman ada di [ADR 0028](../adr/0028-akun-dan-login.md) dan [ADR 0032](../adr/0032-akun-tanpa-verifikasi-email.md) (tanpa verifikasi email). Kontrak bertipe ada di `packages/contracts/src/akun.ts` (`import { … } from '@urusin/contracts'`).

## Prinsip

- **Wajib akun.** Tidak ada mode tamu. Memulai atau membuka urusan butuh sesi: tanpa sesi, tombol mulai mengarah ke `/daftar?next=<tujuan>`, halaman aplikasi (urusan, Urusanku, Data Diri, Dokumen, Pengaturan) ke `/masuk?next=<tujuan>`, dan API urusan/brankas/ingatan menjawab 401 `BELUM_MASUK`. Setelah daftar atau masuk, warga kembali ke tujuan semula. Halaman informatif (landing, katalog layanan/peristiwa, Tanya jawab, Bantuan, Privasi, Syarat) tetap publik. **"Masuk sebagai juri"** tetap selalu terlihat di Masuk. Data tamu lama (sebelum wajib akun) masih digabung ke akun saat warga masuk dari peramban yang sama, lalu disapu seperti biasa.
- **Masuk dan lupa sandi tidak menyebut apakah email terdaftar.** Hanya Daftar yang menjawab `EMAIL_SUDAH_TERDAFTAR` ("Email ini sudah terdaftar. Silakan masuk.", dengan tautan Masuk).
- **`pesanWarga` boleh ditampilkan langsung.** Pakai `kode` untuk logika (misalnya memunculkan Turnstile (opsional, tidak aktif di produksi saat ini) atau formulir konfirmasi sandi).
- **Email bisa tertunda.** Email hanya dipakai untuk atur ulang sandi dan pemberitahuan tautan Google. Selama Resend belum dikonfigurasi (kondisi produksi saat ini: `URUSIN_EMAIL_MODE=log`), `/lupa-sandi` mengembalikan `tersedia: false`: tampilkan pesan jujur bahwa atur ulang lewat email belum tersedia (`ATUR_ULANG_NONAKTIF`), tanpa formulir.
- **Daftar = akun penuh.** Daftar langsung masuk (tanpa "Cek email Anda") lalu ke `/beranda` atau `next`. `akun.sinkron` selalu true untuk akun dan demo (tidak ada mode tamu).
- Semua formulir berfungsi **tanpa JavaScript** (form action biasa). `use:enhance` boleh ditambahkan.
- Status login di setiap halaman lewat `data.akun` dari `+layout.server.ts`: `null` bila belum masuk, atau `{ jenis: 'akun' | 'demo', email (null untuk demo) }`.

## Brankas dan pengaturan perangkat

- Item `DokumenAkun` dari `/api/vault` dapat membawa `bacaSaja: true`. Ini menandai berkas contoh bersama
  pada salinan demo juri. Berkas tetap bisa diunduh dan dipakai untuk latihan. UI menampilkan
  "Contoh bawaan · hanya baca" serta menyembunyikan tombol hapus; Hapus semua hanya menghitung unggahan
  sendiri. Server tetap menolak penghapusan rujukan contoh.
- Jika jenis dokumen yang sedang difilter habis setelah penghapusan, filter kembali ke Semua supaya
  berkas lain tetap terlihat. Tabel Data Diri dapat digulir mendatar dan difokuskan untuk tombol panah.
- "Hapus data di perangkat ini" membersihkan daftar urusan/pesan serta wilayah lokal, mengembalikan
  preferensi tampilan ke nilai awal, menghentikan pembacaan suara, dan langsung memperbarui kontrol
  wilayah. Data Diri dan dokumen di server mengikuti aksi brankas/akun masing-masing.

## Rute halaman (form action)

| Layar                        | Rute                          | Aksi dan field                                                                                                                             | Hasil sukses                                                               | Galat (`form.kode`)                                                                                                                             |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| App 15 Masuk                 | `/masuk?next=/path`           | `?/masuk`: `email`, `sandi`, `next` (hidden), `cf-turnstile-response` atau `turnstile`. `?/juri`: `cf-turnstile-response` atau `turnstile` | redirect 303 ke `next` (atau `/lengkapi-profil?next=…`); juri → `/beranda` | `KREDENSIAL_SALAH` 401, `TURNSTILE_WAJIB` 403, `TERKUNCI` 429, `RATE_LIMITED`, `DEMO_BATAS_IP`, `DEMO_PENUH`, `TURNSTILE_TIDAK_AKTIF`           |
| App 16 Daftar                | `/daftar?next=/path`          | `email`, `sandi`, `next` (hidden)                                                                                                          | sukses: sesi dipasang, 303 ke `next` (bawaan `/beranda`)                   | `EMAIL_TIDAK_VALID`, `SANDI_TERLALU_PENDEK`, `SANDI_TERLALU_PANJANG`, `SANDI_TERLALU_UMUM` (422), `EMAIL_SUDAH_TERDAFTAR` (409), `RATE_LIMITED` |
| App 18 Lupa kata sandi       | `/lupa-sandi`                 | `email`                                                                                                                                    | `{ terkirim: true, tertunda, email }`                                      | `EMAIL_TIDAK_VALID`, `RATE_LIMITED`                                                                                                             |
| App 19 Atur ulang kata sandi | `/atur-ulang-sandi?token=…`   | `token` (hidden), `sandi`                                                                                                                  | `{ berhasil: true }`: semua perangkat keluar                               | `TOKEN_TIDAK_VALID`, `SANDI_*` (token tidak terbakar), `RATE_LIMITED`                                                                           |
| App 20 Lengkapi profil       | `/lengkapi-profil?next=/path` | `namaLengkap` (wajib), `hp` (opsional), `next` (hidden)                                                                                    | redirect 303 ke `next`                                                     | `BODY_INVALID` 422                                                                                                                              |

Data `load`:

- `/masuk`: `{ next, ulang, googleAktif, juri, turnstileSiteKey, tautkan, galat }`.
  - `?ulang=1&lanjut=/path` = masuk ulang untuk akun yang sudah masuk (`ulang = { email }`, formulir tetap tampil, email terisi, penanda `[data-ulang]`); sandi atau Google memberi sesi segar lalu kembali ke `lanjut` (alias `next`, hanya path situs ini).
  - Unduh dokumen (`unduhDokumen` di `lib/akun/klien.ts`): 401 `PERLU_MASUK_ULANG` → `/masuk?ulang=1&lanjut=/dokumen?unduh=<id>`; `/dokumen?unduh=<id>` melanjutkan unduhan otomatis.
  - `juri` selalu true: tombol juri selalu tampil. Tanpa kunci Turnstile (kondisi produksi saat ini), batas per IP/global dan kedaluwarsa 24 jam tetap berlaku.
  - `turnstileSiteKey` → render widget Cloudflare Turnstile (skrip `challenges.cloudflare.com`); widget mengisi `cf-turnstile-response` sendiri. Bila ada site key, tampilkan widget di tombol juri selalu, dan di formulir masuk setelah galat `TURNSTILE_WAJIB`.
  - `galat` dari `?galat=`: `GOOGLE_GAGAL`, `GOOGLE_TIDAK_AKTIF`, `GOOGLE_EMAIL_BELUM_TERVERIFIKASI`, `GOOGLE_PERLU_SANDI`, `GOOGLE_SUDAH_DIPAKAI`.
  - `tautkan` true (setelah `GOOGLE_PERLU_SANDI`): "Email ini sudah punya akun. Masuk dengan kata sandi untuk menautkan Google." Setelah masuk dengan sandi, Google tertaut otomatis.
- `/daftar`: `{ googleAktif, next }`. `/lupa-sandi`: `{ tersedia, googleAktif }`. `/atur-ulang-sandi`: `{ token, tokenBerlaku }`; membuka tautan tidak memakai token. `/verifikasi-email` (tautan lama) dialihkan ke `/beranda` atau `/masuk`.
- `/lengkapi-profil`: `{ next, namaLengkap }`. Nama disimpan di Data Diri pemilik vault (akun/demo).

**Masuk dengan Google:** `<form method="GET" action="/auth/google">` + `<input type="hidden" name="next">` (atau tautan `/auth/google?next=…` dengan `data-sveltekit-reload`), hanya bila `googleAktif`. Bila warga sudah masuk, tombol yang sama di Pengaturan akun **menautkan** Google ke akun itu.

Aturan sandi untuk teks bantuan: minimal 10 karakter dan bukan sandi umum.

## Endpoint JSON

Galat berbentuk `{ kode, pesanWarga }`; 429 membawa `Retry-After`. POST/PUT/DELETE wajib dari origin yang sama (`fetch` biasa dari halaman sudah memenuhinya).

| Method | Path                           | Body → Respons (skema di `@urusin/contracts`)                                                                                                    | Catatan                                                                                                                                                                      |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/akun`                    | → `SesiAkunResponse` (`masuk`, `metode{email,google,juri}`, `email{mode,tertunda}`, `akun`, `perangkat[]`)                                       | `akun.jenis`, `akun.sinkron`, `akun.terhubungGoogle`                                                                                                                         |
| POST   | `/api/akun/daftar`             | `DaftarRequest` → `MasukResponse` (sesi dipasang, `next: '/beranda'`); email terdaftar → 409 `EMAIL_SUDAH_TERDAFTAR`                             |                                                                                                                                                                              |
| POST   | `/api/akun/masuk`              | `MasukRequest` (`turnstile?`) → `MasukResponse` (`akun`, `next`, `urusanDipindahkan`, `vaultDipindahkan`, `googleTertaut`)                       | memasang cookie sesi, memutar `urusin_sid`                                                                                                                                   |
| POST   | `/api/akun/juri`               | `{turnstile?}` → `{akun, next}`                                                                                                                  | "Masuk sebagai juri": salinan demo sintetis 24 jam                                                                                                                           |
| POST   | `/api/urusan/[id]/izinkan-isi` | `{writeList, targetOrigin}` → `{diizinkan:true, kurang[]}`                                                                                       | "Izinkan isi" Pendamping: placeholder + `berkas:<JENIS>`; tanpa nilai; bukan pemilik 404; `targetOrigin` di luar allowlist (portal `kirim-asli` registry, situs latihan) 403 |
| POST   | `/api/akun/konfirmasi-sandi`   | `{sandi}` → `{berhasil:true}`                                                                                                                    | setelah `PERLU_MASUK_ULANG` (unduh di perangkat baru)                                                                                                                        |
| POST   | `/api/akun/keluar`             | → `{keluar:true, sesiDihapus}`                                                                                                                   | perangkat ini                                                                                                                                                                |
| POST   | `/api/akun/google/lepas`       | → `{dilepas}`                                                                                                                                    | Lepas Google (Pengaturan); `GOOGLE_SATU_SATUNYA` 409 bila akun belum punya sandi                                                                                             |
| POST   | `/api/akun/keluar-semua`       | → `{keluar:true, sesiDihapus}`                                                                                                                   |                                                                                                                                                                              |
| POST   | `/api/akun/lupa-sandi`         | `{email}` → 202 `{terkirim:true, tertunda}`                                                                                                      |                                                                                                                                                                              |
| POST   | `/api/akun/atur-ulang-sandi`   | `{token, sandi}` → `{berhasil:true}`                                                                                                             |                                                                                                                                                                              |
| POST   | `/api/akun/ubah-sandi`         | `{sandiLama?, sandiBaru}` → `{berhasil:true}`                                                                                                    | `sandiLama` wajib bila `punyaSandi`                                                                                                                                          |
| POST   | `/api/akun/hapus`              | `{konfirmasi:"HAPUS", sandi?}` → `{terhapus:true}`; sandi salah ikut penguncian; akun Google saja: `PERLU_MASUK_ULANG` 401 bila login > 15 menit | tidak bisa dibatalkan                                                                                                                                                        |
| POST   | `/api/akun/profil`             | `{namaLengkap, hp?}` → `{dataDiri, diubahPada}`                                                                                                  | menggabungkan ke Data Diri                                                                                                                                                   |
| GET    | `/api/akun/urusan`             | → `DaftarUrusanResponse`                                                                                                                         | urusan milik akun                                                                                                                                                            |
| GET    | `/api/vault`                   | → `VaultResponse` (`pemilik`, `sinkron`, `dataDiri{ada,diubahPada}`, `dokumen[]`, `batas`)                                                       | tanpa nilai; layar Dompet                                                                                                                                                    |
| POST   | `/api/vault`                   | multipart `berkas`, `jenis`, `judul` → 201 `DokumenAkun`                                                                                         | JPG/PNG/WebP/PDF ≤ 9 MB, 10 berkas (`DOKUMEN_TERLALU_BESAR` 413, `DOKUMEN_JENIS_DITOLAK` 415, `DOKUMEN_KUOTA_PENUH` 409, `PENYIMPANAN_PENUH` 507)                            |
| GET    | `/api/vault/data-diri`         | → `{dataDiri, diubahPada}`                                                                                                                       | `no-store`; hanya `fetch` dari halaman sendiri; `PERLU_MASUK_ULANG` 401 di perangkat baru → `/masuk?ulang=1&lanjut=/data-diri`                                               |
| PUT    | `/api/vault/data-diri`         | `DataDiri` → `{dataDiri, diubahPada}`                                                                                                            | mengganti seluruh isi                                                                                                                                                        |
| GET    | `/api/vault/[id]`              | → berkas (lampiran, `no-store`)                                                                                                                  | `PERLU_MASUK_ULANG` 401 di perangkat baru → minta sandi (`konfirmasi-sandi`) atau Google                                                                                     |
| DELETE | `/api/vault/[id]`              | → `{terhapus:true}`                                                                                                                              |                                                                                                                                                                              |

`/api/vault*` berlaku untuk tamu juga: tamu baru benar-benar dibuat pada tulis pertama. `GET` vault menolak permintaan yang bukan dari halaman Urusin (`Sec-Fetch-Site` ≠ `same-origin`), jadi panggil dengan `fetch` dari halaman, bukan dengan tautan `<a>` lintas situs. Untuk unduh, `fetch` lalu `URL.createObjectURL` aman; navigasi langsung `<a href download>` dari halaman sendiri juga `same-origin`.

## Keadaan yang perlu didesain

- **Masuk:** galat kredensial; Turnstile muncul setelah 3 gagal (hanya bila Turnstile aktif; tidak di produksi saat ini); terkunci (30 detik, berlipat sampai 1 jam; pakai `Retry-After`); kembali dari Google gagal; Google perlu sandi (tautkan); tombol juri (dengan widget Turnstile) dan galat batasnya.
- **Daftar:** sandi ditolak; email sudah terdaftar (tautan Masuk); sukses langsung ke beranda.
- **Lupa / atur ulang:** terkirim; tertunda; belum tersedia (tanpa pengirim email); tautan kedaluwarsa; sandi ditolak; berhasil.
- **Unduh dokumen di perangkat baru:** dialog "Masukkan kata sandi untuk mengunduh di perangkat ini" (atau "Masuk ulang dengan Google" bila `punyaSandi` false).
- **Penyimpanan penuh:** pesan jujur 507, tanpa tombol coba ulang otomatis.
- **Pengaturan akun:** email, status Google (tautkan bila belum: form GET `/auth/google` dengan `next=/pengaturan`; server meminta masuk ulang bila login > 15 menit; lepas bila tertaut), perangkat, Ubah/Buat sandi, Keluar, dan komponen `ZonaBahaya` (`#zona-bahaya`): form action `?/keluarSemua` (→ `/masuk`) dan `?/hapusAkun` (ketik HAPUS + sandi; akun Google saja dialihkan ke `/masuk?ulang=1&lanjut=/pengaturan#zona-bahaya` bila login > 15 menit; berhasil → `/`), jalan tanpa JS. Sesi juri (`jenis: 'demo'`): label "Salinan demo, dihapus dalam 24 jam", tanpa ubah sandi/hapus akun.

## Dipakai e2e (jangan diubah tanpa memperbarui `apps/web/e2e/akun.spec.ts`)

- Label input: "Email", "Kata sandi" (Masuk), label yang memuat "Kata sandi" (Daftar), "Kata sandi baru", "Nama lengkap".
- Tombol: "Daftar", "Masuk", "Lanjutkan dengan Google" (Daftar: "Daftar dengan Google"), "Masuk sebagai juri", "Kirim tautan", "Simpan kata sandi", "Simpan". Tautan persetujuan di Daftar: "Syarat layanan" (→ `/syarat`) dan "Kebijakan privasi" (→ `/privasi`). Tombol Google hanya tampil bila `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` terisi.
- Formulir masuk `action="?/masuk"` dan formulir juri `data-juri`, masing-masing dengan `input[name="turnstile"]` (e2e mengisinya dengan token uji). Penanda tautan Google: elemen `[data-tautkan]`.
- Pesan sukses `role="status"`: "Tautan berlaku 30 menit", "Kata sandi baru tersimpan".
- Pesan galat `role="alert"` dengan `data-kode="<KODE>"`.
- IdP tiruan `/dev/oidc/authorize` (hanya `URUSIN_OIDC_FIXTURE=1`) bukan layar produk; jangan didesain.

Rute baru perlu didaftarkan di `perf-routes.cjs` begitu layarnya final. Kerangka dev-only belum didaftarkan.
