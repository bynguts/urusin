#!/usr/bin/env bash
# ACTIONS_RUNNER_HOOK_JOB_COMPLETED: dijalankan runner (user urusin-ci) setelah setiap job, sukses atau gagal.
# Runner persisten, jadi kebersihan antar job dijaga di sini (checkout membersihkan workspace di awal job):
#   - hapus node_modules di workspace (penyumbang disk terbesar),
#   - pnpm store prune di HOME runner (_home); batas keras PNPM_STORE_MAX_MB (bawaan 1024) bila prune tidak
#     bisa jalan (pnpm/node dari setup-* tidak selalu ada di PATH hook) atau tidak cukup: store dihapus,
#     job berikut memulihkannya dari cache setup-node,
#   - hapus kontainer sisa urusin-ci-pw-* dan temp ci-docker (lewat ci-docker cleanup, sudoers sempit),
#   - cetak df agar tren disk terlihat di log job.
# Tidak pernah gagal-keras: kebersihan tidak boleh mengubah hasil job.
set -uo pipefail
# Runner memanggil hook dengan `bash -e -o pipefail`; matikan -e agar langkah kebersihan yang gagal (mis. tidak ada
# pnpm/setup-pnpm di job Gitleaks) tidak membuat hook exit 1 dan menandai job gagal.
set +e
ws="${GITHUB_WORKSPACE:-}"
case "$ws" in
  /opt/urusin-ci/runner/_work/*)
    find "$ws" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null
    ;;
esac
case "${HOME:-}" in
  /opt/urusin-ci/runner/_home)
    pnpm_bin="$(command -v pnpm || find "$HOME/setup-pnpm/node_modules/.bin" -maxdepth 1 -name pnpm 2>/dev/null | head -n1)"
    [ -z "$pnpm_bin" ] || "$pnpm_bin" store prune >/dev/null 2>&1 || echo "job-completed: pnpm store prune gagal (batas keras tetap berlaku)"
    store="$HOME/.local/share/pnpm/store"
    if [ -d "$store" ] && [ "$(du -sm "$store" | cut -f1)" -gt "${PNPM_STORE_MAX_MB:-1024}" ]; then
      rm -rf "$store" && echo "job-completed: pnpm store > ${PNPM_STORE_MAX_MB:-1024} MB, dihapus"
    fi
    ;;
esac
sudo -n /opt/urusin-ci/bin/ci-docker cleanup 2>&1 || true
echo "disk agent-vm setelah job: $(df -h --output=pcent,avail / | tail -n1 | tr -s ' ')"
exit 0
