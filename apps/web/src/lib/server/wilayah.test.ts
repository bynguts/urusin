/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons/payload tanpa tipe */
import { isRedirect } from '@sveltejs/kit';
import { SKEMA_FIXTURE, TetapkanWilayahResponseSchema } from '@urusin/contracts';
import { DemoProvider, wilayahUrusan } from '@urusin/harness';
import { kanalWilayah } from '@urusin/registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions as beranda } from '../../routes/+page.server';
import { GET as peristiwaApi } from '../../routes/api/peristiwa/[slug]/+server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { POST as setujui } from '../../routes/api/urusan/[id]/rencana/setujui/+server';
import { POST as tetapkan } from '../../routes/api/urusan/[id]/wilayah/+server';
import { GET as wilayahApi } from '../../routes/api/wilayah/+server';
import { load as muatPeristiwa } from '../../routes/peristiwa/[slug]/+page.server';
import { daftarKota, peristiwaView } from './referensi';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';

const ORIGIN = 'http://localhost:3000';
let rt: Runtime;
beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0 },
  });
  setRuntimeForTests(rt);
});
afterEach(() => setRuntimeForTests(undefined));

function kue() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: string) => void m.set(k, v),
    getAll: () => [...m].map(([name, value]) => ({ name, value })),
    delete: (k: string) => void m.delete(k),
    serialize: () => '',
  };
}
const ev = (request: Request, params: Record<string, string> = {}, locals: Record<string, unknown> = {}) =>
  ({
    request,
    params,
    url: new URL(request.url),
    locals: { sid: 'sid-uji', ...locals },
    cookies: kue(),
    getClientAddress: () => '127.0.0.1',
    setHeaders: () => {},
  }) as never;
const post = (body: unknown) =>
  new Request(`${ORIGIN}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
const form = (isi: Record<string, string>) =>
  new Request(`${ORIGIN}/?/mulai`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: new URLSearchParams(isi),
  });

async function selesai(id: string) {
  for (let i = 0; i < 300 && rt.running.has(id); i++) await new Promise((r) => setTimeout(r, 10));
}
const payloads = (id: string, type: string) =>
  rt.store
    .eventsOfType(id, type, 50)
    .reverse()
    .map((e) => e.payload as any);
/** Akun salinan juri: Data Diri sintetis dengan kab/kota KTP Wonogiri (3312). */
const akunJuri = () => rt.akun.buatDemo({ ip: '127.0.0.1', userAgent: null }).akun;

async function urusanBaru(kodeKabKota?: string, peristiwa = 'kelahiran') {
  const res = await buatUrusan(ev(post({ peristiwa, ...(kodeKabKota ? { kodeKabKota } : {}) })));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('wilayah dulu: usulan saat urusan dibuat', () => {
  it('kodeKabKota dari perangkat hanya usulan "pilihan"; wilayah KTP belum ditetapkan, belum ada rencana', async () => {
    const id = await urusanBaru('3578');
    const u = rt.store.getUrusanOrThrow(id);
    expect(u.kodeKabKota).toBeNull();
    expect(wilayahUrusan(rt.store, u)).toMatchObject({
      ktp: null,
      usulan: { ktp: { kodeKabKota: '3578' }, sumber: 'pilihan' },
    });
    expect(payloads(id, 'plan_card')).toEqual([]);
  });

  it('tanpa pilihan dan tanpa Data Diri: tidak ada usulan (bukan Wonogiri diam-diam)', async () => {
    const id = await urusanBaru();
    expect(payloads(id, 'wilayah')).toEqual([]);
    expect(wilayahUrusan(rt.store, rt.store.getUrusanOrThrow(id)).usulan).toBeNull();
  });

  it('pilihan eksplisit di halaman menang atas Data Diri; tanpa pilihan (atau sama) sumbernya Data Diri', async () => {
    const akun = akunJuri();
    const usulan = async (body: Record<string, string>) => {
      const res = await buatUrusan(ev(post({ peristiwa: 'kelahiran', ...body }), {}, { akun }));
      const { id } = (await res.json()) as { id: string };
      return payloads(id, 'wilayah').map((e) => [e.ktp.kodeKabKota, e.sumber]);
    };
    expect(await usulan({ kodeKabKota: '3578' })).toEqual([['3578', 'pilihan']]);
    expect(await usulan({})).toEqual([['3312', 'data_diri']]);
    expect(await usulan({ kodeKabKota: '3312' })).toEqual([['3312', 'data_diri']]);
  });

  it('pesan pertama menyebut kab/kota lain: usulan perangkat/Data Diri tidak diterbitkan (W4)', async () => {
    const akun = akunJuri();
    const usulan = async (body: Record<string, string>) => {
      const res = await buatUrusan(ev(post({ peristiwa: 'kelahiran', ...body }), {}, { akun }));
      const { id } = (await res.json()) as { id: string };
      await selesai(id);
      return payloads(id, 'wilayah')
        .filter((e) => e.status === 'usulan' && e.sumber !== 'warga')
        .map((e) => e.ktp.kodeKabKota);
    };
    expect(
      await usulan({ kodeKabKota: '3311', pesan: 'KTP saya Kabupaten Wonogiri, mau urus akta' }),
    ).toEqual(['3312']);
    expect(await usulan({ pesan: 'KTP saya Kota Surabaya, mau urus akta kelahiran' })).toEqual([]);
    expect(await usulan({ pesan: 'Saya mau urus akta kelahiran anak' })).toEqual(['3312']);
  });

  it('halaman peristiwa: tanpa ?kodeKabKota, kab/kota Data Diri diisikan sebagai usulan', async () => {
    const akun = akunJuri();
    const d = (await muatPeristiwa(
      ev(new Request(`${ORIGIN}/peristiwa/kelahiran`), { slug: 'kelahiran' }, { akun }),
    )) as any;
    expect(d).toMatchObject({ kodeDipilih: '3312', dariDataDiri: true });
    const tamu = (await muatPeristiwa(
      ev(new Request(`${ORIGIN}/peristiwa/kelahiran`), { slug: 'kelahiran' }),
    )) as any;
    expect(tamu).toMatchObject({ kodeDipilih: null, dariDataDiri: false });
    expect(JSON.stringify(tamu.rencana)).not.toMatch(/wonogiri/i);
  });
});

describe('POST /api/urusan/[id]/wilayah (tombol "Ya, betul")', () => {
  it('Surabaya: wilayah ditetapkan dengan audit, rencana nasional + kanal Surabaya, tanpa Wonogiri, tier dipandu', async () => {
    const id = await urusanBaru('3578');
    const res = await tetapkan(ev(post({ kodeKabKota: '3578' }), { id }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(TetapkanWilayahResponseSchema.parse(j)).toMatchObject({
      state: 'RENCANA_DIUSULKAN',
      rencana: true,
    });
    expect(rt.store.getUrusanOrThrow(id).kodeKabKota).toBe('3578');
    expect(payloads(id, 'wilayah').at(-1)).toMatchObject({ status: 'ditetapkan', sumber: 'warga' });
    const [kartu] = payloads(id, 'plan_card');
    expect(JSON.stringify(kartu)).not.toMatch(/wonogiri/i);
    expect(kartu).toMatchObject({ tier: 'dipandu', wilayah: { ktp: { kodeKabKota: '3578' } } });
    expect(kartu.langkah.flatMap((l: any) => l.sumber.map((s: any) => s.url))).toContain(
      kanalWilayah('3578').url,
    );
    expect(kartu.langkah.some((l: any) => l.jenis === 'online-adapter')).toBe(false);
    expect(rt.store.verifyChain(id).ok).toBe(true);
  });

  it('kartu basi tidak menimpa: KTP sama → 200 tanpa perubahan; KTP lain → 409 WILAYAH_SUDAH_DITETAPKAN', async () => {
    const id = await urusanBaru('3312');
    expect((await tetapkan(ev(post({ kodeKabKota: '3310' }), { id }))).status).toBe(200); // Klaten di obrolan
    const sebelum = rt.store.getUrusanOrThrow(id);
    const jumlah = payloads(id, 'wilayah').length;
    const basi = await tetapkan(ev(post({ kodeKabKota: '3312' }), { id }));
    expect(basi.status).toBe(409);
    expect((await basi.json()).kode).toBe('WILAYAH_SUDAH_DITETAPKAN');
    const sama = await tetapkan(ev(post({ kodeKabKota: '3310' }), { id }));
    expect(await sama.json()).toEqual({ state: sebelum.state, version: sebelum.version, rencana: false });
    expect(rt.store.getUrusanOrThrow(id)).toMatchObject({ kodeKabKota: '3310', version: sebelum.version });
    expect(payloads(id, 'wilayah')).toHaveLength(jumlah);
  });

  it('urusan tanpa rencana yang sudah bercakap: "Ya, betul" melanjutkan giliran agen, tidak buntu', async () => {
    const res = await buatUrusan(
      ev(post({ kodeKabKota: '3578', pesan: 'KTP saya rusak kena air, bikin baru gimana?' })),
    );
    const { id } = (await res.json()) as { id: string };
    await selesai(id);
    const r = await tetapkan(ev(post({ kodeKabKota: '3578' }), { id }));
    const j = await r.json();
    expect(j).toMatchObject({ rencana: false, turnId: expect.any(String) });
    await selesai(id);
    const ditetapkan = rt.store
      .eventsOfType(id, 'wilayah', 20)
      .find((e) => (e.payload as any).status === 'ditetapkan')!.seq;
    const sesudah = rt.store.eventsAfter(id, ditetapkan).map((e) => e.type);
    expect(sesudah.some((t) => ['assistant_text', 'grounded_answer', 'handoff'].includes(t))).toBe(true);
  });

  it('kode tidak dikenal 422; format salah 422; urusan tidak ada 404', async () => {
    const id = await urusanBaru();
    const tak = await tetapkan(ev(post({ kodeKabKota: '9999' }), { id }));
    expect(tak.status).toBe(422);
    expect((await tak.json()).kode).toBe('WILAYAH_TIDAK_DIKENAL');
    expect((await tetapkan(ev(post({ kodeKabKota: '12' }), { id }))).status).toBe(422);
    expect((await tetapkan(ev(post({ kodeKabKota: '3578' }), { id: `u_${'0'.repeat(32)}` }))).status).toBe(
      404,
    );
    expect(payloads(id, 'wilayah')).toEqual([]);
  });

  it('urusan bebas (jenis belum diketahui): wilayah tercatat, rencana belum diusulkan', async () => {
    const res = await buatUrusan(ev(post({})));
    const { id } = (await res.json()) as { id: string };
    const j = await (await tetapkan(ev(post({ kodeKabKota: '3216' }), { id }))).json();
    expect(j).toMatchObject({ state: 'MEMAHAMI', rencana: false });
  });
});

describe('alur juri Wonogiri (Data Diri 3312): satu konfirmasi tambahan, lalu Browser Pendamping layanan 23', () => {
  it('peristiwa Kelahiran → tanya wilayah → "Ya, betul" → rencana semi → Setujui → pendamping', async () => {
    const akun = akunJuri();
    const r = await Promise.resolve()
      .then(() =>
        beranda.mulai(
          ev(
            form({
              peristiwa: 'kelahiran',
              kodeKabKota: '3312',
              pesan: 'Saya ingin mengurus kelahiran. Apa saja yang perlu saya siapkan?',
            }),
            {},
            { akun },
          ),
        ),
      )
      .catch((e: unknown) => e);
    expect(isRedirect(r)).toBe(true);
    const id = (r as { location: string }).location.split('/').at(-1)!;
    await selesai(id);
    // Turn pertama: menanyakan wilayah KTP, belum ada rencana.
    const teks = payloads(id, 'assistant_text')
      .map((e) => e.delta)
      .join('');
    expect(teks).toContain('KTP Anda terdaftar di Kabupaten Wonogiri, betul?');
    expect(payloads(id, 'plan_card')).toEqual([]);

    // Satu-satunya klik tambahan: "Ya, betul".
    const v = rt.store.getUrusanOrThrow(id).version;
    // Pemilik urusan = akun juri yang sama (keamanan-pemilik): semua aksi dari sesi akun itu.
    const j = await (
      await tetapkan(ev(post({ kodeKabKota: '3312', expectedVersion: v }), { id }, { akun }))
    ).json();
    expect(j).toMatchObject({ state: 'RENCANA_DIUSULKAN', rencana: true });
    const [kartu] = payloads(id, 'plan_card');
    expect(kartu).toMatchObject({ ringkasan: 'Kelahiran · Kab. Wonogiri', tier: 'semi' });
    expect(kartu.langkah.some((l: any) => l.jenis === 'online-adapter')).toBe(true);

    // Setujui rencana → permintaan Browser Pendamping (layanan 23 Telunjuk Sakti) seperti sebelumnya.
    const s = await (
      await setujui(ev(post({ expectedVersion: rt.store.getUrusanOrThrow(id).version }), { id }, { akun }))
    ).json();
    expect(s).toMatchObject({ pendamping: true });
    const [req] = payloads(id, 'execution_request');
    expect(req).toMatchObject({
      adapterId: 'telunjuk-sakti-wonogiri',
      origin: 'https://telunjuksakti.wonogirikab.go.id',
    });
    expect(JSON.stringify(req.params)).toContain('23');
    // Setelah disetujui, wilayah terkunci.
    expect((await tetapkan(ev(post({ kodeKabKota: '3578' }), { id }, { akun }))).status).toBe(409);
  });
});

describe('peristiwaView dan daftar wilayah', () => {
  it.each([
    ['3578', 'Kota Surabaya'],
    ['3216', 'Kabupaten Bekasi'],
    ['1101', 'Kabupaten Aceh Selatan'],
  ])('%s (%s): tanpa langkah/tautan Wonogiri, kanal resminya sendiri, tier dipandu', (kode, nama) => {
    for (const slug of ['kelahiran', 'kematian', 'perkawinan', 'pindah']) {
      const v = peristiwaView(slug, kode)!;
      expect(JSON.stringify(v), slug).not.toMatch(/wonogiri/i);
      expect(v.tier).toBe('dipandu');
      expect(v.kota).toMatchObject({ kodeKabKota: kode, nama });
      expect(v.langkah.flatMap((l) => l.sumber.map((s) => s.url))).toContain(kanalWilayah(kode).url);
    }
  });

  it('3312 tetap memakai bundel Wonogiri (semi); tanpa kode: nasional tanpa Wonogiri', () => {
    expect(peristiwaView('kelahiran', '3312')).toMatchObject({ tier: 'semi', kodeKabKota: '3312' });
    const umum = peristiwaView('kelahiran', null)!;
    expect(umum.kota).toBeNull();
    expect(JSON.stringify(umum)).not.toMatch(/wonogiri/i);
  });

  it('GET /api/peristiwa?kodeKabKota=3578 lolos skema dan tanpa Wonogiri', async () => {
    const j = await (
      await peristiwaApi(ev(new Request(`${ORIGIN}/p?kodeKabKota=3578`), { slug: 'kelahiran' }))
    ).json();
    expect(SKEMA_FIXTURE.peristiwa.safeParse(j).success).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/wonogiri/i);
  });

  it('pemilih wilayah memuat 514 kab/kota bernama resmi; situs hanya milik kab/kota itu sendiri', async () => {
    const d = daftarKota();
    expect(d).toHaveLength(514);
    expect(new Set(d.map((k) => k.kodeKabKota)).size).toBe(514);
    expect(d.every((k) => /^(Kabupaten|Kota) /.test(k.nama))).toBe(true);
    expect(
      d
        .filter((k) => /Bekasi$/.test(k.nama))
        .map((k) => k.nama)
        .sort(),
    ).toEqual(['Kabupaten Bekasi', 'Kota Bekasi']);
    const wonogiri = d.find((k) => k.kodeKabKota === '3312')!.situs!.url;
    expect(d.filter((k) => k.situs?.url === wonogiri).map((k) => k.kodeKabKota)).toEqual(['3312']);
    const j = await (await wilayahApi(ev(new Request(`${ORIGIN}/w`)))).json();
    expect(SKEMA_FIXTURE.wilayah.safeParse(j).success).toBe(true);
    expect(j.kota).toHaveLength(514);
    expect(j.kota.filter((k: any) => k.tier === 'semi').map((k: any) => k.kodeKabKota)).toContain('3312');
  });
});
