# Hardening host dan izin deploy

VPS `agent-vm` (aarch64, Ubuntu 24.04) dipakai bersama produksi pengguna: Caddy sistem untuk situs lain,
proxy LLM di `:20128`, kontainer lain, dan aturan iptables khusus. Dokumen ini mencatat **setiap** tulisan
Urusin ke host dan izin yang dibutuhkan untuk masing-masing. Apa pun yang tidak tercantum di sini bukan
milik Urusin dan tidak disentuh.

## Model izin

| Jenis            | Cakupan                                                                                                                                                                    | Izin                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Tetap (standing) | `deploy.sh` (termasuk rollback otomatis), rollback manual, `backup.sh`, `restore.sh`, `image-retention.sh --apply`, `disk-alert.sh`                                        | Satu kali dari pengguna, dicatat di sini. Hanya sumber daya Urusin di tabel "Tulisan host". |
| Per kejadian     | Memasang atau mengubah `/opt/urusin/Caddyfile.urusin`, menambah baris `import` di `/etc/caddy/Caddyfile`, `caddy reload`                                                   | Minta izin setiap kali, sebutkan perubahan persisnya (diff snippet + host).                 |
| Tidak pernah     | Mengedit blok situs lain di Caddy, restart Caddy, iptables/ufw/tailscale, `daemon.json`, `docker system/image prune`, kontainer/volume/network/image non-Urusin, proxy LLM | Tidak ada izin yang mencakup ini.                                                           |

- Status izin tetap: **belum diberikan** (ditanyakan di review v11, belum dijawab). Sampai diberikan, lead
  meminta izin per deploy.
- Bila DNS domain utama sudah resolve tetapi pengguna tidak bisa dihubungi untuk izin Caddy, `DOMAIN` tetap
  di set `fallback` (sslip). Pindah set butuh izin per kejadian (snippet baru + reload).
- Agen tidak men-deploy; hanya lead. Pemeriksaan read-only (`ss -ltn`, `docker ps`, `caddy version`)
  tidak butuh izin.

## Tulisan host

| Lokasi / sumber daya                                                     | Ditulis oleh                           | Isi                                                                                 | Catatan                                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/opt/urusin/`                                                           | instalasi pertama (`git clone`)        | repo; `deploy/` dipakai di host                                                     | milik user deploy, bukan root                                                              |
| `/opt/urusin/deploy/.env`                                                | manual (lead)                          | rahasia produksi                                                                    | `chmod 600`; tidak pernah di-commit                                                        |
| `/opt/urusin/deploy/.env.images`                                         | `deploy.sh` (atomik, `umask 077`)      | digest per warna, warna aktif                                                       | rollback menulis ulang dari nilai sebelumnya                                               |
| `/opt/urusin/deploy/.env.images.history`                                 | `deploy.sh` (append)                   | waktu, warna, SHA, `repo@digest`                                                    | tidak dipangkas; sumber retensi                                                            |
| `/opt/urusin/deploy/.env.images.keep`                                    | manual (lead)                          | digest yang wajib disimpan (mis. rc1)                                               | dibaca `image-retention.sh`                                                                |
| `/opt/urusin/Caddyfile.urusin`                                           | manual, izin per kejadian              | salinan `deploy/Caddyfile.urusin[.fallback]`                                        | satu-satunya file yang di-`import` Caddy                                                   |
| `/etc/caddy/Caddyfile`                                                   | manual, izin per kejadian, sekali      | satu baris `import /opt/urusin/Caddyfile.urusin`                                    | blok situs lain tidak disentuh                                                             |
| `DOCKER_CONFIG` sementara `/tmp/urusin-docker-XXXXXX`                    | `deploy.sh` bila `GHCR_TOKEN` diset    | login GHCR (`read:packages`)                                                        | `chmod 700`, dihapus saat skrip keluar; `~/.docker` pengguna tidak disentuh                |
| Kontainer `urusin-web-blue-1`, `urusin-web-green-1`, `urusin-fixtures-1` | `deploy.sh` (compose project `urusin`) | web (network host, bind `127.0.0.1:4310/4311`), fixtures (bridge, `127.0.0.1:4320`) | `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, batas mem/cpu/pids                    |
| Volume `urusin_data`                                                     | compose                                | SQLite (WAL) + penanda warna aktif `/data/.active-color`                            | penanda ditulis `deploy.sh` lewat `docker compose exec`, di dalam volume, bukan di FS host |
| Network `urusin_default`                                                 | compose                                | bridge untuk fixtures                                                               | web memakai network host, tidak membuat network                                            |
| Log kontainer                                                            | Docker json-file per service           | `max-size: 10m`, `max-file: 3` di `compose.prod.yml`                                | **bukan** `daemon.json` (mengubahnya me-restart semua kontainer)                           |
| Image `ghcr.io/bynguts/urusin-*`                                         | `deploy.sh` (`docker pull` per digest) | arm64                                                                               | retensi lihat di bawah                                                                     |
| `/var/backups/urusin/` (`BACKUP_DIR`)                                    | `backup.sh` (cron)                     | `urusin-*.db.gz`, `.lock.d`, `.partial.db` sementara                                | retensi `KEEP_DAYS`; restic off-site opsional                                              |
| `/var/log/urusin-backup.log`                                             | cron `backup.sh`                       | log backup                                                                          |                                                                                            |
| crontab user deploy                                                      | manual (lead)                          | baris `backup.sh` dan `disk-alert.sh`                                               | lihat README "Backup" dan "Alert disk"                                                     |

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
  - **Bind**: `HOST=127.0.0.1`. `deploy.sh` memeriksa dengan `ss -ltn` bahwa `4310`/`4311` tidak terikat
    ke `0.0.0.0`/`::`, dan menggagalkan deploy (rollback) bila terikat.
  - **Egress** (`@urusin/egress`): semua HTTP keluar server lewat satu Agent undici.
    - Tujuan diperiksa sebelum tersambung, dan setiap alamat hasil DNS diperiksa juga. Loopback, privat,
      link-local (termasuk `169.254.169.254`), CGNAT `100.64/10` dan padanan IPv6 ditolak.
    - Satu-satunya pengecualian lokal adalah persis `127.0.0.1:20128`, yaitu proxy LLM.
    - Host lain hanya dari allowlist: Jina, registry domain resmi, `*.go.id`, dan base URL LLM dari env.
    - Redirect diikuti manual, dan setiap hop diperiksa ulang.
    - ESLint melarang `fetch`, `undici`, dan `node:http(s)`/`net`/`tls` mentah di kode server di luar modul itu.
    - Tes membuktikan `127.0.0.1:2019` (admin Caddy), `:4320`, `:22` dan metadata cloud tidak terjangkau.
- Fixtures tetap di bridge, tanpa akses ke proxy dan tanpa berbagi jaringan host.

## Caddy

- Snippet literal dari `deploy/hosts.json` (`node scripts/gen-caddyfile.mjs`, dicek CI). Tidak ada
  placeholder `{$…}`, jadi environment proses Caddy tidak pernah diubah dan Caddy tidak pernah di-restart.
- Isinya hanya blok situs Urusin dan snippet `(urusin_common)`, tanpa opsi global. CSP hanya dari aplikasi.
- Setiap perubahan:
  1. salin snippet set yang dipilih ke `/opt/urusin/Caddyfile.urusin`;
  2. `caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile`;
  3. `systemctl reload caddy`.

  Semua langkah ini dengan izin per kejadian.
