import { describe, expect, it } from 'vitest';
import {
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
  });

  it('hostsTantanganWilayah: Cloudflare + host sesuai proteksi portal; semua terdaftar di egress', () => {
    expect(hostsTantanganWilayah('3312')).toEqual(['challenges.cloudflare.com']);
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
    // Mati/berubah: bukan jalur web lagi, tanpa host portal, catatan OBS bertanggal + alasan.
    for (const kode of ['1117', '1171', '1173', '1114', '3314', '1116', '3525', '1102', '1471']) {
      const w = PORTAL_WILAYAH[kode]!;
      expect(w.jenis, kode).toBe('tidak_diketahui');
      expect(w.hosts, kode).toEqual([]);
      expect(w.url, kode).toBeUndefined();
      expect(w.platform, kode).toBeUndefined();
      expect(w.catatan, kode).toMatch(/^OBS 2026-11-10: portal daring tidak bisa dipakai \(.+\)/);
    }
    expect(getOfficialDomain('cecah.benermeriahkab.go.id')).toBeUndefined();
    // 1102: host tetap tercatat sebagai situs informasi Disdukcapil, bukan portal layanan.
    expect(PORTAL_WILAYAH['1102']!.hostInfo).toContain('disdukcapil.acehtenggarakab.go.id');
  });

  it('urutan kanal routing multi-kanal', () => {
    expect(URUTAN_KANAL).toEqual(['portal_web', 'ikd', 'whatsapp', 'kantor']);
  });
});
