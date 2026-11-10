import { FakeProvider, fakeCompletion } from '@urusin/llm';
import type { EventOf, EventPayload, UrusinEvent } from '@urusin/contracts';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { setujuiRencana } from './rencana.js';
import { jejakView } from './trace.js';
import { makeEnv } from './testing.js';
import {
  buatUrusanTerwilayah,
  tetapkanWilayah,
  usulkanRencanaOtomatis,
  usulkanWilayah,
  wilayahUrusan,
} from './wilayah.js';

type Env = ReturnType<typeof makeEnv>;
const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);
const publisher = (env: Env, id: string) => (e: EventPayload) => {
  const { type, ...isi } = e;
  env.store.appendEvent(id, type, isi);
};
const tool = (name: string, args: Record<string, unknown>) =>
  fakeCompletion({ toolCalls: [{ name, arguments: JSON.stringify(args) }] });
const balas = (content: string) => fakeCompletion({ content });

/** Isi hasil tool terakhir yang dikirim balik ke model (pesan role tool). */
function hasilTool(p: FakeProvider): string {
  const msgs = p.calls.flatMap((c) => (c.kind === 'create' ? c.params.messages : []));
  const t = [...msgs].reverse().find((m) => m.role === 'tool');
  return typeof t?.content === 'string' ? t.content : '';
}

function setup(
  replies: ReturnType<typeof fakeCompletion>[],
  input: { jenis?: string; kodeKabKota?: string },
) {
  const provider = new FakeProvider({ replies });
  const env = makeEnv({ provider });
  const u = buatUrusanTerwilayah(env.store, input);
  return { provider, env, u };
}

describe('gerbang wilayah: rencana diblokir di kode sampai wilayah KTP ditetapkan', () => {
  it('tanpa wilayah: tidak ada rencana otomatis, dan urusan__usulkan_rencana ditolak WILAYAH_BELUM_DITETAPKAN', async () => {
    const { env, u } = setup(
      [
        tool('urusan__usulkan_rencana', {
          ringkasan: 'Akta kelahiran',
          langkah: [{ judul: 'Ajukan akta', jenis: 'online-adapter' }],
        }),
        balas('KTP Anda terdaftar di kabupaten/kota mana?'),
      ],
      { jenis: 'kelahiran' },
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran anak' });
    expect(of(out.events, 'policy_gate')[0]).toMatchObject({
      tool: 'urusan__usulkan_rencana',
      keputusan: 'deny',
      aturan: 'WILAYAH_BELUM_DITETAPKAN',
    });
    expect(of(out.events, 'plan_card')).toHaveLength(0);
    expect(env.store.getUrusanOrThrow(u.id)).toMatchObject({ state: 'MEMAHAMI', kodeKabKota: null });
  });

  it('pindah dengan KTP tetapi tanpa tujuan: rencana belum diusulkan', async () => {
    const { env, u } = setup([balas('Pindah ke kabupaten/kota mana?')], {
      jenis: 'pindah',
      kodeKabKota: '3578',
    });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau pindah' });
    expect(of(out.events, 'plan_card')).toHaveLength(0);
    expect(env.store.getUrusanOrThrow(u.id).state).toBe('MEMAHAMI');
  });

  it('catatan state memberi tahu model bahwa wilayah KTP belum ditetapkan beserta usulannya', async () => {
    const { env, u, provider } = setup([balas('KTP Anda terdaftar di Kabupaten Wonogiri, betul?')], {
      jenis: 'kelahiran',
    });
    usulkanWilayah(u.id, '3312', 'data_diri', publisher(env, u.id));
    await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    const call = provider.calls.find((c) => c.kind === 'create');
    const note = call?.kind === 'create' ? call.params.messages.map((m) => m.content).join('\n') : '';
    expect(note).toContain('WILAYAH KTP: belum ditetapkan.');
    expect(note).toContain('Usulan (Data Diri akun): Kabupaten Wonogiri');
    expect(note).toContain('WILAYAH DULU');
  });
});

describe('rencana sesuai wilayah: tanpa isi Wonogiri untuk warga daerah lain', () => {
  it.each([
    ['3578', 'Kota Surabaya', 'https://wargaklampid-dispendukcapil.surabaya.go.id/'],
    ['3216', 'Kabupaten Bekasi', 'https://sitepak.bekasikab.go.id/'],
    ['1101', 'Kabupaten Aceh Selatan', 'https://dukcapil.kemendagri.go.id/'],
  ])('%s %s: kanal resmi sendiri, tier dipandu jujur, tanpa Browser Pendamping', async (kode, nama, url) => {
    const { env, u } = setup([balas('Rencana sudah saya siapkan.')], {
      jenis: 'kelahiran',
      kodeKabKota: kode,
    });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    const kartu = of(out.events, 'plan_card')[0]!;
    expect(kartu).toBeDefined();
    expect(JSON.stringify(kartu)).not.toMatch(/wonogiri/i);
    expect(kartu.wilayah?.ktp).toEqual({ kodeKabKota: kode, nama });
    expect(kartu.tier).toBe('dipandu');
    expect(kartu.langkah.some((l) => l.jenis === 'online-adapter')).toBe(false);
    expect(kartu.langkah[0]!.sumber[0]!.url).toBe(url);
    expect(env.store.getUrusanOrThrow(u.id).state).toBe('RENCANA_DIUSULKAN');
    // Setujui rencana: tidak ada Browser Pendamping yang ditawarkan di wilayah tanpa adapter tulis.
    const events: EventPayload[] = [];
    const r = setujuiRencana(env.store, u.id, (e) => void events.push(e));
    expect(r.executionId).toBeNull();
    expect(events.some((e) => e.type === 'execution_request')).toBe(false);
  });

  it('jawaban tanpa sumber menyebut kanal wilayah itu sendiri (situs Disdukcapil terverifikasi)', async () => {
    const { env, u, provider } = setup(
      [tool('rag__cari_pengetahuan', { query: 'zzz qqq' }), balas('Silakan cek kanal resmi.')],
      { jenis: 'kelahiran', kodeKabKota: '1104' },
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'zzz qqq' });
    expect(hasilTool(provider)).toMatch(/acehtengahkab\.go\.id/);
    expect(hasilTool(provider)).not.toMatch(/wonogiri/i);
  });

  it('kode kab/kota dari model tidak menimpa wilayah urusan: ajukan_layanan ke portal kota lain ditolak gate', async () => {
    const args = { kodeKabKota: '3312', layananId: 23 };
    const provider = new FakeProvider({ replies: [] });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3578' });
    // Konfirmasi sah sekalipun: portal Wonogiri tidak boleh dibuka untuk urusan berwilayah KTP Surabaya.
    const confirmationId = env.store.createConfirmation(u.id, 'dukcapil__ajukan_layanan', args);
    provider.enqueue(tool('dukcapil__ajukan_layanan', { ...args, confirmationId }));
    provider.enqueue(balas('Tidak bisa.'));
    let v = env.store.getUrusanOrThrow(u.id).version;
    for (const s of [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
    ] as const)
      v = env.store.transition(u.id, v, s).version;
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ajukan' });
    expect(of(out.events, 'execution_request')).toHaveLength(0);
    expect(of(out.events, 'policy_gate')[0]).toMatchObject({
      keputusan: 'deny',
      aturan: 'ORIGIN_NOT_OFFICIAL',
    });
  });
});

describe('wilayah__tetapkan: validasi ke 514 kab/kota', () => {
  it('nama tidak dikenal: ditolak, wilayah tetap kosong', async () => {
    const { env, u, provider } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Atlantis' }), balas('Kab/kota mana?')],
      { jenis: 'kelahiran' },
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'KTP saya Atlantis' });
    expect(hasilTool(provider)).toMatch(/tidak dikenal di 514 kab\/kota/);
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBeNull();
  });

  it('nama ganda (Bekasi): ditolak dengan pilihan Kota/Kabupaten untuk ditanyakan', async () => {
    const { env, u, provider } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Bekasi' }), balas('Kota atau Kabupaten Bekasi?')],
      { jenis: 'kelahiran' },
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'KTP saya Bekasi' });
    const isi = hasilTool(provider);
    expect(isi).toMatch(/Kota Bekasi \(3275/);
    expect(isi).toMatch(/Kabupaten Bekasi \(3216/);
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBeNull();
    expect(of(out.events, 'wilayah')).toHaveLength(0);
  });

  it('nama yang disebut warga sendiri: ditetapkan + event audit, lalu rencana disusun', async () => {
    const { env, u } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Kota Surabaya' }), balas('Baik, Kota Surabaya.')],
      { jenis: 'kelahiran' },
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'KTP saya Surabaya' });
    expect(of(out.events, 'wilayah')[0]).toMatchObject({
      status: 'ditetapkan',
      sumber: 'warga',
      ktp: { kodeKabKota: '3578', nama: 'Kota Surabaya' },
    });
    expect(env.store.getUrusanOrThrow(u.id)).toMatchObject({
      kodeKabKota: '3578',
      state: 'RENCANA_DIUSULKAN',
    });
    expect(env.store.verifyChain(u.id).ok).toBe(true);
    expect(jejakView(env.store, u.id).timeline.map((e) => ('ringkas' in e ? e.ringkas : ''))).toContain(
      'Wilayah KTP dipastikan warga: Kota Surabaya',
    );
  });

  it('pemetaan kecamatan oleh model (Cikarang → Kab. Bekasi) wajib dibenarkan warga dulu', async () => {
    const { env, u, provider } = setup(
      [
        tool('wilayah__tetapkan', { ktp: 'Kabupaten Bekasi' }),
        balas('Cikarang termasuk Kabupaten Bekasi. KTP Anda terdaftar di Kabupaten Bekasi, betul?'),
        tool('wilayah__tetapkan', { ktp: 'Kabupaten Bekasi' }),
        balas('Baik.'),
      ],
      { jenis: 'kelahiran' },
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'Saya tinggal di Cikarang' });
    expect(hasilTool(provider)).toMatch(/Belum dikonfirmasi warga/);
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBeNull();
    await runTurn(env.deps, { urusanId: u.id, userText: 'iya betul' });
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBe('3216');
  });

  it('tanpa pernyataan warga, model tidak boleh menetapkan wilayah tebakan', async () => {
    const { env, u, provider } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Kabupaten Wonogiri' }), balas('KTP Anda di mana?')],
      { jenis: 'kelahiran' },
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    expect(hasilTool(provider)).toMatch(/Belum dikonfirmasi warga/);
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBeNull();
  });
});

describe('KTP ≠ domisili dan pindah (asal → tujuan)', () => {
  it('KTP Surabaya, tinggal di Kab. Bekasi: rencana tetap Disdukcapil Surabaya, catatan menjelaskan', async () => {
    const { env, u } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Kota Surabaya', domisili: 'Kabupaten Bekasi' }), balas('Baik.')],
      { jenis: 'kelahiran' },
    );
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'KTP saya Surabaya, tapi sekarang tinggal di Kabupaten Bekasi',
    });
    expect(of(out.events, 'wilayah')[0]).toMatchObject({
      ktp: { kodeKabKota: '3578' },
      domisili: { kodeKabKota: '3216' },
    });
    const kartu = of(out.events, 'plan_card')[0]!;
    expect(kartu.wilayah).toEqual({
      ktp: { kodeKabKota: '3578', nama: 'Kota Surabaya' },
      domisili: { kodeKabKota: '3216', nama: 'Kabupaten Bekasi' },
    });
    expect(kartu.catatan).toMatch(/sesuai alamat KTP: Kota Surabaya/);
    expect(kartu.catatan).toMatch(/dari mana saja/);
    expect(kartu.langkah[0]!.sumber[0]!.url).toMatch(/surabaya\.go\.id/);
    expect(JSON.stringify(kartu)).not.toMatch(/wonogiri/i);
  });

  it('pindah Surabaya → Kab. Bekasi: surat pindah di asal, datang/KK/KTP-el di tujuan', async () => {
    const { env, u } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Kota Surabaya', tujuan: 'Kabupaten Bekasi' }), balas('Baik.')],
      { jenis: 'pindah' },
    );
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Saya mau pindah dari Surabaya ke Kabupaten Bekasi',
    });
    const kartu = of(out.events, 'plan_card')[0]!;
    expect(kartu.ringkasan).toBe('Pindah · Kota Surabaya → Kab. Bekasi');
    expect(kartu.wilayah?.tujuan).toEqual({ kodeKabKota: '3216', nama: 'Kabupaten Bekasi' });
    const [pwni, ...tujuan] = kartu.langkah;
    expect(pwni!.judul).toMatch(/SKPWNI.*Kota Surabaya/);
    expect(pwni!.sumber[0]!.url).toMatch(/surabaya\.go\.id/);
    for (const l of tujuan) expect(l.sumber[0]!.url).toMatch(/bekasikab\.go\.id/);
    expect(JSON.stringify(kartu)).not.toMatch(/wonogiri/i);
    expect(wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id)).tujuan?.kodeKabKota).toBe('3216');
  });

  it('wilayah diubah setelah rencana diusulkan: rencana lama gugur dan disusun ulang', async () => {
    const { env, u } = setup(
      [tool('wilayah__tetapkan', { ktp: 'Kabupaten Bekasi' }), balas('Baik, saya ganti.')],
      { jenis: 'kelahiran', kodeKabKota: '3578' },
    );
    const pub = publisher(env, u.id);
    usulkanRencanaOtomatis(env.store, env.store.getUrusanOrThrow(u.id), pub);
    let cur = env.store.getUrusanOrThrow(u.id);
    cur = env.store.transition(cur.id, cur.version, 'MEMAHAMI');
    cur = usulkanRencanaOtomatis(env.store, cur, pub);
    expect(cur.state).toBe('RENCANA_DIUSULKAN');
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Maaf, KTP saya Kabupaten Bekasi' });
    const kartu = of(out.events, 'plan_card').at(-1)!;
    expect(kartu.wilayah?.ktp.kodeKabKota).toBe('3216');
    expect(env.store.getUrusanOrThrow(u.id).state).toBe('RENCANA_DIUSULKAN');
  });
});

describe('usulan Data Diri: ditawarkan untuk dikonfirmasi, tidak pernah diam-diam', () => {
  it('"ya" atas usulan Data Diri → wilayah ditetapkan; tanpa itu tetap kosong', async () => {
    const { env, u, provider } = setup(
      [
        balas('Aturan berbeda per kab/kota. KTP Anda terdaftar di Kabupaten Wonogiri, betul?'),
        tool('wilayah__tetapkan', { ktp: 'Kabupaten Wonogiri' }),
        balas('Baik.'),
      ],
      { jenis: 'kelahiran' },
    );
    usulkanWilayah(u.id, '3312', 'data_diri', publisher(env, u.id));
    await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBeNull();
    const w = wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id));
    expect(w).toMatchObject({ ktp: null, usulan: { sumber: 'data_diri', ktp: { kodeKabKota: '3312' } } });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ya' });
    expect(hasilTool(provider)).toMatch(/Wilayah KTP ditetapkan: Kabupaten Wonogiri/);
    expect(of(out.events, 'plan_card')[0]).toMatchObject({
      tier: 'semi',
      wilayah: { ktp: { kodeKabKota: '3312' } },
    });
  });

  it('konfirmasi lewat tombol (deterministik, tanpa model): wilayah + rencana sekaligus', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u0 = env.store.createUrusan({ jenis: 'kelahiran' });
    const pub = publisher(env, u0.id);
    usulkanWilayah(u0.id, '3312', 'data_diri', pub);
    let u = env.store.transition(u0.id, u0.version, 'MEMAHAMI');
    u = tetapkanWilayah(env.store, u, { ktp: '3312' }, pub);
    u = usulkanRencanaOtomatis(env.store, u, pub);
    expect(u).toMatchObject({ state: 'RENCANA_DIUSULKAN', kodeKabKota: '3312' });
    const types = env.store.eventsAfter(u.id).map((e) => e.type);
    expect(types).toEqual(['wilayah', 'wilayah', 'plan_card', 'state']);
  });
});

describe('temuan review: penetapan wilayah tidak menimpa diam-diam', () => {
  const urusanMemahami = (jenis = 'pindah') => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u0 = env.store.createUrusan({ jenis });
    const u = env.store.transition(u0.id, u0.version, 'MEMAHAMI');
    return { env, u, pub: publisher(env, u.id) };
  };
  const jumlahWilayah = (env: Env, id: string) => env.store.eventsOfType(id, 'wilayah', 50).length;

  it('panggilan hanya-KTP mempertahankan tujuan pindah; null eksplisit menghapusnya', () => {
    const { env, u, pub } = urusanMemahami();
    let cur = tetapkanWilayah(env.store, u, { ktp: '3312', tujuan: '3578' }, pub);
    cur = tetapkanWilayah(env.store, cur, { ktp: '3313' }, pub);
    expect(wilayahUrusan(env.store, cur)).toMatchObject({
      ktp: { kodeKabKota: '3313' },
      tujuan: { kodeKabKota: '3578' },
    });
    cur = tetapkanWilayah(env.store, cur, { ktp: '3313', tujuan: null }, pub);
    expect(wilayahUrusan(env.store, cur).tujuan).toBeNull();
  });

  it('wilayah yang sama ditetapkan lagi: tanpa event baru dan versi tidak naik', () => {
    const { env, u, pub } = urusanMemahami('kelahiran');
    const a = tetapkanWilayah(env.store, u, { ktp: '3312' }, pub);
    const b = tetapkanWilayah(env.store, a, { ktp: '3312' }, pub);
    expect(b.version).toBe(a.version);
    expect(jumlahWilayah(env, u.id)).toBe(1);
  });

  it('kolom dan event audit ditulis atomik: event gagal → kolom tidak berubah', () => {
    const { env, u } = urusanMemahami('kelahiran');
    expect(() =>
      tetapkanWilayah(env.store, u, { ktp: '3312' }, () => {
        throw new Error('event gagal');
      }),
    ).toThrow('event gagal');
    expect(env.store.getUrusanOrThrow(u.id)).toMatchObject({ kodeKabKota: null, version: u.version });
  });

  it('urusan lama berkolom 3312 tanpa event ditetapkan: hanya usulan, tanpa rencana, setujui ditolak', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u0 = env.store.createUrusan({ kodeKabKota: '3312', jenis: 'kelahiran' });
    let u = env.store.transition(u0.id, u0.version, 'MEMAHAMI');
    expect(wilayahUrusan(env.store, u)).toMatchObject({
      ktp: null,
      usulan: { ktp: { kodeKabKota: '3312' }, sumber: 'pilihan' },
    });
    expect(usulkanRencanaOtomatis(env.store, u, publisher(env, u.id)).state).toBe('MEMAHAMI');
    u = env.store.transition(u.id, u.version, 'RENCANA_DIUSULKAN');
    expect(() => setujuiRencana(env.store, u.id, () => {})).toThrow(/wilayah KTP warga belum ditetapkan/);
  });

  it('"ya" atas pertanyaan lain tidak mengonfirmasi usulan wilayah', async () => {
    const { env, u, provider } = setup(
      [
        balas('Apakah anak Anda lahir di rumah sakit?'),
        tool('wilayah__tetapkan', { ktp: 'Kabupaten Wonogiri' }),
        balas('Baik.'),
      ],
      { jenis: 'kelahiran' },
    );
    usulkanWilayah(u.id, '3312', 'data_diri', publisher(env, u.id));
    await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'ya' });
    expect(hasilTool(provider)).toMatch(/Belum dikonfirmasi warga/);
    expect(wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id)).ktp).toBeNull();
  });
});

describe('temuan eval persona: persyaratan dan wilayah setelah rencana', () => {
  const jawab = (refId: string, kutipanPersis: string, teks: string) =>
    fakeCompletion({
      content: JSON.stringify({ klaim: [{ teks, kutipan: [{ refId, kutipanPersis }] }], handoff: null }),
    });

  it('W1: kartu rencana membawa daftar dokumen nasional dan keterangannya', async () => {
    const { env, u } = setup([balas('Rencana sudah saya siapkan.')], {
      jenis: 'kelahiran',
      kodeKabKota: '3302',
    });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    const ajukan = of(out.events, 'plan_card')[0]!.langkah[0]!;
    expect(ajukan.dokumen).toContain('Kartu Keluarga');
    expect(ajukan.dokumen).toContain('KTP-el orang tua');
    expect(ajukan.keterangan).toMatch(/Perpres 96\/2018/);
  });

  it('W1: "dokumen apa saja?" setelah wilayah ditetapkan dijawab dari registry, bukan hand-off', async () => {
    const { env, u } = setup(
      [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'dokumen apa saja yang dibawa?' }),
        jawab('rencana-kelahiran-ajukan', 'KTP-el orang tua', 'Siapkan KTP-el orang tua.'),
      ],
      { jenis: 'kelahiran', kodeKabKota: '3302' },
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'dokumen apa saja yang dibawa?' });
    expect(of(out.events, 'handoff')).toHaveLength(0);
    const kutipan = of(out.events, 'grounded_answer')[0]!.klaim[0]!.kutipan[0]!;
    expect(kutipan.url).toBe('https://peraturan.go.id/id/perpres-no-96-tahun-2018');
  });
});

describe('temuan eval persona W2: ganti wilayah membuang sumber wilayah lama', () => {
  it('potongan Wonogiri yang diambil sebelum ganti ke Sukoharjo tidak bisa dikutip lagi', async () => {
    const { env, u } = setup(
      [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'syarat akta kelahiran?' }),
        fakeCompletion({
          content: JSON.stringify({
            klaim: [
              {
                teks: 'Standar Wonogiri mencantumkan fotokopi surat keterangan kelahiran.',
                kutipan: [{ refId: 'wng-1', kutipanPersis: 'fotokopi surat keterangan kelahiran' }],
              },
            ],
            handoff: null,
          }),
        }),
      ],
      { jenis: 'kelahiran', kodeKabKota: '3312' },
    );
    env.store.saveChunks(u.id, [
      {
        refId: 'wng-1',
        text: 'Persyaratan akta kelahiran Disdukcapil Wonogiri: fotokopi surat keterangan kelahiran.',
        url: 'https://disdukcapil.wonogirikab.go.id/',
        judul: 'Disdukcapil Wonogiri',
        instansi: 'Disdukcapil Kabupaten Wonogiri',
        verifiedAt: null,
      },
    ]);
    const cur = env.store.getUrusanOrThrow(u.id);
    tetapkanWilayah(env.store, cur, { ktp: '3311' }, publisher(env, u.id));
    expect(env.store.getChunks(u.id)).toHaveLength(0);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta kelahiran?' });
    expect(of(out.events, 'grounded_answer')).toHaveLength(0);
    expect(JSON.stringify(out.events)).not.toMatch(/wonogiri/i);
  });
});

describe('temuan eval persona W6: hand-off tidak diulang identik', () => {
  it('pertanyaan tanpa sumber berulang: kanal lain, lalu langkah lain tanpa hand-off yang sama', async () => {
    const jawab = tool('urusan__jawab_persyaratan', { pertanyaan: 'nomor antrean berapa?' });
    const { env, u, provider } = setup([jawab, jawab, jawab, balas('Coba datang langsung ke kantor.')], {
      jenis: 'skck',
      kodeKabKota: '3312',
    });
    const kanal = async () => {
      const out = await runTurn(env.deps, { urusanId: u.id, userText: 'nomor antrean berapa?' });
      return of(out.events, 'handoff').map((h) => h.kanal.map((k) => k.url));
    };
    const [pertama] = await kanal();
    const [kedua] = await kanal();
    expect(pertama!.length).toBeGreaterThan(0);
    expect(kedua!.length).toBeGreaterThan(0);
    // Kanal kedua tidak mengulang satu pun kanal pertama.
    const norm = (x?: string) => (x ?? '').toLowerCase().replace(/\/+$/, '');
    expect(kedua!.some((k) => pertama!.map(norm).includes(norm(k)))).toBe(false);
    // Semua kanal sudah diberikan: tidak ada hand-off lagi, model diminta memberi langkah lain.
    expect(await kanal()).toHaveLength(0);
    expect(hasilTool(provider)).toMatch(/JANGAN ulangi/);
  });
});
