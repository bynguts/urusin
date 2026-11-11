#!/usr/bin/env bash
# Mematikan dan mencopot runner laptop sepenuhnya:
#   1. hapus variabel URUSIN_RUNNER_UJI dulu (job baru kembali ke URUSIN_RUNNER, tidak antre ke runner yang mati),
#   2. tunggu job yang sedang jalan selesai (maks WAIT_MIN menit, bawaan 30; FORCE=1 = tidak menunggu). Kontainer
#      yang dimatikan di tengah job membuat registrasinya "busy" sampai GitHub menganggap job hilang,
#   3. hapus kontainer, volume workspace, dan image,
#   4. hapus registrasi runner berlabel urusin-laptop di GitHub, lalu pastikan sisanya 0.
#   deploy/ci-runner-laptop/down.sh
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
REPO=bynguts/urusin
LABEL=urusin-laptop
IMAGE=urusin-ci-runner-laptop:2.338.2
SEL="[.runners[] | select(any(.labels[]; .name == \"$LABEL\"))]"

gh variable delete URUSIN_RUNNER_UJI --repo "$REPO" 2>/dev/null && echo "URUSIN_RUNNER_UJI dihapus"
if [ "${FORCE:-0}" != 1 ]; then
  for _ in $(seq 1 $((${WAIT_MIN:-30} * 4))); do
    [ "$(gh api "repos/$REPO/actions/runners" --jq "$SEL | map(select(.busy)) | length")" = 0 ] && break
    echo "runner laptop masih menjalankan job; menunggu (FORCE=1 untuk tidak menunggu)"
    sleep 15
  done
fi
for name in $(docker ps -a --filter label=urusin.ci-runner-laptop=1 --format '{{.Names}}'); do
  docker rm -f "$name" >/dev/null && docker volume rm "$name-work" >/dev/null && echo "$name: kontainer dan volume dihapus"
done
docker image rm "$IMAGE" >/dev/null 2>&1
# Setelah FORCE=1 registrasi bisa masih "busy" (HTTP 422) beberapa menit: ulangi sampai 10 menit.
for id in $(gh api "repos/$REPO/actions/runners" --jq "$SEL | .[].id"); do
  for _ in $(seq 1 40); do
    gh api -X DELETE "repos/$REPO/actions/runners/$id" >/dev/null 2>&1 && { echo "registrasi runner $id dihapus"; break; }
    sleep 15
  done
done
left="$(gh api "repos/$REPO/actions/runners" --jq "$SEL | length")"
echo "sisa runner berlabel $LABEL: $left"
[ "$left" = 0 ]
