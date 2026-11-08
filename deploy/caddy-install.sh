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
#   3. Pasang snippet ke TARGET, pastikan tepat satu baris import snippet Urusin di CADDYFILE (baris
#      `import <...>/Caddyfile.urusin` lain dihapus), `caddy validate`. Validasi gagal => pulihkan backup, tanpa reload.
#   4. Reload Caddy (bukan restart), tunggu SETTLE_SECONDS, snapshot SESUDAH.
#   5. Ada kode status yang berubah (atau reload gagal) => rollback otomatis: pulihkan backup, reload, exit 1.
#
# Keamanan (root): perintah reload tetap (`systemctl reload caddy`, tidak dibaca dari env). Direktori TARGET
# dan BACKUP_DIR wajib milik pengguna yang menjalankan (root di produksi), bukan symlink, dan tidak bisa ditulis
# group/others; berkas sementara dibuat dengan mktemp di direktori tujuan lalu di-mv (atomik).
# Caddy berjalan sebagai `User=` unit (biasanya `caddy`), bukan root: sebelum berkas live diubah, snippet baru
# dan Caddyfile host wajib terbaca oleh user itu, dan `caddy validate` dijalankan sebagai user itu (validate
# sebagai root lolos walau Caddy sendiri tidak bisa membaca import, lalu reload gagal).
# Sumber `primary`/`fallback` = deploy/Caddyfile.urusin.<set>; sumber yang sama dengan TARGET ditolak.
#
# TARGET tanpa env = path dari baris import snippet Urusin yang SUDAH ada di CADDYFILE (mis. /opt/urusin di VPS
# lama), sehingga pemasangan berikutnya tidak pernah menambah import kedua; tanpa baris import = DEFAULT_TARGET.
# Lebih dari satu baris import snippet Urusin = galat (rapikan manual dulu).
#
# Variabel (opsional): CADDYFILE (/etc/caddy/Caddyfile), TARGET (lihat di atas),
# DEFAULT_TARGET (/etc/caddy/urusin/Caddyfile.urusin), BACKUP_DIR (/var/backups/urusin-caddy),
# SITES ("gutstore.my.id admin.gutstore.my.id pythia.web.id"), SETTLE_SECONDS (5).
# Tes mengganti fungsi reload_caddy dengan men-source skrip ini (lihat tests/caddy-install.test.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TARGET="${TARGET:-}"
DEFAULT_TARGET="${DEFAULT_TARGET:-/etc/caddy/urusin/Caddyfile.urusin}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/urusin-caddy}"
SITES="${SITES:-gutstore.my.id admin.gutstore.my.id pythia.web.id}"
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

die() { echo "caddy-install: $*" >&2; exit 1; }
log() { echo "caddy-install: $*"; }

# Satu-satunya perintah reload. Tetap, bukan dari env (skrip berjalan sebagai root).
reload_caddy() { systemctl reload caddy; }

# User proses Caddy dari unit systemd (`User=`); kosong = root.
caddy_user() { systemctl show -p User --value caddy 2>/dev/null || true; }

# Jalankan perintah sebagai user Caddy (langsung bila user itu root atau pengguna yang sedang berjalan).
as_caddy() {
  local u
  u="$(caddy_user)"
  if [ -z "$u" ] || [ "$u" = root ] || [ "$u" = "$(id -un)" ]; then "$@"; else sudo -n -u "$u" -- "$@"; fi
}

# Kode status HTTPS per situs, satu baris "situs kode". 000 = tidak terjangkau (tetap dibandingkan).
snapshot() {
  local s code
  for s in $SITES; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' -m 10 "https://$s/" 2>/dev/null || true)"
    echo "$s ${code:-000}"
  done
}

# Baris import snippet Urusin di Caddyfile host (satu path per baris, apa adanya).
urusin_imports() {
  sed -nE 's/^[[:space:]]*import[[:space:]]+(\/[^[:space:]]*\/Caddyfile\.urusin)[[:space:]]*$/\1/p' "$CADDYFILE"
}

# Direktori tujuan aman: ada, bukan symlink, milik pengguna yang menjalankan, tidak bisa ditulis group/others.
require_private_dir() {
  local d="$1"
  [ -d "$d" ] && [ ! -L "$d" ] || die "direktori tidak ada atau symlink: $d"
  [ "$(stat -c %u "$d")" = "$(id -u)" ] || die "direktori bukan milik uid $(id -u): $d"
  [ -z "$(find "$d" -maxdepth 0 -perm /022)" ] || die "direktori bisa ditulis group/others: $d"
}

main() {
  local src="" dry=0 a
  for a in "$@"; do
    case "$a" in
      --dry-run) dry=1 ;;
      primary) src="$HERE/Caddyfile.urusin.primary" ;;
      fallback) src="$HERE/Caddyfile.urusin.fallback" ;;
      -*) die "opsi tidak dikenal: $a" ;;
      *) [ -z "$src" ] || die "hanya satu snippet"; src="$a" ;;
    esac
  done
  [ -n "$src" ] || die "pemakaian: $0 <primary|fallback|berkas-snippet> [--dry-run]"
  [ -f "$src" ] || die "snippet tidak ada: $src"
  [ -f "$CADDYFILE" ] || die "Caddyfile host tidak ada: $CADDYFILE"
  local existing detected=0
  existing="$(urusin_imports | sort -u)"
  [ "$(grep -c . <<<"$existing")" -le 1 ] || die "lebih dari satu baris import snippet Urusin di $CADDYFILE:
$existing
rapikan manual dulu (sisakan satu), tidak ada yang diubah"
  if [ -z "$TARGET" ]; then
    if [ -n "$existing" ]; then TARGET="$existing"; detected=1; else TARGET="$DEFAULT_TARGET"; fi
  fi
  # Sumber == TARGET berarti memasang ulang snippet yang sedang aktif (bukan set yang diminta) lalu melapor sukses.
  if [ -e "$TARGET" ] && [ "$(readlink -f "$src")" = "$(readlink -f "$TARGET")" ]; then
    die "sumber snippet sama dengan TARGET ($TARGET); pakai deploy/Caddyfile.urusin.<primary|fallback>"
  fi
  command -v caddy >/dev/null || die "caddy tidak ditemukan"
  command -v curl >/dev/null || die "curl tidak ditemukan"
  [[ "$SETTLE_SECONDS" =~ ^[0-9]+$ ]] || die "SETTLE_SECONDS harus angka"
  # Snippet tidak boleh memakai placeholder env (environment proses Caddy tidak diubah).
  ! grep -v '^[[:space:]]*#' "$src" | grep -qF '{$' || die "snippet memuat placeholder {\$…}; bangkitkan ulang dari hosts.json"

  local import_line="import $TARGET" legacy_line="" tdir
  tdir="$(dirname "$TARGET")"
  # Import snippet Urusin lain (path berbeda dari TARGET) diganti, bukan ditambah: tetap tepat satu import.
  if [ -n "$existing" ] && [ "$existing" != "$TARGET" ]; then legacy_line="import $existing"; fi
  if [ "$detected" = 1 ]; then log "TARGET dari baris import yang sudah ada: $TARGET"; else log "TARGET: $TARGET"; fi

  local before
  before="$(snapshot)"
  log "status sebelum:"
  # shellcheck disable=SC2001
  sed 's/^/  /' <<<"$before"

  if [ "$dry" = 1 ]; then
    caddy validate --adapter caddyfile --config "$src" >/dev/null 2>&1 || die "snippet tidak valid: $src"
    log "snippet valid (berdiri sendiri): $src"
    as_caddy caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1       || die "Caddyfile host saat ini tidak valid (divalidasi sebagai user Caddy '$(caddy_user)')"
    log "Caddyfile host saat ini valid (sebagai user Caddy '$(caddy_user)')"
    if [ -d "$tdir" ] && ! as_caddy test -x "$tdir"; then log "PERINGATAN: user Caddy tidak bisa menelusuri $tdir"; fi
    if grep -qxF "$import_line" "$CADDYFILE"; then log "baris import sudah ada"; else log "akan menambah: $import_line"; fi
    if [ -n "$legacy_line" ] && grep -qxF "$legacy_line" "$CADDYFILE"; then log "akan menghapus baris lama: $legacy_line"; fi
    if [ -f "$TARGET" ] && cmp -s "$src" "$TARGET"; then log "snippet terpasang sudah sama"; else log "akan memasang $src -> $TARGET"; fi
    log "dry-run: tidak ada berkas yang diubah dan Caddy tidak di-reload"
    exit 0
  fi

  # --- Direktori milik root -----------------------------------------------------------------------
  # Tolak symlink SEBELUM mkdir/chmod (chmod mengikuti symlink).
  [ ! -L "$BACKUP_DIR" ] || die "direktori tidak ada atau symlink: $BACKUP_DIR"
  [ ! -L "$tdir" ] || die "direktori tidak ada atau symlink: $tdir"
  if [ -d "$tdir" ] && [ "$(stat -c %u "$tdir")" != "$(id -u)" ]; then
    die "direktori snippet $tdir bukan milik uid $(id -u); skrip tidak menulis ke direktori milik pengguna lain. Untuk memindahkan snippet (baris import lama diganti, tetap satu import): TARGET=$DEFAULT_TARGET $0 <set>. Tidak ada yang diubah"
  fi
  mkdir -p "$BACKUP_DIR" "$tdir"
  chmod 700 "$BACKUP_DIR"
  require_private_dir "$BACKUP_DIR"
  require_private_dir "$tdir"

  # --- Pra-cek user Caddy (sebelum berkas live diubah) ------------------------------------------------
  # Snippet baru disiapkan sebagai berkas sementara di direktori TARGET; user Caddy harus bisa membacanya di
  # sana (izin direktori ikut diuji), begitu juga Caddyfile host. Gagal => hapus sementara, tanpa perubahan.
  local tmp
  tmp="$(mktemp "$tdir/.Caddyfile.urusin.XXXXXX")"
  cp "$src" "$tmp"
  chmod 644 "$tmp"
  if ! as_caddy test -r "$tmp" || ! as_caddy test -r "$CADDYFILE"; then
    rm -f "$tmp"
    die "user Caddy '$(caddy_user)' tidak bisa membaca $tdir atau $CADDYFILE; perbaiki izin (lihat hardening.md), tidak ada yang diubah"
  fi

  # --- Backup bertimestamp -------------------------------------------------------------------------
  local ts had_target=0
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  # Jangan pernah menimpa backup lain (dua pemakaian dalam detik yang sama).
  [ ! -e "$BACKUP_DIR/Caddyfile.$ts" ] || die "backup $ts sudah ada; ulangi sebentar lagi"
  cp -p "$CADDYFILE" "$BACKUP_DIR/Caddyfile.$ts"
  if [ -f "$TARGET" ]; then had_target=1; cp -p "$TARGET" "$BACKUP_DIR/Caddyfile.urusin.$ts"; fi
  log "backup: $BACKUP_DIR/Caddyfile.$ts"

  restore_files() {
    cp -p "$BACKUP_DIR/Caddyfile.$ts" "$CADDYFILE"
    if [ "$had_target" = 1 ]; then cp -p "$BACKUP_DIR/Caddyfile.urusin.$ts" "$TARGET"; else rm -f "$TARGET"; fi
  }

  # --- Pasang + validasi ---------------------------------------------------------------------------
  mv -f "$tmp" "$TARGET"

  # Caddyfile host ditulis ulang lewat mktemp di direktorinya (izin/pemilik disalin), lalu mv atomik.
  tmp="$(mktemp "$(dirname "$CADDYFILE")/.Caddyfile.XXXXXX")"
  if [ -n "$legacy_line" ]; then grep -vxF "$legacy_line" "$CADDYFILE" > "$tmp" || true; else cat "$CADDYFILE" > "$tmp"; fi
  grep -qxF "$import_line" "$tmp" || printf '\n%s\n' "$import_line" >> "$tmp"
  chmod --reference="$CADDYFILE" "$tmp"
  chown --reference="$CADDYFILE" "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$CADDYFILE"

  # Validasi sebagai user Caddy: import yang tidak terbaca oleh proses Caddy gagal di sini, bukan saat reload.
  if ! as_caddy caddy validate --adapter caddyfile --config "$CADDYFILE" >&2; then
    restore_files
    die "caddy validate gagal (sebagai user Caddy '$(caddy_user)'); berkas dipulihkan dari backup, Caddy TIDAK di-reload"
  fi
  log "caddy validate: valid (sebagai user Caddy '$(caddy_user)')"

  rollback() {
    echo "caddy-install: ROLLBACK: $1" >&2
    restore_files
    if reload_caddy; then
      sleep "$SETTLE_SECONDS"
      echo "caddy-install: status setelah rollback:" >&2
      snapshot | sed 's/^/  /' >&2
    else
      echo "caddy-install: PERINGATAN: reload setelah rollback gagal; periksa Caddy SEKARANG" >&2
    fi
    exit 1
  }

  # --- Reload + bandingkan -------------------------------------------------------------------------
  reload_caddy || rollback "reload gagal (systemctl reload caddy)"
  sleep "$SETTLE_SECONDS"
  local after
  after="$(snapshot)"
  log "status sesudah:"
  # shellcheck disable=SC2001
  sed 's/^/  /' <<<"$after"
  if [ "$before" != "$after" ]; then
    rollback "kode status situs pengguna berubah"
  fi
  log "selesai: snippet terpasang, situs pengguna tidak berubah (backup $ts)"
}

# Di-source (tes) => hanya definisi fungsi; dijalankan => main.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
