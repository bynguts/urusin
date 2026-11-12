# 0034. Peta portal daerah aktif: rute per layanan, prasyarat akun, petunjuk Navigator

- **Status:** Diterima. **Dicatat:** 2026-11-12. **Sumber:** keputusan tim (lanjutan ADR 0030 dan 0033).

## Konteks

ADR 0033 menjamin Browser Pendamping di 10 daerah, tetapi registry hanya tahu "portal web ada". Pemetaan baca-saja
2026-11-12 (HTML publik, bundle JS, manual PDF resmi; tanpa login dan tanpa kirim) menunjukkan:

- Sebagian layanan tidak ada online di portal daerahnya: KTP-el di Si D'nOK Semarang (TPDK kecamatan), pindah di
  SIAPEL Malang, KTP-el baru di Sobat Dukcapil Tangerang, KTP-el selain hilang dan KIA selain pemula di SIRANCAK Padang.
  Membuka Pendamping untuk sel itu pasti berakhir buntu.
- Beberapa akun hanya bisa dibuat warga sendiri di luar sesi: SIRANCAK (swafoto kamera langsung, OTP WhatsApp terbalik,
  email Gmail, verifikasi admin), Tangerang LIVE (aplikasi), Si D'nOK (sandi lewat WA/email, profil wajib lengkap),
  SIAPEL (aktivasi email).
- Navigator meraba menu: tautan langsung Depok 404, formulir di tab "Pendaftaran", nice-select/Select2, select AJAX
  bertingkat, datepicker digit saja, SweetAlert, tanda tangan canvas.
- Registry salah untuk Bandar Lampung: COKELAT `/pendaftaran` tidak bisa dikirim warga; kanal warga adalah Permen
  Manis 2.0 (`/pelayanan/auth`, email + sandi).

## Keputusan

- `PETA_PORTAL` di `@urusin/core` (`peta-portal.ts`) adalah data tepercaya per kode wilayah × 5 layanan (`akta_lahir`,
  `kk`, `pindah`, `kia`, `ktp_el`): `online`, penimpa per varian (`baru`, `hilang`, `datang`, ...), `offline` (alasan +
  alternatif konkret), rute/jalur menu, jalur awal sesi, prasyarat akun, jebakan, kolom, berkas, dan `blokirAset`.
  Wilayah tanpa entri = belum dipetakan, perilaku lama.
- `rutePendamping` (harness): sel/varian offline di daerah aktif = `dipandu` dengan `sebab: 'offline_portal'`, sebelum
  adapter/Navigator dipertimbangkan. Kartu rencana menaruh langkah `jalur-resmi` (kantor/TPDK/kanal lain) di depan dan
  tidak melabeli langkah apa pun "online"; persetujuan tidak menerbitkan `execution_request`.
- Varian diambil dari pesan warga (`varianDisebut`, kata kunci `VARIAN_LAYANAN`, hanya bila tepat satu). Kartu,
  catatan state, tier, dan persetujuan memakai masukan yang sama (`urusanRute`).
- Prasyarat akun = langkah `akun-portal` PERTAMA di kartu, sebelum Pendamping, dengan langkah konkret. `perangkat:
'ponsel'` menyatakan langkah itu tidak bisa dikerjakan di Browser Pendamping.
- Jalur awal sesi (`params.jalur`) dari peta: halaman masuk/formulir layanan (mis. Malang langsung ke `create`,
  Bandar Lampung `/pelayanan/auth`, Depok dan Tangerang beranda).
- Petunjuk Navigator: `petunjukPortalUrusan` (harness) menyusun teks dari peta; web meneruskannya ke loop sebagai
  `petunjukPortal`; prompt menaruhnya di PESAN SISTEM, terpisah dari teks halaman yang tetap DATA tak tepercaya
  (redaksi + spotlight di pesan pengguna). Penanda pembungkus dan DATAMARK di petunjuk dinetralkan. Mode Uji tanpa
  petunjuk (replika). Petunjuk tidak melonggarkan validator atau aturan keras.
- `blokirAset`: worker membatalkan HANYA gambar/fon/media yang cocok pola portal sesi (Depok: `cms.depok.go.id`, ikon
  SVG `icon-submission/`, `404-animasi.gif`), di awal `context.route`. Dokumen, skrip, gaya, dan XHR tidak pernah
  diblokir di sini, jadi formulir tetap utuh.
- Headed: Si D'nOK menolak Chromium headless (WAF, 403 `http_bot_simple`). Worker produksi dan laptop sudah headed di
  Xvfb (`config.ts` menolak `PENDAMPING_HEADLESS=1` di produksi; `sessions.ts` menolak headless untuk origin
  non-fixture; `deploy/tests/worker-id.test.sh` memeriksa compose laptop). `butuhHeaded` di peta mencatat alasannya.

## Konsekuensi

- Sel offline jujur sejak kartu, tanpa sesi buntu. Varian yang tidak disebut warga mengikuti nilai sel (Padang KTP-el
  tanpa varian = dipandu, karena mayoritas KTP-el baru); warga yang menyebut "hilang" mendapat Pendamping.
- Peta bisa usang; setiap portal mencatat `buktiTanggal`. Field terpetakan penuh hanya Tangerang (5/5); portal lain
  memetakan rute, menu, berkas, dan jebakan.
- Surabaya, Medan, Banjarmasin, dan Wonogiri belum punya entri; ditambahkan saat petanya selesai (data saja).
