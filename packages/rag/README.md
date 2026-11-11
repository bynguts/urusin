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

Tanpa `--vector-mode`, ingest memakai `none` (hasil eval penyedia nyata di bawah: center dan whitening tidak menang di korpus ini).
Tanpa konfigurasi embedding lengkap (`LLM_EMBED_*`), ingest dan eval berjalan BM25 saja (fallback otomatis).

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

Leksikon layanan luar cakupan (`data/glossary/luar-cakupan.json`: SIM, SKCK, paspor, BPJS, DPT, NPWP, IKD) memaksa
`alasan: di_luar_cakupan` bila kueri menyebut salah satunya dan tak ada judul chunk yang memuat nama itu (kata umum
seperti "syarat perpanjang" bisa membuat cakupan leksikal 1.0 sendirian). STNK/BPKB tidak dimasukkan karena halaman
Samsat ada di korpus. Di gold tuning abstain recall naik dari 41.7% ke 83.3% (presisi 100%, recall@3 tidak berubah);
di held-out tetap 66.7% (tak ada istilah leksikon di soal luar cakupannya).

### Hand-off ke kanal resmi

Bila `tanpaHasil`, output tool dapat memuat `kanal` (layanan luar cakupan yang disebut kueri: instansi, deskripsi, dan
tautan + `verifiedAt` HANYA bila terverifikasi; sumber `data/kanal-resmi.json`, `pnpm --filter @urusin/rag rag:kanal`) dan
`kontak` (situs Disdukcapil kab/kota dari `kodeKabKota`, hanya yang `terverifikasi`; sumber
`data/wilayah/kontak-dukcapil.json`, `pnpm --filter @urusin/rag rag:kontak`). Pemeriksa hanya GET baca-saja, menghormati
robots.txt, maks 1 permintaan per detik; telepon dan alamat tidak pernah dikarang (alamat hanya bila tertulis di halaman
resmi yang sama, lalu dibersihkan dari nomor telepon dan teks non-alamat).

### Korpus nyata dan gold set

Bangun korpus dari sumber resmi di `data/sources.json` (butuh jaringan; sopan: robots.txt, >= 2 detik per host):

```
pnpm rag:ingest --sources ../../data/sources.json --db .cache/rag.db
pnpm rag:eval --gold ../../data/gold/tuning.json --pipelines ../../data/gold/pipelines.json
pnpm rag:eval --gold ../../data/gold/heldout.json --pipelines ../../data/gold/pipelines.json
pnpm rag:eval --gold ../../data/gold/nasional.json --pipelines ../../data/gold/pipelines.json
```

Korpus (45 sumber, ~310 chunk): halaman standar pelayanan per layanan Disdukcapil Wonogiri, data dukung Si D'nOK
Semarang, katalog layanan Klampid Surabaya (adapter GraphQL, disanitasi), Cek Bansos, LAPOR!, regulasi adminduk
(metadata dari peraturan.go.id), serta beberapa halaman Samsat/OSS/Ombudsman. Setiap chunk wajib punya
`sourceUrl` dan `verifiedAt` non-null (skema Zod + trigger DB aditif).

Teks pasal regulasi nasional (UU 23/2006 Ps 34, 93; UU 24/2013 Ps 27, 32, 44, 79A, 94, 95B; Perpres 96/2018 Ps 10-12,
14, 17, 21, 22, 25, 33, 34; Permendagri 108/2019 Ps 18, 24, 28-31, 43; Permendagri 109/2019 Ps 4-5 (kode formulir F-1.01
sampai F-2.04); Permendagri 7/2026 Ps 4, 6, 24-26, 34; Perpol 1/2026 tentang SKCK Ps 2-5, 10, 12-14) masuk lewat
adapter `pasal`:
sumber ber-`jenis: pdf` menunjuk PDF resmi di peraturan.go.id, ingest mengambil PDF itu (robots, jeda sopan) dan
mencatat hash-nya untuk `rag:verify`, sedangkan teks chunk diambil dari kutipan verbatim di `data/regulasi/pasal.json`
(tanpa dependensi parser PDF). Satu chunk per pasal, id `<sumber>#pasal-27a`, judul `<judul sumber> - Pasal 27A`,
`kodeWilayah` null. Bahasa hukumnya umum, jadi dua penyesuaian (`PASAL_PRIOR` = 0.5 di `search.ts`): bila kode wilayah
warga diketahui, skor BM25 chunk pasal dikali 0.5 agar chunk daerah didahulukan; dan cakupan abstain yang berasal dari
chunk pasal dikali 0.5 agar satu kata umum ("hari", "kartu") tidak meloloskan kueri luar cakupan.

Gold set: `data/gold/tuning.json` (50 pertanyaan: 13 Surabaya, 12 luar cakupan) untuk penyetelan dan
`data/gold/heldout.json` (20 pertanyaan, 6 luar cakupan) yang TIDAK dipakai menyetel. `data/rag-gold.json` tetap contoh
sintetis. Pertanyaan luar cakupan (`luarCakupan: true`) tidak punya `relevan`; jawaban benar adalah abstain.
`data/gold/nasional.json` (28 pertanyaan) menguji teks pasal: 24 pertanyaan tanpa wilayah yang jawabannya pasal
nasional, plus 4 penjaga wilayah (Surabaya, Wonogiri) yang jawabannya chunk daerah dan tidak boleh dikalahkan pasal.

Keterbatasan korpus yang perlu diketahui sebelum menilai angka:

- Katalog Klampid hanya memuat nama dan deskripsi layanan (persyaratan per dokumen butuh login), jadi pertanyaan
  Surabaya hanya bisa diarahkan ke layanan yang tepat, bukan dijawab rinci.
- Id chunk halaman HTML berbasis urutan, sehingga bergeser bila halaman berubah. Gold yang rujukannya tidak cocok
  muncul di `tanpaChunkRelevan` pada laporan eval; id chunk Klampid stabil (`klampid-katalog#<kategori>-<slug>`).
- SIM, BPJS, Cek DPT, dan IKD umum belum ada di korpus (sumber tak terjangkau atau tak terverifikasi);
  pertanyaan tentangnya diperlakukan sebagai luar cakupan.
- Tahap hybrid dan rerank butuh kunci embedding/LLM; tanpanya `rag:eval` hanya mengukur BM25.

### Penyedia embedding dan rerank

Konfigurasi terpisah dari LLM agen (lihat `.env.example`): `LLM_EMBED_BASE_URL` (bawaan `LLM_BASE_URL`),
`LLM_EMBED_API_KEY`, `LLM_EMBED_MODEL`, `LLM_EMBED_TASK_QUERY` / `LLM_EMBED_TASK_PASSAGE` (field `task` Jina) dan
`RERANK_BASE_URL` / `RERANK_API_KEY` / `RERANK_MODEL` (`POST /rerank`). `LLM_API_KEY` tidak pernah dikirim ke base URL
embedding yang berbeda. Kueri dan dokumen diredaksi PII (NIK, HP, email -> `[DATA]`) sebelum SETIAP panggilan
embedding dan rerank. Vektor dokumen di-cache per (model, task, hash teks) (`--cache` pada `matrix-cli`). Tanpa
konfigurasi atau bila panggilan gagal, pipeline jatuh ke BM25 + stem + glosarium. Tes dan CI tidak pernah
memanggil penyedia (fetch palsu).

Reranker menerima judul sumber + teks chunk (potongan pendek seperti "Biaya: tidak ada" tak bermakna tanpa nama
layanannya; tanpa judul reranker justru menurunkan hasil hybrid). `minRerankScore` (env
`RAG_ABSTAIN_MIN_RERANK_SCORE`) menjadi gerbang abstain tambahan bila endpoint rerank dipakai.

Evaluasi: `pnpm --filter @urusin/rag exec node dist/eval/matrix-cli.js --gold ../../data/gold/tuning.json --embed
"jina-embeddings-v3:retrieval.query:retrieval.passage" --rerank "jina-reranker-v3" --combo "jina-embeddings-v3:retrieval.query:retrieval.passage"`
(kredensial dari env; jangan dicetak atau di-commit).

### Hasil evaluasi penyedia nyata (Jina, 2026-11-08)

Seleksi dua tahap dengan aturan tetap (agar tidak menyetel belasan konfigurasi pada 50 pertanyaan): hybrid menggantikan
BM25 hanya bila menang >= 2 pertanyaan hits@3 di tuning DAN tidak kalah di held-out; seri jatuh ke pilihan yang lebih
sederhana/murah (BM25 atau tanpa transformasi). Angka dalam hit = pertanyaan dalam cakupan yang punya chunk relevan di
top-3 (tuning n=38, held-out n=14). Baseline BM25 + stem + glosarium: tuning 28/38 (73.7%), MRR 0.685; held-out 11/14 (78.6%),
MRR 0.700. Latensi = satu panggilan per kueri (p50 / p95); harga per token tidak dimasukkan (env `*_PRICE_PER_MTOK`
tersedia untuk meter biaya, nilai Jina tak diverifikasi).

**Ringkasan held-out (n=14 dalam cakupan, 6 luar cakupan), konfigurasi default:**

| Pipeline                                   | hits@3 (recall@3) | abstain presisi / recall |
| ------------------------------------------ | ----------------: | -----------------------: |
| BM25 + stem + glosarium                    |     11/14 (78.6%) |             100% / 66.7% |
| Hybrid (v5-omni-small, tanpa transformasi) |     13/14 (92.9%) |             100% / 66.7% |
| Hybrid + jina-reranker-v3 + lantai 0.05    |      14/14 (100%) |              100% / 100% |

Abstain di baris BM25 dan hybrid memakai gerbang leksikal 0.1 + leksikon; lantai skor rerank menambah recall abstain.
Tuning: BM25 28/38, hybrid 35/38, hybrid + rerank v3 35/38, abstain 100% / 100%. Angka diambil dari eval 2026-11-08
di bawah (belum diulang setelah penambahan `ikd` ke leksikon luar cakupan, yang tidak menyentuh soal gold).

**Jalur agen (yang di-deploy).** Tool agen `rag__cari_pengetahuan` / `dukcapil__cek_persyaratan` memakai `createRagSearcher`
(BM25 stem + glosarium + vektor RRF + rerank endpoint + gerbang abstain, env yang sama dengan produksi, k=4).
`pnpm rag:eval-agent --db <rag.db> --gold ../../data/gold/heldout.json --gold ../../data/gold/tuning.json --strict`
mengukur jalur itu langsung, dan `--strict` gagal bila ada pertanyaan yang jatuh ke fallback. Hasil 2026-11-09 pada DB
yang di-deploy (v5-omni-small, jina-reranker-v3, lantai 0.05, cakupan 0.1):

| Jalur agen                 | held-out R@1 / R@3 / MRR@4 | held-out abstain P / R | tuning R@1 / R@3 / MRR@4 | tuning abstain P / R |
| -------------------------- | -------------------------- | ---------------------: | ------------------------ | -------------------: |
| tanpa env penyedia (BM25)  | 57.1% / 78.6% / 0.679      |           100% / 66.7% | 56.6% / 73.7% / 0.645    |         100% / 83.3% |
| hybrid + rerank (produksi) | 71.4% / 100% / 0.845       |            100% / 100% | 82.9% / 89.5% / 0.875    |          100% / 100% |

Semua 70 pertanyaan berjalan di mode hybrid. Rerank endpoint dipanggil pada 57 pertanyaan, dan tidak ada yang jatuh ke
fallback. Sisanya sudah diabstain oleh gerbang cakupan sebelum rerank.

**Tahap 1: embedding dalam hybrid (BM25 + vektor, RRF), tanpa transformasi.**

| Model (task query/passage)        | tuning hits@3 | tuning MRR |      latensi | token/kueri |
| --------------------------------- | ------------: | ---------: | -----------: | ----------: |
| BM25 saja                         |         28/38 |      0.685 |            - |           - |
| jina-embeddings-v3                |         35/38 |      0.825 | 454 / 536 ms |        27.6 |
| **jina-embeddings-v5-omni-small** |         35/38 |      0.829 | 296 / 409 ms |        21.4 |
| jina-embeddings-v5-text-small     |         35/38 |      0.816 | 279 / 383 ms |        21.4 |
| jina-embeddings-v4 (2048-d)       |         32/38 |      0.760 | 446 / 684 ms |        21.4 |

Semua menang >= 2 hit atas BM25; v3, v5-omni dan v5-text seri (35/38), dipilih v5-omni-small (MRR tertinggi, latensi dan
token lebih rendah). Held-out: v5-omni 13/14 (92.9%) tidak kalah dari BM25 (11/14). Tanpa field task, v5-omni turun ke 84.2%
(32/38): task wajib dikirim.

**Tahap 2: whitening, hanya untuk pemenang.** v5-omni-small: mentah 35/38 (MRR 0.829), center 34/38 (0.823), whiten k=64
33/38 (0.740), k=128 78.9% dan k=256 56.6% recall@3. Whitening menurunkan hasil di semua model yang diuji, center tidak menang: **tanpa
transformasi (`--vector-mode none`)**.

**Tahap 3: reranker pada kandidat hybrid v5-omni** (kandidat top-20, judul + teks dikirim; kriteria: +>= 2 hit@1 di tuning
dan tidak kehilangan hits@3 di tuning maupun held-out):

| Reranker                           | tuning R@1 / hits@3 / MRR | held-out R@1 / hits@3 / MRR |      latensi | token/kueri | lolos?                  |
| ---------------------------------- | ------------------------- | --------------------------- | -----------: | ----------: | ----------------------- |
| tanpa rerank                       | 72.4% / 35 / 0.829        | 57.1% / 13 / 0.768          |            - |           - | -                       |
| jina-reranker-v2-base-multilingual | 67.1% / 34 / 0.790        | 78.6% / 14 / 0.893          | 409 / 504 ms |        3806 | tidak (kalah di tuning) |
| jina-reranker-m0                   | 75.0% / 34 / 0.836        | 78.6% / 14 / 0.893          | 533 / 830 ms |        5834 | tidak (kalah 1 hit@3)   |
| **jina-reranker-v3**               | **82.9% / 35 / 0.891**    | 64.3% / 14 / 0.810          | 346 / 419 ms |        5655 | ya                      |

Daftar yang diminta hanya v2 dan m0 (keduanya tidak lolos); v3 ikut diukur karena ada dan lolos. Rerank hanya efektif bila
judul sumber ikut dikirim: tanpa judul, potongan pendek seperti "Biaya: tidak ada biaya/tarif" tak bermakna dan hybrid
turun dari 92.1% ke 81.6%.

**Lantai skor rerank sebagai gerbang abstain (jina-reranker-v3).** Dengan gerbang leksikal 0.1 + leksikon + lantai 0.05:
tuning abstain presisi/recall 100% / 100% (tanpa lantai 100% / 83.3%), hits@3 tak berubah (35/38); held-out 100% / 100%
(tanpa lantai 100% / 66.7%). Lantai 0.1 saja (tanpa gerbang lain) menurunkan hits@3 ke 34/38 dan presisi ke 91.7%, jadi
dipilih 0.05. Skor v2 dan m0 tidak terkalibrasi untuk ini (lantai sampai 0.5 hampir tak menahan apa pun); lantai berlaku
khusus untuk v3 dan harus dikalibrasi ulang bila model diganti.

**Keandalan.** Kueri embedding dibatasi 2 detik dan rerank 3 detik, tanpa retry, dengan pemutus sirkuit (3 kegagalan
beruntun -> lewati penyedia 30 detik -> BM25 / urutan fusi). Vektor tersimpan bersama model, dimensi dan parameter transformasi;
kueri dengan model embedding berbeda ditolak (BM25 saja). Eval memakai retry tanpa pemutus karena mengukur kualitas.

**Default** (`.env.example`): `jina-embeddings-v5-omni-small` (task `retrieval.query`/`retrieval.passage`), ingest tanpa
transformasi, `jina-reranker-v3`, `RAG_ABSTAIN_MIN_COVERAGE=0.1`, `RAG_ABSTAIN_MIN_RERANK_SCORE=0.05`. Tanpa kunci apa pun
pipeline tetap BM25 + stem + glosarium + gerbang leksikal/leksikon. Catatan: gerbang cakupan di eval dihitung dari BM25
saja, produksi dari top-3 hasil fusi.

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
