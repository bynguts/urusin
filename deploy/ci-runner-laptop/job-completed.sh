#!/usr/bin/env bash
# ACTIONS_RUNNER_HOOK_JOB_COMPLETED: kebersihan setelah setiap job (disk laptop sempit).
#   - workspace job dikosongkan total (checkout berikutnya clone ulang),
#   - pnpm store dan cache user dihapus (setup-node memulihkannya dari cache GitHub),
#   - _work/_tool (Node dari setup-node) dibiarkan agar tidak diunduh ulang.
# Tidak pernah gagal-keras: kebersihan tidak boleh mengubah hasil job.
set +e
ws="${GITHUB_WORKSPACE:-}"
case "$ws" in
  /home/runner/_work/?*) find "$ws" -mindepth 1 -delete 2>/dev/null ;;
esac
rm -rf "$HOME/.local/share/pnpm/store" "$HOME/.cache" "$HOME/.npm" 2>/dev/null
echo "runner laptop setelah job: _work $(du -sh /home/runner/_work 2>/dev/null | cut -f1)"
exit 0
