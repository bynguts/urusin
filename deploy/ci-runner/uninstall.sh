#!/usr/bin/env bash
# Copot runner self-hosted Urusin sepenuhnya. WAJIB sebelum repo dibuat Public (lihat README.md): di repo
# publik, PR dari fork bisa menjalankan kode di runner self-hosted = di agent-vm.
#
#   sudo deploy/ci-runner/uninstall.sh < remove-token   # copot (aman diulang)
#   sudo deploy/ci-runner/uninstall.sh --dry-run        # cetak rencana
#
# remove-token sekali pakai dibuat di luar box, hanya lewat stdin:
#   gh api -X POST repos/bynguts/urusin/actions/runners/remove-token --jq .token
# Tanpa token, pendaftaran di GitHub dihapus manual: gh api -X DELETE repos/bynguts/urusin/actions/runners/<id>
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

# 2. Cabut pendaftaran runner di GitHub (config.sh remove) dengan remove-token dari stdin; token lewat env.
if [ -f "$CI_ROOT/runner/.runner" ]; then
  RM_TOKEN=""
  [ "$DRY" = 1 ] || { IFS= read -r RM_TOKEN || true; }
  if [ "$DRY" = 1 ]; then
    echo "+ config.sh remove (remove-token dari stdin)"
  elif [ -n "$RM_TOKEN" ]; then
    # shellcheck disable=SC2016 # $0 diekspansi oleh bash -c
    ACTIONS_RUNNER_INPUT_TOKEN="$RM_TOKEN" HOME="$CI_ROOT/runner/_home" \
      setpriv --reuid="$CI_USER" --regid="$CI_USER" --init-groups bash -c 'cd "$0" && ./config.sh remove' "$CI_ROOT/runner" ||
      echo "uninstall: PERINGATAN: config.sh remove gagal; hapus manual: gh api repos/$REPO/actions/runners (label $LABEL)"
    unset RM_TOKEN
  else
    echo "uninstall: PERINGATAN: tanpa remove-token; hapus manual: gh api repos/$REPO/actions/runners (label $LABEL)"
  fi
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
  (Tidak ada PAT di box: runner hanya memegang kredensial runner-nya sendiri, ikut terhapus bersama /opt/urusin-ci.)
EOF
