/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons/payload tanpa tipe */
import { isRedirect } from '@sveltejs/kit';
import { HapusIngatanResponseSchema, IngatanResponseSchema } from '@urusin/contracts';
import { DemoProvider, wilayahUrusan } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE as hapusSemuaApi, GET as ingatanApi } from '../../routes/api/ingatan/+server';
import { DELETE as hapusButirApi } from '../../routes/api/ingatan/[id]/+server';
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
});
