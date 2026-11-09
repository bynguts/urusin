# Hardening host dan izin deploy

VPS `agent-vm` (aarch64, Ubuntu 24.04) dipakai bersama produksi pengguna: Caddy sistem untuk situs lain,
proxy LLM di `:20128`, kontainer lain, dan aturan iptables khusus. Dokumen ini mencatat **setiap** tulisan
Urusin ke host dan izin yang dibutuhkan untuk masing-masing. Apa pun yang tidak tercantum di sini bukan
milik Urusin dan tidak disentuh.

## Model izin

Keputusan pengguna, **diberikan 2026-11-08** ("Tetap + Caddy per-event"; dicatat apa adanya, disampaikan lead):

> - STANDING permission for deploy.sh, rollback, restore and backup on Urusin-only resources (urusin-*
>   containers and volume, /opt/urusin, 127.0.0.1:4310/4311/4320).
> - PER-EVENT user go-ahead for installing or changing the Caddy snippet and for caddy reload. The procedure
>   each time: timestamped Caddyfile backup, `caddy validate`, status-code snapshot of gutstore.my.id,
>   admin.gutstore.my.id and pythia.web.id before and after, and auto-rollback if any of them changed.

| Jenis                                      | Cakupan                                                                                                                                                                    | Izin                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tetap (standing), **diberikan 2026-11-08** | `deploy.sh`, rollback (otomatis di `deploy.sh` maupun manual), `restore.sh`, `backup.sh`                                                                                   | Diberikan 2026-11-08. Hanya sumber daya Urusin: kontainer dan volume `urusin-*`, `/opt/urusin`, `127.0.0.1:4310/4311/4320`. |
| Per kejadian                               | Memasang atau mengubah snippet Caddy (`/etc/caddy/urusin/Caddyfile.urusin` dan baris `import` di `/etc/caddy/Caddyfile`), `caddy reload`                                   | Go-ahead pengguna setiap kali, lewat `deploy/caddy-install.sh` (prosedur di bawah).                                         |
| Tidak pernah                               | Mengedit blok situs lain di Caddy, restart Caddy, iptables/ufw/tailscale, `daemon.json`, `docker system/image prune`, kontainer/volume/network/image non-Urusin, proxy LLM | Tidak ada izin yang mencakup ini.                                                                                           |

- `image-retention.sh --apply` dan `disk-alert.sh` tidak disebut dalam izin tetap. `disk-alert.sh` hanya
  membaca `df` dan mengirim notifikasi. Untuk `image-retention.sh --apply`, lead meminta go-ahead sampai
  pengguna menyatakan itu termasuk izin tetap; dry-run boleh kapan saja.
- Bila DNS domain utama sudah resolve tetapi pengguna tidak bisa dihubungi untuk izin Caddy, `DOMAIN` tetap
  di set `fallback` (sslip). Pindah set butuh izin per kejadian (snippet baru + reload).
- Sejak 2026-11-08 (keputusan lead): satu agen `ops-sec` adalah satu-satunya yang menjalankan `deploy.sh` dan
  mengubah `/opt/urusin/.env`; permintaan deploy lewat lead. `caddy-install.sh` tetap hanya dijalankan lead,
  setelah go-ahead. Pemeriksaan read-only (`ss -ltn`, `docker ps`, `caddy version`) tidak butuh izin.
- Riwayat Caddy: snippet fallback dipasang 2026-11-08 (backup `20261108T184610Z`), lalu primary
  `urusinai.web.id` (backup `20261108T185039Z`; izin tetap pengguna mencakup pemasangan primary ini).

### Prosedur Caddy per kejadian (`deploy/caddy-install.sh`)

```sh
deploy/caddy-install.sh fallback --dry-run   # read-only: snapshot status, validasi, rencana; boleh kapan saja
sudo deploy/caddy-install.sh fallback        # hanya setelah go-ahead pengguna (atau `primary`)
```

1. Snapshot kode status `https://gutstore.my.id/`, `https://admin.gutstore.my.id/` dan
   `https://pythia.web.id/` **sebelum** perubahan. `000` berarti tidak terjangkau, dan tetap dibandingkan.
2. Backup bertimestamp `/etc/caddy/Caddyfile` (dan snippet lama bila ada) ke `/var/backups/urusin-caddy/`
   (milik root, chmod 700). Backup yang sudah ada tidak pernah ditimpa.
3. Pasang snippet ke TARGET: path dari baris `import .../Caddyfile.urusin` yang sudah ada di Caddyfile host, atau
   `/etc/caddy/urusin/Caddyfile.urusin` bila belum ada (`TARGET=` eksplisit menang dan mengganti import lama).
   Hasilnya selalu tepat satu baris import snippet Urusin; lebih dari satu = galat sebelum perubahan. Direktori
   TARGET milik pengguna lain (mis. `/opt/urusin` milik ubuntu) ditolak dengan saran `TARGET=` di atas,
   lalu jalankan
   `caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile`. Bila gagal, backup dipulihkan dan
   Caddy tidak di-reload.
   Sebelum berkas live diubah, snippet baru (sebagai berkas sementara di direktori tujuan) dan Caddyfile host
   wajib terbaca oleh user proses Caddy (`User=` unit, biasanya `caddy`), dan `caddy validate` dijalankan sebagai
   user itu. Insiden 2026-11-08: `/opt/urusin` berizin 0750, validate sebagai root lolos, reload gagal ("File to
   import not found") dan rollback otomatis berjalan; perbaikannya `chmod 0751 /opt/urusin`.
4. Jalankan `systemctl reload caddy` (bukan restart; perintah tetap, tidak dibaca dari env). Tunggu `SETTLE_SECONDS` (5), lalu ambil snapshot
   **sesudah**.
5. Bila ada kode status yang berubah, atau reload gagal, rollback berjalan otomatis: backup dipulihkan,
   Caddy di-reload, status sesudah rollback dicetak, dan skrip keluar dengan exit 1.

Sumber `primary`/`fallback` adalah `deploy/Caddyfile.urusin.primary` / `.fallback`; sumber yang sama dengan TARGET
ditolak (dulu `primary` = `Caddyfile.urusin` = TARGET lama, sehingga setelah fallback, `primary` memasang ulang
fallback dan melapor sukses). Snippet berisi placeholder `{$…}` ditolak. Skrip berjalan sebagai root, jadi direktori snippet dan backup
wajib milik root, bukan symlink, dan tidak bisa ditulis group/others (`/opt/urusin` milik `ubuntu`, karena itu
snippet tidak lagi di sana). Berkas sementara dibuat dengan `mktemp` di direktori tujuan lalu di-`mv` atomik.
Tes: `bash deploy/tests/caddy-install.test.sh` memakai caddy/curl palsu dan mengganti fungsi `reload_caddy`
(skrip di-source); tidak pernah menyentuh host. Hanya valid di Linux (CI), karena izin berkas dan symlink diuji.

## Tulisan host

| Lokasi / sumber daya                                                     | Ditulis oleh                                     | Isi                                                                                 | Catatan                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/urusin/`                                                           | instalasi pertama (`git clone`)                  | repo; `deploy/` dipakai di host                                                     | milik user deploy, bukan root                                                                                                                                             |
| `/opt/urusin/deploy/.env`                                                | manual (lead)                                    | rahasia produksi                                                                    | `chmod 600`; tidak pernah di-commit                                                                                                                                       |
| `/opt/urusin/deploy/.env.images`                                         | `deploy.sh` (atomik, `umask 077`)                | digest per warna, warna aktif                                                       | rollback menulis ulang dari nilai sebelumnya                                                                                                                              |
| `/opt/urusin/deploy/.env.images.history`                                 | `deploy.sh` (append)                             | waktu, warna, SHA, `repo@digest`                                                    | tidak dipangkas; sumber retensi                                                                                                                                           |
| `/opt/urusin/deploy/.env.images.keep`                                    | manual (lead)                                    | digest yang wajib disimpan (mis. rc1)                                               | dibaca `image-retention.sh`                                                                                                                                               |
| `/etc/caddy/urusin/Caddyfile.urusin`                                     | `caddy-install.sh`, izin per kejadian            | salinan `deploy/Caddyfile.urusin[.fallback]`                                        | satu-satunya file yang di-`import` Caddy; direktori milik root (VPS saat ini masih meng-import `/opt/urusin/Caddyfile.urusin`; dipindah hanya dengan `TARGET=` eksplisit) |
| `/etc/caddy/Caddyfile`                                                   | `caddy-install.sh`, per kejadian (import sekali) | satu baris `import /etc/caddy/urusin/Caddyfile.urusin`                              | blok situs lain tidak disentuh                                                                                                                                            |
| `DOCKER_CONFIG` sementara `/tmp/urusin-docker-XXXXXX`                    | `deploy.sh` bila `GHCR_TOKEN` diset              | login GHCR (`read:packages`)                                                        | `chmod 700`, dihapus saat skrip keluar; `~/.docker` pengguna tidak disentuh                                                                                               |
| Kontainer `urusin-web-blue-1`, `urusin-web-green-1`, `urusin-fixtures-1` | `deploy.sh` (compose project `urusin`)           | web (network host, bind `127.0.0.1:4310/4311`), fixtures (bridge, `127.0.0.1:4320`) | `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, batas mem/cpu/pids                                                                                                   |
| Volume `urusin_data`                                                     | compose                                          | SQLite (WAL) + penanda warna aktif `/data/.active-color`                            | penanda ditulis `deploy.sh` lewat `docker compose exec`, di dalam volume, bukan di FS host                                                                                |
| Network `urusin_default`                                                 | compose                                          | bridge untuk fixtures                                                               | web memakai network host, tidak membuat network                                                                                                                           |
| Log kontainer                                                            | Docker json-file per service                     | `max-size: 10m`, `max-file: 3` di `compose.prod.yml`                                | **bukan** `daemon.json` (mengubahnya me-restart semua kontainer)                                                                                                          |
| Image `ghcr.io/bynguts/urusin-*`                                         | `deploy.sh` (`docker pull` per digest)           | arm64                                                                               | retensi lihat di bawah                                                                                                                                                    |
| `/var/backups/urusin/` (`BACKUP_DIR`)                                    | `backup.sh` (cron)                               | `urusin-*.db.gz`, `.lock.d`, `.partial.db` sementara                                | retensi `KEEP_DAYS`; restic off-site opsional                                                                                                                             |
| `/var/backups/urusin-caddy/`                                             | `caddy-install.sh` (izin per kejadian)           | `Caddyfile.<ts>`, `Caddyfile.urusin.<ts>`                                           | milik root, `chmod 700`; tidak pernah ditimpa (`/opt/urusin/caddy-backups/` = lokasi lama)                                                                                |
| `/var/log/urusin-backup.log`                                             | cron `backup.sh`                                 | log backup                                                                          |                                                                                                                                                                           |
| `/etc/cron.d/urusin-backup` (root), crontab user deploy                  | manual (lead)                                    | `backup.sh` (root, cron.d) dan `disk-alert.sh`                                      | lihat README "Backup" dan "Alert disk"                                                                                                                                    |

## Kompresi (Caddy) dan Lighthouse CI

- Kompresi respons hanya di Caddy: `encode zstd gzip` dengan daftar `match` Content-Type eksplisit di
  `Caddyfile.urusin.{primary,fallback}` (tanpa `text/*`, jadi SSE tidak dikompres). Aplikasi sendiri tidak
  mengompres SSR.
- Lighthouse CI mengukur lewat `scripts/lhci-serve.mjs`, proxy yang meniru blok `encode` itu persis (zstd lalu
  gzip, daftar tipe yang sama, minimum 512 byte, level bawaan Caddy) dan tidak mengubah hal lain. Tujuannya
  anggaran byte mengukur apa yang diterima warga, bukan melonggarkan gerbang. Bila blok `encode` di
  Caddyfile berubah, ubah `COMPRESSIBLE` di skrip itu juga.

## Retensi image

- Hanya `deploy/image-retention.sh`. Default dry-run; `--apply` menghapus.
- Penghapusan per referensi: `docker image rm ghcr.io/bynguts/urusin-<nama>@sha256:<digest>`. Tanpa `-f`;
  image yang dipakai kontainer ditolak Docker dan hanya dilaporkan.
- Disimpan:
  - semua digest di `.env.images` (warna aktif dan sebelumnya, `FIXTURES_IMAGE`);
  - digest di `.env.images.keep`, yaitu rc1;
  - 3 image terakhir per repo dari `.env.images.history` (`KEEP_LAST`).
- Repo lain, image tanpa digest, dan image milik pengguna tidak pernah disentuh. Tidak ada `prune`.

## Jaringan dan egress

- Web memakai `network_mode: host` karena iptables host men-DROP `:20128` dari bridge Docker. Akibatnya
  web berbagi namespace jaringan host, jadi ada dua pagar:
  - **Bind**: `HOST=127.0.0.1`. `deploy.sh` memeriksa dengan `ss -ltn` bahwa `4310`/`4311` hanya terikat
    ke `127.0.0.1`: selama menunggu warna baru sehat, sesudahnya, dan juga pada warna aktif. Alamat lain
    (wildcard atau IP non-loopback) menggagalkan deploy dengan rollback.
  - **Egress** (`@urusin/egress`): semua HTTP keluar server lewat Agent undici yang dijaga.
    - Tujuan diperiksa sebelum tersambung, dan setiap alamat hasil DNS diperiksa juga. Loopback, privat,
      link-local (termasuk `169.254.169.254`), CGNAT `100.64/10` dan padanan IPv6 ditolak. Alamat
      IPv4-mapped (`::ffff:a.b.c.d`) diperiksa sebagai IPv4; `::ffff:0:0:0/96`, NAT64 dan 6to4 diblokir utuh.
    - Pengecualian lokal satu-satunya adalah persis `127.0.0.1:20128` (proxy LLM). Itu pun hanya berlaku bila
      `LLM_BASE_URL` memang origin itu, dan redirect dari host lain ke sana selalu ditolak.
    - Dua profil terpisah:
      - **runtime** (server web): host Jina dan origin base URL LLM/embedding/rerank dari env;
      - **ingest** (`rag:ingest`, `rag:verify`, CLI kanal/kontak): registry domain resmi dan `*.go.id`,
        hanya https:443.
    - Redirect diikuti manual, dan setiap hop diperiksa ulang.
    - **Backstop**: `hooks.server.ts` dan entry CLI rag memasang Agent egress sebagai dispatcher global
      undici. Akibatnya fetch global, `event.fetch`, default SDK openai dan WebSocket undici juga dijaga.
    - ESLint melarang di kode server (`.ts`/`.js`, termasuk `+page.ts`/`+layout.ts`) di luar modul itu:
      `fetch`, `WebSocket` dan `EventSource` global, `undici` dan subpath-nya, `node:http(s)`/`http2`/
      `net`/`tls`, dan `child_process`.
    - Tes membuktikan `127.0.0.1:2019` (admin Caddy), `:4320`, `:22` dan metadata cloud tidak terjangkau,
      juga lewat fetch global setelah boot.
  - Firewall host (iptables) tidak diubah sebagai pagar tambahan; itu di luar izin Urusin.
- Fixtures tetap di bridge, tanpa akses ke proxy dan tanpa berbagi jaringan host.

### IP klien dan kuota per-IP (`X-Forwarded-For`)

- Compose mengisi `ADDRESS_HEADER=X-Forwarded-For` dan `XFF_DEPTH=1`. Caddy adalah satu-satunya hop dan
  menimpa `X-Forwarded-For` dari klien, jadi entri terakhir = IP peer TCP yang dilihat Caddy.
- Batasan yang harus diingat:
  - **CDN di depan atau `trusted_proxies` di Caddy merusak kuota per-IP.** Dengan CDN (mis. Cloudflare
    proxied), IP peer yang dilihat Caddy adalah IP edge CDN. Banyak klien runtuh menjadi sedikit IP, sehingga
    kuota per-IP menolak pengguna sah. Bila `trusted_proxies` ditambahkan, Caddy meneruskan XFF dari hop
    tepercaya, dan `XFF_DEPTH=1` lalu menunjuk ke entri yang salah. Kuota lalu bisa runtuh, atau bisa
    dipalsukan bila depth tidak disesuaikan. Mengaktifkan salah satunya menuntut `XFF_DEPTH` dan dokumen
    ini diperbarui bersama.
  - **Proses lokal bisa memalsukan XFF.** Web berjalan di network host dan mendengarkan
    `127.0.0.1:4310/4311` tanpa melewati Caddy. Proses apa pun di host (milik pengguna atau penyerang
    yang sudah di host) dapat mengirim `X-Forwarded-For` sembarang langsung ke port itu dan menghindari
    kuota per-IP. Kuota per-sesi dan batas biaya harian (`URUSIN_DAILY_IDR_CAP`) tetap berlaku.

## Caddy

- Snippet literal dari `deploy/hosts.json` (`node scripts/gen-caddyfile.mjs`, dicek CI). Tidak ada
  placeholder `{$…}`, jadi environment proses Caddy tidak pernah diubah dan Caddy tidak pernah di-restart.
- Isinya hanya blok situs Urusin dan snippet `(urusin_common)`, tanpa opsi global. CSP hanya dari aplikasi.
- `/api/health*` publik dijawab `404` (memuat gitSha/versi/runningTurns). Smoke publik dan monitor memakai
  `/api/ready`; `deploy.sh` membaca `/api/health` lewat `127.0.0.1`.
- UI membaca kemampuan server dari `/api/kemampuan`, yang publik dan berisi subset tidak sensitif: mode `llm`, status
  `ai`/`vision`/`rag`, dan flag fitur pencarian. Endpoint ini tidak memuat sha, versi, nama model, jumlah chunk, biaya,
  atau turn berjalan, sehingga tidak perlu aturan Caddy.
- Setiap perubahan hanya lewat `deploy/caddy-install.sh` dengan go-ahead pengguna (prosedur di "Model izin").
