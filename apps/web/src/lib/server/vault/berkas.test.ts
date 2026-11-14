import { MemoryMailer } from '@urusin/akun/testing';
import { DemoProvider, MIME_BERKAS, renderBerkas } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { layananBerkas, templatDariBrankas } from './berkas';

const NIK = ['3201', '0101', '0190', '0002'].join('');
const KTX = { ip: '127.0.0.1', userAgent: null };

let rt: Runtime;
let pemilik: string;
let lain: string;

beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  setRuntimeForTests(rt);
  pemilik = rt.akun.pastikanTamu('a'.repeat(32), KTX);
  lain = rt.akun.pastikanTamu('b'.repeat(32), KTX);
  rt.akun.vault.setDataDiri(pemilik, { namaLengkap: 'Warga Uji', nik: NIK, tanggalLahir: '1990-01-01' });
});
afterEach(() => setRuntimeForTests(undefined));

describe('layanan berkas di atas brankas', () => {
  it('runtime mendaftarkan berkas__buat', () => {
    expect(rt.registry.get('berkas__buat')).toBeDefined();
  });

  it('nilai placeholder dari Data Diri pemilik; placeholder tak dikenal/kosong tidak ikut', () => {
    const l = layananBerkas(() => rt);
    expect(
      l.nilai(pemilik, ['{{PEMOHON.NIK}}', '{{PEMOHON.NAMA}}', '{{PEMOHON.HP}}', '{{ORANG2.NIK}}'], null),
    ).toEqual({ '{{PEMOHON.NIK}}': NIK, '{{PEMOHON.NAMA}}': 'Warga Uji' });
    expect(l.nilai(lain, ['{{PEMOHON.NIK}}'], null)).toEqual({});
  });

  it('simpan: terenkripsi di Dokumen pemilik dengan mime kantor, bisa dibaca ulang', async () => {
    const l = layananBerkas(() => rt);
    const bytes = await renderBerkas(
      {
        format: 'xlsx',
        namaBerkas: 'Checklist',
        judul: 'CHECKLIST',
        blok: [{ jenis: 'daftar', butir: ['KK'] }],
      },
      '2026-11-14',
    );
    const { id } = l.simpan(pemilik, { judul: 'Checklist.xlsx', mime: MIME_BERKAS.xlsx, bytes }) as {
      id: string;
    };
    const d = rt.akun.vault.getDocument(pemilik, id)!;
    expect(d.meta).toMatchObject({ judul: 'Checklist.xlsx', mime: MIME_BERKAS.xlsx, jenis: 'lainnya' });
    expect(Buffer.compare(d.bytes, bytes)).toBe(0);
    expect(rt.akun.vault.getDocument(lain, id)).toBeNull();
  }, 60_000);

  it('templat: hanya DOCX/PDF milik pemilik yang dibaca', async () => {
    const docx = await renderBerkas(
      {
        format: 'docx',
        namaBerkas: 't',
        judul: 'FORMULIR KELURAHAN',
        blok: [{ jenis: 'paragraf', teks: 'Nama: ....' }],
      },
      '2026-11-14',
    );
    const milik = rt.akun.vault.putDocument(pemilik, {
      jenis: 'lainnya',
      judul: 't',
      mime: MIME_BERKAS.docx,
      bytes: docx,
    });
    const orangLain = rt.akun.vault.putDocument(lain, {
      jenis: 'lainnya',
      judul: 't',
      mime: MIME_BERKAS.docx,
      bytes: docx,
    });
    const foto = rt.akun.vault.putDocument(pemilik, {
      jenis: 'foto',
      judul: 'f',
      mime: 'image/png',
      bytes: Buffer.from('89504e47', 'hex'),
    });
    const t = await templatDariBrankas(rt, pemilik, [milik.id, orangLain.id, foto.id, milik.id]);
    expect(t).toHaveLength(1);
    expect(t[0]!.mime).toBe(MIME_BERKAS.docx);
    expect(t[0]!.teks).toContain('FORMULIR KELURAHAN');
  }, 60_000);
});
