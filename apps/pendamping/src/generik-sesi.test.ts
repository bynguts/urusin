import type net from 'node:net';
import { hostsSesi } from '@urusin/adapters';
import { EGRESS_ASET_UMUM } from '@urusin/core';
import type {
  AksiSesiInternal,
  HasilAksi,
  MulaiSesiInternal,
  PendampingServerMessage,
  Pengamatan,
} from '@urusin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from './config.js';
import type { IzinGenerik } from './generik.js';
import { createServer } from './server.js';
import { ADAPTER_GENERIK, SessionManager, sidHashOf, type ActiveRun, type RunInit } from './sessions.js';
import { headerTanda } from './tanda.js';

const SID = sidHashOf('c'.repeat(32));
const OTHER = sidHashOf('d'.repeat(32));
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';
const FX = 'http://127.0.0.1:4331';
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const PH = '{{PEMOHON.NAMA}}';

const owner = (urusanId: string, sidHash = SID) => ({ urusanId, sidHash });

function input(urusanId: string, extra: Partial<MulaiSesiInternal> = {}): MulaiSesiInternal {
  return {
    urusanId,
    sidHash: SID,
    executionId: `x_${urusanId}`,
    adapterId: ADAPTER_GENERIK,
    flowId: 'navigator',
    origin: RESMI,
    params: {},
    ...extra,
  };
}

const PENGAMATAN: Pengamatan = {
  v: 1,
  seq: 1,
  host: '127.0.0.1:4331',
  jalur: '/',
  judul: 'x',
  sinyal: {
    login: false,
    otp: false,
    captcha: false,
    tantangan: false,
    halamanAkhir: false,
    sukses: false,
    galatForm: false,
  },
  elemen: [],
  teks: '',
  sidik: 's',
};

type FakeRun = ActiveRun & { init: RunInit; calls: string[]; aksiMasuk: AksiSesiInternal['aksi'][] };

function harness(over: Partial<Config> = {}) {
  const runs: FakeRun[] = [];
  /** Pengamatan yang dikembalikan run palsu (diganti tes, mis. halaman sukses). */
  const ctl = { amatan: PENGAMATAN, tulisWarga: false };
  const config = { ...loadConfig({}), ...over };
  const factory = async (init: RunInit): Promise<FakeRun> => {
    const calls: string[] = [];
    const aksiMasuk: AksiSesiInternal['aksi'][] = [];
    const run: FakeRun = {
      init,
      calls,
      aksiMasuk,
      mulaiAi: async () => void calls.push('mulaiAi'),
      input: async (m) => void calls.push(`input:${m.type}`),
      ambilAlih: () => void calls.push('ambilAlih'),
      kembalikan: () => {
        calls.push('kembalikan');
        init.hooks.mode('ai', 'AI melanjutkan.');
      },
      gantiProgram: async () => void calls.push('ganti'),
      setViewer: async () => {},
      destroy: async () => void calls.push('destroy'),
      generik: {
        amati: async () => ctl.amatan,
        adaTulisWargaSejakAksiAi: () => ctl.tulisWarga,
        aksi: async (req): Promise<HasilAksi[]> => {
          aksiMasuk.push(req.aksi);
          return req.aksi.map((_, indeks) => ({ indeks, kode: 'ok' }));
        },
      },
    };
    runs.push(run);
    return run;
  };
  const manager = new SessionManager(config, factory);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const viewer = () => {
    const sent: PendampingServerMessage[] = [];
    return {
      sent,
      send: (m: PendampingServerMessage) => void sent.push(m),
      frame: () => {},
      ack: () => {},
      close: () => {},
    };
  };
  return { manager, runs, config, flush, viewer, ctl };
}

describe('programDari(generik)', () => {
  it('Mode Uji tanpa pemetaan = 422 dan tidak ada peramban/edge yang dibuat', async () => {
    const h = harness({ production: true, fixtureOrigins: [FX], originOverrides: new Map() });
    await expect(h.manager.create(input('u1', { modeUji: true }))).rejects.toMatchObject({
      kode: 'ADAPTER_TIDAK_ADA',
      status: 422,
    });
    // Factory (Chromium + daftarEdge) tidak pernah dipanggil: 0 host terdaftar di edge.
    expect(h.runs).toHaveLength(0);
  });

  it('Mode Uji dengan pemetaan: hanya origin fixture (0 host asli, termasuk pihak ketiga)', async () => {
    const h = harness({
      production: true,
      fixtureOrigins: [FX],
      originOverrides: new Map([[RESMI, `${FX}/generik/akun`]]),
    });
    const s = await h.manager.create(
      input('u1', {
        modeUji: true,
        params: { kode: '3312', hosts: 'challenges.cloudflare.com', jalur: '/masuk' },
      }),
    );
    await h.flush();
    const p = h.runs[0]!.init.program;
    expect(s).toMatchObject({ situs: FX, replika: true });
    expect(hostsSesi(p)).toEqual(['127.0.0.1']);
    expect(p.steps).toEqual([{ op: 'nav', path: '/generik/akun/masuk', effect: 'read' }]);
    expect(h.runs[0]!.init.generik).toBeDefined();
  });

  it('produksi: host sesi = host wilayah `kode` (bawaan portal + tantangan relevan); di luar wilayah = 422', async () => {
    const h = harness({ production: true, maxSessions: 20 });
    const hostsDari = async (id: string, params: Record<string, string>) => {
      await h.manager.create(input(id, { params }));
      await h.flush();
      return hostsSesi(h.runs.at(-1)!.init.program);
    };
    // Bawaan dari registry wilayah: host portal + tantangan Cloudflare (termasuk flow brunhild) + aset umum
    // CDN/fon, tanpa host info.
    expect(await hostsDari('u1', { kode: '3312', jalur: '/' })).toEqual([
      'telunjuksakti.wonogirikab.go.id',
      'challenges.cloudflare.com',
      'brunhild.challenges.cloudflare.com',
      ...EGRESS_ASET_UMUM,
    ]);
    // CDN boleh diminta eksplisit oleh web.
    expect(
      await hostsDari('u4', { kode: '3312', hosts: 'telunjuksakti.wonogirikab.go.id,unpkg.com' }),
    ).toEqual(['telunjuksakti.wonogirikab.go.id', 'unpkg.com']);
    // Diminta web: semuanya harus milik wilayah itu (host info boleh diminta eksplisit).
    expect(await hostsDari('u2', { kode: '3312', hosts: 'disdukcapil.wonogirikab.go.id' })).toEqual([
      'telunjuksakti.wonogirikab.go.id',
      'disdukcapil.wonogirikab.go.id',
    ]);
    // Tanpa kode: hanya host origin.
    expect(await hostsDari('u3', {})).toEqual(['telunjuksakti.wonogirikab.go.id']);
    const runs = h.runs.length;
    for (const [id, extra] of [
      // reCAPTCHA tidak ada di proteksi portal Wonogiri.
      ['t1', { params: { kode: '3312', hosts: 'www.google.com' } }],
      // Host portal wilayah lain.
      ['t2', { params: { kode: '3312', hosts: 'sidnok.semarangkota.go.id' } }],
      // Origin bukan portal wilayah `kode`.
      ['t3', { origin: 'https://sidnok.semarangkota.go.id', params: { kode: '3312' } }],
      // Host diminta tanpa kode wilayah.
      ['t4', { params: { hosts: 'challenges.cloudflare.com' } }],
      ['t5', { origin: 'https://contoh.example' }],
      ['t6', { params: { jalur: '//evil.example/x' } }],
      ['t7', { params: { kode: '9999' } }],
    ] as const)
      await expect(h.manager.create(input(id, extra as Partial<MulaiSesiInternal>))).rejects.toMatchObject({
        status: 422,
      });
    expect(h.runs).toHaveLength(runs);
  });
});

async function sesiBerjalan(h: ReturnType<typeof harness>, id = 'u1') {
  const s = await h.manager.create(input(id));
  await h.flush();
  const run = h.runs.at(-1)!;
  return { s, run, izin: run.init.generik!.izin };
}

describe('persetujuan generik terikat rencanaHash', () => {
  it('minta -> butuh_data{kolom, rencanaHash} tanpa sidik -> isi untuk hash itu saja', async () => {
    const h = harness();
    const { s, run, izin } = await sesiBerjalan(h);
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'berjalan', mode: 'ai' });
    expect(run.calls).toEqual(['mulaiAi']);
    const v = h.viewer();
    await h.manager.attach(s.sesiId, v);

    izin.minta({
      rencanaHash: H1,
      kolom: [{ placeholder: PH, labelPortal: 'Nama', sidik: 's-nama' }],
      berkas: [],
    });
    expect(h.manager.status(owner('u1')).status).toBe('menunggu_data');
    const butuh = v.sent.find((m) => m.type === 'butuh_data');
    expect(butuh).toEqual({
      type: 'butuh_data',
      placeholder: [PH],
      berkas: [],
      origin: RESMI,
      kolom: [{ placeholder: PH, labelPortal: 'Nama' }],
      rencanaHash: H1,
    });
    expect(JSON.stringify(v.sent)).not.toContain('s-nama');
    expect(h.manager.butuhData(owner('u1'))).toMatchObject({ kolom: [{ placeholder: PH }], rencanaHash: H1 });

    // Rencana lain / tanpa hash = 409, nilai tidak disimpan.
    await expect(h.manager.isiData(owner('u1'), { [PH]: 'Budi' }, H2)).rejects.toMatchObject({ status: 409 });
    await expect(h.manager.isiData(owner('u1'), { [PH]: 'Budi' })).rejects.toMatchObject({ status: 409 });
    expect(izin.nilai(PH)).toBeUndefined();

    const kurang = await h.manager.isiData(owner('u1'), { [PH]: 'Budi' }, H1);
    expect(kurang).toEqual({ placeholder: [], berkas: [] });
    expect(izin.disetujui(H1, 's-nama', PH)).toBe(true);
    expect(izin.disetujui(H2, 's-nama', PH)).toBe(false);
    expect(izin.disetujui(H1, 's-lain', PH)).toBe(false);
    expect(izin.nilai(PH)).toBe('Budi');
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'berjalan', mode: 'ai' });
    // Halaman awal hanya dibuka sekali (mulaiAi idempoten di browser.ts).
    expect(run.calls.filter((c) => c === 'mulaiAi')).toHaveLength(2);

    // Rencana berikutnya dengan placeholder yang SAMA wajib disetujui ulang walau nilainya sudah di memori.
    izin.minta({
      rencanaHash: H2,
      kolom: [{ placeholder: PH, labelPortal: 'Nama', sidik: 's-nama' }],
      berkas: [],
    });
    expect(izin.disetujui(H1, 's-nama', PH)).toBe(false);
    expect(h.manager.butuhData(owner('u1'))).toMatchObject({ placeholder: [PH], rencanaHash: H2 });

    expect(h.manager.kurasJejak(owner('u1')).catatan).toEqual([
      { jenis: 'persetujuan', rencanaHash: H1, n: 1 },
    ]);
  });

  it('baris yang tidak disetujui (tidak ada di isian) tidak terikat', async () => {
    const h = harness();
    const { izin } = await sesiBerjalan(h);
    izin.minta({
      rencanaHash: H1,
      kolom: [
        { placeholder: PH, labelPortal: 'Nama', sidik: 's-nama' },
        { placeholder: '{{PEMOHON.NIK}}', labelPortal: 'NIK', sidik: 's-nik' },
      ],
      berkas: [],
    });
    const kurang = await h.manager.isiData(owner('u1'), { [PH]: 'Budi' }, H1);
    expect(kurang.placeholder).toEqual(['{{PEMOHON.NIK}}']);
    expect(izin.disetujui(H1, 's-nik', '{{PEMOHON.NIK}}')).toBe(false);
  });

  const mintaNama = (izin: Pick<IzinGenerik, 'minta'>) =>
    izin.minta({
      rencanaHash: H1,
      kolom: [{ placeholder: PH, labelPortal: 'Nama', sidik: 's-nama' }],
      berkas: [],
    });

  it('isi dengan daftar kosong = tolak semua: berjalan lagi, tunggu kembali, tidak ada pasangan', async () => {
    const h = harness();
    const { izin } = await sesiBerjalan(h);
    mintaNama(izin);
    const p = h.manager.tunggu(owner('u1'), 5000);
    expect(await h.manager.isiData(owner('u1'), {}, H1)).toEqual({ placeholder: [PH], berkas: [] });
    expect(await p).toEqual({ mode: 'ai', status: 'berjalan', habisWaktu: false });
    expect(izin.disetujui(H1, 's-nama', PH)).toBe(false);
    expect(() => h.manager.butuhData(owner('u1'))).toThrow();
    expect(h.manager.kurasJejak(owner('u1')).catatan).toEqual([
      { jenis: 'persetujuan', rencanaHash: H1, n: 0 },
    ]);
  });

  it('"Saya isi sendiri" (ambil alih dari lembar) lalu kembalikan: izin ditutup, tunggu kembali', async () => {
    const h = harness();
    const { s, izin } = await sesiBerjalan(h);
    mintaNama(izin);
    await h.manager.handleClient(s.sesiId, { type: 'ambil_alih' });
    // Lembar ditutup: sesi berjalan, giliran warga; tidak lagi menunggu data.
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'berjalan', mode: 'takeover' });
    expect(() => h.manager.butuhData(owner('u1'))).toThrow();
    // "Tolak semua" yang datang belakangan untuk rencana itu = idempoten; rencana lain / isian = 409.
    expect(await h.manager.isiData(owner('u1'), {}, H1)).toEqual({ placeholder: [], berkas: [] });
    await expect(h.manager.isiData(owner('u1'), {}, H2)).rejects.toMatchObject({ status: 409 });
    await expect(h.manager.isiData(owner('u1'), { [PH]: 'Budi' }, H1)).rejects.toMatchObject({
      status: 409,
    });
    expect(izin.nilai(PH)).toBeUndefined();

    const p = h.manager.tunggu(owner('u1'), 5000);
    await h.manager.handleClient(s.sesiId, { type: 'kembalikan' });
    expect(await p).toEqual({ mode: 'ai', status: 'berjalan', habisWaktu: false });
    expect(izin.disetujui(H1, 's-nama', PH)).toBe(false);
    expect(h.manager.kurasJejak(owner('u1')).catatan).toEqual([
      { jenis: 'ambil_alih', fase: 'mulai' },
      { jenis: 'persetujuan', rencanaHash: H1, n: 0 },
      { jenis: 'ambil_alih', fase: 'selesai' },
    ]);
  });

  it('kembalikan saat lembar masih terbuka (tanpa ambil alih) juga menutup izin', async () => {
    const h = harness();
    const { s, izin } = await sesiBerjalan(h);
    mintaNama(izin);
    const p = h.manager.tunggu(owner('u1'), 5000);
    await h.manager.handleClient(s.sesiId, { type: 'kembalikan' });
    expect(await p).toEqual({ mode: 'ai', status: 'berjalan', habisWaktu: false });
  });
});

describe('aksi: kolom dari web', () => {
  it('placeholder kolom wajib ada di aksi isi/pilih rencana; kolom asing = 422', async () => {
    const h = harness();
    const { run } = await sesiBerjalan(h);
    const aksi = [{ jenis: 'isi' as const, ref: 'e1', nilai: PH }];
    await expect(
      h.manager.aksi(owner('u1'), {
        ...owner('u1'),
        rencanaHash: H1,
        aksi,
        kolom: [{ placeholder: '{{PEMOHON.NIK}}', labelPortal: 'NIK' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(run.aksiMasuk).toEqual([]);
    const r = await h.manager.aksi(owner('u1'), {
      ...owner('u1'),
      rencanaHash: H1,
      aksi,
      kolom: [{ placeholder: PH, labelPortal: 'Nama' }],
    });
    expect(r.hasil).toEqual([{ indeks: 0, kode: 'ok' }]);
    expect(run.aksiMasuk).toEqual([aksi]);
  });
});

describe('amati/aksi/tunggu/jejak', () => {
  it('aksi saat warga memegang kendali tidak dijalankan', async () => {
    const h = harness();
    const { run } = await sesiBerjalan(h);
    h.manager.serahkan(owner('u1'));
    const r = await h.manager.aksi(owner('u1'), {
      ...owner('u1'),
      rencanaHash: H1,
      aksi: [{ jenis: 'klik', ref: 'e1' }],
    });
    expect(r).toEqual({ mode: 'takeover', hasil: [{ indeks: 0, kode: 'DILEWATI' }] });
    expect(run.aksiMasuk).toEqual([]);
    // Amati tetap boleh (baca saja).
    expect((await h.manager.amati(owner('u1'))).mode).toBe('takeover');
    expect(h.manager.kurasJejak(owner('u1')).catatan).toEqual([{ jenis: 'ambil_alih', fase: 'mulai' }]);
  });

  it('pemilik lain = 403; sesi adapter = 409', async () => {
    const h = harness();
    await sesiBerjalan(h);
    await expect(h.manager.amati(owner('u1', OTHER))).rejects.toMatchObject({ status: 403 });
    expect(() => h.manager.kurasJejak(owner('u1', OTHER))).toThrow(/perangkat lain/);
    const a = await h.manager.create({
      ...input('u-adapter'),
      adapterId: 'telunjuk-sakti-wonogiri',
      flowId: 'ajukan',
      params: { layanan_id: 1 },
    });
    expect(a.status).toBeDefined();
    await h.flush();
    await expect(h.manager.amati(owner('u-adapter'))).rejects.toMatchObject({ status: 409 });
  });

  it('tunggu: segera saat AI; menunggu saat takeover sampai warga mengembalikan; habis waktu', async () => {
    const h = harness();
    const { s } = await sesiBerjalan(h);
    expect(await h.manager.tunggu(owner('u1'), 1000)).toEqual({
      mode: 'ai',
      status: 'berjalan',
      habisWaktu: false,
    });
    h.manager.serahkan(owner('u1'));
    expect(await h.manager.tunggu(owner('u1'), 20)).toEqual({
      mode: 'takeover',
      status: 'berjalan',
      habisWaktu: true,
    });
    const p = h.manager.tunggu(owner('u1'), 5000);
    await h.manager.handleClient(s.sesiId, { type: 'kembalikan' });
    expect(await p).toEqual({ mode: 'ai', status: 'berjalan', habisWaktu: false });
    // Sesi berakhir saat menunggu: kembali dengan mode done.
    h.manager.serahkan(owner('u1'));
    const q = h.manager.tunggu(owner('u1'), 5000);
    await h.manager.akhiri(owner('u1'));
    expect(await q).toMatchObject({ mode: 'done', status: 'dibatalkan', habisWaktu: false });
    // Jejak tetap bisa dikuras dari nisan.
    expect(h.manager.kurasJejak(owner('u1')).catatan.map((c) => c.jenis)).toEqual([
      'ambil_alih',
      'ambil_alih',
      'ambil_alih',
    ]);
  });
});

describe('server: endpoint internal generik (HMAC)', () => {
  let server: ReturnType<typeof createServer> | undefined;
  afterEach(() => server?.close());

  it('amati/aksi/tunggu/jejak: tanda wajib, zod di batas, pemilik = sidHash', async () => {
    const h = harness({ internalToken: 't'.repeat(40) });
    server = createServer(h.config, h.manager);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const call = (path: string, body: unknown, token = 't'.repeat(40)) => {
      const isi = JSON.stringify(body);
      return fetch(`${base}${path}`, {
        method: 'POST',
        headers: { ...headerTanda(token, 'POST', path, isi), 'content-type': 'application/json' },
        body: isi,
      });
    };
    expect((await call('/internal/sesi', input('u1'))).status).toBe(201);
    await h.flush();
    expect((await call('/internal/sesi/amati', owner('u1'), 'salah'.repeat(8))).status).toBe(401);
    expect((await call('/internal/sesi/amati', owner('u1', OTHER))).status).toBe(403);
    const amati = await call('/internal/sesi/amati', owner('u1'));
    expect(amati.status).toBe(200);
    expect(await amati.json()).toEqual({ mode: 'ai', pengamatan: PENGAMATAN, executionId: 'x_u1' });
    const pantau = await call('/internal/sesi/amati', { ...owner('u1'), pantau: true });
    expect(pantau.status).toBe(200);

    // URL/JS/teks bebas di aksi ditolak di batas (zod), sebelum sampai ke peramban.
    for (const buruk of [
      { jenis: 'klik', ref: 'e1', url: 'https://x' },
      { jenis: 'isi', ref: 'e1', nilai: 'teks bebas' },
      { jenis: 'klik', ref: 'button#kirim' },
      { jenis: 'kirim', ref: 'e1' },
    ]) {
      const r = await call('/internal/sesi/aksi', { ...owner('u1'), rencanaHash: H1, aksi: [buruk] });
      // Kunci tak dikenal di objek aksi dibuang zod; selebihnya 422.
      if ('url' in buruk) expect(r.status).toBe(200);
      else expect(r.status).toBe(422);
    }
    expect(h.runs[0]!.aksiMasuk).toEqual([[{ jenis: 'klik', ref: 'e1' }]]);
    const aksi = await call('/internal/sesi/aksi', {
      ...owner('u1'),
      rencanaHash: H1,
      aksi: [{ jenis: 'klik', ref: 'e2' }],
    });
    expect(await aksi.json()).toEqual({ mode: 'ai', hasil: [{ indeks: 0, kode: 'ok' }] });
    expect((await call('/internal/sesi/tunggu', { ...owner('u1'), maksMs: 25_001 })).status).toBe(422);
    const tunggu = await call('/internal/sesi/tunggu', { ...owner('u1'), maksMs: 10 });
    expect(await tunggu.json()).toEqual({ mode: 'ai', status: 'berjalan', habisWaktu: false });
    const jejak = await call('/internal/sesi/jejak', owner('u1'));
    expect(await jejak.json()).toEqual({ executionId: 'x_u1', catatan: [], terbuang: 0 });
    expect((await call('/internal/sesi/jejak', owner('u1', OTHER))).status).toBe(403);

    // selesai: tanda wajib, pemilik, bukti tervalidasi zod, halaman harus sukses.
    expect((await call('/internal/sesi/selesai', owner('u1'), 'salah'.repeat(8))).status).toBe(401);
    expect((await call('/internal/sesi/selesai', owner('u1', OTHER))).status).toBe(403);
    expect(
      (await call('/internal/sesi/selesai', { ...owner('u1'), bukti: { nomor: '<script>' } })).status,
    ).toBe(422);
    expect((await call('/internal/sesi/selesai', owner('u1'))).status).toBe(409);
    h.ctl.amatan = { ...PENGAMATAN, sinyal: { ...PENGAMATAN.sinyal, sukses: true }, teks: 'Nomor REG-1' };
    h.ctl.tulisWarga = true;
    const selesai = await call('/internal/sesi/selesai', { ...owner('u1'), bukti: { nomor: 'REG-1' } });
    expect(selesai.status).toBe(200);
    expect(selesai.status === 200 && (await selesai.clone().json()).executionId).toBe('x_u1');
    expect(await selesai.json()).toMatchObject({
      status: 'siaga',
      hasil: 'berhasil',
      bukti: { nomor: 'REG-1' },
    });
  });
});

describe('selesai (H3): halaman sukses -> siaga berhasil + bukti di jejak', () => {
  const SUKSES: Pengamatan = {
    ...PENGAMATAN,
    sinyal: { ...PENGAMATAN.sinyal, sukses: true },
    teks: 'Permohonan berhasil dikirim. Nomor registrasi: REG-2026-0001.',
  };

  it('halaman belum sukses = 409; sukses saat warga memegang kendali = siaga berhasil', async () => {
    const h = harness();
    const { s } = await sesiBerjalan(h);
    await expect(h.manager.selesai(owner('u1'), { nomor: 'REG-2026-0001' })).rejects.toMatchObject({
      status: 409,
    });
    // Warga menekan Kirim sendiri (takeover), lalu halaman sukses muncul.
    await h.manager.handleClient(s.sesiId, { type: 'ambil_alih' });
    h.ctl.amatan = SUKSES;
    // Halaman sukses tanpa tulis warga sejak aksi AI terakhir (dasbor/label/draf, review N3) = 409.
    await expect(h.manager.selesai(owner('u1'), { nomor: 'REG-2026-0001' })).rejects.toMatchObject({
      status: 409,
      message: 'belum ada pengiriman oleh warga',
    });
    h.ctl.tulisWarga = true;
    await expect(h.manager.selesai(owner('u1', OTHER))).rejects.toMatchObject({ status: 403 });
    const v = await h.manager.selesai(owner('u1'), { nomor: 'REG-2026-0001', status: 'Terkirim' });
    expect(v).toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    expect(h.manager.kurasJejak(owner('u1')).catatan).toContainEqual({
      jenis: 'bukti',
      bukti: { nomor: 'REG-2026-0001', status: 'Terkirim' },
    });
    // Idempoten; eksekusi lain = 409.
    expect(await h.manager.selesai(owner('u1'))).toMatchObject({ status: 'siaga' });
    await expect(h.manager.selesai(owner('u1'), undefined, 'x_lain')).rejects.toMatchObject({ status: 409 });
  });

  it('sesi berakhir = 404 (jangan diulang); peramban belum siap = 409 LAYANAN_TIDAK_TERSEDIA', async () => {
    const h = harness({ maxSessions: 1 });
    await sesiBerjalan(h);
    // u2 antre (peramban belum ada).
    await h.manager.create(input('u2'));
    await expect(h.manager.amati(owner('u2'))).rejects.toMatchObject({
      status: 409,
      kode: 'LAYANAN_TIDAK_TERSEDIA',
    });
    await h.manager.akhiri(owner('u1'));
    await expect(h.manager.amati(owner('u1'))).rejects.toMatchObject({ status: 404 });
  });

  it('nomor bukti yang tidak tertulis di halaman tidak dicatat', async () => {
    const h = harness();
    await sesiBerjalan(h);
    h.ctl.amatan = SUKSES;
    h.ctl.tulisWarga = true;
    await h.manager.selesai(owner('u1'), { nomor: 'KARANGAN-999', status: 'Terkirim' });
    expect(h.manager.kurasJejak(owner('u1')).catatan).toEqual([
      { jenis: 'bukti', bukti: { status: 'Terkirim' } },
    ]);
  });

  it('N7: sesi diakhiri saat amati berjalan = 409, bukan berhasil', async () => {
    const h = harness();
    await sesiBerjalan(h);
    h.ctl.tulisWarga = true;
    h.runs[0]!.generik!.amati = async () => {
      await h.manager.akhiri(owner('u1'));
      return SUKSES;
    };
    await expect(h.manager.selesai(owner('u1'))).rejects.toMatchObject({
      status: 409,
      message: 'sesi pendamping sudah berakhir',
    });
  });

  it('kode N1: sukses sesudah tulis warga dari worker (loop web sudah berhenti) = siaga berhasil', async () => {
    const h = harness();
    await sesiBerjalan(h);
    const hooks = h.runs[0]!.init.hooks;
    hooks.suksesWarga!(PENGAMATAN);
    expect(h.manager.status(owner('u1')).status).toBe('berjalan');
    hooks.suksesWarga!(SUKSES);
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    // /selesai sesudahnya idempoten; bukti dari Navigator boleh menyusul sekali (nomor tertulis di halaman).
    expect(await h.manager.selesai(owner('u1'))).toMatchObject({ status: 'siaga' });
    h.ctl.tulisWarga = true;
    h.ctl.amatan = SUKSES;
    expect(await h.manager.selesai(owner('u1'), { nomor: 'REG-2026-0001' })).toMatchObject({
      status: 'siaga',
      hasil: 'berhasil',
      bukti: { nomor: 'REG-2026-0001' },
    });
    expect(h.manager.kurasJejak(owner('u1')).catatan).toContainEqual({
      jenis: 'bukti',
      bukti: { nomor: 'REG-2026-0001' },
    });
  });

  it('L4: amati/aksi dengan executionId lain = 409; tanpa executionId atau sama = jalan', async () => {
    const h = harness();
    const { s } = await sesiBerjalan(h);
    await expect(h.manager.amati(owner('u1'), false, 'x_lain')).rejects.toMatchObject({ status: 409 });
    await expect(
      h.manager.aksi(owner('u1'), {
        ...owner('u1'),
        rencanaHash: H1,
        aksi: [{ jenis: 'serahkan', alasan: 'tidak_yakin' }],
        executionId: 'x_lain',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.runs[0]!.aksiMasuk).toEqual([]);
    await expect(h.manager.amati(owner('u1'), false, s.executionId)).resolves.toMatchObject({
      executionId: s.executionId,
    });
  });

  it('sesi adapter = 409', async () => {
    const h = harness();
    await h.manager.create({
      ...input('u-adapter'),
      adapterId: 'telunjuk-sakti-wonogiri',
      flowId: 'ajukan',
      params: { layanan_id: 1 },
    });
    await h.flush();
    await expect(h.manager.selesai(owner('u-adapter'))).rejects.toMatchObject({ status: 409 });
  });
});

describe('persetujuan berkas per putaran (M6) dan tujuan = origin halaman (F7)', () => {
  const ktp = { nama: 'KTP', namaBerkas: 'ktp.pdf', mime: 'application/pdf', dataBase64: 'eA==' };

  it('berkas putaran lalu tidak otomatis disetujui di putaran berikutnya', async () => {
    const h = harness();
    const { izin } = await sesiBerjalan(h);
    izin.minta({ rencanaHash: H1, kolom: [], berkas: ['KTP'] });
    await h.manager.isiBerkas(owner('u1'), ktp);
    await h.manager.isiData(owner('u1'), {}, H1);
    expect(izin.berkasDisetujui(H1, 'KTP')).toBe(true);

    // Putaran 2: warga membatalkan centang KTP (web tidak mengirim berkas lagi).
    izin.minta({ rencanaHash: H2, kolom: [], berkas: ['KTP'] });
    await h.manager.isiData(owner('u1'), {}, H2);
    expect(izin.berkasDisetujui(H2, 'KTP')).toBe(false);

    // Putaran 3: web menyebut berkas yang disetujui secara eksplisit (berkas sudah tersimpan).
    const H3 = '3'.repeat(64);
    izin.minta({ rencanaHash: H3, kolom: [], berkas: ['KTP'] });
    await h.manager.isiData(owner('u1'), {}, H3, ['KTP']);
    expect(izin.berkasDisetujui(H3, 'KTP')).toBe(true);
  });

  it('origin lembar = origin halaman yang diisi; kembali ke origin sesi setelah lembar ditutup', async () => {
    const h = harness();
    const { s, izin } = await sesiBerjalan(h);
    const v = h.viewer();
    await h.manager.attach(s.sesiId, v);
    izin.minta({
      rencanaHash: H1,
      kolom: [{ placeholder: PH, labelPortal: 'Nama', sidik: 's-nama' }],
      berkas: [],
      origin: 'https://layanan.contoh.go.id',
    });
    expect(h.manager.butuhData(owner('u1')).origin).toBe('https://layanan.contoh.go.id');
    expect(v.sent.find((m) => m.type === 'butuh_data')).toMatchObject({
      origin: 'https://layanan.contoh.go.id',
    });
    await h.manager.isiData(owner('u1'), { [PH]: 'Budi' }, H1);
    izin.minta({ rencanaHash: H2, kolom: [], berkas: [] });
    expect(h.manager.butuhData(owner('u1')).origin).toBe(RESMI);
  });
});
