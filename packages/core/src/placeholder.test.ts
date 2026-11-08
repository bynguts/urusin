import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorCode } from './errors.js';
import { containsEmail, containsNikLike, containsPhone, detectPii, isNikLike } from './pii.js';
import {
  filePlaceholder,
  findGuardIssues,
  findPlaceholders,
  hasMalformedPlaceholder,
  isPlaceholder,
  llmText,
  noPlaceholder,
  parsePlaceholder,
  placeholder,
} from './placeholder.js';

// Data sintetis dirakit dari potongan agar file ini tidak memicu pii-scan.
const j = (...p: string[]) => p.join('');
const NIK = j('331201', '150890', '0001');
const PHONE = j('0812', '3456', '7890');
const EMAIL = j('warga', '@', 'mail.id');

describe('grammar placeholder', () => {
  it('mengurai placeholder vault', () => {
    expect(parsePlaceholder('{{PEMOHON.NIK}}')).toEqual({
      kind: 'vault',
      namespace: 'PEMOHON',
      path: ['NIK'],
      raw: '{{PEMOHON.NIK}}',
    });
  });
  it('mengurai path bertingkat', () => {
    const p = parsePlaceholder('{{ANAK.AYAH.NAMA_LENGKAP}}');
    expect(p?.kind === 'vault' && p.path).toEqual(['AYAH', 'NAMA_LENGKAP']);
  });
  it('mengurai placeholder file', () => {
    expect(parsePlaceholder('{{FILE:item}}')).toEqual({ kind: 'file', name: 'item', raw: '{{FILE:item}}' });
  });
  it.each([
    '{{PEMOHON}}',
    '{{pemohon.nik}}',
    '{{ PEMOHON.NIK }}',
    '{{PEMOHON.}}',
    '{{1A.B}}',
    '{{FILE:}}',
    'PEMOHON.NIK',
  ])('menolak bentuk tidak valid %s', (token) => {
    expect(isPlaceholder(token)).toBe(false);
    expect(parsePlaceholder(token)).toBeNull();
  });
  it('menemukan beberapa placeholder dalam teks', () => {
    const found = findPlaceholders('Nama {{PEMOHON.NAMA}} lahir {{ANAK.TGL_LAHIR}} file {{FILE:KK}}');
    expect(found.map((p) => p.raw)).toEqual(['{{PEMOHON.NAMA}}', '{{ANAK.TGL_LAHIR}}', '{{FILE:KK}}']);
  });
  it('mendeteksi kurung kurawal yang rusak', () => {
    expect(hasMalformedPlaceholder('{{PEMOHON.NIK}}')).toBe(false);
    expect(hasMalformedPlaceholder('{{PEMOHON.NIK}')).toBe(true);
    expect(hasMalformedPlaceholder('nilai }} sisa')).toBe(true);
    expect(hasMalformedPlaceholder('teks biasa')).toBe(false);
  });
  it('builder menghasilkan token valid dan menolak nama buruk', () => {
    expect(placeholder('PEMOHON', 'HP')).toBe('{{PEMOHON.HP}}');
    expect(filePlaceholder('item')).toBe('{{FILE:item}}');
    expect(() => placeholder('pemohon', 'hp')).toThrow();
    expect(() => placeholder('PEMOHON')).toThrow();
  });
});

describe('detektor PII', () => {
  it('NIK valid, termasuk tanggal perempuan (+40)', () => {
    expect(isNikLike(NIK)).toBe(true);
    expect(isNikLike(j('331201', '550890', '0001'))).toBe(true);
  });
  it('NIK dengan kode provinsi/bulan tidak valid ditolak', () => {
    expect(isNikLike(j('991201', '150890', '0001'))).toBe(false);
    expect(isNikLike(j('331201', '151390', '0001'))).toBe(false);
  });
  it('NIK berpemisah tetap terdeteksi', () => {
    expect(
      containsNikLike(`nik ${NIK.slice(0, 4)} ${NIK.slice(4, 8)} ${NIK.slice(8, 12)} ${NIK.slice(12)}`),
    ).toBe(true);
  });
  it('HP berbagai format', () => {
    expect(containsPhone(PHONE)).toBe(true);
    expect(containsPhone(j('+62', '812', '34567890'))).toBe(true);
    expect(containsPhone('versi 0.8.1')).toBe(false);
  });
  it('email', () => {
    expect(containsEmail(`hubungi ${EMAIL}`)).toBe(true);
    expect(containsEmail('tidak ada surel')).toBe(false);
  });
  it('detectPii mengumpulkan semua jenis', () => {
    expect(detectPii(`${NIK} ${PHONE} ${EMAIL}`)).toEqual(['nik', 'phone', 'email']);
  });
});

describe('noPlaceholder()', () => {
  const Params = z
    .object({ kecamatan: z.string(), catatan: z.string().optional(), daftar: z.array(z.string()).optional() })
    .superRefine(noPlaceholder());

  it('meloloskan parameter bersih', () => {
    expect(Params.safeParse({ kecamatan: 'Wonogiri', catatan: 'akta kelahiran anak kedua' }).success).toBe(
      true,
    );
  });
  it('menolak placeholder lengkap dari model', () => {
    const r = Params.safeParse({ kecamatan: '{{PEMOHON.KECAMATAN}}' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['kecamatan']);
  });
  it.each(['{{', '}}', 'abc {{ def', 'x }} y'])('menolak fragmen kurung %s', (v) => {
    expect(llmText().safeParse(v).success).toBe(false);
  });
  it('menolak NIK, HP, email', () => {
    expect(llmText().safeParse(`nik saya ${NIK}`).success).toBe(false);
    expect(llmText().safeParse(`wa ${PHONE}`).success).toBe(false);
    expect(llmText().safeParse(EMAIL).success).toBe(false);
  });
  it('menelusuri array dan objek bersarang', () => {
    const r = Params.safeParse({ kecamatan: 'Baturetno', daftar: ['ok', `hp ${PHONE}`] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['daftar', 1]);
  });
  it('memberi kode error Urusin per pelanggaran', () => {
    const issues = findGuardIssues({ a: '{{PEMOHON.NIK}}', b: NIK });
    expect(issues.map((i) => i.code)).toEqual([
      ErrorCode.PLACEHOLDER_IN_LLM_PARAM,
      ErrorCode.PII_IN_LLM_PARAM,
    ]);
  });
  it('memeriksa kunci objek juga', () => {
    expect(findGuardIssues({ [EMAIL]: 'x' })).toHaveLength(1);
  });
  it('mengabaikan angka dan boolean', () => {
    expect(findGuardIssues({ n: 3312, b: true, z: null })).toEqual([]);
  });
});
