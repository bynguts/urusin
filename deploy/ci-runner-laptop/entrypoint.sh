#!/usr/bin/env bash
# Menunggu pendaftaran (up.sh menjalankan config.sh lewat docker exec), lalu menjalankan listener.
# Restart kontainer (--restart unless-stopped, reboot laptop) memakai konfigurasi yang sudah tersimpan.
set -euo pipefail
cd /home/runner
until [ -f .runner ]; do sleep 2; done
exec ./run.sh
