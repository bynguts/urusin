#!/usr/bin/env bash
# M11a: periksa dari DALAM kontainer web bahwa gateway LLM lokal terjangkau (host network + loopback).
#
#   deploy/check-llm-reach.sh <blue|green>
#
# Menjalankan `node -e fetch(${LLM_BASE_URL}/models)` di kontainer `web-<warna>` (memakai LLM_BASE_URL
# milik kontainer; tanpa kunci API). Status HTTP apa pun (200/401/403) = terjangkau; timeout atau
# kesalahan koneksi = gagal (exit 1). Dipanggil deploy.sh setelah health, sebelum promosi.
# Variabel: LLM_CHECK_TIMEOUT_MS (default 5000).
set -euo pipefail

cd "$(dirname "$0")"

color="${1:-}"
[ "$color" = blue ] || [ "$color" = green ] || { echo "check-llm-reach: pemakaian: $0 <blue|green>" >&2; exit 2; }

js='
const base = process.env.LLM_BASE_URL;
if (!base) { console.error("LLM_BASE_URL tidak diset di kontainer"); process.exit(3); }
const url = base.replace(/\/+$/, "") + "/models";
const ms = Number(process.env.LLM_CHECK_TIMEOUT_MS || 5000);
fetch(url, { signal: AbortSignal.timeout(ms) })
  .then((r) => { console.log("LLM " + url + " -> HTTP " + r.status); process.exit(0); })
  .catch((e) => { console.error("LLM " + url + " tidak terjangkau: " + (e && e.cause && e.cause.code || e.name || e.message)); process.exit(1); });
'

docker compose -f compose.prod.yml --env-file .env --env-file .env.images exec -T \
  -e "LLM_CHECK_TIMEOUT_MS=${LLM_CHECK_TIMEOUT_MS:-5000}" "web-$color" node -e "$js"
