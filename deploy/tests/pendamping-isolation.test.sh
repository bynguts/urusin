#!/usr/bin/env bash
# Uji topologi isolasi Browser Pendamping dengan jaringan compose.prod.yml SUNGGUHAN (image diganti busybox):
# kontainer pendamping tidak punya rute default dan hanya rute subnet internalnya sendiri, tidak bisa ke
# internet, gateway bridge luar, maupun docker0, dan satu-satunya yang terjangkau adalah pendamping-edge.
# (gateway_mode_ipv4=isolated: host tidak memegang alamat di subnet internal; diuji compose-config.test.sh.) Dilewati (exit 0) bila docker/daemon tidak tersedia.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
if ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "pendamping-isolation: docker tidak tersedia; dilewati"
  exit 0
fi

BUSYBOX='busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662'
PROJ="urusin-isotest-$$"
SB="$(mktemp -d)"
cp "$DEPLOY/compose.prod.yml" "$DEPLOY/pendamping-seccomp.json" "$SB/"
printf 'DOMAIN=urusin.test\nPENDAMPING_IMAGE=%s\n' "$BUSYBOX" > "$SB/.env"
# Hanya image, perintah, user, dan healthcheck yang diganti; jaringan, seccomp, cap, dan batas tetap asli.
# Port host tidak dipublikasikan dalam uji (tidak menyentuh 127.0.0.1:4330 milik mesin ini).
cat > "$SB/uji.override.yml" <<'YAML'
services:
  pendamping:
    command: ['sh', '-c', 'sleep 600']
    user: '65534'
    healthcheck: { disable: true }
  pendamping-edge:
    command: ['sh', '-c', 'echo ok > /tmp/index.html && httpd -f -p 3128 -h /tmp']
    user: '65534'
    ports: !reset []
    healthcheck: { disable: true }
YAML
dc() { (cd "$SB" && docker compose -p "$PROJ" -f compose.prod.yml -f uji.override.yml --env-file .env --profile pendamping "$@"); }
cleanup() { dc down -v --remove-orphans >/dev/null 2>&1; rm -rf "$SB"; }
[ -n "${KEEP:-}" ] || trap cleanup EXIT

if ! dc up -d pendamping pendamping-edge >"$SB/up.log" 2>&1; then
  cat "$SB/up.log"
  echo "pendamping-isolation: compose up gagal"
  exit 1
fi

bad=0
check() { if [ "$2" = 0 ]; then echo "  ok   $1"; else echo "  FAIL $1"; bad=$((bad + 1)); fi; }
di() { dc exec -T pendamping "$@" >>"$SB/exec.log" 2>&1; }
gagal() { if di "$@"; then echo 1; else echo 0; fi; }
lulus() { if di "$@"; then echo 0; else echo 1; fi; }

luar_gw="$(docker network inspect "${PROJ}_pendamping_luar" --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')"
docker0_gw="$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null)"

check 'pendamping: tanpa rute default' "$(lulus sh -c '! ip route | grep -q "^default"')"
check 'pendamping: tidak ada rute ke internet (1.1.1.1)' "$(gagal ip route get 1.1.1.1)"
check "pendamping: tidak ada rute ke gateway bridge luar edge (${luar_gw:-?})" "$(gagal ip route get "${luar_gw:-192.0.2.1}")"
if [ -n "$docker0_gw" ]; then
  check "pendamping: tidak ada rute ke docker0 host (${docker0_gw})" "$(gagal ip route get "$docker0_gw")"
fi
check 'pendamping: TCP ke 1.1.1.1:443 gagal' "$(gagal nc -w 3 1.1.1.1 443)"
check 'pendamping: hanya satu rute (subnet internal sendiri)' "$(lulus sh -c '[ "$(ip route | wc -l)" -eq 1 ]')"
check 'pendamping: IPv6 mati (tanpa alamat global)' "$(lulus sh -c '! ip -6 addr show scope global | grep -q inet6')"
edge=1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if di wget -q -T 3 -O- http://pendamping-edge:3128/; then edge=0; break; fi
  sleep 1
done
check 'pendamping: edge terjangkau (pendamping-edge:3128)' "$edge"

if [ "$bad" -gt 0 ]; then
  tail -n 20 "$SB/exec.log"
  echo "pendamping-isolation: $bad pemeriksaan gagal"
  exit 1
fi
echo "pendamping-isolation: semua lulus"
