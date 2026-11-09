#!/usr/bin/env bash
# Jalankan Browser Pendamping (profil compose `pendamping`): pendamping + pendamping-edge.
#   deploy/pendamping-up.sh
# Menolak jalan bila Docker Engine < 28 (lihat docker-versi.sh), lalu `up -d` kedua layanan.
set -euo pipefail
cd "$(dirname "$0")"
die() { echo "pendamping-up: $*" >&2; exit 1; }
command -v docker >/dev/null || die "docker tidak ditemukan"
[ -f .env ] || die ".env tidak ada"
# shellcheck source=docker-versi.sh
. ./docker-versi.sh
pastikan_docker_28 || die "$DOCKER_VERSI_PESAN"
COMPOSE_PROFILES=pendamping docker compose -f compose.prod.yml --env-file .env up -d pendamping pendamping-edge
