# Deploy Urusin (VPS)

Image web dibangun CI (`.github/workflows/release.yml`) per commit di `main`, multi-arch (amd64 + arm64),
dan ditarik VPS berdasarkan digest. VPS tidak pernah build.

Target: VPS `agent-vm` (Ubuntu 24.04, Docker + compose v2). Caddy sistem sudah memegang 80/443 dan
melayani situs lain; Urusin hanya mengikat `127.0.0.1:4310` (web) dan `127.0.0.1:4320` (fixtures, opsional).
Port terpakai lain di host: 3000, 3100, 8000, 8080, 8082, 8765, 20128.

## Instalasi pertama

```sh
sudo mkdir -p /opt/urusin && sudo chown "$USER" /opt/urusin
git clone https://github.com/bynguts/urusin.git /opt/urusin   # atau salin folder deploy/ saja
cd /opt/urusin/deploy

# 1. Login GHCR (repo privat): PAT dengan scope read:packages saja
echo "$GHCR_PAT" | docker login ghcr.io -u bynguts --password-stdin

# 2. Konfigurasi. File ini berisi rahasia: jangan di-commit.
cp ../.env.example .env
chmod 600 .env
$EDITOR .env        # isi DOMAIN, SESSION_SECRET, LLM_*, VAPID_*, TURNSTILE_*
```

`.env` di `/opt/urusin/deploy/.env` dibaca compose (`env_file`) dan oleh `deploy.sh`.
`DOMAIN` wajib (mis. `urusin.web.id`); `ORIGIN` diturunkan otomatis menjadi `https://$DOMAIN`.

## Caddy (host)

Snippet `Caddyfile.urusin` mendefinisikan `{$DOMAIN}` dan `verify.{$DOMAIN}` ke `127.0.0.1:4310`
(SSE tanpa buffering, zstd/gzip, header keamanan + HSTS; CSP hanya dari aplikasi).

1. DNS: A/AAAA untuk `DOMAIN` dan `verify.DOMAIN` ke IP VPS.
2. Beri Caddy variabel `DOMAIN`. Untuk Caddy via systemd:
   ```sh
   sudo systemctl edit caddy
   # tambahkan:
   # [Service]
   # Environment=DOMAIN=urusin.web.id
   ```
3. Tambahkan satu baris ke `/etc/caddy/Caddyfile` (di luar blok situs lain):
   ```
   import /opt/urusin/deploy/Caddyfile.urusin
   ```
4. Validasi lalu reload (tanpa memutus situs lain):
   ```sh
   sudo systemctl restart caddy   # hanya setelah `edit` di atas; berikutnya cukup reload
   caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

## Deploy

SHA dan digest ada di ringkasan job `Release image` di GitHub Actions.

```sh
cd /opt/urusin/deploy
./deploy.sh <git-sha> sha256:<digest>   # digest dari ringkasan job
./deploy.sh <git-sha>                   # digest dicari di GHCR
./deploy.sh sha256:<digest>             # SHA diambil dari label image
```

Skrip: pull berdasarkan digest, tulis `.env.images` (`WEB_IMAGE`, `GIT_SHA`), `docker compose up -d`,
menunggu `http://127.0.0.1:4310/api/health`, dan **gagal bila `gitSha` tidak sama** dengan argumen.
Idempotent; menjalankan ulang dengan argumen yang sama aman.

Rollback: skrip mencetak `rollback: ./deploy.sh sha256:<digest sebelumnya>` saat selesai atau gagal.

## Profil fixtures (opsional)

```sh
echo 'FIXTURES_IMAGE=ghcr.io/bynguts/urusin-fixtures@sha256:...' >> .env
COMPOSE_PROFILES=fixtures ./deploy.sh <git-sha> sha256:<digest>
```

Port `127.0.0.1:4320`; routing Caddy-nya ditambahkan terpisah setelah host fixtures ditetapkan.

## Uji lokal (laptop)

```sh
cd deploy
cp ../.env.example .env
docker compose -f compose.local.yml --env-file .env up --build   # http://localhost:3000
```

## Data

SQLite (WAL) ada di volume Docker bernama `urusin_data` (`/data` di container). Cadangkan dengan
`docker run --rm -v urusin_data:/data -v "$PWD":/backup alpine tar czf /backup/data.tgz -C /data .`
(hentikan web dulu agar WAL konsisten).
