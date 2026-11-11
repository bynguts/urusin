#!/usr/bin/env bash
# Mematikan dan mencopot runner laptop sepenuhnya:
#   1. hapus variabel URUSIN_RUNNER_UJI dulu (job kembali ke URUSIN_RUNNER, tidak antre ke runner yang mati),
#   2. hapus kontainer, volume workspace, dan image,
#   3. hapus registrasi runner berlabel urusin-laptop di GitHub, lalu pastikan sisanya 0.
#   deploy/ci-runner-laptop/down.sh
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
REPO=bynguts/urusin
LABEL=urusin-laptop
IMAGE=urusin-ci-runner-laptop:2.338.2
SEL="[.runners[] | select(any(.labels[]; .name == \"$LABEL\"))]"

gh variable delete URUSIN_RUNNER_UJI --repo "$REPO" 2>/dev/null && echo "URUSIN_RUNNER_UJI dihapus"
for name in $(docker ps -a --filter label=urusin.ci-runner-laptop=1 --format '{{.Names}}'); do
  docker rm -f "$name" >/dev/null && docker volume rm "$name-work" >/dev/null && echo "$name: kontainer dan volume dihapus"
done
docker image rm "$IMAGE" >/dev/null 2>&1
for id in $(gh api "repos/$REPO/actions/runners" --jq "$SEL | .[].id"); do
  gh api -X DELETE "repos/$REPO/actions/runners/$id" && echo "registrasi runner $id dihapus"
done
left="$(gh api "repos/$REPO/actions/runners" --jq "$SEL | length")"
echo "sisa runner berlabel $LABEL: $left"
[ "$left" = 0 ]
