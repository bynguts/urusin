#!/usr/bin/env bash
# ACTIONS_RUNNER_HOOK_JOB_COMPLETED: kebersihan setelah setiap job (disk laptop sempit, unduhan ke GitHub lambat).
#   - workspace: hanya berkas tak terlacak/ignored (node_modules, build, coverage) yang dihapus; .git disimpan agar
#     checkout berikutnya cukup fetch inkremental, bukan clone penuh,
#   - pnpm store lokal dipertahankan (ci.yml mematikan cache setup-node di runner ini) dan dihapus bila melewati
#     PNPM_STORE_MAX_MB (bawaan 2048); ~/.cache dan ~/.npm disimpan sampai 1 GB masing-masing,
#   - action yang sudah diunduh (dipin SHA, jadi isinya tetap) diarsipkan ke ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE
#     sehingga "Set up job" berikutnya tidak mengunduh ulang dari GitHub,
#   - _work/_tool (Node dari setup-node) dibiarkan agar tidak diunduh ulang.
# Tidak pernah gagal-keras: kebersihan tidak boleh mengubah hasil job.
set +e
ws="${GITHUB_WORKSPACE:-}"
case "$ws" in
  /home/runner/_work/?*)
    if [ -d "$ws/.git" ]; then git -C "$ws" clean -ffdxq 2>/dev/null; else find "$ws" -mindepth 1 -delete 2>/dev/null; fi
    ;;
esac
# pnpm menaruh store di akar filesystem proyek (volume _work), atau di XDG bila proyek di filesystem yang sama.
for store in /home/runner/_work/.pnpm-store "$HOME/.local/share/pnpm/store"; do
  if [ -d "$store" ] && [ "$(du -sm "$store" | cut -f1)" -gt "${PNPM_STORE_MAX_MB:-2048}" ]; then
    rm -rf "$store" && echo "job-completed: pnpm store $store > ${PNPM_STORE_MAX_MB:-2048} MB, dihapus"
  fi
done
# ~/.npm dan ~/.cache dipakai self-installer pnpm/action-setup (npm install @pnpm/exe): simpan sampai 1 GB.
for c in "$HOME/.cache" "$HOME/.npm" /home/runner/_work/.npm-cache; do
  if [ -d "$c" ] && [ "$(du -sm "$c" | cut -f1)" -gt 1024 ]; then rm -rf "$c"; fi
done
cache="${ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE:-}"
if [ -n "$cache" ] && [ -d /home/runner/_work/_actions ]; then
  for d in /home/runner/_work/_actions/*/*/*; do
    sha="${d##*/}"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || continue
    rel="${d#/home/runner/_work/_actions/}"
    out="$cache/$(dirname "$rel" | tr / _)/$sha.tar.gz"
    [ -f "$out" ] && continue
    mkdir -p "${out%/*}" && tar -czf "$out.tmp" -C "${d%/*}" "$sha" && mv "$out.tmp" "$out"
  done
fi
echo "runner laptop setelah job: _work $(du -sh /home/runner/_work 2>/dev/null | cut -f1)"
exit 0
