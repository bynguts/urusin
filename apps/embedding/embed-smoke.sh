#!/bin/sh
# Uji semantik sidecar embedding di DALAM image (tanpa python/jq; dipakai smoke Release dan ci-docker).
# Kueri "akta kelahiran" (awalan profil gemma, sama dengan klien @urusin/embedding) harus lebih dekat ke label
# "Pencatatan Kelahiran" daripada "Pembayaran Pajak Kendaraan Bermotor", dan vektor harus ternormalisasi.
set -eu
URL="${EMBED_SMOKE_URL:-http://127.0.0.1:8080}"
BODY="{\"input\":[\"task: search result | query: mau bikin akta kelahiran anak\",\"title: none | text: Pencatatan Kelahiran\",\"title: none | text: Pembayaran Pajak Kendaraan Bermotor\"]}"
OUT="$(curl -fsS -m 120 -H 'content-type: application/json' -d "$BODY" "$URL/v1/embeddings")"
printf '%s' "$OUT" | tr -d ' \n' | awk '
  {
    s = $0; n = 0
    while (match(s, /"embedding":\[[^]]*\]/)) {
      arr = substr(s, RSTART + 13, RLENGTH - 14); s = substr(s, RSTART + RLENGTH)
      m = split(arr, v, ","); dim[n] = m
      for (i = 1; i <= m; i++) e[n, i] = v[i] + 0
      if (match(s, /^[^{]*"index":[0-9]+/)) { t = substr(s, RSTART, RLENGTH); sub(/.*"index":/, "", t); idx[n] = t + 0 } else idx[n] = n
      n++
    }
  }
  END {
    if (n != 3 || dim[0] < 64 || dim[0] != dim[1] || dim[0] != dim[2]) { print "embed-smoke: balasan tidak sah (n=" n ")"; exit 1 }
    for (k = 0; k < 3; k++) pos[idx[k]] = k
    q = pos[0]; a = pos[1]; b = pos[2]
    for (i = 1; i <= dim[0]; i++) { qa += e[q, i] * e[a, i]; qb += e[q, i] * e[b, i]; qq += e[q, i] * e[q, i] }
    printf "embed-smoke: dim=%d |q|=%.3f kelahiran=%.3f pajak=%.3f\n", dim[0], sqrt(qq), qa, qb
    if (sqrt(qq) < 0.98 || sqrt(qq) > 1.02 || qa <= qb + 0.05) { print "embed-smoke: GAGAL"; exit 1 }
    print "embedding ok"
  }'
