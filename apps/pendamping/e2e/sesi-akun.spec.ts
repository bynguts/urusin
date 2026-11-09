import { expect, test } from '@playwright/test';
import { buildProgram, type Program } from '@urusin/adapters';
import type { PendampingBukti, PendampingClientMessage, PendampingEvent } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import type { ActiveRun, Hooks } from '../src/sessions.js';
import { FIXTURE_ORIGIN } from '../playwright.config.js';

/**
 * Status sesi akun terhadap replika Telunjuk Sakti (apps/fixtures, data fiktif):
 * 1) probe masuk adapter: halaman butuh login -> takeover `masuk_akun`; warga masuk sendiri; peramban kembali
 *    ke halaman yang dituju alur dan AI melanjutkan;
 * 2) siaga: execution berikutnya di peramban yang sama tidak perlu login lagi;
 * 3) bukti: nomor registrasi + status dibaca dari elemen yang dideklarasikan adapter.
 */

const TEST_HP = '08000000001'; // kredensial uji fiktif yang tercetak di halaman fixture
const TEST_CAPTCHA = 'DEV123';

type Rekam = {
  events: PendampingEvent[];
  modes: string[];
  selesai: { pesan: string; bukti?: PendampingBukti | undefined }[];
  ended?: string;
};

function programCekStatus(): Program {
  const r = buildProgram('telunjuk-sakti-wonogiri', 'cek_status', {});
  if (!r.ok) throw new Error(r.message);
  return { ...r.program, origin: FIXTURE_ORIGIN };
}

async function mulai(): Promise<{ run: ActiveRun; rekam: Rekam }> {
  const config = loadConfig({ PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN, PENDAMPING_HEADLESS: '1' });
  const rekam: Rekam = { events: [], modes: [], selesai: [] };
  const hooks: Hooks = {
    mode: (m, pesan) => rekam.modes.push(`${m}:${pesan ?? ''}`),
    fokus: () => {},
    event: (e) => rekam.events.push(e),
    activity: () => {},
    ended: (status, _hasil, pesan) => void (rekam.ended ??= `${status}:${pesan}`),
    langkahSelesai: (pesan, bukti) => void rekam.selesai.push({ pesan, bukti }),
    berkasKurang: () => {},
  };
  const run = await createBrowserFactory(config)({
    sesiId: 'akun-e2e',
    program: programCekStatus(),
    executionId: 'x_akun_1',
    viewport: { lebar: 390, tinggi: 844, dpr: 1, seluler: true },
    hooks,
    data: { value: () => undefined, file: () => undefined },
  });
  await run.mulaiAi();
  return { run, rekam };
}

const tekan = async (run: ActiveRun, key: string, code = key) => {
  for (const aksi of ['down', 'up'] as const) await run.input({ type: 'key', aksi, key, code });
};
const ketik = (run: ActiveRun, teks: string) =>
  run.input({ type: 'text', teks } satisfies PendampingClientMessage & { type: 'text' });

test('masuk_akun -> warga masuk sendiri -> AI lanjut; bukti terbaca; execution kedua tanpa login (siaga)', async () => {
  const { run, rekam } = await mulai();
  try {
    // 1) Daftar permohonan butuh login: fixture mengalihkan ke halaman login -> giliran warga masuk akun.
    await expect
      .poll(() => rekam.events.find((e) => e.jenis === 'giliran_anda' && e.alasan === 'masuk_akun'), {
        timeout: 30_000,
      })
      .toBeTruthy();
    expect(rekam.modes.at(-1)).toMatch(/^takeover:Masuk ke akun Anda/);
    expect(rekam.selesai).toEqual([]);

    // Warga: Tab ke kolom HP, ketik; Tab ke CAPTCHA, ketik; Enter. AI tidak mengetik apa pun di sini.
    await tekan(run, 'Tab');
    await ketik(run, TEST_HP);
    await tekan(run, 'Tab');
    await ketik(run, TEST_CAPTCHA);
    await tekan(run, 'Enter');

    // Setelah masuk: kembali ke daftar permohonan, AI menyelesaikan alur, bukti dibaca dari tabel.
    await expect.poll(() => rekam.selesai.length, { timeout: 30_000 }).toBe(1);
    expect(rekam.modes).toContain('ai:Anda sudah masuk. AI melanjutkan.');
    expect(rekam.selesai[0]).toMatchObject({
      pesan: expect.stringContaining('Hasil ada di layar'),
      bukti: { nomor: 'FX-REG-0001', status: 'Diproses (data uji)' },
    });

    // 2) Execution berikutnya di peramban yang sama: sudah masuk, tidak ada masuk_akun kedua.
    const sebelum = rekam.events.filter(
      (e) => e.jenis === 'giliran_anda' && e.alasan === 'masuk_akun',
    ).length;
    await run.gantiProgram(programCekStatus(), 'x_akun_2');
    await run.mulaiAi();
    await expect.poll(() => rekam.selesai.length, { timeout: 30_000 }).toBe(2);
    expect(rekam.events.filter((e) => e.jenis === 'giliran_anda' && e.alasan === 'masuk_akun')).toHaveLength(
      sebelum,
    );
    expect(rekam.selesai[1]?.bukti?.nomor).toBe('FX-REG-0001');
    expect(rekam.ended).toBeUndefined();
  } finally {
    await run.destroy();
  }
});
