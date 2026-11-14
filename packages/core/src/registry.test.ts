import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errors.js';
import {
  EGRESS_PIHAK_KETIGA,
  OFFICIAL_DOMAINS,
  egressAllowedHosts,
  getOfficialDomain,
  isOfficialUrl,
  matchOfficialOrigin,
  matchOfficialUrl,
} from './registry.js';
import { DOMAIN_WILAYAH, PORTAL_WILAYAH } from './registry-wilayah.js';

const T = 'telunjuksakti.wonogirikab.go.id';

describe('registry domain resmi', () => {
  it('memuat 14 domain seed lalu host wilayah, tanpa duplikat; host bukan .go.id hanya dari data wilayah', () => {
    const hosts = OFFICIAL_DOMAINS.map((d) => d.host);
    expect(hosts.slice(0, 14)).toContain(T);
    expect(hosts.length).toBe(14 + DOMAIN_WILAYAH.filter((d) => !hosts.slice(0, 14).includes(d.host)).length);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const h of hosts.slice(0, 14)) expect(h.endsWith('.go.id') || h === 'oss.go.id').toBe(true);
    // Pengecualian bukan .go.id (mis. e-open.id) wajib bersumber halaman .go.id: lihat registry-wilayah.test.ts.
    for (const h of hosts.filter((x) => !x.endsWith('.go.id')))
      expect(DOMAIN_WILAYAH.some((d) => d.host === h)).toBe(true);
  });

  it('aksesWilayah dari probe server produksi: blokir keras = id-only, tantangan interaktif = id-utama', () => {
    const akses = (a: string) => OFFICIAL_DOMAINS.filter((d) => d.aksesWilayah === a).map((d) => d.host);
    // Seed tangan (Sidnok) + host portal wilayah yang ditolak dari IP Singapura (probe portal nyata 2026-11-10)
    // + 1101 (interstitial JSD macet tanpa kotak centang dari Singapura, probe 2026-11-12).
    const probe = ['1101', '1271', '1372', '1403', '1771', '3275', '3279', '3402', '3674', '6271'].flatMap(
      (k) => PORTAL_WILAYAH[k]!.hosts,
    );
    expect(akses('id-only').sort()).toEqual(['sidnok.semarangkota.go.id', ...probe].sort());
    // id-utama: Telunjuk Sakti (seed) + portal dengan interstitial Turnstile dari IP Singapura (Situbondo, Makassar).
    expect(akses('id-utama').sort()).toEqual(
      [
        'telunjuksakti.wonogirikab.go.id',
        ...['3512', '7371'].flatMap((k) => PORTAL_WILAYAH[k]!.hosts),
      ].sort(),
    );
  });

  it.each(OFFICIAL_DOMAINS.map((d) => d.host))('menerima https://%s/', (host) => {
    expect(isOfficialUrl(`https://${host}/`)).toBe(true);
  });

  it('menerima path, query, dan fragment pada host resmi', () => {
    const r = matchOfficialUrl(`https://${T}/telunjuksakti/index.php/users/login?x=1#a`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.domain.wilayah).toBe('3312');
  });

  it('host tidak peka huruf besar (dinormalisasi parser URL)', () => {
    expect(isOfficialUrl(`https://${T.toUpperCase()}/`)).toBe(true);
  });

  it('menerima port 443 eksplisit karena dinormalisasi menjadi default', () => {
    expect(isOfficialUrl(`https://${T}:443/`)).toBe(true);
  });

  it('getOfficialDomain mengembalikan metadata instansi', () => {
    expect(getOfficialDomain('cekdptonline.kpu.go.id')?.instansi).toBe('KPU');
    expect(getOfficialDomain('kpu.go.id')).toBeUndefined();
  });
});

describe('jebakan lookalike', () => {
  const traps: [string, string, ErrorCode][] = [
    ['sufiks jebakan', `https://${T}.evil.com/`, ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['sufiks jebakan dengan strip', `https://${T}-login.com/`, ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['prefiks subdomain asing', `https://login.${T}/`, ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['subdomain di atas domain induk resmi', 'https://evil.oss.go.id/', ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['domain induk yang tidak terdaftar', 'https://wonogirikab.go.id/', ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['http bukan https', `http://${T}/`, ErrorCode.URL_NOT_HTTPS],
    ['skema ftp', `ftp://${T}/`, ErrorCode.URL_NOT_HTTPS],
    ['userinfo menyamar host', `https://${T}@evil.com/`, ErrorCode.URL_HAS_USERINFO],
    ['userinfo dengan password', `https://user:pass@${T}/`, ErrorCode.URL_HAS_USERINFO],
    ['userinfo kosong', `https://@${T}/`, ErrorCode.URL_HAS_USERINFO],
    ['port non-standar', `https://${T}:8443/`, ErrorCode.URL_NONSTANDARD_PORT],
    ['punycode homograf', 'https://xn--telunjuksakt-w5b.wonogirikab.go.id/', ErrorCode.URL_PUNYCODE],
    [
      'unicode homograf (dikonversi ke punycode)',
      'https://telunjuksaktі.wonogirikab.go.id/',
      ErrorCode.URL_PUNYCODE,
    ],
    ['typosquat huruf hilang', 'https://telunjuksakt.wonogirikab.go.id/', ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['typosquat go.id → co.id', 'https://telunjuksakti.wonogirikab.co.id/', ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['titik akhir FQDN', `https://${T}./`, ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['backslash + @ trick', `https://evil.com\\@${T}/`, ErrorCode.URL_HAS_USERINFO],
    ['backslash path trick', `https://evil.com\\${T}/`, ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['alamat IP', 'https://103.10.10.10/', ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['spasi di depan', ` https://${T}/`, ErrorCode.URL_INVALID],
    ['tab di dalam host', `https://telunjuk\tsakti.wonogirikab.go.id/`, ErrorCode.URL_INVALID],
    ['bukan URL', 'telunjuksakti.wonogirikab.go.id', ErrorCode.URL_INVALID],
    ['javascript:', 'javascript:alert(1)', ErrorCode.URL_NOT_HTTPS],
    ['lapor tanpa www', 'https://lapor.go.id/', ErrorCode.DOMAIN_NOT_OFFICIAL],
    ['www tambahan pada host tanpa www', 'https://www.oss.go.id/', ErrorCode.DOMAIN_NOT_OFFICIAL],
  ];

  it.each(traps)('menolak %s', (_label, url, code) => {
    const r = matchOfficialUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
});

describe('matchOfficialOrigin', () => {
  it('menerima origin persis', () => {
    expect(matchOfficialOrigin(`https://${T}`).ok).toBe(true);
  });
  it('menolak origin dengan slash akhir atau path', () => {
    expect(matchOfficialOrigin(`https://${T}/`).ok).toBe(false);
    expect(matchOfficialOrigin(`https://${T}/login`).ok).toBe(false);
  });
  it('menolak origin http', () => {
    expect(matchOfficialOrigin(`http://${T}`).ok).toBe(false);
  });
});

describe('egress pihak ketiga', () => {
  it('host persis huruf kecil tanpa wildcard/port/skema, tidak tumpang tindih dengan domain resmi', () => {
    const resmi = new Set(OFFICIAL_DOMAINS.map((d) => d.host));
    for (const { host } of EGRESS_PIHAK_KETIGA) {
      expect(host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(resmi.has(host)).toBe(false);
    }
    const all = egressAllowedHosts();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain('telunjuksakti.wonogirikab.go.id');
    expect(all).toContain('challenges.cloudflare.com');
  });
});
