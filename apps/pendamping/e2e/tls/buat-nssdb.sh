#!/bin/sh
# Bangun ulang basis data NSS uji e2e (apps/pendamping/e2e/tls/nssdb) dari root + intermediate uji (pki.ts).
# Kunci diturunkan dari benih publik, jadi hanya sertifikat dan basis data yang dikomit. Jalankan dari root repo:
#   docker run --rm -v "$PWD:/repo" -w /repo node:26-slim sh apps/pendamping/e2e/tls/buat-nssdb.sh
# Root uji dipercaya (C,,) HANYA di basis data uji ini (HOME Chromium e2e); intermediate "ada" tanpa trust (,,),
# sama seperti bundel produksi. Intermediate "hilang" sengaja tidak dimuat.
set -eu
apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends libnss3-tools >/dev/null
d=apps/pendamping/e2e/tls
node --input-type=module -e "
const { writeFileSync } = await import('node:fs');
const p = await import('./$d/pki.ts');
const mulai = new Date('2026-11-01T00:00:00Z');
const akhir = new Date('2036-11-01T00:00:00Z');
writeFileSync('$d/root-uji.crt', p.terbitkan({ subjek: p.ROOT_UJI, jenis: 'root', mulai, akhir }).toString());
writeFileSync('$d/antara-ada.crt',
  p.terbitkan({ subjek: p.ANTARA_ADA, penerbit: p.ROOT_UJI, jenis: 'antara', mulai, akhir }).toString());
"
rm -rf "$d/nssdb" && mkdir "$d/nssdb"
certutil -N -d "sql:$d/nssdb" --empty-password
certutil -A -d "sql:$d/nssdb" -t "C,," -n urusin-uji-root -i "$d/root-uji.crt"
certutil -A -d "sql:$d/nssdb" -t ",," -n urusin-uji-antara-ada -i "$d/antara-ada.crt"
certutil -L -d "sql:$d/nssdb"
