import { FakeProvider, fakeCompletion } from '@urusin/llm';
import type { EventOf, EventPayload, UrusinEvent } from '@urusin/contracts';
import { DAFTAR_PENDAMPING_AKTIF, REF_UU24 } from '@urusin/registry';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { arahanPanduanUmum, kanalDipandu, paketDipandu } from './dipandu.js';
import { alasanDipandu } from './generik.js';
import { rutePendamping, setujuiRencana } from './rencana.js';
import { makeEnv } from './testing.js';
import { buatUrusanTerwilayah, refWilayah, rencanaUrusan, tetapkanWilayah } from './wilayah.js';

type Env = ReturnType<typeof makeEnv>;
const of = <T extends UrusinEvent['type']>(events: readonly UrusinEvent[], t: T) =>
  events.filter((e): e is EventOf<T> => e.type === t);
const tool = (name: string, args: Record<string, unknown>) =>
  fakeCompletion({ toolCalls: [{ name, arguments: JSON.stringify(args) }] });
const balas = (content: string) => fakeCompletion({ content });
const publisher = (env: Env, id: string) => (e: EventPayload) => {
  const { type, ...isi } = e;
  env.store.appendEvent(id, type, isi);
};
function hasilTool(p: FakeProvider): string {
  const msgs = p.calls.flatMap((c) => (c.kind === 'create' ? c.params.messages : []));
  const t = [...msgs].reverse().find((m) => m.role === 'tool');
  return typeof t?.content === 'string' ? t.content : '';
}
function catatanState(p: FakeProvider): string {
  const call = p.calls.find((c) => c.kind === 'create');
  return call?.kind === 'create' ? call.params.messages.map((m) => String(m.content)).join('\n') : '';
}

/** Persona daerah non-prioritas (permintaan pemilik produk 2026-11-12). */
const PERSONA = [
  {
    nama: 'Kota Jayapura, KTP-el pertama anak 17 tahun',
    kode: '9171',
    jenis: 'ktp',
    pesan: 'Anak saya baru 17 tahun, mau bikin KTP. KTP kami Kota Jayapura.',
    kanal: /dukcapil\.jayapurakota\.go\.id\/pacemace/,
  },
  {
    nama: 'Kota Makassar, KK baru setelah menikah',
    kode: '7371',
    jenis: 'kk',
    pesan: 'Saya baru menikah, mau buat KK baru. KTP saya Makassar.',
    kanal: /dukcapil\.makassarkota\.go\.id/,
  },
  {
    nama: 'Jakarta Selatan, KIA lewat Alpukat Betawi',
    kode: '3174',
    jenis: 'kia',
    pesan: 'Mau bikin KIA untuk anak saya, KK kami Jakarta Selatan.',
    kanal: /alpukat-dukcapil\.jakarta\.go\.id/,
  },
  {
    nama: 'Kabupaten Sorong, akta kelahiran',
    kode: '9601',
    jenis: 'kelahiran',
    pesan: 'Anak saya baru lahir, mau urus akta. KTP saya Kabupaten Sorong.',
    kanal: /sorongkab\.go\.id/,
  },
  {
    nama: 'Kota Kupang, pindah ke Kabupaten Kupang',
    kode: '5371',
    jenis: 'pindah',
    tujuan: '5301',
    pesan: 'Saya mau pindah dari Kota Kupang ke Kabupaten Kupang.',
    kanal: /dukcapil\.kupangkota\.go\.id/,
  },
] as const;

describe('ADR 0033: persona daerah non-prioritas dipandu lengkap, tanpa hand-off', () => {
  it.each(PERSONA)('$nama', async (p) => {
    // Tanpa rencana deterministik (mis. KIA sebelum bundelnya ada), model yang mengusulkan langkah.
    const deterministik = rencanaUrusan(p.jenis, { ktp: p.kode, tujuan: 'tujuan' in p ? p.tujuan : null });
    const provider = new FakeProvider({
      replies: [
        ...(deterministik
          ? []
          : [
              tool('urusan__usulkan_rencana', {
                ringkasan: 'Kartu Identitas Anak',
                langkah: [{ judul: 'Ajukan KIA ke Disdukcapil', jenis: 'offline', bawa: ['KK'] }],
              }),
            ]),
        ...(deterministik ? [balas('Ini rencananya.')] : []),
      ],
    });
    const env = makeEnv({ provider });
    let u = buatUrusanTerwilayah(env.store, { kodeKabKota: p.kode, jenis: p.jenis });
    if ('tujuan' in p)
      u = tetapkanWilayah(env.store, u, { ktp: p.kode, tujuan: p.tujuan }, publisher(env, u.id));

    // Giliran 1: rencana dipandu yang lengkap.
    const satu = await runTurn(env.deps, { urusanId: u.id, userText: p.pesan });
    const kartu = of(satu.events, 'plan_card')[0]!;
    expect(kartu, 'kartu rencana').toBeDefined();
    expect(kartu.tier).toBe('dipandu');
    expect(kartu.pendamping).toBeUndefined();
    expect(kartu.langkah.length).toBeGreaterThan(0);
    const d = kartu.dipandu!;
    expect(d.pendampingBerkembang).toBe(true);
    expect(d.pesan).toMatch(/Urusin memandu Anda langkah demi langkah/);
    expect(d.pesan).toContain('sedang kami kembangkan');
    expect(d.pesan).toContain(DAFTAR_PENDAMPING_AKTIF);
    expect(d.kanal.map((k) => k.url ?? '').join(' ')).toMatch(p.kanal);
    for (const k of d.kanal) if (k.url) expect(k.url, k.nama).toMatch(/^https:\/\//);
    expect(d.biaya.teks).toMatch(/^Gratis/);
    expect(d.biaya.sumber?.url).toBe(REF_UU24.url);
    expect(d.waktu.teks.length).toBeGreaterThan(0);
    expect(d.tips.length).toBeGreaterThan(0);
    expect(d.lanjutan.join(' ')).toMatch(/formulir/);
    // Catatan state untuk agen: Pendamping sedang dikembangkan, bukan "tidak bisa dibantu".
    expect(catatanState(provider)).toContain('BROWSER PENDAMPING: sedang dikembangkan untuk wilayah ini');
    expect(JSON.stringify(satu.events)).not.toMatch(/belum bisa dibantu/);

    expect(provider.pending).toBe(0);
    // Giliran 2: tanpa sumber yang bisa dikutip = panduan umum bertanda jujur, bukan hand-off.
    provider.enqueue(
      tool('urusan__jawab_persyaratan', { pertanyaan: 'Berapa lama jadinya dan buka jam berapa?' }),
      fakeCompletion({ content: JSON.stringify({ klaim: [], handoff: null }) }),
      balas('Panduan umum (belum dari sumber resmi daerah, cek ulang di kanal resmi): ...'),
    );
    const dua = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Berapa lama jadinya dan buka jam berapa?',
    });
    expect(of(dua.events, 'handoff')).toHaveLength(0);
    const arahan = hasilTool(provider);
    expect(arahan).toContain('Panduan umum (belum dari sumber resmi daerah, cek ulang di kanal resmi):');
    expect(arahan).toMatch(p.kanal);

    // Setujui rencana: tidak ada Browser Pendamping, label positif.
    const events: EventPayload[] = [];
    const r = setujuiRencana(env.store, u.id, (e) => void events.push(e));
    expect(r.executionId).toBeNull();
    expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
    const label = events.find((e): e is EventOf<'progress'> => e.type === 'progress')?.label ?? '';
    expect(label).toContain('sedang kami kembangkan');
    expect(label).not.toMatch(/belum bisa dibantu/);
  });

  it('daerah berportal web di luar 10 daerah (Kota Jayapura, Makassar): rute dipandu `pengembangan`', () => {
    for (const kode of ['9171', '7371', '3321', '3571'])
      for (const jenis of ['kelahiran', 'kematian', 'pindah'])
        expect(rutePendamping({ jenis, kodeKabKota: kode }), `${jenis} × ${kode}`).toMatchObject({
          jalur: 'dipandu',
          sebab: 'pengembangan',
        });
    // Wonogiri dan Surabaya tetap Browser Pendamping.
    expect(rutePendamping({ jenis: 'kelahiran', kodeKabKota: '3578' }).jalur).not.toBe('dipandu');
  });

  it('kanal WhatsApp/aplikasi disebut dalam kalimat positif', () => {
    expect(alasanDipandu('5371', 'Kota Kupang')).toMatch(
      /^Rencana disetujui\. Untuk Kota Kupang, Urusin memandu Anda langkah demi langkah\. Disdukcapil Kota Kupang melayani pengajuan lewat WhatsApp\. Browser Pendamping/,
    );
    expect(alasanDipandu(null)).not.toMatch(/belum bisa dibantu/);
  });

  it('daerah aktif yang urusannya dipandu: tanpa label "sedang dikembangkan"', () => {
    const p = paketDipandu('pindah', { ktp: refWilayah('3312')!, tujuan: refWilayah('3578') });
    expect(p.pendampingBerkembang).toBe(false);
    expect(p.pesan).not.toContain('sedang kami kembangkan');
    // Pindah: kanal Disdukcapil tujuan ikut disebut.
    expect(p.kanal.map((k) => k.url ?? '').join(' ')).toMatch(/surabaya\.go\.id/);
    expect(p.waktu).toMatchObject({ umum: false, teks: expect.stringMatching(/100 hari kerja/) });
  });

  it('kanal dipandu: portal registry dulu dengan jam layanan; warga luar daerah tanpa portal penduduk', () => {
    const k = kanalDipandu('9171', 'ktp');
    expect(k[0]).toMatchObject({
      url: 'https://dukcapil.jayapurakota.go.id/pacemace',
      kontak: expect.stringContaining('Senin-Jumat 08.00-14.00 WIT'),
    });
    expect(kanalDipandu('9171', 'ktp', true).some((x) => x.url?.includes('pacemace'))).toBe(false);
    expect(arahanPanduanUmum(k)).toContain('https://dukcapil.jayapurakota.go.id/pacemace');
  });
});
