# Kebijakan Privasi Urusin

Berlaku sejak 10 November 2026. Sumber teks halaman privasi aplikasi. Isinya harus sama dengan penanganan data
yang sebenarnya; rujukan teknisnya ada di [ADR 0028](adr/0028-akun-dan-login.md) (DPIA) dan
[`docs/arsitektur.md`](arsitektur.md).

## Ringkasnya

- AI Urusin **tidak pernah melihat** NIK, nomor KK, nomor HP, atau email Anda. AI hanya melihat penanda seperti
  "NIK pemohon".
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
layarnya ditampilkan di perangkat Anda.

- Apa yang Anda ketik saat mengambil alih (kata sandi situs pemerintah, OTP, CAPTCHA) melewati server Urusin,
  tetapi **tidak dicatat, tidak disimpan, dan tidak dikirim ke AI**.
- Peramban itu tidak menyimpan cookie, kata sandi, atau riwayat. Sesi dihancurkan saat selesai, setelah
  15 menit, atau setelah 3 menit tanpa aktivitas. Layar tidak direkam.
- Sebelum mengisi, Anda menekan "Izinkan isi" dan melihat data apa yang akan ditulis ke situs mana. Persetujuan
  itu berlaku sekali dan hanya untuk situs tersebut.

## Pihak lain yang memproses data

| Pihak                            | Lokasi            | Data yang diterima                                                                                                   |
| -------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Oracle Cloud (hosting)           | Singapura         | Semua data di atas, dalam bentuk terenkripsi untuk Data Diri dan dokumen                                             |
| Resend (pengiriman email)        | Amerika Serikat   | Alamat email Anda dan isi email verifikasi atau atur ulang sandi. Saat ini belum aktif: belum ada email yang dikirim |
| Google (bila Anda memilihnya)    | Global            | Proses masuk dengan akun Google Anda                                                                                 |
| Penyedia model AI                | Di luar Indonesia | Teks percakapan yang sudah tanpa NIK, KK, HP, atau email                                                             |
| Jina AI (pencarian sumber resmi) | Di luar Indonesia | Kalimat pertanyaan yang sudah tanpa data pribadi                                                                     |
| Cloudflare Turnstile             | Global            | Data teknis peramban untuk membedakan manusia dan bot, hanya di tombol juri dan setelah beberapa kali gagal masuk    |

Pengiriman ke Resend, Google, penyedia AI, Jina, dan Cloudflare adalah transfer data ke luar Indonesia (UU PDP
Pasal 56). Dasarnya persetujuan Anda. Bila tidak ingin email Anda melintas batas, pakai masuk dengan Google atau
cara tanpa akun.

## Cookie

Urusin hanya memakai cookie yang dibutuhkan agar aplikasi berjalan:

- `__Host-urusin_sid`: mengenali peramban ini untuk kuota dan data tamu (30 hari).
- `__Host-urusin_akun`: sesi masuk akun (berakhir setelah 7 hari tidak dipakai, paling lama 30 hari).
- `__Host-urusin_oauth` dan `__Host-urusin_tautkan`: sementara, selama proses masuk atau menautkan Google.
- `urusin_terakhir`: urusan terakhir yang Anda buka di peramban ini (30 hari).

## Berapa lama data disimpan

| Data                                   | Lama disimpan                                                              |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Data tanpa akun (tamu)                 | 72 jam sejak dibuat, aktivitas tidak memperpanjang                         |
| Salinan juri                           | 24 jam sejak dibuat                                                        |
| Akun yang emailnya belum dipastikan    | 24 jam sejak dibuat, bila tidak ada tautan verifikasi yang masih berlaku   |
| Akun dan isinya                        | Sampai Anda menghapusnya                                                   |
| Sesi, token email, dan tiket sementara | Dibersihkan setiap jam setelah kedaluwarsa                                 |
| Cadangan basis data                    | Berisi data terenkripsi; tidak bisa dibuka lagi setelah kunci Anda dihapus |

Menghapus data atau akun menghancurkan kunci enkripsinya (_crypto-shred_), sehingga salinan di cadangan pun
tidak bisa dibuka lagi.

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

Data Diri dan dokumen dienkripsi dengan kunci khusus per pemilik. Membuka brankas di perangkat baru meminta Anda
masuk ulang. Kata sandi akun disimpan sebagai hash argon2id dan login dilindungi penguncian bertahap. Laporan
celah keamanan diterima lewat [`SECURITY.md`](../SECURITY.md).

## Perubahan kebijakan

Perubahan dicatat di riwayat berkas ini di repositori publik Urusin, dengan tanggal berlaku di bagian atas.
