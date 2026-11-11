import type { EventOf, EventPayload, UrusinEvent } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { DemoProvider } from './demo.js';
import { setujuiRencana } from './rencana.js';
import { makeEnv } from './testing.js';
import { usulkanWilayah } from './wilayah.js';

const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);
const publisher = (env: ReturnType<typeof makeEnv>, id: string) => (e: EventPayload) => {
  const { type, ...isi } = e;
  env.store.appendEvent(id, type, isi);
};

describe('alur demo juri Wonogiri tetap utuh (akta kelahiran, Telunjuk Sakti layanan 23)', () => {
  it('usulan Data Diri Wonogiri → satu konfirmasi → rencana semi → Setujui → Browser Pendamping layanan 23', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    usulkanWilayah(u.id, '3312', 'data_diri', publisher(env, u.id));
    const t1 = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Saya ingin mengurus kelahiran. Apa saja yang perlu saya siapkan?',
    });
    // Satu-satunya tambahan: kartu konfirmasi wilayah (usulan Data Diri), tanpa pertanyaan ganda di teks.
    expect(of(t1.events, 'assistant_text')).toHaveLength(0);
    expect(of(t1.events, 'plan_card')).toHaveLength(0);

    const t2 = await runTurn(env.deps, { urusanId: u.id, userText: 'Ya' });
    const kartu = of(t2.events, 'plan_card')[0]!;
    expect(kartu).toMatchObject({ tier: 'semi', ringkasan: 'Kelahiran · Kab. Wonogiri' });
    expect(kartu.langkah[0]).toMatchObject({ id: 'ajukan', jenis: 'online-adapter' });
    expect(kartu.langkah[0]!.sumber[0]!.url).toMatch(/disdukcapil\.wonogirikab\.go\.id/);

    const events: EventPayload[] = [];
    const r = setujuiRencana(env.store, u.id, (e) => void events.push(e));
    expect(r.urusan.state).toBe('MENUNGGU_KONFIRMASI');
    expect(events.find((e) => e.type === 'execution_request')).toMatchObject({
      adapterId: 'telunjuk-sakti-wonogiri',
      params: { layanan_id: 23 },
      origin: 'https://telunjuksakti.wonogirikab.go.id',
    });
  }, 20_000);
});

describe('DemoProvider: wilayah dulu untuk Peristiwa Hidup', () => {
  it('tanpa usulan: bertanya kab/kota KTP; warga menyebut Surabaya → rencana Surabaya', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    const t1 = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    expect(
      of(t1.events, 'assistant_text')
        .map((e) => e.delta)
        .join(''),
    ).toMatch(/kabupaten\/kota mana/);
    const t2 = await runTurn(env.deps, { urusanId: u.id, userText: 'KTP saya Kota Surabaya' });
    expect(of(t2.events, 'plan_card')[0]?.wilayah?.ktp.kodeKabKota).toBe('3578');
  });
  it('nama ganda: DemoProvider meneruskan pertanyaan pilihan dari tool', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    const t = await runTurn(env.deps, { urusanId: u.id, userText: 'KTP saya Bekasi' });
    expect(
      of(t.events, 'assistant_text')
        .map((e) => e.delta)
        .join(''),
    ).toMatch(/Kota Bekasi.*Kabupaten Bekasi|Kabupaten Bekasi.*Kota Bekasi/);
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBeNull();
  });
});
