import { inflateRawSync } from 'node:zlib';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import type { EventOf, UrusinEvent } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import {
  BERKAS_TOOL,
  GARIS_KOSONG,
  KEBIJAKAN_BERKAS,
  MIME_BERKAS,
  berkasBuat,
  buatBatasBerkas,
  isiPlaceholder,
  mintaBerkas,
  namaBerkasAman,
  rapikanIsianTemplat,
  renderBerkas,
  tanggalIndonesia,
  teksTemplat,
  teksWinAnsi,
  type IsiBerkas,
  type LayananBerkas,
} from './berkas.js';
import { PolicyGate } from './policy.js';
import { FAKE_HP, FAKE_NIK, dumpDb, makeEnv } from './testing.js';
import type { ToolContext } from './tools.js';
import { buatUrusanTerwilayah } from './wilayah.js';

const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);
const tool = (name: string, args: Record<string, unknown>) =>
  fakeCompletion({ toolCalls: [{ name, arguments: JSON.stringify(args) }] });

/** Pembaca ZIP minimal (direktori pusat + inflate) untuk memeriksa isi DOCX/XLSX/PPTX. */
function isiZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const metode = buf.readUInt16LE(p + 10);
    const ukuran = buf.readUInt32LE(p + 20);
    const panjangNama = buf.readUInt16LE(p + 28);
    const ekstra = buf.readUInt16LE(p + 30);
    const komentar = buf.readUInt16LE(p + 32);
    const lokal = buf.readUInt32LE(p + 42);
    const nama = buf.subarray(p + 46, p + 46 + panjangNama).toString('utf8');
    const awal = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
    const data = buf.subarray(awal, awal + ukuran);
    out.set(nama, (metode === 8 ? inflateRawSync(data) : data).toString('utf8'));
    p += 46 + panjangNama + ekstra + komentar;
  }
  return out;
}
const semuaTeksZip = (buf: Buffer) => [...isiZip(buf).values()].join('\n');

const ISI: IsiBerkas = {
  format: 'docx',
  namaBerkas: 'Surat Pernyataan Belum Menikah',
  judul: 'SURAT PERNYATAAN BELUM MENIKAH',
  blok: [
    { jenis: 'paragraf', teks: 'Yang bertanda tangan di bawah ini:' },
    {
      jenis: 'isian',
      isian: [
        { label: 'Nama', nilai: 'Siti Aminah' },
        { label: 'Tempat/tanggal lahir', nilai: 'Wonogiri, 17 Agustus 1995' },
      ],
    },
    { jenis: 'judul_bagian', teks: 'Pernyataan' },
    {
      jenis: 'daftar',
      bernomor: true,
      butir: ['Saya belum pernah menikah.', 'Pernyataan ini saya buat dengan sebenarnya.'],
    },
    {
      jenis: 'tabel',
      kolom: ['No', 'Dokumen'],
      baris: [
        ['1', 'Fotokopi KTP-el'],
        ['2', 'Fotokopi KK'],
      ],
    },
  ],
  tandaTangan: {
    tempat: 'Wonogiri',
    tanggal: '2026-11-14',
    penanda: [{ peran: 'Yang membuat pernyataan,', nama: 'Siti Aminah', meterai: true }],
  },
};

describe('render berkas', { timeout: 60_000 }, () => {
  it('DOCX: ZIP sah, judul, isian, tanggal Indonesia, meterai', async () => {
    const b = await renderBerkas(ISI, '2026-11-14');
    expect(b.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    const xml = isiZip(b).get('word/document.xml')!;
    expect(xml).toContain('SURAT PERNYATAAN BELUM MENIKAH');
    expect(xml).toContain('Siti Aminah');
    expect(xml).toContain('Wonogiri, 14 November 2026');
    expect(xml).toContain('Meterai Rp10.000');
    // A4 (11906 x 16838 twip)
    expect(xml).toMatch(/w:w="11906"/);
  });

  it('PDF: %PDF-, judul terbaca, karakter non-WinAnsi tidak menggagalkan', async () => {
    const b = await renderBerkas(
      {
        ...ISI,
        format: 'pdf',
        blok: [...ISI.blok!, { jenis: 'paragraf', teks: 'Panah → dan emoji 😀 aman.' }],
      },
      '2026-11-14',
    );
    expect(b.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const teks = await teksTemplat({ mime: MIME_BERKAS.pdf, bytes: b });
    expect(teks).toContain('SURAT PERNYATAAN BELUM MENIKAH');
    expect(teks).toContain('14 November 2026');
  });

  it('XLSX: ZIP sah, judul dan tabel ada', async () => {
    const b = await renderBerkas({ ...ISI, format: 'xlsx' }, '2026-11-14');
    expect(b.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    const semua = semuaTeksZip(b);
    expect(semua).toContain('SURAT PERNYATAAN BELUM MENIKAH');
    expect(semua).toContain('Fotokopi KTP-el');
  });

  it('PPTX: ZIP sah, slide judul + slide dari `slide`', async () => {
    const b = await renderBerkas(
      {
        format: 'pptx',
        namaBerkas: 'Checklist Akta',
        judul: 'Checklist Akta Kelahiran',
        slide: [{ judul: 'Dokumen dibawa', poin: ['KK asli', 'KTP-el orang tua'] }],
      },
      '2026-11-14',
    );
    expect(b.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    const z = isiZip(b);
    expect([...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(2);
    expect(semuaTeksZip(b)).toContain('Checklist Akta Kelahiran');
    expect(semuaTeksZip(b)).toContain('KTP-el orang tua');
  });

  it('gaya surat permohonan: tempat-tanggal kanan atas, Perihal, Kepada', async () => {
    const b = await renderBerkas(
      {
        ...ISI,
        kepada: ['Yth. Kepala Disdukcapil Kabupaten Wonogiri', 'di Tempat'],
        perihal: 'Permohonan akta kelahiran',
      },
      '2026-11-14',
    );
    const xml = isiZip(b).get('word/document.xml')!;
    expect(xml).toContain('Perihal : Permohonan akta kelahiran');
    expect(xml).toContain('Yth. Kepala Disdukcapil Kabupaten Wonogiri');
  });

  it('utilitas: tanggal, nama berkas, WinAnsi, minta berkas', () => {
    expect(tanggalIndonesia('2026-01-05')).toBe('5 Januari 2026');
    expect(namaBerkasAman('Surat/Kuasa: <x>.docx', 'pdf')).toBe('Surat Kuasa x.pdf');
    expect(teksWinAnsi('a → b ✓')).toBe('a -> b ?');
    expect(mintaBerkas('tolong buatkan surat kuasa untuk ambil akta')).toBe(true);
    expect(mintaBerkas('isikan templat ini ya')).toBe(true);
    expect(mintaBerkas('syarat akta kelahiran apa?')).toBe(false);
  });
});

describe('placeholder brankas', { timeout: 60_000 }, () => {
  it('nilai asli menggantikan placeholder; yang kosong jadi garis + label', () => {
    const kosong = new Set<string>();
    const out = isiPlaceholder(
      { a: 'NIK {{PEMOHON.NIK}}', b: ['{{PEMOHON.TANGGAL_LAHIR}}', '{{IBU.NAMA}}'] },
      { '{{PEMOHON.NIK}}': FAKE_NIK, '{{PEMOHON.TANGGAL_LAHIR}}': '1995-08-17' },
      kosong,
    );
    expect(out).toEqual({ a: `NIK ${FAKE_NIK}`, b: ['17 Agustus 1995', GARIS_KOSONG] });
    expect([...kosong]).toEqual(['nama ibu']);
  });
});

describe('templat lampiran', { timeout: 60_000 }, () => {
  it('DOCX templat terbaca (mammoth); isian {{Nama}} dirapikan', async () => {
    const docx = await renderBerkas(
      {
        format: 'docx',
        namaBerkas: 't',
        judul: 'FORMULIR RT',
        blok: [{ jenis: 'paragraf', teks: 'Nama: {{Nama}}' }],
      },
      '2026-11-14',
    );
    // `{{Nama}}` bukan placeholder brankas sah: render tidak menyentuhnya.
    const teks = await teksTemplat({ mime: MIME_BERKAS.docx, bytes: docx });
    expect(teks).toContain('FORMULIR RT');
    expect(rapikanIsianTemplat(teks!)).toContain('Nama: [isian: Nama]');
    expect(rapikanIsianTemplat('NIK {{PEMOHON.NIK}}')).toBe('NIK {{PEMOHON.NIK}}');
    expect(await teksTemplat({ mime: 'image/png', bytes: Buffer.from('x') })).toBeNull();
    expect(await teksTemplat({ mime: MIME_BERKAS.docx, bytes: Buffer.from('bukan zip') })).toBeNull();
  });

  it('teks templat ke model: PII diredaksi, dibungkus spotlight, catatan PDF tak terbaca tidak muncul', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'Data apa yang perlu diisi?' })],
    });
    const env = makeEnv({ provider, berkas: layananTiruan().layanan });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3578', jenis: 'akta' });
    await runTurn(env.deps, {
      urusanId: u.id,
      userText: '[warga melampirkan dokumen: Dokumen lain (DOCX)]\ntolong isikan templat ini',
      templat: [
        { mime: MIME_BERKAS.docx, teks: `FORMULIR\nNIK: ${FAKE_NIK}\nHP: ${FAKE_HP}\nNama: {{Nama}}` },
      ],
      pemilikBerkas: 'usr_1',
    });
    const kirim = JSON.stringify(
      provider.calls.flatMap((c) => (c.kind === 'create' ? [c.params.messages] : [])),
    );
    expect(kirim).toContain('DATA_TAK_TEPERCAYA sumber=\\"user_file\\" id=\\"templat-1\\"');
    expect(kirim).not.toContain(FAKE_NIK);
    expect(kirim).not.toContain(FAKE_HP);
    expect(kirim).toContain('[isian:');
    expect(kirim).not.toContain('BELUM bisa dibaca');
    expect(kirim).toContain(KEBIJAKAN_BERKAS.slice(0, 40));
  });
});

function layananTiruan(nilai: Record<string, string> = {}) {
  const tersimpan: { pemilik: string; judul: string; mime: string; bytes: Buffer }[] = [];
  const diminta: string[][] = [];
  const layanan: Omit<LayananBerkas, 'batas'> = {
    nilai: (_p, ph) => {
      diminta.push([...ph]);
      return Object.fromEntries(ph.flatMap((x) => (nilai[x] ? [[x, nilai[x]]] : [])));
    },
    simpan: (pemilik, b) => {
      tersimpan.push({ pemilik, ...b });
      return { id: `dok_${String(tersimpan.length).padStart(32, '0')}` };
    },
  };
  return { layanan, tersimpan, diminta };
}

const ARGS_SURAT = {
  format: 'docx',
  namaBerkas: 'Surat Kuasa Pengambilan Akta',
  judul: 'SURAT KUASA',
  blok: [
    { jenis: 'paragraf', teks: 'Yang bertanda tangan di bawah ini:' },
    {
      jenis: 'isian',
      isian: [
        { label: 'Nama', nilai: '{{PEMOHON.NAMA}}' },
        { label: 'NIK', nilai: '{{PEMOHON.NIK}}' },
        { label: 'Alamat', nilai: '{{PEMOHON.ALAMAT}}' },
      ],
    },
    { jenis: 'paragraf', teks: 'Memberi kuasa kepada Budi Santoso untuk mengambil kutipan akta kelahiran.' },
  ],
  tandaTangan: {
    tempat: 'Surabaya',
    penanda: [
      { peran: 'Penerima Kuasa,', nama: 'Budi Santoso' },
      { peran: 'Pemberi Kuasa,', nama: '{{PEMOHON.NAMA}}', meterai: true },
    ],
  },
};

describe('berkas__buat end-to-end (agen + gate + brankas tiruan)', { timeout: 60_000 }, () => {
  it('nilai brankas masuk berkas, TIDAK pernah ke model/riwayat/event; kartu berkas terbit', async () => {
    const t = layananTiruan({ '{{PEMOHON.NIK}}': FAKE_NIK, '{{PEMOHON.NAMA}}': 'Siti Aminah' });
    const provider = new FakeProvider({
      replies: [tool(BERKAS_TOOL, ARGS_SURAT), fakeCompletion({ content: 'Surat kuasa siap diunduh.' })],
    });
    const env = makeEnv({ provider, berkas: t.layanan });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3578', jenis: 'akta' });
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'buatkan surat kuasa ambil akta untuk Budi Santoso',
      pemilikBerkas: 'usr_1',
    });
    expect(out.status).toBe('selesai');
    expect(t.tersimpan).toHaveLength(1);
    const s = t.tersimpan[0]!;
    expect(s).toMatchObject({
      pemilik: 'usr_1',
      judul: 'Surat Kuasa Pengambilan Akta.docx',
      mime: MIME_BERKAS.docx,
    });
    const xml = isiZip(s.bytes).get('word/document.xml')!;
    expect(xml).toContain(FAKE_NIK);
    expect(xml).toContain('Siti Aminah');
    expect(xml).not.toContain('{{PEMOHON');
    expect(xml).toContain(GARIS_KOSONG); // alamat belum ada di Data Diri

    const kartu = of(out.events, 'berkas');
    expect(kartu).toHaveLength(1);
    expect(kartu[0]).toMatchObject({
      format: 'docx',
      nama: 'Surat Kuasa Pengambilan Akta.docx',
      judul: 'SURAT KUASA',
    });
    expect(kartu[0]!.ukuran).toBe(s.bytes.length);

    const keModel = JSON.stringify(provider.calls);
    expect(keModel).not.toContain(FAKE_NIK);
    expect(keModel).not.toContain('Siti Aminah');
    expect(keModel).toContain('alamat'); // label kolom kosong dilaporkan, bukan nilai
    expect(JSON.stringify(out.events)).not.toContain(FAKE_NIK);
    expect(dumpDb(env.store.db)).not.toContain(FAKE_NIK);
  });

  it('tanpa pemilik brankas: tool tidak ditawarkan', async () => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: 'Halo.' })] });
    const env = makeEnv({ provider, berkas: layananTiruan().layanan });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3578', jenis: 'akta' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'halo' });
    const create = provider.calls.find((c) => c.kind === 'create');
    const nama =
      create?.kind === 'create'
        ? (create.params.tools ?? []).map((x) => (x.type === 'function' ? x.function.name : ''))
        : [];
    expect(nama).not.toContain(BERKAS_TOOL);
  });
});

describe('policy gate berkas__buat', { timeout: 60_000 }, () => {
  const env = makeEnv({ provider: new FakeProvider({ replies: [] }), berkas: layananTiruan().layanan });
  const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3578', jenis: 'akta' });
  const gate = new PolicyGate(env.registry, env.store);
  const nilai = (rawArgs: unknown) =>
    gate.evaluate({
      urusan: env.store.getUrusanOrThrow(u.id),
      state: env.store.getUrusanOrThrow(u.id).state,
      toolName: BERKAS_TOOL,
      rawArgs,
      quota: { mode: 'normal' } as never,
    });

  it('placeholder brankas sah lolos', () => {
    expect(nilai(ARGS_SURAT).allow).toBe(true);
  });

  it('NIK/HP mentah dan kurung kurawal liar ditolak', () => {
    for (const bad of [
      { ...ARGS_SURAT, judul: `SURAT ${FAKE_NIK}` },
      { ...ARGS_SURAT, perihal: `hubungi ${FAKE_HP}` },
      { ...ARGS_SURAT, judul: 'SURAT {{nama}}' },
    ]) {
      const o = nilai(bad);
      expect(o.allow).toBe(false);
      if (!o.allow) expect(o.rule).toBe('PLACEHOLDER_OR_PII_IN_PARAM');
    }
  });

  it('tool lain tetap menolak placeholder', () => {
    const o = gate.evaluate({
      urusan: env.store.getUrusanOrThrow(u.id),
      state: env.store.getUrusanOrThrow(u.id).state,
      toolName: 'rag__cari_pengetahuan',
      rawArgs: { query: 'akta {{PEMOHON.NIK}}' },
      quota: { mode: 'normal' } as never,
    });
    expect(o.allow).toBe(false);
  });

  it('diizinkan di semua state', () => {
    expect(berkasBuat.allowedStates).toContain('SELESAI');
    expect(berkasBuat.allowedStates).toContain('BARU');
  });
});

describe('batas laju dan isi', { timeout: 60_000 }, () => {
  const ctx = (layanan: LayananBerkas, extra: Partial<ToolContext> = {}): ToolContext => {
    const env = makeEnv({ provider: new FakeProvider({ replies: [] }) });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3578', jenis: 'akta' });
    return {
      urusan: env.store.getUrusanOrThrow(u.id),
      store: env.store,
      deps: { ...env.deps, berkas: layanan, now: () => new Date('2026-11-14T03:00:00Z') },
      nonce: 'n',
      pesanWarga: '',
      signal: new AbortController().signal,
      pemilikBerkas: 'usr_1',
      ...extra,
    };
  };
  const args = BerkasBuatArgs();

  it('10 berkas per urusan per jam; ke-11 ditolak tanpa menyimpan', async () => {
    const t = layananTiruan();
    const c = ctx({ ...t.layanan, batas: buatBatasBerkas() });
    for (let i = 0; i < 10; i++) expect((await berkasBuat.execute(c, args)).events).toHaveLength(1);
    const r = await berkasBuat.execute(c, args);
    expect(r.events).toBeUndefined();
    expect(r.content).toContain('Batas pembuatan berkas');
    expect(t.tersimpan).toHaveLength(10);
  });

  it('judul meniru kop instansi ditolak; kuota Dokumen penuh dijelaskan', async () => {
    const t = layananTiruan();
    const r1 = await berkasBuat.execute(ctx({ ...t.layanan, batas: buatBatasBerkas() }), {
      ...args,
      judul: 'PEMERINTAH KOTA SURABAYA',
    });
    expect(r1.content).toContain('kop');
    const penuh = {
      ...t.layanan,
      simpan: () => {
        throw Object.assign(new Error('x'), { kode: 'DOKUMEN_KUOTA_PENUH' });
      },
      batas: buatBatasBerkas(),
    };
    const r2 = await berkasBuat.execute(ctx(penuh), args);
    expect(r2.content).toContain('Dokumen warga sudah penuh');
    expect(t.tersimpan).toHaveLength(0);
  });
});

function BerkasBuatArgs() {
  return berkasBuat.input.parse({
    format: 'pdf',
    namaBerkas: 'Checklist',
    judul: 'CHECKLIST DOKUMEN',
    blok: [{ jenis: 'daftar', butir: ['KK', 'KTP-el'] }],
  });
}
