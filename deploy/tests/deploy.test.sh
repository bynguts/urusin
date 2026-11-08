#!/usr/bin/env bash
# shellcheck disable=SC2034  # RC dipakai lewat eval di check()
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

echo "10. backup.sh: berkas dibuat, retensi, restic opsional"
new_sandbox
export BACKUP_DIR="$SB/bk"
mkdir -p "$BACKUP_DIR"
echo lama > "$BACKUP_DIR/urusin-20200101T000000Z.db.gz"
touch -d '5 days ago' "$BACKUP_DIR/urusin-20200101T000000Z.db.gz"
echo baru > "$BACKUP_DIR/urusin-20990101T000000Z.db.gz"
touch -d '1 day ago' "$BACKUP_DIR/urusin-20990101T000000Z.db.gz"
(BACKUP_IMAGE=ghcr.io/x@sha256:aa bash "$DEPLOY/backup.sh") > "$SB/out.log" 2>&1; RC=$?
check "exit 0" '[ $RC -eq 0 ]'
check "backup baru dibuat (urusin-2026*.db.gz, tidak kosong)" 'ls "$BACKUP_DIR"/urusin-202[6-9]*T*Z.db.gz | grep -v 20990101 | grep -q . && [ "$(ls "$BACKUP_DIR"/urusin-*.db.gz | wc -l)" -eq 2 ]'
check "backup > 3 hari dihapus, 1 hari dipertahankan" '[ ! -e "$BACKUP_DIR/urusin-20200101T000000Z.db.gz" ] && [ -e "$BACKUP_DIR/urusin-20990101T000000Z.db.gz" ]'
check "tanpa sisa .partial" '[ ! -e "$BACKUP_DIR/.partial.db" ]'
check "restic tidak dipanggil tanpa RESTIC_REPOSITORY" '! calls | grep -q "^restic"'
export RESTIC_REPOSITORY="/tmp/repo-palsu"
(BACKUP_IMAGE=ghcr.io/x@sha256:aa bash "$DEPLOY/backup.sh") > "$SB/out.log" 2>&1; RC=$?
check "restic dipanggil bila RESTIC_REPOSITORY diset" '[ $RC -eq 0 ] && calls | grep -q "^restic backup"'
unset RESTIC_REPOSITORY
export SHIM_RUN_FAIL=1
(BACKUP_IMAGE=ghcr.io/x@sha256:aa bash "$DEPLOY/backup.sh") > "$SB/out.log" 2>&1; RC=$?
check "kegagalan sqlite -> exit non-zero, tanpa .partial" '[ $RC -ne 0 ] && [ ! -e "$BACKUP_DIR/.partial.db" ]'
unset SHIM_RUN_FAIL BACKUP_DIR

echo "11. zero-downtime.sh: lulus tanpa kegagalan, gagal bila ada respons 5xx atau deploy gagal"
new_sandbox
printf '#!/usr/bin/env bash
exit 0
' > "$SB/deploy-ok"
printf '#!/usr/bin/env bash
exit 1
' > "$SB/deploy-bad"
chmod +x "$SB/deploy-ok" "$SB/deploy-bad"
zd() { (cd "$SB" && URL=https://zd.test/api/health GRACE=0 RPS=200 LOG="$SB/zd.log" DEPLOY_CMD="$1" bash "$HERE/zero-downtime.sh" "${@:2}") > "$SB/out.log" 2>&1; RC=$?; }
zd "$SB/deploy-ok" aaaaaaa bbbbbbb@sha256:abc
check "semua 2xx -> exit 0 dan LULUS" '[ $RC -eq 0 ] && grep -q "LULUS" "$SB/out.log"'
export SHIM_ZD_FAIL=1
zd "$SB/deploy-ok" aaaaaaa
check "respons 503 -> exit 1 dan gagal>0" '[ $RC -eq 1 ] && grep -q "GAGAL" "$SB/out.log" && [ -s "$SB/zd.log" ]'
unset SHIM_ZD_FAIL
zd "$SB/deploy-bad" aaaaaaa
check "deploy gagal -> exit 1" '[ $RC -eq 1 ]'

echo "12. disk-alert.sh: ambang 85%"
new_sandbox
export SHIM_DF_PCT=91
(bash "$DEPLOY/disk-alert.sh") > "$SB/out.log" 2>&1; RC=$?
check "91% -> exit 1" '[ $RC -eq 1 ]'
export NTFY_URL="https://ntfy.test/topik"
(bash "$DEPLOY/disk-alert.sh") > "$SB/out.log" 2>&1
check "ntfy dikirim saat lewat ambang" 'calls | grep -q "ntfy.test/topik"'
export SHIM_DF_PCT=40
: > "$SHIM_DIR/calls.log"
(bash "$DEPLOY/disk-alert.sh") > "$SB/out.log" 2>&1; RC=$?
check "40% -> exit 0, tanpa notifikasi" '[ $RC -eq 0 ] && ! calls | grep -q ntfy'
unset SHIM_DF_PCT NTFY_URL

echo
echo "lulus: $pass, gagal: $fail"
[ "$fail" -eq 0 ]
