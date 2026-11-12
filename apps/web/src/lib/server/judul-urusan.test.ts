import { HarnessStore, openHarnessDb } from '@urusin/harness';
import { FakeProvider, fakeCompletion, type ChatParams, type ChatProvider } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import {
  buatJudulUrusan,
  judulCadangan,
  judulDemo,
  mintaJudul,
  sanitasiMasukan,
  validasiJudul,
} from './judul-urusan';

// Data uji dirakit saat runtime (pemindai PII repo menolak NIK/HP literal).
const NIK = ['3312', '0101', '0101', '0001'].join('');
const HP = ['0812', '3456', '7890'].join('');
const EMAIL = ['budi', 'contoh.id'].join('@');
const CAPS = { json_schema_strict: true, tools: true };

const balas = (judul: string) => fakeCompletion({ content: JSON.stringify({ judul }) });

function siapkan(pesan: string, opsi: { jenis?: string; kode?: string } = {}) {
  const store = new HarnessStore(openHarnessDb());
  const u = store.createUrusan({ jenis: opsi.jenis, kodeKabKota: opsi.kode });
  const t = store.claimTurn(u.id, pesan);
  store.finishTurn(t.turnId, {
    status: 'done',
    messages: [],
    tokensIn: 0,
    tokensOut: 0,
    costIdr: 0,
    degraded: false,
  });
  return { store, id: u.id };
}

/** Isi pesan `user` yang benar-benar dikirim ke model. */
const kirimanKeModel = (p: FakeProvider) =>
  p.calls
    .flatMap((c) => (c.kind === 'create' ? (c.params as ChatParams).messages : []))
    .map((m) => JSON.stringify(m));

describe('sanitasiMasukan', () => {
  it('NIK, HP, email, angka panjang, nama, dan alamat tidak sampai ke model', () => {
    const { teks, nama } = sanitasiMasukan(
      `Nama saya Budi Santoso, NIK ${NIK}, HP ${HP}, email ${EMAIL}, tinggal di Jl. Melati 5 RT 03. ` +
        'Mau urus akta lahir anak kedua, nomor resi 99887766.',
    );
    expect(teks).not.toContain(NIK);
    expect(teks).not.toContain(HP);
    expect(teks).not.toContain(EMAIL);
    expect(teks).not.toContain('Budi');
    expect(teks).not.toContain('Melati');
    expect(teks).not.toMatch(/\d{5,}/);
    expect(teks).toContain('akta lahir anak kedua');
    expect(nama).toEqual(expect.arrayContaining(['budi', 'santoso']));
  });

  it('nama setelah Pak/Bu/atas nama ikut disamarkan', () => {
    const { teks, nama } = sanitasiMasukan('Akta kematian atas nama Siti Aminah, ayah saya Pak Joko');
    expect(teks).not.toMatch(/Siti|Aminah|Joko/);
    expect(nama).toEqual(expect.arrayContaining(['siti', 'aminah', 'joko']));
  });
});

describe('validasiJudul', () => {
  it('2–6 kata lolos, tanda kutip/titik dibuang', () => {
    expect(validasiJudul('"Akta lahir anak kedua."')).toBe('Akta lahir anak kedua');
    expect(validasiJudul('Pindah Surabaya ke Malang')).toBe('Pindah Surabaya ke Malang');
  });

  it('terlalu pendek/panjang, PII, alamat, angka panjang, atau nama terlarang → null', () => {
    expect(validasiJudul('Akta')).toBeNull();
    expect(validasiJudul('satu dua tiga empat lima enam tujuh')).toBeNull();
    expect(validasiJudul(`KTP ${NIK} hilang`)).toBeNull();
    expect(validasiJudul(`Hubungi ${HP} soal KK`)).toBeNull();
    expect(validasiJudul('KK baru di Jl. Melati 5')).toBeNull();
    expect(validasiJudul('KTP hilang RT 03 Depok')).toBeNull();
    expect(validasiJudul('Akta lahir untuk Budi', ['budi'])).toBeNull();
    expect(validasiJudul('{{PEMOHON.NIK}} akta lahir')).toBeNull();
  });
});

describe('judulCadangan', () => {
  it('jenis + wilayah, lalu jenis saja, lalu wilayah, lalu umum', () => {
    expect(judulCadangan('kelahiran', '3312')).toBe('Akta kelahiran · Wonogiri');
    expect(judulCadangan('kelahiran', null)).toBe('Akta kelahiran');
    expect(judulCadangan(null, '3578')).toBe('Urusan · Surabaya');
    expect(judulCadangan(null, null)).toBe('Urusan baru');
  });
});

describe('mintaJudul', () => {
  it('judul model yang lolos validasi dipakai; masukan model sudah disanitasi', async () => {
    const provider = new FakeProvider({ replies: [balas('Akta lahir anak kedua')] });
    const j = await mintaJudul(
      { provider, model: 'm', caps: CAPS },
      { pesan: `NIK ${NIK} mau akta lahir anak kedua`, jenis: 'kelahiran', kodeKabKota: '3312' },
    );
    expect(j).toBe('Akta lahir anak kedua');
    const terkirim = kirimanKeModel(provider).join('\n');
    expect(terkirim).not.toContain(NIK);
    expect(terkirim).toContain('Akta kelahiran');
    expect(terkirim).toContain('Wonogiri');
  });

  it('keluaran model berisi PII → null (pemanggil memakai cadangan)', async () => {
    const provider = new FakeProvider({ replies: [balas(`KTP hilang ${HP}`)] });
    expect(
      await mintaJudul(
        { provider, model: 'm', caps: CAPS },
        { pesan: 'KTP hilang', jenis: 'ktp', kodeKabKota: null },
      ),
    ).toBeNull();
  });

  it('model tidak menjawab dalam batas waktu → null tanpa menunggu lama', async () => {
    const macet: ChatProvider = {
      baseURL: 'x',
      create: () => new Promise(() => undefined),
      stream: () => new Promise(() => undefined),
      transcribe: () => Promise.reject(new Error('x')),
      embed: () => Promise.reject(new Error('x')),
    };
    const mulai = Date.now();
    expect(
      await mintaJudul(
        { provider: macet, model: 'm', caps: CAPS },
        { pesan: 'KTP hilang', jenis: null, kodeKabKota: null },
        50,
      ),
    ).toBeNull();
    expect(Date.now() - mulai).toBeLessThan(1000);
  });

  it('galat provider → null', async () => {
    const provider = new FakeProvider({ replies: [new Error('503')] as never });
    expect(
      await mintaJudul(
        { provider, model: 'm', caps: CAPS },
        { pesan: 'KTP hilang', jenis: null, kodeKabKota: null },
      ),
    ).toBeNull();
  });
});

describe('buatJudulUrusan', () => {
  it('menyimpan judul AI sekali setelah turn pertama', async () => {
    const { store, id } = siapkan('Mau urus akta lahir anak kedua', { jenis: 'kelahiran', kode: '3312' });
    const provider = new FakeProvider({
      replies: [balas('Akta lahir anak kedua'), balas('Judul lain sekali')],
    });
    const deps = { provider, model: 'm', caps: CAPS };
    expect(await buatJudulUrusan({ store, deps }, id)).toBe('Akta lahir anak kedua');
    expect(store.getUrusan(id)).toMatchObject({ judul: 'Akta lahir anak kedua', judulManual: false });
    // Turn berikutnya: sudah ada judul → model tidak dipanggil lagi.
    expect(await buatJudulUrusan({ store, deps }, id)).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it('PII di keluaran atau batas waktu → judul cadangan jenis + wilayah', async () => {
    const a = siapkan('KTP saya hilang', { jenis: 'kelahiran', kode: '3312' });
    const pii = new FakeProvider({ replies: [balas(`Akta lahir ${NIK}`)] });
    expect(
      await buatJudulUrusan({ store: a.store, deps: { provider: pii, model: 'm', caps: CAPS } }, a.id),
    ).toBe('Akta kelahiran · Wonogiri');
    const b = siapkan('KTP saya hilang', { jenis: 'kelahiran', kode: '3312' });
    const macet = { ...pii, create: () => new Promise<never>(() => undefined) } as unknown as ChatProvider;
    expect(
      await buatJudulUrusan({ store: b.store, deps: { provider: macet, model: 'm', caps: CAPS } }, b.id, 30),
    ).toBe('Akta kelahiran · Wonogiri');
  });

  it('nama manual warga tidak ditimpa judul AI', async () => {
    const { store, id } = siapkan('Mau urus akta lahir', { jenis: 'kelahiran' });
    expect(store.simpanJudul(id, 'Akta si bungsu', 'warga')).toBe(true);
    const provider = new FakeProvider({ replies: [balas('Akta lahir anak kedua')] });
    expect(await buatJudulUrusan({ store, deps: { provider, model: 'm', caps: CAPS } }, id)).toBeNull();
    expect(store.simpanJudul(id, 'Judul AI telat datang', 'ai')).toBe(false);
    expect(store.getUrusan(id)).toMatchObject({ judul: 'Akta si bungsu', judulManual: true });
    expect(provider.calls).toHaveLength(0);
    // Warga boleh mengganti lagi; judul ikut terhapus bersama urusan (tabel anak, cascade).
    expect(store.simpanJudul(id, 'Akta adik', 'warga')).toBe(true);
    expect(store.getUrusan(id)?.judul).toBe('Akta adik');
    store.deleteUrusan(id);
    expect(store.listUrusan([id])).toEqual([]);
  });
});

describe('judulDemo', () => {
  it('menjawab hanya permintaan skema judul, dari pesan yang sudah disaring', () => {
    const params = {
      model: 'm',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ pesan_warga: 'Saya mau urus akta lahir anak kedua [nama]' }),
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'judul_urusan', schema: {} } },
    } as unknown as ChatParams;
    const r = judulDemo(params);
    expect(JSON.parse(r!.choices[0]!.message.content!)).toEqual({ judul: 'Urus akta lahir anak kedua' });
    expect(judulDemo({ model: 'm', messages: [] } as unknown as ChatParams)).toBeUndefined();
  });
});
