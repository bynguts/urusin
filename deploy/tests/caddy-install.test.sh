#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # ekspresi check() (memakai rc/out) sengaja dievaluasi lewat eval
# Uji caddy-install.sh dengan caddy/curl palsu (PATH) dan reload palsu: bash deploy/tests/caddy-install.test.sh
# Seam reload: skrip di-source lalu fungsi reload_caddy diganti (bukan perintah dari env).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
pass=0
fail=0
check() { if eval "$2"; then pass=$((pass + 1)); echo "  ok   $1"; else fail=$((fail + 1)); echo "  FAIL $1  [$2]"; fi; }
export PATH="$HERE/shims-caddy:$PATH" SETTLE_SECONDS=0 FAKE_RELOAD="$HERE/shims-caddy/fake-reload"

new_sandbox() {
  SB="$(mktemp -d)"
  export SHIM_DIR="$SB/state" CADDYFILE="$SB/etc/Caddyfile" TARGET="$SB/etc/urusin/Caddyfile.urusin"
  export LEGACY_TARGET="$SB/opt/Caddyfile.urusin" BACKUP_DIR="$SB/backups/urusin-caddy"
  mkdir -p "$SHIM_DIR" "$SB/etc" "$SB/opt"
  : > "$SHIM_DIR/calls.log"
  printf 'gutstore.my.id {\n\treverse_proxy 127.0.0.1:3000\n}\n' > "$CADDYFILE"
  cp "$CADDYFILE" "$SB/caddyfile.orig"
  echo 200 > "$SHIM_DIR/orig.gutstore.my.id"
  echo 302 > "$SHIM_DIR/orig.admin.gutstore.my.id"
  echo 401 > "$SHIM_DIR/orig.pythia.web.id"
  for f in "$SHIM_DIR"/orig.*; do cp "$f" "$SHIM_DIR/code.${f##*/orig.}"; done
  unset SHIM_BREAK_SITE SHIM_RELOAD_FAIL RELOAD_CMD
}
# shellcheck disable=SC2154  # FAKE_RELOAD diekspor di atas
# Override: reload palsu; user Caddy = "caddy"; as_caddy mencatat panggilan dan (SHIM_CADDY_UNREADABLE) gagal
# pada `test`, seperti user caddy yang tidak bisa menelusuri direktori milik pengguna lain.
# shellcheck disable=SC2329  # dipanggil lewat bash -c (export -f)
caddy_overrides() {
  reload_caddy() { "$FAKE_RELOAD" reload caddy; }
  caddy_user() { echo caddy; }
  as_caddy() {
    echo "as_caddy $*" >> "$SHIM_DIR/calls.log"
    if [ -n "${SHIM_CADDY_UNREADABLE:-}" ] && [ "$1" = test ]; then return 1; fi
    "$@"
  }
}
export -f caddy_overrides
run_script() {
  local script="$1"
  shift
  out="$(bash -c 'source "$1"; shift; caddy_overrides; main "$@"' _ "$script" "$@" 2>&1)"
  rc=$?
}
run() { run_script "$DEPLOY/caddy-install.sh" "$@"; }
leftovers() { find "$SB/etc" -name '.Caddyfile*' | wc -l; }
reloads() { grep -c '^systemctl reload caddy' "$SHIM_DIR/calls.log"; }

echo "1. --dry-run: hanya baca"
new_sandbox
run fallback --dry-run
check "exit 0, validasi snippet + Caddyfile, tanpa reload" '[ $rc -eq 0 ] && [ "$(grep -c "^caddy validate" "$SHIM_DIR/calls.log")" -eq 2 ] && [ "$(reloads)" -eq 0 ]'
check "dry-run memvalidasi Caddyfile host sebagai user Caddy" 'grep -qF "as_caddy caddy validate --adapter caddyfile --config $CADDYFILE" "$SHIM_DIR/calls.log"'
check "tidak ada berkas yang diubah atau dibuat" 'cmp -s "$CADDYFILE" "$SB/caddyfile.orig" && [ ! -e "$TARGET" ] && [ ! -e "$BACKUP_DIR" ]'
check "snapshot ketiga situs pengguna dicatat" 'grep -q "pythia.web.id 401" <<<"$out" && grep -q "admin.gutstore.my.id 302" <<<"$out" && grep -q "gutstore.my.id 200" <<<"$out"'
check "rencana menyebut import dan pemasangan" 'grep -qF "akan menambah: import $TARGET" <<<"$out" && grep -q "akan memasang" <<<"$out"'

echo "2. pasang: backup bertimestamp, import sekali, reload sekali"
run fallback
check "exit 0, reload 1x" '[ $rc -eq 0 ] && [ "$(reloads)" -eq 1 ]'
check "snippet fallback terpasang" 'cmp -s "$DEPLOY/Caddyfile.urusin.fallback" "$TARGET"'
check "backup Caddyfile bertimestamp sama dengan aslinya" 'ls "$BACKUP_DIR" | grep -Eq "^Caddyfile\.[0-9]{8}T[0-9]{6}Z$" && cmp -s "$BACKUP_DIR"/Caddyfile.2* "$SB/caddyfile.orig"'
check "tepat satu baris import; blok situs lain utuh" '[ "$(grep -cxF "import $TARGET" "$CADDYFILE")" -eq 1 ] && grep -q "reverse_proxy 127.0.0.1:3000" "$CADDYFILE"'
check "backup di direktori 0700; tanpa sisa berkas sementara" '[ "$(stat -c %a "$BACKUP_DIR")" = 700 ] && [ "$(leftovers)" -eq 0 ]'
/usr/bin/sleep 1
run primary
check "pindah ke primary: import tidak berlipat, snippet lama ikut di-backup" '[ $rc -eq 0 ] && [ "$(grep -cxF "import $TARGET" "$CADDYFILE")" -eq 1 ] && cmp -s "$DEPLOY/Caddyfile.urusin.primary" "$TARGET" && ls "$BACKUP_DIR" | grep -q "^Caddyfile.urusin\."'

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
mkdir -p "$(dirname "$TARGET")"
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

echo "7. reload tetap: RELOAD_CMD dari env tidak pernah dievaluasi"
new_sandbox
export RELOAD_CMD="touch $SB/pwned"
run fallback
check "pasang sukses, RELOAD_CMD diabaikan" '[ $rc -eq 0 ] && [ ! -e "$SB/pwned" ] && [ "$(reloads)" -eq 1 ]'
unset RELOAD_CMD
check "fungsi reload bawaan persis systemctl reload caddy" \
  '[ "$(bash -c "source \"\$1\"; declare -f reload_caddy" _ "$DEPLOY/caddy-install.sh" | grep -c "systemctl reload caddy")" -eq 1 ]'
check "skrip tidak memuat bash -c atau eval" '! grep -Eq "bash -c|(^|[^a-z_])eval " "$DEPLOY/caddy-install.sh"'

echo "8. migrasi baris import lama (/opt/urusin)"
new_sandbox
printf '\nimport %s\n' "$LEGACY_TARGET" >> "$CADDYFILE"
printf '# lama\n' > "$LEGACY_TARGET"
cp "$CADDYFILE" "$SB/caddyfile.orig"
run fallback --dry-run
check "dry-run menyebut penghapusan baris lama" '[ $rc -eq 0 ] && grep -qF "akan menghapus baris lama: import $LEGACY_TARGET" <<<"$out"'
run fallback
check "baris lama hilang, baris baru tepat satu" '[ $rc -eq 0 ] && ! grep -qxF "import $LEGACY_TARGET" "$CADDYFILE" && [ "$(grep -cxF "import $TARGET" "$CADDYFILE")" -eq 1 ]'
new_sandbox
printf '\nimport %s\n' "$LEGACY_TARGET" >> "$CADDYFILE"
cp "$CADDYFILE" "$SB/caddyfile.orig"
export SHIM_BREAK_SITE=pythia.web.id
run fallback
check "rollback memulihkan baris lama" '[ $rc -ne 0 ] && cmp -s "$CADDYFILE" "$SB/caddyfile.orig"'
unset SHIM_BREAK_SITE

echo "9. direktori tujuan tidak aman ditolak sebelum mengubah apa pun"
new_sandbox
mkdir -p "$(dirname "$TARGET")" && chmod 777 "$(dirname "$TARGET")"
run fallback
check "direktori TARGET world-writable -> exit 1, tanpa reload, Caddyfile utuh" '[ $rc -ne 0 ] && grep -q "bisa ditulis group/others" <<<"$out" && [ "$(reloads)" -eq 0 ] && cmp -s "$CADDYFILE" "$SB/caddyfile.orig"'
new_sandbox
mkdir -p "$SB/elsewhere" "$(dirname "$BACKUP_DIR")" && ln -s "$SB/elsewhere" "$BACKUP_DIR"
run fallback
check "BACKUP_DIR symlink -> exit 1, tanpa backup di target symlink" '[ $rc -ne 0 ] && grep -q "symlink" <<<"$out" && [ -z "$(ls -A "$SB/elsewhere")" ] && [ "$(reloads)" -eq 0 ]'

echo "10. user Caddy tidak bisa membaca snippet: gagal sebelum perubahan apa pun"
new_sandbox
export SHIM_CADDY_UNREADABLE=1
run fallback
check "exit 1 dengan pesan izin, tanpa reload" '[ $rc -ne 0 ] && grep -q "user Caddy .caddy. tidak bisa membaca" <<<"$out" && [ "$(reloads)" -eq 0 ]'
check "Caddyfile utuh, TARGET tidak dibuat, tanpa backup dan tanpa berkas sementara" 'cmp -s "$CADDYFILE" "$SB/caddyfile.orig" && [ ! -e "$TARGET" ] && [ -z "$(ls -A "$BACKUP_DIR")" ] && [ "$(leftovers)" -eq 0 ]'
unset SHIM_CADDY_UNREADABLE
new_sandbox
run fallback
check "pemasangan memvalidasi Caddyfile host sebagai user Caddy" '[ $rc -eq 0 ] && grep -qF "as_caddy caddy validate --adapter caddyfile --config $CADDYFILE" "$SHIM_DIR/calls.log" && grep -q "^as_caddy test -r" "$SHIM_DIR/calls.log"'

echo "11. sumber == TARGET ditolak; fallback -> primary di tata letak /opt/urusin"
run "$TARGET"
check "sumber sama dengan TARGET -> exit 1, tanpa reload tambahan" '[ $rc -ne 0 ] && grep -q "sama dengan TARGET" <<<"$out" && [ "$(reloads)" -eq 1 ]'
new_sandbox
# Tata letak VPS lama: skrip dan snippet sumber disalin ke direktori yang sama dengan TARGET.
OPT="$SB/opt/urusin"
mkdir -p "$OPT" && cp "$DEPLOY"/caddy-install.sh "$DEPLOY"/Caddyfile.urusin.* "$OPT"/
export TARGET="$OPT/Caddyfile.urusin" LEGACY_TARGET="$OPT/Caddyfile.urusin"
run_script "$OPT/caddy-install.sh" fallback
/usr/bin/sleep 1
run_script "$OPT/caddy-install.sh" primary
check "primary setelah fallback benar-benar memasang snippet primary" '[ $rc -eq 0 ] && cmp -s "$DEPLOY/Caddyfile.urusin.primary" "$TARGET" && ! cmp -s "$DEPLOY/Caddyfile.urusin.fallback" "$TARGET"'

echo
echo "lulus: $pass, gagal: $fail"
[ "$fail" -eq 0 ]
