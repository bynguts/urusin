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
- **Akses ke sesi.** Hanya web app yang memanggil API internal pendamping, ditandatangani HMAC-SHA256 atas `waktu\nnonce\nMETODE\njalur\nsha256(isi)` (header `x-urusin-waktu`, `x-urusin-nonce`, `x-urusin-tanda`; jendela 60 detik, nonce yang sudah terlihat ditolak), karena worker bisa berada di host lain lewat Tailscale; tiap worker di luar 127.0.0.1 punya rahasia sendiri dan web mematok URL WS ke worker yang dikonfigurasi. Sesi terikat ke urusan, ke akun (pemeriksa pemilik `pasangPemeriksaPemilikAkun`), dan sha256 cookie `urusin_sid`. Upgrade WebSocket ditolak sebelum soket dibuat bila sesi tidak ada atau bukan milik cookie itu; pesan dibatasi 64 KB sejak byte pertama (berkas dikirim berpotongan, `berkas_potong`) dan soket yang belum `halo` dibatasi. Tiket sekali pakai 30 detik dikirim sebagai pesan pertama (bukan di URL), dan Origin harus persis origin web app. Hanya tombol kiri mouse yang diteruskan.
- **SSRF dan egress.** Di produksi kontainer pendamping hanya ada di jaringan compose `pendamping_internal` (`internal: true`, gateway IPv4 host `isolated`, IPv6 mati): tanpa rute ke host maupun internet, dan boot ditolak bila ada rute default. Satu-satunya jalan keluar Chromium adalah kontainer `pendamping-edge`: proxy CONNECT dengan kredensial acak per sesi yang didaftarkan pendamping lewat kanal bertanda HMAC (Chromium tidak me-resolve DNS sendiri). Edge meresolusi DNS sendiri dan memeriksa SETIAP alamat dengan `checkConnect` profil `browser` dari `@urusin/egress`: hanya https:443, host persis sesi (origin program + pihak ketiga yang dideklarasikan adapter) DAN union registry global (selalu ditegakkan edge, walau pendamping disusupi); loopback, RFC1918, CGNAT/Tailscale, link-local/metadata, gateway bridge, `::ffff:`/NAT64/6to4 ditolak; host di luar izin tidak pernah di-resolve; lalu tersambung ke IP yang sudah diperiksa (aman dari DNS rebinding). Edge juga satu-satunya port host (127.0.0.1:4330) dan hanya meneruskan `/ws/<uuid>`, `/internal/*`, `/health` (dan `/debug*` bila diaktifkan). Lapisan kedua `context.route` membatalkan permintaan ke host di luar allowlist. Di dev/e2e proxy yang sama berjalan di dalam proses; e2e membuktikan `127.0.0.1:2019` (admin Caddy) dan `169.254.169.254` tidak terjangkau, dan `deploy/tests/pendamping-isolation.test.sh` membuktikan topologi compose tanpa rute keluar.
- **Isolasi proses.** Sandbox Chromium AKTIF (user namespace + seccomp-bpf; profil seccomp Playwright dan hanya `SYS_CHROOT` untuk chroot sandbox), diperiksa saat boot (renderer harus di user namespace lain dengan filter seccomp tambahan) dan gagal tertutup. Kontainer non-root, `no-new-privileges`, filesystem read-only (HOME/XDG di tmpfs), tmpfs `/tmp`, tanpa core dump, batas memori (swap = memori) dan PID.

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
