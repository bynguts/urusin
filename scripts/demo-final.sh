#!/usr/bin/env bash
# Demo final Urusin di SATU laptop (localhost, tanpa VPS dan tanpa Tailscale kecuali untuk LLM): web + Browser
# Pendamping + fixtures + DB berisi akun juri, lewat deploy/compose.demo.yml. Butuh Docker (Compose v2) dan bash
# (Git Bash di Windows).
#
#   bash scripts/demo-final.sh up [--ghcr [SHA]]  siapkan deploy/.env.demo, build image (atau tarik dari GHCR),
#                                                 naikkan di http://localhost, lalu preflight
#   bash scripts/demo-final.sh cek                preflight saja (hijau = siap, merah = perbaiki dulu)
#   bash scripts/demo-final.sh offline            SAKLAR: LLM dimatikan -> DemoProvider (internet venue putus)
#   bash scripts/demo-final.sh online             kembali memakai LLM
#   bash scripts/demo-final.sh log [layanan]      ikuti log (web, pendamping, fixtures, gerbang)
#   bash scripts/demo-final.sh down               hentikan (data demo tetap ada)
#   bash scripts/demo-final.sh reset              hentikan dan hapus data demo (DB, vault)
#
# LLM (opsional): LLM_BASE_URL, LLM_API_KEY, LLM_AGENT_MODEL dari env saat `up`, atau dari berkas DEMO_LLM_ENV
# (bawaan ~/.urusin-secrets/llm.env bila ada). Tanpa itu demo memakai DemoProvider (tanpa jaringan).
# Korpus RAG produksi (opsional): letakkan di deploy/data/demo/rag.db; tanpa itu korpus contoh.
# Rahasia hanya ditulis ke deploy/.env.demo (chmod 600, diabaikan git) dan tidak pernah dicetak.
# shellcheck disable=SC2015 # `ok`/`merah` selalu berhasil, jadi A && ok || merah aman
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env.demo"
RAG_DIR="$DEPLOY/data/demo"

if [ -t 1 ]; then H=$'\e[32m' M=$'\e[31m' K=$'\e[33m' T=$'\e[1m' N=$'\e[0m'; else H='' M='' K='' T='' N=''; fi
die() { echo "${M}demo-final: $*${N}" >&2; exit 1; }
info() { echo "${T}==> $*${N}"; }

nilai() { { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

# Tulis KEY=nilai (nilai lewat env, bukan argumen proses) ke .env.demo.
setel() {
  local tmp="$ENV_FILE.tmp"
  KUNCI="$1" NILAI="$2" awk 'BEGIN { k = ENVIRON["KUNCI"]; v = ENVIRON["NILAI"]; ada = 0 }
    index($0, k "=") == 1 { print k "=" v; ada = 1; next } { print }
    END { if (!ada) print k "=" v }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
setel_bila_kosong() { [ -n "$(nilai "$1")" ] || setel "$1" "$2"; }

hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

compose() { docker compose -f "$DEPLOY/compose.demo.yml" --env-file "$ENV_FILE" "$@"; }

origin() {
  local p
  p="$(nilai DEMO_PORT)"
  if [ "${p:-80}" = 80 ]; then echo "http://localhost"; else echo "http://localhost:$p"; fi
}

# Nilai satu kunci dari berkas env LLM (KEY=nilai, tanpa menjalankan isinya).
dari_berkas() { { grep -E "^$1=" "$2" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'; }

siapkan_env() {
  if [ ! -f "$ENV_FILE" ]; then (umask 077 && : > "$ENV_FILE"); fi
  chmod 600 "$ENV_FILE"
  setel_bila_kosong SESSION_SECRET "$(hex 32)"
  setel_bila_kosong URUSIN_PII_KEY "$(b64 32)"
  setel_bila_kosong PENDAMPING_INTERNAL_TOKEN "$(hex 32)"
  setel_bila_kosong URUSIN_DAILY_IDR_CAP 50000
  setel_bila_kosong DEMO_LLM_DISABLED 0
  setel_bila_kosong DEMO_PORT 80
  setel_bila_kosong DEMO_FIXTURES_PORT 4320
  local o
  o="$(origin)"
  setel DEMO_ORIGIN "$o"
  setel DEMO_WS_ORIGIN "ws://${o#http://}"

  # LLM: env proses > berkas DEMO_LLM_ENV > yang sudah ada di .env.demo.
  local berkas="${DEMO_LLM_ENV:-$HOME/.urusin-secrets/llm.env}" base key model
  base="${LLM_BASE_URL:-$(dari_berkas LLM_BASE_URL "$berkas")}"
  key="${LLM_API_KEY:-$(dari_berkas LLM_API_KEY "$berkas")}"
  model="${LLM_AGENT_MODEL:-$(dari_berkas LLM_AGENT_MODEL "$berkas")}"
  if [ -n "$base" ] && [ -n "$key" ] && [ -n "$model" ]; then
    [[ "$base" =~ ^(https?://[^/]+)(/.*)?$ ]] || die "LLM_BASE_URL tidak valid"
    # Web memanggil 127.0.0.1:20128 (pengecualian egress proxy LLM); gerbang meneruskan ke origin aslinya.
    setel DEMO_LLM_UPSTREAM "${BASH_REMATCH[1]}"
    setel LLM_BASE_URL "http://127.0.0.1:20128${BASH_REMATCH[2]:-}"
    setel LLM_API_KEY "$key"
    setel LLM_AGENT_MODEL "$model"
    setel_bila_kosong LLM_TIMEOUT_MS 45000
    setel_bila_kosong LLM_MAX_RETRIES 1
  fi

  mkdir -p "$RAG_DIR"
  if [ -f "$RAG_DIR/rag.db" ]; then setel DEMO_RAG_DB /rag/rag.db; else setel DEMO_RAG_DB ''; fi
}

image_lokal_ada() {
  local i
  for i in urusin-demo-web urusin-demo-pendamping urusin-demo-fixtures; do
    docker image inspect "$i:local" >/dev/null 2>&1 || return 1
  done
}

cmd_up() {
  command -v docker >/dev/null 2>&1 || die "Docker tidak ditemukan"
  docker info >/dev/null 2>&1 || die "Docker belum berjalan (buka Docker Desktop dulu)"
  siapkan_env
  if [ "${1:-}" = "--ghcr" ]; then
    local sha="${2:-$(git -C "$ROOT" rev-parse HEAD)}"
    setel DEMO_WEB_IMAGE "ghcr.io/bynguts/urusin-web:$sha"
    setel DEMO_PENDAMPING_IMAGE "ghcr.io/bynguts/urusin-pendamping:$sha"
    setel DEMO_FIXTURES_IMAGE "ghcr.io/bynguts/urusin-fixtures:$sha"
    info "Menarik image GHCR $sha (butuh docker login ghcr.io)"
    compose pull web pendamping fixtures
  elif [ "${1:-}" = "--build" ] || { [ -z "$(nilai DEMO_WEB_IMAGE)" ] && ! image_lokal_ada; }; then
    setel DEMO_WEB_IMAGE '' && setel DEMO_PENDAMPING_IMAGE '' && setel DEMO_FIXTURES_IMAGE ''
    info "Membangun image dari checkout ini (sekali, ~10 menit; 'up' berikutnya tanpa build dan tanpa internet)"
    GIT_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo local)" compose build
  fi
  info "Menaikkan layanan demo"
  compose up -d --wait --wait-timeout 180 || { compose ps; die "layanan belum sehat; lihat: bash scripts/demo-final.sh log"; }
  cmd_cek
}

# Ganti mode LLM lalu buat ulang web saja (pendamping/fixtures dan sesi juri tidak terganggu).
cmd_mode() {
  [ -f "$ENV_FILE" ] || die "belum ada deploy/.env.demo: jalankan 'bash scripts/demo-final.sh up' dulu"
  setel DEMO_LLM_DISABLED "$1"
  compose up -d --wait --wait-timeout 120 web
  if [ "$1" = 1 ]; then echo "${H}Mode OFFLINE: agen memakai DemoProvider (tanpa jaringan).${N}"
  else echo "${H}Mode ONLINE: agen memakai LLM.${N}"; fi
  cmd_cek
}

# ---------------------------------------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------------------------------------
GAGAL=0
ok() { echo "  ${H}[OK]${N}    $*"; }
merah() { echo "  ${M}[GAGAL]${N} $*"; GAGAL=$((GAGAL + 1)); }
kuning() { echo "  ${K}[CATAT]${N} $*"; }

# Waktu respons (ms) + kode HTTP; keluaran "kode ms".
ukur() { curl -s -o /dev/null -m "${2:-10}" -w '%{http_code} %{time_total}' "$1" | awk '{ printf "%s %d", $1, $2 * 1000 }'; }

# Jalankan potongan JS di dalam kontainer web (jaringan yang sama dengan web: 127.0.0.1 = demo).
di_web() { compose exec -T web node -e "$1" 2>/dev/null; }

cmd_cek() {
  [ -f "$ENV_FILE" ] || die "belum ada deploy/.env.demo: jalankan 'bash scripts/demo-final.sh up' dulu"
  local o
  o="$(nilai DEMO_ORIGIN)"
  echo
  echo "${T}Preflight demo final Urusin ($o)${N}"

  # 1. Kontainer
  local svc st
  for svc in gerbang web pendamping fixtures; do
    st="$(compose ps --format '{{.State}} {{.Health}}' "$svc" 2>/dev/null | head -n 1)"
    case "$st" in
      'running healthy' | 'running ') ok "layanan $svc berjalan${st#running}" ;;
      *) merah "layanan $svc: ${st:-tidak berjalan}" ;;
    esac
  done

  # 2. Web + waktu respons halaman yang dibuka saat demo
  local r kode ms hal
  for hal in / /masuk /peristiwa/kelahiran; do
    r="$(ukur "$o$hal")"; kode="${r% *}"; ms="${r#* }"
    if [ "$kode" = 200 ] && [ "$ms" -lt 2000 ]; then ok "halaman $hal ${ms} ms"
    elif [ "$kode" = 200 ]; then merah "halaman $hal lambat (${ms} ms, batas 2000)"
    else merah "halaman $hal HTTP $kode"; fi
  done

  # 3. Mode agen + RAG (dibaca dari dalam web; /api/health tidak dibuka lewat gerbang produksi)
  local kem
  kem="$(curl -fsS -m 10 "$o/api/kemampuan" 2>/dev/null || true)"
  local mode_llm=""
  case "$kem" in
    *'"llm":"llm"'*) mode_llm=llm ;;
    *'"llm":"demo"'*) mode_llm=demo ;;
  esac
  local health
  health="$(curl -fsS -m 10 "$o/api/health" 2>/dev/null || true)"
  case "$health" in
    *'"status":"ready"'*) ok "RAG korpus produksi ter-mount ($(grep -o '"chunks":[0-9]*' <<<"$health" | head -n 1 | cut -d: -f2) chunk)" ;;
    *'"status":"demo"'*) kuning "RAG memakai korpus contoh (salin rag.db produksi ke deploy/data/demo/rag.db lalu 'up')" ;;
    *) merah "RAG/runtime belum siap: ${health:-tanpa jawaban}" ;;
  esac

  # 4. LLM terjangkau, atau fallback aktif
  local llm_off
  llm_off="$(nilai DEMO_LLM_DISABLED)"
  if [ "$llm_off" = 1 ]; then
    [ "$mode_llm" = demo ] && ok "fallback aktif: mode OFFLINE (DemoProvider, tanpa jaringan)" \
      || merah "saklar offline aktif tetapi web masih mode '${mode_llm:-?}' (jalankan ulang: offline)"
  elif [ -z "$(nilai LLM_API_KEY)" ]; then
    [ "$mode_llm" = demo ] && ok "tanpa LLM terkonfigurasi: DemoProvider aktif" || merah "mode agen tidak diketahui"
  else
    local hasil
    hasil="$(di_web "const t=Date.now();fetch(process.env.LLM_BASE_URL.replace(/\/+\$/,'')+'/models',{headers:{authorization:'Bearer '+process.env.LLM_API_KEY},signal:AbortSignal.timeout(8000)}).then(r=>console.log(r.status,Date.now()-t)).catch(()=>console.log(0,Date.now()-t))" || echo '0 0')"
    kode="${hasil% *}"; ms="${hasil#* }"
    if [ "$kode" = 200 ] && [ "$mode_llm" = llm ]; then
      [ "$ms" -lt 3000 ] && ok "LLM terjangkau (${ms} ms)" || merah "LLM lambat (${ms} ms): pertimbangkan 'bash scripts/demo-final.sh offline'"
    elif [ "$kode" = 200 ]; then
      merah "LLM terjangkau tetapi web mode '${mode_llm:-?}' (jalankan: bash scripts/demo-final.sh online)"
    else
      merah "LLM TIDAK terjangkau (HTTP $kode). Saklar: bash scripts/demo-final.sh offline"
    fi
  fi

  # 5. Browser Pendamping
  local antre
  antre="$(curl -fsS -m 10 "$o/api/pendamping/antrean" 2>/dev/null || true)"
  case "$antre" in
    *'"maks":'[1-9]*) ok "Browser Pendamping siap $antre" ;;
    *) merah "Browser Pendamping tidak terjangkau dari web: ${antre:-tanpa jawaban}" ;;
  esac

  # 6. Fixtures (replika) yang dipakai alur demo
  local fx f
  fx="http://127.0.0.1:$(nilai DEMO_FIXTURES_PORT)"
  for f in / /sby/ /smg/; do
    r="$(ukur "$fx$f")"; kode="${r% *}"; ms="${r#* }"
    [ "$kode" = 200 ] && ok "replika $f ${ms} ms" || merah "replika $f HTTP $kode"
  done

  # 7. Akun juri: salinan demo berisi Data Diri sintetis bisa dibuat (sama dengan klik "Masuk sebagai juri")
  local jar loc dd
  jar="$(mktemp)"
  # Sama dengan klik tombol (form action SvelteKit lewat fetch): jawaban JSON redirect ke /beranda + cookie sesi.
  loc="$(curl -s -m 15 -c "$jar" -H "Origin: $o" -H 'x-sveltekit-action: true' -H 'accept: application/json'     --data 'juri=1' "$o/masuk?/juri" || true)"
  dd="$(curl -s -m 10 -b "$jar" -o /dev/null -w '%{http_code}' "$o/data-diri" || true)"
  rm -f "$jar"
  case "$loc" in
    *'"location":"/beranda"'*) [ "$dd" = 200 ] && ok "akun juri: salinan demo dibuat, Data Diri terbuka" || merah "akun juri: Data Diri HTTP $dd" ;;
    *) merah "akun juri gagal dibuat (${loc:0:120})" ;;
  esac

  echo
  if [ "$GAGAL" = 0 ]; then
    echo "${H}${T}SIAP DEMO.${N} Buka $o di peramban (layar proyektor), klik Masuk -> \"Masuk sebagai juri\"."
  else
    echo "${M}${T}$GAGAL pemeriksaan GAGAL.${N} Perbaiki dulu (log: bash scripts/demo-final.sh log)."
    return 1
  fi
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  cek) cmd_cek ;;
  offline) cmd_mode 1 ;;
  online) cmd_mode 0 ;;
  log) shift; compose logs -f --tail 100 "$@" ;;
  down) compose down ;;
  reset) compose down -v ;;
  *) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
