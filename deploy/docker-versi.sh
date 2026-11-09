# shellcheck shell=bash
# Dipakai deploy.sh dan pendamping-up.sh (di-source). compose.prod.yml memberi jaringan pendamping
# `com.docker.network.bridge.gateway_mode_ipv4: isolated`; Docker Engine < 28 mengabaikan opsi itu tanpa
# galat, sehingga gateway bridge tetap merutekan keluar dan isolasi B1 hilang diam-diam. Tolak sejak awal.
DOCKER_VERSI_MIN=28
DOCKER_VERSI_PESAN=""

# 0 bila versi server Docker >= DOCKER_VERSI_MIN; selain itu 1 dan DOCKER_VERSI_PESAN berisi alasannya.
pastikan_docker_28() {
  local v major
  v="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  major="${v%%.*}"
  case "$major" in
    '' | *[!0-9]*)
      DOCKER_VERSI_PESAN="versi Docker Engine (server) tidak terbaca: '${v}'; butuh >= ${DOCKER_VERSI_MIN}"
      return 1 ;;
  esac
  if [ "$major" -lt "$DOCKER_VERSI_MIN" ]; then
    DOCKER_VERSI_PESAN="Docker Engine ${v} < ${DOCKER_VERSI_MIN}: gateway_mode_ipv4 diabaikan, isolasi pendamping tidak berlaku"
    return 1
  fi
  return 0
}
