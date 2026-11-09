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

describe('SesiPendampingUi: pengajuan terkirim', () => {
  it('selesai + nomor langsung tampil (tanpa jeda/mengisi), lalu hasil dilaporkan ke server sekali', async () => {
    const panggilan: string[] = [];
    const ui = new SesiPendampingUi('u_1', async () => null, (async (url: string, init?: RequestInit) => {
      panggilan.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    ui.terapkanSesi(sesi({ mode: 'takeover' }));
    ui.terapkanEvent({ jenis: 'giliran_anda', alasan: 'final', pesan: 'Tekan Selesai', tombol: 'Selesai' });
    expect(ui.data.keadaan).toBe('giliran');
    // Urutan dari layanan pendamping saat sesi ditutup: event selesai, mode done, status selesai.
    ui.terapkanEvent({
      jenis: 'selesai',
      hasil: 'berhasil',
      pesan: 'Pengajuan terkirim.',
      bukti: { nomor: 'FX-REG-0002' },
    });
    expect(ui.data).toMatchObject({ keadaan: 'selesai', bukti: { nomor: 'FX-REG-0002' }, giliran: null });
    ui.terapkanSesi(
      sesi({ status: 'selesai', mode: 'done', hasil: 'berhasil', bukti: { nomor: 'FX-REG-0002' } }),
    );
    expect(ui.data).toMatchObject({ keadaan: 'selesai', bukti: { nomor: 'FX-REG-0002' } });
    await Promise.resolve();
    expect(panggilan).toEqual(['GET /api/urusan/u_1/pendamping']);
  });

  it('sinkron gagal (jaringan) dicoba lagi pada status berikutnya', async () => {
    let n = 0;
    const ui = new SesiPendampingUi('u_1', async () => null, (async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    ui.terapkanSesi(sesi({ status: 'selesai', mode: 'done', hasil: 'berhasil' }));
    await new Promise((r) => setTimeout(r, 0));
    ui.terapkanSesi(sesi({ status: 'selesai', mode: 'done', hasil: 'berhasil' }));
    await new Promise((r) => setTimeout(r, 0));
    ui.terapkanSesi(sesi({ status: 'selesai', mode: 'done', hasil: 'berhasil' }));
    expect(n).toBe(2);
  });
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
