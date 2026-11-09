import http from 'node:http';
import type net from 'node:net';
import { expect, test } from '@playwright/test';
import { launchIsolated } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { createDaftarSesi, createEdgeKontrol, createEdgeProxy } from '../src/edge.js';

/**
 * Jalur produksi Chromium -> pendamping-edge: pendaftaran sesi di kanal kontrol (HMAC), proxy CONNECT dengan
 * kredensial per sesi (407 lalu ulang), keputusan host. Edge mendengar di 127.0.0.2, BUKAN 127.0.0.1, seperti
 * IP kontainer edge di produksi: `--host-resolver-rules` harus mengecualikan alamat proxy yang sebenarnya
 * (regresi run 6: semua sesi gagal di langkah 0 dengan net::ERR_PROXY_CONNECTION_FAILED). DNS edge diarahkan
 * ke loopback agar tes tidak pernah keluar ke jaringan: keputusan akhirnya "terlarang", tapi itu hanya terjadi
 * bila Chromium sampai ke edge DAN autentikasi sesi lolos.
 */
const TOKEN = 'e'.repeat(40);
const HOST = 'fixtures.urusin.test';

const dengar = (s: http.Server) =>
  new Promise<number>((ok) => s.listen(0, '127.0.0.2', () => ok((s.address() as net.AddressInfo).port)));

test('edge: Chromium menjawab 407 dengan kredensial sesi; CONNECT sampai ke keputusan host', async () => {
  const union = new Set([HOST]);
  const log: string[] = [];
  const daftar = createDaftarSesi(4);
  const proxy = createEdgeProxy(
    { union, upstreamProxy: undefined, maksTerowongan: 16 },
    daftar,
    async () => ['127.0.0.1'],
    (b) => log.push(b),
  );
  const kontrol = createEdgeKontrol({ token: TOKEN, union, maksSesi: 4 }, daftar);
  const portProxy = await dengar(proxy.server);
  const portKontrol = await dengar(kontrol);
  const config = {
    ...loadConfig({ PENDAMPING_FIXTURE_ORIGINS: `https://${HOST}`, PENDAMPING_HEADLESS: '1' }),
    edge: { kontrol: new URL(`http://127.0.0.2:${portKontrol}`), proxyPort: portProxy, token: TOKEN },
  };
  const iso = await launchIsolated(config, { lebar: 390, tinggi: 844, dpr: 1, seluler: true }, [HOST]);
  try {
    expect(daftar.ukuran).toBe(1);
    const page = iso.context.pages()[0] ?? (await iso.context.newPage());
    const galat = await page.goto(`https://${HOST}/`, { timeout: 15_000 }).then(
      () => '',
      (e: Error) => e.message,
    );
    expect(galat).toMatch(/net::ERR_TUNNEL_CONNECTION_FAILED/);
    expect(
      log.some((b) => /^edge: CONNECT ditolak host=fixtures\.urusin\.test alasan=.*127\.0\.0\.1/.test(b)),
    ).toBe(true);
    // Urutan nyata: CONNECT pertama tanpa kredensial (407), ulang dengan kredensial sesi, lalu keputusan host.
    expect(log[0]).toBe(`edge: CONNECT 407 host=${HOST} kredensial=tidak_ada`);
    expect(log.some((b) => b.includes('kredensial=tidak_sah'))).toBe(false);
  } finally {
    await iso.close();
    proxy.tutup();
    proxy.server.close();
    kontrol.close();
  }
});
