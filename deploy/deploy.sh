#!/usr/bin/env bash
# Deploy image web Urusin berdasarkan digest, blue/green. Tidak pernah build di VPS, tidak menyimpan rahasia.
#
#   deploy/deploy.sh <git-sha>                      # digest dicari di GHCR (butuh `docker login ghcr.io`)
#   deploy/deploy.sh <git-sha> sha256:<digest>      # digest dari ringkasan job release.yml
#   deploy/deploy.sh sha256:<digest>                # SHA diambil dari label image (revision)
#
# Alur:
#   1. Pull image; label revision harus SHA lengkap dan SHA itu juga harus ada di provenance buildx.
#   2. Jalankan image di warna yang menganggur (blue=4310, green=4311), tunggu /api/health sehat,
#      gitSha cocok, dan /api/ready masih 503 (belum dipromosikan). Warna aktif tidak disentuh.
#      Juga memastikan 127.0.0.1:<port> tidak terikat ke 0.0.0.0 (ss) dan web menjangkau LLM_BASE_URL.
#   3. Smoke ke port langsung warna idle lulus => PROMOSI: tulis /data/.active-color (volume bersama).
#      Caddy memakai /api/ready, jadi lalu lintas pindah hanya setelah promosi, bukan saat port hidup.
#   4. Smoke publik (https://$DOMAIN, https://verify.$DOMAIN, TLS) bila DOMAIN diset, lalu hentikan
#      warna lama (warna lama tetap hidup sampai smoke lulus agar rollback seketika).
#   5. Gagal di langkah 2-4 => rollback otomatis (promosikan ulang yang lama) dan exit non-zero.
#
# Variabel (opsional): GHCR_TOKEN/GHCR_USER (login sementara), DRAIN_SECONDS (default 120 = batas turn agen), REQUIRE_LLM=1 (gagal bila web tidak menjangkau LLM_BASE_URL), IMAGE_REPO, WAIT_SECONDS, SETTLE_SECONDS, PORT_BLUE, PORT_GREEN, SKIP_SMOKE=1,
# REQUIRE_PROVENANCE (default 1; 0 = cukup label revision, JANGAN dipakai di produksi).
# GHCR: DOCKER_CONFIG dari lingkungan dihormati. Bila GHCR_TOKEN diset (dan DOCKER_CONFIG tidak), skrip
# membuat DOCKER_CONFIG sementara di /tmp (chmod 700), login lewat stdin, dan menghapusnya saat keluar.
# Skrip ini tidak pernah menulis ke konfigurasi docker di HOME pengguna. Idempotent: menjalankan ulang dengan argumen sama aman (warna berganti).
set -euo pipefail

cd "$(dirname "$0")"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/bynguts/urusin-web}"
PORT_BLUE="${PORT_BLUE:-4310}"
PORT_GREEN="${PORT_GREEN:-4311}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
SETTLE_SECONDS="${SETTLE_SECONDS:-3}"
DRAIN_SECONDS="${DRAIN_SECONDS:-120}"
REQUIRE_PROVENANCE="${REQUIRE_PROVENANCE:-1}"
ENV_FILE=".env"
IMAGES_FILE=".env.images"
HISTORY_FILE=".env.images.history"

die() { echo "deploy: $*" >&2; exit 1; }

[ $# -ge 1 ] && [ $# -le 2 ] || die "pemakaian: $0 <git-sha> [sha256:<digest>] | $0 sha256:<digest>"
[ -f "$ENV_FILE" ] || die "$ENV_FILE tidak ada (salin ../.env.example, isi nilai, chmod 600)"

# Izin direktori deploy dan rahasia (hardening.md): direktori paling longgar 0751 (others hanya --x agar user
# Caddy bisa menelusuri ke snippet lama; tidak bisa membaca daftar isi atau menulis), .env dan
# .restic-password 0600. Dilewati di Windows (MSYS/Cygwin): NTFS tidak punya mode POSIX.
check_secret_perms() {
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; esac
  local f
  [ -z "$(find . -maxdepth 0 -perm /026)" ] \
    || die "direktori $(pwd) bisa ditulis group atau dibaca/ditulis others; jalankan: chmod 0751 $(pwd)"
  for f in "$ENV_FILE" .restic-password; do
    [ -e "$f" ] || continue
    [ -z "$(find "$f" -maxdepth 0 -perm /077)" ] || die "$f bisa diakses group/others; jalankan: chmod 600 $(pwd)/$f"
  done
}
check_secret_perms

command -v docker >/dev/null || die "docker tidak ditemukan"
command -v curl >/dev/null || die "curl tidak ditemukan"
# shellcheck source=docker-versi.sh
. ./docker-versi.sh
pastikan_docker_28 || die "$DOCKER_VERSI_PESAN"

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

# --- 0. Login GHCR sementara (opsional) -------------------------------------------------------
if [ -n "${GHCR_TOKEN:-}" ] && [ -z "${DOCKER_CONFIG:-}" ]; then
  DOCKER_CONFIG="$(mktemp -d "${TMPDIR:-/tmp}/urusin-docker-XXXXXX")"
  export DOCKER_CONFIG
  chmod 700 "$DOCKER_CONFIG"
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  # Token lewat pipe ke stdin (bukan argumen, bukan here-string yang ditulis ke berkas sementara).
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-bynguts}" --password-stdin >/dev/null \
    || die "docker login ghcr.io gagal (GHCR_TOKEN butuh scope read:packages)"
  echo "deploy: login GHCR sementara di $DOCKER_CONFIG (dihapus saat selesai)"
fi
unset GHCR_TOKEN

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
# Label revision harus SHA git LENGKAP (40 hex); "dev", kosong, atau SHA pendek ditolak.
[[ "$label_sha" =~ ^[0-9a-f]{40}$ ]] || die "label org.opencontainers.image.revision bukan SHA lengkap (40 hex): '${label_sha:-kosong}'; ditolak"
if [ -z "$expected_sha" ]; then
  expected_sha="$label_sha"
elif [ "${label_sha#"$expected_sha"}" = "$label_sha" ]; then
  die "label revision image ($label_sha) != SHA yang diharapkan ($expected_sha); ditolak"
fi
expected_sha="$label_sha"

# --- 1b. Provenance (#14e): SHA lengkap harus ada di label DAN di provenance buildx ------------
# Ini pencocokan isi metadata provenance, BUKAN verifikasi kriptografis attestation (tanda tangan/
# cosign belum dipakai). Melindungi dari image salah-SHA, bukan dari registry yang disusupi.
provenance="$(docker buildx imagetools inspect "$web_image" --format '{{json .Provenance}}' 2>/dev/null || true)"
if [ -n "$provenance" ] && [ "$provenance" != "null" ] && [ "$provenance" != "{}" ] && grep -qF -- "$label_sha" <<<"$provenance"; then
  echo "deploy: provenance memuat SHA lengkap ${label_sha:0:12}... (isi dicocokkan; tanda tangan tidak diverifikasi)"
elif [ "$REQUIRE_PROVENANCE" = "0" ]; then
  echo "deploy: PERINGATAN: provenance tidak ada/tidak memuat SHA lengkap; hanya label revision (REQUIRE_PROVENANCE=0)" >&2
else
  die "provenance buildx tidak memuat SHA lengkap ${label_sha:0:12}...; ditolak (REQUIRE_PROVENANCE=1)"
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
ready_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/api/ready" 2>/dev/null || true; }

# Host network: port web harus terikat ke 127.0.0.1 saja. Tanpa `ss` pemeriksaan dilewati dengan peringatan.
# nonloopback_bind <port>: 0 (BURUK) bila ada listener pada port itu dengan alamat lokal selain 127.0.0.1.
nonloopback_bind() {
  command -v ss >/dev/null || return 1
  local out bad
  out="$(ss -ltnH "sport = :$1" 2>/dev/null || true)"
  bad="$(awk -v want="127.0.0.1:$1" '$4 != want { print }' <<<"$out")"
  [ -n "$bad" ] || return 1
  echo "deploy: :$1 terikat ke semua antarmuka / alamat non-loopback (harus 127.0.0.1):" >&2
  echo "$bad" >&2
  return 0
}
listeners_loopback_only() { # port
  command -v ss >/dev/null || { echo "deploy: peringatan: ss tidak ada; pemeriksaan bind dilewati" >&2; return 0; }
  [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null || true)" ] || { echo "deploy: :$1 tidak terlihat mendengarkan" >&2; return 1; }
  ! nonloopback_bind "$1"
}

wait_healthy() { # port expected_sha -> 0 bila sehat dan gitSha cocok
  local port="$1" want="$2" body="" got=""
  for _ in $(seq 1 "$WAIT_SECONDS"); do
    # Bind non-loopback terdeteksi selagi menunggu: berhenti saat itu juga (port terbuka ke publik).
    if nonloopback_bind "$port"; then return 1; fi
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
  local body="" color="" code host
  # Publik hanya /api/ready ({ready,color}); /api/health (gitSha, versi, runningTurns) dijawab 404 oleh
  # Caddy dan hanya diperiksa lewat 127.0.0.1. Caddy butuh beberapa detik memindahkan lalu lintas setelah
  # promosi: ulangi sampai warna publik = warna baru. curl menolak sertifikat tidak valid (cek TLS).
  for _ in 1 2 3 4 5 6 7 8; do
    body="$(curl -fsS --max-time 10 "https://${domain}/api/ready" 2>/dev/null)" || body=""
    color="$(printf '%s' "$body" | sed -n 's/.*"color":"\([a-z]*\)".*/\1/p')"
    if [ "$color" = "$idle" ]; then break; fi
    sleep 2
  done
  [ -n "$body" ] || { echo "deploy: smoke: https://${domain}/api/ready gagal (TLS/DNS/Caddy?)" >&2; return 1; }
  [ "$color" = "$idle" ] || { echo "deploy: smoke: warna publik=${color:-kosong}, diharapkan=${idle}" >&2; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${domain}/api/health" 2>/dev/null || true)"
  [ "$code" = 404 ] || echo "deploy: peringatan: https://${domain}/api/health publik -> HTTP ${code:-?} (harus 404; snippet Caddy lama?)" >&2
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

# --- Promosi (penanda warna aktif di volume bersama; dibaca /api/ready) ------------------------
# promote <warna-yang-dipromosikan> <warna-kontainer-tempat-exec>
promote() {
  "${compose[@]}" exec -T "web-$2" sh -c 'printf %s "$0" > /data/.active-color.tmp && mv /data/.active-color.tmp /data/.active-color' "$1"
}

# Turn agen berjalan di latar belakang dan memakai SSE: jangan hentikan warna lama selagi masih ada.
# Menunggu runningTurns (dari /api/health) = 0, paling lama DRAIN_SECONDS (>= batas turn 120 dtk).
# Image lama tanpa field itu: tunggu penuh. Kontainer sudah mati: langsung lanjut.
drain_old() { # port warna
  local waited=0 body n
  while [ "$waited" -lt "$DRAIN_SECONDS" ]; do
    body="$(health_body "$1")"
    [ -n "$body" ] || return 0
    n="$(printf '%s' "$body" | sed -n 's/.*"runningTurns":\([0-9]*\).*/\1/p')"
    [ "$n" = 0 ] && return 0
    echo "deploy: menunggu ${n:-turn (jumlah tidak diketahui)} di web-$2 selesai (${waited}/${DRAIN_SECONDS}s)"
    sleep 5
    waited=$((waited + 5))
  done
  echo "deploy: peringatan: batas drain ${DRAIN_SECONDS}s tercapai; web-$2 dihentikan walau turn masih berjalan" >&2
}

# --- 5. Rollback ------------------------------------------------------------------------------
rolled_back=0
rollback() {
  [ "$rolled_back" = 0 ] || return 0
  rolled_back=1
  echo "deploy: ROLLBACK ke ${prev_image:-<tidak ada>}" >&2
  if [ -n "$prev_image" ]; then
    printf 'ACTIVE_COLOR=%s\nWEB_IMAGE_%s=%s\nGIT_SHA_%s=%s\nRUN_MIGRATIONS_%s=0\n' \
      "$active" "$(upper "$active")" "$prev_image" "$(upper "$active")" "$prev_sha" "$(upper "$active")" > "${IMAGES_FILE}.tmp"
    mv "${IMAGES_FILE}.tmp" "$IMAGES_FILE"
  fi
  if [ -z "$prev_image" ]; then
    "${compose[@]}" exec -T "web-$idle" rm -f /data/.active-color >&2 || true
    "${compose[@]}" stop "web-$idle" >&2 || true
    echo "deploy: rollback: tidak ada image sebelumnya (deploy pertama); web-$idle dihentikan" >&2
    return 0
  fi
  # Pastikan versi lama berjalan dan sehat, promosikan ulang, baru hentikan yang gagal.
  if [ -z "$(health_body "$active_port")" ] || ! sha_match "$(gitsha_of "$(health_body "$active_port")")" "$prev_sha"; then
    echo "deploy: rollback: menjalankan ulang ${prev_image} di web-${active}" >&2
    "${compose[@]}" up -d "web-$active" >&2 || true
    wait_healthy "$active_port" "$prev_sha" || echo "deploy: PERINGATAN: versi sebelumnya juga tidak sehat; periksa manual" >&2
  fi
  promote "$active" "$active" >&2 || promote "$active" "$idle" >&2 || echo "deploy: PERINGATAN: gagal menulis penanda warna aktif" >&2
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

listeners_loopback_only "$idle_port" || fail "web-$idle tidak boleh mendengarkan di luar 127.0.0.1"
# Warna aktif juga di network host: bind non-loopback di sana sama berbahayanya.
if [ -n "$active" ] && [ "$active_port" != "$idle_port" ] && nonloopback_bind "$active_port"; then
  fail "web-$active (aktif, :$active_port) mendengarkan di luar 127.0.0.1"
fi

# M11a: web (di dalam kontainer) harus menjangkau proxy LLM. Peringatan saja kecuali REQUIRE_LLM=1.
if ! bash ./check-llm-reach.sh "$idle"; then
  if [ "${REQUIRE_LLM:-0}" = 1 ]; then fail "web-$idle tidak menjangkau LLM_BASE_URL (REQUIRE_LLM=1)"; fi
  echo "deploy: PERINGATAN: web-$idle tidak menjangkau LLM_BASE_URL; fitur AI akan gagal (set REQUIRE_LLM=1 untuk menggagalkan deploy)" >&2
fi

# --- 3. Smoke langsung ke warna idle, lalu promosi --------------------------------------------
# /api/ready harus ada (image mengenal blue/green) dan belum siap: 503. 404 berarti image tanpa rute itu.
[ "$(ready_code "$idle_port")" = 503 ] || fail "web-$idle: /api/ready harus 503 sebelum promosi (image tanpa rute /api/ready?)"
echo "deploy: smoke langsung web-${idle} lulus; mempromosikan"
promote "$idle" "$idle" || fail "gagal menulis penanda warna aktif"
ok_ready=0
for _ in $(seq 1 15); do
  if [ "$(ready_code "$idle_port")" = 200 ]; then ok_ready=1; break; fi
  sleep 1
done
[ "$ok_ready" = 1 ] || fail "web-$idle tidak siap setelah promosi"
sleep "$SETTLE_SECONDS"

# --- 4. Smoke publik, lalu hentikan warna lama --------------------------------------------------
if [ "$legacy" = 1 ]; then
  drain_old "$active_port" "$active"
  # Layout lama tidak mengenal /api/ready dan tetap di 4310: hentikan sekarang agar lalu lintas pindah.
  "${compose[@]}" stop -t 30 "web-$active" || echo "deploy: peringatan: stop web-$active gagal" >&2
  legacy_ids="$(docker ps -aq --filter label=com.docker.compose.project=urusin --filter label=com.docker.compose.service=web 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -z "$legacy_ids" ] || docker rm -f $legacy_ids >/dev/null || true
fi

smoke_public || fail "smoke publik gagal"

if [ -n "$active" ] && [ "$active" != "$idle" ] && [ "$legacy" = 0 ]; then
  drain_old "$active_port" "$active"
  echo "deploy: menghentikan web-${active}"
  "${compose[@]}" stop -t 30 "web-$active" || echo "deploy: peringatan: stop web-$active gagal" >&2
fi

# Sukses: simpan sebagai aktif; migrasi tidak perlu diulang pada restart berikutnya.
sed -i "s/^ACTIVE_COLOR=.*/ACTIVE_COLOR=${idle}/; s/^RUN_MIGRATIONS_${IDLE_U}=.*/RUN_MIGRATIONS_${IDLE_U}=0/" "$IMAGES_FILE"

echo "deploy: OK aktif=${idle} gitSha=${expected_sha} image=${web_image}"
if [ -n "$prev_image" ] && [ "$prev_image" != "$web_image" ]; then
  echo "rollback manual: $0 ${prev_sha:+$prev_sha }${prev_image#*@}"
fi
