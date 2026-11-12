import type { EventOf, EventPayload, UrusanState, UrusinEvent } from '@urusin/contracts';
import { PORTAL_WILAYAH } from '@urusin/core';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { afterEach, describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { openHarnessDb } from './db.js';
import {
  ADAPTER_GENERIK,
  alasanDipandu,
  hostsAiWilayah,
  hostsPortalWilayah,
  jalurModeUji,
  portalWebWilayah,
} from './generik.js';
import { catatanDipandu } from './builtin-tools.js';
import { aturJaringanId, mulaiPengajuan, rutePendamping, setujuiRencana, tierEksekusi } from './rencana.js';
import { buatUrusanTerwilayah, rencanaPeristiwa } from './wilayah.js';
import { HarnessStore } from './store.js';
import { makeEnv } from './testing.js';
import { jejakView } from './trace.js';

/** Registry wilayah (WP-D): Semarang web tanpa adapter, Dairi WhatsApp, Jakarta Pusat aplikasi. */
const SMG = '3374';
const DAIRI = '1211';
const JAKPUS = '3171';

afterEach(() => aturJaringanId(() => false));

function urusanDiusulkan(kodeKabKota: string, jenis: string) {
  const store = new HarnessStore(openHarnessDb());
  let u = buatUrusanTerwilayah(store, { kodeKabKota, jenis });
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

  it('params sesi generik: kode + jalur masuk portal; host sesi dari bawaan wilayah di worker', () => {
    // Kota Surabaya: portal di jalur /app; Kota Bandar Lampung: /pendaftaran.
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3578' })).toMatchObject({
      jalur: 'generik',
      params: { kode: '3578', jalur: '/app' },
    });
    const bdl = rutePendamping({ jenis: 'kelahiran', kodeKabKota: '1871' });
    expect(bdl).toMatchObject({ params: { kode: '1871', jalur: '/pendaftaran' } });
    if (bdl.jalur === 'generik') expect(bdl.params).not.toHaveProperty('hosts');
  });

  it('Mode Uji: jalur portal hanya dibawa bila replika mendeklarasikannya, selain itu akar replika', () => {
    const SBY = 'https://wargaklampid-dispendukcapil.surabaya.go.id';
    expect(jalurModeUji(SBY, '/app')).toBe('/');
    expect(jalurModeUji(SBY, undefined)).toBe('/');
    expect(jalurModeUji('bukan url', '/app')).toBe('/');
    const deklarasi = { 'wargaklampid-dispendukcapil.surabaya.go.id': ['/app'] };
    expect(jalurModeUji(SBY, '/app', deklarasi)).toBe('/app');
    expect(jalurModeUji(SBY, '/lain', deklarasi)).toBe('/');
    expect(jalurModeUji('https://sidnok.semarangkota.go.id', '/app', deklarasi)).toBe('/');
  });

  it('portal yang hanya bisa dimasuki lewat akun Google (OAuth diblokir egress) = dipandu', () => {
    expect(PORTAL_WILAYAH['3201']?.login).toEqual(['google']);
    expect(portalWebWilayah('3201')).toBeUndefined();
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3201' }).jalur).toBe('dipandu');
    // Kab. Bogor di luar daerah Pendamping aktif (ADR 0033): kalimat positif, bukan "belum bisa dibantu".
    expect(alasanDipandu('3201', 'Kab. Bogor')).toMatch(
      /Untuk Kab\. Bogor, Urusin memandu.*sedang kami kembangkan/,
    );
  });

  it('probe portal nyata: jalur masuk portal dari registry sampai params sesi (bukan "/")', () => {
    // 1871 "/" situs info, 3321 "/" halaman default IIS, 3571 "/" halaman kosong.
    for (const [kode, jalur] of [
      ['1871', '/pendaftaran'],
      ['3321', '/Siap_Om'],
      ['3571', '/sakti'],
    ] as const) {
      expect(new URL(portalWebWilayah(kode)!.url).pathname, kode).toBe(jalur);
      // Demak dan Kota Kediri di luar daerah Pendamping aktif (ADR 0033): jalurnya tetap tercatat, rutenya dipandu.
      if (kode !== '1871') {
        expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: kode }), kode).toMatchObject({
          jalur: 'dipandu',
          sebab: 'pengembangan',
        });
        continue;
      }
      expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: kode }), kode).toMatchObject({
        jalur: 'generik',
        params: { kode, jalur },
      });
      const { store, u, events, publish } = urusanDiusulkan(kode, 'kelahiran');
      setujuiRencana(store, u.id, publish);
      const req = events.find((e): e is EventOf<'execution_request'> => e.type === 'execution_request');
      expect(req?.params, kode).toMatchObject({ kode, jalur });
    }
  });

  it('probe portal nyata: portal id-only baru dipandu tanpa worker ID; portal mati/berubah selalu dipandu', () => {
    for (const kode of ['1271', '1372', '1403', '1771', '3275', '3279', '3402', '3674', '6271']) {
      // Di luar daerah Pendamping aktif (ADR 0033): dipandu apa pun keadaan worker ID.
      const aktif = kode === '1271';
      aturJaringanId(() => false);
      expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: kode }), kode).toMatchObject({
        jalur: 'dipandu',
        sebab: aktif ? 'jaringan_id' : 'pengembangan',
      });
      aturJaringanId(() => true);
      expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: kode }).jalur, kode).toBe(
        aktif ? 'generik' : 'dipandu',
      );
    }
    for (const kode of ['1117', '1171', '1173', '1114', '3314', '1116', '3525', '1102', '1471']) {
      expect(portalWebWilayah(kode), kode).toBeUndefined();
      expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: kode }).jalur, kode).toBe('dipandu');
      expect(hostsPortalWilayah(kode), kode).toEqual([]);
    }
  });

  it('host portal: hanya host portal persis (tanpa host info dan pihak ketiga)', () => {
    expect(hostsPortalWilayah(SMG)).toEqual(PORTAL_WILAYAH[SMG]!.hosts);
    expect(hostsPortalWilayah(SMG)).not.toContain('challenges.cloudflare.com');
    expect(hostsAiWilayah(SMG)).not.toContain('challenges.cloudflare.com');
    expect(hostsPortalWilayah(DAIRI)).toEqual([]);
    expect(hostsPortalWilayah(null)).toEqual([]);
  });

  it('host aset portal: ikut sesi wilayah, bukan host portal (vault) atau host AI', () => {
    for (const [kode, aset] of [
      ['3404', 'dukcapil-cdn.slemankab.go.id'],
      ['3310', 'api.diskominfo.klaten.go.id'],
    ] as const) {
      expect(hostsPortalWilayah(kode), kode).not.toContain(aset);
      expect(hostsAiWilayah(kode), kode).not.toContain(aset);
      expect(hostsAiWilayah(kode), kode).toEqual(expect.arrayContaining([...PORTAL_WILAYAH[kode]!.hosts]));
    }
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
    // Portal Semarang `id-only`: ditawarkan karena ada worker berjaringan Indonesia yang sehat.
    aturJaringanId(() => true);
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

  it('2b. portal id-only tanpa worker ID sehat: dipandu sejak kartu; id-utama (Wonogiri) tetap di server', () => {
    aturJaringanId(() => false);
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: SMG })).toMatchObject({
      jalur: 'dipandu',
      sebab: 'jaringan_id',
      alasan: expect.stringContaining('hanya bisa dibuka dari jaringan Indonesia'),
    });
    const kartu = rencanaPeristiwa('kelahiran', { ktp: SMG })!;
    expect(kartu.tier).toBe('dipandu');
    expect(kartu.pendamping).toBeUndefined();
    expect(kartu.catatan).toContain('Browser Pendamping berjaringan Indonesia sedang tidak aktif');
    const { store, u, events, publish } = urusanDiusulkan(SMG, 'kelahiran');
    expect(setujuiRencana(store, u.id, publish)).toMatchObject({
      executionId: null,
      urusan: { state: 'RENCANA_DISETUJUI' },
    });
    expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
    // Telunjuk Sakti Wonogiri `id-utama`: worker server tetap melayani (warga menyelesaikan kotak centang).
    expect(rutePendamping({ jenis: 'pindah', kodeKabKota: '3312' })).toMatchObject({
      jalur: 'generik',
      origin: 'https://telunjuksakti.wonogirikab.go.id',
    });
    expect(rencanaPeristiwa('pindah', { ktp: '3312' })?.tier).toBe('semi');
    // Kembali ditawarkan begitu worker ID sehat.
    aturJaringanId(() => true);
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: SMG }).jalur).toBe('generik');
    expect(rencanaPeristiwa('kelahiran', { ktp: SMG })?.tier).toBe('semi');
  });

  it('N11: tier dibekukan per eksekusi; kesehatan worker ID yang berubah di tengah jalan tidak mengubahnya', () => {
    const { store, u } = urusanDiusulkan(SMG, 'kelahiran');
    const events: EventPayload[] = [];
    const publish = (e: EventPayload) => {
      store.appendEvent(u.id, e.type, e);
      events.push(e);
    };
    // Sehat hanya pada pembacaan pertama: satu persetujuan = satu keputusan rute (tier dan tindakan sama).
    let n = 0;
    aturJaringanId(() => n++ === 0);
    const r = setujuiRencana(store, u.id, publish);
    expect(r.urusan.state).toBe('MENUNGGU_KONFIRMASI');
    expect(r.executionId).not.toBeNull();
    // Worker ID mati sesudah eksekusi ditawarkan: langkah eksekusi ini tetap bertier saat ditawarkan.
    aturJaringanId(() => false);
    mulaiPengajuan(store, u.id, publish);
    const tier = events.flatMap((e) => (e.type === 'state' ? [[e.state, e.tier]] : []));
    expect(tier).toEqual([
      ['RENCANA_DISETUJUI', 'semi'],
      ['MENYIAPKAN_BERKAS', 'semi'],
      ['BERKAS_SIAP', 'semi'],
      ['MENGISI', 'semi'],
      ['MENUNGGU_KONFIRMASI', 'semi'],
      ['MENGUNGGAH', 'semi'],
      ['MENUNGGU_SUBMIT_WARGA', 'semi'],
    ]);
    expect(tierEksekusi(store, store.getUrusanOrThrow(u.id))).toBe('semi');
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

  it('3b. layanan non-adminduk tidak diarahkan ke Disdukcapil (QA warga: Samsat Jakarta, LAPOR! Bandung)', () => {
    // Sebelumnya: "Disdukcapil Jakarta Pusat melayani pengajuan lewat aplikasi ponsel resmi" untuk pajak motor.
    for (const jenis of ['pajak_kendaraan', 'pengaduan', 'bansos'])
      expect(rutePendamping({ jenis, kodeKabKota: JAKPUS })).toEqual({
        jalur: 'dipandu',
        alasan: alasanDipandu(null),
      });
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: JAKPUS })).toMatchObject({
      alasan: expect.stringMatching(/Disdukcapil/),
    });

    const ktp = { kodeKabKota: JAKPUS, nama: 'Kota Administrasi Jakarta Pusat' };
    const dukcapil = { judul: 'Alpukat Betawi', url: 'https://alpukat-dukcapil.jakarta.go.id/' };
    expect(catatanDipandu('kelahiran', ktp, dukcapil)).toContain('alpukat-dukcapil.jakarta.go.id');
    for (const jenis of ['pajak_kendaraan', 'pengaduan', 'lainnya']) {
      const c = catatanDipandu(jenis, ktp, dukcapil);
      expect(c).toMatch(/^Langkah disusun asisten, belum bersumber\./);
      expect(c).not.toContain('alpukat');
    }
    expect(catatanDipandu('pengaduan', ktp, dukcapil)).toContain('lapor.go.id');
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
