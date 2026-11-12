#!/bin/bash
# Healthcheck sidecar embedding: GET /health lewat /dev/tcp bash. Image sengaja tanpa curl (curl menyeret
# 15 pustaka); dipakai HEALTHCHECK image, healthcheck compose, dan smoke Release/ci-docker.
set -eu
exec 3<>"/dev/tcp/127.0.0.1/${LLAMA_ARG_PORT:-8080}"
printf 'GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' >&3
IFS= read -r -t 4 baris <&3
case "$baris" in
  "HTTP/1."?" 200"*) exit 0 ;;
  *) exit 1 ;;
esac
