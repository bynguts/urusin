import type { EventOf, EventPayload, UrusanState, UrusinEvent } from '@urusin/contracts';
import { PORTAL_WILAYAH } from '@urusin/core';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { openHarnessDb } from './db.js';
import {
  ADAPTER_GENERIK,
  alasanDipandu,
  hostsAiWilayah,
  hostsPortalWilayah,
  portalWebWilayah,
} from './generik.js';
import { rutePendamping, setujuiRencana } from './rencana.js';
import { HarnessStore } from './store.js';
import { makeEnv } from './testing.js';
import { jejakView } from './trace.js';

/** Registry wilayah (WP-D): Semarang web tanpa adapter, Dairi WhatsApp, Jakarta Pusat aplikasi. */
const SMG = '3374';
const DAIRI = '1211';
const JAKPUS = '3171';

function urusanDiusulkan(kodeKabKota: string, jenis: string) {
  const store = new HarnessStore(openHarnessDb());
  let u = store.createUrusan({ kodeKabKota, jenis });
  for (const ke of ['MEMAHAMI', 'RENCANA_DIUSULKAN'] as UrusanState[])
    u = store.transition(u.id, u.version, ke);
  const events: EventPayload[] = [];
  return { store, u, events, publish: (e: EventPayload) => void events.push(e) };
}

describe('registry wilayah untuk Navigator', () => {
  it('data uji sesuai registry', () => {
    expect(PORTAL_WILAYAH[SMG]?.jenis).toBe('web');
    expect(PORTAL_WILAYAH[DAIRI]?.jenis).toBe('whatsapp');
    expect(PORTAL_WILAYAH[JAKPUS]?.jenis).toBe('aplikasi');
  });

  it('params sesi generik: jalur masuk portal dan host sesi = host portal (+ Cloudflare hanya bila dipakai)', () => {
    // Kota Surabaya: portal di jalur /app, tanpa proteksi Cloudflare.
    const sby = rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3578' });
    expect(sby).toMatchObject({ jalur: 'generik', params: { jalur: '/app' } });
    if (sby.jalur !== 'generik') return;
    expect(String(sby.params.hosts).split(',')).toEqual(hostsPortalWilayah('3578'));
    // Kota Bandar Lampung: jalur /pendaftaran dan portal ber-Cloudflare.
    const bdl = rutePendamping({ jenis: 'kelahiran', kodeKabKota: '1871' });
    expect(bdl).toMatchObject({ params: { jalur: '/pendaftaran' } });
    if (bdl.jalur !== 'generik') return;
    const hosts = String(bdl.params.hosts).split(',');
    expect(hosts).toEqual([...hostsPortalWilayah('1871'), 'challenges.cloudflare.com']);
    // Host info Disdukcapil tidak pernah ikut sesi.
    for (const h of PORTAL_WILAYAH['1871']!.hostInfo)
      if (!hostsPortalWilayah('1871').includes(h)) expect(hosts).not.toContain(h);
  });

  it('portal yang hanya bisa dimasuki lewat akun Google (OAuth diblokir egress) = dipandu', () => {
    expect(PORTAL_WILAYAH['3201']?.login).toEqual(['google']);
    expect(portalWebWilayah('3201')).toBeUndefined();
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3201' }).jalur).toBe('dipandu');
  });

  it('host portal: hanya host portal persis (tanpa host info dan pihak ketiga)', () => {
    expect(hostsPortalWilayah(SMG)).toEqual(PORTAL_WILAYAH[SMG]!.hosts);
    expect(hostsPortalWilayah(SMG)).not.toContain('challenges.cloudflare.com');
    expect(hostsAiWilayah(SMG)).not.toContain('challenges.cloudflare.com');
    expect(hostsPortalWilayah(DAIRI)).toEqual([]);
    expect(hostsPortalWilayah(null)).toEqual([]);
  });

  it('platform bersama (SIDAK Aceh) ikut host portal tenant', () => {
    expect(hostsPortalWilayah('1101')).toContain('sidak.acehprov.go.id');
  });

  it('setiap portal web: origin https dan host-nya milik wilayah itu', () => {
    for (const [kode, p] of Object.entries(PORTAL_WILAYAH)) {
      const w = portalWebWilayah(kode);
      if (p.jenis !== 'web') expect(w).toBeUndefined();
      else if (w) expect(hostsPortalWilayah(kode)).toContain(new URL(w.origin).host);
    }
  });
});

describe('routing rencana.ts: adapter -> (platform) -> generik -> dipandu', () => {
  it('1. wilayah dengan adapter tulisan tangan: jalur cepat adapter, bukan generik', () => {
    expect(PORTAL_WILAYAH['3312']?.jenis).toBe('web');
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
    const { store, u, events, publish } = urusanDiusulkan(SMG, 'kelahiran');
    const r = setujuiRencana(store, u.id, publish);
    expect(r.urusan.state).toBe('MENUNGGU_KONFIRMASI');
    const req = events.find((e): e is EventOf<'execution_request'> => e.type === 'execution_request');
    expect(req).toMatchObject({
      adapterId: ADAPTER_GENERIK,
      flowId: 'kelahiran',
      params: { jenis: 'kelahiran', kode: SMG },
      origin: portalWebWilayah(SMG)!.origin,
    });
    expect(req?.ringkasan).toMatch(/izinkan per halaman/);
    expect(req?.ringkasan).toMatch(/menekan Kirim sendiri/);
    expect(events.at(-1)).toMatchObject({ type: 'gate', jenis: 'konfirmasi', paramsHash: req?.paramsHash });
  });

  it('3. wilayah non-web (WhatsApp, aplikasi): dipandu dengan alasan jujur, tanpa permintaan eksekusi', () => {
    for (const [kode, kanal] of [
      [DAIRI, /lewat WhatsApp/],
      [JAKPUS, /lewat aplikasi ponsel resmi/],
    ] as const) {
      expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: kode })).toMatchObject({ jalur: 'dipandu' });
      const { store, u, events, publish } = urusanDiusulkan(kode, 'kelahiran');
      const r = setujuiRencana(store, u.id, publish);
      expect(r).toMatchObject({ executionId: null, urusan: { state: 'RENCANA_DISETUJUI' } });
      expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
      expect(events.find((e) => e.type === 'progress')).toMatchObject({
        label: expect.stringMatching(kanal),
      });
    }
    // Jenis urusan tak dikenal di wilayah web pun tetap dipandu.
    expect(rutePendamping({ jenis: 'lainnya', kodeKabKota: SMG }).jalur).toBe('dipandu');
  });

  it('4. wilayah belum ditetapkan: dipandu, dan tool rencana tetap kena WILAYAH_BELUM_DITETAPKAN', async () => {
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

describe('jejak Navigator di halaman Jejak', () => {
  it('setiap catatan jejak_pendamping diringkas tanpa nilai; hash dipendekkan', () => {
    const store = new HarnessStore(openHarnessDb());
    const u = store.createUrusan({ kodeKabKota: SMG, jenis: 'kelahiran' });
    const h = 'ab'.repeat(32);
    const catatan = [
      { jenis: 'amati', host: 'sidnok.semarangkota.go.id', sidik: 's1', elemen: 12 },
      {
        jenis: 'rencana',
        model: 'm',
        tokenMasuk: 1,
        tokenKeluar: 1,
        rencanaHash: h,
        aksi: [{ jenis: 'isi', ref: 'e1' }],
      },
      { jenis: 'validasi', rencanaHash: h, putusan: 'tolak', aturan: ['KELAS_KLIK_DITOLAK'] },
      { jenis: 'persetujuan', rencanaHash: h, n: 3 },
      {
        jenis: 'blokir',
        metode: 'POST',
        host: 'sidnok.semarangkota.go.id',
        jalurSha256: h,
        jendela: 'ai_klik',
      },
      { jenis: 'ambil_alih', fase: 'mulai', alasan: 'final' },
      { jenis: 'jejak_terbuang', n: 4 },
      { jenis: 'validasi', rencanaHash: 'cd'.repeat(32), putusan: 'terima', aturan: [], asal: h },
      { jenis: 'resi', akhir: 'selesai', hash: h, halaman: 3, aksi: 9, panggilanLlm: 4 },
    ];
    for (const c of catatan) store.appendEvent(u.id, 'jejak_pendamping', { executionId: 'x_1', catatan: c });
    const ringkas = jejakView(store, u.id)
      .timeline.filter((i) => i.jenis === 'event' && i.type === 'jejak_pendamping')
      .map((i) => (i.jenis === 'event' ? i.ringkas : ''));
    expect(ringkas).toEqual([
      'Navigator mengamati sidnok.semarangkota.go.id (12 elemen)',
      'Rencana abababab: isi',
      'Validator menolak rencana abababab (KELAS_KLIK_DITOLAK)',
      'Warga menyetujui 3 isian untuk rencana abababab',
      'Gerbang tulis memblokir POST ke sidnok.semarangkota.go.id',
      'Kendali ke warga (final)',
      '4 catatan worker terbuang (buffer jejak penuh); rantai audit sesi ini tidak lengkap',
      'Validator menerima rencana cdcdcdcd (ikat ulang dari abababab)',
      'Resi Navigator (selesai): 3 halaman, 9 aksi, 4 panggilan LLM, hash abababab',
    ]);
  });
});
