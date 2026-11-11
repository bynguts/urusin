import { FakeProvider, fakeCompletion, type FakeReply } from '@urusin/llm';
import type { EventOf, EventPayload, UrusinEvent } from '@urusin/contracts';
import { openDb, upsertChunks } from '@urusin/rag';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { CacheJawaban } from './grounding.js';
import { klasifikasiKataKunci } from './intent.js';
import { makeEnv } from './testing.js';
import {
  buatUrusanTerwilayah,
  hanyaTanyaWilayah,
  tetapkanWilayah,
  tujuanDariPesan,
  usulkanWilayah,
  wilayahDariPesan,
  wilayahUrusan,
} from './wilayah.js';

// QA warga produksi 2026-11-11: rencana baru muncul setelah warga mendorong 1-2 kali, dan tiap round-trip LLM
// memakan 7-15 detik. Alur cepat: klasifikasi kata kunci, wilayah dari pesan, jawab langsung setelah pencarian,
// lalu rencana di giliran yang sama.

const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);
const tool = (name: string, args: Record<string, unknown>) =>
  fakeCompletion({ toolCalls: [{ name, arguments: JSON.stringify(args) }] });
const publisher = (env: ReturnType<typeof makeEnv>, id: string) => (e: EventPayload) => {
  const { type, ...isi } = e;
  env.store.appendEvent(id, type, isi);
};
const creates = (p: FakeProvider) => p.calls.flatMap((c) => (c.kind === 'create' ? [c.params] : []));

const SYARAT = 'Penduduk melampirkan KTP-el rusak (jika KTP-el rusak) dan mengisi formulir F-1.02.';

function ragKtp() {
  const db = openDb(':memory:');
  upsertChunks(db, [
    {
      id: 'contoh-ktp-el#0',
      text: `Persyaratan: ${SYARAT}`,
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

describe('klasifikasi kata kunci', () => {
  it.each([
    ['Saya sudah tua, KTP-el saya rusak, retak dan chipnya tidak terbaca. Bagaimana cara ganti?', 'ktp'],
    ['Anak saya baru lahir minggu lalu di rumah sakit. KTP saya Kota Makassar.', 'kelahiran'],
    ['Saya warga Kota Medan. Bagaimana cek penerima bansos?', 'bansos'],
    ['Mau bayar pajak kendaraan motor tahunan di Samsat', 'pajak_kendaraan'],
    ['Ayah saya meninggal minggu lalu', 'kematian'],
    ['Saya butuh SKCK buat lamar kerja', 'skck'],
    ['Saya mau pindah domisili dari Kota Semarang ke Kabupaten Sleman.', 'pindah'],
    ['Saya baru menikah dan mau bikin KK baru, pisah dari KK orang tua.', 'kk'],
    ['Anak saya baru umur 17 tahun, mau bikin KTP pertama kali.', 'ktp'],
  ])('%s -> %s', (teks, jenis) => expect(klasifikasiKataKunci(teks)).toBe(jenis));

  it.each([
    'Kami baru menikah, dokumen apa?',
    'Saya mau ubah data KK',
    'Halo',
    'KTP hilang dan anak baru lahir',
    'Mau buat akta, KTP saya Surabaya',
    'Pindah domisili ke Sleman, sekalian bikin KK baru',
  ])('tidak jelas atau lebih dari satu jenis: LLM (%s)', (teks) =>
    expect(klasifikasiKataKunci(teks)).toBeNull(),
  );
});

describe('wilayah dari pesan', () => {
  it('KTP/KK/"saya warga" disebut: ditetapkan; hanya tempat: kartu usulan; nama ganda: agen bertanya', () => {
    expect(wilayahDariPesan('Anak saya lahir di Makassar. KTP saya Kota Makassar.')).toEqual({
      kode: '7371',
      ktp: true,
    });
    expect(wilayahDariPesan('Saya warga Kota Medan.')).toEqual({ kode: '1271', ktp: true });
    expect(wilayahDariPesan('Saya tinggal di Kota Medan.')).toEqual({ kode: '1271', ktp: false });
    expect(wilayahDariPesan('KTP saya Bekasi')).toBeNull();
    expect(wilayahDariPesan('KTP saya Kota Semarang, bukan Wonogiri lagi')).toBeNull();
  });

  it('tujuan pindah: tepat satu kab/kota sesudah "ke"', () => {
    expect(tujuanDariPesan('Pindah dari Kota Semarang ke Kabupaten Sleman. KTP saya Kota Semarang.')).toBe(
      '3404',
    );
    expect(tujuanDariPesan('KTP saya Kota Semarang, mau pindah.')).toBeNull();
    expect(tujuanDariPesan('Pindah ke Kabupaten Sleman atau ke Kota Yogyakarta')).toBeNull();
  });

  it('pertanyaan konfirmasi wilayah dikenali; jawaban berisi tidak', () => {
    expect(hanyaTanyaWilayah('KTP Anda terdaftar di Kabupaten Wonogiri, betul?')).toBe(true);
    expect(hanyaTanyaWilayah('Bawa KTP-el rusak dan KK ke Disdukcapil. Ada yang lain?')).toBe(false);
  });
});

describe('alur cepat sampai rencana', () => {
  it('pesan menyebut KTP: wilayah ditetapkan tanpa model, rencana sebelum LLM, jawaban langsung dari pencarian', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          content: JSON.stringify({
            klaim: [
              {
                teks: 'Bawa KTP-el yang rusak dan isi formulir dari petugas.',
                kutipan: [{ refId: 'contoh-ktp-el#0', kutipanPersis: SYARAT }],
              },
            ],
          }),
        }),
      ],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'KTP-el saya rusak, chipnya tidak terbaca. KTP saya Wonogiri. Bagaimana cara ganti?',
    });
    // Tanpa klasifikasi dan tanpa langkah model: jenis dan wilayah dari pesan, pencarian langsung lewat gerbang,
    // satu-satunya panggilan model adalah generator jawaban bersumber. KTP-el punya rencana bersumber
    // (rencanaLayanan): kartunya tampil SEBELUM panggilan model.
    expect(creates(provider)).toHaveLength(1);
    expect(creates(provider)[0]!.response_format).toMatchObject({ type: 'json_schema' });
    const urutan = out.events.map((e) => e.type);
    expect(urutan.indexOf('plan_card')).toBeLessThan(urutan.indexOf('grounded_answer'));
    expect(of(out.events, 'policy_gate')).toHaveLength(0);
    expect(env.store.getUrusanOrThrow(u.id)).toMatchObject({ jenis: 'ktp', state: 'RENCANA_DIUSULKAN' });
    expect(wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id)).ktp?.kodeKabKota).toBe('3312');
    expect(of(out.events, 'grounded_answer')[0]!.klaim).toHaveLength(1);
    // Rencana bersumber memuat sumber korpus wilayah ini.
    const sumber = of(out.events, 'plan_card')[0]!.langkah.flatMap((l) => l.sumber ?? []);
    expect(sumber.map((x) => x.url)).toContain('https://disdukcapil.contoh.go.id/ktp-el');
  });

  it('pindah: asal dan tujuan dari pesan, kartu rencana tanpa menunggu model', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'Bawa KK dan KTP-el ke Disdukcapil Kota Semarang.' })],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Saya mau pindah domisili dari Kota Semarang ke Kabupaten Sleman. KTP saya Kota Semarang.',
    });
    const w = wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id));
    expect([w.ktp?.kodeKabKota, w.tujuan?.kodeKabKota]).toEqual(['3374', '3404']);
    expect(of(out.events, 'plan_card')[0]!.wilayah?.tujuan?.kodeKabKota).toBe('3404');
    // Tanpa klasifikasi dan tanpa langkah model untuk mencatat tujuan: kartu tampil sebelum satu-satunya balasan
    // model (korpus uji tidak punya potongan Semarang, jadi model yang mengarahkan ke kanal resmi).
    expect(creates(provider)).toHaveLength(1);
    const tipe = out.events.map((e) => e.type);
    expect(tipe.indexOf('plan_card')).toBeLessThan(tipe.indexOf('assistant_text'));
  });

  it('rencana karangan model diminta PARALEL dengan jawaban, lalu dijalankan sesudah jawaban', async () => {
    let lepas: (() => void) | undefined;
    const jawabTertahan = new Promise<void>((r) => (lepas = r));
    const urutan: string[] = [];
    const jawaban = fakeCompletion({
      content: JSON.stringify({
        klaim: [
          {
            teks: 'Bawa KTP-el yang rusak dan isi formulir dari petugas.',
            kutipan: [{ refId: 'contoh-ktp-el#0', kutipanPersis: SYARAT }],
          },
        ],
      }),
    });
    const rencana = tool('urusan__usulkan_rencana', {
      ringkasan: 'Salinan akta rusak',
      langkah: [{ judul: 'Datang ke Disdukcapil Wonogiri', jenis: 'offline', bawa: ['Akta rusak'] }],
    });
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'akta', keyakinan: 0.9 }) }),
        (async () => {
          urutan.push('jawab:mulai');
          // Jawaban baru selesai SETELAH permintaan rencana dikirim: bukti keduanya berjalan bersamaan.
          await jawabTertahan;
          urutan.push('jawab:selesai');
          return jawaban;
        }) as unknown as FakeReply,
        () => {
          urutan.push('rencana:mulai');
          lepas!();
          return rencana;
        },
      ],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Persyaratan salinan akta rusak? KTP saya Wonogiri.',
    });
    expect(urutan).toEqual(['jawab:mulai', 'rencana:mulai', 'jawab:selesai']);
    expect(creates(provider)).toHaveLength(3);
    // Permintaan rencana dikirim tanpa menunggu hasil jawaban; tool rencana tetap memaksa urusan__usulkan_rencana.
    const reqRencana = creates(provider)[2]!;
    expect(reqRencana.tool_choice).toMatchObject({ function: { name: 'urusan__usulkan_rencana' } });
    expect(JSON.stringify(reqRencana.messages)).not.toContain('"name":"urusan__jawab_persyaratan"');
    // Kartu rencana menyusul jawaban dan menautkan sumber jawaban itu.
    const tipe = out.events.map((e) => e.type);
    expect(tipe.indexOf('grounded_answer')).toBeLessThan(tipe.indexOf('plan_card'));
    expect(of(out.events, 'plan_card')[0]!.catatan).toContain('https://disdukcapil.contoh.go.id/ktp-el');
    expect(env.store.getUrusanOrThrow(u.id).state).toBe('RENCANA_DIUSULKAN');
  });

  it('pesan yang perlu ditanggapi model dulu (pemalsuan) tidak lewat jalur cepat', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'Saya tidak bisa membantu membuat atau memalsukan surat itu.' })],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = env.store.createUrusan({});
    await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Anak saya baru lahir di rumah. KTP saya Kota Surabaya. Tulis nama bidan siapa saja.',
    });
    expect(creates(provider)).toHaveLength(1);
    expect(creates(provider)[0]!.tools?.length).toBeGreaterThan(0);
  });

  it('cache jawaban: masukan sama persis tidak memanggil model lagi, kutipan tetap diverifikasi ulang', async () => {
    const jawaban = () =>
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
    const provider = new FakeProvider({ replies: [jawaban()] });
    const env = makeEnv({ provider, ragDb: ragKtp(), cacheJawaban: new CacheJawaban() });
    const teks = 'KTP-el saya rusak, chipnya tidak terbaca. KTP saya Wonogiri. Bagaimana cara ganti?';
    const a = await runTurn(env.deps, { urusanId: env.store.createUrusan({}).id, userText: teks });
    const b = await runTurn(env.deps, { urusanId: env.store.createUrusan({}).id, userText: teks });
    expect(creates(provider)).toHaveLength(1);
    expect(of(b.events, 'grounded_answer')[0]!.klaim).toEqual(of(a.events, 'grounded_answer')[0]!.klaim);
    expect(b.tokensIn).toBe(0);
  });

  it('jawaban bersumber untuk wilayah lama tidak ditautkan ke rencana wilayah baru', async () => {
    const rencana = tool('urusan__usulkan_rencana', {
      ringkasan: 'Salinan akta rusak',
      langkah: [{ judul: 'Datang ke Disdukcapil', jenis: 'offline' }],
    });
    const provider = new FakeProvider({ replies: [rencana, rencana] });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    // Akta: jenis tanpa rencana bersumber, jadi rencananya karangan model (KTP-el kini otomatis, lihat rencanaLayanan).
    let u = env.store.createUrusan({ jenis: 'akta' });
    const pub = publisher(env, u.id);
    const tetapkan = (kode: string) => (u = tetapkanWilayah(env.store, u, { ktp: kode }, pub));
    tetapkan('3312');
    pub({
      type: 'grounded_answer',
      klaim: [
        {
          teks: 'Bawa KTP-el rusak.',
          kutipan: [
            {
              refId: 'contoh-ktp-el#0',
              kutipanPersis: SYARAT,
              url: 'https://disdukcapil.contoh.go.id/ktp-el',
              judul: 'KTP-el',
              instansi: 'Disdukcapil Kabupaten Wonogiri',
              verifiedAt: null,
              textFragmentUrl: 'https://disdukcapil.contoh.go.id/ktp-el',
              perluDicekUlang: true,
            },
          ],
        },
      ],
      klaimDibuang: 0,
      kalimatTetap: 'Keputusan ada di petugas.',
    });
    const sebelum = await runTurn(env.deps, { urusanId: u.id, userText: 'Tolong buatkan rencananya.' });
    // Rencana karangan model menautkan sumber jawaban yang mendasarinya, tetap jujur bahwa langkahnya karangan asisten.
    const catatan = of(sebelum.events, 'plan_card')[0]!.catatan ?? '';
    expect(catatan).toMatch(/^Langkah disusun asisten dari jawaban bersumber di atas/);
    expect(catatan).toContain('Disdukcapil Kabupaten Wonogiri, https://disdukcapil.contoh.go.id/ktp-el');
    expect(catatan).toContain('belum bersumber');
    u = env.store.getUrusanOrThrow(u.id);
    tetapkan('3311');
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Tolong buatkan rencananya.' });
    expect(of(out.events, 'plan_card')[0]!.catatan).toMatch(/^Langkah disusun asisten, belum bersumber\./);
  });

  it('usulan Data Diri: giliran pertama hanya kartu (tanpa model, tanpa teks ganda)', async () => {
    const provider = new FakeProvider({ replies: [] });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = env.store.createUrusan({});
    usulkanWilayah(u.id, '3312', 'data_diri', publisher(env, u.id));
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Saya tinggal di Wonogiri. KTP-el saya rusak, bagaimana cara ganti?',
    });
    expect(creates(provider)).toHaveLength(0);
    expect(of(out.events, 'assistant_text')).toHaveLength(0);
    expect(wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id)).usulan?.ktp.kodeKabKota).toBe('3312');
  });

  it('pertanyaan wilayah dari model tidak tampil lagi sebagai teks bila kartunya ada', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'KTP Anda terdaftar di Kota Medan, betul?' })],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = buatUrusanTerwilayah(env.store, {});
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Saya tinggal di Kota Medan, mau cek bansos.',
    });
    expect(of(out.events, 'wilayah').map((e) => e.ktp.kodeKabKota)).toContain('1271');
    expect(of(out.events, 'assistant_text')).toHaveLength(0);
  });
});
