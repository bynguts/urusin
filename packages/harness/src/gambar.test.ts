import { FakeProvider, fakeCompletion, type ChatParams } from '@urusin/llm';
import { openDb, upsertChunks } from '@urusin/rag';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import {
  bacaGambar,
  bersihkanTeksFoto,
  peringatanFoto,
  periksaFoto,
  uraiBacaanFoto,
  type BacaanFoto,
} from './gambar.js';
import { DATAMARK } from './spotlight.js';
import { FAKE_NIK, dumpDb, makeEnv } from './testing.js';
import { buatUrusanTerwilayah } from './wilayah.js';

/** Data URL JPEG kecil (isi tidak penting untuk FakeProvider). */
const GAMBAR = `data:image/jpeg;base64,${Buffer.from('gambar-uji').toString('base64')}`;
const DESKRIPSI = `Surat Keterangan Pindah dari Kelurahan Sukamaju, nomor 474/123/2026. NIK ${FAKE_NIK} terlihat.`;
/** Teks di dalam blok spotlight: spasi diganti DATAMARK. */
const dm = (s: string) => s.split(' ').join(DATAMARK);
/** Bacaan vision foto akta yang buram dan terpotong (bentuk keluaran model di produksi). */
const BACAAN_BURAM = {
  gambar: [
    {
      jenisDokumen: 'Surat Keterangan Kelahiran',
      terbaca: 'sebagian',
      masalah: [
        { bagian: 'judul', jenis: 'buram' },
        { bagian: 'data bayi', jenis: 'buram' },
        { bagian: 'bagian bawah', jenis: 'terpotong' },
      ],
      ringkasan: `Surat keterangan kelahiran dari RSUD Wonogiri. NIK ${FAKE_NIK} terlihat.`,
    },
  ],
};

const adaGambar = (p: ChatParams) =>
  p.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => (c as { type?: string }).type === 'image_url'),
  );

/** Panggilan bergambar → deskripsi vision; panggilan lain (agen) → balasan teks. */
function provider(
  vision: () => ReturnType<typeof fakeCompletion> | Error = () => fakeCompletion({ content: DESKRIPSI }),
) {
  const balas = (p: ChatParams) =>
    adaGambar(p) ? vision() : fakeCompletion({ content: 'Itu surat pindah.' });
  return new FakeProvider({ replies: Array.from({ length: 8 }, () => balas) });
}

const creates = (p: FakeProvider) => p.calls.flatMap((c) => (c.kind === 'create' ? [c.params] : []));
const pesanAgen = (p: FakeProvider) =>
  creates(p)
    .filter((c) => !adaGambar(c))
    .map((c) => JSON.stringify(c.messages));

function setup(p: FakeProvider, visionModel?: string) {
  const env = makeEnv({ provider: p, ...(visionModel ? { visionModel } : {}) });
  const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3276', jenis: 'skck' });
  return { env, u };
}

describe('gambar lampiran chat dibaca model vision', () => {
  it('vision dipanggil sekali dengan model vision; deskripsi masuk konteks agen (spotlight, NIK diredaksi)', async () => {
    const p = provider();
    const { env, u } = setup(p, 'visi');
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: '[warga melampirkan dokumen: Dokumen lain (gambar)]\nbisa lihat ini ga',
      gambar: [GAMBAR],
    });
    expect(out.status).toBe('selesai');
    const visi = creates(p).filter(adaGambar);
    expect(visi).toHaveLength(1);
    expect(visi[0]!.model).toBe('visi');
    expect(out.events.some((e) => e.type === 'progress' && e.label === 'Membaca gambar lampiran…')).toBe(
      true,
    );

    const agen = pesanAgen(p);
    expect(agen.length).toBeGreaterThan(0);
    const prompt = agen.at(-1)!;
    expect(prompt).toContain('DATA_TAK_TEPERCAYA');
    expect(prompt).toContain('Sukamaju');
    expect(prompt).not.toContain(FAKE_NIK);
    // Agen tidak menerima piksel: hanya panggilan vision yang membawa image_url.
    expect(
      creates(p)
        .filter((c) => !adaGambar(c))
        .every((c) => !JSON.stringify(c).includes('image_url')),
    ).toBe(true);

    // Riwayat tersimpan memuat deskripsi (turn berikutnya tetap tahu isinya), tanpa NIK dan tanpa data URL.
    const db = dumpDb(env.store.db);
    expect(db).toContain('Sukamaju');
    expect(db).not.toContain(FAKE_NIK);
    expect(db).not.toContain(GAMBAR);
  });

  it('tanpa model vision: tidak ada panggilan bergambar, agen diminta berterus terang', async () => {
    const p = provider();
    const { env, u } = setup(p);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ini apa?', gambar: [GAMBAR] });
    expect(out.status).toBe('selesai');
    expect(creates(p).filter(adaGambar)).toHaveLength(0);
    expect(pesanAgen(p).at(-1)).toContain('BELUM bisa dibaca');
  });

  it('vision galat: turn tetap selesai dan agen diminta berterus terang', async () => {
    const p = provider(() => new Error('model_offline'));
    const { env, u } = setup(p, 'visi');
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ini apa?', gambar: [GAMBAR] });
    expect(out.status).toBe('selesai');
    expect(creates(p).filter(adaGambar)).toHaveLength(1);
    expect(pesanAgen(p).at(-1)).toContain('BELUM bisa dibaca');
  });

  it('lampiran PDF tanpa gambar: catatan bahwa isinya belum bisa dibaca', async () => {
    const p = provider();
    const { env, u } = setup(p, 'visi');
    await runTurn(env.deps, {
      urusanId: u.id,
      userText: '[warga melampirkan dokumen: Surat (PDF)]\ntolong cek ini',
    });
    expect(creates(p).filter(adaGambar)).toHaveLength(0);
    expect(pesanAgen(p).at(-1)).toContain('BELUM bisa dibaca');
  });

  it('bacaan JSON dengan masalah: peringatan tetap tampil lebih dulu, jawaban bersumber diberi tahu', async () => {
    const SYARAT = 'Persyaratan: surat keterangan lahir dari rumah sakit atau bidan dan KK orang tua.';
    const rag = openDb(':memory:');
    upsertChunks(rag, [
      {
        id: 'contoh-akta#0',
        text: SYARAT,
        sourceRef: {
          url: 'https://disdukcapil.contoh.go.id/akta',
          judul: 'Akta Kelahiran › persyaratan',
          instansi: 'Disdukcapil Kabupaten Wonogiri',
        },
        verifiedAt: '2026-11-10T00:00:00.000Z',
        kodeWilayah: '3312',
        layanan: 'adminduk',
      },
    ]);
    const balas = (p: ChatParams) => {
      if (adaGambar(p))
        return fakeCompletion({ content: '```json\n' + JSON.stringify(BACAAN_BURAM) + '\n```' });
      const isi = JSON.stringify(p.messages);
      if (isi.includes('Kamu menyusun jawaban persyaratan'))
        return fakeCompletion({
          content: JSON.stringify({
            klaim: [
              {
                teks: 'Siapkan surat keterangan lahir dari rumah sakit atau bidan.',
                kutipan: [
                  { refId: 'contoh-akta#0', kutipanPersis: 'surat keterangan lahir dari rumah sakit' },
                ],
              },
            ],
            handoff: null,
          }),
        });
      if (!p.messages.some((m) => m.role === 'tool'))
        return fakeCompletion({
          toolCalls: [
            {
              name: 'rag__cari_pengetahuan',
              arguments: JSON.stringify({ query: 'syarat akta kelahiran', layanan: 'adminduk' }),
            },
          ],
        });
      return fakeCompletion({ content: 'Baik.' });
    };
    const p = new FakeProvider({ replies: Array.from({ length: 12 }, () => balas) });
    const env = makeEnv({ provider: p, visionModel: 'visi', ragDb: rag });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'kelahiran' });
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: '[warga melampirkan dokumen: Surat (gambar)]\nini bisa dipakai buat akta?',
      gambar: [GAMBAR],
    });
    expect(out.status).toBe('selesai');

    const teks = out.events.filter((e) => e.type === 'assistant_text');
    expect(teks[0]).toMatchObject({
      utuh: true,
      delta:
        'Foto Surat Keterangan Kelahiran belum jelas: bagian judul dan data bayi buram, bagian bawah terpotong. ' +
        'Foto ulang di tempat terang, kertas rata, ponsel dipegang diam sampai fokus, seluruh halaman masuk bingkai.',
    });
    // Peringatan terbit sebelum jawaban bersumber.
    const idxPeringatan = out.events.indexOf(teks[0]!);
    const idxJawaban = out.events.findIndex((e) => e.type === 'grounded_answer');
    expect(idxJawaban).toBeGreaterThan(idxPeringatan);

    // Agen: kondisi foto di data spotlight + larangan menyatakan dokumen dapat dipakai.
    const agen = pesanAgen(p).find((s) => !s.includes('Kamu menyusun jawaban persyaratan'))!;
    expect(agen).toContain(dm('Kondisi foto: bagian judul dan data bayi buram'));
    expect(agen).toContain('JANGAN menyatakan dokumen atau foto warga sah');
    expect(agen).not.toContain(FAKE_NIK);
    // Jawaban bersumber: catatan kualitas foto (spotlight) + larangan klaim "dapat dipakai".
    const jawab = pesanAgen(p).find((s) => s.includes('Kamu menyusun jawaban persyaratan'))!;
    expect(jawab).toContain('BELUM JELAS');
    expect(jawab).toContain('JANGAN membuat klaim bahwa dokumen atau foto warga');
    expect(jawab).toContain('kualitas_foto');
  });

  it('bacaan JSON jelas: tidak ada peringatan, isi tetap masuk konteks', async () => {
    const p = provider(() =>
      fakeCompletion({
        content: JSON.stringify({
          gambar: [
            { jenisDokumen: 'KTP-el', terbaca: 'jelas', masalah: [], ringkasan: 'KTP-el Kota Bekasi.' },
          ],
        }),
      }),
    );
    const { env, u } = setup(p, 'visi');
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ini KTP saya', gambar: [GAMBAR] });
    expect(out.status).toBe('selesai');
    expect(out.events.some((e) => e.type === 'assistant_text' && e.delta.includes('belum jelas'))).toBe(
      false,
    );
    const prompt = pesanAgen(p).at(-1)!;
    expect(prompt).toContain(dm('Kondisi foto: jelas'));
    expect(prompt).not.toContain('JANGAN menyatakan dokumen');
  });

  it('bacaGambar menolak data URL yang bukan gambar base64', async () => {
    const p = provider();
    const r = await bacaGambar({
      provider: p,
      model: 'visi',
      gambar: ['data:text/html;base64,PGI+', 'https://contoh.invalid/a.jpg'],
      pertanyaan: '',
      signal: new AbortController().signal,
    });
    expect(r.ok).toBe(false);
    expect(p.calls).toHaveLength(0);
  });
});

const foto = (o: Partial<BacaanFoto>): BacaanFoto => ({
  jenisDokumen: 'KTP-el',
  terbaca: 'jelas',
  masalah: [],
  ringkasan: '',
  ...o,
});

describe('uraiBacaanFoto: keluaran vision diurai dengan toleran', () => {
  it('objek {gambar}, berpagar ```json, dengan teks pengantar', () => {
    const r = uraiBacaanFoto(`Berikut hasilnya:\n\`\`\`json\n${JSON.stringify(BACAAN_BURAM)}\n\`\`\``);
    expect(r).toHaveLength(1);
    expect(r![0]).toMatchObject({
      jenisDokumen: 'Surat Keterangan Kelahiran',
      terbaca: 'sebagian',
      masalah: [
        { bagian: 'judul', jenis: 'buram' },
        { bagian: 'data bayi', jenis: 'buram' },
        { bagian: 'bagian bawah', jenis: 'terpotong' },
      ],
    });
  });

  it('array atau satu objek; sinonim jenis dipetakan, jenis tak dikenal dibuang, terbaca diturunkan', () => {
    const arr = uraiBacaanFoto(
      JSON.stringify([
        {
          jenisDokumen: 'KK',
          masalah: [
            { bagian: 'pojok kiri', jenis: 'Blur' },
            { bagian: 'x', jenis: 'jelek' },
          ],
        },
        { jenisDokumen: 'KTP-el', terbaca: 'jelas', masalah: [] },
      ]),
    );
    expect(arr).toEqual([
      {
        jenisDokumen: 'KK',
        terbaca: 'sebagian',
        masalah: [{ bagian: 'pojok kiri', jenis: 'buram' }],
        ringkasan: '',
      },
      { jenisDokumen: 'KTP-el', terbaca: 'jelas', masalah: [], ringkasan: '' },
    ]);
    expect(uraiBacaanFoto('{"jenisDokumen":"Akta","terbaca":"tidak","masalah":[]}')).toEqual([
      { jenisDokumen: 'Akta', terbaca: 'tidak', masalah: [], ringkasan: '' },
    ]);
  });

  it('bukan JSON atau kosong: null (jalur teks lama)', () => {
    expect(uraiBacaanFoto(DESKRIPSI)).toBeNull();
    expect(uraiBacaanFoto('{"gambar": [')).toBeNull();
    expect(uraiBacaanFoto('{"gambar": []}')).toBeNull();
    expect(uraiBacaanFoto('[1, "a", null]')).toBeNull();
  });

  it('teks dari gambar dibersihkan: tanpa URL/markup, satu baris, dibatasi', () => {
    expect(bersihkanTeksFoto('bagian <b>bawah</b>\nklik https://jahat.example/x', 40)).toBe(
      'bagian b bawah /b klik',
    );
    expect(bersihkanTeksFoto('a'.repeat(100), 40)).toHaveLength(40);
    expect(bersihkanTeksFoto(42, 40)).toBe('');
  });
});

describe('peringatanFoto: kalimat tetap untuk warga', () => {
  it('satu foto: bagian per jenis masalah + saran foto ulang', () => {
    expect(peringatanFoto(uraiBacaanFoto(JSON.stringify(BACAAN_BURAM))!)).toBe(
      'Foto Surat Keterangan Kelahiran belum jelas: bagian judul dan data bayi buram, bagian bawah terpotong. ' +
        'Foto ulang di tempat terang, kertas rata, ponsel dipegang diam sampai fokus, seluruh halaman masuk bingkai.',
    );
  });

  it('beberapa foto: "Foto #n (jenis)" sesuai urutan lampiran; foto yang jelas tidak disebut', () => {
    const teks = peringatanFoto([
      foto({ jenisDokumen: 'KTP-el' }),
      foto({ jenisDokumen: 'Kartu Keluarga', masalah: [{ bagian: 'kanan atas', jenis: 'silau' }] }),
      foto({ jenisDokumen: '', terbaca: 'tidak' }),
    ]);
    expect(teks).toBe(
      'Foto #2 (Kartu Keluarga) belum jelas: bagian kanan atas silau kena pantulan cahaya. ' +
        'Foto #3 belum jelas: tulisannya belum terbaca. ' +
        'Foto ulang di tempat terang, kertas rata, tanpa lampu kilat, seluruh halaman masuk bingkai.',
    );
  });

  it('semua jelas: null; tanpa bagian: "fotonya ..."', () => {
    expect(peringatanFoto([foto({}), foto({ jenisDokumen: 'KK' })])).toBeNull();
    expect(peringatanFoto([foto({ masalah: [{ bagian: '', jenis: 'gelap' }] })])).toBe(
      'Foto KTP-el belum jelas: fotonya terlalu gelap. Foto ulang di tempat terang, kertas rata, seluruh halaman masuk bingkai.',
    );
  });
});

describe('periksaFoto: pemeriksaan foto dokumen brankas', () => {
  const periksa = (p: FakeProvider, model: string | undefined = 'visi') =>
    periksaFoto({ provider: p, model, gambar: GAMBAR, signal: new AbortController().signal });

  it('perlu difoto ulang: masalah + kalimat pendek, NIK di teks diredaksi', async () => {
    const bacaan = structuredClone(BACAAN_BURAM);
    bacaan.gambar[0]!.masalah.push({ bagian: `nomor ${FAKE_NIK}`, jenis: 'tertutup' });
    const p = new FakeProvider({ replies: [fakeCompletion({ content: JSON.stringify(bacaan) })] });
    const r = await periksa(p);
    expect(r.status).toBe('perlu_ulang');
    expect(r.ringkasan).toMatch(/^Bagian judul dan data bayi buram, bagian bawah terpotong, bagian nomor /);
    expect(JSON.stringify(r)).not.toContain(FAKE_NIK);
    expect(r.masalah).toHaveLength(4);
    expect(p.calls).toHaveLength(1);
  });

  it('jelas: status jelas dengan jenis dokumennya', async () => {
    const p = new FakeProvider({
      replies: [
        fakeCompletion({ content: '{"gambar":[{"jenisDokumen":"KTP-el","terbaca":"jelas","masalah":[]}]}' }),
      ],
    });
    expect(await periksa(p)).toMatchObject({
      status: 'jelas',
      masalah: [],
      ringkasan: 'KTP-el terbaca jelas',
    });
  });

  it('fail-open: tanpa model, galat, atau bukan JSON → belum (tanpa klaim)', async () => {
    const belum = { status: 'belum', masalah: [], ringkasan: '' };
    expect(await periksa(new FakeProvider({ replies: [] }), undefined)).toMatchObject(belum);
    expect(await periksa(new FakeProvider({ replies: [new Error('offline')] }))).toMatchObject(belum);
    expect(
      await periksa(new FakeProvider({ replies: [fakeCompletion({ content: 'Fotonya cukup jelas.' })] })),
    ).toMatchObject(belum);
  });
});
