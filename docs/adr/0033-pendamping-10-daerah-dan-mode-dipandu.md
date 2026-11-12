# 0033. Browser Pendamping di 10 daerah prioritas, daerah lain dipandu AI

- **Status:** Diterima. **Dicatat:** 2026-11-12. **Sumber:** keputusan pemilik produk.

## Konteks

ADR 0030 menawarkan Navigator generik di setiap wilayah yang punya portal `web` di registry (56 wilayah). Warga di
wilayah lain mendapat pesan "Situs ini belum bisa dibantu Browser Pendamping", dan pertanyaan tanpa sumber di korpus
berakhir di kartu hand-off. Contohnya KTP-el pertama anak 17 tahun di Kota Jayapura. Jawaban juga sering hanya
mengutip peraturan.go.id tanpa menyebut kanal daerah, padahal registry punya kanalnya (mis.
dukcapil.makassarkota.go.id).

Pemilik produk memutuskan bahwa Browser Pendamping ke portal asli hanya dijamin di 10 daerah: Surabaya 3578,
Wonogiri 3312, Kota Semarang 3374, Medan 1271, Kota Malang 3573, Depok 3276, Kota Tangerang 3671, Kota Padang 1371,
Bandar Lampung 1871, dan Banjarmasin 6371.

## Bukti untuk wilayah berportal web di luar 10 daerah

- Data registry `portal-dukcapil.json` (`bukti: OBS`, probe 2026-11-10/11) hanya membuktikan halaman portal bisa
  **dibuka** dari jaringan tertentu (`aksesWilayah`), beserta jenis login dan proteksinya. Data itu tidak membuktikan
  Navigator sampai serah-terima akhir dengan kolom yang benar.
- Eval Navigator (`scripts/eval-generik.mjs`, TSR/FA/SV) hanya berjalan pada replika, bukan portal nyata.
- Sesi probe portal nyata di luar 10 daerah (gel4: 9171 Kota Jayapura, 3279 Kota Banjar, 3674 Tangerang Selatan)
  menghasilkan perbaikan gerbang (http→https, blokir keras Cloudflare). Belum ada catatan sesi yang sampai ke
  halaman akhir.
- Banyak dari portal itu memakai reCAPTCHA, hCaptcha, Turnstile, slider, login Google, atau `id-only`. Pada kondisi
  ini warga paling sering mendapat pengalaman rusak (berhenti di tengah dan diserahkan balik).

Rekomendasi tim agar portal yang "terbukti terbuka di probe" tetap ditawarkan dengan label beta sudah ditimbang.
Kriteria "terbuka" yang tersedia sekarang hanya keterjangkauan halaman, bukan keberhasilan pengisian. Dua persona
uji (Kota Jayapura dan Makassar) justru wilayah berportal web yang harus melihat kartu "sedang dikembangkan". Karena
itu belum ada wilayah yang memenuhi syarat beta.

## Keputusan

- Satu sumber kebenaran: `DAERAH_PENDAMPING_AKTIF` di `@urusin/registry` (`pendamping-aktif.ts`). Sumber ini dibaca
  rute agen, kartu rencana, catatan state model, dan halaman web (/cara-kerja, landing).
- `rutePendamping` (harness) mengembalikan `dipandu` dengan `sebab: 'pengembangan'` untuk wilayah di luar daftar,
  sebelum adapter atau Navigator generik dipertimbangkan. Data portal di registry tetap utuh, untuk kanal yang bisa
  diklik dan untuk perluasan nanti.
- Tidak ada lagi pesan buntu. `alasanDipandu` di luar daftar berbunyi: "Untuk [X], Urusin memandu Anda langkah demi
  langkah. Browser Pendamping (AI ikut mengisi formulir di situs resmi) untuk [X] sedang kami kembangkan; saat ini
  aktif di …". Kanal WhatsApp/aplikasi daerah disisipkan bila tercatat.
- Kartu rencana tanpa Pendamping membawa `dipandu` (kontrak `plan_card`, aditif) dengan isi:
  - kalimat positif;
  - kanal resmi daerah yang bisa diklik, berurutan: portal registry (web/WA/aplikasi) dengan jam layanan, lalu
    situs Disdukcapil/pemda, alamat, dan kontak;
  - biaya gratis bersumber UU 24/2013 Ps. 79A;
  - perkiraan waktu, bersumber bila ada tenggat pasal; selain itu ditandai panduan umum;
  - tips berlabel panduan umum;
  - bantuan lanjutan yang memang tersedia.
- Urusan adminduk tidak berakhir hand-off. Bila `urusan__jawab_persyaratan` tidak menemukan kutipan terverifikasi,
  model menerima arahan PANDUAN UMUM: kalimat pertama "Panduan umum (belum dari sumber resmi daerah, cek ulang di
  kanal resmi):", lalu langkah konkret dari pengetahuannya yang tetap tunduk pada FAKTA HUKUM. Arahan ditutup
  dengan kanal daerah yang berwenang (yurisdiksi tetap dari `kodeYurisdiksi`). Hand-off tetap berlaku untuk
  layanan non-adminduk (SKCK, Samsat, bansos) dan untuk kuota habis.

## Syarat menambah daerah (atau label beta)

Kode wilayah boleh masuk `DAERAH_PENDAMPING_AKTIF` (atau daftar beta bila nanti dibuat) hanya setelah ada sesi probe
portal nyata yang tercatat sampai serah-terima akhir dengan SV = 0, untuk minimal satu jenis urusan. Proteksi
portal harus bisa dilalui warga sendiri (tanpa penyelesai CAPTCHA, ADR 0025), dan bila `id-only`, worker
berjaringan Indonesia harus tersedia.

## Konsekuensi

- Warga di 504 kab/kota lain tidak lagi ditawari "Setujui dan buka situs". Mereka mendapat rencana lengkap dan
  kanal yang bisa diklik.
- Panduan umum bisa keliru untuk kekhususan daerah. Mitigasinya label jujur, FAKTA HUKUM di prompt sistem, dan
  kanal resmi yang selalu disebut.
- Belum tersedia dan tidak dijanjikan di kartu:
  - cek foto berkas dengan vision. Fitur ini butuh mengirim foto dokumen berisi PII ke penyedia LLM, sementara
    ADR 0007 menyimpan vault di peramban dan model tidak pernah melihat data pribadi;
  - pengingat terjadwal. ADR 0015 belum diimplementasikan.
