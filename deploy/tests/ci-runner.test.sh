#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # ekspresi check() sengaja dievaluasi lewat eval
# Uji deploy/ci-runner (tanpa Docker sungguhan, tanpa root): bash deploy/tests/ci-runner.test.sh
# docker/df palsu di tests/shims-ci. Memeriksa validasi argumen ci-docker, flag Docker yang tetap (tanpa
# --privileged/--network host/mount host lain), token lewat stdin, penjaga disk 88%, hook job-started/-completed.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CI="$(cd "$HERE/../ci-runner" && pwd)"
pass=0
fail=0
check() { if eval "$2"; then pass=$((pass + 1)); echo "  ok   $1"; else fail=$((fail + 1)); echo "  FAIL $1  [$2]"; fi; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export SHIM_DIR="$SB/state" URUSIN_CI_ROOT="$SB/ci" URUSIN_CI_TEST_PATH="$HERE/shims-ci"
mkdir -p "$SHIM_DIR" "$URUSIN_CI_ROOT/etc" "$URUSIN_CI_ROOT/runner/_work/urusin/urusin/apps/pendamping" "$SB/luar/x"
WS="$URUSIN_CI_ROOT/runner/_work/urusin/urusin"
export URUSIN_CI_USER
URUSIN_CI_USER="$(stat -c %U "$WS")"
PIN='mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d'
printf 'FROM %s AS pwbasis\n' "$PIN" > "$WS/apps/pendamping/Dockerfile"
SHA=2175bb0c67fe37631a73ad92e23d600b705a018b
DIG="sha256:$(printf '%064d' 7)"
TOKEN=tokenuji-bukan-rahasia-jangan-jadi-argumen

cid() { : > "$SHIM_DIR/calls.log"; out="$(printf '%s\n' "$TOKEN" | bash "$CI/ci-docker" "$@" 2>&1)"; rc=$?; calls="$(cat "$SHIM_DIR/calls.log")"; }

echo "== validasi argumen (ditolak sebelum Docker dipanggil)"
cid hapus-semua
check "subperintah tak dikenal ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
cid build api "$SHA" "$WS"
check "nama image di luar web|fixtures|pendamping ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
cid build web 2175bb0 "$WS"
check "SHA pendek ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
cid build web "$SHA" "$SB/luar/x"
check "workspace di luar _work ditolak" '[ $rc -ne 0 ] && [[ "$out" == *"di luar"* ]] && [ -z "$calls" ]'
ln -s "$SB/luar" "$URUSIN_CI_ROOT/runner/_work/lompat" 2>/dev/null
if [ -L "$URUSIN_CI_ROOT/runner/_work/lompat" ]; then
  cid build web "$SHA" "$URUSIN_CI_ROOT/runner/_work/lompat/x"
  check "symlink keluar dari _work ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
fi
cid smoke web "sha256:abc" "$WS"
check "digest tidak lengkap ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
cid alias "$SHA" latest
check "tag rilis selain rc*/v* ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
cid pw rm "$WS" "$SHA"
check "job Playwright selain e2e|perf ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'

echo "== penjaga disk"
SHIM_DF_PCT=88 cid build web "$SHA" "$WS"
check "disk 88% menolak build" '[ $rc -ne 0 ] && [[ "$out" == *"88%"* ]] && [ -z "$calls" ]'
SHIM_DF_PCT=95 cid pw e2e "$WS" "$SHA"
check "disk 95% menolak e2e" '[ $rc -ne 0 ] && [ -z "$calls" ]'

echo "== build"
SHIM_DF_PCT=84 cid build web "$SHA" "$WS"
check "build sukses mencetak DIGEST" '[ $rc -eq 0 ] && [[ "$out" == *"DIGEST: $DIG"* ]]'
check "login GHCR lewat stdin" '[ "$(cat "$SHIM_DIR/login.stdin")" = "$TOKEN" ] && [[ "$calls" == *"[--password-stdin]"* ]]'
check "token tidak pernah jadi argumen docker" '[[ "$calls" != *"$TOKEN"* ]]'
check "DOCKER_CONFIG temp dihapus setelah selesai" '[ ! -e "$(cat "$SHIM_DIR/login.dir")" ]'
check "builder khusus urusin-ci + push + SBOM + provenance max" '[[ "$calls" == *"[--builder] [urusin-ci]"* && "$calls" == *"[--push] [--sbom=true] [--provenance=mode=max]"* ]]'
check "tag ghcr.io/bynguts/urusin-web:<sha> + GIT_SHA" '[[ "$calls" == *"[--tag] [ghcr.io/bynguts/urusin-web:$SHA]"* && "$calls" == *"[GIT_SHA=$SHA]"* ]]'
check "tanpa entitlement --allow / network host" '[[ "$calls" != *"--allow"* && "$calls" != *"network=host"* ]]'
check "cache builder dipangkas ke 3gb setelah build" '[[ "$calls" == *"[buildx] [prune] [--builder] [urusin-ci] [--force] [--keep-storage] [3gb]"* ]]'

echo "== pw (kontainer Playwright)"
SHIM_DF_PCT=50 cid pw e2e "$WS" "$SHA"
run_line="$(grep '^docker \[run\]' <<<"$calls")"
check "e2e menjalankan satu docker run" '[ $rc -eq 0 ] && [ "$(grep -c "^docker \[run\]" <<<"$calls")" = 1 ]'
check "image = basis Playwright dipin digest dari Dockerfile pendamping" '[[ "$run_line" == *"[$PIN]"* ]]'
check "batas sumber daya (--cpus 1.5 bobot rendah, memori 4g, pids)" '[[ "$run_line" == *"[--cpus] [1.5]"* && "$run_line" == *"[--cpu-shares] [256]"* && "$run_line" == *"[--memory] [4g]"* && "$run_line" == *"[--pids-limit] [2048]"* ]]'
check "tanpa --privileged / --network host / --pid host" '[[ "$run_line" != *"privileged"* && "$run_line" != *"[--network] [host]"* && "$run_line" != *"[--pid]"* ]]'
check "cap-drop ALL, seccomp dari salinan terpasang" '[[ "$run_line" == *"[--cap-drop] [ALL]"* && "$run_line" == *"[seccomp=$URUSIN_CI_ROOT/etc/pendamping-seccomp.json]"* ]]'
check "satu-satunya mount host = workspace" '[ "$(grep -o "\[-v\]" <<<"$run_line" | wc -l)" = 1 ] && [[ "$run_line" == *"[-v] [$WS:/work]"* ]]'
check "tanpa no-new-privileges (sandbox setuid, ADR 0029) dan tanpa --no-sandbox" '[[ "$run_line" != *"no-new-privileges"* && "$run_line" != *"--no-sandbox"* ]]'
check "e2e menjalankan pnpm e2e sebagai uid pemilik workspace" '[[ "$run_line" == *"pnpm e2e"* && "$run_line" == *"[PW_UID=$(stat -c %u "$WS")]"* ]]'
check "pw tidak login GHCR" '[[ "$calls" != *"[login]"* ]]'
SHIM_DF_PCT=50 cid pw perf "$WS" "$SHA"
check "perf menjalankan lhci autorun" '[ $rc -eq 0 ] && [[ "$calls" == *"lhci autorun"* ]]'
printf 'FROM mcr.microsoft.com/playwright:v1.65.0-noble AS pwbasis\n' > "$WS/apps/pendamping/Dockerfile"
SHIM_DF_PCT=50 cid pw e2e "$WS" "$SHA"
check "basis Playwright tanpa pin digest ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
printf 'FROM %s AS pwbasis\n' "$PIN" > "$WS/apps/pendamping/Dockerfile"

echo "== alias / builder"
cid alias "$SHA" rc1
check "alias membuat tag dari digest :<sha> (imagetools create, bukan build)" '[ $rc -eq 0 ] && [ "$(grep -c "\[imagetools\] \[create\]" <<<"$calls")" = 3 ] && [[ "$calls" != *"[build]"* ]]'
cid builder-gc
check "gc hanya untuk builder urusin-ci, batas 3gb (bukan prune global)" '[[ "$calls" == *"[buildx] [prune] [--builder] [urusin-ci] [--force] [--keep-storage] [3gb]"* ]] && [[ "$calls" != *"[system]"* && "$calls" != *"[builder] [prune]"* ]]'
cid cleanup
check "cleanup hanya kontainer urusin-ci-pw-* (tanpa prune)" '[ $rc -eq 0 ] && [[ "$calls" == *"[name=^urusin-ci-pw-]"* ]] && [[ "$calls" != *"prune"* ]]'
SHIM_NO_BUILDER=1 cid builder-init
check "builder-init: docker-container + buildkitd.toml + batas CPU/memori" '[[ "$calls" == *"[--driver] [docker-container]"* && "$calls" == *"buildkitd.toml]"* && "$calls" == *"memory=4g"* ]]'

echo "== hook job-started"
out="$(PATH="$HERE/shims-ci:$PATH" SHIM_DF_PCT=87 bash "$CI/job-started" 2>&1)"
rc=$?
check "disk 87% boleh jalan" '[ $rc -eq 0 ] && [[ "$out" == *"87%"* ]]'
out="$(PATH="$HERE/shims-ci:$PATH" SHIM_DF_PCT=88 bash "$CI/job-started" 2>&1)"
rc=$?
check "disk 88% menggagalkan job dengan ::error::" '[ $rc -ne 0 ] && [[ "$out" == "::error::"* ]]'

echo "== hook job-completed"
mkdir -p "$SB/bin" "$WS/node_modules/x" "$WS/apps/web/node_modules/y" "$SB/luar/x/node_modules"
printf '#!/usr/bin/env bash\necho "$*" >> "%s/sudo.log"\n' "$SHIM_DIR" > "$SB/bin/sudo"
chmod +x "$SB/bin/sudo"
# Salinan uji dengan akar _work dialihkan ke sandbox (skrip asli memakai path tetap /opt/urusin-ci).
sed "s#/opt/urusin-ci/runner/_work/#$URUSIN_CI_ROOT/runner/_work/#" "$CI/job-completed" > "$SB/job-completed"
jc() { out="$(GITHUB_WORKSPACE="$1" PATH="$SB/bin:$HERE/shims-ci:$PATH" SHIM_DF_PCT=84 bash "$SB/job-completed" 2>&1)"; rc=$?; }
jc "$WS"
check "job-completed: hapus node_modules workspace, cleanup lewat sudo, cetak df" '[ $rc -eq 0 ] && [ ! -e "$WS/node_modules" ] && [ ! -e "$WS/apps/web/node_modules" ] && grep -q "^-n /opt/urusin-ci/bin/ci-docker cleanup$" "$SHIM_DIR/sudo.log" && [[ "$out" == *"84%"* ]]'
jc "$SB/luar/x"
check "job-completed: tidak menyentuh di luar _work" '[ $rc -eq 0 ] && [ -d "$SB/luar/x/node_modules" ]'

echo "== berkas pemasangan"
check "unit: batas CPU/memori/IO + prestart root + hook job-completed" 'grep -q "^CPUQuota=150%" "$CI/urusin-ci-runner.service" && grep -q "^MemoryMax=" "$CI/urusin-ci-runner.service" && grep -q "^IOWeight=" "$CI/urusin-ci-runner.service" && grep -q "^ExecStartPre=+/opt/urusin-ci/bin/runner-prestart" "$CI/urusin-ci-runner.service" && grep -q "^Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/urusin-ci/bin/job-completed" "$CI/urusin-ci-runner.service"'
check "unit: runner persisten (run.sh), tanpa runner-start/JIT" 'grep -q "^ExecStart=/opt/urusin-ci/runner/run.sh" "$CI/urusin-ci-runner.service" && ! grep -q "runner-start" "$CI/urusin-ci-runner.service" && [ ! -e "$CI/runner-start" ]'
check "tanpa PAT di box: tanpa jitconfig/--ephemeral; gh-admin-token hanya dihapus" '! grep -nE "generate-jitconfig|--ephemeral|--jitconfig" "$CI"/install.sh "$CI"/uninstall.sh "$CI"/runner-prestart && [ "$(grep -c gh-admin-token "$CI/install.sh")" = 1 ] && grep -q "rm -f.*gh-admin-token" "$CI/install.sh"'
check "token registrasi/remove lewat env, bukan argumen --token" '! grep -nE -- "--token" "$CI"/install.sh "$CI"/uninstall.sh && grep -q "ACTIONS_RUNNER_INPUT_TOKEN=" "$CI/install.sh" && grep -q "ACTIONS_RUNNER_INPUT_TOKEN=" "$CI/uninstall.sh"'
check "install: tidak pernah menambah user ke grup docker / sysctl / daemon.json" '! grep -nE "usermod|gpasswd|sysctl -w|daemon.json.*>|binfmt --install|prune -a|system prune" "$CI/install.sh" | grep -v "^[0-9]*:#"'
check "buildkitd: cache dibatasi 3 GB" 'grep -q "^ *gckeepstorage = 3000000000" "$CI/buildkitd.toml" && grep -q "keepBytes = 3000000000" "$CI/buildkitd.toml"'

echo
echo "ci-runner: $pass lulus, $fail gagal"
[ "$fail" -eq 0 ]
