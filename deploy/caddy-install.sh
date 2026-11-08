#!/usr/bin/env bash
# Pasang atau ubah snippet Caddy Urusin di Caddy sistem (host dipakai bersama situs pengguna).
# SETIAP pemakaian tanpa --dry-run butuh IZIN PER KEJADIAN dari pengguna (lihat hardening.md).
# Agen tidak pernah menjalankan skrip ini ke VPS; hanya lead, setelah pengguna setuju.
#
#   deploy/caddy-install.sh <primary|fallback|berkas-snippet> --dry-run   # hanya baca: rencana + validasi
#   sudo deploy/caddy-install.sh <primary|fallback|berkas-snippet>        # pasang + reload
#
# Prosedur (keputusan pengguna):
#   1. Snapshot kode status HTTPS situs pengguna (SITES) SEBELUM perubahan.
#   2. Backup bertimestamp Caddyfile host (dan snippet lama) ke BACKUP_DIR.
#   3. Pasang snippet ke TARGET, pastikan tepat satu baris `import TARGET` di CADDYFILE, `caddy validate`.
#      Validasi gagal => pulihkan backup, tanpa reload.
#   4. Reload Caddy (bukan restart), tunggu SETTLE_SECONDS, snapshot SESUDAH.
#   5. Ada kode status yang berubah (atau reload gagal) => rollback otomatis: pulihkan backup, reload, exit 1.
#
# Variabel (opsional): CADDYFILE (/etc/caddy/Caddyfile), TARGET (/opt/urusin/Caddyfile.urusin),
# BACKUP_DIR (/opt/urusin/caddy-backups), SITES ("gutstore.my.id admin.gutstore.my.id pythia.web.id"),
# RELOAD_CMD ("systemctl reload caddy"), SETTLE_SECONDS (5).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TARGET="${TARGET:-/opt/urusin/Caddyfile.urusin}"
BACKUP_DIR="${BACKUP_DIR:-/opt/urusin/caddy-backups}"
SITES="${SITES:-gutstore.my.id admin.gutstore.my.id pythia.web.id}"
RELOAD_CMD="${RELOAD_CMD:-systemctl reload caddy}"
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

die() { echo "caddy-install: $*" >&2; exit 1; }
log() { echo "caddy-install: $*"; }

src=""
dry=0
for a in "$@"; do
  case "$a" in
    --dry-run) dry=1 ;;
    primary) src="$HERE/Caddyfile.urusin" ;;
    fallback) src="$HERE/Caddyfile.urusin.fallback" ;;
    -*) die "opsi tidak dikenal: $a" ;;
    *) [ -z "$src" ] || die "hanya satu snippet"; src="$a" ;;
  esac
done
[ -n "$src" ] || die "pemakaian: $0 <primary|fallback|berkas-snippet> [--dry-run]"
[ -f "$src" ] || die "snippet tidak ada: $src"
[ -f "$CADDYFILE" ] || die "Caddyfile host tidak ada: $CADDYFILE"
command -v caddy >/dev/null || die "caddy tidak ditemukan"
command -v curl >/dev/null || die "curl tidak ditemukan"
[[ "$SETTLE_SECONDS" =~ ^[0-9]+$ ]] || die "SETTLE_SECONDS harus angka"
# Snippet tidak boleh memakai placeholder env (environment proses Caddy tidak diubah).
! grep -v '^[[:space:]]*#' "$src" | grep -qF '{$' || die "snippet memuat placeholder {\$…}; bangkitkan ulang dari hosts.json"

import_line="import $TARGET"

# Kode status HTTPS per situs, satu baris "situs kode". 000 = tidak terjangkau (tetap dibandingkan).
snapshot() {
  local s code
  for s in $SITES; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' -m 10 "https://$s/" 2>/dev/null || true)"
    echo "$s ${code:-000}"
  done
}

before="$(snapshot)"
log "status sebelum:"; sed 's/^/  /' <<<"$before"

if [ "$dry" = 1 ]; then
  caddy validate --adapter caddyfile --config "$src" >/dev/null 2>&1 || die "snippet tidak valid: $src"
  log "snippet valid (berdiri sendiri): $src"
  caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1 || die "Caddyfile host saat ini tidak valid"
  log "Caddyfile host saat ini valid"
  if grep -qxF "$import_line" "$CADDYFILE"; then log "baris import sudah ada"; else log "akan menambah: $import_line"; fi
  if [ -f "$TARGET" ] && cmp -s "$src" "$TARGET"; then log "snippet terpasang sudah sama"; else log "akan memasang $src -> $TARGET"; fi
  log "dry-run: tidak ada berkas yang diubah dan Caddy tidak di-reload"
  exit 0
fi

# --- Backup bertimestamp -------------------------------------------------------------------------
ts="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
# Jangan pernah menimpa backup lain (dua pemakaian dalam detik yang sama).
[ ! -e "$BACKUP_DIR/Caddyfile.$ts" ] || die "backup $ts sudah ada; ulangi sebentar lagi"
cp -p "$CADDYFILE" "$BACKUP_DIR/Caddyfile.$ts"
had_target=0
if [ -f "$TARGET" ]; then had_target=1; cp -p "$TARGET" "$BACKUP_DIR/Caddyfile.urusin.$ts"; fi
log "backup: $BACKUP_DIR/Caddyfile.$ts"

restore_files() {
  cp -p "$BACKUP_DIR/Caddyfile.$ts" "$CADDYFILE"
  if [ "$had_target" = 1 ]; then cp -p "$BACKUP_DIR/Caddyfile.urusin.$ts" "$TARGET"; else rm -f "$TARGET"; fi
}

# --- Pasang + validasi ---------------------------------------------------------------------------
mkdir -p "$(dirname "$TARGET")"
cp "$src" "$TARGET.tmp.$ts"
chmod 644 "$TARGET.tmp.$ts"
mv -f "$TARGET.tmp.$ts" "$TARGET"
grep -qxF "$import_line" "$CADDYFILE" || printf '\n%s\n' "$import_line" >> "$CADDYFILE"

if ! caddy validate --adapter caddyfile --config "$CADDYFILE" >&2; then
  restore_files
  die "caddy validate gagal; berkas dipulihkan dari backup, Caddy TIDAK di-reload"
fi
log "caddy validate: valid"

rollback() {
  echo "caddy-install: ROLLBACK: $1" >&2
  restore_files
  if bash -c "$RELOAD_CMD"; then
    sleep "$SETTLE_SECONDS"
    echo "caddy-install: status setelah rollback:" >&2
    snapshot | sed 's/^/  /' >&2
  else
    echo "caddy-install: PERINGATAN: reload setelah rollback gagal; periksa Caddy SEKARANG" >&2
  fi
  exit 1
}

# --- Reload + bandingkan -------------------------------------------------------------------------
bash -c "$RELOAD_CMD" || rollback "reload gagal ($RELOAD_CMD)"
sleep "$SETTLE_SECONDS"
after="$(snapshot)"
log "status sesudah:"; sed 's/^/  /' <<<"$after"
if [ "$before" != "$after" ]; then
  rollback "kode status situs pengguna berubah"
fi
log "selesai: snippet terpasang, situs pengguna tidak berubah (backup $ts)"
