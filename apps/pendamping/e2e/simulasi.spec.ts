import { expect, test } from '@playwright/test';
import { alurSimulasiUntuk, FLOW_SIMULASI } from '@urusin/adapters';
import type { PendampingEvent, PendampingServerMessage, PendampingSorot } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { SessionManager, sidHashOf } from '../src/sessions.js';
import { FIXTURE_ORIGIN } from '../playwright.config.js';

/**
 * Simulasi demo juri ("Lihat contoh pengisian (simulasi)") terhadap REPLIKA di apps/fixtures (tidak pernah ke situs
 * asli): Mode Uji membuka formulir simulasi replika yang sudah "masuk" (tanpa dinding login replika), warga
 * mengizinkan isi, AI mengisi Data Diri contoh, lalu WARGA sendiri yang menekan Kirim (simulasi). Replika
 * menghitung kolom yang terisi pada kiriman itu (tanpa nilai).
 */

const SID = sidHashOf('simulasi'.padEnd(32, '0'));

const ISIAN: Record<string, string> = {
  '{{PEMOHON.NAMA}}': 'Juri Contoh Urusin',
  '{{PEMOHON.NIK}}': ['3312', '01', '410190', '0001'].join(''),
  '{{PEMOHON.TEMPAT_LAHIR}}': 'Wonogiri',
  '{{PEMOHON.TANGGAL_LAHIR}}': '1990-01-01',
  '{{PEMOHON.ALAMAT}}': 'Jalan Contoh Nomor 1',
  '{{PEMOHON.HP}}': ['0800', '0000', '001'].join(''),
};

const kasus = [
  { nama: 'Wonogiri (Telunjuk Sakti)', origin: 'https://telunjuksakti.wonogirikab.go.id', awalan: '' },
  {
    nama: 'Surabaya (Klampid)',
    origin: 'https://wargaklampid-dispendukcapil.surabaya.go.id',
    awalan: '/sby',
  },
  { nama: "Semarang (Si D'nOK)", origin: 'https://sidnok.semarangkota.go.id', awalan: '/smg' },
] as const;

function manager() {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
    PENDAMPING_ORIGIN_OVERRIDES: kasus.map((k) => `${k.origin}=${FIXTURE_ORIGIN}${k.awalan}`).join(','),
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

for (const k of kasus) {
  test(`simulasi ${k.nama}: tanpa login replika, AI mengisi kolom, warga menekan Kirim (simulasi)`, async () => {
    const alur = alurSimulasiUntuk(k.origin);
    expect(alur).toEqual({ adapterId: expect.any(String), flowId: FLOW_SIMULASI });
    const m = manager();
    const owner = { urusanId: `u-sim-${k.awalan || 'wng'}`, sidHash: SID };
    try {
      // Di luar Mode Uji alur simulasi ditolak (portal resmi tidak punya jalurnya).
      await expect(
        m.create({
          ...owner,
          executionId: 'x_sim_asli',
          adapterId: alur!.adapterId,
          flowId: alur!.flowId,
          origin: k.origin,
          params: {},
        }),
      ).rejects.toMatchObject({ status: 422 });

      const s = await m.create({
        ...owner,
        executionId: 'x_sim',
        adapterId: alur!.adapterId,
        flowId: alur!.flowId,
        origin: k.origin,
        params: {},
        modeUji: true,
        viewport: { lebar: 1280, tinggi: 800, dpr: 1, seluler: false },
      });
      expect(s.simulasi).toBe(true);
      const v = penampil();
      await m.attach(s.sesiId, v);
      // Lembar izin: data yang diminta = enam kolom formulir simulasi.
      await expect.poll(() => m.status(owner).status, { timeout: 30_000 }).toBe('menunggu_data');
      await m.isiData(owner, ISIAN);

      // AI mengisi lalu menyerahkan tombol Kirim (simulasi) ke warga, tanpa giliran masuk akun.
      const final = () =>
        v.events.find(
          (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
            e.jenis === 'giliran_anda' && e.alasan === 'final' && e.sorot !== undefined,
        )?.sorot;
      await expect.poll(final, { timeout: 30_000 }).toBeTruthy();
      expect(v.events.some((e) => e.jenis === 'giliran_anda' && e.alasan === 'masuk_akun')).toBe(false);
      const sorot: PendampingSorot = final()!;
      for (const aksi of ['down', 'up'] as const)
        await m.handleClient(s.sesiId, {
          type: 'pointer',
          aksi,
          x: sorot.x + sorot.lebar / 2,
          y: sorot.y + sorot.tinggi / 2,
          jenis: 'mouse',
          tombol: 'left',
          klik: 1,
        });

      const terisi = async () =>
        ((await (await fetch(`${FIXTURE_ORIGIN}${k.awalan}/simulasi/_terisi`)).json()) as { terisi: number })
          .terisi;
      await expect.poll(terisi, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
      expect(await terisi()).toBe(Object.keys(ISIAN).length);
    } finally {
      await m.shutdown();
    }
  });
}
