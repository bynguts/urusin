#!/usr/bin/env bash
# Jalankan Browser Pendamping (profil compose `pendamping`): pendamping + pendamping-edge.
#   deploy/pendamping-up.sh
# Menolak jalan bila Docker Engine < 28 (lihat docker-versi.sh), lalu `up -d` kedua layanan. Image dari
# PENDAMPING_IMAGE (@digest) di .env. Sesudahnya menunggu /health edge (127.0.0.1:4330) dan memastikan `sha` yang
# dilaporkan worker = label revision image (GIT_SHA dibakar ke image saat build; compose tidak menimpanya).
# Variabel: PENDAMPING_WAIT (detik, bawaan 120).
set -euo pipefail
cd "$(dirname "$0")"
die() { echo "pendamping-up: $*" >&2; exit 1; }
command -v docker >/dev/null || die "docker tidak ditemukan"
[ -f .env ] || die ".env tidak ada"
# shellcheck source=docker-versi.sh
. ./docker-versi.sh
pastikan_docker_28 || die "$DOCKER_VERSI_PESAN"
img="$(sed -n 's/^PENDAMPING_IMAGE=//p' .env | tail -n 1 | tr -d "\"'\r")"
[[ "$img" =~ ^ghcr\.io/bynguts/urusin-pendamping@sha256:[0-9a-f]{64}$ ]] \
  || die "PENDAMPING_IMAGE di .env harus ghcr.io/bynguts/urusin-pendamping@sha256:<digest>"
if grep -q '^GIT_SHA_PENDAMPING=' .env; then
  echo "pendamping-up: catatan: GIT_SHA_PENDAMPING di .env tidak dipakai lagi (sha = label image); boleh dihapus"
fi
COMPOSE_PROFILES=pendamping docker compose -f compose.prod.yml --env-file .env up -d pendamping pendamping-edge

# Label revision = SHA build (sama dengan GIT_SHA image). Image lokal setelah `up`.
label="$(docker image inspect "$img" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
wait_s="${PENDAMPING_WAIT:-120}"
[[ "$wait_s" =~ ^[0-9]+$ ]] || die "PENDAMPING_WAIT harus angka"
h=""
for _ in $(seq 1 "$wait_s"); do
  h="$(curl -fsS --max-time 3 http://127.0.0.1:4330/health 2>/dev/null || true)"
  case "$h" in '{"ok":true'*) break ;; esac
  h=""
  sleep 1
done
[ -n "$h" ] || die "pendamping belum sehat setelah ${wait_s} s (docker compose logs pendamping pendamping-edge)"
echo "pendamping-up: sehat $h"
sha="$(sed -nE 's/.*"sha":"([0-9a-f]+)".*/\1/p' <<<"$h")"
if [ -z "$sha" ]; then
  echo "pendamping-up: peringatan: /health tanpa sha (image lama); revision image ${label:-tidak diketahui}" >&2
elif [[ ! "$label" =~ ^[0-9a-f]{40}$ ]] || [ "${label#"$sha"}" = "$label" ]; then
  die "/health sha $sha != label revision image (${label:-kosong})"
else
  echo "pendamping-up: sha $sha = revision image"
fi
