import { describe, expect, it } from 'vitest';
import {
  galatSitus,
  halamanGalatChrome,
  jenisGalatNav,
  kanalLain,
  pesanAlihLuar,
  pesanSitusBermasalah,
} from './galat-nav.js';

describe('halamanGalatChrome', () => {
  it('hanya dokumen chrome-error:// (bukan situs, bukan about:blank)', () => {
    expect(halamanGalatChrome('chrome-error://chromewebdata/')).toBe(true);
    expect(halamanGalatChrome('https://siapel.malangkota.go.id/')).toBe(false);
    expect(halamanGalatChrome('about:blank')).toBe(false);
    expect(halamanGalatChrome('https://contoh.go.id/chrome-error://x')).toBe(false);
  });
});

describe('jenisGalatNav / galatSitus', () => {
  it.each([
    ['net::ERR_CERT_AUTHORITY_INVALID', 'sertifikat'],
    ['net::ERR_CERT_COMMON_NAME_INVALID', 'sertifikat'],
    ['net::ERR_CERT_DATE_INVALID', 'sertifikat'],
    ['net::ERR_SSL_PROTOCOL_ERROR', 'sertifikat'],
    ['net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH', 'sertifikat'],
    ['net::ERR_BAD_SSL_CLIENT_AUTH_CERT', 'sertifikat'],
    ['net::ERR_NAME_NOT_RESOLVED', 'dns'],
    ['net::ERR_NAME_RESOLUTION_FAILED', 'dns'],
    ['net::ERR_ADDRESS_UNREACHABLE', 'dns'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'waktu'],
    ['net::ERR_TIMED_OUT', 'waktu'],
    ['net::ERR_CONNECTION_REFUSED', 'koneksi'],
    ['net::ERR_CONNECTION_RESET', 'koneksi'],
    ['net::ERR_CONNECTION_CLOSED', 'koneksi'],
    ['net::ERR_EMPTY_RESPONSE', 'koneksi'],
    ['net::ERR_TUNNEL_CONNECTION_FAILED', 'jalur_keluar'],
    ['net::ERR_PROXY_CONNECTION_FAILED', 'jalur_keluar'],
    ['net::ERR_FAILED', 'lain'],
  ] as const)('%s -> %s', (net, jenis) => {
    expect(jenisGalatNav(net)).toBe(jenis);
    expect(galatSitus(net)).toBe(['sertifikat', 'dns', 'koneksi', 'waktu'].includes(jenis));
  });

  it('bukan kegagalan situs: dibatalkan, diblokir rute, kosong, atau bentuk asing', () => {
    for (const net of [
      'net::ERR_ABORTED',
      'net::ERR_BLOCKED_BY_CLIENT',
      undefined,
      '',
      'ERR_CERT_AUTHORITY_INVALID',
      'net::ERR_cert',
    ]) {
      expect(jenisGalatNav(net)).toBeUndefined();
      expect(galatSitus(net)).toBe(false);
    }
  });
});

describe('pesan untuk warga', () => {
  it('Malang (ERR_CERT_AUTHORITY_INVALID): jujur, tanpa ajakan lanjutkan sendiri, kanal resmi dari registry', () => {
    const p = pesanSitusBermasalah('siapel.malangkota.go.id', 'net::ERR_CERT_AUTHORITY_INVALID');
    expect(p).toContain('Situs siapel.malangkota.go.id sedang bermasalah');
    expect(p).toContain('sertifikat keamanannya tidak lengkap');
    expect(p).toContain('Demi keamanan, AI tidak membukanya');
    expect(p).toContain('dispendukcapil.malangkota.go.id');
    expect(p).toContain('IKD');
    expect(p).not.toMatch(/lanjutkan sendiri|di luar daftar/i);
    expect(p).toMatch(/\(net::ERR_CERT_AUTHORITY_INVALID\)$/);
  });

  it.each([
    ['net::ERR_CERT_DATE_INVALID', 'sertifikat keamanannya tidak sah'],
    ['net::ERR_NAME_NOT_RESOLVED', 'alamatnya tidak ditemukan'],
    ['net::ERR_CONNECTION_REFUSED', 'tidak bisa dihubungi'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'tidak menjawab tepat waktu'],
  ])('%s -> %s', (net, sebab) => {
    expect(pesanSitusBermasalah('portal.contoh.go.id', net)).toContain(`(${sebab})`);
  });

  it('host di luar registry: tetap ada kanal nasional dan kantor', () => {
    expect(kanalLain('portal.contoh.go.id')).toEqual([
      'aplikasi Identitas Kependudukan Digital (IKD)',
      'kantor Disdukcapil terdekat',
    ]);
    expect(kanalLain('SIAPEL.malangkota.go.id:443')[0]).toBe(
      'situs informasi Disdukcapil dispendukcapil.malangkota.go.id',
    );
  });

  it('redirect ke host lain di halaman awal: dipandu tanpa ajakan lanjutkan sendiri', () => {
    const p = pesanAlihLuar('portal.contoh.go.id');
    expect(p).toContain('di luar daftar situs resmi');
    expect(p).not.toMatch(/lanjutkan sendiri/i);
  });
});
