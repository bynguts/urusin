#!/usr/bin/env bash
# Deploy image web Urusin berdasarkan digest, blue/green. Tidak pernah build di VPS, tidak menyimpan rahasia.
#
#   deploy/deploy.sh <git-sha>                      # digest dicari di GHCR (butuh `docker login ghcr.io`)
#   deploy/deploy.sh <git-sha> sha256:<digest>      # digest dari ringkasan job release.yml
#   deploy/deploy.sh sha256:<digest>                # SHA diambil dari label image (revision)
#
# Alur:
#   1. Pull image dan verifikasi provenance/label revision == SHA yang diharapkan (tolak bila beda).
#   2. Jalankan image di warna yang menganggur (blue=4310, green=4311), tunggu /api/health sehat
#      dan gitSha cocok. Warna aktif tidak disentuh sampai tahap ini lulus.
#   3. Hentikan warna lama (Caddy `lb_policy first` memindahkan lalu lintas), lalu smoke test publik
#      (https://$DOMAIN dan https://verify.$DOMAIN + masa berlaku TLS) bila DOMAIN diset.
#   4. Gagal di langkah 2-3 => rollback otomatis ke digest sebelumnya dan exit non-zero.
#
# Variabel (opsional): IMAGE_REPO, WAIT_SECONDS, SETTLE_SECONDS, REQUIRE_PROVENANCE=1 (tanpa fallback
# label), PORT_BLUE, PORT_GREEN, SKIP_SMOKE=1. Idempotent: menjalankan ulang dengan argumen sama aman.
set -euo pipefail

cd "$(dirname "$0")"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/bynguts/urusin-web}"
PORT_BLUE="${PORT_BLUE:-4310}"
PORT_GREEN="${PORT_GREEN:-4311}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
SETTLE_SECONDS="${SETTLE_SECONDS:-3}"
REQUIRE_PROVENANCE="${REQUIRE_PROVENANCE:-0}"
ENV_FILE=".env"
IMAGES_FILE=".env.images"
HISTORY_FILE=".env.images.history"

die() { echo "deploy: $*" >&2; exit 1; }

[ $# -ge 1 ] && [ $# -le 2 ] || die "pemakaian: $0 <git-sha> [sha256:<digest>] | $0 sha256:<digest>"
[ -f "$ENV_FILE" ] || die "$ENV_FILE tidak ada (salin ../.env.example, isi nilai, chmod 600)"
command -v docker >/dev/null || die "docker tidak ditemukan"
command -v curl >/dev/null || die "curl tidak ditemukan"

expected_sha=""
digest=""
for arg in "$@"; do
  if [[ "$arg" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    digest="$arg"
  elif [[ "$arg" =~ ^[0-9a-f]{7,40}$ ]]; then
    expected_sha="$arg"
  else
    die "argumen tidak dikenal: $arg"
  fi
done

port_of() { if [ "$1" = blue ]; then echo "$PORT_BLUE"; else echo "$PORT_GREEN"; fi; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
# Baca KEY dari .env.images (atau file yang diberikan). Kosong bila tidak ada.
getvar() { sed -n "s/^$1=//p" "${2:-$IMAGES_FILE}" 2>/dev/null | head -n1 || true; }
# Dua SHA cocok bila salah satunya awalan dari yang lain (minimal 7 karakter).
sha_match() {
  [ "${#1}" -ge 7 ] && [ "${#2}" -ge 7 ] || return 1
  case "$1" in "$2"*) return 0 ;; esac
  case "$2" in "$1"*) return 0 ;; esac
  return 1
}

compose=(docker compose -f compose.prod.yml --env-file "$ENV_FILE" --env-file "$IMAGES_FILE")

# --- 1. Resolusi digest + pull ---------------------------------------------------------------
if [ -z "$digest" ]; then
  echo "deploy: mencari digest ${IMAGE_REPO}:${expected_sha}"
  digest="$(docker buildx imagetools inspect "${IMAGE_REPO}:${expected_sha}" --format '{{json .Manifest.Digest}}' | tr -d '"')" \
    || die "image ${IMAGE_REPO}:${expected_sha} tidak ditemukan (sudah docker login ghcr.io?)"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "digest tidak valid: $digest"
fi

web_image="${IMAGE_REPO}@${digest}"

echo "deploy: pull ${web_image}"
docker pull "$web_image" >/dev/null

label_sha="$(docker image inspect "$web_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
if [ -z "$expected_sha" ]; then
  expected_sha="$label_sha"
  [ -n "$expected_sha" ] && [ "$expected_sha" != "dev" ] || die "SHA tidak diketahui; berikan <git-sha> sebagai argumen"
fi

# --- 1b. Provenance (#14e): refuse bila image bukan dari SHA yang diharapkan ------------------
if [ -n "$label_sha" ] && ! sha_match "$label_sha" "$expected_sha"; then
  die "label revision image ($label_sha) != SHA yang diharapkan ($expected_sha); ditolak"
fi
provenance="$(docker buildx imagetools inspect "$web_image" --format '{{json .Provenance}}' 2>/dev/null || true)"
if [ -n "$provenance" ] && [ "$provenance" != "null" ] && [ "$provenance" != "{}" ] && grep -q -- "${expected_sha:0:7}" <<<"$provenance"; then
  echo "deploy: provenance cocok dengan ${expected_sha:0:12}"
elif [ "$REQUIRE_PROVENANCE" != "1" ] && [ -n "$label_sha" ] && sha_match "$label_sha" "$expected_sha"; then
  echo "deploy: peringatan: provenance tidak tersedia/tidak memuat SHA; memakai label revision (${label_sha:0:12})" >&2
else
  die "provenance image tidak memverifikasi ${expected_sha:0:12} (set REQUIRE_PROVENANCE=0 hanya bila label revision ada); ditolak"
fi

# --- 2. Tentukan warna aktif/idle ------------------------------------------------------------
active=""; prev_image=""; prev_sha=""; legacy=0
if [ -f "$IMAGES_FILE" ]; then
  active="$(getvar ACTIVE_COLOR)"
  if [ -z "$active" ] && [ -n "$(getvar WEB_IMAGE)" ]; then
    # Layout lama (satu service `web` di 4310): anggap sebagai blue; image-nya jadi "sebelumnya".
    legacy=1; active=blue
    prev_image="$(getvar WEB_IMAGE)"; prev_sha="$(getvar GIT_SHA)"
  fi
fi
if [ -n "$active" ] && [ "$legacy" = 0 ]; then
  prev_image="$(getvar "WEB_IMAGE_$(upper "$active")")"; prev_sha="$(getvar "GIT_SHA_$(upper "$active")")"
fi
if [ -z "$active" ]; then idle=blue; elif [ "$active" = blue ]; then idle=green; else idle=blue; fi
IDLE_U="$(upper "$idle")"
idle_port="$(port_of "$idle")"
active_port="$(port_of "${active:-$idle}")"

# --- Tulis .env.images (atomik) ---------------------------------------------------------------
# Hanya warna idle yang berubah; warna aktif tetap (rollback menulis ulang dari prev_image/prev_sha).
umask 077
{
  echo "ACTIVE_COLOR=${active:-$idle}"
  for c in blue green; do
    C="$(upper "$c")"
    if [ "$c" = "$idle" ]; then
      echo "WEB_IMAGE_${C}=${web_image}"; echo "GIT_SHA_${C}=${expected_sha}"
      # Hanya warna baru yang menjalankan migrasi (lihat README "Migrasi").
      echo "RUN_MIGRATIONS_${C}=1"
    elif [ "$c" = "${active:-}" ]; then
      echo "WEB_IMAGE_${C}=${prev_image}"; echo "GIT_SHA_${C}=${prev_sha}"
      echo "RUN_MIGRATIONS_${C}=0"
    fi
  done
  [ -n "$(getvar FIXTURES_IMAGE)" ] && echo "FIXTURES_IMAGE=$(getvar FIXTURES_IMAGE)"
} > "${IMAGES_FILE}.tmp"
mv "${IMAGES_FILE}.tmp" "$IMAGES_FILE"
# Riwayat tidak pernah dipangkas: mem-pin digest rc*/rilis lama agar bisa di-rollback manual.
printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$idle" "$expected_sha" "$web_image" >> "$HISTORY_FILE"

# --- Utilitas health --------------------------------------------------------------------------
health_body() { curl -fsS --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null || true; }
gitsha_of() { printf '%s' "$1" | sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p'; }

wait_healthy() { # port expected_sha -> 0 bila sehat dan gitSha cocok
  local port="$1" want="$2" body="" got=""
  for _ in $(seq 1 "$WAIT_SECONDS"); do
    body="$(health_body "$port")"
    [ -n "$body" ] && break
    sleep 1
  done
  if [ -z "$body" ]; then echo "deploy: :$port/api/health tidak merespons" >&2; return 1; fi
  got="$(gitsha_of "$body")"
  if [ -n "$want" ] && ! sha_match "$got" "$want"; then
    echo "deploy: gitSha tidak cocok di :$port (health=${got:-kosong}, diharapkan=${want})" >&2
    return 1
  fi
  return 0
}

smoke_public() {
  [ -n "${SKIP_SMOKE:-}" ] && return 0
  local domain
  domain="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | head -n1 | tr -d "\"' \r")"
  if [ -z "$domain" ]; then echo "deploy: DOMAIN tidak diset di $ENV_FILE; smoke publik dilewati"; return 0; fi
  local body got code host
  # curl menolak sertifikat tidak valid secara bawaan, jadi ini sekaligus memeriksa TLS.
  body="$(curl -fsS --max-time 10 "https://${domain}/api/health")" || { echo "deploy: smoke: https://${domain}/api/health gagal (TLS/DNS/Caddy?)" >&2; return 1; }
  got="$(gitsha_of "$body")"
  sha_match "$got" "$expected_sha" || { echo "deploy: smoke: gitSha publik=${got:-kosong}, diharapkan=${expected_sha}" >&2; return 1; }
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://verify.${domain}/")" || { echo "deploy: smoke: https://verify.${domain}/ gagal (TLS/DNS?)" >&2; return 1; }
  case "$code" in 2*|3*|4*) ;; *) echo "deploy: smoke: https://verify.${domain}/ -> HTTP $code" >&2; return 1 ;; esac
  if command -v openssl >/dev/null; then
    for host in "$domain" "verify.${domain}"; do
      echo | openssl s_client -servername "$host" -connect "${host}:443" 2>/dev/null | openssl x509 -noout -checkend $((7 * 86400)) >/dev/null \
        || { echo "deploy: smoke: sertifikat $host tidak valid atau kedaluwarsa < 7 hari" >&2; return 1; }
    done
  fi
  echo "deploy: smoke publik OK (${domain}, verify.${domain}, TLS)"
}

# --- 4. Rollback ------------------------------------------------------------------------------
rolled_back=0
rollback() {
  [ "$rolled_back" = 0 ] || return 0
  rolled_back=1
  echo "deploy: ROLLBACK ke ${prev_image:-<tidak ada>}" >&2
  if [ -n "$prev_image" ]; then
    printf 'ACTIVE_COLOR=%s
WEB_IMAGE_%s=%s
GIT_SHA_%s=%s
RUN_MIGRATIONS_%s=0
'       "$active" "$(upper "$active")" "$prev_image" "$(upper "$active")" "$prev_sha" "$(upper "$active")" > "${IMAGES_FILE}.tmp"
    mv "${IMAGES_FILE}.tmp" "$IMAGES_FILE"
  fi
  if [ -z "$prev_image" ]; then
    "${compose[@]}" stop "web-$idle" >&2 || true
    echo "deploy: rollback: tidak ada image sebelumnya (deploy pertama); web-$idle dihentikan" >&2
    return 0
  fi
  # Pastikan versi lama berjalan dan sehat, baru hentikan yang gagal.
  if [ -z "$(health_body "$active_port")" ] || ! sha_match "$(gitsha_of "$(health_body "$active_port")")" "$prev_sha"; then
    echo "deploy: rollback: menjalankan ulang ${prev_image} di web-${active}" >&2
    "${compose[@]}" up -d "web-$active" >&2 || true
    wait_healthy "$active_port" "$prev_sha" || echo "deploy: PERINGATAN: versi sebelumnya juga tidak sehat; periksa manual" >&2
  fi
  "${compose[@]}" stop "web-$idle" >&2 || true
  echo "deploy: rollback selesai; melayani ${prev_image}" >&2
}
fail() {
  echo "deploy: GAGAL: $*" >&2
  "${compose[@]}" logs --tail 40 "web-$idle" >&2 || true
  rollback
  exit 1
}

# --- 2b. Naikkan warna idle dan tunggu sehat --------------------------------------------------
echo "deploy: menaikkan web-${idle} (:${idle_port}) dengan ${web_image}"
"${compose[@]}" up -d "web-$idle" || fail "compose up web-$idle gagal"
echo "deploy: menunggu http://127.0.0.1:${idle_port}/api/health (maks ${WAIT_SECONDS}s)"
wait_healthy "$idle_port" "$expected_sha" || fail "web-$idle tidak sehat / gitSha salah"

# --- 3. Alihkan: hentikan warna lama, smoke publik --------------------------------------------
if [ -n "$active" ] && [ "$active" != "$idle" ]; then
  sleep "$SETTLE_SECONDS"
  echo "deploy: menghentikan web-${active} (lalu lintas pindah ke web-${idle})"
  "${compose[@]}" stop -t 30 "web-$active" || echo "deploy: peringatan: stop web-$active gagal" >&2
  if [ "$legacy" = 1 ]; then
    # Kontainer `web` dari layout lama sudah yatim; hapus agar port 4310 bebas.
    legacy_ids="$(docker ps -aq --filter label=com.docker.compose.project=urusin --filter label=com.docker.compose.service=web 2>/dev/null || true)"
    [ -z "$legacy_ids" ] || docker rm -f $legacy_ids >/dev/null || true
  fi
  # Pastikan yang melayani sekarang benar-benar versi baru.
  wait_healthy "$idle_port" "$expected_sha" || fail "web-$idle tidak sehat setelah pengalihan"
fi

if ! smoke_public; then
  fail "smoke publik gagal"
fi

# Sukses: simpan sebagai aktif; migrasi tidak perlu diulang pada restart berikutnya.
sed -i "s/^ACTIVE_COLOR=.*/ACTIVE_COLOR=${idle}/; s/^RUN_MIGRATIONS_${IDLE_U}=.*/RUN_MIGRATIONS_${IDLE_U}=0/" "$IMAGES_FILE"

echo "deploy: OK aktif=${idle} gitSha=${expected_sha} image=${web_image}"
if [ -n "$prev_image" ] && [ "$prev_image" != "$web_image" ]; then
  echo "rollback manual: $0 ${prev_sha:+$prev_sha }${prev_image#*@}"
fi
