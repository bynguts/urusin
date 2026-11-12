import { describe, expect, it } from 'vitest';
import { petakanIsian, pesanDataKurang } from './isi-data.js';

describe('pesanDataKurang: Data Diri kosong disebut jujur (QA prod 2026-11-12 Klampid)', () => {
  it('menyebut data yang tidak ada di Data Diri, tanpa nilai apa pun, tanpa duplikat', () => {
    const { kurang } = petakanIsian(['{{PEMOHON.NIK}}', '{{PEMOHON.EMAIL}}', '{{PEMOHON.HP}}'], {});
    const pesan = pesanDataKurang([...kurang, ...kurang]);
    expect(pesan).toMatch(/^Data Diri Anda di Urusin belum memuat: /);
    expect(pesan).toContain('NIK');
    expect(pesan.match(/NIK/g)).toHaveLength(1);
    expect(pesan).toContain('isi sendiri di layar');
  });
});
