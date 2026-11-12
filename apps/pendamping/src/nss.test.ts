import { X509Certificate } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BERKAS_NSS, envNss } from './nss.js';

const CERTS = join(import.meta.dirname, '..', 'certs');
type Entri = {
  berkas: string;
  subjek: string;
  penerbit: string;
  sha256: string;
  sumber: string;
  berlakuSampai: string;
};
const manifest = JSON.parse(readFileSync(join(CERTS, 'intermediate.json'), 'utf8')) as Entri[];

describe('bundel intermediate CA (certs/intermediate.json)', () => {
  it('setiap berkas PEM tercatat di manifest dan sebaliknya', () => {
    const berkas = readdirSync(join(CERTS, 'intermediate')).sort();
    expect(berkas).toEqual(manifest.map((m) => m.berkas).sort());
  });

  it.each(manifest)(
    '$berkas: sidik SHA-256 cocok, CA intermediate (bukan trust anchor), belum kedaluwarsa',
    (m) => {
      const c = new X509Certificate(readFileSync(join(CERTS, 'intermediate', m.berkas)));
      expect(c.fingerprint256).toBe(m.sha256);
      expect(c.ca).toBe(true);
      // Tidak ada root (self-signed): intermediate hanya untuk membangun rantai, tidak pernah dipercaya sendiri.
      expect(c.issuer).not.toBe(c.subject);
      expect(c.checkIssued(c)).toBe(false);
      expect(/CN=([^\n]+)/.exec(c.subject)?.[1]).toBe(m.subjek);
      expect(/CN=([^\n]+)/.exec(c.issuer)?.[1]).toBe(m.penerbit);
      expect(new Date(c.validTo).toISOString().slice(0, 10)).toBe(m.berlakuSampai);
      expect(Date.parse(c.validTo)).toBeGreaterThan(Date.now());
      // Sumber = URL caIssuers (AIA) resmi CA, http tanpa kueri.
      expect(m.sumber).toMatch(
        /^http:\/\/(cacerts\.(digicert|thawte|geotrust|rapidssl)\.com|(zerossl\.)?crt\.sectigo\.com|secure\.globalsign\.com|[a-z0-9]+\.i\.lencr\.org|i\.pki\.goog)\/[A-Za-z0-9._/-]*$/,
      );
    },
  );

  it('memuat intermediate yang hilang di siapel.malangkota.go.id', () => {
    expect(manifest).toContainEqual(
      expect.objectContaining({
        subjek: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1',
        sha256:
          'C8:02:5F:9F:C6:5F:DF:C9:5B:3C:A8:CC:78:67:B9:A5:87:B5:27:79:73:95:79:17:46:3F:C8:13:D0:B6:25:A9',
      }),
    );
  });
});

describe('envNss', () => {
  it('tanpa konfigurasi: env Chromium tidak diubah', () => {
    expect(envNss(undefined)).toEqual({});
  });

  it('salinan yang BISA DITULIS di HOME/.pki/nssdb, sekali per sumber', () => {
    const sumber = mkdtempSync(join(tmpdir(), 'nss-sumber-'));
    for (const b of BERKAS_NSS) {
      writeFileSync(join(sumber, b), b);
      chmodSync(join(sumber, b), 0o444);
    }
    const dasar = mkdtempSync(join(tmpdir(), 'nss-dasar-'));
    const env = envNss(sumber, dasar);
    expect(env.HOME?.startsWith(dasar)).toBe(true);
    for (const b of BERKAS_NSS) {
      const f = join(env.HOME!, '.pki', 'nssdb', b);
      expect(readFileSync(f, 'utf8')).toBe(b);
      if (process.platform !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600);
    }
    expect(envNss(sumber, dasar)).toEqual(env);
  });

  it('sumber tidak lengkap: galat (gagal tertutup)', () => {
    const sumber = mkdtempSync(join(tmpdir(), 'nss-rusak-'));
    writeFileSync(join(sumber, 'cert9.db'), 'x');
    expect(() => envNss(sumber, tmpdir())).toThrow(/tidak lengkap/);
  });
});
