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

### Abstain (hand-off) dan stopword

Setelah fusi, pipeline menghitung **cakupan** (0..1): bobot IDF kata kueri bermakna (ter-stem, tanpa
stopword, tanpa nama tempat, tanpa kata maksud umum seperti "cara/urus/bikin", dan token yang dijelaskan
glosarium dihitung tercakup bila hasil memuat istilah resminya) yang muncul pada 3 hasil teratas. Cakupan di bawah
`minCoverage` (default `DEFAULT_MIN_COVERAGE = 0.1`, `0` = mati) membuat `tanpaHasil = true`, `hasil = []` dan
`alasan`: `di_luar_cakupan` (tanpa hasil atau cakupan 0) atau `skor_rendah` (cocok sebagian). Ambang 0.3 awal dikalibrasi di
korpus sintetis `abstain.test.ts`; di korpus nyata ia menurunkan recall@3 5 poin, jadi default dikalibrasi ulang ke 0.1
(lihat "Korpus nyata dan gold set"). Cakupan dihitung pada top-3 hasil fusi, sehingga gerbang berlaku sama di mode `bm25` dan `hybrid` (diuji dengan embedder palsu). Ambang bisa ditimpa lewat env `RAG_ABSTAIN_MIN_COVERAGE`. Lantai cosine untuk leg vektor sengaja tidak dipakai: skor cosine tidak terkalibrasi antar model embedding. Stopword dipakai di
semua jalur pencarian (BM25 lama, leg asli, leg ter-stem, perluasan).

Leksikon layanan luar cakupan (`data/glossary/luar-cakupan.json`: SIM, SKCK, paspor, BPJS, DPT, NPWP) memaksa
`alasan: di_luar_cakupan` bila kueri menyebut salah satunya dan tak ada judul chunk yang memuat nama itu (kata umum
seperti "syarat perpanjang" bisa membuat cakupan leksikal 1.0 sendirian). STNK/BPKB tidak dimasukkan karena halaman
Samsat ada di korpus. Di gold tuning abstain recall naik dari 41.7% ke 83.3% (presisi 100%, recall@3 tidak berubah);
di held-out tetap 66.7% (tak ada istilah leksikon di soal luar cakupannya).

### Korpus nyata dan gold set

Bangun korpus dari sumber resmi di `data/sources.json` (butuh jaringan; sopan: robots.txt, >= 2 detik per host):

```
pnpm rag:ingest --sources ../../data/sources.json --db .cache/rag.db
pnpm rag:eval --gold ../../data/gold/tuning.json --pipelines ../../data/gold/pipelines.json
pnpm rag:eval --gold ../../data/gold/heldout.json --pipelines ../../data/gold/pipelines.json
```

Korpus (37 sumber, ~267 chunk): halaman standar pelayanan per layanan Disdukcapil Wonogiri, data dukung Si D'nOK
Semarang, katalog layanan Klampid Surabaya (adapter GraphQL, disanitasi), Cek Bansos, LAPOR!, regulasi adminduk
(hanya metadata dari peraturan.go.id), serta beberapa halaman Samsat/OSS/Ombudsman. Setiap chunk wajib punya
`sourceUrl` dan `verifiedAt` non-null (skema Zod + trigger DB aditif).

Gold set: `data/gold/tuning.json` (50 pertanyaan: 13 Surabaya, 12 luar cakupan) untuk penyetelan dan
`data/gold/heldout.json` (20 pertanyaan, 6 luar cakupan) yang TIDAK dipakai menyetel. `data/rag-gold.json` tetap contoh
sintetis. Pertanyaan luar cakupan (`luarCakupan: true`) tidak punya `relevan`; jawaban benar adalah abstain.

Keterbatasan korpus yang perlu diketahui sebelum menilai angka:

- Katalog Klampid hanya memuat nama dan deskripsi layanan (persyaratan per dokumen butuh login), jadi pertanyaan
  Surabaya hanya bisa diarahkan ke layanan yang tepat, bukan dijawab rinci.
- Id chunk halaman HTML berbasis urutan, sehingga bergeser bila halaman berubah. Gold yang rujukannya tidak cocok
  muncul di `tanpaChunkRelevan` pada laporan eval; id chunk Klampid stabil (`klampid-katalog#<kategori>-<slug>`).
- SKCK, SIM, BPJS, Cek DPT, dan IKD umum belum ada di korpus (sumber tak terjangkau atau tak terverifikasi);
  pertanyaan tentangnya diperlakukan sebagai luar cakupan.
- Tahap hybrid dan rerank butuh kunci embedding/LLM; tanpanya `rag:eval` hanya mengukur BM25.

### rag:verify

`pnpm rag:verify [--only id]` mengambil ulang tiap sumber yang pernah di-ingest dengan conditional GET
(ETag / Last-Modified, lalu hash teks ter-ekstrak), menghormati robots.txt, >= 2 detik per host, UA jujur.
Tidak berubah -> `verifiedAt` chunk diperbarui. Berubah -> sumber ditandai dan hasil pencarian mendapat
`peringatan: "sumber berubah sejak diverifikasi"` sampai di-ingest ulang. `sourceFreshness(db)` memberi umur
sumber tertua untuk halaman transparansi. Ingest menolak chunk tanpa `verifiedAt` (`requireVerified`); data registry
dan peristiwa tidak lewat jalur ini.

### Sumber dan lisensi

- Stemmer (`src/stem/stem.ts`): implementasi sendiri bergaya Nazief-Adriani; kamus akar
  (`src/stem/roots.ts`) dan stopword (`src/stem/stopwords.ts`) disusun sendiri oleh tim, lisensi MIT. Tidak
  ada kode atau kamus pihak ketiga yang disalin (kamus Sastrawi/Kateglo sengaja tidak dipakai karena lisensi data kamusnya belum kami verifikasi;
  kode Sastrawi sendiri MIT). Tambahkan akar di `roots.ts` bila ada istilah korpus
  yang belum ter-stem.
- Glosarium: istilah resmi diambil dari regulasi dan portal resmi yang tercatat di `data/sources.json`;
  `verifiedAt` bernilai `null` sampai dicek tangan pemilik data.
