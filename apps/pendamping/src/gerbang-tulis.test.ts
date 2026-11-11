import { createHash } from 'node:crypto';
import { EGRESS_ASET_UMUM } from '@urusin/core';
import { describe, expect, it } from 'vitest';
import {
  asetUmumBoleh,
  catatanBlokir,
  createGerbangTulis,
  hostAset,
  hostAsetUmum,
  hostAsetWilayah,
  jalurPihakKetigaBoleh,
  JENDELA_ISI_MS,
  putuskan,
  urlTantangan,
  type CatatanBlokir,
  type Jendela,
  type PermintaanGerbang,
  type Putusan,
} from './gerbang-tulis.js';

const T = 1_000_000;
const U = 'https://portal.contoh.go.id/layanan/kk';

/** `dokumen` = navigasi bingkai utama; selain itu XHR/fetch. */
const req = (metode: string, dokumen: boolean, url = U, asal?: string): PermintaanGerbang => ({
  metode,
  dokumen,
  utama: dokumen,
  xhr: !dokumen,
  url,
  ...(asal ? { asal } : {}),
});
/** Navigasi iframe (mis. form target="sink"). */
const iframe = (metode: string, url = U): PermintaanGerbang => ({
  metode,
  dokumen: true,
  utama: false,
  xhr: false,
  url,
});
/** Bukan XHR dan bukan dokumen: sendBeacon / keepalive ping / gambar. */
const beacon = (metode: string, url = U): PermintaanGerbang => ({
  metode,
  dokumen: false,
  utama: false,
  xhr: false,
  url,
});

const warga: Jendela = { jenis: 'warga' };
const diam: Jendela = { jenis: 'ai_diam' };
const tunggu: Jendela = { jenis: 'ai_diam', tungguWarga: true };
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
    ['diam GET dokumen (redirect JS/meta, jalur bersih)', diam, req('GET', true), T, 'lanjut'],
    [
      'diam GET dokumen probe 3674 (?p=close_form)',
      diam,
      req('GET', true, 'https://portal.contoh.go.id/index.php?p=close_form'),
      T,
      'lanjut',
    ],
    ['diam GET dokumen ke jalur tulis', diam, req('GET', true, `${U}/12/ajukan`), T, 'blokir'],
    ['diam GET dokumen kueri tulis', diam, req('GET', true, `${U}?aksi=simpan&id=12`), T, 'blokir'],
    ['diam GET dokumen kueri hapus', diam, req('GET', true, `${U}?hapus=1`), T, 'blokir'],
    ['diam POST dokumen', diam, req('POST', true), T, 'blokir'],
    ['diam POST XHR (latar)', diam, req('POST', false), T, 'blokir'],
    ['diam PUT XHR', diam, req('PUT', false), T, 'blokir'],
    ['diam PATCH XHR', diam, req('PATCH', false), T, 'blokir'],
    ['diam DELETE XHR', diam, req('DELETE', false), T, 'blokir'],
    ['diam metode huruf kecil', diam, req('post', false), T, 'blokir'],
    ['diam metode aneh', diam, req('PROPFIND', false), T, 'blokir'],
    ['diam iframe GET (widget dimuat belakangan)', diam, iframe('GET'), T, 'lanjut'],
    ['diam iframe POST', diam, iframe('POST'), T, 'blokir'],
    ['diam beacon POST', diam, beacon('POST'), T, 'blokir'],
    // takeover tanpa input warga: baca lolos, tulis hanya ke tantangan pihak ketiga
    ['tunggu GET dokumen (login lambat lalu location=)', tunggu, req('GET', true), T, 'lanjut'],
    ['tunggu GET iframe', tunggu, iframe('GET'), T, 'lanjut'],
    ['tunggu POST XHR (retry dari klik AI)', tunggu, req('POST', false), T, 'blokir'],
    ['tunggu POST dokumen', tunggu, req('POST', true), T, 'blokir'],
    ['tunggu POST beacon', tunggu, beacon('POST'), T, 'blokir'],
    [
      'tunggu POST Turnstile',
      tunggu,
      req('POST', false, 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/flow'),
      T,
      'lanjut',
    ],
    [
      'tunggu POST tantangan Cloudflare di host portal (cf-ray)',
      tunggu,
      {
        ...req('POST', true, 'https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/g/flow/ov1'),
        hostCloudflare: true,
      },
      T,
      'lanjut',
    ],
    [
      'tunggu POST /cdn-cgi/challenge-platform/ di host tanpa cf-ray (review L3)',
      tunggu,
      req('POST', true, 'https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/g/flow/ov1'),
      T,
      'blokir',
    ],
    [
      'tunggu POST reCAPTCHA',
      tunggu,
      req('POST', false, 'https://www.google.com/recaptcha/api2/userverify'),
      T,
      'lanjut',
    ],
    [
      'tunggu POST google bukan recaptcha',
      tunggu,
      req('POST', false, 'https://www.google.com/x'),
      T,
      'blokir',
    ],
    // Tantangan non-dokumen: lolos di semua jendela AI (probe #14); dokumen tetap aturan jendela.
    [
      'klik POST Turnstile flow (balapan dengan klik AI)',
      klik,
      req(
        'POST',
        false,
        'https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/flow/ov1',
      ),
      T,
      'lanjut',
    ],
    [
      'diam POST platform tantangan di host portal (cf-ray)',
      diam,
      {
        ...req('POST', false, 'https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/g/jsd/r/1'),
        hostCloudflare: true,
      },
      T,
      'lanjut',
    ],
    [
      'diam POST platform tantangan di host tanpa cf-ray',
      diam,
      req('POST', false, 'https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/g/jsd/r/1'),
      T,
      'blokir',
    ],
    [
      'isi POST reCAPTCHA reload lewat batas',
      isi,
      req('POST', false, 'https://www.google.com/recaptcha/api2/reload?k=x'),
      T + 10_000,
      'lanjut',
    ],
    [
      'klik POST dokumen ke platform tantangan',
      klik,
      req('POST', true, 'https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/g/flow'),
      T,
      'blokir',
    ],
    ['klik POST google bukan recaptcha', klik, req('POST', false, 'https://www.google.com/x'), T, 'blokir'],
    // ai_isi: XHR non-GET <= 3 detik, dokumen tidak pernah
    ['isi GET subresource', isi, req('GET', false), T, 'lanjut'],
    ['isi POST XHR di awal jendela', isi, req('POST', false), T, 'lanjut'],
    ['isi POST XHR tepat di batas', isi, req('POST', false), T + JENDELA_ISI_MS, 'lanjut'],
    ['isi POST XHR lewat batas', isi, req('POST', false), T + JENDELA_ISI_MS + 1, 'blokir'],
    ['isi PUT XHR lewat batas', isi, req('PUT', false), T + 10_000, 'blokir'],
    ['isi select onchange form.submit() (POST dokumen)', isi, req('POST', true), T, 'blokir'],
    ['isi GET dokumen (onchange location=)', isi, req('GET', true), T, 'blokir'],
    ['isi GET subresource lewat batas', isi, req('GET', false), T + 10_000, 'lanjut'],
    ['isi select onchange form POST ke iframe', isi, iframe('POST'), T, 'blokir'],
    ['isi form GET ke iframe', isi, iframe('GET'), T, 'blokir'],
    ['isi sendBeacon POST dalam jendela', isi, beacon('POST'), T, 'blokir'],
    ['isi fetch keepalive non-XHR dalam jendela', isi, beacon('PUT'), T, 'blokir'],
    // ai_klik: GET saja; dokumen hanya ke navKe
    ['klik GET XHR (ui_lokal memuat tab)', klik, req('GET', false), T, 'lanjut'],
    ['klik fetch POST dari type=button', klik, req('POST', false), T, 'blokir'],
    ['klik POST dokumen (submit tersembunyi)', klik, req('POST', true), T, 'blokir'],
    ['klik GET dokumen tanpa navKe', klik, req('GET', true), T, 'blokir'],
    ['klik GET dokumen ke navKe', klikNav, req('GET', true), T, 'lanjut'],
    ['klik GET dokumen ke navKe (fragmen beda)', klikNav, req('GET', true, `${U}#bagian`), T, 'lanjut'],
    ['klik GET dokumen ke URL lain (jalur tulis)', klikNav, req('GET', true, `${U}/hapus`), T, 'blokir'],
    ['klik GET dokumen query tulis', klikNav, req('GET', true, `${U}?hapus=1`), T, 'blokir'],
    [
      'klik redirect JS sesudah navKe ke jalur bersih (probe 3674)',
      klikNav,
      req('GET', true, 'https://portal.contoh.go.id/index.php?p=close_form'),
      T,
      'lanjut',
    ],
    [
      'klik tanpa navKe: GET dokumen jalur bersih tetap blokir',
      klik,
      req('GET', true, `${U}/langkah-2`),
      T,
      'blokir',
    ],
    [
      'klik redirect dari navKe',
      klikNav,
      req('GET', true, 'https://portal.contoh.go.id/masuk', U),
      T,
      'lanjut',
    ],
    [
      'klik redirect dari URL lain ke jalur bersih (setara redirect halaman)',
      klikNav,
      req('GET', true, 'https://portal.contoh.go.id/masuk', `${U}/x`),
      T,
      'lanjut',
    ],
    [
      'klik redirect dari URL lain ke jalur tulis',
      klikNav,
      req('GET', true, 'https://portal.contoh.go.id/permohonan/kirim', `${U}/x`),
      T,
      'blokir',
    ],
    ['klik POST dokumen ke navKe', klikNav, req('POST', true), T, 'blokir'],
    ['klik POST XHR walau navKe ada', klikNav, req('POST', false), T, 'blokir'],
    ['klik URL rusak', klikNav, req('GET', true, 'bukan url'), T, 'blokir'],
    ['klik form GET ke iframe (tanpa navKe)', klik, iframe('GET'), T, 'blokir'],
    ['klik iframe halaman tujuan navKe', klikNav, iframe('GET'), T, 'lanjut'],
    ['klik iframe POST walau navKe ada', klikNav, iframe('POST'), T, 'blokir'],
  ];
  it.each(kasus)('%s', (_n, j, r, now, harap) => {
    expect(putuskan(j, r, now)).toBe(harap);
  });

  it('setiap jendela AI memblokir setiap metode non-aman (properti)', () => {
    const jendela: Jendela[] = [diam, tunggu, { jenis: 'ai_isi', sampai: T - 1 }, klik, klikNav];
    for (const j of jendela)
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE', 'X'])
        for (const r of [req(m, true), req(m, false), iframe(m), beacon(m)])
          expect(putuskan(j, r, T)).toBe('blokir');
  });

  it('ai_isi: hanya XHR/fetch non-GET dalam jendela yang lolos (bukan iframe/beacon)', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(putuskan(isi, req(m, false), T)).toBe('lanjut');
      expect(putuskan(isi, iframe(m), T)).toBe('blokir');
      expect(putuskan(isi, beacon(m), T)).toBe('blokir');
    }
  });

  it('hostAsetUmum: CDN/fon bawaan sesi dikenali (bukan tujuan navigasi), domain resmi tidak (re-review LOW)', () => {
    for (const h of EGRESS_ASET_UMUM) {
      expect(hostAsetUmum(`https://${h}/npm/x@1/index.html`), h).toBe(true);
      expect(hostAsetUmum(`https://${h.toUpperCase()}./a`), h).toBe(true);
    }
    expect(hostAsetUmum('https://unpkg.com/paket-jahat@1.0.0/index.html')).toBe(true);
    expect(hostAsetUmum('https://disdukcapil.contoh.go.id/permohonan')).toBe(false);
    expect(hostAsetUmum('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(false);
    expect(hostAsetUmum('https://cdn.jsdelivr.net.jahat.com/')).toBe(false);
    expect(hostAsetUmum('bukan url')).toBe(false);
  });

  it('putuskan: dokumen dari host aset umum diblokir di SEMUA jendela, subresource GET-nya tidak (re-review MEDIUM)', () => {
    const cdn = 'https://unpkg.com/paket-jahat@1.0.0/index.html';
    const dok = (utama: boolean): PermintaanGerbang => ({
      metode: 'GET',
      dokumen: true,
      utama,
      xhr: false,
      url: cdn,
    });
    const sub: PermintaanGerbang = {
      metode: 'GET',
      dokumen: false,
      utama: false,
      xhr: false,
      url: 'https://unpkg.com/jquery@3/dist/jquery.min.js',
    };
    const jendela: Jendela[] = [
      { jenis: 'warga' },
      { jenis: 'ai_diam' },
      { jenis: 'ai_diam', tungguWarga: true },
      { jenis: 'ai_isi', sampai: T + 3_000 },
      { jenis: 'ai_klik', navKe: cdn },
    ];
    for (const j of jendela) {
      for (const ketat of [false, true]) {
        expect(putuskan(j, dok(true), T, ketat), `${JSON.stringify(j)} utama`).toBe('blokir');
        expect(putuskan(j, dok(false), T, ketat), `${JSON.stringify(j)} iframe`).toBe('blokir');
      }
      if (j.jenis !== 'ai_klik') expect(putuskan(j, sub, T), JSON.stringify(j)).toBe('lanjut');
    }
    expect(asetUmumBoleh({ url: cdn, resourceType: 'document', dokumen: true })).toBe(false);
    expect(asetUmumBoleh({ url: sub.url, resourceType: 'script', dokumen: false })).toBe(true);
    expect(asetUmumBoleh({ url: sub.url, resourceType: 'fetch', dokumen: false })).toBe(false);
    expect(asetUmumBoleh({ url: U, resourceType: 'fetch', dokumen: false })).toBe(true);
  });

  it('re-review LOW: hostAset pemda (3310/3404) hanya subresource, dokumen diblokir di semua jendela', () => {
    for (const host of ['dukcapil-cdn.slemankab.go.id', 'api.diskominfo.klaten.go.id']) {
      const url = `https://${host}/halaman.html`;
      expect(hostAsetWilayah(url), host).toBe(true);
      expect(hostAset(url), host).toBe(true);
      for (const t of ['script', 'stylesheet', 'font', 'image', 'xhr', 'fetch'])
        expect(asetUmumBoleh({ url, resourceType: t, dokumen: false }), `${host} ${t}`).toBe(true);
      expect(asetUmumBoleh({ url, resourceType: 'document', dokumen: true }), host).toBe(false);
      expect(asetUmumBoleh({ url, resourceType: 'media', dokumen: false }), host).toBe(false);
      const dok: PermintaanGerbang = { metode: 'GET', dokumen: true, utama: true, xhr: false, url };
      for (const j of [
        { jenis: 'warga' },
        { jenis: 'ai_diam' },
        { jenis: 'ai_diam', tungguWarga: true },
      ] as Jendela[])
        expect(putuskan(j, dok, T), `${host} ${JSON.stringify(j)}`).toBe('blokir');
    }
    // Host portal sendiri bukan host aset.
    expect(hostAsetWilayah('https://dukcapilonline.slemankab.go.id/Flow/signin')).toBe(false);
    expect(hostAsetWilayah(U)).toBe(false);
  });

  it('jalurPihakKetigaBoleh: www.google.com hanya /recaptcha/ (review L3)', () => {
    expect(jalurPihakKetigaBoleh('https://www.google.com/recaptcha/api2/anchor?k=x')).toBe(true);
    expect(jalurPihakKetigaBoleh('https://www.google.com/search?q=x')).toBe(false);
    expect(jalurPihakKetigaBoleh('https://WWW.GOOGLE.COM/maps')).toBe(false);
    expect(jalurPihakKetigaBoleh('https://www.gstatic.com/recaptcha/x.js')).toBe(true);
    expect(jalurPihakKetigaBoleh(U)).toBe(true);
  });

  it('urlTantangan: host tantangan pihak ketiga dan platform Cloudflare saja', () => {
    expect(urlTantangan('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(true);
    expect(urlTantangan('https://newassets.hcaptcha.com/captcha/v1/x')).toBe(true);
    expect(urlTantangan('https://www.recaptcha.net/recaptcha/api2/reload')).toBe(true);
    expect(urlTantangan('https://www.google.com/recaptcha/api2/userverify')).toBe(true);
    expect(urlTantangan('https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/b/flow', true)).toBe(true);
    expect(urlTantangan('https://portal.contoh.go.id/cdn-cgi/challenge-platform/h/b/flow')).toBe(false);
    expect(urlTantangan('https://www.google.com/search')).toBe(false);
    expect(urlTantangan('https://cloudflare.com.evil.example/cdn-cgi/x')).toBe(false);
    expect(urlTantangan('https://challenges.cloudflare.com.evil.example/x')).toBe(false);
    expect(urlTantangan(U)).toBe(false);
    expect(urlTantangan('bukan url')).toBe(false);
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
      xhr: true,
    });
    expect(JSON.stringify(c)).not.toContain('rahasia-123');
  });
});

describe('mode ketat (dokumen kotor / halaman akhir)', () => {
  const navKe = 'https://portal.contoh.go.id/layanan/kk';
  it('redirect halaman sendiri (GET bingkai utama di luar navKe) diblokir; navKe, subresource, tantangan tetap', () => {
    const alih = req('GET', true, 'https://portal.contoh.go.id/tutup?p=close_form');
    expect(putuskan({ jenis: 'ai_diam' }, alih, T, false)).toBe('lanjut');
    expect(putuskan({ jenis: 'ai_diam' }, alih, T, true)).toBe('blokir');
    expect(putuskan({ jenis: 'ai_diam', tungguWarga: true }, alih, T, true)).toBe('blokir');
    expect(putuskan({ jenis: 'ai_klik', navKe }, alih, T, true)).toBe('blokir');
    expect(putuskan({ jenis: 'ai_klik', navKe }, req('GET', true, navKe), T, true)).toBe('lanjut');
    expect(putuskan({ jenis: 'ai_diam' }, req('GET', false, `${navKe}/x.js`), T, true)).toBe('lanjut');
    expect(putuskan({ jenis: 'ai_diam' }, iframe('GET'), T, true)).toBe('lanjut');
    // Warga mengetuk sendiri: jendela warga tidak terpengaruh.
    expect(putuskan({ jenis: 'warga' }, alih, T, true)).toBe('lanjut');
  });

  it('createGerbangTulis membaca ketat setiap permintaan', () => {
    let ketat = false;
    const g = createGerbangTulis({
      wargaPegang: () => false,
      onBlokir: () => {},
      ketat: () => ketat,
      now: () => T,
    });
    const alih = req('GET', true, 'https://portal.contoh.go.id/tutup');
    expect(g.periksa(alih)).toBe('lanjut');
    ketat = true;
    expect(g.periksa(alih)).toBe('blokir');
  });
});

describe('createGerbangTulis', () => {
  it('tulis non-GET yang lolos di jendela warga dilaporkan (onTulisWarga); GET dan jendela AI tidak', () => {
    let pegang = false;
    let tulis = 0;
    const g = createGerbangTulis({
      wargaPegang: () => pegang,
      onBlokir: () => {},
      onTulisWarga: () => void tulis++,
      now: () => T,
    });
    g.setAi({ jenis: 'ai_isi', sampai: T + 3000 });
    expect(g.periksa(req('POST', false))).toBe('lanjut');
    expect(tulis).toBe(0);
    pegang = true;
    expect(g.periksa(req('GET', true))).toBe('lanjut');
    expect(tulis).toBe(0);
    expect(g.periksa(req('post', true))).toBe('lanjut');
    expect(tulis).toBe(1);
  });

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

  it('tolak (WebSocket): selalu blokir; dicatat hanya di jendela AI', () => {
    let pegang = false;
    const blokir: CatatanBlokir[] = [];
    const g = createGerbangTulis({ wargaPegang: () => pegang, onBlokir: (c) => blokir.push(c) });
    const ws = { metode: 'WSOCKET', dokumen: false, utama: false, xhr: false, url: 'wss://a.go.id/ws' };
    expect(g.tolak(ws)).toBe('blokir');
    pegang = true;
    expect(g.tolak(ws)).toBe('blokir');
    expect(blokir).toEqual([
      expect.objectContaining({ metode: 'WSOCKET', jendela: 'ai_diam', host: 'a.go.id' }),
    ]);
  });

  it('takeover tanpa input = ai_diam tungguWarga; input warga nyata = warga', () => {
    let pegang = false;
    let tunggu = true;
    const g = createGerbangTulis({
      wargaPegang: () => pegang,
      wargaTunggu: () => tunggu,
      onBlokir: () => {},
    });
    g.setAi({ jenis: 'ai_klik' });
    expect(g.jendela()).toEqual({ jenis: 'ai_diam', tungguWarga: true });
    expect(g.periksa(req('POST', false))).toBe('blokir');
    expect(g.periksa(req('GET', true))).toBe('lanjut');
    pegang = true;
    expect(g.jendela()).toEqual({ jenis: 'warga' });
    expect(g.periksa(req('POST', false))).toBe('lanjut');
    pegang = false;
    tunggu = false;
    expect(g.jendela()).toEqual({ jenis: 'ai_klik' });
  });
});
