# Deploy Urusin (VPS)

Image web dibangun CI (`.github/workflows/release.yml`) per commit di `main`, multi-arch (amd64 + arm64),
dan ditarik VPS berdasarkan digest. VPS tidak pernah build.

Target: VPS `agent-vm` (Ubuntu 24.04, Docker + compose v2). Caddy sistem sudah memegang 80/443 dan
melayani situs lain; Urusin hanya mengikat `127.0.0.1:4310` (web-blue, host network), `127.0.0.1:4311` (web-green)
dan `127.0.0.1:4320` (fixtures, opsional). Port terpakai lain di host: 3000, 3100, 8000, 8080, 8082,
8765, 20128. VPS dipakai bersama layanan lain: jangan menyentuh kontainer/layanan di luar proyek `urusin`.

Berkas: `compose.prod.yml`, `Caddyfile.urusin` (+ `.fallback`), `hardening.md`, `deploy.sh`, `backup.sh`, `restore.sh`, `disk-alert.sh`,
`tests/` (harness tanpa Docker).

## Instalasi pertama

```sh
sudo mkdir -p /opt/urusin && sudo chown "$USER" /opt/urusin
git clone https://github.com/bynguts/urusin.git /opt/urusin   # atau salin folder deploy/ saja
cd /opt/urusin/deploy

# 1. Login GHCR (repo privat): PAT read:packages saja, di DOCKER_CONFIG sementara (lihat "Login GHCR
#    sementara"); jangan menulis ke ~/.docker milik pengguna.

# 2. Konfigurasi. File ini berisi rahasia: jangan di-commit.
cp ../.env.example .env
chmod 600 .env
$EDITOR .env        # isi DOMAIN, SESSION_SECRET, LLM_*, VAPID_*, TURNSTILE_*
```

`.env` di `/opt/urusin/deploy/.env` dibaca compose (`env_file`) dan oleh `deploy.sh`.
`DOMAIN` wajib dan harus host `app` salah satu set di `deploy/hosts.json`. Compose menurunkan `ORIGIN` dan
`URUSIN_PUBLIC_ORIGIN` (`https://$DOMAIN`), `VERIFY_HOST` (`verify.$DOMAIN`) dan `FIXTURES_HOST`
(`fixtures.$DOMAIN`); startup aplikasi menolak host di luar satu set.

## Caddy (host)

Snippet dibangkitkan dari `deploy/hosts.json` oleh `node scripts/gen-caddyfile.mjs` dengan hostname
**literal** (tanpa placeholder `{$DOMAIN}`): placeholder dibaca dari environment proses Caddy sistem, dan
mengubahnya berarti mengedit unit Caddy pengguna lalu me-restart Caddy. Dua berkas di-commit, keduanya
diperiksa CI (`node scripts/gen-caddyfile.mjs --check`, juga `scripts/tests/gen-caddyfile.test.mjs`):

| Set        | Berkas                      | Host                                         |
| ---------- | --------------------------- | -------------------------------------------- |
| `primary`  | `Caddyfile.urusin`          | `hosts.json` `primary.app`, `primary.verify` |
| `fallback` | `Caddyfile.urusin.fallback` | sslip (`fallback.*`), tanpa DNS sendiri      |

Pemilihan host hanya terjadi di VPS: `.env` (`DOMAIN`) dan salinan snippet set yang sama di
`/opt/urusin/Caddyfile.urusin`. Image dan ekstensi identik untuk kedua set. Isi snippet:

- `reverse_proxy 127.0.0.1:4310 127.0.0.1:4311` dengan `lb_policy first`, health check aktif
  **`/api/ready`** tiap 2 detik (200 hanya pada warna yang dipromosikan `deploy.sh`; `/api/health` tetap liveness), dan `lb_try_duration 5s` (permintaan yang gagal tersambung diulang ke
  upstream sehat, sehingga pergantian blue/green tidak menghasilkan 502). Lalu lintas hanya ke warna aktif
  tanpa reload Caddy. `flush_interval -1` untuk SSE.
- `encode zstd gzip` dengan **matcher eksplisit**. Matcher bawaan Caddy menyertakan `text/*`, sehingga
  `text/event-stream` (SSE) ikut dikompres dan tertahan di buffer encoder. Matcher respons Caddy tidak
  bisa menegasikan nilai header, jadi daftar tipe yang aman dikompres ditulis satu per satu.
- Header: `Strict-Transport-Security: max-age=31536000` (**tanpa `includeSubDomains`**: domain dipakai
  bersama layanan lain), `Permissions-Policy: camera=(self), microphone=(self), geolocation=()` (kamera =
  foto dokumen, mikrofon = suara), `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, `Reporting-Endpoints` (tujuan laporan CSP).
- CSP **hanya** dari aplikasi (SvelteKit, `report-uri /api/csp-report` + `report-to csp-endpoint`).
- Tanpa opsi global dan tanpa blok situs lain: blok situs pengguna tidak tersentuh.

Langkah host (setiap perubahan Caddy = **izin per kejadian** dari pengguna, lihat `hardening.md`):

1. DNS: A/AAAA untuk host `app` dan `verify` set yang dipilih ke IP VPS (set `fallback` tidak butuh DNS).
2. Salin snippet set yang dipilih ke path tetap milik Urusin (bukan `/etc/caddy`):
   ```sh
   install -m 644 /opt/urusin/deploy/Caddyfile.urusin.fallback /opt/urusin/Caddyfile.urusin   # atau Caddyfile.urusin (primary)
   ```
   `DOMAIN` di `.env` harus sama dengan host `app` set itu (startup aplikasi menolak campuran set).
3. Sekali saja: tambahkan satu baris ke `/etc/caddy/Caddyfile` (di luar blok situs lain):
   ```
   import /opt/urusin/Caddyfile.urusin
   ```
4. Validasi lalu reload (reload tidak memutus situs lain; jangan restart):
   ```sh
   caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Pindah set (mis. fallback -> primary setelah DNS siap): ulangi langkah 2 dan 4, ubah `DOMAIN` di `.env`,
   lalu `./deploy.sh` ulang. Pairing dan tautan pada host lama tidak ikut pindah.
5. Uji header (dari mana saja):
   ```sh
   curl -sI https://$DOMAIN/ | grep -iE 'strict-transport|permissions-policy|cross-origin|reporting-endpoints|content-security'
   curl -sI -H 'Accept-Encoding: gzip' https://$DOMAIN/api/health | grep -i content-encoding
   ```
   `strict-transport-security` tidak boleh memuat `includeSubDomains`; `content-security-policy` muncul
   tepat satu kali.

## Jaringan web dan proxy LLM (host network)

Proxy LLM di host mendengarkan `0.0.0.0:20128`, tetapi `iptables INPUT` men-DROP port 20128/9119/8765 untuk
semua antarmuka kecuali `lo` dan `tailscale0`. Paket dari kontainer di jaringan bridge Docker datang dengan
src `172.x` lewat `br-*`/`docker0`, jadi ikut ter-DROP: web di bridge **tidak bisa** menjangkau proxy.
Firewall tidak diubah; sebagai gantinya:

- `web-blue`/`web-green` memakai `network_mode: host` dengan `HOST=127.0.0.1` dan `PORT=4310`/`4311`
  (adapter-node). Tidak ada `ports:` (tidak valid di host network). Tetap `read_only`, `cap_drop: [ALL]`,
  `no-new-privileges`, healthcheck (memakai `$PORT`), dan batas sumber daya.
- `.env` produksi: `LLM_BASE_URL=http://127.0.0.1:20128/v1` (loopback diizinkan `-i lo`; tidak bergantung
  pada tailscaled). Placeholder saja di `.env.example`; kunci API tetap di `.env` (chmod 600).
- Konsekuensi: web berbagi namespace jaringan host, jadi bind ke `0.0.0.0` akan membuka port ke publik.
  `deploy.sh` memeriksa dengan `ss -ltn` bahwa `4310`/`4311` hanya terikat ke `127.0.0.1` dan menggagalkan
  deploy (rollback) bila tidak. Cek manual: `ss -ltnH 'sport = :4310 or sport = :4311'` harus hanya
  menampilkan `127.0.0.1:...`.
- **Fixtures** tetap di bridge dengan publish `127.0.0.1:4320`: tidak butuh proxy LLM, dan bridge menjaga
  isolasi (konten uji tidak berbagi jaringan host). Hanya web yang pindah.
- Backup/restore memakai `--network none`; tidak terpengaruh. Smoke langsung `deploy.sh` tetap ke
  `127.0.0.1:4310/4311`.
- **`deploy/check-llm-reach.sh <warna>`** (M11a) berjalan di DALAM kontainer: `node -e fetch(${LLM_BASE_URL}/models)`;
  status HTTP apa pun (200/401/403) = terjangkau, timeout/koneksi gagal = gagal. `deploy.sh` memanggilnya
  setelah health dan sebelum promosi: hanya peringatan, kecuali `REQUIRE_LLM=1` (gagal + rollback).
  Jalankan manual: `./check-llm-reach.sh green`.

## Env produksi (placeholder; nilai asli hanya di `.env`, chmod 600)

`.env.example` memuat semua nama. Yang wajib/khusus produksi:

- `DOMAIN`, `SESSION_SECRET`, `LLM_BASE_URL=http://127.0.0.1:20128/v1`, `LLM_API_KEY`, model LLM.
- `URUSIN_PII_KEY` (base64 >= 32 byte, wajib di mode llm; `openssl rand -base64 32`),
  `URUSIN_DAILY_IDR_CAP` (angka > 0, wajib di mode llm), `LLM_EVAL_DAILY_BUDGET_USD`.
- Embedding/rerank (Jina): `LLM_EMBED_BASE_URL`, `LLM_EMBED_API_KEY`, `LLM_EMBED_MODEL`,
  `RERANK_BASE_URL`, `RERANK_API_KEY`, `RERANK_MODEL`.
- IP klien untuk kuota per-IP: compose sudah mengisi `ADDRESS_HEADER=X-Forwarded-For` dan `XFF_DEPTH=1`.
  Caddy adalah satu-satunya hop dan **menimpa** `X-Forwarded-For` dari klien (klien bukan proxy tepercaya),
  jadi entri terakhir = IP klien asli. Diverifikasi dengan Caddy 2 sungguhan: permintaan dengan
  `X-Forwarded-For: 6.6.6.6` sampai ke upstream hanya dengan IP peer asli. Jangan menambah
  `trusted_proxies` di Caddy kecuali ada CDN di depan (itu mengubah `XFF_DEPTH`).

## Login GHCR sementara

`deploy.sh` menghormati `DOCKER_CONFIG` dari lingkungan dan tidak pernah menulis ke konfigurasi docker
pengguna. Pola yang aman untuk pull dengan token sementara:

```sh
export DOCKER_CONFIG="$(mktemp -d /tmp/urusin-docker-XXXX)"; chmod 700 "$DOCKER_CONFIG"
docker login ghcr.io -u bynguts --password-stdin <<<"$GHCR_PAT"   # token lewat stdin, bukan argumen
./deploy.sh <git-sha> sha256:<digest>
rm -rf "$DOCKER_CONFIG"; unset DOCKER_CONFIG
```

## Deploy (blue/green)

SHA dan digest ada di ringkasan job `Release image` di GitHub Actions.

```sh
cd /opt/urusin/deploy
./deploy.sh <git-sha> sha256:<digest>   # digest dari ringkasan job
./deploy.sh <git-sha>                   # digest dicari di GHCR
./deploy.sh sha256:<digest>             # SHA diambil dari label image
```

Urutan `deploy.sh`:

1. `docker pull` berdasarkan digest.
2. **Provenance (#14e), wajib (`REQUIRE_PROVENANCE=1` adalah bawaan)** sebelum `up`:
   label `org.opencontainers.image.revision` harus **SHA git lengkap (40 hex)** dan cocok dengan SHA yang
   diberikan, dan keluaran `docker buildx imagetools inspect --format '{{json .Provenance}}'` harus memuat
   **SHA lengkap yang sama** (bukan substring SHA7). Salah satu gagal = ditolak, tidak ada yang berubah.
   `REQUIRE_PROVENANCE=0` (hanya label) tidak untuk produksi. Catatan jujur: ini mencocokkan _isi_
   metadata provenance; **tanda tangan/attestation tidak diverifikasi secara kriptografis** (belum ada
   cosign/`gh attestation verify`), jadi bukan perlindungan terhadap registry yang disusupi.
3. Menentukan warna aktif dari `.env.images` (`ACTIVE_COLOR`), menaikkan **warna idle**
   (`web-blue` = 4310, `web-green` = 4311), menunggu `/api/health` sehat dengan `gitSha` yang cocok, dan
   memastikan `/api/ready` masih 503 (belum dipromosikan; 404 = image tanpa rute itu, ditolak).
   Warna aktif tidak disentuh.
4. **Promosi**: setelah smoke ke port langsung warna idle lulus, `deploy.sh` menulis `/data/.active-color`
   (volume bersama, lewat `docker compose exec`) berisi nama warna baru. Setiap instance membandingkan
   berkas itu dengan `URUSIN_COLOR`; hanya warna yang dipromosikan menjawab 200 di `/api/ready`, sehingga
   Caddy tidak mengirim lalu lintas ke warna baru (mis. green -> blue, saat blue di 4310 yang diutamakan
   `lb_policy first`) sebelum smoke lulus.
5. Smoke publik bila `DOMAIN` ada di `.env`: `https://$DOMAIN/api/health` (gitSha publik, diulang sampai
   Caddy berpindah), `https://verify.$DOMAIN/` (HTTP < 500) dan masa berlaku sertifikat TLS keduanya
   (> 7 hari, butuh `openssl`). `SKIP_SMOKE=1` melewatinya. Baru setelah lulus warna lama dihentikan,
   **setelah drain**: `deploy.sh` menunggu `runningTurns` di `/api/health` warna lama menjadi 0, paling lama
   `DRAIN_SECONDS` (default 120 = batas turn agen). Image lama tanpa field itu ditunggu penuh; kontainer yang
   sudah mati dilewati; bila batas tercapai ada peringatan lalu tetap dihentikan.
6. **Rollback otomatis**: gagal di langkah 3-5 (tidak sehat, `gitSha` salah, `/api/ready` tidak ada,
   smoke gagal) => `.env.images` dikembalikan ke digest sebelumnya, versi lama dijalankan ulang bila sempat
   berhenti, dipromosikan ulang, warna yang gagal dihentikan, `deploy.sh` exit 1. Sukses mencetak
   `rollback manual: ./deploy.sh <sha> <digest lama>`.

`.env.images` memuat `ACTIVE_COLOR`, `WEB_IMAGE_{BLUE,GREEN}`, `GIT_SHA_{BLUE,GREEN}`,
`RUN_MIGRATIONS_{BLUE,GREEN}`. Idempotent; menjalankan ulang dengan argumen sama aman (warna berganti).
Deploy pertama setelah layout lama (satu service `web`, `WEB_IMAGE=`) dikenali otomatis: kontainer lama
dianggap blue, versi baru naik di green, lalu kontainer lama dihapus.

### Upgrade ke `/api/ready` (sekali saja)

Image lama tidak punya `/api/ready`; bila snippet Caddy baru dimuat saat image lama masih melayani, Caddy
menganggap semua upstream tidak sehat. Urutan aman untuk rilis pertama yang membawa `/api/ready`:

1. `SKIP_SMOKE=1 ./deploy.sh <sha> sha256:<digest>` (kontainer lama, bila layout lama, dihentikan setelah promosi).
2. Baru perbarui snippet Caddy (`/api/ready`) dan `sudo systemctl reload caddy`.
3. Deploy berikutnya berjalan normal dengan smoke publik.

### Migrasi database (hanya satu instance)

Kedua warna memakai volume `data` yang sama (SQLite WAL di satu host aman untuk beberapa proses).
Agar hanya satu instance yang menjalankan migrasi, `deploy.sh` mengisi `RUN_MIGRATIONS=1` **hanya** untuk
warna yang baru dinaikkan dan `0` untuk yang lain; setelah sukses nilainya menjadi `0` lagi. Aplikasi
harus menjalankan migrasi hanya bila `RUN_MIGRATIONS=1` (saat ini belum ada kode migrasi; saat ditambah,
bacalah variabel ini dan bungkus migrasi dalam `BEGIN IMMEDIATE`). Aturan skema: migrasi harus
**kompatibel mundur** (tambah kolom/tabel, jangan hapus/ubah nama dalam rilis yang sama) karena versi
lama masih melayani sampai versi baru sehat dan saat rollback.

### Uji nol respons gagal selama deploy

Rencana uji (jalankan dari laptop/host lain, bukan dari VPS):

```sh
# Terminal 1 (manual): ~20 req/detik, catat kode status selain 2xx/3xx; berjalan sampai Ctrl-C
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/api/health" || echo 000)
  case "$code" in 2*|3*) ;; *) echo "$(date +%T) GAGAL $code" ;; esac
  sleep 0.05
done | tee deploy-failures.log

# Terminal 2 (di VPS): deploy dua kali berturut-turut agar kedua arah (blue->green, green->blue) teruji
./deploy.sh <sha-lama> sha256:<digest-lama>
./deploy.sh <sha-baru> sha256:<digest-baru>
```

Otomatis: `deploy/tests/zero-downtime.sh <sha>@sha256:<digest> <sha>@sha256:<digest>` menembak
`https://$DOMAIN/api/health` (~20 rps, `RPS`/`URL` bisa diubah) selama dua deploy berurutan dan exit 1 bila
ada respons non-2xx/3xx lebih dari `MAX_FAILURES` (default 0) atau deploy gagal. Jalankan di VPS saat gladi,
bukan di CI. Manual (setara):

Lulus bila `deploy-failures.log` kosong untuk kedua deploy. Ulangi sekali dengan SSE aktif
(`curl -N https://$DOMAIN/<rute-sse>`): koneksi lama boleh putus saat warna lama berhenti, tetapi koneksi
baru harus langsung tersambung. Uji negatif: `./deploy.sh <sha> sha256:<digest>` dengan SHA yang salah harus
exit 1 dan log tetap kosong (warna aktif tidak pernah berhenti).

### Image rc dan riwayat

- **Jangan** menjalankan `docker image prune -a` atau `docker system prune -a` di host ini: image yang
  tidak sedang berjalan (termasuk `rc*`) akan terhapus dan rollback manual gagal. Bila perlu membersihkan,
  pakai `docker image prune` (tanpa `-a`, hanya dangling) atau hapus per-digest secara sadar.
- Setiap deploy menambah satu baris ke `.env.images.history` (waktu, warna, SHA, `repo@sha256:digest`);
  berkas ini tidak pernah dipangkas dan menjadi catatan pin digest rc/rilis lama. Salin ke tempat aman
  (mis. ikut backup) dan lakukan `docker pull <repo>@<digest>` untuk menyimpan ulang image rc bila terhapus.
- Image rc juga sebaiknya diberi tag tetap di GHCR (`rc1`) dan dipertahankan dari retensi paket GHCR.

## Backup SQLite (#15)

**Pilihan: skrip cron di host (`backup.sh`), bukan service compose.** Alasan: tetap berjalan saat web mati
atau sedang deploy, tidak menambah kontainer yang selalu hidup di VPS bersama (RAM terbatas), tidak ada
loop `sleep` di dalam kontainer, dan restore memakai alat yang sama. Skrip memakai wadah sementara
**image web kita sendiri** (digest warna aktif dari `.env.images`, atau `BACKUP_IMAGE`) yang sudah berisi
node + `better-sqlite3`: `apps/web/scripts/db-backup.mjs` memakai API backup online `.backup()`, lalu
`PRAGMA integrity_check` pada salinan, dan exit non-zero bila hasilnya bukan `ok`. Skrip dikirim lewat stdin
(`docker run --entrypoint node ... --input-type=module -`), jadi `Dockerfile` tidak perlu menyalinnya, tanpa
jaringan dan rootfs read-only. Tidak ada image pihak ketiga. Konsekuensi: clone repo penuh (skrip dibaca dari
`../apps/web/scripts`, atau set `SCRIPT_DIR`) dan `better-sqlite3` harus menjadi dependency `@urusin/web`.

```sh
sudo mkdir -p /var/backups/urusin && sudo chown "$USER" /var/backups/urusin
# Cron tiap 6 jam (crontab -e):
0 */6 * * *  /opt/urusin/deploy/backup.sh >> /var/log/urusin-backup.log 2>&1
```

- Retensi lokal: 3 hari (`KEEP_DAYS`, selalu menyisakan yang terbaru). Berkas: `urusin-<UTC>.db.gz`, mode 600.
- **Off-site opsional (restic)**: atur lewat environment, tidak ada rahasia di git.
  ```sh
  sudo apt-get install -y restic
  install -m 600 /dev/null /opt/urusin/deploy/.restic-password && $EDITOR /opt/urusin/deploy/.restic-password
  export RESTIC_REPOSITORY=s3:s3.amazonaws.com/<bucket>/urusin   # atau sftp:..., rest:..., b2:...
  export RESTIC_PASSWORD_FILE=/opt/urusin/deploy/.restic-password
  restic init                                                      # sekali saja
  # cron: RESTIC_REPOSITORY=... RESTIC_PASSWORD_FILE=... RESTIC_FORGET=1 backup.sh
  ```
  Tanpa `RESTIC_REPOSITORY`, bagian ini dilewati. Kegagalan restic membuat `backup.sh` exit 1 (salinan lokal
  tetap ada). Kredensial backend (mis. `AWS_ACCESS_KEY_ID`) diberikan lewat environment crontab/`EnvironmentFile`
  milik root, bukan di repo.
- `HEALTHCHECK_URL=https://hc-ping.com/<uuid>` membuat `backup.sh` mem-ping saat sukses dan `/fail` saat gagal
  (healthchecks.io akan memperingatkan bila ping tidak datang dalam 7 jam).

### Restore dan latihan restore (restore drill)

```sh
cd /opt/urusin/deploy
ls -1t /var/backups/urusin | head -3
./restore.sh /var/backups/urusin/urusin-<UTC>.db.gz          # minta konfirmasi; --yes untuk non-interaktif
# dari off-site:
restic restore latest --tag urusin --target /tmp/restore && ./restore.sh /tmp/restore/var/backups/urusin/urusin-<UTC>.db.gz
```

`restore.sh` memakai image dan `apps/web/scripts/db-restore.mjs` yang sama; memvalidasi backup (`integrity_check`) sebelum mengubah apa pun, menghentikan kedua warna web,
menyimpan DB lama sebagai `urusin.db.pre-restore-<UTC>` di volume, mengganti DB, menyalakan warna aktif,
dan menunggu `/api/health`.

Latihan (lakukan sebelum produksi dan catat hasilnya di `docs/` atau issue):

1. `./backup.sh` lalu pastikan berkas baru ada dan tidak kosong.
2. Catat jumlah baris tabel kunci / `curl /api/health`.
3. Ubah data (mis. buat satu catatan uji), lalu `./restore.sh <backup>` .
4. Pastikan data kembali ke kondisi langkah 2, `/api/health` ok, dan `urusin.db.pre-restore-*` ada.
5. Catat tanggal, durasi (RTO) dan umur backup (RPO <= 6 jam) sebagai bukti.

## Alert disk

`disk-alert.sh` memperingatkan (exit 1 + log syslog + notifikasi) bila pemakaian > 85 %:

```sh
# crontab -e, tiap 15 menit. Topik ntfy dibuat sulit ditebak (anggap sebagai rahasia).
*/15 * * * *  NTFY_URL=https://ntfy.sh/<topik-rahasia> MOUNTS="/ /var/lib/docker" /opt/urusin/deploy/disk-alert.sh
```

- **ntfy**: pasang aplikasi ntfy di HP, langganan `<topik-rahasia>`. Tambahkan `NTFY_TOKEN` bila memakai
  server ntfy sendiri dengan autentikasi.
- **healthchecks.io / Uptime Kuma push**: `HEALTHCHECK_URL=https://hc-ping.com/<uuid>`; skrip mem-ping saat
  aman dan `/fail` saat lewat ambang, sehingga mati-nya cron pun terdeteksi.
- Tanpa variabel notifikasi, skrip hanya mencatat log dan exit code. Tidak memakai Telegram.

## Uptime dan halaman status

Tidak ada akun eksternal yang dibuat oleh repo ini. Pilihan:

- **UptimeRobot** (gratis): monitor HTTPS ke `https://$DOMAIN/api/health` (kata kunci `"ok":true`, interval
  5 menit) dan `https://verify.$DOMAIN/`; aktifkan monitor sertifikat/kedaluwarsa TLS dan "Status Page"
  publik; kirim peringatan ke email/ntfy.
- **Uptime Kuma** (self-host, bila RAM cukup; jalankan di mesin lain, bukan di VPS bersama ini): monitor
  HTTP(s) keyword yang sama, halaman status publik, notifikasi ntfy.
- Biarkan monitor menunjuk domain publik (bukan 127.0.0.1) agar mencakup Caddy dan TLS.

## Batas sumber daya

Per kontainer web: `mem_limit: 512m`, `cpus: 1.0`, `pids_limit: 256`; fixtures: `128m`, `0.5`, `128`.
Saat deploy dua warna hidup sebentar (maks 1 GiB dari ~7,6 GiB RAM bebas). Log json-file 3 x 10 MB.

## Profil fixtures (opsional)

```sh
echo 'FIXTURES_IMAGE=ghcr.io/bynguts/urusin-fixtures@sha256:...' >> .env
COMPOSE_PROFILES=fixtures ./deploy.sh <git-sha> sha256:<digest>
```

Port `127.0.0.1:4320`, profil `public` (`FIXTURES_PUBLIC_ORIGIN` diisi compose menjadi
`https://fixtures.$DOMAIN`). Blok Caddy fixtures ada di snippet dalam bentuk **komentar** (nonaktif
bawaan). Untuk mengaktifkan: tambahkan DNS A/AAAA host `fixtures` set itu, bangkitkan snippet dengan blok
aktif (sudah mengirim `X-Robots-Tag: noindex, nofollow` dan `X-Site-Notice: Situs uji - bukan situs pemerintah`)
`node scripts/gen-caddyfile.mjs --set <primary|fallback> --fixtures --out Caddyfile.urusin`, salin ke
`/opt/urusin/Caddyfile.urusin`, `caddy validate`, lalu `systemctl reload caddy` (izin per kejadian).

## Uji skrip (tanpa Docker)

```sh
bash deploy/tests/deploy.test.sh   # docker/curl/restic/df palsu di tests/shims; juga jalan lewat `pnpm test:scripts`
shellcheck -x deploy/*.sh deploy/tests/deploy.test.sh deploy/tests/shims/*
```

Kasus: bind loopback/`REQUIRE_LLM`/jangkauan LLM, render `compose.prod.yml` (`tests/compose-config.test.sh`, memakai `docker compose config` sungguhan bila ada), `zero-downtime.sh` (lulus/gagal), deploy pertama dan kedua (pindah warna), `gitSha` salah / warna baru tidak sehat / smoke publik
gagal (rollback otomatis, exit non-zero), label revision tidak cocok/pendek, provenance tanpa/SHA7 saja/SHA lengkap, `REQUIRE_PROVENANCE=0`,
image tanpa `/api/ready` (ditolak sebelum `up` atau sebelum promosi), migrasi dari layout lama, backup + retensi + restic opsional, alert disk.

### Uji lokal dengan host network (Docker Desktop)

Pada Docker Desktop (Windows/macOS) `network_mode: host` berarti jaringan VM Linux, bukan jaringan laptop:
`127.0.0.1:4310` di laptop tidak menjangkau kontainer. Uji lokal harus menjalankan klien (curl, Caddy,
`ss`, server LLM palsu) di kontainer dengan `--network host` juga; di VPS Linux semuanya langsung bekerja.
Hasil uji lokal yang dilakukan dicatat di laporan PR; yang tidak bisa diuji lokal: perilaku iptables host
nyata dan akses ke proxy LLM sungguhan.

## Uji lokal (laptop)

```sh
cd deploy
cp ../.env.example .env
docker compose -f compose.local.yml --env-file .env up --build   # http://localhost:3000
```

## Data

SQLite (WAL) ada di volume Docker bernama `urusin_data` (`/data` di container), dipakai bersama kedua
warna. Backup rutin: lihat bagian Backup. Cadangan manual sekali jalan: `./backup.sh`.
