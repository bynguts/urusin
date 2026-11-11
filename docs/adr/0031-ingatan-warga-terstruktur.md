# 0031. Ingatan warga terstruktur di vault, bukan memori LLM pihak ketiga

- **Status:** Diterima. **Dicatat:** 2026-11-11. **Sumber:** keputusan tim.

## Konteks

Agen hanya mengingat isi satu urusan (`ringkasRiwayat(store.loadHistory(urusanId))`) dan kode wilayah dari Data
Diri saat urusan dimulai. Di urusan kedua warga harus bercerita ulang: domisili, kebutuhan (lansia, bahasa
sederhana), dokumen yang sudah ada di brankas, dan status urusan lainnya.

## Keputusan

- Ingatan disimpan per pemilik vault (akun, tamu, atau salinan demo) sebagai satu JSON terenkripsi di
  `vault_ingatan`. Kuncinya DEK pemilik yang sama dengan Data Diri (envelope encryption ADR 0028), dengan AAD
  sendiri `v1|ingatan|<pemilik>`. Ingatan ikut crypto-shred, ikut umur tamu/demo, dan digabung saat rotasi
  tamu ke akun (`gabungIngatan`: butir tunggal milik akun menang, catatan digabung tanpa duplikat).
- Isinya terbatas pada jenis butir yang tetap: wilayah (KTP, domisili, tujuan pindah terakhir), preferensi
  (bahasa sederhana, lansia, kanal online/datang, aksesibilitas), dan paling banyak 10 catatan pendek
  (≤ 200 karakter). Daftar dokumen (jenisnya saja) dan ringkasan urusan lain (jenis, status, langkah
  berikutnya, tenggat menurut aturan nasional) tidak disimpan ulang. Keduanya dihitung saat turn dimulai.
- Penulisan lewat tool `ingatan__ingat` dan pencatatan otomatis wilayah yang sudah DITETAPKAN warga (kecuali
  kematian, karena wilayahnya milik almarhum). Setiap butir lolos skema, pemindai PII (NIK, KK, HP, email, nama
  ibu, alamat lengkap, placeholder, deret angka panjang), dan bukti bahwa warga sendiri yang menyatakannya di
  urusan itu. PII masuk ke Data Diri lewat placeholder, tidak ke ingatan. Warga melihat kartu "Urusin
  mengingat: …" dengan tombol Batalkan, dan bagian "Yang Urusin ingat" di Pengaturan menyediakan hapus per
  butir serta "Hapus semua ingatan" (hak hapus UU PDP 27/2022).
- Blok "Yang Urusin tahu tentang warga ini" (≤ 600 token) disisipkan sesudah prompt sistem statis. Datanya
  dibungkus spotlight `ingatan` (delimiter ber-nonce + datamark, rencana §6.2), jadi diperlakukan
  sebagai DATA dan bukan instruksi. Kasus INJ-11 menguji catatan beracun.
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

- Akun yang emailnya belum terverifikasi tidak memakai ingatan (pemilik vaultnya terikat sid, bukan urusan).
  Ingatan aktif setelah email diverifikasi; tamu memakai ingatan tamunya sendiri.
- Event `ingatan` di rantai audit memuat label butir (sudah lolos pemindai PII). Event ini tetap ada setelah
  ingatan dihapus dan terhapus bersama urusannya. Jejak hanya mencatat jenis butir.
- Bukti "dinyatakan warga" untuk teks bebas memakai heuristik tumpang tindih kata (≥ 60%). Model masih bisa
  merapikan kalimat, tetapi tidak bisa mengarang isi baru.
