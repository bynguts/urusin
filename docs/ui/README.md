# Panduan UI Urusin (pemilik: Rafi, @rafilajhh)

Rafi memegang UI sepenuhnya: desain di pen.dev (Pencil) sekaligus implementasi di `apps/web`. Agen tidak menulis UI. Agen menyediakan kontrak data bertipe, fixture, dan pagar CI. Dokumen ini berisi semua yang perlu diketahui sebelum mulai.

## 1. Mulai sekarang

```sh
git clone git@github.com:bynguts/urusin.git && cd urusin
git config user.name "Rafi Mahardika"
git config user.email "rafimahardika96@gmail.com"
pnpm install                          # memasang hook commit (wajib)
pnpm --filter @urusin/web dev         # http://localhost:5173
```

Kerja di branch sendiri (misalnya `feat/ui-beranda`). Commit kecil dengan awalan `feat(web):`, `fix(web):`, atau `style(web):`.

Larangan:

- force push, rebase, squash, atau amend;
- trailer `Co-Authored-By` (hook akan menolaknya).

## 2. Status kesiapan

| Bagian                                                                                                             | Status                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| App SvelteKit 3 + Svelte 5 + Tailwind v4 di `apps/web`                                                             | ✅ siap. Rute yang ada: `/`, `/pair`, `/peristiwa`, `/api/*`                                                                                        |
| Desain di pen.dev (token, komponen, layar)                                                                         | ✅ bisa dimulai sekarang, tanpa ketergantungan                                                                                                      |
| Data Peristiwa Hidup, kab/kota, sumber resmi                                                                       | ✅ ada di `@urusin/registry` dan `data/`                                                                                                            |
| Kontrak `@urusin/contracts` (event SSE, endpoint, store, fixture JSON per layar × state, endpoint dev pemutar SSE) | 🔄 sedang dibangun agen harness. Kontrak layar ★ dibekukan **sebelum Rafi mulai membangun layar ★**; setelah itu hanya boleh ditambah, tidak diubah |
| Backend chat/agen (harness)                                                                                        | 🔄 sedang dibangun. Sebelum siap, pakai fixture                                                                                                     |

Selama kontrak belum masuk `main`, bangun layar dengan data contoh. Setelah masuk, ganti dengan import dari `@urusin/contracts` beserta fixture-nya.

## 3. Pagar otomatis di CI (PR gagal bila dilanggar)

- JS awal per rute ≤ **70 KB gzip**. Saat ini 38 KB.
- Total transfer ≤ **250 KB**. TBT ≤ 200 ms. LCP ≤ 2,5 s.
- Lighthouse mobile: performance ≥ **0,90**, aksesibilitas ≥ **0,95**.
- Rute baru harus didaftarkan di `perf-routes.cjs` supaya ikut diperiksa.

## 4. Layar (★ = dipakai di demo Take-1, kerjakan lebih dulu)

| #     | Layar                       | Rute                                 | Isi utama                                                                                                                                                                          |
| ----- | --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★1    | Beranda                     | `/`                                  | 4 kartu Peristiwa Hidup (Kelahiran, Kematian, Perkawinan, Pindah), cari + mikrofon, urusan berjalan, lencana "Data di perangkat ini"                                               |
| ★2    | Rencana peristiwa           | `/peristiwa/[slug]`                  | Pilih kab/kota. Langkah online dan offline dengan kutipan sumber + tanggal verifikasi. Kelayakan "mungkin memenuhi" / "perlu konfirmasi". Tier ditulis jujur. Tetap jalan tanpa JS |
| ★3    | Urusan / chat               | `/urusan/[id]`                       | Chat, kartu rencana, checklist, jawaban bersumber, progres. Laptop: 2 panel                                                                                                        |
| ★4    | Data Diri                   | `/data-diri`                         | Satu pertanyaan per halaman, `autocomplete`, `inputmode="numeric"`                                                                                                                 |
| ★5    | Berkas                      | `/urusan/[id]/berkas`                | Bingkai kamera, masking terlihat, hasil cek hijau/kuning/merah dengan alasan dalam bahasa awam                                                                                     |
| ★6    | Konfirmasi                  | —                                    | Ringkasan yang akan diisi (tersamar), situs + instansi tujuan, jumlah berkas, tombol "Setujui"                                                                                     |
| ★7    | Bagian Anda                 | —                                    | Login/CAPTCHA/"Selesai" dilakukan warga sendiri. "Lanjutkan dari langkah X"                                                                                                        |
| ★8    | Lacak                       | `/lacak`                             | Status semua urusan: menunggu siapa, langkah berikutnya, tenggat                                                                                                                   |
| ★9    | Sambung                     | `/sambung` (laptop) + `/pindai` (HP) | **Laptop menampilkan QR**, HP memindai, ada kode 6 digit cadangan, hitung mundur 10 menit                                                                                          |
| ★10   | Pair ekstensi               | `/pair`                              | Panduan 3 langkah. State hubungkan / berhasil / gagal. Bila dibuka di HP, jelaskan bahwa ekstensi butuh laptop                                                                     |
| 11    | Dompet                      | `/dompet`                            | Daftar dokumen, masa simpan, hapus                                                                                                                                                 |
| 12    | Jejak                       | `/jejak/[id]`                        | Timeline, rantai hijau/merah, "Lihat apa yang dilihat AI"                                                                                                                          |
| 13    | Transparansi                | `/transparansi`                      | Pemroses data, retensi, latensi, biaya per hari, umur sumber tertua                                                                                                                |
| 14    | Coba (juri)                 | `/coba`                              | 3 skenario 60 detik + tautan video                                                                                                                                                 |
| 15    | Pengaturan                  | `/pengaturan`                        | Ukuran huruf, Bacakan otomatis, hemat data, hapus semua data                                                                                                                       |
| 16–18 | Privasi, Aksesibilitas, MCP | `/privasi`, `/aksesibilitas`, `/mcp` | —                                                                                                                                                                                  |
| 19–20 | Offline, error              | `/offline`, 404/500                  | —                                                                                                                                                                                  |

Ekstensi: popup (pairing, Mode Uji, status), overlay persetujuan (18 px, tanpa kata "write"), banner Mode Uji.

## 5. State yang wajib didesain di setiap layar yang relevan

- **Proses:** memuat (skeleton, bukan spinner kosong), kosong (ajakan + 1 tombol), progres ("Mencari di 3 sumber resmi…").
- **Jawaban:**
  - Bersumber: chip [1] → panel kutipan yang disorot + tautan resmi yang langsung menggulir ke kalimatnya.
  - Hand-off: "Belum ada sumber resmi untuk ini" + kanal resmi.
- **Masalah:**
  - Error: apa yang terjadi + yang bisa dilakukan + "Coba lagi".
  - Offline.
  - Sesi habis, tanpa input hilang.
  - Situs pemerintah berubah → mode dipandu.
- **Kemampuan terbatas:** AI hemat / AI berhenti, tanpa vision (checklist manual), izin kamera/mikrofon ditolak, HP tanpa ekstensi, iOS belum dipasang ke layar utama.
- **Ekstensi:** belum dipasang, belum dipasangkan, menunggu warga, sedang mengisi, selesai.
- **Mode:** Mode Uji (banner permanen), Mode Presentasi (area sensitif disamarkan).

## 6. Aturan desain untuk lansia dan HP murah

- **Teks:** dasar **18 px**, minimum 16 px, line-height 1,5–1,6. Tanpa label huruf kapital semua. Judul maksimal 3 tingkat.
- **Sentuhan:** target **48 px**, jarak antar-target ≥ 8 px.
- **Bahasa Sederhana:**
  - Kalimat ≤ 15 kata, kata kerja di depan ("Foto KK Anda").
  - Satu aksi utama per layar.
  - Istilah resmi dijelaskan saat pertama muncul.
  - Hindari kata submit, upload, write, error.
- **Warna:** status selalu ikon + teks, tidak hanya warna. Kontras teks ≥ 4,5:1, komponen ≥ 3:1.
- **WCAG 2.2 AA:**
  - 2.4.11: fokus tidak tertutup header atau nav bawah.
  - 2.5.8: ukuran target.
  - 3.3.7: data tidak diminta dua kali.
  - 3.3.8: CAPTCHA dikerjakan warga.
  - 3.2.6: "Bantuan" selalu di tempat yang sama.
  - Hormati `prefers-reduced-motion`.
- **Sinyal kepercayaan:** domain resmi tampil, sumber + tanggal verifikasi, "Keputusan ada di petugas", tombol kirim final selalu milik warga.
- **Suara dulu:** mikrofon besar di beranda. Tombol **Bacakan** (`speechSynthesis` suara id-ID, gratis, di perangkat) di setiap jawaban.
- **Tata letak:** HP satu kolom + nav bawah 4 menu (Beranda, Urusanku, Dompet, Akun). Laptop dua panel.

## 7. Stack UI (ringan tapi cantik)

| Bagian                  | Pakai                                                                                                           | Jangan           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| Styling                 | Tailwind v4, token dari pen.dev di `@theme` (`src/routes/layout.css`)                                           | CSS-in-JS        |
| Dialog, lembar, tooltip | `<dialog>` native + Popover API. `bits-ui` hanya bila perlu (combobox kab/kota), import per komponen            | UI kit utuh      |
| Ikon                    | `@lucide/svelte`, import per ikon, selalu dengan label                                                          | Icon font        |
| Font                    | Font sistem. Opsional untuk judul: Plus Jakarta Sans (Tokotype, OFL) woff2 subset, 1 file, `font-display: swap` | > 2 file font    |
| Animasi                 | Transisi Svelte, CSS, View Transitions via `onNavigate`                                                         | GSAP, Lottie     |
| Berat                   | `qrcode`, `pdf-lib`, kamera: lazy, hanya di rute yang butuh                                                     | Import di layout |

Urutan kerja di pen.dev:

1. Token (warna, tipografi, spasi, radius).
2. 15 komponen inti dengan semua state-nya: Button, Card, Steps, CitationChip, StatusBadge, ConsentSheet, EmptyState, dan seterusnya.
3. Layar ★ di 360 px.
4. Versi 1280 px.
5. Versi 768 px.
6. Sisa layar.

Pakai teks Indonesia yang panjang dan realistis, karena nama instansi bisa panjang.

## 8. Momen "wow" yang tetap ringan

- Kutipan yang menggulir langsung ke kalimat di situs resmi (Text Fragment `#:~:text=`). URL-nya disediakan kontrak.
- "Lihat apa yang dilihat AI": teks asli dan versi placeholder berdampingan.
- Jejak berubah merah bila data dimanipulasi.
- Animasi centang saat berkas lolos cek, maksimal 300 ms, cukup CSS.

Detail lengkap ada di audit best-case, bagian "Revisi dimensi 6" (`.omc/plans/bestcase-audit.md` di folder logicodix, bisa dikirim A).
