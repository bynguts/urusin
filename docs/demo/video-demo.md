# Skrip video demo (YouTube, 3–5 menit)

Skrip ini untuk video wajib submission LOGICODIX 2026. Target durasi **4:30**, batas keras 3:00–5:00. Sumber:
rencana §5.4 dan §8, recon `telunjuksakti.md`, riset `problem-evidence-id.md`, dan teks UI yang ada di kode.
Pitch final 7 menit ada di [`pitch-7-menit.md`](pitch-7-menit.md).

## Aturan rekaman (mengikat, risiko diskualifikasi)

1. **Satu rekaman utuh dan berkesinambungan** dari aplikasi yang berjalan di `https://urusinai.web.id`, dari
   **commit final** yang sama dengan hash submission dan image yang ter-deploy. Tanpa slide, mockup, simulasi,
   atau rekayasa. Penyuntingan hanya memotong waktu tunggu dan menambah narasi, teks, atau musik.
2. **Urutan wajib guidebook:** identitas → alur input-proses-output → bukti klaim → integrasi AI/API.
3. **Tanpa fixture di video** (rencana §5.4 prinsip 3). Situs uji `fixtures.urusinai.web.id` dan Mode Uji
   **tidak** tampil di video; tempatnya di pitch final (diumumkan). Alasannya: juri bisa menilai fixture sebagai
   simulasi.
4. **Kirim hanya oleh pemilik urusan asli.** Perekam memakai akun dan data miliknya sendiri, mengetik password
   dan CAPTCHA sendiri, dan menekan tombol final sendiri. Bila tidak ada kebutuhan asli, rekaman berhenti di
   lembar "Izinkan AI mengisi?" (Varian H di bawah).
5. **Nol PII di frame.** Data Diri yang ditampilkan memakai akun juri (data sintetis). Halaman login situs asli
   memperlihatkan nomor HP perekam; tutup dengan kotak teks saat menyunting (lihat "Butir terbuka") lalu review
   frame demi frame oleh anggota lain sebelum upload.
6. Upload sebagai **Unlisted**. Caption menyebut model agen yang aktif (`pythia` lewat proxy OpenAI-compatible
   tim) dan Jina untuk embedding/rerank.

## Persiapan sebelum menekan rekam

- Laptop 1280 px (tampilan dua panel) **atau** HP Android 360 px yang di-mirror dengan scrcpy. Pilih satu untuk
  seluruh rekaman.
- Browser bersih tanpa ekstensi, zoom 100%, notifikasi OS mati, tab lain tertutup.
- Akun perekam di Urusin sudah terverifikasi; Data Diri dan dokumen perekam **tidak** dibuka di layar.
- Akun Telunjuk Sakti milik perekam (login HP + password + CAPTCHA gambar, profil selfie sudah lengkap).
- Cek stempel versi: `https://urusinai.web.id/api/kemampuan` → `versi.sha7` = 7 karakter awal hash submission
  (atau baris `v<sha7>` di bawah Pengaturan, bertaut ke commit di GitHub).
- Cek cepat: `https://urusinai.web.id/api/ready` → `{"ready":true}`, lalu satu pertanyaan uji di chat.

## Shot list (target 4:30)

| #   | Waktu     | Layar                                                                                                       | Aksi di layar                                                                                                                                                                  | Narasi (VO)                                                                                                                                                                                                                                                                      | Bukti / rubrik        |
| --- | --------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | 0:00–0:15 | Landing `urusinai.web.id` → Pengaturan                                                                      | Landing tampil. Buka **Pengaturan**, gulir ke bawah: baris kecil `v<sha7>`; klik → halaman commit di GitHub (hash sama), kembali ke landing.                                   | "Kami Tim Urusin: Muqorrobin dan Rafi. Ini Urusin, pendamping AI untuk mengurus dokumen kependudukan. Yang Anda lihat berjalan live di urusinai.web.id, dari commit final ini."                                                                                                  | Identitas, provenance |
| 2   | 0:15–0:40 | Landing (tetap)                                                                                             | Gulir pelan ke bagian Peristiwa Hidup. Teks layar: tiga angka masalah.                                                                                                         | "Sekitar 4 juta orang pindah domisili dalam lima tahun terakhir (BPS SUPAS 2025), tetapi urusan dokumennya tetap di daerah asal. Hanya 18,52% rumah tangga punya komputer (BPS 2024), padahal layanan online daerah dibuat untuk layar besar."                                   | PSF                   |
| 3   | 0:40–0:55 | Landing → `/masuk`                                                                                          | Klik "Masuk", masuk dengan akun perekam (atau Google).                                                                                                                         | "Contohnya Telunjuk Sakti di Wonogiri: 42 layanan online, login dengan nomor HP, kata sandi, dan CAPTCHA gambar, lalu foto berkas diunggah satu per satu, maksimal 9 MB. Akta Kelahiran saja butuh enam syarat, termasuk formulir F2.01."                                        | PSF (recon nyata)     |
| 4   | 0:55–1:30 | Beranda → urusan baru (chat)                                                                                | Ketik cerita: _"Anak saya lahir minggu lalu di Surabaya, tapi KTP saya Wonogiri. Mau urus akta kelahiran."_ Tunggu jawaban stream.                                             | "Saya cukup bercerita dengan bahasa sehari-hari. Urusin mengenali peristiwanya, kelahiran, dan daerahnya dari KTP saya, Wonogiri, bukan dari tempat saya tinggal."                                                                                                               | Input → proses, AI    |
| 5   | 1:30–2:00 | Kartu jawaban + tab Sumber                                                                                  | Arahkan kursor ke nomor kutipan [1] dan chip sumber ("Diperiksa …"). Buka tab **Rencana**: "Kemungkinan memenuhi syarat" / "Perlu konfirmasi".                                 | "Setiap kalimat persyaratan punya kutipan ke situs resmi dan tanggal kami memeriksanya. Kalau sumbernya tidak ada, Urusin tidak mengarang; ia mengarahkan ke kanal resmi. Urusin juga tidak memutuskan Anda berhak; yang memutuskan petugas Dukcapil."                           | Grounding, Etika      |
| 6   | 2:00–2:20 | Tab **Dokumen** (kartu "Dokumen untuk urusan ini")                                                          | Tunjukkan daftar "Perlu disiapkan" / "Semua siap". Jangan buka isi dokumen.                                                                                                    | "Dokumen yang diminta situs resmi muncul sebagai daftar. Data Diri dan dokumen tersimpan di brankas terenkripsi per akun, jadi bisa dilanjutkan dari HP atau laptop."                                                                                                            | Output, vault         |
| 7   | 2:20–2:35 | Kartu "Periksa sebelum AI mengisi"                                                                          | Tunjukkan domain resmi + chip "Situs resmi" + catatan kuning. Klik **Setujui dan buka situs**.                                                                                 | "Sebelum apa pun dibuka, Urusin menunjukkan situs tujuan dan aturannya: kata sandi tidak disimpan, AI hanya mengisi dan mengunggah, dan tombol Kirim tetap saya yang tekan."                                                                                                     | Etika, transparansi   |
| 8   | 2:35–2:55 | Browser Pendamping: "Selesaikan pemeriksaan keamanan situs"                                                 | Siaran situs asli Telunjuk Sakti. Bila tantangan Cloudflare muncul, perekam **mencentang kotaknya sendiri**. (Bila tidak muncul, katakan saja.)                                | "Ini Browser Pendamping: Chromium biasa yang berjalan di server kami, layarnya disiarkan ke sini. Situs ini dilindungi Cloudflare. Kami tidak memakai penyamaran atau jasa pemecah CAPTCHA; kotak keamanannya saya centang sendiri."                                             | Tech, Etika           |
| 9   | 2:55–3:20 | Pendamping: "Masuk akun di situs resmi"                                                                     | Chip "Giliran Anda". Perekam mengetik nomor HP, kata sandi, dan CAPTCHA sendiri lewat **Ambil alih**, lalu "Kembalikan ke AI".                                                 | "Login, OTP, dan CAPTCHA selalu giliran saya. Saat saya mengetik, AI berhenti, dan ketikan saya tidak dibaca AI dan tidak dicatat."                                                                                                                                              | Etika (kredensial)    |
| 10  | 3:20–3:45 | Lembar **"Izinkan AI mengisi?"**                                                                            | Tunjukkan chip Data diri dan Berkas yang akan dipakai. **Varian K:** klik **Izinkan isi**. **Varian H:** klik **Saya isi sendiri**.                                            | K: "Sebelum AI mengisi, saya melihat persis data dan berkas yang akan dipakai, hanya untuk sesi ini." · H: "Kami berhenti di sini karena tidak ada kebutuhan asli. Mengirim permohonan palsu akan membebani petugas Dukcapil sungguhan."                                         | Etika, consent        |
| 11  | 3:45–4:05 | K: Pendamping "AI sedang mengisi" → "Periksa isian, lalu tekan Kirim pengajuan" · H: kartu rencana          | K: progres "n dari N", unggahan berjalan; perekam menekan tombol final situs (di Telunjuk Sakti namanya **Selesai**); "Nomor permohonan" tampil. H: tunjukkan langkah dipandu. | K: "AI mengunggah berkas satu per satu. AI dikunci agar tidak bisa menekan Kirim; tombol final saya yang tekan. Nomor permohonan tersimpan di urusan saya." · H: "Pengiriman lengkap kami uji otomatis di setiap commit, dan Anda bisa mencobanya di Mode Uji."                  | Output nyata          |
| 12  | 4:05–4:15 | K: "Pengajuan terkirim" + "Browser ditutup. Login dan cookie ikut dihapus." · H: Hentikan → "Sesi berakhir" | Tunjukkan pesan penutupan sesi.                                                                                                                                                | "Setelah selesai, browser di server dihancurkan bersama login dan cookie-nya."                                                                                                                                                                                                   | Etika (sesi dihapus)  |
| 13  | 4:15–4:30 | `/masuk` (jendela privat) → **Masuk sebagai juri** → Pengaturan                                             | Tunjukkan tombol "Masuk sebagai juri" dan "Coba tanpa daftar". Buka Pengaturan, tunjukkan **Keluar dan hapus akun** sekilas.                                                   | "Juri bisa mencoba tanpa mendaftar: satu klik, data sintetis, terhapus otomatis. Akun warga bisa dihapus kapan saja dari Keluar dan hapus akun, dan kunci datanya ikut dihancurkan, sesuai UU PDP. Kodenya terbuka di GitHub. Urusin: urusan beres, warga tetap pegang kendali." | UU PDP, penutup       |

Bila waktu tersisa (≤ 5:00), sisipkan setelah shot 13: buka `https://urusinai.web.id/api/transparansi` (latensi
p50/p95 dan biaya per hari, tanpa PII), narasi: "Angka latensi dan biaya kami terbuka."

## Varian dan aturan pilih

- **Varian K (kirim asli):** dipakai hanya bila perekam punya kebutuhan asli untuk layanan yang dibuka
  (rencana §5.4 Take-1/Varian A2). Urusan di shot 4 diganti dengan cerita asli perekam; struktur shot tetap.
  Persetujuan tertulis perekam dicatat di `docs/rc1-checklist.md`.
- **Varian H (henti di gate):** dipakai bila tidak ada kebutuhan asli (rencana §5.4 Varian A3). Tanpa tulisan
  apa pun ke situs pemerintah dan tanpa fixture. Durasi shot 11–12 dipendekkan; sisa waktu dipakai untuk
  `/api/transparansi`.
- **Situs asli down atau menolak Pendamping** saat rekaman: Urusin menampilkan "Situs menolak Browser
  Pendamping" lalu **Buka panduan**. Itu perilaku produk yang sah: rekam apa adanya dan narasikan jujur, jangan
  mengganti dengan fixture.

## Angka yang boleh diucapkan (terverifikasi)

| Angka                                                                      | Sumber                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| ~4 juta migran risen; 25,8 juta migran seumur hidup                        | BPS, SUPAS 2025 (rilis 30 Jun 2026)              |
| 18,52% rumah tangga punya komputer                                         | BPS, Statistik Telekomunikasi Indonesia 2024     |
| Aktivasi IKD baru 8,29% dari wajib KTP-el                                  | Ditjen Dukcapil, kinerja 2025 (via RMOL)         |
| ~27 ribu aplikasi pemerintah                                               | Presiden Jokowi, 27 Mei 2024 (setkab.go.id)      |
| Telunjuk Sakti: 42 layanan, login HP + sandi + CAPTCHA, unggah ≤ 9 MB/file | Recon tim `recon/telunjuksakti.md`               |
| Akta Kelahiran (id 23): 6 syarat termasuk F2.01                            | Recon tim `recon/telunjuksakti-persyaratan.json` |

**Jangan diucapkan:** "adminduk keluhan tertinggi Ombudsman", "91% warga …", angka survei atau usabilitas yang
belum ada datanya, MCP/Inspector, `/coba`, anti-phishing, atau Mode Presentasi (belum ada di produk).

## Checklist sebelum upload

- [ ] Durasi 3:00–5:00; satu rekaman tanpa potongan selain jeda tunggu.
- [ ] Hash commit di shot 1 = hash submission = image yang ter-deploy.
- [ ] Review frame demi frame oleh anggota lain: tidak ada NIK, nomor HP, email, wajah, atau isi dokumen.
- [ ] Tidak ada fixture, `fixtures.urusinai.web.id`, atau Mode Uji di frame mana pun.
- [ ] Caption: model agen + provider, Jina embedding/rerank, tautan repo dan `urusinai.web.id`.
- [ ] YouTube Unlisted; tautan dicoba dari jendela privat.

## Butir terbuka (di luar dokumen ini)

- **Mode Presentasi tidak dibangun** (keputusan lead; hanya preferensi `modePresentasi` tanpa pemakai). Nomor HP
  perekam di halaman login Telunjuk Sakti ditutup kotak teks saat menyunting.
- **Mode Uji untuk juri** saat ini hanya saklar deployment (`PENDAMPING_ORIGIN_OVERRIDES`), belum per akun juri.
