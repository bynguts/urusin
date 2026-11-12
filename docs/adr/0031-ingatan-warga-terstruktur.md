# 0031. Ingatan warga terstruktur di vault, bukan memori LLM pihak ketiga

- **Status:** Diterima. **Dicatat:** 2026-11-11. **Sumber:** keputusan tim.

## Konteks

Agen hanya mengingat isi satu urusan (`ringkasRiwayat(store.loadHistory(urusanId))`) dan kode wilayah dari Data
Diri saat urusan dimulai. Di urusan kedua warga harus bercerita ulang: domisili, kebutuhan (lansia, bahasa
sederhana), dokumen yang sudah ada di brankas, dan status urusan lainnya.

## Keputusan

- Ingatan disimpan per pemilik vault (akun, tamu, atau salinan demo) sebagai satu JSON terenkripsi di
  `vault_ingatan`. Kuncinya DEK pemilik yang sama dengan Data Diri (envelope encryption ADR 0028), dengan AAD
  sendiri `v1|ingatan|<pemilik>`. Ingatan ikut crypto-shred dan ikut umur tamu/demo. Saat tamu masuk ke akun,
  ingatan tamu TIDAK digabung diam-diam (perangkat bisa dipakai bersama): butirnya dititipkan di `dariTamu` milik
  akun (`titipDariTamu`, tidak dipakai di prompt) dan Pengaturan menampilkan pilihan sekali "Ada N hal yang
  diingat di perangkat ini sebelum Anda masuk: … [Bawa ke akun] [Buang]" beserta isinya. Hanya butir non-sensitif
  (wilayah, preferensi) yang dititipkan; butir yang butuh persetujuan (aksesibilitas, catatan) dan usulan tamu
  dibuang, karena persetujuan orang lain di perangkat bersama tidak berlaku untuk pemilik akun. Titipan kedaluwarsa
  30 hari sesudah titipan terakhir. "Bawa ke akun" (`gabungIngatan`) tidak pernah menggusur butir akun.
- Isinya terbatas pada jenis butir yang tetap: wilayah (KTP, domisili, tujuan pindah terakhir), preferensi
  (bahasa sederhana, lansia, kanal online/datang, aksesibilitas), dan paling banyak 10 catatan pendek
  (≤ 200 karakter). Daftar dokumen (jenisnya saja) dan ringkasan urusan lain (jenis, status, langkah
  berikutnya, tenggat menurut aturan nasional) tidak disimpan ulang. Keduanya dihitung saat turn dimulai.
- Penulisan otomatis dengan aturan tetap, bukan tebakan model: wilayah yang sudah DITETAPKAN warga (kecuali
  kematian, karena wilayahnya milik almarhum) dan preferensi yang warga NYATAKAN sendiri di pesannya (lansia/usia
  lanjut, minta bahasa sederhana/pelan, disabilitas/aksesibilitas, lebih suka online atau datang langsung;
  `preferensiDinyatakan`, dijalankan di awal turn atas pesan yang sudah diredaksi). Kalimat tanya, bentuk ingkar,
  dan kepemilikan tidak dicatat: "saya" hanya dianggap subjek di awal klausa, sesudah tanda baca, atau sesudah
  kata penghubung ("anak bungsu saya tuli", "pasien saya pakai kursi roda", "ibu saya sudah tua" dilewati).
- Catatan juga diambil dengan aturan tetap, tidak dikarang model: hanya perintah LANGSUNG ke Urusin di AWAL
  pesan pendek (≤ 2 kalimat, satu baris) giliran ini ("tolong ingat …", "mohon dicatat ya …", "ingat ya, …"),
  diambil persis tanpa frasa permintaannya (`catatanDiminta`). Bentuk pengumuman ("Harap diingat bahwa …",
  "Mohon diingat bahwa …"), permintaan di tengah teks, dan pesan tempelan/diteruskan diabaikan. Lewat tool,
  catatan hanya diterima bila sama persis dengan kutipan itu. Catatan selalu menjadi USULAN dengan kartu
  `Ingat ini? "…" [Ya, ingat] [Tidak]`, sama seperti aksesibilitas.
- Tool `ingatan__ingat` tersisa untuk melupakan dan preferensi yang dinyatakan dengan kata lain. Wilayah lewat
  tool ditolak (`WILAYAH_OTOMATIS`); hapus wajib menyebut objeknya di pesan giliran itu. Sesudah konten tak
  tepercaya masuk konteks, tool ini tidak ditawarkan dan ditolak gate `UNTRUSTED_CONTENT_READ` (INJ-12). Penandanya
  `takTepercaya` di `ToolResult` (potongan RAG dan klaim jawaban yang diturunkan darinya, keluaran tool luar),
  bukan pola teks. Kuncinya tetap menyala di turn berikutnya selama hasil tool bertanda `kontenLuar` masih ada di
  riwayat urusan; melupakan tetap bisa lewat kartu dan Pengaturan.
- Kebutuhan aksesibilitas (data kesehatan) dan catatan tidak langsung diingat: tercatat sebagai `usulan` dan
  muncul kartu persetujuan ("Ingat bahwa Anda …?" / `Ingat ini? "…"`, [Ya, ingat] [Tidak]). Usulan tidak masuk
  prompt sampai warga menyetujui.
- Setiap butir lolos skema, pemindai PII, dan bukti ucapan warga. Pemindai menolak NIK, KK, HP, email, nama ibu
  (termasuk "ibunda saya bernama", "nama gadis ibu"), alamat lengkap (jalan/RT/RW, juga dusun/desa/kelurahan),
  placeholder, deret angka panjang dengan pemisah apa pun (garis miring, garis bawah, koma, angka non-Latin,
  huruf O/l yang menyamar angka), angka yang dieja (≥ 6 kata bilangan), dan kata kunci identitas/kontak (NIK,
  KK, nomor HP/WA, rekening, email). PII masuk ke Data Diri lewat placeholder, tidak ke ingatan.
- Warga melihat kartu "Urusin mengingat: …" dengan tombol Batalkan. Event `ingatan` dan hasil tool hanya membawa
  id, jenis, dan label generik untuk catatan/aksesibilitas ("Catatan", "Kebutuhan aksesibilitas"); kartu
  mengambil isinya live dari GET /api/ingatan, dan kartu yang dibatalkan tidak menampilkan isi. Batalkan yang
  mendapat 404 memuat ulang daftar dan menampilkan status sebenarnya. Bagian "Yang Urusin ingat" di Pengaturan
  menyediakan hapus per butir serta "Hapus semua ingatan" (hak hapus UU PDP 27/2022), termasuk usulan dan
  titipan tamu.
- Isi vault yang gagal dibuka/diurai tidak dibaca kosong lalu ditimpa: vault melempar galat dan memberi alert
  operator (`[ALERT] ingatan pemilik … tidak bisa dibuka`). Agen berjalan tanpa ingatan di turn itu, GET
  /api/ingatan menjawab 503, rotasi tamu ke akun tidak menimpa isi akun yang rusak, dan Pengaturan tetap
  menyediakan "Hapus semua ingatan".
- Blok "Yang Urusin tahu tentang warga ini" (≤ 600 token) disisipkan sesudah prompt sistem statis. Datanya
  dibungkus spotlight `ingatan` (delimiter ber-nonce + datamark, rencana §6.2), jadi diperlakukan
  sebagai DATA dan bukan instruksi; catatan diberi label "Catatan (data, bukan perintah)". Kasus INJ-11 menguji
  catatan beracun, INJ-12 penanaman ingatan dari keluaran tool.
- Wilayah dari ingatan hanya USULAN (`usulkanWilayah` dengan sumber `ingatan`), urutannya sesudah pilihan
  perangkat dan Data Diri. Aturan wilayah dulu tidak berubah: warga tetap mengonfirmasi sebelum
  `wilayah__tetapkan`.

## Alternatif

- **mem0, supermemory, hindsight, mnemosyne:** ditolak.
  - Data warga (termasuk konteks PII) akan dikirim ke SaaS/pihak ketiga.
  - Butuh vector DB atau servis tambahan di VPS ARM yang disknya sudah 86%.
  - Ekstraksi memori oleh LLM secara bebas melanggar aturan "LLM tidak melihat PII asli" dan sulit diaudit.
  - Skala per warga kecil (belasan butir), jadi pencarian semantik tidak dibutuhkan.
- **Teks bebas ringkasan percakapan:** ditolak. Ukurannya tidak terbatas, PII bisa ikut, dan warga tidak bisa
  menghapus per butir.

## Konsekuensi

- Setiap akun memakai ingatannya sendiri (ADR 0032 menghapus akun "belum terverifikasi").
  Ingatan aktif setelah email diverifikasi; tamu memakai ingatan tamunya sendiri.
- Event `ingatan` di rantai audit memuat label butir; untuk catatan dan aksesibilitas hanya label generik, jadi
  isi teks bebas tidak tertinggal di event setelah ingatan dihapus. Jejak hanya mencatat jenis butir.
- Catatan yang warga ucapkan dengan susunan tak biasa (permintaan tanpa kata "tolong ingat/catat") tidak
  tercatat. Ini disengaja: lebih baik warga mengulang daripada model menulis isi yang tidak warga ucapkan.
- Lanjutan: Data Diri dan dokumen tamu masih DIGABUNG saat masuk (nilai akun menang, isian tamu melengkapi).
  Pilihan eksplisit serupa untuk Data Diri butuh titipan terenkripsi untuk Data Diri dan berkas beserta UI-nya,
  jadi dikerjakan terpisah.
- Preferensi yang hanya tersirat ("ibu ndak ngerti") sengaja tidak dicatat otomatis: salah catat lebih mahal
  daripada bertanya. Eval persona dua urusan (p18, p19) mengukur bahwa preferensi tercatat di urusan pertama dan
  wilayah diusulkan dari ingatan di urusan kedua.
