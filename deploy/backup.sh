#!/usr/bin/env bash
# Backup online SQLite Urusin (cron host tiap 6 jam). Aman saat web berjalan: memakai API backup
# SQLite (`.backup`), bukan menyalin berkas -wal/-shm. Lihat deploy/README.md bagian "Backup".
#
#   0 */6 * * *  /opt/urusin/deploy/backup.sh >> /var/log/urusin-backup.log 2>&1
#
# Variabel (semua opsional):
#   BACKUP_DIR           tujuan lokal (default /var/backups/urusin)
#   KEEP_DAYS            retensi lokal dalam hari (default 3)
#   DATA_VOLUME          volume Docker data (default urusin_data)
#   DB_FILE              nama berkas DB di volume (default urusin.db)
#   SQLITE_IMAGE         image berisi CLI sqlite3 (default keinos/sqlite3:3.47.2; pin digest bila bisa)
#   RESTIC_REPOSITORY    bila diset: kirim backup terbaru ke repo restic (off-site)
#   RESTIC_PASSWORD_FILE berkas kata sandi restic (dibaca restic; jangan di git)
#   RESTIC_FORGET=1      jalankan `restic forget --keep-daily 14 --keep-weekly 8 --prune`
#   HEALTHCHECK_URL      ping healthchecks.io/Uptime Kuma push saat sukses; "/fail" saat gagal
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/urusin}"
KEEP_DAYS="${KEEP_DAYS:-3}"
DATA_VOLUME="${DATA_VOLUME:-urusin_data}"
DB_FILE="${DB_FILE:-urusin.db}"
SQLITE_IMAGE="${SQLITE_IMAGE:-keinos/sqlite3:3.47.2}"

log() { echo "backup: $(date -u +%FT%TZ) $*"; }
ping_hc() { # suffix
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECK_URL}$1" || log "peringatan: ping healthcheck gagal"
}
fail() { log "GAGAL: $*" >&2; ping_hc /fail; exit 1; }

command -v docker >/dev/null || fail "docker tidak ditemukan"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$KEEP_DAYS" -ge 1 ] || fail "KEEP_DAYS harus bilangan bulat >= 1"

umask 077
mkdir -p "$BACKUP_DIR"

# Satu proses pada satu waktu (kunci mkdir; kunci basi > 2 jam dianggap sisa crash).
lock="$BACKUP_DIR/.lock.d"
find "$lock" -maxdepth 0 -mmin +120 -exec rm -rf {} + 2>/dev/null || true
mkdir "$lock" 2>/dev/null || { log "backup lain masih berjalan; dilewati"; exit 0; }
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

partial="$BACKUP_DIR/.partial.db"
rm -f "$partial" "$partial.gz"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/urusin-${stamp}.db.gz"

# Wadah sementara: tanpa jaringan, rootfs read-only. Volume data di-mount rw karena membaca DB mode
# WAL membutuhkan akses ke -shm. `.backup` membuat salinan konsisten; lalu integrity_check pada salinan.
log "mulai backup ${DATA_VOLUME}/${DB_FILE}"
docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges:true \
  -v "${DATA_VOLUME}:/data" -v "${BACKUP_DIR}:/backup" --entrypoint sh "$SQLITE_IMAGE" -c '
    set -e
    sqlite3 "/data/$1" ".timeout 15000" ".backup /backup/.partial.db"
    [ "$(sqlite3 /backup/.partial.db "PRAGMA integrity_check;")" = ok ]
  ' sh "$DB_FILE" || { rm -f "$partial"; fail "sqlite .backup/integrity_check gagal"; }

[ -s "$partial" ] || fail "hasil backup kosong"
gzip -c "$partial" > "$final.tmp" && mv "$final.tmp" "$final"
rm -f "$partial"
log "OK $final ($(wc -c < "$final") byte)"

# Retensi lokal: hapus yang lebih tua dari KEEP_DAYS hari, tetapi selalu sisakan yang terbaru.
find "$BACKUP_DIR" -maxdepth 1 -name 'urusin-*.db.gz' ! -newer "$final" -mmin +$((KEEP_DAYS * 24 * 60)) -delete

# Off-site (opsional).
if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  command -v restic >/dev/null || fail "RESTIC_REPOSITORY diset tetapi restic tidak terpasang"
  restic backup --tag urusin --host urusin "$final" || fail "restic backup gagal (backup lokal tetap ada)"
  if [ "${RESTIC_FORGET:-0}" = 1 ]; then
    restic forget --tag urusin --keep-daily 14 --keep-weekly 8 --prune || fail "restic forget gagal"
  fi
  log "off-site restic OK"
fi

ping_hc ""
