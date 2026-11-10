import type { EventOf, EventPayload, UrusanState, UrusinEvent } from '@urusin/contracts';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { afterEach, describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { openHarnessDb } from './db.js';
import {
  ADAPTER_GENERIK,
  alasanDipandu,
  hostsWilayah,
  pasangSumberPortalWilayah,
  portalWebWilayah,
  type PortalWilayahRingkas,
} from './generik.js';
import { rutePendamping, setujuiRencana } from './rencana.js';
import { HarnessStore } from './store.js';
import { makeEnv } from './testing.js';

/** Registry wilayah tiruan (bentuk antarmuka WP-D); host persis, tanpa wildcard. */
const PORTAL: Record<string, PortalWilayahRingkas> = {
  // Wonogiri: punya adapter tulisan tangan; registry wilayah juga mencatat portal web-nya.
  '3312': {
    jenis: 'web',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    nama: 'Telunjuk Sakti',
    hosts: ['telunjuksakti.wonogirikab.go.id'],
  },
  // Kota Semarang: portal web tanpa adapter tulisan tangan.
  '3374': {
    jenis: 'web',
    origin: 'https://layanan.disdukcapil.semarangkota.go.id',
    nama: 'Layanan Disdukcapil Semarang',
    hosts: ['layanan.disdukcapil.semarangkota.go.id', 'disdukcapil.semarangkota.go.id'],
  },
  // Surabaya: anggap kanal WhatsApp saja (non-web).
  '3578': { jenis: 'whatsapp', hosts: ['dispendukcapil.surabaya.go.id'] },
  // Origin tidak di daftar host: bukan portal web yang sah.
  '3301': { jenis: 'web', origin: 'https://lain.example.go.id', hosts: ['cilacapkab.go.id'] },
};

afterEach(() => pasangSumberPortalWilayah());
const pasang = () => pasangSumberPortalWilayah((k) => PORTAL[k]);

function urusanDiusulkan(kodeKabKota: string, jenis: string) {
  const store = new HarnessStore(openHarnessDb());
  let u = store.createUrusan({ kodeKabKota, jenis });
  for (const ke of ['MEMAHAMI', 'RENCANA_DIUSULKAN'] as UrusanState[])
    u = store.transition(u.id, u.version, ke);
  const events: EventPayload[] = [];
  return { store, u, events, publish: (e: EventPayload) => void events.push(e) };
}

describe('antarmuka registry wilayah', () => {
  it('tanpa sumber: tidak ada host dan tidak ada portal web (gagal tertutup)', () => {
    expect(hostsWilayah('3374')).toEqual([]);
    expect(portalWebWilayah('3374')).toBeUndefined();
  });
  it('portal web hanya bila https dan host origin ada di daftar host wilayah', () => {
    pasang();
    expect(portalWebWilayah('3374')?.origin).toBe('https://layanan.disdukcapil.semarangkota.go.id');
    expect(portalWebWilayah('3301')).toBeUndefined();
    expect(portalWebWilayah('3578')).toBeUndefined();
    expect(portalWebWilayah('bukan')).toBeUndefined();
  });
});

describe('routing rencana.ts: adapter -> (platform) -> generik -> dipandu', () => {
  it('1. wilayah dengan adapter tulisan tangan: jalur cepat adapter, bukan generik', () => {
    pasang();
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3312' })).toMatchObject({
      jalur: 'adapter',
      adapterId: 'telunjuk-sakti-wonogiri',
    });
    const { store, u, events, publish } = urusanDiusulkan('3312', 'kelahiran');
    setujuiRencana(store, u.id, publish);
    expect(events.find((e) => e.type === 'execution_request')).toMatchObject({
      adapterId: 'telunjuk-sakti-wonogiri',
    });
  });

  it('2. wilayah web tanpa adapter: Navigator generik ke portal wilayah, gerbang konfirmasi tetap', () => {
    pasang();
    const { store, u, events, publish } = urusanDiusulkan('3374', 'kelahiran');
    const r = setujuiRencana(store, u.id, publish);
    expect(r.urusan.state).toBe('MENUNGGU_KONFIRMASI');
    const req = events.find((e): e is EventOf<'execution_request'> => e.type === 'execution_request');
    expect(req).toMatchObject({
      adapterId: ADAPTER_GENERIK,
      flowId: 'kelahiran',
      params: { jenis: 'kelahiran', kode: '3374' },
      origin: 'https://layanan.disdukcapil.semarangkota.go.id',
    });
    expect(req?.ringkasan).toMatch(/izinkan per halaman/);
    expect(req?.ringkasan).toMatch(/menekan Kirim sendiri/);
    expect(events.at(-1)).toMatchObject({ type: 'gate', jenis: 'konfirmasi', paramsHash: req?.paramsHash });
  });

  it('3. wilayah non-web (WhatsApp): dipandu dengan alasan jujur, tanpa permintaan eksekusi', () => {
    pasang();
    const rute = rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3578' });
    expect(rute).toMatchObject({ jalur: 'dipandu' });
    const { store, u, events, publish } = urusanDiusulkan('3578', 'kelahiran');
    const r = setujuiRencana(store, u.id, publish);
    expect(r).toMatchObject({ executionId: null, urusan: { state: 'RENCANA_DISETUJUI' } });
    expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
    const label = events.find((e) => e.type === 'progress');
    expect(label).toMatchObject({ type: 'progress', label: expect.stringMatching(/lewat WhatsApp/) });
    expect(label).toMatchObject({ label: expect.stringMatching(/Surabaya/) });
    // Jenis urusan tak dikenal di wilayah web pun tetap dipandu.
    expect(rutePendamping({ jenis: 'lainnya', kodeKabKota: '3374' }).jalur).toBe('dipandu');
  });

  it('4. wilayah belum ditetapkan: dipandu, dan tool rencana tetap kena WILAYAH_BELUM_DITETAPKAN', async () => {
    pasang();
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: null })).toEqual({
      jalur: 'dipandu',
      alasan: alasanDipandu(null),
    });
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          toolCalls: [
            {
              name: 'urusan__usulkan_rencana',
              arguments: JSON.stringify({
                ringkasan: 'Akta kelahiran',
                langkah: [{ judul: 'Ajukan akta', jenis: 'online-adapter' }],
              }),
            },
          ],
        }),
        fakeCompletion({ content: 'KTP Anda terdaftar di kabupaten/kota mana?' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran anak' });
    const gate = out.events.filter((e): e is EventOf<'policy_gate'> => e.type === 'policy_gate');
    expect(gate[0]).toMatchObject({ keputusan: 'deny', aturan: 'WILAYAH_BELUM_DITETAPKAN' });
    expect(out.events.some((e: UrusinEvent) => e.type === 'execution_request')).toBe(false);
    expect(env.store.getUrusanOrThrow(u.id)).toMatchObject({ state: 'MEMAHAMI', kodeKabKota: null });
  });
});
