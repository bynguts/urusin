import { describe, expect, it } from 'vitest';
import { hrefAman, pecahTautan, tautanLuar } from './tautan';

const tautan = (teks: string) => pecahTautan(teks).filter((s) => s.jenis === 'tautan');

describe('pecahTautan', () => {
  it('teks tanpa URL tetap satu segmen teks', () => {
    expect(pecahTautan('Bawa KTP asli ke loket.')).toEqual([
      { jenis: 'teks', teks: 'Bawa KTP asli ke loket.' },
    ]);
    expect(pecahTautan('')).toEqual([]);
  });

  it('URL http/https di tengah kalimat menjadi tautan, teks di sekitarnya utuh', () => {
    expect(pecahTautan('Buka https://dukcapil.example.go.id/layanan lalu masuk.')).toEqual([
      { jenis: 'teks', teks: 'Buka ' },
      {
        jenis: 'tautan',
        teks: 'https://dukcapil.example.go.id/layanan',
        href: 'https://dukcapil.example.go.id/layanan',
      },
      { jenis: 'teks', teks: ' lalu masuk.' },
    ]);
    expect(tautan('lihat http://contoh.id')[0]).toMatchObject({ href: 'http://contoh.id/' });
  });

  it('menolak javascript:, data:, file:, dan skema lain', () => {
    for (const t of [
      'javascript:alert(1)',
      'klik javascript://%0Aalert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://contoh.id/berkas',
      '[klik](javascript:alert(1))',
    ])
      expect(tautan(t)).toEqual([]);
    expect(hrefAman('javascript:alert(1)')).toBeNull();
    expect(hrefAman('https://')).toBeNull();
  });

  it('tanda baca akhir kalimat tidak ikut URL', () => {
    for (const akhir of ['.', ',', ';', ':', '!', '?', '…', '"', '”', ')']) {
      const s = pecahTautan(`Situs: https://contoh.go.id/a${akhir}`);
      expect(s.at(-1)).toEqual({ jenis: 'teks', teks: akhir });
      expect(s[1]).toMatchObject({ jenis: 'tautan', href: 'https://contoh.go.id/a' });
    }
    // Dalam kurung: kurung tutup milik kalimat.
    expect(tautan('(lihat https://contoh.go.id/x).')[0]?.href).toBe('https://contoh.go.id/x');
    // Kurung berpasangan di dalam URL tetap utuh.
    expect(tautan('https://id.wikipedia.org/wiki/Akta_(hukum).')[0]?.href).toBe(
      'https://id.wikipedia.org/wiki/Akta_(hukum)',
    );
  });

  it('URL panjang dengan query dan fragmen tertangkap utuh; di atas 2048 karakter dibiarkan teks', () => {
    const panjang = `https://layanan.example.go.id/permohonan/${'a1b2c3'.repeat(50)}?jenis=kk&langkah=2#:~:text=Syarat`;
    const s = tautan(`Isi di ${panjang} ya`);
    expect(s).toHaveLength(1);
    expect(s[0]?.teks).toBe(panjang);
    expect(s[0]?.href).toBe(new URL(panjang).href);
    expect(tautan(`https://contoh.id/${'x'.repeat(2100)}`)).toEqual([]);
  });

  it('beberapa URL dan tautan Markdown [label](url)', () => {
    const s = pecahTautan('A https://a.id dan [Situs resmi](https://b.go.id/x) serta https://c.id.');
    expect(s.filter((x) => x.jenis === 'tautan')).toEqual([
      { jenis: 'tautan', teks: 'https://a.id', href: 'https://a.id/' },
      { jenis: 'tautan', teks: 'Situs resmi', href: 'https://b.go.id/x' },
      { jenis: 'tautan', teks: 'https://c.id', href: 'https://c.id/' },
    ]);
    expect(s.map((x) => x.teks).join('')).toBe('A https://a.id dan Situs resmi serta https://c.id.');
  });

  it('pemanggilan berulang tidak saling memengaruhi (regex global)', () => {
    expect(tautan('x https://a.id')).toHaveLength(1);
    expect(tautan('https://b.id y')).toHaveLength(1);
  });
});

describe('tautanLuar', () => {
  it('http/https = luar; rute aplikasi bukan', () => {
    expect(tautanLuar('https://a.id')).toBe(true);
    expect(tautanLuar('/dokumen')).toBe(false);
  });
});
