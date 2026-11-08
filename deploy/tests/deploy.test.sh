#!/usr/bin/env bash
# Uji deploy.sh dengan docker/curl palsu (tanpa Docker): bash deploy/tests/deploy.test.sh
# Berjalan di Git Bash/CI. Tiap kasus memakai direktori sandbox sendiri.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
SHA_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SHA_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
DIG_A="sha256:$(printf 'a%.0s' $(seq 1 64))"
DIG_B="sha256:$(printf 'b%.0s' $(seq 1 64))"
pass=0
fail=0

ok() { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1  [$2]"; fi; }

PATH_ORIG="$PATH"

new_sandbox() {
  SB="$(mktemp -d)"
  mkdir -p "$SB/deploy" "$SB/state"
  cp "$DEPLOY/deploy.sh" "$SB/deploy/deploy.sh"
  : > "$SB/deploy/compose.prod.yml"
  printf 'DOMAIN=urusin.test\n' > "$SB/deploy/.env"
  export SHIM_DIR="$SB/state"
  : > "$SHIM_DIR/calls.log"
  unset SHIM_LABEL SHIM_PROVENANCE SHIM_SERVE_BLUE SHIM_SERVE_GREEN SHIM_DOWN_BLUE SHIM_DOWN_GREEN \
    SHIM_PUBLIC_FAIL SHIM_TLS_FAIL REQUIRE_PROVENANCE
  export PATH="$HERE/shims:$PATH_ORIG"
  export WAIT_SECONDS=2 SETTLE_SECONDS=0
}
run_deploy() { (cd "$SB/deploy" && bash ./deploy.sh "$@") > "$SB/out.log" 2>&1; RC=$?; }
images() { cat "$SB/deploy/.env.images"; }
calls() { cat "$SHIM_DIR/calls.log"; }

echo "1. deploy pertama: sukses, blue aktif"
new_sandbox
export SHIM_LABEL="$SHA_A"
run_deploy "$SHA_A" "$DIG_A"
check "exit 0" '[ $RC -eq 0 ]'
check "ACTIVE_COLOR=blue" 'images | grep -q "^ACTIVE_COLOR=blue$"'
check "blue berjalan dengan SHA A" '[ "$(cat "$SHIM_DIR/running.blue")" = "$SHA_A" ]'
check "riwayat tercatat" '[ "$(wc -l < "$SB/deploy/.env.images.history")" -eq 1 ]'

echo "2. deploy kedua: pindah ke green, blue dihentikan"
export SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "exit 0" '[ $RC -eq 0 ]'
check "ACTIVE_COLOR=green" 'images | grep -q "^ACTIVE_COLOR=green$"'
check "migrasi: green=0 setelah sukses, blue tidak 1" 'images | grep -q "^RUN_MIGRATIONS_GREEN=0$" && ! images | grep -q "^RUN_MIGRATIONS_BLUE=1$"'
check "blue dihentikan" '[ ! -f "$SHIM_DIR/running.blue" ]'
check "green berjalan dengan SHA B" '[ "$(cat "$SHIM_DIR/running.green")" = "$SHA_B" ]'
check "cetak perintah rollback manual" 'grep -q "rollback manual" "$SB/out.log"'
check "smoke publik OK" 'grep -q "smoke publik OK" "$SB/out.log"'

echo "3. gitSha salah di warna baru: rollback otomatis, exit non-zero"
export SHIM_LABEL="$SHA_A" SHIM_SERVE_BLUE="deadbeefdeadbeef"
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "pesan ROLLBACK" 'grep -q "ROLLBACK" "$SB/out.log"'
check "green (lama) tetap melayani SHA B" '[ "$(cat "$SHIM_DIR/running.green")" = "$SHA_B" ]'
check "blue yang gagal dihentikan" '[ ! -f "$SHIM_DIR/running.blue" ]'
check ".env.images kembali: green aktif dengan digest B" 'images | grep -q "^ACTIVE_COLOR=green$" && images | grep -q "^WEB_IMAGE_GREEN=.*${DIG_B}$"'

echo "4. warna baru tidak sehat: rollback"
unset SHIM_SERVE_BLUE
export SHIM_DOWN_BLUE=1
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "green tetap melayani" '[ "$(cat "$SHIM_DIR/running.green")" = "$SHA_B" ]'

echo "5. smoke publik gagal setelah pengalihan: versi lama dijalankan ulang"
unset SHIM_DOWN_BLUE
export SHIM_PUBLIC_FAIL=1
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "green (lama) berjalan lagi dengan SHA B" '[ "$(cat "$SHIM_DIR/running.green")" = "$SHA_B" ]'
check "blue (baru) dihentikan" '[ ! -f "$SHIM_DIR/running.blue" ]'
check "ACTIVE_COLOR=green" 'images | grep -q "^ACTIVE_COLOR=green$"'

echo "6. label revision tidak cocok: ditolak sebelum up"
unset SHIM_PUBLIC_FAIL
export SHIM_LABEL="cccccccccccccccc"
: > "$SHIM_DIR/calls.log"
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "tidak ada compose up" '! calls | grep -q "compose.* up "'
check "pesan label" 'grep -q "label revision" "$SB/out.log"'

echo "7. REQUIRE_PROVENANCE=1 tanpa provenance: ditolak"
export SHIM_LABEL="$SHA_A" REQUIRE_PROVENANCE=1
: > "$SHIM_DIR/calls.log"
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "tidak ada compose up" '! calls | grep -q "compose.* up "'

echo "8. provenance memuat SHA: diterima"
export SHIM_PROVENANCE="{\"SLSA\":{\"invocation\":{\"configSource\":{\"digest\":{\"sha1\":\"$SHA_A\"}}}}}"
run_deploy "$SHA_A" "$DIG_A"
check "exit 0" '[ $RC -eq 0 ]'
check "pesan provenance cocok" 'grep -q "provenance cocok" "$SB/out.log"'

echo "9. migrasi dari layout lama (WEB_IMAGE tunggal)"
new_sandbox
printf 'WEB_IMAGE=ghcr.io/bynguts/urusin-web@%s\nGIT_SHA=%s\n' "$DIG_A" "$SHA_A" > "$SB/deploy/.env.images"
echo "$SHA_A" > "$SHIM_DIR/running.blue"
export SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "exit 0" '[ $RC -eq 0 ]'
check "green aktif, legacy dihentikan" 'images | grep -q "^ACTIVE_COLOR=green$" && [ ! -f "$SHIM_DIR/running.blue" ]'

echo
echo "lulus: $pass, gagal: $fail"
[ "$fail" -eq 0 ]
