import { FakeProvider, fakeCompletion, generateStructured } from '@urusin/llm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildChunkContextHeader,
  cariPengetahuanTool,
  createLlmRewriter,
  createRerankBudget,
  openDb,
  rerankHits,
  retrieve,
  searchBm25,
  upsertChunks,
  type Db,
  type Hit,
  type JsonCall,
  type RerankEndpoint,
  type RetrievalPipeline,
} from './index.js';
import { weightedRrf } from './pipeline.js';

/** Data sintetis, dirakit agar pemindai PII repo tidak menandainya. */
const NIK_SINTETIS = ['3578', '0112', '0190', '0001'].join('');
const EMAIL_SINTETIS = ['warga', 'contoh.id'].join(String.fromCharCode(64));
const NOW = '2026-11-08T00:00:00.000Z';
const mk = (id: string, judul: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  text,
  sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
  verifiedAt: NOW,
  ...extra,
});

/** Korpus contoh: lima chunk lama dari rag.test.ts + chunk bergaya resmi untuk uji istilah baku. */
const CORPUS = [
  mk(
    'nas-ktp',
    'Penggantian KTP-el hilang',
    'Penggantian KTP-el yang hilang memerlukan surat kehilangan dari kepolisian.',
  ),
  mk(
    'nas-akta',
    'Akta kelahiran',
    'Pencatatan akta kelahiran memerlukan surat keterangan lahir dan KK orang tua.',
  ),
  mk('wng-kk', 'KK baru Wonogiri', 'Pengurusan KK baru di Telunjuk Sakti Wonogiri membutuhkan akta nikah.', {
    kodeWilayah: '3312',
    layanan: 'kk',
  }),
  mk('sby-kk', 'KK baru Surabaya', 'Pengurusan KK baru di Klampid Surabaya membutuhkan akta nikah.', {
    kodeWilayah: '3578',
    layanan: 'kk',
  }),
  mk('jt-pajak', 'Samsat Jawa Tengah', 'Pembayaran pajak kendaraan di Jawa Tengah lewat Samsat.', {
    kodeWilayah: '33',
  }),
  mk(
    'nas-rekam',
    'Perekaman KTP-el',
    'Perekaman dan pencetakan KTP-el dilakukan di kantor kecamatan atau Disdukcapil dengan membawa KK.',
  ),
  mk(
    'nas-pindah',
    'Surat keterangan pindah WNI',
    'Perpindahan penduduk antarkabupaten memerlukan SKPWNI dari Disdukcapil asal, lalu pindah datang di tujuan.',
  ),
  mk(
    'nas-kia',
    'Kartu identitas anak',
    'Penerbitan KIA bagi anak usia kurang dari 17 tahun memerlukan akta kelahiran dan KK.',
  ),
  mk(
    'nas-skck',
    'SKCK Polri',
    'Surat keterangan catatan kepolisian diajukan secara daring lewat portal Polri.',
  ),
  mk(
    'nas-bpjs',
    'BPJS Kesehatan',
    'Peserta jaminan kesehatan nasional membayar iuran bulanan; kartu BPJS dapat diaktifkan kembali.',
  ),
];

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertChunks(db, CORPUS);
});

const ids = (hits: readonly { id: string }[]) => hits.map((h) => h.id);
const BASELINE: RetrievalPipeline = {};

describe('stemming + ekspansi mengalahkan BM25 polos', () => {
  const demo: [string, string][] = [
    ['bikin ktp hilang gimana', 'nas-ktp'],
    ['ngurus akta anak', 'nas-akta'],
    ['pindah domisili ke surabaya', 'nas-pindah'],
    ['pajak motor', 'jt-pajak'],
    ['bikin ktp', 'nas-rekam'],
  ];
  it.each(demo)('"%s" -> %s masuk 3 teratas', async (q, expected) => {
    const r = await retrieve(
      db,
      { query: q, kodeKabKota: '3312' },
      { bm25: { stemmed: true }, expand: true },
    );
    expect(ids(r.hits).slice(0, 3)).toContain(expected);
  });
  it('peringkat 1 lebih sering benar daripada baseline', async () => {
    let base = 0;
    let full = 0;
    for (const [q, expected] of demo) {
      const o = { query: q, kodeKabKota: '3312' };
      if ((await retrieve(db, o, BASELINE)).hits[0]?.id === expected) base++;
      if ((await retrieve(db, o, { bm25: { stemmed: true }, expand: true })).hits[0]?.id === expected) full++;
    }
    expect(full).toBeGreaterThan(base);
  });
  it('stem: bentuk berimbuhan di kueri menemukan bentuk lain di dokumen', async () => {
    const exactOnly = await retrieve(db, { query: 'persyaratan mencetak merekam' }, BASELINE);
    const stemmed = await retrieve(
      db,
      { query: 'persyaratan mencetak merekam' },
      { bm25: { stemmed: true } },
    );
    expect(exactOnly.hits.map((h) => h.id)).not.toContain('nas-rekam');
    expect(stemmed.hits.map((h) => h.id)).toContain('nas-rekam');
  });
  it('istilah teknis tetap cocok persis (KTP-el, SKPWNI)', async () => {
    expect((await retrieve(db, { query: 'SKPWNI' }, { bm25: { stemmed: true } })).hits[0]?.id).toBe(
      'nas-pindah',
    );
    expect(
      (await retrieve(db, { query: 'KTP-el' }, { bm25: { stemmed: true } })).hits.length,
    ).toBeGreaterThan(0);
  });
});

describe('perluasan berbobot rendah', () => {
  it('kecocokan istilah asli mengungguli kecocokan istilah perluasan saja', async () => {
    db = openDb(':memory:');
    upsertChunks(db, [
      mk('asli', 'Catatan', 'ktp hilang dilaporkan segera'),
      mk('luas', 'Perekaman', 'perekaman pencetakan penggantian blangko'),
    ]);
    const r = await retrieve(db, { query: 'ktp hilang' }, { bm25: { stemmed: true }, expand: true });
    expect(ids(r.hits)[0]).toBe('asli');
    expect(ids(r.hits)).toContain('luas');
  });
  it('weightedRrf: bobot menggeser urutan', () => {
    const a = [{ id: 'x' }, { id: 'y' }];
    const b = [{ id: 'y' }];
    expect(
      weightedRrf([
        { hits: a, weight: 1 },
        { hits: b, weight: 0.01 },
      ]).map((r) => r.id),
    ).toEqual(['x', 'y']);
    expect(
      weightedRrf([
        { hits: a, weight: 1 },
        { hits: b, weight: 5 },
      ]).map((r) => r.id),
    ).toEqual(['y', 'x']);
  });
  it('expand=false: kueri awam tidak diperluas', async () => {
    const r = await retrieve(db, { query: 'stnk' }, { bm25: { stemmed: false }, expand: false });
    expect(r.debug.expandedTerms).toBe(0);
    expect(r.hits).toEqual([]);
  });
  it('filter wilayah tetap berlaku di semua leg', async () => {
    const r = await retrieve(
      db,
      { query: 'kk baru nikah', kodeKabKota: '3578' },
      { bm25: { stemmed: true }, expand: true },
    );
    expect(ids(r.hits)).toContain('sby-kk');
    expect(ids(r.hits)).not.toContain('wng-kk');
  });
});

describe('teks pasal nasional: wilayah dulu', () => {
  const PASAL = mk(
    'perpres#pasal-33',
    'Syarat akta kelahiran - Pasal 33',
    'Syarat akta kelahiran: surat keterangan lahir.',
  );
  const DAERAH = mk(
    'sby-akta',
    'Layanan Klampid Surabaya',
    'Syarat akta kelahiran di Klampid Surabaya: surat keterangan lahir, KK orang tua, dan KTP-el kedua orang tua.',
    { kodeWilayah: '3578' },
  );
  const q = { query: 'syarat akta kelahiran surat keterangan lahir', kodeKabKota: '3578' };
  beforeEach(() => {
    db = openDb(':memory:');
    upsertChunks(db, [PASAL, DAERAH]);
  });
  it('dengan kode wilayah, chunk daerah mendahului pasal yang cocok lebih rapat; pasal tetap ikut', async () => {
    for (const p of [BASELINE, { bm25: { stemmed: true }, expand: true }] as RetrievalPipeline[]) {
      expect(ids((await retrieve(db, q, p)).hits)).toEqual(['sby-akta', 'perpres#pasal-33']);
    }
    expect(ids(searchBm25(db, q))).toEqual(['sby-akta', 'perpres#pasal-33']);
  });
  it('tanpa kode wilayah, pasal tidak didiskon', async () => {
    expect(ids(searchBm25(db, { query: q.query }))).toEqual(['perpres#pasal-33']);
  });
  it('cakupan abstain dari chunk pasal didiskon separuh', async () => {
    const teks = 'Setiap kelahiran wajib dilaporkan paling lambat 60 hari.';
    const cov = async (id: string) => {
      db = openDb(':memory:');
      upsertChunks(db, [mk(id, 'UU 24/2013', teks), mk('lain', 'KK', 'Kartu keluarga baru.')]);
      const r = await retrieve(
        db,
        { query: 'harga emas hari ini' },
        { bm25: { stemmed: true }, expand: true },
      );
      return r.debug.coverage!;
    };
    const biasa = await cov('uu#0');
    expect(biasa).toBeGreaterThan(0);
    expect(await cov('uu#pasal-27')).toBeCloseTo(biasa / 2, 6);
  });
});

describe('header konteks: diindeks, tidak ditampilkan', () => {
  it('kueri yang hanya cocok dengan header menemukan chunk; teks tampil tanpa header', async () => {
    db = openDb(':memory:');
    const header = buildChunkContextHeader({
      judulHalaman: 'Layanan Disdukcapil',
      heading: 'Biaya',
      instansi: 'Dinas Contoh',
      layanan: 'adminduk',
    });
    upsertChunks(db, [
      { ...mk('c1', 'Layanan Disdukcapil', 'Gratis tanpa dipungut bayaran.'), contextHeader: header },
    ]);
    const exact = searchBm25(db, { query: 'biaya' });
    expect(exact.map((h) => h.id)).toEqual(['c1']);
    expect(exact[0]!.text).toBe('Gratis tanpa dipungut bayaran.');
    const r = await retrieve(db, { query: 'biaya' }, { bm25: { stemmed: true } });
    expect(r.hits[0]?.text).not.toContain('Biaya');
  });
  it('tanpa contextHeader, header dibuat dari judul, instansi, layanan', async () => {
    const row = db.prepare('SELECT ctx FROM chunks WHERE id = ?').get('wng-kk') as { ctx: string };
    expect(row.ctx).toBe('KK baru Wonogiri › Dinas Contoh › kk');
  });
});

describe('migrasi', () => {
  it('DB skema lama (tanpa ctx dan indeks stem) dimigrasi dan terisi', () => {
    const old = openDb(':memory:');
    old.exec(`
      DROP TRIGGER chunks_ai; DROP TRIGGER chunks_ad; DROP TABLE chunks_fts; DROP TABLE chunks_stem_fts; DROP TABLE chunks;
      CREATE TABLE chunks (id TEXT PRIMARY KEY, judul TEXT NOT NULL, text TEXT NOT NULL, instansi TEXT NOT NULL, url TEXT NOT NULL, verified_at TEXT, kode_wilayah TEXT, layanan TEXT);
      CREATE VIRTUAL TABLE chunks_fts USING fts5(judul, text, instansi, content='chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO chunks_fts(rowid, judul, text, instansi) VALUES (new.rowid, new.judul, new.text, new.instansi); END;
      INSERT INTO chunks(id, judul, text, instansi, url, verified_at) VALUES ('a', 'Akta', 'pencatatan kelahiran anak', 'Dinas', 'https://x.go.id/a', NULL);
    `);
    // migrate() idempoten dipanggil lagi lewat openDb pada koneksi yang sama
    return import('./db.js').then(({ migrate }) => {
      migrate(old);
      migrate(old);
      expect(searchBm25(old, { query: 'kelahiran' }).map((h) => h.id)).toEqual(['a']);
      const stem = old.prepare("SELECT rowid FROM chunks_stem_fts WHERE chunks_stem_fts MATCH 'lahir'").all();
      expect(stem).toHaveLength(1);
    });
  });
  it('hapus chunk ikut menghapus indeks stem', () => {
    db.prepare("DELETE FROM chunks WHERE id = 'nas-ktp'").run();
    const n = db.prepare('SELECT COUNT(*) AS n FROM chunks_stem_fts').get() as { n: number };
    expect(n.n).toBe(CORPUS.length - 1);
  });
});

// ---------------------------------------------------------------------------
// Rerank
// ---------------------------------------------------------------------------

const cand = (): Hit[] =>
  ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    text: `teks ${id}`,
    skor: 1 - i / 10,
    kutipan: { url: `https://contoh.go.id/${id}`, judul: `Judul ${id}`, instansi: 'Dinas' },
    verifiedAt: NOW,
    kodeWilayah: null,
    layanan: null,
  }));

const jsonVia =
  (provider: FakeProvider): JsonCall =>
  async (req) =>
    (
      await generateStructured({
        provider,
        model: 'fake',
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        schema: req.schema,
        name: req.name,
        caps: { json_schema_strict: true, tools: true },
        signal: req.signal,
      })
    ).data;

const reply = (o: unknown) => fakeCompletion({ content: JSON.stringify(o) });

describe('rerankHits: endpoint', () => {
  const endpoint = (scores: Record<string, number>): RerankEndpoint & { calls: number } => ({
    calls: 0,
    async rerank(req) {
      this.calls++;
      return req.documents.map((d) => ({ id: d.id, score: scores[d.id] ?? 0 }));
    },
  });
  it('memakai endpoint bila ada; kutipan dan verifiedAt utuh', async () => {
    const ep = endpoint({ c: 0.9, a: 0.5, b: 0.1, d: 0 });
    const r = await rerankHits('q', cand(), 3, { endpoint: ep, caps: { rerank: true } });
    expect(r.status).toBe('endpoint');
    expect(ids(r.hits)).toEqual(['c', 'a', 'b']);
    for (const h of r.hits) {
      expect(h.kutipan.url).toContain('https://contoh.go.id/');
      expect(h.verifiedAt).toBe(NOW);
    }
  });
  it('probe melaporkan rerank=false -> endpoint dilewati', async () => {
    const ep = endpoint({ c: 1 });
    const r = await rerankHits('q', cand(), 3, { endpoint: ep, caps: { rerank: false } });
    expect(ep.calls).toBe(0);
    expect(r.status).toBe('off');
    expect(ids(r.hits)).toEqual(['a', 'b', 'c']);
  });
  it('endpoint melempar -> urutan fusi (fallback)', async () => {
    const ep: RerankEndpoint = {
      async rerank() {
        throw new Error('503');
      },
    };
    const r = await rerankHits('q', cand(), 2, { endpoint: ep });
    expect(r).toMatchObject({ status: 'fallback' });
    expect(ids(r.hits)).toEqual(['a', 'b']);
  });
  it('id asing dari endpoint diabaikan', async () => {
    const ep: RerankEndpoint = {
      async rerank() {
        return [
          { id: 'zzz', score: 9 },
          { id: 'b', score: 1 },
        ];
      },
    };
    const r = await rerankHits('q', cand(), 3, { endpoint: ep });
    expect(ids(r.hits)).toEqual(['b', 'a', 'c']);
  });
});

describe('rerankHits: LLM listwise lewat FakeProvider', () => {
  it('mengurutkan ulang sesuai penanda; sisanya mengikuti urutan fusi', async () => {
    const p = new FakeProvider({ replies: [reply({ urutan: ['d3', 'd1'] })] });
    const r = await rerankHits('syarat ktp', cand(), 4, { json: jsonVia(p) });
    expect(r.status).toBe('llm');
    expect(ids(r.hits)).toEqual(['c', 'a', 'b', 'd']);
    expect(r.hits.every((h) => h.kutipan.url && h.verifiedAt === NOW)).toBe(true);
    const sent = JSON.stringify(p.calls[0]);
    expect(sent).toContain('[d1]');
    expect(sent).toContain('json_schema');
  });
  it('penanda tidak dikenal/duplikat dibuang', async () => {
    const p = new FakeProvider({ replies: [reply({ urutan: ['d9', 'd2', 'd2'] })] });
    const r = await rerankHits('q', cand(), 3, { json: jsonVia(p) });
    expect(ids(r.hits)).toEqual(['b', 'a', 'c']);
  });
  it('keluaran bukan JSON skema -> fallback fusi', async () => {
    const p = new FakeProvider({ replies: [fakeCompletion({ content: 'maaf saya tidak bisa' })] });
    const r = await rerankHits('q', cand(), 3, { json: jsonVia(p) });
    expect(r.status).toBe('fallback');
    expect(ids(r.hits)).toEqual(['a', 'b', 'c']);
  });
  it('galat provider -> fallback', async () => {
    const p = new FakeProvider({ replies: [new Error('boom')] });
    const r = await rerankHits('q', cand(), 3, { json: jsonVia(p) });
    expect(r.status).toBe('fallback');
  });
  it('timeout -> fallback tanpa menunggu', async () => {
    const never: JsonCall = () => new Promise(() => undefined);
    const t0 = Date.now();
    const r = await rerankHits('q', cand(), 3, { json: never, timeoutMs: 20 });
    expect(r.status).toBe('fallback');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('anggaran panggilan habis -> tidak memanggil LLM', async () => {
    const p = new FakeProvider({ replies: [reply({ urutan: ['d2'] }), reply({ urutan: ['d2'] })] });
    const budget = createRerankBudget(1);
    const deps = { json: jsonVia(p), budget };
    expect((await rerankHits('q', cand(), 3, deps)).status).toBe('llm');
    expect((await rerankHits('q', cand(), 3, deps)).status).toBe('fallback');
    expect(p.calls).toHaveLength(1);
  });
  it('dokumen dipotong sesuai batas prompt', async () => {
    const long = cand().map((h) => ({ ...h, text: 'x'.repeat(5000) }));
    const p = new FakeProvider({ replies: [reply({ urutan: ['d1'] })] });
    await rerankHits('q', long, 4, { json: jsonVia(p), maxPromptChars: 800 });
    const call = p.calls[0];
    expect(call?.kind === 'create' && JSON.stringify(call.params).length).toBeLessThan(2500);
  });
  it('kueri berisi PII tidak dikirim ke LLM', async () => {
    const p = new FakeProvider({ replies: [reply({ urutan: ['d2'] })] });
    const r = await rerankHits(`NIK saya ${NIK_SINTETIS} hilang`, cand(), 3, { json: jsonVia(p) });
    expect(r.status).toBe('skipped');
    expect(p.calls).toHaveLength(0);
  });
  it('tanpa reranker sama sekali -> off', async () => {
    expect((await rerankHits('q', cand(), 2, {})).status).toBe('off');
  });
});

describe('rewrite LLM opsional', () => {
  const pipe: RetrievalPipeline = { bm25: { stemmed: true }, expand: true };
  it('istilah dari LLM masuk sebagai perluasan', async () => {
    db = openDb(':memory:');
    upsertChunks(db, [mk('s1', 'Pelaporan', 'Pelaporan pencurian dilakukan di kantor polisi setempat.')]);
    const p = new FakeProvider({ replies: [reply({ istilah: ['Pelaporan', 'pencurian 123456'] })] });
    const r = await retrieve(db, { query: 'dompet raib' }, pipe, { rewrite: createLlmRewriter(jsonVia(p)) });
    expect(r.debug.rewriteStatus).toBe('applied');
    expect(ids(r.hits)).toEqual(['s1']);
  });
  it('keluaran LLM disanitasi (angka, stopword, terlalu pendek dibuang)', async () => {
    const p = new FakeProvider({
      replies: [reply({ istilah: [`NIK ${NIK_SINTETIS}`, 'yang', 'ab', 'samsat'] })],
    });
    const terms = await createLlmRewriter(jsonVia(p))('q');
    expect(terms).toEqual(['nik', 'samsat']);
  });
  it('PII/placeholder di kueri -> LLM tidak dipanggil', async () => {
    const p = new FakeProvider({ replies: [reply({ istilah: ['x'] })] });
    for (const q of [
      `ktp ${NIK_SINTETIS} hilang`,
      `email saya ${EMAIL_SINTETIS}`,
      'isi {{PEMOHON.NIK}} dong',
    ]) {
      const r = await retrieve(db, { query: q }, pipe, { rewrite: createLlmRewriter(jsonVia(p)) });
      expect(r.debug.rewriteStatus).toBe('skipped');
    }
    expect(p.calls).toHaveLength(0);
  });
  it('LLM galat -> retrieval tetap jalan (fallback)', async () => {
    const p = new FakeProvider({ replies: [new Error('down')] });
    const r = await retrieve(db, { query: 'ktp hilang' }, pipe, { rewrite: createLlmRewriter(jsonVia(p)) });
    expect(r.debug.rewriteStatus).toBe('fallback');
    expect(ids(r.hits)[0]).toBe('nas-ktp');
  });
  it('tidak dipanggil bila expand mati', async () => {
    const p = new FakeProvider({ replies: [] });
    const r = await retrieve(
      db,
      { query: 'ktp hilang' },
      { bm25: {}, expand: false },
      { rewrite: createLlmRewriter(jsonVia(p)) },
    );
    expect(r.debug.rewriteStatus).toBe('off');
    expect(p.calls).toHaveLength(0);
  });
});

describe('cari_pengetahuan: pipeline bawaan', () => {
  it('default: stem + ekspansi; debug berisi waktu per tahap tanpa teks kueri', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'bikin ktp hilang gimana' });
    expect(cariPengetahuanTool.outputSchema.safeParse(out).success).toBe(true);
    expect(out.hasil[0]?.id).toBe('nas-ktp');
    expect(out.mode).toBe('bm25');
    const d = out.debug!;
    expect(d.pipeline).toEqual({ stemmed: true, expand: true, vector: false, rerank: true });
    expect(d.timingsMs.total).toBeGreaterThanOrEqual(0);
    expect(Object.keys(d.timingsMs).sort()).toEqual(['bm25', 'expand', 'fuse', 'rerank', 'total']);
    expect(d.glossaryMatched).toContain('ktp-hilang');
    expect(JSON.stringify(d)).not.toMatch(/gimana/);
  });
  it('vektor: hybrid bila vectorIds ada dan pipeline.vector aktif; dimatikan -> bm25', () => {
    expect(cariPengetahuanTool.execute(db, { query: 'akta' }, { vectorIds: ['nas-akta'] }).mode).toBe(
      'hybrid',
    );
    const off = cariPengetahuanTool.execute(
      db,
      { query: 'akta' },
      { vectorIds: ['nas-akta'], useVector: false },
    );
    expect(off.mode).toBe('bm25');
    expect(off.debug?.pipeline.vector).toBe(false);
  });
  it('id dari leg vektor yang tidak ada di BM25 ikut dihidrasi dengan kutipan', () => {
    const out = cariPengetahuanTool.execute(
      db,
      { query: 'akta kelahiran', k: 10 },
      { vectorIds: ['nas-bpjs'] },
    );
    const bpjs = out.hasil.find((h) => h.id === 'nas-bpjs');
    expect(bpjs?.kutipan.url).toBe('https://contoh.go.id/nas-bpjs');
    expect(bpjs?.verifiedAt).toBe(NOW);
  });
  it('executeAsync: rerank berjalan dan statusnya tercatat; gagal -> urutan fusi', async () => {
    const base = cariPengetahuanTool.execute(db, { query: 'kk akta', k: 3 });
    const p = new FakeProvider({ replies: [reply({ urutan: ['d3'] })] });
    const out = await cariPengetahuanTool.executeAsync(
      db,
      { query: 'kk akta', k: 3 },
      { rerank: { json: jsonVia(p) } },
    );
    expect(out.debug?.rerankStatus).toBe('llm');
    expect(out.hasil).toHaveLength(base.hasil.length);
    expect(out.hasil[0]?.id).toBe(base.hasil[2]?.id);
    const bad = new FakeProvider({ replies: [new Error('x')] });
    const fb = await cariPengetahuanTool.executeAsync(
      db,
      { query: 'kk akta', k: 3 },
      { rerank: { json: jsonVia(bad) } },
    );
    expect(fb.debug?.rerankStatus).toBe('fallback');
    expect(ids(fb.hasil)).toEqual(ids(base.hasil));
  });
  it('rerank=false di pipeline -> LLM tidak dipanggil', async () => {
    const p = new FakeProvider({ replies: [reply({ urutan: ['d2'] })] });
    await cariPengetahuanTool.executeAsync(
      db,
      { query: 'kk akta' },
      { pipeline: { rerank: false }, rerank: { json: jsonVia(p) } },
    );
    expect(p.calls).toHaveLength(0);
  });
  it('tanpa hasil tetap hand-off', async () => {
    const out = await cariPengetahuanTool.executeAsync(db, { query: 'resep rendang padang' });
    expect(out).toMatchObject({ tanpaHasil: true, hasil: [] });
  });
  it('kueri adversarial tidak merusak sintaks FTS', async () => {
    for (const q of ['"', 'a" OR "b', 'NEAR(a b)', '*', 'col:x', '-', '(', 'x"; DROP TABLE chunks;--'])
      await expect(cariPengetahuanTool.executeAsync(db, { query: q })).resolves.toBeDefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n).toBe(CORPUS.length);
  });
});
