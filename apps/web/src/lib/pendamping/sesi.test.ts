import type { SesiPendamping } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { SesiPendampingUi } from './sesi.svelte.js';

const sesi = (extra: Partial<SesiPendamping> = {}): SesiPendamping => ({
  sesiId: '00000000-0000-4000-8000-000000000001',
  urusanId: 'u',
  executionId: 'x_1',
  status: 'berjalan',
  mode: 'ai',
  antrean: null,
  dibuatPada: '2026-11-09T00:00:00.000Z',
  kedaluwarsaPada: '2026-11-09T00:15:00.000Z',
  ...extra,
});

describe('SesiPendampingUi: situs yang benar-benar dibuka', () => {
  it('Mode Uji: header memakai origin replika + tanda replika dari status server', () => {
    const ui = new SesiPendampingUi('u', async () => null);
    expect(ui.data.situs).toBeNull();
    ui.terapkanSesi(sesi({ situs: 'https://fixtures.urusinai.web.id', replika: true }));
    expect(ui.data.situs).toEqual({ origin: 'https://fixtures.urusinai.web.id', replika: true });
    // Status berikutnya tanpa field (worker lama) tidak menghapus yang sudah diketahui.
    ui.terapkanSesi(sesi());
    expect(ui.data.situs).toEqual({ origin: 'https://fixtures.urusinai.web.id', replika: true });
  });

  it('akun warga di portal asli: bukan replika', () => {
    const ui = new SesiPendampingUi('u', async () => null);
    ui.terapkanSesi(sesi({ situs: 'https://telunjuksakti.wonogirikab.go.id', replika: false }));
    expect(ui.data.situs).toEqual({ origin: 'https://telunjuksakti.wonogirikab.go.id', replika: false });
  });
});

/** Viewer palsu: menyimpan handler supaya tes bisa memutar urutan pesan worker yang sebenarnya. */
async function tersambung(ambil: (url: string, init?: RequestInit) => Response) {
  const h: Record<string, (v: unknown) => void> = {};
  const viewer = {
    mode: null,
    koneksi: 'tersambung',
    on: (t: string, cb: (v: unknown) => void) => ((h[t] = cb), () => {}),
    ambilAlih() {},
    kembalikan() {},
    akhiri() {},
    tutup() {},
  };
  const panggilan: string[] = [];
  const ui = new SesiPendampingUi('u', async () => (() => viewer) as never, (async (
    url: string,
    init?: RequestInit,
  ) => {
    panggilan.push(`${init?.method ?? 'GET'} ${url}`);
    return ambil(url, init);
  }) as never);
  await ui.mulai(
    'x_1',
    () => ({}) as HTMLCanvasElement,
    () => null,
  );
  const kirim = (t: string, v: unknown) => h[t]!(v);
  return { ui, kirim, panggilan };
}

const jawabBawaan = (url: string, init?: RequestInit) =>
  url.endsWith('/tiket')
    ? Response.json({ wsUrl: 'ws://x/s', tiket: 't' })
    : init?.method === 'DELETE'
      ? Response.json(sesi({ status: 'selesai', mode: 'done' }))
      : Response.json(sesi(), { status: 201 });

describe('SesiPendampingUi: setelah Kirim, teks jujur soal peramban', () => {
  it('siaga (peramban masih hidup) bukan selesai/ditutup dan bukan dijeda; penutupan sungguhan = selesai + done', async () => {
    const { ui, kirim } = await tersambung(jawabBawaan);
    const bukti = { nomor: 'FX-REG-0001' };
    // Urutan pesan worker saat siaga: event selesai, mode takeover, status siaga.
    kirim('event', { jenis: 'selesai', hasil: 'berhasil', pesan: 'Terkirim.', bukti });
    kirim('mode', { mode: 'takeover', pesan: 'Terkirim.' });
    expect([ui.data.keadaan, ui.data.mode]).toEqual(['siaga', 'takeover']);
    kirim('status', sesi({ status: 'siaga', mode: 'takeover', hasil: 'berhasil' }));
    expect(ui.data.keadaan).toBe('siaga');
    expect(ui.data.bukti).toEqual(bukti);
    // Ditutup sungguhan (idle/TTL): event selesai, mode done, status selesai.
    kirim('event', { jenis: 'selesai', hasil: 'berhasil', pesan: 'Sesi ditutup.' });
    kirim('mode', { mode: 'done', pesan: 'Sesi ditutup.' });
    kirim('status', sesi({ status: 'selesai', mode: 'done', hasil: 'berhasil' }));
    expect([ui.data.keadaan, ui.data.mode]).toEqual(['selesai', 'done']);
  });

  it('Tutup sekarang: DELETE sesi, lalu selesai + done; gagal = tetap siaga dengan pesan jujur', async () => {
    let gagal = true;
    const { ui, kirim, panggilan } = await tersambung((url, init) =>
      init?.method === 'DELETE' && gagal ? new Response('x', { status: 502 }) : jawabBawaan(url, init),
    );
    kirim('status', sesi({ status: 'siaga', mode: 'takeover', hasil: 'berhasil' }));
    await ui.tutupSekarang();
    expect(ui.data.keadaan).toBe('siaga');
    expect(ui.data.pesan).toMatch(/belum bisa ditutup/);
    gagal = false;
    await ui.tutupSekarang();
    expect(panggilan.filter((p) => p.startsWith('DELETE'))).toEqual([
      'DELETE /api/urusan/u/pendamping',
      'DELETE /api/urusan/u/pendamping',
    ]);
    expect([ui.data.keadaan, ui.data.mode]).toEqual(['selesai', 'done']);
  });
});
