#!/usr/bin/env bash
# Retensi image Urusin di host: hapus image urusin-* lama dengan `docker image rm <repo>@<digest>`
# yang ditargetkan. TIDAK PERNAH `docker image/system prune` (VPS dipakai bersama layanan lain) dan
# tidak pernah `-f` (image yang dipakai kontainer ditolak Docker, bukan dipaksa).
#
#   deploy/image-retention.sh            # rencana saja (dry-run)
#   deploy/image-retention.sh --apply    # benar-benar menghapus
#
# Dipertahankan:
#   - semua digest di .env.images (warna aktif + warna sebelumnya untuk rollback, FIXTURES_IMAGE);
#   - semua digest urusin-* di .env (PENDAMPING_IMAGE, FIXTURES_IMAGE bila di sana);
#   - image yang dipakai kontainer mana pun (berjalan atau berhenti) menurut `docker ps -a`;
#   - digest di .env.images.keep (satu per baris, mis. image rc1; ditulis manual oleh lead);
#   - KEEP_LAST (default 3) image terakhir per repo dari .env.images.history.
# Hanya repo yang cocok ^ghcr.io/bynguts/urusin-[a-z0-9-]+$ yang disentuh.
set -euo pipefail

cd "$(dirname "$0")"

KEEP_LAST="${KEEP_LAST:-3}"
REPO_RE='^ghcr\.io/bynguts/urusin-[a-z0-9-]+$'
apply=0
case "${1:-}" in
  --apply) apply=1 ;;
  "") ;;
  *) echo "pemakaian: $0 [--apply]" >&2; exit 2 ;;
esac
[[ "$KEEP_LAST" =~ ^[0-9]+$ ]] || { echo "image-retention: KEEP_LAST harus angka" >&2; exit 2; }

# Referensi repo@sha256:... yang dipertahankan.
keep="$(
  {
    grep -hoE 'ghcr\.io/bynguts/urusin-[a-z0-9-]+@sha256:[0-9a-f]{64}' .env.images .env.images.keep .env 2>/dev/null || true
    # Image kontainer (compose memakai repo@digest): yang sedang dipakai tidak pernah masuk rencana hapus.
    docker ps -a --no-trunc --format '{{.Image}}' | grep -oE '^ghcr\.io/bynguts/urusin-[a-z0-9-]+@sha256:[0-9a-f]{64}$' || true
    # Riwayat: kolom 4 = image; ambil KEEP_LAST terakhir yang unik per repo.
    if [ -f .env.images.history ]; then
      cut -f4 .env.images.history | grep -E '@sha256:[0-9a-f]{64}$' | tac | awk -F@ -v n="$KEEP_LAST" '!seen[$0]++ { if (c[$1]++ < n) print }'
    fi
  } | sort -u
)"

removed=0
kept=0
while IFS=$'\t' read -r repo digest; do
  [[ "$repo" =~ $REPO_RE ]] || continue
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || continue # <none> / tanpa digest: tidak disentuh
  ref="${repo}@${digest}"
  if grep -qxF "$ref" <<<"$keep"; then
    kept=$((kept + 1))
    echo "image-retention: simpan ${ref}"
    continue
  fi
  if [ "$apply" = 1 ]; then
    if docker image rm "$ref" >/dev/null; then
      removed=$((removed + 1))
      echo "image-retention: hapus ${ref}"
    else
      echo "image-retention: peringatan: gagal menghapus ${ref} (dipakai kontainer?)" >&2
    fi
  else
    removed=$((removed + 1))
    echo "image-retention: (dry-run) akan menghapus ${ref}"
  fi
done < <(docker image ls --digests --format '{{.Repository}}\t{{.Digest}}' | sort -u)

echo "image-retention: disimpan ${kept}, $([ "$apply" = 1 ] && echo dihapus || echo 'akan dihapus') ${removed}"
