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
printf '{\n  "packageManager": "pnpm@10.20.0"\n}\n' > "$WS/package.json"
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
check "build membuang ref lokal job ini saja (:sha dan @digest, tanpa -f/prune image)" '[[ "$calls" == *"[image] [rm] [ghcr.io/bynguts/urusin-web:$SHA]"* && "$calls" == *"[image] [rm] [ghcr.io/bynguts/urusin-web@$DIG]"* ]] && [[ "$calls" != *"image] [prune"* && "$calls" != *"system"* ]]'
check "cache builder dipangkas ke 1,5 GB setelah build" '[[ "$calls" == *"[buildx] [prune] [--builder] [urusin-ci] [--force] [--max-used-space] [1500mb]"* ]]'

echo "== pw (kontainer Playwright)"
SHIM_DF_PCT=50 cid pw e2e "$WS" "$SHA"
run_line="$(grep '^docker \[run\]' <<<"$calls")"
check "e2e menjalankan satu docker run" '[ $rc -eq 0 ] && [ "$(grep -c "^docker \[run\]" <<<"$calls")" = 1 ]'
check "image = basis Playwright dipin digest dari Dockerfile pendamping" '[[ "$run_line" == *"[$PIN]"* ]]'
check "batas sumber daya (--cpus 1.5 bobot rendah, memori 4g, pids)" '[[ "$run_line" == *"[--cpus] [1.5]"* && "$run_line" != *"[--cpu-period]"* && "$run_line" == *"[--cpu-shares] [256]"* && "$run_line" == *"[--memory] [4g]"* && "$run_line" == *"[--pids-limit] [2048]"* ]]'
check "tanpa --privileged / --network host / --pid host" '[[ "$run_line" != *"privileged"* && "$run_line" != *"[--network] [host]"* && "$run_line" != *"[--pid]"* ]]'
check "cap-drop ALL, seccomp dari salinan terpasang" '[[ "$run_line" == *"[--cap-drop] [ALL]"* && "$run_line" == *"[seccomp=$URUSIN_CI_ROOT/etc/pendamping-seccomp.json]"* ]]'
check "satu-satunya mount host = workspace" '[ "$(grep -o "\[-v\]" <<<"$run_line" | wc -l)" = 1 ] && [[ "$run_line" == *"[-v] [$WS:/work]"* ]]'
check "tanpa no-new-privileges (sandbox setuid, ADR 0029) dan tanpa --no-sandbox" '[[ "$run_line" != *"no-new-privileges"* && "$run_line" != *"--no-sandbox"* ]]'
check "e2e menjalankan pnpm e2e sebagai uid pemilik workspace" '[[ "$run_line" == *"pnpm e2e"* && "$run_line" == *"[PW_UID=$(stat -c %u "$WS")]"* ]]'
check "pw tidak login GHCR" '[[ "$calls" != *"[login]"* ]]'
check "versi pnpm dibaca di host lalu dioper lewat env (root kontainer tanpa capability tak bisa membaca workspace 0750)" '[[ "$run_line" == *"[PNPM_VERSION=10.20.0]"* && "$run_line" != *"/work/package.json"* ]]'
SHIM_DF_PCT=50 cid pw perf "$WS" "$SHA"
check "perf menjalankan lhci autorun" '[ $rc -eq 0 ] && [[ "$calls" == *"lhci autorun"* ]]'
run_line="$(grep '^docker \[run\]' <<<"$calls")"
check "perf: kuota CPU sama 1,5 dengan periode CFS 10 ms (tanpa --cpus), batas lain tetap" '[[ "$run_line" == *"[--cpu-period] [10000] [--cpu-quota] [15000]"* && "$run_line" != *"[--cpus]"* && "$run_line" == *"[--cpu-shares] [256]"* && "$run_line" == *"[--memory] [4g]"* && "$run_line" == *"[--pids-limit] [2048]"* ]]'
printf 'FROM mcr.microsoft.com/playwright:v1.65.0-noble AS pwbasis\n' > "$WS/apps/pendamping/Dockerfile"
SHIM_DF_PCT=50 cid pw e2e "$WS" "$SHA"
check "basis Playwright tanpa pin digest ditolak" '[ $rc -ne 0 ] && [ -z "$calls" ]'
printf 'FROM %s AS pwbasis\n' "$PIN" > "$WS/apps/pendamping/Dockerfile"
printf '{}\n' > "$WS/package.json"
SHIM_DF_PCT=50 cid pw e2e "$WS" "$SHA"
check "package.json tanpa packageManager pnpm ditolak sebelum docker run" '[ $rc -ne 0 ] && [ -z "$calls" ]'
printf '{\n  "packageManager": "pnpm@10.20.0"\n}\n' > "$WS/package.json"

echo "== smoke (hanya arsitektur native, semua dengan timeout)"
printf 'enabled\n' > "$SB/binfmt-ada"
export URUSIN_CI_ARCH=aarch64 URUSIN_CI_BINFMT="$SB/binfmt-ada"
REF="ghcr.io/bynguts/urusin-web@$DIG"
SHIM_DF_PCT=50 cid smoke web "$DIG" "$WS"
check "smoke web lulus di host arm64" '[ $rc -eq 0 ]'
check "manifest index diperiksa (imagetools inspect --raw)" '[[ "$calls" == *"[buildx] [imagetools] [inspect] [--raw] [$REF]"* ]]'
check "hanya varian native yang ditarik (satu pull linux/arm64)" '[ "$(grep -c "^docker \[pull\]" <<<"$calls")" = 1 ] && [[ "$calls" == *"[pull] [-q] [--platform] [linux/arm64] [$REF]"* ]]'
check "tidak ada pull/run amd64 (qemu)" '[[ "$calls" != *"linux/amd64"* ]]'
check "kontainer smoke bernama urusin-ci-smoke-* (bisa dihentikan paksa)" '[[ "$(grep "^docker \[run\]" <<<"$calls")" == *"[--name] [urusin-ci-smoke-"* ]]'
check "image smoke dibuang (tanpa -f, tanpa prune)" '[[ "$calls" == *"[image] [rm] [$REF]"* ]] && [[ "$calls" != *"prune"* && "$calls" != *"[rm] [-f] [$REF]"* ]]'
SHIM_DF_PCT=50 cid smoke pendamping "$DIG" "$WS"
check "smoke pendamping: 3 run native, semuanya urusin-ci-smoke-*" '[ $rc -eq 0 ] && [ "$(grep -c "^docker \[run\]" <<<"$calls")" = 3 ] && [ "$(grep "^docker \[run\]" <<<"$calls" | grep -c "\[--name\] \[urusin-ci-smoke-")" = 3 ] && [[ "$calls" != *"linux/amd64"* ]]'
SHIM_PLATFORMS="linux/arm64" SHIM_DF_PCT=50 cid smoke web "$DIG" "$WS"
check "binfmt ada tetapi manifest tanpa amd64: ditolak sebelum pull" '[ $rc -ne 0 ] && [[ "$out" == *"tanpa linux/amd64"* ]] && [[ "$calls" != *"[pull]"* ]]'
URUSIN_CI_BINFMT="$SB/tidak-ada" SHIM_PLATFORMS="linux/arm64" SHIM_DF_PCT=50 cid smoke web "$DIG" "$WS"
check "tanpa binfmt: index arm64 saja cukup" '[ $rc -eq 0 ]'
SHIM_RUN_RC=124 SHIM_DF_PCT=50 cid smoke fixtures "$DIG" "$WS"
check "smoke melewati timeout: gagal, kontainer dihentikan paksa, image tetap dibuang" '[ $rc -ne 0 ] && [[ "$out" == *"melewati"* ]] && [[ "$calls" == *"[rm] [-f] [urusin-ci-smoke-"* ]] && [[ "$calls" == *"[image] [rm] [ghcr.io/bynguts/urusin-fixtures@$DIG]"* ]]'
URUSIN_CI_ARCH=riscv64 SHIM_DF_PCT=50 cid smoke web "$DIG" "$WS"
check "arsitektur host tak dikenal ditolak sebelum pull" '[ $rc -ne 0 ] && [[ "$calls" != *"[pull]"* ]]'
smoke_src="$(sed -n '/^cmd_smoke()/,/^}/p' "$CI/ci-docker")"
check "di cmd_smoke tidak ada docker run tanpa batas waktu" '[ -n "$smoke_src" ] && ! grep -q "docker run" <<<"$smoke_src" && grep -q "timeout 900 docker pull" <<<"$smoke_src"'
unset URUSIN_CI_ARCH URUSIN_CI_BINFMT

echo "== alias / builder"
cid alias "$SHA" rc1
check "alias membuat tag dari digest :<sha> (imagetools create, bukan build)" '[ $rc -eq 0 ] && [ "$(grep -c "\[imagetools\] \[create\]" <<<"$calls")" = 3 ] && [[ "$calls" != *"[build]"* ]]'
cid builder-gc
check "gc hanya untuk builder urusin-ci, batas 1,5 GB (bukan prune global)" '[[ "$calls" == *"[buildx] [prune] [--builder] [urusin-ci] [--force] [--max-used-space] [1500mb]"* ]] && [[ "$calls" != *"[system]"* && "$calls" != *"[builder] [prune]"* ]]'
cid cleanup
check "cleanup hanya kontainer urusin-ci-pw-* dan urusin-ci-smoke-* (tanpa prune)" '[ $rc -eq 0 ] && [[ "$calls" == *"[name=^urusin-ci-pw-] [--filter] [name=^urusin-ci-smoke-]"* ]] && [[ "$calls" != *"prune"* ]]'
SHIM_NO_BUILDER=1 cid builder-init
check "builder-init: docker-container + buildkitd.toml + batas CPU/memori" '[[ "$calls" == *"[--driver] [docker-container]"* && "$calls" == *"buildkitd.toml]"* && "$calls" == *"memory=4g"* ]]'

echo "== hook job-started"
out="$(PATH="$HERE/shims-ci:$PATH" SHIM_DF_PCT=87 bash "$CI/job-started.sh" 2>&1)"
rc=$?
check "disk 87% boleh jalan" '[ $rc -eq 0 ] && [[ "$out" == *"87%"* ]]'
out="$(PATH="$HERE/shims-ci:$PATH" SHIM_DF_PCT=88 bash "$CI/job-started.sh" 2>&1)"
rc=$?
check "disk 88% menggagalkan job dengan ::error::" '[ $rc -ne 0 ] && [[ "$out" == "::error::"* ]]'

echo "== hook job-completed"
mkdir -p "$SB/bin" "$WS/node_modules/x" "$WS/apps/web/node_modules/y" "$SB/luar/x/node_modules"
printf '#!/usr/bin/env bash\necho "$*" >> "%s/sudo.log"\n' "$SHIM_DIR" > "$SB/bin/sudo"
chmod +x "$SB/bin/sudo"
# Salinan uji dengan akar _work dialihkan ke sandbox (skrip asli memakai path tetap /opt/urusin-ci).
sed "s#/opt/urusin-ci/runner/#$URUSIN_CI_ROOT/runner/#" "$CI/job-completed.sh" > "$SB/job-completed"
printf '#!/usr/bin/env bash\necho "$*" >> "%s/pnpm.log"\n' "$SHIM_DIR" > "$SB/bin/pnpm"
chmod +x "$SB/bin/pnpm"
H="$URUSIN_CI_ROOT/runner/_home"
mkdir -p "$H/.local/share/pnpm/store/v10"
head -c 2097152 /dev/zero > "$H/.local/share/pnpm/store/v10/blob"
jc() { out="$(HOME="$H" GITHUB_WORKSPACE="$1" PATH="$SB/bin:$HERE/shims-ci:$PATH" SHIM_DF_PCT=84 PNPM_STORE_MAX_MB="${MAXMB:-1024}" bash -e -o pipefail "$SB/job-completed" 2>&1)"; rc=$?; }  # seperti runner: bash -e -o pipefail
jc "$WS"
check "job-completed: hapus node_modules workspace, cleanup lewat sudo, cetak df" '[ $rc -eq 0 ] && [ ! -e "$WS/node_modules" ] && [ ! -e "$WS/apps/web/node_modules" ] && grep -q "^-n /opt/urusin-ci/bin/ci-docker cleanup$" "$SHIM_DIR/sudo.log" && [[ "$out" == *"84%"* ]]'
check "job-completed: pnpm store prune; store di bawah batas tetap ada" 'grep -qx "store prune" "$SHIM_DIR/pnpm.log" && [ -f "$H/.local/share/pnpm/store/v10/blob" ]'
MAXMB=1 jc "$WS"
check "job-completed: store di atas batas keras dihapus" '[ $rc -eq 0 ] && [ ! -e "$H/.local/share/pnpm/store" ]'
# Job tanpa pnpm (mis. Gitleaks): tidak ada pnpm di PATH dan tidak ada $HOME/setup-pnpm. Di bawah bash -e hook
# tetap harus keluar 0 (dulu: substitusi `command -v pnpm || find` gagal -> hook exit 1 -> job ditandai gagal).
mkdir -p "$SB/binsudo" && cp "$SB/bin/sudo" "$SB/binsudo/sudo"
out="$(HOME="$H" GITHUB_WORKSPACE="$WS" PATH="$SB/binsudo:$HERE/shims-ci:/usr/bin:/bin" SHIM_DF_PCT=84 bash -e -o pipefail "$SB/job-completed" 2>&1)"; rc=$?
check "job-completed: tanpa pnpm dan tanpa setup-pnpm tetap exit 0 di bawah bash -e" '[ $rc -eq 0 ] && [[ "$out" == *"84%"* ]]'
jc "$SB/luar/x"
check "job-completed: tidak menyentuh di luar _work" '[ $rc -eq 0 ] && [ -d "$SB/luar/x/node_modules" ]'

echo "== berkas pemasangan"
check "unit: batas CPU/memori/IO + prestart root + hook job-completed" 'grep -q "^CPUQuota=150%" "$CI/urusin-ci-runner.service" && grep -q "^MemoryMax=" "$CI/urusin-ci-runner.service" && grep -q "^IOWeight=" "$CI/urusin-ci-runner.service" && grep -q "^ExecStartPre=+/opt/urusin-ci/bin/runner-prestart" "$CI/urusin-ci-runner.service" && grep -q "^Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/urusin-ci/bin/job-completed\.sh$" "$CI/urusin-ci-runner.service"'
check "unit: setiap hook runner berakhiran .sh/.ps1/.js (runner menolak path lain)" '[ "$(grep -c "^Environment=ACTIONS_RUNNER_HOOK_JOB_" "$CI/urusin-ci-runner.service")" -eq 2 ] && ! grep "^Environment=ACTIONS_RUNNER_HOOK_JOB_" "$CI/urusin-ci-runner.service" | grep -Evq "\.(sh|ps1|js)$" && (for h in $(grep "^Environment=ACTIONS_RUNNER_HOOK_JOB_" "$CI/urusin-ci-runner.service" | sed "s#.*/bin/##"); do [ -f "$CI/$h" ] && grep -q " $h" "$CI/install.sh" || exit 1; done)'
WF="$HERE/../../.github/workflows"
check "workflow: job pull_request tidak pernah ke runner self-hosted" '[ "$(grep -h "URUSIN_RUNNER" "$WF"/*.yml | grep -c "runs-on:")" -ge 1 ] && ! grep -h "runs-on:.*URUSIN_RUNNER" "$WF"/*.yml | grep -vq "github.event_name != '"'"'pull_request'"'"' && vars.URUSIN_RUNNER"'
check "unit: runner persisten (run.sh), tanpa runner-start/JIT" 'grep -q "^ExecStart=/opt/urusin-ci/runner/run.sh" "$CI/urusin-ci-runner.service" && ! grep -q "runner-start" "$CI/urusin-ci-runner.service" && [ ! -e "$CI/runner-start" ]'
check "tanpa PAT di box: tanpa jitconfig/--ephemeral; gh-admin-token hanya dihapus" '! grep -nE "generate-jitconfig|--ephemeral|--jitconfig" "$CI"/install.sh "$CI"/uninstall.sh "$CI"/runner-prestart && [ "$(grep -c gh-admin-token "$CI/install.sh")" = 1 ] && grep -q "rm -f.*gh-admin-token" "$CI/install.sh"'
check "token registrasi/remove lewat env, bukan argumen --token" '! grep -nE -- "--token" "$CI"/install.sh "$CI"/uninstall.sh && grep -q "ACTIONS_RUNNER_INPUT_TOKEN=" "$CI/install.sh" && grep -q "ACTIONS_RUNNER_INPUT_TOKEN=" "$CI/uninstall.sh"'
check "install: tidak pernah menambah user ke grup docker / sysctl / daemon.json" '! grep -nE "usermod|gpasswd|sysctl -w|daemon.json.*>|binfmt --install|prune -a|system prune" "$CI/install.sh" | grep -v "^[0-9]*:#"'
check "buildkitd: cache dibatasi 1,5 GB" '[ "$(grep -c "maxUsedSpace = \"1500MB\"" "$CI/buildkitd.toml")" = 3 ] && ! grep -qE "^ *(keepBytes|gckeepstorage)" "$CI/buildkitd.toml"'

echo
echo "ci-runner: $pass lulus, $fail gagal"
[ "$fail" -eq 0 ]
