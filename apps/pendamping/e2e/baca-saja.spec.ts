import { expect, test } from '@playwright/test';
import type { PendampingEvent, PendampingServerMessage, PendampingSorot } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { SessionManager, sidHashOf } from '../src/sessions.js';
import { FIXTURE_ORIGIN } from '../playwright.config.js';

/**
 * Alur baca-saja situs nyata, diuji terhadap REPLIKA di apps/fixtures (tidak pernah menyentuh situs asli):
 * origin resmi dipetakan ke fixture berawalan jalur (/smg, /sby). Nilai warga lewat vault, captcha
 * matematika dijawab warga, tombol cek ditekan warga, hasil = sesi siaga + bukti.
 */

const SID = sidHashOf('baca'.padEnd(32, '0'));

function manager() {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
    PENDAMPING_ORIGIN_OVERRIDES: [
      `https://sidnok.semarangkota.go.id=${FIXTURE_ORIGIN}/smg`,
      `https://wargaklampid-dispendukcapil.surabaya.go.id=${FIXTURE_ORIGIN}/sby`,
    ].join(','),
    PENDAMPING_HEADLESS: '1',
  });
  return new SessionManager(config, createBrowserFactory(config));
}

function penampil() {
  const events: PendampingEvent[] = [];
  return {
    events,
    send: (m: PendampingServerMessage) => void (m.type === 'event' && events.push(m.event)),
    frame: () => {},
    ack: () => {},
    close: () => {},
  };
}

async function sorotGiliran(events: PendampingEvent[]): Promise<PendampingSorot> {
  const cari = () =>
    events.find(
      (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
        e.jenis === 'giliran_anda' && e.alasan === 'login' && e.sorot !== undefined,
    )?.sorot;
  await expect.poll(cari, { timeout: 30_000 }).toBeTruthy();
  return cari()!;
}

const kasus: {
  nama: string;
  adapterId: string;
  origin: string;
  vault: Record<string, string>;
  bukti: Record<string, string>;
}[] = [
  {
    nama: "Si D'nOK Semarang cek_status",
    adapterId: 'sidnok-semarang',
    origin: 'https://sidnok.semarangkota.go.id',
    vault: { '{{URUSAN.KODE_PELAYANAN}}': 'FIXTUREKODE00001' },
    bukti: { status: 'Siap Diambil' },
  },
  {
    nama: 'Klampid Surabaya cek_status',
    adapterId: 'klampid-surabaya',
    origin: 'https://wargaklampid-dispendukcapil.surabaya.go.id',
    vault: { '{{URUSAN.KITIR}}': 'KITIR-FIXTURE-0001' },
    bukti: { nomor: 'KITIR-FIXTURE-0001' },
  },
];

for (const k of kasus) {
  test(`baca-saja ${k.nama}: vault -> AI mengisi -> warga menjawab captcha dan menekan cek -> siaga + bukti`, async () => {
    const m = manager();
    const owner = { urusanId: `u-${k.adapterId}`, sidHash: SID };
    try {
      const s = await m.create({
        ...owner,
        executionId: `x_${k.adapterId}`,
        adapterId: k.adapterId,
        flowId: 'cek_status',
        origin: k.origin,
        params: {},
        viewport: { lebar: 390, tinggi: 844, dpr: 1, seluler: true },
      });
      const v = penampil();
      await m.attach(s.sesiId, v);
      await expect.poll(() => m.status(owner).status, { timeout: 30_000 }).toBe('menunggu_data');
      await m.isiData(owner, k.vault); // jalur isi server, bukan WS perangkat

      // Gerbang captcha: tombol cek disorot, khusus warga. Warga: Tab ke kolom jawaban, ketik, ketuk tombol.
      const sorot = await sorotGiliran(v.events);
      for (const aksi of ['down', 'up'] as const)
        await m.handleClient(s.sesiId, { type: 'key', aksi, key: 'Tab', code: 'Tab' });
      await m.handleClient(s.sesiId, { type: 'text', teks: '7' });
      const x = sorot.x + sorot.lebar / 2;
      const y = sorot.y + sorot.tinggi / 2;
      for (const aksi of ['down', 'up'] as const)
        await m.handleClient(s.sesiId, {
          type: 'pointer',
          aksi,
          x,
          y,
          jenis: 'touch',
          tombol: 'left',
          klik: 1,
        });

      await expect.poll(() => m.status(owner).status, { timeout: 30_000 }).toBe('siaga');
      expect(m.status(owner)).toMatchObject({ hasil: 'berhasil', mode: 'takeover', bukti: k.bukti });
    } finally {
      await m.shutdown();
    }
  });
}
