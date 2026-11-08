# @urusin/rag

## Pipeline retrieval

`cari_pengetahuan` memakai pipeline berikut. Tiap tahap bisa dimatikan lewat `RetrievalPipeline` dan
turun sendiri bila komponennya tidak ada (tanpa vektor, tanpa reranker, tanpa LLM).

```ts
type RetrievalPipeline = {
  bm25: { stemmed?: boolean }; // default true: tambah leg BM25 atas kolom ter-stem
  expand?: boolean | { weight?: number; llm?: boolean }; // glosarium; bobot leg perluasan default 0.4
  vector?: boolean | Record<string, unknown>; // memakai `vectorIds` dari pemanggil
  rerank?: boolean | { topN?: number }; // top-N (default 20) -> top-k
};
```

Bawaan (`DEFAULT_PIPELINE`): BM25 teks asli + BM25 ter-stem + perluasan glosarium + vektor bila ada +
rerank bila disuntikkan.

| Tahap                  | Cara kerja                                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stem BM25              | better-sqlite3 tidak bisa mendaftarkan tokenizer FTS5 dari JS, jadi teks di-stem di JS saat ingest ke tabel `chunks_stem_fts`; kueri di-stem dengan fungsi yang sama. Kolom asli `chunks_fts` tetap untuk kecocokan persis (KTP-el, NIK, SKPWNI, F1.06). |
| Ekspansi               | `data/glossary/adminduk.json` memetakan istilah awam ke istilah resmi (tiap entri wajib `sourceRef`). Deterministik; skor leg perluasan dikalikan bobot rendah (0.4) sehingga kata asli tetap menang.                                                    |
| Tulis ulang LLM (opsi) | `expand: { llm: true }` + `rewrite: createLlmRewriter(jsonCall)`. Kueri berisi PII atau placeholder vault tidak pernah dikirim (guard dari `@urusin/core`); keluaran disanitasi; galat/timeout -> dilewati.                                              |
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
