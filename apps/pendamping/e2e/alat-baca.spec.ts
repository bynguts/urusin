import { expect, test } from '@playwright/test';
import type { PendampingEvent, PendampingServerMessage, PendampingSorot } from '@urusin/contracts';
import { dukcapilCekStatus, ossCariNib, samsatCekPkb, type ToolContext } from '@urusin/harness';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { SessionManager, sidHashOf } from '../src/sessions.js';
import { FIXTURE_ORIGIN } from '../playwright.config.js';

/**
 * Rantai tool baca-saja harness -> Browser Pendamping, terhadap REPLIKA di apps/fixtures (tidak pernah menyentuh
 * situs asli): `execution_request` yang dihasilkan tool (adapter, alur, origin resmi, params kosong) dipakai apa
 * adanya untuk membuat sesi; origin resmi dipetakan ke fixture berawalan jalur. Nilai (kode, nomor polisi, NIB)
 * masuk lewat vault sesi, bukan lewat model.
 */

const SID = sidHashOf('alat'.padEnd(32, '0'));
const ctx = {} as ToolContext;

function manager() {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
    PENDAMPING_ORIGIN_OVERRIDES: [
      `https://sidnok.semarangkota.go.id=${FIXTURE_ORIGIN}/smg`,
      `https://samsat-pkb2.jakarta.go.id=${FIXTURE_ORIGIN}/samsat`,
      `https://oss.go.id=${FIXTURE_ORIGIN}/oss`,
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

async function eksekusi(r: ReturnType<typeof samsatCekPkb.execute>) {
  const exec = (await r).execution;
  expect(exec).toBeDefined();
  expect(exec!.bacaSaja).toBe(true);
  expect(exec!.params).toEqual({});
  return exec!;
}

async function jalankan(
  m: SessionManager,
  exec: Awaited<ReturnType<typeof eksekusi>>,
  vault: Record<string, string>,
  giliran?: (sesiId: string, events: PendampingEvent[]) => Promise<void>,
) {
  const owner = { urusanId: `u-${exec.adapterId}`, sidHash: SID };
  const s = await m.create({
    ...owner,
    executionId: exec.executionId,
    adapterId: exec.adapterId,
    flowId: exec.flowId,
    origin: exec.origin!,
    params: exec.params,
    viewport: { lebar: 390, tinggi: 844, dpr: 1, seluler: true },
  });
  const v = penampil();
  await m.attach(s.sesiId, v);
  await expect.poll(() => m.status(owner).status, { timeout: 30_000 }).toBe('menunggu_data');
  // Nilai lewat jalur isi server (kanal internal), tidak pernah lewat WS perangkat.
  await m.isiData(owner, vault);
  if (giliran) await giliran(s.sesiId, v.events);
  await expect.poll(() => m.status(owner).status, { timeout: 30_000 }).toBe('siaga');
  return m.status(owner);
}

const terakhir = async (jalur: string) =>
  ((await (await fetch(`${FIXTURE_ORIGIN}${jalur}/uji/terakhir`)).json()) as { terakhir: unknown }).terakhir;

test('samsat__cek_pkb: AI mengisi nomor polisi dari vault dan menekan Cek; hasil di layar warga', async () => {
  const m = manager();
  try {
    const exec = await eksekusi(samsatCekPkb.execute(ctx, {}));
    expect(exec).toMatchObject({ adapterId: 'samsat-dki', flowId: 'cek_pkb' });
    const st = await jalankan(m, exec, {
      '{{KENDARAAN.NOPOL_ANGKA}}': '1234',
      '{{KENDARAAN.NOPOL_HURUF}}': 'UJI',
    });
    expect(st).toMatchObject({ hasil: 'berhasil' });
    expect(await terakhir('/samsat')).toEqual({ nb: '1234', nc: 'UJI' });
  } finally {
    await m.shutdown();
  }
});

test('oss__cari_nib: AI mengisi NIB dari vault dan menekan Cari NIB; hasil di layar warga', async () => {
  const m = manager();
  try {
    const exec = await eksekusi(ossCariNib.execute(ctx, {}));
    expect(exec).toMatchObject({ adapterId: 'oss-nib', flowId: 'cari_nib' });
    const st = await jalankan(m, exec, { '{{USAHA.NIB}}': '9999000000001' });
    expect(st).toMatchObject({ hasil: 'berhasil' });
    await expect.poll(() => terakhir('/oss'), { timeout: 10_000 }).toEqual({ nib: '9999000000001' });
  } finally {
    await m.shutdown();
  }
});

test("dukcapil__cek_status (Si D'nOK): AI mengisi kode, warga menjawab captcha dan menekan Cek -> bukti", async () => {
  const m = manager();
  try {
    const exec = await eksekusi(dukcapilCekStatus.execute(ctx, { kodeKabKota: '3374' }));
    expect(exec).toMatchObject({ adapterId: 'sidnok-semarang', flowId: 'cek_status' });
    const st = await jalankan(
      m,
      exec,
      { '{{URUSAN.KODE_PELAYANAN}}': 'FIXTUREKODE00001' },
      async (id, ev) => {
        const cari = () =>
          ev.find(
            (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
              e.jenis === 'giliran_anda' && e.sorot !== undefined,
          )?.sorot;
        await expect.poll(cari, { timeout: 30_000 }).toBeTruthy();
        const sorot: PendampingSorot = cari()!;
        for (const aksi of ['down', 'up'] as const)
          await m.handleClient(id, { type: 'key', aksi, key: 'Tab', code: 'Tab' });
        await m.handleClient(id, { type: 'text', teks: '7' });
        for (const aksi of ['down', 'up'] as const)
          await m.handleClient(id, {
            type: 'pointer',
            aksi,
            x: sorot.x + sorot.lebar / 2,
            y: sorot.y + sorot.tinggi / 2,
            jenis: 'touch',
            tombol: 'left',
            klik: 1,
          });
      },
    );
    expect(st).toMatchObject({ hasil: 'berhasil', bukti: { status: 'Siap Diambil' } });
  } finally {
    await m.shutdown();
  }
});
