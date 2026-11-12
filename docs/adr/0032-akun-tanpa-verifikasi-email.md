# 0032. Akun tanpa verifikasi email; penautan Google wajib bukti sandi

- **Status:** Diterima. **Dicatat:** 2026-11-12. **Sumber:** keputusan pemilik produk. Mengganti bagian verifikasi
  email dan pra-akun di ADR 0028.

## Konteks

ADR 0028 membuat akun sandi "belum terverifikasi" sampai warga membuka tautan di email. Selama itu akun berperilaku
seperti tamu: vault satu perangkat, tanpa ingatan, dan Browser Pendamping selalu Mode Uji. Produksi tidak punya
pengirim email (Resend belum dikonfigurasi, `mailer.ditahan`), jadi tautan itu tidak pernah sampai. Akibatnya warga
yang mendaftar dengan email tidak pernah bisa memakai portal pemerintah asli. Akun yang tidak terverifikasi juga
disapu setelah 24 jam.

## Keputusan

- **Daftar = akun penuh.** `daftar` membuat akun dan langsung memulai sesi, tanpa email dan tanpa token. Hash
  sandi argon2id, kebijakan sandi, batas laju per IP dan per email, penguncian masuk, dan Turnstile masuk tetap
  sama. Tidak ada lagi perbedaan perilaku berdasarkan `email_verified_at`: setiap akun sinkron antar perangkat,
  memegang vault dan ingatannya sendiri, menerima urusan dan vault tamu saat masuk, dan membuka portal asli di
  Browser Pendamping. Tamu tetap Mode Uji, dan salinan demo juri juga tetap Mode Uji.
- **Email ganda.** Daftar dengan email yang sudah terdaftar (akun sandi atau akun Google) ditolak dengan
  `EMAIL_SUDAH_TERDAFTAR` ("Email ini sudah terdaftar. Silakan masuk."), dan akun yang ada tidak diubah sama sekali.
  Jalur daftar memang membuka status terdaftar sebuah email. Itu harga dari keputusan ini, dan dibatasi oleh batas
  laju daftar (20/jam per IP, 3/jam per email). Masuk dan lupa sandi tetap tidak membocorkannya.
- **Kolom lama.** `email_verified_at` dipertahankan dan kini berarti "akun aktif sejak". Daftar mengisinya, dan
  migrasi `0006` mengisi baris akun lama yang `NULL` dengan `created_at` serta membatalkan token `verify` yang
  masih menunggu. Kodenya tidak lagi membaca kolom ini, jadi `NULL` pun tetap akun penuh. Migrasi tetap dibuat
  supaya rollback ke kode lama tidak menyapu akun-akun itu sebagai "belum terverifikasi".
- **Halaman.** `/verifikasi-email` dan `/api/akun/verifikasi*` dihapus. Tautan lama dialihkan ke `/beranda`
  (bila sudah masuk) atau `/masuk`.
- **Lupa sandi.** Satu-satunya jalur atur ulang tetap tautan email, karena hanya itu bukti kepemilikan kotak surat.
  Bila email ditahan, formulir disembunyikan dengan pesan jujur (`ATUR_ULANG_NONAKTIF`) dan tidak ada jalur atur
  ulang lain (pertanyaan keamanan, operator, dan sejenisnya). Bila Resend aktif, alurnya berjalan seperti
  sebelumnya.

- **Tamu dan Browser Pendamping.** Tamu hanya ditawari "Setujui dan buka situs" (Mode Uji) bila portalnya punya
  situs latihan (`ORIGIN_REPLIKA_UJI`, sama dengan override worker di compose.prod.yml). Di portal lain kartu
  mengajak "Masuk / Daftar (gratis, 30 detik)" lalu kembali ke urusan yang sama (urusan dan rencana tamu pindah ke
  akun), dan server menolak sesi tamu tanpa replika dengan `PERLU_MASUK`. Juri tetap Mode Uji (panduan bila tanpa
  replika).
- **Batas urusan baru.** Warga yang masuk dihitung per akun (bawaan 30/jam). Tamu dihitung per sesi (10/jam)
  ditambah batas per IP longgar (120/jam) sebagai rem banjir, karena CGNAT, warnet, dan kantor kelurahan berbagi
  satu IP. Pesan 429 menyebut waktu tunggu dari Retry-After ("Coba lagi dalam ±N menit").

### Aturan Google (anti pembajakan)

Karena email akun sandi tidak lagi dibuktikan, siapa pun bisa mendaftar dengan email orang lain. Aturannya:

1. **Google tidak pernah mengambil alih akun yang sudah ada.** Login Google dengan email yang sama dengan akun mana
   pun yang belum menautkan `sub` itu hanya menghasilkan tiket `oauth_link_pending` (10 menit) dan
   `GOOGLE_PERLU_SANDI`. Tidak ada sesi yang dibuat, dan sandi, sesi, serta identitas akun itu tidak disentuh.
   Jalur lama "Google mengambil alih akun belum terverifikasi" dihapus. Tanpa verifikasi, akun itu bisa saja milik
   warga sah yang sudah menyimpan data, dan pengambilalihan akan menyerahkan datanya ke pemegang Google.
2. **Penautan wajib bukti sandi.** Tiket hanya dipakai setelah `masuk` dengan sandi akun itu berhasil
   (`tautkanGoogle`, akun yang sama, sekali pakai). Penautan dari Pengaturan (akun yang sedang masuk) wajib
   punya bukti kredensial ≤ 15 menit. Setiap penautan mengirim email pemberitahuan bila email aktif, dan
   "Keluar dari semua perangkat" mencabut tautan yang ditambahkan kemudian.
3. **Akun baru dari Google** tetap mewajibkan `email_verified` dari Google.

Pemegang sandi tidak pernah mendapat Google orang lain tanpa sandi, dan pemegang Google tidak pernah mendapat akun
sandi tanpa sandinya. Tidak ada jalur yang memindahkan kepemilikan, jadi identitas yang sudah ditautkan tidak
bisa "ikut berpindah" ke pihak lain.

## Konsekuensi

- Warga ber-email langsung bisa memakai portal asli, vault lintas perangkat, dan ingatan.
- **Penyerobotan email (squatting).** Orang yang mendaftar lebih dulu dengan email korban memegang akun itu, dan
  korban tidak bisa masuk dengan Google untuk email tersebut. Data korban tidak bocor karena akun itu kosong dari
  data korban. Mitigasinya: bila Resend aktif, pemilik kotak surat bisa memakai "Lupa sandi". Atur ulang mencabut
  sesi dan identitas Google lama, dan akun berpindah ke pemilik kotak surat. Aktif tidak sama dengan terbukti:
  tabel `email_terbukti` mencatat kepemilikan kotak surat yang pernah dibuktikan (tautan verifikasi lama, Google
  dengan email terverifikasi, atau tautan atur ulang). Bila atur ulang terjadi pada akun yang emailnya belum
  terbukti, urusan, vault (crypto-shred, termasuk berkas), dan ingatan pemegang lama dihancurkan DULU sebelum
  sandi berganti, lalu email dicatat terbukti. Pemilik asli tidak mewarisi data atau jebakan yang ditanam
  penyerobot. Konsekuensinya, warga yang mendaftar dengan sandi lalu lupa sandi sebelum emailnya pernah terbukti
  juga kehilangan isi akunnya. Selama email ditahan, korban tidak bisa merebut kembali email itu. Ini risiko yang
  diterima.
- Akun tidak lagi disapu otomatis. Pembersihan hanya untuk tamu (72 jam) dan salinan demo (24 jam).
- Turnstile tidak ditambahkan ke daftar. Produksi menjalankan Turnstile `nonaktif`, jadi rem pembuatan akun massal
  tetap batas laju daftar per IP dan per email: 20/jam dan 40/hari per IP. Kuota urusan akun juga punya plafon
  per IP yang longgar (600/jam), dihitung bersama batas per akun.
- Browser Pendamping portal asli punya rem per akun: satu sesi aktif per akun, maksimal 6 sesi mulai per jam per
  akun dan 30 per jam per IP. Mode Uji (tamu dan juri) tidak kena rem ini. Catatan sesi aktif dan pembatasnya
  disimpan di memori proses web. Ini cukup karena produksi menjalankan satu instance web aktif (pergantian
  blue/green). Bila suatu saat web berjalan multi-instance, rem ini harus dipindah ke penyimpanan bersama.
- Sesi akun yang aktif tetapi `urusin_sid`-nya masih memegang data tamu (misalnya vault satu perangkat akun lama
  sebelum ADR ini) digabungkan ke akun di hooks lalu sid diputar. Data akun tidak ditimpa, dan data tamu milik
  sid lain tidak tersentuh.
