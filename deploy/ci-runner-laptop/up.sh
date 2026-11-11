#!/usr/bin/env bash
# Menyalakan runner CI kedua di laptop (Docker Desktop, Linux x64) dan mengarahkan job non-ci-docker ke sana.
#   deploy/ci-runner-laptop/up.sh
# Env opsional: RUNNERS (bawaan 1), CPUS (6), MEMORY (2g), MEMORY_SWAP (3g).
# VM Docker Desktop laptop hanya 4 GB (+2 GB swap, ~/.wslconfig) dan dipakai bersama worker urusin-worker-id-*,
# jadi memori dibatasi 2 GB per runner. Tanpa port terbuka, tanpa socket Docker di dalam kontainer.
# Token registrasi hanya lewat stdin ke config.sh di dalam kontainer; tidak pernah ke env/argumen/berkas.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
REPO=bynguts/urusin
LABEL=urusin-laptop
IMAGE=urusin-ci-runner-laptop:2.338.2
cd "$(dirname "$0")"

docker build -q -t "$IMAGE" . >/dev/null
for i in $(seq 1 "${RUNNERS:-1}"); do
  name="urusin-ci-laptop-$i"
  if docker container inspect "$name" >/dev/null 2>&1; then
    docker start "$name" >/dev/null
    echo "$name: sudah ada, dipastikan jalan"
    continue
  fi
  docker run -d --name "$name" --restart unless-stopped \
    --cpus "${CPUS:-6}" --memory "${MEMORY:-2g}" --memory-swap "${MEMORY_SWAP:-3g}" --pids-limit 4096 \
    --label urusin.ci-runner-laptop=1 -v "$name-work:/home/runner/_work" "$IMAGE" >/dev/null
  # shellcheck disable=SC2016  # $1..$3 dan $t dievaluasi bash di dalam kontainer
  if ! out="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token |
    docker exec -i "$name" bash -c 'read -r t && ACTIONS_RUNNER_INPUT_TOKEN="$t" ./config.sh --unattended \
      --url "https://github.com/$1" --name "$2" --labels "$3" --work _work --replace' _ "$REPO" "$name" "$LABEL" 2>&1)"; then
    printf '%s\n' "$out" | grep -v '^\[RUNNER ' | tail -n 20 >&2
    docker rm -f "$name" >/dev/null
    echo "$name: pendaftaran gagal, kontainer dibuang" >&2
    exit 1
  fi
  echo "$name: terdaftar (label $LABEL)"
done
gh variable set URUSIN_RUNNER_UJI --repo "$REPO" --body "$LABEL"
echo "URUSIN_RUNNER_UJI=$LABEL: job non-ci-docker di ci.yml kini ke runner laptop (perf/e2e tetap agent-vm)."
