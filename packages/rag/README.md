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

### Pipeline yang dapat dipasang

`rag:eval` menerima `--pipelines berkas.json`: larik `{ "name": "...", "config": RetrievalPipeline }` dengan
`RetrievalPipeline = { bm25?: { stemmed? }, expand?, vector?: { transform }, rerank? }`. Tiap pipeline mendapat tabel
mode sendiri (tanpa `vector`: ablasi penuh A-D; dengan `vector.transform`: A + satu baris vektor). Tahap yang dinyalakan
tetapi tidak punya implementasi (`PipelineStages` pada `runEval`) menjadi no-op dan dicatat di laporan, sehingga
tahap stemming, perluasan kueri, header chunk kontekstual, dan rerank dapat ditambahkan tanpa mengubah eval.

## Pipeline retrieval

`cari_pengetahuan` memakai pipeline berikut. Tiap tahap bisa dimatikan lewat `RetrievalPipeline` dan
turun sendiri bila komponennya tidak ada (tanpa vektor, tanpa reranker, tanpa LLM).

```ts
// dimiliki src/eval/run.ts, dipakai bersama rag:eval
type RetrievalPipeline = {
  bm25?: { stemmed?: boolean }; // true: tambah leg BM25 atas kolom ter-stem
  expand?: boolean; // perluasan glosarium adminduk
  vector?: { transform: FitOptions }; // dipasang saat ingest; di kueri leg aktif bila ada `vectorIds`
  rerank?: boolean; // top-N (default 20) -> top-k
};
```

Opsi runtime ada di `RetrievalDeps`: `expandWeight` (0.4), `rerankTopN` (20), `useVector`, `rewrite`.
Tahap kueri juga tersedia sebagai hook eval lewat `createQueryStages()` (`src/eval/query-stages.ts`);
`pnpm rag:eval --pipelines berkas.json` menjalankannya (rerank nyata hanya bila env LLM lengkap).

Bawaan (`DEFAULT_PIPELINE`): BM25 teks asli + BM25 ter-stem + perluasan glosarium + vektor bila ada +
rerank bila disuntikkan.

| Tahap                  | Cara kerja                                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stem BM25              | better-sqlite3 tidak bisa mendaftarkan tokenizer FTS5 dari JS, jadi teks di-stem di JS saat ingest ke tabel `chunks_stem_fts`; kueri di-stem dengan fungsi yang sama. Kolom asli `chunks_fts` tetap untuk kecocokan persis (KTP-el, NIK, SKPWNI, F1.06). |
| Ekspansi               | `data/glossary/adminduk.json` memetakan istilah awam ke istilah resmi (tiap entri wajib `sourceRef`). Deterministik; skor leg perluasan dikalikan bobot rendah (0.4) sehingga kata asli tetap menang.                                                    |
| Tulis ulang LLM (opsi) | `expand: true` + `rewrite: createLlmRewriter(jsonCall)`. Kueri berisi PII atau placeholder vault tidak pernah dikirim (guard dari `@urusin/core`); keluaran disanitasi; galat/timeout -> dilewati.                                                       |
| Header konteks         | Saat ingest, `buildChunkContextHeader` membuat `judul › bagian › instansi › wilayah › layanan` yang hanya diindeks (kolom `ctx`), tidak ditampilkan. `sourceRef` tidak berubah.                                                                          |
| Chunking               | Dipecah per heading, lalu per blok syarat / prosedur / biaya / waktu / dasar hukum, baru ukuran. Daftar dan tabel dijaga utuh.                                                                                                                           |
| Rerank                 | Top-N hasil fusi -> top-k. (a) `endpoint` rerank bila probe melaporkan `caps.rerank` (bidang opsional); (b) LLM listwise dengan JSON ketat (hanya penanda dokumen), timeout dan anggaran panggilan; (c) galat apa pun -> urutan fusi.                    |

Penggabungan: leg teks dijumlah berdasarkan skor BM25 ternormalisasi berbobot, lalu digabung dengan leg
vektor memakai RRF. Setiap hasil tetap membawa `kutipan` (sourceRef) dan `verifiedAt` aslinya.

```ts
// Sinkron, tanpa LLM: stem + ekspansi + vektor bila ada
cariPengetahuanTool.execute(db, { query: 'bikin ktp hilang gimana' });

// Penuh: tambah rerank (dan tulis ulang) lewat fungsi yang disuntikkan
await cariPengetahuanTool.executeAsync(
  db,
  { query: 'ngurus akta anak' },
  { rerank: { json: jsonCall, timeoutMs: 4000, budget: createRerankBudget(100) } },
);
```

`jsonCall` adalah `JsonCall` (lihat `src/llm-stage.ts`); bangun dari `generateStructured` di `@urusin/llm`
(di tes: `FakeProvider`). Paket ini tidak mengimpor `@urusin/llm` saat runtime.

### Debug dan latensi

Output berisi `debug`: konfigurasi efektif, `timingsMs` per tahap (`expand`, `bm25`, `fuse`, `rerank`,
`total`), jumlah kandidat, id entri glosarium yang cocok, serta status rerank/tulis ulang
(`off | endpoint | llm | fallback | skipped`). Tidak memuat teks kueri atau PII.

### Sumber dan lisensi

- Stemmer (`src/stem/stem.ts`): implementasi sendiri bergaya Nazief-Adriani; kamus akar
  (`src/stem/roots.ts`) dan stopword (`src/stem/stopwords.ts`) disusun sendiri oleh tim, lisensi MIT. Tidak
  ada kode atau kamus pihak ketiga yang disalin (kamus Sastrawi/Kateglo sengaja tidak dipakai karena lisensi data kamusnya belum kami verifikasi;
  kode Sastrawi sendiri MIT). Tambahkan akar di `roots.ts` bila ada istilah korpus
  yang belum ter-stem.
- Glosarium: istilah resmi diambil dari regulasi dan portal resmi yang tercatat di `data/sources.json`;
  `verifiedAt` bernilai `null` sampai dicek tangan pemilik data.
