# Deploy Urusin (VPS)

Image web dibangun CI (`.github/workflows/release.yml`) per commit di `main`, multi-arch (amd64 + arm64),
dan ditarik VPS berdasarkan digest. VPS tidak pernah build.

Target: VPS `agent-vm` (Ubuntu 24.04, Docker + compose v2). Caddy sistem sudah memegang 80/443 dan
melayani situs lain; Urusin hanya mengikat `127.0.0.1:4310` (web-blue, host network), `127.0.0.1:4311` (web-green)
dan `127.0.0.1:4320` (fixtures, opsional). Port terpakai lain di host: 3000, 3100, 8000, 8080, 8082,
8765, 20128. VPS dipakai bersama layanan lain: jangan menyentuh kontainer/layanan di luar proyek `urusin`.

Berkas: `compose.prod.yml`, `Caddyfile.urusin.primary` (+ `.fallback`), `hardening.md`, `deploy.sh`, `backup.sh`, `restore.sh`, `disk-alert.sh`,
`tests/` (harness tanpa Docker). Layout datar (agent-vm) juga butuh `scripts/db-backup.mjs` dan `scripts/db-restore.mjs`
(salinan `apps/web/scripts/`), dibaca `backup.sh`/`restore.sh`.

> **Runner CI self-hosted (`ci-runner/`): cadangan bila menit GitHub Actions habis, TIDAK terpasang.**
> Bila pernah dipasang, **WAJIB dicopot sebelum repo dibuat Public** (submission, tenggat 2026-11-14): di repo
> publik PR dari fork bisa menjalankan kode di runner self-hosted, yaitu di agent-vm. Repo publik mendapat menit
> GitHub gratis, jadi runner tidak dibutuhkan lagi. Urutan: `uninstall.sh` (remove-token lewat stdin) →
> `gh variable delete URUSIN_RUNNER --repo bynguts/urusin` → `gh api repos/bynguts/urusin/actions/runners --jq .total_count`
> = 0 → rotasi token admin lokal (tidak pernah ada PAT di box) → baru ubah visibilitas. Detail, batas sumber daya, dan keputusan sudoers vs grup docker:
> [`ci-runner/README.md`](ci-runner/README.md).

## Instalasi pertama

```sh
sudo mkdir -p /opt/urusin && sudo chown "$USER" /opt/urusin
chmod 0751 /opt/urusin   # others hanya --x (user caddy menelusuri ke snippet lama), tidak bisa membaca daftar isi
git clone https://github.com/bynguts/urusin.git /opt/urusin   # atau salin folder deploy/ saja
cd /opt/urusin/deploy

# 1. Login GHCR (repo privat): PAT read:packages saja, di DOCKER_CONFIG sementara (lihat "Login GHCR
#    sementara"); jangan menulis ke ~/.docker milik pengguna.

# 2. Konfigurasi. File ini berisi rahasia: jangan di-commit.
cp ../.env.example .env
chmod 600 .env      # deploy.sh menolak .env/.restic-password yang bisa diakses group/others
$EDITOR .env        # isi DOMAIN, SESSION_SECRET, URUSIN_PII_KEY, LLM_*, VAPID_*, TURNSTILE_*, GOOGLE_*, RESEND_*
```

`.env` di `/opt/urusin/deploy/.env` dibaca compose (`env_file`) dan oleh `deploy.sh`. Izin wajib (diperiksa
`deploy.sh` sebelum menyentuh docker): direktori deploy paling longgar `0751` (bukan 0755/0775), `.env` dan
`.restic-password` `0600`. Di agent-vm berkas deploy ada langsung di `/opt/urusin` (bukan subfolder `deploy/`).
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
| `primary`  | `Caddyfile.urusin.primary`  | `hosts.json` `primary.app`, `primary.verify` |
| `fallback` | `Caddyfile.urusin.fallback` | sslip (`fallback.*`), tanpa DNS sendiri      |

Pemilihan host hanya terjadi di VPS: `.env` (`DOMAIN`) dan salinan snippet set yang sama di
`/etc/caddy/urusin/Caddyfile.urusin`. Image identik untuk kedua set. Isi snippet:

- `reverse_proxy 127.0.0.1:4310 127.0.0.1:4311` dengan `lb_policy first`, health check aktif
  **`/api/ready`** tiap 2 detik (200 hanya pada warna yang dipromosikan `deploy.sh`; `/api/health` tetap liveness, tetapi **publik dijawab 404** oleh `respond /api/health* 404` karena memuat gitSha/versi/runningTurns; hanya `deploy.sh` yang membacanya lewat `127.0.0.1`), dan `lb_try_duration 5s` (permintaan yang gagal tersambung diulang ke
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

Langkah host (setiap perubahan Caddy = **go-ahead pengguna per kejadian**, prosedur lengkap di `hardening.md`):

1. DNS: A/AAAA untuk host `app` dan `verify` set yang dipilih ke IP VPS (set `fallback` tidak butuh DNS).
   `DOMAIN` di `.env` harus sama dengan host `app` set itu (startup aplikasi menolak campuran set).
2. Rencana read-only (boleh kapan saja): `deploy/caddy-install.sh fallback --dry-run` (atau `primary`).
   Snapshot status situs pengguna, validasi snippet dan Caddyfile host, tanpa mengubah apa pun.
3. Setelah go-ahead: `sudo deploy/caddy-install.sh fallback`. Skrip mem-backup Caddyfile (bertimestamp),
   memasang snippet ke path import yang SUDAH ada di Caddyfile (tanpa import: `/etc/caddy/urusin/Caddyfile.urusin`),
   jadi selalu tepat satu baris import snippet Urusin. VPS saat ini meng-import `/opt/urusin/Caddyfile.urusin` (milik
   ubuntu); skrip menolak menulis ke sana sebagai root dan menyarankan
   `TARGET=/etc/caddy/urusin/Caddyfile.urusin` (memindahkan snippet, import lama diganti). Backup ke `/var/backups/urusin-caddy/`,
   `caddy validate`, `systemctl reload caddy` (bukan restart), lalu membandingkan kode status
   gutstore.my.id, admin.gutstore.my.id dan pythia.web.id sebelum/sesudah. Berubah => rollback otomatis.

   **Tata letak VPS saat ini (`/opt/urusin`, milik ubuntu, mode 0751; snippet 0644):** skrip menolak menulis ke
   sana, dan sarannya (`TARGET=/etc/caddy/urusin/...`) mengubah baris import di `/etc/caddy/Caddyfile`, yang
   berada di luar izin per kejadian biasa. Prosedur manual yang setara (dipakai untuk B1, 2026-11-09), dari
   sesi `ubuntu` dengan `sudo -n`, TANPA mengedit `/etc/caddy/Caddyfile`:

   ```sh
   # di laptop, lalu scp ke /tmp di VPS
   node scripts/gen-caddyfile.mjs --set primary [--fixtures] [--pendamping] \
     --import /opt/urusin/Caddyfile.urusin --out /tmp/Caddyfile.urusin.baru
   # di VPS
   SITES="gutstore.my.id admin.gutstore.my.id pythia.web.id www.pythia.web.id agent-vm.tail25a63e.ts.net urusinai.web.id verify.urusinai.web.id"
   snap() { for h in $SITES; do echo "$h $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://$h/)"; done; }
   TS=$(date -u +%Y%m%dT%H%M%SZ); BK=/var/backups/urusin-caddy/$TS; LIVE=/opt/urusin/Caddyfile.urusin
   sudo install -d -m 700 "$BK" && sudo cp -p "$LIVE" /etc/caddy/Caddyfile "$BK/"   # 1. backup bertimestamp
   before=$(snap)                                                                  # 2. snapshot sebelum
   cp -p "$LIVE" "$LIVE.prev-$TS"
   install -m 644 /tmp/Caddyfile.urusin.baru "$LIVE.tmp" && mv "$LIVE.tmp" "$LIVE"  # 3. pasang (atomik)
   sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
     || { cp -p "$LIVE.prev-$TS" "$LIVE"; exit 1; }                               #    gagal: pulihkan, tanpa reload
   sudo systemctl reload caddy || { cp -p "$LIVE.prev-$TS" "$LIVE"; sudo systemctl reload caddy; exit 1; }
   sleep 6; [ "$before" = "$(snap)" ] \
     || { cp -p "$LIVE.prev-$TS" "$LIVE"; sudo systemctl reload caddy; exit 1; }  # 4. berubah: rollback
   ```

   `validate` dijalankan sebagai user `caddy` (bukan root) agar izin bacanya sama dengan Caddy sendiri. Cek
   drift setelahnya: `node scripts/gen-caddyfile.mjs --check --set primary ... --file <salinan terpasang>`.

4. Pindah set (mis. fallback -> primary setelah DNS siap): ulangi langkah 2-3 dengan set baru, ubah `DOMAIN`
   di `.env`, lalu `./deploy.sh` ulang. Pairing dan tautan pada host lama tidak ikut pindah.
5. Uji header (dari mana saja):
   ```sh
   curl -sI https://$DOMAIN/ | grep -iE 'strict-transport|permissions-policy|cross-origin|reporting-endpoints|content-security'
   curl -sI -H 'Accept-Encoding: gzip' https://$DOMAIN/api/ready | grep -i content-encoding
   curl -s -o /dev/null -w '%{http_code}' https://$DOMAIN/api/health   # harus 404
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
  `URUSIN_DAILY_IDR_CAP` (angka > 0, wajib di mode llm).
- Embedding/rerank (Jina): `LLM_EMBED_BASE_URL`, `LLM_EMBED_API_KEY`, `LLM_EMBED_MODEL`,
  `RERANK_BASE_URL`, `RERANK_API_KEY`, `RERANK_MODEL`.
- IP klien untuk kuota per-IP: compose sudah mengisi `ADDRESS_HEADER=X-Forwarded-For` dan `XFF_DEPTH=1`.
  Caddy adalah satu-satunya hop dan **menimpa** `X-Forwarded-For` dari klien (klien bukan proxy tepercaya),
  jadi entri terakhir = IP klien asli. Diverifikasi dengan Caddy 2 sungguhan: permintaan dengan
  `X-Forwarded-For: 6.6.6.6` sampai ke upstream hanya dengan IP peer asli. Jangan menambah
  `trusted_proxies` di Caddy kecuali ada CDN di depan (itu mengubah `XFF_DEPTH`).

- Akun warga (ADR 0028). Selain `URUSIN_PII_KEY` (wajib, lihat bagian kunci vault di bawah), semuanya opsional:
  app tetap boot tanpa kunci-kunci ini.

  | Kunci                                        | Isi dan perilaku                                                                                                                                                                                                         |
  | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `URUSIN_EMAIL_MODE`                          | `resend` atau `log`. Kosong = `resend` bila `RESEND_API_KEY` terisi, selain itu `log`. `log` di produksi menahan email (tanpa tautan di log) dan verifikasi tidak memblokir. `resend` tanpa kunci = server menolak boot. |
  | `RESEND_API_KEY`, `URUSIN_EMAIL_FROM`        | Kunci Resend dan pengirim (SPF/DKIM Resend di DNS domain).                                                                                                                                                               |
  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | Diisi berdua atau dikosongkan berdua (selain itu server menolak boot). Redirect URI `https://<host app>/auth/google/callback` untuk **kedua** set host di `hosts.json`.                                                  |
  | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile untuk "Masuk sebagai juri" dan login setelah 3 kegagalan. Aktif bila `TURNSTILE_SECRET_KEY` terisi (bukan placeholder `ganti-dengan-…`); site key dipakai widget.                                   |
  | `URUSIN_PII_KEY_PREV`                        | Hanya selama rotasi kunci vault (lihat di bawah); hapus setelah `kek:rotate`.                                                                                                                                            |

  Tanpa Turnstile, tombol "Masuk sebagai juri" **tetap jalan** di produksi supaya juri tidak pernah terkunci:
  batas 3 salinan per IP per hari (`URUSIN_DEMO_PER_IP_HARI`), 200 salinan aktif (`URUSIN_DEMO_AKTIF_MAKS`),
  umur 24 jam, dan batas vault tamu/demo tetap berlaku. Server mencatat `[ALERT] Turnstile nonaktif di produksi`
  saat start sebagai pengingat. Dengan Turnstile, token wajib.
  `URUSIN_OIDC_FIXTURE`/`URUSIN_TURNSTILE_FIXTURE` tidak boleh ada di produksi: server menolak boot.

## Kunci vault (`URUSIN_PII_KEY`): escrow dan rotasi

`URUSIN_PII_KEY` menurunkan KEK vault (HKDF `urusin/kek/v1`) dan kunci HMAC placeholder
(`urusin/placeholder-hmac/v1`). **Kehilangan kunci = semua Data Diri dan dokumen akun hilang**, jadi:

- **Escrow:** simpan salinan kunci di luar VPS, terpisah dari backup DB (pengelola sandi pemilik proyek,
  plus satu salinan offline). Jangan pernah di repo, di backup yang sama, atau di chat. Backup DB tanpa kunci
  hanya ciphertext.
- **Rotasi** (kunci bocor, atau terjadwal):
  1. `./backup.sh` (cadangan sebelum rotasi).
  2. Buat kunci baru: `openssl rand -base64 32`. Escrow kunci baru dulu.
  3. Di `.env`: `URUSIN_PII_KEY_PREV=<kunci lama>`, `URUSIN_PII_KEY=<kunci baru>`; deploy. Server membuka DEK
     lama dengan `PREV` dan membungkus ulang secara malas saat dipakai.
  4. Bungkus ulang semuanya sekaligus:
     `docker exec <container> node node_modules/@urusin/akun/dist/kek-rotate-cli.js` (lokal:
     `pnpm kek:rotate`). Keluaran hanya hitungan `{dibungkusUlang, sudahBaru}`.
  5. Hapus `URUSIN_PII_KEY_PREV` dari `.env` dan deploy ulang.
  6. Simpan kunci lama di escrow sampai backup terakhir yang memakainya kedaluwarsa (retensi backup), lalu
     musnahkan.

## Login GHCR sementara

`deploy.sh` tidak pernah menulis ke konfigurasi docker di HOME pengguna. Dua cara:

- `GHCR_TOKEN` (PAT `read:packages`) di lingkungan, tanpa `DOCKER_CONFIG`: `deploy.sh` membuat
  `DOCKER_CONFIG` sementara `/tmp/urusin-docker-XXXXXX` (chmod 700), login lewat stdin, lalu menghapusnya
  saat keluar (sukses, gagal, atau rollback). `GHCR_USER` default `bynguts`.
  ```sh
  read -rs GHCR_TOKEN && export GHCR_TOKEN   # jangan taruh token di riwayat shell
  ./deploy.sh <git-sha> sha256:<digest>
  unset GHCR_TOKEN
  ```
- `DOCKER_CONFIG` yang sudah ada dihormati apa adanya (tanpa login baru):
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
5. Smoke publik bila `DOMAIN` ada di `.env`: `https://$DOMAIN/api/ready` (warna publik = warna baru, diulang
   sampai Caddy berpindah; `gitSha` sudah dicek lewat `127.0.0.1`), peringatan bila `https://$DOMAIN/api/health`
   publik bukan 404 (snippet Caddy lama), `https://verify.$DOMAIN/` (HTTP < 500) dan masa berlaku sertifikat TLS keduanya
   (> 7 hari, butuh `openssl`). `SKIP_SMOKE=1` melewatinya. Baru setelah lulus warna lama dihentikan,
   **setelah drain**: `deploy.sh` menunggu `runningTurns` di `/api/health` warna lama menjadi 0, paling lama
   `DRAIN_SECONDS` (default 120 = batas turn agen). Image lama tanpa field itu ditunggu penuh; kontainer yang
   sudah mati dilewati; bila batas tercapai ada peringatan lalu tetap dihentikan.
6. **Rollback otomatis**: gagal di langkah 3-5 (tidak sehat, `gitSha` salah, `/api/ready` tidak ada,
   smoke gagal) => `.env.images` dikembalikan ke digest sebelumnya, versi lama dijalankan ulang bila sempat
   berhenti, dipromosikan ulang, warna yang gagal dihentikan, `deploy.sh` exit 1. Sukses mencetak
   `rollback manual: ./deploy.sh <sha> <digest lama>`.

`.env.images` memuat `ACTIVE_COLOR`, `WEB_IMAGE_{BLUE,GREEN}`, `GIT_SHA_{BLUE,GREEN}`,
`RUN_MIGRATIONS_{BLUE,GREEN}`. `GIT_SHA_*` hanya catatan untuk rollback: compose tidak meneruskannya ke
kontainer, jadi `gitSha` di `/api/health` selalu SHA yang dibakar ke image. Idempotent; menjalankan ulang dengan argumen sama aman (warna berganti).
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
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/" || echo 000)
  case "$code" in 2*|3*) ;; *) echo "$(date +%T) GAGAL $code" ;; esac
  sleep 0.05
done | tee deploy-failures.log

# Terminal 2 (di VPS): deploy dua kali berturut-turut agar kedua arah (blue->green, green->blue) teruji
./deploy.sh <sha-lama> sha256:<digest-lama>
./deploy.sh <sha-baru> sha256:<digest-baru>
```

Otomatis: `deploy/tests/zero-downtime.sh <sha>@sha256:<digest> <sha>@sha256:<digest>` menembak
`https://$DOMAIN/` (~20 rps, `RPS`/`URL` bisa diubah; bukan `/api/ready`, yang sesaat 503 di warna lama) selama dua deploy berurutan dan exit 1 bila
ada respons non-2xx/3xx lebih dari `MAX_FAILURES` (default 0) atau deploy gagal. Jalankan di VPS saat gladi,
bukan di CI. Manual (setara):

Lulus bila `deploy-failures.log` kosong untuk kedua deploy. Ulangi sekali dengan SSE aktif
(`curl -N https://$DOMAIN/<rute-sse>`): koneksi lama boleh putus saat warna lama berhenti, tetapi koneksi
baru harus langsung tersambung. Uji negatif: `./deploy.sh <sha> sha256:<digest>` dengan SHA yang salah harus
exit 1 dan log tetap kosong (warna aktif tidak pernah berhenti).

### Image rc dan riwayat

- **Jangan pernah** menjalankan `docker image prune` atau `docker system prune` (dengan atau tanpa `-a`) di
  host ini: VPS dipakai bersama layanan lain, dan image yang tidak sedang berjalan (termasuk `rc*`) akan
  terhapus. Retensi image Urusin hanya lewat `./image-retention.sh` (dry-run; `--apply` untuk menghapus):
  `docker image rm <repo>@<digest>` per referensi `ghcr.io/bynguts/urusin-*`, menyimpan digest di
  `.env.images`, `.env.images.keep` (mis. rc1, satu per baris) dan 3 image terakhir dari riwayat
  (`KEEP_LAST`). Lihat `hardening.md`.
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
jaringan dan rootfs read-only. Tidak ada image pihak ketiga. Skrip dibaca dari `./scripts` bila ada (layout datar
`/opt/urusin`), selain itu `../apps/web/scripts` (clone repo penuh), atau set `SCRIPT_DIR`; `better-sqlite3`
harus menjadi dependency `@urusin/web`.

**Jalankan sebagai root.** `BACKUP_DIR` (`/var/backups/urusin`) milik root, mode 755, berkas 600; wadah
backup juga butuh akses root ke volume. Sebagai user biasa skrip berhenti dengan pesan "tidak bisa ditulis".

```sh
# Layout datar: salin skrip DB sekali (dan setiap kali apps/web/scripts/db-*.mjs berubah)
mkdir -p /opt/urusin/scripts
cp apps/web/scripts/db-backup.mjs apps/web/scripts/db-restore.mjs /opt/urusin/scripts/
# Cron tiap 6 jam, milik root (berkas 0644 root:root):
echo '0 */6 * * * root /opt/urusin/backup.sh >> /var/log/urusin-backup.log 2>&1' | sudo tee /etc/cron.d/urusin-backup
sudo env SCRIPT_DIR=/opt/urusin/scripts /opt/urusin/backup.sh   # uji sekali
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
cd /opt/urusin   # layout datar; clone penuh: /opt/urusin/deploy
sudo ls -1t /var/backups/urusin | head -3
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

- **UptimeRobot** (gratis): monitor HTTPS ke `https://$DOMAIN/api/ready` (kata kunci `"ready":true`, interval
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
`node scripts/gen-caddyfile.mjs --set <primary|fallback> --fixtures --out /tmp/Caddyfile.urusin.fixtures`, lalu
pasang lewat `sudo deploy/caddy-install.sh /tmp/Caddyfile.urusin.fixtures` (izin per kejadian).

## Browser Pendamping (opsional, butuh persetujuan port 4330)

Chromium **headed** per sesi warga di Xvfb (lihat [ADR 0029](../docs/adr/0029-browser-pendamping.md)). Image
berbasis `mcr.microsoft.com/playwright:v1.65.0-noble` (~3,6 GB, sudah ada di cache agent-vm). Dua kontainer
dari image yang sama; isolasi murni dari topologi compose (tanpa iptables):

- `pendamping` (Node + Chromium): HANYA di jaringan `pendamping_internal` (`internal: true`,
  `gateway_mode_ipv4: isolated` sehingga host tidak punya alamat di bridge itu, IPv6 mati). Tanpa port,
  tanpa rute default. Sandbox Chromium AKTIF (profil seccomp Playwright `pendamping-seccomp.json`). agent-vm
  mematikan userns tak berhak, jadi dipakai sandbox setuid `chrome-sandbox` (satu-satunya biner SUID di image):
  `cap_add: [SYS_ADMIN, SYS_CHROOT]` dan TANPA `no-new-privileges`, hanya untuk layanan ini (alasan dan
  pengukuran: ADR 0029). Boot gagal-tertutup bila ada rute keluar atau sandbox (userns/setuid) tidak aktif;
  log boot menyebut jenisnya, mis. `sandbox Chromium aktif (setuid chrome-sandbox)`.
- `pendamping-edge` (`node dist/edge-main.js`, non-root, read-only, `cap_drop: [ALL]`, 128 MB): di internal +
  bridge `pendamping_luar`, publish `127.0.0.1:4330`. Proxy balik HANYA `/ws/<uuid>`, `/internal/*`,
  `/health` (dan `/debug*` bila `PENDAMPING_DEBUG_TOKEN` diisi); satu-satunya proxy CONNECT Chromium
  (kredensial acak per sesi, DNS di-resolve edge, setiap alamat diperiksa `checkConnect` profil browser).

Butuh Docker Engine >= 28 (`gateway_mode_ipv4`). `pendamping-seccomp.json` = profil Playwright v1.65.0
`utils/docker/seccomp_profile.json` (sha256 asli `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`)
dengan satu pemangkasan: blok `CAP_SYS_ADMIN` hanya `clone` dan `unshare` (bpf, perf_event_open, mount/umount,
setns, quotactl, lookup_dcookie, fanotify_init, name_to_handle_at, syslog, sethostname, setdomainname dibuang),
dan `setns` dibuang dari blok userns; `io_uring_setup`/`io_uring_enter`/`io_uring_register` juga dibuang
(Chromium tidak memakainya; permukaan kernel besar). Diukur: sandbox setuid (userns mati) dan userns tetap
aktif. sha256 kini `68e0e88693f1d6bbc30616f3adf713b170da3937fdc43e72e0ac69f7571a0bfc`; ikut tersalin bersama
`compose.prod.yml`.

```sh
# .env (rahasia, chmod 600)
PENDAMPING_IMAGE=ghcr.io/bynguts/urusin-pendamping@sha256:...
PENDAMPING_INTERNAL_TOKEN=$(openssl rand -hex 32)      # sama untuk web dan pendamping
PENDAMPING_INTERNAL_URL=http://127.0.0.1:4330         # dibaca web (dilayani pendamping-edge)
PENDAMPING_EDGE_TOKEN=$(openssl rand -hex 32)         # pendamping <-> edge; BEDA dari token internal
PENDAMPING_DEBUG_TOKEN=$(openssl rand -hex 32)        # opsional, untuk uji kemudi manual

bash deploy/pendamping-up.sh   # menolak Docker Engine < 28, lalu up -d pendamping + pendamping-edge
docker compose -f compose.prod.yml logs pendamping | tail -1   # "pendamping mendengarkan di 172.x.y.z:4330 ..."
curl -fsS http://127.0.0.1:4330/health                # {"ok":true,"aktif":0,"maks":2,"menunggu":0}
```

Bila `pendamping` terus restart dengan "sandbox Chromium tidak aktif" atau "punya rute keluar langsung",
itu disengaja (gagal tertutup): jangan menambal dengan `--no-sandbox` atau jaringan lain; laporkan ke lead.
Uji topologi tanpa image Urusin: `bash deploy/tests/pendamping-isolation.test.sh` (busybox, jaringan asli).

**Uji klik manusia (mode debug, tanpa Caddy):** dari laptop penguji,
`ssh -L 4330:127.0.0.1:4330 agent-vm`, buka `http://localhost:4330/debug`, isi token debug dan URL domain
resmi (mis. halaman login Telunjuk Sakti), lalu kemudikan layar dengan mouse/sentuh. Bila muncul kotak
centang verifikasi situs, klik sendiri; AI tidak pernah mengklik-nya. Tidak ada AI di mode ini. Matikan
dengan mengosongkan `PENDAMPING_DEBUG_TOKEN`.

**Mode Uji (juri dan tamu):** web menandai setiap sesi; hanya akun warga biasa pemilik urusan yang dibuka ke
portal resmi asli. Salinan demo juri dan tamu selalu dibuka ke replika di `https://fixtures.$DOMAIN`
(`PENDAMPING_ORIGIN_OVERRIDES` di `compose.prod.yml`, butuh profil `fixtures`); situs tanpa replika ditolak, tidak
pernah jatuh ke situs asli. Edge harus bisa tersambung ke `fixtures.$DOMAIN:443` (IP publik host sendiri).

**WebSocket untuk warga:** setelah port disetujui, bangkitkan snippet dengan blok `handle /pendamping/ws/*`
aktif, misalnya `node scripts/gen-caddyfile.mjs --set primary --fixtures --pendamping
--import /opt/urusin/Caddyfile.urusin --out /tmp/Caddyfile.urusin` (`--import` hanya mengisi komentar baris
import; path snippet yang dipakai VPS saat ini), lalu pasang lewat `caddy-install.sh` (izin per kejadian).
Snippet yang terpasang bisa dicek ulang dengan flag yang sama: `... --check --set primary --fixtures
--pendamping --import ... --file /opt/urusin/Caddyfile.urusin` (exit 1 bila menyimpang). Hanya jalur itu yang
diteruskan; edge merutekan jalur MENTAH yang kanonik, jadi `/ws/..%2finternal`, `/ws/%2e%2e/internal`,
`/ws/../internal`, `//internal`, dan `/ws/..;/debug` mendapat 404.

**Worker tambahan (opsional, mis. laptop anggota berjaringan Indonesia):** jalankan image yang sama
(digest sama) dengan `PENDAMPING_INTERNAL_TOKEN` yang sama, `HOST=<IP Tailscale worker>`,
`URUSIN_PUBLIC_ORIGIN=https://$DOMAIN`, dan `PENDAMPING_PUBLIC_WS_URL=wss://$DOMAIN/pendamping/w/<id>/ws`.
Di web, ganti `PENDAMPING_INTERNAL_URL` dengan `PENDAMPING_WORKERS` (lihat `.env.example`), mis.
`[{"id":"vps","url":"http://127.0.0.1:4330","region":"umum","maxSessions":2},{"id":"laptop-a","url":"http://100.x.y.z:4330","region":"id","maxSessions":1}]`.
Kanal web -> worker ditandatangani HMAC (bukan bearer polos), dan web memeriksa `GET /health` tiap worker.
Situs `aksesWilayah: 'id-only'` (Telunjuk Sakti, Si D'nOK) hanya dirutekan ke worker `region: "id"`; bila
semua mati, urusan beralih ke mode dipandu dengan pesan jujur. Rute WS worker tambahan butuh blok Caddy
sendiri (dikerjakan lead): `handle_path /pendamping/w/<id>/*` -> `reverse_proxy 100.x.y.z:4330`.

**Egress hulu (opsional):** `PENDAMPING_UPSTREAM_PROXY=http://[user:pass@]host:port` (dipakai EDGE)
mengarahkan CONNECT peramban yang SUDAH lolos kebijakan ke proxy milik operator (mis. egress Indonesia untuk
situs yang menolak IP datacenter). Proxy hulu harus terjangkau dari bridge `pendamping_luar` (bukan
127.0.0.1 host). Urusin tidak menyediakan proxy hulu. Catatan: lewat proxy hulu, edge mengirim CONNECT
dengan NAMA host (setelah nama itu dan semua alamatnya lolos kebijakan di edge); proxy hulu me-resolve
nama itu lagi di sisi operator, jadi alamat yang akhirnya dihubungi ditentukan DNS proxy hulu. Pakai hanya
proxy milik sendiri yang resolvernya dipercaya.

Batas `pendamping`: `mem_limit`/`memswap_limit 1300m` (2 sesi x 512 MB + Node/Xvfb), pengawas menghentikan
sesi di 450 MB RSS, `cpus: 1.0`, `cpu_shares: 256`, `pids_limit: 512`, `/tmp` tmpfs 768 MB, `ulimits core 0`,
`init: true`. `pendamping-edge`: 128 MB, `cpus: 0.5`, `pids_limit: 64`.

## Uji skrip (tanpa Docker)

```sh
bash deploy/tests/deploy.test.sh   # docker/curl/restic/df palsu di tests/shims; juga jalan lewat `pnpm test:scripts`
bash deploy/tests/image-retention.test.sh
bash deploy/tests/caddy-install.test.sh
bash deploy/tests/ci-runner.test.sh       # runner CI self-hosted (docker/df palsu di tests/shims-ci)
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
