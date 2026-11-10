import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  catatanBlokir,
  createGerbangTulis,
  JENDELA_ISI_MS,
  putuskan,
  type CatatanBlokir,
  type Jendela,
  type PermintaanGerbang,
  type Putusan,
} from './gerbang-tulis.js';

const T = 1_000_000;
const U = 'https://portal.contoh.go.id/layanan/kk';

const req = (metode: string, dokumen: boolean, url = U, asal?: string): PermintaanGerbang => ({
  metode,
  dokumen,
  url,
  ...(asal ? { asal } : {}),
});

const warga: Jendela = { jenis: 'warga' };
const diam: Jendela = { jenis: 'ai_diam' };
const isi: Jendela = { jenis: 'ai_isi', sampai: T + JENDELA_ISI_MS };
const klik: Jendela = { jenis: 'ai_klik' };
const klikNav: Jendela = { jenis: 'ai_klik', navKe: U };

describe('putuskan (tabel lengkap)', () => {
  const kasus: [string, Jendela, PermintaanGerbang, number, Putusan][] = [
    // warga: semua lolos (ketukan warga lewat CDP Input saat takeover)
    ['warga GET dokumen', warga, req('GET', true), T, 'lanjut'],
    ['warga POST dokumen (warga menekan Kirim)', warga, req('POST', true), T, 'lanjut'],
    ['warga POST XHR', warga, req('POST', false), T, 'lanjut'],
    ['warga DELETE XHR', warga, req('DELETE', false), T, 'lanjut'],
    // ai_diam: GET subresource saja
    ['diam GET subresource', diam, req('GET', false), T, 'lanjut'],
    ['diam HEAD subresource', diam, req('HEAD', false), T, 'lanjut'],
    ['diam OPTIONS preflight', diam, req('OPTIONS', false), T, 'lanjut'],
    ['diam GET dokumen (redirect JS/meta)', diam, req('GET', true), T, 'blokir'],
    ['diam POST dokumen', diam, req('POST', true), T, 'blokir'],
    ['diam POST XHR (latar)', diam, req('POST', false), T, 'blokir'],
    ['diam PUT XHR', diam, req('PUT', false), T, 'blokir'],
    ['diam PATCH XHR', diam, req('PATCH', false), T, 'blokir'],
    ['diam DELETE XHR', diam, req('DELETE', false), T, 'blokir'],
    ['diam metode huruf kecil', diam, req('post', false), T, 'blokir'],
    ['diam metode aneh', diam, req('PROPFIND', false), T, 'blokir'],
    // ai_isi: XHR non-GET <= 3 detik, dokumen tidak pernah
    ['isi GET subresource', isi, req('GET', false), T, 'lanjut'],
    ['isi POST XHR di awal jendela', isi, req('POST', false), T, 'lanjut'],
    ['isi POST XHR tepat di batas', isi, req('POST', false), T + JENDELA_ISI_MS, 'lanjut'],
    ['isi POST XHR lewat batas', isi, req('POST', false), T + JENDELA_ISI_MS + 1, 'blokir'],
    ['isi PUT XHR lewat batas', isi, req('PUT', false), T + 10_000, 'blokir'],
    ['isi select onchange form.submit() (POST dokumen)', isi, req('POST', true), T, 'blokir'],
    ['isi GET dokumen (onchange location=)', isi, req('GET', true), T, 'blokir'],
    ['isi GET subresource lewat batas', isi, req('GET', false), T + 10_000, 'lanjut'],
    // ai_klik: GET saja; dokumen hanya ke navKe
    ['klik GET XHR (ui_lokal memuat tab)', klik, req('GET', false), T, 'lanjut'],
    ['klik fetch POST dari type=button', klik, req('POST', false), T, 'blokir'],
    ['klik POST dokumen (submit tersembunyi)', klik, req('POST', true), T, 'blokir'],
    ['klik GET dokumen tanpa navKe', klik, req('GET', true), T, 'blokir'],
    ['klik GET dokumen ke navKe', klikNav, req('GET', true), T, 'lanjut'],
    ['klik GET dokumen ke navKe (fragmen beda)', klikNav, req('GET', true, `${U}#bagian`), T, 'lanjut'],
    ['klik GET dokumen ke URL lain', klikNav, req('GET', true, `${U}/hapus`), T, 'blokir'],
    ['klik GET dokumen query beda', klikNav, req('GET', true, `${U}?hapus=1`), T, 'blokir'],
    [
      'klik redirect dari navKe',
      klikNav,
      req('GET', true, 'https://portal.contoh.go.id/masuk', U),
      T,
      'lanjut',
    ],
    [
      'klik redirect dari URL lain',
      klikNav,
      req('GET', true, 'https://portal.contoh.go.id/masuk', `${U}/x`),
      T,
      'blokir',
    ],
    ['klik POST dokumen ke navKe', klikNav, req('POST', true), T, 'blokir'],
    ['klik POST XHR walau navKe ada', klikNav, req('POST', false), T, 'blokir'],
    ['klik URL rusak', klikNav, req('GET', true, 'bukan url'), T, 'blokir'],
  ];
  it.each(kasus)('%s', (_n, j, r, now, harap) => {
    expect(putuskan(j, r, now)).toBe(harap);
  });

  it('setiap jendela AI memblokir setiap metode non-aman (properti)', () => {
    const jendela: Jendela[] = [diam, { jenis: 'ai_isi', sampai: T - 1 }, klik, klikNav];
    for (const j of jendela)
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE', 'X'])
        for (const dokumen of [true, false]) expect(putuskan(j, req(m, dokumen), T)).toBe('blokir');
  });
});

describe('catatanBlokir', () => {
  it('hanya metode, host, sha256(path), jendela: tanpa query/fragmen', () => {
    const c = catatanBlokir(
      { jenis: 'ai_klik' },
      req('post', false, 'https://a.go.id:8443/api/simpan?kode=rahasia-123#x'),
    );
    expect(c).toEqual({
      metode: 'POST',
      host: 'a.go.id:8443',
      jalurSha256: createHash('sha256').update('/api/simpan').digest('hex'),
      jendela: 'ai_klik',
      dokumen: false,
    });
    expect(JSON.stringify(c)).not.toContain('rahasia-123');
  });
});

describe('createGerbangTulis', () => {
  it('warga memegang kendali = lolos; AI = jendela terakhir; blokir dilaporkan sekali per permintaan', () => {
    let pegang = false;
    let now = T;
    const blokir: CatatanBlokir[] = [];
    const g = createGerbangTulis({
      wargaPegang: () => pegang,
      onBlokir: (c) => blokir.push(c),
      now: () => now,
    });
    expect(g.jendela()).toEqual({ jenis: 'ai_diam' });
    expect(g.periksa(req('POST', false))).toBe('blokir');
    pegang = true;
    expect(g.jendela()).toEqual({ jenis: 'warga' });
    expect(g.periksa(req('POST', true))).toBe('lanjut');
    pegang = false;
    g.setAi({ jenis: 'ai_isi', sampai: T + 3000 });
    expect(g.periksa(req('POST', false))).toBe('lanjut');
    now = T + 3001;
    expect(g.periksa(req('POST', false))).toBe('blokir');
    expect(blokir.map((b) => b.jendela)).toEqual(['ai_diam', 'ai_isi']);
  });
});
