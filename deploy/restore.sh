#!/usr/bin/env bash
# Pulihkan SQLite Urusin dari backup.sh (berkas .db atau .db.gz). Menghentikan web, menyimpan DB
# lama sebagai `<DB_FILE>.pre-restore-<waktu>` di volume, lalu memulai web aktif dan menunggu sehat.
#
#   deploy/restore.sh /var/backups/urusin/urusin-20261110T060000Z.db.gz [--yes]
#   restic restore latest --tag urusin --target /tmp/restore   # lalu beri berkas dari sana
#
# Variabel: DATA_VOLUME, DB_FILE, SQLITE_IMAGE (sama seperti backup.sh), HEALTH_WAIT (default 60 detik).
set -euo pipefail

cd "$(dirname "$0")"

DATA_VOLUME="${DATA_VOLUME:-urusin_data}"
DB_FILE="${DB_FILE:-urusin.db}"
SQLITE_IMAGE="${SQLITE_IMAGE:-keinos/sqlite3:3.47.2}"
HEALTH_WAIT="${HEALTH_WAIT:-60}"

die() { echo "restore: $*" >&2; exit 1; }

[ $# -ge 1 ] && [ $# -le 2 ] || die "pemakaian: $0 <backup.db|backup.db.gz> [--yes]"
src="$1"; yes="${2:-}"
[ -f "$src" ] || die "berkas tidak ada: $src"
[ -z "$yes" ] || [ "$yes" = "--yes" ] || die "argumen kedua hanya boleh --yes"
command -v docker >/dev/null || die "docker tidak ditemukan"
[ -f .env ] || die ".env tidak ada"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
case "$src" in
  *.gz) gzip -dc "$src" > "$work/restore.db" ;;
  *) cp "$src" "$work/restore.db" ;;
esac

# Validasi backup SEBELUM mengubah apa pun.
check() {
  docker run --rm --network none --read-only --user 0:0 -v "$work:/w:ro" --entrypoint sh "$SQLITE_IMAGE" -c \
    '[ "$(sqlite3 "file:/w/restore.db?mode=ro" "PRAGMA integrity_check;")" = ok ]'
}
check || die "integrity_check backup GAGAL; tidak ada yang diubah"
echo "restore: backup valid ($src)"

if [ "$yes" != "--yes" ]; then
  read -r -p "Ini MENGGANTI database produksi (DB lama disimpan sebagai pre-restore). Lanjut? [ketik 'ya'] " answer
  [ "$answer" = "ya" ] || die "dibatalkan"
fi

active=""
[ -f .env.images ] && active="$(sed -n 's/^ACTIVE_COLOR=//p' .env.images | head -n1)"
active="${active:-blue}"
compose=(docker compose -f compose.prod.yml --env-file .env --env-file .env.images)

echo "restore: menghentikan web-blue dan web-green"
"${compose[@]}" stop web-blue web-green

ts="$(date -u +%Y%m%dT%H%M%SZ)"
docker run --rm --network none --user 0:0 -v "${DATA_VOLUME}:/data" -v "$work:/w:ro" --entrypoint sh "$SQLITE_IMAGE" -c '
  set -e
  db="/data/$1"
  if [ -f "$db" ]; then
    mv "$db" "$db.pre-restore-$2"
    rm -f "$db-wal" "$db-shm"
    owner="$(stat -c %u:%g "$db.pre-restore-$2")"
  else
    owner="$(stat -c %u:%g /data)"
  fi
  cp /w/restore.db "$db"
  chown "$owner" "$db"
  chmod 600 "$db"
' sh "$DB_FILE" "$ts"
echo "restore: DB diganti; DB lama: ${DB_FILE}.pre-restore-${ts} (di volume ${DATA_VOLUME})"

echo "restore: memulai web-${active}"
"${compose[@]}" up -d "web-$active"
port=4310; [ "$active" = green ] && port=4311
for _ in $(seq 1 "$HEALTH_WAIT"); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    echo "restore: OK, web-${active} sehat"
    exit 0
  fi
  sleep 1
done
die "web-${active} tidak sehat setelah restore; periksa: docker compose logs web-${active}"
