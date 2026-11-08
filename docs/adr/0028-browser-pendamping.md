# 0028. Browser Pendamping di server sebagai eksekutor utama; ekstensi menjadi Mode Privasi

- **Status:** Diterima. Terimplementasi di `apps/pendamping`, `packages/executor`, `packages/adapters`, `packages/pendamping-client`, dan broker `apps/web/src/routes/api/urusan/[id]/pendamping`.
- **Dicatat:** 2026-11-09
- **Sumber keputusan:** keputusan tim

## Konteks dan masalah

Mayoritas warga memakai ponsel. Ekstensi peramban ([ADR 0025](0025-executor-tanpa-bypass-captcha.md)) tidak bisa dipasang di Chrome Android atau Safari iOS, jadi pengisian otomatis hanya berjalan di laptop. Tanpa eksekutor di ponsel, warga ponsel hanya mendapat mode dipandu.

## Keputusan

Eksekutor utama adalah **Browser Pendamping**: satu Chromium **headed** per sesi di server Urusin (di dalam Xvfb; headless hanya untuk CI terhadap fixture, karena situs ber-Cloudflare menantang Chromium headless). Layarnya dialirkan ke perangkat warga (CDP `Page.startScreencast` → WebSocket → `<canvas>`), dan input sentuh/keyboard/IME warga diteruskan lewat `Input.dispatch*`. Ekstensi tetap ada sebagai **Mode Privasi** untuk laptop: peramban warga sendiri, tanpa data lewat server.

Aturan ADR 0025 tetap berlaku dan ditegakkan di kode yang sama:

- DSL langkah dan interpreter diekstrak ke `@urusin/executor` dan dipakai bersama ekstensi dan pendamping, bukan disalin.
- Program adapter situs (alur, probe sesi, bukti) ada di `@urusin/adapters`, terpisah dari interpreter: ekstensi
  dihentikan (pendamping saja), `apps/extension` tetap ada dan tetap memakai `@urusin/executor`.
- AI mengisi kolom dan mengunggah berkas. Login, OTP, CAPTCHA, dan **tombol kirim akhir** dikerjakan warga dalam mode _takeover_. Runner menolak klik pada target `gate.human` (`FINAL_NOT_AUTOMATABLE`) dan ini diuji di unit dan e2e.
- Tanpa plugin stealth, tanpa penyelesai CAPTCHA, agen pengguna jujur. **Tantangan verifikasi situs** (interstitial Cloudflare: header `cf-mitigated: challenge`, judul halaman tantangan, atau frame `challenges.cloudflare.com`/`/cdn-cgi/challenge-platform/` tanpa token Turnstile) diserahkan ke warga sebagai `giliran_anda` dengan `alasan: 'verifikasi_situs'` dan sorotan kotak centangnya. Klik warga diteruskan apa adanya lewat CDP (koordinat diskalakan DPR, sentuh dipetakan ke mouse); AI tidak pernah mengklik-nya. Gagal atau berulang dua kali, atau blokir yang tidak bisa diverifikasi (403/429 WAF, `cf-mitigated: block`), sesi berakhir `dipandu` dengan pesan jujur.
- **Status sesi.** Adapter mendeklarasikan probe masuk (`masuk.keluar`, mis. formulir login ada). Saat mulai dan setiap navigasi, halaman keluar/login memicu takeover `alasan: 'masuk_akun'`; warga masuk sendiri, AI lanjut. Konteks hidup lintas execution dalam satu urusan (status `siaga`) sampai TTL atau idle, jadi warga cukup masuk sekali; tidak ada impor/ekspor cookie dan profil dihapus saat sesi dihancurkan. Setelah kirim, nomor registrasi/status dibaca dari halaman (`bukti`) untuk `cek_status`.

## Model ancaman dan pengungkapan

**Yang berubah dibanding ekstensi:** kredensial dan OTP yang diketik warga melewati server Urusin (WebSocket → Chromium). Ini diungkap ke warga sebelum sesi dimulai (lihat `docs/ui/pendamping.md`). Mitigasinya:

- **Tidak ada persistensi.** Konteks Chromium non-persisten per sesi: tanpa cookie, storage, kata sandi, atau service worker yang tersimpan. Vault dan berkas hanya di memori proses. Sesi dihancurkan saat selesai, setelah TTL 15 menit, atau 3 menit tanpa aktivitas. Frame layar tidak direkam atau dicatat.
- **Takeover tidak dicatat.** Selama takeover AI dijeda dan isi ketikan tidak masuk log, event, atau LLM.
- **LLM tidak melihat PII mentah.** Nilai pribadi masuk lewat placeholder `{{PEMOHON.NIK}}` yang diselesaikan di batas eksekutor. Teks halaman yang dikirim ke model diredaksi `PiiInterceptor` lalu dibungkus spotlight sebagai data tak tepercaya (`teksHalamanUntukLlm`).
- **Akses ke sesi.** Hanya web app yang memanggil API internal pendamping, ditandatangani HMAC-SHA256 dengan rahasia bersama atas `waktu\nMETODE\njalur\nsha256(isi)` (header `x-urusin-waktu`, `x-urusin-tanda`; jendela 60 detik), karena worker bisa berada di host lain lewat Tailscale. Sesi terikat ke urusan dan sha256 cookie `urusin_sid`. WebSocket butuh tiket sekali pakai 30 detik yang dikirim sebagai pesan pertama (bukan di URL), dan Origin harus persis origin web app.
- **SSRF dan egress.** Chromium hanya keluar lewat proxy egress per sesi (`--proxy-server`, termasuk loopback). Proxy hanya mengizinkan domain resmi dari registry ditambah host pihak ketiga yang dibutuhkan situs itu (`EGRESS_PIHAK_KETIGA`). Proxy meresolusi DNS sendiri dan menolak alamat privat, loopback, link-local, dan metadata **setelah** resolusi, lalu tersambung ke IP yang sudah diperiksa (aman dari DNS rebinding). Lapisan kedua `context.route` membatalkan permintaan ke host di luar allowlist. E2e membuktikan `127.0.0.1:2019` (admin Caddy) dan `169.254.169.254` tidak terjangkau.
- **Isolasi proses.** Kontainer tanpa capability, `no-new-privileges`, filesystem read-only, tmpfs `/tmp`, batas memori/PID. Chromium berjalan dengan `--no-sandbox`, jadi batas keamanannya kontainer dan proxy egress.

## Kapasitas

Host produksi (agent-vm, aarch64) dipakai bersama. Sesi aktif dibatasi `PENDAMPING_MAX_SESSIONS` (bawaan 2) dengan antrean FIFO yang statusnya terlihat di UI. Ada batas memori per sesi (`PENDAMPING_SESSION_MEM_MB`, diperiksa dari PSS proses Chromium lewat `/proc/<pid>/smaps_rollup`, sehingga memori bersama tidak dihitung berulang) dan heap JS per renderer. Pengukuran kontainer (headed, Xvfb, alur fixture, cgroup): idle 213 MB (Node 110, Xvfb 59), 1 sesi 422 MB, 2 sesi 594 MB, 3 sesi 760 MB; sekitar 5,5 fps dan 28 KB per frame biner. Image arm64 985 MB terkompresi (sekitar 3,6 GB terurai, hampir seluruhnya base Playwright noble yang sudah di cache; lapisan Urusin sekitar 25 MB).

**Multi-worker.** Container identik dapat berjalan di beberapa host (VPS, laptop anggota lewat Tailscale). Web membaca `PENDAMPING_WORKERS` (`[{id, url, region, maxSessions}]`), memeriksa `GET /health` tiap worker (cache 5 detik), dan memilih worker sehat dengan beban terendah; worker non-`id` didahulukan untuk situs umum. Situs registry `aksesWilayah: 'id-only'` (Telunjuk Sakti, Si D'nOK Semarang) hanya dirutekan ke worker `region: 'id'`; bila tak ada yang sehat, urusan beralih ke mode dipandu dengan pesan jujur, bukan klaim tampilan berubah. Panggilan berikutnya untuk urusan yang sama ke worker yang sama (sesi siaga).

## Alternatif yang dipertimbangkan

- **Hanya ekstensi:** tidak menjangkau ponsel.
- **Otomasi penuh di server termasuk login:** menyimpan atau mengetik kredensial warga oleh mesin, dan melanggar ADR 0025 untuk CAPTCHA. Ditolak.
- **Layanan peramban jarak jauh pihak ketiga:** data warga keluar ke vendor lain, dan sulit menegakkan allowlist egress. Ditolak.

## Konsekuensi

- Pengisian otomatis tersedia di ponsel tanpa memasang apa pun.
- Server memegang data sesi sementara. Ini diungkap ke warga dan dibatasi waktu.
- Butuh port host baru untuk WebSocket (`127.0.0.1:4330`) dan rute Caddy `/pendamping/ws/*`. Keduanya masih berkomentar di `deploy/` sampai disetujui. Worker tambahan butuh rute WS sendiri (mis. `/pendamping/w/<id>/ws/*` ke IP Tailscale worker) dan `PENDAMPING_PUBLIC_WS_URL` worker itu diisi jalur tersebut.
- **Tindak lanjut:** alat MCP (`pendamping_mulai`, `pendamping_status`, `pendamping_serahkan`) lewat `/api/mcp` belum dibuat karena endpoint itu belum ada di `main`. Pemanggilan `teksHalamanUntukLlm` dari alat harness juga masih tindak lanjut. Host `EGRESS_PIHAK_KETIGA` perlu dikonfirmasi lewat recon per situs.
