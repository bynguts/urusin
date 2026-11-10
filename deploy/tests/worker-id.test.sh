#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # ekspresi check() sengaja dikutip tunggal: dievaluasi (eval) saat check berjalan, termasuk $rc
# Menguji deploy/worker-id (worker Pendamping region `id` di laptop, lewat Tailscale) tanpa Docker sungguhan:
# worker.sh dengan docker/curl/ip/tailscale palsu (token tidak pernah tercetak, IP selain Tailscale yang
# terpasang ditolak SEBELUM docker dipanggil, berkas env web sah), lalu render compose.yml (+ compose.final.yml)
# lewat `docker compose config` sungguhan bila tersedia (port edge hanya IP Tailscale / loopback).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
bad=0
ok() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; bad=$((bad + 1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }

mkdir -p "$SB/deploy/worker-id" "$SB/bin"
cp "$DEPLOY/worker-id/worker.sh" "$DEPLOY/worker-id/.env.example" "$DEPLOY/worker-id/compose.yml" \
  "$DEPLOY/worker-id/compose.final.yml" "$SB/deploy/worker-id/"
cp "$DEPLOY/pendamping-seccomp.json" "$SB/deploy/"
cp "$DEPLOY/docker-versi.sh" "$SB/deploy/"
W="$SB/deploy/worker-id"
LOG="$SB/docker.log"

# Shim: docker mencatat argumen; versi 29; image ada; compose sukses.
cat > "$SB/bin/docker" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG"
case "\$1" in
  version) echo "\${SHIM_DOCKER_VERSI:-29.3.1}" ;;
esac
exit 0
EOF
cat > "$SB/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo '{"ok":true,"aktif":0,"maks":1,"menunggu":0}'
EOF
cat > "$SB/bin/ip" <<'EOF'
#!/usr/bin/env bash
echo "1: lo    inet 127.0.0.1/8 scope host lo"
echo "5: tailscale0    inet ${SHIM_IP_HOST:-100.101.102.103}/32 scope global tailscale0"
echo "2: eth0    inet 192.168.1.5/24 scope global eth0"
EOF
cat > "$SB/bin/tailscale" <<'EOF'
#!/usr/bin/env bash
echo "100.101.102.103"
EOF
chmod +x "$SB/bin/"*
export PATH="$SB/bin:$PATH"
jalan() { bash "$W/worker.sh" "$@" > "$SB/out" 2>&1; }
nilai() { grep -E "^$1=" "$W/.env" | tail -n 1 | cut -d= -f2-; }
setel() { sed -i "s|^$1=.*|$1=$2|" "$W/.env"; }

echo "worker.sh init"
jalan init
check "init sukses" '[ $? -eq 0 ]'
TOK="$(nilai WORKER_TOKEN)" EDGE="$(nilai WORKER_EDGE_TOKEN)"
check "WORKER_TOKEN 64 heks" '[[ "$TOK" =~ ^[0-9a-f]{64}$ ]]'
check "WORKER_EDGE_TOKEN 64 heks, beda dari WORKER_TOKEN" '[[ "$EDGE" =~ ^[0-9a-f]{64}$ ]] && [ "$EDGE" != "$TOK" ]'
check "token tidak tercetak" '! grep -qF "$TOK" "$SB/out" && ! grep -qF "$EDGE" "$SB/out"'
check "IP Tailscale diisi dari tailscale ip -4" '[ "$(nilai WORKER_TAILSCALE_IP)" = 100.101.102.103 ]'
jalan init
check "init kedua menolak menimpa .env" '[ $? -ne 0 ] && [ "$(nilai WORKER_TOKEN)" = "$TOK" ]'

echo "worker.sh up: IP selain Tailscale yang terpasang ditolak sebelum docker"
for ip in 0.0.0.0 192.168.1.5 10.0.0.2 127.0.0.1 100.63.0.1 100.128.0.1 100.101.102.1030 ''; do
  setel WORKER_TAILSCALE_IP "$ip"
  : > "$LOG"
  jalan up
  check "WORKER_TAILSCALE_IP='$ip' ditolak, docker tidak dipanggil" '[ $? -ne 0 ] && [ ! -s "$LOG" ]'
done
setel WORKER_TAILSCALE_IP 100.101.102.104
: > "$LOG"
jalan up
check "IP Tailscale yang tidak terpasang di host ditolak" '[ $? -ne 0 ] && [ ! -s "$LOG" ]'
# Nol di depan oktet ditolak walau persis teks itu "terpasang" (Caddy/web menolaknya; sebagian parser = oktal).
for ip in 100.064.0.1 100.101.102.013 100.101.00.1; do
  setel WORKER_TAILSCALE_IP "$ip"
  : > "$LOG"
  SHIM_IP_HOST="$ip" jalan up
  check "WORKER_TAILSCALE_IP='$ip' (nol di depan) ditolak, docker tidak dipanggil" '[ $? -ne 0 ] && [ ! -s "$LOG" ]'
done
setel WORKER_TAILSCALE_IP 100.101.102.103
setel WORKER_EDGE_TOKEN "$TOK"
jalan up
check "WORKER_EDGE_TOKEN sama dengan WORKER_TOKEN ditolak" '[ $? -ne 0 ]'
setel WORKER_EDGE_TOKEN "$EDGE"
setel WORKER_ID "Laptop_A"
jalan up
check "WORKER_ID tidak sah ditolak" '[ $? -ne 0 ]'
setel WORKER_ID laptop-a
: > "$LOG"
SHIM_DOCKER_VERSI=27.5.1 jalan up
check "Docker Engine < 28 ditolak" '[ $? -ne 0 ] && ! grep -q "compose" "$LOG"'

echo "worker.sh up/down"
: > "$LOG"
jalan up
check "up sukses dan sehat" '[ $? -eq 0 ] && grep -q "\"ok\":true" "$SB/out"'
check "up memakai compose.yml saja" 'grep -q "compose -f $W/compose.yml --env-file $W/.env up -d" "$LOG" && ! grep -q compose.final "$LOG"'
: > "$LOG"
jalan up --final
check "up --final menambah compose.final.yml" 'grep -q "compose -f $W/compose.yml -f $W/compose.final.yml --env-file $W/.env up -d" "$LOG"'

echo "worker.sh web-env"
jalan web-env publik
check "web-env publik: token tidak tercetak" '[ $? -eq 0 ] && ! grep -qF "$TOK" "$SB/out"'
node - "$W/.env.web-publik" "$TOK" > "$SB/node.out" 2>&1 <<'EOF'
const [file, tok] = process.argv.slice(2);
const baris = require('node:fs').readFileSync(file, 'utf8').trim().split('\n');
if (baris.length !== 1 || !baris[0].startsWith('PENDAMPING_WORKERS=')) throw new Error('baris');
const w = JSON.parse(baris[0].slice('PENDAMPING_WORKERS='.length));
const [vps, lap] = w;
const ok =
  w.length === 2 &&
  vps.id === 'vps' && vps.url === 'http://127.0.0.1:4330' && vps.region === 'umum' && vps.token === undefined &&
  vps.wsUrl === 'wss://urusinai.web.id/pendamping/ws' &&
  lap.id === 'laptop-a' && lap.url === 'http://100.101.102.103:4330' && lap.region === 'id' &&
  lap.maxSessions === 1 && lap.wsUrl === 'wss://urusinai.web.id/pendamping/w/laptop-a/ws' && lap.token === tok;
if (!ok) throw new Error(JSON.stringify(w.map((x) => ({ ...x, token: x.token && '<ada>' }))));
EOF
check "web-env publik: PENDAMPING_WORKERS [vps umum, laptop-a id + wsUrl /pendamping/w/laptop-a/ws + token]" '[ $? -eq 0 ]'
jalan web-env final
node - "$W/.env.web-final" "$TOK" > "$SB/node.out" 2>&1 <<'EOF'
const [file, tok] = process.argv.slice(2);
const env = Object.fromEntries(
  require('node:fs').readFileSync(file, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const w = JSON.parse(env.PENDAMPING_WORKERS);
const ok =
  /^[0-9a-f]{64}$/.test(env.PENDAMPING_INTERNAL_TOKEN) && env.PENDAMPING_INTERNAL_TOKEN !== tok &&
  w.length === 1 && w[0].url === 'http://100.101.102.103:4330' && w[0].region === 'id' &&
  w[0].wsUrl === 'ws://localhost:4330/ws' && w[0].token === tok;
if (!ok) throw new Error('final tidak sesuai');
EOF
check "web-env final: worker laptop + wsUrl ws://localhost:4330/ws, token internal acak sendiri" '[ $? -eq 0 ]'
jalan web-env lain
check "web-env tanpa mode yang sah ditolak" '[ $? -ne 0 ]'

echo "worker.sh web-env: nilai yang masuk JSON divalidasi (tanpa injeksi)"
rm -f "$W/.env.web-publik"
for kv in 'PENDAMPING_MAX_SESSIONS=1,"token":"x"' 'PENDAMPING_MAX_SESSIONS=0' 'PENDAMPING_MAX_SESSIONS=65' \
  'PENDAMPING_MAX_SESSIONS=01' 'DOMAIN=a.example","x":"1' 'DOMAIN=https://urusinai.web.id' 'DOMAIN=localhost' \
  'WORKER_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"bbbbbbbb'; do
  k="${kv%%=*}" v="${kv#*=}" lama="$(nilai "${kv%%=*}")"
  KUNCI="$k" NILAI="$v" awk 'index($0, ENVIRON["KUNCI"] "=") == 1 { print ENVIRON["KUNCI"] "=" ENVIRON["NILAI"]; next } { print }' \
    "$W/.env" > "$W/.env.tmp" && mv "$W/.env.tmp" "$W/.env"
  jalan web-env publik
  check "web-env publik menolak $k='$v' tanpa menulis berkas" '[ $? -ne 0 ] && [ ! -e "$W/.env.web-publik" ]'
  KUNCI="$k" NILAI="$lama" awk 'index($0, ENVIRON["KUNCI"] "=") == 1 { print ENVIRON["KUNCI"] "=" ENVIRON["NILAI"]; next } { print }' \
    "$W/.env" > "$W/.env.tmp" && mv "$W/.env.tmp" "$W/.env"
done
VPS_MAX_SESSIONS='2,"x":1' jalan web-env publik
check "web-env publik menolak VPS_MAX_SESSIONS yang bukan 1-64" '[ $? -ne 0 ] && [ ! -e "$W/.env.web-publik" ]'
jalan web-env publik
check "web-env publik sah lagi setelah nilai dipulihkan" '[ $? -eq 0 ] && [ -e "$W/.env.web-publik" ]'

if docker_asli="$(PATH="${PATH#"$SB/bin:"}" command -v docker)" && "$docker_asli" compose version >/dev/null 2>&1; then
  echo "compose.yml (docker compose config sungguhan)"
  for final in 0 1; do
    f=(-f "$W/compose.yml")
    [ "$final" = 1 ] && f+=(-f "$W/compose.final.yml")
    if ! "$docker_asli" compose "${f[@]}" --env-file "$W/.env" config --format json > "$SB/cfg.json" 2> "$SB/cfg.err"; then
      fail "docker compose config (final=$final): $(head -c 300 "$SB/cfg.err")"
      continue
    fi
    node - "$SB/cfg.json" "$final" "$TOK" > "$SB/node.out" 2>&1 <<'EOF'
const [file, final, tok] = process.argv.slice(2);
const cfg = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
const pd = cfg.services.pendamping, edge = cfg.services['pendamping-edge'];
const salah = [];
const cek = (n, b) => b || salah.push(n);
cek('pendamping tanpa ports', !pd.ports || pd.ports.length === 0);
cek('pendamping hanya jaringan internal', JSON.stringify(Object.keys(pd.networks)) === '["pendamping_internal"]');
cek('jaringan internal: internal + isolated', cfg.networks.pendamping_internal.internal === true &&
  cfg.networks.pendamping_internal.driver_opts['com.docker.network.bridge.gateway_mode_ipv4'] === 'isolated');
const ips = (edge.ports ?? []).map((p) => p.host_ip).sort();
cek(`edge port ${JSON.stringify(ips)}`, JSON.stringify(ips) === JSON.stringify(final === '1' ? ['100.101.102.103', '127.0.0.1'] : ['100.101.102.103']));
cek('edge tidak pernah wildcard', (edge.ports ?? []).every((p) => p.host_ip && p.host_ip !== '0.0.0.0' && p.target === 4330));
cek('token worker = PENDAMPING_INTERNAL_TOKEN pendamping', pd.environment.PENDAMPING_INTERNAL_TOKEN === tok);
cek('edge token beda', edge.environment.PENDAMPING_EDGE_TOKEN === pd.environment.PENDAMPING_EDGE_TOKEN && pd.environment.PENDAMPING_EDGE_TOKEN !== tok);
cek('URL WS cadangan /pendamping/w/laptop-a/ws', pd.environment.PENDAMPING_PUBLIC_WS_URL === 'wss://urusinai.web.id/pendamping/w/laptop-a/ws');
cek('origin WS', pd.environment.PENDAMPING_ALLOWED_ORIGINS === (final === '1' ? 'https://urusinai.web.id,http://localhost:3000' : 'https://urusinai.web.id'));
cek('produksi, headed, sandbox', pd.environment.NODE_ENV === 'production' && !pd.environment.PENDAMPING_HEADLESS && !pd.environment.PENDAMPING_SANDBOX);
cek('sandbox setuid: cap SYS_ADMIN+SYS_CHROOT saja, seccomp', JSON.stringify(pd.cap_add.sort()) === '["SYS_ADMIN","SYS_CHROOT"]' &&
  pd.cap_drop.includes('ALL') && pd.security_opt.some((s) => s.startsWith('seccomp=')));
cek('edge non-root, no-new-privileges', edge.user === 'pwuser' && edge.security_opt.includes('no-new-privileges:true') && edge.cap_drop.includes('ALL'));
cek('Mode Uji: replika fixtures', pd.environment.PENDAMPING_FIXTURE_ORIGINS === 'https://fixtures.urusinai.web.id' &&
  edge.environment.PENDAMPING_FIXTURE_ORIGINS === 'https://fixtures.urusinai.web.id');
if (salah.length) { console.log(salah.join('; ')); process.exit(1); }
EOF
    rc=$?
    check "compose final=$final: topologi + ikat port $(tr -d '\n' < "$SB/node.out")" '[ "$rc" -eq 0 ]'
  done
else
  echo "worker-id: docker compose tidak tersedia; render compose dilewati"
fi

[ "$bad" -eq 0 ] || { echo "worker-id: $bad gagal"; exit 1; }
echo "worker-id: semua lulus"
