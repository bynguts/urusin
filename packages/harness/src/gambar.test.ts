import { FakeProvider, fakeCompletion, type ChatParams } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { bacaGambar } from './gambar.js';
import { FAKE_NIK, dumpDb, makeEnv } from './testing.js';
import { buatUrusanTerwilayah } from './wilayah.js';

/** Data URL JPEG kecil (isi tidak penting untuk FakeProvider). */
const GAMBAR = `data:image/jpeg;base64,${Buffer.from('gambar-uji').toString('base64')}`;
const DESKRIPSI = `Surat Keterangan Pindah dari Kelurahan Sukamaju, nomor 474/123/2026. NIK ${FAKE_NIK} terlihat.`;

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
