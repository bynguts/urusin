#!/usr/bin/env bash
# Uji "nol respons gagal selama deploy". JALANKAN di VPS saat gladi (bukan di CI): memanggil
# deploy.sh sungguhan beberapa kali berturut-turut sambil menembak URL publik dengan curl.
#
#   deploy/tests/zero-downtime.sh <sha>[@sha256:<digest>] [<sha>[@sha256:<digest>] ...]
#   Contoh (dua arah blue->green->blue):  zero-downtime.sh abc1234@sha256:... def5678@sha256:...
#
# Variabel (opsional):
#   URL            yang ditembak (default https://$DOMAIN/, DOMAIN dari deploy/.env; /api/health publik 404)
#   RPS            perkiraan permintaan per detik (default 20)
#   MAX_FAILURES   batas respons gagal yang masih lulus (default 0)
#   TIMEOUT        detik per permintaan (default 5)
#   GRACE          detik tambahan menembak setelah deploy terakhir selesai (default 5)
#   DEPLOY_CMD     perintah deploy (default deploy/deploy.sh; dipakai tes harness)
#   LOG            berkas ringkasan kegagalan (default ./zero-downtime-failures.log)
# Gagal = status bukan 2xx/3xx, atau curl error (000). Exit 0 bila gagal <= MAX_FAILURES dan semua deploy sukses.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$HERE/.." && pwd)"
DEPLOY_CMD="${DEPLOY_CMD:-$DEPLOY_DIR/deploy.sh}"
RPS="${RPS:-20}"
MAX_FAILURES="${MAX_FAILURES:-0}"
TIMEOUT="${TIMEOUT:-5}"
GRACE="${GRACE:-5}"
LOG="${LOG:-./zero-downtime-failures.log}"

die() { echo "zero-downtime: $*" >&2; exit 2; }
[ $# -ge 1 ] || die "pemakaian: $0 <sha>[@sha256:<digest>] ..."
command -v curl >/dev/null || die "curl tidak ditemukan"

if [ -z "${URL:-}" ]; then
  domain="$(sed -n 's/^DOMAIN=//p' "$DEPLOY_DIR/.env" 2>/dev/null | head -n1 | tr -d "\"' \r")"
  [ -n "$domain" ] || die "set URL atau DOMAIN di deploy/.env"
  URL="https://${domain}/"
fi
interval="$(awk -v r="$RPS" 'BEGIN { printf "%.3f", 1 / r }')"

counts="$(mktemp)"; : > "$counts"; : > "$LOG"
stopfile="$(mktemp -u)"

probe_loop() {
  local total=0 failed=0 code
  while [ ! -e "$stopfile" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$URL" 2>/dev/null || true)"
    total=$((total + 1))
    case "$code" in
      2* | 3*) ;;
      *) failed=$((failed + 1)); echo "$(date -u +%T) HTTP ${code:-000}" >> "$LOG" ;;
    esac
    sleep "$interval"
  done
  echo "$total $failed" > "$counts"
}

echo "zero-downtime: menembak $URL (~${RPS} rps) selama deploy: $*"
probe_loop &
probe_pid=$!
# Beri loop waktu menyatakan baseline sehat sebelum deploy pertama.
sleep 2

deploy_rc=0
for spec in "$@"; do
  sha="${spec%%@*}"; digest=""
  [[ "$spec" == *@* ]] && digest="${spec#*@}"
  echo "zero-downtime: deploy $sha ${digest:+($digest)}"
  # shellcheck disable=SC2086  # digest kosong tidak boleh menjadi argumen kosong
  "$DEPLOY_CMD" "$sha" $digest || { deploy_rc=1; echo "zero-downtime: deploy GAGAL ($sha)" >&2; break; }
done

sleep "$GRACE"
: > "$stopfile"
wait "$probe_pid"
rm -f "$stopfile"
read -r total failed < "$counts"
rm -f "$counts"

echo "zero-downtime: total=${total} gagal=${failed} (batas ${MAX_FAILURES}); deploy_rc=${deploy_rc}"
if [ "$failed" -gt 0 ]; then echo "zero-downtime: lihat $LOG"; fi
if [ "$deploy_rc" -eq 0 ] && [ "$failed" -le "$MAX_FAILURES" ]; then
  echo "zero-downtime: LULUS"
  exit 0
fi
echo "zero-downtime: GAGAL" >&2
exit 1
