#!/usr/bin/env bash
# Menguji compose.prod.yml hasil render (`docker compose config`): web di jaringan host dan hanya
# mengikat 127.0.0.1:4310/4311. Dilewati (exit 0) bila docker compose atau node tidak tersedia.
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
(cd "$SB" && docker compose -f compose.prod.yml --env-file .env --env-file .env.images --profile fixtures config --format json) > "$SB/config.json" \
  || { echo "compose-config: docker compose config gagal"; exit 1; }

node - "$SB/config.json" <<'EOF'
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
  check(`web-${color}: read_only, cap_drop ALL, no-new-privileges`, s.read_only === true && s.cap_drop.includes('ALL') && s.security_opt.includes('no-new-privileges:true'));
  check(`web-${color}: mem 512m, cpus, pids_limit`, Number(s.mem_limit) === 536870912 && Number(s.cpus) > 0 && Number(s.pids_limit) > 0);
  check(`web-${color}: healthcheck memakai PORT`, s.healthcheck.test.join(' ').includes('process.env.PORT'));
}
const fx = cfg.services.fixtures;
check('fixtures: bridge, publish 127.0.0.1:4320 saja', fx.network_mode !== 'host' && fx.ports.length === 1 && fx.ports[0].host_ip === '127.0.0.1' && String(fx.ports[0].published) === '4320');
process.exit(bad ? 1 : 0);
EOF
