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

const T = 'telunjuksakti.wonogirikab.go.id';

describe('registry domain resmi', () => {
  it('memuat 14 domain seed tanpa duplikat, semuanya .go.id', () => {
    const hosts = OFFICIAL_DOMAINS.map((d) => d.host);
    expect(hosts).toHaveLength(14);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const h of hosts) expect(h.endsWith('.go.id') || h === 'oss.go.id').toBe(true);
  });

  it('aksesWilayah dari probe agent-vm: blokir keras = id-only, tantangan interaktif = id-utama', () => {
    const akses = (a: string) => OFFICIAL_DOMAINS.filter((d) => d.aksesWilayah === a).map((d) => d.host);
    expect(akses('id-only')).toEqual(['sidnok.semarangkota.go.id']);
    expect(akses('id-utama')).toEqual(['telunjuksakti.wonogirikab.go.id']);
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
