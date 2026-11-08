# @urusin/rag

Basis pengetahuan RAG hibrida: FTS5 BM25 + (opsional) vektor, digabung dengan RRF, selalu dengan kutipan sumber.
Tanpa embedding, semuanya tetap BM25 saja.

## Transformasi vektor (center / whiten)

Vektor embedding cenderung anisotropik: semuanya menumpuk di satu kerucut sempit sehingga skor cosine
tertekan dan sulit dibedakan. Ada tiga mode pasca-proses (`src/vector/transform.ts`), semua diakhiri normalisasi L2:

| Mode     | Operasi                                                                             | Dimensi keluaran |
| -------- | ----------------------------------------------------------------------------------- | ---------------- |
| `none`   | tidak ada (hanya normalisasi)                                                       | `d`              |
| `center` | kurangi rata-rata korpus `mu`                                                       | `d`              |
| `whiten` | `x' = (x - mu) W`, `W = U L^-1/2` dari eigendekomposisi kovarians, top-`k` komponen | `k`              |

Catatan teknis whitening:

- Kovarians diestimasi dengan shrinkage ke identitas berskala (`shrinkage: 'auto'` = Ledoit-Wolf, atau angka 0..1),
  sehingga aman saat `n < d` (korpus kecil, `d` = 1536/3072). Eigendekomposisi memakai SVD terpangkas acak
  (deterministik) tanpa membentuk matriks `d x d`.
- `k` di-clamp ke `min(n - 1, d)` dan komponen dengan eigen terlalu kecil dibuang.
- Parameter (`mode, dim, k, mean, W, fittedOn, shrinkage, version`) disimpan di tabel `vector_transform`
  (satu baris aktif, `version` naik tiap fit). Vektor mentah di `chunk_vectors.raw`, hasil transform di `chunk_vectors.vec`.
- Ingest melakukan fit setelah semua chunk di-embed; jalur kueri memakai parameter aktif yang sama.

**Mode aktif tidak boleh diasumsikan.** Model embedding kontrastif modern sering tidak mendapat manfaat dari
whitening. Mode dipilih dari hasil `pnpm rag:eval`, lalu diberikan ke ingest:

```sh
pnpm rag:eval --write                        # tulis docs/rag-eval.md (mode A-D: BM25, mentah, center, whiten k=64/128/256)
pnpm rag:ingest --vector-mode center         # atau: --vector-mode whiten --vector-k 128
```

Tanpa `--vector-mode`, ingest memakai `none`. Tanpa env LLM lengkap + `LLM_EMBED_MODEL` + probe `embeddings`
yang lolos, ingest dan eval berjalan BM25 saja.

## Evaluasi (`rag:eval`)

Membaca gold set `data/rag-gold.json`: larik `{ id, pertanyaan, kodeWilayah?, relevan: [id chunk atau url sumber], catatan? }`.
File yang ada saat ini hanya **contoh sintetis** (5 pertanyaan) untuk memperlihatkan skema; ganti dengan gold set tim
(target recall@5 >= 90% pada 50 pertanyaan). Metrik: recall@1/3/5 (porsi referensi gold yang tercakup),
MRR@10, nDCG@10 (relevansi biner). Opsi: `--gold`, `--db`, `--out`, `--write`.
