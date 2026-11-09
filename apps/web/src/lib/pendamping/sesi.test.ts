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
