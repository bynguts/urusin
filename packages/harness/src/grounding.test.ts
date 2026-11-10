import { ALL_ON, FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import {
  GroundedAnswerSchema,
  buildHandoff,
  KLAIM_RINGKAS,
  generateGroundedAnswer,
  handoffChannels,
  kunciUrl,
  locateQuote,
  normalizeForMatch,
  verifyGrounded,
} from './grounding.js';
import { DATAMARK, spotlight } from './spotlight.js';
import type { ChunkRecord } from './store.js';
import { appendTextFragment, buildDirective, encodeTerm, textFragmentUrl } from './textfragment.js';

const URL1 = 'https://telunjuksakti.wonogirikab.go.id/layanan/akta-kelahiran';
const chunk = (over: Partial<ChunkRecord> = {}): ChunkRecord => ({
  refId: 'c1',
  text: 'Persyaratan akta kelahiran: surat keterangan lahir dari bidan, KK orang tua, dan KTP-el kedua orang tua. Layanan ini gratis.',
  url: URL1,
  judul: 'Akta Kelahiran',
  instansi: 'Disdukcapil Kabupaten Wonogiri',
  verifiedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});
const NOW = new Date('2026-11-08T00:00:00.000Z');

describe('normalisasi kutipan', () => {
  it('spasi, huruf besar-kecil, tanda baca, dan datamark tidak menggagalkan pencocokan', () => {
    expect(normalizeForMatch('  KK   orang-tua,  dan KTP-el! ')).toBe('kk orang tua dan ktp el');
    expect(normalizeForMatch(`surat${DATAMARK}keterangan${DATAMARK}lahir`)).toBe('surat keterangan lahir');
  });

  it('locateQuote mengembalikan potongan asli dari teks sumber', () => {
    const c = chunk();
    expect(locateQuote(c.text, 'SURAT KETERANGAN LAHIR dari bidan')).toBe(
      'surat keterangan lahir dari bidan',
    );
  });

  it('kutipan terlalu pendek ditolak (mencegah kecocokan sepele)', () => {
    expect(locateQuote(chunk().text, 'dan')).toBeNull();
  });
});

describe('verifyGrounded (klaim-level)', () => {
  const real = { refId: 'c1', kutipanPersis: 'surat keterangan lahir dari bidan, KK orang tua' };

  it('klaim dengan kutipan asli lolos dan membawa sumber + Text Fragment', () => {
    const r = verifyGrounded(
      { klaim: [{ teks: 'Siapkan surat keterangan lahir dan KK.', kutipan: [real] }] },
      [chunk()],
      {},
      NOW,
    );
    expect(r.handoff).toBeUndefined();
    expect(r.klaimDibuang).toBe(0);
    const cit = r.klaim[0]!.kutipan[0]!;
    expect(cit.url).toBe(URL1);
    expect(cit.textFragmentUrl.startsWith(`${URL1}#:~:text=`)).toBe(true);
    expect(cit.perluDicekUlang).toBe(false);
  });

  it('kutipan karangan dibuang; klaim asli tetap', () => {
    const r = verifyGrounded(
      {
        klaim: [
          {
            teks: 'Wajib membayar Rp 500.000.',
            kutipan: [{ refId: 'c1', kutipanPersis: 'biaya pembuatan sebesar lima ratus ribu rupiah' }],
          },
          { teks: 'Siapkan surat keterangan lahir.', kutipan: [real] },
        ],
      },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(1);
    expect(r.klaim[0]!.teks).toContain('surat keterangan lahir');
    expect(r.klaimDibuang).toBe(1);
  });

  it('klaim dengan satu kutipan asli + satu karangan dibuang seluruhnya', () => {
    const r = verifyGrounded(
      {
        klaim: [
          {
            teks: 'campuran',
            kutipan: [real, { refId: 'c1', kutipanPersis: 'harus datang membawa kambing hitam' }],
          },
        ],
      },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(0);
    expect(r.handoff?.sebab).toBe('kutipan_tidak_terverifikasi');
  });

  it('refId yang tidak pernah diambil (halusinasi) dibuang', () => {
    const r = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [{ refId: 'c99', kutipanPersis: real.kutipanPersis }] }] },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(0);
  });

  it('klaim tanpa kutipan dibuang', () => {
    const r = verifyGrounded({ klaim: [{ teks: 'tanpa sumber', kutipan: [] }] }, [chunk()], {}, NOW);
    expect(r.klaim).toHaveLength(0);
    expect(r.klaimDibuang).toBe(1);
  });

  it('SEMUA karangan → hand-off ke kanal resmi dari registry (bukan jawaban)', () => {
    const r = verifyGrounded(
      {
        klaim: [
          { teks: 'a', kutipan: [{ refId: 'c1', kutipanPersis: 'karangan pertama yang panjang sekali' }] },
          { teks: 'b', kutipan: [{ refId: 'c1', kutipanPersis: 'karangan kedua yang juga panjang' }] },
        ],
      },
      [chunk()],
      { kodeKabKota: '3312' },
      NOW,
    );
    expect(r.klaim).toEqual([]);
    expect(r.klaimDibuang).toBe(2);
    expect(r.handoff?.alasan).toContain('Saya belum menemukan sumber resmi');
    expect(r.handoff?.kanal.length).toBeGreaterThan(0);
    expect(r.handoff?.kanal.every((k) => k.url?.startsWith('https://'))).toBe(true);
  });

  it('tanpa chunk sama sekali → hand-off tanpa_sumber', () => {
    const r = verifyGrounded({ klaim: [{ teks: 'x', kutipan: [real] }] }, [], {}, NOW);
    expect(r.handoff?.sebab).toBe('tanpa_sumber');
    expect(r.handoff?.kanal[0]?.url).toMatch(/^https:\/\//);
  });

  it('verifiedAt > 30 hari atau null → perluDicekUlang', () => {
    const old = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [real] }] },
      [chunk({ verifiedAt: '2026-08-01T00:00:00.000Z' })],
      {},
      NOW,
    );
    expect(old.klaim[0]!.kutipan[0]!.perluDicekUlang).toBe(true);
    const nul = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [real] }] },
      [chunk({ verifiedAt: null })],
      {},
      NOW,
    );
    expect(nul.klaim[0]!.kutipan[0]!.perluDicekUlang).toBe(true);
  });

  it('kutipan yang disalin model dari teks ber-datamark tetap cocok', () => {
    const marked = spotlight('rag', chunk().text, { nonce: 'n1' });
    const copied = marked.match(/surat.*?bidan/)?.[0] ?? '';
    expect(copied).toContain(DATAMARK);
    const r = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [{ refId: 'c1', kutipanPersis: copied }] }] },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(1);
    expect(r.klaim[0]!.kutipan[0]!.kutipanPersis).toBe('surat keterangan lahir dari bidan');
  });

  it('handoffChannels: kota terdaftar memakai registry; kode tak dikenal jatuh ke kanal nasional, bukan chunk', () => {
    expect(handoffChannels({ kodeKabKota: '3312', chunks: [] }).length).toBeGreaterThan(0);
    const k = handoffChannels({ kodeKabKota: '9999', chunks: [chunk()] });
    expect(k.map((x) => x.url)).toEqual(['https://dukcapil.kemendagri.go.id/']);
  });
});

describe('hand-off menurut layanan (W3), kontak (W6), dan dedup URL (W9)', () => {
  const BANSOS: ChunkRecord = chunk({
    refId: 'b1',
    url: 'https://cekbansos.kemensos.go.id/',
    judul: 'Cek Bansos',
    instansi: 'Kementerian Sosial',
  });
  const host = (u: string | undefined) => (u ? new URL(u).hostname : '');

  it('SKCK di Kota Depok diarahkan ke Polri, bukan Disdukcapil Depok', () => {
    const h = buildHandoff({ kodeKabKota: '3276', jenis: 'skck', chunks: [chunk()] }, 'tanpa_sumber');
    expect(h.kanal.length).toBeGreaterThan(0);
    expect(h.kanal[0]!.nama).toMatch(/Polri|Kepolisian/);
    expect(h.kanal.some((k) => /Kependudukan|Disdukcapil|Dukcapil/i.test(k.nama))).toBe(false);
    expect(h.kanal.every((k) => !k.url || host(k.url).endsWith('polri.go.id'))).toBe(true);
    expect(h.kanal.some((k) => k.nama.includes('Kota Depok'))).toBe(true);
    expect(h.alasan).not.toMatch(/Kependudukan|silondomaju/);
  });

  it('verifyGrounded meneruskan jenis urusan ke hand-off', () => {
    const r = verifyGrounded(
      { klaim: [{ teks: 'a', kutipan: [{ refId: 'c1', kutipanPersis: 'karangan yang panjang sekali' }] }] },
      [chunk()],
      { kodeKabKota: '3276', jenis: 'skck' },
      NOW,
    );
    expect(r.handoff?.kanal[0]?.nama).toMatch(/Polri|Kepolisian/);
  });

  it('tanpa wilayah, cek status KK tidak diarahkan ke chunk bansos: kanal nasional Dukcapil', () => {
    const k = handoffChannels({ kodeKabKota: null, jenis: 'kk', chunks: [BANSOS, chunk()] });
    expect(k.map((x) => x.url)).toEqual(['https://dukcapil.kemendagri.go.id/']);
  });

  it('jenis belum diketahui + chunk tidak relevan: tetap kanal nasional Dukcapil, bukan chunk teratas', () => {
    const k = handoffChannels({ chunks: [BANSOS] });
    expect(k.some((x) => host(x.url) === 'cekbansos.kemensos.go.id')).toBe(false);
    expect(k[0]?.url).toBe('https://dukcapil.kemendagri.go.id/');
  });

  it('urusan lain tanpa data kanal: tidak memakai chunk acak dan berkata terus terang', () => {
    const h = buildHandoff({ kodeKabKota: '3312', jenis: 'lainnya', chunks: [BANSOS] }, 'tanpa_sumber');
    expect(h.kanal).toEqual([]);
    expect(h.alasan).toContain('belum punya data kanal resmi');
  });

  it('pajak kendaraan: Bapenda DKI dari domain resmi; provinsi lain disebut tanpa tautan karangan', () => {
    const dki = handoffChannels({ kodeKabKota: '3171', jenis: 'pajak_kendaraan', chunks: [] });
    expect(dki.map((k) => host(k.url))).toEqual(['samsat-pkb2.jakarta.go.id']);
    const wng = handoffChannels({ kodeKabKota: '3312', jenis: 'pajak_kendaraan', chunks: [chunk()] });
    expect(wng).toEqual([{ nama: 'Samsat atau Bapenda Provinsi Jawa Tengah' }]);
  });

  it('adminduk DKI (p05): Suku Dinas kota administrasi lebih dulu, situs Dinas provinsi sebagai pengganti', () => {
    const h = buildHandoff({ kodeKabKota: '3175', jenis: 'kk', chunks: [] }, 'tanpa_sumber');
    expect(h.kanal[0]).toEqual({
      nama: 'Suku Dinas Kependudukan dan Pencatatan Sipil Kota Administrasi Jakarta Timur',
      url: 'https://alpukat-dukcapil.jakarta.go.id/',
    });
    expect(h.alasan).toContain(
      'Suku Dinas Kependudukan dan Pencatatan Sipil Kota Administrasi Jakarta Timur',
    );
    expect(h.alasan).not.toMatch(/Provinsi DKI/);
    expect(host(h.kanal[1]?.url)).toBe('kependudukancapil.jakarta.go.id');
  });

  it('bansos: Kemensos (cekbansos) lalu dinas sosial wilayah, bukan Disdukcapil', () => {
    const k = handoffChannels({ kodeKabKota: '3312', jenis: 'bansos', chunks: [] });
    expect(host(k[0]?.url)).toBe('cekbansos.kemensos.go.id');
    expect(k.some((x) => /Kependudukan/.test(x.nama))).toBe(false);
    expect(k.some((x) => x.nama.includes('Kabupaten Wonogiri'))).toBe(true);
  });

  it('adminduk dengan wilayah: kanal Disdukcapil membawa alamat terverifikasi', () => {
    const skh = handoffChannels({ kodeKabKota: '3311', jenis: 'kk', chunks: [] });
    expect(skh.some((k) => k.kontak === 'Alamat: Jalan Kyai Mawardi No. 1 Sukoharjo')).toBe(true);
    const wng = handoffChannels({ kodeKabKota: '3312', jenis: 'kelahiran', chunks: [] });
    expect(wng.some((k) => k.kontak?.includes('Jalan Jenderal Sudirman Nomor 147A'))).toBe(true);
  });

  it('kontak tidak dikarang untuk wilayah yang belum terverifikasi', () => {
    const k = handoffChannels({ kodeKabKota: '3276', jenis: 'ktp', chunks: [] });
    expect(k.length).toBeGreaterThan(0);
    expect(k.every((x) => x.kontak === undefined)).toBe(true);
  });

  it('URL yang hanya beda garis miring akhir, huruf besar host, atau fragment tidak dobel', () => {
    const skh = handoffChannels({ kodeKabKota: '3311', jenis: 'kk', chunks: [] });
    const kunci = skh.map((k) => kunciUrl(k.url ?? k.nama));
    expect(new Set(kunci).size).toBe(kunci.length);
    expect(skh.filter((k) => host(k.url) === 'dispendukcapil.sukoharjokab.go.id')).toHaveLength(1);
    expect(kunciUrl('https://Dispendukcapil.SukoharjoKab.go.id/#atas')).toBe(
      kunciUrl('https://dispendukcapil.sukoharjokab.go.id'),
    );
    expect(kunciUrl('https://a.go.id/x/?q=1')).not.toBe(kunciUrl('https://a.go.id/x/?q=2'));
  });
});

describe('Text Fragment (WICG)', () => {
  it('encodeTerm meng-encode spasi, koma, ampersand, dan tanda hubung', () => {
    expect(encodeTerm('KTP-el, KK & akta')).toBe('KTP%2Del%2C%20KK%20%26%20akta');
    expect(encodeTerm('biaya (gratis)')).toBe('biaya%20%28gratis%29');
    expect(encodeTerm('Rp 50.000')).toBe('Rp%2050.000');
    expect(encodeTerm('perkawinan — pasutri')).toBe('perkawinan%20%E2%80%94%20pasutri');
  });

  it('bentuk dasar: url#:~:text=<kutipan ter-encode>', () => {
    expect(textFragmentUrl(URL1, chunk().text, 'surat keterangan lahir dari bidan')).toBe(
      `${URL1}#:~:text=surat%20keterangan%20lahir%20dari%20bidan`,
    );
  });

  it('kutipan panjang memakai bentuk rentang start,end', () => {
    const q =
      'surat keterangan lahir dari bidan, KK orang tua, dan KTP-el kedua orang tua. Layanan ini gratis';
    const u = textFragmentUrl(URL1, chunk().text, q);
    expect(u).toBe(`${URL1}#:~:text=surat%20keterangan%20lahir%20dari,tua.%20Layanan%20ini%20gratis`);
    expect(u).toContain(',');
    expect(u.split('text=')[1]!.split(',')).toHaveLength(2);
  });

  it('bagian awal ambigu → prefix- (bila ada konteks sebelum) atau ,-suffix (bila di awal teks)', () => {
    const mid = 'Isi A b c. Syarat KK wajib dibawa. Isi D e f. Syarat KK wajib dibawa. Isi G';
    const u1 = textFragmentUrl('https://x.go.id/a', mid, 'Syarat KK wajib dibawa');
    expect(decodeURIComponent(u1.split('text=')[1]!)).toBe('A b c.-,Syarat KK wajib dibawa');
    const head = 'Biaya pengurusan gratis untuk warga. Biaya pengurusan gratis untuk pelajar.';
    const u2 = textFragmentUrl('https://x.go.id/a', head, 'Biaya pengurusan gratis untuk');
    expect(decodeURIComponent(u2.split('text=')[1]!)).toBe(
      'Biaya pengurusan gratis untuk,-warga. Biaya pengurusan',
    );
  });

  it('mempertahankan fragmen yang sudah ada dan mengganti directive lama', () => {
    expect(appendTextFragment('https://x.go.id/a#syarat', 'text=abc')).toBe(
      'https://x.go.id/a#syarat:~:text=abc',
    );
    expect(appendTextFragment('https://x.go.id/a#:~:text=lama', 'text=baru')).toBe(
      'https://x.go.id/a#:~:text=baru',
    );
  });

  it('buildDirective: prefix-,start,end,-suffix', () => {
    expect(buildDirective({ prefix: 'a b', start: 'c', end: 'd', suffix: 'e-f' })).toBe(
      'text=a%20b-,c,d,-e%2Df',
    );
  });
});

describe('generateGroundedAnswer', () => {
  it('mengirim sumber ber-spotlight + skema strict, dan hasil lolos verifikasi', async () => {
    const answer = {
      klaim: [
        {
          teks: 'Siapkan surat keterangan lahir.',
          kutipan: [{ refId: 'c1', kutipanPersis: 'surat keterangan lahir dari bidan' }],
        },
      ],
      handoff: null,
    };
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: JSON.stringify(answer) })] });
    const r = await generateGroundedAnswer({
      provider,
      model: 'm',
      caps: ALL_ON,
      pertanyaan: 'syarat akta lahir?',
      chunks: [chunk()],
    });
    expect(GroundedAnswerSchema.safeParse(r.data).success).toBe(true);
    const call = provider.calls[0];
    const prompt = call?.kind === 'create' ? JSON.stringify(call.params.messages) : '';
    expect(prompt).toContain('DATA_TAK_TEPERCAYA');
    expect(prompt).toContain(DATAMARK);
    // Temuan eval persona p17: jawaban terlalu panjang. Ringkas, tetapi isi wajib didahulukan.
    expect(prompt).toContain(`paling banyak ${KLAIM_RINGKAS} klaim`);
    expect(prompt).toMatch(
      /dokumen yang wajib disiapkan, lalu kanal\/cara mengajukan, lalu langkah berikutnya/,
    );
    expect(prompt).toMatch(/Lewati rincian proses internal petugas/);
    const v = verifyGrounded(r.data, [chunk()], {}, NOW);
    expect(v.klaim).toHaveLength(1);
  });
});

describe('temuan 4: fakta di klaim harus terbukti di kutipan', () => {
  const c = chunk({
    text: 'Biaya pembuatan akta kelahiran Rp 0 dan layanan dapat diakses di https://telunjuksakti.wonogirikab.go.id/layanan.',
  });
  const klaim = (teks: string) => ({
    klaim: [{ teks, kutipan: [{ refId: 'c1', kutipanPersis: 'Biaya pembuatan akta kelahiran Rp 0' }] }],
  });

  it('klaim dengan angka yang tidak ada di kutipan dibuang (kutipan sah, klaim menyelundupkan angka)', () => {
    const r = verifyGrounded(klaim('Biaya pembuatan akta kelahiran Rp 500.000'), [c], {}, NOW);
    expect(r.klaim).toEqual([]);
    expect(r.klaimDibuang).toBe(1);
    expect(r.handoff).toBeDefined();
  });

  it('klaim dengan URL/telepon yang tidak ada di kutipan dibuang', () => {
    expect(
      verifyGrounded(klaim('Biaya Rp 0, bayar di https://evil.example/bayar'), [c], {}, NOW).klaim,
    ).toEqual([]);
    expect(
      verifyGrounded(klaim('Biaya Rp 0, hubungi ' + ['0812', '3456', '7890'].join('')), [c], {}, NOW).klaim,
    ).toEqual([]);
  });

  it('angka yang memang ada di kutipan lolos', () => {
    expect(verifyGrounded(klaim('Biaya pembuatan akta kelahiran Rp 0'), [c], {}, NOW).klaim).toHaveLength(1);
  });

  it('klaim terlalu panjang dan jumlah klaim berlebih dipangkas', () => {
    const q = { refId: 'c1', kutipanPersis: 'Biaya pembuatan akta kelahiran Rp 0' };
    const panjang = { teks: 'Biaya pembuatan akta kelahiran ' + 'x'.repeat(500), kutipan: [q] };
    expect(verifyGrounded({ klaim: [panjang] }, [c], {}, NOW).klaim).toEqual([]);
    const banyak = {
      klaim: Array.from({ length: 12 }, () => ({ teks: 'Biaya akta kelahiran gratis', kutipan: [q] })),
    };
    const r = verifyGrounded(banyak, [c], {}, NOW);
    expect(r.klaim).toHaveLength(8);
    expect(r.klaimDibuang).toBe(4);
  });
});
