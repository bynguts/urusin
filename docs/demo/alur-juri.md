# Alur juri: Browser Pendamping di Mode Uji (skrip klik untuk pitch)

Skrip klik demi klik untuk memperagakan alur penuh Browser Pendamping di depan juri, dari "Masuk sebagai juri"
sampai nomor permohonan. Semua angka waktu diambil dari **run 9** di `https://urusinai.web.id` (versi `1ff607d`,
9 Nov 2026 16:48 UTC, layar 390 px), yang berhasil sampai nomor permohonan `FX-REG-0002`. Persetujuan sampai
Kirim memakan waktu **28 detik**.

Yang terbuka di sini adalah **replika uji** `fixtures.urusinai.web.id` dengan chip **Mode uji** di bilah atas,
bukan situs pemerintah. Data yang diisi berasal dari salinan demo juri (sintetis). Jangan memakai alur ini di
video submission (lihat aturan 3 di [`video-demo.md`](video-demo.md)); tempatnya di pitch
([`pitch-7-menit.md`](pitch-7-menit.md)), dan pembawa acara mengumumkan bahwa ini replika.

## Persiapan (sebelum naik panggung)

- Buka `https://urusinai.web.id/api/kemampuan`. `versi.sha7` harus sama dengan commit yang dipresentasikan dan
  `kapabilitas.ai` = `normal`.
- Laptop 1280–1440 px, zoom 100%, jendela privat tanpa ekstensi. Laptop lebih aman daripada HP untuk panggung:
  siaran situs tampil besar di kolom kiri dan panel Rencana terlihat di kanan.
- Satu jaringan hanya boleh membuat **3 salinan juri per hari**. Gladi memakai satu, panggung memakai satu,
  sisakan satu cadangan. Sesi juri berlaku 24 jam, jadi gladi pagi bisa dipakai lagi siang hari (buat urusan
  baru untuk tiap peragaan).
- Kredensial replika tercetak di halaman login replika: **HP `08000000001`**, **kode CAPTCHA `DEV123`**.

## Langkah dan waktu

Kolom "Waktu" adalah durasi langkah itu di run 9; kolom "Total" adalah jam log run 9 dihitung dari klik
**Mulai urusan ini**. Total run 9 memuat jeda skrip QA (±15 detik menunggu sebelum klik), jadi peragaan
manual yang lancar sedikit lebih cepat.

| #   | Yang diklik atau diketik                                                                                            | Yang tampil                                                                                                         | Waktu   | Total |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| 1   | `/masuk` → **Masuk sebagai juri** (centang Turnstile bila diminta)                                                  | Masuk ke **Beranda** sebagai "Salinan demo juri"                                                                    | ±6 dtk  | –     |
| 2   | Beranda → kartu **Kelahiran** → pastikan **Kabupaten Wonogiri** → **Mulai urusan ini**                              | Halaman urusan "Akta kelahiran"; pesan "Saya ingin mengurus kelahiran…" terkirim otomatis                           | ±2 dtk  | 0:00  |
| 3   | (tunggu)                                                                                                            | "Memahami kebutuhan Anda…" → "Mencari sumber resmi…" → jawaban bersumber [1][2] + kartu **Rencana · 3 langkah**     | 34 dtk  | 0:34  |
| 4   | **Setujui rencana**                                                                                                 | Kartu **Setujui dan buka situs** (ringkasan isian + chip Situs resmi)                                               | ≤11 dtk | 0:45  |
| 5   | **Setujui dan buka situs**                                                                                          | Bilah atas `fixtures.urusinai.web.id` · **Mode uji** · Menyiapkan                                                   | 2 dtk   | 0:47  |
| 6   | Lembar **Izinkan AI mengisi?** → **Izinkan isi**                                                                    | Chip "AI sedang mengisi"; AI membuka halaman login dan mengisi Nomor HP                                             | <1 dtk  | 0:52  |
| 7   | Banner **Giliran Anda · Masuk akun di situs resmi**. Ketuk kolom **Nomor HP** di siaran, hapus, ketik `08000000001` | Nomor HP berubah di siaran (ketikan tidak dibaca AI)                                                                | ±4 dtk  | 0:56  |
| 8   | Ketuk kolom **Masukkan kode diatas**, ketik `DEV123`                                                                | Kode tampil di kolom                                                                                                | ±3 dtk  | 0:59  |
| 9   | Ketuk tombol **Masuk** di siaran (tombol yang disorot)                                                              | AI lanjut: membuka formulir, mengunggah KK, KTP, dan surat keterangan lahir (3 berkas), lalu berhenti sebelum kirim | 1 dtk   | 1:04  |
| 10  | Banner **Periksa isian, lalu tekan Kirim pengajuan**. Periksa isian di siaran                                       | "Formulir terisi · AI menunggu Anda · 11 dari 11"; AI dikunci dari tombol kirim                                     | –       | –     |
| 11  | Ketuk tombol akhir yang disorot di siaran (di replika berlabel **Selesai**)                                         | Hasil **berhasil**; nomor permohonan **`FX-REG-0002`** (nomor berikutnya berbeda)                                   | 9 dtk   | 1:13  |

Ringkas: dari **Setujui dan buka situs** sampai Kirim **28 detik** di run 9, termasuk ±10 detik warga
mengetik dan memeriksa. Dari **Mulai urusan ini** sampai nomor permohonan **1 menit 13 detik**. Sisakan
1 menit cadangan di pitch untuk jawaban AI yang lebih lambat.

## Kalimat narasi singkat per langkah

- Langkah 3: "Urusin mencari aturan resmi Disdukcapil Wonogiri; setiap syarat punya nomor sumber."
- Langkah 6: "Sebelum AI mengisi, warga melihat data apa yang dikirim ke situs mana, lalu mengizinkan."
- Langkah 7–9: "Login dan CAPTCHA selalu diketik warga sendiri. Yang diketik di sini tidak dibaca AI."
- Langkah 11: "Tombol kirim akhir hanya bisa ditekan warga. AI dikunci di kode, bukan sekadar dilarang."

## Bila ada yang meleset

| Gejala                                                                       | Tindakan                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Jawaban AI lebih dari 60 detik                                               | Muat ulang halaman urusan; bila tetap diam, mulai urusan baru dari Beranda.                                       |
| "Browser Pendamping belum tersedia" atau "Situs ini hanya bisa dibuka dari…" | Deployment belum lengkap. Lanjutkan narasi lewat panel Rencana (mode dipandu); laporkan ke ops-sec.               |
| "HP atau kode CAPTCHA salah" di siaran                                       | Nomor HP belum diganti ke `08000000001`. Ketuk kolom HP, hapus, ketik ulang, lalu ulangi CAPTCHA dan Masuk.       |
| Lembar "Dijeda · Mau lanjut atau batalkan?" setelah Kirim                    | Perilaku yang sedang diperbaiki. Nomor permohonan sudah tercatat; tunjukkan hasilnya di siaran, jangan Batalkan.  |
| "Sesi berakhir · Terlalu lama tidak aktif"                                   | Sesi diam lebih dari 3 menit. Tekan **Mulai lagi** atau mulai urusan baru; jangan berhenti lama di giliran warga. |

## Catatan dari run 9 (untuk tim)

- Run 9 dijalankan otomatis oleh skrip QA dengan klik dan ketikan seperti warga; tiap ketukan dan tombol
  terkirim ke peramban pendamping lewat WebSocket dan diterima (log `pointer`, `key`, `text`).
- Saat run 9 masih ada tiga perilaku yang sedang diperbaiki tim pendamping: (1) teks giliran login menyebut
  "kata sandi" padahal replika meminta Nomor HP + CAPTCHA, (2) AI mengisi Nomor HP salinan juri sehingga warga
  harus menggantinya, (3) setelah Kirim muncul lembar "Dijeda" dan kartu Selesai baru tampil saat sesi ditutup.
  Perbarui tabel di atas begitu perbaikannya live.
- Di HP 390 px siaran situs terlalu kecil sampai perbaikan `e06905f` (area siaran 85dvh) live. Untuk panggung
  pakai laptop.
