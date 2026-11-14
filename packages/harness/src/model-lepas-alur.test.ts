import { FakeProvider, fakeCompletion, type ChatParams } from '@urusin/llm';
import type { EventOf, UrusinEvent } from '@urusin/contracts';
import { openDb, upsertChunks } from '@urusin/rag';
import { describe, expect, it } from 'vitest';
import { runTurn, saringFakta } from './agent.js';
import { chunkNasional } from './builtin-tools.js';
import { makeEnv } from './testing.js';
import type { CariWeb } from './web-cari.js';
import { buatUrusanTerwilayah } from './wilayah.js';

// "Lepaskan model" bagian 2: model yang memutuskan (jawab, tanya, cari web, rencana); kode hanya menjaga garis
// merah (kutipan terverifikasi, angka/URL tanpa sumber dibuang, URL web hanya dari hasil pencarian resmi).

const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);
const tool = (name: string, args: Record<string, unknown>) =>
  fakeCompletion({ toolCalls: [{ name, arguments: JSON.stringify(args) }] });
const creates = (p: FakeProvider) => p.calls.flatMap((c) => (c.kind === 'create' ? [c.params] : []));
const generator = (p: FakeProvider): ChatParams[] =>
  creates(p).filter((c) => c.response_format?.type === 'json_schema');

const SYARAT = 'Penduduk melampirkan KTP-el rusak (jika KTP-el rusak) dan mengisi formulir F-1.02.';

function ragKtp() {
  const db = openDb(':memory:');
  upsertChunks(db, [
    {
      id: 'contoh-ktp-el#0',
      text: `Persyaratan: ${SYARAT} Layanan selesai dalam 1 hari kerja.`,
      sourceRef: {
        url: 'https://disdukcapil.contoh.go.id/ktp-el',
        judul: 'Penerbitan KTP-el Rusak (Standar Pelayanan) › persyaratan',
        instansi: 'Disdukcapil Kabupaten Wonogiri',
      },
      verifiedAt: '2026-11-10T00:00:00.000Z',
      kodeWilayah: '3312',
      layanan: 'adminduk',
    },
  ]);
  return db;
}

const jawabanSah = () =>
  fakeCompletion({
    content: JSON.stringify({
      klaim: [
        {
          teks: 'Bawa KTP-el yang rusak dan isi formulir dari petugas.',
          kutipan: [{ refId: 'contoh-ktp-el#0', kutipanPersis: SYARAT }],
        },
      ],
    }),
  });

describe('sesudah jawaban bersumber model tetap bicara, angka tanpa sumber dibuang', () => {
  it('balasan lanjutan tampil; kalimat dengan biaya karangan dibuang, angka bersumber tetap', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('rag__cari_pengetahuan', { query: 'ganti KTP-el rusak' }),
        tool('urusan__jawab_persyaratan', { pertanyaan: 'Bagaimana cara ganti KTP-el rusak?' }),
        jawabanSah(),
        fakeCompletion({
          content:
            'Datang ke Disdukcapil dengan KTP-el yang rusak. Biayanya Rp 50.000. Biasanya selesai dalam 1 hari kerja.',
        }),
      ],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Bagaimana cara ganti KTP-el rusak?' });
    expect(out.status).toBe('selesai');
    const tipe = out.events.map((e) => e.type);
    expect(tipe.indexOf('assistant_text')).toBeGreaterThan(tipe.indexOf('grounded_answer'));
    const teks = of(out.events, 'assistant_text')
      .map((e) => e.delta)
      .join('');
    expect(teks).toContain('Datang ke Disdukcapil dengan KTP-el yang rusak.');
    expect(teks).toContain('selesai dalam 1 hari kerja');
    expect(teks).not.toContain('50.000');
    // Hasil tool jawaban meminta model melanjutkan, bukan diam.
    expect(JSON.stringify(creates(provider).at(-1)!.messages)).toContain('JAWABAN BERSUMBER SUDAH TAMPIL');
  });

  it('saringFakta: nomor daftar bukan fakta, URL tanpa sumber dibuang, baris kosong hilang', () => {
    const bukti = ['Biaya Rp 0. Lihat https://dukcapil.kemendagri.go.id/layanan'];
    const teks = [
      '1. Bawa KK.',
      '2. Daftar di https://palsu.example.com/daftar',
      '3. Biaya Rp 0, tidak dipungut biaya.',
    ].join('\n');
    expect(saringFakta(teks, bukti)).toBe(['1. Bawa KK.', '3. Biaya Rp 0, tidak dipungut biaya.'].join('\n'));
    expect(saringFakta('Tenggat 60 hari. Cek kanal resmi.', [])).toBe('Cek kanal resmi.');
  });
});

describe('urusan__tetapkan_jenis', () => {
  it('model mengoreksi jenis urusan; done membawa jenis baru', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('urusan__tetapkan_jenis', { jenis: 'kematian' }),
        fakeCompletion({ content: 'Turut berduka. Almarhum tinggal di kabupaten/kota mana?' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'lainnya' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Bapak saya baru berpulang kemarin.' });
    expect(env.store.getUrusanOrThrow(u.id).jenis).toBe('kematian');
    expect(of(out.events, 'done')[0]).toMatchObject({ jenis: 'kematian' });
    expect(of(out.events, 'policy_gate')).toHaveLength(0);
  });

  it('jenis di luar enum ditolak gate', async () => {
    const provider = new FakeProvider({
      replies: [tool('urusan__tetapkan_jenis', { jenis: 'paspor' }), fakeCompletion({ content: 'Baik.' })],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'lainnya' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Mau urus sesuatu.' });
    expect(of(out.events, 'policy_gate')[0]).toMatchObject({ aturan: 'SCHEMA_INVALID' });
    expect(env.store.getUrusanOrThrow(u.id).jenis).toBe('lainnya');
  });
});

describe('web__baca', () => {
  const RESMI = 'https://dukcapil.kemendagri.go.id/page/read/syarat-akta';
  const ISI =
    'Syarat akta kelahiran: surat keterangan lahir, KK, dan KTP-el orang tua. Tidak dipungut biaya.';

  function cariWebTiruan() {
    const dibaca: string[] = [];
    const cari = (async () => [
      { judul: 'Syarat akta', url: RESMI, cuplikan: 'Syarat akta kelahiran ...' },
    ]) as CariWeb;
    cari.baca = async (url) => {
      dibaca.push(url);
      return { judul: 'Syarat Akta Kelahiran', teks: ISI };
    };
    return { cari, dibaca };
  }

  async function jalankan(urlBaca: string, cariDulu: boolean) {
    const t = cariWebTiruan();
    const provider = new FakeProvider({
      replies: [
        ...(cariDulu ? [tool('web__cari', { query: 'syarat akta kelahiran' })] : []),
        tool('web__baca', { url: urlBaca }),
        fakeCompletion({ content: 'Baik.' }),
      ],
    });
    const env = makeEnv({ provider, cariWeb: t.cari });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3578', jenis: 'akta' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta kelahiran?' });
    const hasil = JSON.stringify(creates(provider).at(-1)!.messages);
    return { t, env, u, hasil };
  }

  it('URL hasil web__cari resmi: dibaca, disimpan sebagai potongan sumber, dibungkus spotlight', async () => {
    const { t, env, u, hasil } = await jalankan(RESMI, true);
    expect(t.dibaca).toEqual([RESMI]);
    const baca = env.store.getChunks(u.id).find((c) => /^web-[0-9a-f]{10}-baca$/.test(c.refId));
    expect(baca).toMatchObject({ text: ISI, url: RESMI, verifiedAt: null });
    expect(hasil).toContain('DATA_TAK_TEPERCAYA sumber=\\"web\\"');
  });

  it.each([
    ['URL resmi yang belum pernah muncul di hasil pencarian', RESMI, false],
    ['URL bukan sumber resmi', 'https://blog.contoh.com/syarat-akta', true],
    ['URL http (bukan https)', 'http://dukcapil.kemendagri.go.id/page/read/syarat-akta', true],
    ['URL resmi lain yang tidak ada di hasil pencarian', 'https://dukcapil.kemendagri.go.id/lain', true],
  ])('%s: ditolak tanpa menghubungi penyedia', async (_n, url, cariDulu) => {
    const { t, hasil } = await jalankan(url, cariDulu);
    expect(t.dibaca).toEqual([]);
    expect(hasil).toContain('URL ditolak');
  });
});

describe('persyaratan nasional sebelum wilayah', () => {
  it('chunkNasional: Kemendagri/peraturan lolos, Disdukcapil daerah tidak', () => {
    expect(chunkNasional({ url: 'https://peraturan.go.id/files/ps96-2018.pdf', instansi: 'RI' })).toBe(true);
    expect(chunkNasional({ url: 'https://dukcapil.kemendagri.go.id/x', instansi: 'Kemendagri' })).toBe(true);
    expect(
      chunkNasional({
        url: 'https://disdukcapil.contoh.go.id/x',
        instansi: 'Disdukcapil Kabupaten Wonogiri',
      }),
    ).toBe(false);
  });

  it('jawaban tanpa wilayah: tidak ditolak gate, generator hanya melihat potongan nasional', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'Apa syarat akta kelahiran?' }),
        fakeCompletion({ content: JSON.stringify({ klaim: [] }) }),
        fakeCompletion({ content: 'KTP Anda terdaftar di kabupaten/kota mana?' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    env.store.saveChunks(u.id, [
      {
        refId: 'nasional#0',
        text: 'Persyaratan pencatatan kelahiran: surat keterangan kelahiran, KK, dan KTP-el orang tua.',
        url: 'https://peraturan.go.id/files/ps96-2018.pdf',
        judul: 'Perpres 96/2018',
        instansi: 'Pemerintah Republik Indonesia',
        verifiedAt: null,
      },
      {
        refId: 'daerah#0',
        text: 'Akta kelahiran di Kota Contoh diurus di Mal Pelayanan Publik lantai 2.',
        url: 'https://disdukcapil.contohkota.go.id/akta',
        judul: 'Akta Kota Contoh',
        instansi: 'Disdukcapil Kota Contoh',
        verifiedAt: null,
      },
    ]);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat akta kelahiran anak?' });
    expect(of(out.events, 'policy_gate')).toHaveLength(0);
    const prompt = JSON.stringify(generator(provider)[0]!.messages);
    expect(prompt).toContain('nasional#0');
    expect(prompt).not.toContain('daerah#0');
    expect(prompt).not.toContain('Mal Pelayanan Publik');
  });
});
