import { FakeProvider, fakeCompletion } from '@urusin/llm';
import type { EventOf, UrusinEvent } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { BALASAN_DI_LUAR_URUSAN, mintaDiLuarUrusan } from './intent.js';
import { makeEnv } from './testing.js';

// Bug produksi: "buatkan aku script python" dijawab dengan game tebak angka. Urusin bukan asisten serba bisa.

const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);

const DITOLAK = [
  'buatkan aku script python',
  'Tolong bikinin script buat scraping web',
  'tulis kode javascript untuk kalkulator',
  'bikin program python tebak angka dong',
  'Buatkan codingan login pakai PHP',
  'gimana kode html buat bikin tombol',
  'Kerjakan PR matematika saya ya',
  'tolong kerjain tugas sekolah anak saya',
  'jawabin soal ujian fisika ini',
  'Buatkan puisi tentang ibu',
  'tuliskan esai 500 kata tentang lingkungan',
  'bikinin cerpen horor',
  'buatkan game tebak angka',
  'ayo main tebak-tebakan',
];

const DIIZINKAN = [
  'Gimana cara foto KTP yang benar buat diunggah?',
  'Ada contoh surat pengantar RT untuk pindah domisili?',
  'Jam buka Disdukcapil Wonogiri jam berapa?',
  'Buatkan surat kuasa untuk mengambil KTP-el saya',
  'Tolong tuliskan daftar dokumen untuk akta kelahiran',
  'Mau bikin KK baru, syaratnya apa?',
  'Program bansos PKH syaratnya apa?',
  'Kode pos Wonogiri berapa?',
  'Kode formulir F-1.02 itu untuk apa?',
  'Anak saya dapat PR dari sekolah, disuruh fotokopi akta kelahiran',
  'Saya baru selesai ujian, mau bikin SKCK buat daftar kerja',
  'Bikin KTP buat anak saya yang baru 17 tahun',
  'Halo, selamat pagi',
  'Terima kasih ya',
  'Kode verifikasi dari aplikasi IKD tidak masuk',
];

describe('mintaDiLuarUrusan', () => {
  it.each(DITOLAK)('ditolak: %s', (teks) => expect(mintaDiLuarUrusan(teks)).toBe(true));
  it.each(DIIZINKAN)('diizinkan: %s', (teks) => expect(mintaDiLuarUrusan(teks)).toBe(false));
});

describe('agen: permintaan di luar urusan', () => {
  it('dibalas penolakan tetap tanpa memanggil LLM, jenis urusan tidak diisi', async () => {
    const provider = new FakeProvider({ replies: [] });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'buatkan aku script python' });
    expect(provider.calls.filter((c) => c.kind === 'create')).toHaveLength(0);
    expect(of(out.events, 'assistant_text').map((e) => e.delta)).toEqual([BALASAN_DI_LUAR_URUSAN]);
    expect(BALASAN_DI_LUAR_URUSAN).not.toMatch(/python|def |print\(/i);
    expect(env.store.getUrusanOrThrow(u.id).jenis).toBeNull();
  });

  it('pesan urusan tetap ke model', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'lainnya', keyakinan: 0.6 }) }),
        fakeCompletion({ content: 'Disdukcapil buka Senin-Jumat.' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Jam buka Disdukcapil jam berapa?' });
    expect(provider.calls.filter((c) => c.kind === 'create').length).toBeGreaterThan(0);
    expect(of(out.events, 'assistant_text').map((e) => e.delta)).not.toContain(BALASAN_DI_LUAR_URUSAN);
  });
});
