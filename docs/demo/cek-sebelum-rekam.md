# Cek sebelum rekam (uji terima di situs live)

Checklist ini dijalankan perekam di `https://urusinai.web.id` **sebelum** take video
([`video-demo.md`](video-demo.md)) dan sebelum gladi pitch ([`pitch-7-menit.md`](pitch-7-menit.md)). Tujuannya
memastikan setiap layar yang akan tampil benar-benar bekerja di deployment yang akan disubmit. Jalankan
berurutan; tandai `[x]` bila hasil sesuai harapan. Bila satu langkah gagal, pakai kolom "Bila gagal". Jangan
merekam sebelum semua langkah wajib hijau.

**Aturan saat uji:**

- Pakai data uji, bukan data asli: Data Diri dari akun juri (sintetis) dan dokumen uji berupa gambar atau PDF
  polos tanpa NIK, wajah, atau nomor HP.
- Jangan mengirim apa pun ke situs pemerintah. Browser Pendamping belum live (lihat README "Status"), jadi
  checklist ini tidak mengujinya.
- Catat jam, perangkat, dan hasil di catatan gladi. Hasil gagal dilaporkan ke lead beserta tangkapan layar
  (tanpa PII).

## 0. Persiapan

| #   | Langkah                                                    | Hasil yang diharapkan                                                                                  | Bila gagal                                                                                                                        |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Buka `https://urusinai.web.id/api/ready`                   | `{"ready":true,...}`                                                                                   | Situs belum siap: lapor ke ops-sec, jangan rekam.                                                                                 |
| 0.2 | Buka `https://urusinai.web.id/api/kemampuan`               | `llm: "llm"`, `kapabilitas.ai: "normal"`, `rag: "siap"`, `fitur.pencarianHybrid` dan `rerank` = `true` | `ai: "hemat"`/`"tanpa_ai"` = kuota harian menipis/habis; `rag: "tidak_siap"` = korpus belum dimuat. Lapor ke lead, tunda rekaman. |
| 0.3 | Di respons yang sama, cek `versi.sha7`                     | Sama dengan 7 karakter awal hash commit yang akan disubmit                                             | Field `versi` tidak ada atau sha berbeda = deployment belum diperbarui. Minta redeploy, jangan rekam.                             |
| 0.4 | Jendela privat (incognito) baru, zoom 100%, tanpa ekstensi | Landing tampil dengan Peristiwa Hidup                                                                  | Bersihkan cache situs, coba peramban lain.                                                                                        |

## 1. Masuk sebagai juri

| #   | Langkah                                                     | Hasil yang diharapkan                                                                             | Bila gagal                                                                                                                                 |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | `/masuk` → **Masuk sebagai juri**                           | Pemeriksaan Turnstile lolos (kadang perlu centang), lalu masuk ke aplikasi sebagai juri           | "Selesaikan pemeriksaan keamanan dulu…": centang lalu klik lagi. "Pemeriksaan keamanan belum tersedia…": Turnstile mati, lapor ke ops-sec. |
| 1.2 | Buka **Data diri**                                          | Data sintetis sudah terisi ("Disimpan di brankas Urusin"); nilai tersembunyi sampai **Tampilkan** | Kosong: salinan demo gagal dibuat, keluar lalu ulangi 1.1.                                                                                 |
| 1.3 | Ulangi 1.1 lebih dari 3× dari jaringan yang sama (opsional) | "Akun juri dari jaringan ini sudah dibuat 3 kali hari ini. Coba lagi besok."                      | Bila muncul saat gladi sungguhan: pindah ke hotspot lain atau pakai **Coba tanpa daftar**.                                                 |
| 1.4 | **Pengaturan**                                              | Tidak ada Zona bahaya (sesi juri); baris kecil `v<sha7>` di bawah, bertaut ke commit GitHub       | Zona bahaya muncul untuk juri = bug, lapor. `v<sha7>` tidak ada = lihat 0.3.                                                               |

## 2. Jawaban bersumber

| #   | Langkah                                                                                                                   | Hasil yang diharapkan                                                                                    | Bila gagal                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2.1 | Peristiwa **Kelahiran** → ketik: _"Anak saya lahir minggu lalu di Surabaya, KTP saya Wonogiri. Mau urus akta kelahiran."_ | Jawaban mengalir (stream). Daerah dikenali sebagai Wonogiri.                                             | Tidak ada jawaban > 30 detik: muat ulang. Masih gagal: cek 0.2, lapor ke lead.        |
| 2.2 | Perhatikan kartu jawaban                                                                                                  | Setiap klaim persyaratan punya nomor kutipan [n]; chip sumber menampilkan domain resmi dan "Diperiksa …" | Jawaban tanpa kutipan: catat pertanyaannya, lapor ke lead (bug grounding).            |
| 2.3 | Klik satu chip sumber                                                                                                     | Situs resmi terbuka di tab baru; bila didukung peramban, kalimat yang dikutip tersorot (Text Fragment)   | Situs sumber down: catat, pilih chip lain. Bukan blocker selama chip lain terbuka.    |
| 2.4 | Tab **Rencana**                                                                                                           | "Kemungkinan memenuhi syarat" atau "Perlu konfirmasi" dengan daftar yang perlu dipastikan                | Tab kosong: tunggu agen selesai; bila tetap kosong, ulangi 2.1 di urusan baru.        |
| 2.5 | Tanya hal di luar adminduk, mis. _"Berapa harga tiket kereta ke Wonogiri?"_                                               | Urusin tidak mengarang: menyatakan di luar cakupan dan mengarahkan ke kanal resmi                        | Bila mengarang jawaban: catat, jangan pakai pertanyaan itu di rekaman, lapor ke lead. |

## 3. Brankas: unggah dan hapus dokumen

| #   | Langkah                                                                                                                    | Hasil yang diharapkan                                                   | Bila gagal                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 3.1 | **Dokumen** → **Tambah dokumen** → pilih jenis, beri nama (mis. "Dokumen uji"), pilih berkas uji (JPG/PNG/WebP/PDF ≤ 9 MB) | "Mengunggah…", lalu dokumen muncul di "Dokumen Anda" dengan status Siap | "Maksimal 10 berkas. Hapus berkas lama dulu.": hapus yang lama. "Penyimpanan sedang penuh…": lapor ke ops-sec. |
| 3.2 | **Lihat** pada dokumen tadi                                                                                                | Berkas terbuka                                                          | Diminta masuk ulang = perilaku benar di perangkat baru; masuk ulang lalu ulangi.                               |
| 3.3 | **Hapus** → konfirmasi "Hapus Dokumen uji dari brankas?"                                                                   | Pesan "Dokumen uji dihapus."; dokumen hilang dari daftar                | Masih tampil setelah muat ulang: lapor (bug hapus).                                                            |

## 4. Akun Google

Pakai akun Google milik perekam sendiri. Untuk uji kesiapan juri, minimal sekali pakai akun Google **di luar tim**.

| #   | Langkah                                                                   | Hasil yang diharapkan                                                                                  | Bila gagal                                                                                                                                                         |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | Keluar dari sesi juri. `/masuk` → **Lanjutkan dengan Google**             | Layar persetujuan Google, lalu kembali ke Urusin dalam keadaan masuk (akun baru dibuat bila belum ada) | "redirect_uri_mismatch" atau layar "app not verified/testing": konfigurasi Google OAuth, lapor ke lead. Sementara pakai juri atau tanpa daftar.                    |
| 4.2 | Bila email sudah terdaftar dengan sandi                                   | Diminta membuktikan sandi sebelum Google ditautkan                                                     | Perilaku benar; masukkan sandi akun itu.                                                                                                                           |
| 4.3 | **Data diri** → isi satu kolom (mis. Nama lengkap) → **Simpan data diri** | "Data diri tersimpan."                                                                                 | Galat simpan: muat ulang, ulangi; bila tetap gagal, lapor.                                                                                                         |
| 4.4 | **Urusanku**                                                              | Halaman "Urusan keluarga Anda" tampil tanpa galat                                                      | Galat atau halaman kosong terus: muat ulang, lalu lapor. Catatan: daftar urusan sesi tamu/juri tersimpan di peramban, jadi bisa ikut tampil di peramban yang sama. |

## 5. Zona bahaya (akun Google uji, bukan akun utama)

| #   | Langkah                                                                                                   | Hasil yang diharapkan                                                                                                        | Bila gagal                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 5.1 | **Pengaturan** → gulir ke **Zona bahaya**                                                                 | Dua tombol: "Keluar dari semua perangkat" dan "Hapus akun"                                                                   | Tidak tampil: pastikan masuk sebagai akun, bukan juri/tamu.                                           |
| 5.2 | Masuk dengan akun yang sama di perangkat kedua, lalu di perangkat pertama **Keluar dari semua perangkat** | Perangkat pertama kembali ke `/masuk`; perangkat kedua juga keluar saat dimuat ulang                                         | Perangkat kedua masih masuk: lapor (bug sesi).                                                        |
| 5.3 | Masuk lagi → **Hapus akun** → ketik selain "HAPUS"                                                        | "Konfirmasi belum sesuai. Ketik HAPUS untuk menghapus akun."                                                                 | Akun terhapus tanpa HAPUS: hentikan, lapor segera.                                                    |
| 5.4 | Ketik **HAPUS** → **Hapus akun permanen**                                                                 | Akun Google: bila masuk terakhir > 15 menit, diminta masuk ulang lalu kembali ke Zona bahaya. Setelah itu kembali ke beranda | Loop masuk ulang: lapor. Akun bersandi: kolom sandi wajib; salah sandi = "Kata sandi saat ini salah." |
| 5.5 | Masuk lagi dengan Google yang sama                                                                        | Akun baru yang kosong (Data Diri dan dokumen lama tidak ada)                                                                 | Data lama muncul = penghapusan gagal, hentikan dan lapor segera.                                      |

## 6. Penutup

| #   | Langkah                                           | Hasil yang diharapkan                                    | Bila gagal                                             |
| --- | ------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 6.1 | Buka `/api/transparansi`                          | Latensi p50/p95 dan biaya per hari, tanpa data pribadi   | Bukan blocker; sisipan ini di video bisa dilewati.     |
| 6.2 | Mode gelap OS dan layar 360 px (DevTools atau HP) | Teks terbaca, tombol ≥ 48 px, tidak ada gulir horizontal | Catat layar yang rusak dan lapor ke ui; bukan blocker. |
| 6.3 | Keluar, tutup jendela privat                      | Tidak ada sesi tersisa                                   | -                                                      |

**Lulus bila:** semua langkah 0–5 hijau (6 opsional). Langkah 4.1 dengan akun Google di luar tim wajib hijau
sebelum submission, karena juri bisa memakai Google. Catatan: email verifikasi dan atur ulang sandi masih mode
log (README "Batasan"), jadi alur daftar dengan email tidak termasuk checklist ini.

## 7. Sebelum repo dibuat Public (wajib, oleh ops-sec/lead)

Repo publik + runner self-hosted = siapa pun bisa menjalankan kode di agent-vm lewat PR dari fork. Langkah ini
wajib walaupun runner cadangan tidak pernah dipasang (cukup memastikan hasilnya nol).

| #   | Langkah                                                             | Hasil yang diharapkan       | Bila gagal                                                   |
| --- | ------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| 7.1 | `gh api repos/bynguts/urusin/actions/runners --jq .total_count`     | `0`                         | `sudo deploy/ci-runner/uninstall.sh` di agent-vm, ulangi 7.1 |
| 7.2 | `gh variable list --repo bynguts/urusin`                            | Tidak ada `URUSIN_RUNNER`   | `gh variable delete URUSIN_RUNNER --repo bynguts/urusin`     |
| 7.3 | `ssh agent-vm 'systemctl is-active urusin-ci-runner; id urusin-ci'` | `inactive` / tidak ada user | Jalankan uninstall; jangan ubah visibilitas sebelum bersih   |
| 7.4 | Token admin lokal yang membuat registration/remove token runner     | Sudah dirotasi/dicabut      | Rotasi sekarang (tidak pernah ada PAT di box)                |

Detail: [`deploy/ci-runner/README.md`](../../deploy/ci-runner/README.md).
