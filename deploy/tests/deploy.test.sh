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
  chmod 751 "$SB/deploy" && chmod 600 "$SB/deploy/.env"
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
check "blue dipromosikan (penanda warna aktif)" '[ "$(cat "$SHIM_DIR/promoted")" = blue ]'
check "riwayat tercatat" '[ "$(wc -l < "$SB/deploy/.env.images.history")" -eq 1 ]'

echo "2. deploy kedua: pindah ke green, blue dihentikan"
export SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "exit 0" '[ $RC -eq 0 ]'
check "ACTIVE_COLOR=green" 'images | grep -q "^ACTIVE_COLOR=green$"'
check "migrasi: green=0 setelah sukses, blue tidak 1" 'images | grep -q "^RUN_MIGRATIONS_GREEN=0$" && ! images | grep -q "^RUN_MIGRATIONS_BLUE=1$"'
check "blue dihentikan" '[ ! -f "$SHIM_DIR/running.blue" ]'
check "green berjalan dengan SHA B" '[ "$(cat "$SHIM_DIR/running.green")" = "$SHA_B" ]'
check "green dipromosikan" '[ "$(cat "$SHIM_DIR/promoted")" = green ]'
check "cetak perintah rollback manual" 'grep -q "rollback manual" "$SB/out.log"'
check "smoke publik OK" 'grep -q "smoke publik OK" "$SB/out.log"'

echo "3. gitSha salah di warna baru: rollback otomatis, exit non-zero"
export SHIM_LABEL="$SHA_A" SHIM_SERVE_BLUE="deadbeefdeadbeef"
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "pesan ROLLBACK" 'grep -q "ROLLBACK" "$SB/out.log"'
check "green (lama) tetap melayani SHA B" '[ "$(cat "$SHIM_DIR/running.green")" = "$SHA_B" ]'
check "blue yang gagal dihentikan" '[ ! -f "$SHIM_DIR/running.blue" ]'
check "penanda tetap green (tidak pernah dipromosikan ke blue)" '[ "$(cat "$SHIM_DIR/promoted")" = green ]'
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
export SHIM_LABEL="cccccccccccccccccccccccccccccccccccccccc"
: > "$SHIM_DIR/calls.log"
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero" '[ $RC -ne 0 ]'
check "tidak ada compose up" '! calls | grep -q "compose.* up "'
check "pesan label" 'grep -q "label revision" "$SB/out.log"'

echo "7. provenance wajib (default): tanpa provenance, hanya SHA7, atau label pendek => ditolak sebelum up"
export SHIM_LABEL="$SHA_A" SHIM_PROVENANCE=null
: > "$SHIM_DIR/calls.log"
run_deploy "$SHA_A" "$DIG_A"
check "tanpa provenance -> exit non-zero" '[ $RC -ne 0 ]'
check "tidak ada compose up" '! calls | grep -q "compose.* up "'
export SHIM_PROVENANCE="{\"rev\":\"${SHA_A:0:7}\"}"
run_deploy "$SHA_A" "$DIG_A"
check "provenance hanya SHA7 -> ditolak (harus SHA lengkap)" '[ $RC -ne 0 ] && grep -q "SHA lengkap" "$SB/out.log"'
export SHIM_LABEL="${SHA_A:0:7}" SHIM_PROVENANCE="{\"rev\":\"$SHA_A\"}"
run_deploy "$SHA_A" "$DIG_A"
check "label SHA pendek -> ditolak" '[ $RC -ne 0 ] && grep -q "bukan SHA lengkap" "$SB/out.log"'
export SHIM_LABEL="$SHA_A" SHIM_PROVENANCE=null REQUIRE_PROVENANCE=0
run_deploy "$SHA_A" "$DIG_A"
check "REQUIRE_PROVENANCE=0 hanya label -> diterima dengan peringatan" '[ $RC -eq 0 ] && grep -q "PERINGATAN" "$SB/out.log"'
unset REQUIRE_PROVENANCE

echo "8. provenance memuat SHA lengkap: diterima"
export SHIM_PROVENANCE="{\"SLSA\":{\"invocation\":{\"configSource\":{\"digest\":{\"sha1\":\"$SHA_A\"}}}}}"
run_deploy "$SHA_A" "$DIG_A"
check "exit 0" '[ $RC -eq 0 ]'
check "pesan provenance memuat SHA lengkap" 'grep -q "provenance memuat SHA lengkap" "$SB/out.log"'
unset SHIM_PROVENANCE

echo "8b. image tanpa /api/ready: ditolak sebelum promosi"
export SHIM_NO_READY=1
run_deploy "$SHA_A" "$DIG_A"
check "exit non-zero, tidak ada promosi ke warna baru" '[ $RC -ne 0 ] && grep -q "api/ready" "$SB/out.log"'
unset SHIM_NO_READY

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

echo "13. host network: bind loopback + cek jangkauan LLM"
new_sandbox
cp "$DEPLOY/check-llm-reach.sh" "$SB/deploy/check-llm-reach.sh"
export SHIM_LABEL="$SHA_A"
run_deploy "$SHA_A" "$DIG_A"
check "deploy sukses; pemeriksaan LLM dijalankan sebelum promosi" '[ $RC -eq 0 ] && grep -q "HTTP 401" "$SB/out.log"'
export SHIM_LLM_FAIL=1 SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "LLM tak terjangkau: hanya peringatan, deploy tetap sukses" '[ $RC -eq 0 ] && grep -q "tidak menjangkau LLM_BASE_URL" "$SB/out.log"'
export REQUIRE_LLM=1 SHIM_LABEL="$SHA_A"
run_deploy "$SHA_A" "$DIG_A"
check "REQUIRE_LLM=1: gagal + rollback, warna lama tetap dipromosikan" '[ $RC -ne 0 ] && grep -q "ROLLBACK" "$SB/out.log" && [ "$(cat "$SHIM_DIR/promoted")" = "$(sed -n "s/^ACTIVE_COLOR=//p" "$SB/deploy/.env.images")" ]'
unset SHIM_LLM_FAIL REQUIRE_LLM
export SHIM_SS_WILDCARD=1 SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "bind 0.0.0.0 ditolak + rollback" '[ $RC -ne 0 ] && grep -q "semua antarmuka" "$SB/out.log"'
unset SHIM_SS_WILDCARD
check "bind non-loopback tertangkap di loop tunggu (sebelum promosi)" 'grep -q "tidak sehat" "$SB/out.log" && ! grep -q "smoke publik OK" "$SB/out.log"'
new_sandbox
export SHIM_LABEL="$SHA_A"
run_deploy "$SHA_A" "$DIG_A"
export SHIM_LABEL="$SHA_B" SHIM_SS_WILDCARD_PORT=4310
run_deploy "$SHA_B" "$DIG_B"
check "warna aktif (:4310) terikat 0.0.0.0: deploy gagal + rollback" '[ $RC -ne 0 ] && grep -q "web-blue (aktif, :4310) mendengarkan di luar 127.0.0.1" "$SB/out.log" && grep -q ROLLBACK "$SB/out.log"'
unset SHIM_SS_WILDCARD_PORT

echo "13e. smoke publik lewat /api/ready; /api/health publik harus 404"
new_sandbox
export SHIM_LABEL="$SHA_A"
run_deploy "$SHA_A" "$DIG_A"
check "smoke publik memakai /api/ready, bukan /api/health" '[ $RC -eq 0 ] && grep -q "https://urusin.test/api/ready" "$SHIM_DIR/calls.log" && ! grep -q "fsS.*https://urusin.test/api/health" "$SHIM_DIR/calls.log"'
check "/api/health publik 404: tanpa peringatan" '! grep -q "api/health publik" "$SB/out.log"'
export SHIM_PUBLIC_HEALTH_CODE=200 SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "/api/health publik 200: peringatan snippet lama, deploy tetap sukses" '[ $RC -eq 0 ] && grep -q "api/health publik -> HTTP 200" "$SB/out.log"'
unset SHIM_PUBLIC_HEALTH_CODE

echo "13b. drain turn sebelum menghentikan warna lama"
new_sandbox
export SHIM_LABEL="$SHA_A"
run_deploy "$SHA_A" "$DIG_A"
export SHIM_LABEL="$SHA_B" SHIM_TURNS=0
run_deploy "$SHA_B" "$DIG_B"
check "runningTurns=0: tidak menunggu" '[ $RC -eq 0 ] && ! grep -q "menunggu .* di web-" "$SB/out.log"'
export SHIM_LABEL="$SHA_A" SHIM_TURNS=2
run_deploy "$SHA_A" "$DIG_A"
check "runningTurns>0: menunggu sampai batas drain lalu tetap berhenti (peringatan)" '[ $RC -eq 0 ] && grep -q "menunggu 2 di web-" "$SB/out.log" && grep -q "batas drain" "$SB/out.log"'
unset SHIM_TURNS
export SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "field runningTurns tidak ada (image lama): menunggu penuh" '[ $RC -eq 0 ] && grep -q "jumlah tidak diketahui" "$SB/out.log"'
check "DOCKER_CONFIG tidak ditulis: skrip tidak menyebut ~/.docker" '! grep -rEq "(~|\$HOME)/\.docker" "$DEPLOY"/*.sh'

echo "13c. login GHCR sementara lewat GHCR_TOKEN"
new_sandbox
export SHIM_LABEL="$SHA_A" GHCR_TOKEN="tok-uji-ghcr" TMPDIR="$SB/tmp"
mkdir -p "$TMPDIR"
run_deploy "$SHA_A" "$DIG_A"
check "login ke DOCKER_CONFIG sementara, token lewat stdin" '[ $RC -eq 0 ] && [ "$(cat "$SHIM_DIR/login.stdin")" = tok-uji-ghcr ] && case "$(cat "$SHIM_DIR/login.dir")" in "$TMPDIR"/urusin-docker-*) true ;; *) false ;; esac'
check "pull memakai DOCKER_CONFIG sementara" '[ "$(cat "$SHIM_DIR/pull.config")" = "$(cat "$SHIM_DIR/login.dir")" ]'
check "DOCKER_CONFIG sementara dihapus setelah selesai; token tidak di argumen" '[ ! -e "$(cat "$SHIM_DIR/login.dir")" ] && ! grep -q tok-uji-ghcr "$SHIM_DIR/calls.log"'
export SHIM_LOGIN_FAIL=1 SHIM_LABEL="$SHA_B"
run_deploy "$SHA_B" "$DIG_B"
check "login gagal: berhenti sebelum pull, direktori sementara dibersihkan" '[ $RC -ne 0 ] && grep -q "docker login ghcr.io gagal" "$SB/out.log" && [ -z "$(ls -A "$TMPDIR")" ]'
unset SHIM_LOGIN_FAIL GHCR_TOKEN TMPDIR
export DOCKER_CONFIG="$SB/dc" SHIM_LABEL="$SHA_A"
mkdir -p "$DOCKER_CONFIG"; rm -f "$SHIM_DIR/login.dir"
GHCR_TOKEN=tok-uji-ghcr run_deploy "$SHA_A" "$DIG_A"
check "DOCKER_CONFIG dari lingkungan dihormati (tanpa login baru)" '[ $RC -eq 0 ] && [ ! -e "$SHIM_DIR/login.dir" ] && [ "$(cat "$SHIM_DIR/pull.config")" = "$SB/dc" ]'
unset DOCKER_CONFIG

echo "14. compose.prod.yml dirender: host network, loopback saja"
PATH="$PATH_ORIG" bash "$HERE/compose-config.test.sh" 2>&1 | sed "s/^/  /"
check "compose-config lulus" '[ "${PIPESTATUS[0]}" -eq 0 ]'

echo "11. zero-downtime.sh: lulus tanpa kegagalan, gagal bila ada respons 5xx atau deploy gagal"
new_sandbox
printf '#!/usr/bin/env bash
exit 0
' > "$SB/deploy-ok"
printf '#!/usr/bin/env bash
exit 1
' > "$SB/deploy-bad"
chmod +x "$SB/deploy-ok" "$SB/deploy-bad"
zd() { (cd "$SB" && URL=https://zd.test/ GRACE=0 RPS=200 LOG="$SB/zd.log" DEPLOY_CMD="$1" bash "$HERE/zero-downtime.sh" "${@:2}") > "$SB/out.log" 2>&1; RC=$?; }
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

echo "izin direktori deploy dan rahasia (0751 / 0600)"
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) echo "  (dilewati: NTFS tanpa mode POSIX)" ;;
  *)
    new_sandbox
    chmod 644 "$SB/deploy/.env"
    run_deploy "$SHA_A" "$DIG_A"
    check ".env 0644 -> ditolak sebelum docker dipanggil" '[ $RC -ne 0 ] && grep -q "chmod 600" "$SB/out.log" && ! calls | grep -q "^docker"'
    new_sandbox
    chmod 755 "$SB/deploy"
    run_deploy "$SHA_A" "$DIG_A"
    check "direktori 0755 (others bisa membaca) -> ditolak" '[ $RC -ne 0 ] && grep -q "chmod 0751" "$SB/out.log"'
    new_sandbox
    install -m 640 /dev/null "$SB/deploy/.restic-password"
    run_deploy "$SHA_A" "$DIG_A"
    check ".restic-password 0640 -> ditolak" '[ $RC -ne 0 ] && grep -q ".restic-password" "$SB/out.log"'
    ;;
esac

echo
echo "lulus: $pass, gagal: $fail"
[ "$fail" -eq 0 ]
