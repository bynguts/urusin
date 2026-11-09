#!/usr/bin/env bash
# Pasang runner GitHub Actions self-hosted Urusin di agent-vm. HANYA dijalankan saat CI GitHub gagal karena
# kuota menit/billing, dan HANYA selama repo masih PRIVATE (lihat README.md bagian "Sebelum repo publik").
#
#   sudo deploy/ci-runner/install.sh --dry-run                 # cetak rencana, tidak mengubah apa pun
#   sudo deploy/ci-runner/install.sh < registration-token      # pasang (token lewat stdin, tidak pernah argumen)
#
# Token: REGISTRATION token sekali pakai (berlaku 1 jam), dibuat di luar box:
#   gh api -X POST repos/bynguts/urusin/actions/runners/registration-token --jq .token
# Hanya token itu yang dikirim ke box, hanya lewat stdin, dan tidak pernah disimpan: config.sh menukarnya
# dengan kredensial runner ini sendiri (0600, milik urusin-ci). TIDAK ADA PAT di box.
# Runner persisten (bukan ephemeral); kebersihan antar job lewat hook job-completed dan checkout clean.
#
# Yang dibuat (hanya milik Urusin CI; tidak ada yang lain disentuh):
#   user sistem urusin-ci (TANPA grup docker), /opt/urusin-ci, /etc/sudoers.d/urusin-ci (satu skrip),
#   /etc/systemd/system/urusin-ci-runner.service, builder buildx `urusin-ci` (docker-container, cache <= 1,5 GB).
# Yang TIDAK pernah dilakukan: sysctl, daemon.json, binfmt, iptables/ufw, prune global, apt install.
set -euo pipefail

RUNNER_VERSION="${RUNNER_VERSION:-2.338.2}"
RUNNER_SHA256="${RUNNER_SHA256:-670adb2f268fe21dcbb58b3db0e0aa9d5b3bddfe2c651481336e561ff86de945}"
CI_ROOT=/opt/urusin-ci
CI_USER=urusin-ci
UNIT=/etc/systemd/system/urusin-ci-runner.service
SUDOERS=/etc/sudoers.d/urusin-ci
DISK_MAX=88
REPO=bynguts/urusin
LABEL=urusin-self
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

die() { echo "install: $*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "+ $*"; else "$@"; fi; }

# --- Prasyarat (baca saja) ------------------------------------------------------------------------
[ "$(id -u)" = 0 ] || [ "$DRY" = 1 ] || die "jalankan dengan sudo"
[ "$(uname -m)" = aarch64 ] || die "runner ini untuk agent-vm aarch64 (uname -m = $(uname -m))"
for c in docker systemctl visudo; do command -v "$c" >/dev/null || die "butuh $c"; done
for c in git jq curl setpriv openssl; do command -v "$c" >/dev/null || die "butuh $c (tidak dipasang otomatis)"; done
docker buildx version >/dev/null 2>&1 || die "butuh plugin docker buildx"
pct="$(df --output=pcent / | tail -n1 | tr -dc '0-9')"
[ "$pct" -lt "$DISK_MAX" ] || die "disk ${pct}% >= ${DISK_MAX}%: tidak memasang runner"
[ -f "$DEPLOY/pendamping-seccomp.json" ] || die "deploy/pendamping-seccomp.json tidak ada"
if [ -e /proc/sys/fs/binfmt_misc/qemu-x86_64 ]; then
  echo "install: binfmt qemu-x86_64 ada: Release membangun linux/amd64 + linux/arm64"
else
  echo "install: PERINGATAN: binfmt qemu-x86_64 tidak ada: Release self-hosted hanya linux/arm64"
fi

REG_TOKEN=""
if [ "$DRY" = 0 ] && [ ! -f "$CI_ROOT/runner/.runner" ]; then
  IFS= read -r REG_TOKEN || true
  [ -n "$REG_TOKEN" ] || die "registration token kosong (kirim lewat stdin)"
fi

# --- User + direktori -----------------------------------------------------------------------------
if id "$CI_USER" >/dev/null 2>&1; then
  echo "install: user $CI_USER sudah ada"
else
  run useradd --system --home-dir "$CI_ROOT" --no-create-home --shell /usr/sbin/nologin "$CI_USER"
fi
if [ "$DRY" = 0 ] && id -nG "$CI_USER" | tr ' ' '\n' | grep -qx docker; then
  die "$CI_USER ada di grup docker (setara root): keluarkan dulu; runner memakai sudoers sempit ke ci-docker"
fi
run install -d -m 0755 -o root -g root "$CI_ROOT" "$CI_ROOT/bin"
run install -d -m 0700 -o root -g root "$CI_ROOT/etc" "$CI_ROOT/buildx"
run install -d -m 0750 -o "$CI_USER" -g "$CI_USER" "$CI_ROOT/runner"

# --- Skrip (root-owned; user runner hanya bisa menjalankan) ---------------------------------------
for f in ci-docker runner-prestart job-started job-completed; do
  run install -m 0755 -o root -g root "$HERE/$f" "$CI_ROOT/bin/$f"
done
run install -m 0644 -o root -g root "$HERE/buildkitd.toml" "$CI_ROOT/etc/buildkitd.toml"
run install -m 0644 -o root -g root "$DEPLOY/pendamping-seccomp.json" "$CI_ROOT/etc/pendamping-seccomp.json"
run rm -f "$CI_ROOT/bin/runner-start" "$CI_ROOT/etc/gh-admin-token" # sisa versi JIT (tidak ada token di box)

# --- Runner (versi + sha256 dipin) ----------------------------------------------------------------
tarball="actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz"
if [ "$DRY" = 1 ]; then
  echo "+ unduh $tarball, cek sha256 $RUNNER_SHA256, ekstrak ke $CI_ROOT/runner (milik $CI_USER)"
elif [ ! -x "$CI_ROOT/runner/run.sh" ]; then
  tmp="$(mktemp -d)"
  curl -sSfL --retry 3 -o "$tmp/$tarball" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${tarball}"
  echo "${RUNNER_SHA256}  $tmp/$tarball" | sha256sum -c - >/dev/null || { rm -rf "$tmp"; die "sha256 runner tidak cocok"; }
  tar -xzf "$tmp/$tarball" -C "$CI_ROOT/runner"
  chown -R "$CI_USER:$CI_USER" "$CI_ROOT/runner"
  rm -rf "$tmp"
fi
run chmod 0750 "$CI_ROOT/runner"
run install -d -m 0750 -o "$CI_USER" -g "$CI_USER" "$CI_ROOT/runner/_home"

# --- Pendaftaran sekali (persisten). Token lewat env ACTIONS_RUNNER_INPUT_TOKEN, bukan argv (tak terlihat di ps).
if [ -f "$CI_ROOT/runner/.runner" ]; then
  echo "install: runner sudah terdaftar ($(jq -r .agentName "$CI_ROOT/runner/.runner" 2>/dev/null)); tidak didaftarkan ulang"
elif [ "$DRY" = 1 ]; then
  echo "+ config.sh --unattended --url https://github.com/$REPO --name urusin-self-$(hostname -s) --labels $LABEL (token dari stdin)"
else
  # shellcheck disable=SC2016 # $0..$3 diekspansi oleh bash -c, bukan di sini
  ACTIONS_RUNNER_INPUT_TOKEN="$REG_TOKEN" HOME="$CI_ROOT/runner/_home" \
    setpriv --reuid="$CI_USER" --regid="$CI_USER" --init-groups bash -c \
    'umask 077 && cd "$0" && ./config.sh --unattended --url "https://github.com/$1" --name "$2" --labels "$3" --work _work --replace' \
    "$CI_ROOT/runner" "$REPO" "urusin-self-$(hostname -s)" "$LABEL"
  unset REG_TOKEN
  chmod 0600 "$CI_ROOT"/runner/.credentials* "$CI_ROOT/runner/.runner"
fi

# --- sudoers: SATU skrip, tanpa SETENV (env_reset membuang env pemanggil) -------------------------
sudo_line="$CI_USER ALL=(root) NOPASSWD: $CI_ROOT/bin/ci-docker"
if [ "$DRY" = 1 ]; then
  echo "+ $SUDOERS: Defaults:$CI_USER env_reset,!setenv / $sudo_line"
else
  tmp="$(mktemp)"
  printf 'Defaults:%s env_reset, !setenv\n%s\n' "$CI_USER" "$sudo_line" > "$tmp"
  visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "sudoers tidak valid"; }
  install -m 0440 -o root -g root "$tmp" "$SUDOERS"
  rm -f "$tmp"
fi

# --- Builder buildx khusus (cache dibatasi). Dibuat ulang agar buildkitd.toml terbaru berlaku. ----------
if [ "$DRY" = 0 ] && BUILDX_CONFIG="$CI_ROOT/buildx" docker buildx inspect urusin-ci >/dev/null 2>&1; then
  "$CI_ROOT/bin/ci-docker" builder-rm
fi
run "$CI_ROOT/bin/ci-docker" builder-init

# --- systemd --------------------------------------------------------------------------------------
run install -m 0644 -o root -g root "$HERE/urusin-ci-runner.service" "$UNIT"
run systemctl daemon-reload
run systemctl enable urusin-ci-runner.service
run systemctl restart urusin-ci-runner.service

cat <<EOF
install: selesai. Aktifkan di GitHub (repo variable, bukan secret):
  gh variable set URUSIN_RUNNER --repo bynguts/urusin --body urusin-self
Kembali ke runner GitHub: gh variable delete URUSIN_RUNNER --repo bynguts/urusin
Status: systemctl status urusin-ci-runner; journalctl -u urusin-ci-runner -f
SEBELUM REPO PUBLIK: sudo deploy/ci-runner/uninstall.sh dan hapus URUSIN_RUNNER (README.md).
EOF
