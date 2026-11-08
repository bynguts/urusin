#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # ekspresi check() (memakai rc/out) sengaja dievaluasi lewat eval
# Uji caddy-install.sh dengan caddy/systemctl/curl palsu: bash deploy/tests/caddy-install.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
pass=0
fail=0
check() { if eval "$2"; then pass=$((pass + 1)); echo "  ok   $1"; else fail=$((fail + 1)); echo "  FAIL $1  [$2]"; fi; }
export PATH="$HERE/shims-caddy:$PATH" SETTLE_SECONDS=0

new_sandbox() {
  SB="$(mktemp -d)"
  export SHIM_DIR="$SB/state" CADDYFILE="$SB/etc/Caddyfile" TARGET="$SB/opt/Caddyfile.urusin"
  export BACKUP_DIR="$SB/opt/caddy-backups"
  mkdir -p "$SHIM_DIR" "$SB/etc" "$SB/opt"
  : > "$SHIM_DIR/calls.log"
  printf 'gutstore.my.id {\n\treverse_proxy 127.0.0.1:3000\n}\n' > "$CADDYFILE"
  cp "$CADDYFILE" "$SB/caddyfile.orig"
  echo 200 > "$SHIM_DIR/orig.gutstore.my.id"
  echo 302 > "$SHIM_DIR/orig.admin.gutstore.my.id"
  echo 401 > "$SHIM_DIR/orig.pythia.web.id"
  for f in "$SHIM_DIR"/orig.*; do cp "$f" "$SHIM_DIR/code.${f##*/orig.}"; done
  unset SHIM_BREAK_SITE SHIM_RELOAD_FAIL
}
run() { out="$(bash "$DEPLOY/caddy-install.sh" "$@" 2>&1)"; rc=$?; }
reloads() { grep -c '^systemctl reload caddy' "$SHIM_DIR/calls.log"; }

echo "1. --dry-run: hanya baca"
new_sandbox
run fallback --dry-run
check "exit 0, validasi snippet + Caddyfile, tanpa reload" '[ $rc -eq 0 ] && [ "$(grep -c "caddy validate" "$SHIM_DIR/calls.log")" -eq 2 ] && [ "$(reloads)" -eq 0 ]'
check "tidak ada berkas yang diubah atau dibuat" 'cmp -s "$CADDYFILE" "$SB/caddyfile.orig" && [ ! -e "$TARGET" ] && [ ! -e "$BACKUP_DIR" ]'
check "snapshot ketiga situs pengguna dicatat" 'grep -q "pythia.web.id 401" <<<"$out" && grep -q "admin.gutstore.my.id 302" <<<"$out" && grep -q "gutstore.my.id 200" <<<"$out"'
check "rencana menyebut import dan pemasangan" 'grep -qF "akan menambah: import $TARGET" <<<"$out" && grep -q "akan memasang" <<<"$out"'

echo "2. pasang: backup bertimestamp, import sekali, reload sekali"
run fallback
check "exit 0, reload 1x" '[ $rc -eq 0 ] && [ "$(reloads)" -eq 1 ]'
check "snippet fallback terpasang" 'cmp -s "$DEPLOY/Caddyfile.urusin.fallback" "$TARGET"'
check "backup Caddyfile bertimestamp sama dengan aslinya" 'ls "$BACKUP_DIR" | grep -Eq "^Caddyfile\.[0-9]{8}T[0-9]{6}Z$" && cmp -s "$BACKUP_DIR"/Caddyfile.2* "$SB/caddyfile.orig"'
check "tepat satu baris import; blok situs lain utuh" '[ "$(grep -cxF "import $TARGET" "$CADDYFILE")" -eq 1 ] && grep -q "reverse_proxy 127.0.0.1:3000" "$CADDYFILE"'
/usr/bin/sleep 1
run primary
check "pindah ke primary: import tidak berlipat, snippet lama ikut di-backup" '[ $rc -eq 0 ] && [ "$(grep -cxF "import $TARGET" "$CADDYFILE")" -eq 1 ] && cmp -s "$DEPLOY/Caddyfile.urusin" "$TARGET" && ls "$BACKUP_DIR" | grep -q "^Caddyfile.urusin\."'

echo "3. caddy validate gagal: pulihkan, tanpa reload"
new_sandbox
printf 'INVALID {\n}\n' > "$SB/rusak.caddy"
run "$SB/rusak.caddy"
check "exit 1, tanpa reload, Caddyfile dipulihkan, target tidak tertinggal" '[ $rc -ne 0 ] && [ "$(reloads)" -eq 0 ] && cmp -s "$CADDYFILE" "$SB/caddyfile.orig" && [ ! -e "$TARGET" ] && grep -q "validate gagal" <<<"$out"'

echo "4. kode status situs pengguna berubah setelah reload: rollback otomatis"
new_sandbox
export SHIM_BREAK_SITE=pythia.web.id
run fallback
check "exit 1, ROLLBACK, reload 2x" '[ $rc -ne 0 ] && grep -q "ROLLBACK: kode status situs pengguna berubah" <<<"$out" && [ "$(reloads)" -eq 2 ]'
check "Caddyfile kembali seperti semula, target dihapus" 'cmp -s "$CADDYFILE" "$SB/caddyfile.orig" && [ ! -e "$TARGET" ]'
check "status setelah rollback dilaporkan (pythia kembali 401)" 'grep -A3 "status setelah rollback" <<<"$out" | grep -q "pythia.web.id 401"'
new_sandbox
printf '# lama\n' > "$TARGET"
printf '\nimport %s\n' "$TARGET" >> "$CADDYFILE"
cp "$CADDYFILE" "$SB/caddyfile.orig"
export SHIM_BREAK_SITE=gutstore.my.id
run fallback
check "rollback memulihkan snippet lama persis" '[ $rc -ne 0 ] && [ "$(cat "$TARGET")" = "# lama" ] && cmp -s "$CADDYFILE" "$SB/caddyfile.orig"'
unset SHIM_BREAK_SITE

echo "5. reload gagal: rollback"
new_sandbox
export SHIM_RELOAD_FAIL=1
run fallback
check "exit 1, berkas dipulihkan, peringatan reload rollback" '[ $rc -ne 0 ] && cmp -s "$CADDYFILE" "$SB/caddyfile.orig" && grep -q "reload setelah rollback gagal" <<<"$out"'
unset SHIM_RELOAD_FAIL

echo "6. argumen dan snippet tidak sah"
new_sandbox
run
check "tanpa argumen -> exit non-zero" '[ $rc -ne 0 ] && grep -q pemakaian <<<"$out"'
run fallback --force
check "opsi tak dikenal ditolak" '[ $rc -ne 0 ]'
printf 'urusin.{$DOMAIN} {\n}\n' > "$SB/env.caddy"
run "$SB/env.caddy" --dry-run
check "snippet dengan placeholder env ditolak" '[ $rc -ne 0 ] && grep -q placeholder <<<"$out"'
run "$SB/tidak-ada" --dry-run
check "snippet tidak ada ditolak" '[ $rc -ne 0 ]'
check "kasus gagal tidak pernah reload" '[ "$(reloads)" -eq 0 ]'

echo
echo "lulus: $pass, gagal: $fail"
[ "$fail" -eq 0 ]
