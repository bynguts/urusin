import type { EventPayload, UrusanState } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { openHarnessDb } from './db.js';
import { ConflictError } from './errors.js';
import { TOOL_AJUKAN, langkahPendamping, mulaiPengajuan, setujuiRencana } from './rencana.js';
import { HarnessStore, paramsHash } from './store.js';

function urusanDiusulkan(kodeKabKota: string, jenis: string) {
  const store = new HarnessStore(openHarnessDb());
  let u = store.createUrusan({ kodeKabKota, jenis });
  for (const ke of ['MEMAHAMI', 'RENCANA_DIUSULKAN'] as UrusanState[])
    u = store.transition(u.id, u.version, ke);
  const events: EventPayload[] = [];
  return { store, u, events, publish: (e: EventPayload) => void events.push(e) };
}

describe('Setujui rencana -> Browser Pendamping (deterministik, tanpa model)', () => {
  it('akta kelahiran Wonogiri: maju ke MENUNGGU_KONFIRMASI, lalu execution_request + gerbang konfirmasi', () => {
    const { store, u, events, publish } = urusanDiusulkan('3312', 'kelahiran');
    const r = setujuiRencana(store, u.id, publish, u.version);

    expect(r.urusan.state).toBe('MENUNGGU_KONFIRMASI');
    expect(store.getUrusanOrThrow(u.id).state).toBe('MENUNGGU_KONFIRMASI');
    expect(events.filter((e) => e.type === 'state').map((e) => e.type === 'state' && e.state)).toEqual([
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
      'MENGISI',
      'MENUNGGU_KONFIRMASI',
    ]);
    const req = events.find((e) => e.type === 'execution_request');
    const hash = paramsHash(TOOL_AJUKAN, { kodeKabKota: '3312', layananId: 23 });
    expect(req).toMatchObject({
      executionId: r.executionId,
      adapterId: 'telunjuk-sakti-wonogiri',
      flowId: 'ajukan',
      params: { layanan_id: 23, berkas: 'kk,ktp,surat' },
      tool: TOOL_AJUKAN,
      paramsHash: hash,
      origin: 'https://telunjuksakti.wonogirikab.go.id',
    });
    expect(req && 'bacaSaja' in req).toBe(false);
    // Gerbang sesudah permintaan, hash sama: kartu "Setujui dan buka situs" dan POST /konfirmasi menemukannya.
    expect(events.at(-1)).toMatchObject({
      type: 'gate',
      jenis: 'konfirmasi',
      tool: TOOL_AJUKAN,
      paramsHash: hash,
    });
    // Tanpa nilai pribadi di permintaan.
    expect(JSON.stringify(req)).not.toMatch(/\d{16}|PEMOHON/);

    // Pendamping mulai: urusan siap menerima laporan Selesai dari warga (TERKIRIM sah setelahnya).
    expect(mulaiPengajuan(store, u.id, publish).state).toBe('MENUNGGU_SUBMIT_WARGA');
    expect(mulaiPengajuan(store, u.id, publish).state).toBe('MENUNGGU_SUBMIT_WARGA');
  });

  it('kota tanpa adapter tulis (Surabaya baca-saja) atau jenis tanpa langkah adapter: berhenti di RENCANA_DISETUJUI', () => {
    for (const [kode, jenis] of [
      ['3578', 'kelahiran'],
      ['3312', 'kematian'],
      ['3312', 'lainnya'],
    ] as const) {
      const { store, u, events, publish } = urusanDiusulkan(kode, jenis);
      const r = setujuiRencana(store, u.id, publish);
      expect(r).toMatchObject({ executionId: null, urusan: { state: 'RENCANA_DISETUJUI' } });
      expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
      expect(langkahPendamping(r.urusan)).toBeUndefined();
    }
  });

  it('hanya dari RENCANA_DIUSULKAN dengan versi yang dilihat warga; persetujuan ganda ditolak', () => {
    const { store, u, publish } = urusanDiusulkan('3312', 'kelahiran');
    expect(() => setujuiRencana(store, u.id, publish, u.version - 1)).toThrow(ConflictError);
    setujuiRencana(store, u.id, publish, u.version);
    expect(() => setujuiRencana(store, u.id, publish)).toThrow(ConflictError);
  });
});
