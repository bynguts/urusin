# Deploy Urusin

Panduan ringkas menjalankan Urusin di satu host Linux dengan Docker Compose. Image dibangun CI
(`.github/workflows/release.yml`) untuk setiap commit di `main` (amd64 + arm64) dan ditarik host berdasarkan
digest; host tidak pernah build.

## Isi stack (`compose.prod.yml`)

| Layanan                         | Peran                                                                   | Port host          |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| `web-blue` / `web-green`        | Aplikasi SvelteKit, dua warna untuk deploy blue/green                   | `127.0.0.1:4310/1` |
| `pendamping`, `pendamping-edge` | Browser Pendamping (opsional, profil `pendamping`), lihat ADR 0029      | `127.0.0.1:4330`   |
| `embedding`                     | Sidecar embedding self-hosted (opsional, profil `embedding`), fail-open | `127.0.0.1:4340`   |
| `fixtures`                      | Replika portal untuk Mode Uji (opsional, profil `fixtures`)             | `127.0.0.1:4320`   |

Semua port hanya diikat ke loopback. Reverse proxy di depan (Caddy) menangani TLS dan meneruskan host
publik ke web; snippet-nya dibangkitkan dari `hosts.json` oleh `node scripts/gen-caddyfile.mjs`
(`Caddyfile.urusin.primary` / `.fallback`, diperiksa CI). Data disimpan di volume `data` (SQLite, mode WAL).

## Prasyarat

- Linux dengan Docker Engine >= 28 dan Docker Compose v2.
- Reverse proxy TLS di host (Caddy 2 disarankan) dan DNS untuk host `app` dan `verify` di `hosts.json`.
- Endpoint LLM yang kompatibel dengan OpenAI Chat Completions (atau jalankan tanpa LLM, mode demo).
- Akses baca ke image `ghcr.io/bynguts/urusin-*`.

## Konfigurasi

```sh
git clone https://github.com/bynguts/urusin.git /opt/urusin
cd /opt/urusin/deploy
cp ../.env.example .env
chmod 600 .env      # deploy.sh menolak .env yang bisa dibaca group/others
$EDITOR .env
```

Isi minimal: `DOMAIN` (harus host `app` salah satu set di `hosts.json`), `SESSION_SECRET`,
`URUSIN_PII_KEY` (`openssl rand -base64 32`), `URUSIN_DAILY_IDR_CAP`, serta `LLM_BASE_URL`, `LLM_API_KEY`
dan model LLM. Semua nama variabel beserta penjelasannya ada di `.env.example`. Compose menurunkan `ORIGIN`,
`VERIFY_HOST` dan `FIXTURES_HOST` dari `DOMAIN`. `LLM_CAPS_PIN` (opsional) menyematkan flag kapabilitas LLM
sehingga probe saat boot dilewati.

## Deploy (blue/green)

SHA dan digest tersedia di ringkasan job `Release image` di GitHub Actions.

```sh
./deploy.sh <git-sha> sha256:<digest>
```

`deploy.sh` menarik image berdasarkan digest, memeriksa provenance (label revisi dan SHA harus cocok),
menaikkan warna yang menganggur, menunggu `/api/health` sehat, menjalankan smoke test, lalu
mempromosikannya lewat `/api/ready` sehingga reverse proxy berpindah tanpa reload. Warna lama dihentikan
setelah turn yang berjalan selesai. Kegagalan di langkah mana pun memicu rollback otomatis ke digest
sebelumnya. `check-llm-reach.sh <warna>` memeriksa dari dalam kontainer bahwa endpoint LLM terjangkau.

**Migrasi.** Kedua warna berbagi volume `data`; hanya warna yang baru dinaikkan yang menerima
`RUN_MIGRATIONS=1`. Migrasi skema wajib kompatibel mundur karena versi lama tetap melayani sampai versi baru
sehat (dan saat rollback).

Layanan opsional: `pendamping-up.sh` untuk Browser Pendamping, `COMPOSE_PROFILES=embedding` atau
`fixtures` beserta `*_IMAGE@digest` untuk sidecar lainnya. Pemasangan snippet Caddy:
`caddy-install.sh <primary|fallback> --dry-run` dulu, lalu tanpa `--dry-run` (backup, `caddy validate`,
reload, rollback otomatis bila gagal).

## Backup dan restore

- `backup.sh` (dijalankan root lewat cron, mis. tiap 6 jam) memakai image web sendiri untuk membuat salinan
  SQLite online (`.backup()` + `integrity_check`) ke `/var/backups/urusin`, dengan retensi `KEEP_DAYS`.
  Salinan off-site lewat restic bersifat opsional (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`).
- `restore.sh <berkas.db.gz>` memvalidasi backup, menghentikan web, menyimpan DB lama sebagai
  `urusin.db.pre-restore-<UTC>`, mengganti DB, lalu menyalakan warna aktif kembali.
- `disk-alert.sh` (cron) memperingatkan bila pemakaian disk > 85 %; `image-retention.sh` membersihkan image
  `urusin-*` lama secara terarah (dry-run secara bawaan).

## Kunci vault (`URUSIN_PII_KEY`)

Kunci ini membuka Data Diri dan dokumen akun warga: **kehilangan kunci berarti data itu hilang**. Simpan
salinannya di luar host, terpisah dari backup DB. Rotasi: backup, isi `URUSIN_PII_KEY_PREV` dengan kunci lama
dan `URUSIN_PII_KEY` dengan kunci baru, deploy, jalankan `pnpm kek:rotate` (di kontainer:
`node node_modules/@urusin/akun/dist/kek-rotate-cli.js`), lalu hapus `URUSIN_PII_KEY_PREV` dan deploy ulang.

## Keamanan

Web memakai `network_mode: host` dan hanya mengikat `127.0.0.1`; `deploy.sh` memverifikasinya dengan
`ss -ltn` dan membatalkan deploy bila tidak. Semua HTTP keluar server melewati kebijakan egress
`@urusin/egress`. Browser Pendamping berjalan di jaringan internal tanpa rute keluar dengan sandbox Chromium
aktif dan profil seccomp `pendamping-seccomp.json`. Rincian hardening host ada di [hardening.md](hardening.md).

## Uji skrip

`deploy/tests/` berisi harness untuk skrip deploy dengan shim Docker palsu (tanpa Docker sungguhan), dijalankan
di CI. Untuk menjalankan semuanya di satu laptop tanpa host produksi, gunakan `bash scripts/demo-final.sh up`
(`compose.demo.yml`).
