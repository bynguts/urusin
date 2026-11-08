#!/usr/bin/env bash
# Peringatan disk (cron host): exit 1 dan notifikasi bila pemakaian > THRESHOLD persen.
#
#   */15 * * * *  NTFY_URL=https://ntfy.sh/<topik-rahasia> /opt/urusin/deploy/disk-alert.sh
#
# Variabel (opsional): THRESHOLD (default 85), MOUNTS (default "/"; tambahkan /var/lib/docker bila
# terpisah), NTFY_URL (POST ke topik ntfy), HEALTHCHECK_URL (healthchecks.io: ping sukses saat aman,
# "/fail" saat lewat ambang), NTFY_TOKEN (Bearer, opsional). Tanpa notifikasi, hanya log + exit code.
set -euo pipefail

THRESHOLD="${THRESHOLD:-85}"
MOUNTS="${MOUNTS:-/}"
[[ "$THRESHOLD" =~ ^[0-9]+$ ]] || { echo "disk-alert: THRESHOLD harus angka" >&2; exit 2; }

over=""
for m in $MOUNTS; do
  # `df --output=pcent` mencetak header lalu " 91%".
  pct="$(df --output=pcent "$m" | tail -n1 | tr -dc '0-9')"
  [ -n "$pct" ] || { echo "disk-alert: gagal membaca df $m" >&2; exit 2; }
  echo "disk-alert: $m ${pct}% (ambang ${THRESHOLD}%)"
  if [ "$pct" -gt "$THRESHOLD" ]; then over="$over $m=${pct}%"; fi
done

if [ -n "$over" ]; then
  msg="Disk $(hostname) melewati ${THRESHOLD}%:${over}"
  echo "disk-alert: PERINGATAN $msg" >&2
  command -v logger >/dev/null && logger -t urusin-disk "$msg" || true
  if [ -n "${NTFY_URL:-}" ]; then
    auth=(); [ -z "${NTFY_TOKEN:-}" ] || auth=(-H "Authorization: Bearer ${NTFY_TOKEN}")
    curl -fsS -m 10 "${auth[@]}" -H "Title: Urusin: disk hampir penuh" -H "Priority: high" -d "$msg" "$NTFY_URL" >/dev/null \
      || echo "disk-alert: kirim ntfy gagal" >&2
  fi
  [ -z "${HEALTHCHECK_URL:-}" ] || curl -fsS -m 10 -o /dev/null "${HEALTHCHECK_URL}/fail" || true
  exit 1
fi

[ -z "${HEALTHCHECK_URL:-}" ] || curl -fsS -m 10 -o /dev/null "$HEALTHCHECK_URL" || true
