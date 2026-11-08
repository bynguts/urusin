# 0022. Centering dan whitening vektor hanya aktif bila terbukti lewat evaluasi

- **Status:** Diterima. Terimplementasi di `packages/rag/src/vector/transform.ts` dan `rag:eval`.
- **Dicatat:** 2026-11-08
- **Sumber keputusan:** implementasi

## Konteks dan masalah

Vektor embedding cenderung anisotropik sehingga skor cosine tertekan. Namun model embedding kontrastif modern sering tidak diuntungkan oleh whitening, jadi manfaatnya tidak boleh diasumsikan.

## Keputusan

Ada tiga mode pasca-proses, semuanya diakhiri normalisasi L2: `none`, `center` (kurangi rata-rata korpus), dan `whiten` (eigendekomposisi kovarians dengan shrinkage, top-`k` komponen). Mode **dipilih dari hasil `pnpm rag:eval`** (recall, MRR, nDCG atas gold set) dan baru diberikan ke ingest lewat `--vector-mode`. Tanpa flag itu, ingest memakai `none`. Parameter transform disimpan di tabel `vector_transform` dan jalur kueri memakai parameter aktif yang sama.

## Alternatif yang dipertimbangkan

- Selalu whitening: tidak terbukti membantu untuk semua model.
- Tidak pernah transform: melewatkan perbaikan yang mungkin nyata pada model tertentu.

## Konsekuensi

- Pemilihan mode bisa dipertanggungjawabkan dengan angka, bukan intuisi.
- Gold set saat ini hanya contoh sintetis (5 pertanyaan); angka eval baru bermakna setelah gold set tim menggantikannya.
