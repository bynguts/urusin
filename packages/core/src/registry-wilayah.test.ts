import { describe, expect, it } from 'vitest';
import {
  EGRESS_ASET_UMUM,
  EGRESS_PIHAK_KETIGA,
  OFFICIAL_DOMAINS,
  egressAllowedHosts,
  getOfficialDomain,
  isOfficialUrl,
} from './registry.js';
import {
  DOMAIN_WILAYAH,
  EGRESS_PIHAK_KETIGA_WILAYAH,
  PLATFORM_WILAYAH,
  PORTAL_WILAYAH,
  URUTAN_KANAL,
  hostsWilayah,
} from './registry-wilayah.js';
import { hostsTantanganWilayah } from './tantangan-wilayah.js';

const HOST_PERSIS = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;
const goId = (h: string) => h.endsWith('.go.id');
const portal = Object.values(PORTAL_WILAYAH);

describe('lint registry wilayah (ADR 0030)', () => {
  it('semua host persis: huruf kecil, tanpa wildcard/port/skema/path', () => {
    for (const d of DOMAIN_WILAYAH) expect(d.host, d.host).toMatch(HOST_PERSIS);
    for (const w of portal)
      for (const h of [...w.hosts, ...w.hostInfo]) expect(h, w.kode).toMatch(HOST_PERSIS);
  });

  it('host bukan .go.id wajib punya sumber halaman https .go.id', () => {
    for (const w of portal) {
      expect(w.hostInfo.every(goId), `${w.kode} hostInfo`).toBe(true);
      if (w.hosts.every(goId)) continue;
      expect(w.sumber, w.kode).toBeDefined();
      const s = new URL(w.sumber!);
      expect(s.protocol, w.kode).toBe('https:');
      expect(goId(s.hostname), `${w.kode}: sumber ${w.sumber}`).toBe(true);
    }
    for (const p of Object.values(PLATFORM_WILAYAH)) {
      expect(goId(new URL(p.sumber).hostname)).toBe(true);
      expect(p.hosts.every(goId)).toBe(true);
    }
  });

  it('jenis web <=> ada host portal; kelas cocok dengan jenis', () => {
    const peta = { A: 'web', B: 'web', C: 'aplikasi', D: 'whatsapp', E: 'nasional', F: 'tidak_diketahui' };
    for (const w of portal) {
      expect(w.jenis, w.kode).toBe(peta[w.kelas]);
      expect(w.hosts.length > 0, w.kode).toBe(w.jenis === 'web');
      expect(w.kode, w.kode).toMatch(/^\d{4}$/);
    }
    // Probe portal nyata 2026-11-10: 9 portal mati/berubah dikeluarkan dari jalur web.
    expect(portal.filter((w) => w.jenis === 'web').length).toBeGreaterThanOrEqual(55);
  });

  it('SIDAK Aceh: satu platform dirujuk 17 tenant Aceh yang hidup (probe 2026-11-10)', () => {
    const sidak = portal.filter((w) => w.platform === 'sidak-aceh');
    expect(sidak).toHaveLength(17);
    for (const w of sidak) expect(w.kode.startsWith('11')).toBe(true);
    expect(PLATFORM_WILAYAH['sidak-aceh']!.hosts).toEqual(['sidak.acehprov.go.id']);
  });

  it('semua host wilayah masuk union OFFICIAL_DOMAINS (edge) dan lolos pencocok persis', () => {
    const resmi = new Set(OFFICIAL_DOMAINS.map((d) => d.host));
    const union = new Set(egressAllowedHosts());
    for (const d of DOMAIN_WILAYAH) {
      expect(resmi.has(d.host), d.host).toBe(true);
      expect(union.has(d.host), d.host).toBe(true);
      expect(isOfficialUrl(`https://${d.host}/`), d.host).toBe(true);
    }
    // Tidak ada host pihak ketiga yang menyamar sebagai domain wilayah.
    for (const { host } of EGRESS_PIHAK_KETIGA) expect(resmi.has(host)).toBe(false);
  });

  it('hostsWilayah: host wilayah + tantangan Cloudflare; tantangan hanya bila ada host wilayah', () => {
    expect(EGRESS_PIHAK_KETIGA_WILAYAH).toEqual(['challenges.cloudflare.com']);
    for (const h of EGRESS_PIHAK_KETIGA_WILAYAH) expect(EGRESS_PIHAK_KETIGA.map((e) => e.host)).toContain(h);
    const wonogiri = hostsWilayah('3312');
    expect(wonogiri).toEqual(
      expect.arrayContaining([
        'telunjuksakti.wonogirikab.go.id',
        'disdukcapil.wonogirikab.go.id',
        'challenges.cloudflare.com',
      ]),
    );
    const bekasi = hostsWilayah('3275');
    expect(bekasi).toEqual(expect.arrayContaining(['www.e-open.id', 'disdukcapil.bekasikota.go.id']));
    expect(hostsWilayah('1107')).toEqual(
      expect.arrayContaining(['sigoduk.pidiekab.go.id', 'sidak.acehprov.go.id']),
    );
    // Wilayah tanpa host: tidak ada apa pun, termasuk tidak ada host tantangan.
    expect(hostsWilayah('3171')).toEqual([]);
    expect(hostsWilayah('9999')).toEqual([]);
    expect(hostsWilayah('__proto__')).toEqual([]);
    // Tidak ada host wilayah lain yang bocor ke sesi.
    expect(wonogiri).not.toContain('www.e-open.id');
    // Host aset portal (probe nyata: CDN/API .go.id yang dimuat halaman) ikut egress sesi wilayahnya saja.
    expect(PORTAL_WILAYAH['3404']!.hostAset).toEqual(['dukcapil-cdn.slemankab.go.id']);
    expect(PORTAL_WILAYAH['3310']!.hostAset).toEqual(['api.diskominfo.klaten.go.id']);
    expect(hostsWilayah('3404')).toContain('dukcapil-cdn.slemankab.go.id');
    expect(hostsWilayah('3310')).toContain('api.diskominfo.klaten.go.id');
    expect(hostsWilayah('3312')).not.toContain('dukcapil-cdn.slemankab.go.id');
  });

  it('hostsTantanganWilayah: Cloudflare + host sesuai proteksi portal; semua terdaftar di egress', () => {
    expect(hostsTantanganWilayah('3312')).toEqual([
      'challenges.cloudflare.com',
      'brunhild.challenges.cloudflare.com',
    ]);
    expect(hostsTantanganWilayah('1306')).toEqual(
      expect.arrayContaining(['challenges.cloudflare.com', 'www.google.com', 'www.recaptcha.net']),
    );
    expect(hostsTantanganWilayah('3208')).toEqual(expect.arrayContaining(['js.hcaptcha.com']));
    expect(hostsTantanganWilayah('9999')).toEqual([]);
    expect(hostsTantanganWilayah('__proto__')).toEqual([]);
    const egress = new Set(egressAllowedHosts());
    for (const kode of Object.keys(PORTAL_WILAYAH))
      for (const h of hostsTantanganWilayah(kode)) expect(egress.has(h), `${kode} ${h}`).toBe(true);
  });

  it('EGRESS_ASET_UMUM: CDN/fon bawaan sesi, semuanya terdaftar di egress dan bukan domain resmi', () => {
    const egress = new Set(EGRESS_PIHAK_KETIGA.map((e) => e.host));
    for (const h of EGRESS_ASET_UMUM) expect(egress.has(h), h).toBe(true);
    for (const h of ['unpkg.com', 'cdn.tailwindcss.com', 'code.jquery.com', 'fonts.googleapis.com'])
      expect(EGRESS_ASET_UMUM).toContain(h);
    // Tantangan tidak ikut aset umum (punya jalurnya sendiri lewat proteksi/tantangan wilayah).
    expect(EGRESS_ASET_UMUM.some((h) => h.includes('challenges') || h.includes('recaptcha'))).toBe(false);
  });

  it('probe portal nyata 2026-11-10: id-only, proteksi, Google-only, dan portal mati/berubah', () => {
    // SG ditolak, ID terbuka: host portal ber-aksesWilayah id-only (diteruskan ke OFFICIAL_DOMAINS).
    for (const kode of ['1271', '1372', '1403', '1771', '3275', '3279', '3402', '3674', '6271']) {
      const w = PORTAL_WILAYAH[kode]!;
      expect(w.aksesWilayah, kode).toBe('id-only');
      for (const h of w.hosts) expect(getOfficialDomain(h)?.aksesWilayah, `${kode} ${h}`).toBe('id-only');
    }
    // Tanpa catatan id-only: tetap tanpa syarat jaringan dari data wilayah.
    expect(getOfficialDomain('weh.sabangkota.go.id')?.aksesWilayah).toBeUndefined();
    // Proteksi yang teramati: reCAPTCHA (host Google ikut sesi) dan Turnstile.
    for (const kode of ['1971', '6402']) {
      expect(PORTAL_WILAYAH[kode]!.proteksi, kode).toContain('recaptcha');
      expect(hostsTantanganWilayah(kode), kode).toEqual(expect.arrayContaining(['www.google.com']));
    }
    expect(PORTAL_WILAYAH['1271']!.proteksi).toContain('turnstile');
    expect(PORTAL_WILAYAH['3201']!.login).toEqual(['google']);
    // Mati (recon ulang 2026-11-12): bukan jalur web, tanpa host portal, catatan OBS bertanggal + bukti.
    for (const kode of ['1117', '1173', '3525']) {
      const w = PORTAL_WILAYAH[kode]!;
      expect(w.jenis, kode).toBe('tidak_diketahui');
      expect(w.hosts, kode).toEqual([]);
      expect(w.url, kode).toBeUndefined();
      expect(w.platform, kode).toBeUndefined();
      expect(w.catatan, kode).toMatch(/^OBS 2026-11-12: portal daring tidak bisa dipakai \(.+\)/);
      // Tetap dipandu ke situs Disdukcapil yang benar bila ada.
      if (kode !== '3525') expect(w.hostInfo.length, kode).toBeGreaterThan(0);
    }
    expect(getOfficialDomain('cecah.benermeriahkab.go.id')).toBeUndefined();
    expect(getOfficialDomain('simpedu.lhokseumawekota.go.id')).toBeUndefined();
    expect(getOfficialDomain('poedak.gresikkab.go.id')).toBeUndefined();
    // 1102: host lama tetap tercatat sebagai situs informasi Disdukcapil, bukan portal layanan.
    expect(PORTAL_WILAYAH['1102']!.hostInfo).toContain('disdukcapil.acehtenggarakab.go.id');
    expect(PORTAL_WILAYAH['1102']!.hosts).not.toContain('disdukcapil.acehtenggarakab.go.id');
  });

  it('recon ulang kelas F 2026-11-12: portal pengganti ditawarkan ke Browser Pendamping', () => {
    // kode -> [kelas, host url, login yang wajib ada]
    const pengganti: Record<string, [string, string, string]> = {
      '1102': ['A', 'simpel.acehtenggarakab.go.id', 'email_sandi'],
      '1116': ['B', 'disdukcapil.acehtamiangkab.go.id', 'tanpa_akun'],
      '1171': ['A', 'sihati.bandaacehkota.go.id', 'email_sandi'],
      '1471': ['B', 'appdukcapil.pekanbaru.go.id', 'tanpa_akun'],
      '3314': ['A', 'pandu-online.sragenkab.go.id', 'nik_sandi'],
    };
    for (const [kode, [kelas, host, login]] of Object.entries(pengganti)) {
      const w = PORTAL_WILAYAH[kode]!;
      expect(w.kelas, kode).toBe(kelas);
      expect(w.jenis, kode).toBe('web');
      const u = new URL(w.url!);
      // Syarat "ditawarkan" (routing Pendamping): https, host url = host portal, bukan Google-saja.
      expect(u.protocol, kode).toBe('https:');
      expect(u.hostname, kode).toBe(host);
      expect(w.hosts, kode).toContain(u.hostname);
      expect(w.login, kode).toContain(login);
      expect(
        w.login.every((l) => l === 'google'),
        kode,
      ).toBe(false);
      expect(w.platform, kode).toBeUndefined();
      expect(w.catatan, kode).toMatch(/^OBS 2026-11-12: /);
      expect(isOfficialUrl(w.url!), kode).toBe(true);
      expect(getOfficialDomain(u.hostname)?.wilayah, kode).toBe(kode);
      expect(hostsWilayah(kode), kode).toContain(u.hostname);
    }
    // Host lama yang mati/TLS rusak tidak pernah menjadi host sesi.
    for (const h of [
      'primadona.bandaacehkota.go.id',
      'silatersipu.acehtamiangkab.go.id',
      'sianton.dukcapil.sragenkab.go.id',
      'sipayo.acehjayakab.go.id',
    ])
      expect(getOfficialDomain(h), h).toBeUndefined();
    // 1114: TLS sipayo rusak; kanal resmi WhatsApp/Facebook dari situs Disdukcapil = dipandu (kelas D).
    expect(PORTAL_WILAYAH['1114']).toMatchObject({ kelas: 'D', jenis: 'whatsapp', hosts: [] });
    expect(PORTAL_WILAYAH['1114']!.hostInfo).toContain('dukcapil.acehjayakab.go.id');
    // 1471: sipenduduk hanya info/lacak (ikut sesi wilayah, bukan host portal); formulir pada jam layanan.
    expect(PORTAL_WILAYAH['1471']!.hostInfo).toContain('sipenduduk.pekanbaru.go.id');
    expect(PORTAL_WILAYAH['1471']!.jamLayanan).toMatch(/09\.00-13\.59/);
    expect(hostsWilayah('1471')).toContain('sipenduduk.pekanbaru.go.id');
  });

  it('probe 2026-11-12: 1101 id-only (JSD macet dari SG), 1771 jam layanan, 3315 masuk langsung /login', () => {
    const acehSelatan = PORTAL_WILAYAH['1101']!;
    expect(acehSelatan.aksesWilayah).toBe('id-only');
    expect(acehSelatan.platform).toBe('sidak-aceh');
    expect(acehSelatan.proteksi).toEqual(expect.arrayContaining(['cloudflare', 'turnstile']));
    expect(getOfficialDomain('simpeladminduk.acehselatankab.go.id')?.aksesWilayah).toBe('id-only');
    // Host platform bersama tidak ikut id-only (tenant SIDAK lain tetap dari worker mana pun).
    expect(getOfficialDomain('sidak.acehprov.go.id')?.aksesWilayah).toBeUndefined();
    const bengkulu = PORTAL_WILAYAH['1771']!;
    expect(bengkulu.url).toBe('https://slawe.bengkulukota.go.id/');
    expect(bengkulu.jamLayanan).toBe('Senin-Jumat 08.00-16.00 WIB');
    const grobogan = PORTAL_WILAYAH['3315']!;
    expect(grobogan.url).toBe('https://klikdukcapil.grobogan.go.id/login');
    expect(grobogan.login).toEqual(['nik_sandi']);
    expect(grobogan.proteksi).toContain('turnstile');
  });

  it('probe 2026-11-11: login PAK ONOM (3279) di host pemkot lain, ikut portal dan id-only', () => {
    const h = 'bebeong.banjarkota.go.id';
    expect(PORTAL_WILAYAH['3279']!.hosts).toContain(h);
    expect(hostsWilayah('3279')).toContain(h);
    expect(isOfficialUrl(`https://${h}/open_layanan/pakonom`)).toBe(true);
    expect(getOfficialDomain(h)).toMatchObject({ wilayah: '3279', aksesWilayah: 'id-only' });
  });

  it('urutan kanal routing multi-kanal', () => {
    expect(URUTAN_KANAL).toEqual(['portal_web', 'ikd', 'whatsapp', 'kantor']);
  });
});
