/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons/payload tanpa tipe */
import { isRedirect } from '@sveltejs/kit';
import {
  HapusIngatanResponseSchema,
  IngatanResponseSchema,
  SetujuiIngatanResponseSchema,
} from '@urusin/contracts';
import { DemoProvider, wilayahUrusan } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE as hapusSemuaApi, GET as ingatanApi } from '../../routes/api/ingatan/+server';
import { DELETE as hapusButirApi, POST as setujuiApi } from '../../routes/api/ingatan/[id]/+server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { POST as tetapkan } from '../../routes/api/urusan/[id]/wilayah/+server';
import { actions as pengaturanPage, load as pengaturanLoad } from '../../routes/pengaturan/+page.server';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';

/** Ingatan warga (ADR 0031) di web: kartu → ingatan → usulan urusan kedua → API/Pengaturan → hapus. */
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
const ev = (request: Request, params: Record<string, string> = {}, sid = 'sid-uji') =>
  ({
    request,
    params,
    url: new URL(request.url),
    locals: { sid },
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
const get = () =>
  new Request(`${ORIGIN}/api/ingatan`, { headers: { 'sec-fetch-site': 'same-origin', origin: ORIGIN } });
const del = () => new Request(`${ORIGIN}/api/ingatan`, { method: 'DELETE', headers: { origin: ORIGIN } });
const form = (isi: Record<string, string>) =>
  new Request(`${ORIGIN}/pengaturan`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: new URLSearchParams(isi),
  });

async function urusanBaru(sid = 'sid-uji', peristiwa = 'kelahiran') {
  const res = await buatUrusan(ev(post({ peristiwa }), {}, sid));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
const daftar = async (sid = 'sid-uji') =>
  IngatanResponseSchema.parse(await (await ingatanApi(ev(get(), {}, sid))).json()).butir;
async function redirectDari(p: unknown) {
  try {
    await p;
  } catch (e) {
    if (isRedirect(e)) return e.location;
    throw e;
  }
  return null;
}

describe('ingatan warga lewat web', () => {
  it('kartu "Ya, betul" → ingatan KTP + kartu chat; urusan kedua diusulkan dari ingatan (tetap usulan)', async () => {
    rt.akun.pastikanTamu('sid-uji', { ip: '127.0.0.1', userAgent: null });
    const id1 = await urusanBaru();
    expect((await tetapkan(ev(post({ kodeKabKota: '3312' }), { id: id1 }))).status).toBe(200);
    const kartu = rt.store.eventsOfType(id1, 'ingatan', 10).map((e) => e.payload as any);
    expect(kartu).toEqual([
      expect.objectContaining({
        aksi: 'simpan',
        butir: expect.objectContaining({ label: 'Wilayah KTP: Kabupaten Wonogiri' }),
      }),
    ]);
    expect((await daftar()).map((b) => b.label)).toEqual(['Wilayah KTP: Kabupaten Wonogiri']);

    const id2 = await urusanBaru('sid-uji', 'perkawinan');
    const w = wilayahUrusan(rt.store, rt.store.getUrusanOrThrow(id2));
    expect(w.ktp).toBeNull(); // tidak ditetapkan diam-diam
    expect(w.usulan).toMatchObject({ ktp: { kodeKabKota: '3312' }, sumber: 'ingatan' });

    // sesi lain tidak melihat dan tidak bisa menghapus ingatan ini
    expect(await daftar('sid-lain')).toEqual([]);
    const butir = (await daftar())[0]!;
    expect(
      (
        await hapusButirApi(
          ev(new Request(`${ORIGIN}/x`, { method: 'DELETE' }), { id: butir.id }, 'sid-lain'),
        )
      ).status,
    ).toBe(404);

    // "Batalkan" di kartu chat
    const r = await hapusButirApi(ev(new Request(`${ORIGIN}/x`, { method: 'DELETE' }), { id: butir.id }));
    expect(HapusIngatanResponseSchema.parse(await r.json())).toEqual({ dihapus: 1 });
    expect(await daftar()).toEqual([]);
    const id3 = await urusanBaru();
    expect(wilayahUrusan(rt.store, rt.store.getUrusanOrThrow(id3)).usulan).toBeNull();
  });

  it('tanpa tamu/akun (belum ada vault): tidak ada ingatan dan tidak ada kartu', async () => {
    const id = await urusanBaru('sid-baru');
    expect((await tetapkan(ev(post({ kodeKabKota: '3312' }), { id }, 'sid-baru'))).status).toBe(200);
    expect(rt.store.eventsOfType(id, 'ingatan', 10)).toEqual([]);
    expect(await daftar('sid-baru')).toEqual([]);
  });

  it('Pengaturan: daftar butir, hapus per butir, dan "Hapus semua ingatan"; GET butuh same-origin', async () => {
    const tamu = rt.akun.pastikanTamu('sid-uji', { ip: '127.0.0.1', userAgent: null });
    for (const kode of ['3312', '3374']) {
      const id = await urusanBaru();
      await tetapkan(ev(post({ kodeKabKota: kode }), { id }));
    }
    rt.akun.vault.setIngatan(tamu, {
      ...(rt.akun.vault.getIngatan(tamu)!.data as object),
      butir: [
        ...(rt.akun.vault.getIngatan(tamu)!.data as any).butir,
        { id: 'ing_00000000000000aa', jenis: 'lansia', nilai: 'ya', at: '2026-11-11T00:00:00.000Z' },
      ],
    });
    const muat = async () =>
      ((await pengaturanLoad(ev(new Request(`${ORIGIN}/pengaturan`)) as never)) as any).ingatan;
    expect((await muat()).map((b: any) => b.label)).toEqual(['Wilayah KTP: Kota Semarang', 'Warga lansia']);
    expect(
      await redirectDari(pengaturanPage.hapusIngatan(ev(form({ id: 'ing_00000000000000aa' })) as never)),
    ).toBe('/pengaturan#ingatan');
    expect((await muat()).map((b: any) => b.jenis)).toEqual(['ktp']);
    await redirectDari(pengaturanPage.hapusSemuaIngatan(ev(form({})) as never));
    expect(await muat()).toEqual([]);
    expect(rt.akun.vault.getIngatan(tamu)).toBeNull();
    expect(HapusIngatanResponseSchema.parse(await (await hapusSemuaApi(ev(del()))).json())).toEqual({
      dihapus: 0,
    });
    expect((await ingatanApi(ev(new Request(`${ORIGIN}/api/ingatan`)))).status).toBe(403);
  });

  const AT = '2026-11-11T00:00:00.000Z';
  const reqId = (method: string) => new Request(`${ORIGIN}/x`, { method, headers: { origin: ORIGIN } });

  it('kartu persetujuan: usulan aksesibilitas muncul sebagai pertanyaan; "Ya, ingat" → butir; "Tidak" → hilang', async () => {
    const tamu = rt.akun.pastikanTamu('sid-uji', { ip: '127.0.0.1', userAgent: null });
    rt.akun.vault.setIngatan(tamu, {
      versi: 1,
      butir: [],
      usulan: [
        { id: 'ing_00000000000000a1', jenis: 'aksesibilitas', nilai: 'tuli', at: AT },
        { id: 'ing_00000000000000a2', jenis: 'aksesibilitas', nilai: 'pakai kursi roda', at: AT },
      ],
    });
    const isi = async () => IngatanResponseSchema.parse(await (await ingatanApi(ev(get()))).json());
    expect((await isi()).usulan?.map((b) => b.label)).toEqual([
      'Ingat bahwa Anda tuli?',
      'Ingat bahwa Anda pakai kursi roda?',
    ]);
    expect((await isi()).butir).toEqual([]);
    // sesi lain tidak bisa menyetujui
    expect((await setujuiApi(ev(reqId('POST'), { id: 'ing_00000000000000a1' }, 'sid-lain'))).status).toBe(
      404,
    );
    const ya = await setujuiApi(ev(reqId('POST'), { id: 'ing_00000000000000a1' }));
    expect(SetujuiIngatanResponseSchema.parse(await ya.json())).toMatchObject({
      disetujui: 1,
      butir: { id: 'ing_00000000000000a1', label: 'Kebutuhan aksesibilitas: tuli' },
    });
    expect((await setujuiApi(ev(reqId('POST'), { id: 'ing_00000000000000a1' }))).status).toBe(404);
    // "Tidak": usulan kedua dibuang tanpa pernah diingat
    expect((await hapusButirApi(ev(reqId('DELETE'), { id: 'ing_00000000000000a2' }))).status).toBe(200);
    const akhir = await isi();
    expect(akhir.butir.map((b) => b.label)).toEqual(['Kebutuhan aksesibilitas: tuli']);
    expect(akhir.usulan).toBeUndefined();
  });

  it('isi rusak: GET 503 (bukan kosong), Pengaturan memberi tahu, "Hapus semua" tetap bisa', async () => {
    const tamu = rt.akun.pastikanTamu('sid-uji', { ip: '127.0.0.1', userAgent: null });
    rt.akun.vault.setIngatan(tamu, { versi: 1, butir: [] });
    rt.akun.vault.setIngatan(tamu, { versi: 9 }); // bentuk asing (tidak lolos skema)
    const r = await ingatanApi(ev(get()));
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).kode).toBe('INGATAN_TIDAK_TERBACA');
    const muat = async () => (await pengaturanLoad(ev(new Request(`${ORIGIN}/pengaturan`)) as never)) as any;
    expect(await muat()).toMatchObject({ ingatan: [], ingatanRusak: true });
    // penulisan lewat kartu tidak menimpa isi yang rusak
    expect((await hapusButirApi(ev(reqId('DELETE'), { id: 'ing_00000000000000a1' }))).status).not.toBe(200);
    expect(rt.akun.vault.getIngatan(tamu)!.data).toEqual({ versi: 9 });
    await redirectDari(pengaturanPage.hapusSemuaIngatan(ev(form({})) as never));
    expect(rt.akun.vault.getIngatan(tamu)).toBeNull();
    expect(await muat()).toMatchObject({ ingatan: [], ingatanRusak: false });
  });

  it('Pengaturan: titipan tamu sesudah masuk → "Ada N hal …" dengan Bawa ke akun / Buang', async () => {
    const pemilik = rt.akun.pastikanTamu('sid-uji', { ip: '127.0.0.1', userAgent: null });
    const awal = {
      versi: 1,
      butir: [{ id: 'ing_00000000000000b1', jenis: 'kanal', nilai: 'datang', at: AT }],
      dariTamu: [
        { id: 'ing_00000000000000b2', jenis: 'kanal', nilai: 'online', at: AT },
        { id: 'ing_00000000000000b3', jenis: 'lansia', nilai: 'ya', at: AT },
      ],
    };
    rt.akun.vault.setIngatan(pemilik, awal);
    const muat = async () => (await pengaturanLoad(ev(new Request(`${ORIGIN}/pengaturan`)) as never)) as any;
    expect(await muat()).toMatchObject({ ingatanTamu: 2 });
    expect((await muat()).ingatan.map((b: any) => b.label)).toEqual(['Lebih suka datang langsung ke kantor']);
    expect(await redirectDari(pengaturanPage.bawaIngatanTamu(ev(form({})) as never))).toBe(
      '/pengaturan#ingatan',
    );
    const sesudah = await muat();
    expect(sesudah.ingatanTamu).toBe(0);
    expect(sesudah.ingatan.map((b: any) => b.jenis)).toEqual(['lansia', 'kanal']);
    expect(sesudah.ingatan.find((b: any) => b.jenis === 'kanal').label).toBe(
      'Lebih suka datang langsung ke kantor',
    ); // akun menang

    rt.akun.vault.setIngatan(pemilik, awal);
    await redirectDari(pengaturanPage.buangIngatanTamu(ev(form({})) as never));
    expect(await muat()).toMatchObject({ ingatanTamu: 0 });
    expect((await muat()).ingatan.map((b: any) => b.jenis)).toEqual(['kanal']);
  });
});
