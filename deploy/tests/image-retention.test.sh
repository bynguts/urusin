#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # ekspresi check() (memakai rc/out) sengaja dievaluasi lewat eval
# Uji image-retention.sh dengan docker palsu: bash deploy/tests/image-retention.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
pass=0
fail=0
check() { if eval "$2"; then pass=$((pass + 1)); echo "  ok   $1"; else fail=$((fail + 1)); echo "  FAIL $1  [$2]"; fi; }
d() { printf 'sha256:%s' "$(printf "$1%.0s" $(seq 1 64))"; } # digest dari satu karakter hex
W=ghcr.io/bynguts/urusin-web
F=ghcr.io/bynguts/urusin-fixtures

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/deploy" "$SB/state"
cp "$DEPLOY/image-retention.sh" "$SB/deploy/"
export SHIM_DIR="$SB/state" PATH="$HERE/shims:$PATH"
: > "$SHIM_DIR/calls.log"

# Riwayat deploy: 1..6 (6 terbaru). Aktif 6, sebelumnya 5. rc1 = 1 (di .env.images.keep).
for i in 1 2 3 4 5 6; do printf '2026-11-0%sT00:00:00Z\tblue\t%s\t%s@%s\n' "$i" "$(printf "$i%.0s" $(seq 1 40))" "$W" "$(d "$i")"; done > "$SB/deploy/.env.images.history"
printf 'ACTIVE_COLOR=green\nWEB_IMAGE_GREEN=%s@%s\nWEB_IMAGE_BLUE=%s@%s\nFIXTURES_IMAGE=%s@%s\n' "$W" "$(d 6)" "$W" "$(d 5)" "$F" "$(d f)" > "$SB/deploy/.env.images"
printf '%s@%s\n' "$W" "$(d 1)" > "$SB/deploy/.env.images.keep"
{
  for i in 1 2 3 4 5 6; do printf '%s\t%s\n' "$W" "$(d "$i")"; done
  printf '%s\t%s\n%s\t%s\n' "$F" "$(d f)" "$F" "$(d e)"
  printf '%s\t<none>\n' "$W"                                   # tanpa digest: tidak disentuh
  printf 'ghcr.io/bynguts/lain\t%s\n' "$(d c)"                  # repo lain milik pengguna
  printf 'caddy\t%s\nghcr.io/bynguts/urusin-web-evil.example/x\t%s\n' "$(d a)" "$(d b)"
} > "$SHIM_DIR/images.tsv"

echo "1. dry-run: tidak menghapus apa pun"
out="$(bash "$SB/deploy/image-retention.sh")"; rc=$?
check "exit 0, tanpa docker image rm" '[ $rc -eq 0 ] && [ ! -e "$SHIM_DIR/rm.log" ]'
check "rencana: hapus web 2, web 3, fixtures e saja" '[ "$(grep -c "akan menghapus" <<<"$out")" -eq 3 ] && grep -q "akan menghapus $W@$(d 2)" <<<"$out" && grep -q "akan menghapus $W@$(d 3)" <<<"$out" && grep -q "akan menghapus $F@$(d e)" <<<"$out"'

echo "2. --apply: hanya referensi urusin-* yang tidak dipertahankan"
bash "$SB/deploy/image-retention.sh" --apply >/dev/null; rc=$?
check "exit 0; rm tepat web@2, web@3, fixtures@e" '[ $rc -eq 0 ] && [ "$(sort "$SHIM_DIR/rm.log" | tr "\n" " ")" = "$F@$(d e) $W@$(d 2) $W@$(d 3) " ]'
check "rc1, aktif, sebelumnya, 3 terakhir, fixtures aktif tetap" '! grep -qE "@($(d 1)|$(d 4)|$(d 5)|$(d 6)|$(d f))$" "$SHIM_DIR/rm.log"'
check "tidak pernah prune, -f, atau repo lain" '! grep -qE "prune|image rm -f|image rm .*(caddy|bynguts/lain|evil)" "$SHIM_DIR/calls.log"'

echo "3. image yang dipakai kontainer: peringatan, lanjut"
rm -f "$SHIM_DIR/rm.log"
out="$(SHIM_RM_BUSY="$(d 2)" bash "$SB/deploy/image-retention.sh" --apply 2>&1)"; rc=$?
check "exit 0, peringatan untuk web@2, fixtures@e tetap dihapus" '[ $rc -eq 0 ] && grep -q "gagal menghapus $W@$(d 2)" <<<"$out" && grep -q "hapus $F@$(d e)" <<<"$out"'

echo "4. argumen tidak dikenal / KEEP_LAST bukan angka"
bash "$SB/deploy/image-retention.sh" --force >/dev/null 2>&1; rc=$?
check "--force ditolak (exit 2)" '[ $rc -eq 2 ]'
KEEP_LAST=x bash "$SB/deploy/image-retention.sh" >/dev/null 2>&1; rc=$?
check "KEEP_LAST=x ditolak (exit 2)" '[ $rc -eq 2 ]'

echo
echo "lulus: $pass, gagal: $fail"
[ "$fail" -eq 0 ]
