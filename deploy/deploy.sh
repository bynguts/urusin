#!/usr/bin/env bash
# Deploy image web Urusin berdasarkan digest. Tidak pernah build di VPS, tidak menyimpan rahasia.
#
#   deploy/deploy.sh <git-sha>                      # digest dicari di GHCR (butuh `docker login ghcr.io`)
#   deploy/deploy.sh <git-sha> sha256:<digest>      # digest dari ringkasan job release.yml
#   deploy/deploy.sh sha256:<digest>                # SHA diambil dari label image (revision)
#
# Setelah `up`, menunggu /api/health dan memastikan gitSha cocok. Idempotent: menjalankan ulang
# dengan argumen sama hanya memastikan kondisi yang sama.
set -euo pipefail

cd "$(dirname "$0")"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/bynguts/urusin-web}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4310/api/health}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
ENV_FILE=".env"
IMAGES_FILE=".env.images"

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

if [ -z "$digest" ]; then
  echo "deploy: mencari digest ${IMAGE_REPO}:${expected_sha}"
  digest="$(docker buildx imagetools inspect "${IMAGE_REPO}:${expected_sha}" --format '{{json .Manifest.Digest}}' | tr -d '"')" \
    || die "image ${IMAGE_REPO}:${expected_sha} tidak ditemukan (sudah docker login ghcr.io?)"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "digest tidak valid: $digest"
fi

web_image="${IMAGE_REPO}@${digest}"

echo "deploy: pull ${web_image}"
docker pull "$web_image" >/dev/null

if [ -z "$expected_sha" ]; then
  expected_sha="$(docker image inspect "$web_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  [ -n "$expected_sha" ] && [ "$expected_sha" != "dev" ] || die "SHA tidak diketahui; berikan <git-sha> sebagai argumen"
fi

# Simpan image sebelumnya untuk rollback, lalu tulis yang baru.
previous=""
if [ -f "$IMAGES_FILE" ]; then
  previous="$(sed -n 's/^WEB_IMAGE=//p' "$IMAGES_FILE" | head -n1)"
fi
umask 077
printf 'WEB_IMAGE=%s\nGIT_SHA=%s\n' "$web_image" "$expected_sha" > "${IMAGES_FILE}.tmp"
mv "${IMAGES_FILE}.tmp" "$IMAGES_FILE"

compose=(docker compose -f compose.prod.yml --env-file "$ENV_FILE" --env-file "$IMAGES_FILE")
"${compose[@]}" up -d --remove-orphans

echo "deploy: menunggu ${HEALTH_URL} (maks ${WAIT_SECONDS}s)"
body=""
for _ in $(seq 1 "$WAIT_SECONDS"); do
  if body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then break; fi
  body=""
  sleep 1
done

rollback_hint() {
  if [ -n "$previous" ] && [ "$previous" != "$web_image" ]; then
    echo "rollback: $0 ${previous#*@}" >&2
  else
    echo "rollback: tidak ada image sebelumnya yang tercatat" >&2
  fi
}

if [ -z "$body" ]; then
  echo "deploy: /api/health tidak merespons" >&2
  "${compose[@]}" logs --tail 40 web >&2 || true
  rollback_hint
  exit 1
fi

actual_sha="$(printf '%s' "$body" | sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p')"
case "$actual_sha" in
  "$expected_sha"*) ;;
  *)
    echo "deploy: gitSha tidak cocok (health=${actual_sha:-kosong}, diharapkan=${expected_sha})" >&2
    rollback_hint
    exit 1
    ;;
esac

echo "deploy: OK gitSha=${actual_sha} image=${web_image}"
rollback_hint
