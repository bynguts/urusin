# 0028. Browser Pendamping di server sebagai eksekutor utama; ekstensi menjadi Mode Privasi

- **Status:** Diterima. Terimplementasi di `apps/pendamping`, `packages/executor`, `packages/adapters`, `packages/pendamping-client`, dan broker `apps/web/src/routes/api/urusan/[id]/pendamping`.
- **Dicatat:** 2026-11-09
- **Sumber keputusan:** keputusan tim

## Konteks dan masalah

Mayoritas warga memakai ponsel. Ekstensi peramban ([ADR 0025](0025-executor-tanpa-bypass-captcha.md)) tidak bisa dipasang di Chrome Android atau Safari iOS, jadi pengisian otomatis hanya berjalan di laptop. Tanpa eksekutor di ponsel, warga ponsel hanya mendapat mode dipandu.

## Keputusan

Eksekutor utama adalah **Browser Pendamping**: satu Chromium headless per sesi di server Urusin. Layarnya dialirkan ke perangkat warga (CDP `Page.startScreencast` → WebSocket → `<canvas>`), dan input sentuh/keyboard/IME warga diteruskan lewat `Input.dispatch*`. Ekstensi tetap ada sebagai **Mode Privasi** untuk laptop: peramban warga sendiri, tanpa data lewat server.

Aturan ADR 0025 tetap berlaku dan ditegakkan di kode yang sama:

- DSL langkah dan interpreter diekstrak ke `@urusin/executor` dan dipakai bersama ekstensi dan pendamping, bukan disalin.
- Program adapter situs (alur, probe sesi, bukti) ada di `@urusin/adapters`, terpisah dari interpreter: ekstensi
  dihentikan (pendamping saja), `apps/extension` tetap ada dan tetap memakai `@urusin/executor`.
- AI mengisi kolom dan mengunggah berkas. Login, OTP, CAPTCHA, dan **tombol kirim akhir** dikerjakan warga dalam mode _takeover_. Runner menolak klik pada target `gate.human` (`FINAL_NOT_AUTOMATABLE`) dan ini diuji di unit dan e2e.
- Tanpa plugin stealth, tanpa penyelesai CAPTCHA, agen pengguna jujur. Bila situs memasang WAF/bot wall (status 403/429/503, `cf-mitigated`, penanda halaman), sesi berakhir `dipandu` dengan pesan jelas. Tidak ada percobaan melewati.

## Model ancaman dan pengungkapan

**Yang berubah dibanding ekstensi:** kredensial dan OTP yang diketik warga melewati server Urusin (WebSocket → Chromium). Ini diungkap ke warga sebelum sesi dimulai (lihat `docs/ui/pendamping.md`). Mitigasinya:

- **Tidak ada persistensi.** Konteks Chromium non-persisten per sesi: tanpa cookie, storage, kata sandi, atau service worker yang tersimpan. Vault dan berkas hanya di memori proses. Sesi dihancurkan saat selesai, setelah TTL 15 menit, atau 3 menit tanpa aktivitas. Frame layar tidak direkam atau dicatat.
- **Takeover tidak dicatat.** Selama takeover AI dijeda dan isi ketikan tidak masuk log, event, atau LLM.
- **LLM tidak melihat PII mentah.** Nilai pribadi masuk lewat placeholder `{{PEMOHON.NIK}}` yang diselesaikan di batas eksekutor. Teks halaman yang dikirim ke model diredaksi `PiiInterceptor` lalu dibungkus spotlight sebagai data tak tepercaya (`teksHalamanUntukLlm`).
- **Akses ke sesi.** Hanya web app yang memanggil API internal pendamping (token bersama, jaringan compose). Sesi terikat ke urusan dan sha256 cookie `urusin_sid`. WebSocket butuh tiket sekali pakai 30 detik yang dikirim sebagai pesan pertama (bukan di URL), dan Origin harus persis origin web app.
- **SSRF dan egress.** Chromium hanya keluar lewat proxy egress per sesi (`--proxy-server`, termasuk loopback). Proxy hanya mengizinkan domain resmi dari registry ditambah host pihak ketiga yang dibutuhkan situs itu (`EGRESS_PIHAK_KETIGA`). Proxy meresolusi DNS sendiri dan menolak alamat privat, loopback, link-local, dan metadata **setelah** resolusi, lalu tersambung ke IP yang sudah diperiksa (aman dari DNS rebinding). Lapisan kedua `context.route` membatalkan permintaan ke host di luar allowlist. E2e membuktikan `127.0.0.1:2019` (admin Caddy) dan `169.254.169.254` tidak terjangkau.
- **Isolasi proses.** Kontainer tanpa capability, `no-new-privileges`, filesystem read-only, tmpfs `/tmp`, batas memori/PID. Chromium berjalan dengan `--no-sandbox`, jadi batas keamanannya kontainer dan proxy egress.

## Kapasitas

Host produksi (agent-vm, aarch64) dipakai bersama. Sesi aktif dibatasi `PENDAMPING_MAX_SESSIONS` (bawaan 2) dengan antrean FIFO yang statusnya terlihat di UI. Ada batas memori per sesi (`PENDAMPING_SESSION_MEM_MB`, diperiksa dari RSS proses Chromium) dan heap JS per renderer. Pengukuran lokal (Windows, headless shell, alur fixture): sekitar 213 MB working set (sekitar 89 MB private) per sesi. Angka arm64 belum diukur.

## Alternatif yang dipertimbangkan

- **Hanya ekstensi:** tidak menjangkau ponsel.
- **Otomasi penuh di server termasuk login:** menyimpan atau mengetik kredensial warga oleh mesin, dan melanggar ADR 0025 untuk CAPTCHA. Ditolak.
- **Layanan peramban jarak jauh pihak ketiga:** data warga keluar ke vendor lain, dan sulit menegakkan allowlist egress. Ditolak.

## Konsekuensi

- Pengisian otomatis tersedia di ponsel tanpa memasang apa pun.
- Server memegang data sesi sementara. Ini diungkap ke warga dan dibatasi waktu.
- Butuh port host baru untuk WebSocket (`127.0.0.1:4330`) dan rute Caddy `/pendamping/ws/*`. Keduanya masih berkomentar di `deploy/` sampai disetujui.
- **Tindak lanjut:** alat MCP (`pendamping_mulai`, `pendamping_status`, `pendamping_serahkan`) lewat `/api/mcp` belum dibuat karena endpoint itu belum ada di `main`. Pemanggilan `teksHalamanUntukLlm` dari alat harness juga masih tindak lanjut. Host `EGRESS_PIHAK_KETIGA` perlu dikonfirmasi lewat recon per situs. Frame bisa dipindah dari JSON base64 ke biner untuk menghemat bandwidth.
