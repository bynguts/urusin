import { describe, expect, it } from 'vitest';
import { cariPengetahuanTool, openDb, upsertChunks, DEFAULT_MIN_COVERAGE } from './index.js';
import { fakeEmbedder } from './eval/fake-embedder.js';
import { embedAndFit, vectorIdsForQuery } from './vector/pipeline.js';

const mk = (id: string, judul: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  text,
  sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
  verifiedAt: '2026-11-08T00:00:00.000Z',
  ...extra,
});

/** Korpus sintetis bergaya halaman resmi (tanpa data pribadi). */
const CORPUS = [
  mk(
    'ktp-hilang',
    'Penggantian KTP-el hilang',
    'Penggantian KTP-el yang hilang memerlukan surat kehilangan dari kepolisian dan KK.',
  ),
  mk(
    'ktp-rekam',
    'Perekaman KTP-el',
    'Perekaman dan pencetakan KTP-el dilakukan di kantor kecamatan atau Disdukcapil dengan membawa KK.',
  ),
  mk(
    'ktp-rusak',
    'Penggantian KTP-el rusak',
    'KTP-el yang rusak diganti dengan membawa KTP-el lama dan KK ke Disdukcapil.',
  ),
  mk(
    'akta-lahir',
    'Akta kelahiran',
    'Pencatatan akta kelahiran memerlukan surat keterangan lahir dan KK orang tua.',
  ),
  mk(
    'akta-mati',
    'Akta kematian',
    'Pencatatan kematian memerlukan surat keterangan kematian dari rumah sakit atau kelurahan.',
  ),
  mk(
    'akta-nikah',
    'Akta perkawinan',
    'Pencatatan perkawinan memerlukan surat keterangan dari pemuka agama dan KTP-el kedua mempelai.',
  ),
  mk(
    'kk-baru',
    'Kartu keluarga baru',
    'Penerbitan kartu keluarga baru memerlukan akta perkawinan dan KTP-el.',
  ),
  mk(
    'pindah',
    'Surat keterangan pindah WNI',
    'Perpindahan penduduk antarkabupaten memerlukan SKPWNI dari Disdukcapil asal, lalu pindah datang di tujuan.',
  ),
  mk(
    'kia',
    'Kartu identitas anak',
    'Penerbitan KIA bagi anak usia kurang dari 17 tahun memerlukan akta kelahiran dan KK.',
  ),
  mk(
    'ikd',
    'Identitas kependudukan digital',
    'Identitas kependudukan digital diaktifkan lewat aplikasi dengan KTP-el dan swafoto.',
  ),
  mk(
    'pajak',
    'Pajak kendaraan bermotor',
    'Pajak kendaraan bermotor dibayar di Samsat atau secara daring melalui Bapenda; bawa STNK.',
  ),
  mk('skck', 'SKCK Polri', 'Surat keterangan catatan kepolisian diajukan secara daring lewat portal Polri.'),
  mk(
    'sim',
    'Surat izin mengemudi',
    'Pembuatan dan perpanjangan surat izin mengemudi dilakukan di Satpas dengan ujian teori dan praktik.',
  ),
  mk(
    'bpjs',
    'BPJS Kesehatan',
    'Peserta jaminan kesehatan nasional membayar iuran bulanan; kartu BPJS dapat diaktifkan kembali setelah tunggakan dilunasi.',
  ),
  mk(
    'bansos',
    'Cek bansos',
    'Penerima bantuan sosial dapat dicek lewat laman Cek Bansos Kementerian Sosial dengan data wilayah.',
  ),
  mk(
    'lapor',
    'LAPOR!',
    'Layanan aspirasi dan pengaduan online rakyat menerima pengaduan tentang pelayanan publik.',
  ),
  mk(
    'nib',
    'Nomor induk berusaha',
    'Pelaku usaha mengurus nomor induk berusaha lewat OSS untuk perizinan berusaha.',
  ),
  mk(
    'dpt',
    'Cek DPT',
    'Pemilih dapat memeriksa nama pada daftar pemilih tetap lewat laman Cek DPT Komisi Pemilihan Umum.',
  ),
];

const IN_SCOPE: [string, string][] = [
  ['bikin ktp hilang gimana', 'ktp-hilang'],
  ['ktp saya ilang', 'ktp-hilang'],
  ['bikin ktp baru', 'ktp-rekam'],
  ['ktp rusak gimana', 'ktp-rusak'],
  ['ngurus akta anak', 'akta-lahir'],
  ['akta lahir butuh apa', 'akta-lahir'],
  ['ada yang meninggal ngurus apa', 'akta-mati'],
  ['pindah domisili ke surabaya', 'pindah'],
  ['pindahan antar kabupaten', 'pindah'],
  ['bikin kk baru', 'kk-baru'],
  ['kia buat anak umur 5', 'kia'],
  ['pajak motor mati', 'pajak'],
  ['stnk', 'pajak'],
  ['skck online', 'skck'],
  ['perpanjang sim', 'sim'],
  ['bpjs nunggak', 'bpjs'],
  ['cek bansos', 'bansos'],
  ['mau lapor pelayanan buruk', 'lapor'],
  ['daftar nib usaha kecil', 'nib'],
  ['nama saya ada di dpt ga', 'dpt'],
  ['ktp hilang di terminal bus', 'ktp-hilang'],
  ['ngurus akta anak di kecamatan', 'akta-lahir'],
  ['pajak motor mati dua tahun', 'pajak'],
  ['perpanjang sim di mal pelayanan publik', 'sim'],
  ['kk baru setelah nikah kemarin', 'kk-baru'],
];

const OUT_OF_SCOPE = [
  'resep rendang padang',
  'jadwal pertandingan bola malam ini',
  'cara daftar CPNS 2026',
  'harga tiket pesawat ke Bali',
  'cara membuat kue brownies',
  'cuaca besok di Surabaya',
  'lirik lagu terbaru',
  'cara menurunkan berat badan',
  'kapan gajian PNS naik',
  'tips belajar bahasa Inggris',
];

const db = openDb(':memory:');
upsertChunks(db, CORPUS);
const embed = fakeEmbedder();
await embedAndFit(db, embed, { mode: 'center' });
/** Leg vektor tiap kueri dihitung sekali (embedder palsu deterministik, tanpa jaringan). */
const VEC = new Map<string, string[]>();
for (const q of [...IN_SCOPE.map(([x]) => x), ...OUT_OF_SCOPE, 'ktp hilang di terminal bus', 'ktp hilang'])
  VEC.set(q, (await vectorIdsForQuery(db, embed, q)) ?? []);

type Mode = 'bm25' | 'hybrid';
const run = (q: string, mode: Mode, minCoverage?: number) =>
  cariPengetahuanTool.execute(
    db,
    { query: q, k: 3 },
    {
      ...(minCoverage === undefined ? {} : { minCoverage }),
      ...(mode === 'hybrid' ? { vectorIds: VEC.get(q) ?? [] } : {}),
    },
  );

const recallAt3 = (mode: Mode, minCoverage?: number) =>
  IN_SCOPE.filter(([q, id]) =>
    run(q, mode, minCoverage)
      .hasil.map((h) => h.id)
      .includes(id),
  ).length / IN_SCOPE.length;

describe.each<Mode>(['bm25', 'hybrid'])('abstain / hand-off (mode %s)', (mode) => {
  it('mode keluaran sesuai', () => {
    expect(run('ktp hilang', mode).mode).toBe(mode);
  });
  it('10 pertanyaan di luar cakupan -> tanpaHasil true dengan alasan (ambang 0.3 di celah korpus sintetis)', () => {
    expect(OUT_OF_SCOPE).toHaveLength(10);
    for (const q of OUT_OF_SCOPE) {
      const out = run(q, mode, 0.3);
      expect(out.tanpaHasil, q).toBe(true);
      expect(out.hasil, q).toEqual([]);
      expect(['di_luar_cakupan', 'skor_rendah'], q).toContain(out.alasan);
    }
  });
  it('tanpa gerbang (minCoverage 0) kueri di luar cakupan masih mengembalikan hasil', () => {
    const leaked = OUT_OF_SCOPE.filter((q) => !run(q, mode, 0).tanpaHasil);
    expect(leaked.length).toBeGreaterThanOrEqual(mode === 'hybrid' ? 8 : 2);
  });
  it('recall@3 25/25 dalam cakupan, tidak turun lebih dari 2 poin dibanding tanpa gerbang', () => {
    const before = recallAt3(mode, 0);
    const after = recallAt3(mode);
    expect(before).toBeGreaterThanOrEqual(0.9);
    expect(after).toBe(1);
    expect(before - after).toBeLessThanOrEqual(0.02);
  });
  it('kueri dalam cakupan dengan kata konteks asing tetap dijawab', () => {
    expect(run('ktp hilang di terminal bus', mode).hasil[0]?.id).toBe('ktp-hilang');
  });
  it('ambang dapat dikonfigurasi', () => {
    expect(run('lirik lagu terbaru', mode, 0.1).tanpaHasil).toBe(false);
    expect(run('ktp hilang di terminal bus', mode, 0.9).tanpaHasil).toBe(true);
  });
  it('debug memuat coverage (angka, bukan teks kueri)', () => {
    expect(run('ktp hilang', mode).debug!.coverage).toBeGreaterThan(0.9);
  });
});

describe('abstain: konfigurasi', () => {
  it('bawaan 0.1 (dikalibrasi di korpus nyata) dan alasan', () => {
    expect(DEFAULT_MIN_COVERAGE).toBe(0.1);
    expect(run('resep rendang padang', 'bm25').alasan).toBe('di_luar_cakupan');
    // korpus sintetis punya celah 0.26..0.33, jadi 'skor_rendah' diuji dengan ambang 0.3 eksplisit
    expect(run('lirik lagu terbaru', 'bm25', 0.3).alasan).toBe('skor_rendah');
  });
  it('env RAG_ABSTAIN_MIN_COVERAGE menimpa bawaan; nilai tak valid diabaikan', () => {
    const prev = process.env['RAG_ABSTAIN_MIN_COVERAGE'];
    try {
      process.env['RAG_ABSTAIN_MIN_COVERAGE'] = '0';
      expect(run('lirik lagu terbaru', 'bm25').tanpaHasil).toBe(false);
      process.env['RAG_ABSTAIN_MIN_COVERAGE'] = 'abc';
      expect(run('resep rendang padang', 'bm25').tanpaHasil).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['RAG_ABSTAIN_MIN_COVERAGE'];
      else process.env['RAG_ABSTAIN_MIN_COVERAGE'] = prev;
    }
  });
});
