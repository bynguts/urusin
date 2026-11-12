import https from 'node:https';
import type net from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { ADAPTER_GENERIK, SessionManager, sidHashOf } from '../src/sessions.js';
import { ANTARA_ADA, ANTARA_HILANG, kunciAcak, terbitkan, type Pihak } from './tls/pki.js';

/**
 * Rantai sertifikat (QA prod, siapel.malangkota.go.id): server TLS uji hanya mengirim sertifikat LEAF, tanpa
 * intermediate, persis portal Malang. Chromium sungguhan (sandbox aktif, proxy egress allowlist yang menolak
 * unduhan AIA) memakai basis data NSS uji di HOME-nya (`tls/nssdb`, lewat jalur produksi PENDAMPING_NSS_DB):
 * root uji dipercaya, intermediate "ada" tanpa trust (seperti bundel produksi), intermediate "hilang" tidak ada.
 *  - leaf dari intermediate yang ADA di bundel: halaman terbuka;
 *  - leaf dari intermediate yang TIDAK ada: ERR_CERT_AUTHORITY_INVALID -> dipandu jujur, bukan giliran warga;
 *  - leaf self-signed (sertifikat tidak sah sungguhan): tetap ditolak -> dipandu.
 * Validasi tidak pernah dilonggarkan: tanpa ignoreHTTPSErrors, tanpa --ignore-certificate-errors.
 */

// Basis data NSS Chromium (dan HOME-nya) hanya berlaku di Linux; CI e2e berjalan di Linux.
test.skip(process.platform !== 'linux', 'basis data NSS Chromium hanya dipakai di Linux');

const SID = sidHashOf('t'.repeat(32));
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';
const NSSDB = join(import.meta.dirname, 'tls', 'nssdb');

const HALAMAN = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Portal uji TLS</title></head><body>
<h1>Layanan kependudukan</h1><form><label for="nama">Nama lengkap</label><input id="nama" name="nama"></form>
</body></html>`;

async function serverTls(penerbit: Pihak | undefined) {
  const leaf: Pihak = { cn: '127.0.0.1', ...kunciAcak() };
  const sert = terbitkan({
    subjek: leaf,
    penerbit,
    jenis: 'leaf',
    mulai: new Date(Date.now() - 3_600_000),
    akhir: new Date(Date.now() + 7 * 86_400_000),
  });
  // HANYA leaf yang dikirim (tanpa rantai), seperti siapel.malangkota.go.id.
  const server = https.createServer(
    { key: leaf.kunci.export({ type: 'pkcs8', format: 'pem' }), cert: sert.toString() },
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(HALAMAN);
    },
  );
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `https://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    tutup: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

async function sesiGenerik(origin: string, urusanId: string) {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: origin,
    PENDAMPING_ORIGIN_OVERRIDES: `${RESMI}=${origin}`,
    PENDAMPING_HEADLESS: '1',
    PENDAMPING_NSS_DB: NSSDB,
  });
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId, sidHash: SID };
  await manager.create({
    ...o,
    executionId: `x_${urusanId}`,
    adapterId: ADAPTER_GENERIK,
    flowId: 'navigator',
    origin: RESMI,
    params: { jalur: '/' },
    modeUji: true,
  });
  return { manager, o };
}

test('leaf tanpa intermediate, intermediate ada di bundel NSS: halaman terbuka', async () => {
  const situs = await serverTls(ANTARA_ADA);
  const { manager, o } = await sesiGenerik(situs.origin, 'u-tls-ada');
  try {
    await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('berjalan');
    const a = await manager.amati(o);
    expect(a.pengamatan.judul).toBe('Portal uji TLS');
    expect(a.pengamatan.elemen.some((e) => e.nama === 'Nama lengkap')).toBe(true);
  } finally {
    await manager.shutdown();
    await situs.tutup();
  }
});

for (const [kasus, penerbit] of [
  ['intermediate TIDAK ada di bundel', ANTARA_HILANG],
  ['sertifikat self-signed (tidak sah sungguhan)', undefined],
] as const) {
  test(`${kasus}: ditolak Chromium, sesi dipandu jujur tanpa giliran "lanjutkan sendiri"`, async () => {
    const situs = await serverTls(penerbit);
    const { manager, o } = await sesiGenerik(situs.origin, `u-tls-${penerbit ? 'hilang' : 'palsu'}`);
    try {
      await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('dipandu');
      const s = manager.status(o);
      expect(s.hasil).toBe('drift');
      expect(s.pesan).toContain(`Situs ${new URL(situs.origin).host} sedang bermasalah`);
      expect(s.pesan).toContain('Demi keamanan, AI tidak membukanya');
      expect(s.pesan).toContain('net::ERR_CERT_AUTHORITY_INVALID');
      expect(s.pesan).not.toMatch(/lanjutkan sendiri|di luar daftar/i);
    } finally {
      await manager.shutdown();
      await situs.tutup();
    }
  });
}
