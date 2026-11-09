# Browser Pendamping: panduan UI (untuk Rafi)

Browser Pendamping adalah peramban Chromium di server Urusin. Layarnya dialirkan ke ponsel warga lewat `<canvas>`. AI mengisi formulir dan mengunggah berkas. Warga sendiri yang login, mengetik OTP/CAPTCHA, dan menekan tombol kirim akhir. Latar keputusan ada di [ADR 0028](../adr/0028-browser-pendamping.md).

Agen tidak menulis UI. Yang tersedia untukmu:

- kontrak bertipe di `@urusin/contracts` (`packages/contracts/src/pendamping.ts`);
- klien tanpa framework `createPendampingViewer` di `@urusin/pendamping-client`;
- endpoint web di bawah `/api/urusan/[id]/pendamping` dan `/api/pendamping/antrean`;
- halaman uji **DEV ONLY** tanpa gaya di `apps/pendamping` (`GET /dev`, mati di produksi), yang dipakai e2e. Jangan dijadikan acuan tampilan.

## 1. Alur layar

```
kartu rencana (confirm) ──► [Isi dengan Browser Pendamping]
        │ POST /api/urusan/[id]/pendamping {executionId}
        ▼
  status "antre" ──► layar antrean (posisi n dari m)
        ▼
  "menunggu_data" ──► viewer mengirim vault + berkas yang diminta (butuh_data)
        ▼
  "berjalan", mode ai ──► layar dialirkan, AI mengisi (event "langkah")
        │
        ├─ giliran_anda (login / masuk_akun / verifikasi_situs) ──► mode takeover:
        │     warga login, OTP, CAPTCHA, atau mencentang verifikasi situs;
        │     AI lanjut otomatis setelah halaman berikutnya terbuka
        ▼
  giliran_anda (final) ──► mode takeover: warga memeriksa lalu menekan Kirim sendiri
        ▼
  status "siaga" (hasil + bukti; peramban tetap hidup untuk langkah berikutnya urusan ini)
        ▼  DELETE / TTL / idle
  status "selesai" / "dipandu" / "gagal" / "kedaluwarsa"
```

## 2. Layar yang perlu didesain

### a. Layar antrean

Muncul saat `status === 'antre'`. Data dari `sesi.antrean = { posisi, panjang }` (event `status` di viewer, atau `GET /api/urusan/[id]/pendamping`). Ringkasan global ada di `GET /api/pendamping/antrean` → `{ aktif, maks, menunggu }`.

Isi minimal: posisi warga, perkiraan bahwa satu sesi paling lama 15 menit, tombol **Batal** (`DELETE /api/urusan/[id]/pendamping`). Bila `POST` dijawab `429 ANTREAN_PENUH`, tampilkan `pesanWarga` dan tawarkan mode dipandu.

### b. Banner takeover (mode `takeover`)

Selalu terlihat selama `viewer.mode === 'takeover'`. Pesan wajib: **AI berhenti. Yang Anda ketik tidak dicatat dan tidak dilihat AI.** Tombol **Kembalikan ke AI** (`viewer.kembalikan()`) hanya relevan bila takeover diminta warga sendiri (`alasan: 'diminta_warga'`). Selama mode `ai`, sediakan tombol **Ambil alih** (`viewer.ambilAlih()`): input dari canvas diabaikan pendamping di mode `ai`.

### c. Prompt "Giliran Anda"

Dipicu event `{ jenis: 'giliran_anda', alasan, pesan, sorot? }`:

| `alasan`           | Arti                                           | Saran tampilan                                                  |
| ------------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| `login`            | login, OTP, atau CAPTCHA                       | tampilkan `pesan`, fokus ke canvas, buka keyboard (`inputTeks`) |
| `final`            | pengiriman akhir, hanya warga yang boleh       | prompt periksa + kirim (lihat bagian d)                         |
| `diminta_warga`    | warga menekan Ambil alih                       | banner takeover saja                                            |
| `periksa`          | AI butuh warga memeriksa halaman               | tampilkan `pesan`                                               |
| `masuk_akun`       | situs meminta warga masuk ke akunnya           | tampilkan `pesan`, sorot tombol Masuk, buka keyboard            |
| `verifikasi_situs` | situs menampilkan verifikasi (mis. Cloudflare) | tampilkan `pesan`, sorot kotak centang; warga mengetuk sendiri  |

`sorot = { x, y, lebar, tinggi }` adalah kotak elemen (piksel CSS halaman, relatif viewport halaman) yang harus ditekan warga, mis. tombol Masuk atau Kirim. Gambar outline/penanda di atas canvas memakai `meta` frame terakhir (`viewer.on('frame', meta => …)`) dan fungsi `tataLetak`/`petakanKoordinat` yang diekspor klien untuk memetakan koordinat halaman ↔ canvas.

### d. Serah terima Kirim akhir

Runner menolak menekan tombol final di kode (`FINAL_NOT_AUTOMATABLE`); AI tidak bisa mengirim. Saat `giliran_anda` dengan `alasan: 'final'`:

1. Tampilkan ringkasan dari kartu rencana yang sudah disetujui (bukan dari halaman).
2. Teks: **Periksa isian di layar. Tekan tombol Kirim di halaman bila sudah benar.**
3. Sorot tombol (`sorot`). Warga mengetuk tombol di canvas sendiri.
4. Setelah situs memuat halaman berikutnya, status menjadi `siaga` dengan `hasil: 'berhasil'` (mode tetap `takeover`, layar tetap tampil). `sesi.bukti = { nomor?, status? }` berisi nomor registrasi/status yang dibaca dari halaman bila adapter mendeklarasikannya; tampilkan di layar selesai. Event `selesai` dikirim saat itu juga. Langkah berikutnya urusan yang sama (mis. `cek_status`) memakai peramban yang sama tanpa login ulang. Tombol **Selesai** memanggil `DELETE`, lalu status `selesai`.

### e. Akhir dan galat

- `dipandu` (event atau status): situs memblokir peramban server, atau verifikasi situs gagal/berulang dua kali. Tampilkan `pesan`, lalu alihkan ke mode dipandu (langkah manual) di kartu urusan.
- `POST` dijawab `503 PENDAMPING_WILAYAH_TIDAK_TERSEDIA`: situs hanya bisa dibuka dari jaringan Indonesia dan worker berjaringan Indonesia sedang mati. Urusan sudah dialihkan ke dipandu; tampilkan `pesanWarga` apa adanya.
- `kedaluwarsa`: sesi melewati 15 menit atau 3 menit tanpa aktivitas. Tawarkan mulai ulang.
- `galat` (`{ kode, pesanWarga }`): tampilkan `pesanWarga` apa adanya. Daftar `kode` ada di `PendampingKodeGalatSchema`.
- `diblokir` (`{ host }`): permintaan ke host di luar allowlist ditolak. Cukup log ringan; tidak perlu ditampilkan ke warga kecuali berulang.

## 3. Endpoint web

Semua memakai cookie `urusin_sid` yang sudah ada di perangkat (tanpa cookie: `401 SESI_DIPERLUKAN`) dan cek Origin persis untuk POST/DELETE.

| Endpoint                                    | Body / hasil                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/urusan/[id]/pendamping`          | `MulaiPendampingRequest` `{ executionId, viewport? }` → `201 SesiPendamping` |
| `GET /api/urusan/[id]/pendamping`           | `SesiPendamping` (status, mode, antrean, hasil)                              |
| `POST /api/urusan/[id]/pendamping/tiket`    | `TiketPendampingResponse` `{ wsUrl, tiket, kedaluwarsa }` (30 detik, sekali) |
| `POST /api/urusan/[id]/pendamping/serahkan` | `SesiPendamping` (memaksa takeover)                                          |
| `DELETE /api/urusan/[id]/pendamping`        | `SesiPendamping` (akhiri; browser dihancurkan)                               |
| `GET /api/pendamping/antrean`               | `AntreanPendampingResponse` `{ aktif, maks, menunggu }`                      |

`executionId` berasal dari event SSE `execution_request` yang sudah dikonfirmasi warga. Kirim `viewport` sesuai layar (`lebar`, `tinggi` dalam piksel CSS, `dpr`, `seluler`) supaya halaman tampil versi ponsel.

## 4. Klien viewer

```ts
import { createPendampingViewer } from '@urusin/pendamping-client';

const tiket = await fetch(`/api/urusan/${id}/pendamping/tiket`, { method: 'POST' }).then((r) => r.json());
const viewer = createPendampingViewer(canvas, tiket.wsUrl, {
  // dipanggil ulang tiap sambung ulang: tiket sekali pakai
  tiket: () => fetch(`/api/urusan/${id}/pendamping/tiket`, { method: 'POST' }).then((r) => r.json()).then((t) => t.tiket),
  inputTeks, // <textarea> tersembunyi untuk keyboard ponsel/IME
});

viewer.on('mode', ({ mode }) => …);            // 'ai' | 'takeover' | 'done'
viewer.on('event', (e) => …);                  // langkah | giliran_anda | dipandu | diblokir | selesai
viewer.on('status', (sesi) => …);              // SesiPendamping
viewer.on('butuh_data', ({ placeholder, berkas }) => …);
viewer.on('galat', ({ kode, pesanWarga }) => …);
viewer.on('koneksi', (s) => …);                // menyambung | tersambung | putus | selesai

viewer.kirimVault({ '{{PEMOHON.HP}}': hp });   // nilai dari vault perangkat, hanya untuk sesi ini
await viewer.kirimBerkas('ktp', fileBlob);     // nama = nama berkas di butuh_data
viewer.ambilAlih(); viewer.kembalikan(); viewer.akhiri(); viewer.tutup();
```

Catatan untuk komponen:

- Canvas digambar _contain-fit_ dengan DPR; beri ukuran CSS sendiri (mis. lebar penuh, tinggi sisa layar). Viewer menangani pointer, sentuh, roda gulir, dan keyboard **hanya** di mode `takeover`.
- Untuk keyboard ponsel, fokuskan `inputTeks` saat canvas diketuk dalam mode takeover. Elemen itu harus bisa difokus (bukan `display:none`); sembunyikan dengan opasitas/ukuran.
- Viewer menyambung ulang otomatis dengan tiket baru; berhenti saat sesi selesai atau tiket ditolak (`koneksi === 'selesai'`).
- Panggil `viewer.tutup()` saat komponen di-unmount.
- WebSocket berada di origin yang sama (`wss://<domain>/pendamping/ws/...`, atau `/pendamping/w/<worker>/ws/...` untuk worker tambahan), jadi CSP `connect-src 'self'` cukup. Selalu pakai `tiket.wsUrl` apa adanya.
- Frame layar dikirim sebagai pesan WebSocket biner; klien mengirim `ack` per frame (sudah ditangani viewer), jadi koneksi lambat mendapat fps lebih rendah, bukan antrean menumpuk.

## 5. Privasi yang harus tampak di UI

- Sebelum mulai: jelaskan bahwa peramban berjalan di server Urusin, kata sandi/OTP diketik warga dan **tidak disimpan**, dan semuanya dihapus saat sesi berakhir (tidak ada cookie, riwayat, atau rekaman layar).
- Data vault dikirim ke sesi hanya setelah warga menyetujui kartu rencana.
