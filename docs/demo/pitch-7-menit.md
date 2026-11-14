# Outline pitch final 7 menit

Final offline 2026-11-29: slot 15 menit = **7 menit pitch + demo live di localhost**, lalu 3 menit Q&A. Outline
ini memperbarui rencana §8.1–§8.3 ke produk yang benar-benar ada. Skrip video submission ada di
[`video-demo.md`](video-demo.md).

**Pembagian peran:** Muqorrobin (A) presenter dan jawaban teknis; Rafi (B) memegang HP demo, membuka cerita,
dan menjawab pertanyaan lapangan/PSF dan UI.

## Pengaturan panggung

- **Laptop presenter:** stack Urusin lengkap di `http://localhost` lewat
  `bash scripts/demo-final.sh up --ghcr SHA` (SHA = commit submission, image yang sama), Chromium Pendamping
  headed. Instance lokal ini adalah **Mode Uji**: semua portal resmi dipetakan ke replika lokal (banner "Situs
  uji — bukan situs pemerintah").
  Preflight `bash scripts/demo-final.sh cek` harus SIAP DEMO; detail panggung di [`alur-juri.md`](alur-juri.md).
- **HP Android nyata** dan laptop bergabung ke **hotspot HP anggota kedua** (bukan Wi-Fi venue). Proyektor
  menampilkan laptop: mirror HP lewat scrcpy (USB).
- **Situs asli:** dibuka dari instance publik `urusinai.web.id` di HP (alur baca, tanpa kirim).
- Tab siap: `urusinai.web.id`, `localhost` (Mode Uji), `/api/transparansi`, repo GitHub.

## Alur 7 menit

| Waktu     | Isi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Slide / layar                  | Rubrik       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------ |
| 0:00–0:45 | **Hook (B):** "Saya kuliah di Surabaya, KTP saya Wonogiri. Kalau keluarga saya punya bayi di sini, akta kelahirannya tetap diurus lewat Wonogiri." Tiga angka: **~4 juta migran risen** (BPS SUPAS 2025), **18,52%** rumah tangga punya komputer (BPS 2024), dan Telunjuk Sakti: **42 layanan**, login HP + sandi + CAPTCHA gambar, unggah foto berkas satu per satu ≤ 9 MB.                                                                                                                                   | Slide: 3 angka + sumber        | PSF          |
| 0:45–1:15 | **Solusi (A):** lapisan agen di atas ~27 ribu aplikasi pemerintah, mulai dari peristiwa hidup, bukan nama formulir. **Tiga prinsip:** warga memegang tombol (login, CAPTCHA, Kirim); AI tidak melihat data pribadi mentah; setiap persyaratan bersumber.                                                                                                                                                                                                                                                       | Slide: 3 prinsip               | PSF / Etika  |
| 1:15–1:50 | **Live 1, cerita → rencana bersumber (HP, `urusinai.web.id`):** "Masuk sebagai juri" → ketik cerita kelahiran → jawaban stream dengan nomor kutipan → chip sumber "Diperiksa …" → tab Rencana ("Kemungkinan memenuhi syarat" / "Perlu konfirmasi").                                                                                                                                                                                                                                                            | HP via scrcpy                  | Tech / UX    |
| 1:50–2:15 | **Live 2, dokumen:** tab Dokumen "Dokumen untuk urusan ini"; Data Diri sintetis dari akun juri tersimpan di vault terenkripsi.                                                                                                                                                                                                                                                                                                                                                                                 | HP                             | UX / Etika   |
| 2:15–2:45 | **Live 3, situs asli:** Pendamping membuka Telunjuk Sakti asli dari instance publik. Bila tantangan Cloudflare muncul, B **mencentang kotaknya sendiri** di layar Pendamping ("Selesaikan pemeriksaan keamanan situs"). Berhenti di halaman login: "Kami tidak login ke akun warga Wonogiri di panggung."                                                                                                                                                                                                      | HP                             | Tech / Etika |
| 2:45–4:00 | **Live 4, Mode Uji (diumumkan lisan + banner):** pindah ke laptop `localhost`. "Setujui dan buka situs" → Ambil alih: login + CAPTCHA diketik B → lembar **"Izinkan AI mengisi?"** → **Izinkan isi** → AI mengisi dan mengunggah berkas (progres "n dari N") → "Periksa isian, lalu tekan Kirim pengajuan": **B menekan Kirim** → "Nomor permohonan" → "Browser ditutup. Login dan cookie ikut dihapus."                                                                                                       | Laptop (dua panel)             | Tech / UX    |
| 4:00–5:15 | **Angka (A), maksimal 3 per slide:** lihat tabel "Angka" di bawah.                                                                                                                                                                                                                                                                                                                                                                                                                                             | 3 slide angka                  | Tech / SE    |
| 5:15–6:15 | **Etika & keamanan (A):** lethal trifecta dan cara memutusnya; pengungkapan Browser Pendamping (kredensial melintas server, tidak disimpan atau dicatat, layar tidak ke AI, sesi dihancurkan, alternatif "Saya isi sendiri"); tanpa penyamaran; egress hanya ke situs resmi; vault + Keluar dan hapus akun + UU PDP.                                                                                                                                                                                           | Slide: diagram 3 kaki trifecta | Etika        |
| 6:15–6:50 | **Dampak & keberlanjutan (B):** 514 kab/kota dikenali (Kepmendagri 300.2.2-2138/2025) → kanal resmi; persyaratan bersumber untuk kota berkorpus; dua tier: semi (AI mengisi, warga Kirim; kirim asli tervalidasi di Wonogiri, portal terdaftar lain lewat Navigator generik) dan dipandu (Medan dan Semarang hanya menerima jaringan Indonesia), plus cek status baca-saja (Surabaya). Skala = tambah worker Pendamping; biaya dan latensi terbuka di `/api/transparansi`. Adopsi lewat pendamping desa/Pemda. | Slide: peta cakupan            | PSF          |
| 6:50–7:00 | **Penutup:** slide pemetaan rubrik + QR ke `urusinai.web.id`. "Urusan beres, warga tetap pegang kendali."                                                                                                                                                                                                                                                                                                                                                                                                      | Slide rubrik + QR              | Semua        |

## Angka (hanya yang terverifikasi)

**Slide A, kualitas AI** (`pnpm rag:eval-agent`, held-out 14 dalam cakupan + 6 di luar cakupan):

- Recall@3 **78,6% → 100%** (BM25 saja → hybrid kata kunci + vektor; angka eval 2026-11-08 memakai embedding Jina, produksi memakai embedding self-hosted di server Urusin).
- Abstain presisi/recall **100% / 100%** (BM25 saja: 100% / 66,7%): pertanyaan di luar cakupan dijawab "arahkan
  ke kanal resmi", bukan dikarang.
- Jalur agen held-out: R@1 **71,4%**, MRR@4 **0,845**.

**Slide B, keamanan terukur:**

- Suite prompt injection: **10 kasus, 5 kanal** (RAG, output tool, DOM, OCR, berkas warga) dengan model yang
  sengaja patuh → keberhasilan serangan untuk aksi tulis/final **0%**, karena yang memblokir policy gate.
- Model tidak pernah melihat NIK, KK, nomor HP, atau email: diredaksi `[DATA]` sebelum LLM dan embedding.
- Tujuan pengisian terkunci: "Izinkan isi" sekali pakai, terikat ke pemilik, daftar isian, dan origin; origin
  hanya portal resmi terdaftar atau situs uji.

**Slide C, rekayasa:**

- **> 1.200 tes unit** di 10 paket + e2e Playwright; coverage berambang per paket (`registry` 100% baris,
  `egress`/`llm` 95%, `akun`/`rag` 90%).
- Lighthouse CI mobile: performance ≥ 0,90, aksesibilitas ≥ 0,95, total ≤ 250 KiB; JS awal ≤ 70 KB gzip.
- Browser Pendamping: ~213 MB idle, +170–210 MB per sesi; image multi-arch dideploy berdasarkan digest.

## Poin etika (5:15–6:15)

1. **Lethal trifecta diputus:** data pribadi hanya placeholder di LLM; teks luar dibungkus spotlight + datamark;
   aksi tulis butuh "Izinkan isi" di luar layar situs; Kirim final hanya oleh warga.
2. **Kredensial melintas server, dan kami mengatakannya sebelum warga memilih.** Tidak disimpan, tidak dicatat,
   AI tidak melihat layar saat warga mengetik, sesi dan profil Chromium dihancurkan. Alternatif: "Saya isi
   sendiri" (dipandu).
3. **Tanpa penyamaran:** Chromium headed biasa, tanpa stealth, tanpa jasa pemecah CAPTCHA, tanpa proxy
   residensial. Tantangan Cloudflare dicentang manusia. Situs yang menolak → dipandu.
4. **Data warga:** vault AES-256-GCM dengan kunci per akun; "Hapus akun" di Keluar dan hapus akun menghancurkan kuncinya.
   Sandi argon2id. Akun juri terhapus 24 jam. Pemroses dan transfer lintas batas (Oracle Singapura,
   OpenAI AS) diungkap di kebijakan privasi (UU PDP).
5. **Jawaban jujur bila server dibobol:** bocor database saja → isi vault tetap terenkripsi; database **dan**
   kunci server bocor bersamaan → vault terbaca. Itu harga data yang ikut dari HP ke laptop, dan kami
   menyatakannya.

## Q&A inti (3 menit)

| Pertanyaan                              | Jawaban inti                                                                                                                                                                                                                                                             | Penjawab |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Ini bot yang melanggar ToS / UU ITE?    | User agent di sesi warga sendiri. Login, CAPTCHA, dan Kirim selalu warga. Tanpa penyamaran dan tanpa API privat.                                                                                                                                                         | A        |
| Password saya lewat server kalian?      | Ya, dan diungkap sebelum memilih. Hanya di memori sesi; tanpa disk, log, atau rekaman; sesi dihancurkan; kode terbuka. Tidak mau → "Saya isi sendiri".                                                                                                                   | A        |
| NIK atau wajah dikirim ke LLM?          | Tidak. Placeholder + redaksi `[DATA]`; pengisian formulir tidak memakai model sama sekali (program adapter deterministik, nilai dari vault).                                                                                                                             | A        |
| Kalau situs memblokir server kalian?    | Telunjuk Sakti lolos dengan klik manusia. Situs khusus IP Indonesia dirutekan ke worker Pendamping di laptop tim; bila tetap ditolak, dipandu.                                                                                                                           | A        |
| Kenapa juri pakai Mode Uji untuk kirim? | Alasan etis: juri bukan warga Wonogiri, dan permohonan palsu membebani petugas Dukcapil sungguhan. Situs asli tetap bisa dicoba untuk alur baca.                                                                                                                         | B        |
| Hanya Wonogiri?                         | 514 kab/kota dikenali dan diarahkan ke kanal resmi. Kirim asli baru divalidasi di Wonogiri; Surabaya cek status; Semarang dan Medan dipandu; portal terdaftar lain semi lewat Navigator generik (belum divalidasi kirim); tanpa portal dipandu. Ditulis jujur di README. | B        |
| Kenapa perlu akun?                      | Agar Data Diri dan dokumen ikut dari HP ke laptop. Akun wajib; juri bisa langsung mencoba lewat "Masuk sebagai juri".                                                                                                                                                    | B        |
| Bagaimana tahu jawabannya benar?        | Setiap persyaratan berkutipan ke situs resmi + tanggal pemeriksaan; tanpa sumber → kanal resmi; abstain 100/100 di held-out.                                                                                                                                             | A        |
| Urusin memutuskan saya berhak?          | Tidak. Keluarannya "kemungkinan memenuhi syarat" atau "perlu konfirmasi"; keputusan di petugas.                                                                                                                                                                          | B        |
| Kode buatan AI aman?                    | Claude Code dipakai dan diungkap di README. Setiap perubahan direview, dites di CI, dan di-commit anggota dari akunnya sendiri; security review independen.                                                                                                              | A        |

## Pemetaan rubrik (slide 6:50)

| Kriteria                  | Bukti di produk                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem-Solution Fit (25) | Cerita perantau nyata; angka BPS terverifikasi; recon Telunjuk Sakti (42 layanan); Peristiwa Hidup; 514 kab/kota → kanal resmi; HP bisa mengisi lewat Browser Pendamping         |
| Tech Innovation (25)      | Browser Pendamping (screencast CDP + ambil alih); RAG hybrid kata kunci + vektor (recall@3 100%, abstain 100/100); gateway LLM OpenAI-compatible + capability probe; policy gate |
| Software Engineering (25) | Monorepo bertipe, kontrak zod, > 1.200 tes + e2e, coverage berambang, Lighthouse CI, image multi-arch by digest, audit berantai hash, ADR, commit konvensional                   |
| UI/UX (15)                | Desain tim di pen.dev, mobile-first 360 px + dua panel laptop, "Giliran Anda" yang jelas, Bacakan, juri satu klik, JS ≤ 70 KB                                                    |
| Ethics & Security (10)    | Kirim selalu oleh warga, "Izinkan isi" terikat origin, injection ASR 0% tulis, vault per akun + crypto-shred, Keluar dan hapus akun, kebijakan privasi UU PDP, tanpa penyamaran  |

## Rencana gagal (diumumkan sebelumnya)

- **Internet/hotspot mati:** hotspot cadangan dari operator berbeda. Bila tetap mati: Live 3 dilewati, Live 4
  tetap berjalan di localhost; LLM tidak tersedia → `bash scripts/demo-final.sh offline` (DemoProvider, ±1 menit), alur Wonogiri tetap utuh karena adapternya tanpa model.
- **Situs asli down atau menolak:** tunjukkan pesan produk "Situs menolak Browser Pendamping" → "Buka
  panduan"; itu fitur, bukan kegagalan.
- **HP gagal tersambung:** DevTools device mode 360 px di laptop.
- **Laptop gagal:** laptop cadangan yang sudah menarik image dengan digest yang sama.
- **Semua gagal:** putar video submission.

## Gladi

- 6× gladi penuh ≤ 6:45, durasi dicatat; minimal 1 gladi skenario "semua gagal".
- Satu gladi di hotspot yang sama dengan HP yang sama.
- Bank Q&A lengkap (40 pertanyaan) dibagi: A teknis, B lapangan/PSF/UI.
