#!/usr/bin/env bash
# Pulihkan SQLite Urusin dari backup.sh (berkas .db atau .db.gz). Menghentikan web, menyimpan DB
# lama sebagai `<DB_FILE>.pre-restore-<waktu>` di volume, lalu memulai web aktif dan menunggu sehat.
#
#   deploy/restore.sh /var/backups/urusin/urusin-20261110T060000Z.db.gz [--yes]
#   restic restore latest --tag urusin --target /tmp/restore   # lalu beri berkas dari sana
#
# Variabel: DATA_VOLUME, DB_FILE, BACKUP_IMAGE, SCRIPT_DIR (sama seperti backup.sh), HEALTH_WAIT (default 60 detik).
# Memakai image web kita sendiri (digest dari .env.images), bukan image pihak ketiga.
set -euo pipefail

cd "$(dirname "$0")"

DATA_VOLUME="${DATA_VOLUME:-urusin_data}"
DB_FILE="${DB_FILE:-urusin.db}"
if [ -z "${SCRIPT_DIR:-}" ]; then
  if [ -f scripts/db-restore.mjs ]; then SCRIPT_DIR=scripts; else SCRIPT_DIR=../apps/web/scripts; fi
fi
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

active=""
[ -f .env.images ] && active="$(sed -n 's/^ACTIVE_COLOR=//p' .env.images | head -n1)"
active="${active:-blue}"
image="${BACKUP_IMAGE:-$(sed -n "s/^WEB_IMAGE_$(printf '%s' "$active" | tr '[:lower:]' '[:upper:]')=//p" .env.images 2>/dev/null | head -n1)}"
[ -n "$image" ] || die "image web tidak diketahui (.env.images kosong dan BACKUP_IMAGE tidak diset)"
[ -f "$SCRIPT_DIR/db-restore.mjs" ] || die "$SCRIPT_DIR/db-restore.mjs tidak ada (salin apps/web/scripts/db-*.mjs ke ./scripts, clone repo penuh, atau set SCRIPT_DIR)"

# Jalankan db-restore.mjs di wadah image web (skrip lewat stdin). Argumen: env tambahan (-e ...).
run_restore() {
  docker run --rm -i --network none --user 0:0 -v "${DATA_VOLUME}:/data" -v "$work:/w:ro" "$@"     -e SRC_PATH=/w/restore.db -e "DB_PATH=/data/${DB_FILE}" --entrypoint node "$image"     --input-type=module - < "$SCRIPT_DIR/db-restore.mjs"
}

# Validasi backup SEBELUM mengubah apa pun (CHECK_ONLY: hanya integrity_check).
run_restore -e CHECK_ONLY=1 || die "integrity_check backup GAGAL; tidak ada yang diubah"
echo "restore: backup valid ($src)"

if [ "$yes" != "--yes" ]; then
  read -r -p "Ini MENGGANTI database produksi (DB lama disimpan sebagai pre-restore). Lanjut? [ketik 'ya'] " answer
  [ "$answer" = "ya" ] || die "dibatalkan"
fi

compose=(docker compose -f compose.prod.yml --env-file .env --env-file .env.images)

echo "restore: menghentikan web-blue dan web-green"
"${compose[@]}" stop web-blue web-green

ts="$(date -u +%Y%m%dT%H%M%SZ)"
run_restore -e "STAMP=$ts" || die "db-restore gagal; web masih berhenti, periksa volume ${DATA_VOLUME}"
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
