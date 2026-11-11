# 0030. Browser Pendamping generik untuk portal tanpa adapter

- **Status:** Diterima. **Dicatat:** 2026-11-10. **Sumber:** keputusan tim.

## Konteks

Adapter tulisan tangan hanya ada untuk Telunjuk Sakti dan beberapa alur baca. Warga dari wilayah lain hanya mendapat mode dipandu, padahal banyak Disdukcapil punya formulir web.

## Keputusan

- Navigator generik berjalan di web app: amati, rencana per halaman dalam JSON ketat, lalu validasi. Tangannya adalah worker Pendamping. Adapter tetap menjadi jalur cepat.
- Model hanya melihat pengamatan yang sudah diredaksi dan hanya boleh menjawab dengan `ref`, placeholder vault, atau indeks opsi. Tidak ada URL, teks bebas, tombol keyboard, atau JS.
- Tombol yang mungkin mengirim, membayar, menghapus, atau mendaftar selalu dikerjakan warga. Ini ditegakkan oleh klasifikator deterministik yang dijalankan ulang di halaman saat klik (default tolak; submitter asli selalu `kirim`), gerbang tulis jaringan di worker (permintaan non-GET dan navigasi tak terduga dari aksi AI dibatalkan sebelum terkirim), dan kunci halaman akhir.
- Navigasi hanya ke host persis wilayah itu di registry; edge tetap menegakkan union registry.
- Nilai vault hanya mengalir untuk pasangan (kolom, placeholder) yang disetujui warga per halaman.
- Mode Uji hanya membuka replika.
- Worker berjaringan Indonesia (laptop tim lewat Tailscale) hanya dipakai sesuai catatan registry yang terukur
  oleh probe nyata. `id-only` (IP pusat data ditolak keras) wajib worker itu; tanpa worker sehat, urusan
  dipandu sejak kartu rencana. `id-utama` (mis. interstitial Turnstile dari IP pusat data) mendahulukannya,
  tetapi tetap jalan di worker server bila laptop mati atau penuh. Portal tanpa catatan tidak diutamakan ke
  laptop, supaya nilai Data Diri warga tidak ikut ke memori perangkat tim tanpa alasan terukur.
- Semua langkah dicatat di rantai audit tanpa nilai.
- ADR 0025 tetap berlaku: tanpa penyelesai CAPTCHA dan tanpa penyamaran.

## Alternatif

- Otomasi bebas dengan JS buatan model: ditolak.
- pi-agent-core: ditolak untuk tenggat ini. Ia hanya menambah lapis hook di proses web, padahal gerbang yang menentukan harus ada di worker; dependensinya berat (88 paket, 88 MB) dan rilisnya cepat berubah.
- Hanya mode dipandu: tidak cukup.

## Konsekuensi

- Wizard yang menyimpan data per halaman lewat POST butuh satu ketukan warga per halaman.
- Situs yang hanya lewat aplikasi atau WhatsApp tetap dipandu.
- Host baru harus melalui recon dulu.
- Risiko diterima: biaya LLM Navigator masuk meter kuota yang sama dengan agen (token/biaya per urusan + biaya
  harian global; habis = serah templat `kuota`), tetapi belum ada batas per akun atau per juri. Akun yang membuat
  banyak urusan dibatasi oleh batas biaya harian global dan rate limit HTTP per IP/sesi saja. Tinjau ulang bila
  pemakaian nyata menunjukkan satu akun menghabiskan anggaran harian.
- Sisa risiko diterima (gerbang tulis): CAPTCHA tak terlihat (mis. `grecaptcha.execute`, Turnstile) yang dipicu
  klik AI lalu memanggil callback pengiriman bisa lolos bila callback itu jalan paling lama 3 detik
  (`JENDELA_WARGA_MS`) setelah warga mengetuk di dalam iframe tantangan. Selama ambil alih, ketukan di iframe
  tantangan belum dibedakan dari ketukan di halaman, kecuali saat verifikasi situs (`pantau`) aktif. Penanda
  tautan pembuka (`tautanPembuka`, aturan `K7_NEG_NAMA_TAUTAN`) tidak mengubah ini: tautan itu tetap diketuk
  warga, bukan AI. Tinjau ulang bila ada portal nyata yang memakai CAPTCHA tak terlihat pada tombol non-final.
- Tulis tertunda dari aksi AI (timer/retry, review N2/N4): tulis non-GET yang diblokir menandai dokumen "kotor"
  sampai navigasi bingkai utama berikutnya ter-commit. Dokumen kotor tidak lagi dapat jendela XHR isi; blokir
  saat AI diam sesudah AI bertindak di dokumen itu = muat ulang lewat GET (sekali per URL) lalu serah ke warga;
  ketukan warga hanya membuka jendela tulis bila mengenai kotak sorot, tombol kirim, atau tautan; kontrol isian
  (radio, centang, pilihan, label, summary), area kosong, kolom ketik, dan ketikan tidak (re-review N4, PoC A).
  Sisa risiko diterima: (1) percobaan tulis tertunda PERTAMA yang kebetulan jatuh di dalam jendela isi
  (≤ `JENDELA_ISI_MS`) sebelum ada blokir apa pun tetap lolos; (2) di dokumen kotor yang tidak dimuat ulang,
  ketukan warga pada tombol kirim atau tautan membuka jendela 3 detik yang juga dipakai timer halaman (warga
  memang sedang bermaksud mengirim/berpindah). Dipertimbangkan: atribusi lewat stack inisiator CDP (`Network.requestWillBeSent`
  `initiator.stack`) untuk membedakan tulis dari handler ketukan warga dan dari timer; belum dipakai karena
  stack async tidak andal lintas `setTimeout`/promise dan menambah lapis CDP Network di samping rute Playwright.
- Sisa risiko diterima (redirect halaman sendiri, probe 3674): saat AI diam atau sesudah navigasi AI ke `navKe`,
  GET bingkai utama ke URL lain (redirect JS/meta halaman) lolos bila jalur/kuerinya tidak berbunyi tulis
  (`jalurTulis`, aturan jalur yang sama dengan tautan `navigasi` K8). Risikonya setara klik `navigasi` yang
  sudah diterima: GET ke jalur bersih di host allowlist. Batasnya: di dokumen kotor (N2) dan di dokumen yang
  pengamatan terakhirnya halaman akhir, redirect itu tidak pernah lolos (mode ketat gerbang, juga saat warga
  memegang kendali tanpa mengetuk); dokumen baru yang ter-commit mengakhiri mode ketat.
  Contoh konkret yang tetap lolos (re-review gelombang-4, PoC G): di dokumen BERSIH (belum ada tulis yang
  diblokir) yang bukan halaman akhir, AI mengklik tombol "Lanjut" `type=button`; handler halaman menunda
  `location.href = '/permohonan/12/go?langkah=akhir&ok=1'` 1,5 detik. Saat itu AI sudah diam (`ai_diam`), jalur
  dan kuerinya tidak berbunyi tulis, jadi GET bingkai utama itu terkirim (penghitung PoC = 1) dan sesi tetap di
  mode AI. Bila server memperlakukan GET seperti itu sebagai pengiriman, satu langkah terjadi tanpa ketukan warga.
  Varian dengan kata tulis di kueri (PoC G2, form GET `?aksi=final`) tetap diblokir. Mitigasinya bukan di gerbang:
  portal yang mengubah keadaan lewat GET melanggar semantik HTTP, recon host baru memeriksanya, dan halaman akhir
  tetap mengunci serah. Tinjau ulang bila recon menemukan portal nyata yang mengirim permohonan lewat GET.
- Tujuan `buka_tautan` (re-review TOCTOU, PoC E3): URL absolut yang ditampilkan ke warga disimpan saat giliran
  `ketuk_tautan` dikirim; href yang dibaca ulang saat warga menekan Buka harus sama persis (host, jalur, kueri),
  selain itu tidak dibuka dan giliran tetap di warga. Host aset umum (CDN/fon, `EGRESS_ASET_UMUM`) hanya untuk
  subresource: tidak pernah menjadi dokumen bingkai mana pun atau tujuan navigasi AI, tautan, pop-up.

## Rujukan berkas utama

- packages/executor/src/runner-ops.ts (228-268), interpreter.ts (84-91, 326)
- apps/pendamping/src/browser.ts (252-313 route; 383-480 wire/driver), sessions.ts (61-84, 232-246)
- apps/web/src/lib/server/vault/resolver.ts (27-36), apps/web/src/lib/server/pendamping/izinkan.ts
- packages/core/src/registry.ts (24-187), packages/harness/src/rencana.ts (44), guarded-llm.ts (29)
- packages/contracts/src/pendamping.ts (184-200, 283-372)
- recon/dukcapil-kota-verify.md dan recon/portal-dukcapil-nasional.md (repo riset logicodix, di luar repo ini)
