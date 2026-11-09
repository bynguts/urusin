import { expect, test } from '@playwright/test';
import type { PendampingEvent, PendampingServerMessage, PendampingSorot } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { SessionManager, sidHashOf } from '../src/sessions.js';
import { FIXTURE_ORIGIN } from '../playwright.config.js';

/**
 * Alur baca-saja situs nyata, diuji terhadap REPLIKA di apps/fixtures (tidak pernah menyentuh situs asli):
 * origin resmi dipetakan ke fixture berawalan jalur (/smg, /sby). Kode/kitir bukan Data Diri: AI langsung
 * jalan dan menyerahkan giliran `isi_sendiri` di kolomnya (warga mengetik, lalu Lanjutkan); captcha matematika
 * dijawab warga, tombol cek ditekan warga, hasil = sesi siaga + bukti.
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

async function sorotGiliran(
  events: PendampingEvent[],
  alasan: 'login' | 'isi_sendiri',
): Promise<PendampingSorot> {
  const cari = () =>
    events.find(
      (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
        e.jenis === 'giliran_anda' && e.alasan === alasan && e.sorot !== undefined,
    )?.sorot;
  await expect.poll(cari, { timeout: 30_000 }).toBeTruthy();
  return cari()!;
}

const kasus: {
  nama: string;
  adapterId: string;
  origin: string;
  ketik: string;
  bukti: Record<string, string>;
}[] = [
  {
    nama: "Si D'nOK Semarang cek_status",
    adapterId: 'sidnok-semarang',
    origin: 'https://sidnok.semarangkota.go.id',
    ketik: 'FIXTUREKODE00001',
    bukti: { status: 'Siap Diambil' },
  },
  {
    nama: 'Klampid Surabaya cek_status',
    adapterId: 'klampid-surabaya',
    origin: 'https://wargaklampid-dispendukcapil.surabaya.go.id',
    ketik: 'KITIR-FIXTURE-0001',
    bukti: { nomor: 'KITIR-FIXTURE-0001' },
  },
];

for (const k of kasus) {
  test(`baca-saja ${k.nama}: warga mengetik di kolom -> Lanjutkan -> captcha + cek oleh warga -> siaga + bukti`, async () => {
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
      // Tidak menunggu data: AI jalan, lalu menyerahkan kolom kode/kitir ke warga (tidak lewat vault/AI).
      await expect.poll(() => m.status(owner).status, { timeout: 30_000 }).toBe('berjalan');
      const kolom = await sorotGiliran(v.events, 'isi_sendiri');
      for (const aksi of ['down', 'up'] as const)
        await m.handleClient(s.sesiId, {
          type: 'pointer',
          aksi,
          x: kolom.x + kolom.lebar / 2,
          y: kolom.y + kolom.tinggi / 2,
          jenis: 'touch',
          tombol: 'left',
          klik: 1,
        });
      await m.handleClient(s.sesiId, { type: 'text', teks: k.ketik });
      await m.handleClient(s.sesiId, { type: 'kembalikan' });

      // Gerbang captcha: tombol cek disorot, khusus warga. Warga: Tab ke kolom jawaban, ketik, ketuk tombol.
      const sorot = await sorotGiliran(v.events, 'login');
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
