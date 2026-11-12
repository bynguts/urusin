import type { Akun } from '@urusin/akun';
import { DemoProvider } from '@urusin/harness';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kodeWilayahTersimpan, mulaiUrusanDariForm, WILAYAH_COOKIE } from './mulai-urusan';
import { RateLimiter } from './limiter';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { PESAN_PII } from './http';
import { SID_COOKIE } from './sesi';

let rt: Runtime;
/** Wajib akun: formulir mulai urusan dipakai warga yang masuk (akun email + sandi, tanpa Data Diri). */
let akun: Akun;
beforeEach(async () => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0 },
  });
  setRuntimeForTests(rt);
  akun = (await rt.akun.daftar({ email: 'warga@example.com', sandi: 'kuda-lari-cepat-9' }, KTX)).akun;
});
afterEach(() => setRuntimeForTests(undefined));

const SID = 'a'.repeat(32);
const KTX = { ip: '10.0.0.9', userAgent: null };

function eventForm(
  fields: Record<string, string>,
  ip: string,
  kue: Record<string, string> = {},
  locals: App.Locals = { akun },
) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const jar = new Map<string, string>([[SID_COOKIE, SID], ...Object.entries(kue)]);
  return {
    request: new Request('http://localhost:3000/beranda?/mulai', { method: 'POST', body }),
    url: new URL('http://localhost:3000/beranda?/mulai'),
    params: {},
    locals,
    cookies: {
      get: (k: string) => jar.get(k),
      set: (k: string, v: string) => void jar.set(k, v),
      delete: (k: string) => void jar.delete(k),
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      serialize: () => '',
    },
    getClientAddress: () => ip,
  } as never;
}

async function mulai(
  fields: Record<string, string>,
  ip: string,
  kue: Record<string, string> = {},
): Promise<string> {
  try {
    await mulaiUrusanDariForm(eventForm(fields, ip, kue));
  } catch (e) {
    if (isRedirect(e)) return e.location.split('/').pop()!;
    throw e;
  }
  throw new Error('tidak redirect');
}

/** Formulir "mulai urusan" (Beranda / Rencana peristiwa) harus mengikat pemilik seperti POST /api/urusan. */
describe('mulaiUrusanDariForm: pemilik urusan', () => {
  it('peristiwa tanpa pesan: urusan terikat ke akun, endpoint Pendamping mengenali pemiliknya', async () => {
    const id = await mulai({ peristiwa: 'kelahiran', kodeKabKota: '3312' }, '10.0.0.1');
    expect(rt.akun.urusanMilik(akun.id)).toEqual([id]);
    expect(rt.akun.pemilikVaultUrusan(id, { akun, sid: 'b'.repeat(32) })).toBe(akun.id);
    expect(rt.akun.pemilikVaultUrusan(id, { sid: SID })).toBeUndefined();
  });

  it('dengan pesan: tidak ada baris tamu, urusan terikat ke akun', async () => {
    const id = await mulai({ pesan: 'Anak saya lahir minggu lalu', kodeKabKota: '3312' }, '10.0.0.2');
    expect(rt.akun.tamuDariSid(SID)).toBeUndefined();
    expect(rt.akun.urusanMilik(akun.id)).toEqual([id]);
  });

  it('tanpa sesi akun: 303 ke /daftar?next=<rencana peristiwa>, tidak ada urusan atau tamu dibuat', async () => {
    let lokasi = '';
    try {
      await mulaiUrusanDariForm(eventForm({ peristiwa: 'pindah', kodeKabKota: '3404' }, '10.0.0.5', {}, {}));
    } catch (e) {
      if (isRedirect(e)) lokasi = e.location;
    }
    expect(lokasi).toBe(`/daftar?next=${encodeURIComponent('/peristiwa/pindah?kodeKabKota=3404')}`);
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM urusan').get()).toEqual({ n: 0 });
    expect(rt.akun.tamuDariSid(SID)).toBeUndefined();
  });
});

/** Jalur tanpa JS harus menolak NIK sama seperti POST /api/urusan (422, pesan warga yang sama). */
describe('mulaiUrusanDariForm: PII', () => {
  it('pesan berisi NIK → 422 dengan pesan warga yang sama dengan API; tidak ada urusan dibuat, pesan tidak digemakan', async () => {
    const nik = ['3312', '0101', '0190', '0003'].join('');
    const r = (await mulaiUrusanDariForm(
      eventForm({ pesan: `NIK saya ${nik}, mau urus akta`, kodeKabKota: '3312' }, '10.0.0.3'),
    )) as { status: number; data: { pesanWarga: string; pesan: string; kode?: string } };
    expect(r.status).toBe(422);
    expect(r.data.pesanWarga).toBe(PESAN_PII);
    expect(r.data.kode).toBe('PII_IN_PAYLOAD');
    expect(r.data.pesan).not.toContain(nik);
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM urusan').get()).toEqual({ n: 0 });
  });
});

describe('mulaiUrusanDariForm: batas laju', () => {
  it('429 menyebut waktu tunggu nyata (±N menit) dan pesan warga tetap utuh untuk dikirim ulang', async () => {
    rt.limits.buat.akun = new RateLimiter(1, 3_600_000);
    await mulai({ peristiwa: 'kelahiran' }, '10.0.0.4');
    const r = (await mulaiUrusanDariForm(eventForm({ pesan: 'mau urus akta' }, '10.0.0.4'))) as {
      status: number;
      data: { pesanWarga: string; pesan: string; kode?: string };
    };
    expect(r.status).toBe(429);
    expect(r.data.kode).toBe('RATE_LIMITED');
    expect(r.data.pesanWarga).toMatch(
      /^Terlalu banyak urusan baru dalam waktu singkat\. Coba lagi dalam ±\d+ menit\.$/,
    );
    expect(r.data.pesan).toBe('mau urus akta');
  });
});

/**
 * QA prod (tamu di HP): wilayah yang disimpan di Pengaturan > Wilayah layanan dipakai saat mulai dari landing
 * (`/?/mulai`, csr=false, formulir tanpa kodeKabKota). Cookie perangkat = usulan `pilihan`, tetap dikonfirmasi warga.
 */
describe('mulaiUrusanDariForm: wilayah tersimpan di perangkat (cookie)', () => {
  const usulan = (id: string) =>
    rt.store
      .eventsOfType(id, 'wilayah', 20)
      .map((e) => e.payload as { status: string; sumber: string; ktp: { kodeKabKota: string } });
  const SLEMAN = { [WILAYAH_COOKIE]: '3404' };

  it('kartu peristiwa landing tanpa kode: cookie Sleman → usulan wilayah Sleman (sumber pilihan)', async () => {
    const id = await mulai({ peristiwa: 'kematian' }, '10.0.0.11', SLEMAN);
    expect(usulan(id)).toEqual([
      expect.objectContaining({
        status: 'usulan',
        sumber: 'pilihan',
        ktp: expect.objectContaining({ kodeKabKota: '3404' }),
      }),
    ]);
  });

  it('pesan tanpa menyebut kota + cookie → usulan dari cookie', async () => {
    const id = await mulai({ pesan: 'Saya mau pindah domisili' }, '10.0.0.12', SLEMAN);
    expect(usulan(id).map((u) => u.ktp.kodeKabKota)).toEqual(['3404']);
  });

  it('kode di formulir menang atas cookie', async () => {
    const id = await mulai({ peristiwa: 'kelahiran', kodeKabKota: '3312' }, '10.0.0.13', SLEMAN);
    expect(usulan(id).map((u) => u.ktp.kodeKabKota)).toEqual(['3312']);
  });

  it('pesan menyebut kota lain: cookie tidak diusulkan (kartu tidak bertentangan dengan pesan)', async () => {
    const id = await mulai({ pesan: 'KTP saya Kota Medan, mau urus akta kelahiran' }, '10.0.0.14', SLEMAN);
    expect(usulan(id).some((u) => u.ktp.kodeKabKota === '3404')).toBe(false);
  });

  it('cookie tidak valid (format salah atau tidak ada di registry) diabaikan', async () => {
    expect(kodeWilayahTersimpan({ get: () => '34x4' })).toBeUndefined();
    expect(kodeWilayahTersimpan({ get: () => undefined })).toBeUndefined();
    expect(kodeWilayahTersimpan({ get: () => '3404' })).toBe('3404');
    const salah = await mulai({ peristiwa: 'kelahiran' }, '10.0.0.15', { [WILAYAH_COOKIE]: '34;x' });
    expect(usulan(salah)).toEqual([]);
    const takAda = await mulai({ peristiwa: 'kelahiran' }, '10.0.0.16', { [WILAYAH_COOKIE]: '9999' });
    expect(usulan(takAda)).toEqual([]);
  });

  it('tanpa cookie dan tanpa kode: tidak ada usulan (agen bertanya)', async () => {
    const id = await mulai({ peristiwa: 'kelahiran' }, '10.0.0.17');
    expect(usulan(id)).toEqual([]);
  });
});
