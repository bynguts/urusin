import { MemoryMailer } from '@urusin/akun/testing';
import { FakeProvider, fakeCompletion, type FakeReply } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { dataUrlPeriksa, periksaUnggahan } from './periksa-dokumen';
import { createRuntime } from './runtime';

const NIK = ['3201', '0101', '0190', '0002'].join('');
const SID = 'a'.repeat(32);
const KTX = { ip: '127.0.0.1', userAgent: null };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
const BURAM = JSON.stringify({
  gambar: [
    {
      jenisDokumen: 'Surat Keterangan Kelahiran',
      terbaca: 'sebagian',
      masalah: [
        { bagian: 'judul', jenis: 'buram' },
        { bagian: `bawah dekat ${NIK}`, jenis: 'terpotong' },
      ],
      ringkasan: `NIK ${NIK} terlihat.`,
    },
  ],
});

function siapkan(replies: FakeReply[], visionModel: string | null = 'visi') {
  const provider = new FakeProvider({ replies });
  const rt = createRuntime({
    provider,
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    harness: { visionModel: visionModel ?? undefined },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  const tamu = rt.akun.pastikanTamu(SID, KTX);
  const unggah = (mime = 'image/jpeg', bytes = JPG) => {
    const meta = rt.akun.vault.putDocument(tamu, { jenis: 'akta', judul: 'Akta', mime, bytes });
    return { meta, bytes, mime };
  };
  const periksaDi = (id: string) => rt.akun.vault.listDocuments(tamu).find((d) => d.id === id)?.periksa;
  return { rt, provider, tamu, unggah, periksaDi };
}

describe('periksa foto dokumen brankas', () => {
  it('perlu difoto ulang: hasil ditunggu, disimpan terenkripsi, teks diredaksi, biaya ke batas harian', async () => {
    const s = siapkan([
      fakeCompletion({ content: BURAM, usage: { prompt_tokens: 900, completion_tokens: 80 } }),
    ]);
    const { meta, bytes, mime } = s.unggah();
    const p = await periksaUnggahan(s.rt, s.tamu, meta.id, { mime, bytes }, { tunggu: true });
    expect(p).toMatchObject({
      status: 'perlu_ulang',
      ringkasan: expect.stringMatching(/^Bagian judul buram, /),
    });
    expect(JSON.stringify(p)).not.toContain(NIK);
    expect(s.periksaDi(meta.id)).toEqual(p);
    // Gambar yang dikirim = berkas asli kecil sebagai data URL.
    const c = s.provider.calls[0];
    expect(c?.kind === 'create' && JSON.stringify(c.params)).toContain('data:image/jpeg;base64,');
    expect(s.rt.store.db.prepare('SELECT requests, tokens_in FROM daily_usage').get()).toEqual({
      requests: 1,
      tokens_in: 900,
    });
  });

  it('pratinjau dari perangkat dipakai untuk berkas besar; berkas besar tanpa pratinjau → belum', () => {
    const besar = Buffer.alloc(2_000_000);
    const pratinjau = `data:image/jpeg;base64,${Buffer.from('kecil').toString('base64')}`;
    expect(dataUrlPeriksa('image/jpeg', besar, pratinjau)).toBe(pratinjau);
    expect(dataUrlPeriksa('image/jpeg', besar, undefined)).toBeNull();
    expect(dataUrlPeriksa('image/png', besar, 'data:text/html;base64,PGI+')).toBeNull();
    expect(dataUrlPeriksa('image/png', JPG, null)).toMatch(/^data:image\/png;base64,/);
  });

  it('fail-open: tanpa model vision, galat, atau bukan JSON → belum; PDF tidak diperiksa', async () => {
    const tanpa = siapkan([], null);
    const a = tanpa.unggah();
    expect(await periksaUnggahan(tanpa.rt, tanpa.tamu, a.meta.id, a, { tunggu: true })).toEqual({
      status: 'belum',
      masalah: [],
      ringkasan: '',
    });
    expect(tanpa.provider.calls).toHaveLength(0);

    const galat = siapkan([new Error('offline')]);
    const b = galat.unggah();
    expect((await periksaUnggahan(galat.rt, galat.tamu, b.meta.id, b, { tunggu: true }))?.status).toBe(
      'belum',
    );

    const teks = siapkan([fakeCompletion({ content: 'Fotonya cukup jelas.' })]);
    const c = teks.unggah();
    expect((await periksaUnggahan(teks.rt, teks.tamu, c.meta.id, c, { tunggu: true }))?.status).toBe('belum');

    const pdf = siapkan([]);
    const d = pdf.unggah('application/pdf', Buffer.from('%PDF-1.7'));
    expect(await periksaUnggahan(pdf.rt, pdf.tamu, d.meta.id, d, { tunggu: true })).toBeUndefined();
    expect(pdf.periksaDi(d.meta.id)).toBeUndefined();
  });

  it('tanpa tunggu (lampiran chat): respons tidak menunggu, hasil tersimpan di latar', async () => {
    let lepas!: () => void;
    const tahan = new Promise<void>((r) => (lepas = r));
    const s = siapkan([
      fakeCompletion({ content: '{"gambar":[{"jenisDokumen":"KTP-el","terbaca":"jelas","masalah":[]}]}' }),
    ]);
    const asli = s.provider.create.bind(s.provider);
    s.provider.create = async (...args) => {
      await tahan;
      return asli(...args);
    };
    const { meta, bytes, mime } = s.unggah();
    expect(await periksaUnggahan(s.rt, s.tamu, meta.id, { mime, bytes }, { tunggu: false })).toBeUndefined();
    expect(s.periksaDi(meta.id)).toBeUndefined();
    lepas();
    await expect.poll(() => s.periksaDi(meta.id)?.status).toBe('jelas');
  });

  it('batas tunggu habis: respons tanpa hasil, hasil menyusul di metadata', async () => {
    let lepas!: () => void;
    const tahan = new Promise<void>((r) => (lepas = r));
    const s = siapkan([fakeCompletion({ content: BURAM })]);
    const asli = s.provider.create.bind(s.provider);
    s.provider.create = async (...args) => {
      await tahan;
      return asli(...args);
    };
    const { meta, bytes, mime } = s.unggah();
    expect(
      await periksaUnggahan(s.rt, s.tamu, meta.id, { mime, bytes }, { tunggu: true, tungguMs: 5 }),
    ).toBeUndefined();
    lepas();
    await expect.poll(() => s.periksaDi(meta.id)?.status).toBe('perlu_ulang');
  });
});
