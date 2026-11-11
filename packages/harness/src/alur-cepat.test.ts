import { FakeProvider, fakeCompletion } from '@urusin/llm';
import type { EventOf, EventPayload, UrusinEvent } from '@urusin/contracts';
import { openDb, upsertChunks } from '@urusin/rag';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { klasifikasiKataKunci } from './intent.js';
import { makeEnv } from './testing.js';
import {
  buatUrusanTerwilayah,
  hanyaTanyaWilayah,
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
  ])('%s -> %s', (teks, jenis) => expect(klasifikasiKataKunci(teks)).toBe(jenis));

  it.each([
    'Kami baru menikah, dokumen apa?',
    'Saya mau ubah data KK',
    'Halo',
    'KTP hilang dan anak baru lahir',
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

  it('pertanyaan konfirmasi wilayah dikenali; jawaban berisi tidak', () => {
    expect(hanyaTanyaWilayah('KTP Anda terdaftar di Kabupaten Wonogiri, betul?')).toBe(true);
    expect(hanyaTanyaWilayah('Bawa KTP-el rusak dan KK ke Disdukcapil. Ada yang lain?')).toBe(false);
  });
});

describe('alur cepat sampai rencana', () => {
  it('pesan menyebut KTP: wilayah ditetapkan tanpa model, jawaban langsung setelah pencarian, rencana di giliran yang sama', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('rag__cari_pengetahuan', { query: 'syarat ganti KTP-el rusak' }),
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
        tool('urusan__usulkan_rencana', {
          ringkasan: 'Ganti KTP-el rusak',
          langkah: [{ judul: 'Datang ke Disdukcapil Wonogiri', jenis: 'offline', bawa: ['KTP-el rusak'] }],
        }),
      ],
    });
    const env = makeEnv({ provider, ragDb: ragKtp() });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'KTP-el saya rusak, chipnya tidak terbaca. KTP saya Wonogiri. Bagaimana cara ganti?',
    });
    // Tanpa panggilan klasifikasi; satu langkah model, generator jawaban, lalu rencana yang dipaksa.
    const calls = creates(provider);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.tool_choice).toEqual({
      type: 'function',
      function: { name: 'urusan__usulkan_rencana' },
    });
    expect(env.store.getUrusanOrThrow(u.id)).toMatchObject({ jenis: 'ktp', state: 'RENCANA_DIUSULKAN' });
    expect(wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id)).ktp?.kodeKabKota).toBe('3312');
    expect(of(out.events, 'grounded_answer')).toHaveLength(1);
    expect(of(out.events, 'plan_card')).toHaveLength(1);
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
