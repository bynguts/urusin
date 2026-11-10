#!/usr/bin/env bash
# Worker Browser Pendamping region `id` (laptop anggota, Docker Desktop/Linux, lewat Tailscale).
#
#   bash deploy/worker-id/worker.sh init            # buat .env (chmod 600) + token acak, IP Tailscale otomatis
#   bash deploy/worker-id/worker.sh build           # bangun image lokal urusin-pendamping:worker-id dari checkout
#   bash deploy/worker-id/worker.sh up [--final]    # validasi .env lalu jalankan (--final: + localhost:3000)
#   bash deploy/worker-id/worker.sh sehat [--final] # GET /health lewat IP Tailscale (dan loopback bila --final)
#   bash deploy/worker-id/worker.sh down            # hentikan dan hapus kontainer worker
#   bash deploy/worker-id/worker.sh web-env publik  # tulis .env.web-publik: PENDAMPING_WORKERS untuk agent-vm
#   bash deploy/worker-id/worker.sh web-env final   # tulis .env.web-final: env web lokal (compose.local.yml)
#
# Rahasia hanya ditulis ke berkas chmod 600 di folder ini (diabaikan git), tidak pernah dicetak.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
ENV_FILE="$DIR/.env"
IMAGE_LOKAL="urusin-pendamping:worker-id"

die() { echo "worker: $*" >&2; exit 1; }

# Nilai KEY dari .env tanpa menjalankan isinya (bukan `source`).
nilai() { { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

# Tulis KEY=nilai (nilai lewat env, bukan argumen proses) ke .env.
setel() {
  local tmp="$ENV_FILE.tmp"
  KUNCI="$1" NILAI="$2" awk 'BEGIN { k = ENVIRON["KUNCI"]; v = ENVIRON["NILAI"]; ada = 0 }
    index($0, k "=") == 1 { print k "=" v; ada = 1; next } { print }
    END { if (!ada) print k "=" v }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

acak() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# 0 bila $1 IPv4 literal di 100.64.0.0/10 (Tailscale), sama dengan pengecualian egress web. Oktet 0-255 TANPA nol
# di depan (`100.064.0.1` ditolak: `[ -eq ]`/sebagian parser membacanya oktal, dan Caddy/web menolaknya).
OKTET='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
ip_tailscale() {
  local b
  [[ "$1" =~ ^$OKTET\.$OKTET\.$OKTET\.$OKTET$ ]] || return 1
  b=${BASH_REMATCH[2]}
  [ "${BASH_REMATCH[1]}" = 100 ] && [ "$b" -ge 64 ] && [ "$b" -le 127 ]
}

# 0 bila IP $1 terpasang di antarmuka host ini (Linux `ip`, Windows `ipconfig`, macOS `ifconfig`).
ip_ada() {
  local pola="(^|[^0-9.])${1//./\\.}([^0-9.]|\$)"
  if command -v ip >/dev/null 2>&1; then ip -4 -o addr show | grep -qE "$pola"
  elif command -v ipconfig >/dev/null 2>&1; then ipconfig | tr -d '\r' | grep -qE "$pola"
  else ifconfig 2>/dev/null | grep -qE "$pola"; fi
}

periksa_env() {
  [ -f "$ENV_FILE" ] || die ".env belum ada: jalankan 'worker.sh init'"
  local id ip port tok edge
  id="$(nilai WORKER_ID)" ip="$(nilai WORKER_TAILSCALE_IP)" port="$(nilai WORKER_PORT)"
  tok="$(nilai WORKER_TOKEN)" edge="$(nilai WORKER_EDGE_TOKEN)"
  [ -n "$(nilai DOMAIN)" ] || die "DOMAIN kosong"
  [[ "$id" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || die "WORKER_ID tidak sah: '$id'"
  ip_tailscale "$ip" || die "WORKER_TAILSCALE_IP harus IP Tailscale 100.64.0.0/10 (bukan 0.0.0.0/LAN): '$ip'"
  ip_ada "$ip" || die "IP $ip tidak terpasang di host ini (Tailscale mati/IP salah?)"
  [[ "${port:-4330}" =~ ^[0-9]{1,5}$ ]] || die "WORKER_PORT tidak sah"
  [ "${#tok}" -ge 32 ] || die "WORKER_TOKEN kosong/pendek (>= 32): jalankan 'worker.sh init'"
  [ "${#edge}" -ge 32 ] || die "WORKER_EDGE_TOKEN kosong/pendek (>= 32): jalankan 'worker.sh init'"
  [ "$tok" != "$edge" ] || die "WORKER_EDGE_TOKEN harus beda dari WORKER_TOKEN"
}

compose() {
  local f=(-f "$DIR/compose.yml")
  [ "${FINAL:-0}" = 1 ] && f+=(-f "$DIR/compose.final.yml")
  docker compose "${f[@]}" --env-file "$ENV_FILE" "$@"
}

sehat() {
  local ip port
  ip="$(nilai WORKER_TAILSCALE_IP)" port="$(nilai WORKER_PORT)"
  port="${port:-4330}"
  curl -fsS -m 5 "http://$ip:$port/health" || return 1
  echo "  <- http://$ip:$port/health (Tailscale)"
  if [ "${FINAL:-0}" = 1 ]; then
    curl -fsS -m 5 "http://127.0.0.1:$port/health" || return 1
    echo "  <- http://127.0.0.1:$port/health (loopback, final)"
  fi
}

cmd_init() {
  [ ! -e "$ENV_FILE" ] || die ".env sudah ada (hapus dulu bila ingin token baru; token lama di web harus diganti juga)"
  (umask 077 && cp "$DIR/.env.example" "$ENV_FILE")
  chmod 600 "$ENV_FILE"
  setel WORKER_TOKEN "$(acak)"
  setel WORKER_EDGE_TOKEN "$(acak)"
  local ip=""
  command -v tailscale >/dev/null 2>&1 && ip="$(tailscale ip -4 2>/dev/null | tr -d '\r' | head -n 1 || true)"
  if ip_tailscale "$ip"; then setel WORKER_TAILSCALE_IP "$ip"; echo "worker: WORKER_TAILSCALE_IP=$ip"
  else echo "worker: isi WORKER_TAILSCALE_IP di $ENV_FILE (tailscale ip -4)"; fi
  echo "worker: $ENV_FILE dibuat (chmod 600); WORKER_TOKEN dan WORKER_EDGE_TOKEN diisi acak (tidak ditampilkan)"
}

cmd_build() {
  local sha
  sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo dev)"
  docker build -f "$ROOT/apps/pendamping/Dockerfile" --build-arg "GIT_SHA=$sha" -t "$IMAGE_LOKAL" "$ROOT"
}

cmd_up() {
  periksa_env
  # shellcheck source=SCRIPTDIR/../docker-versi.sh
  . "$DIR/../docker-versi.sh"
  pastikan_docker_28 || die "$DOCKER_VERSI_PESAN"
  local img
  img="$(nilai PENDAMPING_IMAGE)"
  if [ -z "$img" ] && ! docker image inspect "$IMAGE_LOKAL" >/dev/null 2>&1; then
    die "image $IMAGE_LOKAL belum ada: jalankan 'worker.sh build' atau isi PENDAMPING_IMAGE"
  fi
  compose up -d
  local _
  for _ in $(seq 1 45); do
    if sehat >/dev/null 2>&1; then sehat; return 0; fi
    sleep 2
  done
  compose ps
  die "worker belum sehat setelah 90 detik; lihat: docker compose -p urusin-worker-id logs pendamping"
}

cmd_web_env() {
  periksa_env
  local mode="${1:-}" dom id ip port tok maks out
  dom="$(nilai DOMAIN)" id="$(nilai WORKER_ID)" ip="$(nilai WORKER_TAILSCALE_IP)"
  port="$(nilai WORKER_PORT)" tok="$(nilai WORKER_TOKEN)" maks="$(nilai PENDAMPING_MAX_SESSIONS)"
  port="${port:-4330}" maks="${maks:-1}"
  local laptop
  case "$mode" in
    publik)
      laptop="{\"id\":\"$id\",\"url\":\"http://$ip:$port\",\"region\":\"id\",\"maxSessions\":$maks,\"wsUrl\":\"wss://$dom/pendamping/w/$id/ws\",\"token\":\"$tok\"}"
      out="$DIR/.env.web-publik"
      (umask 077 && printf 'PENDAMPING_WORKERS=[%s,%s]\n' \
        "{\"id\":\"vps\",\"url\":\"http://127.0.0.1:4330\",\"region\":\"umum\",\"maxSessions\":${VPS_MAX_SESSIONS:-2},\"wsUrl\":\"wss://$dom/pendamping/ws\"}" \
        "$laptop" > "$out") ;;
    final)
      laptop="{\"id\":\"$id\",\"url\":\"http://$ip:$port\",\"region\":\"id\",\"maxSessions\":$maks,\"wsUrl\":\"ws://localhost:$port/ws\",\"token\":\"$tok\"}"
      out="$DIR/.env.web-final"
      (umask 077 && printf 'PENDAMPING_INTERNAL_TOKEN=%s\nPENDAMPING_WORKERS=[%s]\n' "$(acak)" "$laptop" > "$out") ;;
    *) die "web-env butuh 'publik' atau 'final'" ;;
  esac
  chmod 600 "$out"
  echo "worker: $out ditulis (chmod 600, berisi token; jangan dicetak/di-commit)"
}

[ "${2:-}" = "--final" ] && FINAL=1
case "${1:-}" in
  init) cmd_init ;;
  build) cmd_build ;;
  up) cmd_up ;;
  sehat) periksa_env; sehat ;;
  down) FINAL=1 compose down ;;
  web-env) cmd_web_env "${2:-}" ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
