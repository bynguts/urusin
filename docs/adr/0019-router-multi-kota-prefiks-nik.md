# 0019. Router multi-kota berdasarkan kode kab/kota dari prefiks NIK

- **Status:** Diterima. Router dan registry data ada di `packages/registry`; adapter per kota belum.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** rencana D19 (§1.3, §10)

## Konteks dan masalah

Layanan adminduk dikelola per kabupaten atau kota. Hardcode per kota tidak skala, dan membiarkan LLM memilih URL membuka jalan bagi situs peniru dan halusinasi.

## Keputusan

`routeByNik` mengambil 4 digit pertama NIK sebagai `kode_kabkota`, mencarinya di registry data generik, lalu memilih adapter bila ada. Kode yang tidak terdaftar jatuh ke default `dipandu` dengan RAG. Hanya digit 1-4 yang diteruskan, NIK tidak disimpan, dan pesan error sengaja generik (tidak memuat masukan). Kirim asli hanya untuk entri yang tervalidasi; kota lain read-only atau dipandu.

## Alternatif yang dipertimbangkan

- Hardcode per kota di harness: tidak skala dan rawan regresi.
- LLM memilih URL atau portal: rawan situs peniru dan halusinasi, melanggar batas bahwa LLM tidak memutuskan origin.

## Konsekuensi

- Menambah kota berarti menambah entri data, adapter, dan fixture tanpa mengubah harness.
- Klaim dibatasi jujur: tidak ada kota yang diklaim "kirim asli" tanpa validasi.
- Ada uji properti: router tidak pernah melempar selain `RegistryError` dan pesan errornya tidak memuat masukan.
