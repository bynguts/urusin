# Kebijakan Privasi Urusin

Berlaku sejak 14 November 2026. Sumber teks halaman privasi aplikasi. Isinya harus sama dengan penanganan data
yang sebenarnya; rujukan teknisnya ada di [ADR 0028](adr/0028-akun-dan-login.md) (DPIA) dan
[`docs/arsitektur.md`](arsitektur.md).

## Ringkasnya

- AI Urusin **tidak pernah melihat** NIK, nomor KK, nomor HP, atau email yang Anda ketik. AI hanya melihat penanda
  seperti "NIK pemohon".
- **Gambar yang Anda lampirkan di chat dikirim ke AI untuk dibaca** (salinan yang diperkecil di perangkat Anda).
  Angka yang tampak di foto ikut terlihat oleh model pembaca gambar; model diminta tidak menyalinnya dan hasil
  bacaannya disaring dari NIK/KK/HP/email sebelum dipakai. Salinan itu tidak disimpan; aslinya tersimpan terenkripsi
  di Dokumen. PDF tidak dikirim ke AI.
- Data Diri dan dokumen Anda disimpan **terenkripsi**. Tanpa akun, data itu terhapus sendiri 72 jam setelah
  dibuat.
- Urusin **tidak pernah menekan tombol Kirim** di situs pemerintah. Anda yang memeriksa dan mengirim.
- Kami tidak menjual data, tidak memasang iklan, dan tidak memakai pelacak atau analitik pihak ketiga.

## Siapa yang mengelola data

Urusin dikembangkan dan dioperasikan oleh Tim Urusin (LOGICODIX 2026) sebagai pengendali data. Pertanyaan dan
permintaan soal data pribadi bisa dikirim lewat kontak di [`SECURITY.md`](../SECURITY.md).

## Tiga cara memakai Urusin

| Cara                   | Yang terjadi pada data Anda                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tanpa akun** (tamu)  | Data Diri dan dokumen disimpan terenkripsi di server, terikat ke peramban ini lewat cookie. Terhapus otomatis 72 jam setelah dibuat. Daftar urusan dan pengaturan tampilan disimpan di peramban ini saja. |
| **Dengan akun**        | Data Diri, dokumen, dan daftar urusan disimpan terenkripsi di server dan ikut ke perangkat lain yang Anda pakai untuk masuk. Disimpan sampai Anda menghapusnya atau menghapus akun.                       |
| **Masuk sebagai juri** | Salinan demo berisi data karangan, bukan data orang sungguhan. Terhapus 24 jam setelah dibuat dan hanya bisa diisikan ke situs latihan.                                                                   |

## Data yang kami simpan

| Data                                                                 | Untuk apa                                                  | Bentuk                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Data Diri (nama, NIK, KK, alamat, HP) dan dokumen (foto KTP/KK, PDF) | Mengisi formulir layanan atas persetujuan Anda             | Terenkripsi AES-256-GCM dengan kunci khusus per pemilik                      |
| Email dan kata sandi akun                                            | Masuk dan memulihkan akun                                  | Email polos; kata sandi hanya disimpan sebagai hash argon2id                 |
| Identitas Google (bila Anda memilih masuk dengan Google)             | Masuk                                                      | Nomor identitas akun Google, tanpa kata sandi Google                         |
| Sesi masuk                                                           | Menjaga Anda tetap masuk dan menampilkan daftar perangkat  | Waktu dan ringkasan jenis peramban; IP dan user agent lengkap tidak disimpan |
| Isi percakapan dan Jejak urusan                                      | Menjalankan urusan dan menampilkan riwayatnya kepada Anda  | Tanpa NIK, KK, HP, atau email (diganti penanda)                              |
| Sidik IP (hash)                                                      | Membatasi penyalahgunaan (kuota tamu dan juri, batas laju) | Hash satu arah, bukan alamat IP                                              |

## Browser Pendamping

Saat Urusin mengisi formulir di situs pemerintah, situs itu dibuka di peramban Chromium di server Urusin dan
layarnya ditampilkan di perangkat Anda. Situs yang hanya menerima jaringan Indonesia belum bisa dibuka dari
server itu; untuk situs seperti ini Urusin memandu Anda mengisi sendiri langkah demi langkah.

- Apa yang Anda ketik saat mengambil alih (kata sandi situs pemerintah, OTP, CAPTCHA) melewati server Urusin,
  tetapi **tidak dicatat, tidak disimpan, dan tidak dikirim ke AI**.
- Peramban itu tidak menyimpan cookie, kata sandi, atau riwayat. Sesi dihancurkan saat selesai, setelah
  15 menit, atau setelah 3 menit tanpa aktivitas. Layar tidak direkam.
- Sebelum mengisi, Anda menekan "Izinkan isi" dan melihat data apa yang akan ditulis ke situs mana. Persetujuan
  itu berlaku sekali dan hanya untuk situs tersebut.

## Pihak lain yang memproses data

| Pihak                                           | Lokasi            | Data yang diterima                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oracle Cloud (hosting)                          | Singapura         | Semua data di atas, dalam bentuk terenkripsi untuk Data Diri dan dokumen. Server ini juga menjalankan mesin pencari sumber resmi Urusin dan Browser Pendamping                                                                                                      |
| Google (bila Anda memilihnya)                   | Global            | Proses masuk dengan akun Google Anda                                                                                                                                                                                                                                |
| OpenAI (model GPT, lewat proxy model milik tim) | Di luar Indonesia | Teks percakapan, termasuk nama dan teks bebas yang Anda ketik. NIK, KK, HP, dan email diganti penanda sebelum dikirim. Gambar yang Anda lampirkan di chat atau foto yang Anda simpan di Dokumen (salinan diperkecil) untuk dibaca isinya dan diperiksa kejelasannya |

Pencarian sumber resmi (pencarian kata dan vektor) berjalan di server Urusin sendiri: pertanyaan Anda tidak
dikirim ke mesin pencari pihak lain. Urusin saat ini tidak mengirim email dan tidak memakai layanan anti-bot
pihak ketiga; bila salah satunya kelak diaktifkan, pihaknya dicantumkan di sini lebih dulu.

Pengiriman ke Google dan OpenAI adalah transfer data ke luar Indonesia (UU PDP Pasal 56). Dasarnya persetujuan
Anda.

## Cookie

Urusin hanya memakai cookie yang dibutuhkan agar aplikasi berjalan:

- `__Host-urusin_sid`: mengenali peramban ini untuk kuota dan data tamu (30 hari sejak terakhir dipakai).
- `__Host-urusin_sid_segar`: penanda harian agar cookie di atas diperpanjang paling sering sekali sehari (1 hari).
- `__Host-urusin_akun`: sesi masuk akun (berakhir setelah 7 hari tidak dipakai, paling lama 30 hari).
- `__Host-urusin_oauth` dan `__Host-urusin_tautkan`: sementara, selama proses masuk atau menautkan Google.
- `urusin_terakhir`: urusan terakhir yang Anda buka di peramban ini (30 hari).

## Berapa lama data disimpan

| Data                                   | Lama disimpan                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data tanpa akun (tamu)                 | 72 jam sejak dibuat, aktivitas tidak memperpanjang                                                                                                                                                                                                                                                                        |
| Salinan juri                           | 24 jam sejak dibuat                                                                                                                                                                                                                                                                                                       |
| Akun yang emailnya belum dipastikan    | 24 jam sejak dibuat, bila tidak ada tautan verifikasi yang masih berlaku                                                                                                                                                                                                                                                  |
| Akun dan isinya                        | Sampai Anda menghapusnya                                                                                                                                                                                                                                                                                                  |
| Sesi, token email, dan tiket sementara | Dibersihkan setiap jam setelah kedaluwarsa                                                                                                                                                                                                                                                                                |
| Cadangan basis data                    | Dibuat tiap 6 jam dan disimpan 3 hari di server yang sama (`deploy/backup.sh`). Bila salinan di luar server (restic) diaktifkan operator: 14 cadangan harian dan 8 mingguan. Data Diri dan dokumen di dalamnya terenkripsi; percakapan dan Jejak (tanpa NIK, KK, HP, email) ikut tersimpan sampai cadangannya kedaluwarsa |

Menghapus data atau akun menghancurkan kunci enkripsinya (_crypto-shred_), sehingga Data Diri dan dokumen di
cadangan pun tidak bisa dibuka lagi. Percakapan dan Jejak urusan yang dihapus masih ada di cadangan sampai
cadangan itu kedaluwarsa (3 hari, atau sampai 8 minggu bila salinan di luar server aktif).

## Hak Anda (UU No. 27 Tahun 2022)

- **Melihat dan mengunduh** Data Diri dan dokumen Anda: halaman Data Diri dan Dokumen.
- **Memperbaiki** Data Diri: halaman Data Diri.
- **Menghapus** dokumen satu per satu: halaman Dokumen. Menghapus seluruh akun beserta isinya: Pengaturan →
  Zona bahaya → Hapus akun (ketik HAPUS dan kata sandi; akun Google diminta masuk ulang bila login terakhir
  lebih dari 15 menit lalu).
- **Keluar dari semua perangkat:** Pengaturan → Zona bahaya.
- **Menarik persetujuan:** hapus akun, lepas tautan Google di Pengaturan, atau berhenti memakai cara tanpa akun
  (data terhapus sendiri dalam 72 jam).

## Keamanan

Data Diri dan dokumen dienkripsi dengan kunci khusus per pemilik. Kunci itu dibungkus kunci server Urusin, jadi
server (dan operatornya) secara teknis bisa membuka brankas; kebocoran basis data saja tidak cukup untuk
membacanya, tetapi kebocoran basis data bersama kunci server cukup. Membuka brankas di perangkat baru meminta Anda
masuk ulang. Kata sandi akun disimpan sebagai hash argon2id dan login dilindungi penguncian bertahap. Laporan
celah keamanan diterima lewat [`SECURITY.md`](../SECURITY.md).

## Perubahan kebijakan

Perubahan dicatat di riwayat berkas ini di repositori publik Urusin, dengan tanggal berlaku di bagian atas.
