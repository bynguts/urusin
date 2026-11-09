# 0029. Browser Pendamping di server sebagai eksekutor

- **Status:** Diterima. Terimplementasi di `apps/pendamping`, `packages/executor`, `packages/adapters`, `packages/pendamping-client`, dan broker `apps/web/src/routes/api/urusan/[id]/pendamping`.
- **Dicatat:** 2026-11-09
- **Sumber keputusan:** keputusan tim

## Konteks dan masalah

Mayoritas warga memakai ponsel. Ekstensi peramban ([ADR 0025](0025-executor-tanpa-bypass-captcha.md)) tidak bisa dipasang di Chrome Android atau Safari iOS, jadi pengisian otomatis hanya berjalan di laptop. Tanpa eksekutor di ponsel, warga ponsel hanya mendapat mode dipandu.

## Keputusan

Eksekutor utama adalah **Browser Pendamping**: satu Chromium **headed** per sesi di server Urusin (di dalam Xvfb; headless hanya untuk CI terhadap fixture, karena situs ber-Cloudflare menantang Chromium headless). Layarnya dialirkan ke perangkat warga (CDP `Page.startScreencast` → WebSocket → `<canvas>`), dan input sentuh/keyboard/IME warga diteruskan lewat `Input.dispatch*`. Ekstensi peramban dihapus dari repositori (2026-11-09); Browser Pendamping adalah satu-satunya eksekutor.

Aturan ADR 0025 tetap berlaku dan ditegakkan di kode yang sama:

- DSL langkah dan interpreter ada di `@urusin/executor` (diekstrak dari ekstensi sebelum dihapus).
- Program adapter situs (alur, probe sesi, bukti) ada di `@urusin/adapters`, terpisah dari interpreter.
- AI mengisi kolom dan mengunggah berkas. Login, OTP, CAPTCHA, dan **tombol kirim akhir** dikerjakan warga dalam mode _takeover_. Runner menolak klik pada target `gate.human` (`FINAL_NOT_AUTOMATABLE`) dan ini diuji di unit dan e2e.
- Tanpa plugin stealth, tanpa penyelesai CAPTCHA, agen pengguna jujur. **Tantangan verifikasi situs** (interstitial Cloudflare: header `cf-mitigated: challenge`, judul halaman tantangan, atau frame `challenges.cloudflare.com`/`/cdn-cgi/challenge-platform/` tanpa token Turnstile) diserahkan ke warga sebagai `giliran_anda` dengan `alasan: 'verifikasi_situs'` dan sorotan kotak centangnya. Klik warga diteruskan apa adanya lewat CDP (koordinat diskalakan DPR, sentuh dipetakan ke mouse); AI tidak pernah mengklik-nya. Gagal atau berulang dua kali, atau blokir yang tidak bisa diverifikasi (403/429 WAF, `cf-mitigated: block`), sesi berakhir `dipandu` dengan pesan jujur.
- **Status sesi.** Adapter mendeklarasikan probe masuk (`masuk.keluar`, mis. formulir login ada). Saat mulai dan setiap navigasi, halaman keluar/login memicu takeover `alasan: 'masuk_akun'`; warga masuk sendiri, AI lanjut. Konteks hidup lintas execution dalam satu urusan (status `siaga`) sampai TTL atau idle, jadi warga cukup masuk sekali; tidak ada impor/ekspor cookie dan profil dihapus saat sesi dihancurkan. Setelah kirim, nomor registrasi/status dibaca dari halaman (`bukti`) untuk `cek_status`.

## Model ancaman dan pengungkapan

**Yang berubah dibanding ekstensi:** kredensial dan OTP yang diketik warga melewati server Urusin (WebSocket → Chromium). Ini diungkap ke warga sebelum sesi dimulai (lihat `docs/ui/pendamping.md`). Mitigasinya:

- **Tidak ada persistensi.** Konteks Chromium non-persisten per sesi: tanpa cookie, storage, kata sandi, atau service worker yang tersimpan. Vault dan berkas hanya di memori proses. Sesi dihancurkan saat selesai, setelah TTL 15 menit, atau 3 menit tanpa aktivitas. Frame layar tidak direkam atau dicatat.
- **Takeover tidak dicatat.** Selama takeover AI dijeda dan isi ketikan tidak masuk log, event, atau LLM.
- **LLM tidak melihat PII mentah.** Nilai pribadi masuk lewat placeholder `{{PEMOHON.NIK}}` yang diselesaikan di batas eksekutor. Teks halaman yang dikirim ke model diredaksi `PiiInterceptor` lalu dibungkus spotlight sebagai data tak tepercaya (`teksHalamanUntukLlm`).
- **Akses ke sesi.** Hanya web app yang memanggil API internal pendamping, ditandatangani HMAC-SHA256 atas `waktu\nnonce\nMETODE\njalur\nContent-Length\nsha256(isi)` dengan hash isi dideklarasikan di header (`x-urusin-waktu`, `x-urusin-nonce`, `x-urusin-isi-sha256`, `x-urusin-tanda`; jendela 60 detik, nonce yang sudah terlihat ditolak). Tanda tangan diperiksa sebelum satu byte isi dibaca; isi lalu dibaca dengan batas dan di-hash sambil jalan, tidak cocok = ditolak; paling banyak satu pembacaan isi besar (> 64 KB) sekaligus, sisanya 503 + Retry-After, karena worker bisa berada di host lain lewat Tailscale; tiap worker di luar 127.0.0.1 punya rahasia sendiri dan web mematok URL WS ke worker yang dikonfigurasi. Sesi terikat ke urusan, ke akun (pemeriksa pemilik `pasangPemeriksaPemilikAkun`), dan sha256 cookie `urusin_sid`. Upgrade WebSocket ditolak sebelum soket dibuat bila sesi tidak ada atau bukan milik cookie itu; pesan dibatasi 64 KB sejak byte pertama dan soket yang belum `halo` dibatasi. Perangkat hanya mengirim input dan kendali lewat WS; nilai Data Diri dan Dokumen masuk lewat "Izinkan isi": peramban mengirim `{writeList, targetOrigin}` ke `POST /api/urusan/[id]/izinkan-isi`, server menerbitkan persetujuan sekali pakai (hanya portal registry `kirim-asli` atau situs latihan), lalu controller memanggil `ambilIsianUntukIsi` dengan origin sesi yang hidup dan mengirim nilai ke worker pemegang sesi lewat kanal internal bertanda. Tiket sekali pakai 30 detik dikirim sebagai pesan pertama (bukan di URL), dan Origin harus persis origin web app. Hanya tombol kiri mouse yang diteruskan.
- **SSRF dan egress.** Di produksi kontainer pendamping hanya ada di jaringan compose `pendamping_internal` (`internal: true`, gateway IPv4 host `isolated`, IPv6 mati): tanpa rute ke host maupun internet, dan boot ditolak bila ada rute default. Satu-satunya jalan keluar Chromium adalah kontainer `pendamping-edge`: proxy CONNECT dengan kredensial acak per sesi yang didaftarkan pendamping lewat kanal bertanda HMAC (Chromium tidak me-resolve DNS sendiri). Edge meresolusi DNS sendiri dan memeriksa SETIAP alamat dengan `checkConnect` profil `browser` dari `@urusin/egress`: hanya https:443, host persis sesi (origin program + pihak ketiga yang dideklarasikan adapter) DAN union registry global (selalu ditegakkan edge, walau pendamping disusupi); loopback, RFC1918, CGNAT/Tailscale, link-local/metadata, gateway bridge, `::ffff:`/NAT64/6to4 ditolak; host di luar izin tidak pernah di-resolve; lalu tersambung ke IP yang sudah diperiksa (aman dari DNS rebinding). Edge juga satu-satunya port host (127.0.0.1:4330) dan hanya meneruskan `/ws/<uuid>`, `/internal/*`, `/health` (dan `/debug*` bila diaktifkan). Lapisan kedua `context.route` membatalkan permintaan ke host di luar allowlist. Di dev/e2e proxy yang sama berjalan di dalam proses; e2e membuktikan `127.0.0.1:2019` (admin Caddy) dan `169.254.169.254` tidak terjangkau, dan `deploy/tests/pendamping-isolation.test.sh` membuktikan topologi compose tanpa rute keluar.
- **Isolasi proses.** Sandbox Chromium AKTIF (seccomp-bpf + namespace; profil seccomp Playwright dengan blok `CAP_SYS_ADMIN` dipangkas ke `clone`/`unshare`), tidak pernah `--no-sandbox`. Diperiksa saat boot dan gagal tertutup: renderer harus punya filter seccomp lebih banyak dari proses Node DAN berada di user namespace lain (sandbox userns) atau di namespace PID baru (sandbox setuid); selain itu pendamping menolak start. Kontainer non-root (pwuser), filesystem read-only (HOME/XDG di tmpfs), tmpfs `/tmp`, tanpa core dump, batas memori (swap = memori) dan PID. Lihat sandbox setuid di bawah.

### Sandbox setuid (agent-vm)

Host produksi mematikan user namespace tak berhak (`kernel.unprivileged_userns_clone=0`, `apparmor_restrict_unprivileged_userns=1`; `unshare -U` EPERM) dan sysctl host tidak kita ubah. Maka namespace renderer dibuat helper setuid Chromium:

- **Image.** `chrome_sandbox` bawaan Playwright (mode 777, tidak SUID) disalin sebagai `<dir exe>/chrome-sandbox` root 4755 (`COPY --chmod`, tanpa RUN). `CHROME_DEVEL_SANDBOX` di-set ke path itu sebagai penanda, tetapi Chromium mengabaikannya bila exe tidak dimiliki uid yang menjalankan (exe milik root, kita pwuser; diukur); yang dipakai adalah lokasi bawaan di sebelah exe. Semua biner SUID/SGID lain dari image dasar (su, mount, umount, passwd, chfn, chsh, gpasswd, newgrp, chage, expiry, ssh-agent, ssh-keysign, unix_chkpwd, pam_extrausers_chkpwd, dbus-daemon-launch-helper) dicabut bitnya; smoke rilis memastikan `chrome-sandbox` satu-satunya.
- **Compose, hanya layanan `pendamping`.** `cap_drop: [ALL]` + `cap_add: [SYS_ADMIN, SYS_CHROOT]`, TANPA `no-new-privileges`; seccomp Playwright, read-only, pwuser tetap. `pendamping-edge` (image sama) tetap `no-new-privileges` tanpa cap, jadi SUID tidak berlaku di sana. Set minimal diukur dengan userns dimatikan (`max_user_namespaces=0`) pada image nyata:

  | Konfigurasi                                           | Hasil                                                                                                                                     |
  | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | `SYS_ADMIN` + `SYS_CHROOT`, tanpa `no-new-privileges` | boot lulus, `sandbox Chromium aktif (setuid chrome-sandbox)`, chrome://sandbox "adequately sandboxed" (SUID, PID ns, Net ns, Seccomp-BPF) |
  | sama + `no-new-privileges`                            | gagal: "The setuid sandbox is not running as root"                                                                                        |
  | `SYS_CHROOT` saja                                     | gagal: "setuid sandbox: failed to move to new namespaces"                                                                                 |
  | `SYS_ADMIN` saja                                      | gagal (chroot ditolak)                                                                                                                    |
  | + `SETUID`/`SETGID`                                   | tidak diperlukan                                                                                                                          |

  Alasan tiap izin: `SYS_ADMIN` karena helper (euid 0) memanggil `clone(CLONE_NEWPID|CLONE_NEWNET)` dan kernel mewajibkan CAP_SYS_ADMIN untuk namespace non-user; `SYS_CHROOT` karena helper `chroot()` ke direktori kosong sebelum membuang hak; tanpa `no-new-privileges` karena exec biner SUID tidak menaikkan euid bila flag itu aktif.

- **Yang tetap berlaku untuk pwuser.** Kedua cap hanya ada di bounding set (`CapBnd 0x240000`); `CapPrm`/`CapEff`/`CapAmb` pwuser 0, dan satu-satunya jalan memakainya adalah helper SUID yang langsung membuangnya. Diukur sebagai pwuser dengan flag compose dan userns mati: `unshare -U`, `-r`, `-m`, `-p`, `-n`, `mount -t tmpfs`, `mount -o remount,rw /`, `chroot`, dan `su` semuanya ditolak. Profil seccomp tidak diperluas; perlu dicatat bahwa dengan `SYS_ADMIN` di bounding set, aturan profil yang bersyarat CAP_SYS_ADMIN (mount, umount, setns, dll.) ikut terbuka di level seccomp, jadi penghalangnya adalah pemeriksaan capability kernel (pwuser tanpa cap efektif), AppArmor `docker-default`, dan tidak adanya biner SUID lain. Di host yang mengizinkan userns tak berhak (bukan agent-vm), Chromium memakai sandbox userns dan `unshare -U` sebagai pwuser berhasil seperti sebelum perubahan ini (memang dibutuhkan sandbox userns).
- **Bukti di kernel produksi.** ops-sec menjalankan image baru di agent-vm sebagai probe sekali pakai (`--rm --network none`, flag compose persis) dan mencatat log boot serta uji unshare/mount di laporan delta.

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
