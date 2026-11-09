#!/usr/bin/env bash
# Copot runner self-hosted Urusin sepenuhnya. WAJIB sebelum repo dibuat Public (lihat README.md): di repo
# publik, PR dari fork bisa menjalankan kode di runner self-hosted = di agent-vm.
#
#   sudo deploy/ci-runner/uninstall.sh            # copot (aman diulang)
#   sudo deploy/ci-runner/uninstall.sh --dry-run  # cetak rencana
#
# Menghapus HANYA milik Urusin CI: unit, sudoers, builder buildx `urusin-ci`, kontainer urusin-ci-*,
# user urusin-ci, /opt/urusin-ci, dan pendaftaran runner berlabel urusin-self di GitHub.
# Tidak menyentuh image/kontainer/volume lain, cache build global, daemon.json, atau sysctl.
set -euo pipefail
CI_ROOT=/opt/urusin-ci
CI_USER=urusin-ci
UNIT=/etc/systemd/system/urusin-ci-runner.service
SUDOERS=/etc/sudoers.d/urusin-ci
REPO=bynguts/urusin
LABEL=urusin-self
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
run() { if [ "$DRY" = 1 ]; then echo "+ $*"; else "$@"; fi; }
[ "$(id -u)" = 0 ] || [ "$DRY" = 1 ] || { echo "uninstall: jalankan dengan sudo" >&2; exit 1; }

# 1. Hentikan runner (job berjalan dibatalkan) dan cabut unit.
if [ -f "$UNIT" ]; then
  run systemctl disable --now urusin-ci-runner.service || true
  run rm -f "$UNIT"
  run systemctl daemon-reload
fi

# 2. Hapus pendaftaran runner berlabel urusin-self di GitHub (runner JIT idle tetap terdaftar sampai dihapus).
tok="$CI_ROOT/etc/gh-admin-token"
if [ -s "$tok" ]; then
  api() {
    curl -sS --fail-with-body --max-time 30 -X "$1" \
      -H @<(printf 'Authorization: Bearer %s\n' "$(<"$tok")") -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO/actions/runners$2"
  }
  ids="$(api GET '?per_page=100' | jq -r --arg l "$LABEL" '.runners[] | select(any(.labels[]; .name == $l)) | .id')" || ids=""
  for id in $ids; do
    if [ "$DRY" = 1 ]; then echo "+ DELETE runner $id"; else api DELETE "/$id" >/dev/null && echo "uninstall: runner $id dihapus dari GitHub"; fi
  done
else
  echo "uninstall: PERINGATAN: token admin tidak ada; cek manual: gh api repos/$REPO/actions/runners"
fi

# 3. Builder buildx urusin-ci (beserta cache-nya) dan kontainer sisa urusin-ci-*.
if [ -x "$CI_ROOT/bin/ci-docker" ]; then run "$CI_ROOT/bin/ci-docker" teardown; fi

# 4. sudoers, user, direktori.
run rm -f "$SUDOERS"
if id "$CI_USER" >/dev/null 2>&1; then
  run pkill -u "$CI_USER" || true
  run userdel "$CI_USER"
fi
run rm -rf "$CI_ROOT"

cat <<EOF
uninstall: selesai. Lanjutkan di GitHub:
  gh variable delete URUSIN_RUNNER --repo $REPO      # job kembali ke ubuntu-latest
  gh api repos/$REPO/actions/runners --jq '.total_count'   # harus 0
  Cabut fine-grained PAT admin di github.com/settings/personal-access-tokens.
EOF
