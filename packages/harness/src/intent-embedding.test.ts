import { normalisasi, type Penyemat } from '@urusin/embedding';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { klasifikasiKataKunci } from './intent.js';
import { AMBANG_INTENT, buatKlasifikasiIntent, type KlasifikasiIntentEmbedding } from './intent-embedding.js';
import { PROTOTIPE_INTENT } from './intent-prototipe.js';
import { makeEnv } from './testing.js';

/**
 * Penyemat palsu: tiap prototipe jenis `kia` dipetakan ke sumbu 0, jenis lain ke sumbu 1; kueri berisi "kartu"
 * ke sumbu 0, kueri lain ke vektor di tengah (skor rendah, margin nol).
 */
const penyematPalsu = (o: { mati?: boolean } = {}): Penyemat => {
  const kia = new Set(PROTOTIPE_INTENT.kia);
  return {
    semat: (teks) => {
      if (o.mati) return Promise.resolve(null);
      return Promise.resolve(
        teks.map((t) => {
          if (t.includes('query: ')) return normalisasi(t.includes('kartu') ? [1, 0] : [1, 1])!;
          return normalisasi([...kia].some((p) => t.endsWith(p)) ? [1, 0] : [0, 1])!;
        }),
      );
    },
  };
};

describe('buatKlasifikasiIntent', () => {
  it('yakin = jenis; tidak yakin (skor/margin di bawah ambang) = null', async () => {
    const k = buatKlasifikasiIntent(penyematPalsu());
    expect(await k.panaskan()).toBe(true);
    expect(await k.klasifikasi('anak tk disuruh bikin kartu identitas')).toBe('kia');
    expect(await k.klasifikasi('halo apa kabar')).toBeNull();
  });

  it('fail-open: sidecar mati atau penyemat melempar = null (klasifikasi kembali ke LLM)', async () => {
    const mati = buatKlasifikasiIntent(penyematPalsu({ mati: true }));
    expect(await mati.panaskan()).toBe(false);
    expect(await mati.klasifikasi('bikin kartu anak')).toBeNull();
    const lempar = buatKlasifikasiIntent({ semat: () => Promise.reject(new Error('boom')) });
    expect(await lempar.klasifikasi('bikin kartu anak')).toBeNull();
  });

  it('ambang ketat dan prototipe tidak memuat `lainnya`', () => {
    expect(AMBANG_INTENT.skor).toBeGreaterThan(0);
    expect(AMBANG_INTENT.margin).toBeGreaterThan(0);
    expect(Object.keys(PROTOTIPE_INTENT)).not.toContain('lainnya');
  });
});

describe('agen: jalur cepat embedding setelah kata kunci', () => {
  const TEKS = 'anak tk disuruh bikin kartu identitas';
  const namaSkema = (p: FakeProvider) =>
    p.calls.flatMap((c) =>
      c.kind === 'create' && c.params.response_format?.type === 'json_schema'
        ? [c.params.response_format.json_schema.name]
        : [],
    );

  async function jalankan(intentEmbedding: KlasifikasiIntentEmbedding | undefined) {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'kk', keyakinan: 0.9 }) }),
        ...Array.from({ length: 6 }, () => fakeCompletion({ content: 'Baik.' })),
      ],
    });
    const env = makeEnv({ provider, ...(intentEmbedding ? { intentEmbedding } : {}) });
    const u = env.store.createUrusan({});
    await runTurn(env.deps, { urusanId: u.id, userText: TEKS });
    return { provider, jenis: env.store.getUrusanOrThrow(u.id).jenis };
  }

  it('prasyarat: kata kunci tidak mengenali pesan ini', () => {
    expect(klasifikasiKataKunci(TEKS)).toBeNull();
  });

  it('embedding yakin: jenis diambil tanpa panggilan klasifikasi LLM', async () => {
    const k = buatKlasifikasiIntent(penyematPalsu());
    await k.panaskan();
    const r = await jalankan(k);
    expect(r.jenis).toBe('kia');
    expect(namaSkema(r.provider)).not.toContain('klasifikasi_urusan');
  });

  it.each<[string, KlasifikasiIntentEmbedding | undefined]>([
    ['tanpa sidecar', undefined],
    ['sidecar mati', buatKlasifikasiIntent(penyematPalsu({ mati: true }))],
    ['tidak yakin', { klasifikasi: () => Promise.resolve(null), panaskan: () => Promise.resolve(true) }],
    [
      'melempar',
      { klasifikasi: () => Promise.reject(new Error('x')), panaskan: () => Promise.resolve(true) },
    ],
  ])('%s: tanpa klasifikasi LLM terpisah, jenis dibiarkan untuk ditetapkan model', async (_n, k) => {
    const r = await jalankan(k);
    // Tidak ada lagi round-trip klasifikasi terstruktur; model menetapkan jenis lewat urusan__tetapkan_jenis.
    expect(namaSkema(r.provider)).not.toContain('klasifikasi_urusan');
    expect(r.jenis).toBeNull();
  });
});
