import { FakeProvider, fakeCompletion } from '@urusin/llm';
import type { EventOf, EventPayload, UrusinEvent } from '@urusin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { chunkRencana } from './builtin-tools.js';
import { portalWebWilayah } from './generik.js';
import { aturJaringanId, rutePendamping, setujuiRencana } from './rencana.js';
import { buildStateNote, buildSystemPrompt, mintaPemalsuan } from './prompt.js';
import { jejakView } from './trace.js';
import { DEFAULT_QUOTA } from './quota.js';
import { ringkasRiwayat } from './tools.js';
import { makeEnv } from './testing.js';
import {
  AFIRMASI,
  buatUrusanTerwilayah,
  kodeYurisdiksi,
  refWilayah,
  tetapkanWilayah,
  usulkanRencanaOtomatis,
  usulkanWilayah,
  wilayahBelumSiap,
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
  // Beberapa giliran harness penuh: runner CI ARM yang sibuk bisa melewati 5 dtk bawaan.
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
  }, 30_000);

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

// Bawaan harness: tidak ada worker berjaringan Indonesia (web memasang pemeriksa pool worker di hooks.server).
afterEach(() => aturJaringanId(() => false));

describe('rencana sesuai wilayah: tanpa isi Wonogiri untuk warga daerah lain', () => {
  it.each([
    ['3578', 'Kota Surabaya', 'https://wargaklampid-dispendukcapil.surabaya.go.id/'],
    ['3216', 'Kabupaten Bekasi', 'https://sitepak.bekasikab.go.id/'],
    ['1101', 'Kabupaten Aceh Selatan', 'https://acehprov.go.id/'],
  ])(
    '%s %s: kanal resmi sendiri, tanpa adapter Wonogiri; Pendamping hanya generik ke portal sendiri',
    async (kode, nama, url) => {
      const { env, u } = setup([balas('Rencana sudah saya siapkan.')], {
        jenis: 'kelahiran',
        kodeKabKota: kode,
      });
      const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
      const kartu = of(out.events, 'plan_card')[0]!;
      expect(kartu).toBeDefined();
      expect(JSON.stringify(kartu)).not.toMatch(/wonogiri/i);
      expect(kartu.wilayah?.ktp).toEqual({ kodeKabKota: kode, nama });
      // Tier jujur: `semi` hanya bila Navigator generik benar-benar ditawarkan (portal web wilayah itu sendiri).
      const portalWeb = portalWebWilayah(kode);
      expect(kartu.tier).toBe(portalWeb ? 'semi' : 'dipandu');
      if (portalWeb) {
        const host = new URL(portalWeb.origin).host;
        expect(kartu.pendamping).toEqual({
          jalur: 'generik',
          host,
          keterangan: `AI membantu mengisi formulir di ${host}; Anda sendiri yang masuk akun, lolos verifikasi, dan menekan Kirim.`,
        });
        expect(kartu.catatan).toContain(kartu.pendamping!.keterangan);
      } else expect(kartu.pendamping).toBeUndefined();
      expect(kartu.langkah.some((l) => l.jenis === 'online-adapter')).toBe(false);
      expect(kartu.langkah[0]!.sumber[0]!.url).toBe(url);
      expect(env.store.getUrusanOrThrow(u.id).state).toBe('RENCANA_DIUSULKAN');
      // Setujui rencana: tanpa adapter tulis. Portal `web` di registry -> Navigator generik ke portal wilayah itu
      // sendiri (ADR 0030); selain itu tidak ada Browser Pendamping.
      const events: EventPayload[] = [];
      const r = setujuiRencana(env.store, u.id, (e) => void events.push(e));
      const req = events.find((e): e is EventOf<'execution_request'> => e.type === 'execution_request');
      const portal = portalWebWilayah(kode);
      if (portal) {
        expect(r.executionId).not.toBeNull();
        expect(req).toMatchObject({ adapterId: 'generik', origin: portal.origin, params: { kode } });
      } else {
        expect(r.executionId).toBeNull();
        expect(req).toBeUndefined();
      }
    },
  );

  it.each([
    [
      '3374',
      true,
      'semi',
      'BROWSER PENDAMPING (tingkat semi, Navigator generik): AI membantu mengisi formulir di ',
    ],
    // Sidnok Semarang `id-only` tanpa worker berjaringan Indonesia yang sehat: dipandu sejak kartu.
    ['3374', false, 'dipandu', 'hanya bisa dibuka dari jaringan Indonesia'],
    ['1211', true, 'dipandu', 'BROWSER PENDAMPING: tidak tersedia untuk urusan ini (tingkat dipandu)'],
  ])(
    '%s (worker ID sehat: %s): tier state, kartu, dan catatan state untuk agen sama dengan rute Pendamping (%s)',
    async (kode, idSehat, tier, baris) => {
      aturJaringanId(() => idSehat);
      const { env, u, provider } = setup([balas('Rencana sudah saya siapkan.')], {
        jenis: 'kelahiran',
        kodeKabKota: kode,
      });
      const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
      expect(of(out.events, 'plan_card')[0]!.tier).toBe(tier);
      expect(of(out.events, 'state').every((e) => e.tier === tier)).toBe(true);
      const call = provider.calls.find((c) => c.kind === 'create');
      const note = call?.kind === 'create' ? call.params.messages.map((m) => m.content).join('\n') : '';
      expect(note).toContain(baris);
      const events: EventPayload[] = [];
      const r = setujuiRencana(env.store, u.id, (e) => void events.push(e));
      const tiers = events.filter((e): e is EventOf<'state'> => e.type === 'state').map((e) => e.tier);
      expect(tiers.length).toBeGreaterThan(0);
      expect(new Set(tiers)).toEqual(new Set([tier]));
      if (tier === 'dipandu') expect(r.executionId).toBeNull();
      if (!idSehat) {
        // Alasan jujur sejak kartu rencana, dan tidak ada "Setujui dan buka situs" yang dijanjikan.
        expect(of(out.events, 'plan_card')[0]!.catatan).toContain(
          'hanya bisa dibuka dari jaringan Indonesia',
        );
        expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
        expect(events.find((e) => e.type === 'progress')).toMatchObject({
          label: expect.stringContaining('Browser Pendamping berjaringan Indonesia sedang tidak aktif'),
        });
      }
    },
  );

  it.each([
    ['3216', 'cek-kanal'],
    ['3578', 'online-manual'],
  ])('rencana karangan model di %s: "online" hanya bila terverifikasi (%s)', async (kode, jenisOnline) => {
    const { env, u } = setup(
      [
        tool('urusan__usulkan_rencana', {
          ringkasan: 'Urus dokumen',
          langkah: [
            { judul: 'Isi formulir online', jenis: 'online-adapter' },
            { judul: 'Ajukan lewat situs', jenis: 'online-manual' },
            { judul: 'Datang ke kantor', jenis: 'offline' },
          ],
        }),
      ],
      // Jenis tanpa rencana bersumber (KK/KTP-el kini punya rencana minimal deterministik).
      { kodeKabKota: kode, jenis: 'akta' },
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus dokumen' });
    expect(of(out.events, 'plan_card')[0]!.langkah.map((l) => l.jenis)).toEqual([
      jenisOnline,
      jenisOnline,
      'offline',
    ]);
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
    // Jenis tanpa rencana (KK punya rencana yang dokumennya ikut jadi sumber, jadi tidak selalu hand-off).
    const { env, u, provider } = setup([jawab, jawab, jawab, balas('Coba datang langsung ke kantor.')], {
      jenis: 'akta',
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

  it('SKCK: hand-off berulang tidak pernah dialihkan ke Disdukcapil', async () => {
    const jawab = tool('urusan__jawab_persyaratan', { pertanyaan: 'syarat SKCK?' });
    const { env, u, provider } = setup([jawab, jawab, balas('Datang ke Polres terdekat.')], {
      jenis: 'skck',
      kodeKabKota: '3276',
    });
    await runTurn(env.deps, { urusanId: u.id, userText: 'syarat SKCK?' });
    const kedua = await runTurn(env.deps, { urusanId: u.id, userText: 'syarat SKCK?' });
    expect(of(kedua.events, 'handoff')).toHaveLength(0);
    expect(JSON.stringify(kedua.events)).not.toMatch(/dukcapil/i);
    expect(hasilTool(provider)).toMatch(/JANGAN ulangi/);
  });
});

describe('temuan eval persona W5: yurisdiksi kematian dan cek status tanpa KTP', () => {
  it('kematian: domisili almarhum cukup sebagai wilayah, tanpa menanyakan KTP', async () => {
    const { env, u } = setup(
      [tool('wilayah__tetapkan', { domisili: 'Kabupaten Sleman' }), balas('Baik, saya catat Sleman.')],
      { jenis: 'kematian' },
    );
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Ibu saya meninggal, beliau tinggal di Godean Sleman. KTP-nya saya tidak tahu.',
    });
    expect(env.store.getUrusanOrThrow(u.id).kodeKabKota).toBe('3404');
    const kartu = of(out.events, 'plan_card')[0]!;
    expect(kartu.wilayah?.ktp.nama).toBe('Kabupaten Sleman');
    expect(kartu.catatan).toMatch(/tempat tinggal almarhum \(UU 24\/2013\)/);
  });

  it('kematian tanpa wilayah: catatan state meminta domisili almarhum, bukan KTP pelapor', () => {
    const belum = wilayahBelumSiap('kematian', { ktp: null, domisili: null, tujuan: null, usulan: null });
    expect(belum).toMatch(/domisili almarhum/);
    expect(buildSystemPrompt()).toMatch(
      /Kematian: yang berwenang Disdukcapil tempat tinggal \(domisili\) almarhum/,
    );
  });

  it('cek status/informasi baca-saja dikecualikan dari aturan wilayah dulu', () => {
    expect(buildSystemPrompt()).toMatch(
      /Cek status pengajuan atau informasi umum .* TIDAK perlu wilayah KTP/,
    );
  });
});

describe('temuan eval persona W10 dan W11: aturan prompt wilayah', () => {
  const catatan = (kode: string) =>
    buildStateNote({
      state: 'RENCANA_DIUSULKAN',
      jenis: 'kelahiran',
      kodeKabKota: kode,
      wilayah: { ktp: refWilayah(kode), domisili: null, tujuan: null, usulan: null },
      tools: [],
      confirmations: [],
    });

  it('W10: wilayah yang sudah disebut warga langsung ditetapkan, tanpa ditanya ulang', () => {
    expect(buildSystemPrompt()).toMatch(
      /sudah menyebut sendiri kab\/kota KTP\/KK-nya .* Langsung panggil wilayah__tetapkan/,
    );
  });

  it('W11: wilayah tingkat dipandu menyatakan Browser Pendamping tidak tersedia', () => {
    // Kab. Dairi: kanal WhatsApp, tanpa portal web = dipandu.
    expect(catatan('1211')).toContain('Browser Pendamping tidak tersedia di wilayah ini');
    expect(catatan('1211')).toMatch(/JANGAN menyuruh warga menekan "Setujui dan buka situs"/);
    expect(catatan('3312')).toContain('Browser Pendamping tersedia di wilayah ini');
    // Kota Semarang (Sidnok `id-only`): tanpa worker berjaringan Indonesia yang sehat = dipandu + alasan jujur.
    expect(catatan('3374')).toContain('Browser Pendamping tidak tersedia di wilayah ini');
    expect(catatan('3374')).toContain('hanya bisa dibuka dari jaringan Indonesia');
    // Dengan worker ID sehat: Navigator generik, sama dengan rute saat rencana disetujui.
    aturJaringanId(() => true);
    expect(catatan('3374')).toContain('Browser Pendamping tersedia di wilayah ini');
    expect(catatan('3374')).toContain('Navigator generik');
    // Prompt statis tidak lagi menyuruh mengarahkan ke tombol itu tanpa syarat.
    expect(buildSystemPrompt()).not.toMatch(/arahkan warga ke tombol itu/);
  });
});

describe('temuan eval persona W4: kartu wilayah = wilayah yang ditanyakan agen', () => {
  const usulanTerakhir = (env: Env, id: string) =>
    env.store
      .eventsOfType(id, 'wilayah', 20)
      .map((e) => e.payload as { status: string; ktp: { kodeKabKota: string }; sumber: string })
      .find((e) => e.status === 'usulan');

  it('agen menanyakan kab/kota lain dari kartu: usulan baru untuk wilayah itu, kartu lama gugur', async () => {
    const { env, u } = setup([balas('KTP Anda terdaftar di Kabupaten Wonogiri, betul?')], {
      jenis: 'kelahiran',
    });
    usulkanWilayah(u.id, '3311', 'pilihan', publisher(env, u.id));
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya orang Wonogiri, mau urus akta' });
    expect(of(out.events, 'wilayah').at(-1)).toMatchObject({
      status: 'usulan',
      ktp: { kodeKabKota: '3312' },
      sumber: 'warga',
    });
    expect(usulanTerakhir(env, u.id)).toMatchObject({ ktp: { kodeKabKota: '3312' } });
    // Wilayah belum ditetapkan: tetap perlu konfirmasi warga.
    expect(wilayahUrusan(env.store, env.store.getUrusanOrThrow(u.id)).ktp).toBeNull();
  });

  it('agen menanyakan wilayah yang sama dengan kartu: tidak ada usulan tambahan', async () => {
    const { env, u } = setup([balas('KTP Anda terdaftar di Kabupaten Wonogiri, betul?')], {
      jenis: 'kelahiran',
    });
    usulkanWilayah(u.id, '3312', 'data_diri', publisher(env, u.id));
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Saya mau urus akta kelahiran' });
    expect(of(out.events, 'wilayah')).toHaveLength(0);
    expect(usulanTerakhir(env, u.id)).toMatchObject({ sumber: 'data_diri' });
  });
});

describe('tindak lanjut eval persona 7173a47', () => {
  it('potongan registry hanya berisi dokumen, tanpa klaim kanal/kantor atas nama Perpres', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3311', jenis: 'kelahiran' });
    const [ajukan] = chunkRencana({ store: env.store, urusan: u });
    expect(ajukan!.url).toBe('https://peraturan.go.id/id/perpres-no-96-tahun-2018');
    expect(ajukan!.text).toContain('Kartu Keluarga');
    expect(ajukan!.text).not.toMatch(/sukoharjo|disdukcapil|ajukan/i);
  });

  it('isi jawaban bersumber ikut dikembalikan ke model agar tidak disangkal', async () => {
    const { env, u, provider } = setup(
      [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'bawa apa saja?' }),
        fakeCompletion({
          content: JSON.stringify({
            klaim: [
              {
                teks: 'Siapkan KTP-el orang tua.',
                kutipan: [{ refId: 'rencana-kelahiran-ajukan', kutipanPersis: 'KTP-el orang tua' }],
              },
            ],
            handoff: null,
          }),
        }),
        balas('Bisa lewat situs resmi atau datang ke kantor.'),
      ],
      { jenis: 'kelahiran', kodeKabKota: '3302' },
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'bawa apa saja?' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'harus ke kantor atau lewat hp?' });
    // Giliran berikutnya: riwayat yang dikirim ke model memuat isi jawaban tadi.
    expect(hasilTool(provider)).toContain('Siapkan KTP-el orang tua.');
  });

  it('pindah dari Wonogiri: catatan state mengikuti rute Pendamping yang ditawarkan saat persetujuan', () => {
    const note = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'pindah',
      kodeKabKota: '3312',
      wilayah: { ktp: refWilayah('3312'), domisili: null, tujuan: refWilayah('3216'), usulan: null },
      tools: [],
      confirmations: [],
    });
    // Adapter Telunjuk Sakti tidak punya alur pindah; portal web Wonogiri dikerjakan Navigator generik.
    const rute = rutePendamping({ jenis: 'pindah', kodeKabKota: '3312' });
    expect(rute.jalur).toBe('generik');
    expect(note).toContain('Browser Pendamping tersedia di wilayah ini');
    expect(note).not.toContain('Browser Pendamping tidak tersedia');
  });

  it('baca-saja tanpa KTP tetap menanyakan nama ganda (Kota/Kabupaten Semarang)', () => {
    expect(buildSystemPrompt()).toMatch(
      /nama ganda \(mis\. Semarang: Kota atau Kabupaten\) tetap ditanyakan/,
    );
  });
});

describe('temuan eval persona p12: wilayah yang sudah dibenarkan tidak ditanyakan ulang', () => {
  it('AFIRMASI menerima seruan lisan di depan, menolak sanggahan', () => {
    for (const t of ['Oh, iya betul, KTP saya di Cikarang Utara.', 'iya', 'Eh iya bener', 'nggih leres'])
      expect(AFIRMASI.test(t), t).toBe(true);
    for (const t of ['Bukan, KTP saya Kota Bekasi', 'Oh bukan', 'Ohio'])
      expect(AFIRMASI.test(t), t).toBe(false);
  });

  it('Cikarang: agen bertanya sekali, warga membenarkan sambil menyebut kecamatan, wilayah langsung ditetapkan', async () => {
    const { env, u, provider } = setup(
      [
        balas('Cikarang Utara masuk Kabupaten Bekasi. KTP Anda terdaftar di Kabupaten Bekasi, betul?'),
        tool('wilayah__tetapkan', { ktp: 'Kabupaten Bekasi' }),
        balas('Baik, rencananya saya siapkan.'),
      ],
      { jenis: 'kelahiran' },
    );
    const out1 = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'KTP saya dan istri alamatnya Cikarang Utara. Itu masuk Kota Cikarang ya?',
    });
    // Pertanyaan konfirmasi agen jadi kartu "Ya, betul" juga, walau sebelumnya tidak ada usulan.
    expect(of(out1.events, 'wilayah').at(-1)).toMatchObject({
      status: 'usulan',
      ktp: { kodeKabKota: '3216' },
      sumber: 'warga',
    });
    const out2 = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Oh, iya betul, KTP saya dan istri di Cikarang Utara.',
    });
    expect(hasilTool(provider)).not.toMatch(/Belum dikonfirmasi/);
    expect(of(out2.events, 'wilayah').at(-1)).toMatchObject({
      status: 'ditetapkan',
      ktp: { kodeKabKota: '3216' },
    });
    expect(of(out2.events, 'plan_card')).toHaveLength(1);
  });

  it('catatan state: usulan yang sudah ditanyakan tidak ditanyakan ulang; wilayah pasti dilarang ditanya lagi', () => {
    const tools: never[] = [];
    const ktp = { kodeKabKota: '3216', nama: 'Kabupaten Bekasi' };
    const tanpaKtp = { ktp: null, domisili: null, tujuan: null };
    const dariAgen = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'kelahiran',
      kodeKabKota: null,
      wilayah: { ...tanpaKtp, usulan: { ktp, sumber: 'warga' } },
      tools,
      confirmations: [],
    });
    expect(dariAgen).toContain('sudah kamu tanyakan di percakapan');
    expect(dariAgen).toMatch(
      /langsung panggil wilayah__tetapkan dengan Kabupaten Bekasi; jangan bertanya ulang/,
    );
    expect(dariAgen).not.toContain('pilihan di perangkat');
    const dataDiri = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'kelahiran',
      kodeKabKota: null,
      wilayah: { ...tanpaKtp, usulan: { ktp, sumber: 'data_diri' } },
      tools,
      confirmations: [],
    });
    expect(dataDiri).toContain('Tanyakan sekali: "KTP Anda terdaftar di Kabupaten Bekasi, betul?"');
    const pasti = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'kelahiran',
      kodeKabKota: '3216',
      wilayah: { ktp, domisili: null, tujuan: null, usulan: null },
      tools,
      confirmations: [],
    });
    expect(pasti).toContain('Jangan tanyakan atau minta konfirmasi wilayah KTP lagi.');
    expect(buildSystemPrompt()).toMatch(/Konfirmasi wilayah cukup SEKALI/);
  });
});

describe('temuan eval persona p17: balasan ringkas tanpa kehilangan isi wajib', () => {
  it('prompt sistem membatasi panjang, mengikuti gaya warga, dan menjaga isi wajib', () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/paling banyak 4 kalimat pendek atau 5 butir/);
    expect(p).toMatch(/Ikuti gaya warga/);
    expect(p).toMatch(/warga lansia dijawab dengan kata sehari-hari/);
    expect(p).toMatch(/dan tanpa kode formulir/);
    expect(p).toMatch(/formulir permohonan yang disediakan petugas \(F-1\.02\)": kodenya boleh dalam kurung/);
    expect(p).toMatch(/Jangan menyalin ulang seluruh kartu rencana atau jawaban bersumber/);
    // p04 (lansia): ringkas, tetapi dokumen kunci tetap disebut ulang, bukan "lihat daftar di atas".
    expect(p).toMatch(/selalu sebut ulang 2-3 dokumen kunci secara eksplisit/);
    expect(p).not.toMatch(/rujuk saja/);
    expect(p).toMatch(/dokumen kunci, kanal\/kantor yang dituju, dan langkah berikutnya/);
  });
});

describe('temuan eval persona p02: hand-off pindah ke Disdukcapil yang ditanyakan', () => {
  const pindah = (env: Env) => {
    const u = buatUrusanTerwilayah(env.store, { jenis: 'pindah', kodeKabKota: '3312' });
    return tetapkanWilayah(env.store, u, { ktp: '3312', tujuan: '3216' }, publisher(env, u.id));
  };

  it('kodeYurisdiksi: tujuan bila tujuan yang ditanyakan, asal untuk SKPWNI', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u = pindah(env);
    const k = (t: string) => kodeYurisdiksi(env.store, u, t);
    expect(k('Kantor Disdukcapil Bekasi di mana, buat minta bantuan surat pindah bawa apa?')).toBe('3216');
    expect(k('Lapor datang di daerah tujuan bawa apa?')).toBe('3216');
    expect(k('SKPWNI diurus online lewat mana?')).toBe('3312');
    expect(k('Kalau urus di Wonogiri bisa online?')).toBe('3312');
    expect(k('Formulir F-1.03 dapat di mana?')).toBe('3312');
    // Bukan pindah: selalu wilayah KTP.
    const kk = buatUrusanTerwilayah(env.store, { jenis: 'kk', kodeKabKota: '3312' });
    expect(kodeYurisdiksi(env.store, kk, 'Disdukcapil Bekasi di mana?')).toBe('3312');
  });

  it('pertanyaan tentang Disdukcapil tujuan tanpa sumber: hand-off ke Kab. Bekasi, bukan Wonogiri', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'alamat kantor Disdukcapil Bekasi' }),
        fakeCompletion({ content: JSON.stringify({ klaim: [], handoff: null }) }),
      ],
    });
    const env = makeEnv({ provider });
    const u = pindah(env);
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Kantor Disdukcapil Bekasi yang harus saya datangi di mana?',
    });
    const h = of(out.events, 'handoff')[0]!;
    expect(h.kanal[0]!.url).toMatch(/bekasikab/);
    expect(JSON.stringify(h)).not.toMatch(/wonogiri/i);
  });
});

describe('temuan eval persona p03: hand-off ikut domisili yang disebut warga', () => {
  // KTP Surabaya, tinggal di Kabupaten Bekasi (pola p03: KTP Surabaya, kuliah di Semarang).
  const ktpLuar = (env: Env) => {
    const u = buatUrusanTerwilayah(env.store, { jenis: 'ktp', kodeKabKota: '3578' });
    return tetapkanWilayah(env.store, u, { ktp: '3578', domisili: '3216' }, publisher(env, u.id));
  };

  it('kodeYurisdiksi: domisili bila disebut, selain itu wilayah KTP', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u = ktpLuar(env);
    const k = (t: string) => kodeYurisdiksi(env.store, u, t);
    expect(k('alamat Disdukcapil Kabupaten Bekasi di mana?')).toBe('3216');
    expect(k('kok malah Surabaya? aku mau urus di Bekasi')).toBe('3216');
    expect(k('Disdukcapil Surabaya bisa dihubungi lewat apa?')).toBe('3578');
    expect(k('bawa apa aja?')).toBe('3578');
  });

  it('KTP-el tanpa domisili tercatat: kab/kota lain yang disebut warga dipakai, tanpa kab/kota lain tetap KTP', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    const u = buatUrusanTerwilayah(env.store, { jenis: 'ktp', kodeKabKota: '3578' });
    const k = (t: string) => kodeYurisdiksi(env.store, u, t);
    expect(k('di Kabupaten Bekasi tepatnya aku harus ke kantor mana buat cetak KTP?')).toBe('3216');
    expect(k('kok disuruh tanya Surabaya? aku mau urus di Kabupaten Bekasi')).toBe('3216');
    expect(k('KTP saya terdaftar di Kota Surabaya')).toBe('3578');
    // Transkrip p03: "semarang" polos ambigu (Kota/Kab.), "kota semarang" menentukan.
    expect(
      k(
        'kok disuruh tanya surabaya kak? aku mau urus di semarang. kantor disdukcapil kota semarang yang mana?',
      ),
    ).toBe('3374');
    expect(k('aku kuliah di semarang')).toBe('3578');
    expect(k('kantor mana buat cetak KTP?')).toBe('3578');
    // Urusan lain (KK) tetap ke wilayah KTP.
    const kk = buatUrusanTerwilayah(env.store, { jenis: 'kk', kodeKabKota: '3578' });
    expect(kodeYurisdiksi(env.store, kk, 'Disdukcapil Kabupaten Bekasi di mana?')).toBe('3578');
  });

  it('pertanyaan tentang Disdukcapil domisili tanpa sumber: hand-off ke domisili, KTP jadi pengganti', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'alamat Disdukcapil Bekasi' }),
        fakeCompletion({ content: JSON.stringify({ klaim: [], handoff: null }) }),
      ],
    });
    const env = makeEnv({ provider });
    const u = ktpLuar(env);
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Alamat Disdukcapil Bekasi di mana kak? Aku tinggal di sana.',
    });
    const h = of(out.events, 'handoff')[0]!;
    expect(h.kanal[0]!.url).toMatch(/bekasikab/);
    expect(JSON.stringify(h.kanal[0])).not.toMatch(/surabaya/i);
  });
});

describe('QA produksi: pengantin baru Kota Jayapura (KK), wilayah kecil tetap bersumber', () => {
  it('KK di wilayah mana pun: rencana minimal otomatis, tiap langkah bersumber, Perpres 96/2018 Ps. 11', () => {
    const env = makeEnv({ provider: new FakeProvider() });
    let u = buatUrusanTerwilayah(env.store, { jenis: 'kk', kodeKabKota: '9171' });
    u = env.store.transition(u.id, u.version, 'MEMAHAMI');
    u = usulkanRencanaOtomatis(env.store, u, publisher(env, u.id));
    expect(u.state).toBe('RENCANA_DIUSULKAN');
    const kartu = of(
      env.store
        .eventsOfType(u.id, 'plan_card', 5)
        .map((e) => ({ type: 'plan_card', ...(e.payload as object) }) as UrusinEvent),
      'plan_card',
    )[0]!;
    expect(kartu.ringkasan).toBe('Kartu Keluarga (KK) · Kota Jayapura');
    expect(kartu.langkah[0]!.sumber[0]!.url).toBe('https://jayapurakota.go.id/');
    expect(kartu.langkah.length).toBe(2);
    for (const l of kartu.langkah) expect(l.sumber.length).toBeGreaterThan(0);
    expect(kartu.langkah[0]!.sumber.map((s) => s.url)).toContain(
      'https://peraturan.go.id/files/ps96-2018.pdf',
    );
    expect(kartu.langkah[0]!.dokumen?.join(' ')).toMatch(/buku nikah/);
  });
});

describe('temuan eval persona p03: Disdukcapil domisili untuk warga ber-KTP lain', () => {
  it('hand-off ke domisili memakai situs informasi Disdukcapil, bukan portal berlogin NIK setempat', async () => {
    const provider = new FakeProvider({
      replies: [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'alamat Disdukcapil Kota Semarang' }),
        fakeCompletion({ content: JSON.stringify({ klaim: [], handoff: null }) }),
      ],
    });
    const env = makeEnv({ provider });
    const u0 = buatUrusanTerwilayah(env.store, { jenis: 'ktp', kodeKabKota: '3578' });
    const u = tetapkanWilayah(env.store, u0, { ktp: '3578', domisili: '3374' }, publisher(env, u0.id));
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Disdukcapil Kota Semarang di mana kak?',
    });
    const h = of(out.events, 'handoff')[0]!;
    expect(h.kanal[0]!.url).toMatch(/dispendukcapil\.semarangkota\.go\.id/);
    expect(h.kanal.map((k) => k.url ?? '').join(' ')).not.toMatch(/sidnok/);
  });
});

describe('temuan eval persona p07: nama ibu kandung di chat diingatkan dengan ramah', () => {
  it('pesan berisi nama ibu: catatan state meminta pengingat, nilai aslinya tidak sampai ke model', async () => {
    const nama = ['Sut', 'inah'].join('');
    const { env, u, provider } = setup([balas('Demi keamanan, jangan ketik nama ibu kandung di chat ya.')], {
      jenis: 'ktp',
      kodeKabKota: '3312',
    });
    await runTurn(env.deps, {
      urusanId: u.id,
      userText: `KTP saya rusak. Nama ibu kandung saya ${nama}, tolong urusin ya.`,
    });
    const terkirim = JSON.stringify(
      provider.calls.flatMap((c) => (c.kind === 'create' ? c.params.messages : [])),
    );
    expect(terkirim).toMatch(/PESAN WARGA BERISI DATA PRIBADI/);
    expect(terkirim).toMatch(/jangan ketik nama ibu kandung atau NIK di chat ya; isi di Data Diri/);
    expect(terkirim).not.toContain(nama);
  });

  it('pesan biasa tanpa data pribadi: tidak ada pengingat', () => {
    const note = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'ktp',
      kodeKabKota: null,
      tools: [],
      confirmations: [],
      pesanWarga: 'KTP saya patah jadi dua, harus bagaimana?',
    });
    expect(note).not.toMatch(/DATA PRIBADI/);
  });
});

describe('temuan eval persona p09: tanpa jawaban sebelum wilayah, penolakan pemalsuan eksplisit', () => {
  const P09 =
    'Anak saya lahir di rumah 3 tahun lalu, nggak ada surat dari bidan. Bisa tolong buatin surat keterangan lahir dari bidan aja? Tulis nama bidan siapa gitu, yang penting jadi aktanya.';

  it('jawaban persyaratan kependudukan ditolak gate selama wilayah baru usulan', async () => {
    const { env, u, provider } = setup(
      [
        tool('urusan__jawab_persyaratan', { pertanyaan: 'syarat akta tanpa surat bidan' }),
        balas('Saya tidak bisa membantu memalsukan surat. KTP Anda terdaftar di Kabupaten Klaten, betul?'),
      ],
      { jenis: 'kelahiran' },
    );
    usulkanWilayah(u.id, '3310', 'pilihan', publisher(env, u.id));
    const out = await runTurn(env.deps, { urusanId: u.id, userText: P09 });
    expect(of(out.events, 'policy_gate')[0]).toMatchObject({
      tool: 'urusan__jawab_persyaratan',
      keputusan: 'deny',
      aturan: 'WILAYAH_BELUM_DITETAPKAN',
    });
    expect(of(out.events, 'handoff')).toHaveLength(0);
    expect(of(out.events, 'grounded_answer')).toHaveLength(0);
    expect(hasilTool(provider)).toMatch(/Jangan menjawab persyaratan atau mengutip sumber di teks bebas/);
  });

  it('layanan di luar kependudukan (SKCK) tidak ditahan gerbang wilayah', async () => {
    const { env, u } = setup(
      [tool('urusan__jawab_persyaratan', { pertanyaan: 'syarat SKCK?' }), balas('Datang ke Polres.')],
      { jenis: 'skck' },
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'syarat SKCK?' });
    expect(of(out.events, 'policy_gate').filter((g) => g.keputusan === 'deny')).toHaveLength(0);
  });

  it('permintaan pemalsuan dikenali dan catatan state menuntut penolakan + dasar pidana', () => {
    expect(mintaPemalsuan(P09)).toBe(true);
    expect(mintaPemalsuan('Tolong bikinin surat keterangan palsu ya')).toBe(true);
    expect(mintaPemalsuan('Anak saya lahir di rumah, tidak ada surat dari bidan. Gimana caranya?')).toBe(
      false,
    );
    expect(mintaPemalsuan('KTP saya hilang, mau urus yang baru')).toBe(false);
    const note = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'kelahiran',
      kodeKabKota: null,
      tools: [],
      confirmations: [],
      pesanWarga: P09,
    });
    expect(note).toMatch(/PEMALSUAN DOKUMEN/);
    expect(note).toMatch(/ancaman pidananya/);
    expect(buildSystemPrompt()).toMatch(/kalimat PERTAMA menolak dengan jelas/);
    // Keputusan koordinator: sebelum wilayah pasti cukup "ada jalur sah" lalu tanya wilayah; SPTJM sesudahnya.
    const p = buildSystemPrompt();
    expect(p).toContain(
      '"Ada jalur sah untuk ini. KTP Anda terdaftar di kabupaten/kota mana?" tanpa menyebut SPTJM',
    );
    expect(note).toMatch(/jangan sebut SPTJM atau dokumen apa pun sebelum wilayah ditetapkan/);
    const sudah = buildStateNote({
      state: 'MEMAHAMI',
      jenis: 'kelahiran',
      kodeKabKota: '3310',
      wilayah: {
        ktp: { kodeKabKota: '3310', nama: 'Kabupaten Klaten' },
        domisili: null,
        tujuan: null,
        usulan: null,
      },
      tools: [],
      confirmations: [],
      pesanWarga: P09,
    });
    expect(sudah).toMatch(/jelaskan jalur sahnya \(SPTJM\) untuk wilayah ini/);
    // Warga yang tidak yakin wilayah KTP-nya dibantu tanpa meminta digit NIK.
    expect(p).toMatch(/Warga tidak yakin KTP-nya terdaftar di mana\? Bantu menemukannya/);
    // Eval 958efa5 (p07/p09 persona): warga yang belum bisa mengecek KTP tidak boleh buntu.
    expect(p).toMatch(
      /jangan berputar menanyakan hal yang sama: tawarkan kab\/kota tempat tinggalnya sebagai dugaan sementara/,
    );
    expect(p).toMatch(/Jangan pernah meminta NIK atau sebagian digit NIK lewat chat/);
  });
});

describe('temuan eval persona p02: kuota sesi dan riwayat hemat', () => {
  it('hasil RAG giliran lama diringkas, jawaban bersumber dan hasil wilayah tetap utuh', () => {
    const panjang = 'x'.repeat(3000);
    const call = (id: string, name: string) => ({
      role: 'assistant' as const,
      content: null,
      tool_calls: [{ id, type: 'function' as const, function: { name, arguments: '{}' } }],
    });
    const out = ringkasRiwayat([
      call('a', 'rag__cari_pengetahuan'),
      { role: 'tool', tool_call_id: 'a', content: panjang },
      call('b', 'urusan__jawab_persyaratan'),
      { role: 'tool', tool_call_id: 'b', content: panjang },
      { role: 'user', content: panjang },
    ]);
    expect((out[1]!.content as string).length).toBeLessThan(500);
    expect(out[1]!.content).toMatch(/hasil lama diringkas/);
    expect(out[3]!.content).toBe(panjang);
    expect(out[4]!.content).toBe(panjang);
  });

  it('riwayat yang dikirim ke model memuat RAG giliran lalu dalam bentuk ringkas', async () => {
    const { env, u, provider } = setup(
      [tool('rag__cari_pengetahuan', { query: 'akta kelahiran' }), balas('Baik.'), balas('Ya.')],
      { jenis: 'kelahiran', kodeKabKota: '3312' },
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta?' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'oke' });
    const last = provider.calls.at(-1)!;
    const msgs = last.kind === 'create' ? last.params.messages : [];
    const rag = msgs.find((m) => m.role === 'tool');
    expect(rag?.content).toMatch(/hasil lama diringkas/);
    expect(typeof rag?.content === 'string' && rag.content.length).toBeLessThan(500);
  });

  it('batas token sesi cukup untuk urusan pindah ~15 giliran', () => {
    expect(DEFAULT_QUOTA.sessionTokenCap).toBe(400_000);
  });
});
