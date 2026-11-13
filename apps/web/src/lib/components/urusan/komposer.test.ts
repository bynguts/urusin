import { describe, expect, it } from 'vitest';
import {
  aksiEnter,
  pecahPenanda,
  penandaLampiran,
  tebakJenis,
  teksDenganLampiran,
  ukuranBerkas,
} from './komposer';

const tombol = (o: Partial<{ key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }>) => ({
  key: 'Enter',
  shiftKey: false,
  isComposing: false,
  ...o,
});

describe('aksiEnter', () => {
  it('Enter mengirim, Shift+Enter baris baru', () => {
    expect(aksiEnter(tombol({}))).toBe('kirim');
    expect(aksiEnter(tombol({ shiftKey: true }))).toBeNull();
  });

  it('tidak mengirim selama komposisi IME (isComposing atau keyCode 229)', () => {
    expect(aksiEnter(tombol({ isComposing: true }))).toBeNull();
    expect(aksiEnter(tombol({ keyCode: 229 }))).toBeNull();
  });

  it('tombol lain diabaikan', () => {
    expect(aksiEnter(tombol({ key: 'a' }))).toBeNull();
    expect(aksiEnter(tombol({ key: 'Tab' }))).toBeNull();
  });

  it('layar sentuh: Enter = baris baru (kirim lewat tombol)', () => {
    expect(aksiEnter(tombol({}), true)).toBeNull();
  });
});

describe('lampiran chat', () => {
  it('jenis ditebak dari nama berkas tanpa ikut mengirim nama', () => {
    expect(tebakJenis('KTP_ibu.jpg')).toBe('ktp');
    expect(tebakJenis('scan-e-ktp.png')).toBe('ktp');
    expect(tebakJenis('KK terbaru.pdf')).toBe('kk');
    expect(tebakJenis('kartu_keluarga.webp')).toBe('kk');
    expect(tebakJenis('Akte Kelahiran.pdf')).toBe('akta');
    expect(tebakJenis('surat-pengantar-rt.pdf')).toBe('surat');
    expect(tebakJenis('pasfoto 3x4.jpg')).toBe('foto');
    expect(tebakJenis('image.png')).toBe('lainnya');
    expect(tebakJenis('kkn-laporan.pdf')).toBe('lainnya');
  });

  it('penanda hanya berisi jenis dan bentuk, tidak pernah nama berkas atau angka', () => {
    expect(penandaLampiran('kk', 'image/jpeg')).toBe('[warga melampirkan dokumen: Kartu Keluarga (gambar)]');
    expect(penandaLampiran('lainnya', 'application/pdf')).toBe(
      '[warga melampirkan dokumen: Dokumen lain (PDF)]',
    );
    const t = teksDenganLampiran('  ini KK saya ', [
      { jenis: 'kk', mime: 'image/png' },
      { jenis: 'akta', mime: 'application/pdf' },
    ]);
    expect(t).toBe(
      '[warga melampirkan dokumen: Kartu Keluarga (gambar)]\n[warga melampirkan dokumen: Akta (PDF)]\nini KK saya',
    );
    expect(t).not.toMatch(/\d/);
    expect(teksDenganLampiran('', [{ jenis: 'ktp', mime: 'image/png' }])).toBe(
      '[warga melampirkan dokumen: KTP (gambar)]',
    );
  });

  it('gelembung memisahkan penanda (chip) dari tulisan warga', () => {
    expect(pecahPenanda('[warga melampirkan dokumen: KTP (gambar)]\nIni KTP saya')).toEqual({
      lampiran: [{ label: 'KTP', bentuk: 'gambar' }],
      teks: 'Ini KTP saya',
    });
    // Tulisan warga yang mirip tetapi tidak persis tetap teks.
    expect(pecahPenanda('saya [warga melampirkan dokumen: KTP (gambar)]').lampiran).toEqual([]);
    expect(pecahPenanda('biasa saja')).toEqual({ lampiran: [], teks: 'biasa saja' });
  });
});

describe('ukuranBerkas', () => {
  it('KB dibulatkan (minimal 1), MB satu desimal dengan koma', () => {
    expect(ukuranBerkas(200)).toBe('1 KB');
    expect(ukuranBerkas(150 * 1024)).toBe('150 KB');
    expect(ukuranBerkas(1.4 * 1024 * 1024)).toBe('1,4 MB');
  });
});
