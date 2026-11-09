#!/usr/bin/env bash
# Menguji compose.prod.yml hasil render (`docker compose config`): web di jaringan host dan hanya
# mengikat 127.0.0.1:4310/4311; topologi isolasi Browser Pendamping (pendamping hanya di jaringan
# internal, edge satu-satunya jalan keluar dan satu-satunya port). Dilewati (exit 0) bila docker compose
# atau node tidak tersedia.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
if ! docker compose version >/dev/null 2>&1 || ! command -v node >/dev/null; then
  echo "compose-config: docker compose/node tidak tersedia; dilewati"
  exit 0
fi

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
cp "$DEPLOY/compose.prod.yml" "$SB/"
printf 'DOMAIN=urusin.test\n' > "$SB/.env"
printf 'WEB_IMAGE_BLUE=ghcr.io/x/web@sha256:aa\nWEB_IMAGE_GREEN=ghcr.io/x/web@sha256:bb\n' > "$SB/.env.images"
(cd "$SB" && docker compose -f compose.prod.yml --env-file .env --env-file .env.images --profile fixtures --profile pendamping config --format json) > "$SB/config.json" \
  || { echo "compose-config: docker compose config gagal"; exit 1; }

node - "$SB/config.json" "$DEPLOY/pendamping-seccomp.json" <<'EOF'
const cfg = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
let bad = 0;
const check = (name, ok) => { console.log((ok ? '  ok   ' : '  FAIL ') + name); if (!ok) bad++; };
for (const [color, port] of [['blue', '4310'], ['green', '4311']]) {
  const s = cfg.services[`web-${color}`];
  const env = s.environment;
  check(`web-${color}: network_mode host`, s.network_mode === 'host');
  check(`web-${color}: tanpa ports (tidak valid di host network)`, !s.ports || s.ports.length === 0);
  check(`web-${color}: HOST=127.0.0.1 (bukan 0.0.0.0)`, env.HOST === '127.0.0.1');
  check(`web-${color}: PORT=${port}`, env.PORT === port);
  check(`web-${color}: URUSIN_COLOR=${color}`, env.URUSIN_COLOR === color);
  check(`web-${color}: host satu set dari DOMAIN`, env.DOMAIN === 'urusin.test' && env.VERIFY_HOST === 'verify.urusin.test' && env.FIXTURES_HOST === 'fixtures.urusin.test' && env.ORIGIN === 'https://urusin.test' && env.URUSIN_PUBLIC_ORIGIN === 'https://urusin.test');
  check(`web-${color}: ADDRESS_HEADER=X-Forwarded-For, XFF_DEPTH=1`, env.ADDRESS_HEADER === 'X-Forwarded-For' && env.XFF_DEPTH === '1');
  check(`web-${color}: logging json-file berbatas`, s.logging.driver === 'json-file' && s.logging.options['max-size'] && s.logging.options['max-file']);
  check(`web-${color}: read_only, cap_drop ALL, no-new-privileges`, s.read_only === true && s.cap_drop.includes('ALL') && s.security_opt.includes('no-new-privileges:true'));
  check(`web-${color}: mem 512m, cpus, pids_limit`, Number(s.mem_limit) === 536870912 && Number(s.cpus) > 0 && Number(s.pids_limit) > 0);
  check(`web-${color}: healthcheck memakai PORT`, s.healthcheck.test.join(' ').includes('process.env.PORT'));
}
const fx = cfg.services.fixtures;
check('fixtures: logging json-file berbatas', fx.logging.driver === 'json-file' && !!fx.logging.options['max-size']);
check('fixtures: bridge, publish 127.0.0.1:4320 saja', fx.network_mode !== 'host' && fx.ports.length === 1 && fx.ports[0].host_ip === '127.0.0.1' && String(fx.ports[0].published) === '4320');

const pd = cfg.services.pendamping;
const edge = cfg.services['pendamping-edge'];
const net = cfg.networks;
const internal = Object.values(net).find((n) => n.name === 'urusin_pendamping_internal');
const luar = Object.values(net).find((n) => n.name === 'urusin_pendamping_luar');
check('jaringan pendamping_internal: internal, gateway IPv4 host isolated, IPv6 mati',
  !!internal && internal.internal === true && internal.enable_ipv6 === false &&
  internal.driver_opts?.['com.docker.network.bridge.gateway_mode_ipv4'] === 'isolated');
check('jaringan pendamping_luar: bridge biasa, IPv6 mati', !!luar && !luar.internal && luar.enable_ipv6 === false);
check('pendamping: HANYA di pendamping_internal, bukan host network', pd.network_mode === undefined &&
  JSON.stringify(Object.keys(pd.networks)) === JSON.stringify(['pendamping_internal']));
check('pendamping: tanpa port terpublikasi', !pd.ports || pd.ports.length === 0);
check('pendamping: HOST=antarmuka (bukan wildcard), edge wajib', pd.environment.HOST === 'antarmuka' &&
  pd.environment.PENDAMPING_EDGE_URL === 'http://pendamping-edge:3129' && 'PENDAMPING_EDGE_TOKEN' in pd.environment);
check('pendamping: tanpa PENDAMPING_UPSTREAM_PROXY (egress hanya lewat edge)', !('PENDAMPING_UPSTREAM_PROXY' in pd.environment));
// Sandbox setuid (ADR 0029): tanpa no-new-privileges HANYA di pendamping; tepat SYS_ADMIN + SYS_CHROOT.
check('pendamping: seccomp Playwright, satu-satunya security_opt (sandbox setuid, tanpa no-new-privileges)',
  pd.security_opt.length === 1 && /^seccomp=.*pendamping-seccomp\.json$/.test(pd.security_opt[0]));
// Profil seccomp dipangkas: CAP_SYS_ADMIN hanya membuka clone/unshare; setns/mount/bpf tidak pernah diizinkan.
const sec = JSON.parse(require('node:fs').readFileSync(process.argv[3], 'utf8'));
const izin = sec.syscalls.filter((x) => x.action === 'SCMP_ACT_ALLOW');
const sysAdmin = izin.filter((x) => x.includes?.caps?.includes('CAP_SYS_ADMIN')).flatMap((x) => x.names);
check('seccomp: blok CAP_SYS_ADMIN tepat clone + unshare', JSON.stringify([...sysAdmin].sort()) === '["clone","unshare"]');
check('seccomp: setns/mount/umount2/bpf/perf_event_open tidak diizinkan di aturan mana pun',
  !izin.some((x) => x.names.some((n) => ['setns', 'mount', 'umount', 'umount2', 'bpf', 'perf_event_open'].includes(n))));
check('seccomp: io_uring_setup/io_uring_enter/io_uring_register tidak diizinkan di aturan mana pun',
  !izin.some((x) => x.names.some((n) => n.startsWith('io_uring'))));
check('pendamping: cap_drop ALL, hanya SYS_ADMIN + SYS_CHROOT ditambah', pd.cap_drop.includes('ALL') &&
  JSON.stringify([...pd.cap_add].sort()) === JSON.stringify(['SYS_ADMIN', 'SYS_CHROOT']));
check('pendamping: read_only, ulimit core 0, memswap = mem', pd.read_only === true && 'core' in pd.ulimits && (pd.ulimits.core.soft ?? 0) === 0 &&
  (pd.ulimits.core.hard ?? 0) === 0 && Number(pd.memswap_limit) === Number(pd.mem_limit));
check('edge: internal + luar, publish 127.0.0.1:4330 saja', JSON.stringify(Object.keys(edge.networks).sort()) ===
  JSON.stringify(['pendamping_internal', 'pendamping_luar']) && edge.ports.length === 1 &&
  edge.ports[0].host_ip === '127.0.0.1' && String(edge.ports[0].published) === '4330' && String(edge.ports[0].target) === '4330');
check('edge: entry dist/edge-main.js, image sama dengan pendamping', JSON.stringify(edge.command) ===
  JSON.stringify(['node', 'dist/edge-main.js']) && edge.image === pd.image);
check('edge: non-root, read_only, cap_drop ALL tanpa cap_add, no-new-privileges', edge.user === 'pwuser' &&
  edge.read_only === true && edge.cap_drop.includes('ALL') && !edge.cap_add &&
  edge.security_opt.includes('no-new-privileges:true'));
check('edge: batas mem/cpu/pids, ulimit core 0', Number(edge.mem_limit) <= 134217728 &&
  Number(edge.memswap_limit) === Number(edge.mem_limit) && Number(edge.cpus) > 0 && Number(edge.pids_limit) > 0 &&
  'core' in edge.ulimits && (edge.ulimits.core.hard ?? 0) === 0 && (edge.ulimits.core.soft ?? 0) === 0);
check('edge: token edge dan pendamping hulu', 'PENDAMPING_EDGE_TOKEN' in edge.environment &&
  edge.environment.EDGE_PENDAMPING_URL === 'http://pendamping:4330');
check('hanya edge dan fixtures yang mempublikasikan port', Object.entries(cfg.services).every(([n, s]) =>
  !s.ports || s.ports.length === 0 || n === 'pendamping-edge' || n === 'fixtures'));
process.exit(bad ? 1 : 0);
EOF
