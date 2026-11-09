#!/usr/bin/env bash
# ACTIONS_RUNNER_HOOK_JOB_STARTED: dijalankan runner sebelum langkah pertama setiap job. Exit != 0 menggagalkan
# job sebelum checkout. Penjaga disk: job ditolak bila disk >= 88% (layanan lain di agent-vm didahulukan).
set -euo pipefail
max="${URUSIN_CI_DISK_MAX:-88}"
pct="$(df --output=pcent "${URUSIN_CI_DF_ROOT:-/}" | tail -n1 | tr -dc '0-9')"
if [ -z "$pct" ] || [ "$pct" -ge "$max" ]; then
  echo "::error::disk agent-vm ${pct:-?}% >= ${max}%: job self-hosted ditolak. Lapor ke ops (jangan prune global)."
  exit 1
fi
echo "disk agent-vm ${pct}% (< ${max}%): job boleh jalan"
