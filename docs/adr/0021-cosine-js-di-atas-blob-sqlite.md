# 0021. Pencarian vektor cosine di JS atas blob SQLite, bukan sqlite-vec

- **Status:** Diterima. Terimplementasi di `packages/rag/src/vector/store.ts`. Menggantikan klaim `sqlite-vec` di rencana §2 dan §3.18.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** implementasi

## Konteks dan masalah

`sqlite-vec` adalah ekstensi native yang harus cocok dengan arsitektur dan libc image. Deploy berjalan di VPS arm64 dan laptop x64, dan `better-sqlite3` sendiri sudah memerlukan prebuild native. Korpus kecil (rencana: ribuan chunk; batas desain sekitar 10 ribu).

## Keputusan

Vektor disimpan sebagai `BLOB` Float32 di tabel `chunk_vectors` (kolom `raw` dan `vec`). Pencarian memuat vektor ke memori dan menghitung cosine secara brute-force di JS; vektor sudah ter-L2-normalisasi sehingga cosine menjadi dot product. Filter wilayah dan layanan sama dengan BM25. `sqlite-vec` bukan dependensi: `tryLoadSqliteVec` hanya mencoba memuatnya secara dinamis bila terpasang, dan tanpa itu perilaku tidak berubah.

## Alternatif yang dipertimbangkan

- `sqlite-vec` (`vec0`): pencarian lebih cepat untuk korpus besar, tetapi menambah ekstensi native yang harus dibangun atau diunduh per arsitektur.
- Vector DB terpisah: menambah service (ADR 0018).

## Konsekuensi

- Portabel di arm64 dan x64 tanpa ekstensi native tambahan.
- Biaya kueri linear terhadap jumlah chunk; pada skala puluhan ribu chunk ke atas keputusan ini perlu ditinjau ulang.
- Dokumen publik (README, rencana) tidak boleh mengklaim `sqlite-vec` sebagai komponen yang dipakai.
