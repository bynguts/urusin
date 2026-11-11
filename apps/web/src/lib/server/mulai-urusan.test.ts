import { DemoProvider } from '@urusin/harness';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mulaiUrusanDariForm } from './mulai-urusan';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { PESAN_PII } from './http';
import { SID_COOKIE } from './sesi';

let rt: Runtime;
beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0 },
  });
  setRuntimeForTests(rt);
});
afterEach(() => setRuntimeForTests(undefined));

const SID = 'a'.repeat(32);
const KTX = { ip: '10.0.0.9', userAgent: null };

function eventForm(fields: Record<string, string>, ip: string) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const jar = new Map<string, string>([[SID_COOKIE, SID]]);
  return {
    request: new Request('http://localhost:3000/beranda?/mulai', { method: 'POST', body }),
    url: new URL('http://localhost:3000/beranda?/mulai'),
    params: {},
    locals: {} as App.Locals,
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

async function mulai(fields: Record<string, string>, ip: string): Promise<string> {
  try {
    await mulaiUrusanDariForm(eventForm(fields, ip));
  } catch (e) {
    if (isRedirect(e)) return e.location.split('/').pop()!;
    throw e;
  }
  throw new Error('tidak redirect');
}

/** Formulir "mulai urusan" (Beranda / Rencana peristiwa) harus mengikat pemilik seperti POST /api/urusan. */
describe('mulaiUrusanDariForm: pemilik urusan', () => {
  it('peristiwa tanpa pesan: urusan terikat ke sid, endpoint Pendamping mengenali pemiliknya', async () => {
    rt.akun.pastikanTamu(SID, KTX);
    const id = await mulai({ peristiwa: 'kelahiran', kodeKabKota: '3312' }, '10.0.0.1');
    expect(rt.akun.pemilikVaultUrusan(id, { sid: SID })).toBe(rt.akun.tamuDariSid(SID));
    expect(rt.akun.pemilikVaultUrusan(id, { sid: 'b'.repeat(32) })).toBeUndefined();
  });

  it('dengan pesan: tamu dibuat (seperti /turn) dan urusan terikat padanya', async () => {
    const id = await mulai({ pesan: 'Anak saya lahir minggu lalu', kodeKabKota: '3312' }, '10.0.0.2');
    const tamu = rt.akun.tamuDariSid(SID);
    expect(tamu).toBeDefined();
    expect(rt.akun.pemilikVaultUrusan(id, { sid: SID })).toBe(tamu);
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
